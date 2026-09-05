import { NOTIF_DAILY_CAP_MAX, NOTIF_MIN_GAP_MINUTES, NPT_OFFSET_MINUTES } from './constants.js';

/**
 * The notification send gate.  Spec Ch. 10.4, 10.5.
 *
 * ONE of the four modules where a bug is a severity-1 incident rather than a
 * defect, and the only thing standing between an editor's enthusiasm and a
 * reader's uninstall.
 *
 * Enforced SERVER-SIDE, before dispatch. A client-side cap is not a cap: the
 * notification has already been sent and paid for by the time the client could
 * refuse it, and a reinstall resets it.
 *
 * Pure and clock-injectable so every branch is testable without a database or a
 * wall clock.
 */

export type NotificationType =
  | 'breaking'
  | 'digest'
  | 'category'
  | 'correction'
  | 'article_retracted';

export type ChannelKey = 'breaking' | 'digest' | 'categories';

export type SuppressionReason =
  | 'disabled'
  | 'channel_off'
  | 'cap_reached'
  | 'min_gap'
  | 'quiet_hours'
  | 'no_language';

export interface DeviceNotifState {
  enabled: boolean;
  channels: { breaking: boolean; digest: boolean; categories: boolean };
  dailyCap: number;
  sentToday: number;
  lastSentAt: Date | null;
  langPrefs: string[];
}

export interface GateDecision {
  send: boolean;
  reason?: SuppressionReason;
  /** Breaking news during quiet hours is HELD, not dropped, and delivered when
   *  the window opens. Dropping it would defeat the point of the channel. */
  deferUntil?: Date;
}

/**
 * Types exempt from the daily cap.  Spec Ch. 15.7.
 *
 * Correcting an error is not a marketing message. Without this exemption the
 * readers most likely to have seen the error are the least likely to see the
 * correction, which is exactly backwards.
 */
const CAP_EXEMPT: ReadonlySet<NotificationType> = new Set(['correction', 'article_retracted']);

/** Quiet hours in Nepal Time.  Spec Ch. 10.5. */
export const QUIET_START_MIN = 21 * 60 + 30; // 21:30
export const QUIET_END_MIN = 6 * 60 + 30; //   06:30

export function channelFor(type: NotificationType): ChannelKey {
  if (type === 'digest') return 'digest';
  if (type === 'category') return 'categories';
  // Corrections and retractions ride the breaking channel: a reader who
  // switched breaking off has opted out of urgent interruptions generally.
  return 'breaking';
}

/** Minutes past midnight in Nepal Time (UTC+05:45). */
export function nptMinutesOfDay(at: Date): number {
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return (utcMinutes + NPT_OFFSET_MINUTES) % (24 * 60);
}

export function isQuietHours(at: Date): boolean {
  const m = nptMinutesOfDay(at);
  // The window wraps midnight, so it is a union rather than a range.
  return m >= QUIET_START_MIN || m < QUIET_END_MIN;
}

/** The next 06:30 NPT at or after `at`. */
export function nextQuietWindowEnd(at: Date): Date {
  const m = nptMinutesOfDay(at);
  const minutesUntil = m < QUIET_END_MIN ? QUIET_END_MIN - m : 24 * 60 - m + QUIET_END_MIN;
  return new Date(at.getTime() + minutesUntil * 60_000);
}

export interface GateInput {
  device: DeviceNotifState;
  type: NotificationType;
  /** Languages this notification has copy for. */
  availableLanguages: string[];
  now: Date;
  minGapMinutes?: number;
}

export function evaluateSendGate(input: GateInput): GateDecision {
  const { device, type, availableLanguages, now } = input;
  const minGap = input.minGapMinutes ?? NOTIF_MIN_GAP_MINUTES;

  if (!device.enabled) return { send: false, reason: 'disabled' };

  if (!device.channels[channelFor(type)]) {
    return { send: false, reason: 'channel_off' };
  }

  // We never send an English title to a Nepali-only device. Checked before the
  // cap so a device that could not read it does not burn a slot.
  if (!device.langPrefs.some((l) => availableLanguages.includes(l))) {
    return { send: false, reason: 'no_language' };
  }

  const exempt = CAP_EXEMPT.has(type);

  if (!exempt) {
    // The ceiling is a product decision, not a preference: a stored value above
    // the maximum is clamped here as well as at write time.
    const cap = Math.min(device.dailyCap, NOTIF_DAILY_CAP_MAX);
    if (device.sentToday >= cap) return { send: false, reason: 'cap_reached' };
  }

  if (isQuietHours(now)) {
    // Breaking news is held until the window opens. Everything else is simply
    // suppressed — a digest that arrives six hours late is not a digest.
    if (type === 'breaking') {
      return { send: false, reason: 'quiet_hours', deferUntil: nextQuietWindowEnd(now) };
    }
    if (!exempt) return { send: false, reason: 'quiet_hours' };
  }

  // Breaking bypasses the minimum gap — that is what makes it breaking — but it
  // never bypasses the daily cap, checked above.
  if (type !== 'breaking' && !exempt && device.lastSentAt) {
    const gapMinutes = (now.getTime() - device.lastSentAt.getTime()) / 60_000;
    if (gapMinutes < minGap) return { send: false, reason: 'min_gap' };
  }

  return { send: true };
}
