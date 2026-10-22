const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { logActivity } = require('../utils/activityLogger');
const { sendMailWithDeadline, isConfigured: isMailConfigured } = require('../config/mailer');

const JWT_SECRET = process.env.JWT_SECRET || 'suprema_jwt_super_secret_key_2026_dev_mode';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * GET /api/v1/admin/users
 * List all registered users (Admin/Super Admin only)
 */
const getAllUsers = async (req, res, next) => {
  try {
    const [users] = await pool.query(
      `SELECT id, name, email, role, status, created_at,
        (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = users.id) as workspace_count
       FROM users
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/admin/invitations
 * Every workspace invitation on the platform, with its current status and the
 * audit trail of how it was answered.
 *
 * This is the staff view: invitations are per-workspace, but an admin
 * overseeing the platform needs to see them all in one place - who was
 * invited where, by whom, and whether they accepted, declined or never
 * answered.
 */
const getAllInvitations = async (req, res, next) => {
  try {
    const [invitations] = await pool.query(
      `SELECT wi.id, wi.workspace_id, wi.user_id, wi.email, wi.role, wi.status,
              wi.created_at, wi.responded_at,
              w.name AS workspace_name,
              u.name AS invitee_name, u.avatar_url AS invitee_avatar, u.role AS invitee_role,
              inviter.name AS inviter_name,
              inviter.id AS inviter_id
       FROM workspace_invitations wi
       JOIN workspaces w ON wi.workspace_id = w.id
       LEFT JOIN users u ON wi.user_id = u.id
       LEFT JOIN users inviter ON wi.invited_by = inviter.id
       ORDER BY wi.created_at DESC
       LIMIT 200`
    );

    // The audit trail for each invitation, so the page can show the full
    // story of one invitation and not just its final state.
    const [history] = await pool.query(
      `SELECT al.id, al.action, al.entity_id AS workspace_id, al.details, al.created_at,
              u.name AS actor_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.action IN (
         'WORKSPACE_INVITATION_SENT',
         'WORKSPACE_INVITATION_ACCEPTED',
         'WORKSPACE_INVITATION_REJECTED'
       )
       ORDER BY al.created_at DESC
       LIMIT 200`
    );

    const historyByWorkspace = history.reduce((acc, entry) => {
      const key = `${entry.workspace_id}`;
      acc[key] = acc[key] || [];
      acc[key].push(entry);
      return acc;
    }, {});

    const decorated = invitations.map((inv) => {
      let details = {};
      try {
        details =
          typeof inv.details === 'string' ? JSON.parse(inv.details) : inv.details || {};
      } catch {
        details = {};
      }
      return {
        ...inv,
        invited_by_me: Number(inv.inviter_id) === Number(req.user.id),
        invitee_name: inv.invitee_name || details.member_name || inv.email,
        history: historyByWorkspace[String(inv.workspace_id)] || []
      };
    });

    res.status(200).json({
      success: true,
      count: decorated.length,
      summary: {
        total: decorated.length,
        pending: decorated.filter((i) => i.status === 'pending').length,
        accepted: decorated.filter((i) => i.status === 'accepted').length,
        rejected: decorated.filter((i) => i.status === 'rejected').length
      },
      invitations: decorated
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/users/:id/role
 * Update a user's role (Super Admin, Admin, Developer)
 * Allows self-role promotion (including assigning super_admin) and issues an immediate fresh token.
 */
const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['super_admin', 'admin', 'developer', 'member', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Valid roles: ${validRoles.join(', ')}`
      });
    }

    const targetUserId = parseInt(id, 10);
    const isSelf = targetUserId === req.user.id;

    const [result] = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, targetUserId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let newToken = null;
    let updatedUser = null;

    if (isSelf) {
      const [[userRow]] = await pool.query(
        'SELECT id, name, email, role, status, avatar_url FROM users WHERE id = $1',
        [targetUserId]
      );
      if (userRow) {
        newToken = jwt.sign(
          {
            id: userRow.id,
            email: userRow.email,
            role: userRow.role,
            name: userRow.name
          },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRES_IN }
        );
        updatedUser = userRow;
      }
    }

    // Best-effort activity logging
    logActivity({
      workspaceId: req.user.workspace_id || null,
      userId: req.user.id,
      action: isSelf ? 'self_updated_role' : 'updated_user_role',
      entityType: 'user',
      entityId: targetUserId,
      metadata: { targetUserId, newRole: role, isSelf }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: isSelf
        ? `Your role was updated to '${role}' successfully`
        : `User role updated to '${role}' successfully`,
      isSelf,
      token: newToken,
      user: updatedUser
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/users/:id/status
 * Suspend / Re-activate a user account (Admin, Developer & Super Admin)
 * A suspended user is blocked at login by authController.login
 */
const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Valid statuses: ${validStatuses.join(', ')}`
      });
    }

    if (parseInt(id, 10) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own account status'
      });
    }

    // Fetch target so we can protect Super Admin accounts from lower roles
    const [users] = await pool.query(
      'SELECT id, name, role, status FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const target = users[0];

    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only a Super Admin can change the status of a Super Admin account'
      });
    }

    const [result] = await pool.query(
      'UPDATE users SET status = $1 WHERE id = $2',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const verb = status === 'active' ? 're-activated' : status === 'suspended' ? 'suspended' : 'marked inactive';

    res.status(200).json({
      success: true,
      message: `User "${target.name}" has been ${verb} successfully`,
      status
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/users/:id/reset-password
 *
 * Body (optional): { "new_password": "Something strong" }
 *
 * With no body the server generates a strong temporary password. Either way the
 * new password is emailed to the account owner. It is returned in the response
 * ONLY when it could not be emailed - a password never appears in a response
 * that also claims the email went out.
 */
const resetUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requested =
      typeof req.body?.new_password === 'string' ? req.body.new_password.trim() : '';

    if (requested) {
      if (requested.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters long.'
        });
      }
      // bcrypt only hashes the first 72 bytes, so a longer password would be
      // silently truncated - the user would be given something that is not
      // what was actually stored. Reject instead.
      if (Buffer.byteLength(requested, 'utf8') > 72) {
        return res.status(400).json({
          success: false,
          message: 'Password is too long (72 characters maximum).'
        });
      }
    }

    const [users] = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = users[0];

    // Admin-supplied password, or a strong generated one.
    const newPassword =
      requested ||
      `Sup-${crypto.randomBytes(6).toString('base64url')}!${Math.floor(Math.random() * 90 + 10)}`;
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashedPassword, user.id]
    );

    // Audit trail: who changed whose password, and in which mode.
    try {
      const [wsRows] = await pool.query(
        'SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1',
        [req.user.id]
      );
      await logActivity({
        workspace_id: wsRows[0]?.workspace_id,
        user_id: req.user.id,
        action: 'admin.password_reset',
        entity_type: 'user',
        entity_id: user.id,
        details: { target_email: user.email, mode: requested ? 'admin_set' : 'generated' }
      });
    } catch (logErr) {
      console.warn('[Admin] Could not write password activity log:', logErr.message);
    }

    let emailSent = false;
    let emailQueued = false;
    let emailError = null;

    // Send email with the new password. Bounded wait: Gmail's TLS handshake can
    // take 15s+ on some networks, and that must never hold this request open.
    // If it has not been accepted within the deadline the send continues in the
    // background and the admin is told so.
    if (isMailConfigured()) {
      const result = await sendMailWithDeadline({
          from: `"Suprema OS Security" <${process.env.SMTP_USER}>`,
          to: user.email,
          subject: requested
            ? '🔐 Your Suprema Password Has Been Changed'
            : '🔐 Your Suprema Password Has Been Reset',
          html: `
            <div style="font-family: Arial, sans-serif; background-color: #09090b; color: #ffffff; padding: 40px 20px;">
              <div style="max-width: 480px; margin: 0 auto; background-color: #18181b; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 32px; text-align: center;">
                <h2 style="color: #ffffff; margin-bottom: 8px;">${requested ? 'Password Changed' : 'Password Reset'}</h2>
                <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 24px;">
                  Hi <strong style="color: #fff;">${user.name}</strong>, an administrator
                  ${requested ? 'set a new password' : 'reset your password'} for your Suprema account.
                </p>
                <div style="background-color: #000; border: 1px solid #6366f1; border-radius: 14px; padding: 18px; font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #818cf8; margin-bottom: 24px; word-break: break-all;">
                  ${newPassword}
                </div>
                <p style="color: #71717a; font-size: 12px; margin-bottom: 8px;">Sign in with this password.</p>
                <p style="color: #71717a; font-size: 12px;">If you were not expecting this change, contact your administrator immediately.</p>
              </div>
            </div>
          `
      });

      emailSent = result.sent === true;
      emailQueued = result.queued === true;
      emailError = result.error || null;
      console.log(
        `[Admin] Password email for ${user.email}: ` +
        (emailSent ? 'sent' : emailQueued ? 'still sending in background' : `failed (${emailError})`)
      );
    } else {
      emailError = 'SMTP is not configured on this server';
      console.log(`[DEV] Password for ${user.email}: ${newPassword}`);
    }

    const verb = requested ? 'changed' : 'reset';

    res.status(200).json({
      success: true,
      emailSent,
      emailQueued,
      message: emailSent
        ? `Password ${verb}. The new password was emailed to ${user.email}.`
        : emailQueued
          ? `Password ${verb} instantly. The email to ${user.email} is still being sent in the background - share the password below if it does not arrive.`
          : `Password ${verb}, but the email could not be sent (${emailError}). Share the password below securely.`,
      // Returned only when the email was NOT confirmed delivered, so it must
      // be passed on manually.
      ...(!emailSent && { newPassword })
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/users/:id
 * Delete a user account (Super Admin only)
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (parseInt(id, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }

    const [result] = await pool.query('DELETE FROM users WHERE id = $1', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/notifications/broadcast
 * Send an announcement to ALL users, or to specific users.
 * Admin / Developer / Super Admin only.
 *
 * Body:
 *   title    (required) string
 *   message  (required) string
 *   type     (optional) info | task_assigned | mention | system | announcement
 *   link     (optional) string
 *   user_ids (optional) array of user IDs. Omit or pass [] to notify everyone.
 */
const broadcastNotification = async (req, res, next) => {
  let connection;

  try {
    const { title, message, type = 'announcement', link = null, user_ids } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required'
      });
    }

    // Validate against the allowed types before the database does. Postgres'
    // CHECK constraint would reject an invalid value with an unfriendly 500,
    // and the traffic still costs a round trip - so keep the check up here.
    const VALID_TYPES = ['info', 'task_assigned', 'mention', 'system', 'announcement'];
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid notification type '${type}'. Valid types: ${VALID_TYPES.join(', ')}`
      });
    }

    // Normalise the recipient list. Anything that is not a usable integer is
    // rejected rather than silently dropped, so a malformed id never turns
    // into a broadcast to everybody by accident.
    let targetIds = null;
    if (user_ids !== undefined && user_ids !== null) {
      if (!Array.isArray(user_ids)) {
        return res.status(400).json({
          success: false,
          message: 'user_ids must be an array of user IDs'
        });
      }

      const parsed = user_ids.map(Number);
      if (parsed.some((id) => !Number.isInteger(id) || id <= 0)) {
        return res.status(400).json({
          success: false,
          message: 'user_ids must contain only positive integer user IDs'
        });
      }

      targetIds = [...new Set(parsed)]; // de-duplicate
    }

    // Resolve recipients, ignoring any ids that do not exist.
    let recipients;
    if (targetIds && targetIds.length > 0) {
      // PostgreSQL placeholders are numbered, so each id gets its own $n
      // rather than a row of '?'. The '$' is concatenated rather than written
      // as '$$' because '$$' in a template literal is two literal dollars,
      // not an escaped one - which would produce "$$1" and a syntax error.
      const placeholders = targetIds.map((_, i) => '$' + (i + 1)).join(',');
      const [found] = await pool.query(
        `SELECT id, name, email FROM users WHERE id IN (${placeholders})`,
        targetIds
      );
      recipients = found;

      if (recipients.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'None of the selected users could be found'
        });
      }
    } else {
      const [all] = await pool.query('SELECT id, name, email FROM users');
      recipients = all;

      if (recipients.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No users to notify',
          recipientCount: 0
        });
      }
    }

    // Insert all rows in one transaction so a partial broadcast is impossible.
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const values = recipients.map((u) => [u.id, title, message, type, false, link]);
    await connection.query(
      'INSERT INTO notifications (user_id, title, message, type, is_read, link) VALUES $1 RETURNING id',
      [values]
    );

    await connection.commit();
    connection.release();
    connection = null;

    const targeted = targetIds && targetIds.length > 0;
    const missing = targeted ? targetIds.length - recipients.length : 0;

    res.status(201).json({
      success: true,
      message: targeted
        ? `Notification sent to ${recipients.length} user(s)` +
          (missing > 0 ? ` (${missing} skipped - not found)` : '')
        : `Broadcast sent to ${recipients.length} users`,
      recipientCount: recipients.length,
      scope: targeted ? 'selected' : 'all',
      recipients: recipients.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      skippedCount: missing
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    next(error);
  }
};

module.exports = {
  getAllUsers,
  getAllInvitations,
  updateUserRole,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  broadcastNotification
};
