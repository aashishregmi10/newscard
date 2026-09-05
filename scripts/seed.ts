/**
 * Development seed data.
 *
 * Every story, publisher and image below is SYNTHETIC. Source names are
 * fictional and the images are generated gradients, because we hold no licence
 * to any real article or photograph. See scripts/seedStories.ts and
 * scripts/gen-images.ts.
 *
 * Run: npm run db:seed   (runs the image generator first)
 */

import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { connect, close, collections } from '@newscard/db';
import { MVP_CATEGORIES, DEFAULT_CONFIG } from '@newscard/schemas';
import { countGraphemes, countWords } from '@newscard/shared';
import { hash as argonHash } from '@node-rs/argon2';
import { STORIES, SOURCES } from './seedStories.js';
import { generateFor } from './gen-images.js';

/** Development-only credentials, printed at the end so they are never a secret
 *  hidden in a file, and never reused anywhere real. */
const DEV_EMAIL = 'editor@example.invalid';
const DEV_PASSWORD = 'seed-editor-password';

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Copy .env.example to .env first.');
  process.exit(1);
}

/**
 * Image URLs must be reachable FROM THE PHONE, not just from this machine.
 * localhost on a handset means the handset. Set CDN_BASE_URL to the LAN address
 * (e.g. http://192.168.1.20:3000/media) before seeding if you are testing on a
 * real device, or images will silently fail to load there while looking fine in
 * a desktop browser.
 */
const CDN_BASE = process.env.CDN_BASE_URL ?? 'http://localhost:3000/media';

const NOW = Date.now();
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

async function main(): Promise<void> {
  const db = await connect({ uri: uri! });
  const c = collections(db);
  console.log(`seeding ${db.databaseName}`);
  console.log(`image base: ${CDN_BASE}`);

  // Wipe only what we own. Never touches devices or readEvents.
  await Promise.all([
    c.articles.deleteMany({}),
    c.sources.deleteMany({}),
    c.categories.deleteMany({}),
    c.staff.deleteMany({}),
    c.config.deleteMany({}),
  ]);

  await c.config.insertOne({ _id: new ObjectId(), _key: 'singleton', ...DEFAULT_CONFIG } as never);

  const categoryIds = new Map<string, ObjectId>();
  for (const cat of MVP_CATEGORIES) {
    const _id = new ObjectId();
    categoryIds.set(cat.slug, _id);
    await c.categories.insertOne({ _id, ...cat } as never);
  }
  console.log(`  ${MVP_CATEGORIES.length} categories`);

  const sourceIds = new Map<string, ObjectId>();
  for (const s of SOURCES) {
    const _id = new ObjectId();
    sourceIds.set(s.slug, _id);
    await c.sources.insertOne({
      _id,
      slug: s.slug,
      displayName: s.displayName,
      homepageUrl: `https://example.invalid/${s.slug}`,
      logoUrl: null,
      language: s.language,
      // Fixtures are marked `agreed` so the pipeline is testable end to end.
      // Real sources start `pending` until Gate 1 concludes.
      licence: {
        status: 'agreed',
        agreementRef: 'FIXTURE — not a real agreement',
        agreedAt: new Date(),
        contactEmail: 'takedown@example.invalid',
      },
      ingest: { method: 'manual', pollIntervalMin: 15, consecutiveFailures: 0 },
      priority: s.priority,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  }
  console.log(`  ${SOURCES.length} sources (all fictional)`);

  const editorId = new ObjectId();
  await c.staff.insertOne({
    _id: editorId,
    email: DEV_EMAIL,
    name: 'Seed Editor',
    role: 'admin',
    languages: ['ne', 'en'],
    isActive: true,
    passwordHash: await argonHash(DEV_PASSWORD, {
      algorithm: 2, // Argon2id
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    }),
    failedLoginCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);

  const clusterIds = new Map<string, ObjectId>();
  let withImage = 0;

  for (const story of STORIES) {
    const catId = categoryIds.get(story.category);
    const srcId = sourceIds.get(story.source);
    if (!catId || !srcId) throw new Error(`unknown category/source for ${story.slug}`);

    const cat = MVP_CATEGORIES.find((x) => x.slug === story.category)!;
    const src = SOURCES.find((x) => x.slug === story.source)!;

    let clusterId: ObjectId | null = null;
    if (story.clusterKey) {
      if (!clusterIds.has(story.clusterKey)) clusterIds.set(story.clusterKey, new ObjectId());
      clusterId = clusterIds.get(story.clusterKey)!;
    }

    // A minority of stories carry no image on purpose — the card must collapse
    // the image region cleanly rather than leaving a gap (Ch. 7.2.1).
    let image: Record<string, unknown> | null = null;
    if (!story.noImage) {
      const g = generateFor(story.slug, story.category, CDN_BASE);
      image = {
        sourceUrl: null,
        credit: `${src.displayName} (synthetic placeholder)`,
        // `own` is accurate: we generated these. Nothing here is claimed as a
        // licensed news photograph.
        licence: 'own',
        blurHash: g.blurHash,
        width: g.width,
        height: g.height,
        urls: g.urls,
      };
      withImage++;
    }

    const publishedAt = minsAgo(story.minutesAgo);

    await c.articles.insertOne({
      _id: new ObjectId(),
      slug: story.slug,
      status: 'published',
      language: story.language,
      categoryId: catId,
      sourceId: srcId,
      publishedAt,
      headline: story.headline,
      summary: story.summary,
      summaryWordCount: countWords(story.summary),
      summaryCharCount: countGraphemes(story.summary),
      pullQuote: story.pullQuote,
      publisherUrl: `https://example.invalid/${story.source}/${story.slug}`,
      publisherAuthor: story.author,
      publisherPublishedAt: publishedAt,
      tags: [],
      clusterId,
      originatingAgency: story.originatingAgency ?? null,
      image,
      sourceName: src.displayName,
      sourceLogoUrl: null,
      categorySlug: cat.slug,
      categoryLabel: cat.label,
      authoredBy: editorId,
      reviewedBy: editorId,
      selfApproved: true,
      draftSource: 'human',
      revisionCount: 1,
      possibleDuplicate: false,
      possibleLanguageMismatch: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  }

  const ne = STORIES.filter((s) => s.language === 'ne').length;
  console.log(`  ${STORIES.length} articles (${ne} Nepali, ${STORIES.length - ne} English)`);
  console.log(`  ${withImage} with images, ${STORIES.length - withImage} without (deliberate)`);
  console.log(`  ${clusterIds.size} cluster(s) — one story carried by 3 outlets`);
  console.log('\nseed complete');
  console.log(`\nCMS login (development only):\n  ${DEV_EMAIL}\n  ${DEV_PASSWORD}`);
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error('\nseed failed:', e instanceof Error ? e.message : e);
    await close();
    process.exit(1);
  });
