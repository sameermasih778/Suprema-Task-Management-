/**
 * Security posture.
 *
 * These are assertions about the app's boundaries rather than any single
 * feature: what an unauthenticated caller sees, what a 500 is allowed to leak,
 * whether a hostile input crashes the process, and whether the response ever
 * contains a credential.
 *
 * The errorHandler tests are unit tests against the middleware directly,
 * because triggering a genuine 500 through a route would mean shipping a route
 * that is deliberately broken.
 */

const { app, request, auth, fixtures, createUser, deleteUserByEmail, unique, pool } = require('./helpers');

const errorHandler = require('../middleware/errorHandler');

let F;

beforeAll(async () => {
  F = await fixtures();
});

/** Minimal express response double. */
const makeRes = () => {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
};

describe('security headers', () => {
  test('helmet is applied to API responses', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');

    // Helmet's default rather than DENY. This origin only ever serves JSON and
    // static uploads, so there is no page here worth framing - if a server-side
    // rendered page were ever added to this origin, switch it to DENY.
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('server identity is not advertised', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error handling leaks nothing', () => {
  let errorSpy;

  beforeEach(() => {
    // The middleware logs the real error for the developer; that must not be
    // confused with what it sends to the caller.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  test('a 500 sends a generic message and no stack', () => {
    const res = makeRes();
    const err = new Error('connect ECONNREFUSED 10.0.0.5:3306 in /srv/app/controllers/users.js');

    errorHandler(err, { method: 'GET', originalUrl: '/api/v1/users' }, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.payload.message).toBe('Something went wrong on our end. Please try again.');
    expect(res.payload.stack).toBeUndefined();
    // The raw message can carry hostnames and paths - it must not survive.
    expect(JSON.stringify(res.payload)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.payload)).not.toContain('/srv/app');
  });

  test('a 4xx message written by a controller is passed through', () => {
    const res = makeRes();
    res.statusCode = 400;

    errorHandler(new Error('Please enter a valid email address.'), {}, res, () => {});

    expect(res.payload.message).toBe('Please enter a valid email address.');
  });

  test('a duplicate key is reported as 409 without the SQL error', () => {
    const res = makeRes();
    const err = new Error("Duplicate key value violates unique constraint \"users_email_key\"");
    // 23505 is PostgreSQL's unique_violation.
    err.code = '23505';

    errorHandler(err, {}, res, () => {});

    expect(res.statusCode).toBe(409);
    expect(res.payload.message).toMatch(/already exists/i);
    expect(JSON.stringify(res.payload)).not.toContain('23505');
  });

  test('the stack is only ever included in development', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const res = makeRes();
      errorHandler(new Error('boom'), {}, res, () => {});
      expect(res.payload.stack).toContain('boom');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('hostile input does not become a 500', () => {
  test('SQL injection in a login email is treated as a wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: "' OR '1'='1' --",
      password: 'anything'
    });

    // Must be an auth failure, never a database error surfacing as 500.
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid email or password/i);
    expect(JSON.stringify(res.body)).not.toMatch(/SQL|syntax|mysql|SELECT/i);
  });

  test('SQL injection in a login password does not authenticate anyone', async () => {
    const victim = await createUser({
      name: 'Injection Target',
      email: `${unique('inj')}@suprema.test`
    });

    const res = await request(app).post('/api/v1/auth/login').send({
      email: victim.email,
      password: "' OR '1'='1"
    });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();

    await deleteUserByEmail(victim.email);
  });

  test('SQL injection in the public contact form is rejected, not executed', async () => {
    const res = await request(app).post('/api/v1/contact').send({
      name: "'; DROP TABLE users; --",
      email: `${unique('inj')}@example.test`,
      message: 'hello'
    });

    // Either accepted as a literal string or rejected by validation - but the
    // users table must still be there.
    expect([201, 400]).toContain(res.status);

    const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM users');
    expect(row.c).toBeGreaterThan(0);
  });

  test('a malformed JSON body is a 400, not a crash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
  });

  test('an unknown route answers with JSON, not an HTML stack trace', async () => {
    const res = await request(app).get('/api/v1/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.message).toMatch(/not found/i);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });
});

describe('credentials never leave the server', () => {
  test('a successful login response contains no hash', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: F.superAdmin.email,
      password: 'TestPass123!'
    });

    expect(res.status).toBe(200);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('password_hash');
    expect(serialised).not.toContain('!google-');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('a forged token is refused', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign(
      { id: F.superAdmin.id, email: F.superAdmin.email, role: 'super_admin' },
      'a-wrong-secret'
    );

    const res = await request(app)
      .get('/api/v1/admin/leads/contact')
      .set('Authorization', `Bearer ${forged}`);

    // Invalid signature => unauthenticated (401), not "authenticated but
    // forbidden" (403).
    expect(res.status).toBe(401);
  });

  test('a token signed for another role is honoured only as itself', async () => {
    // A member cannot self-promote by minting their own token - the role in a
    // token is trusted, so it must only ever be issued by this server.
    const res = await request(app)
      .get('/api/v1/admin/changelogs')
      .set(auth(F.member));

    expect(res.status).toBe(403);
  });
});

describe('CORS', () => {
  test('an unknown origin is not granted access', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('the configured application origin is allowed', async () => {
    const configured = (process.env.CLIENT_ORIGIN || '').split(',')[0].trim();
    const res = await request(app).get('/api/v1/health').set('Origin', configured);

    expect(res.headers['access-control-allow-origin']).toBe(configured);
  });

  test('a preflight from a foreign origin does not advertise the API', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
