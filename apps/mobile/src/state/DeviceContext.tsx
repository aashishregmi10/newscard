import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { API_BASE } from '../api/client';
import { useSettings } from './SettingsContext';

/**
 * Device identity and notification preferences.  Spec Ch. 6.7, 10.2, 15.2.
 *
 * The identifier is a UUID this app generates and stores locally. It is NEVER
 * derived from hardware — not the advertising ID, not the Android ID, not the
 * IMEI. That is precisely what lets the store privacy disclosure say we collect
 * no device identifiers, and why the app requests no identifier permissions.
 */

const DEVICE_ID_KEY = 'newscard.deviceId.v1';
const DEVICE_TOKEN_KEY = 'newscard.deviceToken.v1';
const PROMPT_STATE_KEY = 'newscard.notifPrompt.v1';

/**
 * Cards a reader must get through before we ask for notification permission.
 *
 * Ch. 15.2: asking on first launch, before any value has been delivered, is
 * refused by most people — and on Android that refusal is effectively
 * permanent. Asking after the app has proved useful roughly doubles acceptance.
 */
export const CARDS_BEFORE_PROMPT = 5;

export interface NotifChannels {
  breaking: boolean;
  digest: boolean;
  categories: boolean;
}

export interface NotifPrefs {
  enabled: boolean;
  channels: NotifChannels;
  dailyCap: number;
}

const DEFAULT_PREFS: NotifPrefs = {
  enabled: true,
  // `categories` is OFF by default — it is the channel most likely to generate
  // volume, and a reader who has not asked for topical alerts should not get
  // them (Ch. 10.2).
  channels: { breaking: true, digest: true, categories: false },
  dailyCap: 3,
};

interface Ctx {
  ready: boolean;
  deviceId: string | null;
  registered: boolean;
  prefs: NotifPrefs;
  /** OS-level permission, which is separate from our own preferences. */
  permission: 'granted' | 'denied' | 'undetermined';
  /** True once the reader has read enough for the prompt to be fair to ask. */
  promptEligible: boolean;
  cardsRead: number;
  noteCardRead: () => void;
  requestPermission: () => Promise<boolean>;
  setPrefs: (patch: Partial<NotifPrefs>) => void;
  dismissPrompt: () => void;
  promptDismissed: boolean;
}

const DeviceCtx = createContext<Ctx | null>(null);

async function uuid(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  // expo-crypto is not a dependency; this is a v4-shaped random id, which is
  // all we need — it identifies an install, not a person or a handset.
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
    c === 'x' ? hex() : ((Math.floor(Math.random() * 4) + 8) % 16).toString(16),
  );
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const { languages } = useSettings();
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [permission, setPermission] = useState<Ctx['permission']>('undetermined');
  const [cardsRead, setCardsRead] = useState(0);
  const [promptDismissed, setPromptDismissed] = useState(false);

  /** Register (or refresh) with the API. Idempotent on deviceId. */
  const register = useCallback(
    async (id: string, pushToken: string | null) => {
      try {
        const res = await fetch(`${API_BASE}/v1/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: id,
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            appVersion: Constants.expoConfig?.version ?? '0.1.0',
            osVersion: Device.osName ? `${Device.osName} ${Device.osVersion ?? ''}`.trim() : null,
            fcmToken: pushToken,
            langPrefs: languages,
          }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { deviceToken: string; notif: NotifPrefs };
        setToken(body.deviceToken);
        await AsyncStorage.setItem(DEVICE_TOKEN_KEY, body.deviceToken);
        // Trust the server's copy: it is authoritative and already clamped.
        if (body.notif) setPrefsState(body.notif);
      } catch {
        // Registration is best-effort. Failing it must never block reading —
        // the entire app works without notifications.
      }
    },
    [languages],
  );

  useEffect(() => {
    void (async () => {
      const id = await uuid();
      setDeviceId(id);

      const [savedToken, promptState, perms] = await Promise.all([
        AsyncStorage.getItem(DEVICE_TOKEN_KEY),
        AsyncStorage.getItem(PROMPT_STATE_KEY),
        Notifications.getPermissionsAsync().catch(() => null),
      ]);

      if (savedToken) setToken(savedToken);
      if (promptState === 'dismissed') setPromptDismissed(true);
      if (perms) setPermission(perms.granted ? 'granted' : perms.canAskAgain ? 'undetermined' : 'denied');

      // Register immediately with no push token. The device row must exist so
      // preferences can be stored before permission is ever granted.
      await register(id, null);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const res = await Notifications.requestPermissionsAsync();
      const granted = res.granted;
      setPermission(granted ? 'granted' : res.canAskAgain ? 'undetermined' : 'denied');
      if (!granted || !deviceId) return granted;

      // Expo's push service relays to FCM and APNs, so no Firebase project is
      // needed in development. A standalone Android build will need FCM
      // credentials attached to the Expo project.
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      const pushToken = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      await register(deviceId, pushToken.data);
      return true;
    } catch {
      return false;
    }
  }, [deviceId, register]);

  const setPrefs = useCallback(
    (patch: Partial<NotifPrefs>) => {
      const next = { ...prefs, ...patch, channels: { ...prefs.channels, ...patch.channels } };
      setPrefsState(next); // optimistic: the control responds immediately
      if (!deviceId || !token) return;
      void fetch(`${API_BASE}/v1/devices/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notif: next, langPrefs: languages }),
      })
        .then(async (r) => {
          if (!r.ok) return;
          // The server clamps dailyCap; adopt what it actually stored so the UI
          // cannot claim a value the server rejected.
          const body = (await r.json()) as { notif?: NotifPrefs };
          if (body.notif) setPrefsState(body.notif);
        })
        .catch(() => undefined);
    },
    [prefs, deviceId, token, languages],
  );

  const dismissPrompt = useCallback(() => {
    setPromptDismissed(true);
    void AsyncStorage.setItem(PROMPT_STATE_KEY, 'dismissed').catch(() => undefined);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      deviceId,
      registered: token !== null,
      prefs,
      permission,
      cardsRead,
      promptDismissed,
      promptEligible:
        permission === 'undetermined' && !promptDismissed && cardsRead >= CARDS_BEFORE_PROMPT,
      noteCardRead: () => setCardsRead((n) => n + 1),
      requestPermission,
      setPrefs,
      dismissPrompt,
    }),
    [ready, deviceId, token, prefs, permission, cardsRead, promptDismissed, requestPermission, setPrefs, dismissPrompt],
  );

  return <DeviceCtx.Provider value={value}>{children}</DeviceCtx.Provider>;
}

export function useDevice(): Ctx {
  const c = useContext(DeviceCtx);
  if (!c) throw new Error('useDevice must be used inside DeviceProvider');
  return c;
}
