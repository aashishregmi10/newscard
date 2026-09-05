import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useDevice } from '../state/DeviceContext';
import type { Theme } from '../theme/tokens';

/**
 * The notification permission prompt.  Spec Ch. 15.2.
 *
 * Shown only after the reader has got through five cards. Asking on first
 * launch, before any value has been delivered, is refused by most people — and
 * on Android that refusal is effectively permanent, so a badly-timed prompt
 * does not just fail, it burns the only chance.
 *
 * This is our OWN sheet, shown before the system dialogue. If the reader says
 * no here, the OS prompt is never triggered and the permission stays
 * `undetermined` — so we can ask again later. Firing the system dialogue
 * straight away would spend that one chance immediately.
 */

const T = {
  title: { en: 'Want the important ones?', ne: 'महत्त्वपूर्ण समाचार चाहिन्छ?' },
  body: {
    en: 'At most three a day, and never between 9:30pm and 6:30am. You can change or switch this off any time in Settings.',
    ne: 'दिनमा बढीमा तीन वटा, र राति ९:३० देखि बिहान ६:३० सम्म कहिल्यै पठाइँदैन। सेटिङबाट जुनसुकै बेला बदल्न वा बन्द गर्न सकिन्छ।',
  },
  allow: { en: 'Turn on', ne: 'सुरु गर्नुहोस्' },
  later: { en: 'Not now', ne: 'अहिले होइन' },
} as const;

export function NotifPrompt({ theme, lang }: { theme: Theme; lang: 'ne' | 'en' }) {
  const { promptEligible, requestPermission, dismissPrompt } = useDevice();

  return (
    <Modal visible={promptEligible} transparent animationType="fade" onRequestClose={dismissPrompt}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{T.title[lang]}</Text>

          {/* The limits are stated UP FRONT. A prompt that hides the volume is
              how apps end up with notifications switched off permanently. */}
          <Text style={[styles.body, { color: theme.textSecondary }]}>{T.body[lang]}</Text>

          <Pressable
            style={[styles.primary, { backgroundColor: theme.accent }]}
            onPress={() => void requestPermission().finally(dismissPrompt)}
          >
            <Text style={styles.primaryText}>{T.allow[lang]}</Text>
          </Pressable>

          <Pressable style={styles.secondary} onPress={dismissPrompt}>
            <Text style={{ color: theme.textSecondary, fontSize: 15 }}>{T.later[lang]}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: { width: '100%', maxWidth: 360, borderRadius: 16, padding: 24 },
  title: { fontSize: 19, fontWeight: '700', marginBottom: 10 },
  body: { fontSize: 14.5, lineHeight: 21, marginBottom: 22 },
  primary: { borderRadius: 24, paddingVertical: 13, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  secondary: { paddingVertical: 13, alignItems: 'center' },
});
