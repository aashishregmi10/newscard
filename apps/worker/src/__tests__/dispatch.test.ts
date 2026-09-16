import { describe, it, expect } from 'vitest';
import { nptDayKey, effectiveSentToday } from '../dispatch.js';

/**
 * The daily cap depends on agreeing what "today" is.
 *
 * These are the cases that decide whether a reader can be sent three
 * notifications or six, and every one of them is invisible to a test written in
 * UTC — Nepal Time is UTC+05:45, so the boundary falls at 18:15 UTC, in the
 * middle of a working afternoon rather than at a suspicious-looking midnight.
 */

describe('nptDayKey', () => {
  it('rolls over at midnight in Nepal, not at midnight UTC', () => {
    // 18:14 UTC is 23:59 NPT — still the 14th locally.
    expect(nptDayKey(new Date('2026-03-14T18:14:00Z'))).toBe('2026-03-14');
    // 18:15 UTC is 00:00 NPT on the 15th.
    expect(nptDayKey(new Date('2026-03-14T18:15:00Z'))).toBe('2026-03-15');
  });

  it('treats UTC midnight as the same Nepali day it already was', () => {
    // 23:59 UTC on the 14th is 05:44 NPT on the 15th — the UTC date changing
    // is exactly the event a naive implementation would reset on.
    expect(nptDayKey(new Date('2026-03-14T23:59:00Z'))).toBe('2026-03-15');
    expect(nptDayKey(new Date('2026-03-15T00:01:00Z'))).toBe('2026-03-15');
  });
});

describe('effectiveSentToday', () => {
  const now = new Date('2026-03-15T04:00:00Z'); // 09:45 NPT on the 15th

  it('is zero for a device that has never been sent to', () => {
    expect(effectiveSentToday(0, null, now)).toBe(0);
    // A stored count with no timestamp cannot be attributed to a day, so it is
    // not allowed to cap anyone.
    expect(effectiveSentToday(3, null, now)).toBe(0);
  });

  it('keeps the count within the same Nepali day', () => {
    const earlierToday = new Date('2026-03-14T20:00:00Z'); // 01:45 NPT, the 15th
    expect(effectiveSentToday(2, earlierToday, now)).toBe(2);
  });

  it('discards a count from a previous Nepali day', () => {
    const yesterday = new Date('2026-03-14T10:00:00Z'); // 15:45 NPT, the 14th
    expect(effectiveSentToday(3, yesterday, now)).toBe(0);
  });

  it('does not reset on the UTC day changing alone', () => {
    // 23:00 UTC on the 14th is 04:45 NPT on the 15th — the same Nepali day as
    // `now`. A UTC-based reset would zero this and hand the reader a second
    // full allowance before breakfast.
    const lateUtc = new Date('2026-03-14T23:00:00Z');
    expect(effectiveSentToday(3, lateUtc, now)).toBe(3);
  });
});
