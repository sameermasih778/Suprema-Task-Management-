/**
 * Compare query latency: Aiven (MySQL, London) vs Supabase (Postgres, N. Virginia).
 *
 * Same machine, same moment, same kind of query - so the difference is the
 * distance between the application and its database.
 *
 * The Supabase side uses the app's OWN pool (config/db.js), so this measures
 * exactly what the running application experiences.
 */
const path = require('path');
const dotenv = require('dotenv');

const SERVER = 'C:/Users/Sameer Khokhar/Desktop/KhawajaLabs Project 2/server';
dotenv.config({ path: path.join(SERVER, '.env') });

const mysql = require(path.join(SERVER, 'node_modules/mysql2/promise'));
const appPool = require(path.join(SERVER, 'config/db'));

const SAMPLES = 12;

async function bench(label, connect, query) {
  const client = await connect();
  const times = [];
  try {
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = process.hrtime.bigint();
      await query(client);
      times.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  } finally {
    if (client !== appPool) await client.end().catch(() => {});
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(
    `${label.padEnd(32)} min ${times[0].toFixed(1).padStart(6)}ms   ` +
    `median ${median.toFixed(1).padStart(6)}ms   max ${times[times.length - 1].toFixed(1).padStart(6)}ms`
  );
  return median;
}

const aiven = () =>
  mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

const TASK_LIST = `SELECT t.id, t.title, t.status, t.due_date,
                         (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count
                  FROM tasks t JOIN projects p ON t.project_id = p.id
                  WHERE p.workspace_id = 1 ORDER BY t.created_at DESC`;

(async () => {
  console.log('Round-trip latency - same machine, same moment\n');

  await appPool.ready;

  const aivenPing = await bench('Aiven MySQL (eu, London)', aiven, (c) => c.query('SELECT 1 AS ok'));
  const supaPing = await bench('Supabase Postgres (us-east-1)', async () => appPool, (c) => c.query('SELECT 1 AS ok'));

  console.log('\nThe task-list query (what the board runs on every load):\n');
  const aivenTask = await bench('Aiven MySQL (eu, London)', aiven, (c) => c.query(TASK_LIST));
  const supaTask = await bench('Supabase Postgres (us-east-1)', async () => appPool, (c) => c.query(TASK_LIST));

  const pct = (a, b) => (((a - b) / a) * 100).toFixed(0);
  console.log(`\nRound trip : ${aivenPing.toFixed(1)}ms -> ${supaPing.toFixed(1)}ms  (${pct(aivenPing, supaPing)}% faster)`);
  console.log(`Task list  : ${aivenTask.toFixed(1)}ms -> ${supaTask.toFixed(1)}ms  (${pct(aivenTask, supaTask)}% faster)`);

  await appPool.end();
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
