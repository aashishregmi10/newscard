import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

/**
 * Five stars to tap, or five to read.
 *
 * Each star is its own 40-point target — a star drawn at 26 points is too
 * small to hit reliably with a thumb on a moving feed — and taps give a light
 * haptic tick, so a choice registers before anything is sent. Nothing is sent
 * from here: the card asks for a Submit, because a rating cannot be changed.
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
          style={styles.target}
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  target: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
});
