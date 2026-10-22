/**
 * Recreate the database schema from scratch (PostgreSQL / Supabase).
 *
 * Guard against destroying existing data.
 *
 * PostgreSQL has no `CREATE DATABASE` isolation, so the unit that gets
 * dropped is a SCHEMA. `public` holds the live application data; this script
 * drops and recreates it, which is the equivalent of the old
 * "drop the database and start again".
 *
 * If the schema already contains real rows we stop and require --force.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const CONNECTION_STRING = process.env.DATABASE_URL;
const TARGET_SCHEMA = 'public';

/**
 * Guard against destroying an existing database.
 *
 * This script DROPs the whole schema, so running it out of habit (for example
 * as part of a normal `npm run dev` startup) silently deletes every
 * registered account. Newly created users then cannot log in and do not
 * appear in the admin panel, which looks exactly like a login bug but is data
 * loss.
 *
 * If the schema already contains real rows we stop and require --force.
 */
const force = process.argv.includes('--force') || process.env.SUPREMA_DB_FORCE === '1';

async function inspectExisting(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*)::int AS total FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = 'users'`,
    [TARGET_SCHEMA]
  );
  if (rows[0].total === 0) return { exists: false, userCount: 0 };

  const [countRows] = await connection.query(
    `SELECT COUNT(*)::int AS total FROM ${TARGET_SCHEMA}.users`
  );
  return { exists: true, userCount: countRows[0].total };
}

async function initializeDatabase() {
  console.log('\n🚀 Starting Suprema Database Initialization (PostgreSQL)\n');
  let connection;

  try {
    if (!CONNECTION_STRING) {
      throw new Error('DATABASE_URL is not set in server/.env');
    }

    connection = new Client({
      connectionString: CONNECTION_STRING,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000
    });
    await connection.connect();
    console.log('🔌 Connected to PostgreSQL');

    // 1b. Refuse to silently destroy an existing, populated schema
    const existing = await inspectExisting(connection);
    if (existing.exists && existing.userCount > 0 && !force) {
      console.error('\n╔══════════════════════════════════════════════════════════════╗');
      console.error('║  STOPPED: this would DESTROY your existing data.              ║');
      console.error('╚══════════════════════════════════════════════════════════════╝');
      console.error(`\n   Schema '${TARGET_SCHEMA}' already contains ${existing.userCount} user(s).`);
      console.error('   Dropping it would permanently delete every registered account.\n');
      console.error('   To just start the app you do NOT need this - use:');
      console.error('       npm run dev\n');
      console.error('   Only run this again if you deliberately want a clean slate:');
      console.error('       npm run db:init -- --force\n');
      await connection.end();
      process.exit(1);
    }

    if (existing.exists && force) {
      console.warn(
        `\n⚠️  --force supplied: destroying '${TARGET_SCHEMA}' (${existing.userCount} user(s) will be lost).`
      );
    }

    // 2. Drop and recreate the schema
    console.log(`📦 Recreating schema '${TARGET_SCHEMA}'...`);
    await connection.query(`DROP SCHEMA IF EXISTS ${TARGET_SCHEMA} CASCADE`);
    await connection.query(`CREATE SCHEMA ${TARGET_SCHEMA}`);
    await connection.query(`SET search_path TO ${TARGET_SCHEMA}`);
    console.log(`✅ Schema '${TARGET_SCHEMA}' is ready.`);

    // 3. Read and execute schema.sql
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('⚙️ Executing Database Schema (schema.sql)...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await connection.query(schemaSql);
      console.log('✅ All tables & indexes created successfully.');
    } else {
      console.warn('⚠️ schema.sql file not found at:', schemaPath);
    }

    // 4. Read and execute seed.sql
    const seedPath = path.join(__dirname, '../database/seed.sql');
    if (fs.existsSync(seedPath)) {
      console.log('🌱 Executing Seed Data (seed.sql)...');
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      await connection.query(seedSql);
      console.log('✅ Seed data inserted successfully (Users, Workspaces, Teams, Projects, Tasks).');
    } else {
      console.warn('⚠️ seed.sql file not found at:', seedPath);
    }

    console.log('\n🎉 Database Initialization Completed Successfully!\n');
  } catch (error) {
    console.error('\n❌ Database Initialization Failed!');
    console.error('Error Message:', error.message || error);
    console.error('Error Code:', error.code || 'N/A');
    console.error('\n💡 Troubleshooting Tips:');
    console.error(' 1. Check DATABASE_URL in server/.env (it should start with postgresql://).');
    console.error(' 2. Make sure the Supabase project is not paused.');
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

initializeDatabase();
