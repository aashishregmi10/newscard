import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Platform,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { NewsCard } from './NewsCard';
import { CardSkeleton } from './CardSkeleton';
import { SponsoredCard } from './SponsoredCard';
import { useFeed } from '../hooks/useFeed';
import { useFilters } from '../state/FiltersContext';
import { useDevice } from '../state/DeviceContext';
import { isAd, type AdCard, type Card, type FeedEntry } from '../api/client';
import {
  noteAdVisible,
  noteAdHidden,
  noteAdClick,
  flushAdEvents,
  setAdDeviceId,
} from '../lib/adTracker';
import type { Theme } from '../theme/tokens';

/**
 * One category's vertical card feed — a single page inside the horizontal
 * CategoryPager.
 *
 * Extracted from the screen so each category owns its own scroll position,
 * cursor and cache state. Swiping back to नेपाल returns to where the reader
 * was, instead of resetting to the top.
 */

/**
 * A card counts as read only once it has settled and been on screen a moment —
 * flicking past ten is not reading ten (Ch. 7.4).
 *
 * Module-level because FlatList captures this on mount; a fresh object literal
 * each render is both wasted work and, for onViewableItemsChanged, an outright
 * invariant violation.
 */
const VIEWABILITY = { itemVisiblePercentThreshold: 90, minimumViewTime: 800 } as const;

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

function CategoryFeedInner({
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
  /** Ad ids on screen at the last viewability change, so we can tell which ones
   *  have since scrolled away and close out their dwell. */
  const visibleAds = useRef<Set<string>>(new Set());

  /**
   * `active` read through a ref, not the closure.
   *
   * FlatList captures onViewableItemsChanged once and treats a later identity
   * change as an invariant violation. Keeping the callback stable means it
   * cannot close over `active`, so the current value is read from here instead.
   */
  const activeRef = useRef(active);
  activeRef.current = active;
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const noteCardReadRef = useRef(device.noteCardRead);
  noteCardReadRef.current = device.noteCardRead;

  const { cards: raw, status, error, fromCache, refreshing, reload, refresh, loadMore } = useFeed(
    languages,
    category,
  );

  // Mute filters are editorial — an ad has neither a category the reader chose
  // to mute nor a publisher they distrust, so it passes through unexamined.
  //
  // Memoised because a new array identity on every render makes FlatList
  // rebuild its cells, and this component re-renders on every horizontal swipe.
  const cards: FeedEntry[] | null = useMemo(
    () => raw?.filter((c) => isAd(c) || !filters.isMuted(c.category.slug, c.source.name)) ?? null,
    [raw, filters],
  );

  useEffect(() => {
    setAdDeviceId(device.deviceId);
  }, [device.deviceId]);

  // Leaving the category (or the screen) closes out anything still on screen.
  // Without this an ad the reader was looking at when they swiped away is never
  // reported, and the advertiser is under-credited for a real impression.
  useEffect(
    () => () => {
      visibleAds.current.clear();
      void flushAdEvents();
    },
    [],
  );

  useEffect(() => {
    if (!active) {
      for (const id of visibleAds.current) noteAdHidden(id);
      visibleAds.current.clear();
    }
  }, [active]);

  /* ----------------------------------------------------------- list plumbing
   *
   * Every prop below is memoised on purpose. This component re-renders on each
   * horizontal swipe (its `active` prop flips), and a FlatList handed a fresh
   * renderItem or getItemLayout closure rebuilds every visible cell. Seven
   * categories doing that at once, mid-animation, is exactly the stutter a
   * reader feels as "the tabs are laggy".
   */

  const keyExtractor = useCallback((e: FeedEntry) => e.id, []);

  const handleAdClick = useCallback(
    (ad: AdCard) => {
      noteAdClick(ad, category);
    },
    [category],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FeedEntry>) =>
      isAd(item) ? (
        <SponsoredCard
          ad={item}
          theme={theme}
          height={height}
          textScale={textScale}
          dataSaver={dataSaver}
          lang={item.language}
          onClick={handleAdClick}
        />
      ) : (
        <NewsCard
          card={item}
          theme={theme}
          height={height}
          textScale={textScale}
          dataSaver={dataSaver}
          onMenu={onMenu}
        />
      ),
    [theme, height, textScale, dataSaver, handleAdClick, onMenu],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<FeedEntry> | null | undefined, index: number) => ({
      length: height,
      offset: height * index,
      index,
    }),
    [height],
  );

  /**
   * Held in a ref and never replaced. FlatList throws on a changed
   * onViewableItemsChanged, so this reads everything it needs from refs rather
   * than from the render closure.
   */
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (!activeRef.current) return;

    const nowVisible = new Set<string>();
    for (const v of viewableItems) {
      const item = v.item as FeedEntry | undefined;
      if (!item) continue;

      if (isAd(item)) {
        // An ad is not a story: it never counts towards "cards read", the
        // signal that decides when to ask for notification permission.
        // Counting it would let advertising buy its way to a prompt.
        nowVisible.add(item.id);
        noteAdVisible(item, categoryRef.current);
        continue;
      }

      if (!counted.current.has(item.id)) {
        counted.current.add(item.id);
        noteCardReadRef.current();
      }
    }

    for (const id of visibleAds.current) {
      if (!nowVisible.has(id)) noteAdHidden(id);
    }
    visibleAds.current = nowVisible;
  }).current;

  const refreshControl = useMemo(
    () => (
      <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.textSecondary} />
    ),
    [refreshing, refresh, theme.textSecondary],
  );

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
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        snapToInterval={height}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        getItemLayout={getItemLayout}
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        refreshControl={refreshControl}
        /* Cards are full-screen, so the defaults (10 initial, window of 21) mount
         * roughly twenty screens of content per category — multiplied by every
         * mounted category. These keep one screen either side ready and no more,
         * which is what the snap interval actually needs. */
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={60}
        windowSize={3}
        /* Android only: detaches views scrolled out of the window, which is the
         * single biggest win on the entry-level devices this app targets. */
        removeClippedSubviews={Platform.OS === 'android'}
      />
    </View>
  );
}

/**
 * Memoised because the feed screen re-renders every category on each swipe.
 * Without this, moving from नेपाल to राजनीति re-renders all seven lists during
 * the settle animation, and the reader feels it as a hitch on arrival.
 *
 * Only `active` differs between renders for the two pages involved, and the
 * list props above are stable, so a re-render costs almost nothing.
 */
export const CategoryFeed = memo(CategoryFeedInner);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: { paddingHorizontal: 16, paddingVertical: 7 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },
});
