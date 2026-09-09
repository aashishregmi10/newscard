import { useFonts } from 'expo-font';

/**
 * Loading the bundled Devanagari face.
 *
 * `useFonts` returns false until the font is registered, and text rendered in
 * that window falls back to the system face and then reflows when the real one
 * arrives. On a card whose whole layout is tuned to one metric that reflow is
 * visible, so the app holds its first paint until this resolves — see
 * app/_layout.tsx.
 *
 * The hold is bounded. A font that fails to load must not leave the reader
 * looking at nothing, so the caller treats an error the same as a success and
 * renders with the system face: worse typography, working app.
 */
export function useAppFonts(): { ready: boolean; failed: boolean } {
  const [loaded, error] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    NotoSansDevanagari: require('../../assets/fonts/NotoSansDevanagari-Variable.ttf'),
  });

  return { ready: loaded || error !== null, failed: error !== null };
}
