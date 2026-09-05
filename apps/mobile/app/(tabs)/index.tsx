import { useState, useEffect, useCallback, useRef } from 'react';
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
import { fetchFeed, fetchCategories, FeedError, type Card } from '../../src/api/client';
import { useSettings } from '../../src/state/SettingsContext';

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
  const { theme, textScale, dataSaver, languages, isDark } = useSettings();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const railH = 52;
  const tabBarH = 58;
  const [listH, setListH] = useState(
    Math.round(height - insets.top - railH - tabBarH),
  );

  const [categories, setCategories] = useState<CategoryOption[]>(FALLBACK_CATEGORIES);
  const [category, setCategory] = useState('top');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<FlatList<Card>>(null);
  const cursor = useRef<string | null>(null);
  const hasMore = useRef(true);
  const loadingMore = useRef(false);

  useEffect(() => {
    fetchCategories()
      .then((c) => {
        if (c.length) setCategories(c);
      })
      // A failed category list is not fatal — the feed still works on `top`.
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setCards(null);
      setError(null);
      try {
        const page = await fetchFeed({ languages, category, limit: 20 });
        setCards(page.items);
        cursor.current = page.nextCursor;
        hasMore.current = page.hasMore;
      } catch (e) {
        const fe = e instanceof FeedError ? e : null;
        setError({ kind: fe?.kind ?? 'server', message: fe?.message ?? 'Something went wrong.' });
        if (mode === 'initial') setCards([]);
      } finally {
        setRefreshing(false);
      }
    },
    [languages, category],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore.current || !cursor.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchFeed({ languages, category, cursor: cursor.current, limit: 20 });
      setCards((prev) => [...(prev ?? []), ...page.items]);
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
    } catch {
      // Silent. The reader still has everything above; a toast would interrupt
      // reading to report something they never asked for.
    } finally {
      loadingMore.current = false;
    }
  }, [languages, category]);

  const selectCategory = (slug: string) => {
    if (slug === category) return;
    setCategory(slug);
    cursor.current = null;
    hasMore.current = true;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const labelLang = languages.includes('ne') ? 'ne' : 'en';

  return (
    <View style={[styles.root, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      <CategoryRail
        categories={categories}
        active={category}
        onSelect={selectCategory}
        theme={theme}
        labelLang={labelLang}
      />

      {error && cards && cards.length > 0 && (
        <View style={[styles.banner, { backgroundColor: theme.surfaceRaised }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5 }}>
            {error.kind === 'offline' ? 'You are offline. Showing saved stories.' : error.message}
          </Text>
        </View>
      )}

      {cards === null ? (
        <CardSkeleton theme={theme} height={listH} />
      ) : cards.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
            {error ? 'Could not load stories' : 'Nothing here yet'}
          </Text>
          <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
            {error?.message ?? 'This category has no stories right now.'}
          </Text>
          <Pressable
            style={[styles.retry, { borderColor: theme.divider }]}
            onPress={() => void load('initial')}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        /* One swipe = one card, like Reels. `disableIntervalMomentum` is what
         * enforces it: pagingEnabled and snapToInterval only decide where a
         * scroll RESTS, so without it a fling keeps momentum and travels several
         * cards. The interval is measured by onLayout rather than computed,
         * because a one-pixel error accumulates into visible misalignment. */
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
              isDark={isDark}
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
              onRefresh={() => void load('refresh')}
              tintColor={theme.textSecondary}
            />
          }
        />
      )}
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
