import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { LanguageEnum, MAX_VIDEO_DURATION_S } from '@saar/schemas';
import { requireAuth, requireRole } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Shorts — the editorial side of the video tab.  Contract §4, "video upload".
 *
 * ── Why shorts are not articles ─────────────────────────────────────────────
 *
 * A short is its own document in its own collection, not an article with a
 * video attached. They are read differently — one vertical tab, no summary, no
 * word limit — and giving them a shared lifecycle would mean the article state
 * machine growing branches that only apply to video, which is how a workflow
 * stops being readable.
 *
 * What they DO share is the licensing discipline. A publisher with no agreed
 * licence cannot have a short filed against them, exactly as with a story, and
 * the check is re-asserted at publication rather than trusted from creation.
 */

export const shortRoutes = Router();

shortRoutes.use(requireAuth);

const CreateSchema = z.object({
  language: LanguageEnum,
  categorySlug: z.string().min(1).max(40),
  sourceSlug: z.string().min(1).max(60),
  title: z.string().min(1).max(80),
  caption: z.string().min(1).max(400),
  credit: z.string().min(1).max(200),
  licence: z.enum(['publisher_licensed', 'agency', 'cc_by', 'own']),
  sourceUrl: z.string().nullable().optional(),
  /** Straight from POST /cms/media/video. */
  durationSeconds: z.number().positive().max(MAX_VIDEO_DURATION_S),
  posterUrl: z.string().min(1),
  posterBlurHash: z.string().min(6),
  renditions: z
    .array(
      z.object({
        quality: z.enum(['low', 'medium', 'high']),
        url: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

function slugFor(title: string, language: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  // A Nepali title transliterates to nothing, so the slug falls back to the
  // language and date rather than becoming a bare random string.
  return `${base || `short-${language}`}-${stamp}-${rand}`;
}

/** GET /cms/shorts — newest first, every status. */
shortRoutes.get(
  '/cms/shorts',
  requireRole('queue.read'),
  asyncRoute(async (_req, res) => {
    const docs = await getDb()
      .collection('videos')
      .find({})
      .sort({ createdAt: -1 })
      .limit(60)
      .toArray();

    res.json({
      items: docs.map((v) => ({
        id: v._id.toString(),
        slug: v.slug,
        status: v.status,
        language: v.language,
        title: v.title,
        caption: v.caption,
        durationSeconds: v.durationSeconds,
        posterUrl: v.posterUrl,
        credit: v.credit,
        sourceName: v.sourceName,
        categorySlug: v.categorySlug,
        publishedAt: v.publishedAt ? (v.publishedAt as Date).toISOString() : null,
        createdAt: (v.createdAt as Date).toISOString(),
      })),
    });
  }),
);

/** POST /cms/shorts — create a draft from an uploaded, transcoded clip. */
shortRoutes.post(
  '/cms/shorts',
  requireRole('article.write'),
  asyncRoute(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'This short is not ready to save.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const c = collections(getDb());
    const d = parsed.data;

    const category = await c.categories.findOne({ slug: d.categorySlug });
    if (!category) throw new AppError('BAD_REQUEST', `No such section: ${d.categorySlug}.`);

    const source = await c.sources.findOne({ slug: d.sourceSlug });
    if (!source) throw new AppError('BAD_REQUEST', `No such publisher: ${d.sourceSlug}.`);

    // The same gate as a story, at the same point: starting work against a
    // publisher we have no agreement with wastes the editor's time, because
    // publication would refuse it at the end.
    if (source.licence?.status !== 'agreed') {
      throw new AppError(
        'VALIDATION_FAILED',
        `${source.displayName} has no agreed licence, so shorts cannot be filed against them.`,
        { licenceStatus: source.licence?.status ?? null },
      );
    }

    const now = new Date();
    const _id = new ObjectId();

    await getDb()
      .collection('videos')
      .insertOne({
        _id,
        slug: slugFor(d.title, d.language),
        status: 'draft',
        language: d.language,
        categoryId: category._id,
        sourceId: source._id,
        publishedAt: null,
        title: d.title,
        caption: d.caption,
        durationSeconds: d.durationSeconds,
        posterUrl: d.posterUrl,
        posterBlurHash: d.posterBlurHash,
        renditions: d.renditions,
        credit: d.credit,
        licence: d.licence,
        sourceUrl: d.sourceUrl ?? null,
        // Denormalised so a video card needs no join, exactly as an article.
        sourceName: source.displayName,
        categorySlug: category.slug,
        categoryLabel: category.label,
        createdAt: now,
        updatedAt: now,
      } as never);

    await writeAudit({
      action: 'short.create',
      entityType: 'video',
      entityId: _id.toString(),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { title: d.title, categorySlug: d.categorySlug, sourceSlug: d.sourceSlug },
      ip: req.ip ?? null,
    });

    res.status(201).json({ id: _id.toString() });
  }),
);

/**
 * POST /cms/shorts/:id/publish
 *
 * Re-asserts the source licence at the moment of publication, for the same
 * reason the article flow does: an agreement can lapse between writing and
 * publishing, and the check that matters is the one taken last.
 */
shortRoutes.post(
  '/cms/shorts/:id/publish',
  requireRole('article.publish'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const c = collections(getDb());
    const videos = getDb().collection('videos');
    const v = await videos.findOne({ _id: new ObjectId(id) });
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') {
      throw new AppError('INVALID_TRANSITION', `A ${v.status} short cannot be published.`);
    }

    const source = await c.sources.findOne({ _id: v.sourceId as ObjectId });
    if (source?.licence?.status !== 'agreed' || !source.isActive) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${source?.displayName ?? 'That publisher'} no longer has an agreed licence.`,
      );
    }

    const now = new Date();
    // Compare-and-swap on the status the check was made against, so a
    // concurrent change makes this match nothing rather than publish on a
    // stale read — the same guarantee publishArticle relies on.
    const result = await videos.updateOne(
      { _id: v._id, status: 'draft' },
      { $set: { status: 'published', publishedAt: now, updatedAt: now } },
    );
    if (result.matchedCount === 0) {
      throw new AppError('INVALID_TRANSITION', 'That short changed while it was being published.');
    }

    await writeAudit({
      action: 'short.publish',
      entityType: 'video',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'draft' },
      after: { status: 'published' },
      ip: req.ip ?? null,
    });

    res.json({ status: 'published', publishedAt: now.toISOString() });
  }),
);

/** POST /cms/shorts/:id/retract — withdraw a published short. */
shortRoutes.post(
  '/cms/shorts/:id/retract',
  requireRole('article.retract'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const videos = getDb().collection('videos');
    const result = await videos.updateOne(
      { _id: new ObjectId(id), status: 'published' },
      { $set: { status: 'retracted', updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      throw new AppError('INVALID_TRANSITION', 'Only a published short can be retracted.');
    }

    await writeAudit({
      action: 'short.retract',
      entityType: 'video',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'published' },
      after: { status: 'retracted' },
      ip: req.ip ?? null,
    });

    res.json({ status: 'retracted' });
  }),
);
