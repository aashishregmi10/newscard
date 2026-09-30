import { z } from 'zod';
import { LanguageEnum } from './enums.js';
import { HttpsUrl, LocalisedText, ObjectIdString } from './common.js';

/**
 * Advertising.  Direct-sold sponsorship, not programmatic.
 *
 * ── Why this is built rather than bought ────────────────────────────────────
 * An advertising SDK would be faster to integrate and worse in every way that
 * matters here:
 *
 *   Revenue   Programmatic CPMs in Nepal are very low. Direct-sold local
 *             sponsorship is worth several times more per impression, which is
 *             the whole reason the teardown recommended it.
 *   Privacy   Third-party SDKs collect an advertising ID and phone home. This
 *             one collects nothing beyond what the app already stores, so the
 *             store privacy disclosure stays short and true.
 *   Size      Ad SDKs are among the largest and most start-up-expensive mobile
 *             dependencies — on a metered connection and an entry-level phone
 *             that is a real cost.
 *   Control   We decide the density. An ad network's incentive is to raise it.
 *
 * The forbidden-dependency CI check still blocks third-party ad SDKs, and is
 * now more important rather than less.
 */

/** An advertiser — the organisation buying, kept separate so reporting and
 *  billing attach to them rather than to a campaign. */
export const Advertiser = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email(),
  /** Shown on the card. Readers are owed the real name of who paid. */
  displayName: z.string().min(1),
  isActive: z.boolean().default(true),
});
export type Advertiser = z.infer<typeof Advertiser>;

export const CampaignStatusEnum = z.enum(['draft', 'scheduled', 'live', 'paused', 'ended']);
export type CampaignStatus = z.infer<typeof CampaignStatusEnum>;

/**
 * Where an ad appears. Two different products, sold and weighted separately.
 *
 *   card     takes a whole card in the feed, between stories — the poster.
 *            Density is the policy in adPolicy.ts: one in ten at most.
 *   inline   a small labelled link in a story’s action row, beside save and
 *            share. On every story by default; see DEFAULT_INLINE_ADS.
 *
 * A campaign belongs to exactly one. A business that wants both buys two, which
 * keeps each price, each share of voice and each report about one thing.
 */
export const AdPlacementEnum = z.enum(['card', 'inline']);
export type AdPlacement = z.infer<typeof AdPlacementEnum>;

/** The most text the small ad can carry and still fit beside two icons on a
 *  360dp phone with the publisher name. Measured in graphemes, as a summary is. */
export const INLINE_AD_TEXT_MAX = 24;

/**
 * What the advertiser supplied. One shape for both placements; which fields
 * matter depends on where it runs.
 *
 *                card (poster)                     inline (small ad)
 *   headline     one-line description — the       the words on the pill,
 *                screen-reader label, and what      INLINE_AD_TEXT_MAX at most
 *                data-saver shows instead of the
 *                poster
 *   body         optional supporting line           unused
 *   image        the poster, portrait               an optional square logo
 *   callToAction the button                         unused (the pill is the link)
 */
export const AdCreative = z.object({
  headline: z.string().min(2).max(90),
  /** Optional now that the full-card ad is a poster: the image carries the
   *  message, and a forced paragraph under it was copy nobody would read. */
  body: z.string().max(300).nullable().optional(),
  /** The words on the button. Kept short so it never wraps on a small screen. */
  callToAction: LocalisedText,
  /** Where a tap goes. HTTPS only, opened in the in-app browser like any link. */
  landingUrl: HttpsUrl,
  image: z
    .object({
      credit: z.string().nullable().optional(),
      blurHash: z.string().nullable().optional(),
      width: z.number().int().positive().nullable().optional(),
      height: z.number().int().positive().nullable().optional(),
      urls: z.object({
        sm: z.string().nullable().optional(),
        md: z.string().nullable().optional(),
        lg: z.string().nullable().optional(),
      }),
    })
    .nullable(),
});
export type AdCreative = z.infer<typeof AdCreative>;

export const Campaign = z
  .object({
    advertiserId: ObjectIdString,
    name: z.string().min(1),
    status: CampaignStatusEnum,
    /** Absent on campaigns created before placements existed, which were all
     *  full-card. Read as `card`. */
    placement: AdPlacementEnum.default('card'),
    language: LanguageEnum,
    creative: AdCreative,

    /** Empty means every category. Targeting is category and language only —
     *  no behavioural or location targeting, which is what lets us promise
     *  advertisers reach without profiling readers. */
    categories: z.array(z.string()).default([]),

    startsAt: z.date(),
    endsAt: z.date(),

    /**
     * What was paid, for the whole flight. Nepali paisa, integer: money is
     * never a float.
     *
     * This is also what decides how often the ad is shown. Advertising is sold
     * by time — "Rs 5,000 for a week" — so the weight is the price PER DAY
     * (campaignWeight in adPolicy.ts). A campaign that paid twice as much per
     * day is shown twice as often; one that paid 0 is a house ad, shown only
     * when no paying campaign can fill the slot.
     *
     * There used to be a separate `weight`, typed in by hand. Two numbers that
     * both claim to mean "how much this advertiser gets" will disagree, and the
     * one the advertiser can see on their invoice is the one that should win.
     */
    pricePaisa: z.number().int().nonnegative().default(0),

    /**
     * Optional caps, from when campaigns were sold by impressions. Time-sold
     * campaigns leave both unset and are shown for their whole flight; a
     * campaign that does carry one stops or paces on it, so older campaigns
     * keep behaving as they were sold.
     */
    impressionGoal: z.number().int().positive().nullable().optional(),
    dailyImpressionCap: z.number().int().nonnegative().nullable().optional(),

    /**
     * sha256 of the campaign's report token.
     *
     * The report shows an advertiser what they bought and what it delivered —
     * commercial information about a paying customer. Campaign ids travel in
     * every feed response (inside the ad card id), so an unauthenticated report
     * endpoint would let any reader pull any advertiser's performance.
     *
     * The token is issued once, given to the advertiser, and only its hash is
     * stored: a database dump yields no working report links, and the token can
     * be rotated by overwriting this field.
     */
    reportTokenHash: z.string().nullable().default(null),

    /** Running totals, updated as events arrive. Denormalised so serving does
     *  not have to aggregate the event collection on every request. */
    stats: z
      .object({
        impressions: z.number().int().nonnegative().default(0),
        viewableImpressions: z.number().int().nonnegative().default(0),
        clicks: z.number().int().nonnegative().default(0),
      })
      .default({ impressions: 0, viewableImpressions: 0, clicks: 0 }),
  })
  .superRefine((c, ctx) => {
    if (c.endsAt <= c.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'endsAt must be after startsAt',
      });
    }
  });
export type Campaign = z.infer<typeof Campaign>;

/** The public shape of an ad in the feed. Mirrors the article card so the
 *  client renders one list, but is explicitly typed so it can NEVER be
 *  mistaken for editorial. */
export const AdCardDto = z.object({
  kind: z.literal('ad'),
  id: z.string(),
  campaignId: z.string(),
  language: LanguageEnum,
  advertiser: z.string(),
  headline: z.string(),
  body: z.string(),
  callToAction: LocalisedText,
  landingUrl: z.string(),
  image: z
    .object({
      blurHash: z.string().nullable(),
      urls: z.object({
        sm: z.string().nullable(),
        md: z.string().nullable(),
        lg: z.string().nullable(),
      }),
    })
    .nullable(),
});
export type AdCardDto = z.infer<typeof AdCardDto>;

/**
 * The small ad, as the app receives it.
 *
 * Attached to a story’s FEED ENTRY, never to ArticleCardDto: the card DTO is a
 * snapshot-tested whitelist, it is what the deep-link endpoint returns, and it
 * is what the phone caches for offline reading — and an ad must not be
 * replayed from a cache after its campaign has ended.
 */
export const InlineAdDto = z.object({
  kind: z.literal('inlineAd'),
  /** Unique per story it sits on, for the same reason a card ad’s id carries
   *  its position: two stories carrying one campaign are two impressions. */
  id: z.string(),
  campaignId: z.string(),
  language: LanguageEnum,
  advertiser: z.string(),
  text: z.string(),
  landingUrl: z.string(),
  logo: z
    .object({
      blurHash: z.string().nullable(),
      urls: z.object({
        sm: z.string().nullable(),
        md: z.string().nullable(),
        lg: z.string().nullable(),
      }),
    })
    .nullable(),
});
export type InlineAdDto = z.infer<typeof InlineAdDto>;

export const AdEventTypeEnum = z.enum(['impression', 'viewable', 'click']);
export type AdEventType = z.infer<typeof AdEventTypeEnum>;

/**
 * One measured ad event.
 *
 * `viewable` follows the usual industry definition — on screen, and on screen
 * long enough to have been seen. Reporting both raw and viewable impressions
 * matters: an advertiser who is told "10,000 impressions" and later discovers
 * half were never actually looked at stops trusting the numbers, and a small
 * local advertiser who feels misled does not come back.
 */
export const AdEvent = z.object({
  campaignId: ObjectIdString,
  deviceId: z.string().uuid(),
  type: AdEventTypeEnum,
  /** Which product delivered it. Events written before placements existed
   *  carry none, and were all full-card: read as 'card'. */
  placement: AdPlacementEnum.default('card'),
  /** Time the card was the active card, for the viewable determination. */
  dwellMs: z.number().int().nonnegative().max(120_000),
  categorySlug: z.string(),
  occurredAt: z.date(),
});
export type AdEvent = z.infer<typeof AdEvent>;

/** On screen for at least a second counts as seen. */
export const VIEWABLE_THRESHOLD_MS = 1000;
