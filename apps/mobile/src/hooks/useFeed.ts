import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeed, FeedError, type Card } from '../api/client';
import { putCards, getCards, evict } from '../db/cache';

/**
 * Feed loading with an offline cache.  Spec Ch. 9.
 *
 * The governing rule, and the reason this hook exists rather than a bare fetch:
 *
 *   A story we already have is ALWAYS shown. Losing the network must never
 *   blank the screen. QA treats a blank feed with a populated cache as a
 *   severity-1 defect (Ch. 2.6).
 *
 * So the cache is read FIRST and rendered immediately, then the network is
 * tried and the result merged. On a slow connection the reader sees yesterday's
 * stories in milliseconds rather than a spinner for eight seconds.
 */

export type FeedStatus = 'loading' | 'ready' | 'empty';

export interface FeedState {
  cards: Card[] | null;
  status: FeedStatus;
  /** Set when the last network attempt failed. Cards may still be present. */
  error: { kind: string; message: string } | null;
  /** True when what is on screen came from the cache, not the network. */
  fromCache: boolean;
  refreshing: boolean;
}

export function useFeed(languages: Array<'ne' | 'en'>, category: string) {
  const [state, setState] = useState<FeedState>({
    cards: null,
    status: 'loading',
    error: null,
    fromCache: false,
    refreshing: false,
  });

  const cursor = useRef<string | null>(null);
  const hasMore = useRef(true);
  const loadingMore = useRef(false);
  /** Guards against a slow response for a category the reader has left. */
  const requestId = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const myRequest = ++requestId.current;

      if (mode === 'refresh') {
        setState((s) => ({ ...s, refreshing: true, error: null }));
      } else {
        setState({
          cards: null,
          status: 'loading',
          error: null,
          fromCache: false,
          refreshing: false,
        });

        // Paint from cache immediately. This is the whole point: on a poor
        // connection the reader gets something to read in milliseconds.
        try {
          const cached = await getCards(category, languages);
          if (cached.length > 0 && requestId.current === myRequest) {
            setState({
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
        const page = await fetchFeed({ languages, category, limit: 20 });
        if (requestId.current !== myRequest) return;

        cursor.current = page.nextCursor;
        hasMore.current = page.hasMore;

        setState({
          cards: page.items,
          status: page.items.length === 0 ? 'empty' : 'ready',
          error: null,
          fromCache: false,
          refreshing: false,
        });

        void putCards(page.items, category).then(() => evict()).catch(() => undefined);
      } catch (e) {
        if (requestId.current !== myRequest) return;
        const fe = e instanceof FeedError ? e : null;
        const error = {
          kind: fe?.kind ?? 'server',
          message: fe?.message ?? 'Something went wrong.',
        };

        setState((s) => ({
          ...s,
          // Keep whatever is on screen. Anything already cached stays readable.
          status: s.cards && s.cards.length > 0 ? 'ready' : 'empty',
          error,
          refreshing: false,
        }));
      }
    },
    [languages, category],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore.current || !cursor.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchFeed({
        languages,
        category,
        cursor: cursor.current,
        limit: 20,
      });
      setState((s) => ({ ...s, cards: [...(s.cards ?? []), ...page.items] }));
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
      void putCards(page.items, category).catch(() => undefined);
    } catch {
      // Silent. The reader still has everything above; a toast would interrupt
      // reading to report something they never asked for.
    } finally {
      loadingMore.current = false;
    }
  }, [languages, category]);

  return {
    ...state,
    reload: () => load('initial'),
    refresh: () => load('refresh'),
    loadMore,
  };
}
