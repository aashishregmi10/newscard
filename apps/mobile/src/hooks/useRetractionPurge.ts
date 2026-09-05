import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { API_BASE } from '../api/client';
import { getCards, purge } from '../db/cache';
import { useBookmarks } from '../state/BookmarksContext';

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

async function runPurge(removeBookmark: (id: string) => void): Promise<number> {
  // Categories are checked together; the cache is keyed by category, and `top`
  // plus `nepal` covers the overwhelming majority of what a reader holds.
  const cached = await getCards('top', ['ne', 'en'], 200).catch(() => []);
  if (cached.length === 0) return 0;

  const cutoff = Date.now() - CHECK_WINDOW_HOURS * 60 * 60 * 1000;
  const ids = cached
    .filter((c) => Date.parse(c.publishedAt) >= cutoff)
    .map((c) => c.id)
    .slice(0, 500);

  if (ids.length === 0) return 0;

  const res = await fetch(`${API_BASE}/v1/articles/validate`, {
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
  const { remove } = useBookmarks();
  const running = useRef(false);

  useEffect(() => {
    const run = () => {
      // Foreground events can arrive in bursts; one pass at a time is enough.
      if (running.current) return;
      running.current = true;
      runPurge(remove)
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
  }, [remove]);
}
