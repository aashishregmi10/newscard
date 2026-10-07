import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Card } from '../api/client';
import { API_BASE, fetchWithTimeout } from '../api/client';
import { purge, recentIds } from '../db/cache';
import { useBookmarkActions } from '../state/BookmarksContext';

/**
 * Purge withdrawn stories from the local cache.  Spec Ch. 9.7.
 *
 * A device offline for several days may hold cards that have since been
 * retracted. This is the one correctness problem in the offline design that
 * actually matters: a story is usually retracted because it was WRONG, so
 * leaving it readable damages trust rather than merely annoying.
 *
 * Runs on every foreground. The request sends the ids we hold and the server
 * returns only the ones no longer published, so the common case — nothing
 * changed — costs a few hundred bytes.
 */

/** Only recent cards are worth checking. Anything older has aged out of the
 *  feed anyway, and checking it wastes the reader's data. */
const CHECK_WINDOW_HOURS = 72;

async function runPurge(saved: Card[], removeBookmark: (id: string) => void): Promise<number> {
  // Every section's cache, not only `top`: a story withdrawn from Sport and
  // cached there stayed readable offline (launch review, 7 Oct 2026). And every
  // bookmark, whatever its age — a bookmark outlives the cache window, and a
  // promise to keep a story is not a promise to keep one we withdrew.
  const cutoff = Date.now() - CHECK_WINDOW_HOURS * 60 * 60 * 1000;
  const cached = await recentIds(cutoff).catch(() => [] as string[]);
  const ids = [...new Set([...saved.map((c) => c.id), ...cached])].slice(0, 500);
  if (ids.length === 0) return 0;

  const res = await fetchWithTimeout(`${API_BASE}/v1/articles/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) return 0;

  const body = (await res.json()) as { invalid?: string[] };
  const invalid = body.invalid ?? [];
  if (invalid.length === 0) return 0;

  await purge(invalid);
  // A bookmark is a promise, but not a promise to keep something we withdrew.
  // Ch. 9.4 requires the bookmark to go too.
  for (const id of invalid) removeBookmark(id);

  return invalid.length;
}

export function useRetractionPurge(): void {
  /* The actions, not the list: subscribing here re-rendered the whole app
     (this runs in the root layout) on every save and unsave. */
  const { remove, current } = useBookmarkActions();
  const running = useRef(false);

  useEffect(() => {
    const run = () => {
      // Foreground events can arrive in bursts; one pass at a time is enough.
      if (running.current) return;
      running.current = true;
      runPurge(current(), remove)
        .then((n) => {
          if (n > 0) console.info(`[cache] removed ${n} withdrawn stor${n === 1 ? 'y' : 'ies'}`);
        })
        .catch(() => {
          // Offline is the normal case for this app. Failing to reconcile is
          // not an error worth surfacing; the next foreground tries again.
        })
        .finally(() => {
          running.current = false;
        });
    };

    run(); // on mount

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [remove, current]);
}
