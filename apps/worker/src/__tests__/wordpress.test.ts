import { describe, expect, it } from 'vitest';
import { fetchWordPressPosts, postsToItems, wordPressPostsUrl } from '../ingest/wordpress.js';
import { FeedFetchError } from '../ingest/politeGet.js';

/**
 * Reading a WordPress posts API.
 *
 * The fixture is synthetic — an invented portal on example.invalid with
 * invented text — but shaped exactly like what WordPress returns for
 * `?_embed=wp:featuredmedia`, including the HTML entities and the date that
 * carries no zone.
 */

const POST = {
  id: 2031611,
  date_gmt: '2026-10-04T02:32:01',
  link: 'https://namunakhabar.example.invalid/2026/10/2031611/sample-story',
  title: { rendered: 'नमुना &#8216;शीर्षक&#8217; यहाँ' },
  excerpt: { rendered: '<p>नमुना सारांश। &hellip;</p>' },
  content: {
    rendered:
      '<p>पहिलो अनुच्छेद।</p><script>track()</script><p>दोस्रो <strong>अनुच्छेद</strong>।</p>',
  },
  _embedded: {
    'wp:featuredmedia': [
      {
        media_type: 'image',
        source_url: 'https://namunakhabar.example.invalid/uploads/full.jpg',
        media_details: {
          sizes: {
            large: { source_url: 'https://namunakhabar.example.invalid/uploads/large.jpg' },
            full: { source_url: 'https://namunakhabar.example.invalid/uploads/full.jpg' },
          },
        },
      },
    ],
  },
};

describe('postsToItems', () => {
  it('maps a post to the feed item the rest of the collector already reads', () => {
    const [item] = postsToItems([POST]);
    expect(item).toEqual({
      title: 'नमुना ‘शीर्षक’ यहाँ',
      link: POST.link,
      summary: expect.stringContaining('नमुना सारांश।'),
      content: 'पहिलो अनुच्छेद। दोस्रो अनुच्छेद।',
      publishedAt: new Date('2026-10-04T02:32:01Z'),
      imageUrl: 'https://namunakhabar.example.invalid/uploads/large.jpg',
      guid: '2031611',
    });
  });

  it('reads date_gmt as UTC, not as local time', () => {
    const [item] = postsToItems([POST]);
    expect(item!.publishedAt!.toISOString()).toBe('2026-10-04T02:32:01.000Z');
  });

  it('falls back to the original upload when there is no large size', () => {
    const post = {
      ...POST,
      _embedded: { 'wp:featuredmedia': [{ source_url: 'https://namunakhabar.example.invalid/x.jpg' }] },
    };
    expect(postsToItems([post])[0]!.imageUrl).toBe('https://namunakhabar.example.invalid/x.jpg');
  });

  it('has no photo when the featured media is not an image, or is missing', () => {
    const video = {
      ...POST,
      _embedded: { 'wp:featuredmedia': [{ media_type: 'file', source_url: 'https://x.invalid/a.mp4' }] },
    };
    const bare = { ...POST, _embedded: undefined };
    expect(postsToItems([video])[0]!.imageUrl).toBeNull();
    expect(postsToItems([bare])[0]!.imageUrl).toBeNull();
  });

  it('refuses a photo address that is not http(s)', () => {
    const post = {
      ...POST,
      _embedded: { 'wp:featuredmedia': [{ source_url: 'javascript:alert(1)' }] },
    };
    expect(postsToItems([post])[0]!.imageUrl).toBeNull();
  });

  it('skips a post with no title or no link, and anything that is not a post', () => {
    expect(postsToItems([{ ...POST, title: { rendered: '' } }])).toEqual([]);
    expect(postsToItems([{ ...POST, link: null }])).toEqual([]);
    expect(postsToItems([null, 7, 'x'])).toEqual([]);
    expect(postsToItems({ code: 'rest_no_route' })).toEqual([]);
  });
});

describe('wordPressPostsUrl', () => {
  it('asks for the featured image only, and only the fields we read', () => {
    const url = new URL(wordPressPostsUrl('https://namunakhabar.example.invalid/wp-json/wp/v2/posts'));
    expect(url.searchParams.get('_embed')).toBe('wp:featuredmedia');
    expect(url.searchParams.get('_fields')).toContain('_embedded');
    expect(Number(url.searchParams.get('per_page'))).toBeGreaterThan(0);
  });
});

describe('fetchWordPressPosts', () => {
  const json = (body: unknown, status = 200) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

  it('returns the posts as feed items', async () => {
    const items = await fetchWordPressPosts('https://namunakhabar.example.invalid/wp-json/wp/v2/posts', {
      fetchImpl: json([POST]),
    });
    expect(items).toHaveLength(1);
  });

  it('names a locked API rather than reporting an empty publisher', async () => {
    await expect(
      fetchWordPressPosts('https://namunakhabar.example.invalid/wp-json/wp/v2/posts', {
        fetchImpl: json({ code: 'rest_cannot_access' }),
      }),
    ).rejects.toThrow(/rest_cannot_access/);
  });

  it('reports an HTTP failure with its status', async () => {
    const err = await fetchWordPressPosts('https://namunakhabar.example.invalid/wp-json/wp/v2/posts', {
      fetchImpl: json({ code: 'forbidden' }, 401),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedFetchError);
    expect((err as FeedFetchError).status).toBe(401);
  });
});
