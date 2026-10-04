/**
 * How much of a summary is the publisher's own words.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 *
 * The product's licence to exist is that we summarise in our own words, credit
 * the publisher and link to them. A draft can now arrive pre-written — by the
 * AI, or as the article's own key sentences when the AI is unavailable — and a
 * busy editor could publish either unread. This is the check that a summary
 * reaching a reader is ours.
 *
 * ── How ─────────────────────────────────────────────────────────────────────
 *
 * Every run of six consecutive words in the summary is looked up in the
 * original. Six because shorter runs match by coincidence — a name and a title
 * ("प्रधानमन्त्री पुष्पकमल दाहाल प्रचण्डले आज") — and longer ones let a lightly
 * reshuffled copy through. The result is the share of the summary's runs found
 * verbatim. A summary written in its own words scores near nothing; one pasted
 * from the article scores near one.
 *
 * Punctuation and case are ignored, so a copied sentence does not pass for
 * having its full stop changed to a danda.
 */

/** Runs of this many words are compared. */
export const OVERLAP_RUN_WORDS = 6;

/** At or above this share copied, a summary is the publisher's words. */
export const COPIED_SHARE_LIMIT = 0.5;

function words(text: string): string[] {
  return text
    .toLowerCase()
    /* Letters, digits and Devanagari's combining marks survive; every kind of
       punctuation, including the danda, becomes a space. */
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

function runs(list: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= list.length; i++) out.push(list.slice(i, i + n).join(' '));
  return out;
}

/** The share, 0–1, of the summary's six-word runs that appear in the original. */
export function copiedShare(summary: string, original: string, n = OVERLAP_RUN_WORDS): number {
  const mine = runs(words(summary), n);
  if (mine.length === 0) return 0;
  const theirs = new Set(runs(words(original), n));
  if (theirs.size === 0) return 0;
  let copied = 0;
  for (const r of mine) if (theirs.has(r)) copied += 1;
  return copied / mine.length;
}

export function isMostlyCopied(summary: string, original: string): boolean {
  return copiedShare(summary, original) >= COPIED_SHARE_LIMIT;
}
