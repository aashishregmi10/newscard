import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ObjectId } from 'mongodb';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { pollDueSources, AUTO_PAUSE_AFTER_FAILURES } from '../ingest/pollSources.js';

/**
 * The collector, end to end.
 *
 * Runs against a real MongoDB and a real HTTP server, because the things worth
 * proving here are exactly the ones a mock would assert away: that the unique
 * index is what stops a duplicate, that a failing publisher pauses itself, and
 * that an unlicensed source is not polled.
 *
 * The feed is served from localhost. Pointing a test at a real publisher's
 * server would be discourteous, non-deterministic, and would fail in CI.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

let server: Server;
let feedUrl: string;
/** Swapped per test to control what the publisher "serves". */
let respond: (req: unknown) => { status: number; body: string; headers?: Record<string, string> };

function rss(items: Array<{ title: string; link: string; date?: string }>): string {
  const entries = items
    .map(
      (i) => `<item>
        <title>${i.title}</title>
        <link>${i.link}</link>
        <description>Some extract from the publisher.</description>
        <pubDate>${i.date ?? new Date().toUTCString()}</pubDate>
      </item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>नमुना खबर</title>${entries}</channel></rss>`;
}

const STORIES = [
  { title: 'वर्षापछि सडक मर्मतको काम तीव्र', link: 'http://127.0.0.1/news/1' },
  { title: 'नयाँ शैक्षिक सत्रको तयारी सुरु', link: 'http://127.0.0.1/news/2' },
  { title: 'बिहानी बजारमा चहलपहल बढ्यो', link: 'http://127.0.0.1/news/3' },
];

let sourceId: ObjectId;

async function seedSource(over: Record<string, unknown> = {}): Promise<void> {
  const c = collections(getDb());
  await c.sources.deleteMany({});
  sourceId = new ObjectId();
  await c.sources.insertOne({
    _id: sourceId,
    slug: 'namuna-khabar',
    displayName: 'नमुना खबर',
    homepageUrl: `http://127.0.0.1`,
    language: 'ne',
    licence: { status: 'pending' },
    ingest: {
      method: 'rss',
      // The whole point of the second gate: no agreement, public feed only.
      basis: 'public_feed',
      feedUrl,
      pollIntervalMin: 5,
      consecutiveFailures: 0,
    },
    priority: 20,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as never);
}

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());

  server = createServer((req, res) => {
    const out = respond(req);
    res.writeHead(out.status, { 'Content-Type': 'application/rss+xml', ...(out.headers ?? {}) });
    res.end(out.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  feedUrl = `http://127.0.0.1:${port}/feed.xml`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await close();
});

beforeEach(async () => {
  respond = () => ({ status: 200, body: rss(STORIES) });
  await collections(getDb()).leads.deleteMany({});
  await seedSource();
});

describe('the collector', () => {
  it('collects a publisher feed into leads', async () => {
    const [report] = await pollDueSources();

    expect(report?.fetched).toBe(3);
    expect(report?.inserted).toBe(3);
    expect(report?.error).toBeNull();

    const leads = await collections(getDb()).leads.find({}).toArray();
    expect(leads).toHaveLength(3);
    expect(leads[0]?.status).toBe('new');
    expect(leads[0]?.sourceSlug).toBe('namuna-khabar');
    expect(leads[0]?.language).toBe('ne');
  });

  it('polls a publisher we have no agreement with, on the strength of a public feed', async () => {
    /*
     * The change that unblocked all of this. The source above is `pending` —
     * Gate 1 is still open — and it is polled anyway because `basis` is
     * `public_feed`. A lead is a reference, not content.
     */
    const source = await collections(getDb()).sources.findOne({ slug: 'namuna-khabar' });
    expect(source?.licence.status).toBe('pending');

    const [report] = await pollDueSources();
    expect(report?.inserted).toBe(3);
  });

  it('does not poll a source whose basis is an agreement it does not have', async () => {
    // The default basis. A source that predates this field behaves as before.
    await seedSource({
      ingest: { method: 'rss', basis: 'agreement', feedUrl, pollIntervalMin: 5, consecutiveFailures: 0 },
    });
    expect(await pollDueSources()).toHaveLength(0);
  });

  it('offers the same story once, however often it is fetched', async () => {
    /*
     * A feed carries the same twenty stories every fifteen minutes. The unique
     * index is what decides this, not a read-then-write, so two overlapping
     * runs cannot both pass the check.
     */
    await pollDueSources();
    await collections(getDb()).sources.updateOne(
      { _id: sourceId },
      { $set: { 'ingest.lastPolledAt': new Date(Date.now() - 60 * 60 * 1000) } },
    );

    const [second] = await pollDueSources();
    expect(second?.inserted).toBe(0);
    expect(second?.duplicates).toBe(3);
    expect(await collections(getDb()).leads.countDocuments({})).toBe(3);
  });

  it('adds only what is new when the feed moves on', async () => {
    await pollDueSources();
    respond = () => ({
      status: 200,
      body: rss([...STORIES, { title: 'चौथो समाचार शीर्षक यहाँ', link: 'http://127.0.0.1/news/4' }]),
    });
    await collections(getDb()).sources.updateOne(
      { _id: sourceId },
      { $set: { 'ingest.lastPolledAt': new Date(Date.now() - 60 * 60 * 1000) } },
    );

    const [second] = await pollDueSources();
    expect(second?.inserted).toBe(1);
    expect(second?.duplicates).toBe(3);
  });

  it('respects the poll interval instead of fetching on every tick', async () => {
    await pollDueSources();
    // Immediately again: nothing is due.
    expect(await pollDueSources()).toHaveLength(0);
  });

  it('honours a 304 and stops re-reading a feed that has not changed', async () => {
    respond = () => ({ status: 304, body: '' });
    await collections(getDb()).sources.updateOne(
      { _id: sourceId },
      { $set: { 'ingest.etag': '"abc"' } },
    );

    const [report] = await pollDueSources();
    expect(report?.notModified).toBe(true);
    expect(report?.inserted).toBe(0);

    const source = await collections(getDb()).sources.findOne({ _id: sourceId });
    expect(source?.ingest.consecutiveFailures).toBe(0);
    expect(source?.ingest.lastSuccessAt).toBeInstanceOf(Date);
  });
});

describe('when a publisher misbehaves', () => {
  async function pollAgain(): Promise<void> {
    await collections(getDb()).sources.updateOne(
      { _id: sourceId },
      { $set: { 'ingest.lastPolledAt': new Date(Date.now() - 60 * 60 * 1000) } },
    );
    await pollDueSources();
  }

  it('counts failures and pauses the source at the documented threshold', async () => {
    /*
     * The auto-pause has been in the schema comment since the beginning —
     * "At 5 the source auto-pauses and editorial is alerted" — and was never
     * implemented. A feed broken for a day should stop being requested.
     */
    respond = () => ({ status: 500, body: 'upstream exploded' });

    for (let i = 0; i < AUTO_PAUSE_AFTER_FAILURES; i += 1) {
      await pollAgain();
    }

    const source = await collections(getDb()).sources.findOne({ _id: sourceId });
    expect(source?.ingest.consecutiveFailures).toBe(AUTO_PAUSE_AFTER_FAILURES);

    // Paused: no longer selected, even though it is otherwise due.
    await collections(getDb()).sources.updateOne(
      { _id: sourceId },
      { $set: { 'ingest.lastPolledAt': new Date(Date.now() - 60 * 60 * 1000) } },
    );
    expect(await pollDueSources()).toHaveLength(0);
  });

  it('clears the failure count on the next success', async () => {
    respond = () => ({ status: 500, body: '' });
    await pollAgain();
    expect(
      (await collections(getDb()).sources.findOne({ _id: sourceId }))?.ingest.consecutiveFailures,
    ).toBe(1);

    respond = () => ({ status: 200, body: rss(STORIES) });
    await pollAgain();
    expect(
      (await collections(getDb()).sources.findOne({ _id: sourceId }))?.ingest.consecutiveFailures,
    ).toBe(0);
  });

  it('names an HTML error page as the failure it is', async () => {
    // Serving the 404 page with a 200 status is common. Without naming it, the
    // parse returns zero items and the source looks quiet rather than broken.
    respond = () => ({ status: 200, body: '<!DOCTYPE html><html><body>Not found</body></html>' });
    const [report] = await pollDueSources();
    expect(report?.error).toContain('not_xml');
    expect(report?.inserted).toBe(0);
  });

  it('stamps lastPolledAt even when the fetch fails', async () => {
    // Otherwise a source that always fails looks un-polled and is hammered on
    // every single tick.
    respond = () => ({ status: 503, body: '' });
    await pollDueSources();
    const source = await collections(getDb()).sources.findOne({ _id: sourceId });
    expect(source?.ingest.lastPolledAt).toBeInstanceOf(Date);
  });

  it('keeps going for the other publishers when one fails', async () => {
    const c = collections(getDb());
    const otherId = new ObjectId();
    await c.sources.insertOne({
      _id: otherId,
      slug: 'sample-post',
      displayName: 'Sample Post',
      homepageUrl: 'http://127.0.0.1',
      language: 'en',
      licence: { status: 'pending' },
      ingest: { method: 'rss', basis: 'public_feed', feedUrl, pollIntervalMin: 5, consecutiveFailures: 0 },
      priority: 30,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    let call = 0;
    respond = () => {
      call += 1;
      return call === 1 ? { status: 500, body: '' } : { status: 200, body: rss(STORIES) };
    };

    const reports = await pollDueSources();
    expect(reports).toHaveLength(2);
    expect(reports.filter((r) => r.error !== null)).toHaveLength(1);
    expect(reports.reduce((n, r) => n + r.inserted, 0)).toBe(3);
  });
});
