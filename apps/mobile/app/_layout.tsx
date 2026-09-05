import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SettingsProvider, useSettings } from '../src/state/SettingsContext';
import { BookmarksProvider } from '../src/state/BookmarksContext';
import { FiltersProvider } from '../src/state/FiltersContext';
import { DeviceProvider } from '../src/state/DeviceContext';
import { useNotificationRouting } from '../src/hooks/useNotificationRouting';

function Root() {
  const { isDark, theme } = useSettings();
  // Routes a notification tap straight to its card, including from cold start.
  useNotificationRouting();
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
