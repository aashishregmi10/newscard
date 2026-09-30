import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import type { Theme } from '../theme/tokens';
import { textSize } from '../theme/tokens';

/**
 * A short confirmation with an Undo, for an action that changes the feed.
 *
 * "Not interested" and "Hide this source" remove stories the moment they are
 * tapped. That is the point — the control must visibly do something — but a
 * mis-tap then took a whole section out of the reader's feed with no way back
 * short of finding the list in Settings. This says what happened, in words,
 * and offers the way back for as long as the reader is likely to want it.
 *
 * Opacity and position only, on the native driver: it appears while the list
 * above it is still settling, and must not take frames from it.
 */

export interface UndoMessage {
  /** Changes for each new message, so a second action restarts the timer. */
  id: number;
  text: string;
  undoLabel: string;
  onUndo: () => void;
}

const SHOWN_MS = 5000;

export function UndoBar({ message, theme, bottom = 12 }: { message: UndoMessage | null; theme: Theme; bottom?: number }) {
  const [current, setCurrent] = useState<UndoMessage | null>(message);
  const shown = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    setCurrent(message);
    shown.setValue(0);
    Animated.timing(shown, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    const t = setTimeout(() => {
      Animated.timing(shown, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setCurrent((c) => (c?.id === message.id ? null : c));
      });
    }, SHOWN_MS);
    return () => clearTimeout(t);
  }, [message, shown]);

  if (!current) return null;

  const undo = () => {
    current.onUndo();
    Animated.timing(shown, { toValue: 0, duration: 120, useNativeDriver: true }).start(() =>
      setCurrent(null),
    );
  };

  return (
    <Animated.View
      // The live region is what makes a screen reader announce it: the bar
      // appears without focus moving, and would otherwise pass in silence.
      accessibilityLiveRegion="polite"
      style={[
        styles.bar,
        {
          bottom,
          backgroundColor: theme.strip,
          opacity: shown,
          transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <Text style={[styles.text, { color: theme.stripText }]} numberOfLines={2}>
        {current.text}
      </Text>
      <Pressable onPress={undo} hitSlop={10} accessibilityRole="button" style={styles.btn}>
        <Text style={[styles.btnText, { color: theme.stripAction }]}>{current.undoLabel}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    minHeight: 48,
    borderRadius: 12,
    zIndex: 20,
    elevation: 6,
  },
  text: { flex: 1, fontSize: textSize(13.5) },
  btn: { paddingHorizontal: 10, paddingVertical: 8 },
  btnText: { fontSize: textSize(13.5), fontWeight: '700' },
});
