import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FONT_DEVANAGARI, type Theme } from '../theme/tokens';

/**
 * The first launch.
 *
 * ── What this deliberately is not ───────────────────────────────────────────
 *
 * A multi-screen onboarding carousel was rejected for this product and that
 * decision stands: review mining found them to be a leading cause of a
 * first-session uninstall, and the app is meant to be readable in four seconds.
 *
 * But "no onboarding" had become "no first run at all", and that is a different
 * thing. The app opened straight into a feed with both languages enabled, so a
 * Nepali-only reader met English cards within seconds and had to find Settings
 * to stop it. And the two-axis gesture — vertical for stories, horizontal for
 * sections — is the entire navigation model, discovered by accident or not at
 * all.
 *
 * So: one screen, one decision, and two lines telling the reader how the app
 * moves. It can be answered in a single tap and never appears again.
 */

interface Props {
  theme: Theme;
  onChoose: (languages: Array<'ne' | 'en'>) => void;
}

const CHOICES: Array<{ key: string; label: string; sub: string; langs: Array<'ne' | 'en'> }> = [
  { key: 'ne', label: 'नेपाली', sub: 'Nepali only', langs: ['ne'] },
  { key: 'both', label: 'नेपाली + English', sub: 'Both languages', langs: ['ne', 'en'] },
  { key: 'en', label: 'English', sub: 'English only', langs: ['en'] },
];

export function FirstRun({ theme, onChoose }: Props) {
  return (
    <View style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.top}>
        <Text style={[styles.brand, { color: theme.accent }]}>SAAR</Text>
        <Text style={[styles.tag, { color: theme.textSecondary }]}>
          समाचार, ६० शब्दमा{'\n'}
          <Text style={styles.tagEn}>The news, in sixty words</Text>
        </Text>
      </View>

      <View style={styles.choices}>
        <Text style={[styles.ask, { color: theme.textSecondary }]}>
          कुन भाषामा पढ्नुहुन्छ?  ·  Which language?
        </Text>

        {CHOICES.map((c) => (
          <Pressable
            key={c.key}
            style={({ pressed }) => [
              styles.choice,
              { borderColor: theme.divider, backgroundColor: pressed ? theme.surfaceRaised : 'transparent' },
            ]}
            onPress={() => onChoose(c.langs)}
            accessibilityRole="button"
            accessibilityLabel={c.sub}
          >
            <View style={styles.choiceText}>
              <Text style={[styles.choiceLabel, { color: theme.textPrimary }]}>{c.label}</Text>
              <Text style={[styles.choiceSub, { color: theme.textSecondary }]}>{c.sub}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={theme.textSecondary} />
          </Pressable>
        ))}

        <Text style={[styles.later, { color: theme.textSecondary }]}>
          सेटिङमा गएर कहिल्यै पनि बदल्न सकिन्छ · Change any time in Settings
        </Text>
      </View>

      {/* How the app moves. Two lines, shown once — the alternative is a reader
          who never discovers that the sections are a sideways swipe. */}
      <View style={[styles.hints, { borderTopColor: theme.divider }]}>
        <View style={styles.hint}>
          <MaterialCommunityIcons name="gesture-swipe-vertical" size={20} color={theme.accent} />
          <Text style={[styles.hintText, { color: theme.textSecondary }]}>
            माथि स्वाइप — अर्को समाचार{'\n'}
            <Text style={styles.hintEn}>Swipe up for the next story</Text>
          </Text>
        </View>
        <View style={styles.hint}>
          <MaterialCommunityIcons name="gesture-swipe-horizontal" size={20} color={theme.accent} />
          <Text style={[styles.hintText, { color: theme.textSecondary }]}>
            छेउतिर स्वाइप — अर्को विषय{'\n'}
            <Text style={styles.hintEn}>Swipe sideways for the next section</Text>
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },
  top: { paddingTop: 72 },
  brand: { fontSize: 15, fontWeight: '800', letterSpacing: 3.5 },
  tag: {
    fontFamily: FONT_DEVANAGARI,
    fontSize: 26,
    lineHeight: 26 * 1.7,
    marginTop: 14,
  },
  tagEn: { fontFamily: undefined, fontSize: 17, lineHeight: 17 * 1.55 },

  choices: { paddingBottom: 8 },
  ask: { fontSize: 13, marginBottom: 14, letterSpacing: 0.2 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  choiceText: { flex: 1 },
  choiceLabel: { fontSize: 19, fontWeight: '600', fontFamily: FONT_DEVANAGARI },
  choiceSub: { fontSize: 13, marginTop: 3 },
  later: { fontSize: 12, textAlign: 'center', marginTop: 6 },

  hints: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingBottom: 34,
    gap: 12,
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hintText: { fontFamily: FONT_DEVANAGARI, fontSize: 14, lineHeight: 14 * 1.6, flex: 1 },
  hintEn: { fontFamily: undefined, fontSize: 12.5 },
});
