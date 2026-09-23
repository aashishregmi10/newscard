import { Router } from 'express';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import {
  IngestMethodEnum,
  LanguageEnum,
  LicenceStatusEnum,
  Source,
  isPollable,
} from '@saar/schemas';
import { requireAuth, requireRole } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';
import { setSourceLicence } from '../services/sources.service.js';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Publisher administration.  Spec Ch. 3.5.
 *
 * -- Why this exists ---------------------------------------------------------
 *
 * The `sources` collection was writable only by `scripts/seed.ts`. Adding a
 * publisher, recording their feed URL or changing their licence status meant
 * editing a script and re-seeding the database. Meanwhile `source.read`,
 * `source.write` and `source.setLicence` had been in the permission matrix from
 * the beginning with no route behind any of them.
 *
 * This is also the tool for running Gate 1: five licensing conversations, what
 * each publisher agreed to, and who to contact for a takedown.
 *
 * -- Why the licence is a separate endpoint ---------------------------------
 *
 * Adding a publisher to the list and asserting that we have their agreement are
 * two different acts, and the permission matrix already says so — `source.write`
 * is admin, `source.setLicence` is admin, but they are separate rows and can be
 * separated later. Creation therefore CANNOT set a licence: a new publisher
 * always starts `pending`, whatever the request body says. Folding the licence
 * into POST or PATCH would make a change of legal position indistinguishable
 * from swapping a logo in the audit trail.
 *
 * -- Why there is no delete ---------------------------------------------------
 *
 * `isActive: false` instead. Articles reference a source by id and
 * `publishArticle` throws 'Article has no source.' if the referenced document
 * has gone — so deleting a publisher breaks every story ever filed against them,
 * including the published ones we are obliged to keep attributed.
 */

export const sourceRoutes = Router();

sourceRoutes.use(requireAuth);

/* ------------------------------------------------------------------ schemas */

const SLUG = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits and hyphens only.');

/**
 * The ingest fields an editor may set.
 *
 * `lastPolledAt`, `lastSuccessAt` and `consecutiveFailures` are deliberately
 * absent: they are written by the poller and are a report on what happened, not
 * a setting. Accepting them here would let a form overwrite the telemetry it is
 * displaying.
 */
const IngestCreate = z.object({
  method: IngestMethodEnum,
  feedUrl: z.string().url().nullable().optional(),
  /* The floor of 5 is the schema's and the database validator's, to be polite
     to the publisher's servers. The ceiling is this route's: a once-a-day poll
     interval is a typo, not a policy. */
  pollIntervalMin: z.number().int().min(5).max(1440).default(15),
});

/* Written out rather than `IngestCreate.partial()`, because `.partial()` over a
   field carrying `.default()` is a subtlety nobody should have to reason about
   at a call site. */
const IngestPatch = z.object({
  method: IngestMethodEnum.optional(),
  feedUrl: z.string().url().nullable().optional(),
  pollIntervalMin: z.number().int().min(5).max(1440).optional(),
});

const CreateSchema = z.object({
  slug: SLUG,
  displayName: z.string().min(1).max(120),
  homepageUrl: z.string().url(),
  logoUrl: z.string().url().nullable().optional(),
  language: LanguageEnum,
  ingest: IngestCreate,
  priority: z.number().int().min(0).max(999).default(50),
  isActive: z.boolean().default(true),
});

/** `slug` is absent on purpose — it is the address, not a field. See below. */
const PatchSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  homepageUrl: z.string().url().optional(),
  logoUrl: z.string().url().nullable().optional(),
  language: LanguageEnum.optional(),
  ingest: IngestPatch.optional(),
  priority: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

const LicenceSchema = z.object({
  status: LicenceStatusEnum,
  agreementRef: z.string().min(1).max(200).nullable().optional(),
  agreedAt: z.coerce.date().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  note: z.string().max(500).optional(),
});

/* ---------------------------------------------------------------- helpers */

function issuesOf(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

interface SourceDoc {
  slug: string;
  displayName: string;
  homepageUrl: string;
  logoUrl?: string | null;
  language: string;
  licence?: {
    status?: string;
    agreementRef?: string | null;
    agreedAt?: Date | null;
    contactEmail?: string | null;
  } | null;
  ingest?: {
    method?: string;
    feedUrl?: string | null;
    pollIntervalMin?: number;
    lastPolledAt?: Date | null;
    lastSuccessAt?: Date | null;
    consecutiveFailures?: number;
  } | null;
  priority?: number;
  isActive?: boolean;
}

function toRow(s: SourceDoc) {
  return {
    slug: s.slug,
    displayName: s.displayName,
    homepageUrl: s.homepageUrl,
    logoUrl: s.logoUrl ?? null,
    language: s.language,
    priority: s.priority ?? 50,
    isActive: s.isActive ?? true,
    licence: {
      status: s.licence?.status ?? 'unknown',
      agreementRef: s.licence?.agreementRef ?? null,
      agreedAt: s.licence?.agreedAt?.toISOString() ?? null,
      contactEmail: s.licence?.contactEmail ?? null,
    },
    ingest: {
      method: s.ingest?.method ?? 'manual',
      feedUrl: s.ingest?.feedUrl ?? null,
      pollIntervalMin: s.ingest?.pollIntervalMin ?? 15,
      lastPolledAt: s.ingest?.lastPolledAt?.toISOString() ?? null,
      lastSuccessAt: s.ingest?.lastSuccessAt?.toISOString() ?? null,
      consecutiveFailures: s.ingest?.consecutiveFailures ?? 0,
    },
    /* `isPollable` gains its first caller. It is precisely the question this
       screen answers — would we poll this, once polling exists — and giving the
       client the predicate's own answer stops the UI reimplementing it. */
    pollable: isPollable({
      isActive: s.isActive ?? true,
      licence: { status: s.licence?.status ?? 'unknown' },
      ingest: { method: s.ingest?.method ?? 'manual' },
    }),
  };
}

/* ----------------------------------------------------------------- routes */

/**
 * GET /cms/sources — every publisher.
 *
 * Readable by every role. An author who cannot find a publisher in the composer
 * needs somewhere to discover that it is a licensing question rather than a
 * bug; `GET /cms/options` already returns unlicensed publishers marked rather
 * than hidden for the same reason.
 *
 * No article counts here. A `$group` over `articles` with no `$match` is the
 * collection scan the index file opens by warning about — and the count is only
 * ever acted on for one publisher at a time, on the screen below.
 */
sourceRoutes.get(
  '/cms/sources',
  requireRole('source.read'),
  asyncRoute(async (_req, res) => {
    const c = collections(getDb());
    const docs = await c.sources
      .find({})
      .sort({ priority: 1, displayName: 1 })
      .limit(200)
      .toArray();
    res.json({ items: docs.map((d) => toRow(d as unknown as SourceDoc)) });
  }),
);

/** GET /cms/sources/:slug — one publisher, with what is filed against them. */
sourceRoutes.get(
  '/cms/sources/:slug',
  requireRole('source.read'),
  asyncRoute(async (req, res) => {
    const slug = String(req.params.slug ?? '');
    const c = collections(getDb());
    const doc = await c.sources.findOne({ slug });
    if (!doc) throw new AppError('NOT_FOUND', 'No such publisher.');

    /* Both served by `by_source`. This is what the withdrawal confirmation
       reads, so the number is on screen BEFORE the click rather than in the
       response to it. */
    const [published, total] = await Promise.all([
      c.articles.countDocuments({ sourceId: doc._id, status: 'published' }),
      c.articles.countDocuments({ sourceId: doc._id }),
    ]);

    res.json({
      source: { ...toRow(doc as unknown as SourceDoc), articles: { published, total } },
    });
  }),
);

/** POST /cms/sources — add a publisher. Always starts unlicensed. */
sourceRoutes.post(
  '/cms/sources',
  requireRole('source.write'),
  asyncRoute(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This publisher is not ready to save.',
        issuesOf(parsed.error),
      );
    }

    const candidate = {
      ...parsed.data,
      logoUrl: parsed.data.logoUrl ?? null,
      /*
       * Not from the request body, at any cost. A licence is an assertion that
       * a publisher agreed to something, and it is made on its own endpoint
       * under its own permission with its own audit line.
       */
      licence: {
        status: 'pending' as const,
        agreementRef: null,
        agreedAt: null,
        contactEmail: null,
      },
      ingest: {
        ...parsed.data.ingest,
        feedUrl: parsed.data.ingest.feedUrl ?? null,
        lastPolledAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
      },
    };

    /* The shared schema, so `feedUrl is required when method is "rss"` is
       enforced from its single definition rather than restated here. */
    const check = Source.safeParse(candidate);
    if (!check.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This publisher is not ready to save.',
        issuesOf(check.error),
      );
    }

    const c = collections(getDb());
    const clash = await c.sources.findOne({ slug: candidate.slug });
    if (clash) {
      throw new AppError(
        'VALIDATION_FAILED',
        `A publisher with the slug “${candidate.slug}” already exists.`,
        { field: 'slug' },
      );
    }

    const now = new Date();
    let insertedId: string;
    try {
      const result = await c.sources.insertOne({
        ...candidate,
        createdAt: now,
        updatedAt: now,
      } as never);
      insertedId = result.insertedId.toString();
    } catch (e) {
      /* The check above is a race; `source_slug_unique` is the actual
         guarantee. Losing that race must not become a 500. */
      if (typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000) {
        throw new AppError(
          'VALIDATION_FAILED',
          `A publisher with the slug “${candidate.slug}” already exists.`,
          { field: 'slug' },
        );
      }
      throw e;
    }

    await writeAudit({
      action: 'source.create',
      entityType: 'source',
      entityId: insertedId,
      actorId: req.staff?.staffId ?? null,
      actorEmail: req.staff?.email ?? null,
      before: null,
      after: {
        slug: candidate.slug,
        displayName: candidate.displayName,
        language: candidate.language,
        ingest: candidate.ingest,
        priority: candidate.priority,
        isActive: candidate.isActive,
        licenceStatus: 'pending',
      },
      ip: req.ip ?? null,
    });

    res.status(201).json({ slug: candidate.slug });
  }),
);

/** PATCH /cms/sources/:slug — everything except the slug and the licence. */
sourceRoutes.patch(
  '/cms/sources/:slug',
  requireRole('source.write'),
  asyncRoute(async (req, res) => {
    const slug = String(req.params.slug ?? '');

    /*
     * The slug is the address, not a field.
     *
     * It is in the unique index, it is how `POST /cms/articles` and
     * `POST /cms/shorts` resolve a publisher, and it is what a link to this
     * screen contains. Renaming is what `displayName` is for. Rejected rather
     * than ignored, so a client that tries learns immediately.
     */
    if (req.body !== null && typeof req.body === 'object' && 'slug' in req.body) {
      throw new AppError(
        'BAD_REQUEST',
        'A publisher’s slug cannot be changed. Change the display name instead.',
        { field: 'slug' },
      );
    }
    if (req.body !== null && typeof req.body === 'object' && 'licence' in req.body) {
      throw new AppError(
        'BAD_REQUEST',
        'Use the licence endpoint to change a publisher’s licence.',
        { field: 'licence' },
      );
    }

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid field values.', issuesOf(parsed.error));
    }
    if (Object.keys(parsed.data).length === 0) {
      throw new AppError('BAD_REQUEST', 'Nothing to change.');
    }

    const c = collections(getDb());
    const before = (await c.sources.findOne({ slug })) as unknown as SourceDoc | null;
    if (!before) throw new AppError('NOT_FOUND', 'No such publisher.');

    const mergedIngest = {
      method: parsed.data.ingest?.method ?? before.ingest?.method ?? 'manual',
      feedUrl:
        parsed.data.ingest?.feedUrl !== undefined
          ? parsed.data.ingest.feedUrl
          : (before.ingest?.feedUrl ?? null),
      pollIntervalMin:
        parsed.data.ingest?.pollIntervalMin ?? before.ingest?.pollIntervalMin ?? 15,
    };

    const check = Source.safeParse({
      slug: before.slug,
      displayName: parsed.data.displayName ?? before.displayName,
      homepageUrl: parsed.data.homepageUrl ?? before.homepageUrl,
      logoUrl: parsed.data.logoUrl !== undefined ? parsed.data.logoUrl : (before.logoUrl ?? null),
      language: parsed.data.language ?? before.language,
      licence: {
        status: before.licence?.status ?? 'unknown',
        agreementRef: before.licence?.agreementRef ?? null,
        agreedAt: before.licence?.agreedAt ?? null,
        contactEmail: before.licence?.contactEmail ?? null,
      },
      ingest: { ...mergedIngest, consecutiveFailures: before.ingest?.consecutiveFailures ?? 0 },
      priority: parsed.data.priority ?? before.priority ?? 50,
      isActive: parsed.data.isActive ?? before.isActive ?? true,
    });
    if (!check.success) {
      throw new AppError('VALIDATION_FAILED', 'This change is not storable.', issuesOf(check.error));
    }

    /*
     * Dot-notated for the ingest sub-fields, and this is the single most likely
     * bug in the whole feature: `$set: { ingest: mergedIngest }` replaces the
     * sub-document and silently wipes `lastPolledAt`, `lastSuccessAt` and
     * `consecutiveFailures` — invisibly, and only noticeable once something
     * actually polls.
     */
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.displayName !== undefined) set.displayName = parsed.data.displayName;
    if (parsed.data.homepageUrl !== undefined) set.homepageUrl = parsed.data.homepageUrl;
    if (parsed.data.logoUrl !== undefined) set.logoUrl = parsed.data.logoUrl;
    if (parsed.data.language !== undefined) set.language = parsed.data.language;
    if (parsed.data.priority !== undefined) set.priority = parsed.data.priority;
    if (parsed.data.isActive !== undefined) set.isActive = parsed.data.isActive;
    if (parsed.data.ingest?.method !== undefined) set['ingest.method'] = mergedIngest.method;
    if (parsed.data.ingest?.feedUrl !== undefined) set['ingest.feedUrl'] = mergedIngest.feedUrl;
    if (parsed.data.ingest?.pollIntervalMin !== undefined) {
      set['ingest.pollIntervalMin'] = mergedIngest.pollIntervalMin;
    }

    await c.sources.updateOne({ slug }, { $set: set });

    await writeAudit({
      action: 'source.update',
      entityType: 'source',
      entityId: slug,
      actorId: req.staff?.staffId ?? null,
      actorEmail: req.staff?.email ?? null,
      before: {
        displayName: before.displayName,
        homepageUrl: before.homepageUrl,
        language: before.language,
        priority: before.priority ?? 50,
        isActive: before.isActive ?? true,
        ingest: {
          method: before.ingest?.method ?? 'manual',
          feedUrl: before.ingest?.feedUrl ?? null,
          pollIntervalMin: before.ingest?.pollIntervalMin ?? 15,
        },
      },
      after: { ...set },
      ip: req.ip ?? null,
    });

    res.json({ ok: true });
  }),
);

/** POST /cms/sources/:slug/licence — the legal gate. Admin only. */
sourceRoutes.post(
  '/cms/sources/:slug/licence',
  requireRole('source.setLicence'),
  asyncRoute(async (req, res) => {
    const slug = String(req.params.slug ?? '');
    const parsed = LicenceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid licence values.', issuesOf(parsed.error));
    }

    const result = await setSourceLicence({
      slug,
      status: parsed.data.status,
      ...(parsed.data.agreementRef !== undefined && { agreementRef: parsed.data.agreementRef }),
      ...(parsed.data.agreedAt !== undefined && { agreedAt: parsed.data.agreedAt }),
      ...(parsed.data.contactEmail !== undefined && { contactEmail: parsed.data.contactEmail }),
      note: parsed.data.note,
      actorId: req.staff?.staffId ?? '',
      actorEmail: req.staff?.email ?? '',
      ip: req.ip ?? null,
    });

    res.json({
      licence: {
        status: result.licence.status,
        agreementRef: result.licence.agreementRef,
        agreedAt: result.licence.agreedAt?.toISOString() ?? null,
        contactEmail: result.licence.contactEmail,
      },
      publishedArticles: result.publishedArticles,
      wasDowngraded: result.wasDowngraded,
    });
  }),
);
