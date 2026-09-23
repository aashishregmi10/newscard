import { MAX_FEED_BYTES, parseFeed, type ParsedFeed } from '@saar/shared';

/**
 * Fetching one publisher's feed.
 *
 * ── We are a guest on somebody else's server ────────────────────────────────
 *
 * Every decision in this file follows from that. We identify ourselves, we give
 * up quickly, we send conditional requests so a feed that has not changed costs
 * them a 304 instead of a document, and we never follow a redirect chain
 * anywhere interesting. A collector that hammers a Nepali publisher's origin is
 * a collector that ends the licensing conversation before it starts.
 */

/** Eight seconds, matching the mobile client's own network budget (Ch. 2.6). */
const TIMEOUT_MS = 8_000;

/** Enough hops for http→https and www→apex, not enough to be a redirect maze. */
const MAX_REDIRECTS = 3;

/**
 * Who we are.
 *
 * A publisher reading their access log should be able to tell who we are and
 * how to reach us without guessing. An anonymous crawler is the kind that gets
 * blocked at the CDN, and rightly.
 */
const USER_AGENT = 'SAAR-NewsCollector/1.0 (+https://saar.np/about/collector)';

export interface FetchFeedResult {
  /** Null when the server said 304 — the feed has not changed since last time. */
  feed: ParsedFeed | null;
  notModified: boolean;
  /** Hand these back on the next poll so the publisher can answer 304. */
  etag: string | null;
  lastModified: string | null;
}

export class FeedFetchError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'network'
      | 'timeout'
      | 'http_status'
      | 'too_large'
      | 'not_xml'
      | 'too_many_redirects',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

export interface FetchFeedOptions {
  etag?: string | null;
  lastModified?: string | null;
  /** Injected in tests. Defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function fetchFeed(
  url: string,
  options: FetchFeedOptions = {},
): Promise<FetchFeedResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
    'Accept-Encoding': 'gzip, deflate',
  };
  /* Conditional request. A publisher who supports these serves us a 304 and a
     few bytes instead of their whole feed, every fifteen minutes, forever. */
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await doFetch(url, {
      headers,
      signal: controller.signal,
      /* Handled manually so the hop count is ours and a redirect to a
         non-http(s) scheme cannot be followed. */
      redirect: 'manual',
    });

    let hops = 0;
    let current = url;
    while (res.status >= 300 && res.status < 400) {
      if (++hops > MAX_REDIRECTS) {
        throw new FeedFetchError(`More than ${MAX_REDIRECTS} redirects.`, 'too_many_redirects');
      }
      const location = res.headers.get('location');
      if (location === null) break;

      const next = new URL(location, current);
      if (next.protocol !== 'https:' && next.protocol !== 'http:') {
        throw new FeedFetchError(`Redirected to ${next.protocol}`, 'network');
      }
      current = next.toString();
      res = await doFetch(current, { headers, signal: controller.signal, redirect: 'manual' });
    }
  } catch (e) {
    if (e instanceof FeedFetchError) throw e;
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') {
      throw new FeedFetchError(`No response within ${timeoutMs}ms.`, 'timeout');
    }
    throw new FeedFetchError(
      e instanceof Error ? e.message : 'The request failed.',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 304) {
    return { feed: null, notModified: true, etag: options.etag ?? null, lastModified: options.lastModified ?? null };
  }

  if (!res.ok) {
    throw new FeedFetchError(`The server answered ${res.status}.`, 'http_status', res.status);
  }

  /*
   * Size is checked twice: the declared length first, because refusing before
   * reading is cheaper for both of us, and then the actual body — a server may
   * omit Content-Length or lie about it.
   */
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_FEED_BYTES) {
    throw new FeedFetchError(`Feed declares ${declared} bytes.`, 'too_large');
  }

  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) {
    throw new FeedFetchError(`Feed is ${body.length} bytes.`, 'too_large');
  }

  /*
   * A publisher serving an HTML error page with a 200 is common enough to be
   * worth naming. Without this the parse returns zero items and the source
   * looks merely quiet rather than broken.
   */
  if (/^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body)) {
    throw new FeedFetchError('The server returned an HTML page, not a feed.', 'not_xml');
  }

  return {
    feed: parseFeed(body),
    notModified: false,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}
