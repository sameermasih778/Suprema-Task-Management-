const pool = require('../config/db');
const path = require('path');
const { saveAttachment, removeStoredAsset } = require('../config/assetStorage');

/**
 * POST /api/v1/attachments
 * Upload a document/image attachment for a task
 */
const uploadAttachment = async (req, res, next) => {
  try {
    const { task_id } = req.body;
    const userId = req.user.id;
    const file = req.file;

    if (!task_id || !file) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: task_id and file upload are required'
      });
    }

    // Cloudinary when CLOUDINARY_URL is configured (production/Vercel),
    // local disk otherwise. `publicId` is stored in the filename column so a
    // later delete can target the exact stored object.
    const ext = path.extname(file.originalname).toLowerCase();
    const stored = await saveAttachment(file.buffer, { ext, mime: file.mimetype });
    const file_path = stored.url;

    const [result] = await pool.query(
      `INSERT INTO task_attachments (task_id, user_id, filename, original_name, file_path, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [task_id, userId, stored.publicId, file.originalname, file_path, file.buffer.length, file.mimetype]
    );

    const attachmentId = result.insertId;

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      attachment: {
        id: attachmentId,
        task_id,
        filename: stored.publicId,
        original_name: file.originalname,
        file_path,
        file_size: file.size,
        mime_type: file.mimetype
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/attachments?task_id=1
 * Fetch attachments for a task
 */
const getTaskAttachments = async (req, res, next) => {
  try {
    const { task_id } = req.query;

    if (!task_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: task_id query parameter is required'
      });
    }

    const [attachments] = await pool.query(
      `SELECT ta.id, ta.task_id, ta.user_id, ta.filename, ta.original_name, 
              ta.file_path, ta.file_size, ta.mime_type, ta.created_at,
              u.name AS uploader_name
       FROM task_attachments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1
       ORDER BY ta.created_at DESC`,
      [task_id]
    );

    res.status(200).json({
      success: true,
      count: attachments.length,
      attachments
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/attachments/:id
 * Delete an attachment
 */
const deleteAttachment = async (req, res, next) => {
  try {
    const attachmentId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    /**
     * Load the attachment together with the workspace it lives in. Every value
     * used to make the authorisation decision below comes from the database -
     * never from the request - so a caller cannot influence it.
     */
    const [existing] = await pool.query(
      `SELECT a.user_id AS uploader_id, a.file_path, p.workspace_id
         FROM task_attachments a
         JOIN tasks    t ON t.id = a.task_id
         JOIN projects p ON p.id = t.project_id
        WHERE a.id = $1`,
      [attachmentId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const attachment = existing[0];

    /**
     * Who may delete an attachment:
     *   - the member who uploaded it
     *   - an owner or admin of the workspace it belongs to
     *   - any staff account (super_admin / admin / developer)
     *
     * Without this check any authenticated user could delete any file in any
     * workspace simply by supplying its ID.
     */
    const isStaff = ['super_admin', 'admin', 'developer'].includes(userRole);
    let isWorkspaceManager = false;

    if (!isStaff && attachment.uploader_id !== userId) {
      const [membership] = await pool.query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [attachment.workspace_id, userId]
      );
      const workspaceRole = membership[0]?.role;
      isWorkspaceManager = workspaceRole === 'owner' || workspaceRole === 'admin';
    }

    if (!isStaff && attachment.uploader_id !== userId && !isWorkspaceManager) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only delete attachments that you uploaded.'
      });
    }

    // Remove the stored object (Cloudinary URL or legacy local file). Cleanup
    // is best-effort and must never fail the request.
    try {
      await removeStoredAsset(attachment.file_path);
    } catch (cleanupError) {
      console.warn('[Attachment] Could not remove stored file:', cleanupError.message);
    }

    await pool.query('DELETE FROM task_attachments WHERE id = $1', [attachmentId]);

    res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully'
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadAttachment,
  getTaskAttachments,
  deleteAttachment
};
