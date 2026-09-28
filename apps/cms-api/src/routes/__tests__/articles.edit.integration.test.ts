import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

/**
 * Correcting and withdrawing a live story, driven over HTTP.
 *
 * -- The regression this file exists for ------------------------------------
 *
 * The first attempt at "edit a published story" withdrew it and inserted a
 * copy as a new draft. The copy carried the same `publisherUrl`, which
 * `publisher_url_unique` refuses — so the insert failed AFTER the withdrawal
 * had succeeded, and two live stories were pulled with nothing to replace
 * them. The editor saw an error, looked at the list, and reasonably concluded
 * that withdrawing was broken.
 *
 * `syncIndexes` below is therefore not optional: without the unique index that
 * bug cannot be reproduced, and a test that cannot fail the way production
 * failed is not guarding anything.
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
function patch(path: string, cookie: string) {
  return request(app).patch(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function get(path: string, cookie: string) {
  return request(app).get(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}

/** Inside the default 45–60 word band. */
function words(n: number, word = 'relief'): string {
  return Array.from({ length: n }, () => word).join(' ');
}

const PUBLISHED_AT = new Date('2026-09-20T06:00:00Z');

async function insertArticle(status: 'published' | 'retracted' | 'draft'): Promise<ObjectId> {
  const _id = new ObjectId();
  await collections(getDb()).articles.insertOne({
    _id,
    slug: `story-${_id.toString()}`,
    status,
    language: 'en',
    categoryId: new ObjectId(),
    sourceId,
    publishedAt: status === 'draft' ? null : PUBLISHED_AT,
    headline: 'First tranche of flood relief fund released',
    summary: words(50),
    summaryWordCount: 50,
    summaryCharCount: 50 * 7,
    pullQuote: null,
    publisherUrl: `https://samplepost.example.invalid/${_id.toString()}`,
    publisherAuthor: null,
    publisherPublishedAt: null,
    tags: [],
    clusterId: null,
    originatingAgency: null,
    image: null,
    sourceName: 'Sample Post',
    sourceLogoUrl: null,
    categorySlug: 'nepal',
    categoryLabel: { ne: 'नेपाल', en: 'Nepal' },
    authoredBy: new ObjectId(),
    reviewedBy: null,
    selfApproved: false,
    draftSource: 'human',
    revisionCount: 0,
    possibleDuplicate: false,
    possibleLanguageMismatch: false,
    ...(status === 'retracted'
      ? { retractedAt: new Date('2026-09-21T00:00:00Z'), retractionReason: 'Wrong district named.' }
      : {}),
    createdAt: new Date('2026-09-19T00:00:00Z'),
    updatedAt: new Date('2026-09-20T06:00:00Z'),
  } as never);
  return _id;
}

const GOOD_EDIT = {
  headline: 'First tranche of flood relief fund released to districts',
  summary: words(52, 'corrected'),
  reason: 'The headline did not say where the money went.',
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
  await Promise.all([c.sources.deleteMany({}), c.articles.deleteMany({}), c.audit.deleteMany({})]);

  sourceId = new ObjectId();
  await c.sources.insertOne({
    _id: sourceId,
    slug: 'sample-post',
    displayName: 'Sample Post',
    homepageUrl: 'https://samplepost.example.invalid',
    language: 'en',
    licence: {
      status: 'agreed',
      agreementRef: 'FIXTURE — not a real agreement',
      agreedAt: new Date('2026-09-01T00:00:00Z'),
      contactEmail: 'takedown@samplepost.example.invalid',
    },
    ingest: { method: 'manual', pollIntervalMin: 15 },
    priority: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
});

describe('editing a live story', () => {
  it('saves the change, stamps the time and keeps the reason', async () => {
    const id = await insertArticle('published');
    const before = Date.now();

    const res = await post(`/api/cms/articles/${id.toString()}/edit`, reviewerCookie).send(GOOD_EDIT);
    expect(res.status).toBe(200);
    expect(typeof res.body.lastEditedAt).toBe('string');

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    expect(doc?.headline).toBe(GOOD_EDIT.headline);
    expect(doc?.summary).toBe(GOOD_EDIT.summary);
    expect(doc?.summaryWordCount).toBe(52);
    expect(doc?.lastEditReason).toBe(GOOD_EDIT.reason);
    expect(doc?.lastEditedAt).toBeInstanceOf(Date);
    expect(doc!.lastEditedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('leaves it live, and where it was in the feed', async () => {
    /* publishedAt is half of the feed cursor. Moving it would put a days-old
       story at the top of every reader feed. */
    const id = await insertArticle('published');
    await post(`/api/cms/articles/${id.toString()}/edit`, adminCookie).send(GOOD_EDIT);

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    expect(doc?.status).toBe('published');
    expect(doc?.publishedAt?.toISOString()).toBe(PUBLISHED_AT.toISOString());
  });

  it('writes the whole before and after to the audit trail', async () => {
    const id = await insertArticle('published');
    await post(`/api/cms/articles/${id.toString()}/edit`, adminCookie).send(GOOD_EDIT);

    const row = await collections(getDb()).audit.findOne({ action: 'article.edit' });
    expect(row).not.toBeNull();
    expect(row?.entityId).toBe(id.toString());
    expect((row?.before as { headline: string }).headline).toBe(
      'First tranche of flood relief fund released',
    );
    expect((row?.after as { headline: string; reason: string }).headline).toBe(GOOD_EDIT.headline);
    expect((row?.after as { reason: string }).reason).toBe(GOOD_EDIT.reason);
  });

  it('refuses without a reason, and changes nothing', async () => {
    const id = await insertArticle('published');
    for (const reason of [undefined, '', 'typo', '         ']) {
      const res = await post(`/api/cms/articles/${id.toString()}/edit`, adminCookie).send({
        ...GOOD_EDIT,
        reason,
      });
      expect(res.status).toBe(422);
    }
    const doc = await collections(getDb()).articles.findOne({ _id: id });
    expect(doc?.headline).toBe('First tranche of flood relief fund released');
    expect(doc?.lastEditedAt ?? null).toBeNull();
  });

  it('runs the publish rules again on the new text', async () => {
    /* Otherwise this would be the one way to publish a two-word summary. */
    const id = await insertArticle('published');
    const short = await post(`/api/cms/articles/${id.toString()}/edit`, adminCookie).send({
      ...GOOD_EDIT,
      summary: words(12),
    });
    expect(short.status).toBe(422);

    const tinyHeadline = await post(`/api/cms/articles/${id.toString()}/edit`, adminCookie).send({
      ...GOOD_EDIT,
      headline: 'Relief',
    });
    expect(tinyHeadline.status).toBe(422);
  });

  it('is refused to an author, as publishing is', async () => {
    const id = await insertArticle('published');
    const res = await post(`/api/cms/articles/${id.toString()}/edit`, authorCookie).send(GOOD_EDIT);
    expect(res.status).toBe(403);
  });

  it('refuses a withdrawn story and a draft', async () => {
    const withdrawn = await insertArticle('retracted');
    const draft = await insertArticle('draft');
    expect(
      (await post(`/api/cms/articles/${withdrawn.toString()}/edit`, adminCookie).send(GOOD_EDIT)).status,
    ).toBe(409);
    expect(
      (await post(`/api/cms/articles/${draft.toString()}/edit`, adminCookie).send(GOOD_EDIT)).status,
    ).toBe(409);
  });

  it('is still refused by the autosave route, which records nothing', async () => {
    const id = await insertArticle('published');
    const res = await patch(`/api/cms/articles/${id.toString()}`, adminCookie).send({
      headline: GOOD_EDIT.headline,
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error?.message)).toMatch(/edit screen/);
  });

  it('shows up on the published list', async () => {
    const id = await insertArticle('published');
    await post(`/api/cms/articles/${id.toString()}/edit`, adminCookie).send(GOOD_EDIT);

    const res = await get('/api/cms/published', adminCookie);
    expect(res.status).toBe(200);
    const row = (res.body.items as Array<{ id: string; lastEditedAt: string | null; lastEditReason: string | null }>).find(
      (r) => r.id === id.toString(),
    );
    expect(row?.lastEditedAt).not.toBeNull();
    expect(row?.lastEditReason).toBe(GOOD_EDIT.reason);
  });
});

describe('withdrawing a live story', () => {
  it('withdraws it, keeps the reason, and moves it to the withdrawn list', async () => {
    const id = await insertArticle('published');
    const res = await post(`/api/cms/articles/${id.toString()}/retract`, adminCookie).send({
      reason: 'The figures were from last year.',
    });
    expect(res.status).toBe(200);

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    expect(doc?.status).toBe('retracted');
    expect(doc?.retractionReason).toBe('The figures were from last year.');

    const list = await get('/api/cms/published?status=retracted', adminCookie);
    expect(list.body.counts).toEqual({ published: 0, retracted: 1 });
    expect(list.body.items[0].id).toBe(id.toString());
  });

  it('no longer offers the withdraw-and-copy route that pulled stories and failed', async () => {
    /* The regression itself. The route is gone; this asserts it stays gone,
       and that calling where it was does not touch the story. */
    const id = await insertArticle('published');
    const res = await post(`/api/cms/articles/${id.toString()}/correct`, adminCookie).send({
      reason: 'The figures were from last year.',
    });
    expect(res.status).toBe(404);

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    expect(doc?.status).toBe('published');
  });
});
