/**
 * One GET against a publisher's server, as a guest.
 *
 * Every request the collector makes — their feed, their content API, a story
 * page, a photograph — goes through here, so the rules below hold for all of
 * them rather than for whichever one was written most carefully:
 *
 *   - we say who we are, so a publisher reading their access log can tell;
 *   - we give up quickly;
 *   - we follow at most three redirects, and never to a non-http(s) scheme;
 *   - we refuse a response larger than the caller said it could be, checking
 *     the declared length before reading and the real length after, because a
 *     server may omit Content-Length or lie about it.
 *
 * A collector that hammers a Nepali publisher's origin is a collector that ends
 * the licensing conversation before it starts.
 */

/** Eight seconds, matching the mobile client's own network budget (Ch. 2.6). */
export const DEFAULT_TIMEOUT_MS = 8_000;

/** Enough hops for http→https and www→apex, not enough to be a redirect maze. */
const MAX_REDIRECTS = 3;

/**
 * Who we are.
 *
 * A publisher reading their access log should be able to tell who we are and
 * how to reach us without guessing. An anonymous crawler is the kind that gets
 * blocked at the CDN, and rightly.
 */
export const USER_AGENT = 'SAAR-NewsCollector/1.0 (+https://saar.np/about/collector)';

export class FeedFetchError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'network'
      | 'timeout'
      | 'http_status'
      | 'too_large'
      | 'not_xml'
      | 'not_json'
      | 'not_image'
      | 'too_many_redirects',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

export interface PoliteGetOptions {
  accept: string;
  /** Refused above this, declared or actual. */
  maxBytes: number;
  etag?: string | null;
  lastModified?: string | null;
  /** Injected in tests. Defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PoliteGetResult {
  /** 304 when the server said nothing has changed; the body is then empty. */
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  /** The address the body actually came from, after redirects. */
  finalUrl: string;
}

export async function politeGet(url: string, options: PoliteGetOptions): Promise<PoliteGetResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: options.accept,
    'Accept-Encoding': 'gzip, deflate',
  };
  /* Conditional request. A publisher who supports these serves us a 304 and a
     few bytes instead of the whole document, every poll, forever. */
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let current = url;
  try {
    res = await doFetch(url, {
      headers,
      signal: controller.signal,
      /* Handled manually so the hop count is ours and a redirect to a
         non-http(s) scheme cannot be followed. */
      redirect: 'manual',
    });

    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.status !== 304) {
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

    if (res.status === 304) {
      return { status: 304, headers: res.headers, bytes: new Uint8Array(), finalUrl: current };
    }
    if (!res.ok) {
      throw new FeedFetchError(`The server answered ${res.status}.`, 'http_status', res.status);
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > options.maxBytes) {
      throw new FeedFetchError(`The response declares ${declared} bytes.`, 'too_large');
    }

    /* Read inside the timer: a server that sends headers promptly and then
       trickles the body must not hold the collector past its budget. */
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > options.maxBytes) {
      throw new FeedFetchError(`The response is ${bytes.byteLength} bytes.`, 'too_large');
    }

    return { status: res.status, headers: res.headers, bytes, finalUrl: current };
  } catch (e) {
    if (e instanceof FeedFetchError) throw e;
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') {
      throw new FeedFetchError(`No response within ${timeoutMs}ms.`, 'timeout');
    }
    throw new FeedFetchError(e instanceof Error ? e.message : 'The request failed.', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** The body as text, decoded as UTF-8 — what every Nepali portal serves. */
export function bodyText(result: PoliteGetResult): string {
  return new TextDecoder('utf-8').decode(result.bytes);
}
