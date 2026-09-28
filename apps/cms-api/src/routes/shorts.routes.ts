import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError, can, type StaffRole } from '@saar/shared';
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

const Rendition = z.object({
  quality: z.enum(['low', 'medium', 'high']),
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
});

const Licence = z.enum(['publisher_licensed', 'agency', 'cc_by', 'own']);

const CreateSchema = z.object({
  language: LanguageEnum,
  categorySlug: z.string().min(1).max(40),
  sourceSlug: z.string().min(1).max(60),
  title: z.string().min(1).max(80),
  caption: z.string().min(1).max(400),
  credit: z.string().min(1).max(200),
  licence: Licence,
  sourceUrl: z.string().nullable().optional(),
  /** Straight from POST /cms/media/video. */
  durationSeconds: z.number().positive().max(MAX_VIDEO_DURATION_S),
  posterUrl: z.string().min(1),
  posterBlurHash: z.string().min(6),
  renditions: z.array(Rendition).min(1),
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

/**
 * GET /cms/shorts — newest first, every status, a page at a time.
 *
 * It returned the newest 60 and stopped, and the screen paged those 60 in
 * the browser. So the 61st short was not on another page — it was nowhere,
 * with nothing on screen to say the list had been cut. The same bug the
 * triage queue had at 200, fixed the same way: the server pages and says how
 * many there are in total.
 *
 * `_id` breaks ties, so two shorts saved in the same millisecond cannot swap
 * places between one page request and the next and appear twice.
 */
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
});

shortRoutes.get(
  '/cms/shorts',
  requireRole('queue.read'),
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown query.');
    const { page, perPage } = parsed.data;

    const videos = getDb().collection('videos');
    const [total, docs] = await Promise.all([
      videos.countDocuments({}),
      videos
        .find({})
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .toArray(),
    ]);

    res.json({
      total,
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
        lastEditedAt: v.lastEditedAt ? (v.lastEditedAt as Date).toISOString() : null,
        lastEditReason: (v.lastEditReason as string | undefined) ?? null,
        retractionReason: (v.retractionReason as string | undefined) ?? null,
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

/** GET /cms/shorts/:id — everything the edit screen needs. */
shortRoutes.get(
  '/cms/shorts/:id',
  requireRole('queue.read'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const v = await getDb().collection('videos').findOne({ _id: new ObjectId(id) });
    if (!v) throw new AppError('NOT_FOUND');

    const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);
    res.json({
      short: {
        id: v._id.toString(),
        slug: v.slug,
        status: v.status,
        language: v.language,
        title: v.title,
        caption: v.caption,
        credit: v.credit,
        licence: v.licence,
        durationSeconds: v.durationSeconds,
        posterUrl: v.posterUrl,
        posterBlurHash: v.posterBlurHash ?? null,
        renditions: v.renditions,
        sourceName: v.sourceName,
        categorySlug: v.categorySlug,
        publishedAt: iso(v.publishedAt),
        createdAt: iso(v.createdAt),
        retractedAt: iso(v.retractedAt),
        retractionReason: v.retractionReason ?? null,
        lastEditedAt: iso(v.lastEditedAt),
        lastEditReason: v.lastEditReason ?? null,
      },
    });
  }),
);

/**
 * POST /cms/shorts/:id/edit — change a short after it was saved.
 *
 * ── Draft and live are edited through one route, under different rules ─────
 *
 * A draft is nobody’s business but the newsroom’s, so it is edited freely by
 * anyone who may write. A live short is what readers are being shown, so it
 * follows the article rule exactly: it takes the permission publishing takes,
 * a reason of at least ten characters, and the time and reason are stamped on
 * the record. A withdrawn short is final and is not edited at all.
 *
 * ── What can change ────────────────────────────────────────────────────────
 *
 * Everything the upload form asked except the publisher. The words, the
 * section, the language, the credit and licence, and the clip itself — a
 * wrong file is the likeliest mistake of all. The publisher is fixed because
 * it decides which licence the short was filed under; a clip from someone else
 * is a different short, and is uploaded as one.
 *
 * `publishedAt` is never touched, for the reason given on the article route:
 * it is the sort order, and a correction must not float an old clip back to
 * the top of the tab.
 */
const EditSchema = z.object({
  language: LanguageEnum,
  categorySlug: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  caption: z.string().trim().min(1).max(400),
  credit: z.string().trim().min(1).max(200),
  licence: Licence,
  /** Present only when the clip was replaced. Straight from POST /cms/media/video. */
  clip: z
    .object({
      durationSeconds: z.number().positive().max(MAX_VIDEO_DURATION_S),
      posterUrl: z.string().min(1),
      posterBlurHash: z.string().min(6),
      renditions: z.array(Rendition).min(1),
    })
    .optional(),
  /** Required for a live short; ignored for a draft. */
  reason: z.string().max(300).optional(),
});

shortRoutes.post(
  '/cms/shorts/:id/edit',
  requireRole('article.write'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const parsed = EditSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'A title, a caption and a credit are all required.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const d = parsed.data;

    const c = collections(getDb());
    const videos = getDb().collection('videos');
    const v = await videos.findOne({ _id: new ObjectId(id) });
    if (!v) throw new AppError('NOT_FOUND');

    if (v.status === 'retracted') {
      throw new AppError(
        'INVALID_TRANSITION',
        'This short was withdrawn. A withdrawal is final, so it is no longer edited.',
      );
    }

    const live = v.status === 'published';
    const reason = (d.reason ?? '').trim();
    if (live) {
      if (!can(req.staff!.role as StaffRole, 'article.publish')) {
        throw new AppError(
          'FORBIDDEN',
          'Editing a live short needs a reviewer or an admin, as publishing one does.',
        );
      }
      if (reason.length < 10) {
        throw new AppError(
          'VALIDATION_FAILED',
          'This short is live, so say why it is being changed, in at least ten characters. It is kept with the short.',
        );
      }
    }

    const category = await c.categories.findOne({ slug: d.categorySlug });
    if (!category) throw new AppError('BAD_REQUEST', `No such section: ${d.categorySlug}.`);

    const now = new Date();
    const set: Record<string, unknown> = {
      language: d.language,
      title: d.title,
      caption: d.caption,
      credit: d.credit,
      licence: d.licence,
      categoryId: category._id,
      categorySlug: category.slug,
      categoryLabel: category.label,
      updatedAt: now,
    };
    if (d.clip !== undefined) {
      set.durationSeconds = d.clip.durationSeconds;
      set.posterUrl = d.clip.posterUrl;
      set.posterBlurHash = d.clip.posterBlurHash;
      set.renditions = d.clip.renditions;
    }
    if (live) {
      set.lastEditedAt = now;
      set.lastEditedBy = new ObjectId(req.staff!.staffId);
      set.lastEditReason = reason;
    }

    /* Compare-and-swap on the status the checks were made against. A short
       published or withdrawn by someone else mid-edit changes which rules
       apply, so the edit is refused rather than applied under the old ones. */
    const write = await videos.updateOne({ _id: v._id, status: v.status }, { $set: set });
    if (write.matchedCount === 0) {
      throw new AppError(
        'INVALID_TRANSITION',
        'This short changed while you were editing it, so nothing has been saved. Reload and try again.',
      );
    }

    await writeAudit({
      action: 'short.edit',
      entityType: 'video',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: {
        status: v.status,
        language: v.language,
        categorySlug: v.categorySlug,
        title: v.title,
        caption: v.caption,
        credit: v.credit,
        licence: v.licence,
        posterUrl: v.posterUrl,
      },
      after: {
        status: v.status,
        language: d.language,
        categorySlug: category.slug,
        title: d.title,
        caption: d.caption,
        credit: d.credit,
        licence: d.licence,
        posterUrl: d.clip?.posterUrl ?? v.posterUrl,
        clipReplaced: d.clip !== undefined,
        ...(live ? { reason } : {}),
      },
      ip: req.ip ?? null,
    });

    res.json({ ok: true, lastEditedAt: live ? now.toISOString() : null });
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

/**
 * POST /cms/shorts/:id/retract — withdraw a published short.
 *
 * It took no reason, and was one unconfirmed click on the library row. A
 * withdrawal is final and is the one act most likely to be asked about
 * later, so it now asks for a reason exactly as an article withdrawal does,
 * and keeps it on the record.
 */
shortRoutes.post(
  '/cms/shorts/:id/retract',
  requireRole('article.retract'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const parsed = z.object({ reason: z.string() }).safeParse(req.body);
    const reason = parsed.success ? parsed.data.reason.trim() : '';
    if (reason.length < 10) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A reason of at least 10 characters is required to withdraw a short.',
      );
    }

    const videos = getDb().collection('videos');
    const now = new Date();
    const result = await videos.updateOne(
      { _id: new ObjectId(id), status: 'published' },
      {
        $set: {
          status: 'retracted',
          retractedAt: now,
          retractionReason: reason,
          updatedAt: now,
        },
      },
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
      after: { status: 'retracted', retractionReason: reason },
      ip: req.ip ?? null,
    });

    res.json({ status: 'retracted' });
  }),
);
