import { describe, expect, it } from 'vitest';
import type { Limits } from '../api';
import { bandState, countGraphemes, countWords, measure } from '../lib/measure';

/**
 * Counting a summary.
 *
 * The grapheme rule is the single most consequential piece of pure logic in
 * this application: get it wrong and every Nepali summary reads as a third
 * longer than it is, so the counter turns amber while the editor is looking at
 * a summary of exactly the right length — and the fix they will reach for is to
 * write less.
 */

const LIMITS: Limits = {
  limitType: 'words',
  limits: { ne: { min: 45, max: 60 }, en: { min: 45, max: 60 } },
  headlineMaxChars: 90,
  pullQuoteMaxChars: 140,
};

describe('countGraphemes', () => {
  it('counts a conjunct as the one character a reader sees', () => {
    // क्ष is three code points — क, ् and ष — and one character to anyone
    // reading it. Counting code points is what makes a correct summary look
    // over-long.
    const conjunct = 'क्ष';
    expect([...conjunct].length).toBe(3);
    expect(countGraphemes(conjunct)).toBe(1);
  });

  it('counts a Devanagari word the way it is written', () => {
    expect(countGraphemes('नेपाल')).toBe(3);
  });

  it('agrees with the obvious answer on Latin text', () => {
    expect(countGraphemes('hello')).toBe(5);
    expect(countGraphemes('')).toBe(0);
  });
});

describe('countWords', () => {
  it('does not count the gaps', () => {
    // `split(' ').length` reports 5 for this, which is how a short summary
    // manages to read as over the limit.
    expect(countWords('  one   two  three ')).toBe(3);
  });

  it('treats an empty or blank summary as nothing written yet', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });

  it('counts across line breaks', () => {
    expect(countWords('one\ntwo\nthree')).toBe(3);
  });
});

describe('measure', () => {
  it('uses whatever unit the deployment is configured for', () => {
    const text = 'one two three';
    expect(measure(text, LIMITS, 'en')).toBe(3);
    expect(measure(text, { ...LIMITS, limitType: 'graphemes' }, 'en')).toBe(text.length);
  });
});

describe('bandState', () => {
  const band = { min: 45, max: 60 };

  it('separates too short from too long, inclusively at both ends', () => {
    // Three states rather than "wrong": "write more" and "cut something" are
    // different instructions and an editor acts on them differently.
    expect(bandState(44, band)).toBe('under');
    expect(bandState(45, band)).toBe('ok');
    expect(bandState(60, band)).toBe('ok');
    expect(bandState(61, band)).toBe('over');
  });

  it('treats an empty summary as under, not as fine', () => {
    expect(bandState(0, band)).toBe('under');
  });
});
