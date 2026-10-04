import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '@saar/db';
import { AppError, encodeCursor, decodeCursor, CursorError } from '@saar/shared';
import { ObjectId } from 'mongodb';
import { LanguageEnum } from '@saar/schemas';
import { asyncRoute } from '../middleware/index.js';
import { loadEnv } from '../config/index.js';

/**
 * GET /v1/videos — the shorts feed.
 *
 * Paged on the same signed compound cursor as the article feed, for the same
 * reason: a page-number feed duplicates and skips whenever anything is
 * published while a reader is scrolling, and two items published in the same
 * millisecond are the case that breaks a naive tiebreak.
 *
 * ── What this response deliberately does NOT contain ────────────────────────
 *
 * A URL the client is told to play. Every rendition is returned and the CLIENT
 * chooses, because only the client knows whether it is on Wi-Fi, whether the
 * reader has Data Saver on, and how large the surface is. A server that picks
 * for it would be guessing, and guessing high on a metered connection spends
 * someone's money.
 */

const QuerySchema = z.object({
  lang: z
    .string()
    .default('ne,en')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(LanguageEnum).min(1, 'lang must name at least one of: ne, en')),
  category: z.string().default('all'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(20).default(10),
  /**
   * Whether the app can play a YouTube short, with YouTube's player.
   *
   * Apps built before YouTube shorts existed play only our own renditions, and
   * a YouTube short has none — so it is sent only to an app that says `1`.
   * An older install keeps working and simply does not see them.
   */
  youtube: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
});

export const videoRoutes = Router();

videoRoutes.get(
  '/videos',
  asyncRoute(async (req, res) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', 'Invalid query parameters.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const env = loadEnv();
    const { lang, category, cursor, limit, youtube } = parsed.data;

    const filter: Record<string, unknown> = {
      status: 'published',
      language: { $in: lang },
      publishedAt: { $ne: null },
      ...(youtube ? {} : { origin: { $ne: 'youtube' } }),
    };
    // `all` and `top` are virtual: no video is filed against them.
    if (category !== 'all' && category !== 'top') filter.categorySlug = category;

    if (cursor) {
      // Same compound-key decode as the article feed, including the signature
      // check — an unsigned cursor is a way to ask the database for arbitrary
      // ranges.
      try {
        const { p, i } = decodeCursor(cursor, env.CURSOR_SECRET);
        filter.$or = [
          { publishedAt: { $lt: new Date(p) } },
          { publishedAt: new Date(p), _id: { $lt: new ObjectId(i) } },
        ];
      } catch (e) {
        if (e instanceof CursorError) {
          throw new AppError('INVALID_CURSOR', undefined, { reason: e.reason });
        }
        throw e;
      }
    }

    // One more than asked for, so `hasMore` is known without a second count.
    const docs = await getDb()
      .collection('videos')
      .find(filter)
      .sort({ publishedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const last = page[page.length - 1];

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({
      items: page.map((v) => ({
        kind: 'video' as const,
        id: v._id.toString(),
        slug: v.slug,
        language: v.language,
        title: v.title,
        caption: v.caption,
        durationSeconds: v.durationSeconds,
        posterUrl: v.posterUrl,
        posterBlurHash: v.posterBlurHash ?? null,
        renditions: v.renditions ?? [],
        youtubeId: v.origin === 'youtube' ? ((v.youtubeId as string | undefined) ?? null) : null,
        credit: v.credit,
        source: { name: v.sourceName },
        category: { slug: v.categorySlug, label: v.categoryLabel },
        publishedAt: (v.publishedAt as Date).toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor(last.publishedAt as Date, last._id.toString(), env.CURSOR_SECRET)
          : null,
      hasMore,
    });
  }),
);
