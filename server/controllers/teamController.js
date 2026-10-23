const pool = require('../config/db');
const { logActivity } = require('../utils/activityLogger');

// Staff (admin/developer/super_admin) may manage every team. Everyone else may
// only manage the teams they created themselves - without this, any signed-in
// user could add/remove members from any team in the workspace.
const STAFF_ROLES = ['super_admin', 'admin', 'developer'];
const canManageTeam = async (req, team) => {
  if (STAFF_ROLES.includes(req.user.role)) return true;
  // Only the creator of the team AND an owner/admin of the workspace it
  // lives in may manage it. Being the creator alone is not enough - an
  // invited member who created a team in a workspace they were only
  // invited into must not be able to edit it or add members to it.
  if (Number(team.created_by) !== Number(req.user.id)) return false;

  const [rows] = await pool.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [team.workspace_id, req.user.id]
  );
  return rows.length > 0 && ['owner', 'admin'].includes(rows[0].role);
};

/**
 * GET /api/v1/teams?workspace_id=1
 * Fetch teams inside a workspace
 */
const getTeams = async (req, res, next) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: workspace_id query parameter is required'
      });
    }

    const userId = req.user.id;
    const isStaff = ['super_admin', 'admin', 'developer'].includes(req.user.role);

    // A workspace owner/admin (or staff) may see every team in the workspace.
    // A plain member only sees the teams they actually belong to - otherwise
    // an invited member would see (and be tempted to manage) teams they were
    // never added to.
    let canSeeAll = isStaff;
    if (!canSeeAll) {
      const [wm] = await pool.query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspace_id, userId]
      );
      if (wm.length > 0 && ['owner', 'admin'].includes(wm[0].role)) canSeeAll = true;
    }

    const baseSql = `SELECT t.id, t.workspace_id, t.name, t.description, t.created_by, t.created_at,
            (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count
     FROM teams t
     WHERE t.workspace_id = $1`;
    const sql = canSeeAll
      ? `${baseSql} ORDER BY t.created_at DESC`
      : `${baseSql} AND EXISTS (SELECT 1 FROM team_members tm2 WHERE tm2.team_id = t.id AND tm2.user_id = $2) ORDER BY t.created_at DESC`;
    const params = canSeeAll ? [workspace_id] : [workspace_id, userId];

    const [teams] = await pool.query(sql, params);

    res.status(200).json({
      success: true,
      count: teams.length,
      teams
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/teams/mine
 * Teams the current user is a member of, across every workspace they
 * belong to - not just the active one. This is what makes a team a
 * member was added to actually show up for them.
 */
const getMyTeams = async (req, res, next) => {
  try {
    const [teams] = await pool.query(
      `SELECT t.id, t.workspace_id, w.name AS workspace_name, t.name, t.description,
              t.created_by, t.created_at, tm.role AS team_role,
              (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id) AS member_count
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       JOIN workspaces w ON t.workspace_id = w.id
       WHERE tm.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      count: teams.length,
      teams
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/teams
 * Create a team within a workspace
 */
const createTeam = async (req, res, next) => {
  try {
    const { workspace_id, name, description } = req.body;
    const userId = req.user.id;

    if (!workspace_id || !name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: workspace_id and team name are required'
      });
    }

    const [result] = await pool.query(
      'INSERT INTO teams (workspace_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [workspace_id, name.trim(), description || null, userId]
    );

    const teamId = result.insertId;

    // Automatically add creator as team leader
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'leader') RETURNING id",
      [teamId, userId]
    );

    // Activity log
    await logActivity({
      workspace_id,
      user_id: userId,
      action: 'TEAM_CREATED',
      entity_type: 'team',
      entity_id: teamId,
      details: { name: name.trim(), description }
    });

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      team: {
        id: teamId,
        workspace_id,
        name: name.trim(),
        description,
        member_count: 1
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/teams/:id/members
 * Fetch team members
 */
const getTeamMembers = async (req, res, next) => {
  try {
    const teamId = req.params.id;

    const [members] = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, tm.role, tm.joined_at,
              u.role AS global_role
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at ASC`,
      [teamId]
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
 * POST /api/v1/teams/:id/members
 * Add user to team
 */
const addTeamMember = async (req, res, next) => {
  try {
    const teamId = req.params.id;
    const { user_id, role = 'member' } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: user_id is required'
      });
    }

    const [teamRows] = await pool.query(
      `SELECT t.workspace_id, t.name, t.created_by, w.name AS workspace_name
       FROM teams t JOIN workspaces w ON t.workspace_id = w.id WHERE t.id = $1`,
      [teamId]
    );
    if (teamRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    if (!(await canManageTeam(req, teamRows[0]))) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only manage teams in workspaces you own or administer'
      });
    }

    const [existing] = await pool.query(
      'SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, user_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: User is already a member of this team'
      });
    }

    await pool.query(
      'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
      [teamId, user_id, role]
    );

    // Notify the member that they were added, including the role they were
    // given. A failure here must never break the add itself, so it is
    // deliberately isolated and never throws.
    if (Number(user_id) !== req.user.id) {
      try {
        const [addedUser] = await pool.query('SELECT name FROM users WHERE id = $1', [user_id]);
        const [actor] = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
        const roleLabel = role === 'leader' ? 'Team Leader' : 'Member';
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, link)
           VALUES ($1, $2, $3, 'system', FALSE, $4) RETURNING id`,
          [
            user_id,
            `Added to team "${teamRows[0].name}"`,
            `${actor[0]?.name || 'An administrator'} added you to team "${teamRows[0].name}" in workspace "${teamRows[0].workspace_name}" as ${roleLabel}.`,
            '/dashboard/teams'
          ]
        );
      } catch (notifyErr) {
        console.warn('Failed to send team-add notification:', notifyErr.message);
      }
    }

    await logActivity({
      workspace_id: teamRows[0].workspace_id,
      user_id: req.user.id,
      action: 'TEAM_MEMBER_ADDED',
      entity_type: 'team',
      entity_id: Number(teamId),
      details: { team_name: teamRows[0].name, user_id, role }
    });

    res.status(201).json({
      success: true,
      message: 'Member added to team successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/teams/:id/members/:userId
 * Remove user from team
 */
const removeTeamMember = async (req, res, next) => {
  try {
    const { id: teamId, userId } = req.params;

    const [teamRows] = await pool.query('SELECT id, workspace_id, name, created_by FROM teams WHERE id = $1', [teamId]);
    if (teamRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    if (!(await canManageTeam(req, teamRows[0]))) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only manage teams in workspaces you own or administer'
      });
    }

    await pool.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    await logActivity({
      workspace_id: teamRows[0].workspace_id,
      user_id: req.user.id,
      action: 'TEAM_MEMBER_REMOVED',
      entity_type: 'team',
      entity_id: Number(teamId),
      details: { team_name: teamRows[0].name, removed_user_id: userId }
    });

    res.status(200).json({
      success: true,
      message: 'Member removed from team'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/teams/:id
 * Delete team
 */
const deleteTeam = async (req, res, next) => {
  try {
    const teamId = req.params.id;

    const [teamRows] = await pool.query('SELECT id, workspace_id, name, created_by FROM teams WHERE id = $1', [teamId]);
    if (teamRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    if (!(await canManageTeam(req, teamRows[0]))) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only manage teams in workspaces you own or administer'
      });
    }

    await pool.query('DELETE FROM teams WHERE id = $1', [teamId]);

    await logActivity({
      workspace_id: teamRows[0].workspace_id,
      user_id: req.user.id,
      action: 'TEAM_DELETED',
      entity_type: 'team',
      entity_id: Number(teamId),
      details: { name: teamRows[0].name }
    });

    res.status(200).json({
      success: true,
      message: 'Team deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeams,
  getMyTeams,
  createTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  deleteTeam
};
