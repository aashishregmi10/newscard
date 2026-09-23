/**
 * Paging arithmetic.
 *
 * Pure, and separated from the component for the usual reason: off-by-one
 * errors in paging are invisible in review and obvious to whoever loses the
 * last row of every page. Each of these has a boundary that is worth an
 * assertion rather than an afternoon.
 */

/** How many pages a list of this size needs. Never fewer than one. */
export function pageCountOf(total: number, perPage: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(perPage) || perPage <= 0) return 1;
  return Math.ceil(total / perPage);
}

/**
 * The page actually shown.
 *
 * The URL can ask for page 40 of a three-page list — a bookmark taken before
 * stories were published, or someone editing the address bar. Showing an empty
 * list and a dead "next" button is the wrong answer; the last page is the right
 * one, and it is what a reader means by "as far as it goes".
 */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
}

/** The slice of items belonging to a page, having clamped the page first. */
export function pageSlice<T>(items: readonly T[], page: number, perPage: number): T[] {
  const count = pageCountOf(items.length, perPage);
  const safe = clampPage(page, count);
  const start = (safe - 1) * perPage;
  return items.slice(start, start + perPage);
}

/** The human range for "showing 21 to 40 of 137". One-based and inclusive. */
export function pageRange(
  page: number,
  perPage: number,
  total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const safe = clampPage(page, pageCountOf(total, perPage));
  const from = (safe - 1) * perPage + 1;
  return { from, to: Math.min(total, safe * perPage) };
}

export type PageToken = number | 'gap';

/**
 * Which page numbers to draw.
 *
 * Always the first page, always the last, and `span` either side of the current
 * one, with a gap marker standing in for the rest. Two rules stop it looking
 * broken:
 *
 *   - A gap is only drawn where it hides MORE than one page. Replacing a single
 *     page with an ellipsis is the same width and strictly less useful, and it
 *     produces the sequence "1 … 3 4 5" where 2 is missing for no reason.
 *   - The window keeps a constant width as it moves. Without that, the control
 *     is narrower at the ends of the list than in the middle, and the buttons
 *     move under the pointer as you page through — so the second click of a
 *     double click lands on a different page than the first.
 */
export function pageWindow(page: number, pageCount: number, span = 1): PageToken[] {
  const total = Math.max(1, pageCount);
  const current = clampPage(page, total);

  /* first + last + current + span either side + two gap markers. */
  const maxSlots = span * 2 + 5;
  if (total <= maxSlots) {
    return range(1, total);
  }

  /*
   * Three shapes, each exactly `maxSlots` wide.
   *
   * Near an end there is no room for a gap on that side, so the pages it would
   * have cost are spent extending the run instead — which is what keeps the
   * width constant. Sliding a fixed-width window and dropping the gap when it
   * is not needed does NOT: it produces a control one slot narrower at the
   * ends than in the middle.
   */
  const boundary = span + 2;

  if (current <= boundary + 1) {
    return [...range(1, maxSlots - 2), 'gap', total];
  }

  if (current >= total - boundary) {
    return [1, 'gap', ...range(total - (maxSlots - 3), total)];
  }

  return [1, 'gap', ...range(current - span, current + span), 'gap', total];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}
