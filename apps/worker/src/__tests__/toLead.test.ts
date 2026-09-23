import { describe, expect, it } from 'vitest';
import type { FeedItem } from '@saar/shared';
import { detectLanguage, fingerprintOf, MAX_LEAD_AGE_DAYS, toLead, type SourceContext } from '../ingest/toLead.js';

/**
 * What becomes a lead, and what does not.
 *
 * A collector's failure mode is not crashing. It is quietly offering an editor
 * forty things that are not stories — section labels, sponsored links, and last
 * month's archive — until they stop reading the queue. Every rejection rule
 * below exists because of one of those.
 */

const NOW = new Date('2026-09-22T06:00:00Z');

const SOURCE: SourceContext = {
  id: '65f1c2a4b8e9d0123456789a',
  slug: 'namuna-khabar',
  displayName: 'नमुना खबर',
  language: 'ne',
  homepageUrl: 'https://namunakhabar.example.invalid',
};

function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    title: 'वर्षापछि सडक मर्मतको काम तीव्र',
    link: 'https://namunakhabar.example.invalid/news/123',
    summary: 'वर्षा थामिएपछि मर्मत सुरु।',
    publishedAt: new Date('2026-09-22T04:00:00Z'),
    imageUrl: 'https://namunakhabar.example.invalid/img/1.jpg',
    guid: 'nk-123',
    ...over,
  };
}

describe('toLead — accepting', () => {
  it('carries what the editor needs to triage', () => {
    const out = toLead(item(), SOURCE, NOW);
    if (!out.ok) throw new Error(`rejected: ${out.reason}`);

    expect(out.lead.headline).toBe('वर्षापछि सडक मर्मतको काम तीव्र');
    expect(out.lead.canonicalUrl).toBe('https://namunakhabar.example.invalid/news/123');
    expect(out.lead.sourceSlug).toBe('namuna-khabar');
    expect(out.lead.language).toBe('ne');
    expect(out.lead.status).toBe('new');
  });

  it('starts unpromoted and unclustered', () => {
    const out = toLead(item(), SOURCE, NOW);
    if (!out.ok) throw new Error('rejected');
    expect(out.lead.promotedArticleId).toBeNull();
    expect(out.lead.clusterKey).toBeNull();
  });

  it('sets an expiry from the server clock it was handed', () => {
    // Never a client clock — that is the flaw the engineering review found in
    // the other three TTLs.
    const out = toLead(item(), SOURCE, NOW);
    if (!out.ok) throw new Error('rejected');
    expect(out.lead.purgeAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(out.lead.fetchedAt).toEqual(NOW);
  });

  it('keeps an undated item rather than dropping it', () => {
    // Plenty of feeds omit the date entirely. The story is still real.
    const out = toLead(item({ publishedAt: null }), SOURCE, NOW);
    expect(out.ok).toBe(true);
  });

  it('canonicalises the link on the way in', () => {
    const out = toLead(
      item({ link: 'https://namunakhabar.example.invalid/news/123/?utm_source=rss#top' }),
      SOURCE,
      NOW,
    );
    if (!out.ok) throw new Error('rejected');
    expect(out.lead.canonicalUrl).toBe('https://namunakhabar.example.invalid/news/123');
  });

  it('truncates rather than rejecting an over-long headline or extract', () => {
    const out = toLead(
      item({ title: 'क'.repeat(500), summary: 'x'.repeat(5000) }),
      SOURCE,
      NOW,
    );
    if (!out.ok) throw new Error('rejected');
    expect(out.lead.headline.length).toBe(300);
    expect(out.lead.feedExtract?.length).toBe(2000);
  });
});

describe('toLead — rejecting', () => {
  it('drops a headline too short to be a story', () => {
    // Feeds carry section labels as items: "Sports", "ताजा".
    expect(toLead(item({ title: 'Sports' }), SOURCE, NOW)).toEqual({
      ok: false,
      reason: 'headline_too_short',
    });
    expect(toLead(item({ title: '   ' }), SOURCE, NOW)).toEqual({
      ok: false,
      reason: 'no_headline',
    });
  });

  it('drops a link that is not a usable URL', () => {
    for (const link of ['javascript:alert(1)', 'not a url', '', '/relative']) {
      expect(toLead(item({ link }), SOURCE, NOW)).toEqual({ ok: false, reason: 'bad_url' });
    }
  });

  it('drops an item that points away from the publisher', () => {
    /*
     * The important one. Feeds carry sponsored items and syndicated partner
     * content pointing elsewhere; attributing one of those to this publisher
     * would be an attribution error in a product whose whole standing rests on
     * attribution being right.
     */
    expect(toLead(item({ link: 'https://advertiser.example.invalid/offer' }), SOURCE, NOW)).toEqual({
      ok: false,
      reason: 'off_host',
    });
  });

  it('accepts a subdomain of the same publisher, in either direction', () => {
    // english.x and www.x are one newspaper, and the homepage may be recorded
    // as either the apex or the www host.
    expect(
      toLead(item({ link: 'https://english.namunakhabar.example.invalid/news/9' }), SOURCE, NOW).ok,
    ).toBe(true);
    expect(
      toLead(item({ link: 'https://www.namunakhabar.example.invalid/news/9' }), SOURCE, NOW).ok,
    ).toBe(true);
    expect(
      toLead(item({ link: 'https://namunakhabar.example.invalid/news/9' }), {
        ...SOURCE,
        homepageUrl: 'https://www.namunakhabar.example.invalid',
      }, NOW).ok,
    ).toBe(true);
  });

  it('does not treat two .com.np publishers as the same one', () => {
    /*
     * The bug a first implementation had. Comparing the last two labels makes
     * `.com.np` — the standard Nepali commercial domain — look like the
     * registered domain, so every Nepali site becomes the same publisher and
     * the sponsored-link check waves them all through.
     */
    const np: SourceContext = { ...SOURCE, homepageUrl: 'https://kantipur.com.np' };
    expect(toLead(item({ link: 'https://someadvertiser.com.np/offer' }), np, NOW)).toEqual({
      ok: false,
      reason: 'off_host',
    });
    expect(toLead(item({ link: 'https://english.kantipur.com.np/news/9' }), np, NOW).ok).toBe(true);
  });

  it('drops the archive a first poll would otherwise import', () => {
    /*
     * Without this, adding a publisher imports everything their feed reaches
     * back to as "new" and buries the editor on day one.
     */
    const old = new Date(NOW.getTime() - (MAX_LEAD_AGE_DAYS + 1) * 86_400_000);
    expect(toLead(item({ publishedAt: old }), SOURCE, NOW)).toEqual({
      ok: false,
      reason: 'too_old',
    });
  });

  it('keeps an item dated slightly in the future', () => {
    // A publisher's clock running ahead is not a reason to lose their story.
    const soon = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(toLead(item({ publishedAt: soon }), SOURCE, NOW).ok).toBe(true);
  });
});

describe('detectLanguage', () => {
  it('files an English story from a Nepali feed in English', () => {
    /*
     * A bilingual publisher puts English pieces in a Nepali feed constantly.
     * Unlike an ARTICLE — where Ch. 4.6 forbids overwriting the declared
     * language and asks for a human-reviewed flag — a lead has no reviewer yet,
     * so filing it in the wrong queue is a triage error, not a legal one.
     */
    expect(detectLanguage('Trekking routes reopen for the autumn season', 'ne')).toBe('en');
  });

  it('keeps Devanagari as Nepali', () => {
    expect(detectLanguage('वर्षापछि सडक मर्मतको काम तीव्र', 'ne')).toBe('ne');
    expect(detectLanguage('वर्षापछि सडक मर्मतको काम तीव्र', 'en')).toBe('ne');
  });

  it('treats a mostly-Devanagari headline with a Latin brand name as Nepali', () => {
    expect(detectLanguage('नेपाल एयरलाइन्सको Boeing 757 मर्मत सम्पन्न', 'ne')).toBe('ne');
  });
});

describe('fingerprintOf', () => {
  it('is stable for the same story', () => {
    const a = fingerprintOf('वर्षापछि सडक मर्मत', 'https://x.example.invalid/a');
    const b = fingerprintOf('वर्षापछि सडक मर्मत', 'https://x.example.invalid/a');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('matches a story re-issued under a new URL by the same publisher', () => {
    // What the unique index on canonicalUrl cannot catch: most Nepali CMSs
    // mint a new URL when a piece is corrected.
    const original = fingerprintOf('वर्षापछि सडक मर्मत', 'https://x.example.invalid/news/123');
    const reissued = fingerprintOf('वर्षापछि सडक मर्मत', 'https://x.example.invalid/news/1231');
    expect(original).toBe(reissued);
  });

  it('ignores the punctuation and joiners that make one headline look like two', () => {
    // normaliseForCompare strips the danda and zero-width joiners, which two
    // CMSs will disagree about for the same sentence.
    const withDanda = fingerprintOf('सडक मर्मत सुरु।', 'https://x.example.invalid/a');
    const without = fingerprintOf('सडक मर्मत सुरु', 'https://x.example.invalid/a');
    expect(withDanda).toBe(without);
  });

  it('separates the same headline from two different publishers', () => {
    // Wire copy runs verbatim across outlets. Those are separate leads that
    // CLUSTER; they are not duplicates of each other.
    const a = fingerprintOf('समान शीर्षक', 'https://one.example.invalid/a');
    const b = fingerprintOf('समान शीर्षक', 'https://two.example.invalid/a');
    expect(a).not.toBe(b);
  });
});
