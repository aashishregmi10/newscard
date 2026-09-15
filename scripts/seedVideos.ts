/**
 * Seeds the demonstration shorts.
 *
 * Every clip is real CC-licensed footage from Wikimedia Commons, credited to
 * its actual photographer and stored with its licence — the same discipline the
 * still images follow, and what lets the publish gate that blocks unlicensed
 * media be satisfied honestly rather than bypassed.
 *
 * The captions are ours and invented, under the same rule as the written
 * corpus: fictional publishers, no real named individual, and no checkable
 * claim about a real institution.
 */

import { ObjectId, type Db } from 'mongodb';
import { fetchAllVideos } from './fetch-demo-videos.js';
import { DEMO_VIDEOS } from './seedVideosData.js';

export interface SeededVideos {
  encoded: number;
  skipped: number;
}

export async function seedVideos(
  db: Db,
  cdnBase: string,
  categoryIds: Map<string, ObjectId>,
  sourceIds: Map<string, ObjectId>,
  categoryLabels: Map<string, { ne: string; en: string }>,
  sourceNames: Map<string, string>,
): Promise<SeededVideos> {
  await db.collection('videos').deleteMany({});

  const clips = await fetchAllVideos(cdnBase);
  const now = Date.now();

  let encoded = 0;
  let skipped = 0;

  for (const v of DEMO_VIDEOS) {
    const clip = clips[v.slug];
    // No footage means no record. A video row whose file does not exist is a
    // card that renders as a black rectangle, which is worse than one fewer
    // short in the tab.
    if (!clip) {
      skipped++;
      continue;
    }

    const catId = categoryIds.get(v.category);
    const srcId = sourceIds.get(v.source);
    const label = categoryLabels.get(v.category);
    const srcName = sourceNames.get(v.source);
    if (!catId || !srcId || !label || !srcName) {
      skipped++;
      continue;
    }

    const publishedAt = new Date(now - v.minutesAgo * 60_000);

    await db.collection('videos').insertOne({
      _id: new ObjectId(),
      slug: v.slug,
      status: 'published',
      language: v.language,
      categoryId: catId,
      sourceId: srcId,
      publishedAt,
      title: v.title,
      caption: v.caption,
      durationSeconds: clip.durationSeconds,
      posterUrl: clip.posterUrl,
      posterBlurHash: clip.posterBlurHash,
      renditions: clip.renditions,
      // Credit and licence travel with the clip, exactly as with a photograph.
      credit: `${clip.credit} (${clip.licence})`,
      licence: 'cc_by',
      sourceUrl: clip.sourceUrl,
      // Denormalised so a video card needs no join, as an article card does not.
      sourceName: srcName,
      categorySlug: v.category,
      categoryLabel: label,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    encoded++;
  }

  return { encoded, skipped };
}
