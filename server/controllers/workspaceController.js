const pool = require('../config/db');

/**
 * GET /api/v1/workspaces
 * Fetch all workspaces the logged-in user belongs to
 */
const getUserWorkspaces = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [workspaces] = await pool.query(
      `SELECT w.id, w.name, w.slug, w.plan, w.status, w.owner_id, w.created_at, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE wm.user_id = ?
       ORDER BY w.created_at DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      count: workspaces.length,
      workspaces
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/workspaces
 * Create a new workspace and assign current user as owner
 */
const createWorkspace = async (req, res, next) => {
  let connection;
  try {
    const { name, plan = 'free' } = req.body;
    const userId = req.user.id;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Workspace name is required'
      });
    }

    const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [wsResult] = await connection.query(
      'INSERT INTO workspaces (name, slug, owner_id, plan) VALUES (?, ?, ?, ?)',
      [name.trim(), slug, userId, plan]
    );

    const workspaceId = wsResult.insertId;

    await connection.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, "owner")',
      [workspaceId, userId]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      success: true,
      message: 'Workspace created successfully',
      workspace: {
        id: workspaceId,
        name: name.trim(),
        slug,
        owner_id: userId,
        plan,
        role: 'owner'
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

/**
 * GET /api/v1/workspaces/:id/members
 * Fetch all members of a workspace
 */
const getWorkspaceMembers = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;

    const [members] = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.role AS global_role, wm.role AS workspace_role, wm.joined_at 
       FROM workspace_members wm 
       JOIN users u ON wm.user_id = u.id 
       WHERE wm.workspace_id = ? 
       ORDER BY wm.joined_at ASC`,
      [workspaceId]
    );

    res.status(200).json({
      success: true,
      count: members.length,
      members
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/workspaces/:id/members
 * Add a member to a workspace by email
 */
const addWorkspaceMember = async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const { email, role = 'member' } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: User email is required'
      });
    }

    // Find user by email
    const [users] = await pool.query('SELECT id, name, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User Error: User with provided email does not exist'
      });
    }

    const targetUser = users[0];

    // Check if already in workspace
    const [existing] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, targetUser.id]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: User is already a member of this workspace'
      });
    }

    await pool.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [workspaceId, targetUser.id, role]
    );

    // Log activity
    const { logActivity } = require('../utils/activityLogger');
    await logActivity({
      workspace_id: workspaceId,
      user_id: req.user.id,
      action: 'MEMBER_JOINED',
      entity_type: 'workspace',
      entity_id: workspaceId,
      details: {
        member_name: targetUser.name,
        member_email: targetUser.email,
        role
      }
    });

    res.status(201).json({
      success: true,
      message: `${targetUser.name} added to workspace successfully`,
      member: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        workspace_role: role,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(targetUser.name)}`
      }
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserWorkspaces,
  createWorkspace,
  getWorkspaceMembers,
  addWorkspaceMember
};
