/**
 * Changelog manager (staff CRUD) and the public changelog it feeds.
 *
 * The public endpoint orders by release_date DESC, so ordering is part of the
 * contract being tested, not just field-level validation.
 */

const { app, request, auth, fixtures, pool, unique } = require('./helpers');

const ADMIN = '/api/v1/admin/changelogs';
const PUBLIC = '/api/v1/changelogs';

let F;
let staffToken;

const tagId = () => `v9.9.9-${unique('t')}`;

const validBody = (overrides = {}) => ({
  tagId: tagId(),
  releaseDate: '2030-01-15',
  badge: 'New',
  badgeColor: 'text-emerald-400',
  title: 'A test release',
  description: 'Written by the automated suite.',
  bullets: 'first bullet\nsecond bullet\n\n   third bullet   ',
  ...overrides
});

beforeAll(async () => {
  F = await fixtures();
  staffToken = auth(F.admin);
});

// Everything this file creates, tracked so the table is provably restored.
const created = [];
afterEach(async () => {
  // One statement per tag: node-postgres sends a JavaScript array as several
  // bind parameters, which does not fit a single $1 placeholder.
  for (const tag of created) {
    await pool.query('DELETE FROM changelogs WHERE tag_id = $1', [tag]);
  }
  created.length = 0;
});

describe('POST /admin/changelogs - validation', () => {
  const rejects = async (body, pattern) => {
    // Track the tag even though nothing should be written: if validation ever
    // regresses and the row IS created, afterEach still cleans it up rather
    // than leaving it to fail an unrelated test later.
    if (body.tagId) created.push(body.tagId);

    const res = await request(app).post(ADMIN).set(staffToken).send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(pattern);
    return res;
  };

  test('requires a version tag', async () => {
    await rejects(validBody({ tagId: '' }), /version tag is required/i);
  });

  test('refuses characters that are not safe in a tag', async () => {
    await rejects(validBody({ tagId: 'v1.4.0 <script>' }), /may only contain/i);
  });

  test('requires a title', async () => {
    await rejects(validBody({ title: '' }), /title is required/i);
  });

  test('requires a release date so ordering stays correct', async () => {
    await rejects(validBody({ releaseDate: '' }), /release date is required/i);
  });

  test('refuses a malformed release date', async () => {
    await rejects(validBody({ releaseDate: '12/2030' }), /YYYY-MM-DD/);
  });

  test('refuses a date that is not a real date', async () => {
    await rejects(validBody({ releaseDate: '2030-02-31' }), /not a real date/i);
  });

  test('refuses an unknown badge colour', async () => {
    await rejects(validBody({ badgeColor: 'text-hotpink-900' }), /Badge colour must be one of/);
  });

  test('nothing invalid reaches the database', async () => {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS c FROM changelogs WHERE tag_id LIKE 'v9.9.9-%'"
    );
    expect(row.c).toBe(0);
  });
});

describe('POST /admin/changelogs - creating', () => {
  test('creates an entry and makes it public', async () => {
    const body = validBody();
    created.push(body.tagId);

    const res = await request(app).post(ADMIN).set(staffToken).send(body);
    expect(res.status).toBe(201);
    expect(res.body.message).toContain(body.tagId);

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === body.tagId);
    expect(found).toBeTruthy();
    expect(found.title).toBe(body.title);
  });

  test('rejects a duplicate version tag with a clear message, not a 500', async () => {
    const body = validBody();
    created.push(body.tagId);

    expect((await request(app).post(ADMIN).set(staffToken).send(body)).status).toBe(201);

    const dupe = await request(app)
      .post(ADMIN)
      .set(staffToken)
      .send(validBody({ tagId: body.tagId, title: 'Different title' }));

    expect(dupe.status).toBe(409);
    expect(dupe.body.message).toMatch(/already in the changelog/i);
    expect(dupe.body.message).not.toMatch(/ER_DUP_ENTRY|SQL/);
  });

  test('turns one-bullet-per-line into a clean JSON array', async () => {
    const body = validBody();
    created.push(body.tagId);

    await request(app).post(ADMIN).set(staffToken).send(body);

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === body.tagId);

    // Blank lines dropped, whitespace trimmed, and no ragged edges.
    expect(found.bullets).toEqual(['first bullet', 'second bullet', 'third bullet']);
  });

  test('accepts bullets already supplied as a JSON array', async () => {
    const body = validBody({ bullets: ['alpha', 'beta'] });
    created.push(body.tagId);

    await request(app).post(ADMIN).set(staffToken).send(body);

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === body.tagId);
    expect(found.bullets).toEqual(['alpha', 'beta']);
  });

  test('stores no bullets as an empty list rather than null junk', async () => {
    const body = validBody({ bullets: '' });
    created.push(body.tagId);

    await request(app).post(ADMIN).set(staffToken).send(body);

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === body.tagId);
    expect(found.bullets).toEqual([]);
  });
});

describe('public changelog ordering', () => {
  test('newest release date comes first', async () => {
    const older = validBody({ releaseDate: '2020-03-01' });
    const newer = validBody({ releaseDate: '2030-03-01' });
    created.push(older.tagId, newer.tagId);

    await request(app).post(ADMIN).set(staffToken).send(older);
    await request(app).post(ADMIN).set(staffToken).send(newer);

    const pub = await request(app).get(PUBLIC);
    const ids = pub.body.changelogs.map((c) => c.tagId);

    expect(ids.indexOf(newer.tagId)).toBeLessThan(ids.indexOf(older.tagId));
    expect(ids[0]).toBe(newer.tagId);
  });
});

describe('PUT /admin/changelogs/:tagId - updating', () => {
  test('edits an entry and the public page follows', async () => {
    const body = validBody();
    created.push(body.tagId);
    await request(app).post(ADMIN).set(staffToken).send(body);

    const res = await request(app)
      .put(`${ADMIN}/${body.tagId}`)
      .set(staffToken)
      .send({ ...body, title: 'Edited title', badge: 'Fixed', bullets: 'only one now' });

    expect(res.status).toBe(200);

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === body.tagId);
    expect(found.title).toBe('Edited title');
    expect(found.badge).toBe('Fixed');
    expect(found.bullets).toEqual(['only one now']);
  });

  test('validates edits the same way it validates creates', async () => {
    const body = validBody();
    created.push(body.tagId);
    await request(app).post(ADMIN).set(staffToken).send(body);

    const res = await request(app)
      .put(`${ADMIN}/${body.tagId}`)
      .set(staffToken)
      .send({ ...body, releaseDate: 'tomorrow' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/YYYY-MM-DD/);
  });

  test('returns 404 when there is nothing to edit', async () => {
    const res = await request(app)
      .put(`${ADMIN}/v0.0.0-does-not-exist`)
      .set(staffToken)
      .send(validBody({ tagId: 'v0.0.0-does-not-exist' }));

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/No changelog entry/i);
  });
});

describe('escaped line breaks in text fields', () => {
  test('stores a real newline when an editor types the characters backslash-n', async () => {
    // A single-line admin input cannot hold a newline, so editors describe the
    // break with the two characters `\` and `n`. Stored verbatim that printed
    // "\n" on the public card - this is that regression.
    const body = validBody({ bannerTitle: 'Task Assignment\\nFeatures' });
    created.push(body.tagId);

    await request(app).post(ADMIN).set(staffToken).send(body);

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === body.tagId);

    expect(found.bannerTitle).toBe('Task Assignment\nFeatures');
    expect(found.bannerTitle).not.toContain('\\n');
  });

  test('serves rows stored before the fix without printing the escape', async () => {
    // Reproduce a legacy row exactly: CHAR(92) is a backslash, so this stores
    // the two characters `\` + `n` no matter how the connection escapes them.
    const tag = `v9.9.9-${unique('legacy')}`;
    created.push(tag);

    await pool.query(
      `INSERT INTO changelogs (tag_id, date, release_date, title, banner_title)
       VALUES ($1, 'Jan 1, 2030', '2030-01-01', 'Legacy row',
               CONCAT('Legacy heading', CHR(92), 'ncontinued')) RETURNING id`,
      [tag]
    );

    const pub = await request(app).get(PUBLIC);
    const found = pub.body.changelogs.find((c) => c.tagId === tag);

    expect(found.bannerTitle).toBe('Legacy heading\ncontinued');
    expect(found.bannerTitle).not.toContain('\\n');
  });
});

describe('DELETE /admin/changelogs/:tagId - removing', () => {
  test('removes it from the public changelog immediately', async () => {
    const body = validBody();
    await request(app).post(ADMIN).set(staffToken).send(body);

    expect(
      (await request(app).get(PUBLIC)).body.changelogs.some((c) => c.tagId === body.tagId)
    ).toBe(true);

    const res = await request(app).delete(`${ADMIN}/${body.tagId}`).set(staffToken);
    expect(res.status).toBe(200);

    expect(
      (await request(app).get(PUBLIC)).body.changelogs.some((c) => c.tagId === body.tagId)
    ).toBe(false);
  });

  test('returns 404 when deleting something that is already gone', async () => {
    const res = await request(app)
      .delete(`${ADMIN}/v0.0.0-never-existed`)
      .set(staffToken);
    expect(res.status).toBe(404);
  });

  test('restores the table to its original state', async () => {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS c FROM changelogs WHERE tag_id LIKE 'v9.9.9-%'"
    );
    expect(row.c).toBe(0);
  });
});
