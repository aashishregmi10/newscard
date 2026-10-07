/**
 * Sizes and colours for the Interaction cards — pure, so they can be tested
 * without a phone.
 */

/** Room the vote card needs besides its tiles: header, question, bottom bar, footnote. */
export function voteChromeHeight(textScale: number): number {
  const s = Math.min(Math.max(textScale, 0.85), 1.4);
  const header = 30;
  const question = 20 * s * 1.3 * 3 + 14;
  const bottomBar = 52;
  const footnote = 34 * s;
  return Math.round(header + question + bottomBar + footnote + 18 + 16);
}

export interface TileLayout {
  /** Square-ish: the width and height of one tile. */
  width: number;
  height: number;
  rows: number;
  columns: number;
}

/**
 * The vote's photo tiles, as large as the card allows.
 *
 * Two columns always; two candidates make one row of tall tiles, three or four
 * make two rows (the third centred). A tile is never taller than 1.35× its
 * width — a long sliver of a photo reads worse than a little empty space.
 */
export function voteTileSize(
  cardWidth: number,
  cardHeight: number,
  options: number,
  textScale: number,
  padding = 18,
  gap = 10,
): TileLayout {
  const columns = 2;
  const rows = options <= 2 ? 1 : 2;
  const width = Math.floor((cardWidth - padding * 2 - gap) / columns);
  const space = Math.max(0, cardHeight - voteChromeHeight(textScale) - gap * (rows - 1));
  const height = Math.max(96, Math.min(Math.floor(space / rows), Math.floor(width * 1.35)));
  return { width, height, rows, columns };
}

export type RatingTone = 'good' | 'fair' | 'poor' | 'new';

/** The colour of an average, as food and shopping apps show it. */
export function ratingTone(average: number | null): RatingTone {
  if (average === null) return 'new';
  if (average >= 4) return 'good';
  if (average >= 3) return 'fair';
  return 'poor';
}

/**
 * Which option leads, or -1 when nobody has voted or the top is a tie — a
 * "leading" badge on one of two equals would be a claim the numbers do not make.
 */
export function leaderIndex(votes: readonly number[]): number {
  let best = -1;
  let top = 0;
  let tied = false;
  votes.forEach((v, i) => {
    if (v > top) {
      top = v;
      best = i;
      tied = false;
    } else if (v === top && v > 0) {
      tied = true;
    }
  });
  return tied ? -1 : best;
}

/**
 * How full each of five stars is for an average: 3.4 is three whole stars and
 * the fourth four-tenths full. Readers judge a 3.4 against a 3.9 by the last
 * star, so it is drawn in part rather than rounded away.
 */
export function starFills(average: number): number[] {
  return [0, 1, 2, 3, 4].map((k) => Math.round(Math.min(1, Math.max(0, average - k)) * 100) / 100);
}

/** "2 of 4 rated", for the Send button that waits for every option. */
export function ratedCount(chosen: Readonly<Record<string, number>>, optionIds: readonly string[]): number {
  return optionIds.filter((id) => (chosen[id] ?? 0) > 0).length;
}
