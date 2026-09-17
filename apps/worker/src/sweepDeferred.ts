import { collections, getDb } from '@saar/db';
import { dispatchNotification, type DispatchReport } from './dispatch.js';

/**
 * Deliver the notifications quiet hours held.  Spec Ch. 10.5.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * The send gate distinguishes two outcomes that look identical from outside:
 * breaking news arriving at 23:00 is HELD until the window opens, while a
 * digest at the same moment is simply suppressed. Holding is the whole reason
 * the breaking channel is allowed to exist — an urgent story is not urgent
 * eight hours later, but it is still worth sending at 06:30, and dropping it
 * defeats the channel.
 *
 * The gate decided to hold, returned the time to release, and nothing acted on
 * it. Those readers received nothing at all. The count was at least reported
 * rather than hidden, which is how it was noticed.
 *
 * ── Why it sweeps rather than schedules ─────────────────────────────────────
 *
 * A timer per notification would not survive a restart, and the release time is
 * already written on the document. So the state lives in the database and this
 * asks a question — "is anything due?" — that is correct after a crash, a
 * deploy, or a week of downtime.
 *
 * ── Why it cannot double-send ───────────────────────────────────────────────
 *
 * Each notification is CLAIMED with a compare-and-swap before anything is sent:
 * the filter requires `deferredSweptAt: null`, so a second caller — another
 * process, an overlapping tick — matches nothing and moves on. Claiming before
 * sending means a crash mid-send loses a delivery rather than repeating one,
 * which is the right way round for something that buzzes in someone's pocket.
 */

export interface SweepResult {
  /** Notifications whose window had opened. */
  claimed: number;
  reports: DispatchReport[];
}

export async function sweepDeferred(now: Date = new Date()): Promise<SweepResult> {
  const c = collections(getDb());
  const result: SweepResult = { claimed: 0, reports: [] };

  // One at a time, claiming as we go. A findOneAndUpdate loop rather than a
  // find-then-update: the gap between reading a list and acting on it is
  // exactly where a second process sends the same notification again.
  for (;;) {
    const claimed = await c.notifications.findOneAndUpdate(
      {
        deferredUntil: { $ne: null, $lte: now },
        deferredSweptAt: null,
      },
      { $set: { deferredSweptAt: now } },
      { returnDocument: 'after' },
    );

    if (!claimed) break;

    const deviceIds = (claimed as { deferredDeviceIds?: string[] }).deferredDeviceIds ?? [];
    result.claimed++;

    if (deviceIds.length === 0) {
      // Claimed but nothing to send: clear the deferral so it is not examined
      // on every future tick.
      await c.notifications.updateOne(
        { _id: claimed._id },
        { $set: { deferredUntil: null, deferredDeviceIds: [], updatedAt: now } },
      );
      continue;
    }

    // The gate runs again for each of these devices. That is deliberate: hours
    // have passed, and a reader who has since switched notifications off, hit
    // their daily cap, or uninstalled must not receive this because of a
    // decision taken last night.
    result.reports.push(
      await dispatchNotification(claimed._id.toString(), { now, onlyDeviceIds: deviceIds }),
    );
  }

  return result;
}

/**
 * Run the sweep on an interval, and return a function that stops it.
 *
 * A `setInterval` in the CMS process is not a real scheduler, and this is the
 * honest reason it is acceptable here: the claim above makes a double-send
 * impossible, so the worst a second instance can do is ask a question and get
 * no rows. When this becomes a fleet, the timer moves to a cron or a queue and
 * `sweepDeferred` itself does not change.
 *
 * Five minutes: the release time is a boundary readers do not see, and waking
 * every minute to find nothing due is noise in the logs for no benefit.
 */
export const SWEEP_INTERVAL_MS = 5 * 60_000;

export function startDeferredSweep(intervalMs: number = SWEEP_INTERVAL_MS): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    // A slow sweep must not overlap itself.
    if (running) return;
    running = true;
    try {
      const { claimed, reports } = await sweepDeferred();
      if (claimed > 0) {
        const accepted = reports.reduce((n, r) => n + r.accepted, 0);
        console.log(
          `[sweep] released ${claimed} held notification(s); ${accepted} accepted for delivery`,
        );
      }
    } catch (e) {
      // Never let a failed sweep take the process down. The next tick retries,
      // and the claim is only taken on a row we are about to send.
      console.error('[sweep] failed', e);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), intervalMs);
  // Do not hold the process open for this alone.
  handle.unref?.();
  // Run once at startup so a restart during quiet hours releases promptly.
  void tick();

  return () => clearInterval(handle);
}
