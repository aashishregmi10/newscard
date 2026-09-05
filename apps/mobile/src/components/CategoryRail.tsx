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
  return (
    <View style={[styles.wrap, { borderBottomColor: theme.divider }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {categories.map((c) => {
          const on = c.slug === active;
          return (
            <Pressable
              key={c.slug}
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
