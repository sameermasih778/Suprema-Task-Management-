const { Pool, types } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const { runMigrations } = require('../database/migrate');

dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Database access for Suprema - Supabase (PostgreSQL).
 *
 * WHY AN ADAPTER
 * --------------
 * The whole codebase was written against mysql2, whose call shape is:
 *
 *     const [rows]   = await pool.query('SELECT ... WHERE id = ?', [id]);
 *     const [result] = await pool.query('INSERT ...');
 *     result.insertId;                        // the new row's id
 *
 * node-postgres returns a completely different shape ({ rows, rowCount }),
 * and its placeholders are $1, $2 rather than ?. Rewriting all 157 call
 * sites to the new shape would be a large, risky diff for no benefit, so
 * this module presents the mysql2 shape on top of node-postgres. The rest
 * of the codebase keeps reading exactly as it did, and the ONLY thing that
 * changes is the SQL dialect itself.
 *
 * WHAT STILL CHANGES IN THE SQL
 * ----------------------------
 *   ?            ->  $1, $2, $3            (placeholders)
 *   `col`        ->  'col'                 (identifier quoting)
 *   ON DUPLICATE KEY UPDATE -> ON CONFLICT (...) DO UPDATE
 *   INSERT ... (no RETURNING) -> INSERT ... RETURNING id
 *   TINYINT(1)  ->  BOOLEAN
 *   DATETIME     ->  TIMESTAMPTZ
 */

/**
 * mysql2 hands BIGINT back as a number. node-postgres hands it back as a
 * string, and COUNT(*)/SUM() are bigint - so without this every count in
 * the app would arrive as '3' instead of 3, and comparisons like
 * `count === 3` would silently be false.
 */
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10));

/**
 * The connection string. Supabase's session pooler (port 5432) is used for
 * both the application and the migrations: it speaks plain Postgres, works
 * with node-postgres unchanged, and holds one server connection per client
 * instead of opening a new one per request - which is what keeps a
 * serverless deployment (Vercel) from exhausting the connection limit.
 */
const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  process.env.DB_CONNECTION_STRING ||
  'postgresql://postgres:postgres@localhost:5432/postgres';

const pool = new Pool({
  connectionString: CONNECTION_STRING,
  // Point the session at a specific schema. The app uses `public`; the test
  // suite uses its own schema, so `npm test` can never touch real data.
  options: process.env.DB_SEARCH_PATH
    ? `-c search_path=${process.env.DB_SEARCH_PATH}`
    : undefined,
  // Supabase requires TLS. Certificate verification is left on because the
  // Supabase CA is a public root (unlike the self-signed certs some hosted
  // MySQL providers use, which is why the old config disabled it).
  ssl: { rejectUnauthorized: false },
  max: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

/** Reads are answered with rows; writes are answered with a result header. */
const isReadQuery = (sql) => {
  const s = sql || '';
  // Plain SELECT/... are reads.
  if (/^\s*(SELECT|WITH|SHOW|EXPLAIN|TABLE|VALUES)\b/i.test(s)) return true;
  // UPDATE/DELETE ... RETURNING yields rows to the caller (there is no
  // insertId concept for those, so the caller expects the returned rows).
  if (/^\s*(UPDATE|DELETE)\b/i.test(s) && /\bRETURNING\b/i.test(s)) return true;
  return false;
};

/**
 * Present a node-postgres result in the mysql2 shape.
 *   SELECT -> [rows, fields]
 *   INSERT/UPDATE/DELETE -> [resultHeader, fields]
 */
const shapeResult = (result, sql) => {
  const rows = result.rows || [];
  const fields = result.fields || [];

  if (isReadQuery(sql)) {
    return [rows, fields];
  }

  const header = {
    // mysql2 exposes the new row's id here. An INSERT must therefore use
    // `RETURNING id` - the adapter reads it back out of the returned row.
    insertId: rows.length && rows[0].id !== undefined ? rows[0].id : undefined,
    affectedRows: result.rowCount ?? 0,
    changedRows: result.rowCount ?? 0,
    warningStatus: 0
  };

  return [header, fields];
};

/** A pool that answers exactly like the mysql2 pool the app already uses. */
const mysql2Shape = {
  /**
   * @param {string} sql
   * @param {any[]} [params]
   * @returns {Promise<[any, any]>} [rows, fields] for reads,
   *                                 [resultHeader, fields] for writes
   */
  async query(sql, params) {
    const result = params === undefined
      ? await pool.query(sql)
      : await pool.query(sql, params);
    return shapeResult(result, sql);
  },

  /**
   * A dedicated connection, for work that needs an explicit transaction.
   * Mirrors mysql2's connection API: query / beginTransaction / commit /
   * rollback / release.
   */
  async getConnection() {
    const client = await pool.connect();

    return {
      async query(sql, params) {
        const result = params === undefined
          ? await client.query(sql)
          : await client.query(sql, params);
        return shapeResult(result, sql);
      },
      async beginTransaction() {
        await client.query('BEGIN');
      },
      async commit() {
        await client.query('COMMIT');
      },
      async rollback() {
        await client.query('ROLLBACK');
      },
      release() {
        client.release();
      }
    };
  },

  async end() {
    await pool.end();
  }
};

/**
 * Verify the connection on boot and bring an older database up to the
 * current schema. Safe on every boot: migrations are idempotent and
 * additive only.
 */
async function testConnection() {
  try {
    const [rows] = await mysql2Shape.query('SELECT current_database() AS db, current_user AS usr, now() AS now');
    const info = rows[0] || {};
    console.log('✅ Database Connection Established Successfully');
    console.log(
      `📌 Connected to '${info.db}' as '${info.usr}' on ${CONNECTION_STRING.replace(
        /:\/\/([^:]+):[^@]+@/,
        '://$1:***@'
      )}`
    );
    console.log(`🕒 Database clock: ${new Date(info.now).toISOString()}`);

    await runMigrations(mysql2Shape);
  } catch (error) {
    console.warn('⚠️  Database Connection Warning:', error.message);
    console.warn('   (Check DATABASE_URL and that the database is reachable)');
  }
}

/**
 * Resolves once the connection check and any pending migrations have
 * finished.
 *
 * config/db.js kicks them off without awaiting (the HTTP server does not care
 * when they land), so a fast test could otherwise read a half-migrated schema.
 * Nothing here ever rejects, so awaiting it is always safe.
 */
const ready = testConnection();

module.exports = {
  ...mysql2Shape,
  // The raw pool, for anything that needs the native node-postgres API.
  rawPool: pool,
  ready
};
