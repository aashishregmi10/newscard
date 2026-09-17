import { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CategoryRail, type CategoryOption } from '../../src/components/CategoryRail';
import { CategoryPager, type CategoryPagerHandle } from '../../src/components/CategoryPager';
import { CategoryFeed } from '../../src/components/CategoryFeed';
import { CardMenu } from '../../src/components/CardMenu';
import { NotifPrompt } from '../../src/components/NotifPrompt';
import { fetchCategories, type Card } from '../../src/api/client';
import { useSettings } from '../../src/state/SettingsContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { useFilters } from '../../src/state/FiltersContext';

/**
 * The feed screen.  Spec Ch. 7.1, 7.9.
 *
 * Two axes, which is what makes it feel like a phone app rather than a list:
 *
 *   vertical   — one swipe, one story (paged, Reels-style)
 *   horizontal — one swipe, one category: नेपाल → राजनीति → अर्थतन्त्र
 *
 * The rail stays tappable for jumping several categories at once; the swipe is
 * for moving one step, which is the common case.
 */

/**
 * The rail to show before the server has answered.
 *
 * ── Why this is all seven and not just `top` ────────────────────────────────
 *
 * It used to be one entry. When the server could not be reached — it was simply
 * not running — the app started with a single tab and stayed that way, because
 * the fetch below runs once on mount and its failure is silent. Every section
 * vanished, the stories looked lost, and nothing on screen suggested the cause.
 *
 * The seven sections are FIXED by specification, not discovered at runtime, so
 * a bootstrap list is honest rather than a guess. The server stays
 * authoritative: it decides order, labels and which are active, and overwrites
 * this the moment it answers. This only has to be right enough to give a reader
 * with no network the app they had yesterday.
 */
const FALLBACK_CATEGORIES: CategoryOption[] = [
  { slug: 'top', label: { ne: 'मुख्य समाचार', en: 'Top Stories' } },
  { slug: 'nepal', label: { ne: 'नेपाल', en: 'Nepal' } },
  { slug: 'politics', label: { ne: 'राजनीति', en: 'Politics' } },
  { slug: 'business', label: { ne: 'अर्थतन्त्र', en: 'Business' } },
  { slug: 'world', label: { ne: 'विश्व', en: 'World' } },
  { slug: 'sports', label: { ne: 'खेलकुद', en: 'Sports' } },
  { slug: 'tech', label: { ne: 'प्रविधि', en: 'Technology' } },
];

export default function FeedScreen() {
  const { theme, textScale, dataSaver, languages } = useSettings();
  const { online } = useNetwork();
  const filters = useFilters();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const railH = 52;
  const tabBarH = 58;
  const pageHeight = Math.round(height - insets.top - railH - tabBarH);

  const [categories, setCategories] = useState<CategoryOption[]>(FALLBACK_CATEGORIES);
  const [index, setIndex] = useState(0);
  /**
   * The category the rail highlights.
   *
   * Separate from `index` on purpose. This one moves as soon as the swipe
   * crosses halfway, so the highlight tracks the thumb; `index` moves when the
   * pager settles, and is what decides which feed is counting reads and
   * measuring ads. Tying both to the settle made the rail feel a beat late.
   */
  const [railIndex, setRailIndex] = useState(0);
  /**
   * Which pages have ever been visited.
   *
   * PagerView keeps all its children in the React tree, so without this every
   * category mounts a feed on launch: seven simultaneous requests before the
   * reader has seen anything, and seven lists to reconcile on every swipe.
   *
   * Pages mount on first arrival and then STAY mounted — unmounting would throw
   * away the reader's scroll position in a category they are moving between,
   * which is the thing that makes a pager feel disposable.
   */
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const pager = useRef<CategoryPagerHandle>(null);

  /**
   * Load the real sections, and try again when the network comes back.
   *
   * Fetched once on mount was not enough. A reader who opens the app before
   * the connection settles — or while the server is down — kept whatever the
   * first attempt produced for the whole session, with no way to recover but
   * force-closing the app. Retrying on `online` costs one request and removes
   * the only state this screen could get permanently stuck in.
   */
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  useEffect(() => {
    if (categoriesLoaded || !online) return;
    let cancelled = false;

    fetchCategories()
      .then((c) => {
        if (cancelled || c.length === 0) return;
        setCategories(c);
        setCategoriesLoaded(true);
      })
      // Non-fatal: the bootstrap rail above is already usable, and this runs
      // again the next time connectivity returns.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [online, categoriesLoaded]);

  /** Rail tap → jump the pager. The pager's own callback then updates `index`,
   *  so tap and swipe converge on one source of truth. */
  const selectByTap = useCallback(
    (slug: string) => {
      const next = categories.findIndex((c) => c.slug === slug);
      if (next < 0) return;
      // Highlight immediately; the pager animates and its own callbacks follow.
      // Waiting for the animation to finish before moving the highlight is what
      // makes a tap feel unacknowledged.
      setRailIndex(next);
      pager.current?.setPage(next);
    },
    // Deliberately NOT dependent on `index`: a callback that changes on every
    // page change defeats the rail's memoisation.
    [categories],
  );

  const labelLang = languages.includes('ne') ? 'ne' : 'en';
  const activeSlug = categories[railIndex]?.slug ?? 'top';

  /**
   * Called when the pager settles on a new page.
   *
   * The neighbours are marked visited at the same time so the NEXT swipe finds
   * its page already mounted and shows cards immediately rather than a
   * skeleton — the pager's own `offscreenPageLimit` keeps the native views
   * alive, and this keeps the React side in step with it.
   */
  const onPageChange = useCallback((i: number) => {
    setRailIndex(i);
    setIndex((prev) => {
      // A selection tick on arrival gives the horizontal swipe a physical
      // answer, the same way the vertical card snap does.
      if (i !== prev) void Haptics.selectionAsync();
      return i;
    });
    setVisited((prev) => {
      if (prev.has(i) && prev.has(i - 1) && prev.has(i + 1)) return prev;
      const next = new Set(prev);
      next.add(i);
      next.add(i - 1);
      next.add(i + 1);
      return next;
    });
  }, []);

  // Mounting the first neighbour on arrival, not during the swipe, keeps the
  // gesture itself free of any mount work.
  useEffect(() => {
    setVisited((prev) => (prev.has(1) ? prev : new Set([...prev, 1])));
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      <CategoryRail
        categories={categories}
        active={activeSlug}
        onSelect={selectByTap}
        theme={theme}
        labelLang={labelLang}
      />

      <CategoryPager
        ref={pager}
        initialPage={0}
        onPageChange={onPageChange}
        onPageApproaching={setRailIndex}
      >
        {categories.map((c, i) => (
          // `key` must be the slug: PagerView keeps children mounted, and a
          // positional key would recycle one category's list into another.
          <View key={c.slug} style={styles.page} collapsable={false}>
            {visited.has(i) ? (
              <CategoryFeed
                category={c.slug}
                languages={languages}
                theme={theme}
                textScale={textScale}
                dataSaver={dataSaver}
                height={pageHeight}
                labelLang={labelLang}
                active={i === index}
                onMenu={setMenuCard}
              />
            ) : (
              // An unvisited page is a plain surface, not a skeleton: a skeleton
              // implies something is loading, and nothing is — the reader has
              // not asked for this category yet.
              <View style={[styles.page, { backgroundColor: theme.surface }]} />
            )}
          </View>
        ))}
      </CategoryPager>

      <CardMenu
        visible={menuCard !== null}
        card={menuCard}
        theme={theme}
        lang={labelLang}
        onClose={() => setMenuCard(null)}
        onNotInterested={(c) => filters.muteCategory(c.category.slug)}
        onHideSource={(c) => filters.muteSource(c.source.name)}
      />

      <NotifPrompt theme={theme} lang={labelLang} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
});
