/**
 * Shared test utilities.
 *
 * Tokens are minted locally instead of obtained through the login endpoint so
 * each suite can set up the exact role it is testing without depending on
 * another feature working first. They are signed with the same JWT_SECRET the
 * middleware verifies, so they exercise the real authentication path.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../server');
const pool = require('../config/db');

/**
 * Nothing queries the database until boot-time migrations have finished.
 *
 * config/db.js kicks them off without awaiting (the HTTP server does not care
 * when they land), so a fast test could otherwise read a half-migrated schema.
 */
beforeAll(async () => {
  await pool.ready;
});

/**
 * Close this file's pool when its tests finish.
 *
 * Jest gives every test file a fresh module registry, so each one builds its
 * own pool from config/db.js. Without this the worker keeps mysql2's sockets
 * open and Jest hangs forever after reporting results - which is why
 * `npm test` would otherwise need --forceExit.
 */
afterAll(async () => {
  await pool.end();
});

/** Short, globally unique suffix so suites cannot collide with each other. */
const unique = (prefix = 'x') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Build a bearer token for a user record.
 *
 * Only call this with a user that exists in the test database when the test
 * then reads the database - the signature is valid either way, but a well-built
 * test should not authenticate as a person who is not there.
 */
const tokenFor = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

/** The seeded fixtures created by globalSetup. */
const fixtures = async () => {
  const [users] = await pool.query(
    `SELECT id, name, email, role, status FROM users
      WHERE email IN ('superadmin@suprema.test','admin@suprema.test','dev@suprema.test',
                      'member@suprema.test','uploader@suprema.test')
      ORDER BY id`
  );
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));

  const [[workspace]] = await pool.query(
    "SELECT id FROM workspaces WHERE name = 'Test Workspace'"
  );
  const [[project]] = await pool.query("SELECT id FROM projects WHERE name = 'Test Project'");
  const [[task]] = await pool.query("SELECT id FROM tasks WHERE title = 'Test Task'");

  return {
    superAdmin: byEmail['superadmin@suprema.test'],
    admin: byEmail['admin@suprema.test'],
    developer: byEmail['dev@suprema.test'],
    member: byEmail['member@suprema.test'],
    uploader: byEmail['uploader@suprema.test'],
    workspaceId: workspace?.id,
    projectId: project?.id,
    taskId: task?.id
  };
};

/** Insert an active user with a known password; caller is responsible for cleanup. */
const createUser = async ({ name, email, role = 'member', passwordHash }) => {
  const bcrypt = require('bcryptjs');
  const hash = passwordHash || (await bcrypt.hash('TestPass123!', 4));
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, email, hash, role, 'active']
  );
  return { id: result.insertId, name, email, role };
};

/**
 * Delete a test account completely.
 *
 * Test users now own a default workspace (the Google sign-up path creates
 * one), and the schema protects that link with RESTRICT - so clear the
 * owned workspaces before deleting the account rows. Membership rows
 * themselves need no manual handling: they either cascade with the
 * workspace or with the user, depending on which one goes first.
 */
const deleteUserByEmail = async (email) => {
  await pool.query('DELETE FROM workspaces WHERE owner_id = (SELECT id FROM users WHERE email = $1)', [email]);
  await pool.query('DELETE FROM users WHERE email = $1', [email]);
};

module.exports = {
  app,
  request,
  pool,
  tokenFor,
  auth,
  unique,
  fixtures,
  createUser,
  deleteUserByEmail
};
