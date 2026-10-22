/**
 * Marketing capture and the Lead Inbox.
 *
 * The contact form and waitlist write rows; this suite proves staff can read
 * them, move them through their statuses, and export them without corrupting
 * the file.
 */

const { app, request, auth, fixtures, pool, unique } = require('./helpers');

let F;

const CONTACT = '/api/v1/contact';
const WAITLIST = '/api/v1/waitlist';
const ADMIN = '/api/v1/admin/leads';

const marker = unique('lead');

const contactBody = (overrides = {}) => ({
  name: 'Test Inquirer',
  email: `${unique('inq')}@example.test`,
  subject: 'Question about pricing',
  message: 'How much does the Pro plan cost?',
  ...overrides
});

beforeAll(async () => {
  F = await fixtures();
});

describe('POST /contact - the public inquiry form', () => {
  test('rejects an incomplete submission with per-field errors', async () => {
    const res = await request(app).post(CONTACT).send({ name: '', email: '', message: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
      message: expect.any(String)
    });
  });

  test('rejects a malformed email address', async () => {
    const res = await request(app).post(CONTACT).send(contactBody({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(res.body.errors.email).toMatch(/valid email/i);
  });

  test('accepts a message at the exact size limit', async () => {
    // MAX_MESSAGE is 5000 with a `> 5000` check, so 5000 is allowed. Pinning
    // both sides of the boundary stops an off-by-one from going unnoticed.
    const res = await request(app)
      .post(CONTACT)
      .send(contactBody({ message: 'x'.repeat(5000) }));

    expect(res.status).toBe(201);
  });

  test('rejects a message one character over the limit', async () => {
    const res = await request(app)
      .post(CONTACT)
      .send(contactBody({ message: 'x'.repeat(5001) }));

    expect(res.status).toBe(400);
    expect(res.body.errors.message).toMatch(/under/i);
  });

  test('accepts a valid inquiry and shows it to staff as unread', async () => {
    const email = `${marker}-inbox@example.test`;
    const res = await request(app)
      .post(CONTACT)
      .send(contactBody({ email, message: 'Please contact me about Enterprise.' }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const inbox = await request(app).get(`${ADMIN}/contact`).set(auth(F.admin));
    expect(inbox.status).toBe(200);

    const found = inbox.body.messages.find((m) => m.email === email);
    expect(found).toBeTruthy();
    expect(found.status).toBe('unread');
    expect(found.message).toBe('Please contact me about Enterprise.');
  });

  test('defaults the subject when the form does not send one', async () => {
    const email = `${marker}-subj@example.test`;
    await request(app).post(CONTACT).send(contactBody({ email, subject: '' }));

    const inbox = await request(app).get(`${ADMIN}/contact`).set(auth(F.admin));
    const found = inbox.body.messages.find((m) => m.email === email);
    expect(found.subject).toBe('Website Inquiry');
  });
});

describe('POST /waitlist - queue positions', () => {
  test('rejects an invalid address', async () => {
    const res = await request(app).post(WAITLIST).send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.errors.email).toBeTruthy();
  });

  test('assigns an increasing position and a referral code', async () => {
    const first = `${marker}-a@example.test`;
    const second = `${marker}-b@example.test`;

    const one = await request(app).post(WAITLIST).send({ email: first });
    const two = await request(app).post(WAITLIST).send({ email: second });

    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(one.body.position).toBeGreaterThan(0);
    expect(two.body.position).toBe(one.body.position + 1);
    expect(one.body.referralCode).toMatch(/^SUP-/);
    expect(one.body.alreadyRegistered).toBe(false);
  });

  test('a duplicate signup returns the existing position instead of failing', async () => {
    const email = `${marker}-dup@example.test`;

    const first = await request(app).post(WAITLIST).send({ email });
    const again = await request(app).post(WAITLIST).send({ email });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.alreadyRegistered).toBe(true);
    expect(again.body.position).toBe(first.body.position);

    const [[row]] = await pool.query(
      'SELECT COUNT(*) AS c FROM waitlist_leads WHERE email = $1',
      [email]
    );
    expect(row.c).toBe(1);
  });
});

describe('Lead Inbox - reading and working the leads', () => {
  test('lists waitlist leads with their positions', async () => {
    await request(app).post(WAITLIST).send({ email: `${marker}-list@example.test` });

    const res = await request(app).get(`${ADMIN}/waitlist`).set(auth(F.superAdmin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leads)).toBe(true);
    expect(res.body.leads.some((l) => l.email === `${marker}-list@example.test`)).toBe(true);
  });

  test('moves a contact message through its statuses', async () => {
    const email = `${marker}-status@example.test`;
    await request(app).post(CONTACT).send(contactBody({ email }));

    const inbox = await request(app).get(`${ADMIN}/contact`).set(auth(F.admin));
    const lead = inbox.body.messages.find((m) => m.email === email);
    expect(lead.status).toBe('unread');

    const read = await request(app)
      .patch(`${ADMIN}/contact/${lead.id}/status`)
      .set(auth(F.admin))
      .send({ status: 'read' });
    expect(read.status).toBe(200);

    const replied = await request(app)
      .patch(`${ADMIN}/contact/${lead.id}/status`)
      .set(auth(F.admin))
      .send({ status: 'replied' });
    expect(replied.status).toBe(200);

    const after = await request(app).get(`${ADMIN}/contact`).set(auth(F.admin));
    expect(after.body.messages.find((m) => m.id === lead.id).status).toBe('replied');
  });

  test('refuses a status value that is not part of the workflow', async () => {
    const email = `${marker}-badstatus@example.test`;
    await request(app).post(CONTACT).send(contactBody({ email }));

    const inbox = await request(app).get(`${ADMIN}/contact`).set(auth(F.admin));
    const lead = inbox.body.messages.find((m) => m.email === email);

    const res = await request(app)
      .patch(`${ADMIN}/contact/${lead.id}/status`)
      .set(auth(F.admin))
      .send({ status: 'nonsense' });

    expect(res.status).toBe(400);
  });
});

describe('CSV export', () => {
  test('exports contact messages as UTF-8 CSV with a BOM', async () => {
    const res = await request(app).get(`${ADMIN}/export?type=contact`).set(auth(F.admin));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);

    const body = res.text;
    // Without this Excel reads the file as ANSI and mangles accented names.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('Email');
    expect(body).toContain(`${marker}-inbox@example.test`);
  });

  test('escapes commas and quotes so Excel keeps its columns aligned', async () => {
    const email = `${marker}-csv@example.test`;
    const tricky = 'Smith, John said "call me" tomorrow';

    await request(app).post(CONTACT).send(contactBody({ email, message: tricky }));

    const res = await request(app).get(`${ADMIN}/export?type=contact`).set(auth(F.admin));
    const body = res.text;

    // A comma inside an unquoted cell would shift every later column, and a
    // single double-quote would terminate the field early.
    expect(body).toContain('"Smith, John said ""call me"" tomorrow"');
  });

  test('exports the waitlist too', async () => {
    const res = await request(app).get(`${ADMIN}/export?type=waitlist`).set(auth(F.admin));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    expect(res.text).toContain(`${marker}-a@example.test`);
  });
});

/**
 * Removed here on purpose.
 *
 * It used to be an afterAll, but Jest runs afterAll hooks in registration
 * order and helpers.js registers the hook that closes this file's connection
 * pool first - so the pool was gone before this could run. Declaring it as the
 * last test keeps it ahead of every afterAll while still running after
 * everything else in the file.
 */
test('cleans up every row this file created', async () => {
  // Everything carries a unique marker in its email.
  await pool.query('DELETE FROM contact_messages WHERE email LIKE $1', [`%${marker}%`]);
  await pool.query('DELETE FROM waitlist_leads WHERE email LIKE $1', [`%${marker}%`]);

  const [[contacts]] = await pool.query(
    'SELECT COUNT(*) AS c FROM contact_messages WHERE email LIKE $1',
    [`%${marker}%`]
  );
  const [[waitlist]] = await pool.query(
    'SELECT COUNT(*) AS c FROM waitlist_leads WHERE email LIKE $1',
    [`%${marker}%`]
  );
  expect(contacts.c).toBe(0);
  expect(waitlist.c).toBe(0);
});
