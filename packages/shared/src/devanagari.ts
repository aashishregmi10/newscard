/**
 * Devanagari normalisation, used before tokenising for cross-source clustering.
 * Plan §2a.
 *
 * This is the step most likely to be skipped, and skipping it quietly halves the
 * clustering score: the same Nepali word written with a precomposed nukta form
 * versus a base letter plus U+093C tokenises as two different words, so two
 * outlets running identical wire copy score as unrelated stories.
 *
 * This is text processing, not machine learning. It is the only "AI-adjacent"
 * file in the codebase and it is deliberately boring.
 */

/** Devanagari block, plus the extended and vedic ranges we may encounter. */
const DEVANAGARI_RE = /[ऀ-ॿ꣠-ꣿ᳐-᳿]/u;

/** Zero-width joiner / non-joiner. Present in real copy, invisible, breaks equality. */
const ZERO_WIDTH_RE = /[​-‍﻿]/gu;

/** Devanagari danda and double danda — sentence punctuation, not word content. */
const DANDA_RE = /[।॥]/gu;

/**
 * Nepali stopwords. Deliberately short: an over-aggressive list removes the very
 * words that distinguish two stories about the same ministry.
 */
const NE_STOPWORDS = new Set([
  'र', 'तथा', 'पनि', 'छ', 'छन्', 'हो', 'भएको', 'गरेको', 'लागि', 'बाट',
  'मा', 'को', 'का', 'की', 'ले', 'लाई', 'सँग', 'भन्ने', 'भन्दा', 'यो',
  'त्यो', 'तर', 'गर्ने', 'हुने', 'रहेको', 'गरी', 'अनि', 'नै', 'सक्ने',
]);

const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'has',
  'have', 'had', 'that', 'this', 'it', 'its', 'said', 'says', 'will', 'would',
]);

export function containsDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

/**
 * Ratio of Devanagari letters to all letters. Used for the language contradiction
 * check in Ch. 4.6 — NOT to overwrite the source's declared language, only to
 * flag a mismatch for a human.
 */
export function devanagariRatio(text: string): number {
  let dev = 0;
  let letters = 0;
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      if (DEVANAGARI_RE.test(ch)) dev++;
    }
  }
  return letters === 0 ? 0 : dev / letters;
}

/**
 * Normalise for comparison. Order matters: NFC composition first, then strip the
 * invisible characters that survive composition.
 */
export function normaliseForCompare(text: string): string {
  return text
    .normalize('NFC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(DANDA_RE, ' ')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Tokenise into comparable content words, stopwords removed.
 * Handles mixed-script text, which is the normal case in Nepali news.
 */
export function contentTokens(text: string): string[] {
  const normalised = normaliseForCompare(text);
  const raw = normalised.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return raw.filter((t) => t.length > 1 && !NE_STOPWORDS.has(t) && !EN_STOPWORDS.has(t));
}

/**
 * Candidate proper nouns. Capitalised Latin words, plus every Devanagari token —
 * Devanagari has no case, so we cannot detect proper nouns by shape and instead
 * let the Jaccard term carry that signal.
 */
export function properNounCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!word || word.length < 2) continue;
    if (/^\p{Lu}/u.test(word)) out.add(normaliseForCompare(word));
    else if (containsDevanagari(word)) out.add(normaliseForCompare(word));
  }
  out.delete('');
  return [...out];
}
