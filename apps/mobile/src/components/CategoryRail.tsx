import { useEffect, useRef } from 'react';
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import type { Theme } from '../theme/tokens';

/**
 * Category rail.  Spec Ch. 7.9.
 *
 * In the MVP this rail IS the navigation model within the feed — there is no
 * search and no drawer. Selecting a category resets to the top of that feed,
 * and swiping horizontally moves one category at a time.
 *
 * Plain text labels rather than filled pills: at seven categories a row of
 * pills is a wall of boxes, and the boxes carry no information the label does
 * not. The active category is the accent colour.
 *
 * Ch. 11.7 says state must never rest on colour alone, so the active label is
 * ALSO heavier and carries a short underline. Someone who cannot separate the
 * accent from the body colour still sees which one is selected.
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
  /** Measured positions, so scrolling to a label does not depend on guessing
   *  its width — Devanagari and Latin differ considerably. */
  const layouts = useRef<Record<string, { x: number; width: number }>>({});

  // Keep the active label visible as the reader SWIPES, not only when they tap.
  // Without this the rail highlights a label that may be off screen, and reads
  // as disconnected from the gesture.
  useEffect(() => {
    const l = layouts.current[active];
    if (!l) return;
    scroller.current?.scrollTo({ x: Math.max(0, l.x - 72), animated: true });
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
              style={styles.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text
                style={[
                  styles.label,
                  {
                    color: on ? theme.accent : theme.textSecondary,
                    fontWeight: on ? '700' : '500',
                  },
                ]}
                numberOfLines={1}
              >
                {c.label[labelLang]}
              </Text>
              {/* Second, non-colour signal for the selected state. */}
              <View
                style={[
                  styles.underline,
                  { backgroundColor: on ? theme.accent : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: 14, gap: 20, alignItems: 'flex-end' },
  item: { paddingTop: 13, alignItems: 'center', minHeight: 44, justifyContent: 'flex-end' },
  label: { fontSize: 15, letterSpacing: 0.1 },
  underline: { height: 2.5, borderRadius: 2, alignSelf: 'stretch', marginTop: 8 },
});
