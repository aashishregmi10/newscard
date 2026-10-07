import { router } from 'expo-router';
import { SignInScreen } from '../src/components/SignInScreen';
import { useSettings } from '../src/state/SettingsContext';

/** The sign-in screen, opened from Settings. On first run it is shown by the root layout. */
export default function SignInRoute() {
  const { theme, isDark, languages } = useSettings();
  return (
    <SignInScreen
      theme={theme}
      isDark={isDark}
      lang={languages.includes('ne') ? 'ne' : 'en'}
      onDone={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
