import { describe, expect, it } from 'vitest';
import {
  AUTO_PAUSE_AFTER_FAILURES,
  ingestHealth,
  ingestSummary,
  licenceLook,
  sourceHaystack,
  suggestSlug,
} from '../lib/sources';

/**
 * How a publisher reads on screen.
 *
 * This file imports `lib/sources.ts` and nothing else, which is the point —
 * cms-web is not an npm workspace, so the root runner cannot resolve React, and
 * a single type-only import of the `ui` barrel would make all of this
 * untestable. `lib/status.ts` has exactly that problem today.
 */

describe('licenceLook', () => {
  it('gives every status its own word, tone and icon', () => {
    const statuses = ['agreed', 'pending', 'refused', 'unknown'];
    const looks = statuses.map(licenceLook);

    expect(new Set(looks.map((l) => l.label)).size).toBe(4);
    expect(new Set(looks.map((l) => l.tone)).size).toBe(4);
    expect(new Set(looks.map((l) => l.icon)).size).toBe(4);
  });

  it('marks only "agreed" as the one that permits publishing', () => {
    // The tone carries meaning here: it is the legal gate, not decoration.
    expect(licenceLook('agreed').tone).toBe('ok');
    expect(licenceLook('pending').tone).toBe('warn');
    expect(licenceLook('refused').tone).toBe('bad');
    expect(licenceLook('unknown').tone).toBe('neutral');
  });

  it('says what a status means rather than restating it', () => {
    // A blurb that just repeats the label teaches nothing.
    for (const status of ['agreed', 'pending', 'refused', 'unknown']) {
      const look = licenceLook(status);
      expect(look.blurb.length).toBeGreaterThan(20);
      expect(look.blurb.toLowerCase()).not.toBe(look.label.toLowerCase());
    }
  });

  it('degrades a status this build has not heard of', () => {
    /*
     * The server can gain a value while a browser keeps the previous bundle.
     * Rendering the raw token readably is the difference between a row that
     * looks unfamiliar and one that looks empty.
     */
    const look = licenceLook('under_review');
    expect(look.label).toBe('Under review');
    expect(look.tone).toBe('neutral');
    expect(look.icon).toBe('info');
    expect(look.blurb).toContain('unlicensed');
  });

  it('does not fall over on an empty status', () => {
    expect(() => licenceLook('')).not.toThrow();
    expect(licenceLook('').tone).toBe('neutral');
  });
});

describe('ingestSummary', () => {
  it('does not mention polling for a publisher nobody polls', () => {
    expect(ingestSummary({ method: 'manual', pollIntervalMin: 15 })).toBe('Manual entry');
  });

  it('names the method and the interval together', () => {
    expect(ingestSummary({ method: 'rss', pollIntervalMin: 15 })).toBe('RSS every 15 minutes');
    expect(ingestSummary({ method: 'api', pollIntervalMin: 30 })).toBe('API every 30 minutes');
  });

  it('agrees with the number in front of it', () => {
    expect(ingestSummary({ method: 'rss', pollIntervalMin: 1 })).toBe('RSS every 1 minute');
  });
});

describe('ingestHealth', () => {
  const base = { lastSuccessAt: null, consecutiveFailures: 0 };

  it('reports a manual publisher as manual whatever the counters say', () => {
    // Stale telemetry on a source that switched to manual must not read as a
    // fault — nothing is polling it, so nothing is failing.
    const health = ingestHealth({ ...base, method: 'manual', consecutiveFailures: 9 });
    expect(health.state).toBe('manual');
    expect(health.tone).toBe('neutral');
  });

  it('distinguishes never-polled from healthy', () => {
    // Today every RSS publisher is in this state, because nothing polls yet.
    expect(ingestHealth({ ...base, method: 'rss' }).state).toBe('never');
    expect(ingestHealth({ ...base, method: 'rss' }).tone).toBe('neutral');

    const ok = ingestHealth({ method: 'rss', lastSuccessAt: '2026-09-20T09:00:00Z', consecutiveFailures: 0 });
    expect(ok.state).toBe('ok');
    expect(ok.tone).toBe('ok');
  });

  it('escalates at the auto-pause threshold the schema documents', () => {
    const below = ingestHealth({ ...base, method: 'rss', consecutiveFailures: AUTO_PAUSE_AFTER_FAILURES - 1 });
    const at = ingestHealth({ ...base, method: 'rss', consecutiveFailures: AUTO_PAUSE_AFTER_FAILURES });

    expect(below.state).toBe('failing');
    expect(below.tone).toBe('warn');
    expect(at.state).toBe('stalled');
    expect(at.tone).toBe('bad');
  });

  it('treats failures as more urgent than a stale success', () => {
    // A publisher that succeeded yesterday and has failed twice since is
    // failing, not healthy.
    const health = ingestHealth({
      method: 'rss',
      lastSuccessAt: '2026-09-19T09:00:00Z',
      consecutiveFailures: 2,
    });
    expect(health.state).toBe('failing');
  });
});

describe('sourceHaystack', () => {
  const source = {
    slug: 'namuna-khabar',
    displayName: 'नमुना खबर',
    language: 'ne',
    licence: { status: 'pending' },
    ingest: { method: 'rss' },
  };

  it('includes the licence status, so typing it filters the list', () => {
    // This is why the screen needs no second filter control beyond the tabs.
    expect(sourceHaystack(source)).toContain('pending');
  });

  it('includes the ingest method and the slug', () => {
    expect(sourceHaystack(source)).toContain('rss');
    expect(sourceHaystack(source)).toContain('namuna-khabar');
  });

  it('is lowercased once so the filter does not have to', () => {
    const shouted = sourceHaystack({ ...source, displayName: 'SAMPLE POST', slug: 'Sample-Post' });
    expect(shouted).toBe(shouted.toLowerCase());
  });
});

describe('suggestSlug', () => {
  it('proposes a storable slug from a Latin masthead', () => {
    expect(suggestSlug('Sample Post')).toBe('sample-post');
    expect(suggestSlug('The Kathmandu Times!')).toBe('the-kathmandu-times');
  });

  it('collapses and trims punctuation rather than leaving stray hyphens', () => {
    expect(suggestSlug('  A -- B  ')).toBe('a-b');
    expect(suggestSlug('...')).toBe('');
  });

  it('returns nothing for a Devanagari masthead rather than guessing', () => {
    /*
     * There is no transliteration here on purpose. A romanisation we invented
     * would be a worse slug than the one a Nepali editor would choose, asserted
     * with more confidence — and the slug is permanent.
     */
    expect(suggestSlug('नमुना खबर')).toBe('');
  });

  it('respects the 64-character ceiling the schema sets', () => {
    expect(suggestSlug('a'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});
