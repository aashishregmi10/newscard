import { describe, it, expect } from 'vitest';
import { clampClientTimestamp, MAX_CLIENT_TIMESTAMP_AGE_MS } from '../clientClock.js';

/**
 * A TTL index keyed on a timestamp the client supplies fails in both
 * directions, and both failures are silent. These are the boundaries that
 * decide whether a row lives for its intended window, vanishes within the
 * minute, or never expires at all.
 */

const now = new Date('2026-09-17T10:00:00.000Z');

describe('clampClientTimestamp', () => {
  it('keeps a plausible timestamp exactly', () => {
    const claimed = '2026-09-17T09:59:40.000Z';
    expect(clampClientTimestamp(claimed, now).toISOString()).toBe(claimed);
  });

  it('clamps the future to now', () => {
    // A clock four years fast would otherwise produce a row that never expires.
    expect(clampClientTimestamp('2030-01-01T00:00:00.000Z', now)).toEqual(now);
  });

  it('clamps a few seconds of skew rather than trusting it', () => {
    // Small and common. It still must not sort ahead of what the server wrote
    // after it.
    expect(clampClientTimestamp('2026-09-17T10:00:05.000Z', now)).toEqual(now);
  });

  it('clamps far past to the oldest allowed moment', () => {
    // The flat-battery case: the row must still be stored, and must not be
    // deleted by the TTL monitor the moment it lands.
    const result = clampClientTimestamp('2020-01-01T00:00:00.000Z', now);
    expect(result.getTime()).toBe(now.getTime() - MAX_CLIENT_TIMESTAMP_AGE_MS);
  });

  it('keeps a timestamp exactly at the age boundary', () => {
    const edge = new Date(now.getTime() - MAX_CLIENT_TIMESTAMP_AGE_MS);
    expect(clampClientTimestamp(edge.toISOString(), now)).toEqual(edge);
  });

  it('falls back to now for absent or unparseable values', () => {
    expect(clampClientTimestamp(undefined, now)).toEqual(now);
    expect(clampClientTimestamp(null, now)).toEqual(now);
    expect(clampClientTimestamp('not a date', now)).toEqual(now);
    expect(clampClientTimestamp('', now)).toEqual(now);
  });

  it('accepts a Date as well as a string', () => {
    const d = new Date('2026-09-17T09:30:00.000Z');
    expect(clampClientTimestamp(d, now)).toEqual(d);
  });
});
