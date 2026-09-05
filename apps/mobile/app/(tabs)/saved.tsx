import { View, Text, FlatList, StyleSheet, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../../src/state/SettingsContext';
import { useBookmarks } from '../../src/state/BookmarksContext';
import { blurHashAverageColor } from '../../src/api/client';
import { relativeTime } from '../../src/lib/relativeTime';

/**
 * Saved stories.  Spec Ch. 9.4.
 *
 * A list rather than the swipe deck: this is a "find the thing I saved" surface,
 * and paging through full-screen cards to locate one is the wrong shape.
 *
 * The full card was stored at bookmark time, so this screen works with no
 * network at all — which is the entire point of a bookmark.
 */
export default function SavedScreen() {
  const { theme, languages } = useSettings();
  const { items, remove, ready } = useBookmarks();
  const insets = useSafeAreaInsets();
  const lang = languages.includes('ne') ? 'ne' : 'en';

  return (
    <View style={[styles.root, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          {lang === 'ne' ? 'सुरक्षित' : 'Saved'}
        </Text>
        {items.length > 0 && (
          <Text style={[styles.count, { color: theme.textSecondary }]}>{items.length}</Text>
        )}
      </View>

      {!ready ? (
        <View style={styles.centre} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
            {lang === 'ne' ? 'केही सुरक्षित छैन' : 'Nothing saved yet'}
          </Text>
          <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
            {lang === 'ne'
              ? 'कार्डमा ♡ थिचेर समाचार सुरक्षित गर्नुहोस्। सुरक्षित समाचार इन्टरनेट नभए पनि पढ्न सकिन्छ।'
              : 'Tap ♡ on a card to save it. Saved stories can be read without a connection.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 14, gap: 10 }}
          renderItem={({ item }) => {
            const when = item.sourcePublishedAt ?? item.publishedAt;
            return (
              <Pressable
                style={[styles.row, { borderColor: theme.divider, backgroundColor: theme.surfaceRaised }]}
                onPress={() => void Linking.openURL(item.publisherUrl)}
              >
                <View
                  style={[
                    styles.thumb,
                    { backgroundColor: blurHashAverageColor(item.image?.blurHash) ?? theme.divider },
                  ]}
                />
                <View style={styles.rowBody}>
                  {/* Devanagari needs more line height than Latin, or vowel
                      marks from one line collide with the next (Ch. 11.6). On
                      web this would be a `lang` attribute; React Native has no
                      such prop, so the value is applied directly. */}
                  <Text
                    style={[
                      styles.rowHead,
                      { color: theme.textPrimary, lineHeight: item.language === 'ne' ? 23 : 20 },
                    ]}
                    numberOfLines={3}
                  >
                    {item.headline}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                    {relativeTime(new Date(when), item.language)} · {item.source.name}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => remove(item.id)}
                  accessibilityLabel="Remove from saved"
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 17 }}>✕</Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '700' },
  count: { fontSize: 14 },
  centre: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  thumb: { width: 58, height: 58, borderRadius: 8 },
  rowBody: { flex: 1 },
  rowHead: { fontSize: 14.5, fontWeight: '600', lineHeight: 20, marginBottom: 4 },
  rowMeta: { fontSize: 12 },
});
