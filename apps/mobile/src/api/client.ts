/**
 * Feed API client.
 *
 * Failure handling is deliberately explicit: on a metered, intermittent
 * connection the interesting cases are "slow", "offline" and "server said no",
 * and they need different treatment in the UI (Ch. 2.6).
 */

import Constants from 'expo-constants';

/**
 * Where the API lives.
 *
 * A hardcoded LAN address is a trap: the dev machine's IP changes whenever the
 * router hands out a new lease, and the symptom is an app that bundles perfectly
 * and then shows "could not load stories" with no clue why.
 *
 * So this derives the host from the Expo dev server the app was loaded from —
 * whatever address reached Metro can reach the API. Explicit override with
 * EXPO_PUBLIC_API_URL; falls back to localhost for simulators.
 */
function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  // e.g. "192.168.1.188:8081" — the host Expo Go connected to.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${API_PORT}`;

  return `http://localhost:${API_PORT}`;
}

const API_PORT = 3000;
export const API_BASE = resolveApiBase();

/**
 * Image URLs are stored relative in development ("/media/…") so they survive an
 * IP change, and absolute in production where they point at a real CDN.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface CardImage {
  credit: string;
  blurHash: string | null;
  width: number | null;
  height: number | null;
  urls: { sm: string | null; md: string | null; lg: string | null };
}

export interface Card {
  id: string;
  slug: string;
  language: 'ne' | 'en';
  headline: string;
  summary: string;
  pullQuote: string | null;
  category: { slug: string; label: { ne: string; en: string } };
  source: { name: string; logoUrl: string | null };
  author: string | null;
  originatingAgency: string | null;
  publisherUrl: string;
  publishedAt: string;
  sourcePublishedAt: string | null;
  image: CardImage | null;
}

export interface AdCard {
  kind: 'ad';
  id: string;
  campaignId: string;
  language: 'ne' | 'en';
  advertiser: string;
  headline: string;
  body: string;
  callToAction: { ne: string; en: string };
  landingUrl: string;
  image: { blurHash: string | null; urls: { sm: string | null; md: string | null; lg: string | null } } | null;
}

/** A feed entry is either editorial or an ad. Discriminated on `kind` so the
 *  two can never be confused at a call site. */
export type FeedEntry = (Card & { kind?: 'article' }) | AdCard;

export const isAd = (e: FeedEntry): e is AdCard => (e as AdCard).kind === 'ad';

export interface FeedPage {
  items: FeedEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type FailureKind = 'offline' | 'timeout' | 'server' | 'bad-response';

export class FeedError extends Error {
  constructor(readonly kind: FailureKind, message: string) {
    super(message);
  }
}

/** Spec Ch. 2.6: abort at 8s and fall back to cache rather than hanging. */
const TIMEOUT_MS = 8000;

export async function fetchFeed(opts: {
  languages: Array<'ne' | 'en'>;
  category?: string;
  cursor?: string | null;
  limit?: number;
  /** Content cards already loaded in this category. Ad spacing is a function
   *  of ABSOLUTE position, so without this every page would restart the count
   *  and the reader would meet an ad every few cards at each page boundary. */
  seen?: number;
  /** Ads this device has already been shown today, for the daily cap. */
  adsToday?: number;
}): Promise<FeedPage> {
  const params = new URLSearchParams({
    lang: opts.languages.join(','),
    category: opts.category ?? 'top',
    limit: String(opts.limit ?? 20),
    seen: String(opts.seen ?? 0),
    adsToday: String(opts.adsToday ?? 0),
  });
  if (opts.cursor) params.set('cursor', opts.cursor);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/feed?${params}`, { signal: controller.signal });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    throw new FeedError(
      aborted ? 'timeout' : 'offline',
      aborted ? 'The server took too long to respond.' : 'No connection.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new FeedError('server', `The server returned ${res.status}.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FeedError('bad-response', 'The response was not readable.');
  }

  // A captive portal (hotel, airport) returns its own login page with HTTP 200.
  // Without this shape check the client caches that page as a news article and
  // renders it (Ch. 16.5). Validating before trusting is the whole point.
  const page = body as Partial<FeedPage>;
  if (!page || !Array.isArray(page.items)) {
    throw new FeedError('bad-response', 'That did not look like our server.');
  }
  const bad = page.items.find(
    (i) => typeof i?.id !== 'string' || typeof (i as { headline?: unknown }).headline !== 'string',
  );
  if (bad) throw new FeedError('bad-response', 'That did not look like our server.');

  return {
    items: page.items,
    nextCursor: page.nextCursor ?? null,
    hasMore: Boolean(page.hasMore),
  };
}

/** The article was retracted — 410, not 404. The client must tell the reader
 *  it was withdrawn rather than that it never existed (Ch. 3.3.3). */
export class ArticleGoneError extends Error {
  constructor() {
    super('This story was withdrawn.');
  }
}

/** Resolve a deep link. Spec Ch. 6.6. */
export async function fetchArticle(slug: string): Promise<Card> {
  const res = await fetch(`${API_BASE}/v1/articles/${encodeURIComponent(slug)}`);
  if (res.status === 410) throw new ArticleGoneError();
  if (!res.ok) throw new FeedError('server', `The server returned ${res.status}.`);
  const body = (await res.json()) as { item?: Card };
  if (!body.item?.id) throw new FeedError('bad-response', 'Unexpected response.');
  return body.item;
}

export interface CategoryOption {
  slug: string;
  label: { ne: string; en: string };
}

/** Category list for the rail. Failure is non-fatal — the feed still works on
 *  `top`, so callers fall back rather than blocking the screen. */
export async function fetchCategories(): Promise<CategoryOption[]> {
  const res = await fetch(`${API_BASE}/v1/categories`);
  if (!res.ok) throw new FeedError('server', `Categories returned ${res.status}.`);
  const body = (await res.json()) as { items?: CategoryOption[] };
  if (!Array.isArray(body.items)) throw new FeedError('bad-response', 'Unexpected response.');
  return body.items;
}

/* ------------------------------------------------------------------ blurhash */

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

/**
 * Decode only the DC (average colour) term of a BlurHash.
 *
 * A full decoder would render the blurred thumbnail, but the average colour is
 * enough to hold the layout and remove the grey flash, costs no dependency, and
 * is exact for the single-component hashes the placeholder pipeline emits.
 */
export function blurHashAverageColor(hash: string | null | undefined): string | null {
  if (!hash || hash.length < 6) return null;
  let dc = 0;
  for (let i = 2; i < 6; i++) {
    const d = B83.indexOf(hash[i]!);
    if (d < 0) return null;
    dc = dc * 83 + d;
  }
  const r = (dc >> 16) & 255;
  const g = (dc >> 8) & 255;
  const b = dc & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

/* ------------------------------------------------------ ad measurement */

export interface AdEventInput {
  campaignId: string;
  type: 'impression' | 'click';
  dwellMs: number;
  categorySlug: string;
  occurredAt: string;
}

/**
 * Post a batch of ad events.
 *
 * Deliberately returns void and swallows nothing louder than a rejection: the
 * caller treats measurement as best-effort. An advertiser losing one impression
 * to a dropped connection is a rounding error; a reader losing the story they
 * were reading because a measurement call failed is not.
 */
export async function postAdEvents(deviceId: string, events: AdEventInput[]): Promise<void> {
  if (events.length === 0) return;
  const res = await fetch(`${API_BASE}/v1/ads/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, events: events.slice(0, 50) }),
  });
  if (!res.ok) throw new FeedError('server', `Ad events returned ${res.status}.`);
}
