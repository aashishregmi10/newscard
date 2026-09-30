/**
 * Demo advertising data.
 *
 * Every advertiser, campaign and creative below is INVENTED, and the names are
 * deliberately generic ("नमुना" / "Sample") rather than real Kathmandu
 * businesses. Putting a real company's name on an advertisement they never
 * bought would be fabricating a commercial record — the same rule that governs
 * the editorial fixtures.
 *
 * Creative images are the same synthetic gradients used for articles, tinted
 * differently so an ad is visually distinguishable at a glance even before the
 * "Sponsored" label is read. They are landscape, where a real advertiser would
 * supply a portrait poster; the card shows either whole.
 *
 * ── Both placements, sold by time ──
 *
 * Every campaign runs the same 37 days, so its share of voice is simply its
 * price over the placement’s total: the full-card shares come out 43/29/17/11,
 * and the small ads 40/40/20 across the placement — enough spread to see the
 * weighting work on a phone. Each reader draws only from campaigns in their own
 * languages, so an English-only reader sees the two English small ads at 67/33.
 * The house ads (price 0) appear only where no paying small ad is eligible.
 *
 * Run: npm run db:seed  (invoked automatically)
 */

import { randomBytes, createHash } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { generateFor } from './gen-images.js';

interface DemoCampaign {
  advertiser: string;
  advertiserDisplay: string;
  name: string;
  placement: 'card' | 'inline';
  language: 'ne' | 'en';
  categories: string[];
  /** Full card: the one-line description. Small ad: the words on the pill,
   *  24 characters at most. */
  headline: string;
  body: string | null;
  cta: { ne: string; en: string };
  /** For the whole flight. The weight is this per day. */
  pricePaisa: number;
}

const CAMPAIGNS: DemoCampaign[] = [
  {
    advertiser: 'namuna-bank',
    advertiserDisplay: 'नमुना बैंक',
    name: 'Savings account — Dashain',
    placement: 'card',
    language: 'ne',
    categories: ['business', 'nepal'],
    headline: 'बचत खातामा नयाँ ब्याजदर',
    body: 'नमुना बैंकले बचत खाताको ब्याजदर पुनरावलोकन गरेको छ। नयाँ दर यही महिनादेखि लागू हुनेछ। विस्तृत जानकारीका लागि नजिकैको शाखामा सम्पर्क गर्नुहोस्।',
    cta: { ne: 'थप जान्नुहोस्', en: 'Learn more' },
    pricePaisa: 4_500_00,
  },
  {
    advertiser: 'sample-telecom',
    advertiserDisplay: 'Sample Telecom',
    name: 'Data pack launch',
    placement: 'card',
    language: 'en',
    categories: ['tech'],
    headline: 'A data pack sized for a month of reading',
    body: 'Sample Telecom has introduced a monthly data pack aimed at light users. It covers messaging, browsing and news, and carries over unused data for thirty days.',
    cta: { ne: 'हेर्नुहोस्', en: 'See the pack' },
    pricePaisa: 3_000_00,
  },
  {
    advertiser: 'namuna-shikshya',
    advertiserDisplay: 'नमुना शिक्षा केन्द्र',
    name: 'Exam preparation intake',
    placement: 'card',
    language: 'ne',
    categories: [], // all categories
    headline: 'लोक सेवा तयारी कक्षा सुरु',
    body: 'नमुना शिक्षा केन्द्रले लोक सेवा तयारी कक्षाको नयाँ समूह सुरु गर्दैछ। बिहान र साँझ दुवै समयमा कक्षा सञ्चालन हुनेछ। सीमित सिट उपलब्ध छ।',
    cta: { ne: 'भर्ना खुल्यो', en: 'Enrol now' },
    pricePaisa: 1_800_00,
  },
  {
    advertiser: 'sample-trek',
    advertiserDisplay: 'Sample Trekking Co.',
    name: 'Autumn season',
    placement: 'card',
    language: 'en',
    categories: ['sports', 'world'],
    headline: 'Autumn routes are open for booking',
    body: 'Sample Trekking Co. has opened bookings for the autumn season. Permits, guides and porters are arranged in advance, and group departures run weekly from Kathmandu.',
    cta: { ne: 'बुक गर्नुहोस्', en: 'Book a trip' },
    pricePaisa: 1_200_00,
  },

  /* ---- small ads, beside share on every story ---------------------------- */
  {
    advertiser: 'namuna-bank',
    advertiserDisplay: 'नमुना बैंक',
    name: 'Savings — small ad',
    placement: 'inline',
    language: 'ne',
    categories: [],
    headline: 'नमुना बैंक · नयाँ ब्याजदर',
    body: null,
    cta: { ne: '', en: '' },
    pricePaisa: 3_700_00,
  },
  {
    advertiser: 'sample-telecom',
    advertiserDisplay: 'Sample Telecom',
    name: 'Data pack — small ad',
    placement: 'inline',
    language: 'en',
    categories: [],
    headline: 'Telecom · Data pack',
    body: null,
    cta: { ne: '', en: '' },
    pricePaisa: 3_700_00,
  },
  {
    advertiser: 'sample-trek',
    advertiserDisplay: 'Sample Trekking Co.',
    name: 'Autumn — small ad',
    placement: 'inline',
    language: 'en',
    categories: [],
    headline: 'Autumn treks · Book now',
    body: null,
    cta: { ne: '', en: '' },
    pricePaisa: 1_850_00,
  },
  {
    advertiser: 'saar-house',
    advertiserDisplay: 'SAAR',
    name: 'House — advertise with us (ne)',
    placement: 'inline',
    language: 'ne',
    categories: [],
    headline: 'यहाँ विज्ञापन गर्नुहोस्',
    body: null,
    cta: { ne: '', en: '' },
    pricePaisa: 0,
  },
  {
    advertiser: 'saar-house',
    advertiserDisplay: 'SAAR',
    name: 'House — advertise with us (en)',
    placement: 'inline',
    language: 'en',
    categories: [],
    headline: 'Advertise with SAAR',
    body: null,
    cta: { ne: '', en: '' },
    pricePaisa: 0,
  },
];

export interface SeededCampaign {
  id: string;
  advertiser: string;
  /** Plaintext report token. Printed once by the seed and never stored — the
   *  campaign document holds only its sha256. */
  reportToken: string;
}

export async function seedAds(
  db: Db,
  cdnBase: string,
): Promise<{ advertisers: number; campaigns: number; seeded: SeededCampaign[] }> {
  await Promise.all([
    db.collection('advertisers').deleteMany({}),
    db.collection('campaigns').deleteMany({}),
    db.collection('adEvents').deleteMany({}),
  ]);

  const now = new Date();
  const startsAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const advertiserIds = new Map<string, ObjectId>();
  const seeded: SeededCampaign[] = [];

  for (const c of CAMPAIGNS) {
    if (!advertiserIds.has(c.advertiser)) {
      const _id = new ObjectId();
      advertiserIds.set(c.advertiser, _id);
      await db.collection('advertisers').insertOne({
        _id,
        name: c.advertiser,
        displayName: c.advertiserDisplay,
        contactEmail: `ads@${c.advertiser}.example.invalid`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Ad creatives get their own tint so an ad is distinguishable from a story
    // at a glance, before the "Sponsored" label is even read. Small ads carry no
    // logo here: a generated gradient at 14px is noise, not a logo.
    const img = c.placement === 'card'
      ? generateFor(`ad-${c.advertiser}-${c.name}`, 'business', cdnBase)
      : null;

    // Issued once, handed to the advertiser, stored only as a hash — the same
    // rule as device tokens. A database dump yields no working report links.
    const campaignId = new ObjectId();
    const reportToken = `rp_${randomBytes(24).toString('base64url')}`;
    seeded.push({ id: campaignId.toString(), advertiser: c.advertiserDisplay, reportToken });

    await db.collection('campaigns').insertOne({
      _id: campaignId,
      advertiserId: advertiserIds.get(c.advertiser)!,
      // Denormalised so serving a card needs no join.
      advertiserName: c.advertiserDisplay,
      name: c.name,
      status: 'live',
      placement: c.placement,
      language: c.language,
      categories: c.categories,
      startsAt,
      endsAt,
      pricePaisa: c.pricePaisa,
      creative: {
        headline: c.headline,
        body: c.body,
        callToAction: c.cta,
        landingUrl: `https://example.invalid/${c.advertiser}`,
        image: img
          ? {
              credit: null,
              blurHash: img.blurHash,
              width: img.width,
              height: img.height,
              urls: img.urls,
            }
          : null,
      },
      stats: { impressions: 0, viewableImpressions: 0, clicks: 0 },
      reportTokenHash: createHash('sha256').update(reportToken).digest('hex'),
      createdAt: now,
      updatedAt: now,
    });
  }

  return { advertisers: advertiserIds.size, campaigns: CAMPAIGNS.length, seeded };
}
