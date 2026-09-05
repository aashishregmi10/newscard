import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Whether remote push can work in this runtime.
 *
 * Expo Go on Android dropped remote push support in SDK 53 — a development
 * build is required. Local notifications still work.
 *
 * This matters beyond a missing feature: calling into the push APIs in an
 * environment that does not support them can throw during render, and a throw
 * in a provider takes the WHOLE APP down with Expo Go's "something went wrong"
 * screen. Notifications are a secondary feature; they must never be able to
 * stop someone reading the news.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const remotePushSupported = !(isExpoGo && Platform.OS === 'android');

export const pushUnavailableReason = remotePushSupported
  ? null
  : 'Remote push needs a development build on Android — Expo Go cannot receive it.';

/**
 * Run a notification call that may not exist in this runtime.
 * Returns `fallback` instead of throwing.
 */
export async function safeNotify<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Synchronous variant, for listener registration. */
export function safeNotifySync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
