import { describe, it, expect } from 'vitest';
import {
  adSlotsForPage,
  clampDensity,
  violatesAdPolicy,
  adRatio,
  DEFAULT_AD_DENSITY,
  MIN_CARDS_BETWEEN_ADS,
  MIN_CARDS_BEFORE_FIRST_AD,
} from '../adPolicy.js';

/**
 * The density policy is the difference between a product readers tolerate and
 * one they uninstall. The reference app's loudest complaint was "every second
 * article is an ad" — so these tests assert the ceiling holds even when
 * configuration actively tries to break it.
 */

const cfg = DEFAULT_AD_DENSITY;

describe('the hard ceiling cannot be configured away', () => {
  it('clamps an aggressive everyNCards up to the minimum', () => {
    expect(clampDensity({ everyNCards: 2 }).everyNCards).toBe(MIN_CARDS_BETWEEN_ADS);
    expect(clampDensity({ everyNCards: 1 }).everyNCards).toBe(MIN_CARDS_BETWEEN_ADS);
    expect(clampDensity({ everyNCards: 0 }).everyNCards).toBe(MIN_CARDS_BETWEEN_ADS);
  });

  it('clamps firstAdAfter so the opening of the feed is never sold', () => {
    expect(clampDensity({ firstAdAfter: 0 }).firstAdAfter).toBe(MIN_CARDS_BEFORE_FIRST_AD);
    expect(clampDensity({ firstAdAfter: 1 }).firstAdAfter).toBe(MIN_CARDS_BEFORE_FIRST_AD);
  });

  it('honours configuration that is MORE conservative than the floor', () => {
    expect(clampDensity({ everyNCards: 20 }).everyNCards).toBe(20);
    expect(clampDensity({ firstAdAfter: 15 }).firstAdAfter).toBe(15);
  });

  it('never produces "every second card", however it is configured', () => {
    const hostile = { everyNCards: 1, firstAdAfter: 0, maxAdsPerDay: 999 };
    const slots = adSlotsForPage(40, 0, hostile, 0);
    expect(violatesAdPolicy(slots, 40, 0, hostile)).toBeNull();
    // 1-in-2 would be 0.5; the ceiling is 1/6.
    expect(adRatio(slots.length, 40)).toBeLessThanOrEqual(1 / MIN_CARDS_BETWEEN_ADS + 1e-9);
  });
});

describe('placement', () => {
  it('leaves the opening of the feed free of ads', () => {
    const slots = adSlotsForPage(20, 0, cfg, 0);
    expect(slots[0]).toBeGreaterThanOrEqual(MIN_CARDS_BEFORE_FIRST_AD - 1);
  });

  it('spaces ads by the configured interval', () => {
    const slots = adSlotsForPage(40, 0, cfg, 0);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]! - slots[i - 1]!).toBe(cfg.everyNCards);
    }
  });

  it('places by ABSOLUTE position, not position within the page', () => {
    // With a page size that is NOT a multiple of the interval, page-relative
    // placement and absolute placement diverge — which is the whole point.
    // (At page 20 / interval 10 they coincide, and that is correct: the
    // absolute spacing is still exactly 10.)
    const page1 = adSlotsForPage(14, 0, cfg, 0);
    const page2 = adSlotsForPage(14, 14, cfg, 0);
    expect(page1).not.toEqual(page2);
  });

  it('keeps the interval consistent ACROSS a page boundary', () => {
    const all: number[] = [];
    for (let page = 0; page < 5; page++) {
      const offset = page * 20;
      for (const s of adSlotsForPage(20, offset, cfg, 0)) all.push(offset + s);
    }
    for (let i = 1; i < all.length; i++) {
      expect(all[i]! - all[i - 1]!).toBe(cfg.everyNCards);
    }
  });

  it('does not depend on the page size — density is the same either way', () => {
    const collect = (size: number, pages: number) => {
      const out: number[] = [];
      for (let p = 0; p < pages; p++) {
        for (const s of adSlotsForPage(size, p * size, cfg, 0)) out.push(p * size + s);
      }
      return out;
    };
    // 100 cards, delivered as 5x20 or 10x10, must produce identical placements.
    expect(collect(20, 5)).toEqual(collect(10, 10));
  });

  it('returns nothing for an empty page', () => {
    expect(adSlotsForPage(0, 0, cfg, 0)).toEqual([]);
  });
});

describe('the daily cap', () => {
  it('stops serving once the reader has seen their allowance', () => {
    expect(adSlotsForPage(40, 0, cfg, cfg.maxAdsPerDay)).toEqual([]);
  });

  it('serves only the remaining allowance', () => {
    const slots = adSlotsForPage(100, 0, cfg, cfg.maxAdsPerDay - 2);
    expect(slots).toHaveLength(2);
  });

  it('maxAdsPerDay of zero disables advertising completely', () => {
    expect(adSlotsForPage(100, 0, { ...cfg, maxAdsPerDay: 0 }, 0)).toEqual([]);
  });
});

describe('long-run density', () => {
  it('settles below the ceiling over a realistic reading session', () => {
    // The ratio is a statistic; spacing is the invariant. Over a short window
    // the ratio can spike above the ceiling with perfectly correct spacing, so
    // the bound is asserted over a long run.
    let ads = 0;
    let content = 0;
    for (let page = 0; page < 50; page++) {
      ads += adSlotsForPage(20, page * 20, { ...cfg, maxAdsPerDay: 9999 }, 0).length;
      content += 20;
    }
    expect(adRatio(ads, content)).toBeLessThanOrEqual(1 / MIN_CARDS_BETWEEN_ADS);
    // With everyNCards = 10 the reader sees roughly one ad per eleven cards.
    expect(adRatio(ads, content)).toBeCloseTo(1 / 11, 2);
  });

  it('a reader who reads 20 cards sees at most 2 ads', () => {
    // The concrete promise, in the units a reader experiences.
    expect(adSlotsForPage(20, 0, cfg, 0).length).toBeLessThanOrEqual(2);
  });
});

describe('property: the invariant holds across many shapes', () => {
  it('never violates the policy, 400 combinations', () => {
    for (let seed = 0; seed < 400; seed++) {
      const contentCount = 1 + (seed % 60);
      const pageOffset = (seed * 7) % 200;
      const shown = seed % 14;
      const config = {
        everyNCards: 1 + (seed % 25),
        firstAdAfter: seed % 12,
        maxAdsPerDay: seed % 20,
      };

      const slots = adSlotsForPage(contentCount, pageOffset, config, shown);
      const violation = violatesAdPolicy(slots, contentCount, pageOffset, config);
      expect(violation, `seed ${seed}: ${violation}`).toBeNull();

      // Never exceeds the remaining daily allowance.
      expect(slots.length).toBeLessThanOrEqual(Math.max(0, config.maxAdsPerDay - shown));

      // Slots are in range and strictly increasing.
      for (let i = 0; i < slots.length; i++) {
        expect(slots[i]).toBeGreaterThanOrEqual(0);
        expect(slots[i]).toBeLessThan(contentCount);
        if (i > 0) expect(slots[i]!).toBeGreaterThan(slots[i - 1]!);
      }
    }
  });
});
