import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SettingsProvider, useSettings } from '../src/state/SettingsContext';
import { BookmarksProvider } from '../src/state/BookmarksContext';
import { FiltersProvider } from '../src/state/FiltersContext';
import { DeviceProvider } from '../src/state/DeviceContext';
import { useNotificationRouting } from '../src/hooks/useNotificationRouting';
import { useRetractionPurge } from '../src/hooks/useRetractionPurge';
import { loadAdBudget, flushAdEvents } from '../src/lib/adTracker';

function Root() {
  const { isDark, theme } = useSettings();
  // Routes a notification tap straight to its card, including from cold start.
  useNotificationRouting();
  // Drops withdrawn stories from the cache on every foreground (Ch. 9.7).
  useRetractionPurge();

  // Warm the day's ad allowance so the first feed request does not wait on a
  // storage read. useFeed awaits it too — that is what makes the cap correct;
  // this only makes it fast.
  useEffect(() => {
    void loadAdBudget();
    const sub = AppState.addEventListener('change', (s) => {
      // Backgrounding is the last reliable moment to report. An impression the
      // reader was mid-way through would otherwise be lost when the OS reclaims
      // the process.
      if (s !== 'active') void flushAdEvents();
    });
    return () => sub.remove();
  }, []);

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
                <Root />
              </FiltersProvider>
            </BookmarksProvider>
          </DeviceProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
