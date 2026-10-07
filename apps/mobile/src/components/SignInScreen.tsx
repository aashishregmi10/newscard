import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReader } from '../state/ReaderContext';
import { FONT_DEVANAGARI, textSize, type Theme } from '../theme/tokens';
import { GoogleButton } from './GoogleButton';
import { SaarLogo } from './SaarMark';

/**
 * The sign-in screen: SAAR's logo, what signing in is for, and "Sign in with
 * Google" (asked for 7 Oct 2026).
 *
 * Offered once, after the language choice, and from Settings after that.
 * Never required: every story reads without an account, so "Not now" is on
 * the screen as plainly as the button. Signing in is for votes and ratings,
 * and the screen says what is — and is not — kept, before anyone taps: an
 * anonymous number from Google, never a name or an email (see
 * src/lib/googleSignIn.ts and the server's readers service).
 */

const COPY = {
  ne: {
    title: 'SAAR मा स्वागत छ',
    sub: 'Google खाताबाट साइन इन गर्नुहोस्',
    perks: [
      { icon: 'poll', text: 'मतदान र रेटिङमा भाग लिनुहोस्' },
      { icon: 'shield-check-outline', text: 'तपाईंको नाम वा इमेल हामी राख्दैनौं' },
      { icon: 'newspaper-variant-outline', text: 'समाचार पढ्न साइन इन चाहिँदैन' },
    ],
    google: 'Google बाट साइन इन गर्नुहोस्',
    later: 'अहिले होइन',
    signedIn: (name: string | null) => (name ? `${name} को रूपमा साइन इन भयो` : 'साइन इन भयो'),
    go: 'पढ्न जानुहोस्',
    failed: 'साइन इन हुन सकेन। फेरि प्रयास गर्नुहोस्।',
    notReady: 'साइन इन अहिले तयार छैन। केही समयपछि प्रयास गर्नुहोस्।',
    update: 'साइन इन गर्न एपको नयाँ संस्करण चाहिन्छ।',
  },
  en: {
    title: 'Welcome to SAAR',
    sub: 'Sign in with your Google account',
    perks: [
      { icon: 'poll', text: 'Take part in votes and ratings' },
      { icon: 'shield-check-outline', text: 'We never keep your name or email' },
      { icon: 'newspaper-variant-outline', text: 'Reading needs no sign-in' },
    ],
    google: 'Sign in with Google',
    later: 'Not now',
    signedIn: (name: string | null) => (name ? `Signed in as ${name}` : 'Signed in'),
    go: 'Start reading',
    failed: 'Could not sign in. Please try again.',
    notReady: 'Sign-in is not ready yet. Please try again later.',
    update: 'Signing in needs the latest version of the app.',
  },
} as const;

export function SignInScreen({
  theme,
  isDark,
  lang,
  onDone,
}: {
  theme: Theme;
  isDark: boolean;
  lang: 'ne' | 'en';
  /** Signed in, or "Not now": either way, on to the app. */
  onDone: () => void;
}) {
  const reader = useReader();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const t = COPY[lang];
  const font = lang === 'ne' ? FONT_DEVANAGARI : undefined;
  const signedIn = reader.session !== null;

  const go = async () => {
    setBusy(true);
    setProblem(null);
    const r = await reader.signIn();
    setBusy(false);
    if (r.ok) onDone();
    else if (r.reason !== 'cancelled') {
      setProblem(r.reason === 'unavailable' ? t.update : r.reason === 'not_set_up' ? t.notReady : t.failed);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.surface }}
      contentContainerStyle={[styles.root, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 18 }]}
      bounces={false}
    >
      <View style={styles.top}>
        <SaarLogo height={176} onDark={isDark} />
      </View>

      <View>
        <Text style={[styles.title, { color: theme.textPrimary, fontFamily: font }]}>{t.title}</Text>
        <Text style={[styles.sub, { color: theme.textSecondary, fontFamily: font }]}>
          {signedIn ? t.signedIn(reader.session?.name ?? null) : t.sub}
        </Text>

        <View style={[styles.perks, { backgroundColor: theme.surfaceRaised }]}>
          {t.perks.map((p) => (
            <View key={p.icon} style={styles.perk}>
              <View style={[styles.perkIcon, { backgroundColor: theme.surface }]}>
                <MaterialCommunityIcons name={p.icon} size={18} color={theme.accent} />
              </View>
              <Text style={[styles.perkText, { color: theme.textPrimary, fontFamily: font }]}>{p.text}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.bottom}>
        {problem !== null && (
          <Text style={[styles.problem, { color: theme.adMark, fontFamily: font }]} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        )}
        {signedIn ? (
          <Pressable
            style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]}
            onPress={onDone}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, { color: isDark ? '#0E1620' : '#FFFFFF', fontFamily: font }]}>{t.go}</Text>
          </Pressable>
        ) : (
          <>
            <GoogleButton label={t.google} busy={busy} onDark={isDark} onPress={() => void go()} />
            <Pressable style={styles.later} disabled={busy} onPress={onDone} accessibilityRole="button">
              <Text style={[styles.laterText, { color: theme.textSecondary, fontFamily: font }]}>{t.later}</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 28, justifyContent: 'space-between', gap: 28 },
  top: { alignItems: 'center' },
  title: { fontSize: textSize(26), fontWeight: '800', textAlign: 'center', lineHeight: textSize(26) * 1.45 },
  sub: { fontSize: textSize(15), textAlign: 'center', marginTop: 6, lineHeight: textSize(15) * 1.5 },
  perks: { marginTop: 24, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  perkIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  perkText: { flex: 1, fontSize: textSize(14.5), lineHeight: textSize(14.5) * 1.5 },
  bottom: { gap: 4 },
  problem: { fontSize: textSize(13), textAlign: 'center', marginBottom: 10 },
  primary: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: textSize(15.5), fontWeight: '700' },
  later: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 28 },
  laterText: { fontSize: textSize(14.5), fontWeight: '600' },
});
