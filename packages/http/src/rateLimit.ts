import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@saar/shared';
import { hitRateCounter } from '@saar/db';

/**
 * The Express adapter over the shared rate counter.  Spec Ch. 6.10.
 *
 * The counter itself lives in @saar/db, because it is storage. This is the
 * part that speaks HTTP: it turns a decision into a 429 with a Retry-After,
 * and it decides what happens when the counter store itself is unavailable.
 *
 * Both servers use it; each keeps its own table of rules, because a limit is a
 * product decision about one route and not a property of limiting.
 */

export interface RateRule {
  /** Human name, used in the counter key and in logs. */
  name: string;
  limit: number;
  windowMs: number;
  /** What to count against. Returning null skips the check entirely. */
  key: (req: Request) => string | null;
  /**
   * What to do when the COUNTER STORE is unreachable.
   *
   * This is a genuine per-route decision and the two servers answer it
   * differently, so it is a parameter rather than a policy.
   *
   *   'open'   — serve the request. For public reads: a limiter that takes the
   *              site down when its database hiccups has caused a worse outage
   *              than the one it was preventing.
   *   'closed' — refuse. For sign-in: unlimited password guesses are worse than
   *              an editor waiting a moment.
   */
  onStoreFailure?: 'open' | 'closed';
  /** Message used when the limit is hit. */
  message?: string;
}

export function rateLimit(rule: RateRule) {
  const failure = rule.onStoreFailure ?? 'open';
  const message = rule.message ?? 'Too many requests. Please slow down.';

  return (req: Request, res: Response, next: NextFunction): void => {
    const id = rule.key(req);
    if (id === null) {
      next();
      return;
    }

    hitRateCounter(rule.name, id, rule.limit, rule.windowMs)
      .then(({ allowed, retryAfterSec }) => {
        res.setHeader('X-RateLimit-Limit', String(rule.limit));
        if (!allowed) {
          res.setHeader('Retry-After', String(retryAfterSec));
          next(new AppError('RATE_LIMITED', message, { retryAfterSec }));
          return;
        }
        next();
      })
      .catch(() => {
        if (failure === 'closed') {
          next(new AppError('RATE_LIMITED', 'Temporarily unavailable. Try again shortly.'));
          return;
        }
        next();
      });
  };
}

/** Count against the caller's address. */
export const byIp = (req: Request): string => req.ip ?? 'unknown';

/**
 * Count against the device's bearer token where there is one, else the address.
 *
 * A prefix is enough to bucket by, and logs less of a credential than the whole
 * token would.
 */
export const byDeviceToken = (req: Request): string => {
  const auth = req.get('authorization');
  if (!auth?.startsWith('Bearer ')) return byIp(req);
  return auth.slice(7, 39);
};
