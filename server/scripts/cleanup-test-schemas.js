const path = require('path');
const dotenv = require('dotenv');
const SERVER = 'C:/Users/Sameer Khokhar/Desktop/KhawajaLabs Project 2/server';
dotenv.config({ path: path.join(SERVER, '.env') });
const { Client } = require(path.join(SERVER, 'node_modules/pg'));

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // The stray row left behind by an earlier manual adapter test.
  await c.query("DELETE FROM users WHERE email = 'adapter-test@suprema.test'");
  console.log('removed the stray test user');

  const schemas = (await c.query(
    `SELECT schema_name FROM information_schema.schemata
      WHERE (schema_name LIKE 'suprema_test_%' OR schema_name LIKE 'probe_%')
        AND schema_name <> current_schema()`
  )).rows;

  let dropped = 0;
  let locked = 0;
  for (const row of schemas) {
    try {
      await c.query("SET lock_timeout = '3s'");
      await c.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
      dropped += 1;
    } catch (e) {
      locked += 1;
    }
  }
  console.log(`dropped ${dropped} leftover test schemas, ${locked} were locked`);

  const left = (await c.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.schemata
      WHERE schema_name LIKE 'suprema_test_%' OR schema_name LIKE 'probe_%'`
  )).rows[0];
  console.log('leftover test schemas now:', left.n);

  const users = (await c.query('SELECT COUNT(*)::int AS n FROM users')).rows[0];
  console.log('users in public:', users.n);

  await c.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
