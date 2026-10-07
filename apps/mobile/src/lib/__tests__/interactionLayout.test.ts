import { describe, expect, it } from 'vitest';
import { leaderIndex, ratedCount, ratingTone, starFills, voteChromeHeight, voteTileSize } from '../interactionLayout';

describe('voteTileSize', () => {
  it('makes two tall tiles in one row for two candidates', () => {
    const t = voteTileSize(360, 700, 2, 1);
    expect(t.rows).toBe(1);
    expect(t.height).toBeGreaterThan(t.width);
    expect(t.height).toBeLessThanOrEqual(Math.floor(t.width * 1.35));
  });

  it('fits two rows of four inside the card, with room for the rest', () => {
    const t = voteTileSize(360, 700, 4, 1);
    expect(t.rows).toBe(2);
    expect(t.height * 2 + 10 + voteChromeHeight(1)).toBeLessThanOrEqual(700);
  });

  it('gives way to larger text, but never below a usable tile', () => {
    const normal = voteTileSize(360, 640, 4, 1);
    const large = voteTileSize(360, 640, 4, 1.35);
    expect(large.height).toBeLessThan(normal.height);
    expect(voteTileSize(320, 300, 4, 1.4).height).toBeGreaterThanOrEqual(96);
  });

  it('uses the width it has on a wide phone', () => {
    expect(voteTileSize(412, 820, 3, 1).width).toBe(Math.floor((412 - 36 - 10) / 2));
  });
});

describe('ratingTone', () => {
  it('reads 4 and above as good, 3 to 4 as fair, below 3 as poor', () => {
    expect(ratingTone(4)).toBe('good');
    expect(ratingTone(4.6)).toBe('good');
    expect(ratingTone(3.9)).toBe('fair');
    expect(ratingTone(3)).toBe('fair');
    expect(ratingTone(2.9)).toBe('poor');
    expect(ratingTone(null)).toBe('new');
  });
});

describe('leaderIndex', () => {
  it('names the clear leader, and nobody on a tie or before any vote', () => {
    expect(leaderIndex([3, 9, 1])).toBe(1);
    expect(leaderIndex([5, 5, 1])).toBe(-1);
    expect(leaderIndex([0, 0])).toBe(-1);
  });
});

describe('starFills', () => {
  it('fills whole stars, then part of the next, then none', () => {
    expect(starFills(3.4)).toEqual([1, 1, 1, 0.4, 0]);
    expect(starFills(5)).toEqual([1, 1, 1, 1, 1]);
    expect(starFills(1)).toEqual([1, 0, 0, 0, 0]);
    expect(starFills(0)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('ratedCount', () => {
  it('counts only the options given stars, and only this card’s', () => {
    expect(ratedCount({ a: 4, b: 0, z: 5 }, ['a', 'b', 'c'])).toBe(1);
    expect(ratedCount({}, ['a', 'b'])).toBe(0);
  });
});
