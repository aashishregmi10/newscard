import { describe, expect, it } from 'vitest';
import { readArticleHtml, MAX_ARTICLE_CHARS } from '../ingest/enrich.js';
import { politeGet, FeedFetchError } from '../ingest/politeGet.js';

/**
 * Reading a story's own page.
 *
 * Synthetic pages — invented text on example.invalid — built the way a news
 * site actually is: the story wrapped in navigation, a sidebar of other
 * headlines, and a footer, which is what the reader has to see past.
 */

const PARAGRAPH =
  'नमुना नगरपालिकाले आज नयाँ खानेपानी आयोजनाको काम सुरु गरेको छ। आयोजना दुई वर्षमा सम्पन्न हुने र दश हजार घरधुरीले लाभ पाउने नगरपालिकाले जनाएको छ।';

function page(head: string, body = PARAGRAPH.repeat(6)): string {
  return `<!doctype html><html><head><title>नमुना</title>${head}</head><body>
    <nav><a href="/">गृहपृष्ठ</a><a href="/politics">राजनीति</a><a href="/sports">खेलकुद</a></nav>
    <main><article><h1>नमुना शीर्षक</h1>
      <p>${body}</p><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p>
    </article></main>
    <aside><ul><li><a href="/a">अर्को समाचार एक</a></li><li><a href="/b">अर्को समाचार दुई</a></li></ul></aside>
    <footer>© नमुना खबर</footer>
  </body></html>`;
}

describe('readArticleHtml', () => {
  it('takes the photo the publisher chose for sharing', () => {
    const out = readArticleHtml(
      page('<meta property="og:image" content="https://namunakhabar.example.invalid/share.jpg">'),
      'https://namunakhabar.example.invalid/news/1',
    );
    expect(out.imageUrl).toBe('https://namunakhabar.example.invalid/share.jpg');
  });

  it('resolves a relative photo address against the page', () => {
    const out = readArticleHtml(
      page('<meta name="twitter:image" content="/img/share.jpg">'),
      'https://namunakhabar.example.invalid/news/1',
    );
    expect(out.imageUrl).toBe('https://namunakhabar.example.invalid/img/share.jpg');
  });

  it('refuses a photo address that is not http(s)', () => {
    const out = readArticleHtml(
      page('<meta property="og:image" content="data:image/png;base64,AAAA">'),
      'https://namunakhabar.example.invalid/news/1',
    );
    expect(out.imageUrl).toBeNull();
  });

  it('finds the story and leaves the menus and other headlines behind', () => {
    const out = readArticleHtml(page(''), 'https://namunakhabar.example.invalid/news/1');
    expect(out.text).toContain('खानेपानी आयोजनाको');
    expect(out.text).not.toContain('अर्को समाचार एक');
    expect(out.text).not.toContain('गृहपृष्ठ');
  });

  it('caps the text at what a lead may hold', () => {
    const out = readArticleHtml(
      page('', PARAGRAPH.repeat(400)),
      'https://namunakhabar.example.invalid/news/1',
    );
    expect(out.text!.length).toBeLessThanOrEqual(MAX_ARTICLE_CHARS);
  });

  it('gives nulls, not an error, for a page with nothing in it', () => {
    const out = readArticleHtml('<html><body></body></html>', 'https://x.example.invalid/');
    expect(out).toEqual({ imageUrl: null, text: null });
  });
});

describe('politeGet', () => {
  it('refuses a body larger than the caller allows, even without a declared length', async () => {
    const big = (async () => new Response('x'.repeat(2048))) as unknown as typeof fetch;
    const err = await politeGet('https://x.example.invalid/', {
      accept: '*/*',
      maxBytes: 1024,
      fetchImpl: big,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedFetchError);
    expect((err as FeedFetchError).reason).toBe('too_large');
  });

  it('follows a redirect and reports where the body came from', async () => {
    const hops = (async (url: string) =>
      url.endsWith('/old')
        ? new Response(null, { status: 301, headers: { location: '/new' } })
        : new Response('ok')) as unknown as typeof fetch;
    const res = await politeGet('https://x.example.invalid/old', {
      accept: '*/*',
      maxBytes: 1024,
      fetchImpl: hops,
    });
    expect(res.finalUrl).toBe('https://x.example.invalid/new');
  });

  it('will not follow a redirect to another scheme', async () => {
    const evil = (async () =>
      new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } })) as unknown as typeof fetch;
    await expect(
      politeGet('https://x.example.invalid/', { accept: '*/*', maxBytes: 1024, fetchImpl: evil }),
    ).rejects.toThrow(/file:/);
  });
});
