import { Router } from 'express';
import { z } from 'zod';
import { AppError, FEED_PAGE_SIZE } from '@newscard/shared';
import { LanguageEnum } from '@newscard/schemas';
import { getFeed } from '../services/feed.service.js';
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

    // A minute of staleness is imperceptible for news at this cadence and
    // removes most origin load (Ch. 6.5.4).
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(result);
  }),
);
