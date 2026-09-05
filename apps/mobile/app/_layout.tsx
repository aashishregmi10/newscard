import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SettingsProvider, useSettings } from '../src/state/SettingsContext';
import { BookmarksProvider } from '../src/state/BookmarksContext';

function Root() {
  const { isDark, theme } = useSettings();
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
        <BookmarksProvider>
          <Root />
        </BookmarksProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
