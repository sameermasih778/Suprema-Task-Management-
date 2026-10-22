/**
 * Harness smoke test.
 *
 * Confirms the suite is running against the isolated test database with SMTP
 * disabled before any behavioural test relies on those guarantees. If this
 * file fails, nothing else in the suite should be trusted.
 */
const { app, request, pool, fixtures } = require('./helpers');

describe('test harness', () => {
  test('runs against the test database, never production', async () => {
    // PostgreSQL has no separate databases, so isolation is by SCHEMA. The
    // schema must be one of ours, and it must not be the public schema the
    // live application data lives in.
    expect(process.env.DB_SEARCH_PATH).toMatch(/^suprema_test_/);
    expect(process.env.DB_SEARCH_PATH).not.toBe('public');
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('cannot send email', async () => {
    expect(process.env.SMTP_USER).toBeFalsy();
    expect(process.env.SMTP_PASS).toBeFalsy();
  });

  test('connects to a database with the full schema', async () => {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = current_schema()"
    );
    expect(row.c).toBeGreaterThanOrEqual(17);
  });

  test('test database has no production rows', async () => {
    const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM users');
    // Seeded fixtures only - production has real accounts.
    expect(row.c).toBe(5);
  });

  test('fixtures exist for every role under test', async () => {
    const f = await fixtures();
    expect(f.superAdmin.role).toBe('super_admin');
    expect(f.admin.role).toBe('admin');
    expect(f.developer.role).toBe('developer');
    expect(f.member.role).toBe('member');
    expect(f.uploader.role).toBe('member');
    expect(f.workspaceId).toBeTruthy();
    expect(f.taskId).toBeTruthy();
  });

  test('server health endpoint answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });
});
