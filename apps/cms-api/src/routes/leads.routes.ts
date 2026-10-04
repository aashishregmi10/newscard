import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { requireAuth } from '../auth/requireAuth.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';
import { draftSlug } from './articles.routes.js';
import { importPublisherPhoto, leadMaterial } from '../services/leadImport.service.js';
import { requestSummaryDraft } from '../services/summaryDraft.service.js';

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

/**
 * Paged on the server, unlike every other list in this application.
 *
 * The queue, the publishers and the shorts all load everything and page in
 * the browser, which is right for a few dozen rows. Leads are different in
 * kind: most of them are dismissed rather than promoted, dismissals are KEPT
 * so the same headline is not offered twice, and they live for thirty days —
 * so `dismissed` grows into the thousands on a handful of publishers while
 * `new` stays small if anyone is doing their job.
 *
 * It was capped at 200 with no paging and no total, which meant leads past
 * that point were not merely on another page, they were invisible, and they
 * expired having never been seen by anybody.
 *
 * Offset paging rather than the signed cursor: `cursor.ts` refuses offsets
 * for the reader's feed because new stories arrive at the head of the sort
 * order and a reader would see a card twice. That risk is real here too and
 * it is worth far less — an editor who sees one lead twice across a page
 * boundary has lost nothing, and the cursor codec is machinery this list does
 * not need.
 */
const MAX_PER_PAGE = 100;

const ListQuery = z.object({
  status: z.enum(['new', 'promoted', 'dismissed']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(10),
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
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown lead status.');

    const c = collections(getDb());
    const { status, page, perPage } = parsed.data;

    /* Counted before the slice, so the client can draw a page control that
       knows how many pages there are. */
    const total = await c.leads.countDocuments({ status });

    /*
     * Newest first by the publisher's own time, or by when we first saw the
     * story if their feed gives none — never with undated stories last.
     *
     * Sorting on publishedAt alone put every undated story below every dated
     * one, because a missing date sorts as the oldest of all. The Kathmandu
     * Post's feed carries no dates, so its stories would have been at the
     * bottom of Incoming, behind hundreds from publishers who date theirs.
     * The time we first saw a story is within one poll of when it went up.
     */
    const docs = await c.leads
      .aggregate([
        { $match: { status } },
        {
          $addFields: {
            _sortAt: { $ifNull: ['$sortAt', { $ifNull: ['$publishedAt', '$fetchedAt'] }] },
          },
        },
        { $sort: { _sortAt: -1, fetchedAt: -1, _id: -1 } },
        { $skip: (page - 1) * perPage },
        { $limit: perPage },
        { $project: { _sortAt: 0 } },
      ])
      .toArray();

    /* Counts for the tab strip, in one round trip rather than three requests
       the client would have to keep in step. */
    const counts = await c.leads
      .aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
      .toArray();

    res.json({
      items: docs.map((d) => toRow(d as unknown as Record<string, unknown>)),
      total,
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

    /*
     * Their photo, when their licence covers photos and the lead has one.
     *
     * Fetched before the draft exists so the composer opens with the picture
     * already in place. Bounded at ten seconds; a failure costs only the
     * photo, and the reason goes on the draft so nobody has to guess.
     */
    /* A story collected before the licence terms were switched on has no
       photo or full text yet; its own page is read now, once. */
    const material = await leadMaterial(lead as never, source.licence);
    const feedImageUrl = material.imageUrl;
    let image: Awaited<ReturnType<typeof importPublisherPhoto>> | null = null;
    let photoNote: string | null = null;
    if (feedImageUrl !== null) {
      if (source.licence?.images === true) {
        image = await importPublisherPhoto(feedImageUrl, source.displayName);
        if (!image.ok) photoNote = image.reason;
      } else {
        photoNote = `${source.displayName}'s licence does not cover their photos, so theirs was not copied. Add one of your own, or turn on "Their photos" on the publisher's page if their agreement allows it.`;
      }
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
      image: image?.ok ? image.image : null,
      photoNote,
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

    /* After the link above, because the draft is written from the lead it
       finds through it. Recorded now, written in the background: promote
       returns at once and the composer shows the draft arriving. */
    await requestSummaryDraft(_id);

    await writeAudit({
      action: 'lead.promote',
      entityType: 'lead',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'new' },
      after: {
        status: 'promoted',
        articleId: _id.toString(),
        categorySlug: category.slug,
        photo: image?.ok ? 'copied' : photoNote === null ? 'none' : 'not copied',
      },
      ip: req.ip ?? null,
    });

    res.status(201).json({ articleId: _id.toString() });
  }),
);

/** POST /cms/leads/:id/dismiss — not for us, and say why. */
leadRoutes.post(
  '/cms/leads/:id/dismiss',
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
