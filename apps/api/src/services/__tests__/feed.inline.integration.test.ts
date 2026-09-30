import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { connect, close, getDb } from '@saar/db';
import { getFeed, __resetInlineSourceCache } from '../feed.service.js';

/**
 * Which stories may carry a small ad.
 *
 * Two people can say no: an editor, for one story ("no ads beside a death
 * toll"), and the newsroom, for every story from a publisher whose agreement
 * does not allow advertising on their reporting. The feed collects both into
 * one set beside the page, and that set never reaches the reader.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

let allowed: ObjectId;
let barred: ObjectId;

async function story(sourceId: ObjectId, over: Record<string, unknown> = {}): Promise<string> {
  const _id = new ObjectId();
  await getDb()
    .collection('articles')
    .insertOne({
      _id,
      slug: `story-${_id.toString()}`,
      status: 'published',
      language: 'en',
      categoryId: new ObjectId(),
      sourceId,
      publishedAt: new Date(Date.now() - Math.floor(Math.random() * 3_600_000)),
      headline: 'Relief fund released to three districts',
      summary: 'Summary text for the story.',
      summaryWordCount: 5,
      summaryCharCount: 27,
      pullQuote: null,
      publisherUrl: `https://example.invalid/${_id.toString()}`,
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
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
  return _id.toString();
}

beforeAll(async () => {
  await connect({ uri: URI });
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  __resetInlineSourceCache();
  await Promise.all([
    getDb().collection('articles').deleteMany({}),
    getDb().collection('sources').deleteMany({}),
  ]);
  allowed = new ObjectId();
  barred = new ObjectId();
  const source = (id: ObjectId, slug: string, inlineAds?: boolean) => ({
    _id: id,
    slug,
    displayName: slug,
    homepageUrl: `https://${slug}.example.invalid`,
    language: 'en',
    licence: { status: 'agreed', agreementRef: 'FIXTURE', agreedAt: new Date(), contactEmail: 'x@example.invalid' },
    ingest: { method: 'manual', pollIntervalMin: 15 },
    priority: 50,
    isActive: true,
    ...(inlineAds === undefined ? {} : { inlineAds }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await getDb()
    .collection('sources')
    .insertMany([source(allowed, 'allowed-post'), source(barred, 'barred-post', false)]);
});

const feed = () =>
  getFeed({ languages: ['en'], categorySlug: 'top', limit: 20, cursorSecret: 'test-secret' });

describe('stories that may not carry a small ad', () => {
  it('includes a story an editor marked, and every story from a barred publisher', async () => {
    const ok = await story(allowed);
    const marked = await story(allowed, { adsSuppressed: true });
    const fromBarred = await story(barred);

    const page = await feed();
    expect(page.items).toHaveLength(3);
    expect([...page.inlineBlocked].sort()).toEqual([marked, fromBarred].sort());
    expect(page.inlineBlocked.has(ok)).toBe(false);
  });

  it('treats an absent flag as allowed, on the story and on the publisher', async () => {
    const plain = await story(allowed);
    const page = await feed();
    expect(page.inlineBlocked.has(plain)).toBe(false);
  });

  it('never puts the flag on the public card', async () => {
    await story(allowed, { adsSuppressed: true });
    const page = await feed();
    expect(page.items[0]).not.toHaveProperty('adsSuppressed');
  });
});
