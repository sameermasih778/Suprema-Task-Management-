/**
 * Apply server/database/schema.sql to Supabase's public schema.
 *
 * Safe on an empty database: the schema drops and recreates the tables. It is
 * NOT safe on a database that already holds data - use
 * `npm run migrate-data-to-supabase` for the data copy.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SERVER = 'C:/Users/Sameer Khokhar/Desktop/KhawajaLabs Project 2/server';
dotenv.config({ path: path.join(SERVER, '.env') });

const { Client } = require(path.join(SERVER, 'node_modules/pg'));

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });
  await client.connect();

  const existing = await client.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'`
  );
  if (existing.rows[0].n > 0) {
    const people = (await client.query('SELECT COUNT(*)::int AS n FROM users')).rows[0];
    if (people.n > 0) {
      console.error(
        'Refusing to apply the schema: the public schema already holds data.\n' +
        '  Use `npm run migrate-data-to-supabase` to copy data instead.'
      );
      await client.end();
      process.exit(1);
    }
  }

  const sql = fs.readFileSync(path.join(SERVER, 'database/schema.sql'), 'utf8');
  console.log('applying schema.sql to Supabase...');
  await client.query(sql);

  const tables = (await client.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
  )).rows[0];
  const due = (await client.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'due_date'`
  )).rows[0];
  console.log(`tables in public: ${tables.n}`);
  console.log(`tasks.due_date type: ${due?.data_type}`);

  await client.end();
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
