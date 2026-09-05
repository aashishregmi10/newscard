import { z } from 'zod';
import { LanguageEnum, PlatformEnum } from './enums.js';
import { NOTIF_DAILY_CAP_MAX } from '@newscard/shared';

/**
 * The `devices` collection.  Spec Ch. 3.6.
 *
 * Devices, not users. In the MVP there are no accounts and this is the only
 * identity we hold. It exists solely to deliver notifications and enforce the
 * daily cap.
 */

export const NotifChannels = z.object({
  breaking: z.boolean().default(true),
  digest: z.boolean().default(true),
  /** OFF by default. This is the channel most likely to generate volume, and a
   *  user who has not asked for topical alerts should not receive them. */
  categories: z.boolean().default(false),
});

export const NotifPrefs = z.object({
  enabled: z.boolean().default(true),
  channels: NotifChannels,
  /** User-settable to 0..3. NEVER above 3 — the ceiling is a product decision,
   *  not a preference. Requests above it are clamped, not rejected. */
  dailyCap: z.number().int().min(0).max(NOTIF_DAILY_CAP_MAX).default(NOTIF_DAILY_CAP_MAX),
  sentToday: z.number().int().nonnegative().default(0),
  lastSentAt: z.date().nullable().optional(),
});
export type NotifPrefs = z.infer<typeof NotifPrefs>;

export const Device = z.object({
  /** A UUID v4 generated on the device at first launch. NOT a hardware
   *  identifier — never IMEI, MAC, Android ID, or advertising ID. This is what
   *  lets the Ch. 15.2 permission table be honest. */
  deviceId: z.string().uuid(),
  /** SHA-256 of the bearer token. The raw token is never stored, so a database
   *  dump yields no working credentials. */
  tokenHash: z.string().length(64),
  fcmToken: z.string().nullable().optional(),
  platform: PlatformEnum,
  appVersion: z.string().min(1),
  /** Coarse, e.g. "Android 13". Never a full build fingerprint. */
  osVersion: z.string().nullable().optional(),
  langPrefs: z.array(LanguageEnum).min(1),
  notif: NotifPrefs,
  lastSeenAt: z.date(),
});
export type Device = z.infer<typeof Device>;

/** Clamp rather than reject, per Ch. 6.7.2 — the response reports what was stored. */
export function clampDailyCap(requested: number): number {
  if (!Number.isFinite(requested)) return NOTIF_DAILY_CAP_MAX;
  return Math.max(0, Math.min(NOTIF_DAILY_CAP_MAX, Math.trunc(requested)));
}
