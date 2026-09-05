import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { connect, close, collections, getDb, applyValidators } from '@newscard/db';
import { DEFAULT_CONFIG, MVP_CATEGORIES } from '@newscard/schemas';
import { countGraphemes, countWords } from '@newscard/shared';
import { publishArticle, retractArticle } from '../publish.service.js';

/**
 * Integration tests for the publish preconditions.  Spec Fig. 4.3.
 *
 * These run against a REAL MongoDB replica set, because the thing under test is
 * a transaction with five guards — and a mocked database would happily let all
 * five pass.
 *
 * Uses its own database name so it can never touch dev data.
 */

const URI =
  process.env.MONGO_TEST_URI ??
  'mongodb://localhost:27018/newscard_test?replicaSet=rs0&directConnection=true';

/**
 * Publishing runs in a transaction, which needs a replica set. When one is not
 * reachable these tests SKIP with a clear reason rather than failing: a red
 * suite should mean the code is wrong, not that Docker is not running. CI runs
 * with the stack up, so nothing is quietly lost.
 */
async function replicaSetAvailable(): Promise<boolean> {
  const c = new MongoClient(URI, { serverSelectionTimeoutMS: 1500 });
  try {
    await c.connect();
    const info = (await c.db('admin').command({ hello: 1 })) as { setName?: string };
    return typeof info.setName === 'string';
  } catch {
    return false;
  } finally {
    await c.close().catch(() => undefined);
  }
}

const hasReplicaSet = await replicaSetAvailable();
if (!hasReplicaSet) {
  console.warn(
    `\n[skipped] publish integration tests — no replica set at ${URI.split('?')[0]}.` +
      '\n          Start it with: npm run db:up\n',
  );
}
const describeIfRs = hasReplicaSet ? describe : describe.skip;

let catId: ObjectId;
let licensedSourceId: ObjectId;
let unlicensedSourceId: ObjectId;
let editorA: ObjectId;
let editorB: ObjectId;

const GOOD_SUMMARY = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');

async function makeArticle(over: Record<string, unknown> = {}): Promise<ObjectId> {
  const c = collections(getDb());
  const _id = new ObjectId();
  const cat = MVP_CATEGORIES[1]!;
  await c.articles.insertOne({
    _id,
    slug: `test-article-${_id.toString()}`,
    status: 'approved',
    language: 'en',
    categoryId: catId,
    sourceId: licensedSourceId,
    publishedAt: null,
    headline: 'A perfectly ordinary test headline for the publish flow',
    summary: GOOD_SUMMARY,
    summaryWordCount: countWords(GOOD_SUMMARY),
    summaryCharCount: countGraphemes(GOOD_SUMMARY),
    pullQuote: null,
    publisherUrl: `https://example.invalid/a/${_id.toString()}`,
    publisherAuthor: null,
    publisherPublishedAt: new Date(),
    tags: [],
    clusterId: null,
    originatingAgency: null,
    image: null,
    sourceName: 'placeholder — overwritten at publish',
    sourceLogoUrl: null,
    categorySlug: cat.slug,
    categoryLabel: cat.label,
    authoredBy: editorA,
    reviewedBy: null,
    selfApproved: false,
    draftSource: 'human',
    revisionCount: 1,
    possibleDuplicate: false,
    possibleLanguageMismatch: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as never);
  return _id;
}

const asEditorB = (articleId: ObjectId) => ({
  articleId: articleId.toString(),
  actorId: editorB.toString(),
  actorEmail: 'b@example.invalid',
  actorRole: 'reviewer',
  actorLanguages: ['ne', 'en'],
  ip: null,
});

beforeAll(async () => {
  // describe.skip does not stop the hooks running, so this must bail too or it
  // fails with a connection error for the very reason we chose to skip.
  if (!hasReplicaSet) return;
  await connect({ uri: URI });
  await applyValidators(getDb());

  const c = collections(getDb());
  await Promise.all([
    c.articles.deleteMany({}),
    c.sources.deleteMany({}),
    c.categories.deleteMany({}),
    c.staff.deleteMany({}),
    c.config.deleteMany({}),
  ]);

  catId = new ObjectId();
  await c.categories.insertOne({ _id: catId, ...MVP_CATEGORIES[1]! } as never);
  await c.config.insertOne({ _id: new ObjectId(), _key: 'singleton', ...DEFAULT_CONFIG } as never);

  licensedSourceId = new ObjectId();
  await c.sources.insertOne({
    _id: licensedSourceId,
    slug: 'licensed-source',
    displayName: 'Licensed Sample Post',
    homepageUrl: 'https://example.invalid/l',
    logoUrl: 'https://cdn.example.invalid/l.png',
    language: 'en',
    licence: { status: 'agreed', contactEmail: 'takedown@example.invalid', agreedAt: new Date() },
    ingest: { method: 'manual', pollIntervalMin: 15, consecutiveFailures: 0 },
    priority: 20,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);

  unlicensedSourceId = new ObjectId();
  await c.sources.insertOne({
    _id: unlicensedSourceId,
    slug: 'unlicensed-source',
    displayName: 'Unlicensed Sample',
    homepageUrl: 'https://example.invalid/u',
    language: 'en',
    licence: { status: 'pending' },
    ingest: { method: 'manual', pollIntervalMin: 15, consecutiveFailures: 0 },
    priority: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);

  editorA = new ObjectId();
  editorB = new ObjectId();
  for (const [id, email] of [
    [editorA, 'a@example.invalid'],
    [editorB, 'b@example.invalid'],
  ] as const) {
    await c.staff.insertOne({
      _id: id,
      email,
      name: email,
      role: 'reviewer',
      languages: ['ne', 'en'],
      isActive: true,
      passwordHash: 'placeholder',
      failedLoginCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  }
});

afterAll(async () => {
  if (!hasReplicaSet) return;
  await close();
});

beforeEach(async () => {
  if (!hasReplicaSet) return;
  await collections(getDb()).articles.deleteMany({});
});

describeIfRs('publish — the happy path', () => {
  it('publishes an approved article and denormalises the source', async () => {
    const id = await makeArticle();
    const res = await publishArticle(asEditorB(id));

    expect(res.status).toBe('published');
    expect(res.publishedAt).toBeInstanceOf(Date);

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    // The denormalised name must be copied at publish time, or the card renders
    // with a blank publisher — the attribution failure we cannot afford.
    expect(doc!.sourceName).toBe('Licensed Sample Post');
    expect(doc!.sourceLogoUrl).toBe('https://cdn.example.invalid/l.png');
    expect(doc!.reviewedBy!.toString()).toBe(editorB.toString());
  });

  it('schedules instead of publishing when given a future date', async () => {
    const id = await makeArticle();
    const when = new Date(Date.now() + 3_600_000);
    const res = await publishArticle({ ...asEditorB(id), scheduledFor: when });

    expect(res.status).toBe('scheduled');
    expect(res.publishedAt).toBeNull();
  });

  it('writes an audit record', async () => {
    const id = await makeArticle();
    await publishArticle(asEditorB(id));
    const audit = await collections(getDb()).audit.findOne({ entityId: id.toString() });
    expect(audit?.action).toBe('article.publish');
    expect(audit?.actorEmail).toBe('b@example.invalid');
  });
});

describeIfRs('publish — the five preconditions', () => {
  it('1. rejects an illegal state transition', async () => {
    const id = await makeArticle({ status: 'draft' });
    await expect(publishArticle(asEditorB(id))).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('2. refuses to publish from an unlicensed source, even after ingestion allowed it', async () => {
    const id = await makeArticle({ sourceId: unlicensedSourceId });
    await expect(publishArticle(asEditorB(id))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('2b. refuses when a source is downgraded BETWEEN ingestion and publish', async () => {
    // The exact race the re-check exists for.
    const id = await makeArticle();
    await collections(getDb()).sources.updateOne(
      { _id: licensedSourceId },
      { $set: { 'licence.status': 'refused' } },
    );

    await expect(publishArticle(asEditorB(id))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // restore for later cases
    await collections(getDb()).sources.updateOne(
      { _id: licensedSourceId },
      { $set: { 'licence.status': 'agreed' } },
    );
  });

  it('3. the schema validator refuses to even STORE an unrecognised image licence', async () => {
    // The first line of defence (Ch. 3.14): such a document cannot exist.
    await expect(
      makeArticle({ image: { credit: 'Someone', licence: 'scraped-from-google', urls: {} } }),
    ).rejects.toThrow(/failed validation/i);
  });

  it('3b. publish ALSO refuses it, for a document that predates the validator', async () => {
    // Defence in depth. A validator is added or changed at some point in a
    // system's life; rows written before that are still there. Smuggle one past
    // the validator and confirm the publish guard is an independent check
    // rather than relying on the storage layer having always been strict.
    const c = collections(getDb());
    const _id = new ObjectId();
    const cat = MVP_CATEGORIES[1]!;
    await c.articles.insertOne(
      {
        _id,
        slug: `legacy-bad-image-${_id.toString()}`,
        status: 'approved',
        language: 'en',
        categoryId: catId,
        sourceId: licensedSourceId,
        publishedAt: null,
        headline: 'A legacy article carrying an image with no valid licence',
        summary: GOOD_SUMMARY,
        summaryWordCount: countWords(GOOD_SUMMARY),
        summaryCharCount: countGraphemes(GOOD_SUMMARY),
        pullQuote: null,
        publisherUrl: `https://example.invalid/legacy/${_id.toString()}`,
        publisherAuthor: null,
        publisherPublishedAt: new Date(),
        tags: [],
        clusterId: null,
        originatingAgency: null,
        image: { credit: 'Someone', licence: 'scraped-from-google', urls: {} },
        sourceName: 'placeholder — overwritten at publish',
        sourceLogoUrl: null,
        categorySlug: cat.slug,
        categoryLabel: cat.label,
        authoredBy: editorA,
        reviewedBy: null,
        selfApproved: false,
        draftSource: 'human',
        revisionCount: 1,
        possibleDuplicate: false,
        possibleLanguageMismatch: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
      { bypassDocumentValidation: true },
    );

    await expect(publishArticle(asEditorB(_id))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('3b. accepts a properly licensed image', async () => {
    const id = await makeArticle({
      image: {
        credit: 'Licensed Sample Post',
        licence: 'publisher_licensed',
        urls: { md: 'https://cdn.example.invalid/i/1/720.webp' },
      },
    });
    await expect(publishArticle(asEditorB(id))).resolves.toMatchObject({ status: 'published' });
  });

  it('4. refuses a summary below the minimum', async () => {
    const short = 'Only eight words in this deliberately short summary here.';
    const id = await makeArticle({ summary: short });
    await expect(publishArticle(asEditorB(id))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('4b. refuses a summary above the maximum', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ');
    const id = await makeArticle({ summary: long });
    await expect(publishArticle(asEditorB(id))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('5. blocks self-approval while a second editor is active', async () => {
    const id = await makeArticle({ authoredBy: editorB });
    await expect(publishArticle(asEditorB(id))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('5b. allows self-approval when sole active editor, and stamps it', async () => {
    await collections(getDb()).staff.updateOne({ _id: editorA }, { $set: { isActive: false } });
    const id = await makeArticle({ authoredBy: editorB });

    const res = await publishArticle(asEditorB(id));
    expect(res.selfApproved).toBe(true);

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    expect(doc!.selfApproved).toBe(true);

    await collections(getDb()).staff.updateOne({ _id: editorA }, { $set: { isActive: true } });
  });

  it('5c. blocks a reviewer approving a language they cannot read', async () => {
    const id = await makeArticle({ language: 'ne' });
    await expect(
      publishArticle({ ...asEditorB(id), actorLanguages: ['en'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describeIfRs('publish — atomicity', () => {
  it('leaves the article untouched when a precondition fails', async () => {
    const id = await makeArticle({ sourceId: unlicensedSourceId });
    await expect(publishArticle(asEditorB(id))).rejects.toThrow();

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    // No half-applied publish: status unchanged, nothing denormalised.
    expect(doc!.status).toBe('approved');
    expect(doc!.publishedAt).toBeNull();
    expect(doc!.sourceName).toBe('placeholder — overwritten at publish');
    expect(doc!.reviewedBy).toBeNull();
  });
});

describeIfRs('retraction', () => {
  it('retracts a published article without deleting it', async () => {
    const id = await makeArticle();
    await publishArticle(asEditorB(id));

    await retractArticle({
      articleId: id.toString(),
      reason: 'Incorrect casualty figure in the second sentence.',
      actorId: editorB.toString(),
      actorEmail: 'b@example.invalid',
      ip: null,
    });

    const doc = await collections(getDb()).articles.findOne({ _id: id });
    // Still present — users may have it cached, shared, or bookmarked.
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe('retracted');
    expect(doc!.retractedAt).toBeInstanceOf(Date);
  });

  it('requires a substantive reason', async () => {
    const id = await makeArticle();
    await publishArticle(asEditorB(id));
    await expect(
      retractArticle({
        articleId: id.toString(),
        reason: 'oops',
        actorId: editorB.toString(),
        actorEmail: 'b@example.invalid',
        ip: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('cannot retract something that was never published', async () => {
    const id = await makeArticle({ status: 'draft' });
    await expect(
      retractArticle({
        articleId: id.toString(),
        reason: 'This was never live in the first place.',
        actorId: editorB.toString(),
        actorEmail: 'b@example.invalid',
        ip: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
