import { Router } from 'express';
import { z } from 'zod';
import { AppError, FEED_PAGE_SIZE } from '@saar/shared';
import { LanguageEnum } from '@saar/schemas';
import { getFeed } from '../services/feed.service.js';
import { injectAds } from '../services/ads.service.js';
import { injectInteractions, interactionsForFeed } from '../services/interactions.service.js';
import { getDb } from '@saar/db';
import { DEFAULT_AD_DENSITY, DEFAULT_INLINE_ADS } from '@saar/shared';
import { asyncRoute } from '../middleware/index.js';
import { loadEnv } from '../config/index.js';

/** GET /v1/feed — spec Ch. 6.5. */

const QuerySchema = z.object({
  // At least one language is required. An empty value is a 400, never an
  // implicit "all" — silently widening a filter is how a Nepali-only reader
  // starts seeing English cards.
  lang: z
    .string()
    .default('ne,en')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(LanguageEnum).min(1, 'lang must name at least one of: ne, en')),
  category: z.string().default('top'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().default(FEED_PAGE_SIZE),
  /** Content cards the reader has already passed. Ad placement is a function
   *  of ABSOLUTE position, so this keeps spacing consistent across pages. */
  seen: z.coerce.number().int().nonnegative().default(0),
  /** Full-card ads already shown to this device today, for the daily cap. */
  adsToday: z.coerce.number().int().nonnegative().default(0),
  /** Small ads shown today. Counted separately: at one per story, sharing the
   *  full-card counter would spend its allowance of twelve in twelve stories. */
  inlineToday: z.coerce.number().int().nonnegative().default(0),
  /**
   * '1' from an app that can draw an Interaction card (a rating or a vote).
   * An older app would draw one as a broken story, so it gets none unless it
   * asks — the same arrangement as YouTube shorts on /v1/videos.
   */
  interactions: z.enum(['0', '1']).default('0'),
});

export const feedRoutes = Router();

feedRoutes.get(
  '/feed',
  asyncRoute(async (req, res) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', 'Invalid query parameters.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const env = loadEnv();
    const { lang, category, cursor, limit } = parsed.data;

    const result = await getFeed({
      languages: lang,
      categorySlug: category,
      cursor,
      // Clamp server-side. A client asking for 500 receives the page size.
      limit: Math.min(limit, FEED_PAGE_SIZE),
      cursorSecret: env.CURSOR_SECRET,
    });

    // Ads are interleaved AFTER the content page is built, so editorial order
    // and source diversity survive untouched.
    const { inlineBlocked, ...page } = result;
    const { entries, adCount, inlineCount } = await injectAds(page.items, {
      languages: lang,
      categorySlug: category,
      pageOffset: parsed.data.seen,
      density: DEFAULT_AD_DENSITY,
      adsShownToday: parsed.data.adsToday,
      inline: DEFAULT_INLINE_ADS,
      inlineShownToday: parsed.data.inlineToday,
      inlineBlocked,
    });

    /* Interactions after ads, placed by the same absolute position and never
       beside a full-card ad. Not personalised: the card fetches its reader's
       own state once it is on screen. */
    const items =
      parsed.data.interactions === '1'
        ? injectInteractions(
            entries,
            parsed.data.seen,
            await interactionsForFeed(getDb(), { languages: lang, categorySlug: category }),
          )
        : entries;

    // Personalised by ad allowance, so this response is NOT shared cache-safe.
    res.setHeader(
      'Cache-Control',
      adCount > 0 || inlineCount > 0
        ? 'private, max-age=30'
        : 'public, max-age=60, stale-while-revalidate=300',
    );
    res.json({ ...page, items, adCount, inlineCount });
  }),
);
