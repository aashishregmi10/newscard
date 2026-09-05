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
  /** Login for the advertiser's own report view. Optional: many will just be
   *  emailed a PDF, especially small local businesses. */
  portalPasswordHash: z.string().nullable().optional(),
});
export type Advertiser = z.infer<typeof Advertiser>;

export const CampaignStatusEnum = z.enum(['draft', 'scheduled', 'live', 'paused', 'ended']);
export type CampaignStatus = z.infer<typeof CampaignStatusEnum>;

export const AdCreative = z.object({
  headline: z.string().min(4).max(90),
  /** Deliberately capped near the editorial summary length: an ad that looks
   *  like a story must READ like one in length too, or the feed rhythm breaks. */
  body: z.string().min(20).max(300),
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
    language: LanguageEnum,
    creative: AdCreative,

    /** Empty means every category. Targeting is category and language only —
     *  no behavioural or location targeting, which is what lets us promise
     *  advertisers reach without profiling readers. */
    categories: z.array(z.string()).default([]),

    startsAt: z.date(),
    endsAt: z.date(),

    /** Bought impressions. Delivery stops when this is reached, so an
     *  advertiser can never be over-delivered and then billed for it. */
    impressionGoal: z.number().int().positive(),
    /** Smooths delivery so a campaign does not exhaust itself on day one and
     *  leave the rest of its flight empty. Zero means no pacing. */
    dailyImpressionCap: z.number().int().nonnegative().default(0),

    /** Nepali paisa, integer. Money is never a float. */
    pricePaisa: z.number().int().nonnegative().default(0),

    /** Rotation weight among eligible campaigns. */
    weight: z.number().int().min(1).max(100).default(10),

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
  /** Time the card was the active card, for the viewable determination. */
  dwellMs: z.number().int().nonnegative().max(120_000),
  categorySlug: z.string(),
  occurredAt: z.date(),
});
export type AdEvent = z.infer<typeof AdEvent>;

/** On screen for at least a second counts as seen. */
export const VIEWABLE_THRESHOLD_MS = 1000;
