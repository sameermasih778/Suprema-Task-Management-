/**
 * Test environment contract.
 *
 * Shared by Jest's globalSetup (main process) and setupFiles (each worker),
 * which do NOT share process.env - so both must call applyTestEnv().
 *
 * The order of operations here is load-bearing:
 *
 *   1. Apply the overrides FIRST.
 *   2. Only then does anything call dotenv.config().
 *
 * dotenv does not overwrite keys that already exist, so every value set below
 * survives the .env load. That is why SMTP_USER is set to an empty string
 * rather than deleted - deleting the key would let dotenv put the real
 * credentials straight back, and the suite would send actual emails to actual
 * people.
 *
 * POSTGRESQL HAS NO PER-DATABASE ISOLATION
 * -----------------------------------------
 * MySQL could do `CREATE DATABASE suprema_test` and get a completely separate
 * database. PostgreSQL cannot: a server hosts ONE database, and isolation
 * inside it is done with SCHEMAS. So the tests now live in their own schema
 * (`suprema_test`) inside the same Supabase database, while production data
 * lives in `public`. The search_path is pointed at the test schema, so every
 * unqualified table name in the app resolves to the test tables and the
 * production tables are never in scope.
 */

const fs = require('fs');
const path = require('path');

/**
 * The test schema for THIS run.
 *
 * It carries a unique suffix on purpose. Every run used to drop and recreate
 * the same fixed schema, and that DROP has to take an ACCESS EXCLUSIVE lock
 * on the schema and everything in it. If an earlier run died without closing
 * its connections - which happens constantly during development, because
 * nodemon restarts the API on every file change - the pooler is still
 * holding sessions that have the old schema in their search path, and the
 * DROP blocks on them until the statement times out. A fresh schema each run
 * means there is never anything to drop, so the lock can never be contended.
 */
const TEST_SCHEMA = `suprema_test_${Date.now().toString(36)}`;

/** The stable prefix, for cleaning up schemas left by earlier runs. */
const TEST_SCHEMA_PREFIX = 'suprema_test_';

/**
 * The production connection string, read straight from the .env file rather
 * than from process.env - because process.env.DATABASE_URL has already been
 * overwritten by the time we can ask. Used only for the guard below.
 */
const readConfiguredDatabaseUrl = () => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const match = raw.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
    if (!match) return null;
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return null;
  }
};

/** Does this connection string already point at the test schema? */
const pointsAtTestSchema = (url) => {
  if (!url) return false;
  return decodeURIComponent(url).includes(`search_path=${TEST_SCHEMA}`);
};

/**
 * Move a connection string onto Supabase's TRANSACTION pooler (port 6543).
 *
 * The session pooler (5432) pins one server connection to each client for as
 * long as the client lives. During development the API server restarts
 * constantly, and every restart that does not close its pool leaves the
 * pooler holding a server connection. Once enough of those pile up the pooler
 * stops handing out server connections and new queries queue until they
 * time out. The transaction pooler multiplexes many clients over a small set
 * of server connections, so a dead client cannot starve a live one.
 *
 * The tests rebuild their schema on every run, which is the most
 * connection-hungry thing in the project, so they use the transaction pooler.
 */
const withTransactionPooler = (url) => url.replace(/:(\d+)\//, ':6543/');

const applyTestEnv = () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_CONNECTION_LIMIT = '5';

  // Empty string, not delete - see the note at the top of this file.
  // sendPasswordResetEmail falls back to returning the link when these are
  // blank, which is how tests read the token without dialling Gmail.
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';

  // Pinned so reset-link assertions do not depend on developer machine config.
  process.env.FRONTEND_URL = 'http://localhost:5173';

  // Point every connection at the test schema.
  //
  // The schema name has to be the SAME in globalSetup (which creates it) and
  // in the workers (which use it). Jest runs globalSetup in the main process
  // and then forks the workers, which inherit its environment - so the main
  // process decides the name once and the workers reuse it.
  if (!process.env.DB_SEARCH_PATH) {
    process.env.DB_SEARCH_PATH = TEST_SCHEMA;
  }

  const base = process.env.DATABASE_URL || readConfiguredDatabaseUrl();
  if (!base) {
    throw new Error(
      'Refusing to run tests: no DATABASE_URL found in server/.env.'
    );
  }
  process.env.DATABASE_URL = withTransactionPooler(base);

  return process.env.DB_SEARCH_PATH;
};

/**
 * Refuses to run anywhere but the test schema.
 *
 * This is the guard that makes it structurally impossible for `npm test` to
 * write into production. It runs before any application module is required,
 * so there is no window in which the pool could be built against the wrong
 * schema.
 */
const assertTestEnv = () => {
  const configured = readConfiguredDatabaseUrl();

  // The schema name carries a per-run suffix, so the check is that it is one
  // of ours - not that it matches this process's own TEST_SCHEMA, which the
  // workers deliberately inherit from the main process instead.
  if (!String(process.env.DB_SEARCH_PATH || '').startsWith(TEST_SCHEMA_PREFIX)) {
    throw new Error(
      `Refusing to run tests: DB_SEARCH_PATH is '${process.env.DB_SEARCH_PATH}', expected one of the '${TEST_SCHEMA_PREFIX}*' test schemas.`
    );
  }

  if (pointsAtTestSchema(configured)) {
    throw new Error(
      `Refusing to run tests: your .env DATABASE_URL already points at '${TEST_SCHEMA}', ` +
      'so the test and real tables would be the same tables.'
    );
  }

  if (process.env.SMTP_USER || process.env.SMTP_PASS) {
    throw new Error(
      'Refusing to run tests: SMTP credentials are configured, so tests would send real email.'
    );
  }
};

module.exports = {
  TEST_DB: TEST_SCHEMA,
  TEST_SCHEMA,
  applyTestEnv,
  assertTestEnv,
  readConfiguredDatabaseUrl
};
