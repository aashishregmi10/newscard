import { getDb } from './client.js';

/**
 * The fixed-window counter behind every rate limit.  Spec Ch. 6.10.
 *
 * MONGO-BACKED, not in-memory. An in-memory counter silently multiplies every
 * limit by the number of running processes, and the failure is invisible: the
 * limit simply stops working the moment you scale past one instance.
 *
 * It lives here, in the database package, rather than in either server, because
 * both of them need it and neither should import the other. The Express
 * adapters stay in the apps — this is only the arithmetic and the storage.
 */

interface CounterDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

const counters = () => getDb().collection<CounterDoc>('rateCounters');

/** TTL index, so spent windows disappear without a sweep job. */
export async function ensureRateCounterIndexes(): Promise<void> {
  await counters().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'rate_ttl' });
}

export interface CounterHit {
  allowed: boolean;
  retryAfterSec: number;
  count: number;
}

/**
 * Count one request against `name:id` and say whether it is still under `limit`.
 *
 * A sliding window would be fairer at the boundary, but needs either a sorted
 * set per key or a script; a fixed window costs one atomic upsert and is more
 * than accurate enough for limits whose purpose is to blunt abuse rather than
 * to meter usage precisely.
 */
export async function hitRateCounter(
  name: string,
  id: string,
  limit: number,
  windowMs: number,
): Promise<CounterHit> {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const key = `${name}:${id}:${bucket}`;
  const expiresAt = new Date((bucket + 1) * windowMs);

  const doc = await counters().findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, returnDocument: 'after' },
  );

  const count = doc?.count ?? 1;
  return {
    allowed: count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
    count,
  };
}

/**
 * Forget a key's current window.
 *
 * Used after a SUCCESSFUL login: a person who mistyped their password twice and
 * then got it right should not carry those two attempts around for the rest of
 * the window. Without this the limiter punishes ordinary typing.
 */
export async function clearRateCounter(name: string, id: string, windowMs: number): Promise<void> {
  const bucket = Math.floor(Date.now() / windowMs);
  await counters().deleteOne({ _id: `${name}:${id}:${bucket}` });
}
