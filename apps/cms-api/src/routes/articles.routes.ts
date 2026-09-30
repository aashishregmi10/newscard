import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import {
  AppError,
  countGraphemes,
  countWords,
  measureSummary,
  type LimitType,
} from '@saar/shared';
import { ArticleStatusEnum, DEFAULT_CONFIG, ImageLicenceEnum } from '@saar/schemas';
import { requireAuth } from '../auth/requireAuth.js';
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

/**
 * GET /cms/published — what a reader can actually see.
 *
 * The queue above deliberately excludes it: a queue is work outstanding, and a
 * published story is work finished. But the finished pile had no screen at all,
 * so the only way to answer "is that story still live" was to open the app and
 * scroll for it.
 *
 * Newest first, unlike the queue. The queue sorts oldest-first so nothing rots
 * at the bottom of a backlog; this is a record rather than a backlog, and the
 * story someone is looking for is almost always a recent one.
 *
 * Paged on the server. It only grows, and 200 rows with no paging is the bug
 * the triage queue had — rows past the cap are not on another page, they are
 * invisible.
 */
const PublishedQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(['published', 'retracted']).default('published'),
});

articleRoutes.get(
  '/cms/published',
  asyncRoute(async (req, res) => {
    const parsed = PublishedQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown query.');
    const { page, perPage, status } = parsed.data;

    const c = collections(getDb());
    const filter = { status };

    const [total, docs, retractedCount, publishedCount] = await Promise.all([
      c.articles.countDocuments(filter),
      c.articles
        .find(filter)
        .sort({ publishedAt: -1, _id: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .toArray(),
      c.articles.countDocuments({ status: 'retracted' }),
      c.articles.countDocuments({ status: 'published' }),
    ]);

    res.json({
      total,
      counts: { published: publishedCount, retracted: retractedCount },
      items: docs.map((d) => ({
        id: d._id.toString(),
        slug: d.slug,
        status: d.status,
        language: d.language,
        headline: d.headline,
        sourceName: d.sourceName,
        categorySlug: d.categorySlug,
        categoryLabel: d.categoryLabel,
        publisherUrl: d.publisherUrl,
        publishedAt: d.publishedAt?.toISOString() ?? null,
        retractionReason: d.retractionReason ?? null,
        retractedAt: d.retractedAt?.toISOString() ?? null,
        lastEditedAt: d.lastEditedAt?.toISOString() ?? null,
        lastEditReason: d.lastEditReason ?? null,
        hasImage: d.image !== null && d.image !== undefined,
      })),
    });
  }),
);

/** GET /cms/articles/:id — everything the composer needs, in one request. */
articleRoutes.get(
  '/cms/articles/:id',
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

    /*
     * The original, for a draft that came from a lead.
     *
     * It is fetched from `leads` rather than copied onto the article, and that
     * is the whole design: the publisher’s own words never enter the
     * `articles` collection, so they cannot reach a reader through a DTO that
     * grows a field, and they expire on the lead’s own 30-day clock rather
     * than living as long as the story does.
     *
     * A hand-written story has no lead and gets null, which is correct — there
     * is no original to show.
     */
    const lead = await c.leads.findOne(
      { promotedArticleId: d._id },
      { projection: { headline: 1, feedExtract: 1, feedContent: 1, canonicalUrl: 1 } },
    );

    res.json({
      limits,
      /* Not nested inside `article`, deliberately: it is not a property of our
         story, it is the thing our story is about. */
      original:
        lead === null
          ? null
          : {
              headline: lead.headline,
              text: (lead as { feedContent?: string | null }).feedContent ?? lead.feedExtract,
              url: lead.canonicalUrl,
            },
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
        publishedAt: d.publishedAt?.toISOString() ?? null,
        retractedAt: d.retractedAt?.toISOString() ?? null,
        retractionReason: d.retractionReason ?? null,
        lastEditedAt: d.lastEditedAt?.toISOString() ?? null,
        lastEditReason: d.lastEditReason ?? null,
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

/**
 * A media URL, relative OR absolute.
 *
 * `ArticleImage.urls` in @saar/schemas uses `z.string().url()`, which a
 * relative path fails — and relative is what this system deliberately stores
 * outside production, so the URLs survive the development machine's IP
 * changing. Production sets CDN_BASE_URL and they become absolute.
 *
 * Declared here rather than by loosening the shared schema: that one is the
 * storage contract and the DTO-leak test asserts against it.
 */
const MediaUrl = z
  .string()
  .min(1)
  .refine((u) => u.startsWith('/') || /^https?:\/\//i.test(u), {
    message: 'must be an absolute URL or a path beginning with /',
  });

/**
 * The image, as the composer sends it back after an upload.
 *
 * Credit and licence are required whenever there is an image at all, because
 * an uncredited photograph is the highest legal risk this product carries and
 * publishing refuses one without a recognised licence. Setting `image` to null
 * removes it, which is how an editor changes their mind.
 */
const ImagePatch = z
  .object({
    credit: z.string().min(1),
    licence: ImageLicenceEnum,
    blurHash: z.string().min(6).nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    urls: z.object({
      sm: MediaUrl.nullable().optional(),
      md: MediaUrl.nullable().optional(),
      lg: MediaUrl.nullable().optional(),
    }),
  })
  .nullable();

const PatchSchema = z.object({
  headline: z.string().min(1).max(90).optional(),
  summary: z.string().min(1).max(1200).optional(),
  pullQuote: z.string().max(70).nullable().optional(),
  image: ImagePatch.optional(),
});

/** PATCH /cms/articles/:id — autosave from the composer. */
articleRoutes.patch(
  '/cms/articles/:id',
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

    /*
     * A published article is not a draft, and this is the autosave route.
     *
     * Silently rewriting what a reader already saw, on a 1.5-second timer,
     * with no record of what changed or why, is the one newsroom failure that
     * costs more than the error being fixed. Corrections to a live story go
     * through POST /cms/articles/:id/edit, which demands a reason, stamps the
     * time, and writes the before and after into the audit trail.
     */
    if (existing.status === 'published' || existing.status === 'retracted') {
      throw new AppError(
        'INVALID_TRANSITION',
        existing.status === 'published'
          ? 'This story is live, so it is corrected rather than autosaved. Use the edit screen, which records your reason.'
          : 'This story was withdrawn and is no longer edited.',
      );
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

/** POST /cms/articles/:id/transition — submit, approve, reject, spike. */
articleRoutes.post(
  '/cms/articles/:id/transition',
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
  asyncRoute(async (req, res) => {
    const Body = z.object({ scheduledFor: z.coerce.date().optional() });
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Invalid schedule date.');

    const result = await publishArticle({
      articleId: String(req.params.id ?? ''),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      ip: req.ip ?? null,
      scheduledFor: parsed.data.scheduledFor,
    });

    res.json(result);
  }),
);

/** POST /cms/articles/:id/retract */
articleRoutes.post(
  '/cms/articles/:id/retract',
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

/**
 * POST /cms/articles/:id/edit — correct a story a reader has already seen.
 *
 * ── Why this is a route of its own and not PATCH ────────────────────────
 *
 * PATCH is the composer autosave: it fires on a 1.5-second timer and records
 * nothing about what changed. That is right for a draft and wrong for a story
 * that is already out, where the question asked afterwards is never "what does
 * it say now" but "what did it say before, and who changed it, and why".
 *
 * So this one is deliberate rather than automatic: it takes the whole text at
 * once, demands a reason, stamps the time, and writes the before and after to
 * the audit trail. There is no autosave on a live story.
 *
 * ── Why the story is edited in place rather than replaced ───────────────
 *
 * An earlier attempt withdrew the story and opened a copy of it as a fresh
 * draft, on the reasoning that a published story should be immutable. It could
 * not work, and the failure is instructive: `publisher_url_unique` allows
 * exactly one article per publisher URL, so the copy was refused by the index
 * — after the original had already been retracted. Two live stories were
 * pulled and neither replacement was ever created.
 *
 * The index is not the obstacle, it is the design: this collection holds one
 * row per publisher story for the whole life of that story. Correcting it
 * means changing that row, and the history lives where history belongs.
 *
 * ── What is deliberately NOT changed ───────────────────────────────
 *
 * `publishedAt`. It is half of the feed cursor and the whole of the sort
 * order, so touching it would move a three-day-old story to the top of every
 * reader feed and duplicate or skip cards for anyone paging at that moment. A
 * corrected story stays where it was published.
 *
 * `status`, for the reason it is not re-approved either: this route corrects a
 * live story, it does not take one down. That is withdrawal, and it is next
 * door.
 */
const EditSchema = z.object({
  headline: z.string().min(1).max(90),
  summary: z.string().min(1).max(1200),
  pullQuote: z.string().max(70).nullable().optional(),
  /* Absent leaves the picture alone; null removes it. The same convention as
     the autosave route, so the composer and the edit screen agree. */
  image: ImagePatch.optional(),
  reason: z.string().min(10).max(300),
});

articleRoutes.post(
  '/cms/articles/:id/edit',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed id.');

    const parsed = EditSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A headline, a summary and a reason of at least ten characters are all required.',
        {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      );
    }

    const reason = parsed.data.reason.trim();
    if (reason.length < 10) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Say why this is being changed, in at least ten characters. It is kept with the story.',
      );
    }

    const c = collections(getDb());
    const existing = await c.articles.findOne({ _id: new ObjectId(id) });
    if (!existing) throw new AppError('NOT_FOUND');

    if (existing.status !== 'published') {
      throw new AppError(
        'INVALID_TRANSITION',
        existing.status === 'retracted'
          ? 'This story was withdrawn. A withdrawal is final, and a replacement is written as a new story.'
          : `Only a live story is corrected this way. This one is ${existing.status}, so it is edited in the composer.`,
        { status: existing.status },
      );
    }

    /*
     * The publish preconditions that are about the CONTENT, run again.
     *
     * They were checked when the story went out, against text that has just
     * been replaced. Skipping them here would make this route the one way to
     * put a two-word summary or an uncredited photograph in front of a reader
     * — through the screen whose whole purpose is fixing mistakes.
     *
     * What is NOT re-checked is the source licence. If an agreement has lapsed
     * the story should come down, and that is a withdrawal; refusing the
     * correction would leave a wrong story up and forbid fixing it.
     */
    const headline = parsed.data.headline.trim();
    if (countGraphemes(headline) < 10) {
      throw new AppError('VALIDATION_FAILED', 'The headline is too short to publish.');
    }

    const cfg = (await c.config.findOne({})) ?? DEFAULT_CONFIG;
    const limits = cfg.summaryLimits ?? DEFAULT_CONFIG.summaryLimits;
    const band = limits.limits[existing.language];
    const measured = measureSummary(
      parsed.data.summary,
      limits.limitType as LimitType,
      existing.language,
    );
    if (measured < band.min || measured > band.max) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Summary is ${measured} ${limits.limitType}; allowed ${band.min}–${band.max}.`,
        { measured, min: band.min, max: band.max, unit: limits.limitType },
      );
    }

    const image = parsed.data.image === undefined ? existing.image : parsed.data.image;
    if (image) {
      const valid = ['publisher_licensed', 'agency', 'cc_by', 'own'];
      if (!image.licence || !valid.includes(image.licence)) {
        throw new AppError('VALIDATION_FAILED', 'Image has no recognised licence.');
      }
      if (!image.credit) throw new AppError('VALIDATION_FAILED', 'Image has no credit.');
    }

    const now = new Date();

    /* Compare-and-swap on the status, as publishing does. If someone withdrew
       this story while the edit was being written the filter matches nothing,
       and we refuse rather than quietly editing a story that is now down. */
    /* Typed loosely for the same reason the autosave route is: the collection
       type describes ids as strings, and the stored value is an ObjectId. */
    const set: Record<string, unknown> = {
      headline,
      summary: parsed.data.summary,
      /* Recomputed here, never taken from the client: the publish gate and the
         reader app both read these. */
      summaryWordCount: countWords(parsed.data.summary),
      summaryCharCount: countGraphemes(parsed.data.summary),
      pullQuote: parsed.data.pullQuote ?? existing.pullQuote ?? null,
      lastEditedAt: now,
      lastEditedBy: new ObjectId(req.staff!.staffId),
      lastEditReason: reason,
      updatedAt: now,
    };
    if (parsed.data.image !== undefined) set.image = parsed.data.image;

    const write = await c.articles.updateOne(
      { _id: existing._id, status: 'published' },
      /* Not `revisionCount`. That already means "sent back to the author in
         review" and the transition service counts it; folding live
         corrections into the same number would make both meaningless. */
      { $set: set },
    );

    if (write.matchedCount === 0) {
      throw new AppError(
        'INVALID_TRANSITION',
        'This story was withdrawn while you were editing it, so nothing has been saved.',
      );
    }

    /* The whole before and after, not a diff. The trail is read long afterwards
       by someone who needs to know what the story said, and a diff of text they
       no longer have is not an answer. */
    await writeAudit({
      action: 'article.edit',
      entityType: 'article',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: {
        headline: existing.headline,
        summary: existing.summary,
        pullQuote: existing.pullQuote ?? null,
        image: existing.image ?? null,
      },
      after: {
        headline,
        summary: parsed.data.summary,
        pullQuote: parsed.data.pullQuote ?? existing.pullQuote ?? null,
        image: image ?? null,
        reason,
      },
      ip: req.ip ?? null,
    });

    res.json({ ok: true, lastEditedAt: now.toISOString() });
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
export function draftSlug(language: string, categorySlug: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${categorySlug}-${language}-${stamp}-${rand}`;
}

articleRoutes.post(
  '/cms/articles',
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
