/**
 * Google sign-in guarantees.
 *
 * The property that matters most: **a Google signup is always a plain member,
 * and signing in never rewrites an existing role.** Google's payload carries no
 * role at all, so if this endpoint ever took one from the credential it would
 * be privilege escalation straight from an external identity provider.
 *
 * `google-auth-library` is mocked rather than called for real, and global.fetch
 * is replaced for the access-token path. That means the signature check itself
 * is NOT under test here - what is under test is everything this app does with
 * a profile once Google has vouched for it.
 */

jest.mock('google-auth-library', () => ({
  OAuth2Client: class {
    // Reads the control globals at call time so each test can set its own
    // outcome without re-requiring the module.
    async verifyIdToken() {
      if (global.__GOOGLE_VERIFY_ERROR) {
        throw new Error(global.__GOOGLE_VERIFY_ERROR);
      }
      return { getPayload: () => global.__GOOGLE_PROFILE };
    }
  }
}));

const { app, request, pool, fixtures, unique, createUser, deleteUserByEmail } = require('./helpers');

const AUTH = '/api/v1/auth/google';

const marker = () => unique('gsuite');
const realFetch = global.fetch;

let F;

beforeAll(async () => {
  F = await fixtures();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
});

beforeEach(() => {
  global.__GOOGLE_PROFILE = undefined;
  global.__GOOGLE_VERIFY_ERROR = undefined;
});

afterAll(() => {
  global.fetch = realFetch;
});

/** A credential shaped like a Google ID token: three dot-separated segments. */
const ID_TOKEN = 'aaaa.bbbb.cccc';
/** Opaque, no dots: takes the userinfo path instead. */
const ACCESS_TOKEN = 'opaque-oauth-access-token';

const signIn = (body) => request(app).post(AUTH).send(body);

const withProfile = (profile, error) => {
  global.__GOOGLE_PROFILE = profile;
  global.__GOOGLE_VERIFY_ERROR = error;
};

const stubUserinfo = (payload) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload
  });
};

describe('configuration and input', () => {
  test('answers 503 when Google is not configured', async () => {
    const previous = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    try {
      const res = await signIn({ credential: ID_TOKEN });
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/not configured/i);
    } finally {
      process.env.GOOGLE_CLIENT_ID = previous;
    }
  });

  test('rejects a missing credential', async () => {
    const res = await signIn({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No Google credential/i);
  });

  test('rejects a credential that is not a string', async () => {
    const res = await signIn({ credential: { evil: true } });
    expect(res.status).toBe(400);
  });
});

describe('the credential itself', () => {
  test('rejects an ID token Google will not verify', async () => {
    withProfile(null, 'invalid signature');

    const res = await signIn({ credential: ID_TOKEN });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or has expired/i);
  });

  test('an ID token is checked with verifyIdToken and never sent to userinfo', async () => {
    withProfile({ email: `${marker()}@suprema.test`, email_verified: true, name: 'JWT User' });
    stubUserinfo({});

    const res = await signIn({ credential: ID_TOKEN });

    expect(res.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an opaque token is checked with userinfo, not verifyIdToken', async () => {
    stubUserinfo({ email: `${marker()}@suprema.test`, email_verified: true, name: 'Popup User' });

    const res = await signIn({ credential: ACCESS_TOKEN });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('googleapis.com');
  });

  test('a rejected access token is a 401, not a 500', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    const res = await signIn({ credential: ACCESS_TOKEN });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or has expired/i);
  });

  test('a network failure while checking the token is reported honestly', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    const res = await signIn({ credential: ACCESS_TOKEN });
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/try again/i);
  });
});

describe('verified profiles', () => {
  test('refuses an unverified Google email and creates no account', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email, email_verified: false, name: 'Unverified' });

    const res = await signIn({ credential: ID_TOKEN });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not verified/i);

    const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE email = $1', [email]);
    expect(row.c).toBe(0);
  });

  test('refuses a profile with no email at all', async () => {
    withProfile({ email_verified: true, name: 'No Email' });

    const res = await signIn({ credential: ID_TOKEN });
    expect(res.status).toBe(401);
  });
});

describe('role guarantees', () => {
  test('a brand new Google account is ALWAYS a member', async () => {
    const email = `${marker()}@suprema.test`;
    // A payload stuffed with elevated-looking fields. None of them are the
    // column the endpoint writes, which is the whole point.
    withProfile({
      email,
      email_verified: true,
      name: 'New Person',
      role: 'super_admin',
      admin: true,
      is_staff: true,
      hd: 'suprema.test'
    });

    const res = await signIn({ credential: ID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('member');

    const [[row]] = await pool.query('SELECT role, status FROM users WHERE email = $1', [email]);
    expect(row.role).toBe('member');
    expect(row.status).toBe('active');
  });

  test('signing in does NOT rewrite an existing role', async () => {
    const email = `${marker()}@suprema.test`;
    await createUser({ name: 'Promoted Staff', email, role: 'developer' });

    withProfile({ email, email_verified: true, name: 'Google Name' });
    const res = await signIn({ credential: ID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('developer');

    const [[row]] = await pool.query('SELECT role FROM users WHERE email = $1', [email]);
    expect(row.role).toBe('developer');

    await deleteUserByEmail(email);
  });

  test('an admin stays an admin', async () => {
    const email = `${marker()}@suprema.test`;
    await createUser({ name: 'Admin', email, role: 'admin' });

    withProfile({ email, email_verified: true, name: 'Admin' });
    const res = await signIn({ credential: ID_TOKEN });

    expect(res.body.user.role).toBe('admin');
    await deleteUserByEmail(email);
  });

  test('a suspended account is refused even with a valid credential', async () => {
    const email = `${marker()}@suprema.test`;
    await createUser({ name: 'Suspended', email, role: 'member' });
    await pool.query("UPDATE users SET status = 'suspended' WHERE email = $1", [email]);

    withProfile({ email, email_verified: true, name: 'Suspended' });
    const res = await signIn({ credential: ID_TOKEN });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Suspended/i);

    await deleteUserByEmail(email);
  });
});

describe('account creation details', () => {
  test('a Google account cannot be logged into with a password', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email, email_verified: true, name: 'No Password' });

    await signIn({ credential: ID_TOKEN });

    // The stored hash is a deliberately unusable marker, not a bcrypt digest,
    // so nothing can ever compare equal to it.
    const [[row]] = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(row.password_hash.startsWith('!google-')).toBe(true);

    const login = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'whatever-guesses-wont-work'
    });
    expect(login.status).toBe(401);

    await deleteUserByEmail(email);
  });

  test('a second sign-in does not create a second account', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email, email_verified: true, name: 'Twice' });

    await signIn({ credential: ID_TOKEN });
    await signIn({ credential: ID_TOKEN });

    const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE email = $1', [email]);
    expect(row.c).toBe(1);

    await deleteUserByEmail(email);
  });

  test('the email is normalised to lowercase before lookup', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email: email.toUpperCase(), email_verified: true, name: 'Caps' });

    const res = await signIn({ credential: ID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);

    await deleteUserByEmail(email);
  });

  test('a Google picture is stored only when the user has none', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email, email_verified: true, name: 'Pic', picture: 'https://img.test/a.png' });

    await signIn({ credential: ID_TOKEN });

    let [[row]] = await pool.query('SELECT avatar_url FROM users WHERE email = $1', [email]);
    expect(row.avatar_url).toBe('https://img.test/a.png');

    // A picture the user set themselves must win over the Google one.
    await pool.query('UPDATE users SET avatar_url = $1 WHERE email = $2', ['https://img.test/mine.png', email]);

    withProfile({ email, email_verified: true, name: 'Pic', picture: 'https://img.test/google.png' });
    await signIn({ credential: ID_TOKEN });

    [[row]] = await pool.query('SELECT avatar_url FROM users WHERE email = $1', [email]);
    expect(row.avatar_url).toBe('https://img.test/mine.png');

    await deleteUserByEmail(email);
  });

  test('falls back to the email local part when Google sends no name', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email, email_verified: true });

    const res = await signIn({ credential: ID_TOKEN });

    expect(res.body.user.name).toBe(email.split('@')[0]);
    await deleteUserByEmail(email);
  });

  test('the returned token authenticates the new account', async () => {
    const email = `${marker()}@suprema.test`;
    withProfile({ email, email_verified: true, name: 'Token Check' });

    const res = await signIn({ credential: ID_TOKEN });
    expect(res.body.token).toBeTruthy();

    // Use it against a real authenticated endpoint.
    const check = await request(app)
      .get('/api/v1/workspaces')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(check.status).toBe(200);

    await deleteUserByEmail(email);
  });
});

/**
 * Kept as the last test rather than an afterAll: helpers.js registers the hook
 * that closes this file's pool first, so an afterAll would run after the pool
 * was already gone.
 */
test('removes every account this file created', async () => {
  const [result] = await pool.query("DELETE FROM users WHERE email LIKE $1", ['gsuite-%@suprema.test']);
  const [[row]] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE email LIKE $1", ['gsuite-%@suprema.test']);

  expect(row.c).toBe(0);
  expect(result.affectedRows).toBeGreaterThanOrEqual(0);
});
