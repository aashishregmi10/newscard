/**
 * Timestamps a client claims, made safe to store.  Spec Ch. 3.8, 15.4.
 *
 * ── The failure this prevents ───────────────────────────────────────────────
 *
 * Measurement and crash reports carry an `occurredAt` from the handset, and a
 * handset's clock is not ours. Three collections expire rows on a MongoDB TTL
 * index, and a TTL index keyed on an attacker-controlled — or merely
 * wrong — timestamp fails in both directions, silently:
 *
 *   Clock behind.  Common on entry-level Android, and universal after a flat
 *                  battery until the network resyncs. The row is written, the
 *                  TTL monitor sees a date already past the window, and it is
 *                  deleted within the minute. The measurement vanishes — and it
 *                  vanishes disproportionately from exactly the low-end devices
 *                  this product is built for, so the data that survives is
 *                  biased towards the phones we were not worried about.
 *
 *   Clock ahead.   A date in 2030 never expires. Retention is a promise we make
 *                  about behavioural data, and this lets any client override it
 *                  by being wrong about the time.
 *
 * So the server records its OWN `receivedAt` and expires on that, and the
 * client's claim is clamped into a window where it can still be useful for
 * analysis without being able to lie usefully.
 *
 * Clamping rather than rejecting, for the same reason dwell is clamped: a batch
 * from a device with a bad clock is still real reading, and dropping it loses
 * the reader rather than the error.
 */

/**
 * How far back a claimed timestamp may reach.
 *
 * Telemetry flushes every 25 seconds and a failed batch is dropped rather than
 * queued, so nothing legitimate is more than minutes old. A week is generous
 * enough to cover a paused app and short enough that a stuck clock lands
 * visibly at the boundary instead of anywhere it likes.
 */
export const MAX_CLIENT_TIMESTAMP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Clamp a client-supplied ISO timestamp into `[now - maxAge, now]`.
 *
 * Returns `now` when the value is absent or unparseable. The future is clamped
 * to `now` exactly: a client cannot report something that has not happened, and
 * a clock a few seconds fast should not produce a timestamp that sorts ahead of
 * everything the server recorded afterwards.
 */
export function clampClientTimestamp(
  claimed: string | Date | undefined | null,
  now: Date = new Date(),
  maxAgeMs: number = MAX_CLIENT_TIMESTAMP_AGE_MS,
): Date {
  if (claimed === undefined || claimed === null) return now;

  const t = claimed instanceof Date ? claimed.getTime() : Date.parse(claimed);
  if (!Number.isFinite(t)) return now;

  const nowMs = now.getTime();
  if (t > nowMs) return now;
  if (t < nowMs - maxAgeMs) return new Date(nowMs - maxAgeMs);
  return new Date(t);
}
