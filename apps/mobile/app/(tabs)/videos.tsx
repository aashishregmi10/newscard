import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { VideoCard } from '../../src/components/VideoCard';
import { fetchVideos, FeedError, type VideoCard as VideoCardType } from '../../src/api/client';
import { useSettings } from '../../src/state/SettingsContext';
import { useNetwork } from '../../src/state/NetworkContext';

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

export default function VideosScreen() {
  const { theme, textScale, dataSaver, languages } = useSettings();
  const { unmetered } = useNetwork();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const tabBarH = 58;
  const pageHeight = Math.round(height - insets.top - tabBarH);

  const [items, setItems] = useState<VideoCardType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [focused, setFocused] = useState(true);

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
      setError(fe?.message ?? 'Something went wrong.');
      setItems([]);
    }
  }, [languages]);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing plays while the reader is on another tab.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<VideoCardType>) => (
      <VideoCard
        video={item}
        theme={theme}
        height={pageHeight}
        textScale={textScale}
        dataSaver={dataSaver}
        unmetered={unmetered}
        active={focused && item.id === activeId}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
      />
    ),
    [theme, pageHeight, textScale, dataSaver, unmetered, focused, activeId, muted],
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
        <Pressable style={[styles.retry, { borderColor: theme.divider }]} onPress={() => void load()}>
          <Text style={{ color: theme.accent, fontWeight: '600' }}>
            {ne ? 'पुनः प्रयास' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000', paddingTop: insets.top }]}>
      {/* Told once, and only when it matters: on mobile data nothing has been
          downloaded yet and tapping is what spends it. */}
      {!unmetered && (
        <View style={styles.dataNote}>
          <MaterialCommunityIcons name="information-outline" size={13} color="rgba(255,255,255,0.8)" />
          <Text style={styles.dataNoteText}>
            {ne
              ? 'मोबाइल डाटामा — चलाउन ट्याप गर्नुहोस्'
              : 'On mobile data — tap to play'}
          </Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(v) => v.id}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={pageHeight}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        onViewableItemsChanged={onViewableItemsChanged}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        // One short either side, and no more. Video is the most expensive thing
        // this app can hold in memory.
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        removeClippedSubviews={Platform.OS === 'android'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
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
  dataNoteText: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
});
