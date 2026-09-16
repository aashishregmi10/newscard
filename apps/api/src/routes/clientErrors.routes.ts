import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { asyncRoute } from '../middleware/index.js';

/**
 * Crash and error reports from the app.
 *
 * ── Why this exists rather than a third-party SDK ───────────────────────────
 *
 * Until now a crash on a reader's phone was invisible: the app showed its error
 * boundary, the reader closed it, and nothing reached us. On entry-level Android
 * with fragmented OEM builds that means crashes we cannot reproduce and learn
 * about weeks later from an aggregate store rating, with no stack trace.
 *
 * A hosted crash reporter would do this better and can be added later. This is
 * deliberately not that, for two reasons. It needs no account, no key and no
 * vendor decision, so it works today. And every ad and attribution SDK is
 * already blocked by the forbidden-dependency check precisely because such SDKs
 * collect more than they are asked to — adding one back for crash reporting
 * would need the same scrutiny, and that is a decision to make deliberately
 * rather than to slip in under an incident.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 *
 * The message, the stack, where in the app it happened, and the platform and app
 * version needed to reproduce it. The device's own random id is accepted so that
 * twenty reports from one broken handset are not read as twenty broken
 * handsets — it identifies an install, never a person. No reader content, no
 * headline, no search term, nothing typed.
 */

const ReportSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(8000).optional(),
  /** Where it happened: a screen name or a component, not a URL. */
  context: z.string().max(120).optional(),
  fatal: z.boolean().default(false),
  platform: z.enum(['ios', 'android', 'web']),
  osVersion: z.string().max(60).optional(),
  appVersion: z.string().max(30),
  deviceId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
});

/** Kept long enough to see whether a release fixed something, and no longer. */
export const CLIENT_ERROR_TTL_DAYS = 60;

export const clientErrorRoutes = Router();

clientErrorRoutes.post(
  '/client-errors',
  asyncRoute(async (req, res) => {
    const parsed = ReportSchema.safeParse(req.body);
    // A malformed report is dropped without complaint. The reporter runs inside
    // an app that is already broken; answering it with a validation error it
    // would have to handle is a second failure on top of the first.
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Invalid error report.');

    const r = parsed.data;
    const db = getDb();

    /**
     * One row per distinct fault, with a count — not one row per occurrence.
     *
     * A crash loop produces thousands of identical reports in a minute. Storing
     * each would bury the one new fault that matters under the one everybody
     * already knows about, and would make the collection the largest in the
     * database for no benefit.
     */
    const fingerprint = `${r.platform}:${r.appVersion}:${r.context ?? '-'}:${r.message.slice(0, 200)}`;
    const now = r.occurredAt ? new Date(r.occurredAt) : new Date();

    await db.collection('clientErrors').updateOne(
      { fingerprint },
      {
        $setOnInsert: {
          fingerprint,
          message: r.message,
          context: r.context ?? null,
          platform: r.platform,
          appVersion: r.appVersion,
          firstSeen: now,
          // Only the first stack is kept. Later ones for the same fingerprint
          // are the same stack, and storing them again buys nothing.
          stack: r.stack ?? null,
        },
        $set: { lastSeen: now, osVersion: r.osVersion ?? null, fatal: r.fatal },
        $inc: { count: 1 },
        // A set, so one handset reporting a hundred times counts once towards
        // "how many installs does this affect" — the number that decides
        // whether a fault is urgent.
        ...(r.deviceId ? { $addToSet: { devices: r.deviceId } } : {}),
      },
      { upsert: true },
    );

    res.status(202).json({ received: true });
  }),
);

/**
 * GET /v1/client-errors — what is currently broken, worst first.
 *
 * Ordered by the number of DISTINCT installs affected rather than by raw count,
 * because one device in a crash loop is a curiosity and two hundred devices
 * hitting the same fault once each is an incident.
 */
clientErrorRoutes.get(
  '/client-errors',
  asyncRoute(async (req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await getDb()
      .collection('clientErrors')
      .aggregate([
        { $match: { lastSeen: { $gte: since } } },
        { $addFields: { deviceCount: { $size: { $ifNull: ['$devices', []] } } } },
        { $sort: { deviceCount: -1, count: -1 } },
        { $limit: 100 },
        { $project: { _id: 0, devices: 0 } },
      ])
      .toArray();

    res.setHeader('Cache-Control', 'no-store');
    res.json({ since: since.toISOString(), items: rows });
  }),
);
