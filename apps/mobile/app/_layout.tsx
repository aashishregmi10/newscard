import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SettingsProvider, useSettings } from '../src/state/SettingsContext';
import { BookmarksProvider } from '../src/state/BookmarksContext';
import { FiltersProvider } from '../src/state/FiltersContext';
import { NetworkProvider } from '../src/state/NetworkContext';
import { DeviceProvider } from '../src/state/DeviceContext';
import { useNotificationRouting } from '../src/hooks/useNotificationRouting';
import { useRetractionPurge } from '../src/hooks/useRetractionPurge';
import { loadAdBudget, flushAdEvents } from '../src/lib/adTracker';
import { useAppFonts } from '../src/lib/fonts';
import { FirstRun } from '../src/components/FirstRun';
import { installGlobalErrorHandlers, flushEvents } from '../src/lib/telemetry';

function Root() {
  const { isDark, theme, ready, languageChosen, chooseLanguages } = useSettings();
  // The card layout is tuned to one Devanagari metric. Painting with the system
  // face first and swapping when the bundled one arrives reflows every card in
  // view, so the first paint waits — see src/lib/fonts.ts for the bound on it.
  const { ready: fontsReady } = useAppFonts();
  // Routes a notification tap straight to its card, including from cold start.
  useNotificationRouting();
  // Drops withdrawn stories from the cache on every foreground (Ch. 9.7).
  useRetractionPurge();

  // Warm the day's ad allowance so the first feed request does not wait on a
  // storage read. useFeed awaits it too — that is what makes the cap correct;
  // this only makes it fast.
  useEffect(() => {
    // A React error boundary only sees errors thrown while rendering. A rejected
    // promise in an effect, a callback that throws, a native module failing on a
    // background thread — all bypass it, and between them they are most of what
    // actually breaks in production.
    installGlobalErrorHandlers();
    void loadAdBudget();
    const sub = AppState.addEventListener('change', (s) => {
      // Backgrounding is the last reliable moment to report. An impression the
      // reader was mid-way through would otherwise be lost when the OS reclaims
      // the process.
      if (s !== 'active') {
        void flushAdEvents();
        void flushEvents();
      }
    });
    return () => sub.remove();
  }, []);

  // A blank surface in the theme's own colour, not a spinner: this resolves in
  // well under the time a spinner would take to become meaningful, and a flash
  // of spinner reads as slower than a flash of nothing.
  if (!fontsReady || !ready) {
    return <View style={{ flex: 1, backgroundColor: theme.surface }} />;
  }

  // One screen, one decision. Shown only until it is answered, and answerable
  // in a single tap — see src/components/FirstRun.tsx for why this is not an
  // onboarding carousel.
  if (!languageChosen) {
    return (
      <>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <FirstRun theme={theme} onChoose={chooseLanguages} />
      </>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.surface },
          animation: 'fade',
        }}
      />
    </>
  );
}

/**
 * The boundary sits OUTSIDE every provider on purpose.
 *
 * The providers are the most likely place for a startup throw — they touch
 * storage, SQLite and the notification APIs — and a boundary nested inside them
 * cannot catch a provider that fails while mounting. Outside, it catches
 * everything and shows the real message instead of Expo Go's generic screen.
 */
export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SettingsProvider>
          <DeviceProvider>
            <BookmarksProvider>
              <FiltersProvider>
                <NetworkProvider>
                  <Root />
                </NetworkProvider>
              </FiltersProvider>
            </BookmarksProvider>
          </DeviceProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
