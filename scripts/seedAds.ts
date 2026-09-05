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
 * "Sponsored" label is read.
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
  language: 'ne' | 'en';
  categories: string[];
  headline: string;
  body: string;
  cta: { ne: string; en: string };
  impressionGoal: number;
  dailyCap: number;
  pricePaisa: number;
  weight: number;
}

const CAMPAIGNS: DemoCampaign[] = [
  {
    advertiser: 'namuna-bank',
    advertiserDisplay: 'नमुना बैंक',
    name: 'Savings account — Dashain',
    language: 'ne',
    categories: ['business', 'nepal'],
    headline: 'बचत खातामा नयाँ ब्याजदर',
    body: 'नमुना बैंकले बचत खाताको ब्याजदर पुनरावलोकन गरेको छ। नयाँ दर यही महिनादेखि लागू हुनेछ। विस्तृत जानकारीका लागि नजिकैको शाखामा सम्पर्क गर्नुहोस्।',
    cta: { ne: 'थप जान्नुहोस्', en: 'Learn more' },
    impressionGoal: 50_000,
    dailyCap: 2_000,
    pricePaisa: 4_500_00,
    weight: 30,
  },
  {
    advertiser: 'sample-telecom',
    advertiserDisplay: 'Sample Telecom',
    name: 'Data pack launch',
    language: 'en',
    categories: ['tech'],
    headline: 'A data pack sized for a month of reading',
    body: 'Sample Telecom has introduced a monthly data pack aimed at light users. It covers messaging, browsing and news, and carries over unused data for thirty days.',
    cta: { ne: 'हेर्नुहोस्', en: 'See the pack' },
    impressionGoal: 30_000,
    dailyCap: 1_500,
    pricePaisa: 3_000_00,
    weight: 20,
  },
  {
    advertiser: 'namuna-shikshya',
    advertiserDisplay: 'नमुना शिक्षा केन्द्र',
    name: 'Exam preparation intake',
    language: 'ne',
    categories: [], // all categories
    headline: 'लोक सेवा तयारी कक्षा सुरु',
    body: 'नमुना शिक्षा केन्द्रले लोक सेवा तयारी कक्षाको नयाँ समूह सुरु गर्दैछ। बिहान र साँझ दुवै समयमा कक्षा सञ्चालन हुनेछ। सीमित सिट उपलब्ध छ।',
    cta: { ne: 'भर्ना खुल्यो', en: 'Enrol now' },
    impressionGoal: 20_000,
    dailyCap: 800,
    pricePaisa: 1_800_00,
    weight: 15,
  },
  {
    advertiser: 'sample-trek',
    advertiserDisplay: 'Sample Trekking Co.',
    name: 'Autumn season',
    language: 'en',
    categories: ['sports', 'world'],
    headline: 'Autumn routes are open for booking',
    body: 'Sample Trekking Co. has opened bookings for the autumn season. Permits, guides and porters are arranged in advance, and group departures run weekly from Kathmandu.',
    cta: { ne: 'बुक गर्नुहोस्', en: 'Book a trip' },
    impressionGoal: 15_000,
    dailyCap: 600,
    pricePaisa: 1_200_00,
    weight: 10,
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
        portalPasswordHash: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Ad creatives get their own tint so an ad is distinguishable from a story
    // at a glance, before the "Sponsored" label is even read.
    const img = generateFor(`ad-${c.advertiser}-${c.name}`, 'business', cdnBase);

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
      language: c.language,
      categories: c.categories,
      startsAt,
      endsAt,
      impressionGoal: c.impressionGoal,
      dailyImpressionCap: c.dailyCap,
      pricePaisa: c.pricePaisa,
      weight: c.weight,
      creative: {
        headline: c.headline,
        body: c.body,
        callToAction: c.cta,
        landingUrl: `https://example.invalid/${c.advertiser}`,
        image: {
          credit: null,
          blurHash: img.blurHash,
          width: img.width,
          height: img.height,
          urls: img.urls,
        },
      },
      stats: { impressions: 0, viewableImpressions: 0, clicks: 0 },
      reportTokenHash: createHash('sha256').update(reportToken).digest('hex'),
      createdAt: now,
      updatedAt: now,
    });
  }

  return { advertisers: advertiserIds.size, campaigns: CAMPAIGNS.length, seeded };
}
