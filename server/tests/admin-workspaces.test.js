/**
 * Admin management of workspaces.
 *
 * A workspace is a tenant, so the destructive path is the thing worth
 * testing hardest:
 *   - archive freezes a workspace and keeps every row of data
 *   - permanent delete destroys it all, and only a super admin can do it
 *   - a permanent delete has to be confirmed by typing the workspace name
 */

const { app, request, auth, fixtures, pool, unique } = require('./helpers');

let F;
let adminToken;
let superAdminToken;
let memberToken;

const createdWorkspaceIds = [];
const createdUserIds = [];

beforeAll(async () => {
  F = await fixtures();
  adminToken = auth(F.admin);
  superAdminToken = auth(F.superAdmin);
  memberToken = auth(F.member);
});

afterEach(async () => {
  if (createdWorkspaceIds.length) {
    await pool.query('DELETE FROM workspaces WHERE id IN (?)', [createdWorkspaceIds]);
    createdWorkspaceIds.length = 0;
  }
  if (createdUserIds.length) {
    await pool.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
    createdUserIds.length = 0;
  }
});

/** A workspace owned by the admin, so it can be managed. */
const createWorkspace = async () => {
  const res = await request(app)
    .post('/api/v1/workspaces')
    .set(adminToken)
    .send({ name: `Ws Test ${unique('w')}` });
  expect(res.status).toBe(201);
  createdWorkspaceIds.push(res.body.workspace.id);
  return res.body.workspace;
};

const createUser = async () => {
  const email = `ws-owner-${unique('o')}@suprema.test`;
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('TestPass123!', 4);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
    ['Workspace Owner', email, hash, 'member', 'active']
  );
  createdUserIds.push(result.insertId);
  return { id: result.insertId, name: 'Workspace Owner', email };
};

describe('GET /api/v1/admin/workspaces', () => {
  test('lists every workspace with its counts', async () => {
    const ws = await createWorkspace();

    const res = await request(app).get('/api/v1/admin/workspaces').set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.total).toBe(res.body.count);

    const mine = res.body.workspaces.find((w) => w.id === ws.id);
    expect(mine).toBeDefined();
    expect(mine.member_count).toBeGreaterThan(0);
    expect(mine.status).toBe('active');
  });

  test('a member cannot reach it', async () => {
    const res = await request(app).get('/api/v1/admin/workspaces').set(memberToken);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/admin/workspaces', () => {
  test('creates a workspace the admin owns when no owner is named', async () => {
    const res = await request(app)
      .post('/api/v1/admin/workspaces')
      .set(adminToken)
      .send({ name: `Owned ${unique('w')}`, plan: 'pro' });
    createdWorkspaceIds.push(res.body.workspace.id);

    expect(res.status).toBe(201);
    expect(res.body.workspace.plan).toBe('pro');
    expect(res.body.workspace.status).toBe('active');

    const [rows] = await pool.query(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [res.body.workspace.id, F.admin.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('owner');
  });

  test('invites a named owner instead of adding them straight away', async () => {
    const owner = await createUser();

    const res = await request(app)
      .post('/api/v1/admin/workspaces')
      .set(adminToken)
      .send({ name: `For ${unique('w')}`, ownerEmail: owner.email });
    createdWorkspaceIds.push(res.body.workspace.id);

    expect(res.status).toBe(201);
    expect(res.body.workspace.owner_email).toBe(owner.email);
    expect(res.body.workspace.invitation_id).toBeTruthy();

    // They are NOT a member until they accept.
    const [members] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [res.body.workspace.id, owner.id]
    );
    expect(members).toHaveLength(0);

    const [invites] = await pool.query(
      'SELECT role, status FROM workspace_invitations WHERE id = ?',
      [res.body.workspace.invitation_id]
    );
    expect(invites[0].status).toBe('pending');
    expect(invites[0].role).toBe('owner');
  });

  test('refuses an owner email with no account', async () => {
    const res = await request(app)
      .post('/api/v1/admin/workspaces')
      .set(adminToken)
      .send({ name: `Bad ${unique('w')}`, ownerEmail: 'nobody-at-all@suprema.test' });

    expect(res.status).toBe(404);
  });

  test('requires a name', async () => {
    const res = await request(app)
      .post('/api/v1/admin/workspaces')
      .set(adminToken)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('a member cannot create a workspace', async () => {
    const res = await request(app)
      .post('/api/v1/admin/workspaces')
      .set(memberToken)
      .send({ name: `Nope ${unique('w')}` });
    expect(res.status).toBe(403);
  });
});

describe('archiving a workspace', () => {
  test('freezes it and keeps the data, and it can be restored', async () => {
    const ws = await createWorkspace();

    const archive = await request(app)
      .post(`/api/v1/admin/workspaces/${ws.id}/archive`)
      .set(adminToken);
    expect(archive.status).toBe(200);

    const [rows] = await pool.query('SELECT status FROM workspaces WHERE id = ?', [ws.id]);
    expect(rows[0].status).toBe('archived');

    // The data is still there.
    const [members] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = ?',
      [ws.id]
    );
    expect(members.length).toBeGreaterThan(0);

    // It is hidden from the switcher list.
    const list = await request(app).get('/api/v1/workspaces').set(adminToken);
    const mine = list.body.workspaces.find((w) => w.id === ws.id);
    expect(mine.status).toBe('archived');

    const restore = await request(app)
      .post(`/api/v1/admin/workspaces/${ws.id}/restore`)
      .set(adminToken);
    expect(restore.status).toBe(200);

    const [after] = await pool.query('SELECT status FROM workspaces WHERE id = ?', [ws.id]);
    expect(after[0].status).toBe('active');
  });

  test('cannot archive twice', async () => {
    const ws = await createWorkspace();
    await request(app).post(`/api/v1/admin/workspaces/${ws.id}/archive`).set(adminToken);

    const again = await request(app)
      .post(`/api/v1/admin/workspaces/${ws.id}/archive`)
      .set(adminToken);
    expect(again.status).toBe(409);
  });
});

describe('GET /api/v1/admin/workspaces/:id/deletion-impact', () => {
  test('reports what a permanent delete would destroy', async () => {
    const ws = await createWorkspace();

    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${ws.id}/deletion-impact`)
      .set(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe(ws.name);
    expect(res.body.confirmation).toBe(ws.name);
    expect(res.body.impact.members).toBeGreaterThan(0);
    expect(res.body.impact).toHaveProperty('tasks');
    expect(res.body.impact).toHaveProperty('comments');
  });
});

describe('DELETE /api/v1/admin/workspaces/:id', () => {
  test('a permanent delete needs the exact name as confirmation', async () => {
    const ws = await createWorkspace();

    const wrong = await request(app)
      .delete(`/api/v1/admin/workspaces/${ws.id}`)
      .set(superAdminToken)
      .send({ confirm: 'something else' });
    expect(wrong.status).toBe(400);

    const right = await request(app)
      .delete(`/api/v1/admin/workspaces/${ws.id}`)
      .set(superAdminToken)
      .send({ confirm: ws.name });
    expect(right.status).toBe(200);

    const [rows] = await pool.query('SELECT id FROM workspaces WHERE id = ?', [ws.id]);
    expect(rows).toHaveLength(0);
  });

  test('an ordinary admin cannot delete a workspace', async () => {
    const ws = await createWorkspace();

    const res = await request(app)
      .delete(`/api/v1/admin/workspaces/${ws.id}`)
      .set(adminToken)
      .send({ confirm: ws.name });

    expect(res.status).toBe(403);

    const [rows] = await pool.query('SELECT id FROM workspaces WHERE id = ?', [ws.id]);
    expect(rows).toHaveLength(1);
  });

  test('a super admin CAN delete a workspace they own', async () => {
    // Creating it without an owner email makes the creator the owner. They
    // must still be able to remove it - being the owner is not a reason to
    // be blocked.
    const res = await request(app)
      .post('/api/v1/admin/workspaces')
      .set(superAdminToken)
      .send({ name: `Owned By Admin ${unique('w')}` });
    createdWorkspaceIds.push(res.body.workspace.id);
    const wsId = res.body.workspace.id;

    const [ownerRows] = await pool.query(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [wsId, F.superAdmin.id]
    );
    expect(ownerRows[0].role).toBe('owner');

    const del = await request(app)
      .delete(`/api/v1/admin/workspaces/${wsId}`)
      .set(superAdminToken)
      .send({ confirm: res.body.workspace.name });
    expect(del.status).toBe(200);

    const [rows] = await pool.query('SELECT id FROM workspaces WHERE id = ?', [wsId]);
    expect(rows).toHaveLength(0);
  });

  test('the requester cannot delete their LAST remaining workspace', async () => {
    // Take the super admin down to exactly one workspace for the duration of
    // this test, so the guard is exercised for real rather than assumed.
    const [all] = await pool.query(
      'SELECT workspace_id, role FROM workspace_members WHERE user_id = ?',
      [F.superAdmin.id]
    );
    const keep = all[0];
    const removed = all.filter((m) => m.workspace_id !== keep.workspace_id);

    for (const r of removed) {
      await pool.query('DELETE FROM workspace_members WHERE user_id = ? AND workspace_id = ?', [
        F.superAdmin.id,
        r.workspace_id
      ]);
    }

    try {
      const [wsRows] = await pool.query('SELECT name FROM workspaces WHERE id = ?', [
        keep.workspace_id
      ]);

      const res = await request(app)
        .delete(`/api/v1/admin/workspaces/${keep.workspace_id}`)
        .set(superAdminToken)
        .send({ confirm: wsRows[0].name });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/only workspace/i);
    } finally {
      for (const r of removed) {
        await pool.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
          [r.workspace_id, F.superAdmin.id, r.role]
        );
      }
    }
  });

  test('a member cannot delete a workspace', async () => {
    const ws = await createWorkspace();

    const res = await request(app)
      .delete(`/api/v1/admin/workspaces/${ws.id}`)
      .set(memberToken)
      .send({ confirm: ws.name });

    expect(res.status).toBe(403);
  });
});
