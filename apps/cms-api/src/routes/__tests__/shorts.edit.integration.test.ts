import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

/**
 * Editing and withdrawing a short, driven over HTTP.
 *
 * The rules under test are the three-way split the route documents: a draft
 * is edited freely by anyone who writes, a live short needs the publish
 * permission and a reason and is stamped, and a withdrawn short is final. Plus
 * withdrawal itself, which used to take no reason at all.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

const app = createCmsApp();

let adminCookie: string;
let reviewerCookie: string;
let authorCookie: string;
let sourceId: ObjectId;

async function sessionFor(role: 'author' | 'reviewer' | 'admin'): Promise<string> {
  const token = await createSession({
    _id: new ObjectId(),
    email: `${role}@example.invalid`,
    role,
    languages: ['ne', 'en'],
  });
  return `${SESSION_COOKIE}=${token}`;
}

function post(path: string, cookie: string) {
  return request(app).post(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function get(path: string, cookie: string) {
  return request(app).get(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}

const PUBLISHED_AT = new Date('2026-09-20T06:00:00Z');

const RENDITIONS = [
  { quality: 'low', url: '/media/v/a-low.mp4', width: 360, height: 640, bytes: 400_000 },
  { quality: 'medium', url: '/media/v/a-med.mp4', width: 540, height: 960, bytes: 900_000 },
];

async function insertShort(status: 'draft' | 'published' | 'retracted'): Promise<ObjectId> {
  const _id = new ObjectId();
  await getDb()
    .collection('videos')
    .insertOne({
      _id,
      slug: `short-${_id.toString()}`,
      status,
      language: 'en',
      categoryId: new ObjectId(),
      sourceId,
      publishedAt: status === 'draft' ? null : PUBLISHED_AT,
      title: 'Flood waters recede in the Terai',
      caption: 'Residents return to their homes as the water level drops.',
      durationSeconds: 42,
      posterUrl: '/media/v/a-poster.jpg',
      posterBlurHash: 'LEHV6nWB2yk8',
      renditions: RENDITIONS,
      credit: 'Sample Post',
      licence: 'publisher_licensed',
      sourceUrl: null,
      sourceName: 'Sample Post',
      categorySlug: 'nepal',
      categoryLabel: { ne: 'नेपाल', en: 'Nepal' },
      ...(status === 'retracted'
        ? { retractedAt: new Date('2026-09-21T00:00:00Z'), retractionReason: 'Wrong footage.' }
        : {}),
      createdAt: new Date('2026-09-19T00:00:00Z'),
      updatedAt: new Date('2026-09-20T06:00:00Z'),
    });
  return _id;
}

const EDIT = {
  language: 'en',
  categorySlug: 'business',
  title: 'Flood waters recede across the Terai',
  caption: 'Residents in three districts return home as the water level drops.',
  credit: 'Sample Post / A. Thapa',
  licence: 'publisher_licensed',
};

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
  [adminCookie, reviewerCookie, authorCookie] = await Promise.all([
    sessionFor('admin'),
    sessionFor('reviewer'),
    sessionFor('author'),
  ]);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  const c = collections(getDb());
  await Promise.all([
    c.sources.deleteMany({}),
    c.categories.deleteMany({}),
    c.audit.deleteMany({}),
    getDb().collection('videos').deleteMany({}),
  ]);

  sourceId = new ObjectId();
  await c.categories.insertMany([
    {
      _id: new ObjectId(),
      slug: 'nepal',
      label: { ne: 'नेपाल', en: 'Nepal' },
      order: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: new ObjectId(),
      slug: 'business',
      label: { ne: 'अर्थ', en: 'Business' },
      order: 2,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ] as never);
});

const videoOf = (id: ObjectId) => getDb().collection('videos').findOne({ _id: id });

describe('editing a draft short', () => {
  it('saves every field, and lets an author do it', async () => {
    const id = await insertShort('draft');
    const res = await post(`/api/cms/shorts/${id.toString()}/edit`, authorCookie).send(EDIT);
    expect(res.status).toBe(200);
    expect(res.body.lastEditedAt).toBeNull();

    const v = await videoOf(id);
    expect(v?.title).toBe(EDIT.title);
    expect(v?.caption).toBe(EDIT.caption);
    expect(v?.credit).toBe(EDIT.credit);
    expect(v?.categorySlug).toBe('business');
    expect(v?.categoryLabel).toEqual({ ne: 'अर्थ', en: 'Business' });
    expect(v?.status).toBe('draft');
  });

  it('asks no reason, and stamps no live-edit record', async () => {
    /* A draft is the newsroom's own business until it is published. */
    const id = await insertShort('draft');
    await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send(EDIT);
    const v = await videoOf(id);
    expect(v?.lastEditedAt ?? null).toBeNull();
    expect(v?.lastEditReason ?? null).toBeNull();
  });

  it('replaces the clip when one is sent, and leaves it alone when not', async () => {
    const id = await insertShort('draft');
    await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send(EDIT);
    expect((await videoOf(id))?.posterUrl).toBe('/media/v/a-poster.jpg');

    const clip = {
      durationSeconds: 30,
      posterUrl: '/media/v/b-poster.jpg',
      posterBlurHash: 'LKO2?U%2Tw=w',
      renditions: [{ quality: 'low', url: '/media/v/b-low.mp4', width: 360, height: 640, bytes: 300_000 }],
    };
    await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send({ ...EDIT, clip });
    const v = await videoOf(id);
    expect(v?.posterUrl).toBe('/media/v/b-poster.jpg');
    expect(v?.durationSeconds).toBe(30);
    expect(v?.renditions).toHaveLength(1);
  });

  it('refuses an unknown section and an empty title', async () => {
    const id = await insertShort('draft');
    expect(
      (await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send({ ...EDIT, categorySlug: 'nowhere' })).status,
    ).toBe(400);
    expect(
      (await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send({ ...EDIT, title: '   ' })).status,
    ).toBe(422);
  });
});

describe('editing a live short', () => {
  it('needs a reason, and changes nothing without one', async () => {
    const id = await insertShort('published');
    for (const reason of [undefined, '', 'typo', '          ']) {
      const res = await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send({ ...EDIT, reason });
      expect(res.status).toBe(422);
    }
    expect((await videoOf(id))?.title).toBe('Flood waters recede in the Terai');
  });

  it('stamps the time and reason, and keeps its place in the tab', async () => {
    const id = await insertShort('published');
    const reason = 'The caption undercounted the districts.';
    const res = await post(`/api/cms/shorts/${id.toString()}/edit`, reviewerCookie).send({ ...EDIT, reason });
    expect(res.status).toBe(200);
    expect(typeof res.body.lastEditedAt).toBe('string');

    const v = await videoOf(id);
    expect(v?.title).toBe(EDIT.title);
    expect(v?.lastEditReason).toBe(reason);
    expect(v?.lastEditedAt).toBeInstanceOf(Date);
    expect(v?.status).toBe('published');
    expect((v?.publishedAt as Date).toISOString()).toBe(PUBLISHED_AT.toISOString());

    const audit = await collections(getDb()).audit.findOne({ action: 'short.edit' });
    expect((audit?.before as { title: string }).title).toBe('Flood waters recede in the Terai');
    expect((audit?.after as { reason: string }).reason).toBe(reason);
  });

  it('is refused to an author, as publishing is', async () => {
    const id = await insertShort('published');
    const res = await post(`/api/cms/shorts/${id.toString()}/edit`, authorCookie).send({
      ...EDIT,
      reason: 'The caption undercounted the districts.',
    });
    expect(res.status).toBe(403);
  });

  it('shows the edit on the library list', async () => {
    const id = await insertShort('published');
    await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send({
      ...EDIT,
      reason: 'The caption undercounted the districts.',
    });
    const res = await get('/api/cms/shorts', adminCookie);
    const row = (res.body.items as Array<{ id: string; lastEditedAt: string | null }>).find(
      (r) => r.id === id.toString(),
    );
    expect(row?.lastEditedAt).not.toBeNull();
  });
});

describe('a withdrawn short', () => {
  it('is not edited', async () => {
    const id = await insertShort('retracted');
    const res = await post(`/api/cms/shorts/${id.toString()}/edit`, adminCookie).send({
      ...EDIT,
      reason: 'Trying to change a withdrawn short.',
    });
    expect(res.status).toBe(409);
  });
});

describe('withdrawing a short', () => {
  it('needs a reason now, and keeps it', async () => {
    const id = await insertShort('published');
    expect((await post(`/api/cms/shorts/${id.toString()}/retract`, adminCookie).send({})).status).toBe(422);
    expect((await videoOf(id))?.status).toBe('published');

    const res = await post(`/api/cms/shorts/${id.toString()}/retract`, adminCookie).send({
      reason: 'The footage was from a different flood.',
    });
    expect(res.status).toBe(200);
    const v = await videoOf(id);
    expect(v?.status).toBe('retracted');
    expect(v?.retractionReason).toBe('The footage was from a different flood.');
    expect(v?.retractedAt).toBeInstanceOf(Date);
  });

  it('is refused to an author', async () => {
    const id = await insertShort('published');
    const res = await post(`/api/cms/shorts/${id.toString()}/retract`, authorCookie).send({
      reason: 'The footage was from a different flood.',
    });
    expect(res.status).toBe(403);
  });
});

describe('the detail route', () => {
  it('returns what the edit screen needs', async () => {
    const id = await insertShort('published');
    const res = await get(`/api/cms/shorts/${id.toString()}`, authorCookie);
    expect(res.status).toBe(200);
    expect(res.body.short.renditions).toHaveLength(2);
    expect(res.body.short.licence).toBe('publisher_licensed');
    expect(res.body.short.publishedAt).toBe(PUBLISHED_AT.toISOString());
  });

  it('404s an unknown id', async () => {
    const res = await get(`/api/cms/shorts/${new ObjectId().toString()}`, adminCookie);
    expect(res.status).toBe(404);
  });
});
