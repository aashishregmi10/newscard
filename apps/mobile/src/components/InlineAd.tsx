import { memo } from 'react';
import { Image, Linking, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { resolveMediaUrl, type InlineAd as InlineAdData } from '../api/client';
import { fontFor, type Theme, textSize } from '../theme/tokens';
import { Ticker } from './Ticker';

/**
 * The small ad on a story: the advertiser's logo and name, in the row with
 * save and share.
 *
 * ── How it is kept from reading as part of the story ─────────────────────────
 *
 * It sits in the row that carries the publisher's credit. It is:
 *
 *   • the advertiser's name only — no headline-like line of copy
 *   • outlined in the ad colour (theme.adMark), never the accent blue the
 *     publisher's name is set in
 *   • shorter than the credit is allowed to become: the publisher's name keeps
 *     its room and this line gives way when space is short. Crediting the
 *     publisher is what the licence requires; the ad is what is negotiable.
 *     A name too long for the room it is left slides slowly sideways (Ticker)
 *     rather than being cut off.
 *
 * It carried a printed "विज्ञापन" / "Ad" label until 4 Oct 2026, when the
 * owner chose the name alone. A screen reader still announces it as an ad.
 *
 * A tap opens the advertiser's page outside the app, in the phone's browser,
 * and is reported first — once the browser takes over, the app may never get
 * the chance.
 */

/** Spoken only, for a screen reader. */
const SPOKEN = { ne: 'विज्ञापन', en: 'Advertisement' } as const;

interface Props {
  ad: InlineAdData;
  theme: Theme;
  /** The reader's language, for what a screen reader says. */
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
      accessibilityLabel={`${SPOKEN[lang]}: ${ad.advertiser}. ${ad.text}`}
    >
      {logo !== null && <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" />}
      <Ticker
        text={ad.advertiser}
        style={[styles.text, { color: theme.textSecondary, fontFamily: fontFor(ad.language) }]}
      />
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
  text: { fontSize: textSize(12), fontWeight: '500' },
});
