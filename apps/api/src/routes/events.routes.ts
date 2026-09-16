import { ObjectId } from 'mongodb';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { clampDwell, MAX_DWELL_MS } from '@saar/schemas';
import { asyncRoute } from '../middleware/index.js';
import { eventsLimit } from '../middleware/rateLimit.js';

/**
 * POST /v1/events — reading measurement.  Spec Ch. 3.8, 6.8.
 *
 * The `readEvents` collection, its schema, its TTL index and its threshold
 * function all existed. This endpoint did not, so nothing was ever written to
 * it: there was no way to answer which stories are read to the end, which
 * section is dead, or whether a notification worked. Every editorial judgement
 * was being made on instinct, and the per-publisher tap-through figure — the
 * number we owe our sources monthly — did not exist.
 *
 * ── What this deliberately does not collect ─────────────────────────────────
 *
 * An article id, a duration, three booleans and the app's own random install
 * id. No advertising identifier, no location, no profile, nothing the reader
 * typed. The id identifies an install so that one device reading forty cards is
 * not read as forty readers; it is not a person and cannot be joined to one.
 *
 * Rows expire after 90 days on a TTL index. Behavioural data we no longer need
 * is a liability rather than an asset.
 */

const EventSchema = z.object({
  articleId: z.string().regex(/^[0-9a-f]{24}$/),
  categorySlug: z.string().max(40).optional(),
  language: z.enum(['ne', 'en']).optional(),
  dwellMs: z.number().nonnegative(),
  completed: z.boolean().default(false),
  /** Named `openedPublisher` on the client because that is what it means to a
   *  reader; stored as `openedArticle` to match the schema already in place. */
  openedPublisher: z.boolean().default(false),
  shared: z.boolean().default(false),
  occurredAt: z.string().datetime().optional(),
});

const BodySchema = z.object({
  deviceId: z.string().uuid(),
  events: z.array(EventSchema).min(1).max(50),
});

export const eventRoutes = Router();

eventRoutes.post(
  '/events',
  // Unauthenticated by design — measurement must never be in the reader’s
  // way — which is exactly why it needs a ceiling. Keyed per device where a
  // bearer token is present, per IP where it is not.
  eventsLimit,
  asyncRoute(async (req, res) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Invalid events.');

    const now = new Date();
    const docs = parsed.data.events.map((e) => ({
      deviceId: parsed.data.deviceId,
      articleId: new ObjectId(e.articleId),
      // Clamped rather than rejected: a device with a bad clock or a card left
      // on screen overnight should not cost us the rest of the batch, and an
      // unclamped outlier would distort every average built on this.
      dwellMs: clampDwell(e.dwellMs),
      completed: e.completed,
      openedArticle: e.openedPublisher,
      shared: e.shared,
      categorySlug: e.categorySlug ?? null,
      language: e.language ?? null,
      occurredAt: e.occurredAt ? new Date(e.occurredAt) : now,
    }));

    await getDb().collection('readEvents').insertMany(docs);

    // 202, not 200: the app must not wait on this and must not care what it
    // says. Measurement is never allowed to be in the reader's way.
    res.status(202).json({ received: docs.length, maxDwellMs: MAX_DWELL_MS });
  }),
);
