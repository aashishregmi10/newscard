/**
 * Where a YouTube short's player goes on its card.
 *
 * YouTube's rules forbid anything drawn in front of its player
 * (developers.google.com/youtube/terms/required-minimum-functionality), so our
 * words cannot sit on the video the way they do on our own shorts. They go in
 * a strip underneath, and the player takes the rest: a 9:16 box, as large as
 * the space above the strip allows, centred, with black around it.
 *
 * A Short is 9:16, so a box of exactly that shape shows it edge to edge, and
 * YouTube's thumbnail (a vertical frame between black bars) cropped to "cover"
 * the same box shows exactly the frame the video will start on.
 */

export interface Box {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** YouTube's minimum for an embedded player, in points. */
export const MIN_PLAYER_SIDE = 200;

export function shortPlayerBox(cardWidth: number, cardHeight: number, stripHeight: number): Box {
  const above = Math.max(0, cardHeight - stripHeight);
  const width = Math.max(
    Math.min(MIN_PLAYER_SIDE, cardWidth),
    Math.floor(Math.min(cardWidth, (above * 9) / 16)),
  );
  const height = Math.floor((width * 16) / 9);
  return {
    width,
    height,
    left: Math.floor((cardWidth - width) / 2),
    top: Math.max(0, Math.floor((above - height) / 2)),
  };
}

/**
 * How tall the strip under the player is: the publisher line, two lines of
 * title, two of caption, and room to breathe — at the reader's text size, so a
 * larger setting takes its space from the video rather than cutting words.
 */
export function shortStripHeight(textScale: number, language: 'ne' | 'en'): number {
  const scale = Math.min(Math.max(textScale, 0.85), 1.4);
  const titleLine = 17 * scale * 1.28;
  const captionLine = 13.5 * scale * (language === 'ne' ? 1.7 : 1.55);
  return Math.round(40 + titleLine * 2 + captionLine * 2 + 26);
}
