import { describe, expect, it } from 'vitest';
import { parseFeed, parseFeedDate, stripHtml } from '../feedParse.js';

/**
 * Reading somebody else's feed.
 *
 * Every case here is a shape a real publisher actually serves. The parser is
 * deliberately lenient — a stray ampersand from a Nepali CMS must not cost us
 * the day's stories — so most of these assert that malformed input still yields
 * usable leads rather than an exception.
 */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>नमुना खबर</title>
    <link>https://namunakhabar.example.invalid</link>
    <item>
      <title>वर्षापछि सडक मर्मतको काम तीव्र</title>
      <link>https://namunakhabar.example.invalid/news/123</link>
      <description><![CDATA[<p>वर्षा थामिएपछि सहरका मुख्य सडकमा &amp; मर्मत सुरु।</p>]]></description>
      <pubDate>Mon, 22 Sep 2026 04:30:00 +0545</pubDate>
      <guid isPermaLink="false">nk-123</guid>
      <media:content url="https://namunakhabar.example.invalid/img/123.jpg" />
    </item>
    <item>
      <title>Second story</title>
      <link>https://namunakhabar.example.invalid/news/124</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sample Post</title>
  <link rel="self" href="https://samplepost.example.invalid/feed.xml"/>
  <entry>
    <title>Trekking routes reopen</title>
    <link rel="alternate" href="https://samplepost.example.invalid/a/trekking"/>
    <summary>Routes above 3,000m reopen for the autumn season.</summary>
    <published>2026-09-22T09:00:00Z</published>
    <id>tag:samplepost,2026:trekking</id>
  </entry>
</feed>`;

describe('parseFeed — RSS', () => {
  it('reads the fields a lead needs', () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe('नमुना खबर');
    expect(feed.items).toHaveLength(2);

    const first = feed.items[0]!;
    expect(first.title).toBe('वर्षापछि सडक मर्मतको काम तीव्र');
    expect(first.link).toBe('https://namunakhabar.example.invalid/news/123');
    expect(first.guid).toBe('nk-123');
    expect(first.imageUrl).toBe('https://namunakhabar.example.invalid/img/123.jpg');
  });

  it('unwraps CDATA, strips the markup and decodes entities', () => {
    // The extract is shown to an editor as text, so it must arrive as text.
    const summary = parseFeed(RSS).items[0]!.summary;
    expect(summary).toBe('वर्षा थामिएपछि सहरका मुख्य सडकमा & मर्मत सुरु।');
    expect(summary).not.toContain('<p>');
    expect(summary).not.toContain('&amp;');
  });

  it('reads a Nepal-time offset correctly', () => {
    // +0545 is the one timezone offset this product cannot get wrong.
    const at = parseFeed(RSS).items[0]!.publishedAt;
    expect(at?.toISOString()).toBe('2026-09-21T22:45:00.000Z');
  });

  it('keeps an item that has only a headline and a link', () => {
    // Most feeds omit something. Only title and link are load-bearing.
    const second = parseFeed(RSS).items[1]!;
    expect(second.title).toBe('Second story');
    expect(second.summary).toBeNull();
    expect(second.publishedAt).toBeNull();
    expect(second.imageUrl).toBeNull();
  });

  it('does not let the first item supply the feed title', () => {
    expect(parseFeed(RSS).title).not.toBe('वर्षापछि सडक मर्मतको काम तीव्र');
  });
});

describe('parseFeed — Atom', () => {
  it('takes the link from href, not the element text', () => {
    const item = parseFeed(ATOM).items[0]!;
    expect(item.link).toBe('https://samplepost.example.invalid/a/trekking');
  });

  it('never mistakes rel="self" for the story', () => {
    /*
     * The failure this prevents is specific and silent: every lead ends up
     * pointing at the feed URL, which looks exactly like the collector working
     * until someone taps one.
     */
    const feed = parseFeed(ATOM);
    for (const item of feed.items) {
      expect(item.link).not.toContain('feed.xml');
    }
  });

  it('reads summary, id and an RFC-3339 date', () => {
    const item = parseFeed(ATOM).items[0]!;
    expect(item.summary).toContain('3,000m');
    expect(item.guid).toBe('tag:samplepost,2026:trekking');
    expect(item.publishedAt?.toISOString()).toBe('2026-09-22T09:00:00.000Z');
  });
});

describe('parseFeed — what the wild actually serves', () => {
  it('returns nothing rather than throwing on an HTML error page', () => {
    // A publisher serving their 404 page instead of the feed happens weekly.
    const html = '<!DOCTYPE html><html><body><h1>503 Service Unavailable</h1></body></html>';
    expect(() => parseFeed(html)).not.toThrow();
    expect(parseFeed(html).items).toEqual([]);
  });

  it('survives empty, whitespace and truncated documents', () => {
    for (const bad of ['', '   ', '<?xml version="1.0"?>', '<rss><channel><item><title>cut']) {
      expect(() => parseFeed(bad)).not.toThrow();
      expect(parseFeed(bad).items).toEqual([]);
    }
  });

  it('drops an item with no link or no headline rather than emitting a dead lead', () => {
    const feed = parseFeed(`<rss><channel>
      <item><title>No link here</title></item>
      <item><link>https://x.example.invalid/a</link></item>
      <item><title>Good</title><link>https://x.example.invalid/b</link></item>
    </channel></rss>`);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]!.title).toBe('Good');
  });

  it('handles namespaced element names', () => {
    const feed = parseFeed(`<rdf:RDF><item>
      <dc:title>Prefixed</dc:title><link>https://x.example.invalid/c</link>
    </item></rdf:RDF>`);
    expect(feed.items[0]!.title).toBe('Prefixed');
  });

  it('ignores a podcast enclosure but takes an image one', () => {
    // <enclosure> is also how audio is attached; a 40MB mp3 is not a thumbnail.
    const audio = parseFeed(`<rss><channel><item><title>T</title>
      <link>https://x.example.invalid/d</link>
      <enclosure url="https://x.example.invalid/ep.mp3" type="audio/mpeg"/>
    </item></channel></rss>`);
    expect(audio.items[0]!.imageUrl).toBeNull();

    const image = parseFeed(`<rss><channel><item><title>T</title>
      <link>https://x.example.invalid/d</link>
      <enclosure url="https://x.example.invalid/p.jpg" type="image/jpeg"/>
    </item></channel></rss>`);
    expect(image.items[0]!.imageUrl).toBe('https://x.example.invalid/p.jpg');
  });

  it('caps how many items one feed can contribute', () => {
    const many = Array.from(
      { length: 400 },
      (_, i) => `<item><title>T${i}</title><link>https://x.example.invalid/${i}</link></item>`,
    ).join('');
    expect(parseFeed(`<rss><channel>${many}</channel></rss>`).items.length).toBeLessThanOrEqual(100);
  });
});

describe('stripHtml', () => {
  it('removes markup and collapses whitespace', () => {
    expect(stripHtml('<p>One</p>\n\n<p>Two</p>')).toBe('One Two');
    expect(stripHtml('a<br/>b')).toBe('a b');
  });

  it('removes script and style content, not just their tags', () => {
    // Dropping the tags alone would leave the code in the extract.
    expect(stripHtml('<script>alert(1)</script>Hello')).toBe('Hello');
    expect(stripHtml('<style>.a{color:red}</style>Hello')).toBe('Hello');
  });

  it('decodes the ampersand last so a double-encoded tag stays inert', () => {
    // `&amp;lt;` must become `&lt;`, not `<` — otherwise stripping can be
    // escaped by encoding the payload twice.
    expect(stripHtml('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('decodes numeric references and ignores impossible ones', () => {
    expect(stripHtml('&#78;&#x65;pal')).toBe('Nepal');
    expect(() => stripHtml('&#xD800;&#999999999;')).not.toThrow();
  });
});

describe('parseFeedDate', () => {
  it('reads both feed date formats', () => {
    expect(parseFeedDate('Mon, 22 Sep 2026 04:30:00 +0545')?.toISOString()).toBe(
      '2026-09-21T22:45:00.000Z',
    );
    expect(parseFeedDate('2026-09-22T09:00:00Z')?.toISOString()).toBe('2026-09-22T09:00:00.000Z');
  });

  it('returns null rather than an Invalid Date', () => {
    // An Invalid Date propagates silently into a sort and ruins the order.
    for (const bad of [null, '', '   ', 'not a date', 'yesterday']) {
      expect(parseFeedDate(bad)).toBeNull();
    }
  });

  it('rejects a date from a broken clock at the other end', () => {
    expect(parseFeedDate('Thu, 01 Jan 1970 00:00:00 GMT')).toBeNull();
    expect(parseFeedDate('3000-01-01T00:00:00Z')).toBeNull();
  });
});
