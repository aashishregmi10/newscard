import { ObjectId, type Filter } from 'mongodb';
import { getDb } from '@newscard/db';
import { adSlotsForPage, clampDensity, type AdDensityConfig } from '@newscard/shared';
import { isVirtualCategory, type AdCardDto, type ArticleCardDto, type Language } from '@newscard/schemas';

/**
 * Ad selection and injection.
 *
 * Two jobs, kept separate on purpose: WHICH ad to show (this file) and HOW
 * OFTEN (packages/shared/adPolicy). The density rules are pure and heavily
 * tested precisely so that no amount of selection cleverness can quietly raise
 * them.
 */

interface CampaignDoc {
  _id: ObjectId;
  advertiserId: ObjectId;
  advertiserName?: string;
  status: string;
  language: Language;
  categories: string[];
  startsAt: Date;
  endsAt: Date;
  impressionGoal: number;
  dailyImpressionCap: number;
  weight: number;
  creative: {
    headline: string;
    body: string;
    callToAction: { ne: string; en: string };
    landingUrl: string;
    image: {
      blurHash?: string | null;
      urls: { sm?: string | null; md?: string | null; lg?: string | null };
    } | null;
  };
  stats: { impressions: number; viewableImpressions: number; clicks: number };
}

const campaigns = () => getDb().collection<CampaignDoc>('campaigns');
const adEvents = () => getDb().collection('adEvents');

/** Impressions this campaign has already served today, for pacing. */
async function servedToday(campaignId: ObjectId): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  return adEvents().countDocuments({
    campaignId,
    type: 'impression',
    occurredAt: { $gte: since },
  });
}

/**
 * Eligible campaigns for this request, in weighted-random order.
 *
 * Weighted rather than strictly ordered so a single high-weight campaign does
 * not monopolise every slot — an advertiser who bought 20% of inventory should
 * see their ad spread across the day, not delivered in one burst.
 */
export async function selectCampaigns(
  languages: Language[],
  categorySlug: string,
  count: number,
): Promise<CampaignDoc[]> {
  if (count <= 0) return [];
  const now = new Date();

  const filter: Filter<CampaignDoc> = {
    status: 'live',
    language: { $in: languages },
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    // Never over-deliver. An advertiser billed for impressions they did not
    // buy is a refund and a lost relationship.
    $expr: { $lt: ['$stats.impressions', '$impressionGoal'] },
  };

  const eligible = await campaigns().find(filter).limit(50).toArray();

  // `top` and `all` are virtual — no article carries them, they are the mixed
  // feed. A campaign that bought "business" must be eligible there, because the
  // business stories it bought are on that screen. Matching the slug literally
  // would make every targeted campaign undeliverable on the app's default tab,
  // which is where nearly all impressions are.
  const matching = eligible.filter(
    (c) =>
      c.categories.length === 0 ||
      isVirtualCategory(categorySlug) ||
      c.categories.includes(categorySlug),
  );

  // Pacing: drop anything that has hit today's allowance.
  const paced: CampaignDoc[] = [];
  for (const c of matching) {
    if (c.dailyImpressionCap > 0) {
      const today = await servedToday(c._id);
      if (today >= c.dailyImpressionCap) continue;
    }
    paced.push(c);
  }

  // Weighted shuffle: one random draw per campaign, scaled by weight.
  return paced
    .map((c) => ({ c, key: Math.random() ** (1 / Math.max(1, c.weight)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.c);
}

/**
 * `placement` is the absolute position of the slot in the reader's session.
 *
 * It is part of the id because the same campaign legitimately reappears further
 * down the feed, and the two are DIFFERENT impressions. A campaign-only id
 * would collide as a list key and, worse, make the client's
 * one-impression-per-ad rule silently discard the second one — under-reporting
 * delivery to the advertiser we are billing.
 */
export function toAdCard(c: CampaignDoc, placement: number): AdCardDto {
  return {
    kind: 'ad',
    id: `ad_${c._id.toString()}_${placement}`,
    campaignId: c._id.toString(),
    language: c.language,
    advertiser: c.advertiserName ?? 'Sponsor',
    headline: c.creative.headline,
    body: c.creative.body,
    callToAction: c.creative.callToAction,
    landingUrl: c.creative.landingUrl,
    image: c.creative.image
      ? {
          blurHash: c.creative.image.blurHash ?? null,
          urls: {
            sm: c.creative.image.urls.sm ?? null,
            md: c.creative.image.urls.md ?? null,
            lg: c.creative.image.urls.lg ?? null,
          },
        }
      : null,
  };
}

export type FeedEntry = (ArticleCardDto & { kind: 'article' }) | AdCardDto;

/**
 * Interleave ads into a page of content.
 *
 * Content order is never changed — ads are inserted between cards, so the
 * editorial sequence and the diversity work upstream survive intact.
 */
export async function injectAds(
  articles: ArticleCardDto[],
  opts: {
    languages: Language[];
    categorySlug: string;
    pageOffset: number;
    density: AdDensityConfig;
    adsShownToday: number;
  },
): Promise<{ entries: FeedEntry[]; adCount: number }> {
  const density = clampDensity(opts.density);
  const slots = adSlotsForPage(articles.length, opts.pageOffset, density, opts.adsShownToday);

  if (slots.length === 0) {
    return { entries: articles.map((a) => ({ ...a, kind: 'article' as const })), adCount: 0 };
  }

  const picked = await selectCampaigns(opts.languages, opts.categorySlug, slots.length);
  // Fewer campaigns than slots simply means fewer ads. An empty slot is left
  // empty rather than filled with a repeat — showing the same ad twice on one
  // screen reads as a bug and annoys the advertiser as much as the reader.
  if (picked.length === 0) {
    return { entries: articles.map((a) => ({ ...a, kind: 'article' as const })), adCount: 0 };
  }

  const slotSet = new Map<number, CampaignDoc>();
  slots.slice(0, picked.length).forEach((slot, i) => slotSet.set(slot, picked[i]!));

  const entries: FeedEntry[] = [];
  articles.forEach((a, i) => {
    entries.push({ ...a, kind: 'article' as const });
    const campaign = slotSet.get(i);
    if (campaign) entries.push(toAdCard(campaign, opts.pageOffset + i + 1));
  });

  return { entries, adCount: slotSet.size };
}
