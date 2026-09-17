import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeed, isAd, type Card } from '../api/client';
import { putCards, getCards, evict } from '../db/cache';
import { adsShownToday, loadAdBudget } from '../lib/adTracker';
import {
  appendPage,
  runFeedLoad,
  INITIAL_FEED_STATE,
  type FeedLoadDeps,
  type FeedState,
  type FeedStatus,
} from './feedLoad';

/**
 * Feed loading with an offline cache.  Spec Ch. 9.
 *
 * The governing rule, and the reason this hook exists rather than a bare fetch:
 *
 *   A story we already have is ALWAYS shown. Losing the network must never
 *   blank the screen. QA treats a blank feed with a populated cache as a
 *   severity-1 defect (Ch. 2.6).
 *
 * The SEQUENCE that guarantees it — cache first, then network, then merge —
 * lives in ./feedLoad, where it can be tested without rendering anything. What
 * is left here is React: state, refs, and wiring the real I/O to the decisions.
 */

export type { FeedStatus, FeedState };

export function useFeed(languages: Array<'ne' | 'en'>, category: string) {
  const [state, setState] = useState<FeedState>(INITIAL_FEED_STATE);

  const cursor = useRef<string | null>(null);
  const hasMore = useRef(true);
  const loadingMore = useRef(false);
  const contentSeen = useRef(0);
  /** Guards against a slow response for a category the reader has left. */
  const requestId = useRef(0);

  /** The real I/O, in one place, so the sequence above stays testable. */
  const deps: FeedLoadDeps = {
    getCached: (cat, langs) => getCards(cat, langs),
    fetchPage: (args) => fetchFeed(args),
    loadAdBudget,
    adsShownToday,
    persist: (articles, cat) => {
      void putCards(articles, cat)
        .then(() => evict())
        .catch(() => undefined);
    },
  };

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const myRequest = ++requestId.current;

      const outcome = await runFeedLoad(
        { mode, category, languages, isCurrent: () => requestId.current === myRequest },
        deps,
        setState,
      );

      if (outcome) {
        cursor.current = outcome.nextCursor;
        hasMore.current = outcome.hasMore;
        contentSeen.current = outcome.contentSeen;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        seen: contentSeen.current,
        adsToday: adsShownToday(),
      });
      // Deduplicated on append — see appendPage for why the cursor alone is not
      // the same guarantee.
      setState((s) => ({ ...s, cards: appendPage(s.cards, page.items) }));
      contentSeen.current += page.items.filter((i) => !isAd(i)).length;
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
      void putCards(
        page.items.filter((i): i is Card => !isAd(i)),
        category,
      ).catch(() => undefined);
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
