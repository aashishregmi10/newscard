import { describe, it, expect } from 'vitest';
import {
  campaignWeight,
  clampInline,
  flightDays,
  inlineSlotsForPage,
  interleaveWeighted,
  pickDistinctWeighted,
  servingPool,
  shareOfVoice,
  DAY_MS,
  type Rng,
} from '../adPolicy.js';

/**
 * Who gets the slot, and how often.
 *
 * The statistical tests use a seeded generator, so a failure is a real change
 * in behaviour and never a bad roll.
 */

/** mulberry32: small, fast, and good enough to test a sampler with. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = new Date('2026-10-01T00:00:00Z');
const days = (n: number) => new Date(START.getTime() + n * DAY_MS);
/** Rupees for readability; stored as paisa. */
const campaign = (rupees: number, forDays: number, name = '') => ({
  name,
  pricePaisa: rupees * 100,
  startsAt: START,
  endsAt: days(forDays),
});

describe('flightDays', () => {
  it('counts whole days and rounds a part-day up', () => {
    expect(flightDays(START, days(7))).toBe(7);
    expect(flightDays(START, new Date(days(7).getTime() + 60_000))).toBe(8);
  });

  it('is never less than one, so a same-day booking has a finite weight', () => {
    expect(flightDays(START, START)).toBe(1);
    expect(flightDays(START, new Date(START.getTime() + 3_600_000))).toBe(1);
    expect(flightDays(days(2), START)).toBe(1);
  });
});

describe('campaignWeight', () => {
  it('is price per day, so a week and a month at the same price are not the same purchase', () => {
    const week = campaignWeight(campaign(10_000, 7));
    const month = campaignWeight(campaign(10_000, 30));
    expect(week).toBeCloseTo((10_000 * 100) / 7, 6);
    expect(week / month).toBeCloseTo(30 / 7, 6);
  });

  it('gives a free campaign no weight', () => {
    expect(campaignWeight(campaign(0, 7))).toBe(0);
  });
});

describe('share of voice', () => {
  it('matches the worked example: 62%, 31%, 7%', () => {
    const pool = servingPool([campaign(20_000, 7), campaign(10_000, 7), campaign(10_000, 30)]);
    const [a, b, c] = shareOfVoice(pool);
    expect(a).toBeCloseTo(0.619, 2);
    expect(b).toBeCloseTo(0.309, 2);
    expect(c).toBeCloseTo(0.072, 2);
    expect(a! + b! + c!).toBeCloseTo(1, 10);
  });

  it('is empty for an empty pool rather than dividing by zero', () => {
    expect(shareOfVoice([])).toEqual([]);
  });
});

describe('servingPool', () => {
  it('leaves house ads out while any paying campaign is eligible', () => {
    const pool = servingPool([campaign(5_000, 7, 'paid'), campaign(0, 30, 'house')]);
    expect(pool.map((x) => x.item.name)).toEqual(['paid']);
  });

  it('gives house ads equal turns when nothing paid is eligible', () => {
    const pool = servingPool([campaign(0, 7, 'a'), campaign(0, 30, 'b')]);
    expect(pool.map((x) => x.weight)).toEqual([1, 1]);
  });
});

describe('interleaveWeighted', () => {
  const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name);
  const count = (xs: string[], n: string) => xs.filter((x) => x === n).length;

  it('gives each campaign its share of a single page to within one slot', () => {
    /* Rs 10,000/week against Rs 5,000/week: two thirds and one third of the
       twenty small ads on a page, i.e. 13.3 and 6.7. */
    const pool = servingPool([campaign(10_000, 7, 'a'), campaign(5_000, 7, 'b')]);
    for (let seed = 1; seed <= 200; seed++) {
      const page = names(interleaveWeighted(pool, 20, seeded(seed)));
      expect(page).toHaveLength(20);
      expect(Math.abs(count(page, 'a') - 40 / 3)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(page, 'b') - 20 / 3)).toBeLessThanOrEqual(1);
    }
  });

  it('matches the worked example over a long run, to within a slot or two', () => {
    const pool = servingPool([
      campaign(20_000, 7, 'a'),
      campaign(10_000, 7, 'b'),
      campaign(10_000, 30, 'c'),
    ]);
    const share = shareOfVoice(pool);
    const run = names(interleaveWeighted(pool, 1_000, seeded(11)));
    pool.forEach((x, i) => {
      expect(Math.abs(count(run, x.item.name) - 1_000 * share[i]!)).toBeLessThanOrEqual(2);
    });
  });

  it('does not force alternation, which would hand two unequal payers equal shares', () => {
    /* The bug a "never the same advertiser twice running" rule would have had. */
    const pool = servingPool([campaign(10_000, 7, 'a'), campaign(5_000, 7, 'b')]);
    const page = names(interleaveWeighted(pool, 30, seeded(5)));
    const repeats = page.filter((x, i) => i > 0 && x === page[i - 1]).length;
    expect(repeats).toBeGreaterThan(0);
    // ...but the lighter one, at a third, is never shown twice running.
    expect(page.some((x, i) => x === 'b' && page[i + 1] === 'b')).toBe(false);
  });

  it('never repeats back to back while no campaign holds more than half', () => {
    const pool = servingPool([campaign(1, 7, 'a'), campaign(1, 7, 'b'), campaign(1, 7, 'c')]);
    for (let seed = 1; seed <= 50; seed++) {
      const page = names(interleaveWeighted(pool, 20, seeded(seed)));
      expect(page.some((x, i) => i > 0 && x === page[i - 1])).toBe(false);
    }
  });

  it('does not always hand the first story to the heaviest campaign', () => {
    const pool = servingPool([campaign(20_000, 7, 'heavy'), campaign(5_000, 7, 'light')]);
    let lightFirst = 0;
    for (let seed = 1; seed <= 500; seed++) {
      if (interleaveWeighted(pool, 1, seeded(seed))[0]!.name === 'light') lightFirst += 1;
    }
    expect(lightFirst).toBeGreaterThan(0);
    expect(lightFirst).toBeLessThan(500);
  });

  it('returns nothing for an empty pool or no slots', () => {
    expect(interleaveWeighted([], 5)).toEqual([]);
    expect(interleaveWeighted([{ item: 'x', weight: 0 }], 5)).toEqual([]);
    expect(interleaveWeighted([{ item: 'x', weight: 1 }], 0)).toEqual([]);
  });
});

describe('pickDistinctWeighted', () => {
  it('never returns the same campaign twice, and no more than asked or available', () => {
    const pool = servingPool([campaign(1, 7, 'a'), campaign(2, 7, 'b'), campaign(3, 7, 'c')]);
    const rng = seeded(7);
    for (let i = 0; i < 1_000; i++) {
      const picked = pickDistinctWeighted(pool, 2, rng).map((c) => c.name);
      expect(new Set(picked).size).toBe(picked.length);
      expect(picked.length).toBe(2);
    }
    expect(pickDistinctWeighted(pool, 10, rng)).toHaveLength(3);
    expect(pickDistinctWeighted(pool, 0, rng)).toEqual([]);
  });

  it('favours the heavier campaign for the first slot', () => {
    const pool = servingPool([campaign(9_000, 7, 'heavy'), campaign(1_000, 7, 'light')]);
    const rng = seeded(3);
    let heavyFirst = 0;
    for (let i = 0; i < 10_000; i++) {
      if (pickDistinctWeighted(pool, 1, rng)[0]!.name === 'heavy') heavyFirst += 1;
    }
    expect(heavyFirst / 10_000).toBeGreaterThan(0.88);
    expect(heavyFirst / 10_000).toBeLessThan(0.92);
  });
});

describe('inlineSlotsForPage', () => {
  it('puts a small ad on every story by default', () => {
    expect(inlineSlotsForPage(5, 0, undefined, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(inlineSlotsForPage(3, 20, undefined, 0)).toEqual([0, 1, 2]);
  });

  it('can be turned down to every Nth story, by absolute position across pages', () => {
    const cfg = { everyNCards: 3 };
    // Stories 1, 4, 7 on the first page of eight; then 10, 13 on the next.
    expect(inlineSlotsForPage(8, 0, cfg, 0)).toEqual([0, 3, 6]);
    expect(inlineSlotsForPage(8, 8, cfg, 0)).toEqual([1, 4, 7]);
  });

  it('honours a daily cap when one is set, and none when it is not', () => {
    expect(inlineSlotsForPage(10, 0, { maxPerDay: 5 }, 3)).toEqual([0, 1]);
    expect(inlineSlotsForPage(10, 0, { maxPerDay: 5 }, 5)).toEqual([]);
    expect(inlineSlotsForPage(10, 0, { maxPerDay: null }, 10_000)).toHaveLength(10);
  });

  it('refuses nonsense configuration rather than obeying it', () => {
    expect(clampInline({ everyNCards: 0, firstAdAfter: -4, maxPerDay: -1 })).toEqual({
      everyNCards: 1,
      firstAdAfter: 1,
      maxPerDay: 0,
    });
  });
});
