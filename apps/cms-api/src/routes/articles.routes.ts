import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError, measureSummary, countGraphemes, countWords, type LimitType } from '@saar/shared';
import { ArticleStatusEnum, DEFAULT_CONFIG } from '@saar/schemas';
import { requireRole, requireAuth } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';
import { transitionArticle } from '../services/transition.service.js';
import { publishArticle, retractArticle } from '../services/publish.service.js';
import { writeAudit } from '../audit/writeAudit.js';

export const articleRoutes = Router();

/** Everything below needs a signed-in editor. */
articleRoutes.use(requireAuth);

/**
 * GET /cms/queue — the editorial queue.  Spec Ch. 5.3.
 *
 * The landing screen. Ordered oldest-first within status so nothing rots at the
 * bottom: a queue sorted newest-first quietly starves its own backlog.
 */
articleRoutes.get(
  '/cms/queue',
  requireRole('queue.read'),
  asyncRoute(async (req, res) => {
    const status = z
      .array(ArticleStatusEnum)
      .default(['draft', 'in_review', 'approved'])
      .parse(
        typeof req.query.status === 'string'
          ? String(req.query.status).split(',')
          : undefined,
      );

    const c = collections(getDb());
    const docs = await c.articles
      .find({ status: { $in: status } })
      .sort({ createdAt: 1 })
      .limit(200)
      .toArray();

    const cfg = (await c.config.findOne({})) ?? DEFAULT_CONFIG;
    const limits = cfg.summaryLimits ?? DEFAULT_CONFIG.summaryLimits;

    res.json({
      limits,
      items: docs.map((d) => ({
        id: d._id.toString(),
        status: d.status,
        language: d.language,
        headline: d.headline,
        sourceName: d.sourceName,
        categorySlug: d.categorySlug,
        createdAt: d.createdAt.toISOString(),
        measured: measureSummary(d.summary, limits.limitType as LimitType, d.language),
        possibleDuplicate: d.possibleDuplicate,
        possibleLanguageMismatch: d.possibleLanguageMismatch,
        clusterId: d.clusterId?.toString() ?? null,
        authoredBy: d.authoredBy.toString(),
      })),
    });
  }),
);

/** GET /cms/articles/:id — everything the composer needs, in one request. */
articleRoutes.get(
  '/cms/articles/:id',
  requireRole('queue.read'),
  asyncRoute(async (req, res) => {
    const c = collections(getDb());
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const d = await c.articles.findOne({ _id: new ObjectId(id) });
    if (!d) throw new AppError('NOT_FOUND');

    const cfg = (await c.config.findOne({})) ?? DEFAULT_CONFIG;
    const limits = cfg.summaryLimits ?? DEFAULT_CONFIG.summaryLimits;

    // Cluster siblings — "4 sources covering this" (plan §2b). The whole point
    // is that the editor summarises once instead of four times.
    const siblings = d.clusterId
      ? await c.articles
          .find({ clusterId: d.clusterId, _id: { $ne: d._id } })
          .project({ headline: 1, sourceName: 1, language: 1, publisherUrl: 1 })
          .toArray()
      : [];

    res.json({
      limits,
      article: {
        id: d._id.toString(),
        status: d.status,
        language: d.language,
        headline: d.headline,
        summary: d.summary,
        pullQuote: d.pullQuote ?? null,
        categorySlug: d.categorySlug,
        sourceName: d.sourceName,
        publisherUrl: d.publisherUrl,
        publisherAuthor: d.publisherAuthor ?? null,
        image: d.image,
        editorialNotes: d.editorialNotes ?? null,
        revisionCount: d.revisionCount,
        authoredBy: d.authoredBy.toString(),
        measured: measureSummary(d.summary, limits.limitType as LimitType, d.language),
      },
      cluster: siblings.map((s) => ({
        id: s._id.toString(),
        headline: s.headline,
        sourceName: s.sourceName,
        language: s.language,
        publisherUrl: s.publisherUrl,
      })),
    });
  }),
);

const PatchSchema = z.object({
  headline: z.string().min(1).max(90).optional(),
  summary: z.string().min(1).max(1200).optional(),
  pullQuote: z.string().max(70).nullable().optional(),
});

/** PATCH /cms/articles/:id — autosave from the composer. */
articleRoutes.patch(
  '/cms/articles/:id',
  requireRole('article.write'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid field values.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const c = collections(getDb());
    const existing = await c.articles.findOne({ _id: new ObjectId(id) });
    if (!existing) throw new AppError('NOT_FOUND');

    // A published article is not a draft. Corrections go through retract and
    // republish so the change is visible in the audit trail.
    if (existing.status === 'published' || existing.status === 'retracted') {
      throw new AppError('INVALID_TRANSITION', `Cannot edit an article that is ${existing.status}.`);
    }

    const set: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.summary !== undefined) {
      // Recomputed server-side. A client-supplied count is a client-supplied
      // opinion, and the publish gate must not trust it.
      set.summaryWordCount = countWords(parsed.data.summary);
      set.summaryCharCount = countGraphemes(parsed.data.summary);
    }

    await c.articles.updateOne({ _id: existing._id }, { $set: set });
    res.json({ ok: true, savedAt: new Date().toISOString() });
  }),
);

/** POST /cms/articles/:id/transition — submit, reject, spike. */
articleRoutes.post(
  '/cms/articles/:id/transition',
  requireRole('article.submit'),
  asyncRoute(async (req, res) => {
    const Body = z.object({
      to: ArticleStatusEnum,
      note: z.string().optional(),
      spikeReason: z.enum(['editorial', 'clustered', 'duplicate', 'stale']).optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'A target status is required.');

    const status = await transitionArticle({
      articleId: String(req.params.id ?? ''),
      to: parsed.data.to,
      note: parsed.data.note,
      spikeReason: parsed.data.spikeReason,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      ip: req.ip ?? null,
    });

    res.json({ status });
  }),
);

/** POST /cms/articles/:id/publish */
articleRoutes.post(
  '/cms/articles/:id/publish',
  requireRole('article.publish'),
  asyncRoute(async (req, res) => {
    const Body = z.object({ scheduledFor: z.coerce.date().optional() });
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Invalid schedule date.');

    const result = await publishArticle({
      articleId: String(req.params.id ?? ''),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      actorRole: req.staff!.role,
      actorLanguages: req.staff!.languages,
      ip: req.ip ?? null,
      scheduledFor: parsed.data.scheduledFor,
    });

    res.json(result);
  }),
);

/** POST /cms/articles/:id/retract */
articleRoutes.post(
  '/cms/articles/:id/retract',
  requireRole('article.retract'),
  asyncRoute(async (req, res) => {
    const Body = z.object({ reason: z.string().min(10) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'A retraction reason of at least 10 characters is required.');
    }

    await retractArticle({
      articleId: String(req.params.id ?? ''),
      reason: parsed.data.reason,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      ip: req.ip ?? null,
    });

    res.json({ ok: true });
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * Creating a story.
 *
 * This is the route the whole product turns on and it was missing: the queue
 * could list, the composer could edit, the workflow could publish — and there
 * was no way to bring an article into existence. Manual entry is the launch
 * content strategy (ingestion is a later phase), so without this nobody could
 * put a single story into the app.
 *
 * A new article starts almost empty on purpose. The composer autosaves through
 * PATCH, so requiring a finished headline and summary up front would mean the
 * editor writes into a form that cannot be saved until it is complete. What IS
 * required is the three things that decide where the story belongs and cannot
 * be inferred later: language, section and publisher.
 * ──────────────────────────────────────────────────────────────────────────── */

const CreateSchema = z.object({
  language: z.enum(['ne', 'en']),
  categorySlug: z.string().min(1).max(40),
  sourceSlug: z.string().min(1).max(60),
  headline: z.string().max(90).optional(),
});

/**
 * A slug that is unique, readable, and never derived from a headline the editor
 * has not written yet. Devanagari is transliterated away rather than
 * percent-encoded, because the slug ends up in a shareable URL.
 */
function draftSlug(language: string, categorySlug: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${categorySlug}-${language}-${stamp}-${rand}`;
}

articleRoutes.post(
  '/cms/articles',
  requireRole('article.write'),
  asyncRoute(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Language, section and publisher are required.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const c = collections(getDb());
    const { language, categorySlug, sourceSlug } = parsed.data;

    const category = await c.categories.findOne({ slug: categorySlug });
    if (!category) throw new AppError('BAD_REQUEST', `No such section: ${categorySlug}.`);

    const source = await c.sources.findOne({ slug: sourceSlug });
    if (!source) throw new AppError('BAD_REQUEST', `No such publisher: ${sourceSlug}.`);

    // The licence gate, checked at creation as well as at publication. Starting
    // a story against a publisher we have no agreement with wastes the editor's
    // time — the publish precondition would refuse it at the end.
    if (source.licence?.status !== 'agreed') {
      throw new AppError(
        'VALIDATION_FAILED',
        `${source.displayName} has no agreed licence, so stories cannot be written against it.`,
        { licenceStatus: source.licence?.status ?? null },
      );
    }

    const now = new Date();
    const _id = new ObjectId();

    await c.articles.insertOne({
      _id,
      slug: draftSlug(language, categorySlug),
      status: 'draft',
      language,
      categoryId: category._id,
      sourceId: source._id,
      publishedAt: null,
      headline: parsed.data.headline ?? '',
      summary: '',
      summaryWordCount: 0,
      summaryCharCount: 0,
      pullQuote: null,
      publisherUrl: source.homepageUrl,
      publisherAuthor: null,
      publisherPublishedAt: null,
      tags: [],
      clusterId: null,
      originatingAgency: null,
      image: null,
      // Denormalised at creation so the queue and the feed never need a join.
      sourceName: source.displayName,
      sourceLogoUrl: source.logoUrl ?? null,
      categorySlug: category.slug,
      categoryLabel: category.label,
      authoredBy: new ObjectId(req.staff!.staffId),
      reviewedBy: null,
      selfApproved: false,
      // Written by a person. Recorded from day one so that when a machine draft
      // arrives later there is a human baseline to measure it against (Ch. 4.7).
      draftSource: 'human',
      revisionCount: 0,
      possibleDuplicate: false,
      possibleLanguageMismatch: false,
      createdAt: now,
      updatedAt: now,
    } as never);

    await writeAudit({
      action: 'article.create',
      entityType: 'article',
      entityId: _id.toString(),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { language, categorySlug, sourceSlug, status: 'draft' },
      ip: req.ip ?? null,
    });

    res.status(201).json({ id: _id.toString() });
  }),
);

/**
 * GET /cms/options — the sections and publishers a new story can be filed
 * against.
 *
 * Publishers with no agreed licence are returned but marked, rather than hidden.
 * An editor who cannot find a publisher they expect needs to know it is a
 * licensing question, not a bug.
 */
articleRoutes.get(
  '/cms/options',
  requireRole('queue.read'),
  asyncRoute(async (_req, res) => {
    const c = collections(getDb());
    const [categories, sources] = await Promise.all([
      c.categories.find({ isActive: true }).sort({ order: 1 }).toArray(),
      c.sources.find({ isActive: true }).sort({ priority: 1 }).toArray(),
    ]);

    res.json({
      categories: categories
        // `top` is virtual — it is the mixed feed, and no article is filed there.
        .filter((cat) => cat.slug !== 'top' && cat.slug !== 'all')
        .map((cat) => ({ slug: cat.slug, label: cat.label })),
      sources: sources.map((s) => ({
        slug: s.slug,
        displayName: s.displayName,
        language: s.language,
        licensed: s.licence?.status === 'agreed',
      })),
    });
  }),
);
