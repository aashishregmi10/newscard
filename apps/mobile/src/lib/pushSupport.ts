import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as NotificationsModule from 'expo-notifications';

/**
 * Safe access to expo-notifications.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * expo-notifications THROWS AT IMPORT TIME in Expo Go on Android:
 *
 *   Error: expo-notifications: Android Push notifications (remote
 *   notifications) functionality was removed from Expo Go with the release of
 *   SDK 53. Use a development build instead of Expo Go.
 *
 * A static `import * as Notifications from 'expo-notifications'` therefore
 * kills the module that contains it. Because our import lived in a provider
 * that the root layout imports, the failure cascaded: the layout module became
 * undefined, expo-router destructured `undefined`, and Expo Go showed only
 * "Sorry, something went wrong" — naming neither the module nor the cause.
 *
 * Guarding the CALL SITES does not help. The throw happens while the module
 * graph is being evaluated, long before any function runs. The only fix is to
 * never import it at module scope, and to require it lazily inside a try.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Remote push needs a development build on Android; Expo Go cannot do it. */
export const remotePushSupported = !(isExpoGo && Platform.OS === 'android');

export const pushUnavailableReason = remotePushSupported
  ? null
  : 'Notifications need a development build on Android — Expo Go removed remote push in SDK 53.';

type Notifications = typeof NotificationsModule;

let cached: Notifications | null | undefined;

/**
 * Lazily load expo-notifications, returning null where it cannot be loaded.
 *
 * The result is cached so a failing environment is not retried on every call,
 * and so the (loud) console error appears once rather than on every render.
 */
export function getNotifications(): Notifications | null {
  if (cached !== undefined) return cached;

  if (!remotePushSupported) {
    cached = null;
    return null;
  }

  try {
    cached = require('expo-notifications') as Notifications;
  } catch {
    cached = null;
  }
  return cached;
}

/** Run a notification call, returning `fallback` if the module is unavailable
 *  or the call throws. */
export async function safeNotify<T>(
  fn: (n: Notifications) => Promise<T>,
  fallback: T,
): Promise<T> {
  const n = getNotifications();
  if (!n) return fallback;
  try {
    return await fn(n);
  } catch {
    return fallback;
  }
}

/** Synchronous variant, for listener registration. */
export function safeNotifySync<T>(fn: (n: Notifications) => T, fallback: T): T {
  const n = getNotifications();
  if (!n) return fallback;
  try {
    return fn(n);
  } catch {
    return fallback;
  }
}

/**
 * One-time runtime configuration, called at startup.
 *
 * Two settings that decide whether a delivered notification is actually SEEN,
 * both easy to leave out and invisible when you do — the send succeeds, the
 * server reports delivery, and the phone shows nothing.
 *
 *   1. The foreground handler. By default expo-notifications suppresses a
 *      notification that arrives while the app is open. That is the exact
 *      situation the phone is in during a demo, and during most of a reader's
 *      session.
 *
 *   2. The Android channel. On Android 8+ every notification belongs to a
 *      channel, and one naming a channel that does not exist is dropped
 *      silently. The server sends channelId "default", so "default" has to be
 *      created here. Importance HIGH is what makes it a heads-up banner rather
 *      than a line in the shade — a breaking alert that only appears once you
 *      pull down the shade is not an alert.
 *
 * Both calls are guarded: none of this exists in Expo Go on Android.
 */
export function configurePushRuntime(): void {
  const n = getNotifications();
  if (!n) return;

  try {
    n.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        // A count nobody maintains decays into a permanent red dot, which
        // teaches the reader to ignore it.
        shouldSetBadge: false,
      }),
    });
  } catch {
    // A handler that cannot be installed costs a foreground banner, not the app.
  }

  if (Platform.OS === 'android') {
    void n
      .setNotificationChannelAsync('default', {
        name: 'News alerts',
        importance: n.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: n.AndroidNotificationVisibility.PUBLIC,
      })
      .catch(() => undefined);
  }
}
