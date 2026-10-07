import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { connect, close, collections, getDb } from '@saar/db';
import { MVP_CATEGORIES } from '@saar/schemas';
import { countGraphemes, countWords } from '@saar/shared';
import { STORIES, SOURCES } from './seedStories.js';
import { generateFor } from './gen-images.js';
import { fetchAll } from './fetch-demo-images.js';
import { requireLocalDatabase } from './lib/localOnly.js';

const CDN_BASE = process.env.CDN_BASE_URL ?? '/media';
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function main() {
  await connect({ uri: requireLocalDatabase('seed-published') });
  const db = getDb();
  const c = collections(db);

  // Categories already exist; reuse them rather than reinserting.
  const categoryIds = new Map<string, ObjectId>();
  for (const cat of await c.categories.find({}).toArray()) {
    categoryIds.set(cat.slug as string, cat._id as ObjectId);
  }

  // Invented demo publishers, inserted only if absent. Nothing existing is
  // touched, so aksherpati and onlinekhabar survive untouched.
  const sourceIds = new Map<string, ObjectId>();
  let addedSources = 0;
  for (const s of SOURCES) {
    const found = await c.sources.findOne({ slug: s.slug });
    if (found) { sourceIds.set(s.slug, found._id as ObjectId); continue; }
    const _id = new ObjectId();
    await c.sources.insertOne({
      _id,
      slug: s.slug,
      displayName: s.displayName,
      homepageUrl: s.homepageUrl,
      logoUrl: null,
      language: s.language,
      licence: {
        status: 'agreed', agreementRef: 'Demonstration corpus',
        agreedAt: new Date(), contactEmail: 'legal@example.invalid',
      },
      ingest: { method: 'manual', basis: 'agreement', feedUrl: null, pollIntervalMin: 15,
        lastPolledAt: null, lastSuccessAt: null, consecutiveFailures: 0 },
      priority: 50, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    } as never);
    sourceIds.set(s.slug, _id);
    addedSources++;
  }

  const editor = await c.staff.findOne({ isActive: true });
  if (!editor) { console.error('no active staff — cannot attribute the stories'); await close(); process.exit(1); }
  const editorId = editor._id as ObjectId;

  /* What fetch-demo-images returns per slug. Declared rather than inferred
     because the cache may be absent and the empty fallback would otherwise
     widen the whole map to `never`. */
  interface CachedPhoto {
    sourceUrl: string | null;
    credit: string;
    licence: string;
    blurHash: string;
    width: number;
    height: number;
    urls: { sm: string | null; md: string | null; lg: string | null };
  }

  /* A miss is not a failure: every story falls back to a generated gradient,
     and the point of the fallback is that the card layout is exercised either
     way. */
  let photos: Record<string, CachedPhoto> = {};
  try {
    photos = (await fetchAll(CDN_BASE)) as Record<string, CachedPhoto>;
  } catch {
    photos = {};
  }

  const clusterIds = new Map<string, ObjectId>();
  let inserted = 0, skipped = 0;

  for (const story of STORIES) {
    if (await c.articles.findOne({ slug: story.slug })) { skipped++; continue; }

    const catId = categoryIds.get(story.category);
    const srcId = sourceIds.get(story.source);
    if (!catId || !srcId) { skipped++; continue; }

    const cat = MVP_CATEGORIES.find((x) => x.slug === story.category)!;
    const src = SOURCES.find((x) => x.slug === story.source)!;

    let clusterId: ObjectId | null = null;
    if (story.clusterKey) {
      if (!clusterIds.has(story.clusterKey)) clusterIds.set(story.clusterKey, new ObjectId());
      clusterId = clusterIds.get(story.clusterKey)!;
    }

    let image: Record<string, unknown> | null = null;
    if (!story.noImage) {
      const photo = photos[story.slug];
      if (photo) {
        image = { sourceUrl: photo.sourceUrl, credit: `${photo.credit} (${photo.licence})`,
          licence: 'cc_by', blurHash: photo.blurHash, width: photo.width, height: photo.height, urls: photo.urls };
      } else {
        const g = generateFor(story.slug, story.category, CDN_BASE);
        image = { sourceUrl: null, credit: `${src.displayName} (synthetic placeholder)`,
          licence: 'own', blurHash: g.blurHash, width: g.width, height: g.height, urls: g.urls };
      }
    }

    const publishedAt = minsAgo(story.minutesAgo);
    await c.articles.insertOne({
      _id: new ObjectId(), slug: story.slug, status: 'published', language: story.language,
      categoryId: catId, sourceId: srcId, publishedAt,
      headline: story.headline, summary: story.summary,
      summaryWordCount: countWords(story.summary), summaryCharCount: countGraphemes(story.summary),
      pullQuote: story.pullQuote,
      publisherUrl: `https://example.invalid/${story.source}/${story.slug}`,
      publisherAuthor: story.author, publisherPublishedAt: publishedAt,
      tags: [], clusterId, originatingAgency: story.originatingAgency ?? null, image,
      sourceName: src.displayName, sourceLogoUrl: null,
      categorySlug: cat.slug, categoryLabel: cat.label,
      authoredBy: editorId, reviewedBy: editorId, selfApproved: true,
      draftSource: 'human', revisionCount: 1,
      possibleDuplicate: false, possibleLanguageMismatch: false,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);
    inserted++;
  }

  console.log('publishers added :', addedSources);
  console.log('articles inserted:', inserted, '| skipped (already there):', skipped);
  console.log('published total  :', await c.articles.countDocuments({ status: 'published' }));
  await close();
}
void main();
