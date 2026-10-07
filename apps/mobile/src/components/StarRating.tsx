import { memo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { starFills } from '../lib/interactionLayout';

/**
 * Five stars to tap, or five to read.
 *
 * Each star is its own target, at least 40 points tall — a star drawn at 26
 * points is too small to hit reliably with a thumb on a moving feed — and a
 * tap gives a light haptic tick and a small pop of the star, so a choice
 * registers before anything is sent. Nothing is sent from here: the card asks
 * for a Submit, because a rating cannot be changed.
 *
 * An empty star is a solid star in a soft grey, as Google Play draws one,
 * rather than an outline: five dark outlines read as a form not yet filled
 * in; five soft stars read as an invitation.
 */

const STAR_COLOR = '#E8A317';

function StarTarget({
  n,
  filled,
  checked,
  size,
  width,
  height,
  emptyColor,
  disabled,
  onPress,
}: {
  n: number;
  filled: boolean;
  checked: boolean;
  size: number;
  width: number;
  height: number;
  emptyColor: string;
  disabled: boolean;
  onPress: (stars: number) => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      hitSlop={4}
      style={[styles.target, { width, height }]}
      onPress={() => {
        scale.setValue(0.7);
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }).start();
        void Haptics.selectionAsync();
        onPress(n);
      }}
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={`${n} / 5`}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <MaterialCommunityIcons name="star" size={size} color={filled ? STAR_COLOR : emptyColor} />
      </Animated.View>
    </Pressable>
  );
}

function StarRatingInner({
  value,
  onChange,
  disabled = false,
  size = 26,
  emptyColor,
  label,
  spread = false,
}: {
  /** 0–5. */
  value: number;
  /** Absent: read-only. */
  onChange?: (stars: number) => void;
  disabled?: boolean;
  size?: number;
  emptyColor: string;
  /** What is being rated, for a screen reader: "Rate Sample Cafe". */
  label: string;
  /** Across the whole width it is given, the outer stars' edges on its edges. */
  spread?: boolean;
}) {
  if (onChange === undefined) {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${label}: ${value} / 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <MaterialCommunityIcons key={n} name="star" size={size} color={n <= value ? STAR_COLOR : emptyColor} />
        ))}
      </View>
    );
  }

  const width = Math.max(36, size + 12);
  const height = Math.max(40, size + 10);
  return (
    <View
      style={[styles.row, spread && { justifyContent: 'space-between', marginHorizontal: -(width - size) / 2 }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <StarTarget
          key={n}
          n={n}
          filled={n <= value}
          checked={value === n}
          size={size}
          width={width}
          height={height}
          emptyColor={emptyColor}
          disabled={disabled}
          onPress={onChange}
        />
      ))}
    </View>
  );
}

export const StarRating = memo(StarRatingInner);

/**
 * An average, in stars: whole stars, then the next filled in part (3.4 shows
 * four-tenths of the fourth), so two close averages look as close as they are.
 */
function StarAverageInner({
  value,
  size = 20,
  emptyColor,
  label,
}: {
  /** 0–5, any fraction. */
  value: number;
  size?: number;
  emptyColor: string;
  label: string;
}) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value.toFixed(1)} / 5`}>
      {starFills(value).map((fill, k) => (
        <View key={k} style={{ width: size, height: size }}>
          <MaterialCommunityIcons name="star" size={size} color={emptyColor} style={StyleSheet.absoluteFill} />
          {fill > 0 && (
            <View style={[styles.part, { width: size * fill, height: size }]}>
              <MaterialCommunityIcons name="star" size={size} color={STAR_COLOR} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

export const StarAverage = memo(StarAverageInner);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  target: { alignItems: 'center', justifyContent: 'center' },
  part: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});
