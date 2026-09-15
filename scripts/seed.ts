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
import { fetchAll } from './fetch-demo-images.js';
import { seedAds } from './seedAds.js';
import { seedVideos } from './seedVideos.js';

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
 * Image URLs are stored RELATIVE ("/media/..."), and the client resolves them
 * against whichever host it reached Expo on.
 *
 * The alternative — baking in an absolute address at seed time — breaks twice:
 * "localhost" on a handset means the handset, and a hardcoded LAN address stops
 * working the next time the router hands out a different lease. Both fail as
 * images that silently do not load on the phone while looking correct in a
 * desktop browser.
 */
const CDN_BASE = process.env.CDN_BASE_URL ?? '/media';

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

  /**
   * Real photographs from Wikimedia Commons, each carrying its own licence and
   * photographer. Cached on disk, so this only touches the network for stories
   * that do not have a picture yet.
   *
   * A story with no usable result falls back to the generated gradient rather
   * than to nothing: the point of the fallback is that the card layout is
   * exercised either way.
   */
  const photos = await fetchAll(CDN_BASE);

  const clusterIds = new Map<string, ObjectId>();
  let withImage = 0;
  let withPhoto = 0;

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
      const photo = photos[story.slug];
      if (photo) {
        image = {
          sourceUrl: photo.sourceUrl,
          // The photographer and the exact licence, both shown on the card.
          // Crediting a real photographer correctly is the whole reason these
          // are usable at all.
          credit: `${photo.credit} (${photo.licence})`,
          // Maps to the schema's enum. The precise licence string lives in the
          // credit, because "CC BY-SA 3.0" is what a takedown request would
          // actually be checked against.
          licence: 'cc_by',
          blurHash: photo.blurHash,
          width: photo.width,
          height: photo.height,
          urls: photo.urls,
        };
        withPhoto++;
      } else {
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
      }
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

  const vids = await seedVideos(
    db,
    CDN_BASE,
    categoryIds,
    sourceIds,
    new Map(MVP_CATEGORIES.map((c) => [c.slug, c.label])),
    new Map(SOURCES.map((s) => [s.slug, s.displayName])),
  );
  console.log(`  ${vids.encoded} shorts (real CC-licensed footage, credited)${vids.skipped ? `, ${vids.skipped} skipped — no footage found` : ''}`);

  const ads = await seedAds(db, CDN_BASE);
  console.log(`  ${ads.advertisers} advertisers, ${ads.campaigns} campaigns (all fictional)`);

  const ne = STORIES.filter((s) => s.language === 'ne').length;
  console.log(`  ${STORIES.length} articles (${ne} Nepali, ${STORIES.length - ne} English)`);
  console.log(`  ${withImage} with images — ${withPhoto} real photographs (CC-licensed, credited), ${withImage - withPhoto} generated`);
  console.log(`  ${STORIES.length - withImage} without an image (deliberate)`);
  console.log(`  ${clusterIds.size} cluster(s) — one story carried by 3 outlets`);
  console.log('\nseed complete');
  console.log(`\nCMS login (development only):\n  ${DEV_EMAIL}\n  ${DEV_PASSWORD}`);

  // Printed rather than stored: the campaign holds only a sha256 of this, so
  // there is nowhere to look it up afterwards. Re-seed to issue a new one.
  console.log('\nAdvertiser reports (development only) — each token is shown once:');
  for (const s of ads.seeded) {
    console.log(`  ${s.advertiser}`);
    console.log(
      `    curl -H "Authorization: Bearer ${s.reportToken}" http://localhost:3000/v1/ads/campaigns/${s.id}/report`,
    );
  }
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error('\nseed failed:', e instanceof Error ? e.message : e);
    await close();
    process.exit(1);
  });
