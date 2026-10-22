/**
 * Self-service password reset.
 *
 * The properties under test are the ones that make this safe to expose:
 *
 *   - no user enumeration (identical answer for known and unknown addresses)
 *   - tokens stored hashed, never in plaintext
 *   - single use, 30 minute life
 *   - expiry decided by the database's clock, never by Node's
 *
 * Email sending is disabled by tests/testEnv.js, so the reset link comes back
 * in the response body. That is a development affordance, and one test below
 * proves it disappears once SMTP is configured.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { app, request, pool, unique, createUser, deleteUserByEmail } = require('./helpers');

const AUTH = '/api/v1/auth';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const tokenFromResponse = (body) => {
  expect(body.devResetUrl).toBeTruthy();
  const url = new URL(body.devResetUrl);
  expect(url.pathname).toBe('/reset-password');
  return url.searchParams.get('token');
};

/** A throwaway account owned entirely by this file. */
const makeAccount = async (label, overrides = {}) => {
  const email = `${unique(label)}@suprema.test`;
  const password = 'OriginalPass1!';
  // Hashed here rather than using createUser's default, so the password this
  // object claims is genuinely the one that will authenticate.
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await createUser({ name: 'Reset Subject', email, passwordHash, ...overrides });
  return { ...user, password };
};

describe('POST /auth/forgot-password', () => {
  test('rejects a malformed address', async () => {
    const res = await request(app).post(`${AUTH}/forgot-password`).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects an empty address', async () => {
    const res = await request(app).post(`${AUTH}/forgot-password`).send({});
    expect(res.status).toBe(400);
  });

  test('answers unknown and known addresses identically - no enumeration', async () => {
    const account = await makeAccount('enum');

    const unknown = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: `${unique('nobody')}@suprema.test` });
    const known = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: account.email });

    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body.message).toBe(known.body.message);

    // devResetUrl only exists in development; strip it before comparing so the
    // assertion matches what a production caller actually sees.
    const strip = ({ devResetUrl, ...rest }) => rest;
    expect(strip(known.body)).toEqual(strip(unknown.body));

    await deleteUserByEmail(account.email);
  });

  test('issues a token and returns a link pointing at FRONTEND_URL', async () => {
    const account = await makeAccount('link');

    const res = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: account.email });

    expect(res.status).toBe(200);
    const token = tokenFromResponse(res.body);
    expect(token).toHaveLength(64);
    expect(res.body.devResetUrl.startsWith(process.env.FRONTEND_URL)).toBe(true);

    await deleteUserByEmail(account.email);
  });

  test('stores the token as a SHA-256 hash, never in plaintext', async () => {
    const account = await makeAccount('hash');

    const res = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: account.email });
    const token = tokenFromResponse(res.body);

    const [rows] = await pool.query(
      'SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = $1',
      [account.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256(token));
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].used_at).toBeNull();

    // The raw token must not be recoverable from any column of any row.
    const [dump] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE user_id = $1',
      [account.id]
    );
    expect(JSON.stringify(dump)).not.toContain(token);

    await deleteUserByEmail(account.email);
  });

  test('a second request invalidates the first link', async () => {
    const account = await makeAccount('supersede');

    const first = tokenFromResponse(
      (await request(app).post(`${AUTH}/forgot-password`).send({ email: account.email })).body
    );
    const second = tokenFromResponse(
      (await request(app).post(`${AUTH}/forgot-password`).send({ email: account.email })).body
    );

    expect(first).not.toBe(second);

    const stale = await request(app).get(`${AUTH}/reset-password/verify`).query({ token: first });
    expect(stale.status).toBe(400);

    const fresh = await request(app).get(`${AUTH}/reset-password/verify`).query({ token: second });
    expect(fresh.status).toBe(200);
    expect(fresh.body.valid).toBe(true);

    await deleteUserByEmail(account.email);
  });

  test('a suspended account gets the same answer and no token', async () => {
    const account = await makeAccount('suspended');

    await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [account.id]);

    const res = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: account.email });

    expect(res.status).toBe(200);
    expect(res.body.devResetUrl).toBeUndefined();

    const [rows] = await pool.query(
      'SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = $1',
      [account.id]
    );
    expect(rows[0].c).toBe(0);

    await deleteUserByEmail(account.email);
  });

  test('with SMTP configured the reset link is never returned to the caller', async () => {
    const account = await makeAccount('smtp');

    // SMTP_PASS stays empty, so sendPasswordResetEmail still takes its
    // no-send fallback - but the presence of SMTP_USER is what production
    // looks like, and that is what suppresses devResetUrl.
    const previous = process.env.SMTP_USER;
    process.env.SMTP_USER = 'noreply@suprema.test';

    try {
      const res = await request(app)
        .post(`${AUTH}/forgot-password`)
        .send({ email: account.email });

      expect(res.status).toBe(200);
      expect(res.body.devResetUrl).toBeUndefined();
      expect(res.body.message).toBe(
        'If an account exists for that address, a reset link is on its way.'
      );
    } finally {
      process.env.SMTP_USER = previous;
    }

    await deleteUserByEmail(account.email);
  });
});

describe('GET /auth/reset-password/verify', () => {
  test('accepts a freshly issued token', async () => {
    const account = await makeAccount('verify-ok');
    const token = tokenFromResponse(
      (await request(app).post(`${AUTH}/forgot-password`).send({ email: account.email })).body
    );

    const res = await request(app).get(`${AUTH}/reset-password/verify`).query({ token });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.expiresAt).toBeTruthy();

    await deleteUserByEmail(account.email);
  });

  test('rejects a missing token', async () => {
    const res = await request(app).get(`${AUTH}/reset-password/verify`);
    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
  });

  test('rejects a token that was never issued', async () => {
    const res = await request(app)
      .get(`${AUTH}/reset-password/verify`)
      .query({ token: crypto.randomBytes(32).toString('hex') });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid/i);
  });

  test('rejects an expired token', async () => {
    const account = await makeAccount('verify-exp');
    const token = tokenFromResponse(
      (await request(app).post(`${AUTH}/forgot-password`).send({ email: account.email })).body
    );

    // Backdate in SQL, matching how the controller itself compares expiry.
    await pool.query(
      'UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE token_hash = $1',
      [sha256(token)]
    );

    const res = await request(app).get(`${AUTH}/reset-password/verify`).query({ token });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);

    await deleteUserByEmail(account.email);
  });
});

describe('POST /auth/reset-password', () => {
  const NEW_PASSWORD = 'BrandNewPass456!';

  test('rejects a password that is too short', async () => {
    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token: 'irrelevant', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/between 8 and 72/);
  });

  test('rejects a password longer than bcrypt can hash', async () => {
    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token: 'irrelevant', password: 'x'.repeat(73) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/between 8 and 72/);
  });

  test('rejects an unknown token', async () => {
    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token: crypto.randomBytes(32).toString('hex'), password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid/i);
  });

  test('changes the password and can only be used once', async () => {
    const account = await makeAccount('reset-flow');
    const token = tokenFromResponse(
      (await request(app).post(`${AUTH}/forgot-password`).send({ email: account.email })).body
    );

    const used = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token, password: NEW_PASSWORD });
    expect(used.status).toBe(200);
    expect(used.body.success).toBe(true);

    // Old password is dead.
    const oldLogin = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: account.email, password: account.password });
    expect(oldLogin.status).toBe(401);

    // New password works.
    const newLogin = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: account.email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.token).toBeTruthy();

    // The token is spent - replaying it must not work, even with a valid password.
    const replay = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token, password: 'AnotherPass789!' });
    expect(replay.status).toBe(400);
    expect(replay.body.message).toMatch(/already been used/i);

    // And verification agrees it is spent.
    const verify = await request(app).get(`${AUTH}/reset-password/verify`).query({ token });
    expect(verify.status).toBe(400);
    expect(verify.body.message).toMatch(/already been used/i);

    // The stored hash must actually match the new password.
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = $1', [account.id]);
    expect(await bcrypt.compare(NEW_PASSWORD, rows[0].password_hash)).toBe(true);

    await deleteUserByEmail(account.email);
  });

  test('an expired token cannot be redeemed', async () => {
    const account = await makeAccount('reset-exp');
    const token = tokenFromResponse(
      (await request(app).post(`${AUTH}/forgot-password`).send({ email: account.email })).body
    );

    await pool.query(
      'UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE token_hash = $1',
      [sha256(token)]
    );

    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);

    // Password must be untouched.
    const login = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);

    await deleteUserByEmail(account.email);
  });
});
