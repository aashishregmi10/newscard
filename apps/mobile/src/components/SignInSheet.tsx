import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReader } from '../state/ReaderContext';
import { textSize, type Theme } from '../theme/tokens';

/**
 * "Sign in with Google to vote" — the only place the app asks anyone to sign in.
 *
 * It says what is kept before the reader decides: one anonymous number from
 * Google, so each account gets one vote; never their name or email. Then
 * Google's own account chooser. `onSignedIn` carries on with whatever the
 * reader was doing — the vote they pressed is sent without a second tap.
 */

const COPY = {
  ne: {
    title: 'मत दिन Google बाट साइन इन गर्नुहोस्',
    body: 'एउटा खाताबाट एक पटक मात्र मत दिन मिल्छ। हामी Google बाट एउटा बेनामी नम्बर मात्र राख्छौं — तपाईंको नाम वा इमेल कहिल्यै होइन।',
    google: 'Google बाट साइन इन',
    later: 'अहिले होइन',
    failed: 'साइन इन हुन सकेन। फेरि प्रयास गर्नुहोस्।',
    notReady: 'मतदान अहिले तयार छैन। केही समयपछि प्रयास गर्नुहोस्।',
    update: 'मत दिन एपको नयाँ संस्करण चाहिन्छ।',
  },
  en: {
    title: 'Sign in with Google to vote',
    body: 'One vote per account. We keep only an anonymous number from Google — never your name or email.',
    google: 'Sign in with Google',
    later: 'Not now',
    failed: 'Could not sign in. Please try again.',
    notReady: 'Voting is not ready yet. Please try again later.',
    update: 'Voting needs the latest version of the app.',
  },
} as const;

export function SignInSheet({
  visible,
  lang,
  theme,
  onClose,
  onSignedIn,
}: {
  visible: boolean;
  lang: 'ne' | 'en';
  theme: Theme;
  onClose: () => void;
  onSignedIn: (token: string) => void;
}) {
  const reader = useReader();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const t = COPY[lang];

  const go = async () => {
    setBusy(true);
    setProblem(null);
    const r = await reader.signIn();
    setBusy(false);
    if (r.ok) {
      onClose();
      onSignedIn(r.token);
    } else if (r.reason !== 'cancelled') {
      setProblem(r.reason === 'unavailable' ? t.update : r.reason === 'not_set_up' ? t.notReady : t.failed);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onClose} accessibilityLabel={t.later} />
      <View
        style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 20 }]}
        accessibilityViewIsModal
      >
        <View style={[styles.grip, { backgroundColor: theme.divider }]} />
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t.title}</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t.body}</Text>
        {problem !== null && <Text style={[styles.problem, { color: theme.adMark }]}>{problem}</Text>}

        <Pressable
          style={({ pressed }) => [styles.google, { opacity: pressed || busy ? 0.75 : 1 }]}
          disabled={busy}
          onPress={() => void go()}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color="#1F1F1F" />
          ) : (
            <>
              <MaterialCommunityIcons name="google" size={20} color="#1F1F1F" />
              <Text style={styles.googleText}>{t.google}</Text>
            </>
          )}
        </Pressable>
        <Pressable style={styles.later} disabled={busy} onPress={onClose} accessibilityRole="button">
          <Text style={[styles.laterText, { color: theme.textSecondary }]}>{t.later}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    paddingHorizontal: 22,
    paddingTop: 10,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  title: { fontSize: textSize(18), fontWeight: '700', marginBottom: 8 },
  body: { fontSize: textSize(14), lineHeight: textSize(14) * 1.55, marginBottom: 18 },
  problem: { fontSize: textSize(13), marginBottom: 12 },
  /* Google's own button colours, as their branding guidelines ask. */
  google: {
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#747775',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleText: { color: '#1F1F1F', fontSize: textSize(15), fontWeight: '600' },
  later: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 24 },
  laterText: { fontSize: textSize(14) },
});
