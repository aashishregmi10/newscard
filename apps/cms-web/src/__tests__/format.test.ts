import { describe, expect, it } from 'vitest';
import { fileSize, humanise, plural, relativeTime } from '../lib/format';

/**
 * Formatting, at the boundaries.
 *
 * The clock is injected, which is the whole reason these are worth writing: the
 * interesting cases are a timestamp from the future and a timestamp that is not
 * one, and neither is reachable from a test that calls Date.now().
 */

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads a timestamp from the future as "just now"', () => {
    /*
     * This is not hypothetical. The server stamps createdAt from its own clock,
     * and a workstation a few seconds behind renders every fresh story as
     * "-1m ago" — which looks like a bug in the queue and is a bug in the
     * subtraction.
     */
    expect(relativeTime(new Date(NOW + 30 * 1000).toISOString(), NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toBe('just now');
  });

  it('returns nothing at all for a date it cannot read', () => {
    // The alternative is "NaNm ago" in a newsroom queue.
    expect(relativeTime('not a date', NOW)).toBe('');
    expect(relativeTime('', NOW)).toBe('');
  });

  it('steps through the units at their boundaries', () => {
    expect(relativeTime(ago(30 * 1000), NOW)).toBe('just now');
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago');
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h ago');
    expect(relativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(ago(6 * DAY), NOW)).toBe('6d ago');
  });

  it('becomes a date once "days ago" stops being useful', () => {
    const old = relativeTime(ago(40 * DAY), NOW);
    expect(old).not.toMatch(/ago$/);
    expect(old).not.toBe('');
  });
});

describe('fileSize', () => {
  it('changes unit where the number stops being readable', () => {
    expect(fileSize(0)).toBe('0 B');
    expect(fileSize(900)).toBe('900 B');
    expect(fileSize(1024)).toBe('1 KB');
    expect(fileSize(1024 * 1024)).toBe('1.0 MB');
    expect(fileSize(1.44 * 1024 * 1024)).toBe('1.4 MB');
  });

  it('says nothing rather than something wrong', () => {
    expect(fileSize(Number.NaN)).toBe('');
    expect(fileSize(-1)).toBe('');
    expect(fileSize(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('plural', () => {
  it('agrees with the number in front of it', () => {
    expect(plural(1, 'device')).toBe('1 device');
    expect(plural(0, 'device')).toBe('0 devices');
    expect(plural(2, 'device')).toBe('2 devices');
  });

  it('takes an irregular plural', () => {
    expect(plural(2, 'story', 'stories')).toBe('2 stories');
  });
});

describe('humanise', () => {
  it('turns a machine token into something an editor would say', () => {
    expect(humanise('cap_reached')).toBe('Cap reached');
    expect(humanise('quiet-hours')).toBe('Quiet hours');
    expect(humanise('breaking')).toBe('Breaking');
  });

  it('does not fall over on an empty token', () => {
    expect(humanise('')).toBe('');
    expect(humanise('__')).toBe('');
  });
});
