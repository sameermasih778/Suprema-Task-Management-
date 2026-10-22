/**
 * Copy the live application data from Aiven (MySQL) to Supabase (PostgreSQL).
 *
 * Option (a): the Aiven database stays untouched and keeps serving the app
 * until the DATABASE_URL on Vercel is switched over. This script only reads
 * from it.
 *
 * Tables are copied in foreign-key order, with their original ids, so every
 * relationship (task -> project -> workspace, comments -> task, ...) survives
 * the move untouched.
 */

const path = require('path');
const dotenv = require('dotenv');

const SERVER = 'C:/Users/Sameer Khokhar/Desktop/KhawajaLabs Project 2/server';
dotenv.config({ path: path.join(SERVER, '.env') });

const mysql = require(path.join(SERVER, 'node_modules/mysql2/promise'));
const { Client } = require(path.join(SERVER, 'node_modules/pg'));

// --- source: Aiven MySQL (read only) ---
const SOURCE = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// --- target: Supabase Postgres ---
const TARGET = process.env.DATABASE_URL;

// Foreign-key order.
const TABLES = [
  'users',
  'workspaces',
  'workspace_members',
  'teams',
  'team_members',
  'projects',
  'tasks',
  'task_comments',
  'task_attachments',
  'activity_logs',
  'notifications',
  'workspace_invitations',
  'email_verifications',
  'password_reset_tokens',
  'contact_messages',
  'waitlist_leads',
  'changelogs',
  'pricing_plans',
  'blogs'
];

// Columns that need special treatment on the way across.
const DATE_ONLY = new Set(['due_date', 'start_date']);

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date);

(async () => {
  console.log('source:', SOURCE.host + ':' + SOURCE.port + '/' + SOURCE.database);
  console.log('target: Supabase (from DATABASE_URL)\n');

  const src = await mysql.createConnection({
    ...SOURCE,
    // Read the timestamps as strings, in UTC, so no local-timezone shift creeps
    // into the copy.
    dateStrings: true,
    multipleStatements: false
  });
  // The MySQL server runs in a local timezone five hours behind UTC. Pinning
  // the session to UTC means every timestamp it hands over is already UTC.
  await src.query("SET time_zone = '+00:00'");

  const dst = new Client({ connectionString: TARGET, ssl: { rejectUnauthorized: false } });
  await dst.connect();

  // The migration engine has to run on the target BEFORE the data is copied:
  // schema.sql is the base table set, and the migrations are what add the
  // later columns (changelogs.release_date, for one). Copying first would
  // fail on a column the target does not have yet.
  const { runMigrations } = require(path.join(__dirname, '../database/migrate'));
  console.log('applying migrations to the target...');
  await runMigrations(dst);
  console.log('');

  // Start from a clean slate so the script can be re-run safely.
  console.log('clearing the target tables...');
  await dst.query(
    `TRUNCATE TABLE ${TABLES.slice().reverse().join(', ')} RESTART IDENTITY CASCADE`
  );

  let totalRows = 0;

  for (const table of TABLES) {
    const [rows] = await src.query(`SELECT * FROM \`${table}\``);
    if (!rows.length) {
      console.log(`  ${table.padEnd(24)} 0 rows`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    for (const row of rows) {
      const values = columns.map((column) => {
        const value = row[column];
        if (value === null || value === undefined) return null;
        if (value instanceof Date) return value.toISOString();
        if (Buffer.isBuffer(value)) return value;
        if (isPlainObject(value)) return JSON.stringify(value);
        if (DATE_ONLY.has(column) && typeof value === 'string') {
          // Trim a DATETIME down to the date part for a DATE column.
          return value.slice(0, 10);
        }
        return value;
      });

      const placeholders = columns.map((_, i) => '$' + (i + 1)).join(', ');
      await dst.query(
        `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`,
        values
      );
    }

    totalRows += rows.length;
    console.log(`  ${table.padEnd(24)} ${rows.length} rows`);
  }

  // The identity columns were fed explicit ids, so the sequences are still
  // sitting at 1 and the next insert would collide with an existing row.
  console.log('\nresetting the identity sequences...');
  for (const table of TABLES) {
    await dst.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM "${table}"), 1))`
    );
  }
  console.log('  done');

  console.log(`\n✅ copied ${totalRows} rows into Supabase`);

  // Prove it landed.
  const counts = await dst.query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM workspaces) AS workspaces,
       (SELECT COUNT(*) FROM teams) AS teams,
       (SELECT COUNT(*) FROM projects) AS projects,
       (SELECT COUNT(*) FROM tasks) AS tasks,
       (SELECT COUNT(*) FROM task_comments) AS comments,
       (SELECT COUNT(*) FROM activity_logs) AS activity`
  );
  console.log('\nSupabase now holds:', JSON.stringify(counts.rows[0]));

  await src.end();
  await dst.end();
  process.exit(0);
})().catch((err) => {
  console.error('\n❌ migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
