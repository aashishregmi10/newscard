import type { NextFunction, Request, Response } from 'express';
import { getDb } from '@newscard/db';
import { AppError } from '@newscard/shared';

/**
 * Rate limiting.  Spec Ch. 6.10.
 *
 * MONGO-BACKED, not in-memory. An in-memory counter silently multiplies every
 * limit by the number of running instances, and the failure is invisible: the
 * limit simply stops working the moment you scale past one process.
 *
 * ── The Nepal-specific tuning that matters ──────────────────────────────────
 * Carrier-grade NAT is widespread here, so a single apparent IP can be an
 * entire mobile cell rather than one person. Per-IP limits are therefore set
 * generously and exist only to blunt crude abuse; the per-device limits do the
 * real work. A limit tuned as though one IP equals one user locks out a whole
 * neighbourhood.
 */

interface CounterDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

const counters = () => getDb().collection<CounterDoc>('rateCounters');

/** TTL index so spent windows disappear without a sweep job. */
export async function ensureRateLimitIndexes(): Promise<void> {
  await counters().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'rate_ttl' });
}

export interface RateRule {
  /** Human name, used in the counter key and in logs. */
  name: string;
  limit: number;
  windowMs: number;
  /** What to count against. Returning null skips the check entirely. */
  key: (req: Request) => string | null;
}

/**
 * Fixed-window counter.
 *
 * A sliding window would be fairer at the boundary, but needs either a sorted
 * set per key or a script; a fixed window costs one atomic upsert and is more
 * than accurate enough for limits whose purpose is to blunt abuse rather than
 * meter usage precisely.
 */
async function hit(rule: RateRule, id: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const bucket = Math.floor(now / rule.windowMs);
  const key = `${rule.name}:${id}:${bucket}`;
  const expiresAt = new Date((bucket + 1) * rule.windowMs);

  const doc = await counters().findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, returnDocument: 'after' },
  );

  const count = doc?.count ?? 1;
  return {
    allowed: count <= rule.limit,
    retryAfterSec: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
  };
}

export function rateLimit(rule: RateRule) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = rule.key(req);
    if (id === null) {
      next();
      return;
    }

    hit(rule, id)
      .then(({ allowed, retryAfterSec }) => {
        res.setHeader('X-RateLimit-Limit', String(rule.limit));
        if (!allowed) {
          res.setHeader('Retry-After', String(retryAfterSec));
          next(
            new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', {
              retryAfterSec,
            }),
          );
          return;
        }
        next();
      })
      .catch(() => {
        // FAIL OPEN. If the counter store is unavailable, serving news is more
        // important than enforcing a limit whose purpose is to blunt abuse. A
        // rate limiter that takes the site down when its database hiccups has
        // caused a worse outage than the one it was preventing.
        next();
      });
  };
}

const ip = (req: Request): string => req.ip ?? 'unknown';
const deviceToken = (req: Request): string | null => {
  const auth = req.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7, 39); // a prefix is enough to bucket by, and logs less
};

/** Generous: one IP may be a whole CGNAT cell (see header note). */
export const publicReadLimit = rateLimit({
  name: 'read',
  limit: 120,
  windowMs: 60_000,
  key: ip,
});

/** Per device — this is the limit that does the real work. */
export const eventsLimit = rateLimit({
  name: 'events',
  limit: 30,
  windowMs: 60_000,
  key: (req) => deviceToken(req) ?? ip(req),
});

export const deviceRegisterLimit = rateLimit({
  name: 'devreg',
  limit: 10,
  windowMs: 60 * 60_000,
  key: ip,
});
