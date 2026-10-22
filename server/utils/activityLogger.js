const pool = require('../config/db');

/**
 * Log an audit trail entry to activity_logs table
 * @param {Object} params
 * @param {number} params.workspace_id
 * @param {number} [params.user_id]
 * @param {string} params.action - e.g. 'TASK_CREATED', 'TASK_UPDATED', 'MEMBER_JOINED', 'TEAM_CREATED'
 * @param {string} params.entity_type - 'task' | 'project' | 'team' | 'workspace' | 'comment'
 * @param {number} [params.entity_id]
 * @param {Object} [params.details]
 */
const logActivity = async ({ workspace_id, user_id, action, entity_type, entity_id, details }) => {
  try {
    if (!workspace_id) return;
    await pool.query(
      `INSERT INTO activity_logs (workspace_id, user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        workspace_id,
        user_id || null,
        action,
        entity_type,
        entity_id || null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (err) {
    console.warn('[ActivityLogger] Error logging activity:', err.message);
  }
};

module.exports = { logActivity };
