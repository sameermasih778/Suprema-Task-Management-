const pool = require('../config/db');
const { logActivity } = require('../utils/activityLogger');

/**
 * Workspace invitations.
 *
 * A workspace invitation is a REQUEST, not a silent add. The person invited
 * decides:
 *
 *   pending  -> the invitee has not answered yet
 *   accepted -> they said yes, and are now a member of the workspace
 *   rejected -> they said no, and nothing happened
 *
 * The membership row in workspace_members is only written on acceptance, so
 * "who is in this workspace" always means "who agreed to be in it".
 *
 * Only people who already have an account can be invited, because acceptance
 * requires someone to accept. (A pre-registration invite would need a
 * different flow: match on email at sign-up time.)
 */

const INVITABLE_ROLES = ['owner', 'admin', 'member', 'guest'];

/** Human label for a workspace role, used in the notification text. */
const roleLabel = (role) =>
  ({ owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' }[role] || 'Member');

/**
 * Who may send invitations for a workspace.
 *
 * Platform admins (super admin / admin) can manage ANY workspace - that is
 * the whole point of the admin Workspaces page, where you invite people into
 * a workspace you are not a member of yourself.
 *
 * A developer can manage the workspaces they belong to. Everyone else needs
 * to be the owner or an admin of that specific workspace.
 *
 * This mirrors the rule used for team management; the backend enforces the
 * same thing and this is only the front door.
 */
const canManageWorkspace = async (req, workspaceId) => {
  if (['super_admin', 'admin'].includes(req.user.role)) return true;

  const [rows] = await pool.query(
    `SELECT wm.role
     FROM workspace_members wm
     WHERE wm.workspace_id = ? AND wm.user_id = ?`,
    [workspaceId, req.user.id]
  );

  if (rows.length === 0) return false;
  return ['owner', 'admin'].includes(rows[0].role);
};

/**
 * POST /api/v1/workspaces/:id/invitations
 * Send a workspace invitation. The invitee is NOT a member yet.
 */
const createInvitation = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const { email, role = 'member' } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: a valid email address is required'
      });
    }

    if (!INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: role must be one of ${INVITABLE_ROLES.join(', ')}`
      });
    }

    if (!(await canManageWorkspace(req, workspaceId))) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you cannot invite people to this workspace'
      });
    }

    const [workspaceRows] = await pool.query(
      'SELECT id, name FROM workspaces WHERE id = ?',
      [workspaceId]
    );
    if (workspaceRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    const workspace = workspaceRows[0];

    const [users] = await pool.query(
      'SELECT id, name, email FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User Error: User with provided email does not exist'
      });
    }
    const invitee = users[0];

    if (Number(invitee.id) === Number(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: you cannot invite yourself'
      });
    }

    const [alreadyMember] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, invitee.id]
    );
    if (alreadyMember.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: User is already a member of this workspace'
      });
    }

    // Re-inviting someone who already has a pending invitation updates that
    // invitation rather than stacking up duplicates.
    const [pending] = await pool.query(
      `SELECT id FROM workspace_invitations
       WHERE workspace_id = ? AND user_id = ? AND status = 'pending'`,
      [workspaceId, invitee.id]
    );

    let invitationId;
    if (pending.length > 0) {
      invitationId = pending[0].id;
      await pool.query(
        `UPDATE workspace_invitations
         SET role = ?, invited_by = ?, email = ?, created_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [role, req.user.id, invitee.email, invitationId]
      );
    } else {
      const [result] = await pool.query(
        `INSERT INTO workspace_invitations (workspace_id, user_id, email, role, invited_by, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [workspaceId, invitee.id, invitee.email, role, req.user.id]
      );
      invitationId = result.insertId;
    }

    const [actor] = await pool.query('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const actorName = actor[0]?.name || 'An administrator';
    const roleText = roleLabel(role);

    // Tell the invitee. This is the notification that was missing before -
    // an invitation used to be a silent add.
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, link)
         VALUES (?, ?, ?, 'invitation', FALSE, ?)`,
        [
          invitee.id,
          `Invitation to join "${workspace.name}"`,
          `${actorName} invited you to join the workspace "${workspace.name}" as ${roleText}. Accept or decline it from the Teams page.`,
          `/dashboard/teams?invitation=${invitationId}`
        ]
      );
    } catch (notifyErr) {
      console.warn('Failed to send invitation notification:', notifyErr.message);
    }

    await logActivity({
      workspace_id: workspaceId,
      user_id: req.user.id,
      action: 'WORKSPACE_INVITATION_SENT',
      entity_type: 'workspace',
      entity_id: workspaceId,
      details: {
        member_name: invitee.name,
        member_email: invitee.email,
        role,
        invitation_id: invitationId
      }
    });

    res.status(201).json({
      success: true,
      message: `Invitation sent to ${invitee.name}. They will appear as a member once they accept.`,
      invitation: {
        id: invitationId,
        workspace_id: workspaceId,
        workspace_name: workspace.name,
        user_id: invitee.id,
        name: invitee.name,
        email: invitee.email,
        role,
        status: 'pending'
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/workspaces/:id/invitations
 * Invitations this workspace has sent, and how each one was answered.
 * Managers only - this is the "who accepted / who rejected" view.
 */
const getWorkspaceInvitations = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;

    if (!(await canManageWorkspace(req, workspaceId))) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you cannot view invitations for this workspace'
      });
    }

    const [invitations] = await pool.query(
      `SELECT wi.id, wi.workspace_id, wi.user_id, wi.email, wi.role, wi.status,
              wi.created_at, wi.responded_at,
              u.name AS invitee_name, u.avatar_url AS invitee_avatar,
              inviter.name AS inviter_name
       FROM workspace_invitations wi
       LEFT JOIN users u ON wi.user_id = u.id
       LEFT JOIN users inviter ON wi.invited_by = inviter.id
       WHERE wi.workspace_id = ?
       ORDER BY wi.created_at DESC
       LIMIT 100`,
      [workspaceId]
    );

    res.status(200).json({
      success: true,
      count: invitations.length,
      pending: invitations.filter((i) => i.status === 'pending').length,
      invitations
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/invitations
 * Invitations addressed to the logged-in user.
 */
const getMyInvitations = async (req, res, next) => {
  try {
    const [invitations] = await pool.query(
      `SELECT wi.id, wi.workspace_id, wi.role, wi.status, wi.created_at, wi.responded_at,
              w.name AS workspace_name, w.slug AS workspace_slug, w.plan,
              inviter.name AS inviter_name, inviter.avatar_url AS inviter_avatar
       FROM workspace_invitations wi
       JOIN workspaces w ON wi.workspace_id = w.id
       LEFT JOIN users inviter ON wi.invited_by = inviter.id
       WHERE wi.user_id = ?
       ORDER BY wi.status = 'pending' DESC, wi.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      count: invitations.length,
      pending: invitations.filter((i) => i.status === 'pending').length,
      invitations
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/invitations/:id/respond
 * Accept or decline an invitation. Only the invited person may answer, and
 * only once - a second response is rejected rather than silently ignored.
 */
const respondToInvitation = async (req, res, next) => {
  let connection;
  try {
    const invitationId = req.params.id;
    const { action } = req.body;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Validation Error: action must be 'accept' or 'reject'"
      });
    }

    const [rows] = await pool.query(
      `SELECT wi.*, w.name AS workspace_name
       FROM workspace_invitations wi
       JOIN workspaces w ON wi.workspace_id = w.id
       WHERE wi.id = ?`,
      [invitationId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    const invitation = rows[0];

    if (Number(invitation.user_id) !== Number(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: this invitation was not addressed to you'
      });
    }

    if (invitation.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: `Conflict: this invitation was already ${invitation.status}`
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    if (action === 'accept') {
      // The membership only exists from the moment they accept.
      await connection.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role)`,
        [invitation.workspace_id, invitation.user_id, invitation.role]
      );
    }

    await connection.query(
      `UPDATE workspace_invitations SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [action === 'accept' ? 'accepted' : 'rejected', invitationId]
    );

    await connection.commit();
    connection.release();

    // Tell the person who sent it how it went.
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, link)
         VALUES (?, ?, ?, 'system', FALSE, ?)`,
        [
          invitation.invited_by,
          action === 'accept'
            ? `${req.user.name} accepted your invitation`
            : `${req.user.name} declined your invitation`,
          action === 'accept'
            ? `${req.user.name} accepted your invitation to join the workspace "${invitation.workspace_name}". They are now a member.`
            : `${req.user.name} declined your invitation to join the workspace "${invitation.workspace_name}".`,
          '/dashboard/teams'
        ]
      );
    } catch (notifyErr) {
      console.warn('Failed to send invitation response notification:', notifyErr.message);
    }

    await logActivity({
      workspace_id: invitation.workspace_id,
      user_id: req.user.id,
      action: action === 'accept' ? 'WORKSPACE_INVITATION_ACCEPTED' : 'WORKSPACE_INVITATION_REJECTED',
      entity_type: 'workspace',
      entity_id: invitation.workspace_id,
      details: {
        member_name: req.user.name,
        member_email: invitation.email,
        role: invitation.role,
        invitation_id: invitationId
      }
    });

    res.status(200).json({
      success: true,
      message:
        action === 'accept'
          ? `You joined "${invitation.workspace_name}".`
          : `Invitation to "${invitation.workspace_name}" declined.`,
      invitation: {
        id: invitationId,
        workspace_id: invitation.workspace_id,
        workspace_name: invitation.workspace_name,
        role: invitation.role,
        status: action === 'accept' ? 'accepted' : 'rejected'
      }
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
  createInvitation,
  getWorkspaceInvitations,
  getMyInvitations,
  respondToInvitation
};
