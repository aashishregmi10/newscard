import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { connect, close, getDb } from '@newscard/db';
import { DEFAULT_AD_DENSITY, violatesAdPolicy } from '@newscard/shared';
import { selectCampaigns, injectAds } from '../ads.service.js';
import type { ArticleCardDto } from '@newscard/schemas';

/**
 * Ad selection and injection against a real MongoDB.
 *
 * The pure density rules are covered in packages/shared/adPolicy.test.ts. What
 * needs a database is everything that decides WHICH campaign is eligible —
 * targeting, pacing, the impression goal — because each of those is a query,
 * and a query is exactly where a filter silently excludes an advertiser who is
 * paying us.
 */

/**
 * Never falls back to MONGO_URI. These suites DELETE collections, and a chain
 * that reaches the development database turns `npm test` into "why is my feed
 * empty" — a data loss that presents as a code bug.
 */
const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

const day = 86_400_000;

function campaign(over: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new ObjectId(),
    advertiserId: new ObjectId(),
    advertiserName: 'Test Advertiser',
    status: 'live',
    language: 'ne',
    categories: [] as string[],
    startsAt: new Date(Date.now() - day),
    endsAt: new Date(Date.now() + day),
    impressionGoal: 1000,
    dailyImpressionCap: 100,
    weight: 1,
    creative: {
      headline: 'Headline',
      body: 'Body',
      callToAction: { ne: 'हेर्नुहोस्', en: 'Learn more' },
      landingUrl: 'https://example.invalid/',
      image: null,
    },
    stats: { impressions: 0, viewableImpressions: 0, clicks: 0 },
    ...over,
  };
}

function articles(n: number): ArticleCardDto[] {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, headline: `Story ${i}` }) as never);
}

beforeAll(async () => {
  await connect({ uri: URI });
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await getDb().collection('campaigns').deleteMany({});
  await getDb().collection('adEvents').deleteMany({});
});

describe('campaign eligibility', () => {
  it('serves an untargeted campaign in any category', async () => {
    await getDb().collection('campaigns').insertOne(campaign() as never);
    const picked = await selectCampaigns(['ne'], 'politics', 1);
    expect(picked).toHaveLength(1);
  });

  it('serves a category-targeted campaign in that category', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ categories: ['business'] }) as never);
    expect(await selectCampaigns(['ne'], 'business', 1)).toHaveLength(1);
  });

  it('does not serve a category-targeted campaign in an unrelated category', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ categories: ['business'] }) as never);
    expect(await selectCampaigns(['ne'], 'sports', 1)).toHaveLength(0);
  });

  /**
   * The regression this exists for: `top` is a virtual category that no article
   * carries. Matching it literally against a campaign's target list made every
   * targeted campaign undeliverable on the app's default tab — three of four
   * seeded advertisers could never be shown, and the symptom was simply "fewer
   * ads than expected", which reads as a density success rather than a bug.
   */
  it('serves a category-targeted campaign on the virtual top feed', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ categories: ['business'] }) as never);
    expect(await selectCampaigns(['ne'], 'top', 1)).toHaveLength(1);
    expect(await selectCampaigns(['ne'], 'all', 1)).toHaveLength(1);
  });

  it('never serves a campaign in a language the reader did not ask for', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ language: 'en' }) as never);
    expect(await selectCampaigns(['ne'], 'top', 1)).toHaveLength(0);
    expect(await selectCampaigns(['ne', 'en'], 'top', 1)).toHaveLength(1);
  });

  it('does not serve a paused or draft campaign', async () => {
    await getDb()
      .collection('campaigns')
      .insertMany([campaign({ status: 'paused' }), campaign({ status: 'draft' })] as never);
    expect(await selectCampaigns(['ne'], 'top', 5)).toHaveLength(0);
  });

  it('does not serve outside the flight window', async () => {
    await getDb()
      .collection('campaigns')
      .insertMany([
        campaign({ startsAt: new Date(Date.now() + day) }),
        campaign({ endsAt: new Date(Date.now() - day) }),
      ] as never);
    expect(await selectCampaigns(['ne'], 'top', 5)).toHaveLength(0);
  });

  it('stops at the impression goal rather than over-delivering', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(
        campaign({
          impressionGoal: 100,
          stats: { impressions: 100, viewableImpressions: 0, clicks: 0 },
        }) as never,
      );
    expect(await selectCampaigns(['ne'], 'top', 1)).toHaveLength(0);
  });

  it('stops for the day once the daily cap is reached, and resumes tomorrow', async () => {
    const c = campaign({ dailyImpressionCap: 2 });
    await getDb().collection('campaigns').insertOne(c as never);

    const now = new Date();
    const yesterday = new Date(Date.now() - day);
    await getDb()
      .collection('adEvents')
      .insertMany([
        { campaignId: c._id, type: 'impression', dwellMs: 2000, occurredAt: now },
        { campaignId: c._id, type: 'impression', dwellMs: 2000, occurredAt: now },
        // Yesterday's delivery must not count against today.
        { campaignId: c._id, type: 'impression', dwellMs: 2000, occurredAt: yesterday },
      ] as never);

    expect(await selectCampaigns(['ne'], 'top', 1)).toHaveLength(0);

    await getDb()
      .collection('adEvents')
      .deleteMany({ occurredAt: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } });
    expect(await selectCampaigns(['ne'], 'top', 1)).toHaveLength(1);
  });
});

describe('injection into a page', () => {
  it('leaves content order untouched and inserts at policy positions', async () => {
    await getDb()
      .collection('campaigns')
      .insertMany([campaign(), campaign(), campaign()] as never);

    const content = articles(20);
    const { entries, adCount } = await injectAds(content, {
      languages: ['ne'],
      categorySlug: 'top',
      pageOffset: 0,
      density: DEFAULT_AD_DENSITY,
      adsShownToday: 0,
    });

    expect(adCount).toBe(2);

    const editorial = entries.filter((e) => e.kind === 'article').map((e) => e.id);
    expect(editorial).toEqual(content.map((a) => a.id));

    const slots: number[] = [];
    let passed = 0;
    for (const e of entries) {
      if (e.kind === 'ad') slots.push(passed - 1);
      else passed++;
    }
    expect(violatesAdPolicy(slots, 20, 0, DEFAULT_AD_DENSITY)).toBeNull();
    expect(slots).toEqual([3, 13]);
  });

  it('gives every placement a distinct id, so the same campaign twice is two impressions', async () => {
    await getDb().collection('campaigns').insertOne(campaign() as never);

    const { entries } = await injectAds(articles(20), {
      languages: ['ne'],
      categorySlug: 'top',
      pageOffset: 0,
      density: DEFAULT_AD_DENSITY,
      adsShownToday: 0,
    });

    // One campaign, so it fills only the first slot — an empty slot is left
    // empty rather than repeating the ad.
    const ads = entries.filter((e) => e.kind === 'ad');
    expect(ads).toHaveLength(1);

    const later = await injectAds(articles(20), {
      languages: ['ne'],
      categorySlug: 'top',
      pageOffset: 20,
      density: DEFAULT_AD_DENSITY,
      adsShownToday: 1,
    });
    const laterAds = later.entries.filter((e) => e.kind === 'ad');
    expect(laterAds.length).toBeGreaterThan(0);
    expect(laterAds[0]!.id).not.toBe(ads[0]!.id);
    expect(laterAds[0]!.campaignId).toBe(ads[0]!.campaignId);
  });

  it('serves nothing once the device has hit the daily cap', async () => {
    await getDb().collection('campaigns').insertOne(campaign() as never);
    const { entries, adCount } = await injectAds(articles(20), {
      languages: ['ne'],
      categorySlug: 'top',
      pageOffset: 0,
      density: DEFAULT_AD_DENSITY,
      adsShownToday: DEFAULT_AD_DENSITY.maxAdsPerDay,
    });
    expect(adCount).toBe(0);
    expect(entries.every((e) => e.kind === 'article')).toBe(true);
  });

  it('returns a clean page when no campaign is eligible', async () => {
    const { entries, adCount } = await injectAds(articles(20), {
      languages: ['ne'],
      categorySlug: 'top',
      pageOffset: 0,
      density: DEFAULT_AD_DENSITY,
      adsShownToday: 0,
    });
    expect(adCount).toBe(0);
    expect(entries).toHaveLength(20);
  });

  it('keeps spacing correct across page boundaries', async () => {
    await getDb()
      .collection('campaigns')
      .insertMany([campaign(), campaign(), campaign(), campaign()] as never);

    const positions: number[] = [];
    let passed = 0;
    let adsToday = 0;

    for (let p = 0; p < 5; p++) {
      const { entries } = await injectAds(articles(20), {
        languages: ['ne'],
        categorySlug: 'top',
        pageOffset: passed,
        density: DEFAULT_AD_DENSITY,
        adsShownToday: adsToday,
      });
      for (const e of entries) {
        if (e.kind === 'ad') {
          positions.push(passed);
          adsToday++;
        } else passed++;
      }
    }

    // First ad after 4 cards, then every 10 — and crucially the page boundary
    // at 20 does not restart the count.
    expect(positions).toEqual([4, 14, 24, 34, 44, 54, 64, 74, 84, 94]);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]! - positions[i - 1]!).toBeGreaterThanOrEqual(6);
    }
  });
});
