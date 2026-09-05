import { memo } from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardImage } from './CardImage';
import type { AdCard } from '../api/client';
import { LINE_HEIGHT, TYPE, type Theme } from '../theme/tokens';

/**
 * A sponsored card.
 *
 * ── Why it deliberately does NOT look like a story ──────────────────────────
 * The commercial temptation is to make an ad indistinguishable from editorial,
 * because it performs better. It is also the fastest way to destroy the thing
 * being sold: a reader who discovers they were fooled stops trusting every
 * card, including the real ones.
 *
 * So this card shares the story LAYOUT — same rhythm, same proportions, so the
 * feed does not jolt — while being unmistakably marked:
 *
 *   • a "Sponsored" chip in the accent colour, top of the card, before the
 *     headline is read
 *   • the advertiser's real name where a publisher's name would sit
 *   • a tinted edge down the leading side
 *   • an explicit call-to-action button, which no story has
 *
 * It is also excluded from "cards read" for the notification prompt, and from
 * the bookmark and share actions. An ad is not a story and should not behave
 * like one anywhere.
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

function SponsoredCardInner({ ad, theme, height, textScale, dataSaver, lang, onClick }: Props) {
  const lh = LINE_HEIGHT[ad.language];
  const bodySize = TYPE.summary.size * textScale;
  const headlineSize = TYPE.headline.size * textScale;

  const open = () => {
    onClick(ad);
    void Linking.openURL(ad.landingUrl);
  };

  return (
    <View style={[styles.card, { height, backgroundColor: theme.surface }]}>
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

      <CardImage
        image={
          ad.image
            ? { credit: '', blurHash: ad.image.blurHash, width: null, height: null, urls: ad.image.urls }
            : null
        }
        theme={theme}
        height={height * 0.34}
        dataSaver={dataSaver}
      />

      <View style={styles.body}>
        <Text
          style={[
            styles.headline,
            {
              color: theme.textPrimary,
              fontSize: headlineSize,
              lineHeight: headlineSize * TYPE.headline.lineHeight,
            },
          ]}
          numberOfLines={3}
        >
          {ad.headline}
        </Text>

        <Text
          style={[
            styles.text,
            { color: theme.textSecondary, fontSize: bodySize, lineHeight: bodySize * lh },
          ]}
        >
          {ad.body}
        </Text>

        <Text style={[styles.disclosure, { color: theme.textSecondary }]}>
          {lang === 'ne'
            ? 'यो विज्ञापन हो। सम्पादकीय सामग्री होइन।'
            : 'This is an advertisement, not editorial content.'}
        </Text>
      </View>

      {/* An explicit button, which no story has — the affordance itself
          distinguishes the card. */}
      <Pressable
        style={[styles.cta, { backgroundColor: theme.accent }]}
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={`${SPONSORED[lang]}: ${ad.callToAction[lang]}`}
      >
        <Text style={styles.ctaText}>{ad.callToAction[lang]}</Text>
        <MaterialCommunityIcons name="arrow-right" size={17} color="#fff" />
      </Pressable>
    </View>
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
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 18 },
  headline: { fontWeight: '600', marginBottom: 10 },
  text: { marginBottom: 14 },
  disclosure: { fontSize: 11, marginTop: 'auto', marginBottom: 14, opacity: 0.8 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 22,
    paddingVertical: 14,
    borderRadius: 26,
  },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
});
