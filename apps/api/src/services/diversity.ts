import { MAX_CONSECUTIVE_SAME_SOURCE } from '@newscard/shared';

/**
 * Source diversity within a feed page.  Plan §2d — CORRECTED.
 *
 * The problem: the feed sorts purely on publishedAt, so on a slow news day one
 * prolific publisher fills the screen and the reader concludes we are that
 * outlet's app. This bites at three sources, not thirty.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS REORDERS RATHER THAN DEFERS
 *
 * The plan originally said over-quota cards would be "deferred to the next page,
 * never dropped". That is not achievable with a position-based cursor, and the
 * reason is worth writing down so nobody reintroduces it:
 *
 *   Let the candidates be sorted, and let k be the position of the last card
 *   placed on this page. Some cards before k were deferred.
 *
 *     - Cursor at k        -> the next page starts after k, so every deferred
 *                             card before k is silently LOST from the feed.
 *     - Cursor at the first deferred card d (d < k)
 *                          -> the next page restarts at d, so every card
 *                             between d and k that WAS shown appears TWICE.
 *
 *   There is no third position. Deferral and a position cursor are mutually
 *   exclusive, and duplicate-or-skip is precisely the failure the (publishedAt,
 *   _id) tiebreak exists to prevent.
 *
 * So this takes exactly `limit` cards and PERMUTES them. The set is unchanged,
 * which means the cursor is simply the last card of the window and pagination
 * stays provably safe. The cost is that a per-page share cap is not enforceable
 * here — a page whose candidates are 15/20 from one source cannot be rebalanced
 * without dropping cards. That is a ranking concern, not a pagination one, and
 * belongs in v2 personalisation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface DiversityItem {
  /** Any stable per-publisher key. */
  sourceId: string;
}

export interface ReorderOptions {
  maxConsecutive?: number;
}

/**
 * Is a run-capped arrangement even possible?
 *
 * With n cards, k = maxConsecutive, and m = the largest per-source count, the
 * dominant source needs enough other cards to break it up. Arranging it as
 * blocks of at most k gives ceil(m / k) blocks, which need ceil(m/k) - 1
 * separators, and there are n - m cards available to separate them.
 *
 * A page of 15 cards from one publisher and 1 from another simply cannot be
 * arranged without a long run. Reporting that honestly is better than a
 * heuristic that pretends otherwise.
 */
export function isDiversityFeasible<T extends DiversityItem>(
  items: readonly T[],
  opts: ReorderOptions = {},
): boolean {
  const k = opts.maxConsecutive ?? MAX_CONSECUTIVE_SAME_SOURCE;
  if (k < 1) return false;
  if (items.length <= k) return true;

  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.sourceId, (counts.get(i.sourceId) ?? 0) + 1);

  const m = Math.max(...counts.values());
  const separatorsNeeded = Math.ceil(m / k) - 1;
  return items.length - m >= separatorsNeeded;
}

/**
 * Can the remainder still be arranged, given a partial run already on the page?
 *
 * Same counting argument as isDiversityFeasible, with one correction: if the
 * dominant source in the remainder is also the source of the run in progress,
 * that run has already eaten into its first block, so it needs one more
 * separator than the counts alone suggest.
 */
function remainderFeasible<T extends DiversityItem>(
  remaining: readonly T[],
  runSource: string | null,
  runLength: number,
  k: number,
): boolean {
  const n = remaining.length;
  if (n === 0) return true;

  const counts = new Map<string, number>();
  for (const i of remaining) counts.set(i.sourceId, (counts.get(i.sourceId) ?? 0) + 1);

  for (const [source, m] of counts) {
    const carried = source === runSource ? runLength : 0;
    const needed = Math.ceil((m + carried) / k) - 1;
    if (n - m < needed) return false;
  }
  return true;
}

/**
 * Permute `items` so that no more than `maxConsecutive` adjacent cards share a
 * source, DISTURBING THE INPUT ORDER AS LITTLE AS POSSIBLE.
 *
 * Order matters here more than it looks. The input is reverse-chronological, so
 * every unnecessary swap pushes a fresher story down the feed. An earlier
 * version of this used a count-aware greedy — always drain the source with the
 * most cards left — and it reordered pages that had no violation at all,
 * demoting a twenty-minute-old story below a fifty-minute-old one for nothing.
 *
 * So: EARLIEST-FIRST, with a feasibility lookahead.
 *
 *   - Normally take the next card in order.
 *   - Skip it only if it would extend a run past the cap, OR if taking it would
 *     leave the remainder impossible to arrange.
 *
 * That lookahead is what a naive earliest-first greedy lacks. Given
 * [a, b, a, a, a] with a cap of 2, naive greedy spends the single `b` separator
 * second and is then forced into a run of three — even though a a b a a is
 * valid. The lookahead sees that taking `b` early strands three `a`s with no
 * separator, and holds it back.
 */
export function reorderForDiversity<T extends DiversityItem>(
  items: readonly T[],
  opts: ReorderOptions = {},
): T[] {
  const k = opts.maxConsecutive ?? MAX_CONSECUTIVE_SAME_SOURCE;
  if (items.length <= 1 || k < 1) return [...items];

  const remaining = [...items];
  const out: T[] = [];
  let runSource: string | null = null;
  let runLength = 0;

  while (remaining.length > 0) {
    let pickIndex = -1;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const extendsRun = candidate.sourceId === runSource;

      if (extendsRun && runLength >= k) continue;

      const nextRunSource = candidate.sourceId;
      const nextRunLength = extendsRun ? runLength + 1 : 1;
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));

      if (remainderFeasible(rest, nextRunSource, nextRunLength, k)) {
        pickIndex = i;
        break;
      }
    }

    // No card keeps the remainder feasible — the input itself cannot be
    // arranged (see isDiversityFeasible). Fall back to the first card that at
    // least does not extend the current run, else the very first. A short
    // monotonous stretch beats dropping cards.
    if (pickIndex === -1) {
      const alt = remaining.findIndex(
        (x) => !(x.sourceId === runSource && runLength >= k),
      );
      pickIndex = alt === -1 ? 0 : alt;
    }

    const [picked] = remaining.splice(pickIndex, 1);
    if (!picked) break;

    out.push(picked);
    if (picked.sourceId === runSource) {
      runLength++;
    } else {
      runSource = picked.sourceId;
      runLength = 1;
    }
  }

  return out;
}

/**
 * Returns a description of the first run that breaches the cap, or null.
 *
 * Pass `{ onlyIfFeasible: true }` to excuse pages that cannot be arranged at all
 * — a page of 15 cards from one publisher will always contain a long run, and
 * calling that a defect would be blaming the algorithm for the input.
 */
export function violatesDiversity<T extends DiversityItem>(
  page: readonly T[],
  opts: ReorderOptions & { onlyIfFeasible?: boolean } = {},
): string | null {
  const maxConsecutive = opts.maxConsecutive ?? MAX_CONSECUTIVE_SAME_SOURCE;
  if (opts.onlyIfFeasible && !isDiversityFeasible(page, opts)) return null;

  let run = 0;
  let prev: string | null = null;

  for (const item of page) {
    run = item.sourceId === prev ? run + 1 : 1;
    prev = item.sourceId;
    if (run > maxConsecutive) {
      return `${run} consecutive cards from ${item.sourceId} (max ${maxConsecutive})`;
    }
  }
  return null;
}
