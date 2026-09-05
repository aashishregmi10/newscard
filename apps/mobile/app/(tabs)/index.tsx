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

const FALLBACK_CATEGORIES: CategoryOption[] = [
  { slug: 'top', label: { ne: 'मुख्य समाचार', en: 'Top Stories' } },
];

export default function FeedScreen() {
  const { theme, textScale, dataSaver, languages } = useSettings();
  const filters = useFilters();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const railH = 52;
  const tabBarH = 58;
  const pageHeight = Math.round(height - insets.top - railH - tabBarH);

  const [categories, setCategories] = useState<CategoryOption[]>(FALLBACK_CATEGORIES);
  const [index, setIndex] = useState(0);
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const pager = useRef<CategoryPagerHandle>(null);

  useEffect(() => {
    // Non-fatal: the feed still works on `top` if this never resolves.
    fetchCategories()
      .then((c) => c.length && setCategories(c))
      .catch(() => undefined);
  }, []);

  /** Rail tap → jump the pager. The pager's own callback then updates `index`,
   *  so tap and swipe converge on one source of truth. */
  const selectByTap = useCallback(
    (slug: string) => {
      const next = categories.findIndex((c) => c.slug === slug);
      if (next >= 0 && next !== index) pager.current?.setPage(next);
    },
    [categories, index],
  );

  const labelLang = languages.includes('ne') ? 'ne' : 'en';
  const activeSlug = categories[index]?.slug ?? 'top';

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
        onPageChange={(i) => {
          // A selection tick on arrival gives the horizontal swipe a physical
          // answer, the same way the vertical card snap does.
          if (i !== index) void Haptics.selectionAsync();
          setIndex(i);
        }}
      >
        {categories.map((c, i) => (
          // `key` must be the slug: PagerView keeps children mounted, and a
          // positional key would recycle one category's list into another.
          <View key={c.slug} style={styles.page} collapsable={false}>
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
