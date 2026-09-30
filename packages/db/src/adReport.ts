import { ObjectId, type Db } from 'mongodb';
import { campaignWeight, flightDays, DAY_MS, servingPool, shareOfVoice } from '@saar/shared';
import { VIEWABLE_THRESHOLD_MS, type AdPlacement } from '@saar/schemas';

/**
 * Advertiser reporting.
 *
 * Lives here, beside the collections it aggregates, because two applications
 * need it and neither may import the other: the public report page (served
 * through the reader API) and the Advertising section of the editorial site.
 * One implementation means the number an advertiser reads and the number the
 * newsroom reads are the same number.
 *
 * ── What an advertiser is owed ──────────────────────────────────────────────
 * A small Kathmandu business spending real money deserves to know what they
 * got, in terms they can check:
 *
 *   What they PAID for, and what it buys: price, days, price per day, and the
 *   share of the placement's slots that price currently commands.
 *
 *   What was DELIVERED: views, and separately the views that were actually on
 *   screen for a second — an advertiser told "10,000 views" who later works
 *   out half were scrolled past in a blink stops believing every number.
 *   Reach, not just volume: "8,000 views" and "8,000 people" are different
 *   purchases, and frequency is the difference.
 *
 *   What it was WORTH: the effective cost per thousand views and per click.
 *   Under time pricing views are not guaranteed, so this is how both sides see
 *   whether the price was right.
 *
 *   Whether the weighting did what it PROMISED: of all views in this placement
 *   over the period, the share this campaign received, beside the share of
 *   voice it paid for. They should match. Where they do not, it is because
 *   language or section targeting narrowed where the campaign could appear —
 *   which is then visible and explainable, rather than a mystery.
 *
 *   Never anything about an individual. Every figure is an aggregate; the rows
 *   underneath are keyed to a random install id and carry no advertising
 *   identifier, no location and no profile.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface CampaignReport {
  campaignId: string;
  campaignName: string;
  advertiser: string;
  status: string;
  placement: AdPlacement;
  period: { from: string; to: string };

  paid: {
    /** Paisa, integer. */
    pricePaisa: number;
    startsAt: string;
    endsAt: string;
    days: number;
    daysElapsed: number;
    /** The campaign's weight. */
    pricePerDayPaisa: number;
    /** Its share of the placement's slots among the campaigns running now,
     *  0–1. Null when it is not running, since it then has none. */
    shareOfVoiceNow: number | null;
  };

  delivery: {
    impressions: number;
    /** On screen for at least VIEWABLE_THRESHOLD_MS. */
    viewableImpressions: number;
    /** viewable / impressions — the honest quality number. */
    viewabilityRate: number;
    /** Only for a campaign sold with a view target; null for one sold by time. */
    goal: number | null;
    completionRate: number | null;
    /** Of every view in this placement over the period, the fraction this
     *  campaign had. Compare with shareOfVoiceNow. */
    deliveredShare: number;
  };

  engagement: {
    clicks: number;
    /** clicks / impressions */
    clickThroughRate: number;
    /** Against viewable impressions — the fairer denominator, since an ad that
     *  was never seen could not have been clicked. */
    viewableClickThroughRate: number;
    /** Median seconds an ad was on screen. */
    medianDwellSeconds: number;
  };

  value: {
    /** The part of the price for the days that have run, in paisa. */
    spentToDatePaisa: number;
    /** Per thousand views, paisa. Null until there is a view to divide by. */
    costPerThousandViewsPaisa: number | null;
    costPerClickPaisa: number | null;
  };

  reach: {
    /** Distinct devices that saw it at least once. */
    devices: number;
    /** impressions / devices — how often the average person saw it. */
    averageFrequency: number;
  };

  /** Where the ad ran. Useful to an advertiser choosing sections next time. */
  byCategory: Array<{ category: string; impressions: number; clicks: number }>;
  /** Delivery over time. */
  daily: Array<{ date: string; impressions: number; viewable: number; clicks: number }>;
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));
const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

interface CampaignRow {
  _id: ObjectId;
  advertiserId: ObjectId;
  name?: string;
  status?: string;
  placement?: AdPlacement;
  language?: string;
  pricePaisa?: number;
  startsAt: Date;
  endsAt: Date;
  impressionGoal?: number | null;
}

/** Events written before placements existed carry none: they were full-card. */
const placementMatch = (placement: AdPlacement) =>
  placement === 'card'
    ? { $or: [{ placement: 'card' }, { placement: { $exists: false } }] }
    : { placement };

/**
 * Share of voice among the campaigns in a placement that are RUNNING at
 * `now`, keyed by campaign id. The same pool serving draws from, less the
 * per-request language and section filter, which varies by reader.
 */
export async function runningShareOfVoice(
  db: Db,
  placement: AdPlacement,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const running = (await db
    .collection('campaigns')
    .find({
      status: 'live',
      startsAt: { $lte: now },
      endsAt: { $gte: now },
      ...placementMatch(placement),
    })
    .project({ pricePaisa: 1, startsAt: 1, endsAt: 1 })
    .toArray()) as unknown as CampaignRow[];

  const pool = servingPool(
    running.map((c) => ({ ...c, pricePaisa: c.pricePaisa ?? 0 })),
  );
  const shares = shareOfVoice(pool);
  return new Map(pool.map((x, i) => [x.item._id.toString(), shares[i] ?? 0]));
}

export async function buildCampaignReport(
  db: Db,
  campaignId: string,
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<CampaignReport | null> {
  const _id = new ObjectId(campaignId);

  const campaign = (await db.collection('campaigns').findOne({ _id })) as CampaignRow | null;
  if (!campaign) return null;
  const placement: AdPlacement = campaign.placement ?? 'card';

  const advertiser = await db.collection('advertisers').findOne({ _id: campaign.advertiserId });

  const match = { campaignId: _id, occurredAt: { $gte: from, $lte: to } };
  const isImpression = { $eq: ['$type', 'impression'] };
  const isViewable = { $and: [isImpression, { $gte: ['$dwellMs', VIEWABLE_THRESHOLD_MS] }] };

  const [totals] = await db
    .collection('adEvents')
    .aggregate<{ impressions: number; viewable: number; clicks: number; devices: string[] }>([
      { $match: match },
      {
        $group: {
          _id: null,
          impressions: { $sum: { $cond: [isImpression, 1, 0] } },
          viewable: { $sum: { $cond: [isViewable, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
          devices: { $addToSet: '$deviceId' },
        },
      },
    ])
    .toArray();

  const impressions = totals?.impressions ?? 0;
  const viewable = totals?.viewable ?? 0;
  const clicks = totals?.clicks ?? 0;
  const devices = totals?.devices?.length ?? 0;

  /* Every view in the same placement over the same period, for the delivered
     share. Served by ad_events_by_placement. */
  const placementViews = await db.collection('adEvents').countDocuments({
    type: 'impression',
    occurredAt: { $gte: from, $lte: to },
    ...placementMatch(placement),
  });

  // Median rather than mean: a handful of phones left on a card for two
  // minutes would drag a mean upward and overstate attention.
  const dwells = await db
    .collection('adEvents')
    .find({ ...match, type: 'impression' }, { projection: { dwellMs: 1 } })
    .sort({ dwellMs: 1 })
    .toArray();
  const medianDwellMs =
    dwells.length === 0 ? 0 : ((dwells[Math.floor(dwells.length / 2)]?.dwellMs as number) ?? 0);

  const byCategory = await db
    .collection('adEvents')
    .aggregate<{ _id: string; impressions: number; clicks: number }>([
      { $match: match },
      {
        $group: {
          _id: '$categorySlug',
          impressions: { $sum: { $cond: [isImpression, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        },
      },
      { $sort: { impressions: -1 } },
    ])
    .toArray();

  const daily = await db
    .collection('adEvents')
    .aggregate<{ _id: string; impressions: number; viewable: number; clicks: number }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
          impressions: { $sum: { $cond: [isImpression, 1, 0] } },
          viewable: { $sum: { $cond: [isViewable, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  /* ---- what was paid, and what it bought -------------------------------- */
  const price = campaign.pricePaisa ?? 0;
  const days = flightDays(campaign.startsAt, campaign.endsAt);
  const elapsedMs = Math.min(
    Math.max(0, now.getTime() - campaign.startsAt.getTime()),
    campaign.endsAt.getTime() - campaign.startsAt.getTime(),
  );
  const daysElapsed = Math.min(days, Math.max(0, Math.ceil(elapsedMs / DAY_MS)));
  const spentToDate = Math.round((price * daysElapsed) / days);

  const running =
    campaign.status === 'live' && campaign.startsAt <= now && campaign.endsAt >= now;
  const sov = running ? (await runningShareOfVoice(db, placement, now)).get(campaignId) ?? 0 : null;

  const goal = typeof campaign.impressionGoal === 'number' ? campaign.impressionGoal : null;

  return {
    campaignId,
    campaignName: String(campaign.name ?? ''),
    advertiser: String(advertiser?.displayName ?? advertiser?.name ?? 'Unknown'),
    status: String(campaign.status ?? ''),
    placement,
    period: { from: from.toISOString(), to: to.toISOString() },

    paid: {
      pricePaisa: price,
      startsAt: campaign.startsAt.toISOString(),
      endsAt: campaign.endsAt.toISOString(),
      days,
      daysElapsed,
      pricePerDayPaisa: Math.round(campaignWeight({ ...campaign, pricePaisa: price })),
      shareOfVoiceNow: sov === null ? null : round(sov),
    },

    delivery: {
      impressions,
      viewableImpressions: viewable,
      viewabilityRate: round(safeDiv(viewable, impressions)),
      goal,
      completionRate: goal === null ? null : round(safeDiv(impressions, goal)),
      deliveredShare: round(safeDiv(impressions, placementViews)),
    },

    engagement: {
      clicks,
      clickThroughRate: round(safeDiv(clicks, impressions)),
      viewableClickThroughRate: round(safeDiv(clicks, viewable)),
      medianDwellSeconds: round(medianDwellMs / 1000, 2),
    },

    value: {
      spentToDatePaisa: spentToDate,
      costPerThousandViewsPaisa:
        impressions === 0 ? null : Math.round((spentToDate / impressions) * 1000),
      costPerClickPaisa: clicks === 0 ? null : Math.round(spentToDate / clicks),
    },

    reach: {
      devices,
      averageFrequency: round(safeDiv(impressions, devices), 2),
    },

    byCategory: byCategory.map((r) => ({
      category: r._id ?? 'unknown',
      impressions: r.impressions,
      clicks: r.clicks,
    })),

    daily: daily.map((r) => ({
      date: r._id,
      impressions: r.impressions,
      viewable: r.viewable,
      clicks: r.clicks,
    })),
  };
}
