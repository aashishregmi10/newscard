import { describe, it, expect } from 'vitest';
import { INITIAL_FIT, MAX_PASSES, MIN_FIT, nextFit, type FitState } from '../cardFit.js';

/**
 * How a story is fitted to its card. What matters to a reader: a story that
 * fits is left exactly as it is, one that does not gets smaller only as far as
 * it must, and the process always ends.
 */

/**
 * A stand-in for layout: text height goes with the square of its size (taller
 * lines, and more of them), and the photograph has already given way, so any
 * excess over the room available is overflow.
 */
function layout(fullHeight: number, room: number) {
  return (s: FitState) => {
    const text = fullHeight * s.fit * s.fit;
    // Collapsing the photograph frees a fixed amount more room.
    const available = room + (s.collapse ? 120 : 0);
    return { text, overflow: text - available };
  };
}

function settle(fullHeight: number, room: number): { state: FitState; rounds: number } {
  const measure = layout(fullHeight, room);
  let state = INITIAL_FIT;
  let rounds = 0;
  while (!state.done) {
    state = nextFit(state, measure(state));
    rounds += 1;
    if (rounds > 20) throw new Error('did not settle');
  }
  return { state, rounds };
}

describe('nextFit', () => {
  it('leaves a story that fits at the reader’s own size', () => {
    const { state, rounds } = settle(300, 400);
    expect(state.fit).toBe(1);
    expect(state.collapse).toBe(false);
    expect(rounds).toBe(1);
  });

  it('treats half a pixel as rounding, not overflow', () => {
    expect(nextFit(INITIAL_FIT, { text: 400, overflow: 0.4 })).toMatchObject({ fit: 1, done: true });
  });

  it('shrinks a long story until it fits, and no further than it must', () => {
    const { state } = settle(480, 400);
    const text = 480 * state.fit * state.fit;
    expect(text).toBeLessThanOrEqual(400.5);
    // Within a few percent of the largest size that fits.
    expect(state.fit).toBeGreaterThan(Math.sqrt(400 / 480) * 0.95);
    expect(state.collapse).toBe(false);
  });

  it('never goes below the smallest size, and collapses the photograph instead', () => {
    const { state } = settle(900, 400);
    expect(state.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(state.collapse).toBe(true);
    expect(state.done).toBe(true);
  });

  it('always ends, even when nothing is enough', () => {
    const { state, rounds } = settle(5000, 100);
    expect(state.done).toBe(true);
    expect(rounds).toBeLessThanOrEqual(MAX_PASSES + 1);
  });

  it('does not report a change when a settled card still fits', () => {
    const settled: FitState = { fit: 0.9, collapse: false, passes: 2, done: true };
    expect(nextFit(settled, { text: 350, overflow: -10 })).toBe(settled);
  });
});
