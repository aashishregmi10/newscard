import { MAX_FEED_BYTES, parseFeed, type ParsedFeed } from '@saar/shared';
import { bodyText, FeedFetchError, politeGet } from './politeGet.js';

/**
 * Fetching one publisher's feed.
 *
 * ── We are a guest on somebody else's server ────────────────────────────────
 *
 * Every decision about HOW we ask lives in politeGet: we identify ourselves,
 * give up quickly, never follow a redirect chain anywhere interesting, and
 * refuse anything too large. What is particular to a feed is here: we send
 * conditional requests so a feed that has not changed costs them a 304 instead
 * of a document, and we name the most common way a feed is broken.
 */

export { FeedFetchError };

export interface FetchFeedResult {
  /** Null when the server said 304 — the feed has not changed since last time. */
  feed: ParsedFeed | null;
  notModified: boolean;
  /** Hand these back on the next poll so the publisher can answer 304. */
  etag: string | null;
  lastModified: string | null;
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
  const res = await politeGet(url, {
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
    maxBytes: MAX_FEED_BYTES,
    etag: options.etag ?? null,
    lastModified: options.lastModified ?? null,
    ...(options.fetchImpl && { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });

  if (res.status === 304) {
    return {
      feed: null,
      notModified: true,
      etag: options.etag ?? null,
      lastModified: options.lastModified ?? null,
    };
  }

  const body = bodyText(res);

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
