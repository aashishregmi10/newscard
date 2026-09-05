import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NewsCard } from '../../src/components/NewsCard';
import { CardSkeleton } from '../../src/components/CardSkeleton';
import { CategoryRail, type CategoryOption } from '../../src/components/CategoryRail';
import { CardMenu } from '../../src/components/CardMenu';
import { fetchCategories, type Card } from '../../src/api/client';
import { useFeed } from '../../src/hooks/useFeed';
import { useSettings } from '../../src/state/SettingsContext';
import { useFilters } from '../../src/state/FiltersContext';

/**
 * The feed.  Spec Ch. 7.1.
 *
 * Full-screen and vertically PAGED. Not free-scrolling: a free list lets the
 * reader park between two cards, halving the reading area, which reads as
 * broken. Paging guarantees whatever is on screen is one complete story.
 */

const FALLBACK_CATEGORIES: CategoryOption[] = [
  { slug: 'top', label: { ne: 'मुख्य समाचार', en: 'Top Stories' } },
];

export default function FeedScreen() {
  const { theme, textScale, dataSaver, languages } = useSettings();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const railH = 52;
  const tabBarH = 58;
  const [listH, setListH] = useState(Math.round(height - insets.top - railH - tabBarH));

  const [categories, setCategories] = useState<CategoryOption[]>(FALLBACK_CATEGORIES);
  const [category, setCategory] = useState('top');
  const listRef = useRef<FlatList<Card>>(null);

  const filters = useFilters();
  const [menuCard, setMenuCard] = useState<Card | null>(null);

  const { cards: rawCards, status, error, fromCache, refreshing, reload, refresh, loadMore } =
    useFeed(languages, category);

  // Applied client-side and immediately. "Not interested" must visibly change
  // the feed — a control that does nothing teaches the reader we ignore them
  // (Ch. 7.8).
  const cards = rawCards?.filter((c) => !filters.isMuted(c.category.slug, c.source.name)) ?? null;

  useEffect(() => {
    // Non-fatal: the feed still works on `top` if this never resolves.
    fetchCategories()
      .then((c) => c.length && setCategories(c))
      .catch(() => undefined);
  }, []);

  const selectCategory = (slug: string) => {
    if (slug === category) return;
    setCategory(slug);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const labelLang = languages.includes('ne') ? 'ne' : 'en';

  /** Shown only when there is something on screen to qualify. A banner over an
   *  empty view would just be a worse empty state. */
  const bannerText =
    cards && cards.length > 0
      ? error?.kind === 'offline'
        ? labelLang === 'ne'
          ? 'तपाईं अफलाइन हुनुहुन्छ। सुरक्षित समाचार देखाइँदै।'
          : 'You are offline. Showing saved stories.'
        : error
          ? error.message
          : fromCache
            ? labelLang === 'ne'
              ? 'सुरक्षित प्रतिलिपि देखाइँदै…'
              : 'Showing saved copy…'
            : null
      : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      <CategoryRail
        categories={categories}
        active={category}
        onSelect={selectCategory}
        theme={theme}
        labelLang={labelLang}
      />

      {bannerText && (
        <View style={[styles.banner, { backgroundColor: theme.surfaceRaised }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5 }}>{bannerText}</Text>
        </View>
      )}

      {status === 'loading' && !cards ? (
        <CardSkeleton theme={theme} height={listH} />
      ) : !cards || cards.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
            {error
              ? labelLang === 'ne'
                ? 'समाचार ल्याउन सकिएन'
                : 'Could not load stories'
              : labelLang === 'ne'
                ? 'यहाँ केही छैन'
                : 'Nothing here yet'}
          </Text>
          <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
            {error?.message ??
              (labelLang === 'ne'
                ? 'यो श्रेणीमा अहिले कुनै समाचार छैन।'
                : 'This category has no stories right now.')}
          </Text>
          <Pressable style={[styles.retry, { borderColor: theme.divider }]} onPress={reload}>
            <Text style={{ color: theme.accent, fontWeight: '600' }}>
              {labelLang === 'ne' ? 'पुनः प्रयास' : 'Try again'}
            </Text>
          </Pressable>
        </View>
      ) : (
        /* One swipe = one card, like Reels. `disableIntervalMomentum` is what
         * enforces it: pagingEnabled and snapToInterval only decide where a
         * scroll RESTS, so without it a fling keeps momentum and travels
         * several cards. The interval is measured by onLayout rather than
         * computed, because a one-pixel error accumulates into visible
         * misalignment after a dozen swipes. */
        <FlatList
          ref={listRef}
          data={cards}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <NewsCard
              card={item}
              theme={theme}
              height={listH}
              textScale={textScale}
              dataSaver={dataSaver}
              onMenu={setMenuCard}
            />
          )}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h > 0 && h !== listH) setListH(h);
          }}
          showsVerticalScrollIndicator={false}
          snapToInterval={listH}
          snapToAlignment="start"
          disableIntervalMomentum
          decelerationRate="fast"
          getItemLayout={(_, index) => ({ length: listH, offset: listH * index, index })}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.textSecondary}
            />
          }
        />
      )}

      <CardMenu
        visible={menuCard !== null}
        card={menuCard}
        theme={theme}
        lang={labelLang}
        onClose={() => setMenuCard(null)}
        onNotInterested={(c) => filters.muteCategory(c.category.slug)}
        onHideSource={(c) => filters.muteSource(c.source.name)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { paddingHorizontal: 16, paddingVertical: 7 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },
});
