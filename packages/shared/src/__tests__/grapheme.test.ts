import { describe, it, expect } from 'vitest';
import {
  countGraphemes,
  countWords,
  truncateGraphemes,
  graphemes,
  measureSummary,
} from '../grapheme.js';

/**
 * Conjuncts and matras that are one visual character but several code points.
 * These are the cases that make String.length wrong for Nepali.
 */
const CONJUNCTS: Array<[string, number]> = [
  ['क्ष', 1],
  ['त्र', 1],
  ['ज्ञ', 1],
  ['श्री', 1],
  ['द्ध', 1],
  ['नि', 1],
  ['की', 1],
  ['हुँ', 1],
];

describe('grapheme counting', () => {
  it.each(CONJUNCTS)('counts %s as %i grapheme(s)', (text, expected) => {
    expect(countGraphemes(text)).toBe(expected);
  });

  it('differs from String.length for conjuncts — the whole reason this exists', () => {
    expect('क्ष'.length).toBe(3);
    expect(countGraphemes('क्ष')).toBe(1);
  });

  it('counts a Nepali word correctly', () => {
    // नेपाल = न े प ा ल -> 3 grapheme clusters
    expect(countGraphemes('नेपाल')).toBe(3);
    expect('नेपाल'.length).toBe(5);
  });

  it('matches String.length for pure ASCII', () => {
    expect(countGraphemes('Kathmandu')).toBe('Kathmandu'.length);
  });

  it('handles mixed-script text', () => {
    // N E P S E <space> मा  -> 7, because 'मा' is a single cluster
    expect(countGraphemes('NEPSE मा')).toBe(7);
    expect('NEPSE मा'.length).toBe(8);
  });

  it('counts an empty string as zero', () => {
    expect(countGraphemes('')).toBe(0);
  });
});

describe('word counting', () => {
  it('counts space-separated Nepali words', () => {
    expect(countWords('सरकारले राहत कोष जारी गरेको छ')).toBe(6);
  });

  it('is not fooled by repeated or mixed whitespace', () => {
    expect(countWords('  one   two \n three\t four  ')).toBe(4);
  });

  it('returns zero for empty and whitespace-only input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('    ')).toBe(0);
  });
});

describe('truncation', () => {
  it('never splits a conjunct', () => {
    const text = 'क्षत्रिय';
    for (let n = 1; n <= countGraphemes(text); n++) {
      const cut = truncateGraphemes(text, n);
      const body = cut.endsWith('…') ? cut.slice(0, -1) : cut;
      // every grapheme in the result must be a whole grapheme of the original
      expect(graphemes(text).slice(0, n).join('')).toBe(body);
    }
  });

  it('returns the original when it already fits', () => {
    expect(truncateGraphemes('नेपाल', 10)).toBe('नेपाल');
  });

  it('appends an ellipsis only when it actually cuts', () => {
    // नेपाल segments as ["ने","पा","ल"], so a limit of 2 keeps "नेपा"
    expect(truncateGraphemes('नेपाल', 2)).toBe('नेपा…');
    expect(truncateGraphemes('नेपाल', 3)).toBe('नेपाल');
  });

  it('returns empty string for a non-positive limit', () => {
    expect(truncateGraphemes('नेपाल', 0)).toBe('');
    expect(truncateGraphemes('नेपाल', -5)).toBe('');
  });
});

describe('measureSummary — the Gate 2 switch', () => {
  const nepali = 'सरकारले बाढी प्रभावित जिल्लाका लागि राहत कोषको पहिलो किस्ता जारी गरेको छ';

  it('measures words when limitType is words', () => {
    expect(measureSummary(nepali, 'words')).toBe(countWords(nepali));
  });

  it('measures graphemes when limitType is graphemes', () => {
    expect(measureSummary(nepali, 'graphemes')).toBe(countGraphemes(nepali));
  });

  it('gives a materially different answer in each mode — which is the point', () => {
    expect(measureSummary(nepali, 'graphemes')).toBeGreaterThan(
      measureSummary(nepali, 'words') * 3,
    );
  });
});
