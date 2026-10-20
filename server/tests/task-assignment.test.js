/**
 * Task assignment notifications and per-task change history.
 *
 * Two things are covered here:
 *
 *  1. Assigning a task must tell the assignee. The notifications table and the
 *     header bell already existed, but nothing ever wrote a `task_assigned`
 *     row - so an assignment was completely invisible to the person who was
 *     given the work.
 *
 *  2. Every task write is recorded, and that record must be readable for the
 *     task it belongs to ("who changed this task and when").
 */

const { app, request, auth, fixtures, pool, unique } = require('./helpers');

let F;
let memberToken;

// Everything this file creates, so the tables are provably restored.
const createdTaskIds = [];
const createdNotificationIds = [];

const title = () => `Assign check ${unique('t')}`;

beforeAll(async () => {
  F = await fixtures();
  memberToken = auth(F.member);
});

afterEach(async () => {
  if (createdTaskIds.length) {
    await pool.query(
      `DELETE FROM activity_logs WHERE entity_type = 'task' AND entity_id IN (?)`,
      [createdTaskIds]
    );
    await pool.query('DELETE FROM tasks WHERE id IN (?)', [createdTaskIds]);
    createdTaskIds.length = 0;
  }
  if (createdNotificationIds.length) {
    await pool.query('DELETE FROM notifications WHERE id IN (?)', [createdNotificationIds]);
    createdNotificationIds.length = 0;
  }
});

/** Create a task and remember it for cleanup. */
const createTask = async (body) => {
  const res = await request(app)
    .post('/api/v1/tasks')
    .set(memberToken)
    .send({ project_id: F.projectId, title: title(), ...body });
  expect(res.status).toBe(201);
  createdTaskIds.push(res.body.task.id);
  return res.body.task;
};

describe('POST /api/v1/tasks - assignment notification', () => {
  test('notifies the assignee when a task is created for them', async () => {
    const task = await createTask({ assignee_id: F.developer.id });

    const [rows] = await pool.query(
      `SELECT n.user_id, n.title, n.message, n.type, n.link
       FROM notifications n
       WHERE n.user_id = ? AND n.type = 'task_assigned' AND n.link = ?`,
      [F.developer.id, `/dashboard/tasks?task=${task.id}`]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain(task.title);
    expect(rows[0].message).toMatch(/assigned you the task/i);
    expect(rows[0].message).toMatch(new RegExp(F.member.name));
  });

  test('does not notify someone who assigned a task to themselves', async () => {
    await createTask({ assignee_id: F.member.id });

    const [rows] = await pool.query(
      `SELECT id FROM notifications
       WHERE user_id = ? AND type = 'task_assigned'
         AND created_at > (NOW() - INTERVAL 1 MINUTE)`,
      [F.member.id]
    );

    expect(rows).toHaveLength(0);
  });

  test('notifies the new assignee when a task is reassigned', async () => {
    const task = await createTask({ assignee_id: F.developer.id });

    const res = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(memberToken)
      .send({ assignee_id: F.admin.id });

    expect(res.status).toBe(200);

    const [rows] = await pool.query(
      `SELECT n.user_id, n.link FROM notifications n
       WHERE n.type = 'task_assigned' AND n.link = ?`,
      [`/dashboard/tasks?task=${task.id}`]
    );

    const recipients = rows.map((r) => r.user_id);
    expect(recipients).toContain(F.admin.id);
  });

  test('does not re-notify when the task is saved without changing the assignee', async () => {
    const task = await createTask({ assignee_id: F.developer.id });

    await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(memberToken)
      .send({ priority: 'high' });

    const [rows] = await pool.query(
      `SELECT id FROM notifications
       WHERE user_id = ? AND type = 'task_assigned' AND link = ?`,
      [F.developer.id, `/dashboard/tasks?task=${task.id}`]
    );

    expect(rows).toHaveLength(1); // only the original assignment
  });
});

describe('GET /api/v1/tasks/:id/activity - change history', () => {
  test('returns who changed the task and when', async () => {
    const task = await createTask({ priority: 'medium' });

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}/activity`)
      .set(memberToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.activities.length).toBeGreaterThan(0);

    const created = res.body.activities.find((a) => a.action === 'TASK_CREATED');
    expect(created).toBeDefined();
    expect(created.user_name).toBe(F.member.name);
    expect(created.created_at).toBeTruthy();
    // Elapsed time is computed by the database, so it is always in seconds
    // since the write - never negative, never NaN.
    expect(typeof created.seconds_ago).toBe('number');
    expect(created.seconds_ago).toBeGreaterThanOrEqual(0);
  });

  test('records which fields changed, not just that something changed', async () => {
    const task = await createTask({ priority: 'medium' });

    await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(memberToken)
      .send({ priority: 'urgent', status: 'in_progress' });

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}/activity`)
      .set(memberToken);

    const update = res.body.activities.find((a) => a.action === 'TASK_UPDATED');
    expect(update).toBeDefined();

    const details =
      typeof update.details === 'string' ? JSON.parse(update.details) : update.details;

    expect(details.changes.priority).toEqual({ from: 'medium', to: 'urgent' });
    expect(details.changes.status).toEqual({ from: 'todo', to: 'in_progress' });
  });

  test('resolves the assignee to a name rather than an id', async () => {
    const task = await createTask({ assignee_id: F.developer.id });

    await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(memberToken)
      .send({ assignee_id: F.admin.id });

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}/activity`)
      .set(memberToken);

    const update = res.body.activities.find((a) => a.action === 'TASK_UPDATED');
    const details =
      typeof update.details === 'string' ? JSON.parse(update.details) : update.details;

    expect(details.changes.assignee.from).toBe(F.developer.name);
    expect(details.changes.assignee.to).toBe(F.admin.name);
  });

  test('404s for a task that does not exist', async () => {
    const res = await request(app).get('/api/v1/tasks/99999999/activity').set(memberToken);
    expect(res.status).toBe(404);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/v1/tasks/1/activity');
    expect(res.status).toBe(401);
  });

  test('does not leak another workspace\'s history', async () => {
    // The seeded task belongs to the test workspace; a user who is not a
    // member of it must not be able to read its history.
    const outsider = { id: 999999, email: 'nobody@suprema.test', role: 'member', name: 'Nobody' };
    const res = await request(app)
      .get(`/api/v1/tasks/${F.taskId}/activity`)
      .set(auth(outsider));

    expect(res.status).toBe(403);
  });
});
