import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

/**
 * Publisher administration, driven over HTTP.  Spec Ch. 3.5, Ch. 5.7.
 *
 * -- Why this one goes through the app rather than the service ---------------
 *
 * The thing most worth testing here is the PERMISSION WIRING. `source.read`,
 * `source.write` and `source.setLicence` sat in the matrix for months with no
 * route behind them, and the whole point of this feature is that they now have
 * one. A service-level test would exercise the logic and prove nothing about
 * whether an author can quietly create a publisher.
 *
 * -- Why syncIndexes and not only applyValidators ---------------------------
 *
 * `source_slug_unique` is what actually guarantees slug uniqueness; the route's
 * findOne is a friendly pre-check and a race. Without the index the duplicate
 * test passes for the wrong reason — the pre-check catches it — and the code
 * path that matters is never run.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

const app = createCmsApp();

let adminCookie: string;
let reviewerCookie: string;
let authorCookie: string;
let sampleSourceId: ObjectId;
let catId: ObjectId;

async function sessionFor(role: 'author' | 'reviewer' | 'admin'): Promise<string> {
  const token = await createSession({
    _id: new ObjectId(),
    email: `${role}@example.invalid`,
    role,
    languages: ['ne', 'en'],
  });
  return `${SESSION_COOKIE}=${token}`;
}

/** Every state-changing request needs the CSRF header the middleware demands. */
function post(path: string, cookie: string) {
  return request(app).post(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function patch(path: string, cookie: string) {
  return request(app).patch(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function get(path: string, cookie: string) {
  return request(app).get(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}

const NEW_PUBLISHER = {
  slug: 'sample-post',
  displayName: 'Sample Post',
  homepageUrl: 'https://samplepost.example.invalid',
  language: 'en',
  ingest: { method: 'manual', pollIntervalMin: 15 },
  priority: 50,
  isActive: true,
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

  catId = new ObjectId();
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  const c = collections(getDb());
  await Promise.all([c.sources.deleteMany({}), c.articles.deleteMany({}), c.audit.deleteMany({})]);

  sampleSourceId = new ObjectId();
  await c.sources.insertOne({
    _id: sampleSourceId,
    slug: 'namuna-khabar',
    displayName: 'नमुना खबर',
    homepageUrl: 'https://namunakhabar.example.invalid',
    language: 'ne',
    licence: {
      status: 'agreed',
      agreementRef: 'FIXTURE — not a real agreement',
      agreedAt: new Date('2026-09-01T00:00:00Z'),
      contactEmail: 'takedown@namunakhabar.example.invalid',
    },
    ingest: {
      method: 'rss',
      feedUrl: 'https://namunakhabar.example.invalid/feed',
      pollIntervalMin: 15,
      lastPolledAt: new Date('2026-09-19T00:00:00Z'),
      lastSuccessAt: new Date('2026-09-19T00:00:00Z'),
      consecutiveFailures: 3,
    },
    priority: 20,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
});

describe('the permission matrix, actually routed', () => {
  it('lets every role read the list', async () => {
    for (const cookie of [authorCookie, reviewerCookie, adminCookie]) {
      const res = await get('/api/cms/sources', cookie);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    }
  });

  it('refuses creation to anyone but an admin', async () => {
    // `source.write` is admin-only, and until this route existed nothing
    // enforced that anywhere.
    expect((await post('/api/cms/sources', authorCookie).send(NEW_PUBLISHER)).status).toBe(403);
    expect((await post('/api/cms/sources', reviewerCookie).send(NEW_PUBLISHER)).status).toBe(403);
    expect((await post('/api/cms/sources', adminCookie).send(NEW_PUBLISHER)).status).toBe(201);
  });

  it('refuses the licence endpoint to a reviewer', async () => {
    // The single most important row in the matrix: a reviewer may publish, but
    // may not decide what we are licensed to publish.
    const body = { status: 'refused', note: 'They asked us to stop.' };
    expect((await post('/api/cms/sources/namuna-khabar/licence', reviewerCookie).send(body)).status).toBe(403);
    expect((await post('/api/cms/sources/namuna-khabar/licence', authorCookie).send(body)).status).toBe(403);
    expect((await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send(body)).status).toBe(200);
  });

  it('refuses everything to a request with no session', async () => {
    expect((await request(app).get('/api/cms/sources')).status).toBe(401);
  });
});

describe('creating a publisher', () => {
  it('always starts unlicensed, whatever the body asks for', async () => {
    /*
     * The reason `source.write` and `source.setLicence` are two permissions.
     * Someone who may add a publisher must not be able to assert an agreement
     * in the same request.
     */
    const res = await post('/api/cms/sources', adminCookie).send({
      ...NEW_PUBLISHER,
      licence: { status: 'agreed', contactEmail: 'nope@example.invalid' },
    });
    expect(res.status).toBe(201);

    const stored = await collections(getDb()).sources.findOne({ slug: 'sample-post' });
    expect(stored?.licence.status).toBe('pending');
    expect(stored?.licence.contactEmail).toBeNull();
  });

  it('rejects a duplicate slug by name, not with a 500', async () => {
    const res = await post('/api/cms/sources', adminCookie).send({
      ...NEW_PUBLISHER,
      slug: 'namuna-khabar',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.field).toBe('slug');
    expect(res.body.error.message).toContain('namuna-khabar');
  });

  it('enforces the schema rule that an RSS publisher needs a feed', async () => {
    // The rule lives in packages/schemas/src/source.ts and is reached through
    // the route rather than restated in it.
    const res = await post('/api/cms/sources', adminCookie).send({
      ...NEW_PUBLISHER,
      ingest: { method: 'rss', pollIntervalMin: 15 },
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.error.details)).toContain('feedUrl');
  });

  it('refuses a poll interval below the five-minute floor', async () => {
    const res = await post('/api/cms/sources', adminCookie).send({
      ...NEW_PUBLISHER,
      ingest: { method: 'rss', feedUrl: 'https://x.example.invalid/f', pollIntervalMin: 2 },
    });
    expect(res.status).toBe(422);
  });

  it('writes an audit record', async () => {
    await post('/api/cms/sources', adminCookie).send(NEW_PUBLISHER);
    const entry = await collections(getDb()).audit.findOne({ action: 'source.create' });
    expect(entry).not.toBeNull();
    expect((entry as unknown as { after: { slug: string } }).after.slug).toBe('sample-post');
  });
});

describe('editing a publisher', () => {
  it('does not wipe the poller telemetry when only a name changes', async () => {
    /*
     * The single most likely bug in this feature. `$set: { ingest }` replaces
     * the whole sub-document and silently destroys lastPolledAt, lastSuccessAt
     * and consecutiveFailures — invisibly, and only noticeable once something
     * actually polls.
     */
    const res = await patch('/api/cms/sources/namuna-khabar', adminCookie).send({
      displayName: 'नमुना खबर दैनिक',
    });
    expect(res.status).toBe(200);

    const stored = await collections(getDb()).sources.findOne({ slug: 'namuna-khabar' });
    expect(stored?.displayName).toBe('नमुना खबर दैनिक');
    expect(stored?.ingest.consecutiveFailures).toBe(3);
    expect(stored?.ingest.lastPolledAt).toBeInstanceOf(Date);
    expect(stored?.ingest.lastSuccessAt).toBeInstanceOf(Date);
    expect(stored?.ingest.feedUrl).toBe('https://namunakhabar.example.invalid/feed');
  });

  it('keeps the telemetry when the poll interval alone changes', async () => {
    await patch('/api/cms/sources/namuna-khabar', adminCookie).send({
      ingest: { pollIntervalMin: 30 },
    });
    const stored = await collections(getDb()).sources.findOne({ slug: 'namuna-khabar' });
    expect(stored?.ingest.pollIntervalMin).toBe(30);
    expect(stored?.ingest.consecutiveFailures).toBe(3);
    expect(stored?.ingest.feedUrl).toBe('https://namunakhabar.example.invalid/feed');
  });

  it('refuses to change the slug rather than ignoring the attempt', async () => {
    const res = await patch('/api/cms/sources/namuna-khabar', adminCookie).send({
      slug: 'something-else',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('slug');
  });

  it('sends a licence change to its own endpoint', async () => {
    const res = await patch('/api/cms/sources/namuna-khabar', adminCookie).send({
      licence: { status: 'refused' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('licence');
  });
});

describe('the licence gate', () => {
  it('refuses "agreed" with no takedown contact', async () => {
    await collections(getDb()).sources.updateOne(
      { slug: 'namuna-khabar' },
      { $set: { 'licence.status': 'pending', 'licence.contactEmail': null } },
    );

    const res = await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'agreed',
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.error.details)).toContain('contactEmail');
  });

  it('stamps the agreement date when one is not supplied', async () => {
    await collections(getDb()).sources.updateOne(
      { slug: 'namuna-khabar' },
      { $set: { 'licence.status': 'pending', 'licence.agreedAt': null } },
    );

    const res = await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'agreed',
      contactEmail: 'legal@namunakhabar.example.invalid',
    });
    expect(res.status).toBe(200);
    expect(res.body.licence.agreedAt).not.toBeNull();
  });

  it('requires a reason to withdraw a licence, and not to grant one', async () => {
    const without = await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'refused',
    });
    expect(without.status).toBe(422);
    expect(without.body.error.details.field).toBe('note');

    const withNote = await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'refused',
      note: 'They withdrew consent by email on 19 September.',
    });
    expect(withNote.status).toBe(200);
  });

  it('keeps the date we DID hold an agreement after withdrawing it', async () => {
    // Evidence, not tidiness. "When did we last have their permission" is a
    // question somebody asks a year later.
    await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'refused',
      note: 'They withdrew consent by email.',
    });
    const stored = await collections(getDb()).sources.findOne({ slug: 'namuna-khabar' });
    expect(stored?.licence.agreedAt).toBeInstanceOf(Date);
  });

  it('leaves published articles live and reports how many', async () => {
    const c = collections(getDb());
    await c.articles.insertOne({
      _id: new ObjectId(),
      slug: 'a-published-story-abc',
      status: 'published',
      language: 'ne',
      categoryId: catId,
      sourceId: sampleSourceId,
      publishedAt: new Date(),
      headline: 'A published story that must survive a licence withdrawal',
      summary: 'x',
      summaryWordCount: 1,
      summaryCharCount: 1,
      publisherUrl: 'https://namunakhabar.example.invalid/a/1',
      image: null,
      sourceName: 'नमुना खबर',
      categorySlug: 'nepal',
      categoryLabel: { ne: 'नेपाल', en: 'Nepal' },
      authoredBy: new ObjectId(),
      draftSource: 'human',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'refused',
      note: 'They withdrew consent by email.',
    });

    expect(res.status).toBe(200);
    expect(res.body.wasDowngraded).toBe(true);
    expect(res.body.publishedArticles).toBe(1);

    const article = await c.articles.findOne({ slug: 'a-published-story-abc' });
    expect(article?.status).toBe('published');
  });

  it('records the withdrawal, its reason and its blast radius in the audit trail', async () => {
    await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'refused',
      note: 'They withdrew consent by email on 19 September.',
    });

    const entry = (await collections(getDb()).audit.findOne({
      action: 'source.setLicence',
    })) as unknown as {
      before: { licence: { status: string } };
      after: { licence: { status: string }; note: string; publishedArticles: number };
    } | null;

    expect(entry).not.toBeNull();
    expect(entry?.before.licence.status).toBe('agreed');
    expect(entry?.after.licence.status).toBe('refused');
    expect(entry?.after.note).toContain('19 September');
    expect(entry?.after.publishedArticles).toBe(0);
  });

  it('stops new stories being filed once the licence is gone', async () => {
    // The gate that already existed, now reachable from this screen.
    await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'refused',
      note: 'They withdrew consent by email.',
    });

    const res = await post('/api/cms/articles', adminCookie).send({
      language: 'ne',
      categorySlug: 'nepal',
      sourceSlug: 'namuna-khabar',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('what the list reports', () => {
  it('answers the pollable question with the schema predicate', async () => {
    const res = await get('/api/cms/sources', adminCookie);
    const row = res.body.items[0];
    // Licensed, active and RSS — the one combination isPollable accepts.
    expect(row.pollable).toBe(true);

    await post('/api/cms/sources/namuna-khabar/licence', adminCookie).send({
      status: 'pending',
      note: 'The agreement lapsed and is being renegotiated.',
    });

    const after = await get('/api/cms/sources', adminCookie);
    expect(after.body.items[0].pollable).toBe(false);
  });

  it('carries the counts a licence decision needs', async () => {
    const res = await get('/api/cms/sources/namuna-khabar', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.source.articles).toEqual({ published: 0, total: 0 });
  });

  it('does not change the shape GET /cms/options returns', async () => {
    // That endpoint reads the same collection and the composer depends on it.
    const res = await get('/api/cms/options', adminCookie);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.sources[0]).sort()).toEqual([
      'displayName',
      'language',
      'licensed',
      'slug',
    ]);
  });
});
