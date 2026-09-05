import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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

export default function RootLayout() {
  return (
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
  );
}
