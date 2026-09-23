import type { Limits } from '../api';

/**
 * Counting a summary.
 *
 * Pure and separated from the composer so it can be tested without a browser,
 * which matters more here than it looks: the grapheme rule below is the kind of
 * thing that is correct on the machine it was written on and wrong on a
 * different engine, and a component test would never have caught it.
 */

/**
 * Grapheme clusters, not code points.
 *
 * क्ष is ONE character to a reader and three code points to JavaScript.
 * `[...text].length` therefore reports a Nepali summary as roughly a third
 * longer than it is, which pushes editors to write too little to stay inside a
 * band that was set by counting the way a reader counts.
 *
 * `Intl.Segmenter` is in every browser this application supports. The fallback
 * is not dead code for a browser we care about — it is there because a wrong
 * count is survivable and a thrown TypeError in a keystroke handler is not.
 */
export function countGraphemes(text: string, locale = 'ne'): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)) n += 1;
    return n;
  }
  return [...text].length;
}

/**
 * Words.
 *
 * Splitting on whitespace and dropping empties, so leading, trailing and
 * doubled spaces do not each count as a word — which is what `split(' ').length`
 * does, and why a summary can read as over the limit while looking short.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).filter(Boolean).length;
}

/** Whichever unit the server said this deployment counts in. */
export function measure(text: string, limits: Limits, language: 'ne' | 'en'): number {
  return limits.limitType === 'graphemes' ? countGraphemes(text, language) : countWords(text);
}

export type BandState = 'under' | 'ok' | 'over';

export function bandState(count: number, band: { min: number; max: number }): BandState {
  if (count < band.min) return 'under';
  if (count > band.max) return 'over';
  return 'ok';
}
