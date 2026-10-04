import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import sharp from 'sharp';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { countWords } from '@saar/shared';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

/**
 * Promoting a lead brings the publisher's photo and a drafted summary with it —
 * and only what their licence allows.
 *
 * Driven over HTTP against a real MongoDB, with the publisher's photo served
 * from localhost: generated, not sourced, and nothing reaches the internet.
 * The AI is deliberately NOT configured, so the summary comes from the
 * key-sentence fallback — deterministic, free, and exactly the path the
 * own-words check at publish exists to catch.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createCmsApp();

let cookie: string;
let server: Server;
let origin: string;
let mediaDir: string;
let sourceId: ObjectId;
let categoryId: ObjectId;
let photo: Buffer;
let smallPhoto: Buffer;

const ARTICLE = [
  'नमुना नगरपालिकाले आज नयाँ खानेपानी आयोजनाको काम औपचारिक रूपमा सुरु गरेको छ।',
  'आयोजना दुई वर्षभित्र सम्पन्न हुने र दश हजार घरधुरीले नियमित खानेपानी पाउने नगरपालिकाले जनाएको छ।',
  'आयोजनाको कुल लागत पचास करोड रुपैयाँ रहेको र त्यसमध्ये आधा संघीय सरकारले बेहोर्ने छ।',
  'स्थानीय बासिन्दाले वर्षौंदेखि खानेपानीको अभाव झेल्दै आएको बताएका छन्।',
  'नगर प्रमुखले काम समयमै सक्न निर्माण कम्पनीलाई निर्देशन दिएको जानकारी दिए।',
  'निर्माण कम्पनीले पहिलो चरणमा मुख्य पाइपलाइन बिछ्याउने काम गर्ने जनाएको छ।',
  'आयोजना पूरा भएपछि पानीको गुणस्तर नियमित परीक्षण गरिने नगरपालिकाले बताएको छ।',
].join(' ');

/** Fifty words in our own words, for the publish that should succeed. */
const OWN_WORDS = Array.from(
  { length: 5 },
  () => 'दश हजार घरमा नियमित पानी पुर्‍याउने लक्ष्यसहित आयोजना थालियो।',
).join(' ');

function post(path: string) {
  return request(app).post(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function get(path: string) {
  return request(app).get(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}

async function seed(
  licence: { images?: boolean; fullText?: boolean },
  imagePath = '/photo.jpg',
  leadOver: Record<string, unknown> = {},
) {
  const c = collections(getDb());
  sourceId = new ObjectId();
  await c.sources.insertOne({
    _id: sourceId,
    slug: 'namuna-khabar',
    displayName: 'नमुना खबर',
    homepageUrl: origin,
    language: 'ne',
    licence: { status: 'agreed', contactEmail: 'legal@namuna.example.invalid', ...licence },
    ingest: { method: 'rss', basis: 'agreement', feedUrl: `${origin}/feed`, pollIntervalMin: 15 },
    priority: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);

  const leadId = new ObjectId();
  await c.leads.insertOne({
    _id: leadId,
    sourceId,
    sourceSlug: 'namuna-khabar',
    sourceName: 'नमुना खबर',
    canonicalUrl: `https://namunakhabar.example.invalid/news/${leadId.toString()}`,
    headline: 'नमुना नगरपालिकामा खानेपानी आयोजना सुरु',
    feedExtract: 'नमुना नगरपालिकाले आज नयाँ खानेपानी आयोजनाको काम सुरु गरेको छ।',
    feedContent: ARTICLE,
    feedImageUrl: `${origin}${imagePath}`,
    language: 'ne',
    publishedAt: new Date(),
    fetchedAt: new Date(),
    fingerprint: `fp-${leadId.toString()}`,
    status: 'new',
    promotedArticleId: null,
    dismissedReason: null,
    clusterKey: null,
    purgeAt: new Date(Date.now() + 30 * 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...leadOver,
  } as never);
  return leadId;
}

/** The draft is written in the background; wait for it to settle. */
async function settledDraft(articleId: string) {
  for (let i = 0; i < 50; i++) {
    const a = await collections(getDb()).articles.findOne({ _id: new ObjectId(articleId) });
    const draft = (a as { summaryDraft?: { status: string } } | null)?.summaryDraft;
    if (draft && draft.status !== 'pending') return a as never as Record<string, never>;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('summary draft never settled');
}

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
  cookie = `${SESSION_COOKIE}=${await createSession({ _id: new ObjectId(), email: 'admin@example.invalid' })}`;

  /* A photo big enough for a card, and one that is not. Generated here. */
  photo = await sharp({
    create: { width: 1200, height: 700, channels: 3, background: { r: 40, g: 110, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  smallPhoto = await sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 160, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();

  server = createServer((req, res) => {
    /* The story's own page, for a lead collected without its photo or text. */
    if (req.url === '/story') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><meta property="og:image" content="${origin}/photo.jpg"></head>
        <body><nav><a href="/">गृहपृष्ठ</a></nav><article><h1>शीर्षक</h1>
        <p>${ARTICLE}</p><p>${ARTICLE}</p></article></body></html>`,
      );
      return;
    }
    const body = req.url === '/small.jpg' ? smallPhoto : req.url === '/photo.jpg' ? photo : null;
    if (body === null) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /* Copied photos land here, not in the real media folder. */
  mediaDir = await mkdtemp(join(tmpdir(), 'saar-media-'));
  process.env.MEDIA_ROOT = mediaDir;
  /* No AI: the key-sentence fallback, deterministically. */
  process.env.GEMINI_API_KEY = '';
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(mediaDir, { recursive: true, force: true });
  await close();
});

beforeEach(async () => {
  const c = collections(getDb());
  await Promise.all([
    c.sources.deleteMany({}),
    c.leads.deleteMany({}),
    c.articles.deleteMany({}),
    c.categories.deleteMany({}),
    c.audit.deleteMany({}),
  ]);
  categoryId = new ObjectId();
  await c.categories.insertOne({
    _id: categoryId,
    slug: 'nepal',
    label: { ne: 'नेपाल', en: 'Nepal' },
    order: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
});

describe('promoting with an images and full-text licence', () => {
  it('opens the draft with their photo, credited to them', async () => {
    const leadId = await seed({ images: true, fullText: true });
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    expect(res.status).toBe(201);

    const article = await collections(getDb()).articles.findOne({ _id: new ObjectId(res.body.articleId) });
    expect(article?.image).toMatchObject({ credit: 'नमुना खबर', licence: 'publisher_licensed' });
    expect(article?.image?.urls.md).toBeTruthy();
    expect((article as { photoNote?: string | null }).photoNote).toBeNull();
  });

  it('drafts a summary in the background, and says it is the publisher’s sentences when the AI is absent', async () => {
    const leadId = await seed({ images: true, fullText: true });
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });

    // Returned before the draft was written.
    const now = await get(`/api/cms/articles/${res.body.articleId}/summary-draft`);
    expect(['pending', 'ready']).toContain(now.body.summaryDraft.status);

    const article = await settledDraft(res.body.articleId);
    const draft = (article as { summaryDraft: Record<string, unknown> }).summaryDraft;
    expect(draft).toMatchObject({ status: 'ready', source: 'key_sentences' });
    expect(draft.error).toMatch(/GEMINI_API_KEY/);
    const words = countWords(String(draft.text));
    expect(words).toBeGreaterThanOrEqual(45);
    expect(words).toBeLessThanOrEqual(60);
    // The summary box itself is left for the composer to fill.
    expect((article as { summary: string }).summary).toBe('');
    // Not an AI draft, so not recorded as one.
    expect((article as { draftSource: string }).draftSource).toBe('human');
  });
});

describe('promoting without those terms', () => {
  it('copies no photo, and says why', async () => {
    const leadId = await seed({});
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    const article = await collections(getDb()).articles.findOne({ _id: new ObjectId(res.body.articleId) });
    expect(article?.image).toBeNull();
    expect((article as { photoNote?: string }).photoNote).toMatch(/licence does not cover their photos/);
  });

  it('sends nothing to be summarised, and says why', async () => {
    const leadId = await seed({});
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    const article = await settledDraft(res.body.articleId);
    const draft = (article as { summaryDraft: Record<string, unknown> }).summaryDraft;
    expect(draft).toMatchObject({ status: 'failed', text: null });
    expect(draft.error).toMatch(/licence does not cover using their full article/);
  });

  it('opens the draft without a photo that is too small for a card, with the reason', async () => {
    const leadId = await seed({ images: true }, '/small.jpg');
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    const article = await collections(getDb()).articles.findOne({ _id: new ObjectId(res.body.articleId) });
    expect(article?.image).toBeNull();
    expect((article as { photoNote?: string }).photoNote).toMatch(/640/);
  });

  it('opens the draft without a photo that is not there', async () => {
    const leadId = await seed({ images: true }, '/missing.jpg');
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    expect(res.status).toBe(201);
    const article = await collections(getDb()).articles.findOne({ _id: new ObjectId(res.body.articleId) });
    expect((article as { photoNote?: string }).photoNote).toMatch(/404/);
  });
});

describe('a story collected before the licence terms were on', () => {
  /* No photo and only an excerpt on the lead — what the collector stores for
     a publisher whose switches were off at the time. */
  const STORY = 'https://namunakhabar.example.invalid/story';
  const bare = () => ({ feedImageUrl: null, feedContent: null, canonicalUrl: STORY });

  /* Publisher links are https, as the database requires; this one address is
     answered by the local test server instead of the internet. */
  beforeEach(() => {
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', ((input: string | URL | Request, init?: RequestInit) =>
      real(String(input) === STORY ? `${origin}/story` : input, init)) as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets its photo and full text from its own page at promote', async () => {
    const leadId = await seed({ images: true, fullText: true }, '/photo.jpg', bare());
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    const article = await collections(getDb()).articles.findOne({ _id: new ObjectId(res.body.articleId) });
    expect(article?.image).toMatchObject({ credit: 'नमुना खबर', licence: 'publisher_licensed' });

    const lead = await collections(getDb()).leads.findOne({ _id: leadId });
    expect(lead?.feedImageUrl).toBe(`${origin}/photo.jpg`);
    expect(lead?.feedContent).toContain('खानेपानी आयोजनाको');

    const drafted = await settledDraft(res.body.articleId);
    expect((drafted as { summaryDraft: { status: string } }).summaryDraft.status).toBe('ready');
  });

  it('can be given its photo afterwards, on a draft promoted without one', async () => {
    const leadId = await seed({}, '/photo.jpg', bare());
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    const id = res.body.articleId as string;

    // Not while the licence does not cover photos.
    expect((await post(`/api/cms/articles/${id}/publisher-photo`).send({})).status).toBe(422);

    await collections(getDb()).sources.updateOne({ _id: sourceId }, { $set: { 'licence.images': true } });
    const ok = await post(`/api/cms/articles/${id}/publisher-photo`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.image).toMatchObject({ credit: 'नमुना खबर', licence: 'publisher_licensed' });

    // And never over a picture that is already there.
    expect((await post(`/api/cms/articles/${id}/publisher-photo`).send({})).status).toBe(409);
  });
});

describe('the Incoming list', () => {
  it('puts a story from an undated feed where it belongs, not at the bottom', async () => {
    /* One dated an hour ago, one undated and first seen just now. */
    const older = await seed({}, '/photo.jpg', {
      publishedAt: new Date(Date.now() - 3600e3),
      fetchedAt: new Date(Date.now() - 3600e3),
    });
    const undated = new ObjectId();
    await collections(getDb()).leads.insertOne({
      ...(await collections(getDb()).leads.findOne({ _id: older })),
      _id: undated,
      canonicalUrl: 'https://namunakhabar.example.invalid/news/undated',
      fingerprint: 'fp-undated',
      publishedAt: null,
      fetchedAt: new Date(),
    } as never);

    const res = await get('/api/cms/leads?status=new');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      undated.toString(),
      older.toString(),
    ]);
  });
});

describe('Regenerate', () => {
  it('asks for a fresh draft without touching the summary box', async () => {
    const leadId = await seed({ fullText: true });
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    await settledDraft(res.body.articleId);

    const again = await post(`/api/cms/articles/${res.body.articleId}/summary-draft`).send({});
    expect(again.status).toBe(202);
    const article = await settledDraft(res.body.articleId);
    expect((article as { summaryDraft: { status: string } }).summaryDraft.status).toBe('ready');
  });

  it('refuses a story with no original to draft from', async () => {
    const leadId = await seed({ fullText: true });
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    await collections(getDb()).leads.deleteMany({});
    const again = await post(`/api/cms/articles/${res.body.articleId}/summary-draft`).send({});
    expect(again.status).toBe(422);
  });
});

describe('the own-words check at publish', () => {
  async function approvedWithSummary(summary: string): Promise<string> {
    const leadId = await seed({ fullText: true });
    const res = await post(`/api/cms/leads/${leadId.toString()}/promote`).send({ categorySlug: 'nepal' });
    await settledDraft(res.body.articleId);
    await collections(getDb()).articles.updateOne(
      { _id: new ObjectId(res.body.articleId) },
      {
        $set: {
          status: 'approved',
          summary,
          summaryWordCount: countWords(summary),
          headline: 'नमुना नगरपालिकामा खानेपानी आयोजना सुरु',
        },
      },
    );
    return res.body.articleId as string;
  }

  it('refuses a summary that is mostly the publisher’s own sentences', async () => {
    const article = await settledDraft(
      (await post(`/api/cms/leads/${(await seed({ fullText: true })).toString()}/promote`).send({
        categorySlug: 'nepal',
      })).body.articleId,
    );
    const copied = String((article as { summaryDraft: { text: string } }).summaryDraft.text);
    await collections(getDb()).articles.deleteMany({});
    await collections(getDb()).leads.deleteMany({});
    await collections(getDb()).sources.deleteMany({});

    const id = await approvedWithSummary(copied);
    const res = await post(`/api/cms/articles/${id}/publish`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error?.message ?? res.text).toMatch(/own words/);
  });

  it('publishes the same story once it is in our own words', async () => {
    const id = await approvedWithSummary(OWN_WORDS);
    const res = await post(`/api/cms/articles/${id}/publish`).send({});
    expect(res.status).toBe(200);
  });
});
