import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';
import type { Theme } from '../theme/tokens';

/**
 * Loading placeholder for a card.
 *
 * Shaped like the real card — image band at 38%, then headline lines, then body
 * lines — so nothing shifts when the content arrives. A centred spinner would
 * be replaced by a full-screen card, which reads as a jump.
 *
 * The pulse is opacity-only and driven by the native driver, so it costs no
 * JavaScript frames on the entry-level device the budgets are measured on.
 */
export function CardSkeleton({ theme, height }: { theme: Theme; height: number }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const Bar = ({ w, h = 14, mb = 10 }: { w: number | string; h?: number; mb?: number }) => (
    <Animated.View
      style={{
        width: w as number,
        height: h,
        marginBottom: mb,
        borderRadius: 5,
        backgroundColor: theme.surfaceRaised,
        opacity: pulse,
      }}
    />
  );

  return (
    <View style={[styles.card, { height, backgroundColor: theme.surface }]}>
      <Animated.View
        style={{
          height: height * 0.38,
          backgroundColor: theme.surfaceRaised,
          opacity: pulse,
        }}
      />
      <View style={styles.body}>
        <Bar w="82%" h={20} mb={8} />
        <Bar w="58%" h={20} mb={20} />
        <Bar w="100%" />
        <Bar w="96%" />
        <Bar w="99%" />
        <Bar w="72%" mb={22} />
        <Bar w="45%" h={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%' },
  body: { paddingHorizontal: 18, paddingTop: 20 },
});
