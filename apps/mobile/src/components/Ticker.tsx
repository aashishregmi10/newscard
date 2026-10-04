import { memo, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

/**
 * One line of text that slides slowly sideways when it is too long to fit.
 *
 * Used for the small ad's text, whose length the advertiser decides. When it
 * fits, it is plain still text. When it does not, it waits a moment, glides
 * left until the end has been read, and comes round again — a second copy
 * follows a gap behind the first, so the loop has no jump.
 *
 * ── Why it is built this way ────────────────────────────────────────────────
 *
 *   • The text's full width can only be measured where nothing limits it, and
 *     a ScrollView's content is that place. Scrolling it is switched off; it
 *     only measures and clips.
 *   • The slide is a native-driver transform, so it runs on the UI thread and
 *     costs the JavaScript thread nothing while the reader swipes.
 *   • It never takes a touch: a tap goes to whatever holds it (the ad's link).
 *   • With the phone's "remove animations" setting on, it does not move; it is
 *     cut with an ellipsis like any other long line.
 */

/** Slow enough to read while it moves. Points per second. */
const SPEED = 26;
/** How long it rests at the start of each pass, so the first word can be read. */
const REST_MS = 1500;
/** Space between the end of one copy and the start of the next. */
const GAP = 32;

interface Props {
  text: string;
  style: StyleProp<TextStyle>;
}

function TickerInner({ text, style }: Props) {
  const [boxWidth, setBoxWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [stillOnly, setStillOnly] = useState(false);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setStillOnly(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStillOnly);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  /* A point of slack, so rounding in the measurement never sets it moving. */
  const tooLong = boxWidth > 0 && textWidth > boxWidth + 1;
  const sliding = tooLong && !stillOnly;

  useEffect(() => {
    if (!sliding) {
      x.setValue(0);
      return;
    }
    const distance = textWidth + GAP;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(REST_MS),
        Animated.timing(x, {
          toValue: -distance,
          duration: (distance / SPEED) * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      x.setValue(0);
    };
  }, [sliding, textWidth, x]);

  if (stillOnly) {
    return (
      <Text style={[style, styles.still]} numberOfLines={1}>
        {text}
      </Text>
    );
  }

  return (
    <View style={styles.box} pointerEvents="none">
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]}>
          <Text style={[style, styles.full]} onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}>
            {text}
          </Text>
          {sliding && (
            <Text
              style={[style, styles.full, { marginLeft: GAP }]}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              {text}
            </Text>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

export const Ticker = memo(TickerInner);

const styles = StyleSheet.create({
  box: { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  still: { flexShrink: 1 },
  /* Its whole width, never squeezed: that is the width being measured. */
  full: { flexShrink: 0 },
});
