import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { requireAuth } from '../auth/requireAuth.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';
import { cleanYouTubeTitle, draftCaption, posterBlurHash } from '../services/shortImport.service.js';
import { shortSlugFor } from './shorts.routes.js';

/**
 * The Shorts Incoming tab: Shorts found on licensed publishers' YouTube
 * channels, and what an editor does with them.
 *
 * The same shape as article Incoming, on purpose — a list paged on the server
 * with counts for the tabs, Promote (choose a section) and Dismiss (say why) —
 * so an editor who knows one knows the other.
 *
 * Promoting makes a short DRAFT that plays the Short with YouTube's player. It
 * is published exactly like an uploaded short, through the same route and the
 * same licence re-check.
 */

export const shortLeadRoutes = Router();

shortLeadRoutes.use(requireAuth);

const ListQuery = z.object({
  status: z.enum(['new', 'promoted', 'dismissed']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
});

const PromoteSchema = z.object({ categorySlug: z.string().min(1) });
const DismissSchema = z.object({ reason: z.string().trim().min(3).max(200) });

function toRow(d: Record<string, unknown>) {
  const date = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  return {
    id: String(d._id),
    sourceSlug: String(d.sourceSlug ?? ''),
    sourceName: String(d.sourceName ?? ''),
    videoId: String(d.videoId ?? ''),
    channelTitle: String(d.channelTitle ?? ''),
    title: String(d.title ?? ''),
    description: String(d.description ?? ''),
    thumbnailUrl: String(d.thumbnailUrl ?? ''),
    durationSeconds: Number(d.durationSeconds ?? 0),
    language: String(d.language ?? 'ne'),
    publishedAt: date(d.publishedAt),
    fetchedAt: date(d.fetchedAt) ?? new Date(0).toISOString(),
    status: String(d.status ?? 'new'),
    promotedVideoId: d.promotedVideoId == null ? null : String(d.promotedVideoId),
    dismissedReason: typeof d.dismissedReason === 'string' ? d.dismissedReason : null,
  };
}

/** GET /cms/short-leads — newest first, a page at a time, with tab counts. */
shortLeadRoutes.get(
  '/cms/short-leads',
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown status.');
    const { status, page, perPage } = parsed.data;

    const shortLeads = getDb().collection('shortLeads');
    const [total, docs, counts] = await Promise.all([
      shortLeads.countDocuments({ status }),
      shortLeads
        .find({ status })
        .sort({ publishedAt: -1, fetchedAt: -1, _id: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .toArray(),
      shortLeads
        .aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
        .toArray(),
    ]);

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

/** POST /cms/short-leads/:id/promote — make it a short draft. */
shortLeadRoutes.post(
  '/cms/short-leads/:id/promote',
  asyncRoute(async (req, res) => {
    const parsed = PromoteSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'A section is required.');
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('NOT_FOUND');

    const c = collections(getDb());
    const shortLeads = getDb().collection('shortLeads');
    const lead = await shortLeads.findOne({ _id: new ObjectId(id) });
    if (!lead) throw new AppError('NOT_FOUND', 'No such Short.');
    if (lead.status !== 'new') {
      throw new AppError(
        'INVALID_TRANSITION',
        lead.status === 'promoted' ? 'This Short has already been promoted.' : 'This Short was dismissed.',
      );
    }

    const category = await c.categories.findOne({ slug: parsed.data.categorySlug });
    if (!category) throw new AppError('BAD_REQUEST', `No such section: ${parsed.data.categorySlug}.`);

    const source = await c.sources.findOne({ _id: lead.sourceId as ObjectId });
    if (!source) throw new AppError('VALIDATION_FAILED', 'This Short has no publisher on file.');
    if (source.licence?.status !== 'agreed') {
      throw new AppError(
        'VALIDATION_FAILED',
        `${source.displayName} has no agreed licence. Their channel can be read, but a short cannot be made from it until an agreement is recorded.`,
      );
    }

    const language = lead.language === 'en' ? 'en' : 'ne';
    const title = cleanYouTubeTitle(String(lead.title), String(lead.channelTitle ?? ''));
    const [caption, blurHash] = await Promise.all([
      draftCaption({
        description: String(lead.description ?? ''),
        title,
        language,
        mayUseText: source.licence?.fullText === true,
      }),
      posterBlurHash(String(lead.thumbnailUrl)),
    ]);

    const now = new Date();
    const _id = new ObjectId();
    const videoId = String(lead.videoId);

    try {
      await getDb()
        .collection('videos')
        .insertOne({
          _id,
          slug: shortSlugFor(title, language),
          status: 'draft',
          language,
          categoryId: category._id,
          sourceId: source._id,
          publishedAt: null,
          title,
          caption: caption.caption,
          /* Shown in the edit screen until a caption is written. */
          captionNote: caption.note,
          durationSeconds: Number(lead.durationSeconds),
          posterUrl: String(lead.thumbnailUrl),
          posterBlurHash: blurHash,
          origin: 'youtube',
          youtubeId: videoId,
          renditions: [],
          credit: source.displayName,
          licence: 'publisher_licensed',
          sourceUrl: `https://www.youtube.com/shorts/${videoId}`,
          sourceName: source.displayName,
          categorySlug: category.slug,
          categoryLabel: category.label,
          createdAt: now,
          updatedAt: now,
        } as never);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        throw new AppError('INVALID_TRANSITION', 'A short already exists for this YouTube video.');
      }
      throw e;
    }

    /* After the draft exists, so a failed insert cannot leave the Short marked
       dealt with and never offered again — the order article promote uses. */
    await shortLeads.updateOne(
      { _id: lead._id },
      { $set: { status: 'promoted', promotedVideoId: _id, updatedAt: now } },
    );

    await writeAudit({
      action: 'shortLead.promote',
      entityType: 'shortLead',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'new' },
      after: {
        status: 'promoted',
        videoId: _id.toString(),
        youtubeId: videoId,
        categorySlug: category.slug,
        caption: caption.note === null ? 'drafted' : 'empty',
      },
      ip: req.ip ?? null,
    });

    res.status(201).json({ id: _id.toString() });
  }),
);

/** POST /cms/short-leads/:id/dismiss — not for us, and say why. */
shortLeadRoutes.post(
  '/cms/short-leads/:id/dismiss',
  asyncRoute(async (req, res) => {
    const parsed = DismissSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'A reason of at least 3 characters is required.');
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('NOT_FOUND');

    const now = new Date();
    const result = await getDb()
      .collection('shortLeads')
      .updateOne(
        { _id: new ObjectId(id), status: 'new' },
        { $set: { status: 'dismissed', dismissedReason: parsed.data.reason, updatedAt: now } },
      );
    if (result.matchedCount === 0) {
      throw new AppError('INVALID_TRANSITION', 'Only a waiting Short can be dismissed.');
    }

    await writeAudit({
      action: 'shortLead.dismiss',
      entityType: 'shortLead',
      entityId: id,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'new' },
      after: { status: 'dismissed', reason: parsed.data.reason },
      ip: req.ip ?? null,
    });

    res.json({ ok: true });
  }),
);
