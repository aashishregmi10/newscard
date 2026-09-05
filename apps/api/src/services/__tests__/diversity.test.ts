import { describe, it, expect } from 'vitest';
import { reorderForDiversity, violatesDiversity, isDiversityFeasible } from '../diversity.js';

interface Item {
  id: number;
  sourceId: string;
}

const items = (sources: string[]): Item[] => sources.map((sourceId, id) => ({ id, sourceId }));
const ids = (xs: Item[]) => xs.map((x) => x.id);

describe('source diversity — reordering', () => {
  it('leaves an already-diverse page untouched', () => {
    const input = items(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(ids(reorderForDiversity(input))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('breaks a run of three by pulling a later card forward', () => {
    // a a a b c d  ->  the third 'a' cannot sit at index 2
    const out = reorderForDiversity(items(['a', 'a', 'a', 'b', 'c', 'd']));
    expect(violatesDiversity(out)).toBeNull();
    expect(out[2]!.sourceId).not.toBe('a');
  });

  it('never loses or invents a card — the set is exactly preserved', () => {
    const input = items(['a', 'a', 'a', 'a', 'b', 'c', 'a', 'b']);
    const out = reorderForDiversity(input);
    expect(out).toHaveLength(input.length);
    expect(ids(out).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('stays as close to chronological order as the constraint allows', () => {
    // Only one swap is needed, so the first two cards must not move.
    const out = reorderForDiversity(items(['a', 'a', 'a', 'b']));
    expect(ids(out).slice(0, 2)).toEqual([0, 1]);
  });

  it('does NOT reorder a page that has no violation', () => {
    // Regression: a count-aware greedy rewrote clean pages, demoting the newest
    // story for nothing. The input is reverse-chronological, so an unnecessary
    // swap costs recency — the one thing a news feed cannot trade away.
    const clean = ['khel', 'khabar', 'samachar', 'post', 'post'];
    expect(ids(reorderForDiversity(items(clean)))).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps the newest card first whenever that is legal', () => {
    // The first card can only move if it alone would make the page impossible.
    for (const feed of [
      ['a', 'b', 'c'],
      ['a', 'a', 'b', 'c'],
      ['a', 'b', 'a', 'b'],
      ['a', 'b', 'b', 'c', 'a'],
    ]) {
      expect(reorderForDiversity(items(feed))[0]!.id, feed.join(',')).toBe(0);
    }
  });

  it('accepts an unavoidable run when only one source is present', () => {
    // 3am, one publisher active. A short monotonous page beats an empty one.
    const input = items(['a', 'a', 'a', 'a', 'a']);
    const out = reorderForDiversity(input);
    expect(ids(out)).toEqual([0, 1, 2, 3, 4]);
    expect(violatesDiversity(out, { onlyIfFeasible: true })).toBeNull();
  });

  it('spends its separator late, not early', () => {
    // [a,b,a,a,a] IS satisfiable as a a b a a. An earliest-first greedy places
    // the b second, runs out of separators, and is forced into a run of three.
    const out = reorderForDiversity(items(['a', 'b', 'a', 'a', 'a']));
    expect(violatesDiversity(out)).toBeNull();
  });

  it('reports infeasible inputs honestly', () => {
    // 5 from one source, 1 from another, cap 2: needs 2 separators, has 1.
    expect(isDiversityFeasible(items(['a', 'a', 'a', 'a', 'a', 'b']))).toBe(false);
    // 4 and 2 is arrangeable: a a b a a b
    expect(isDiversityFeasible(items(['a', 'a', 'a', 'a', 'b', 'b']))).toBe(true);
  });

  it('handles empty and single-item input', () => {
    expect(reorderForDiversity([])).toEqual([]);
    expect(ids(reorderForDiversity(items(['a'])))).toEqual([0]);
  });

  it('detects a violation when one exists', () => {
    expect(violatesDiversity(items(['a', 'a', 'a', 'b']))).toMatch(/consecutive/);
  });
});

describe('property: reordering is safe across random feeds', () => {
  // Deterministic PRNG so any failure is reproducible from its seed alone.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('holds across 500 random feeds', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rnd = mulberry32(seed);
      const sourceCount = 1 + Math.floor(rnd() * 6);
      const len = Math.floor(rnd() * 40);
      const input = items(Array.from({ length: len }, () => `s${Math.floor(rnd() * sourceCount)}`));

      const out = reorderForDiversity(input);

      // 1. It is a permutation — nothing dropped, nothing duplicated. This is
      //    what makes the position cursor safe.
      expect(out.length, `seed ${seed}`).toBe(input.length);
      expect(ids(out).sort((a, b) => a - b), `seed ${seed}`).toEqual(
        ids([...input]).sort((a, b) => a - b),
      );

      // 2. Whenever an arrangement EXISTS, the algorithm finds one. Inputs
      //    dominated by a single source are excused, because no permutation of
      //    them satisfies the cap — see isDiversityFeasible.
      if (isDiversityFeasible(input)) {
        const violation = violatesDiversity(out);
        expect(violation, `seed ${seed}: ${violation}`).toBeNull();
      }
    }
  });

  it('finds an arrangement for every feasible input, 500 seeds', () => {
    let feasibleCases = 0;
    for (let seed = 0; seed < 500; seed++) {
      const rnd = mulberry32(seed + 9000);
      const len = 2 + Math.floor(rnd() * 30);
      const input = items(Array.from({ length: len }, () => `s${Math.floor(rnd() * 4)}`));
      if (!isDiversityFeasible(input)) continue;
      feasibleCases++;
      expect(violatesDiversity(reorderForDiversity(input)), `seed ${seed}`).toBeNull();
    }
    // Guard against the assertion above being vacuously true.
    expect(feasibleCases).toBeGreaterThan(400);
  });

  it('leaves already-clean feeds completely untouched, 500 seeds', () => {
    // The strongest statement of the recency property: if the input already
    // satisfies the cap, the output must be identical to it.
    let cleanCases = 0;
    for (let seed = 0; seed < 500; seed++) {
      const rnd = mulberry32(seed + 4242);
      const len = 1 + Math.floor(rnd() * 25);
      const input = items(Array.from({ length: len }, () => `s${Math.floor(rnd() * 5)}`));
      if (violatesDiversity(input) !== null) continue;
      cleanCases++;
      expect(ids(reorderForDiversity(input)), `seed ${seed}`).toEqual(ids(input));
    }
    expect(cleanCases).toBeGreaterThan(100);
  });
});
