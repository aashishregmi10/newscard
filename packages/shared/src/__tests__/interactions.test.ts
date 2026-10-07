import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AD_DENSITY,
  adSlotsForPage,
  averageStars,
  interactionForSlot,
  interactionProblems,
  interactionSlotsForPage,
  votePercentages,
  type InteractionShape,
} from '../index.js';

/** Names are synthetic, as for all demo data. */
const photo = { credit: 'नमुना फोटो' };
const vote = (over: Partial<InteractionShape> = {}): InteractionShape => ({
  type: 'vote',
  title: 'नमुना: कुन मम पसल राम्रो?',
  options: [
    { name: 'नमुना एक', detail: null, image: photo },
    { name: 'नमुना दुई', detail: null, image: photo },
  ],
  opensAt: null,
  closesAt: '2026-12-01T00:00:00Z',
  ...over,
});

describe('interactionProblems', () => {
  it('passes a complete vote and a rating without photos', () => {
    expect(interactionProblems(vote())).toEqual([]);
    expect(
      interactionProblems({
        type: 'rating',
        title: 'Sample cafes',
        options: [
          { name: 'Sample Cafe', detail: 'Patan', image: null },
          { name: 'नमुना क्याफे', detail: null, image: null },
        ],
        opensAt: null,
        closesAt: null,
      }),
    ).toEqual([]);
  });

  it('holds a vote of photos to 2–4, a vote of names and a rating to 2–6', () => {
    const one = vote({ options: [{ name: 'नमुना एक', detail: null, image: photo }] });
    expect(interactionProblems(one)[0]?.field).toBe('options');
    const named = (n: number, image: { credit: string } | null) =>
      Array.from({ length: n }, (_, i) => ({ name: `Sample ${i + 1}`, detail: null, image }));
    expect(interactionProblems(vote({ options: named(5, photo) }))[0]?.message).toMatch(/At most 4 candidates with photos/);
    expect(interactionProblems(vote({ options: named(6, null) }))).toEqual([]);
    expect(interactionProblems(vote({ options: named(7, null) }))[0]?.message).toMatch(/At most 6 candidates/);
    expect(interactionProblems({ ...vote({ options: named(7, null) }), type: 'rating' })[0]?.message).toMatch(
      /At most 6 options/,
    );
  });

  it('treats names that differ only in case, spacing or Unicode form as the same', () => {
    const p = interactionProblems(
      vote({
        options: [
          { name: 'Sample Cafe', detail: null, image: photo },
          { name: ' sample  CAFE', detail: null, image: photo },
        ],
      }),
    );
    expect(p).toContainEqual({ field: 'options.1.name', message: 'Same name as candidate 1.' });
  });

  it('wants a vote all photos or all names, and a credit for any photo', () => {
    const p = interactionProblems(
      vote({
        options: [
          { name: 'नमुना एक', detail: null, image: null },
          { name: 'नमुना दुई', detail: null, image: { credit: ' ' } },
        ],
      }),
    );
    expect(p.map((x) => x.field)).toEqual(['options.0.image', 'options.1.image']);
  });

  it('wants a closing date on a vote, after its opening', () => {
    expect(interactionProblems(vote({ closesAt: null }))[0]?.field).toBe('closesAt');
    const backwards = vote({ opensAt: '2026-12-02T00:00:00Z', closesAt: '2026-12-01T00:00:00Z' });
    expect(interactionProblems(backwards)[0]?.message).toMatch(/after the opening/);
  });
});

describe('interactionSlotsForPage', () => {
  it('puts the first after the 6th story, then every 12th, counting across pages', () => {
    expect(interactionSlotsForPage(20, 0, [])).toEqual([5, 17]);
    expect(interactionSlotsForPage(10, 10, [])).toEqual([7]);
  });

  it('is never beside a full-card ad, on any page of a long scroll', () => {
    for (let offset = 0; offset < 400; offset += 10) {
      const ads = adSlotsForPage(10, offset, DEFAULT_AD_DENSITY, 0);
      const mine = interactionSlotsForPage(10, offset, ads);
      for (const s of mine) expect(ads).not.toContain(s);
    }
  });

  it('moves one story later when it lands on an ad, or skips if that is off the page', () => {
    expect(interactionSlotsForPage(10, 0, [5])).toEqual([6]);
    expect(interactionSlotsForPage(6, 0, [5])).toEqual([]);
  });

  it('cycles through what is live', () => {
    expect([6, 18, 30, 42].map((a) => interactionForSlot(a, 3))).toEqual([0, 1, 2, 0]);
    expect(interactionForSlot(6, 0)).toBe(-1);
  });
});

describe('results', () => {
  it('rounds vote shares to whole percentages that add up to 100', () => {
    expect(votePercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(votePercentages([2, 1, 1, 0])).toEqual([50, 25, 25, 0]);
    expect(votePercentages([0, 0])).toEqual([0, 0]);
  });

  it('averages stars to one decimal, and says nothing before the first', () => {
    expect(averageStars(13, 3)).toBe(4.3);
    expect(averageStars(0, 0)).toBeNull();
  });
});
