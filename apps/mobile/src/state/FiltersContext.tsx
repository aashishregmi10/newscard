import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local content filters.  Spec Ch. 7.8.
 *
 * "Not interested" MUST visibly change what the reader sees. The competitor
 * research is full of complaints that the control does nothing, and every one
 * of those is a reader learning that the app ignores them.
 *
 * Ranking is a v2 feature, so in the MVP the signal is applied as an immediate
 * LOCAL filter. That is honest and instant — and unlike a server-side
 * preference that quietly feeds a model, the reader can see exactly what it did
 * and undo it in Settings.
 */

const KEY = 'saar.filters.v1';

interface Filters {
  mutedCategories: string[];
  mutedSources: string[];
}

const EMPTY: Filters = { mutedCategories: [], mutedSources: [] };

interface Ctx extends Filters {
  ready: boolean;
  /** `viewing` is the section on screen: a topic is never hidden from its own. */
  isMuted: (categorySlug: string, sourceName: string, viewing?: string) => boolean;
  muteCategory: (slug: string) => void;
  unmuteCategory: (slug: string) => void;
  muteSource: (name: string) => void;
  unmuteSource: (name: string) => void;
  clearAll: () => void;
}

const FiltersCtx = createContext<Ctx | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setFilters({ ...EMPTY, ...(JSON.parse(raw) as Partial<Filters>) });
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  /**
   * Every change is computed from the latest state, not from the render that
   * created the callback. An Undo runs seconds after the render it was made
   * in; built on that render's copy, it would quietly roll back anything
   * changed since.
   */
  const write = useCallback((change: (prev: Filters) => Filters) => {
    setFilters((prev) => {
      const next = change(prev);
      if (next === prev) return prev;
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const actions = useMemo(
    () => ({
      muteCategory: (slug: string) =>
        write((f) =>
          f.mutedCategories.includes(slug)
            ? f
            : { ...f, mutedCategories: [...f.mutedCategories, slug] },
        ),
      unmuteCategory: (slug: string) =>
        write((f) =>
          f.mutedCategories.includes(slug)
            ? { ...f, mutedCategories: f.mutedCategories.filter((s) => s !== slug) }
            : f,
        ),
      muteSource: (name: string) =>
        write((f) =>
          f.mutedSources.includes(name) ? f : { ...f, mutedSources: [...f.mutedSources, name] },
        ),
      unmuteSource: (name: string) =>
        write((f) =>
          f.mutedSources.includes(name)
            ? { ...f, mutedSources: f.mutedSources.filter((s) => s !== name) }
            : f,
        ),
      clearAll: () => write(() => EMPTY),
    }),
    [write],
  );

  const value = useMemo<Ctx>(
    () => ({
      ...filters,
      ...actions,
      ready,
      isMuted: (categorySlug, sourceName, viewing) =>
        filters.mutedSources.includes(sourceName) ||
        // A muted topic is hidden from the reader's OTHER sections. Its own tab
        // is somewhere they went on purpose, and emptying it read as a section
        // with no news rather than as their own setting.
        (categorySlug !== viewing && filters.mutedCategories.includes(categorySlug)),
    }),
    [filters, actions, ready],
  );

  return <FiltersCtx.Provider value={value}>{children}</FiltersCtx.Provider>;
}

export function useFilters(): Ctx {
  const c = useContext(FiltersCtx);
  if (!c) throw new Error('useFilters must be used inside FiltersProvider');
  return c;
}
