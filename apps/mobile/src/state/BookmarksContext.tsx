import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
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
 *
 * ── Why a store and not a context value ─────────────────────────────────────
 *
 * Every card on screen shows whether it is saved. When the list lived in a
 * context value, saving ONE story changed that value and re-rendered every
 * card mounted in every section — a few dozen, while the save animation was
 * running. Now a card subscribes to its own id and re-renders only when that
 * one answer changes; the Saved and Settings screens, which show the whole
 * list, subscribe to the list.
 */

const KEY = 'saar.bookmarks.v1';

function createStore() {
  let items: Card[] = [];
  let ids = new Set<string>();
  const listeners = new Set<() => void>();

  return {
    getItems: () => items,
    has: (id: string) => ids.has(id),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: Card[], persist = true) {
      items = next;
      ids = new Set(next.map((c) => c.id));
      if (persist) void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      for (const l of listeners) l();
    },
  };
}

type Store = ReturnType<typeof createStore>;

interface Actions {
  toggle: (card: Card) => void;
  remove: (id: string) => void;
  /** Puts a removed story back where it was — the Saved screen's Undo. */
  restore: (card: Card, index: number) => void;
  clear: () => void;
}

interface Shared extends Actions {
  store: Store;
  ready: boolean;
}

const BookmarksCtx = createContext<Shared | null>(null);

export function BookmarksProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store | null>(null);
  if (!store.current) store.current = createStore();
  const s = store.current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        // Anything saved before the read finished is kept, ahead of the rest.
        if (raw) {
          const stored = JSON.parse(raw) as Card[];
          const early = s.getItems();
          s.set([...early, ...stored.filter((c) => !s.has(c.id))], early.length > 0);
        }
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [s]);

  const value = useMemo<Shared>(
    () => ({
      store: s,
      ready,
      toggle: (card) =>
        s.set(
          s.has(card.id) ? s.getItems().filter((i) => i.id !== card.id) : [card, ...s.getItems()],
        ),
      remove: (id) => s.set(s.getItems().filter((i) => i.id !== id)),
      restore: (card, index) => {
        if (s.has(card.id)) return;
        const next = [...s.getItems()];
        next.splice(Math.min(index, next.length), 0, card);
        s.set(next);
      },
      clear: () => s.set([]),
    }),
    [s, ready],
  );

  return <BookmarksCtx.Provider value={value}>{children}</BookmarksCtx.Provider>;
}

function useShared(): Shared {
  const c = useContext(BookmarksCtx);
  if (!c) throw new Error('bookmarks hooks must be used inside BookmarksProvider');
  return c;
}

/** The whole list. Re-renders on every change — for the screens that show it. */
export function useBookmarks(): Actions & { ready: boolean; items: Card[]; has: (id: string) => boolean } {
  const shared = useShared();
  const items = useSyncExternalStore(shared.store.subscribe, shared.store.getItems);
  return useMemo(
    () => ({
      ready: shared.ready,
      items,
      has: shared.store.has,
      toggle: shared.toggle,
      remove: shared.remove,
      restore: shared.restore,
      clear: shared.clear,
    }),
    [shared, items],
  );
}

/** Whether one story is saved. Re-renders only when that answer changes. */
export function useIsSaved(id: string): boolean {
  const { store } = useShared();
  return useSyncExternalStore(store.subscribe, () => store.has(id));
}

/** Save, remove and clear, without subscribing to the list. */
export function useBookmarkActions(): Actions {
  const { toggle, remove, restore, clear } = useShared();
  return { toggle, remove, restore, clear };
}
