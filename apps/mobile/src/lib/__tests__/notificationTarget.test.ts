import { describe, it, expect } from 'vitest';
import { targetFrom } from '../notificationTarget.js';

/**
 * A tap is the one moment a reader actively chose to come back. Landing them on
 * a cold home screen wastes it — and to the reader, a payload we failed to
 * parse is indistinguishable from an app that ignored them.
 *
 * The cold-start path matters most and is the least exercised by hand: the
 * event is delivered once, at launch, before any listener exists. Testers
 * rarely force-stop the app first, so a regression here passes every casual
 * check.
 */

describe('targetFrom', () => {
  it('prefers an explicit slug, which needs no parsing', () => {
    expect(targetFrom({ slug: 'monsoon-warning' })).toBe('/article/monsoon-warning');
  });

  it('parses an article deep link', () => {
    expect(targetFrom({ deepLink: 'saar://article/monsoon-warning' })).toBe(
      '/article/monsoon-warning',
    );
  });

  it('stops the slug at a query string', () => {
    // A tracking parameter must not become part of the slug and 404 a story
    // that exists.
    expect(targetFrom({ deepLink: 'saar://article/monsoon-warning?utm=push' })).toBe(
      '/article/monsoon-warning',
    );
  });

  it('stops the slug at a fragment', () => {
    expect(targetFrom({ deepLink: 'saar://article/monsoon-warning#top' })).toBe(
      '/article/monsoon-warning',
    );
  });

  it('routes the non-article destinations', () => {
    expect(targetFrom({ deepLink: 'saar://bookmarks' })).toBe('/saved');
    expect(targetFrom({ deepLink: 'saar://settings' })).toBe('/settings');
    expect(targetFrom({ deepLink: 'saar://feed' })).toBe('/');
  });

  it('accepts the scheme in any case', () => {
    expect(targetFrom({ deepLink: 'SAAR://Article/abc' })).toBe('/article/abc');
  });

  it('lets a slug win over a deep link that disagrees', () => {
    expect(targetFrom({ slug: 'from-slug', deepLink: 'saar://article/from-link' })).toBe(
      '/article/from-slug',
    );
  });

  it('returns null rather than guessing', () => {
    // Every one of these would otherwise navigate somewhere arbitrary, which is
    // worse than staying put: the reader at least still sees the feed.
    expect(targetFrom(undefined)).toBeNull();
    expect(targetFrom(null)).toBeNull();
    expect(targetFrom({})).toBeNull();
    expect(targetFrom({ slug: '' })).toBeNull();
    expect(targetFrom({ deepLink: 'https://example.invalid/article/x' })).toBeNull();
    expect(targetFrom({ deepLink: 'saar://article/' })).toBeNull();
    expect(targetFrom({ deepLink: 'saar://unknown-destination' })).toBeNull();
  });

  it('ignores a type with no destination', () => {
    // A digest carries a type and no target; it must not navigate anywhere.
    expect(targetFrom({ type: 'digest' })).toBeNull();
  });
});
