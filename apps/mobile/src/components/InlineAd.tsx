import { memo } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { resolveMediaUrl, type InlineAd as InlineAdData } from '../api/client';
import { fontFor, type Theme } from '../theme/tokens';

/**
 * The small ad on a story: one line, in the row with save and share.
 *
 * ── How it is kept from reading as part of the story ─────────────────────────
 *
 * It sits in the row that carries the publisher's credit, which is exactly why
 * it has to be unmistakable. It is:
 *
 *   • labelled — "विज्ञापन" or "Ad", in the READER's language, before the text
 *   • outlined in the ad colour (theme.adMark), never the accent blue the
 *     publisher's name is set in
 *   • shorter than the credit is allowed to become: the publisher's name keeps
 *     its room and this line gives way, with an ellipsis, when space is short.
 *     Crediting the publisher is what the licence requires; the ad is what is
 *     negotiable.
 *
 * A tap opens the advertiser's page outside the app, in the phone's browser,
 * and is reported first — once the browser takes over, the app may never get
 * the chance.
 */

const LABEL = { ne: 'विज्ञापन', en: 'Ad' } as const;

interface Props {
  ad: InlineAdData;
  theme: Theme;
  /** The reader's language, for the label. The ad's own text is in its own. */
  lang: 'ne' | 'en';
  onPress: (ad: InlineAdData) => void;
}

function InlineAdInner({ ad, theme, lang, onPress }: Props) {
  const logo = resolveMediaUrl(ad.logo?.urls.sm ?? ad.logo?.urls.md ?? null);

  const open = () => {
    onPress(ad);
    void Linking.openURL(ad.landingUrl);
  };

  return (
    <Pressable
      onPress={open}
      hitSlop={{ top: 10, bottom: 10 }}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: theme.adMark, opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="link"
      accessibilityLabel={`${LABEL[lang]}: ${ad.advertiser}. ${ad.text}`}
    >
      {logo !== null && <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" />}
      <Text style={[styles.label, { color: theme.adMark }]}>{LABEL[lang]}</Text>
      <Text
        style={[styles.text, { color: theme.textSecondary, fontFamily: fontFor(ad.language) }]}
        numberOfLines={1}
      >
        {ad.text}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={14} color={theme.adMark} />
    </Pressable>
  );
}

/** Props are stable for the life of a card, like the card itself. */
export const InlineAd = memo(InlineAdInner);

const styles = StyleSheet.create({
  pill: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 999,
  },
  logo: { width: 14, height: 14, borderRadius: 3 },
  label: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  text: { flexShrink: 1, fontSize: 12, fontWeight: '500' },
});
