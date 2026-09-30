import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { ObjectId, type Filter, type Document } from 'mongodb';
import { z } from 'zod';
import { buildCampaignReport, getDb, runningShareOfVoice } from '@saar/db';
import {
  AppError,
  campaignWeight,
  countGraphemes,
  servingPool,
  shareOfVoice,
} from '@saar/shared';
import {
  AdPlacementEnum,
  HttpsUrl,
  INLINE_AD_TEXT_MAX,
  LanguageEnum,
  type AdPlacement,
} from '@saar/schemas';
import { requireAuth } from '../auth/requireAuth.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Advertising, from the editorial site.
 *
 * Campaigns used to exist only because a seed script wrote them, and an
 * advertiser's report link only because a command-line script minted one. This
 * is where both now happen, by the same admins who run everything else.
 *
 * ── The numbers here are serving's numbers ───────────────────────────────────
 *
 * Share of voice is computed by the same functions the feed draws with
 * (campaignWeight, servingPool, shareOfVoice in @saar/shared), and a campaign's
 * figures by the same report builder the advertiser reads (@saar/db). A price
 * typed into the form, the share it is shown to buy, the share it is actually
 * served and the share the advertiser is told they got are one calculation.
 */

export const adRoutes = Router();

adRoutes.use(requireAuth);

const campaigns = () => getDb().collection('campaigns');
const advertisers = () => getDb().collection('advertisers');

const IdParam = z.string().regex(/^[0-9a-f]{24}$/i, 'Malformed id.');

/** A media URL, relative (development) or absolute (production CDN). */
const MediaUrl = z
  .string()
  .min(1)
  .refine((u) => u.startsWith('/') || /^https?:\/\//i.test(u), 'must be a URL or a path');

const AdImage = z.object({
  blurHash: z.string().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  urls: z.object({
    sm: MediaUrl.nullable().optional(),
    md: MediaUrl.nullable().optional(),
    lg: MediaUrl.nullable().optional(),
  }),
});

/* ────────────────────────────────────────────────────────────────────────────
 * What a campaign is in each list.
 *
 * Stored status is only ever draft, live or paused from this site. Whether a
 * live campaign is scheduled, running or finished is a fact about its dates,
 * and storing it as well would be a second copy that goes stale at midnight.
 * ──────────────────────────────────────────────────────────────────────────── */

export const CAMPAIGN_TABS = ['running', 'scheduled', 'paused', 'finished', 'draft'] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

function tabFilter(tab: CampaignTab, now: Date): Filter<Document> {
  switch (tab) {
    case 'running':
      return { status: 'live', startsAt: { $lte: now }, endsAt: { $gte: now } };
    case 'scheduled':
      return { status: 'live', startsAt: { $gt: now } };
    case 'paused':
      return { status: 'paused', endsAt: { $gte: now } };
    case 'finished':
      return {
        $or: [{ status: 'ended' }, { status: { $in: ['live', 'paused'] }, endsAt: { $lt: now } }],
      };
    case 'draft':
      return { status: 'draft' };
  }
}

function stateOf(c: { status?: string; startsAt: Date; endsAt: Date }, now: Date): CampaignTab {
  if (c.status === 'draft') return 'draft';
  if (c.status === 'ended' || c.endsAt < now) return 'finished';
  if (c.status === 'paused') return 'paused';
  return c.startsAt > now ? 'scheduled' : 'running';
}

const placementOf = (c: { placement?: AdPlacement }): AdPlacement => c.placement ?? 'card';

/* ── GET /cms/ads/overview ──────────────────────────────────────────────────── */

adRoutes.get(
  '/cms/ads/overview',
  asyncRoute(async (_req, res) => {
    const db = getDb();
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(0, 0, 0, 0);

    const placements: AdPlacement[] = ['card', 'inline'];
    const out = [];
    for (const placement of placements) {
      const running = await campaigns()
        .find({
          ...tabFilter('running', now),
          ...(placement === 'card'
            ? { $or: [{ placement: 'card' }, { placement: { $exists: false } }] }
            : { placement }),
        })
        .project({ name: 1, advertiserName: 1, pricePaisa: 1, startsAt: 1, endsAt: 1 })
        .toArray();

      const sov = await runningShareOfVoice(db, placement, now);
      const placementMatch =
        placement === 'card'
          ? { $or: [{ placement: 'card' }, { placement: { $exists: false } }] }
          : { placement };
      const [today] = await db
        .collection('adEvents')
        .aggregate<{ views: number; clicks: number }>([
          { $match: { occurredAt: { $gte: midnight }, ...placementMatch } },
          {
            $group: {
              _id: null,
              views: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } },
              clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
            },
          },
        ])
        .toArray();

      const rows = running
        .map((c) => ({
          id: c._id.toString(),
          name: String(c.name ?? ''),
          advertiser: String(c.advertiserName ?? ''),
          pricePerDayPaisa: Math.round(
            campaignWeight({
              pricePaisa: Number(c.pricePaisa ?? 0),
              startsAt: c.startsAt as Date,
              endsAt: c.endsAt as Date,
            }),
          ),
          shareOfVoice: sov.get(c._id.toString()) ?? 0,
        }))
        .sort((a, b) => b.shareOfVoice - a.shareOfVoice);

      out.push({
        placement,
        running: rows,
        totalPerDayPaisa: rows.reduce((sum, r) => sum + r.pricePerDayPaisa, 0),
        today: { views: today?.views ?? 0, clicks: today?.clicks ?? 0 },
      });
    }

    res.json({ placements: out });
  }),
);

/* ── GET /cms/ads/campaigns ─────────────────────────────────────────────────── */

const ListQuery = z.object({
  tab: z.enum(CAMPAIGN_TABS).default('running'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
});

adRoutes.get(
  '/cms/ads/campaigns',
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown query.');
    const { tab, page, perPage } = parsed.data;
    const now = new Date();
    const db = getDb();

    const [total, docs, ...counts] = await Promise.all([
      campaigns().countDocuments(tabFilter(tab, now)),
      campaigns()
        .find(tabFilter(tab, now))
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .toArray(),
      ...CAMPAIGN_TABS.map((t) => campaigns().countDocuments(tabFilter(t, now))),
    ]);

    const sov = {
      card: await runningShareOfVoice(db, 'card', now),
      inline: await runningShareOfVoice(db, 'inline', now),
    };

    res.json({
      total,
      counts: Object.fromEntries(CAMPAIGN_TABS.map((t, i) => [t, counts[i] ?? 0])),
      items: docs.map((c) => {
        const placement = placementOf(c as { placement?: AdPlacement });
        const stats = (c.stats ?? {}) as { impressions?: number; clicks?: number };
        const impressions = stats.impressions ?? 0;
        const clicks = stats.clicks ?? 0;
        return {
          id: c._id.toString(),
          name: String(c.name ?? ''),
          advertiser: String(c.advertiserName ?? ''),
          placement,
          language: c.language,
          state: stateOf(c as never, now),
          startsAt: (c.startsAt as Date).toISOString(),
          endsAt: (c.endsAt as Date).toISOString(),
          pricePaisa: Number(c.pricePaisa ?? 0),
          pricePerDayPaisa: Math.round(
            campaignWeight({
              pricePaisa: Number(c.pricePaisa ?? 0),
              startsAt: c.startsAt as Date,
              endsAt: c.endsAt as Date,
            }),
          ),
          shareOfVoice: sov[placement].get(c._id.toString()) ?? null,
          impressions,
          clicks,
          hasReportLink: Boolean(c.reportTokenHash),
        };
      }),
    });
  }),
);

/* ── GET /cms/ads/campaigns/:id ─────────────────────────────────────────────── */

adRoutes.get(
  '/cms/ads/campaigns/:id',
  asyncRoute(async (req, res) => {
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) throw new AppError('BAD_REQUEST', 'Malformed id.');
    const c = await campaigns().findOne({ _id: new ObjectId(id.data) });
    if (!c) throw new AppError('NOT_FOUND');

    const now = new Date();
    const startsAt = c.startsAt as Date;
    const endsAt = c.endsAt as Date;
    /* The whole flight so far — which is what the advertiser bought. */
    const to = endsAt < now ? endsAt : now;
    const report = startsAt <= now ? await buildCampaignReport(getDb(), id.data, startsAt, to, now) : null;

    const creative = (c.creative ?? {}) as Record<string, unknown>;
    res.json({
      campaign: {
        id: c._id.toString(),
        advertiserId: String(c.advertiserId),
        advertiser: String(c.advertiserName ?? ''),
        name: String(c.name ?? ''),
        placement: placementOf(c as { placement?: AdPlacement }),
        language: c.language,
        categories: (c.categories as string[] | undefined) ?? [],
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        pricePaisa: Number(c.pricePaisa ?? 0),
        status: c.status === 'draft' || c.status === 'paused' ? c.status : 'live',
        state: stateOf(c as never, now),
        creative: {
          headline: String(creative.headline ?? ''),
          body: (creative.body as string | null | undefined) ?? null,
          callToAction: (creative.callToAction as { ne: string; en: string }) ?? { ne: '', en: '' },
          landingUrl: String(creative.landingUrl ?? ''),
          image: creative.image ?? null,
        },
        hasReportLink: Boolean(c.reportTokenHash),
      },
      report,
    });
  }),
);

/* ── The campaign form ──────────────────────────────────────────────────────── */

const CampaignBody = z
  .object({
    advertiserId: IdParam,
    name: z.string().trim().min(1).max(120),
    placement: AdPlacementEnum,
    language: LanguageEnum,
    categories: z.array(z.string().min(1).max(40)).max(20).default([]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    /** Paisa, integer. Up to one crore rupees, which no local campaign nears. */
    pricePaisa: z.number().int().min(0).max(10_000_000_00),
    status: z.enum(['draft', 'live', 'paused']),
    creative: z.object({
      headline: z.string().trim().min(2).max(90),
      body: z.string().trim().max(300).nullable().optional(),
      callToAction: z.object({ ne: z.string().trim().max(24), en: z.string().trim().max(24) }),
      landingUrl: HttpsUrl,
      image: AdImage.nullable(),
    }),
  })
  .superRefine((b, ctx) => {
    if (b.endsAt <= b.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end must be after the start.' });
    }
    if (b.placement === 'inline' && countGraphemes(b.creative.headline) > INLINE_AD_TEXT_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['creative', 'headline'],
        message: `A small ad carries at most ${INLINE_AD_TEXT_MAX} characters, or it does not fit beside the icons.`,
      });
    }
    if (b.placement === 'card') {
      if (b.creative.image === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['creative', 'image'],
          message: 'A full-card ad needs its poster.',
        });
      }
      if (b.creative.callToAction.ne === '' || b.creative.callToAction.en === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['creative', 'callToAction'],
          message: 'A full-card ad needs its button text in both languages.',
        });
      }
    }
  });

type CampaignInput = z.infer<typeof CampaignBody>;

function parseCampaign(body: unknown): CampaignInput {
  const parsed = CampaignBody.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError('VALIDATION_FAILED', first?.message ?? 'This campaign is not ready to save.', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

async function fieldsFor(input: CampaignInput): Promise<Record<string, unknown>> {
  const advertiser = await advertisers().findOne({ _id: new ObjectId(input.advertiserId) });
  if (!advertiser) throw new AppError('BAD_REQUEST', 'No such advertiser.');

  if (input.categories.length > 0) {
    const found = await getDb()
      .collection('categories')
      .countDocuments({ slug: { $in: input.categories } });
    if (found !== new Set(input.categories).size) {
      throw new AppError('BAD_REQUEST', 'One of those sections does not exist.');
    }
  }

  return {
    advertiserId: advertiser._id,
    /* Denormalised: serving puts it on every ad card and must not join for it. */
    advertiserName: String(advertiser.displayName ?? advertiser.name ?? ''),
    name: input.name,
    placement: input.placement,
    language: input.language,
    categories: [...new Set(input.categories)],
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    pricePaisa: input.pricePaisa,
    status: input.status,
    creative: {
      headline: input.creative.headline,
      body: input.creative.body ?? null,
      callToAction: input.creative.callToAction,
      landingUrl: input.creative.landingUrl,
      image: input.creative.image,
    },
  };
}

/* ── POST /cms/ads/campaigns ────────────────────────────────────────────────── */

adRoutes.post(
  '/cms/ads/campaigns',
  asyncRoute(async (req, res) => {
    const input = parseCampaign(req.body);
    const fields = await fieldsFor(input);
    const now = new Date();
    const _id = new ObjectId();

    await campaigns().insertOne({
      _id,
      ...fields,
      reportTokenHash: null,
      stats: { impressions: 0, viewableImpressions: 0, clicks: 0 },
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      action: 'ad.campaign.create',
      entityType: 'campaign',
      entityId: _id.toString(),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { ...fields, advertiserId: input.advertiserId },
      ip: req.ip ?? null,
    });

    res.status(201).json({ id: _id.toString() });
  }),
);

/* ── POST /cms/ads/campaigns/:id/edit ───────────────────────────────────────── */

adRoutes.post(
  '/cms/ads/campaigns/:id/edit',
  asyncRoute(async (req, res) => {
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) throw new AppError('BAD_REQUEST', 'Malformed id.');
    const _id = new ObjectId(id.data);

    const existing = await campaigns().findOne({ _id });
    if (!existing) throw new AppError('NOT_FOUND');

    const input = parseCampaign(req.body);
    const fields = await fieldsFor(input);

    /* Stats and the report token are not the form's to change: the one is what
       was delivered, the other is the advertiser's key. */
    await campaigns().updateOne({ _id }, { $set: { ...fields, updatedAt: new Date() } });

    await writeAudit({
      action: 'ad.campaign.edit',
      entityType: 'campaign',
      entityId: id.data,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: {
        name: existing.name,
        status: existing.status,
        placement: existing.placement ?? 'card',
        pricePaisa: existing.pricePaisa,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        creative: existing.creative,
      },
      after: { ...fields, advertiserId: input.advertiserId },
      ip: req.ip ?? null,
    });

    res.json({ ok: true });
  }),
);

/* ── GET /cms/ads/share-preview ─────────────────────────────────────────────── */

/**
 * The share of voice a campaign would get, before it is saved.
 *
 * Measured against the campaigns in the same placement that will be running
 * on its first day (or today, if it has already started), because that is who
 * it will actually share the slots with. The same pool and the same arithmetic
 * serving uses.
 */
const PreviewQuery = z.object({
  placement: AdPlacementEnum,
  pricePaisa: z.coerce.number().int().min(0),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  /** When editing, the campaign's own current row is left out of the others. */
  excludeId: IdParam.optional(),
});

adRoutes.get(
  '/cms/ads/share-preview',
  asyncRoute(async (req, res) => {
    const parsed = PreviewQuery.safeParse(req.query);
    if (!parsed.success || parsed.data.endsAt <= parsed.data.startsAt) {
      throw new AppError('BAD_REQUEST', 'A placement, a price and two dates in order are needed.');
    }
    const q = parsed.data;
    const now = new Date();
    const at = q.startsAt > now ? q.startsAt : now;

    const others = await campaigns()
      .find({
        status: 'live',
        startsAt: { $lte: at },
        endsAt: { $gte: at },
        ...(q.placement === 'card'
          ? { $or: [{ placement: 'card' }, { placement: { $exists: false } }] }
          : { placement: q.placement }),
        ...(q.excludeId ? { _id: { $ne: new ObjectId(q.excludeId) } } : {}),
      })
      .project({ name: 1, advertiserName: 1, pricePaisa: 1, startsAt: 1, endsAt: 1 })
      .toArray();

    const self = { _id: null, name: 'This campaign', pricePaisa: q.pricePaisa, startsAt: q.startsAt, endsAt: q.endsAt };
    const pool = servingPool([
      self,
      ...others.map((c) => ({
        _id: c._id,
        name: String(c.name ?? ''),
        advertiserName: String(c.advertiserName ?? ''),
        pricePaisa: Number(c.pricePaisa ?? 0),
        startsAt: c.startsAt as Date,
        endsAt: c.endsAt as Date,
      })),
    ]);
    const shares = shareOfVoice(pool);
    const selfIndex = pool.findIndex((x) => x.item === self);

    res.json({
      at: at.toISOString(),
      pricePerDayPaisa: Math.round(campaignWeight(self)),
      /* Zero for a free campaign while anyone paying is running: a house ad
         gets no share while a paying campaign can fill the slot. */
      shareOfVoice: selfIndex < 0 ? 0 : shares[selfIndex] ?? 0,
      alongside: others.length,
    });
  }),
);

/* ── POST /cms/ads/campaigns/:id/report-link ────────────────────────────────── */

/**
 * Issue — or replace — the advertiser's report token.
 *
 * Shown once, in the response, and stored only as a sha256: a database dump
 * yields no working links. Issuing a new one is also how a link is revoked,
 * because the old hash is overwritten. There was a command-line script for
 * this; an admin now does it from the campaign screen.
 */
adRoutes.post(
  '/cms/ads/campaigns/:id/report-link',
  asyncRoute(async (req, res) => {
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) throw new AppError('BAD_REQUEST', 'Malformed id.');
    const _id = new ObjectId(id.data);

    const existing = await campaigns().findOne({ _id }, { projection: { reportTokenHash: 1 } });
    if (!existing) throw new AppError('NOT_FOUND');

    const token = `rp_${randomBytes(24).toString('base64url')}`;
    await campaigns().updateOne(
      { _id },
      {
        $set: {
          reportTokenHash: createHash('sha256').update(token).digest('hex'),
          updatedAt: new Date(),
        },
      },
    );

    await writeAudit({
      action: 'ad.campaign.reportLink',
      entityType: 'campaign',
      entityId: id.data,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      /* Whether one was replaced, never the token itself. */
      before: { hadLink: Boolean(existing.reportTokenHash) },
      after: { issued: true },
      ip: req.ip ?? null,
    });

    res.status(201).json({ campaignId: id.data, token, replaced: Boolean(existing.reportTokenHash) });
  }),
);

/* ── Advertisers ────────────────────────────────────────────────────────────── */

const AdvertiserBody = z.object({
  /** Internal and unique: how the newsroom refers to them. */
  name: z.string().trim().min(1).max(120),
  /** Printed on every ad. Readers are owed the real name of who paid. */
  displayName: z.string().trim().min(1).max(60),
  contactEmail: z.string().trim().email(),
  isActive: z.boolean().default(true),
});

adRoutes.get(
  '/cms/ads/advertisers',
  asyncRoute(async (_req, res) => {
    const rows = await advertisers().find({}).sort({ name: 1 }).limit(500).toArray();
    const counts = await campaigns()
      .aggregate<{ _id: ObjectId; n: number }>([{ $group: { _id: '$advertiserId', n: { $sum: 1 } } }])
      .toArray();
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      items: rows.map((a) => ({
        id: a._id.toString(),
        name: String(a.name ?? ''),
        displayName: String(a.displayName ?? ''),
        contactEmail: String(a.contactEmail ?? ''),
        isActive: a.isActive !== false,
        campaigns: byId.get(a._id.toString()) ?? 0,
      })),
    });
  }),
);

function duplicateName(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

adRoutes.post(
  '/cms/ads/advertisers',
  asyncRoute(async (req, res) => {
    const parsed = AdvertiserBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Check the advertiser.');
    }
    const now = new Date();
    const _id = new ObjectId();
    try {
      await advertisers().insertOne({ _id, ...parsed.data, createdAt: now, updatedAt: now });
    } catch (e) {
      if (duplicateName(e)) throw new AppError('VALIDATION_FAILED', `An advertiser called “${parsed.data.name}” already exists.`);
      throw e;
    }
    await writeAudit({
      action: 'ad.advertiser.create',
      entityType: 'advertiser',
      entityId: _id.toString(),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: parsed.data,
      ip: req.ip ?? null,
    });
    res.status(201).json({ id: _id.toString() });
  }),
);

adRoutes.post(
  '/cms/ads/advertisers/:id/edit',
  asyncRoute(async (req, res) => {
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) throw new AppError('BAD_REQUEST', 'Malformed id.');
    const parsed = AdvertiserBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Check the advertiser.');
    }
    const _id = new ObjectId(id.data);
    const existing = await advertisers().findOne({ _id });
    if (!existing) throw new AppError('NOT_FOUND');

    try {
      await advertisers().updateOne({ _id }, { $set: { ...parsed.data, updatedAt: new Date() } });
    } catch (e) {
      if (duplicateName(e)) throw new AppError('VALIDATION_FAILED', `An advertiser called “${parsed.data.name}” already exists.`);
      throw e;
    }
    /* The printed name is denormalised onto every campaign, so a rename must
       reach them, or live ads keep the old one. */
    if (existing.displayName !== parsed.data.displayName) {
      await campaigns().updateMany(
        { advertiserId: _id },
        { $set: { advertiserName: parsed.data.displayName, updatedAt: new Date() } },
      );
    }
    await writeAudit({
      action: 'ad.advertiser.edit',
      entityType: 'advertiser',
      entityId: id.data,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: {
        name: existing.name,
        displayName: existing.displayName,
        contactEmail: existing.contactEmail,
        isActive: existing.isActive,
      },
      after: parsed.data,
      ip: req.ip ?? null,
    });
    res.json({ ok: true });
  }),
);
