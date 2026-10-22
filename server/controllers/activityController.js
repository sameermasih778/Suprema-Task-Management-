const pool = require('../config/db');

/**
 * GET /api/v1/activity?workspace_id=1
 * Fetch activity audit logs for a workspace
 */
const getWorkspaceActivity = async (req, res, next) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: workspace_id query parameter is required'
      });
    }

    const [activities] = await pool.query(
      `SELECT al.id, al.workspace_id, al.user_id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.workspace_id = $1
       ORDER BY al.created_at DESC
       LIMIT 50`,
      [workspace_id]
    );

    res.status(200).json({
      success: true,
      count: activities.length,
      activities
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getWorkspaceActivity
};
