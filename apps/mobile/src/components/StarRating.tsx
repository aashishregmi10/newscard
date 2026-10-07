import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { starFills } from '../lib/interactionLayout';

/**
 * Five stars to tap, or five to read.
 *
 * Each star is its own target, at least 40 points tall — a star drawn at 26
 * points is too small to hit reliably with a thumb on a moving feed — and taps
 * give a light haptic tick, so a choice registers before anything is sent.
 * Nothing is sent from here: the card asks for a Submit, because a rating
 * cannot be changed.
 */

const STAR_COLOR = '#E8A317';

function StarRatingInner({
  value,
  onChange,
  disabled = false,
  size = 26,
  emptyColor,
  label,
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
}) {
  if (onChange === undefined) {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${label}: ${value} / 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <MaterialCommunityIcons
            key={n}
            name={n <= value ? 'star' : 'star-outline'}
            size={size}
            color={n <= value ? STAR_COLOR : emptyColor}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          disabled={disabled}
          hitSlop={4}
          style={[styles.target, { width: Math.max(36, size + 12), height: Math.max(40, size + 10) }]}
          onPress={() => {
            void Haptics.selectionAsync();
            onChange(n);
          }}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === n, disabled }}
          accessibilityLabel={`${n} / 5`}
        >
          <MaterialCommunityIcons
            name={n <= value ? 'star' : 'star-outline'}
            size={size}
            color={n <= value ? STAR_COLOR : emptyColor}
          />
        </Pressable>
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
          <MaterialCommunityIcons name="star-outline" size={size} color={emptyColor} style={StyleSheet.absoluteFill} />
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
  target: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  part: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});
