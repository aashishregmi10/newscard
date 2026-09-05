import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

const KEY = 'newscard.filters.v1';

interface Filters {
  mutedCategories: string[];
  mutedSources: string[];
}

const EMPTY: Filters = { mutedCategories: [], mutedSources: [] };

interface Ctx extends Filters {
  ready: boolean;
  isMuted: (categorySlug: string, sourceName: string) => boolean;
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

  const write = (next: Filters) => {
    setFilters(next);
    void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const value = useMemo<Ctx>(
    () => ({
      ...filters,
      ready,
      isMuted: (categorySlug, sourceName) =>
        filters.mutedCategories.includes(categorySlug) || filters.mutedSources.includes(sourceName),
      muteCategory: (slug) =>
        write({
          ...filters,
          mutedCategories: filters.mutedCategories.includes(slug)
            ? filters.mutedCategories
            : [...filters.mutedCategories, slug],
        }),
      unmuteCategory: (slug) =>
        write({ ...filters, mutedCategories: filters.mutedCategories.filter((s) => s !== slug) }),
      muteSource: (name) =>
        write({
          ...filters,
          mutedSources: filters.mutedSources.includes(name)
            ? filters.mutedSources
            : [...filters.mutedSources, name],
        }),
      unmuteSource: (name) =>
        write({ ...filters, mutedSources: filters.mutedSources.filter((s) => s !== name) }),
      clearAll: () => write(EMPTY),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, ready],
  );

  return <FiltersCtx.Provider value={value}>{children}</FiltersCtx.Provider>;
}

export function useFilters(): Ctx {
  const c = useContext(FiltersCtx);
  if (!c) throw new Error('useFilters must be used inside FiltersProvider');
  return c;
}
