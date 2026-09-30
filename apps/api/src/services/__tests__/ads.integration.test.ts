import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { connect, close, getDb } from '@saar/db';
import { DEFAULT_AD_DENSITY, DEFAULT_INLINE_ADS, violatesAdPolicy } from '@saar/shared';
import { eligibleCampaigns, injectAds, type ArticleEntry } from '../ads.service.js';
import type { ArticleCardDto } from '@saar/schemas';

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
    pricePaisa: 700_00,
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

/** The small-ad options, with small ads effectively absent: none of these
 *  fixtures is an inline campaign, so the pool is empty whatever the density. */
const NO_INLINE = {
  inline: DEFAULT_INLINE_ADS,
  inlineShownToday: 0,
  inlineBlocked: new Set<string>(),
};

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
    const picked = await eligibleCampaigns(['ne'], 'politics');
    expect(picked).toHaveLength(1);
  });

  it('serves a category-targeted campaign in that category', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ categories: ['business'] }) as never);
    expect(await eligibleCampaigns(['ne'], 'business')).toHaveLength(1);
  });

  it('does not serve a category-targeted campaign in an unrelated category', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ categories: ['business'] }) as never);
    expect(await eligibleCampaigns(['ne'], 'sports')).toHaveLength(0);
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
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(1);
    expect(await eligibleCampaigns(['ne'], 'all')).toHaveLength(1);
  });

  it('never serves a campaign in a language the reader did not ask for', async () => {
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ language: 'en' }) as never);
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(0);
    expect(await eligibleCampaigns(['ne', 'en'], 'top')).toHaveLength(1);
  });

  it('does not serve a paused or draft campaign', async () => {
    await getDb()
      .collection('campaigns')
      .insertMany([campaign({ status: 'paused' }), campaign({ status: 'draft' })] as never);
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(0);
  });

  it('does not serve outside the flight window', async () => {
    await getDb()
      .collection('campaigns')
      .insertMany([
        campaign({ startsAt: new Date(Date.now() + day) }),
        campaign({ endsAt: new Date(Date.now() - day) }),
      ] as never);
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(0);
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
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(0);
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

    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(0);

    await getDb()
      .collection('adEvents')
      .deleteMany({ occurredAt: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } });
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(1);
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
      ...NO_INLINE,
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
      ...NO_INLINE,
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
      ...NO_INLINE,
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
      ...NO_INLINE,
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
      ...NO_INLINE,
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
        ...NO_INLINE,
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

describe('time-sold campaigns', () => {
  it('are eligible with no impression goal at all', async () => {
    /* `$lt` against a missing goal compares with null, which every number is
       greater than: without the explicit branch, every campaign sold by time
       would have been silently excluded. */
    await getDb()
      .collection('campaigns')
      .insertOne(campaign({ impressionGoal: undefined, dailyImpressionCap: undefined }) as never);
    expect(await eligibleCampaigns(['ne'], 'top')).toHaveLength(1);
  });
});

describe('the small ad', () => {
  const inlineCampaign = (over: Partial<Record<string, unknown>> = {}) =>
    campaign({
      placement: 'inline',
      creative: { headline: 'Hotel X', callToAction: { ne: '', en: '' }, landingUrl: 'https://example.invalid/', image: null },
      impressionGoal: null,
      dailyImpressionCap: null,
      ...over,
    });
  const opts = (over: Partial<Parameters<typeof injectAds>[1]> = {}) => ({
    languages: ['ne'] as ['ne'],
    categorySlug: 'top',
    pageOffset: 0,
    density: DEFAULT_AD_DENSITY,
    adsShownToday: 0,
    ...NO_INLINE,
    ...over,
  });
  const stories = (entries: Awaited<ReturnType<typeof injectAds>>["entries"]) =>
    entries.filter((e): e is ArticleEntry => e.kind === 'article');

  it('rides on every story, and never takes a card of its own', async () => {
    await getDb().collection('campaigns').insertOne(inlineCampaign() as never);
    const { entries, adCount, inlineCount } = await injectAds(articles(20), opts());
    expect(inlineCount).toBe(20);
    expect(adCount).toBe(0);
    expect(entries.every((e) => e.kind === 'article')).toBe(true);
    for (const s of stories(entries)) {
      expect(s.inlineAd?.kind).toBe('inlineAd');
      expect(s.inlineAd?.text).toBe('Hotel X');
      expect(s.inlineAd?.id).toBe(`inl_${s.inlineAd!.campaignId}_${s.id}`);
    }
  });

  it('and a full-card campaign never appears as a small ad', async () => {
    await getDb().collection('campaigns').insertOne(campaign() as never);
    const { entries, adCount, inlineCount } = await injectAds(articles(20), opts());
    expect(inlineCount).toBe(0);
    expect(adCount).toBeGreaterThan(0);
    expect(stories(entries).every((s) => s.inlineAd === undefined)).toBe(true);
  });

  it('does not spend the full-card allowance', async () => {
    /* The reason the two are counted apart: at one per story, a shared counter
       would have spent the full-card allowance of twelve in twelve stories. */
    await getDb()
      .collection('campaigns')
      .insertMany([inlineCampaign(), campaign(), campaign()] as never);
    const { adCount, inlineCount } = await injectAds(
      articles(20),
      opts({ inlineShownToday: 500 }),
    );
    expect(inlineCount).toBe(20);
    expect(adCount).toBe(2);
  });

  it('skips a story an editor marked, or whose publisher does not allow it', async () => {
    await getDb().collection('campaigns').insertOne(inlineCampaign() as never);
    const { entries } = await injectAds(
      articles(5),
      opts({ inlineBlocked: new Set(['a1', 'a3']) }),
    );
    const carrying = stories(entries).filter((s) => s.inlineAd).map((s) => s.id);
    expect(carrying).toEqual(['a0', 'a2', 'a4']);
  });

  it('divides a page between payers by price per day', async () => {
    /* Rs 1,000 a day against Rs 500 a day: two thirds and one third of the
       twenty small ads on a page, to within one. */
    const heavy = inlineCampaign({ pricePaisa: 7_000_00, endsAt: new Date(Date.now() + 6 * day) });
    const light = inlineCampaign({ pricePaisa: 3_500_00, endsAt: new Date(Date.now() + 6 * day) });
    await getDb().collection('campaigns').insertMany([heavy, light] as never);
    const { entries } = await injectAds(articles(21), opts());
    const ids = stories(entries).map((s) => s.inlineAd!.campaignId);
    const heavyCount = ids.filter((id) => id === heavy._id.toString()).length;
    expect(Math.abs(heavyCount - 14)).toBeLessThanOrEqual(1);
  });

  it('shows a house ad only when no paying campaign is eligible', async () => {
    const house = inlineCampaign({ pricePaisa: 0, creative: { headline: 'Advertise here', callToAction: { ne: '', en: '' }, landingUrl: 'https://example.invalid/', image: null } });
    await getDb().collection('campaigns').insertOne(house as never);
    const alone = await injectAds(articles(4), opts());
    expect(stories(alone.entries).every((s) => s.inlineAd?.text === 'Advertise here')).toBe(true);

    await getDb().collection('campaigns').insertOne(inlineCampaign() as never);
    const withPaid = await injectAds(articles(20), opts());
    expect(stories(withPaid.entries).every((s) => s.inlineAd?.text === 'Hotel X')).toBe(true);
  });
});
