import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { VideoCard } from '../../src/components/VideoCard';
import { failureText, fetchVideos, FeedError, type VideoCard as VideoCardType } from '../../src/api/client';
import { useSettings } from '../../src/state/SettingsContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { textSize } from '../../src/theme/tokens';
import { useMeasuredHeight } from '../../src/hooks/useMeasuredHeight';

/**
 * The shorts tab.
 *
 * Vertical, one short per screen, same snap behaviour as the reading feed — the
 * gesture a reader already knows from the other tab, and from every other
 * short-video product they use.
 *
 * ── Two things it does that a naive version would not ───────────────────────
 *
 * Only the visible short plays. Every mounted player otherwise decodes at once,
 * which stutters on the hardware this app targets and downloads clips nobody
 * watches.
 *
 * Everything pauses when the tab loses focus. Leaving audio playing behind
 * another screen is the kind of thing that gets an app uninstalled, and
 * `useFocusEffect` is what makes the tab bar's own navigation trigger it.
 */

/** Module-level: FlatList reads this once, and a fresh object each render is waste. */
const VIEWABILITY = { itemVisiblePercentThreshold: 80 } as const;

export default function VideosScreen() {
  const { theme, textScale, dataSaver, languages, shortsMuted, setShortsMuted } = useSettings();
  const { unmetered } = useNetwork();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Measured, not computed — see useMeasuredHeight.
  const [pageHeight, onListLayout] = useMeasuredHeight(height - insets.top - insets.bottom - 64);

  const [items, setItems] = useState<VideoCardType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Shown for a moment when a pull could not reach the server. */
  const [refreshFailed, setRefreshFailed] = useState(false);

  const list = useRef<FlatList<VideoCardType>>(null);
  const cursor = useRef<string | null>(null);
  const hasMore = useRef(true);
  const loadingMore = useRef(false);

  const ne = languages.includes('ne');

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await fetchVideos({ languages, limit: 10 });
      setItems(page.items);
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
      setActiveId(page.items[0]?.id ?? null);
    } catch (e) {
      const fe = e instanceof FeedError ? e : null;
      setError(failureText(fe?.kind, languages.includes('ne') ? 'ne' : 'en'));
      setItems([]);
    }
  }, [languages]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Pull down on the first short for the newest ones.
   *
   * The shorts on screen stay until the new page has arrived, so the pull
   * never empties the screen. If it fails, they stay and a line says so.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const page = await fetchVideos({ languages, limit: 10, fresh: true });
      setItems(page.items);
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
      setActiveId(page.items[0]?.id ?? null);
      list.current?.scrollToOffset({ offset: 0, animated: false });
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [languages]);

  useEffect(() => {
    if (!refreshFailed) return;
    const t = setTimeout(() => setRefreshFailed(false), 3000);
    return () => clearTimeout(t);
  }, [refreshFailed]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={refresh}
        // Light on the black of this tab, and a raised disc on Android so the
        // spinner reads against footage.
        tintColor="#fff"
        colors={[theme.accent]}
        progressBackgroundColor={theme.surfaceRaised}
      />
    ),
    [refreshing, refresh, theme.accent, theme.surfaceRaised],
  );

  // Nothing plays while the reader is on another tab.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  /*
   * Nor once the app is in the background — Home, the lock button, another
   * app. YouTube's terms forbid background playback, and Google Play holds
   * apps to them. Going inactive takes the player off the page entirely
   * rather than asking it to pause: a WebView in a backgrounded app may never
   * run the pause, and a player that is gone is certainly silent. On return
   * it loads again where the reader was.
   */
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  const live = focused && foreground;

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore.current || !cursor.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchVideos({ languages, cursor: cursor.current, limit: 10 });
      setItems((prev) => [...(prev ?? []), ...page.items]);
      cursor.current = page.nextCursor;
      hasMore.current = page.hasMore;
    } catch {
      // Silent: the reader still has everything above.
    } finally {
      loadingMore.current = false;
    }
  }, [languages]);

  /** Held in a ref and never replaced — FlatList throws on a changed handler. */
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.item as VideoCardType | undefined;
    if (first) setActiveId(first.id);
  }).current;

  /*
   * Sound: on unless the reader turns it off, and their choice holds for every
   * short after — and after a restart — until they change it. It lives in the
   * settings for that reason (SettingsContext.shortsMuted).
   */
  const muted = shortsMuted;
  const toggleMute = useCallback(() => setShortsMuted(!shortsMuted), [setShortsMuted, shortsMuted]);

  /* The short after the one on screen gets its player ready in advance, so a
     swipe starts it at once instead of showing a spinner (YouTubeShortCard). */
  const activeIndex = useMemo(
    () => (items === null || activeId === null ? -1 : items.findIndex((v) => v.id === activeId)),
    [items, activeId],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<VideoCardType>) => (
      <VideoCard
        video={item}
        theme={theme}
        height={pageHeight}
        textScale={textScale}
        dataSaver={dataSaver}
        unmetered={unmetered}
        active={live && item.id === activeId}
        preload={live && activeIndex >= 0 && index === activeIndex + 1}
        muted={muted}
        onToggleMute={toggleMute}
      />
    ),
    [theme, pageHeight, textScale, dataSaver, unmetered, live, activeId, activeIndex, muted, toggleMute],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<VideoCardType> | null | undefined, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight],
  );

  if (items === null) {
    return (
      <View style={[styles.fill, styles.centre, { backgroundColor: theme.surface }]}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.fill, styles.centre, { backgroundColor: theme.surface, padding: 32 }]}>
        <MaterialCommunityIcons name="video-off-outline" size={34} color={theme.textSecondary} />
        <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
          {error
            ? ne
              ? 'भिडियो ल्याउन सकिएन'
              : 'Could not load videos'
            : ne
              ? 'अहिले कुनै भिडियो छैन'
              : 'No videos yet'}
        </Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
          {error ?? (ne ? 'नयाँ भिडियो आएपछि यहाँ देखिनेछ।' : 'New shorts will appear here.')}
        </Text>
        <Pressable
          style={[styles.retry, { borderColor: theme.divider }]}
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel={ne ? 'भिडियो पुनः लोड गर्नुहोस्' : 'Reload shorts'}
        >
          <Text style={{ color: theme.accent, fontWeight: '600' }}>
            {ne ? 'पुनः प्रयास' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000', paddingTop: insets.top }]}>
      {/* Told once, and only when it matters: with Data Saver on, nothing has
          been downloaded yet and tapping is what spends it. */}
      {refreshFailed ? (
        <View style={styles.dataNote}>
          <MaterialCommunityIcons name="wifi-off" size={13} color="rgba(255,255,255,0.8)" />
          <Text style={styles.dataNoteText}>
            {ne ? 'नयाँ भिडियो ल्याउन सकिएन' : 'Could not get new videos'}
          </Text>
        </View>
      ) : dataSaver && (
        <View style={styles.dataNote}>
          <MaterialCommunityIcons name="information-outline" size={13} color="rgba(255,255,255,0.8)" />
          <Text style={styles.dataNoteText}>
            {ne ? 'डाटा सेभर — चलाउन ट्याप गर्नुहोस्' : 'Data Saver — tap to play'}
          </Text>
        </View>
      )}

      <FlatList
        ref={list}
        style={styles.fill}
        onLayout={onListLayout}
        refreshControl={refreshControl}
        data={items}
        keyExtractor={(v) => v.id}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={pageHeight}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        // One short either side, and no more. Video is the most expensive thing
        // this app can hold in memory.
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        // Not clipped: the next short is off screen while its player gets
        // ready, and a web view detached from the window is not reliably
        // loading. With three cards mounted at most, clipping saves nothing.
        removeClippedSubviews={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: textSize(17), fontWeight: '600', marginTop: 14, marginBottom: 6 },
  emptyBody: { fontSize: textSize(14), textAlign: 'center', marginBottom: 18 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },

  dataNote: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dataNoteText: { color: 'rgba(255,255,255,0.85)', fontSize: textSize(12) },
});
