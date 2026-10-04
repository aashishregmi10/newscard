import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { resolveMediaUrl, type CardImage as CardImageData } from '../api/client';
import { textSize } from '../theme/tokens';

/**
 * A story's photograph, full screen.
 *
 * Opened by tapping the photo on a card. Closed the way a reader already
 * expects from every photo app: the back button, the ✕, or a flick up or down.
 * Pinch or double-tap to look closer.
 *
 * ── Smooth on a cheap phone ─────────────────────────────────────────────────
 *
 * Every frame of a pinch or a drag is computed on the UI thread (Reanimated
 * and Gesture Handler, both already in the build), so a busy JavaScript thread
 * cannot make the photo lag the fingers. The card's own copy of the picture,
 * already downloaded, shows at once; the sharper one fades in over it when it
 * arrives. Nothing waits for the network before something is on screen.
 *
 * The credit stays visible: it is part of the licence, here as on the card.
 */

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** How far a drag, or how fast a flick, closes the viewer. */
const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 900;

const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };
const FADE_MS = 180;

interface Props {
  image: CardImageData;
  /** The story's language, for the words around the photo. */
  ne: boolean;
  /** In Data Saver the sharper copy is the card's medium one, not the large. */
  dataSaver: boolean;
  onClose: () => void;
}

export function ImageViewer({ image, ne, dataSaver, onClose }: Props) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /* The photograph's own shape, or the 16:9 every card rendition is cut to. */
  const aspect = image.width && image.height ? image.width / image.height : 16 / 9;
  const fitW = Math.min(W, H * aspect);
  const fitH = fitW / aspect;

  /* What the card already showed — so it is in the cache and appears at once —
     and then the sharper copy over it. */
  const shownUri = resolveMediaUrl(
    dataSaver ? (image.urls.sm ?? image.urls.md) : (image.urls.md ?? image.urls.sm),
  );
  const sharpUri = resolveMediaUrl(dataSaver ? image.urls.md : (image.urls.lg ?? image.urls.md));
  const [anyLoaded, setAnyLoaded] = useState(false);
  const [chrome, setChrome] = useState(true);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const pinching = useSharedValue(false);
  /** A one-finger drag on an unzoomed photo moves it away to close. */
  const closingDrag = useSharedValue(false);
  /** 0 closed, 1 open: the backdrop and the photo fade with it. */
  const open = useSharedValue(0);

  useEffect(() => {
    open.value = withTiming(1, { duration: FADE_MS });
  }, [open]);

  const close = useCallback(() => {
    open.value = withTiming(0, { duration: FADE_MS }, (done) => {
      if (done) runOnJS(onClose)();
    });
  }, [open, onClose]);

  const toggleChrome = useCallback(() => setChrome((c) => !c), []);

  /** Keep a zoomed photo's edges from leaving the screen. */
  const bound = (s: number, x: number, y: number): [number, number] => {
    'worklet';
    const maxX = Math.max(0, (fitW * s - W) / 2);
    const maxY = Math.max(0, (fitH * s - H) / 2);
    return [Math.min(maxX, Math.max(-maxX, x)), Math.min(maxY, Math.max(-maxY, y))];
  };

  const settleTo = (s: number, x: number, y: number) => {
    'worklet';
    const [bx, by] = s <= 1 ? [0, 0] : bound(s, x, y);
    scale.value = withTiming(s, SETTLE);
    tx.value = withTiming(bx, SETTLE);
    ty.value = withTiming(by, SETTLE);
  };

  /*
   * Two fingers: zoom about the point between them, and follow them as they
   * move. The point of the photo that was under the fingers when they landed
   * stays under them — that is what makes a pinch feel held rather than slid.
   */
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      pinching.value = true;
      closingDrag.value = false;
      startScale.value = scale.value;
      startX.value = tx.value;
      startY.value = ty.value;
      focalX.value = e.focalX - W / 2;
      focalY.value = e.focalY - H / 2;
    })
    .onUpdate((e) => {
      const s = Math.min(MAX_SCALE * 1.2, Math.max(0.8, startScale.value * e.scale));
      const k = s / startScale.value;
      scale.value = s;
      tx.value = e.focalX - W / 2 - k * (focalX.value - startX.value);
      ty.value = e.focalY - H / 2 - k * (focalY.value - startY.value);
    })
    .onEnd(() => {
      settleTo(Math.min(MAX_SCALE, Math.max(1, scale.value)), tx.value, ty.value);
    })
    .onFinalize(() => {
      pinching.value = false;
    });

  /* One finger: move around a zoomed photo, or drag an unzoomed one away. */
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
      closingDrag.value = scale.value <= 1.01;
    })
    .onUpdate((e) => {
      if (pinching.value) return;
      if (closingDrag.value) {
        ty.value = e.translationY;
        return;
      }
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    })
    .onEnd((e, success) => {
      /* Cut short by a second finger: the pinch has the photo now. */
      if (!success || pinching.value) return;
      if (closingDrag.value) {
        if (Math.abs(e.translationY) > CLOSE_DISTANCE || Math.abs(e.velocityY) > CLOSE_VELOCITY) {
          /* Carry on the way it was thrown while it fades. */
          const away = (e.translationY + e.velocityY * 0.1 >= 0 ? 1 : -1) * H * 0.6;
          ty.value = withTiming(away, { duration: FADE_MS });
          open.value = withTiming(0, { duration: FADE_MS }, (done) => {
            if (done) runOnJS(onClose)();
          });
        } else {
          ty.value = withTiming(0, SETTLE);
        }
        return;
      }
      settleTo(scale.value, tx.value, ty.value);
    });

  /* Double tap: in to where it was tapped, or back out. */
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(24)
    .onEnd((e, success) => {
      if (!success) return;
      if (scale.value > 1.01) {
        settleTo(1, 0, 0);
        return;
      }
      const s = DOUBLE_TAP_SCALE;
      settleTo(s, (e.x - W / 2) * (1 - s), (e.y - H / 2) * (1 - s));
    });

  /* Single tap: hide or show the ✕ and the credit, for a clear look. */
  const singleTap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((_e, success) => {
      if (success) runOnJS(toggleChrome)();
    });

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));

  const backdropStyle = useAnimatedStyle(() => {
    /* Dragging it away lets the card show through, as a promise of where the
       reader is about to land. */
    const drag = closingDrag.value ? Math.min(1, Math.abs(ty.value) / (H * 0.45)) : 0;
    return { opacity: open.value * (1 - drag * 0.8) };
  });

  const photoStyle = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const chromeStyle = useAnimatedStyle(() => ({ opacity: open.value }));

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <StatusBar style="light" />
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />

        <GestureDetector gesture={gesture}>
          <View style={[styles.fill, styles.centre]} collapsable={false}>
            {!anyLoaded && <ActivityIndicator color="rgba(255,255,255,0.8)" style={styles.spinner} />}
            <Animated.View style={[{ width: fitW, height: fitH }, photoStyle]}>
              {shownUri ? (
                <Image
                  source={{ uri: shownUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  fadeDuration={0}
                  onLoad={() => setAnyLoaded(true)}
                />
              ) : null}
              {sharpUri && sharpUri !== shownUri ? (
                <Image
                  source={{ uri: sharpUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  onLoad={() => setAnyLoaded(true)}
                  accessibilityIgnoresInvertColors
                />
              ) : null}
            </Animated.View>
          </View>
        </GestureDetector>

        {chrome && (
          <Animated.View style={[styles.top, { paddingTop: insets.top + 8 }, chromeStyle]} pointerEvents="box-none">
            <Pressable
              onPress={close}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={ne ? 'तस्बिर बन्द गर्नुहोस्' : 'Close photo'}
            >
              <MaterialCommunityIcons name="close" size={24} color="#fff" />
            </Pressable>
          </Animated.View>
        )}

        {chrome && image.credit ? (
          <Animated.View
            style={[styles.bottom, { paddingBottom: insets.bottom + 18 }, chromeStyle]}
            pointerEvents="none"
          >
            <Text style={styles.credit} numberOfLines={2}>
              {ne ? 'तस्बिर: ' : 'Photo: '}
              {image.credit}
            </Text>
          </Animated.View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  backdrop: { backgroundColor: '#000' },
  spinner: { position: 'absolute' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18 },
  credit: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: textSize(12),
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
