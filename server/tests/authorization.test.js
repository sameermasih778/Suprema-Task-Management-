/**
 * Authorization.
 *
 * These are the checks that were missing before Day 13: endpoints that
 * authenticated a caller but never asked what they were allowed to do. Each
 * assertion here is a regression test for a gap that was actually found and
 * fixed rather than a hypothetical.
 *
 * The rule being enforced:
 *   - the audit feed is staff-only
 *   - an attachment may be deleted by its uploader, a workspace owner/admin,
 *     or any staff account - and by nobody else
 */

const { app, request, auth, fixtures, pool } = require('./helpers');

let F;

beforeAll(async () => {
  F = await fixtures();
});

/** A fresh attachment so a successful delete never consumes a shared fixture. */
const createAttachment = async (uploaderId) => {
  const [result] = await pool.query(
    `INSERT INTO task_attachments
       (task_id, user_id, filename, original_name, file_path, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [F.taskId, uploaderId, 'probe.png', 'probe.png', 'https://example.invalid/probe.png', 1024, 'image/png']
  );
  return result.insertId;
};

describe('GET /activity - the audit trail is staff only', () => {
  test('rejects an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/activity');
    expect(res.status).toBe(401);
  });

  test('rejects a member even with a valid workspace', async () => {
    const res = await request(app)
      .get('/api/v1/activity')
      .query({ workspace_id: F.workspaceId })
      .set(auth(F.member));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/super_admin/);
  });

  test('rejects an expired or forged token', async () => {
    const res = await request(app)
      .get('/api/v1/activity')
      .query({ workspace_id: F.workspaceId })
      .set('Authorization', 'Bearer not.a.real.token');
    // 401: the token itself is invalid, so the caller is unauthenticated.
    // (403 is reserved for an authenticated caller missing a required role.)
    expect(res.status).toBe(401);
  });

  test('passes the role gate for every staff role', async () => {
    for (const user of [F.superAdmin, F.admin, F.developer]) {
      const res = await request(app)
        .get('/api/v1/activity')
        .query({ workspace_id: F.workspaceId })
        .set(auth(user));

      // 400 for a missing param, 200 with one - both prove the role gate
      // admitted the caller, which is the part this file exists to check.
      expect([200, 400]).toContain(res.status);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    }
  });

  test('returns the feed for staff once authorized', async () => {
    const res = await request(app)
      .get('/api/v1/activity')
      .query({ workspace_id: F.workspaceId })
      .set(auth(F.admin));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activities');
    expect(Array.isArray(res.body.activities)).toBe(true);
  });
});

describe('DELETE /attachments/:id - only the right people delete files', () => {
  test('rejects an unauthenticated caller', async () => {
    const id = await createAttachment(F.uploader.id);
    const res = await request(app).delete(`/api/v1/attachments/${id}`);
    expect(res.status).toBe(401);

    // Still there.
    const [rows] = await pool.query('SELECT id FROM task_attachments WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
    await pool.query('DELETE FROM task_attachments WHERE id = $1', [id]);
  });

  test('returns 404 for an attachment that does not exist', async () => {
    const res = await request(app)
      .delete('/api/v1/attachments/99999999')
      .set(auth(F.superAdmin));
    expect(res.status).toBe(404);
  });

  test('refuses a workspace member who did not upload it', async () => {
    const id = await createAttachment(F.uploader.id);

    const res = await request(app)
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(F.member));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only delete attachments that you uploaded/i);

    const [rows] = await pool.query('SELECT id FROM task_attachments WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);

    await pool.query('DELETE FROM task_attachments WHERE id = $1', [id]);
  });

  test('allows the uploader', async () => {
    const id = await createAttachment(F.uploader.id);

    const res = await request(app)
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(F.uploader));

    expect(res.status).toBe(200);

    const [rows] = await pool.query('SELECT id FROM task_attachments WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  test('allows a workspace admin who did not upload it', async () => {
    const id = await createAttachment(F.uploader.id);

    const res = await request(app)
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(F.admin));

    expect(res.status).toBe(200);

    const [rows] = await pool.query('SELECT id FROM task_attachments WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  test('allows the workspace owner who did not upload it', async () => {
    const id = await createAttachment(F.uploader.id);

    const res = await request(app)
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(F.superAdmin));

    expect(res.status).toBe(200);

    const [rows] = await pool.query('SELECT id FROM task_attachments WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });
});

describe('role gating across staff endpoints', () => {
  test('a member cannot reach the lead inbox', async () => {
    expect((await request(app).get('/api/v1/admin/leads/contact').set(auth(F.member))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/leads/waitlist').set(auth(F.member))).status).toBe(403);
  });

  test('a member cannot reach the changelog manager', async () => {
    const res = await request(app).get('/api/v1/admin/changelogs').set(auth(F.member));
    expect(res.status).toBe(403);
  });

  test('an unauthenticated caller cannot reach either', async () => {
    expect((await request(app).get('/api/v1/admin/leads/contact')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/changelogs')).status).toBe(401);
  });

  test('staff can reach both', async () => {
    expect(
      (await request(app).get('/api/v1/admin/leads/contact').set(auth(F.admin))).status
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/admin/changelogs').set(auth(F.developer))).status
    ).toBe(200);
  });
});
