/**
 * Fitting a story to its card.
 *
 * A card is exactly one screen tall, and its summary is never cut short and
 * never scrolls: it is the product (Ch. 7.7). But the summary's length, the
 * phone's size and the reader's text size all vary, and at the app's text
 * size a sixty-word Nepali summary on a 360-wide phone is taller than the
 * room left under a full-height photograph. It used to run on underneath the
 * "read the full story" strip, and its last lines were simply not there.
 *
 * So, in this order, and only as far as each is needed:
 *
 *   1. The photograph gives way. It starts at 38% of the card and shrinks to
 *      20% before the text is touched. That part is pure layout — the image
 *      region is the only thing on the card allowed to shrink — so it costs
 *      no measuring and no second pass.
 *   2. The headline and summary step down, from the reader's size towards
 *      MIN_FIT of it. This needs the text measured, which is what this module
 *      decides from.
 *   3. If even that is not enough — the largest text setting on the smallest
 *      phone — the photograph may shrink to nothing.
 *
 * The decision is kept pure so it can be tested without a phone.
 */

/** The smallest the story text may become, as a share of the reader's size. */
export const MIN_FIT = 0.72;

/** Rounds of measure-and-adjust before accepting the result. */
export const MAX_PASSES = 4;

export interface FitState {
  /** Multiplies the headline and summary size. 1 is the reader's own size. */
  fit: number;
  /** Whether the photograph may shrink past its usual minimum. */
  collapse: boolean;
  passes: number;
  /** Nothing more to do: it fits, or every step has been taken. */
  done: boolean;
}

export const INITIAL_FIT: FitState = { fit: 1, collapse: false, passes: 0, done: false };

export interface FitMeasure {
  /** Height of the headline and summary together, as laid out. */
  text: number;
  /** How far the card's content runs past the bottom of the card. */
  overflow: number;
}

export function nextFit(s: FitState, m: FitMeasure): FitState {
  // Half a pixel is layout rounding, not overflow.
  if (m.overflow <= 0.5 || m.text <= 0) return s.done ? s : { ...s, done: true };
  if (s.passes >= MAX_PASSES) return s.done ? s : { ...s, done: true };

  if (s.fit <= MIN_FIT) {
    return s.collapse
      ? { ...s, done: true }
      : { ...s, collapse: true, passes: s.passes + 1, done: false };
  }

  /*
   * Text height grows with the square of its size: each line is taller, and
   * fewer words fit on it, so there are more lines. Shrinking by the square
   * root of the ratio needed lands close in one step; line breaks are whole
   * lines, so the next pass takes up whatever is left.
   */
  const target = Math.max(m.text - m.overflow - 2, m.text * 0.25);
  const fit = Math.max(MIN_FIT, s.fit * Math.sqrt(target / m.text) * 0.99);
  return { ...s, fit, passes: s.passes + 1, done: false };
}
