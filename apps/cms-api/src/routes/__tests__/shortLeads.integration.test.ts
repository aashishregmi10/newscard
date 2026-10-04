import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import sharp from 'sharp';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';
import { cleanYouTubeTitle } from '../../services/shortImport.service.js';

/**
 * Turning a YouTube Short into a short draft, over HTTP.
 *
 * The thumbnail is generated and served from localhost; the AI is not
 * configured, so no caption is drafted and the draft says so. Nothing reaches
 * YouTube or Google. The channel is invented.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createCmsApp();

let cookie: string;
let server: Server;
let thumbUrl: string;
let sourceId: ObjectId;

function post(path: string) {
  return request(app).post(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function get(path: string) {
  return request(app).get(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}

async function seed(licence: Record<string, unknown> = {}): Promise<ObjectId> {
  const c = collections(getDb());
  sourceId = new ObjectId();
  await c.sources.insertOne({
    _id: sourceId,
    slug: 'namuna-tv',
    displayName: 'नमुना टिभी',
    homepageUrl: 'https://www.youtube.com/@namunatv',
    language: 'ne',
    licence: { status: 'agreed', contactEmail: 'legal@namunatv.example.invalid', ...licence },
    ingest: {
      method: 'youtube',
      basis: 'agreement',
      youtubeChannelId: 'UCabcdefghijklmnopqrstuv',
      pollIntervalMin: 15,
    },
    priority: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);

  const id = new ObjectId();
  await getDb().collection('shortLeads').insertOne({
    _id: id,
    sourceId,
    sourceSlug: 'namuna-tv',
    sourceName: 'नमुना टिभी',
    videoId: 'shortAAAAA1',
    channelId: 'UCabcdefghijklmnopqrstuv',
    channelTitle: 'नमुना टिभी',
    title: 'आज कहाँ पर्छ पानी ? || नमुना टिभी #shorts',
    description: 'मौसम पूर्वानुमान महाशाखाका अनुसार आज देशका धेरै भागमा वर्षा हुनेछ। https://example.invalid',
    thumbnailUrl: thumbUrl,
    durationSeconds: 48,
    language: 'ne',
    publishedAt: new Date(),
    fetchedAt: new Date(),
    status: 'new',
    promotedVideoId: null,
    dismissedReason: null,
    purgeAt: new Date(Date.now() + 30 * 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
  cookie = `${SESSION_COOKIE}=${await createSession({ _id: new ObjectId(), email: 'admin@example.invalid' })}`;

  const thumb = await sharp({
    create: { width: 480, height: 360, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(thumb);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  thumbUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hqdefault.jpg`;
  process.env.GEMINI_API_KEY = '';
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await close();
});

beforeEach(async () => {
  const c = collections(getDb());
  await Promise.all([
    c.sources.deleteMany({}),
    c.categories.deleteMany({}),
    c.audit.deleteMany({}),
    getDb().collection('shortLeads').deleteMany({}),
    getDb().collection('videos').deleteMany({}),
  ]);
  await c.categories.insertOne({
    _id: new ObjectId(),
    slug: 'nepal',
    label: { ne: 'नेपाल', en: 'Nepal' },
    order: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
});

describe('the Shorts Incoming list', () => {
  it('lists what is waiting, with counts for the tabs', async () => {
    await seed();
    const res = await get('/api/cms/short-leads?status=new');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ new: 1, promoted: 0, dismissed: 0 });
    expect(res.body.items[0]).toMatchObject({ videoId: 'shortAAAAA1', durationSeconds: 48 });
  });
});

describe('promoting a Short', () => {
  it('makes a short draft that plays from YouTube, credited to the publisher', async () => {
    const id = await seed();
    const res = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    expect(res.status).toBe(201);

    const v = await getDb().collection('videos').findOne({ _id: new ObjectId(res.body.id) });
    expect(v).toMatchObject({
      status: 'draft',
      origin: 'youtube',
      youtubeId: 'shortAAAAA1',
      renditions: [],
      credit: 'नमुना टिभी',
      licence: 'publisher_licensed',
      sourceUrl: 'https://www.youtube.com/shorts/shortAAAAA1',
      posterUrl: thumbUrl,
      title: 'आज कहाँ पर्छ पानी ?',
    });
    // The thumbnail's colour, as every poster carries.
    expect(v?.posterBlurHash).toMatch(/^.{6}$/);

    const lead = await getDb().collection('shortLeads').findOne({ _id: id });
    expect(lead?.status).toBe('promoted');
  });

  it('leaves the caption for the editor, and says why, when the licence does not cover their text', async () => {
    const id = await seed();
    const res = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    const short = (await get(`/api/cms/shorts/${res.body.id}`)).body.short;
    expect(short.caption).toBe('');
    expect(short.captionNote).toMatch(/licence does not cover/);
  });

  it('says why there is no caption when no AI is available', async () => {
    const id = await seed({ fullText: true });
    const res = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    const short = (await get(`/api/cms/shorts/${res.body.id}`)).body.short;
    expect(short.caption).toBe('');
    expect(short.captionNote).toMatch(/GEMINI_API_KEY/);
  });

  it('refuses a publisher with no agreed licence', async () => {
    const id = await seed({ status: 'pending' });
    const res = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    expect(res.status).toBe(422);
  });

  it('refuses to promote the same Short twice', async () => {
    const id = await seed();
    await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    const again = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    expect(again.status).toBe(409);
  });
});

describe('publishing a short from YouTube', () => {
  it('waits for a caption, then publishes', async () => {
    const id = await seed();
    const promoted = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    const shortId = promoted.body.id as string;

    const early = await post(`/api/cms/shorts/${shortId}/publish`).send({});
    expect(early.status).toBe(422);

    const edit = await post(`/api/cms/shorts/${shortId}/edit`).send({
      language: 'ne',
      categorySlug: 'nepal',
      title: 'आज कहाँ पर्छ पानी ?',
      caption: 'देशका धेरै भागमा आज वर्षा हुने पूर्वानुमान छ।',
      credit: 'नमुना टिभी',
      licence: 'publisher_licensed',
    });
    expect(edit.status).toBe(200);
    expect((await get(`/api/cms/shorts/${shortId}`)).body.short.captionNote).toBeNull();

    const res = await post(`/api/cms/shorts/${shortId}/publish`).send({});
    expect(res.status).toBe(200);
  });

  it('will not swap the video of a YouTube short for an upload', async () => {
    const id = await seed();
    const promoted = await post(`/api/cms/short-leads/${id.toString()}/promote`).send({ categorySlug: 'nepal' });
    const res = await post(`/api/cms/shorts/${promoted.body.id}/edit`).send({
      language: 'ne',
      categorySlug: 'nepal',
      title: 'शीर्षक',
      caption: 'क्याप्सन',
      credit: 'नमुना टिभी',
      licence: 'publisher_licensed',
      clip: {
        durationSeconds: 30,
        posterUrl: '/media/v/x/poster.jpg',
        posterBlurHash: '000000',
        renditions: [{ quality: 'low', url: '/media/v/x/360.mp4', width: 360, height: 640, bytes: 1 }],
      },
    });
    expect(res.status).toBe(422);
  });
});

describe('dismissing a Short', () => {
  it('keeps it with the reason, so it is not offered again', async () => {
    const id = await seed();
    const res = await post(`/api/cms/short-leads/${id.toString()}/dismiss`).send({ reason: 'Not news' });
    expect(res.status).toBe(200);
    const lead = await getDb().collection('shortLeads').findOne({ _id: id });
    expect(lead).toMatchObject({ status: 'dismissed', dismissedReason: 'Not news' });
  });
});

describe('cleanYouTubeTitle', () => {
  it('drops the channel name and hashtags the channel adds to every upload', () => {
    expect(cleanYouTubeTitle('आज कहाँ पर्छ पानी ? || Nepal Times #shorts', 'Nepal Times')).toBe(
      'आज कहाँ पर्छ पानी ?',
    );
    expect(cleanYouTubeTitle('Floods in the east | Sample TV', 'Sample TV')).toBe('Floods in the east');
  });

  it('cuts a long title at a word, inside 80', () => {
    const long = 'शब्द '.repeat(40).trim();
    const out = cleanYouTubeTitle(long, 'x');
    expect([...new Intl.Segmenter('ne', { granularity: 'grapheme' }).segment(out)].length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });
});
