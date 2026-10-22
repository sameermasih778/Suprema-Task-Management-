/**
 * Manual migration runner:  npm run db:migrate
 *
 * The same migrations also run automatically when the server boots, so this is
 * only needed if you want to apply them without starting the API (or to
 * confirm the current schema state from a terminal).
 *
 * This builds its own connection on purpose: importing config/db.js would
 * trigger its own startup migration run, so two runners would race and the
 * output would be duplicated/interleaved.
 */
const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const { runMigrations } = require('../database/migrate');

dotenv.config({ path: path.join(__dirname, '../.env') });

(async () => {
  console.log('\n🔧 Running Suprema schema migrations...\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set in server/.env');
    process.exit(1);
  }

  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });
  await connection.connect();

  const [[info]] = await connection.query(
    'SELECT current_database() AS db, current_schema() AS schema'
  );
  console.log(`📌 Connected to database '${info.db}', schema '${info.schema}'\n`);

  await runMigrations(connection);

  console.log('\n✅ Migration run complete.\n');
  await connection.end();
  process.exit(0);
})().catch((error) => {
  console.error('❌ Migration runner crashed:', error.message);
  process.exit(1);
});
