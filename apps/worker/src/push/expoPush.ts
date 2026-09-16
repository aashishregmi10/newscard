import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

/**
 * The transport.  Spec Ch. 10.8.
 *
 * ── Why Expo's push service and not FCM directly ────────────────────────────
 *
 * The app obtains an ExponentPushToken (src/state/DeviceContext.tsx), not a raw
 * FCM registration token. Expo holds the FCM service-account key, uploaded once
 * with `eas credentials`, and relays to FCM for Android and APNs for iOS. That
 * means ONE send path and ONE credential rotation instead of two of each, and
 * it is why FCM_PRIVATE_KEY in .env is deliberately empty.
 *
 * The two token formats are not interchangeable. Handing a raw FCM token to
 * this module fails per-message rather than loudly at startup, so tokens are
 * validated before a send rather than after.
 *
 * ── What a "ticket" does and does not tell us ───────────────────────────────
 *
 * A ticket with status "ok" means Expo ACCEPTED the message, not that a handset
 * displayed it. Actual delivery is reported later, by receipt, against the
 * ticket id. Conflating the two produces a dashboard that always reads 100%
 * delivered — which is worse than no dashboard, because it is believed.
 *
 * So tickets are recorded as `accepted`, receipts are fetched separately, and
 * the two are never added together.
 */

/** Unauthenticated: the access token is only needed for enhanced security mode,
 *  which we do not enable — the push token itself is the capability. */
const expo = new Expo();

export interface PushTarget {
  deviceId: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface SendOutcome {
  /** Expo accepted it. NOT proof of delivery — see the note above. */
  accepted: Array<{ deviceId: string; ticketId: string }>;
  /** The handset is gone: uninstalled, or the token was rotated. The caller
   *  clears these so we stop paying to send into the void on every send. */
  unregistered: string[];
  /** Everything else, kept with its message so a failure is diagnosable. */
  failed: Array<{ deviceId: string; message: string }>;
}

export function isValidPushToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && Expo.isExpoPushToken(token);
}

/**
 * Send to many devices.
 *
 * Chunking is not an optimisation — Expo rejects oversized batches outright,
 * and the chunk size is theirs to decide, so it is asked for rather than
 * assumed.
 */
export async function sendPush(targets: PushTarget[]): Promise<SendOutcome> {
  const outcome: SendOutcome = { accepted: [], unregistered: [], failed: [] };
  if (targets.length === 0) return outcome;

  const messages: ExpoPushMessage[] = targets.map((t) => ({
    to: t.token,
    title: t.title,
    body: t.body,
    data: t.data,
    sound: 'default',
    // Android: the channel must exist on the device or the notification is
    // posted silently on API 26+. The app creates "default" at startup.
    channelId: 'default',
    priority: 'high',
  }));

  const chunks = expo.chunkPushNotifications(messages);
  // The targets a chunk covers, in order — Expo returns tickets positionally
  // and gives back nothing that identifies the device, so the mapping has to be
  // maintained here.
  let offset = 0;

  for (const chunk of chunks) {
    const slice = targets.slice(offset, offset + chunk.length);
    offset += chunk.length;

    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (e) {
      // A whole chunk failed — network, or Expo is down. Every device in it is
      // a failure, not a silent omission, or the counts stop adding up.
      const message = e instanceof Error ? e.message : String(e);
      for (const t of slice) outcome.failed.push({ deviceId: t.deviceId, message });
      continue;
    }

    tickets.forEach((ticket, i) => {
      const target = slice[i];
      if (!target) return;

      if (ticket.status === 'ok') {
        outcome.accepted.push({ deviceId: target.deviceId, ticketId: ticket.id });
        return;
      }

      if (ticket.details?.error === 'DeviceNotRegistered') {
        outcome.unregistered.push(target.deviceId);
        return;
      }

      outcome.failed.push({
        deviceId: target.deviceId,
        message: ticket.details?.error ?? ticket.message ?? 'unknown push error',
      });
    });
  }

  return outcome;
}

export interface ReceiptOutcome {
  delivered: number;
  /** Tokens Expo now reports as dead. Cleared by the caller, same as above. */
  unregistered: string[];
  errors: Array<{ ticketId: string; message: string }>;
  /** Expo has not decided yet. Not an error — ask again later. */
  pending: number;
}

/**
 * Resolve tickets into actual delivery.
 *
 * Expo keeps receipts for 24 hours and asks that they are not polled
 * immediately: a ticket read back too soon is simply "not ready", which is
 * indistinguishable from failure if the caller does not model a pending state.
 */
export async function checkReceipts(ticketIds: string[]): Promise<ReceiptOutcome> {
  const out: ReceiptOutcome = { delivered: 0, unregistered: [], errors: [], pending: 0 };
  if (ticketIds.length === 0) return out;

  for (const chunk of expo.chunkPushNotificationReceiptIds(ticketIds)) {
    let receipts;
    try {
      receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      for (const id of chunk) out.errors.push({ ticketId: id, message });
      continue;
    }

    for (const id of chunk) {
      const receipt = receipts[id];
      if (!receipt) {
        out.pending++;
        continue;
      }
      if (receipt.status === 'ok') {
        out.delivered++;
        continue;
      }
      if (receipt.details?.error === 'DeviceNotRegistered') {
        out.unregistered.push(id);
        continue;
      }
      out.errors.push({ ticketId: id, message: receipt.details?.error ?? receipt.message });
    }
  }

  return out;
}
