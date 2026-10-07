/**
 * Feed API client.
 *
 * Failure handling is deliberately explicit: on a metered, intermittent
 * connection the interesting cases are "slow", "offline" and "server said no",
 * and they need different treatment in the UI (Ch. 2.6).
 */

import Constants from 'expo-constants';
import type {
  AdCardDto,
  ArticleCardDto,
  InlineAdDto,
  InteractionCardDto,
  InteractionResultsDto,
  InteractionStateDto,
  ReaderSessionDto,
  VideoCardDto,
  VideoRendition,
} from './generated/dto';

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
 * The public website — privacy policy, terms, contact, account deletion.
 * EXPO_PUBLIC_SITE_URL in a release build (eas.json); in development, the
 * editorial site on the machine Metro runs on, as for the API.
 */
function resolveSiteBase(): string {
  const explicit = process.env.EXPO_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  return `http://${hostUri?.split(':')[0] ?? 'localhost'}:5173`;
}

export const SITE_BASE = resolveSiteBase();

/** The site's pages the app links to. Google Play's News policy wants the contact one reachable in-app. */
export const SITE_LINKS = {
  privacy: `${SITE_BASE}/privacy`,
  terms: `${SITE_BASE}/terms`,
  contact: `${SITE_BASE}/#/contact`,
  deleteAccount: `${SITE_BASE}/delete-account`,
} as const;

/**
 * Image URLs are stored relative in development ("/media/…") so they survive an
 * IP change, and absolute in production where they point at a real CDN.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * The server’s card shapes.
 *
 * GENERATED from packages/schemas — see scripts/gen-client-types.ts. These were
 * hand-written here until they were not: the app is deliberately outside the
 * npm workspace (Metro must not find two copies of React), so it could not
 * import the schemas and kept its own copy instead. The copy agreed with the
 * server because someone remembered, and nothing failed when someone forgot.
 *
 * Now a field added on the server is a compile error here rather than a value
 * the app silently ignores, and `npm run gen:types` is checked by CI.
 *
 * The aliases below keep the names the app already speaks: a `Card` is what the
 * feed shows, whatever the DTO is called on the wire.
 */
export type Card = ArticleCardDto;
export type CardImage = NonNullable<ArticleCardDto['image']>;
export type AdCard = AdCardDto;
export type InlineAd = InlineAdDto;
export type AdPlacement = 'card' | 'inline';
export type VideoCard = VideoCardDto;
export type InteractionCard = InteractionCardDto;
export type InteractionState = InteractionStateDto;
export type InteractionResults = InteractionResultsDto;
export type { VideoRendition } from './generated/dto';

/**
 * A feed entry is either editorial or an ad. Discriminated on `kind` so the
 * two can never be confused at a call site.
 *
 * A story may carry a small ad of its own, `inlineAd`, shown beside save and
 * share. It rides on the entry and never on the card itself, and it is
 * stripped before a story is cached (cacheable, in hooks/feedLoad) so an
 * ended campaign is never replayed offline.
 */
export type FeedEntry = (Card & { kind?: 'article'; inlineAd?: InlineAd }) | AdCard | InteractionCard;

export const isAd = (e: FeedEntry): e is AdCard => (e as AdCard).kind === 'ad';

/** A rating or a vote, as a card between stories. */
export const isInteraction = (e: FeedEntry): e is InteractionCard =>
  (e as InteractionCard).kind === 'interaction';

/** A story — not an ad, not an Interaction. Only stories are read, muted, counted and cached. */
export const isStory = (e: FeedEntry): e is Card & { kind?: 'article'; inlineAd?: InlineAd } =>
  !isAd(e) && !isInteraction(e);

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

/**
 * What to tell a reader about a failure, in their language. The messages
 * thrown above are for logs; these are for screens — a Nepali reader was being
 * shown "The server returned 503." (launch review, 7 Oct 2026).
 */
export function failureText(kind: FailureKind | string | undefined, lang: 'ne' | 'en'): string {
  const ne = lang === 'ne';
  switch (kind) {
    case 'offline':
      return ne
        ? 'सर्भरसँग जोड्न सकिएन। इन्टरनेट जाँचेर फेरि प्रयास गर्नुहोस्।'
        : 'Could not reach the server. Check your connection and try again.';
    case 'timeout':
      return ne ? 'सर्भरले समयमै जवाफ दिएन। फेरि प्रयास गर्नुहोस्।' : 'The server took too long to answer. Try again.';
    case 'server':
      return ne
        ? 'सर्भरमा समस्या आयो। केही बेरपछि फेरि प्रयास गर्नुहोस्।'
        : 'The server had a problem. Try again in a moment.';
    default:
      return ne ? 'केही गडबड भयो। फेरि प्रयास गर्नुहोस्।' : 'Something went wrong. Try again.';
  }
}

/** Spec Ch. 2.6: abort at 8s and fall back to cache rather than hanging. */
const TIMEOUT_MS = 8000;

/**
 * fetch, with the feed's ceiling. Android's HTTP client in React Native never
 * times out on its own (OkHttp's timeouts are set to 0), so a request into a
 * dead connection waits forever: a notification's story stuck on its skeleton,
 * a withdrawn-story check that never runs again that session (launch review,
 * 7 Oct 2026). Every request goes through this or carries its own timer.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFeed(opts: {
  languages: Array<'ne' | 'en'>;
  category?: string;
  cursor?: string | null;
  limit?: number;
  /** Content cards already loaded in this category. Ad spacing is a function
   *  of ABSOLUTE position, so without this every page would restart the count
   *  and the reader would meet an ad every few cards at each page boundary. */
  seen?: number;
  /** Full-card ads this device has already been shown today, for the daily cap. */
  adsToday?: number;
  /** Small ads shown today, counted apart: at one per story, sharing the
   *  full-card count would spend its daily allowance in a dozen stories. */
  inlineToday?: number;
}): Promise<FeedPage> {
  const params = new URLSearchParams({
    lang: opts.languages.join(','),
    category: opts.category ?? 'top',
    limit: String(opts.limit ?? 20),
    seen: String(opts.seen ?? 0),
    adsToday: String(opts.adsToday ?? 0),
    inlineToday: String(opts.inlineToday ?? 0),
    /* This app can draw a rating or a vote; older ones cannot, and the server
       sends them none unless asked. */
    interactions: '1',
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
      aborted
        ? 'The server took too long to respond.'
        : // Covers both "no network" and "server unreachable". fetch cannot
          // tell them apart, so the message must be true of both.
          'Could not reach the server.',
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
  /* An Interaction has a title where a story or an ad has a headline. */
  const bad = page.items.find(
    (i) =>
      typeof i?.id !== 'string' ||
      typeof (isInteraction(i) ? i.title : (i as { headline?: unknown }).headline) !== 'string',
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
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/v1/articles/${encodeURIComponent(slug)}`);
  } catch {
    throw new FeedError('offline', 'Could not reach the server.');
  }
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
  const res = await fetchWithTimeout(`${API_BASE}/v1/categories`);
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
  /** Which product delivered it: the full card, or the small ad on a story. */
  placement: AdPlacement;
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
  const res = await fetchWithTimeout(`${API_BASE}/v1/ads/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, events: events.slice(0, 50) }),
  });
  if (!res.ok) throw new FeedError('server', `Ad events returned ${res.status}.`);
}

/* ------------------------------------------------------------------ videos */

export interface VideoPage {
  items: VideoCard[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchVideos(opts: {
  languages: Array<'ne' | 'en'>;
  category?: string;
  cursor?: string | null;
  limit?: number;
  /** Pulled to refresh: ask the server, not the phone's copy from a minute ago. */
  fresh?: boolean;
}): Promise<VideoPage> {
  const params = new URLSearchParams({
    lang: opts.languages.join(','),
    category: opts.category ?? 'all',
    limit: String(opts.limit ?? 10),
    /* This app can play a YouTube short (YouTubeShortCard); older ones
       cannot, and the server sends them none unless asked. */
    youtube: '1',
  });
  if (opts.cursor) params.set('cursor', opts.cursor);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    /* The server lets a page be kept for 60 seconds, and Android keeps it. A
       reader who pulls to refresh is asking for what is new now, so that
       request skips the phone's copy. */
    res = await fetch(`${API_BASE}/v1/videos?${params}`, {
      signal: controller.signal,
      ...(opts.fresh ? { headers: { 'Cache-Control': 'no-cache' } } : {}),
    });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    throw new FeedError(
      aborted ? 'timeout' : 'offline',
      aborted ? 'The server took too long to respond.' : 'Could not reach the server.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new FeedError('server', `The server returned ${res.status}.`);

  const body = (await res.json()) as Partial<VideoPage>;
  if (!body || !Array.isArray(body.items)) {
    throw new FeedError('bad-response', 'That did not look like our server.');
  }

  return {
    items: body.items,
    nextCursor: body.nextCursor ?? null,
    hasMore: Boolean(body.hasMore),
  };
}

/**
 * Which rendition to play.
 *
 * Deliberately conservative. Only the client knows whether it is on Wi-Fi and
 * whether the reader has Data Saver on, so the server returns every rendition
 * and this decides — and when it cannot tell, it picks the cheaper one. Guessing
 * high on a metered connection spends someone else's money.
 */
export function pickRendition(
  renditions: VideoRendition[],
  opts: { unmetered: boolean; dataSaver: boolean },
): VideoRendition | undefined {
  if (renditions.length === 0) return undefined;
  const by = (q: VideoRendition['quality']) => renditions.find((r) => r.quality === q);
  if (opts.dataSaver) return by('low') ?? renditions[0];
  if (opts.unmetered) return by('high') ?? by('medium') ?? renditions[0];
  return by('medium') ?? by('low') ?? renditions[0];
}

/** Bytes of the chosen rendition, for the "this will cost you X" label. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ── Interactions, and the reader's sign-in ───────────────────────────────── */

/**
 * A refusal from the server about an answer, by status: 401 sign in again,
 * 409 already answered (with where the reader stands), 410 closed.
 */
export class AnswerError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly state: InteractionState | null,
  ) {
    super(message);
  }
}

async function readerCall<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Reader ${token}` } : {}),
        ...(headers ?? {}),
      },
    });
  } catch {
    throw new AnswerError(0, 'Could not reach the server.', null);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string; details?: { state?: InteractionState } } })
    | null;
  if (!res.ok) {
    throw new AnswerError(
      res.status,
      body?.error?.message ?? `The server returned ${res.status}.`,
      body?.error?.details?.state ?? null,
    );
  }
  return body as T;
}

/** The Google Web client ID sign-in must use, from the server's settings — one place to change it. */
export function fetchReaderConfig(): Promise<{ googleWebClientId: string | null }> {
  return readerCall('/v1/readers/config');
}

/** Swap a Google ID token for our own session. */
export function startReaderSession(idToken: string): Promise<ReaderSessionDto> {
  return readerCall('/v1/readers/session', { method: 'POST', body: JSON.stringify({ idToken }) });
}

export function endReaderSession(token: string): Promise<void> {
  return readerCall('/v1/readers/session', { method: 'DELETE', token });
}

/** Delete this reader's account and all it holds: every session, vote and rating. */
export function deleteReaderAccount(token: string): Promise<{ deleted: boolean }> {
  return readerCall('/v1/readers/me', { method: 'DELETE', token });
}

/** Where this reader stands; without a session, what anyone may see. */
export function fetchInteractionState(id: string, token: string | null): Promise<InteractionState> {
  const path = `/v1/interactions/${encodeURIComponent(id)}/${token ? 'me' : 'results'}`;
  return readerCall(path, { token });
}

export function answerVote(id: string, optionId: string, token: string): Promise<InteractionState> {
  return readerCall(`/v1/interactions/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    token,
    body: JSON.stringify({ optionId }),
  });
}

/** Stars for every option of a rating, sent together, as a form is. */
export function answerRatings(
  id: string,
  ratings: ReadonlyArray<{ optionId: string; stars: number }>,
  token: string,
): Promise<InteractionState> {
  return readerCall(`/v1/interactions/${encodeURIComponent(id)}/ratings`, {
    method: 'POST',
    token,
    body: JSON.stringify({ ratings }),
  });
}
