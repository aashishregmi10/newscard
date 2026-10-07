import { ActivityIndicator, Image, Pressable, StyleSheet, Text } from 'react-native';
import { textSize } from '../theme/tokens';

/**
 * "Sign in with Google", drawn as Google's branding guidelines ask: Google's
 * coloured G, unaltered, on Google's light button (white, grey edge) — or its
 * dark one (near-black, lighter edge) on the dark theme — in a pill.
 *
 * Drawn here rather than with the sign-in library's native button: that view
 * is native code, and a native view that misbehaves on the first-run screen
 * would stop the app opening. This is plain React Native, as the vote sheet's
 * button has been since Interactions shipped.
 */

const G = require('../../assets/brand/google-g.png') as number;

const LOOK = {
  light: { background: '#FFFFFF', border: '#747775', text: '#1F1F1F' },
  dark: { background: '#131314', border: '#8E918F', text: '#E3E3E3' },
} as const;

export function GoogleButton({
  label,
  busy,
  onDark,
  onPress,
}: {
  label: string;
  busy: boolean;
  onDark: boolean;
  onPress: () => void;
}) {
  const look = LOOK[onDark ? 'dark' : 'light'];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.background, borderColor: look.border, opacity: pressed || busy ? 0.8 : 1 },
      ]}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
    >
      {busy ? (
        <ActivityIndicator color={look.text} />
      ) : (
        <>
          <Image source={G} style={styles.g} />
          <Text style={[styles.text, { color: look.text }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  g: { width: 20, height: 20 },
  text: { fontSize: textSize(15), fontWeight: '600' },
});
