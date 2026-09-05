/**
 * Grapheme-aware text measurement.  Spec Ch. 11.4.
 *
 * Devanagari does not behave like Latin script under naive string operations, and
 * the failures are silent rather than loud:
 *
 *   "क्ष".length  === 3   (three code points)
 *   graphemes()   === 1   (one visual character)
 *
 * Counting code points would make Nepali summaries appear ~a third longer than
 * they are, which pushes editors to write too little.  Slicing by code-unit index
 * splits a conjunct and renders as a broken glyph.  Both are invisible in an
 * English-only test corpus, which is why the seed data is bilingual from day one.
 */

const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(locale: string): Intl.Segmenter {
  let s = segmenters.get(locale);
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    segmenters.set(locale, s);
  }
  return s;
}

/** Split into grapheme clusters — what a reader perceives as characters. */
export function graphemes(text: string, locale = 'ne'): string[] {
  return Array.from(segmenterFor(locale).segment(text), (s) => s.segment);
}

/** Count grapheme clusters. This is the number the CMS counter must display. */
export function countGraphemes(text: string, locale = 'ne'): number {
  let n = 0;
  for (const _ of segmenterFor(locale).segment(text)) n++;
  return n;
}

/**
 * Count words. Nepali is space-separated, so splitting on Unicode whitespace is
 * correct for both languages — but the filter for empty strings matters, or a
 * double space inflates the count.
 */
export function countWords(text: string): number {
  const t = text.trim();
  if (t === '') return 0;
  return t.split(/\s+/u).filter(Boolean).length;
}

/**
 * Truncate to at most `max` grapheme clusters, appending an ellipsis when cut.
 * Never splits a conjunct.
 */
export function truncateGraphemes(text: string, max: number, locale = 'ne'): string {
  if (max <= 0) return '';
  const g = graphemes(text, locale);
  if (g.length <= max) return text;
  return g.slice(0, max).join('') + '…';
}

/** Measurement unit, set by Gate 2 (spec Ch. 1.7) and stored in `config.summaryLimits`. */
export type LimitType = 'words' | 'graphemes';

/**
 * Measure a summary in whichever unit Gate 2 selected. The CMS counter and the
 * publish precondition MUST both call this — two implementations would drift.
 */
export function measureSummary(text: string, limitType: LimitType, locale = 'ne'): number {
  return limitType === 'graphemes' ? countGraphemes(text, locale) : countWords(text);
}
