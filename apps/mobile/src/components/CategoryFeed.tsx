import { useRef } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { NewsCard } from './NewsCard';
import { CardSkeleton } from './CardSkeleton';
import { useFeed } from '../hooks/useFeed';
import { useFilters } from '../state/FiltersContext';
import { useDevice } from '../state/DeviceContext';
import type { Card } from '../api/client';
import type { Theme } from '../theme/tokens';

/**
 * One category's vertical card feed — a single page inside the horizontal
 * CategoryPager.
 *
 * Extracted from the screen so each category owns its own scroll position,
 * cursor and cache state. Swiping back to नेपाल returns to where the reader
 * was, instead of resetting to the top.
 */

interface Props {
  category: string;
  languages: Array<'ne' | 'en'>;
  theme: Theme;
  textScale: number;
  dataSaver: boolean;
  height: number;
  labelLang: 'ne' | 'en';
  /** Only the visible page loads and counts reads. */
  active: boolean;
  onMenu: (card: Card) => void;
}

export function CategoryFeed({
  category,
  languages,
  theme,
  textScale,
  dataSaver,
  height,
  labelLang,
  active,
  onMenu,
}: Props) {
  const filters = useFilters();
  const device = useDevice();
  const counted = useRef<Set<string>>(new Set());

  const { cards: raw, status, error, fromCache, refreshing, reload, refresh, loadMore } = useFeed(
    languages,
    category,
  );

  const cards = raw?.filter((c) => !filters.isMuted(c.category.slug, c.source.name)) ?? null;

  const banner =
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

  if (status === 'loading' && !cards) {
    return <CardSkeleton theme={theme} height={height} />;
  }

  if (!cards || cards.length === 0) {
    return (
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
    );
  }

  return (
    <View style={styles.fill}>
      {banner && (
        <View style={[styles.banner, { backgroundColor: theme.surfaceRaised }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5 }}>{banner}</Text>
        </View>
      )}

      {/* One swipe = one card. `disableIntervalMomentum` is what enforces it:
       * pagingEnabled and snapToInterval only decide where a scroll RESTS, so
       * without it a fling keeps its momentum and travels several cards. */}
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <NewsCard
            card={item}
            theme={theme}
            height={height}
            textScale={textScale}
            dataSaver={dataSaver}
            onMenu={onMenu}
          />
        )}
        showsVerticalScrollIndicator={false}
        snapToInterval={height}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
        // A card counts as read only once it has settled and been on screen a
        // moment — flicking past ten is not reading ten (Ch. 7.4).
        viewabilityConfig={{ itemVisiblePercentThreshold: 90, minimumViewTime: 800 }}
        onViewableItemsChanged={({ viewableItems }) => {
          if (!active) return;
          for (const v of viewableItems) {
            const id = (v.item as Card | undefined)?.id;
            if (id && !counted.current.has(id)) {
              counted.current.add(id);
              device.noteCardRead();
            }
          }
        }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: { paddingHorizontal: 16, paddingVertical: 7 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },
});
