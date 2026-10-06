import { describe, expect, it } from 'vitest';
import { MIN_PLAYER_SIDE, shortPlayerBox, shortStripHeight } from '../shortLayout';

describe('shortPlayerBox', () => {
  it('fits a 9:16 player above the strip on a small phone, centred', () => {
    const box = shortPlayerBox(360, 700, 150);
    expect(box.height).toBeLessThanOrEqual(700 - 150);
    expect(Math.abs(box.width / box.height - 9 / 16)).toBeLessThan(0.01);
    expect(box.left).toBe(Math.floor((360 - box.width) / 2));
  });

  it('is never wider than the screen on a tall phone', () => {
    const box = shortPlayerBox(412, 1200, 150);
    expect(box.width).toBe(412);
    expect(box.height).toBe(Math.floor((412 * 16) / 9));
    expect(box.top).toBeGreaterThanOrEqual(0);
  });

  it('keeps YouTube’s minimum size even when space is short', () => {
    const box = shortPlayerBox(360, 400, 300);
    expect(box.width).toBeGreaterThanOrEqual(MIN_PLAYER_SIDE);
  });
});

describe('shortStripHeight', () => {
  it('grows with the reader’s text size, and with Nepali’s taller lines', () => {
    expect(shortStripHeight(1.35, 'en')).toBeGreaterThan(shortStripHeight(1, 'en'));
    expect(shortStripHeight(1, 'ne')).toBeGreaterThan(shortStripHeight(1, 'en'));
  });
});
