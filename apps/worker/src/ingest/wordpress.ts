import { parseFeedDate, stripHtml, type FeedItem } from '@saar/shared';
import { bodyText, FeedFetchError, politeGet } from './politeGet.js';

/**
 * Reading a publisher's WordPress content API.
 *
 * ── Why, where the feed already exists ──────────────────────────────────────
 *
 * Most Nepali portals run WordPress, and WordPress serves its posts as JSON at
 * `/wp-json/wp/v2/posts`. Checked against Onlinekhabar on 4 October 2026: their
 * RSS carried no photographs and 84–375 characters of each story, while ONE
 * request to this API returned their twenty latest posts with the full text
 * (83–1,016 words) and the featured photograph on seventeen of them. It is the
 * publisher's own structured output — no page is read, nothing is guessed.
 *
 * Each post is mapped to the same FeedItem an RSS item becomes, so `toLead`,
 * the dedup index and everything downstream are unchanged.
 *
 * ── What is kept depends on the licence, not on what we were sent ────────────
 *
 * The full text arrives in every response. It is only kept when the publisher's
 * licence says `fullText`; otherwise the lead gets the excerpt, exactly what
 * their feed would have said. That decision is the caller's — see pollSources.
 */

/** Thirty posts is a fifteen-minute window for the busiest portal, with room. */
const PER_PAGE = 30;

/** A page of thirty full posts with their images' metadata is about a megabyte. */
const MAX_BYTES = 4 * 1024 * 1024;

const FIELDS = 'id,date_gmt,link,title,excerpt,content,_links,_embedded';

export function wordPressPostsUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.searchParams.set('per_page', String(PER_PAGE));
  /* Only the featured image is embedded. Bare `_embed` also pulls in authors
     and terms, several times the size, none of it used. */
  url.searchParams.set('_embed', 'wp:featuredmedia');
  url.searchParams.set('_fields', FIELDS);
  return url.toString();
}

/** The parts of a post we read. Everything is optional: it is their JSON. */
interface WpPost {
  id?: unknown;
  date_gmt?: unknown;
  link?: unknown;
  title?: { rendered?: unknown };
  excerpt?: { rendered?: unknown };
  content?: { rendered?: unknown };
  _embedded?: {
    'wp:featuredmedia'?: Array<{
      source_url?: unknown;
      media_type?: unknown;
      media_details?: { sizes?: Record<string, { source_url?: unknown }> };
    }>;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * The photograph to use.
 *
 * WordPress keeps several sizes. `large` (about 1024 wide) is preferred: well
 * above the 640 our cards need, and a fraction of the original upload, which on
 * some portals is a six-megabyte camera file.
 */
function featuredImage(post: WpPost): string | null {
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  if (!media) return null;
  if (media.media_type !== undefined && media.media_type !== 'image') return null;
  const candidate =
    str(media.media_details?.sizes?.large?.source_url) ??
    str(media.media_details?.sizes?.full?.source_url) ??
    str(media.source_url);
  if (candidate === null) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pure: one decoded API response to feed items. Exported for tests. */
export function postsToItems(json: unknown): FeedItem[] {
  if (!Array.isArray(json)) return [];
  const items: FeedItem[] = [];
  for (const raw of json as WpPost[]) {
    if (raw === null || typeof raw !== 'object') continue;
    const title = str(raw.title?.rendered);
    const link = str(raw.link);
    if (title === null || link === null) continue;

    const excerpt = str(raw.excerpt?.rendered);
    const content = str(raw.content?.rendered);
    const date = str(raw.date_gmt);

    items.push({
      title: stripHtml(title),
      link,
      summary: excerpt !== null ? stripHtml(excerpt) || null : null,
      content: content !== null ? stripHtml(content) || null : null,
      /* `date_gmt` is UTC with no zone marker; without the Z it would be read
         as local time and every story would be dated 5h45m out. */
      publishedAt: parseFeedDate(date !== null ? `${date}Z` : null),
      imageUrl: featuredImage(raw),
      guid: typeof raw.id === 'number' || typeof raw.id === 'string' ? String(raw.id) : null,
    });
  }
  return items;
}

export async function fetchWordPressPosts(
  apiUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FeedItem[]> {
  const res = await politeGet(wordPressPostsUrl(apiUrl), {
    accept: 'application/json',
    maxBytes: MAX_BYTES,
    ...(options.fetchImpl && { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });

  let json: unknown;
  try {
    json = JSON.parse(bodyText(res));
  } catch {
    throw new FeedFetchError('The API did not return JSON.', 'not_json');
  }
  if (!Array.isArray(json)) {
    /* WordPress answers a disabled or locked API with an object such as
       {"code":"rest_cannot_access"}. Named, so the publisher screen says why. */
    const code = (json as { code?: unknown } | null)?.code;
    throw new FeedFetchError(
      typeof code === 'string' ? `The API refused: ${code}.` : 'The API did not return a list of posts.',
      'not_json',
    );
  }
  return postsToItems(json);
}

/**
 * Whether a site serves the WordPress posts API, and where.
 *
 * Used by the publisher screen's "Detect" button. Tries the conventional path
 * on the site's own origin; a site that has moved or locked its API simply
 * reports not found, and the publisher stays on RSS.
 */
export async function detectWordPressApi(
  homepageUrl: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ found: true; apiUrl: string; sample: number } | { found: false; reason: string }> {
  let origin: string;
  try {
    origin = new URL(homepageUrl).origin;
  } catch {
    return { found: false, reason: 'The homepage address is not a valid URL.' };
  }
  const apiUrl = `${origin}/wp-json/wp/v2/posts`;
  try {
    const res = await politeGet(`${apiUrl}?per_page=3&_fields=id,link`, {
      accept: 'application/json',
      maxBytes: 256 * 1024,
      ...(options.fetchImpl && { fetchImpl: options.fetchImpl }),
    });
    const json: unknown = JSON.parse(bodyText(res));
    if (Array.isArray(json) && json.length > 0) return { found: true, apiUrl, sample: json.length };
    return { found: false, reason: 'The site answered, but not with a list of posts.' };
  } catch (e) {
    if (e instanceof FeedFetchError && e.status === 401) {
      return { found: false, reason: 'The site has a WordPress API, but it is locked.' };
    }
    if (e instanceof FeedFetchError && e.status === 404) {
      return { found: false, reason: 'This site does not serve the WordPress API.' };
    }
    return { found: false, reason: e instanceof Error ? e.message : 'The check failed.' };
  }
}
