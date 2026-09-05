import { ObjectId } from 'mongodb';
import { getDb } from '@newscard/db';
import { VIEWABLE_THRESHOLD_MS } from '@newscard/schemas';

/**
 * Advertiser reporting.
 *
 * ── What an advertiser is owed ──────────────────────────────────────────────
 * A small Kathmandu business spending real money deserves to know what they
 * got, in terms they can check. Three principles shape this:
 *
 *   Report VIEWABLE separately from raw impressions. An advertiser told
 *   "10,000 impressions" who later works out that half were scrolled past in
 *   under a second stops believing every number we give them. Publishing the
 *   stricter figure ourselves is what makes the softer one credible.
 *
 *   Report REACH, not just volume. "8,000 impressions" and "8,000 people"
 *   are wildly different purchases, and frequency is the difference.
 *
 *   Never report anything about an individual. Everything below is an
 *   aggregate; the underlying rows are keyed to a random install id and carry
 *   no advertising identifier, no location and no profile. That is a
 *   constraint, and it is also the honest answer when an advertiser asks who
 *   saw their ad.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface CampaignReport {
  campaignId: string;
  campaignName: string;
  advertiser: string;
  status: string;
  period: { from: string; to: string };

  delivery: {
    impressions: number;
    /** On screen for at least VIEWABLE_THRESHOLD_MS. */
    viewableImpressions: number;
    /** viewable / impressions — the honest quality number. */
    viewabilityRate: number;
    goal: number;
    /** How much of the purchased volume has been delivered. */
    completionRate: number;
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

  reach: {
    /** Distinct devices that saw it at least once. */
    devices: number;
    /** impressions / devices — how often the average person saw it. */
    averageFrequency: number;
  };

  /** Where the ad ran. Useful to an advertiser choosing categories next time. */
  byCategory: Array<{ category: string; impressions: number; clicks: number }>;
  /** Delivery over time, for pacing. */
  daily: Array<{ date: string; impressions: number; viewable: number; clicks: number }>;
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));
const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

export async function buildCampaignReport(
  campaignId: string,
  from: Date,
  to: Date,
): Promise<CampaignReport | null> {
  const db = getDb();
  const _id = new ObjectId(campaignId);

  const campaign = await db.collection('campaigns').findOne({ _id });
  if (!campaign) return null;

  const advertiser = await db
    .collection('advertisers')
    .findOne({ _id: campaign.advertiserId as ObjectId });

  const match = { campaignId: _id, occurredAt: { $gte: from, $lte: to } };

  // One pass for the headline counters.
  const [totals] = await db
    .collection('adEvents')
    .aggregate<{
      impressions: number;
      viewable: number;
      clicks: number;
      devices: string[];
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } },
          viewable: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$type', 'impression'] },
                    { $gte: ['$dwellMs', VIEWABLE_THRESHOLD_MS] },
                  ],
                },
                1,
                0,
              ],
            },
          },
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

  // Median rather than mean: a handful of phones left on a card for two
  // minutes would drag a mean upward and overstate attention.
  const dwells = await db
    .collection('adEvents')
    .find({ ...match, type: 'impression' }, { projection: { dwellMs: 1 } })
    .sort({ dwellMs: 1 })
    .toArray();
  const medianDwellMs =
    dwells.length === 0 ? 0 : (dwells[Math.floor(dwells.length / 2)]?.dwellMs as number) ?? 0;

  const byCategory = await db
    .collection('adEvents')
    .aggregate<{ _id: string; impressions: number; clicks: number }>([
      { $match: match },
      {
        $group: {
          _id: '$categorySlug',
          impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } },
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
          impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } },
          viewable: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$type', 'impression'] },
                    { $gte: ['$dwellMs', VIEWABLE_THRESHOLD_MS] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return {
    campaignId,
    campaignName: String(campaign.name ?? ''),
    advertiser: String(advertiser?.displayName ?? advertiser?.name ?? 'Unknown'),
    status: String(campaign.status ?? ''),
    period: { from: from.toISOString(), to: to.toISOString() },

    delivery: {
      impressions,
      viewableImpressions: viewable,
      viewabilityRate: round(safeDiv(viewable, impressions)),
      goal: Number(campaign.impressionGoal ?? 0),
      completionRate: round(safeDiv(impressions, Number(campaign.impressionGoal ?? 0))),
    },

    engagement: {
      clicks,
      clickThroughRate: round(safeDiv(clicks, impressions)),
      viewableClickThroughRate: round(safeDiv(clicks, viewable)),
      medianDwellSeconds: round(medianDwellMs / 1000, 2),
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
