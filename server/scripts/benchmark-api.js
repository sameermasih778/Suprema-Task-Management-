/**
 * Measure the API's response time FROM THE DEPLOYED SERVER.
 *
 * The database round trip only matters where the application runs: the API is
 * deployed to Vercel (iad1 = Washington DC, Virginia). A laptop in Pakistan
 * talking to either database is a different journey entirely, so the only
 * meaningful measurement is the one taken from inside Vercel.
 *
 * The /health endpoint performs a live `SELECT 1`, so its response time IS
 * the API + database round trip.
 */
const https = require('https');

const URL = process.argv[2] || 'https://superma-task-management-37zl.vercel.app/api/v1/health';
const SAMPLES = 10;

const get = () =>
  new Promise((resolve, reject) => {
    const t = process.hrtime.bigint();
    const req = https.get(URL, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () =>
        resolve({ ms: Number(process.hrtime.bigint() - t) / 1e6, status: res.statusCode, body })
      );
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });

(async () => {
  console.log('API response time (measured from the deployed server)\n');
  console.log(URL + '\n');

  const times = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const r = await get();
    times.push(r.ms);
    if (i === 0) console.log('  sample response:', r.body.slice(0, 160), '\n');
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`  min ${times[0].toFixed(1)}ms   median ${median.toFixed(1)}ms   max ${times[times.length - 1].toFixed(1)}ms`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
