import { describe, expect, it } from 'vitest';
import {
  clampPage,
  pageCountOf,
  pageRange,
  pageSlice,
  pageWindow,
  type PageToken,
} from '../lib/pagination';

/**
 * Paging, at the boundaries.
 *
 * Every case here is one that shows up as "the last story on each page is
 * missing" or "page 4 of 3 is blank" — symptoms nobody traces back to
 * arithmetic, because the arithmetic looks obviously right.
 */

describe('pageCountOf', () => {
  it('rounds up, because a partial page is still a page', () => {
    expect(pageCountOf(40, 20)).toBe(2);
    expect(pageCountOf(41, 20)).toBe(3);
    expect(pageCountOf(1, 20)).toBe(1);
  });

  it('is one page when there is nothing to show', () => {
    // Zero pages would make "page 1 of 0" and disable every control.
    expect(pageCountOf(0, 20)).toBe(1);
    expect(pageCountOf(-5, 20)).toBe(1);
    expect(pageCountOf(10, 0)).toBe(1);
    expect(pageCountOf(Number.NaN, 20)).toBe(1);
  });
});

describe('clampPage', () => {
  it('brings a stale bookmark back to the last real page', () => {
    expect(clampPage(40, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(-2, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
  });

  it('survives a page number that is not one', () => {
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(2.7, 5)).toBe(2);
  });
});

describe('pageSlice', () => {
  const items = Array.from({ length: 41 }, (_, i) => i + 1);

  it('does not drop or repeat an item across a boundary', () => {
    // The classic defect: `slice(page * perPage, ...)` instead of
    // `slice((page - 1) * perPage, ...)`, which silently eats page one.
    const first = pageSlice(items, 1, 20);
    const second = pageSlice(items, 2, 20);
    const third = pageSlice(items, 3, 20);

    expect(first[0]).toBe(1);
    expect(first).toHaveLength(20);
    expect(second[0]).toBe(21);
    expect(third).toEqual([41]);
    expect([...first, ...second, ...third]).toEqual(items);
  });

  it('shows the last page when asked for one past the end', () => {
    expect(pageSlice(items, 99, 20)).toEqual([41]);
  });

  it('is empty for an empty list rather than throwing', () => {
    expect(pageSlice([], 1, 20)).toEqual([]);
    expect(pageSlice([], 5, 20)).toEqual([]);
  });
});

describe('pageRange', () => {
  it('counts from one and includes both ends', () => {
    expect(pageRange(1, 20, 137)).toEqual({ from: 1, to: 20 });
    expect(pageRange(2, 20, 137)).toEqual({ from: 21, to: 40 });
  });

  it('does not claim more than exists on the final page', () => {
    // "Showing 121 to 140 of 137" is the giveaway that nobody checked.
    expect(pageRange(7, 20, 137)).toEqual({ from: 121, to: 137 });
  });

  it('is zero to zero when there is nothing', () => {
    expect(pageRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('pageWindow', () => {
  const pages = (tokens: PageToken[]) => tokens.filter((t): t is number => t !== 'gap');

  it('lists every page when they all fit', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('always offers the first and last page', () => {
    for (const page of [1, 5, 10, 25, 50]) {
      const tokens = pageWindow(page, 50);
      expect(tokens[0]).toBe(1);
      expect(tokens[tokens.length - 1]).toBe(50);
    }
  });

  it('always includes the current page', () => {
    for (const page of [1, 2, 3, 24, 25, 26, 48, 49, 50]) {
      expect(pages(pageWindow(page, 50))).toContain(page);
    }
  });

  it('keeps a constant width as the window moves', () => {
    /*
     * Otherwise the control is narrower at the ends than in the middle and the
     * buttons shift under the pointer while you page, so the second click of a
     * double click lands on a different page than the first.
     */
    const widths = new Set([1, 2, 3, 10, 25, 40, 48, 49, 50].map((p) => pageWindow(p, 50).length));
    expect(widths.size).toBe(1);
  });

  it('never draws a gap that hides only one page', () => {
    // "1 … 3 4 5" with 2 missing for no reason costs the same room as showing it.
    for (let page = 1; page <= 50; page += 1) {
      const tokens = pageWindow(page, 50);
      tokens.forEach((token, i) => {
        if (token !== 'gap') return;
        const before = tokens[i - 1];
        const after = tokens[i + 1];
        if (typeof before === 'number' && typeof after === 'number') {
          expect(after - before).toBeGreaterThan(2);
        }
      });
    }
  });

  it('is ascending, with no page listed twice', () => {
    for (let page = 1; page <= 50; page += 1) {
      const list = pages(pageWindow(page, 50));
      expect(new Set(list).size).toBe(list.length);
      expect([...list].sort((a, b) => a - b)).toEqual(list);
    }
  });

  it('copes with a single page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(4, 1)).toEqual([1]);
  });
});
