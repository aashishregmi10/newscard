import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { connect, close, getDb } from '@saar/db';
import { createApp } from '../../app.js';

/**
 * YouTube shorts reach only an app that can play them.
 *
 * An app built before them plays our own renditions and nothing else; a
 * YouTube short has none, so sending it one would show a poster that never
 * plays. The new app asks with `youtube=1`. Invented records, local database.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createApp();

function short(over: Record<string, unknown>) {
  return {
    _id: new ObjectId(),
    slug: `short-${new ObjectId().toString()}`,
    status: 'published',
    language: 'ne',
    categoryId: new ObjectId(),
    sourceId: new ObjectId(),
    publishedAt: new Date(),
    title: 'शीर्षक',
    caption: 'क्याप्सन',
    durationSeconds: 40,
    posterUrl: '/media/v/x/poster.jpg',
    posterBlurHash: '000000',
    renditions: [{ quality: 'low', url: '/media/v/x/360.mp4', width: 360, height: 640, bytes: 1 }],
    credit: 'नमुना',
    licence: 'publisher_licensed',
    sourceName: 'नमुना',
    categorySlug: 'nepal',
    categoryLabel: { ne: 'नेपाल', en: 'Nepal' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeAll(async () => {
  await connect({ uri: URI });
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  const videos = getDb().collection('videos');
  await videos.deleteMany({});
  await videos.insertMany([
    short({ title: 'अपलोड गरिएको' }),
    short({
      title: 'युट्युबबाट',
      origin: 'youtube',
      youtubeId: 'shortAAAAA1',
      renditions: [],
      posterUrl: 'https://i.ytimg.com/vi/shortAAAAA1/hqdefault.jpg',
    }),
  ]);
});

describe('GET /v1/videos', () => {
  it('sends an older app only the shorts it can play', async () => {
    const res = await request(app).get('/v1/videos?lang=ne');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(['अपलोड गरिएको']);
    expect(res.body.items[0].youtubeId).toBeNull();
  });

  it('sends YouTube shorts, with their id, to an app that asks', async () => {
    const res = await request(app).get('/v1/videos?lang=ne&youtube=1');
    const yt = res.body.items.find((i: { youtubeId: string | null }) => i.youtubeId !== null);
    expect(res.body.items).toHaveLength(2);
    expect(yt).toMatchObject({ youtubeId: 'shortAAAAA1', renditions: [] });
  });
});
