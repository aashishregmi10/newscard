import { useState } from 'react';
import { View, Image, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import {
  blurHashAverageColor,
  resolveMediaUrl,
  type CardImage as CardImageData,
} from '../api/client';
import type { Theme } from '../theme/tokens';

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
  height: number;
  dataSaver: boolean;
  /** Rendition to use when loading normally. */
  rendition?: 'sm' | 'md' | 'lg';
}

/** Rough byte cost shown on the Data Saver button. Better an honest estimate
 *  than no number at all — the point is that the reader can decide. */
const APPROX_KB: Record<string, number> = { sm: 25, md: 70, lg: 140 };

export function CardImage({ image, theme, height, dataSaver, rendition = 'md' }: Props) {
  const [loaded, setLoaded] = useState(false);
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

  return (
    <View style={[styles.wrap, { height, backgroundColor: placeholder }]}>
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

      {shouldLoad && !loaded && (
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
            accessibilityLabel="Load image"
          >
            <Text style={styles.loadBtnText}>Load image</Text>
            <Text style={styles.loadBtnSize}>~{APPROX_KB.sm} KB</Text>
          </Pressable>
        </View>
      )}

      {failed && (
        <View style={styles.centre}>
          <Text style={styles.failText}>image unavailable</Text>
        </View>
      )}
    </View>
  );
}

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
  loadBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  loadBtnSize: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1 },
  failText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
});
