import type { Card, FeedEntry, FeedPage } from '../api/client';

/**
 * The feed's loading decisions, separated from the hook that runs them.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * `useFeed` did five things at once — fetching, cache-first painting,
 * pagination, ad-budget coordination, and discarding a response for a category
 * the reader has left — and that is precisely why it had no tests. There was no
 * seam: you could exercise the whole hook through React or nothing at all.
 *
 * The rule this protects is the one QA treats as severity-1:
 *
 *   A story the app already has is ALWAYS shown. Losing the network must never
 *   blank the screen, and the cache is painted BEFORE the network is tried, not
 *   after it fails.
 *
 * That is an ORDERING guarantee, and ordering is exactly what a test asserts
 * badly through a rendered component and precisely through a list of emitted
 * states. So the sequence lives here, takes its I/O as arguments, and reports
 * what it did by calling `emit`.
 *
 * ── Why nothing here imports ../api/client at runtime ───────────────────────
 *
 * Only its TYPES are imported, which TypeScript erases. `client.ts` reaches for
 * expo-constants at module scope, and importing it would drag React Native into
 * a plain Node test process. The one runtime thing needed from it — telling an
 * ad from a story — is a one-line structural check instead.
 */

export type FeedStatus = 'loading' | 'ready' | 'empty';

export interface FeedState {
  cards: FeedEntry[] | null;
  status: FeedStatus;
  /** Set when the last network attempt failed. Cards may still be present. */
  error: { kind: string; message: string } | null;
  /** True when what is on screen came from the cache, not the network. */
  fromCache: boolean;
  refreshing: boolean;
}

export const INITIAL_FEED_STATE: FeedState = {
  cards: null,
  status: 'loading',
  error: null,
  fromCache: false,
  refreshing: false,
};

/** An ad, structurally. Avoids a runtime import purely to read one field. */
export const isAdEntry = (e: FeedEntry): boolean =>
  (e as { kind?: string }).kind === 'ad';

export interface FeedLoadDeps {
  getCached(category: string, languages: Array<'ne' | 'en'>): Promise<FeedEntry[]>;
  fetchPage(args: {
    languages: Array<'ne' | 'en'>;
    category: string;
    limit: number;
    seen: number;
    adsToday: number;
    cursor?: string;
  }): Promise<FeedPage>;
  loadAdBudget(): Promise<void>;
  adsShownToday(): number;
  /** Fire-and-forget. Caching must never delay what is on screen. */
  persist(articles: Card[], category: string): void;
}

export interface FeedLoadParams {
  mode: 'initial' | 'refresh';
  category: string;
  languages: Array<'ne' | 'en'>;
  /**
   * False once the reader has moved to another category.
   *
   * Checked after every await: a slow response for a category nobody is looking
   * at must not overwrite the one they are.
   */
  isCurrent(): boolean;
}

export interface FeedLoadOutcome {
  nextCursor: string | null;
  hasMore: boolean;
  /** Content cards delivered so far. Ads are spaced on ABSOLUTE position, so
   *  the server needs the running total, not the offset within one page. */
  contentSeen: number;
}

export type Emit = (next: FeedState | ((prev: FeedState) => FeedState)) => void;

/**
 * FeedError carries `kind`; anything else is a server fault we cannot describe.
 * Read structurally so this file needs no runtime import to classify an error.
 */
function describeError(e: unknown): { kind: string; message: string } {
  const kind = (e as { kind?: unknown } | null)?.kind;
  const message = (e as { message?: unknown } | null)?.message;
  return {
    kind: typeof kind === 'string' ? kind : 'server',
    message: typeof message === 'string' && message ? message : 'Something went wrong.',
  };
}

/**
 * Load the first page, painting the cache first.
 *
 * Returns the pagination state on success, or null when the attempt failed or
 * was superseded — the caller keeps its cursor unchanged in both cases.
 */
export async function runFeedLoad(
  params: FeedLoadParams,
  deps: FeedLoadDeps,
  emit: Emit,
): Promise<FeedLoadOutcome | null> {
  const { mode, category, languages, isCurrent } = params;

  if (mode === 'refresh') {
    emit((s) => ({ ...s, refreshing: true, error: null }));
  } else {
    emit({ ...INITIAL_FEED_STATE });

    // Paint from cache immediately. This is the whole point: on a poor
    // connection the reader gets something to read in milliseconds rather than
    // a spinner for eight seconds.
    try {
      const cached = await deps.getCached(category, languages);
      if (cached.length > 0 && isCurrent()) {
        emit({
          cards: cached,
          status: 'ready',
          error: null,
          fromCache: true,
          refreshing: false,
        });
      }
    } catch {
      // A cache read failure is never fatal — fall through to the network.
    }
  }

  try {
    // Must resolve BEFORE the request. Reporting zero ads shown would reset the
    // daily cap on every cold start — the whole cap, defeated by an app
    // restart.
    await deps.loadAdBudget();

    const page = await deps.fetchPage({
      languages,
      category,
      limit: 20,
      seen: 0,
      adsToday: deps.adsShownToday(),
    });
    if (!isCurrent()) return null;

    emit({
      cards: page.items,
      status: page.items.length === 0 ? 'empty' : 'ready',
      error: null,
      fromCache: false,
      refreshing: false,
    });

    // Only editorial is cached. An ad has a flight window and a budget; serving
    // one from a stale cache would bill nobody and mislead the reader after the
    // campaign has ended.
    deps.persist(page.items.filter((i): i is Card => !isAdEntry(i)), category);

    return {
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      contentSeen: page.items.filter((i) => !isAdEntry(i)).length,
    };
  } catch (e) {
    if (!isCurrent()) return null;
    const error = describeError(e);

    emit((s) => ({
      ...s,
      // Keep whatever is on screen. Anything already cached stays readable —
      // this is the line that stops a lost network blanking the feed.
      status: s.cards && s.cards.length > 0 ? 'ready' : 'empty',
      error,
      refreshing: false,
    }));
    return null;
  }
}

/**
 * Append the next page to what is on screen, dropping anything already there.
 *
 * The compound (publishedAt, _id) cursor is what makes duplicates unlikely, and
 * this is what makes them impossible. The two are not the same guarantee: the
 * cursor is a promise about the QUERY, and this is a property of the LIST. A
 * story republished between two requests, or a retry that resends a page, would
 * otherwise render twice — and in React a duplicate key is a rendering bug
 * rather than a visible one, which is the hardest kind to notice.
 */
export function appendPage(current: FeedEntry[] | null, incoming: FeedEntry[]): FeedEntry[] {
  const existing = new Set((current ?? []).map((c) => c.id));
  const fresh = incoming.filter((c) => !existing.has(c.id));
  return [...(current ?? []), ...fresh];
}
