import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card } from '../api/client';

/**
 * Bookmarks.  Spec Ch. 9.4.
 *
 * Local to the device only — no account, no server round trip, no sync. Two
 * consequences that are deliberate:
 *
 *  - The FULL card is stored, not just its id. A bookmark whose content has
 *    been evicted is a broken promise, and re-fetching it needs a network the
 *    reader may not have.
 *  - Toggling is instant and optimistic. There is no request, so there is
 *    nothing to fail.
 *
 * AsyncStorage is the v0 store. Ch. 9.2 specifies SQLite, which arrives with
 * the offline cache in M5; the interface here will not change.
 */

const KEY = 'newscard.bookmarks.v1';

interface Ctx {
  ready: boolean;
  items: Card[];
  has: (id: string) => boolean;
  toggle: (card: Card) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const BookmarksCtx = createContext<Ctx | null>(null);

export function BookmarksProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Card[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setItems(JSON.parse(raw) as Card[]);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const persist = (next: Card[]) => {
    setItems(next);
    void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const value = useMemo<Ctx>(
    () => ({
      ready,
      items,
      has: (id) => items.some((i) => i.id === id),
      toggle: (card) => {
        const exists = items.some((i) => i.id === card.id);
        persist(exists ? items.filter((i) => i.id !== card.id) : [card, ...items]);
      },
      remove: (id) => persist(items.filter((i) => i.id !== id)),
      clear: () => persist([]),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, ready],
  );

  return <BookmarksCtx.Provider value={value}>{children}</BookmarksCtx.Provider>;
}

export function useBookmarks(): Ctx {
  const c = useContext(BookmarksCtx);
  if (!c) throw new Error('useBookmarks must be used inside BookmarksProvider');
  return c;
}
