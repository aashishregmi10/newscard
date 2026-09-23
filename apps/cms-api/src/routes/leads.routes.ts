import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { requireAuth, requireRole } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';
import { draftSlug } from './articles.routes.js';

/**
 * The triage queue.  Plan §2a.
 *
 * The collector writes what it finds to `leads` and stops. This is the other
 * half: what an editor does with forty headlines.
 *
 * -- Why a lead is not a draft -----------------------------------------------
 *
 * Promoting one is a person's decision and always was. The collector is allowed
 * to learn that a story exists; deciding it is worth our summary, which section
 * it belongs in, and that we may publish it at all is editorial judgement, and
 * automating it would produce a queue of drafts nobody chose.
 *
 * -- Why promotion re-checks the licence -------------------------------------
 *
 * Because the two gates are deliberately different strengths. `isPollable` lets
 * us READ a public feed with no agreement at all — that is what makes the
 * collector useful before Gate 1 closes. Writing a story against that publisher
 * is the other gate, and it wants `licence.status === 'agreed'`, exactly as
 * `POST /cms/articles` does.
 *
 * So a source can legitimately fill the triage queue and refuse every promotion
 * out of it. That is not a bug; it is the arrangement working, and the message
 * says so rather than reporting a generic validation failure.
 *
 * -- Why dismissals are kept -------------------------------------------------
 *
 * A dismissed lead stays in the collection with its reason. Deleting it means
 * the next poll offers the same story again, and an editor rejecting the same
 * headline every fifteen minutes stops reading the queue.
 */

export const leadRoutes = Router();

leadRoutes.use(requireAuth);

/** Long enough to clear a morning's collection, short enough to be one page. */
const MAX_LEADS = 200;

const ListQuery = z.object({
  status: z.enum(['new', 'promoted', 'dismissed']).default('new'),
});

const PromoteSchema = z.object({
  categorySlug: z.string().min(1),
});

const DismissSchema = z.object({
  /** Free text, because the useful reasons are not a fixed set and a dropdown
   *  of four would just collect "other". */
  reason: z.string().min(3).max(200),
});

interface LeadRow {
  id: string;
  sourceSlug: string;
  sourceName: string;
  canonicalUrl: string;
  headline: string;
  feedExtract: string | null;
  feedImageUrl: string | null;
  language: string;
  publishedAt: string | null;
  fetchedAt: string;
  status: string;
  promotedArticleId: string | null;
  dismissedReason: string | null;
}

function toRow(d: Record<string, unknown>): LeadRow {
  const date = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  return {
    id: String(d._id),
    sourceSlug: String(d.sourceSlug ?? ''),
    sourceName: String(d.sourceName ?? ''),
    canonicalUrl: String(d.canonicalUrl ?? ''),
    headline: String(d.headline ?? ''),
    feedExtract: typeof d.feedExtract === 'string' ? d.feedExtract : null,
    feedImageUrl: typeof d.feedImageUrl === 'string' ? d.feedImageUrl : null,
    language: String(d.language ?? 'ne'),
    publishedAt: date(d.publishedAt),
    fetchedAt: date(d.fetchedAt) ?? new Date(0).toISOString(),
    status: String(d.status ?? 'new'),
    promotedArticleId: d.promotedArticleId == null ? null : String(d.promotedArticleId),
    dismissedReason: typeof d.dismissedReason === 'string' ? d.dismissedReason : null,
  };
}

/**
 * GET /cms/leads — what the collector has found.
 *
 * Newest first by the publisher's own timestamp, falling back to when we
 * fetched it: a feed that omits dates would otherwise sort arbitrarily and the
 * list would reshuffle on every poll.
 *
 * Served by the `lead_triage` index, which has declared this endpoint as the
 * query it exists for since before the endpoint did.
 */
leadRoutes.get(
  '/cms/leads',
  requireRole('queue.read'),
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown lead status.');

    const c = collections(getDb());
    const docs = await c.leads
      .find({ status: parsed.data.status })
      .sort({ publishedAt: -1, fetchedAt: -1 })
      .limit(MAX_LEADS)
      .toArray();

    /* Counts for the tab strip, in one round trip rather than three requests
       the client would have to keep in step. */
    const counts = await c.leads
      .aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
      .toArray();

    res.json({
      items: docs.map((d) => toRow(d as unknown as Record<string, unknown>)),
      counts: {
        new: counts.find((x) => x._id === 'new')?.n ?? 0,
        promoted: counts.find((x) => x._id === 'promoted')?.n ?? 0,
        dismissed: counts.find((x) => x._id === 'dismissed')?.n ?? 0,
      },
    });
  }),
);

/**
 * POST /cms/leads/:id/promote — turn a lead into a draft.
 *
 * The draft's `publisherUrl` is the lead's canonical URL, not the publisher's
 * homepage. That is the link the reader taps, and it is also why this path does
 * not hit the duplicate-key wall the New story form does: `publisher_url_unique`
 * is unique, and a form that files every story against the same homepage can
 * only ever create one draft per publisher.
 */
leadRoutes.post(
  '/cms/leads/:id/promote',
  requireRole('article.write'),
  asyncRoute(async (req, res) => {
    const parsed = PromoteSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'A section is required.');

    const id = String(req.params.id ?? '');
    if (!/^[0-9a-f]{24}$/.test(id)) throw new AppError('NOT_FOUND');

    const c = collections(getDb());
    const lead = await c.leads.findOne({ _id: new ObjectId(id) });
    if (!lead) throw new AppError('NOT_FOUND', 'No such lead.');
    if (lead.status !== 'new') {
      throw new AppError(
        'INVALID_TRANSITION',
        lead.status === 'promoted'
          ? 'This lead has already been promoted.'
          : 'This lead was dismissed.',
        { status: lead.status },
      );
    }

    const category = await c.categories.findOne({ slug: parsed.data.categorySlug });
    if (!category) throw new AppError('BAD_REQUEST', `No such section: ${parsed.data.categorySlug}.`);

    const source = await c.sources.findOne({ _id: lead.sourceId });
    if (!source) throw new AppError('VALIDATION_FAILED', 'This lead has no publisher on file.');

    // The stronger of the two gates. See the note at the top of this file.
    if (source.licence?.status !== 'agreed') {
      throw new AppError(
        'VALIDATION_FAILED',
        `${source.displayName} has no agreed licence. Their feed can be read, but a story cannot be written against them until an agreement is recorded.`,
        { licenceStatus: source.licence?.status ?? null, sourceSlug: source.slug },
      );
    }

    const now = new Date();
    const _id = new ObjectId();

    await c.articles.insertOne({
      _id,
      slug: draftSlug(lead.language, category.slug),
      status: 'draft',
      language: lead.language,
      categoryId: category._id,
      sourceId: source._id,
      publishedAt: null,
      /*
       * Their headline, as the starting point an editor rewrites.
       *
       * It is not a summary and it is not published as-is: the composer's
       * guidance says to read the original and write from what you remember of
       * it, and the publish gate measures what ends up in the field. Handing
       * over a blank box beside a link would simply mean the first thing every
       * editor does is copy the headline by hand.
       */
      headline: lead.headline.slice(0, 90),
      summary: '',
      summaryWordCount: 0,
      summaryCharCount: 0,
      pullQuote: null,
      /* The story's own URL, from the feed. */
      publisherUrl: lead.canonicalUrl,
      publisherAuthor: null,
      publisherPublishedAt: lead.publishedAt ?? null,
      tags: [],
      clusterId: null,
      originatingAgency: null,
      image: null,
      sourceName: source.displayName,
      sourceLogoUrl: source.logoUrl ?? null,
      categorySlug: category.slug,
      categoryLabel: category.label,
      authoredBy: new ObjectId(req.staff!.staffId),
      reviewedBy: null,
      selfApproved: false,
      /* Discovered by a machine, written by a person. `llm_assisted` would be a
         lie — nothing generated this text, a collector found the link. */
      draftSource: 'human',
      revisionCount: 0,
      possibleDuplicate: false,
      possibleLanguageMismatch: false,
      createdAt: now,
      updatedAt: now,
    } as never);

    /*
     * Marked promoted only after the draft exists.
     *
     * The other order loses the story on a failed insert: the lead reads as
     * dealt with, the draft is not there, and the next poll will not re-offer it
     * because the URL is already in the collection.
     */
    await c.leads.updateOne(
      { _id: lead._id },
      { $set: { status: 'promoted', promotedArticleId: _id, updatedAt: now } },
    );

    await writeAudit({
      action: 'lead.promote',
      entityType: 'lead',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'new' },
      after: { status: 'promoted', articleId: _id.toString(), categorySlug: category.slug },
      ip: req.ip ?? null,
    });

    res.status(201).json({ articleId: _id.toString() });
  }),
);

/** POST /cms/leads/:id/dismiss — not for us, and say why. */
leadRoutes.post(
  '/cms/leads/:id/dismiss',
  requireRole('article.write'),
  asyncRoute(async (req, res) => {
    const parsed = DismissSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'A reason of at least 3 characters is required.');
    }

    const id = String(req.params.id ?? '');
    if (!/^[0-9a-f]{24}$/.test(id)) throw new AppError('NOT_FOUND');

    const c = collections(getDb());
    const lead = await c.leads.findOne({ _id: new ObjectId(id) });
    if (!lead) throw new AppError('NOT_FOUND', 'No such lead.');
    if (lead.status === 'promoted') {
      throw new AppError('INVALID_TRANSITION', 'This lead has already become a draft.');
    }

    await c.leads.updateOne(
      { _id: lead._id },
      {
        $set: {
          status: 'dismissed',
          dismissedReason: parsed.data.reason.trim(),
          updatedAt: new Date(),
        },
      },
    );

    await writeAudit({
      action: 'lead.dismiss',
      entityType: 'lead',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: lead.status },
      after: { status: 'dismissed', reason: parsed.data.reason.trim() },
      ip: req.ip ?? null,
    });

    res.json({ status: 'dismissed' });
  }),
);
