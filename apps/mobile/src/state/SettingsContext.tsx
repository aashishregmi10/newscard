import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { light, dark, TEXT_SCALE, type TextSizeSetting, type Theme } from '../theme/tokens';

/**
 * User settings.  Spec Ch. 11.2, 11.6.1, 12.2.
 *
 * Persisted locally because the MVP has no accounts (Ch. 13.1). Every one of
 * these is reachable in Settings — nothing here is hidden behind a gesture or a
 * hidden menu.
 */

export type Lang = 'ne' | 'en';
export type ThemeMode = 'system' | 'light' | 'dark';

interface Settings {
  languages: Lang[];
  textSize: TextSizeSetting;
  dataSaver: boolean;
  themeMode: ThemeMode;
  /**
   * Whether the reader has ever chosen a language.
   *
   * Distinct from "languages is at its default", because ['ne','en'] is both a
   * sensible default and a perfectly reasonable deliberate choice — the two
   * cannot be told apart from the value alone.
   */
  languageChosen: boolean;
}

const DEFAULTS: Settings = {
  languages: ['ne', 'en'],
  textSize: 'default',
  dataSaver: false,
  themeMode: 'system',
  languageChosen: false,
};

const KEY = 'newscard.settings.v1';

interface Ctx extends Settings {
  ready: boolean;
  theme: Theme;
  isDark: boolean;
  textScale: number;
  setLanguages: (l: Lang[]) => void;
  chooseLanguages: (l: Lang[]) => void;
  toggleLanguage: (l: Lang) => void;
  setTextSize: (t: TextSizeSetting) => void;
  setDataSaver: (v: boolean) => void;
  setThemeMode: (m: ThemeMode) => void;
}

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setSettings({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
      })
      .catch(() => {
        // A corrupt or unreadable store must not stop the app booting; defaults
        // are always a valid state.
      })
      .finally(() => setReady(true));
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  };

  const isDark = settings.themeMode === 'system' ? scheme === 'dark' : settings.themeMode === 'dark';

  const value = useMemo<Ctx>(
    () => ({
      ...settings,
      ready,
      isDark,
      theme: isDark ? dark : light,
      textScale: TEXT_SCALE[settings.textSize],
      setLanguages: (languages) => update({ languages }),
      /** The first-run answer: records the choice and that one was made. */
      chooseLanguages: (languages: Lang[]) => update({ languages, languageChosen: true }),
      toggleLanguage: (l) => {
        const has = settings.languages.includes(l);
        const next = has ? settings.languages.filter((x) => x !== l) : [...settings.languages, l];
        // Never allow an empty selection: an empty feed reads as a broken app,
        // not as a setting the reader changed (Ch. 11.2).
        if (next.length > 0) update({ languages: next });
      },
      setTextSize: (textSize) => update({ textSize }),
      setDataSaver: (dataSaver) => update({ dataSaver }),
      setThemeMode: (themeMode) => update({ themeMode }),
    }),
     
    [settings, ready, isDark],
  );

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('useSettings must be used inside SettingsProvider');
  return c;
}
