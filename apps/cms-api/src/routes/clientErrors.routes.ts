import { Router } from 'express';
import { getDb } from '@saar/db';
import { requireAuth, requireRole } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';

/**
 * GET /api/cms/client-errors — what is currently broken in the app.
 *
 * This used to sit on the public read API, where anyone who guessed the path
 * could read stack traces, internal module paths and the app's component
 * structure. Crash reports are written by anyone (the app is broken by the time
 * it reports, so requiring credentials would lose exactly the reports that
 * matter) — but reading them is an operations task, and operations tasks belong
 * behind the staff session.
 *
 * Ordered by the number of DISTINCT installs affected rather than raw count,
 * because one device in a crash loop is a curiosity and two hundred devices
 * hitting the same fault once each is an incident.
 */

export const clientErrorRoutes = Router();

clientErrorRoutes.use(requireAuth);

clientErrorRoutes.get(
  '/cms/client-errors',
  requireRole('queue.read'),
  asyncRoute(async (_req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await getDb()
      .collection('clientErrors')
      .aggregate([
        { $match: { lastSeen: { $gte: since } } },
        { $addFields: { deviceCount: { $size: { $ifNull: ['$devices', []] } } } },
        { $sort: { deviceCount: -1, count: -1 } },
        { $limit: 100 },
        // `devices` holds install ids. The count is what decides urgency; the
        // ids themselves answer no question an editor has, so they do not leave
        // the database.
        { $project: { _id: 0, devices: 0 } },
      ])
      .toArray();

    res.setHeader('Cache-Control', 'no-store');
    res.json({ since: since.toISOString(), items: rows });
  }),
);
