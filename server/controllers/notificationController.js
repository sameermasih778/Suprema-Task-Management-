const pool = require('../config/db');

/**
 * GET /api/v1/notifications
 * Fetch notifications for logged-in user
 */
const getUserNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [notifications] = await pool.query(
      'SELECT id, title, message, type, is_read, link, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId]
    );

    const unreadCount = notifications.filter(n => !n.is_read).length;

    res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount,
      notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark notification as read
 */
const markAsRead = async (req, res, next) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [notificationId, userId]
    );

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/notifications/read-all
 * Mark all notifications as read
 */
const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;

    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1',
      [userId]
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserNotifications,
  markAsRead,
  markAllAsRead
};
