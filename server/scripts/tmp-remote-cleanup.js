const path = require('path');
const dotenv = require('dotenv');
const SERVER = 'C:/Users/Sameer Khokhar/Desktop/KhawajaLabs Project 2/server';
dotenv.config({ path: path.join(SERVER, '.env') });
const { Client } = require(path.join(SERVER, 'node_modules/pg'));

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('SET search_path TO public');

  // my one-off smoke-test project from the browser check
  const del = await c.query("DELETE FROM projects WHERE name = 'Teacher Test Project (auto-removed)' RETURNING id");
  await c.end();
  console.log('deleted test project rows:', del.rowCount);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message.slice(0, 120)); process.exit(1); });
