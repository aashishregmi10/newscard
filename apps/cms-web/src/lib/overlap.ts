/**
 * How much of a summary is the publisher's own words — the composer's copy.
 *
 * The rule itself lives in packages/shared/src/overlap.ts, and it is the
 * server's copy that refuses to publish. This one exists so the editor sees the
 * problem while typing rather than at the Publish button; the editorial site is
 * built apart from the server packages, so it is restated here (as measure.ts
 * restates the summary counter). The two must agree: same six-word runs, same
 * punctuation rule, same 50% line. src/__tests__/overlap.test.ts holds them to
 * the same cases.
 */

export const OVERLAP_RUN_WORDS = 6;
export const COPIED_SHARE_LIMIT = 0.5;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

function runs(list: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= list.length; i++) out.push(list.slice(i, i + n).join(' '));
  return out;
}

export function copiedShare(summary: string, original: string, n = OVERLAP_RUN_WORDS): number {
  const mine = runs(words(summary), n);
  if (mine.length === 0) return 0;
  const theirs = new Set(runs(words(original), n));
  if (theirs.size === 0) return 0;
  let copied = 0;
  for (const r of mine) if (theirs.has(r)) copied += 1;
  return copied / mine.length;
}
