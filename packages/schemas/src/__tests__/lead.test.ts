import { describe, expect, it } from 'vitest';
import { canonicaliseUrl } from '../lead.js';

/**
 * Reducing a story to one address.
 *
 * This is what makes the unique index on `canonicalUrl` mean anything. Without
 * it the same article arrives from the feed, from a share and from a newsletter
 * wearing three different query strings, and an editor is offered it three
 * times.
 */

describe('canonicaliseUrl', () => {
  it('strips the tracking parameters that make one story look like several', () => {
    expect(
      canonicaliseUrl(
        'https://namunakhabar.example.invalid/news/123?utm_source=rss&utm_medium=feed&fbclid=xyz',
      ),
    ).toBe('https://namunakhabar.example.invalid/news/123');
  });

  it('keeps a query the article actually needs', () => {
    /*
     * Deliberately a fixed blocklist, not "strip everything". Older Nepali CMSs
     * address stories as ?id=1234, and dropping that produces a link that 404s
     * for the reader who taps it — which is the one thing we owe the publisher.
     */
    expect(canonicaliseUrl('https://old.example.invalid/read.php?id=1234')).toBe(
      'https://old.example.invalid/read.php?id=1234',
    );
  });

  it('drops the fragment, which is a position and not a story', () => {
    expect(canonicaliseUrl('https://x.example.invalid/a/story#comments')).toBe(
      'https://x.example.invalid/a/story',
    );
  });

  it('treats a trailing slash as the same page', () => {
    expect(canonicaliseUrl('https://x.example.invalid/a/story/')).toBe(
      canonicaliseUrl('https://x.example.invalid/a/story'),
    );
  });

  it('folds the host but never the path', () => {
    // Hosts are case-insensitive; paths are not, and folding them would merge
    // two genuinely different stories on a case-sensitive server.
    const folded = canonicaliseUrl('https://X.Example.Invalid/A/Story');
    expect(folded).toBe('https://x.example.invalid/A/Story');
  });

  it('collapses the variants of one story to a single address', () => {
    const variants = [
      'https://x.example.invalid/a/story',
      'https://x.example.invalid/a/story/',
      'https://x.example.invalid/a/story?utm_campaign=morning',
      'https://x.example.invalid/a/story#top',
      'https://X.example.invalid/a/story',
    ];
    expect(new Set(variants.map(canonicaliseUrl)).size).toBe(1);
  });

  it('refuses a scheme that has no business in an href', () => {
    /*
     * A lead's URL is put straight into an anchor in the triage list. A feed is
     * third-party input, so javascript: and data: are rejected at the boundary
     * rather than relied on to be harmless later.
     */
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://x.example.invalid/a',
    ]) {
      expect(canonicaliseUrl(bad)).toBeNull();
    }
  });

  it('returns null for anything that is not a URL', () => {
    for (const bad of ['', '   ', 'not a url', '/relative/path', '//protocol-relative']) {
      expect(canonicaliseUrl(bad)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace, which feeds are full of', () => {
    expect(canonicaliseUrl('\n  https://x.example.invalid/a  \n')).toBe(
      'https://x.example.invalid/a',
    );
  });

  it('accepts http as well as https', () => {
    // Plenty of Nepali publishers still serve plain http. Refusing to LEARN of
    // their story is different from refusing to link a reader to it, and that
    // second decision belongs at publish time.
    expect(canonicaliseUrl('http://x.example.invalid/a')).toBe('http://x.example.invalid/a');
  });
});
