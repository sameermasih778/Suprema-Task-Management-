/**
 * Rebuilds the test schema from scratch before every run.
 *
 * Runs once in Jest's main process. The contract is:
 *
 *   - DROP only ever targets the literal string 'suprema_test'
 *   - production (.env's DATABASE_URL) is checked against it and refused if
 *     it already points there
 *   - SMTP is confirmed dead, so no test can send a real email
 *
 * Nothing here reads a schema name from the environment to decide what to
 * drop; a variable that could be repointed at production is exactly how test
 * suites eat real data.
 *
 * PostgreSQL has no `CREATE DATABASE` isolation, so the tests live in their
 * own schema inside the same Supabase database. Production data is in
 * `public`, which is never in the search_path while the tests run.
 *
 * This file deliberately manages its own pool rather than requiring
 * config/db.js. That module fires migrations asynchronously on require, which
 * would race the migration run below and could interleave two ALTER TABLEs on
 * the same column. Workers still load config/db.js afterwards, but by then
 * every migration is already applied and their re-run is a no-op.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

const {
  TEST_SCHEMA,
  TEST_SCHEMA_PREFIX,
  applyTestEnv,
  assertTestEnv,
  readConfiguredDatabaseUrl
} = require('./testEnv');

// Must happen before this file reads .env.
applyTestEnv();
assertTestEnv();

dotenv.config({ path: path.join(__dirname, '../.env') });

// Hardcoded on purpose - never process.env.
const TARGET_SCHEMA = TEST_SCHEMA;

const fixtures = {
  users: {},
  workspaceId: null,
  projectId: null,
  taskId: null,
  attachmentId: null
};

async function createConnection() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });
}

async function dropAndCreate(conn) {
  // Connect explicitly rather than letting the first query do it. Against a
  // pooled connection this is more predictable, and it means a connection
  // problem fails here with a clear message instead of surfacing later.
  await conn.connect();

  // The schema for this run is brand new, so there is nothing to drop and no
  // lock to contend with. The old schema is cleaned up separately, best
  // effort, after everything is in place.
  await conn.query(`CREATE SCHEMA IF NOT EXISTS ${TARGET_SCHEMA}`);
  // From here on, unqualified table names resolve inside the test schema.
  await conn.query(`SET search_path TO ${TARGET_SCHEMA}`);

  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  await conn.query(schema);

  const where = (await conn.query('SELECT current_schema() AS db')).rows[0];
  if (where.db !== TARGET_SCHEMA) {
    throw new Error(`Test schema resolved to '${where.db}', expected '${TARGET_SCHEMA}'.`);
  }
}

/**
 * Remove the schemas left behind by earlier runs.
 *
 * Runs on its OWN connection, on purpose: it drops schemas that other
 * sessions may still hold open, and a blocked drop must never take the
 * connection that is about to build this run's schema with it.
 *
 * Each drop is time-boxed with a session lock_timeout, and only a bounded
 * number of schemas are attempted, so a stuck one can never stall the suite.
 */
async function cleanOldSchemas() {
  let conn;
  try {
    conn = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await conn.connect();
    // A session-level lock_timeout, not SET LOCAL: SET LOCAL only applies
    // inside a transaction, and there is no transaction here - so it would be
    // a no-op and the DROP would block forever on a locked schema.
    await conn.query("SET lock_timeout = '1s'");

    const rows = (await conn.query(
      `SELECT schema_name FROM information_schema.schemata
        WHERE schema_name LIKE $1 AND schema_name <> $2
        ORDER BY schema_name`,
      [`${TEST_SCHEMA_PREFIX}%`, TARGET_SCHEMA]
    )).rows;

    // Bounded, and kept short: this runs before the workers start, and a slow
    // sweep here would eat into their connection timeout.
    for (const row of rows.slice(0, 5)) {
      try {
        await conn.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
      } catch (_) {
        // Locked by a leftover session - it will be cleaned up another time.
      }
    }
  } catch (err) {
    console.warn('   (old test schemas not cleaned up:', err.message + ')');
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/**
 * Minimal world the suites rely on: five users across every role that matters,
 * one workspace with real membership rows, a project, a task, and an
 * attachment. Authorization tests need those membership rows to be genuine -
 * mocking them would test the mock rather than the query.
 */
async function seed(conn) {
  // Cost 4 rather than 10: this rebuilds before every run, and the strength of
  // a throwaway hash is not what any of these tests assert.
  const hash = await bcrypt.hash('TestPass123!', 4);

  const users = [
    { key: 'superAdmin', name: 'Super Admin', email: 'superadmin@suprema.test', role: 'super_admin' },
    { key: 'admin', name: 'Admin User', email: 'admin@suprema.test', role: 'admin' },
    { key: 'developer', name: 'Dev User', email: 'dev@suprema.test', role: 'developer' },
    { key: 'member', name: 'Regular Member', email: 'member@suprema.test', role: 'member' },
    { key: 'uploader', name: 'File Uploader', email: 'uploader@suprema.test', role: 'member' }
  ];

  for (const u of users) {
    const result = await conn.query(
      'INSERT INTO users (name, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [u.name, u.email, hash, u.role, 'active']
    );
    fixtures.users[u.key] = { id: result.rows[0].id, ...u };
  }

  const owner = fixtures.users.superAdmin;

  const ws = await conn.query(
    'INSERT INTO workspaces (name, slug, owner_id, plan) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Test Workspace', `test-ws-${Date.now().toString(36)}`, owner.id, 'free']
  );
  fixtures.workspaceId = ws.rows[0].id;

  const memberships = [
    [fixtures.workspaceId, owner.id, 'owner'],
    [fixtures.workspaceId, fixtures.users.admin.id, 'admin'],
    [fixtures.workspaceId, fixtures.users.member.id, 'member'],
    [fixtures.workspaceId, fixtures.users.uploader.id, 'member']
  ];
  for (const m of memberships) {
    await conn.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
      m
    );
  }

  const project = await conn.query(
    'INSERT INTO projects (workspace_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [fixtures.workspaceId, 'Test Project', owner.id]
  );
  fixtures.projectId = project.rows[0].id;

  const task = await conn.query(
    'INSERT INTO tasks (project_id, title, created_by) VALUES ($1, $2, $3) RETURNING id',
    [fixtures.projectId, 'Test Task', owner.id]
  );
  fixtures.taskId = task.rows[0].id;

  const attachment = await conn.query(
    `INSERT INTO task_attachments
       (task_id, user_id, filename, original_name, file_path, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      fixtures.taskId,
      fixtures.users.uploader.id,
      'probe.png',
      'probe.png',
      'https://example.invalid/probe.png',
      1024,
      'image/png'
    ]
  );
  fixtures.attachmentId = attachment.rows[0].id;}

module.exports = async () => {
  const configured = readConfiguredDatabaseUrl();

  console.log(
    `\n🧪 Rebuilding test schema '${TARGET_SCHEMA}' (production is '${configured ? 'configured' : 'unset'}')`
  );

  const conn = await createConnection();

  // Drop the schemas left by earlier runs FIRST. At this point those runs have
  // finished and closed their connections, so they are no longer locked - the
  // cleanup cannot run afterwards, because the workers of the current run are
  // holding the current schema open.
  if (process.env.SKIP_SCHEMA_CLEANUP !== '1') {
    await cleanOldSchemas();
  }

  await dropAndCreate(conn);
  console.log('   schema loaded');

  const { runMigrations } = require('../database/migrate');
  await runMigrations(conn);

  await seed(conn);
  console.log(
    `   seeded ${Object.keys(fixtures.users).length} users, 1 workspace/project/task/attachment\n`
  );

  await conn.end();
};
