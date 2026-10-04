import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Theme, textSize } from '../theme/tokens';

/**
 * SAAR's mark, on every story card beside the publisher's name.
 *
 * Drawn, not an image: the project has no logo file yet, and the app icon is
 * still Expo's placeholder. This is the wordmark the first-run screen sets in
 * type, in a filled badge so it reads as our mark rather than as part of the
 * publisher's credit. When a real logo exists, it replaces this one component.
 *
 * It is a logo, so it barely grows with the reader's text size: the publisher's
 * name beside it is what must stay readable.
 */
function SaarMarkInner({ theme }: { theme: Theme }) {
  return (
    <View style={[styles.badge, { backgroundColor: theme.accent }]} accessible accessibilityLabel="SAAR">
      <Text style={[styles.word, { color: theme.surface }]} maxFontSizeMultiplier={1.2}>
        SAAR
      </Text>
    </View>
  );
}

export const SaarMark = memo(SaarMarkInner);

const styles = StyleSheet.create({
  badge: {
    flexShrink: 0,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  word: { fontSize: textSize(10), fontWeight: '800', letterSpacing: 1.2 },
});
