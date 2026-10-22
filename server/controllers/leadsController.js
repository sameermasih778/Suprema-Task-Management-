const pool = require('../config/db');

/**
 * Marketing leads captured by the public site.
 *
 * The contact form and the waitlist have both been writing rows since the
 * marketing APIs shipped, but staff had no way to read them. This is that
 * missing inbox - and the honest version of an export, meaning the CSV is
 * generated from the same rows the list endpoints return rather than from a
 * second, possibly divergent, query.
 *
 * Note on auditing: these rows are platform-level, not workspace-level, so
 * status changes are deliberately NOT written to `activity_logs` - that table is
 * keyed by workspace_id and a lead does not belong to one. Inventing a
 * workspace for the entry would produce a misleading audit trail. If lead
 * auditing is ever required, add a dedicated table rather than borrowing the
 * workspace one.
 */

/**
 * Build a CSV string from a header row and data rows.
 *
 * The subtlety that matters: a value containing a comma, a quote or a newline
 * breaks naive `join(',')` exports - Excel then silently shifts every column.
 * Wrapping in quotes and doubling any embedded quote is what keeps the file
 * correct when a customer writes "Smith, John" in a message.
 */
const toCsv = (headers, rows) => {
  const escapeCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.map(escapeCell).join(',')];
  rows.forEach((row) => lines.push(row.map(escapeCell).join(',')));

  // A BOM makes Excel open the file as UTF-8 instead of mangling accents.
  return `\uFEFF${lines.join('\r\n')}`;
};

/**
 * GET /api/v1/admin/leads/contact
 * Website inquiries, newest first.
 */
const getContactMessages = async (req, res, next) => {
  try {
    const { status } = req.query;

    let sql = 'SELECT id, name, email, subject, message, status, created_at FROM contact_messages';
    const params = [];

    if (status && ['unread', 'read', 'replied'].includes(status)) {
      sql += ' WHERE status = $1';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const [messages] = await pool.query(sql, params);

    const [counts] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'unread') AS unread,
         COUNT(*) FILTER (WHERE status = 'replied') AS replied
       FROM contact_messages`
    );

    res.status(200).json({
      success: true,
      count: messages.length,
      summary: {
        total: counts[0].total || 0,
        unread: counts[0].unread || 0,
        replied: counts[0].replied || 0
      },
      messages
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/leads/contact/:id/status
 * Move an inquiry between unread / read / replied.
 */
const updateContactStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['unread', 'read', 'replied'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Valid statuses: unread, read, replied"
      });
    }

    const [result] = await pool.query(
      'UPDATE contact_messages SET status = $1 WHERE id = $2',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found'
      });
    }

    res.status(200).json({
      success: true,
      message: `Inquiry marked as ${status}`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/admin/leads/waitlist
 * Waitlist signups in real queue order.
 */
const getWaitlistLeads = async (req, res, next) => {
  try {
    const { status } = req.query;

    let sql = 'SELECT id, email, queue_position, referral_code, status, created_at FROM waitlist_leads';
    const params = [];

    if (status && ['pending', 'invited', 'active'].includes(status)) {
      sql += ' WHERE status = $1';
      params.push(status);
    }

    // NULL positions sort last: they can only exist if a row predates the
    // queue_position feature, and hiding them at the bottom is correct.
    sql += ' ORDER BY queue_position IS NULL, queue_position ASC, created_at ASC';

    const [leads] = await pool.query(sql, params);

    const [counts] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'invited') AS invited,
         COUNT(*) FILTER (WHERE status = 'active') AS active
       FROM waitlist_leads`
    );

    res.status(200).json({
      success: true,
      count: leads.length,
      summary: {
        total: counts[0].total || 0,
        pending: counts[0].pending || 0,
        invited: counts[0].invited || 0,
        active: counts[0].active || 0
      },
      leads
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/leads/waitlist/:id/status
 * Move a signup between pending / invited / active.
 */
const updateWaitlistStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'invited', 'active'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Valid statuses: pending, invited, active'
      });
    }

    const [result] = await pool.query(
      'UPDATE waitlist_leads SET status = $1 WHERE id = $2',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Waitlist signup not found'
      });
    }

    res.status(200).json({
      success: true,
      message: `Signup marked as ${status}`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/admin/leads/export?type=contact|waitlist
 * Download the same data as a CSV file.
 */
const exportLeadsCsv = async (req, res, next) => {
  try {
    const type = req.query.type === 'contact' ? 'contact' : 'waitlist';

    if (type === 'contact') {
      const [rows] = await pool.query(
        'SELECT name, email, subject, status, message, created_at FROM contact_messages ORDER BY created_at DESC'
      );

      const csv = toCsv(
        ['Name', 'Email', 'Subject', 'Status', 'Message', 'Submitted'],
        rows.map((r) => [r.name, r.email, r.subject, r.status, r.message, r.created_at])
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="suprema-contact-leads.csv"');
      return res.status(200).send(csv);
    }

    const [rows] = await pool.query(
      'SELECT queue_position, email, referral_code, status, created_at FROM waitlist_leads ORDER BY queue_position IS NULL, queue_position ASC'
    );

    const csv = toCsv(
      ['Position', 'Email', 'Referral Code', 'Status', 'Joined'],
      rows.map((r) => [r.queue_position, r.email, r.referral_code, r.status, r.created_at])
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="suprema-waitlist.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getContactMessages,
  updateContactStatus,
  getWaitlistLeads,
  updateWaitlistStatus,
  exportLeadsCsv
};