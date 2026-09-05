import { Router } from 'express';
import { collections, getDb } from '@newscard/db';
import { AppError, gone } from '@newscard/shared';
import { feedRoutes } from './feed.routes.js';
import { deviceRoutes } from './devices.routes.js';
import { validateRoutes } from './validate.routes.js';
import { getArticleBySlug } from '../services/feed.service.js';
import { toArticleCard } from '../dto/articleCard.dto.js';
import { asyncRoute } from '../middleware/index.js';

export const v1 = Router();

v1.use(feedRoutes);
v1.use(deviceRoutes);
v1.use(validateRoutes);

/** GET /v1/articles/:slug — deep-link resolution. Spec Ch. 6.6. */
v1.get(
  '/articles/:slug',
  asyncRoute(async (req, res) => {
    const slug = String(req.params.slug ?? '');
    const doc = await getArticleBySlug(slug);

    if (!doc) throw new AppError('NOT_FOUND');

    // 410, not 404. The distinction matters to the client: 404 means "never
    // existed", 410 means "we withdrew it", and only the latter should purge a
    // bookmark and show a withdrawal notice (Ch. 3.3.3).
    if (doc.status === 'retracted') throw gone();
    if (doc.status !== 'published') throw new AppError('NOT_FOUND');

    res.json({ item: toArticleCard(doc) });
  }),
);

/** GET /v1/categories */
v1.get(
  '/categories',
  asyncRoute(async (_req, res) => {
    const cats = await collections(getDb())
      .categories.find({ isActive: true })
      .sort({ order: 1 })
      .toArray();

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      items: cats.map((c) => ({ slug: c.slug, label: c.label, order: c.order })),
    });
  }),
);

/** GET /v1/health — returns the running commit so the deployed version is
 *  always identifiable (Ch. 17.7). */
v1.get(
  '/health',
  asyncRoute(async (_req, res) => {
    let dbOk = false;
    try {
      await getDb().command({ ping: 1 });
      dbOk = true;
    } catch {
      dbOk = false;
    }

    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk,
      sha: process.env.GIT_SHA ?? 'dev',
      uptimeSec: Math.round(process.uptime()),
    });
  }),
);
