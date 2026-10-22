const pool = require('../config/db');
const { logActivity } = require('../utils/activityLogger');

/**
 * Admin management of workspaces.
 *
 * A workspace is a tenant: it owns teams, projects, tasks, comments,
 * attachments and its own audit trail. Deleting one cascades through all of
 * that, so the destructive path is deliberately awkward and the reversible
 * path (archive) is the normal one.
 *
 *   archive    -> the workspace freezes: it leaves the switcher, every row of
 *                 data is kept, and it can be restored at any time.
 *   delete     -> permanent, super admin only, and the caller has to type the
 *                 workspace name to prove it is not an accident.
 */

const PLANS = ['free', 'pro', 'enterprise'];

/** Counts of everything that a permanent delete would destroy. */
const getDeletionImpact = async (workspaceId) => {
  const [counts] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = $1) AS members,
       (SELECT COUNT(*) FROM teams WHERE workspace_id = $2) AS teams,
       (SELECT COUNT(*) FROM projects WHERE workspace_id = $3) AS projects,
       (SELECT COUNT(*) FROM tasks t
          JOIN projects p ON t.project_id = p.id
         WHERE p.workspace_id = $4) AS tasks,
       (SELECT COUNT(*) FROM task_comments tc
          JOIN tasks t ON tc.task_id = t.id
          JOIN projects p ON t.project_id = p.id
         WHERE p.workspace_id = $5) AS comments,
       (SELECT COUNT(*) FROM task_attachments ta
          JOIN tasks t ON ta.task_id = t.id
          JOIN projects p ON t.project_id = p.id
         WHERE p.workspace_id = $6) AS attachments,
       (SELECT COUNT(*) FROM activity_logs WHERE workspace_id = $7) AS activity_entries`,
    [
      workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId,
      workspaceId
    ]
  );

  return counts[0];
};

/**
 * GET /api/v1/admin/workspaces
 * Every workspace on the platform, with the numbers an admin needs to decide
 * what to do with it.
 */
const listWorkspaces = async (req, res, next) => {
  try {
    const [workspaces] = await pool.query(
      `SELECT w.id, w.name, w.slug, w.plan, w.status, w.owner_id, w.created_at,
              owner.name AS owner_name, owner.email AS owner_email, owner.avatar_url AS owner_avatar,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
              (SELECT COUNT(*) FROM teams t WHERE t.workspace_id = w.id) AS team_count,
              (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id) AS project_count,
              (SELECT COUNT(*) FROM tasks t
                 JOIN projects p ON t.project_id = p.id
                WHERE p.workspace_id = w.id) AS task_count,
              (SELECT COUNT(*) FROM workspace_invitations wi
                WHERE wi.workspace_id = w.id AND wi.status = 'pending') AS pending_invitations
       FROM workspaces w
       LEFT JOIN users owner ON w.owner_id = owner.id
       ORDER BY w.created_at DESC
       LIMIT 200`
    );

    res.status(200).json({
      success: true,
      count: workspaces.length,
      summary: {
        total: workspaces.length,
        active: workspaces.filter((w) => w.status === 'active').length,
        archived: workspaces.filter((w) => w.status === 'archived').length,
        pendingInvitations: workspaces.reduce((sum, w) => sum + w.pending_invitations, 0)
      },
      workspaces
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/workspaces
 * Create a workspace on someone's behalf.
 *
 * ownerEmail is optional:
 *   - given, and that person has an account -> they are invited as the owner
 *     and only become a member when they accept.
 *   - given, but no such account -> 404, because an invitation needs somebody
 *     to accept it.
 *   - omitted -> the creating admin owns it, and the workspace starts with
 *     nobody else in it.
 */
const createWorkspace = async (req, res, next) => {
  let connection;
  try {
    const { name, plan = 'free', ownerEmail } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Workspace name is required'
      });
    }
    if (!PLANS.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: plan must be one of ${PLANS.join(', ')}`
      });
    }

    let owner = { id: req.user.id, name: req.user.name, email: req.user.email };
    let invitationFor = null;

    if (ownerEmail && ownerEmail.trim()) {
      const [users] = await pool.query(
        'SELECT id, name, email FROM users WHERE email = $1',
        [ownerEmail.trim().toLowerCase()]
      );
      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: `User Error: No account with the email "${ownerEmail.trim()}". They need an account before they can be invited.`
        });
      }
      owner = users[0];
      invitationFor = owner;
    }

    const slug = `${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [wsResult] = await connection.query(
      'INSERT INTO workspaces (name, slug, owner_id, plan, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name.trim(), slug, owner.id, plan, 'active']
    );
    const workspaceId = wsResult.insertId;

    let invitationId = null;

    if (invitationFor) {
      // The designated owner is NOT a member yet - they accept first.
      const [invResult] = await connection.query(
        `INSERT INTO workspace_invitations (workspace_id, user_id, email, role, invited_by, status)
         VALUES ($1, $2, $3, 'owner', $4, 'pending') RETURNING id`,
        [workspaceId, invitationFor.id, invitationFor.email, req.user.id]
      );
      invitationId = invResult.insertId;

      try {
        await connection.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, link)
           VALUES ($1, $2, $3, 'invitation', FALSE, $4) RETURNING id`,
          [
            invitationFor.id,
            `Invitation to own "${name.trim()}"`,
            `${req.user.name} created the workspace "${name.trim()}" for you and invited you to own it. Accept the invitation to become its owner.`,
            `/dashboard/teams?invitation=${invitationId}`
          ]
        );
      } catch (notifyErr) {
        console.warn('Failed to send workspace-owner invitation notification:', notifyErr.message);
      }
    } else {
      // No owner named: the creating admin owns it.
      await connection.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
        [workspaceId, req.user.id, 'owner']
      );
    }

    await connection.commit();
    connection.release();

    await logActivity({
      workspace_id: workspaceId,
      user_id: req.user.id,
      action: 'WORKSPACE_CREATED',
      entity_type: 'workspace',
      entity_id: workspaceId,
      details: {
        name: name.trim(),
        plan,
        owner_name: owner.name,
        owner_email: owner.email,
        invitation_id: invitationId
      }
    });

    res.status(201).json({
      success: true,
      message: invitationFor
        ? `Workspace created. ${invitationFor.name} has been invited to own it.`
        : 'Workspace created. You own it.',
      workspace: {
        id: workspaceId,
        name: name.trim(),
        slug,
        plan,
        status: 'active',
        owner_name: owner.name,
        owner_email: owner.email,
        invitation_id: invitationId
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

/** Archive (freeze) a workspace. Reversible. */
const archiveWorkspace = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;

    const [rows] = await pool.query('SELECT id, name, status FROM workspaces WHERE id = $1', [
      workspaceId
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    if (rows[0].status === 'archived') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: this workspace is already archived'
      });
    }

    await pool.query("UPDATE workspaces SET status = 'archived' WHERE id = $1", [workspaceId]);

    await logActivity({
      workspace_id: workspaceId,
      user_id: req.user.id,
      action: 'WORKSPACE_ARCHIVED',
      entity_type: 'workspace',
      entity_id: workspaceId,
      details: { name: rows[0].name }
    });

    res.status(200).json({
      success: true,
      message: `"${rows[0].name}" is archived. All of its data is kept and it can be restored.`
    });
  } catch (error) {
    next(error);
  }
};

/** Restore an archived workspace. */
const restoreWorkspace = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;

    const [rows] = await pool.query('SELECT id, name, status FROM workspaces WHERE id = $1', [
      workspaceId
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    if (rows[0].status !== 'archived') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: this workspace is not archived'
      });
    }

    await pool.query("UPDATE workspaces SET status = 'active' WHERE id = $1", [workspaceId]);

    await logActivity({
      workspace_id: workspaceId,
      user_id: req.user.id,
      action: 'WORKSPACE_RESTORED',
      entity_type: 'workspace',
      entity_id: workspaceId,
      details: { name: rows[0].name }
    });

    res.status(200).json({
      success: true,
      message: `'${rows[0].name}' is active again.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/admin/workspaces/:id/deletion-impact
 * What a permanent delete would destroy, so the admin can be told before
 * they confirm it.
 */
const getWorkspaceDeletionImpact = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;

    const [rows] = await pool.query(
      `SELECT w.id, w.name, w.slug, w.plan, w.status,
              owner.name AS owner_name, owner.email AS owner_email
       FROM workspaces w
       LEFT JOIN users owner ON w.owner_id = owner.id
       WHERE w.id = $1`,
      [workspaceId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const impact = await getDeletionImpact(workspaceId);

    res.status(200).json({
      success: true,
      workspace: rows[0],
      impact,
      // The caller has to send this back exactly, which is what makes the
      // destructive action deliberate.
      confirmation: rows[0].name
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/workspaces/:id
 * Permanently destroy a workspace and everything inside it.
 *
 * Super admin only, and the request must echo the workspace name back as
 * `confirm`. The workspace you are currently working in can never be deleted.
 */
const deleteWorkspace = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const { confirm } = req.body || {};

    const [rows] = await pool.query('SELECT id, name FROM workspaces WHERE id = $1', [
      workspaceId
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    const workspace = rows[0];

    if (confirm !== workspace.name) {
      // Say WHICH of the two went wrong. 'Nothing was sent' and 'the name does
      // not match' look identical from the outside, and the first one is
      // almost always a client sending the confirmation in the wrong place.
      const nothingSent =
        confirm === undefined || confirm === null || confirm === '';
      return res.status(400).json({
        success: false,
        message: nothingSent
          ? `Validation Error: no confirmation was sent. Send the exact workspace name '${workspace.name}' as 'confirm' in the request body.`
          : `Validation Error: send the exact workspace name '${workspace.name}' as 'confirm' to delete it`
      });
    }

    // Deleting a workspace you are the OWNER of is allowed - an admin who
    // created a workspace and then wants to remove it must not be blocked.
    // The one thing that must never happen is deleting your LAST remaining
    // workspace, because that locks you out of the app entirely.
    const [otherWorkspaces] = await pool.query(
      'SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND workspace_id <> $2',
      [req.user.id, workspaceId]
    );
    if (otherWorkspaces.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'This is your only workspace, so it cannot be deleted - you would be locked out of the app. Create or get access to another one first, or archive it instead.'
      });
    }

    const impact = await getDeletionImpact(workspaceId);

    // Cascades take the members, teams, projects, tasks, comments, attachments
    // and the audit trail with it. The notifications are user-scoped and
    // survive, so the people involved still see what happened.
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);

    res.status(200).json({
      success: true,
      message: `"${workspace.name}" and everything in it has been permanently deleted.`,
      destroyed: impact
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listWorkspaces,
  createWorkspace,
  archiveWorkspace,
  restoreWorkspace,
  getWorkspaceDeletionImpact,
  deleteWorkspace
};
