import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { pollDueSources, lastYouTubeReports } from '../ingest/pollSources.js';
import {
  channelQuery,
  learnBoilerplate,
  parseIsoDuration,
  screenVideo,
  stripBoilerplate,
  uploadsPlaylistId,
  type YouTubeVideo,
} from '../ingest/youtube.js';

/**
 * Collecting Shorts from a YouTube channel.
 *
 * Google is never called: a stand-in fetch answers as the YouTube Data API and
 * the oEmbed endpoint do, so this runs offline, spends no quota, and can serve
 * exactly the awkward cases — a long video, one whose owner forbids embedding,
 * one that is wide rather than tall. The channel and its videos are invented.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const CHANNEL = 'UCabcdefghijklmnopqrstuv';
const KEY = 'test-key-not-real';
/** What a channel pastes under every upload — invented, shaped like the real thing. */
const BOILERPLATE = [
  'नमुना टिभीमा प्रसारित सामग्रीबारे गुनासो भए हामीलाई लेख्नुहोस्।',
  'च्यानल सब्स्क्राइब गर्न नभुल्नुहोला।',
  'Contact: news@namunatv.example.invalid',
  'https://namunatv.example.invalid',
  '#NamunaTV #NepaliNews #शीर्षक',
].join('\n');
const NOW = new Date('2026-10-04T06:00:00Z');

interface FakeVideo {
  id: string;
  title: string;
  seconds: number;
  embeddable?: boolean;
  wide?: boolean;
  daysOld?: number;
}

let catalogue: FakeVideo[];
let calls: string[];

const fakeFetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  calls.push(url.pathname);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url.pathname.endsWith('/playlistItems')) {
    expect(url.searchParams.get('playlistId')).toBe(uploadsPlaylistId(CHANNEL));
    expect(url.searchParams.get('key')).toBe(KEY);
    return json({ items: catalogue.map((v) => ({ contentDetails: { videoId: v.id } })) });
  }
  if (url.pathname.endsWith('/videos')) {
    const ids = (url.searchParams.get('id') ?? '').split(',');
    return json({
      items: catalogue
        .filter((v) => ids.includes(v.id))
        .map((v) => ({
          id: v.id,
          snippet: {
            title: v.title,
            description: `${v.title} बारे छोटो विवरण।\n${BOILERPLATE}`,
            channelId: CHANNEL,
            channelTitle: 'नमुना टिभी',
            publishedAt: new Date(NOW.getTime() - (v.daysOld ?? 0) * 86_400_000).toISOString(),
            thumbnails: { high: { url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` } },
          },
          contentDetails: { duration: `PT${Math.floor(v.seconds / 60)}M${v.seconds % 60}S` },
          status: { embeddable: v.embeddable ?? true, privacyStatus: 'public' },
        })),
    });
  }
  if (url.pathname === '/oembed') {
    const id = /shorts%2F([^&]+)|shorts\/([^&]+)/.exec(url.search)?.slice(1).find(Boolean) ?? '';
    const v = catalogue.find((x) => x.id === decodeURIComponent(id));
    if (!v) return json({}, 404);
    return json(v.wide ? { width: 200, height: 113 } : { width: 113, height: 200 });
  }
  return json({}, 404);
}) as unknown as typeof fetch;

async function seedChannel(over: Record<string, unknown> = {}) {
  const c = collections(getDb());
  await c.sources.deleteMany({});
  await c.sources.insertOne({
    _id: new ObjectId(),
    slug: 'namuna-tv',
    displayName: 'नमुना टिभी',
    homepageUrl: 'https://www.youtube.com/@namunatv',
    language: 'ne',
    licence: { status: 'agreed', contactEmail: 'legal@namunatv.example.invalid' },
    ingest: {
      method: 'youtube',
      basis: 'agreement',
      youtubeChannelId: CHANNEL,
      pollIntervalMin: 15,
      consecutiveFailures: 0,
    },
    priority: 50,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as never);
}

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  calls = [];
  catalogue = [
    { id: 'shortAAAAA1', title: 'आज कहाँ पर्छ पानी ? || नमुना टिभी', seconds: 48 },
    { id: 'longBBBBBB2', title: 'पूरा कार्यक्रम', seconds: 1800 },
    { id: 'privCCCCCC3', title: 'इम्बेड नहुने', seconds: 40, embeddable: false },
    { id: 'wideDDDDDD4', title: 'तेर्सो भिडियो', seconds: 60, wide: true },
    { id: 'oldEEEEEEE5', title: 'पुरानो छोटो भिडियो', seconds: 30, daysOld: 20 },
  ];
  await getDb().collection('shortLeads').deleteMany({});
  await seedChannel();
});

describe('reading a channel', () => {
  it('offers only the vertical, embeddable videos of ninety seconds or less', async () => {
    await pollDueSources(NOW, { youtubeKey: KEY, fetchImpl: fakeFetch });
    const leads = await getDb().collection('shortLeads').find({}).toArray();
    expect(leads.map((l) => l.videoId)).toEqual(['shortAAAAA1']);
    expect(leads[0]).toMatchObject({
      status: 'new',
      durationSeconds: 48,
      language: 'ne',
      channelTitle: 'नमुना टिभी',
      thumbnailUrl: 'https://i.ytimg.com/vi/shortAAAAA1/hqdefault.jpg',
    });
    expect(lastYouTubeReports[0]?.rejected).toEqual({
      too_long: 1,
      not_embeddable: 1,
      not_vertical: 1,
      too_old: 1,
    });
  });

  it('asks about a video once, however often the channel is read', async () => {
    await pollDueSources(NOW, { youtubeKey: KEY, fetchImpl: fakeFetch });
    await collections(getDb()).sources.updateOne({}, { $set: { 'ingest.lastPolledAt': new Date(0) } });
    calls = [];
    await pollDueSources(NOW, { youtubeKey: KEY, fetchImpl: fakeFetch });
    // The Short is already known and is not looked up again; only the
    // rejected ones are re-checked, and nothing new is inserted.
    expect(await getDb().collection('shortLeads').countDocuments({})).toBe(1);
    expect(lastYouTubeReports[0]?.known).toBe(1);
  });

  it('skips channels, without failing them, when there is no API key', async () => {
    await pollDueSources(NOW, { youtubeKey: '', fetchImpl: fakeFetch });
    expect(calls).toHaveLength(0);
    const source = await collections(getDb()).sources.findOne({});
    expect(source?.ingest.consecutiveFailures).toBe(0);
  });

  it('counts a refused request against the channel, like a broken feed', async () => {
    const refusing = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await pollDueSources(NOW, { youtubeKey: KEY, fetchImpl: refusing });
    expect(lastYouTubeReports[0]?.error).toMatch(/YOUTUBE_API_KEY/);
    const source = await collections(getDb()).sources.findOne({});
    expect(source?.ingest.consecutiveFailures).toBe(1);
  });

  it('does not read a channel whose publisher is unlicensed and needs an agreement', async () => {
    await seedChannel({ licence: { status: 'pending' } });
    await pollDueSources(NOW, { youtubeKey: KEY, fetchImpl: fakeFetch });
    expect(calls).toHaveLength(0);
  });
});

describe('channel boilerplate', () => {
  it('is learned from the batch and stripped, leaving what describes the clip', async () => {
    /* Ids no earlier test has seen: the collector remembers the ones it
       turned down, and would not look them up again. */
    catalogue = [
      { id: 'bpShortAAA1', title: 'पहिलो छोटो समाचार', seconds: 40 },
      { id: 'bpShortBBB2', title: 'दोस्रो छोटो समाचार', seconds: 50 },
      { id: 'bpLongCCCC3', title: 'लामो कार्यक्रम', seconds: 900 },
    ];
    await pollDueSources(NOW, { youtubeKey: KEY, fetchImpl: fakeFetch });
    const lead = await getDb().collection('shortLeads').findOne({ videoId: 'bpShortAAA1' });
    expect(lead?.description).toBe('पहिलो छोटो समाचार बारे छोटो विवरण।');

    const source = await collections(getDb()).sources.findOne({});
    expect((source?.ingest as { youtubeBoilerplate?: string[] }).youtubeBoilerplate).toContain(
      'च्यानल सब्स्क्राइब गर्न नभुल्नुहोला।',
    );
  });

  it('needs three examples before it decides a line is boilerplate', () => {
    expect(learnBoilerplate(['a\nshared', 'b\nshared'])).toEqual([]);
    expect(learnBoilerplate(['a\nshared', 'b\nshared', 'c\nshared'])).toEqual(['shared']);
  });

  it('keeps what it learned before when a poll brings one new video', () => {
    expect(learnBoilerplate(['only one'], ['shared'])).toEqual(['shared']);
  });

  it('drops links and hashtag-only lines even before anything is learned', () => {
    expect(stripBoilerplate('खबर।\nhttps://x.example.invalid\n#a #b', [])).toBe('खबर।');
  });

  it('leaves a description with nothing of the channel’s alone', () => {
    expect(stripBoilerplate('पहिलो पङ्क्ति।\nदोस्रो पङ्क्ति।', ['अर्को'])).toBe(
      'पहिलो पङ्क्ति।\nदोस्रो पङ्क्ति।',
    );
  });
});

describe('parseIsoDuration', () => {
  it('reads the forms the API writes', () => {
    expect(parseIsoDuration('PT48S')).toBe(48);
    expect(parseIsoDuration('PT1M5S')).toBe(65);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('nonsense')).toBe(0);
  });
});

describe('channelQuery', () => {
  it('accepts what an editor is likely to paste', () => {
    expect(channelQuery('@nepaltimesnews')).toEqual({ handle: '@nepaltimesnews' });
    expect(channelQuery('https://www.youtube.com/@nepaltimesnews/shorts')).toEqual({
      handle: '@nepaltimesnews',
    });
    expect(channelQuery(CHANNEL)).toEqual({ id: CHANNEL });
    expect(channelQuery(`youtube.com/channel/${CHANNEL}`)).toEqual({ id: CHANNEL });
  });

  it('refuses what is not a YouTube channel', () => {
    expect(channelQuery('https://example.invalid/@someone')).toBeNull();
    expect(channelQuery('just words')).toBeNull();
  });
});

describe('screenVideo', () => {
  const base: YouTubeVideo = {
    videoId: 'shortAAAAA1',
    channelId: CHANNEL,
    channelTitle: 'x',
    title: 'शीर्षक',
    description: '',
    publishedAt: NOW,
    durationSeconds: 90,
    embeddable: true,
    thumbnailUrl: null,
  };

  it('takes exactly ninety seconds, and not one more', () => {
    expect(screenVideo(base, NOW)).toBeNull();
    expect(screenVideo({ ...base, durationSeconds: 91 }, NOW)).toBe('too_long');
  });

  it('refuses a video with no title', () => {
    expect(screenVideo({ ...base, title: '' }, NOW)).toBe('no_title');
  });
});
