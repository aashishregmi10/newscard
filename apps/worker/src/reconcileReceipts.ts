import { collections, getDb } from '@saar/db';
import { checkReceipts } from './push/expoPush.js';

/**
 * Turn "Expo accepted it" into "a handset showed it".  Spec Ch. 10.8.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * A push ticket means the message was ACCEPTED for delivery, not delivered.
 * Actual delivery is reported later, by receipt, against the ticket id. The
 * transport already knew this and said so; `checkReceipts` was written,
 * exported, and called by nothing.
 *
 * So `stats.delivered` was the accepted count wearing the delivered name, and
 * the CMS showed it as delivery. A delivery figure that always reads 100% is
 * worse than no figure at all, because it is believed — and it is believed
 * precisely when it matters, which is when someone asks why a story did not
 * reach anyone.
 *
 * ── Why it waits ────────────────────────────────────────────────────────────
 *
 * Expo keeps receipts for 24 hours and asks that they are not polled
 * immediately. A ticket read back too soon is "not ready", which is
 * indistinguishable from failure unless the caller models a pending state — so
 * this leaves a margin, and anything still pending is left for the next pass
 * rather than recorded as a loss.
 */

/** How long after sending before receipts are worth asking for. */
export const RECEIPT_DELAY_MS = 15 * 60_000;

/** After this, a still-pending receipt is never coming. Expo keeps them 24h. */
export const RECEIPT_GIVE_UP_MS = 24 * 60 * 60_000;

export interface ReconcileResult {
  notifications: number;
  delivered: number;
  failed: number;
  pending: number;
  tokensCleared: number;
}

interface TicketRow {
  deviceId: string;
  ticketId: string;
}

export async function reconcileReceipts(now: Date = new Date()): Promise<ReconcileResult> {
  const c = collections(getDb());
  const result: ReconcileResult = {
    notifications: 0,
    delivered: 0,
    failed: 0,
    pending: 0,
    tokensCleared: 0,
  };

  for (;;) {
    // Claimed the same way the quiet-hours sweep claims: a compare-and-swap on
    // a field the filter requires to be null, so two processes cannot both
    // reconcile the same row and double-count the result.
    const claimed = await c.notifications.findOneAndUpdate(
      {
        sentAt: { $ne: null, $lte: new Date(now.getTime() - RECEIPT_DELAY_MS) },
        receiptsCheckedAt: null,
        'tickets.0': { $exists: true },
      },
      { $set: { receiptsCheckedAt: now } },
      { returnDocument: 'after' },
    );

    if (!claimed) break;
    result.notifications++;

    const tickets = ((claimed as { tickets?: TicketRow[] }).tickets ?? []).filter(
      (t) => t && t.ticketId,
    );
    const byTicket = new Map(tickets.map((t) => [t.ticketId, t.deviceId]));

    const outcome = await checkReceipts(tickets.map((t) => t.ticketId));

    result.delivered += outcome.delivered;
    result.failed += outcome.errors.length;
    result.pending += outcome.pending;

    // Expo now reports these handsets as gone. Cleared, not deleted — a
    // reinstall re-registers the same deviceId and the reader's preferences
    // should survive it.
    const deadDevices = outcome.unregistered
      .map((ticketId) => byTicket.get(ticketId))
      .filter((d): d is string => typeof d === 'string');

    if (deadDevices.length > 0) {
      const res = await c.devices.updateMany(
        { deviceId: { $in: deadDevices } },
        { $set: { fcmToken: null, updatedAt: now } },
      );
      result.tokensCleared += res.modifiedCount;
    }

    const stillPending = outcome.pending > 0;
    const tooOld = now.getTime() - (claimed.sentAt as Date).getTime() > RECEIPT_GIVE_UP_MS;

    await c.notifications.updateOne(
      { _id: claimed._id },
      {
        $set: {
          // The honest number, at last: receipts confirmed this many.
          'stats.delivered': outcome.delivered,
          receipts: {
            delivered: outcome.delivered,
            failed: outcome.errors.length,
            pending: outcome.pending,
            unregistered: deadDevices.length,
            checkedAt: now,
          },
          // Leave it unclaimed if Expo has not decided yet and there is still
          // time — recording a pending receipt as a loss would understate
          // delivery, which is the same sin as overstating it.
          ...(stillPending && !tooOld ? { receiptsCheckedAt: null } : {}),
          updatedAt: now,
        },
      },
    );
  }

  return result;
}

/**
 * Run reconciliation on an interval; returns a function that stops it.
 *
 * Same shape and the same caveat as the quiet-hours sweep: a `setInterval` is
 * not a scheduler, and the claim is what makes running it in several processes
 * safe rather than merely unlikely to collide.
 */
export const RECONCILE_INTERVAL_MS = 10 * 60_000;

export function startReceiptReconciliation(
  intervalMs: number = RECONCILE_INTERVAL_MS,
): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await reconcileReceipts();
      if (r.notifications > 0) {
        console.log(
          `[receipts] ${r.notifications} notification(s): ${r.delivered} delivered, ` +
            `${r.failed} failed, ${r.pending} pending, ${r.tokensCleared} token(s) cleared`,
        );
      }
    } catch (e) {
      console.error('[receipts] failed', e);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), intervalMs);
  handle.unref?.();
  void tick();

  return () => clearInterval(handle);
}
