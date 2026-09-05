import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@newscard/db';
import { AppError } from '@newscard/shared';
import { asyncRoute } from '../middleware/index.js';

/**
 * POST /v1/articles/validate — cache reconciliation.  Spec Ch. 9.7.
 *
 * A device that has been offline for days may still be holding stories we have
 * since withdrawn. Correctness matters more here than anywhere else in the app:
 * a retracted story is usually retracted because it was WRONG, and leaving it
 * readable is the one failure that damages trust rather than merely annoying.
 *
 * The client sends the ids it holds; we return only those no longer published.
 * Returning the invalid ones rather than the valid ones keeps the response tiny
 * in the overwhelmingly common case where nothing has changed — which matters
 * on a metered connection, and means the check is cheap enough to run on every
 * foreground.
 */

export const validateRoutes = Router();

const BodySchema = z.object({
  // A cache holds at most 400 cards (Ch. 9.3); 500 leaves headroom without
  // letting a malformed client send us an unbounded list.
  ids: z.array(z.string().regex(/^[0-9a-f]{24}$/)).max(500),
});

validateRoutes.post(
  '/articles/validate',
  asyncRoute(async (req, res) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', 'Expected { ids: string[] } of article ids.');
    }

    const { ids } = parsed.data;
    if (ids.length === 0) {
      res.json({ invalid: [] });
      return;
    }

    const objectIds = ids.map((id) => new ObjectId(id));

    // Ask for what is STILL publishable, then invert. A direct query for
    // "retracted" would miss ids that were spiked, or that never existed
    // because the client is on stale data.
    const live = await collections(getDb())
      .articles.find(
        { _id: { $in: objectIds }, status: 'published' },
        { projection: { _id: 1 } },
      )
      .toArray();

    const liveSet = new Set(live.map((d) => d._id.toString()));
    const invalid = ids.filter((id) => !liveSet.has(id));

    // Not cacheable: the whole point is to reflect a withdrawal immediately.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ invalid });
  }),
);
