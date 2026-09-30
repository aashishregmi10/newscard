import { memo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { blurHashAverageColor, resolveMediaUrl, type AdCard } from '../api/client';
import { LINE_HEIGHT, TYPE, fontFor, type Theme } from '../theme/tokens';

/**
 * A sponsored card: the advertiser's poster, filling the card.
 *
 * ── Why a poster, and why it is shown whole ─────────────────────────────────
 * Most local businesses already have a designed poster, and it says what they
 * want said better than a headline and a paragraph would. It is shown at its
 * own shape, letterboxed on a dark ground, never cropped: a poster's price and
 * phone number sit at its edges, which is exactly what a crop removes.
 *
 * ── Why it still cannot be mistaken for a story ─────────────────────────────
 * The commercial temptation is to make an ad indistinguishable from editorial,
 * because it performs better. It is also the fastest way to destroy the thing
 * being sold: a reader who discovers they were fooled stops trusting every
 * card, including the real ones. So:
 *
 *   • a "Sponsored" chip in the reader's language, top of the card
 *   • the advertiser's real name beside it, where a publisher's would sit
 *   • a tinted leading edge
 *   • a button, which no story has
 *
 * It is excluded from "cards read" for the notification prompt, and from the
 * bookmark and share actions. An ad is not a story and should not behave like
 * one anywhere.
 *
 * ── Where a tap goes ────────────────────────────────────────────────────────
 * Anywhere on the card opens the advertiser's page OUTSIDE the app, in the
 * phone's browser. The click is reported first: once the browser takes over,
 * the app may be backgrounded before a queued event is ever sent.
 *
 * ── On data saver ───────────────────────────────────────────────────────────
 * The poster is the heaviest thing on the card, and a reader who asked to save
 * data did not ask to spend it on advertising. They get the advertiser's
 * one-line description and the button instead.
 */

interface Props {
  ad: AdCard;
  theme: Theme;
  height: number;
  textScale: number;
  dataSaver: boolean;
  lang: 'ne' | 'en';
  onClick: (ad: AdCard) => void;
}

const SPONSORED = { ne: 'प्रायोजित', en: 'Sponsored' } as const;
const DISCLOSURE = {
  ne: 'यो विज्ञापन हो। सम्पादकीय सामग्री होइन।',
  en: 'This is an advertisement, not editorial content.',
} as const;

function SponsoredCardInner({ ad, theme, height, textScale, dataSaver, lang, onClick }: Props) {
  const [failed, setFailed] = useState(false);
  const poster = resolveMediaUrl(ad.image?.urls.lg ?? ad.image?.urls.md ?? ad.image?.urls.sm ?? null);
  const showPoster = !dataSaver && poster !== null && !failed;

  const lh = LINE_HEIGHT[ad.language];
  const fontFamily = fontFor(ad.language);
  const headlineSize = TYPE.headline.size * textScale;
  const bodySize = TYPE.summary.size * textScale;
  const ground = blurHashAverageColor(ad.image?.blurHash ?? null) ?? '#0f1113';

  const open = () => {
    onClick(ad);
    void Linking.openURL(ad.landingUrl);
  };

  return (
    <Pressable
      onPress={open}
      style={[styles.card, { height, backgroundColor: theme.surface }]}
      accessibilityRole="link"
      accessibilityLabel={`${SPONSORED[lang]}: ${ad.advertiser}. ${ad.headline}. ${ad.callToAction[lang]}`}
    >
      {/* Tinted leading edge — a second, non-textual signal that this is not
          editorial, visible even at a glance while scrolling. */}
      <View style={[styles.edge, { backgroundColor: theme.accent }]} />

      <View style={[styles.badgeRow, { borderBottomColor: theme.divider }]}>
        <View style={[styles.badge, { borderColor: theme.accent }]}>
          <MaterialCommunityIcons name="bullhorn-outline" size={12} color={theme.accent} />
          <Text style={[styles.badgeText, { color: theme.accent }]}>{SPONSORED[lang]}</Text>
        </View>
        <Text style={[styles.advertiser, { color: theme.textSecondary }]} numberOfLines={1}>
          {ad.advertiser}
        </Text>
      </View>

      {showPoster ? (
        <View style={[styles.posterFrame, { backgroundColor: ground }]}>
          <Image
            source={{ uri: poster }}
            style={styles.poster}
            resizeMode="contain"
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : (
        /* No poster to show — data saver, a failed load, or an ad without one.
           The description stands in for it, in the ad's own language. */
        <View style={styles.textBody}>
          <Text
            style={[
              styles.headline,
              {
                color: theme.textPrimary,
                fontSize: headlineSize,
                lineHeight: headlineSize * TYPE.headline.lineHeight,
                fontFamily,
              },
            ]}
            numberOfLines={4}
          >
            {ad.headline}
          </Text>
          {ad.body !== '' && (
            <Text
              style={[
                styles.text,
                { color: theme.textSecondary, fontSize: bodySize, lineHeight: bodySize * lh, fontFamily },
              ]}
            >
              {ad.body}
            </Text>
          )}
        </View>
      )}

      <Text style={[styles.disclosure, { color: theme.textSecondary }]}>{DISCLOSURE[lang]}</Text>

      {/* The button is part of the one tap target, not a second one: the whole
          card opens the page, and this is the affordance that says so. */}
      <View style={[styles.cta, { backgroundColor: theme.accent }]}>
        <Text style={styles.ctaText}>{ad.callToAction[lang]}</Text>
        <MaterialCommunityIcons name="open-in-new" size={16} color="#fff" />
      </View>
    </Pressable>
  );
}

/** Same reasoning as NewsCard: stable props, re-rendered by any parent change. */
export const SponsoredCard = memo(SponsoredCardInner);

const styles = StyleSheet.create({
  card: { justifyContent: 'flex-start' },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, zIndex: 5 },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    height: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6 },
  advertiser: { fontSize: 12.5, fontWeight: '600', flexShrink: 1, marginLeft: 10 },
  posterFrame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  poster: { width: '100%', height: '100%' },
  textBody: { flex: 1, paddingHorizontal: 18, paddingTop: 22, justifyContent: 'center' },
  headline: { fontWeight: '600', marginBottom: 12 },
  text: { marginBottom: 14 },
  disclosure: { fontSize: 11, marginTop: 10, marginHorizontal: 18, opacity: 0.8 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: 22,
    paddingVertical: 14,
    borderRadius: 26,
  },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
});
