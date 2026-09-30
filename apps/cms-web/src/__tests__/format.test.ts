import { describe, expect, it } from 'vitest';
import { percent, rupees, explainFailure, fileSize, humanise, plural, relativeTime } from '../lib/format';

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

describe('explainFailure', () => {
  it('names the field the server objected to', () => {
    expect(
      explainFailure('Invalid licence values.', {
        issues: [{ path: 'contactEmail', message: 'Invalid email' }],
      }),
    ).toBe('Invalid licence values. (contactEmail: Invalid email)');
  });

  it('joins several issues', () => {
    expect(
      explainFailure('This publisher is not ready to save.', {
        issues: [
          { path: 'slug', message: 'Too short' },
          { path: 'ingest.feedUrl', message: 'Required when method is rss' },
        ],
      }),
    ).toBe(
      'This publisher is not ready to save. (slug: Too short; ingest.feedUrl: Required when method is rss)',
    );
  });

  it('keeps an issue that carries no path', () => {
    expect(explainFailure('No.', { issues: [{ message: 'Something is wrong' }] })).toBe(
      'No. (Something is wrong)',
    );
  });

  /* A malformed error is still an error. Decorating it is a nicety; losing it
     would be a defect. */
  it('falls back to the plain message on anything unexpected', () => {
    expect(explainFailure('Plain.', null)).toBe('Plain.');
    expect(explainFailure('Plain.', undefined)).toBe('Plain.');
    expect(explainFailure('Plain.', 'a string')).toBe('Plain.');
    expect(explainFailure('Plain.', {})).toBe('Plain.');
    expect(explainFailure('Plain.', { issues: [] })).toBe('Plain.');
    expect(explainFailure('Plain.', { issues: 'not an array' })).toBe('Plain.');
    expect(explainFailure('Plain.', { issues: [null, 7, { path: 'x' }] })).toBe('Plain.');
  });
});

describe('rupees', () => {
  it('groups in lakhs, the way a Kathmandu business reads a price', () => {
    expect(rupees(150_000_00)).toBe('Rs 1,50,000');
    expect(rupees(5_000_00)).toBe('Rs 5,000');
    expect(rupees(0)).toBe('Rs 0');
  });

  it('shows paisa only when there are some', () => {
    expect(rupees(142_857)).toBe('Rs 1,428.57');
    expect(rupees(142_800)).toBe('Rs 1,428');
  });
});

describe('percent', () => {
  it('rounds large shares and keeps a decimal on small ones', () => {
    expect(percent(0.619)).toBe('62%');
    expect(percent(0.072)).toBe('7.2%');
    expect(percent(0)).toBe('0%');
    expect(percent(1)).toBe('100%');
  });
});
