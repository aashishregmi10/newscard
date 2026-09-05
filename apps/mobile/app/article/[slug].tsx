import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NewsCard } from '../../src/components/NewsCard';
import { CardSkeleton } from '../../src/components/CardSkeleton';
import { fetchArticle, ArticleGoneError, type Card } from '../../src/api/client';
import { useSettings } from '../../src/state/SettingsContext';

/**
 * Deep-link target.  Spec Ch. 10.7, tested as N-09 in Ch. 16.10.
 *
 * `newscard://article/<slug>` — where a notification tap lands.
 *
 * This is the single most important path in the notification feature. A slow
 * or broken deep link wastes the one moment the reader actively chose to come
 * back, and it is the loudest complaint theme about competing products. The
 * budget is the card visible within 1200 ms on the reference device.
 */
export default function ArticleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { theme, textScale, dataSaver, languages } = useSettings();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [card, setCard] = useState<Card | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');

  const lang = languages.includes('ne') ? 'ne' : 'en';
  const cardHeight = height - insets.top - insets.bottom - 46;

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    fetchArticle(slug)
      .then((c) => {
        if (!alive) return;
        setCard(c);
        setState('ready');
      })
      .catch((e) => {
        if (!alive) return;
        // 410 is not 404. "We withdrew it" deserves an explanation; "never
        // existed" does not (Ch. 3.3.3).
        setState(e instanceof ArticleGoneError ? 'gone' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.root, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      <View style={[styles.bar, { borderBottomColor: theme.divider }]}>
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button">
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>
            {lang === 'ne' ? '← फिड' : '← Feed'}
          </Text>
        </Pressable>
      </View>

      {state === 'loading' && <CardSkeleton theme={theme} height={cardHeight} />}

      {state === 'ready' && card && (
        <NewsCard
          card={card}
          theme={theme}
          height={cardHeight}
          textScale={textScale}
          dataSaver={dataSaver}
        />
      )}

      {(state === 'gone' || state === 'error') && (
        <View style={styles.centre}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>
            {state === 'gone'
              ? lang === 'ne'
                ? 'यो समाचार हटाइएको छ'
                : 'This story was withdrawn'
              : lang === 'ne'
                ? 'समाचार ल्याउन सकिएन'
                : 'Could not open that story'}
          </Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {state === 'gone'
              ? lang === 'ne'
                ? 'सम्पादकीय कारणले यो समाचार फिर्ता लिइएको हो।'
                : 'It was retracted for editorial reasons.'
              : lang === 'ne'
                ? 'लिङ्क पुरानो हुन सक्छ।'
                : 'The link may be out of date.'}
          </Text>
          <Pressable style={[styles.btn, { borderColor: theme.divider }]} onPress={back}>
            <Text style={{ color: theme.accent, fontWeight: '600' }}>
              {lang === 'ne' ? 'फिडमा जानुहोस्' : 'Go to the feed'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },
});
