import { ObjectId } from 'mongodb';
import { collections, getDb, type DeviceDoc } from '@saar/db';
import {
  evaluateSendGate,
  NPT_OFFSET_MINUTES,
  type NotificationType,
  type SuppressionReason,
} from '@saar/shared';
import { isValidPushToken, sendPush, type PushTarget } from './push/expoPush.js';

/**
 * Turning one notification into many sends.  Spec Ch. 10.4–10.8.
 *
 * The gate itself lives in @saar/shared and is pure, clock-injectable and
 * tested. This module is the part that has a database: it decides what
 * `sentToday` actually is right now, picks a language per device, calls the
 * transport, and writes back what happened.
 *
 * Nothing here re-implements a policy. If a rule about caps, quiet hours or
 * channels appears to be missing it belongs in evaluateSendGate, not here —
 * two copies of that logic is how a cap ends up enforced on one path and not
 * the other.
 */

export interface DispatchReport {
  notificationId: string;
  type: NotificationType;
  /** Registered devices, whatever their state. */
  devices: number;
  /**
   * Registered but carrying no usable push token — the state every device is in
   * until it has run a development build and granted permission.
   *
   * Counted separately from suppressions on purpose: "nothing sent" for this
   * reason is a setup problem, not a policy decision, and the two have
   * completely different fixes.
   */
  noToken: number;
  /** Passed the gate and was handed to the transport. */
  attempted: number;
  /** Expo accepted it. Delivery is confirmed later, by receipt. */
  accepted: number;
  suppressed: number;
  bySuppression: Partial<Record<SuppressionReason, number>>;
  /** Tokens Expo reports as dead; cleared so we stop sending into the void. */
  unregistered: number;
  failed: Array<{ deviceId: string; message: string }>;
  /**
   * Breaking news the gate HELD for quiet hours rather than dropped, and the
   * time the window opens.
   *
   * These ARE delivered: the device ids are recorded on the notification and
   * sweepDeferred() sends to exactly those handsets once the window opens. The
   * count stays separate from `suppressed` because the two mean opposite
   * things — one is "not yet", the other is "never".
   */
  heldForQuietHours: number;
  quietHoursUntil: string | null;
}

/**
 * Which Nepali day a moment falls in.
 *
 * The cap is three a day in the READER's day, not in UTC's. Using UTC would
 * roll the counter over at 05:45 local — mid-morning — so a reader could
 * receive three before breakfast and three more after it.
 */
export function nptDayKey(at: Date): string {
  return new Date(at.getTime() + NPT_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * `sentToday`, corrected for the day having changed.
 *
 * The stored counter only means anything alongside the day it was last written
 * in. Rather than a nightly reset job — a cron that can fail silently and leave
 * every device permanently capped — staleness is derived at read time. A
 * counter from yesterday is simply zero today.
 */
export function effectiveSentToday(
  sentToday: number,
  lastSentAt: Date | null | undefined,
  now: Date,
): number {
  if (!lastSentAt) return 0;
  return nptDayKey(lastSentAt) === nptDayKey(now) ? sentToday : 0;
}

/**
 * The language to send in.
 *
 * The device's own preference order wins, restricted to languages this
 * notification actually has copy for. Returns null when there is no overlap —
 * the gate rejects that case first, and this is the belt to its braces.
 */
function pickLanguage(
  langPrefs: readonly string[],
  available: readonly string[],
): 'ne' | 'en' | null {
  for (const l of langPrefs) {
    if (available.includes(l) && (l === 'ne' || l === 'en')) return l;
  }
  return null;
}

export interface DispatchOptions {
  /**
   * Send to these devices only.
   *
   * Used by the quiet-hours sweep, which must reach the handsets that were HELD
   * and no others — re-running a full dispatch would deliver the notification a
   * second time to everyone who already got it.
   */
  onlyDeviceIds?: string[];
  /**
   * Injectable clock, for tests. Quiet hours make wall-clock behaviour
   * untestable otherwise: half the branches only exist between 21:30 and 06:30
   * NPT, and a suite that passes at noon and fails at midnight is worse than no
   * suite.
   */
  now?: Date;
}

export async function dispatchNotification(
  notificationId: string,
  opts: DispatchOptions = {},
): Promise<DispatchReport> {
  const now = opts.now ?? new Date();
  const c = collections(getDb());

  const notif = await c.notifications.findOne({ _id: new ObjectId(notificationId) });
  if (!notif) throw new Error(`No such notification: ${notificationId}`);

  const type = notif.type as NotificationType;
  const available = notif.audience.languages;

  // Loaded in one go. At demo and launch scale this is a few thousand documents
  // at most; past that it wants a cursor and a bounded send window — a change
  // to this function, and not to the gate.
  const sweeping = Array.isArray(opts.onlyDeviceIds);
  const devices = (await c.devices
    .find(sweeping ? { deviceId: { $in: opts.onlyDeviceIds! } } : {})
    .toArray()) as DeviceDoc[];

  const report: DispatchReport = {
    notificationId,
    type,
    devices: devices.length,
    noToken: 0,
    attempted: 0,
    accepted: 0,
    suppressed: 0,
    bySuppression: {},
    unregistered: 0,
    failed: [],
    heldForQuietHours: 0,
    quietHoursUntil: null,
  };

  const targets: PushTarget[] = [];
  /** Held for quiet hours. These are delivered later by sweepDeferred. */
  const deferredDeviceIds: string[] = [];

  for (const d of devices) {
    if (!isValidPushToken(d.fcmToken)) {
      report.noToken++;
      continue;
    }

    const decision = evaluateSendGate({
      device: {
        enabled: d.notif.enabled,
        channels: d.notif.channels,
        dailyCap: d.notif.dailyCap,
        sentToday: effectiveSentToday(d.notif.sentToday, d.notif.lastSentAt ?? null, now),
        lastSentAt: d.notif.lastSentAt ?? null,
        langPrefs: d.langPrefs,
      },
      type,
      availableLanguages: available,
      now,
    });

    if (!decision.send) {
      report.suppressed++;
      const reason = decision.reason ?? 'disabled';
      report.bySuppression[reason] = (report.bySuppression[reason] ?? 0) + 1;
      if (decision.deferUntil) {
        report.heldForQuietHours++;
        report.quietHoursUntil = decision.deferUntil.toISOString();
        deferredDeviceIds.push(d.deviceId);
      }
      continue;
    }

    const lang = pickLanguage(d.langPrefs, available);
    if (!lang) {
      report.suppressed++;
      report.bySuppression.no_language = (report.bySuppression.no_language ?? 0) + 1;
      continue;
    }

    targets.push({
      deviceId: d.deviceId,
      token: d.fcmToken,
      title: notif.title[lang],
      body: notif.body[lang],
      // The shape useNotificationRouting expects. `deepLink` alone is enough:
      // it already carries the slug for an article, and it is the only thing
      // that can express the non-article targets (feed, saved, settings).
      data: { type, deepLink: notif.deepLink },
    });
  }

  report.attempted = targets.length;

  const outcome = await sendPush(targets);
  report.accepted = outcome.accepted.length;
  report.unregistered = outcome.unregistered.length;
  report.failed = outcome.failed;

  await recordSends(
    outcome.accepted.map((a) => a.deviceId),
    now,
  );

  if (outcome.unregistered.length > 0) {
    // Cleared, not deleted: the reader may reinstall and re-register the same
    // deviceId, and the preferences they chose should survive that.
    await c.devices.updateMany(
      { deviceId: { $in: outcome.unregistered } },
      { $set: { fcmToken: null, updatedAt: now } },
    );
  }

  /**
   * Record the outcome.
   *
   * A sweep ADDS to the totals rather than replacing them: it is the second
   * half of one send, and overwriting would erase the first half from the
   * record. A first dispatch sets them.
   *
   * Either way the deferral state is rewritten from what this run actually
   * found, so a sweep that delivered everything clears it and a sweep that
   * somehow ran inside the window re-arms it.
   */
  const deferral =
    deferredDeviceIds.length > 0
      ? {
          deferredUntil: report.quietHoursUntil ? new Date(report.quietHoursUntil) : null,
          deferredDeviceIds,
          deferredSweptAt: null,
        }
      : { deferredUntil: null, deferredDeviceIds: [], deferredSweptAt: null };

  const dispatchSummary = {
    devices: report.devices,
    noToken: report.noToken,
    bySuppression: report.bySuppression,
    unregistered: report.unregistered,
    failed: report.failed.length,
    heldForQuietHours: report.heldForQuietHours,
  };

  await c.notifications.updateOne(
    { _id: notif._id },
    sweeping
      ? {
          $inc: {
            'stats.attempted': report.attempted,
            'stats.delivered': report.accepted,
          },
          $push: { tickets: { $each: outcome.accepted } },
          $set: { ...deferral, sweptAt: now, lastSweep: dispatchSummary, updatedAt: now },
        }
      : {
          $set: {
            sentAt: now,
            stats: {
              attempted: report.attempted,
              // Accepted by Expo. Replaced with true delivery when receipts are
              // reconciled; never inflated by treating a ticket as a delivery.
              delivered: report.accepted,
              suppressed: report.suppressed,
            },
            // { deviceId, ticketId } pairs, not bare ids: a receipt reporting
            // a dead handset has to be traceable back to the token to clear.
            tickets: outcome.accepted,
            receiptsCheckedAt: null,
            dispatch: dispatchSummary,
            ...deferral,
            updatedAt: now,
          },
        },
  );

  return report;
}

/**
 * Advance the per-device counters for everything actually sent.
 *
 * Two writes rather than one, because a device whose last send was yesterday
 * must be SET to 1 and not incremented — incrementing a stale counter is how a
 * reader ends up capped on a day they have received nothing.
 */
async function recordSends(deviceIds: string[], now: Date): Promise<void> {
  if (deviceIds.length === 0) return;
  const c = collections(getDb());
  const today = nptDayKey(now);

  const docs = await c.devices
    .find({ deviceId: { $in: deviceIds } }, { projection: { deviceId: 1, 'notif.lastSentAt': 1 } })
    .toArray();

  const sameDay: string[] = [];
  const newDay: string[] = [];
  for (const d of docs) {
    const last = d.notif?.lastSentAt;
    if (last && nptDayKey(last) === today) sameDay.push(d.deviceId);
    else newDay.push(d.deviceId);
  }

  await Promise.all([
    sameDay.length
      ? c.devices.updateMany(
          { deviceId: { $in: sameDay } },
          { $inc: { 'notif.sentToday': 1 }, $set: { 'notif.lastSentAt': now, updatedAt: now } },
        )
      : Promise.resolve(),
    newDay.length
      ? c.devices.updateMany(
          { deviceId: { $in: newDay } },
          { $set: { 'notif.sentToday': 1, 'notif.lastSentAt': now, updatedAt: now } },
        )
      : Promise.resolve(),
  ]);
}
