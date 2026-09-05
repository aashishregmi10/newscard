import { useEffect, useRef } from 'react';
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import type { Theme } from '../theme/tokens';

/**
 * Category rail.  Spec Ch. 7.9.
 *
 * In the MVP this rail IS the navigation model within the feed — there is no
 * search and no drawer. Selecting a category resets to the top of that feed.
 *
 * The active chip is indicated by FILL as well as colour, so the state survives
 * colour-vision differences and monochrome rendering (Ch. 11.7).
 */

export interface CategoryOption {
  slug: string;
  label: { ne: string; en: string };
}

interface Props {
  categories: CategoryOption[];
  active: string;
  onSelect: (slug: string) => void;
  theme: Theme;
  /** Which localisation of the label to show. */
  labelLang: 'ne' | 'en';
}

export function CategoryRail({ categories, active, onSelect, theme, labelLang }: Props) {
  const scroller = useRef<ScrollView>(null);
  /** Measured chip positions, so scrolling to one does not depend on guessing
   *  its width from the label length — Devanagari and Latin differ a lot. */
  const layouts = useRef<Record<string, { x: number; width: number }>>({});

  // Keep the active chip visible as the reader SWIPES between categories, not
  // only when they tap. Without this the rail highlights a chip that may be off
  // screen, and the rail reads as disconnected from the gesture.
  useEffect(() => {
    const l = layouts.current[active];
    if (!l) return;
    scroller.current?.scrollTo({ x: Math.max(0, l.x - 64), animated: true });
  }, [active]);

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.divider }]}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {categories.map((c) => {
          const on = c.slug === active;
          return (
            <Pressable
              key={c.slug}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                layouts.current[c.slug] = { x, width };
              }}
              onPress={() => onSelect(c.slug)}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? theme.accent : 'transparent',
                  borderColor: on ? theme.accent : theme.divider,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: on ? '#fff' : theme.textSecondary, fontWeight: on ? '700' : '600' },
                ]}
              >
                {c.label[labelLang]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: 12, paddingVertical: 9, gap: 7 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 34,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13 },
});
