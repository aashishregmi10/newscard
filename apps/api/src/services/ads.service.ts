import { ObjectId, type Filter } from 'mongodb';
import { getDb } from '@saar/db';
import {
  adSlotsForPage,
  clampDensity,
  inlineSlotsForPage,
  interleaveWeighted,
  pickDistinctWeighted,
  servingPool,
  type AdDensityConfig,
  type InlineAdConfig,
  type Rng,
} from '@saar/shared';
import {
  isVirtualCategory,
  type AdCardDto,
  type AdPlacement,
  type ArticleCardDto,
  type InlineAdDto,
  type Language,
} from '@saar/schemas';

/**
 * Ad selection and injection.
 *
 * Two jobs, kept separate on purpose: WHICH ad to show (this file, drawing with
 * the weights in adPolicy.ts) and HOW OFTEN (the density rules, also there).
 * The density rules are pure and heavily tested precisely so that no amount of
 * selection cleverness can quietly raise them.
 *
 * Two placements, weighted separately — they are different products at
 * different prices, and a small-ad buyer must never take a poster slot:
 *
 *   card     a whole card between stories, at the density adPolicy allows
 *   inline   a small labelled link on a story itself, beside save and share
 */

interface CampaignDoc {
  _id: ObjectId;
  advertiserId: ObjectId;
  advertiserName?: string;
  status: string;
  /** Absent on campaigns from before placements existed: all full-card. */
  placement?: AdPlacement;
  language: Language;
  categories: string[];
  startsAt: Date;
  endsAt: Date;
  pricePaisa: number;
  impressionGoal?: number | null;
  dailyImpressionCap?: number | null;
  creative: {
    headline: string;
    body?: string | null;
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

const placementOf = (c: CampaignDoc): AdPlacement => c.placement ?? 'card';

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
 * Every campaign that may be shown on this request, both placements.
 *
 * One query for both: they share every condition except placement, and the
 * split is a filter in memory over a handful of documents.
 */
export async function eligibleCampaigns(
  languages: Language[],
  categorySlug: string,
): Promise<CampaignDoc[]> {
  const now = new Date();

  const filter: Filter<CampaignDoc> = {
    status: 'live',
    language: { $in: languages },
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    /*
     * A goal, where one was sold, still stops delivery: an advertiser billed for
     * impressions they did not buy is a refund and a lost relationship.
     *
     * But time-sold campaigns carry no goal, and `$lt` against a missing field
     * compares with null — which every number is greater than — so the old
     * filter alone would have silently excluded every one of them.
     */
    $or: [
      { impressionGoal: { $exists: false } },
      { impressionGoal: null },
      { $expr: { $lt: ['$stats.impressions', '$impressionGoal'] } },
    ],
  };

  const eligible = await campaigns().find(filter).limit(100).toArray();

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

  // Pacing, for a campaign sold with one. Time-sold campaigns have none.
  const paced: CampaignDoc[] = [];
  for (const c of matching) {
    const cap = c.dailyImpressionCap ?? 0;
    if (cap > 0 && (await servedToday(c._id)) >= cap) continue;
    paced.push(c);
  }
  return paced;
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
    body: c.creative.body ?? '',
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

/**
 * The small ad, for the story with this id.
 *
 * The id pairs the campaign with the story rather than with a position: the
 * same story scrolled past twice is one impression, and two stories carrying
 * the same campaign are two.
 */
export function toInlineAd(c: CampaignDoc, articleId: string): InlineAdDto {
  return {
    kind: 'inlineAd',
    id: `inl_${c._id.toString()}_${articleId}`,
    campaignId: c._id.toString(),
    language: c.language,
    advertiser: c.advertiserName ?? 'Sponsor',
    text: c.creative.headline,
    landingUrl: c.creative.landingUrl,
    logo: c.creative.image
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

export type ArticleEntry = ArticleCardDto & { kind: 'article'; inlineAd?: InlineAdDto };
export type FeedEntry = ArticleEntry | AdCardDto;

/**
 * Interleave ads into a page of content.
 *
 * Content order is never changed — full-card ads are inserted between cards
 * and small ads ride on the cards they belong to, so the editorial sequence
 * and the diversity work upstream survive intact.
 */
export async function injectAds(
  articles: ArticleCardDto[],
  opts: {
    languages: Language[];
    categorySlug: string;
    pageOffset: number;
    density: AdDensityConfig;
    adsShownToday: number;
    inline: Partial<InlineAdConfig>;
    inlineShownToday: number;
    /** Stories that must not carry a small ad: marked by an editor, or from a
     *  publisher whose agreement does not allow it. */
    inlineBlocked: ReadonlySet<string>;
    rng?: Rng;
  },
): Promise<{ entries: FeedEntry[]; adCount: number; inlineCount: number }> {
  const rng = opts.rng ?? Math.random;
  const density = clampDensity(opts.density);

  const cardSlots = adSlotsForPage(articles.length, opts.pageOffset, density, opts.adsShownToday);
  const inlineSlots = inlineSlotsForPage(
    articles.length,
    opts.pageOffset,
    opts.inline,
    opts.inlineShownToday,
  ).filter((i) => !opts.inlineBlocked.has(articles[i]!.id));

  const plain = (): { entries: FeedEntry[]; adCount: number; inlineCount: number } => ({
    entries: articles.map((a) => ({ ...a, kind: 'article' as const })),
    adCount: 0,
    inlineCount: 0,
  });

  if (cardSlots.length === 0 && inlineSlots.length === 0) return plain();

  const eligible = await eligibleCampaigns(opts.languages, opts.categorySlug);
  if (eligible.length === 0) return plain();

  /* ---- full-card: distinct per page ---------------------------------------- */
  // Fewer campaigns than slots simply means fewer ads. An empty slot is left
  // empty rather than filled with a repeat — the same poster twice on one
  // screen reads as a bug and annoys the advertiser as much as the reader.
  const cardPool = servingPool(eligible.filter((c) => placementOf(c) === 'card'));
  const cardPicks = pickDistinctWeighted(cardPool, cardSlots.length, rng);
  const cardAt = new Map<number, CampaignDoc>();
  cardSlots.slice(0, cardPicks.length).forEach((slot, i) => cardAt.set(slot, cardPicks[i]!));

  /* ---- small ad: interleaved across the page's stories ---------------------- */
  // Each advertiser gets its share of voice of this page's small ads to within
  // one, spread out rather than clumped. Why not independent draws, and why not
  // "never the same advertiser twice running": see interleaveWeighted.
  const inlinePool = servingPool(eligible.filter((c) => placementOf(c) === 'inline'));
  const inlinePicks = interleaveWeighted(inlinePool, inlineSlots.length, rng);
  const inlineAt = new Map<number, CampaignDoc>();
  inlineSlots.slice(0, inlinePicks.length).forEach((slot, i) => inlineAt.set(slot, inlinePicks[i]!));

  const entries: FeedEntry[] = [];
  articles.forEach((a, i) => {
    const inline = inlineAt.get(i);
    entries.push({
      ...a,
      kind: 'article' as const,
      ...(inline ? { inlineAd: toInlineAd(inline, a.id) } : {}),
    });
    const card = cardAt.get(i);
    if (card) entries.push(toAdCard(card, opts.pageOffset + i + 1));
  });

  return { entries, adCount: cardAt.size, inlineCount: inlineAt.size };
}
