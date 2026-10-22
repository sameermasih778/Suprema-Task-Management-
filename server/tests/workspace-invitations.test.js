/**
 * Workspace invitations.
 *
 * A workspace invitation is a REQUEST. The membership row in
 * workspace_members must only exist once the invited person has accepted -
 * before this existed, "Invite Collaborator" added the person immediately and
 * silently: no notification, no way to decline, and nothing for an admin to
 * look at afterwards.
 *
 * What is covered here:
 *   - the invitee is notified
 *   - the invitee is NOT a member until they accept
 *   - accepting creates the membership; declining does not
 *   - an invitation can only be answered once, and only by its addressee
 *   - the workspace owner can see who accepted, who declined and who is pending
 */

const { app, request, auth, fixtures, pool, unique } = require('./helpers');

let F;
let adminToken;
let memberToken;

const createdWorkspaceIds = [];
const createdUserIds = [];

beforeAll(async () => {
  F = await fixtures();
  adminToken = auth(F.admin);
  memberToken = auth(F.member);
});

afterEach(async () => {
  if (createdWorkspaceIds.length) {
    for (const id of createdWorkspaceIds) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
    }
    createdWorkspaceIds.length = 0;
  }
  if (createdUserIds.length) {
    for (const id of createdUserIds) {
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
    createdUserIds.length = 0;
  }
});

/** A workspace owned by the admin, so the admin may invite into it. */
const createWorkspace = async () => {
  const res = await request(app)
    .post('/api/v1/workspaces')
    .set(adminToken)
    .send({ name: `Invite Test ${unique('ws')}` });
  expect(res.status).toBe(201);
  createdWorkspaceIds.push(res.body.workspace.id);
  return res.body.workspace.id;
};

/** A second, inviteable account. */
const createInvitee = async () => {
  const email = `invitee-${unique('i')}@suprema.test`;
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('TestPass123!', 4);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ['Invitee Person', email, hash, 'member', 'active']
  );
  createdUserIds.push(result.insertId);
  return { id: result.insertId, name: 'Invitee Person', email };
};

describe('POST /api/v1/workspaces/:id/invitations', () => {
  test('sends an invitation and notifies the invitee', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email, role: 'member' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.invitation.status).toBe('pending');

    const [notifs] = await pool.query(
      `SELECT title, message, type, link FROM notifications
       WHERE user_id = $1 AND type = 'invitation'`,
      [invitee.id]
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0].message).toMatch(/invited you to join the workspace/i);
    expect(notifs[0].link).toContain('invitation=');
  });

  test('does NOT make the invitee a member yet', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email, role: 'member' });

    const [members] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, invitee.id]
    );
    expect(members).toHaveLength(0);
  });

  test('refuses to invite someone who is already a member', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    await pool.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
      [workspaceId, invitee.id, 'member']
    );

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email });

    expect(res.status).toBe(409);
  });

  test('refuses to invite someone who has no account', async () => {
    const workspaceId = await createWorkspace();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: 'nobody-at-all@suprema.test' });

    expect(res.status).toBe(404);
  });

  test('refuses to invite yourself', async () => {
    const workspaceId = await createWorkspace();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: F.admin.email });

    expect(res.status).toBe(400);
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .post('/api/v1/workspaces/1/invitations')
      .send({ email: 'someone@suprema.test' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/invitations/:id/respond', () => {
  /** Create an invitation for a fresh invitee and return both. */
  const invite = async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email, role: 'member' });
    return { workspaceId, invitee, invitationId: res.body.invitation.id };
  };

  test('accepting creates the membership', async () => {
    const { workspaceId, invitee, invitationId } = await invite();

    const res = await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'accept' });

    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('accepted');

    const [members] = await pool.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, invitee.id]
    );
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('member');
  });

  test('declining does NOT create the membership', async () => {
    const { workspaceId, invitee, invitationId } = await invite();

    const res = await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'reject' });

    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('rejected');

    const [members] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, invitee.id]
    );
    expect(members).toHaveLength(0);
  });

  test('the inviter is told how it was answered', async () => {
    const { invitee, invitationId } = await invite();

    await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'accept' });

    const [notifs] = await pool.query(
      `SELECT title, message FROM notifications
       WHERE user_id = $1 AND title LIKE '%invitation%'`,
      [F.admin.id]
    );
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0].title).toMatch(/accepted your invitation/i);
  });

  test('an invitation cannot be answered twice', async () => {
    const { invitee, invitationId } = await invite();

    await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'accept' });

    const second = await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'reject' });

    expect(second.status).toBe(409);
  });

  test('only the addressee may answer', async () => {
    const { invitationId } = await invite();

    const res = await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(memberToken)
      .send({ action: 'accept' });

    expect(res.status).toBe(403);
  });

  test('rejects an unknown action', async () => {
    const { invitee, invitationId } = await invite();

    const res = await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'maybe' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/invitations - the invitee view', () => {
  test('lists the invitations addressed to me', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email });

    const res = await request(app).get('/api/v1/invitations').set(auth(invitee));

    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(1);
    expect(res.body.invitations[0].workspace_name).toBeTruthy();
  });

  test('does not show other people their invitations', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email });

    const res = await request(app).get('/api/v1/invitations').set(memberToken);

    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(0);
  });
});

describe('GET /api/v1/workspaces/:id/invitations - the admin view', () => {
  test('shows pending, accepted and declined with the responder', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email });
    const invitationId = res.body.invitation.id;

    await request(app)
      .post(`/api/v1/invitations/${invitationId}/respond`)
      .set(auth(invitee))
      .send({ action: 'accept' });

    const list = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken);

    expect(list.status).toBe(200);
    expect(list.body.pending).toBe(0);
    expect(list.body.invitations).toHaveLength(1);
    expect(list.body.invitations[0].status).toBe('accepted');
    expect(list.body.invitations[0].invitee_name).toBe(invitee.name);
    expect(list.body.invitations[0].inviter_name).toBe(F.admin.name);
    expect(list.body.invitations[0].responded_at).toBeTruthy();
  });

  test('a plain member cannot see the invitation list', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${F.workspaceId}/invitations`)
      .set(memberToken);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/admin/invitations - the platform-wide view', () => {
  test('lists every invitation with its status and summary counts', async () => {
    const workspaceId = await createWorkspace();
    const invitee = await createInvitee();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(adminToken)
      .send({ email: invitee.email, role: 'member' });

    const list = await request(app).get('/api/v1/admin/invitations').set(adminToken);

    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(list.body.count).toBeGreaterThan(0);
    expect(list.body.summary.total).toBe(list.body.count);
    expect(list.body.summary.pending).toBeGreaterThan(0);

    const mine = list.body.invitations.find((i) => i.id === res.body.invitation.id);
    expect(mine).toBeDefined();
    expect(mine.status).toBe('pending');
    expect(mine.workspace_name).toBeTruthy();
    expect(mine.invited_by_me).toBe(true);
  });

  test('a member cannot reach the platform-wide list', async () => {
    const res = await request(app).get('/api/v1/admin/invitations').set(memberToken);
    expect(res.status).toBe(403);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/v1/admin/invitations');
    expect(res.status).toBe(401);
  });
});
