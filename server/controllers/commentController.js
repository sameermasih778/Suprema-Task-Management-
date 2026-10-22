const pool = require('../config/db');

/**
 * GET /api/v1/comments?task_id=1
 * Fetch comments for a specific task
 */
const getTaskComments = async (req, res, next) => {
  try {
    const { task_id } = req.query;

    if (!task_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: task_id query parameter is required'
      });
    }

    const [comments] = await pool.query(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.content, tc.created_at, tc.updated_at,
              u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = $1
       ORDER BY tc.created_at ASC`,
      [task_id]
    );

    res.status(200).json({
      success: true,
      count: comments.length,
      comments
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/comments
 * Add a comment to a task
 */
const addComment = async (req, res, next) => {
  try {
    const { task_id, content } = req.body;
    const userId = req.user.id;

    if (!task_id || !content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: task_id and content are required'
      });
    }

    const [result] = await pool.query(
      'INSERT INTO task_comments (task_id, user_id, content) VALUES ($1, $2, $3) RETURNING id',
      [task_id, userId, content.trim()]
    );

    const commentId = result.insertId;

    // Fetch user details for instant response
    const [user] = await pool.query('SELECT name, avatar_url, role FROM users WHERE id = $1', [userId]);

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment: {
        id: commentId,
        task_id,
        user_id: userId,
        content: content.trim(),
        user_name: user[0]?.name,
        user_avatar: user[0]?.avatar_url,
        user_role: user[0]?.role,
        created_at: new Date()
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/comments/:id
 * Delete a comment
 */
const deleteComment = async (req, res, next) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    const [existing] = await pool.query('SELECT user_id FROM task_comments WHERE id = $1', [commentId]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    if (existing[0].user_id !== userId && !['super_admin', 'admin'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only delete your own comments'
      });
    }

    await pool.query('DELETE FROM task_comments WHERE id = $1', [commentId]);

    res.status(200).json({
      success: true,
      message: 'Comment deleted successfully'
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTaskComments,
  addComment,
  deleteComment
};
