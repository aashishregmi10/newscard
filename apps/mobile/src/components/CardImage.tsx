import { useEffect, useState, memo } from 'react';
import {
  View,
  Image,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  blurHashAverageColor,
  resolveMediaUrl,
  type CardImage as CardImageData,
} from '../api/client';
import type { Theme } from '../theme/tokens';
import { textSize } from '../theme/tokens';

/**
 * The card's image region.  Spec Ch. 7.2.1 and Ch. 12.2.
 *
 * Three things this has to get right:
 *
 *  1. The layout NEVER shifts. The region reserves its height before the image
 *     loads, painted with the blurHash average colour, so text below it does not
 *     jump when the bytes arrive.
 *  2. A failed image never hides the card. The story is the product; the
 *     photograph is decoration. On error the placeholder simply stays.
 *  3. In Data Saver nothing is fetched until the reader taps, and the button
 *     says what the tap will cost — telling someone the price before they spend
 *     it is the entire idea of the mode.
 */

interface Props {
  image: CardImageData | null;
  theme: Theme;
  /**
   * The region's size and flex. A style rather than a height, so the card can
   * let the photograph give way to a long summary — see NewsCard.
   */
  style: StyleProp<ViewStyle>;
  dataSaver: boolean;
  /** Rendition to use when loading normally. */
  rendition?: 'sm' | 'md' | 'lg';
  /** Tapping the photograph — the card opens it full screen. */
  onPress?: () => void;
  /** The card's language, for the "load image" and "unavailable" words. */
  lang?: 'ne' | 'en';
  /** What a screen reader says that tap does. */
  pressLabel?: string;
}

/** Rough byte cost shown on the Data Saver button. Better an honest estimate
 *  than no number at all — the point is that the reader can decide. */
const APPROX_KB: Record<string, number> = { sm: 25, md: 70, lg: 140 };

/** How long an image may take before a spinner is worth showing. */
const SPINNER_AFTER_MS = 600;

function CardImageInner({
  image,
  theme,
  style,
  dataSaver,
  rendition = 'md',
  onPress,
  pressLabel,
  lang = 'en',
}: Props) {
  const ne = lang === 'ne';
  const [loaded, setLoaded] = useState(false);
  /**
   * A spinner only for an image that is actually slow.
   *
   * Most arrive within a few hundred milliseconds, and a spinner that flashes
   * up and vanishes on every card reads as the app working hard. The
   * placeholder colour already says "a picture goes here".
   */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setSlow(true), SPINNER_AFTER_MS);
    return () => clearTimeout(t);
  }, [loaded]);
  const [failed, setFailed] = useState(false);
  const [manuallyRequested, setManuallyRequested] = useState(false);

  // No image on this story: collapse to nothing and let the text expand.
  if (!image) return null;

  const placeholder = blurHashAverageColor(image.blurHash) ?? theme.surfaceRaised;
  const useRendition = dataSaver ? 'sm' : rendition;
  // Relative in dev, absolute in production — resolved either way.
  const uri = resolveMediaUrl(
    image.urls[useRendition] ?? image.urls.md ?? image.urls.sm,
  );

  const shouldLoad = (!dataSaver || manuallyRequested) && !!uri && !failed;

  /* Tappable only once there is a photograph to open: not behind the Data
     Saver button, and not when it failed. */
  const Region = onPress && shouldLoad ? Pressable : View;

  return (
    <Region
      style={[styles.wrap, style, { backgroundColor: placeholder }]}
      {...(onPress && shouldLoad
        ? { onPress, accessibilityRole: 'imagebutton' as const, accessibilityLabel: pressLabel }
        : {})}
    >
      {shouldLoad && (
        <Image
          source={{ uri: uri! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          // Only fades in when it actually arrives, so a cached image is instant
          // rather than animating on every card.
          fadeDuration={loaded ? 0 : 180}
        />
      )}

      {shouldLoad && !loaded && slow && (
        <View style={styles.centre}>
          <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
        </View>
      )}

      {dataSaver && !manuallyRequested && (
        <View style={styles.centre}>
          <Pressable
            style={styles.loadBtn}
            onPress={() => setManuallyRequested(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={ne ? 'तस्बिर लोड गर्नुहोस्' : 'Load image'}
          >
            <Text style={styles.loadBtnText}>{ne ? 'तस्बिर लोड गर्नुहोस्' : 'Load image'}</Text>
            <Text style={styles.loadBtnSize}>~{APPROX_KB.sm} KB</Text>
          </Pressable>
        </View>
      )}

      {failed && (
        <View style={styles.centre}>
          <Text style={styles.failText}>{ne ? 'तस्बिर उपलब्ध छैन' : 'image unavailable'}</Text>
        </View>
      )}
    </Region>
  );
}

/** Images are the most expensive part of a card to re-mount. */
export const CardImage = memo(CardImageInner);

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden' },
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadBtnText: { color: '#fff', fontSize: textSize(14), fontWeight: '600' },
  loadBtnSize: { color: 'rgba(255,255,255,0.75)', fontSize: textSize(11), marginTop: 1 },
  failText: { color: 'rgba(255,255,255,0.7)', fontSize: textSize(12) },
});
