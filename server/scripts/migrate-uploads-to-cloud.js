/**
 * One-time migration: move existing LOCAL upload files to Cloudinary.
 *
 * Run this ONCE after configuring CLOUDINARY_URL, if your database still
 * contains rows created while files were stored on local disk:
 *
 *   users.avatar_url        LIKE '/uploads/avatars/...'
 *   task_attachments.file_path LIKE '/uploads/...'
 *
 * Each matching file is re-uploaded to Cloudinary and the row is rewritten
 * to the absolute https://res.cloudinary.com/... URL. Rows whose file is
 * already missing on disk are reported and left untouched (their image will
 * simply fall back to the placeholder badge).
 *
 * Usage:
 *   CLOUDINARY_URL=cloudinary://... node scripts/migrate-uploads-to-cloud.js
 *
 * Safe to re-run: rows already pointing at Cloudinary are skipped.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  saveAvatar,
  saveAttachment,
  usingCloudStorage
} = require('../config/assetStorage');

const LOCAL_PREFIX = '/uploads/';
const UPLOAD_ROOT = path.join(__dirname, '../uploads');

function localFileFor(urlPath) {
  const relative = String(urlPath).replace(/^\/uploads\//, '');
  const target = path.resolve(UPLOAD_ROOT, relative);
  if (target !== UPLOAD_ROOT && !target.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return fs.existsSync(target) ? target : null;
}

async function migrateAvatars() {
  const [rows] = await pool.query(
    "SELECT id, avatar_url FROM users WHERE avatar_url LIKE '/uploads/%'"
  );
  let moved = 0;
  let skipped = 0;

  for (const row of rows) {
    const filePath = localFileFor(row.avatar_url);
    if (!filePath) {
      console.warn(`  ! user ${row.id}: local file missing for ${row.avatar_url} (left as-is)`);
      skipped++;
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const stored = await saveAvatar(buffer, ext, row.id);
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [stored.url, row.id]);
    fs.unlinkSync(filePath);
    console.log(`  -> user ${row.id}: ${row.avatar_url} => ${stored.url}`);
    moved++;
  }
  return { moved, skipped, total: rows.length };
}

async function migrateAttachments() {
  const [rows] = await pool.query(
    "SELECT id, filename, file_path, mime_type FROM task_attachments WHERE file_path LIKE '/uploads/%'"
  );
  let moved = 0;
  let skipped = 0;

  for (const row of rows) {
    const filePath = localFileFor(row.file_path);
    if (!filePath) {
      console.warn(`  ! attachment ${row.id}: local file missing for ${row.file_path} (left as-is)`);
      skipped++;
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const stored = await saveAttachment(buffer, { ext, mime: row.mime_type });
    await pool.query(
      'UPDATE task_attachments SET file_path = $1, filename = $2 WHERE id = $3',
      [stored.url, stored.publicId, row.id]
    );
    fs.unlinkSync(filePath);
    console.log(`  -> attachment ${row.id}: ${row.file_path} => ${stored.url}`);
    moved++;
  }
  return { moved, skipped, total: rows.length };
}

(async () => {
  if (!usingCloudStorage()) {
    console.error(
      'CLOUDINARY_URL is not configured - refusing to run.\n' +
      'Set it in server/.env first, then re-run this script.'
    );
    process.exit(1);
  }

  console.log('Migrating local uploads to Cloudinary...');
  const avatars = await migrateAvatars();
  console.log(`Avatars:     ${avatars.moved}/${avatars.total} moved, ${avatars.skipped} missing on disk`);

  const attachments = await migrateAttachments();
  console.log(`Attachments: ${attachments.moved}/${attachments.total} moved, ${attachments.skipped} missing on disk`);

  console.log('Done.');
  process.exit(0);
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
