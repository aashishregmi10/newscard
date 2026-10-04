import { measureSummary, type LimitType } from '@saar/shared';

/**
 * The fallback: the article's own most important sentences, picked out.
 *
 * ── When ────────────────────────────────────────────────────────────────────
 *
 * When there is no AI to ask — no key configured, the free tier's daily limit
 * spent, or the model down. It is instant, free and needs no network, so a
 * promoted story never arrives with an empty summary box for those reasons.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 *
 * A summary in our words. These are the PUBLISHER'S sentences, and the result
 * says so in the composer; the publish gate's overlap check will not let them
 * through until an editor has rewritten them. What this saves is the reading:
 * the editor starts from the three sentences that carry the story rather than
 * from the whole article.
 *
 * ── How it chooses ──────────────────────────────────────────────────────────
 *
 * A sentence scores for the words it shares with the rest of the article — the
 * words a story keeps returning to are what it is about — divided by its
 * length so that long sentences do not win by size, with a bonus for coming
 * first, because news is written with the most important fact at the top.
 * The best are taken until the summary is inside the limit, then put back in
 * the article's own order so they still read as a paragraph.
 */

export interface Band {
  limitType: LimitType;
  min: number;
  max: number;
}

/** Devanagari's danda (।, ॥) ends a Nepali sentence; . ? ! end an English one. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[।॥.?!])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Words for scoring: lowercase, punctuation stripped, very short ones dropped
 *  — in both scripts those are mostly particles and postpositions. */
function tokens(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .split(/[\s,;:"'“”‘’()[\]{}।॥.?!—–-]+/u)
    .filter((w) => [...w].length > 2);
}

export function keySentences(text: string, band: Band, locale: 'ne' | 'en'): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';

  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of new Set(tokens(s))) freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  const scored = sentences.map((s, i) => {
    const words = tokens(s);
    const shared = words.reduce((n, w) => n + ((freq.get(w) ?? 1) - 1), 0);
    const density = words.length > 0 ? shared / Math.sqrt(words.length) : 0;
    /* The lede, then the next two, carry most news stories. */
    const position = i === 0 ? 2 : i < 3 ? 1 : 0;
    return { i, s, size: measureSummary(s, band.limitType, locale), score: density + position };
  });

  const chosen: typeof scored = [];
  let total = 0;
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (total >= band.min) break;
    if (c.size > band.max) continue;
    if (total + c.size > band.max) continue;
    chosen.push(c);
    total += c.size;
  }

  /* Nothing fitted — every sentence is longer than the whole limit. The first
     one is still the best place for an editor to start. */
  if (chosen.length === 0) return sentences[0]!;

  return chosen
    .sort((a, b) => a.i - b.i)
    .map((c) => c.s)
    .join(' ');
}
