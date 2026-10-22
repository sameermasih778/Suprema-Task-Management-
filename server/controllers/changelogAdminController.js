const pool = require('../config/db');
const { withLineBreaks } = require('../utils/text');

/**
 * Changelog manager — staff CRUD over the table the public changelog reads.
 *
 * The public read endpoint already exists and orders by release_date DESC, which
 * is why release_date is required here rather than optional: an entry with no
 * release date sorts to the bottom, which is exactly the "oldest entry shown
 * first" bug migration 007 fixed for existing rows.
 */

const BADGE_COLORS = [
  'text-emerald-400',
  'text-blue-400',
  'text-amber-400',
  'text-purple-400',
  'text-rose-400',
  'text-zinc-400'
];

const parseJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Heading fields only. Single-line admin inputs cannot hold a real newline, so
 * an editor describes the break with the two characters `\` and `n` (most
 * visibly in the banner title, which the public page renders with
 * `whitespace-pre-line`). Store a real newline instead, so the line breaks.
 *
 * Deliberately NOT applied to the free-text columns (description, note): a
 * genuine backslash there is content, not an escape.
 */
const headingText = (value) => withLineBreaks(String(value).trim());
const optionalHeadingText = (value) =>
  (value ? withLineBreaks(String(value).trim()) || null : null);

/**
 * Accept either a JSON array, an array, or one bullet per line.
 * Editors type one bullet per line; storing JSON keeps the column shape the
 * public endpoint already expects.
 */
const normaliseBullets = (input) => {
  if (Array.isArray(input)) {
    return JSON.stringify(input.map((b) => String(b).trim()).filter(Boolean));
  }
  if (typeof input === 'string' && input.trim()) {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return JSON.stringify(parsed.map((b) => String(b).trim()).filter(Boolean));
        }
      } catch {
        // Not valid JSON - fall through and treat it as one bullet per line.
      }
    }
    return JSON.stringify(trimmed.split('\n').map((b) => b.trim()).filter(Boolean));
  }
  return null;
};

/**
 * GET /api/v1/admin/changelogs
 */
const getAdminChangelogs = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, tag_id, date, release_date, badge, badge_color, title, description,
              sub_item_title, sub_item_description, tag, banner_title, bullets, note, created_at
         FROM changelogs
        ORDER BY release_date DESC, id DESC`
    );

    res.status(200).json({
      success: true,
      count: rows.length,
      changelogs: rows.map((r) => ({
        ...r,
        bullets: parseJsonArray(r.bullets)
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Shared validation for create and update.
 * Returns an error message, or null when the payload is usable.
 */
const validate = (body) => {
  const tagId = String(body.tagId || body.tag_id || '').trim();
  const title = String(body.title || '').trim();
  const releaseDate = String(body.releaseDate || body.release_date || '').trim();

  if (!tagId) return 'A version tag is required (for example v1.4.0).';
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(tagId)) {
    return 'The version tag may only contain letters, numbers, dots, dashes and underscores.';
  }
  if (!title) return 'A title is required.';
  if (!releaseDate) return 'A release date is required so the entry sorts correctly.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    return 'The release date must be in YYYY-MM-DD format.';
  }
  // Node does NOT reject an impossible date - it silently rolls it forward:
  // new Date('2030-02-31') is 3 March, not "Invalid Date". So asking whether
  // the value is invalid cannot catch February 31st, which would then reach a
  // DATE column and coerce or fail there instead. Parse as UTC and compare the
  // round-tripped date back against the input; the overflow shows up as a
  // mismatch. UTC also keeps the result independent of the server's timezone.
  const parsed = new Date(`${releaseDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== releaseDate) {
    return 'That release date is not a real date.';
  }

  const badgeColor = String(body.badgeColor || body.badge_color || 'text-emerald-400').trim();
  if (!BADGE_COLORS.includes(badgeColor)) {
    return `Badge colour must be one of: ${BADGE_COLORS.join(', ')}`;
  }

  return null;
};

/**
 * POST /api/v1/admin/changelogs
 */
const createChangelog = async (req, res, next) => {
  try {
    const body = req.body || {};

    const invalid = validate(body);
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const tagId = String(body.tagId || body.tag_id).trim();

    // tag_id is UNIQUE, so check first to return a clear message instead of a
    // raw unique-violation bubbling through as a 500. PostgreSQL reports that
    // as error code 23505.
    const [existing] = await pool.query('SELECT id FROM changelogs WHERE tag_id = $1', [tagId]);
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Version ${tagId} is already in the changelog. Edit that entry instead.`
      });
    }

    const releaseDate = String(body.releaseDate || body.release_date).trim();

    // `date` is the human-readable label shown on the card; default it to the
    // release date formatted, so an editor only fills it in to override.
    const label = String(body.date || '').trim() ||
      new Date(releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    await pool.query(
      `INSERT INTO changelogs
         (tag_id, date, release_date, badge, badge_color, title, description,
          sub_item_title, sub_item_description, tag, banner_title, bullets, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        tagId,
        label,
        releaseDate,
        String(body.badge || 'New').trim() || 'New',
        String(body.badgeColor || body.badge_color || 'text-emerald-400').trim(),
        headingText(body.title),
        body.description ? String(body.description).trim() : null,
        optionalHeadingText(body.subItemTitle),
        body.subItemDescription ? String(body.subItemDescription).trim() : null,
        body.tag ? String(body.tag).trim() : null,
        optionalHeadingText(body.bannerTitle),
        normaliseBullets(body.bullets),
        body.note ? String(body.note).trim() : null
      ]
    );

    res.status(201).json({
      success: true,
      message: `${tagId} added to the changelog.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/admin/changelogs/:tagId
 */
const updateChangelog = async (req, res, next) => {
  try {
    const { tagId } = req.params;
    const body = req.body || {};

    const invalid = validate({ ...body, tagId });
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const [existing] = await pool.query('SELECT id FROM changelogs WHERE tag_id = $1', [tagId]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No changelog entry found for ${tagId}.`
      });
    }

    const releaseDate = String(body.releaseDate || body.release_date).trim();
    const label = String(body.date || '').trim() ||
      new Date(releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    await pool.query(
      `UPDATE changelogs SET
         date = $1, release_date = $2, badge = $3, badge_color = $4, title = $5, description = $6,
         sub_item_title = $7, sub_item_description = $8, tag = $9, banner_title = $10,
         bullets = $11, note = $12
       WHERE tag_id = $13`,
      [
        label,
        releaseDate,
        String(body.badge || 'New').trim() || 'New',
        String(body.badgeColor || body.badge_color || 'text-emerald-400').trim(),
        headingText(body.title),
        body.description ? String(body.description).trim() : null,
        optionalHeadingText(body.subItemTitle),
        body.subItemDescription ? String(body.subItemDescription).trim() : null,
        body.tag ? String(body.tag).trim() : null,
        optionalHeadingText(body.bannerTitle),
        normaliseBullets(body.bullets),
        body.note ? String(body.note).trim() : null,
        tagId
      ]
    );

    res.status(200).json({
      success: true,
      message: `${tagId} updated.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/changelogs/:tagId
 */
const deleteChangelog = async (req, res, next) => {
  try {
    const { tagId } = req.params;

    const [result] = await pool.query('DELETE FROM changelogs WHERE tag_id = $1', [tagId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: `No changelog entry found for ${tagId}.`
      });
    }

    res.status(200).json({
      success: true,
      message: `${tagId} removed from the changelog.`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminChangelogs,
  createChangelog,
  updateChangelog,
  deleteChangelog,
  BADGE_COLORS
};