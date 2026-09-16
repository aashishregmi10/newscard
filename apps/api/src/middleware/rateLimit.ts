import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@saar/shared';
import { ensureRateCounterIndexes, hitRateCounter } from '@saar/db';

/**
 * Rate limiting.  Spec Ch. 6.10.
 *
 * The counter itself lives in @saar/db, because the CMS needs the same one and
 * neither server should import the other. This file is the Express adapter and
 * the table of rules.
 *
 * ── The Nepal-specific tuning that matters ──────────────────────────────────
 * Carrier-grade NAT is widespread here, so a single apparent IP can be an
 * entire mobile cell rather than one person. Per-IP limits are therefore set
 * generously and exist only to blunt crude abuse; the per-device limits do the
 * real work. A limit tuned as though one IP equals one user locks out a whole
 * neighbourhood.
 */

/** Kept under its old name — server.ts and the integration suite both call it. */
export const ensureRateLimitIndexes = ensureRateCounterIndexes;

export interface RateRule {
  /** Human name, used in the counter key and in logs. */
  name: string;
  limit: number;
  windowMs: number;
  /** What to count against. Returning null skips the check entirely. */
  key: (req: Request) => string | null;
}

export function rateLimit(rule: RateRule) {
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

/**
 * Per device — this is the limit that does the real work.
 *
 * A batch carries up to 50 events, so 30 batches a minute is already far more
 * measurement than a person reading can generate. It exists because the
 * endpoint is unauthenticated by design (measurement must never be in the
 * reader's way) and an unauthenticated write with no ceiling is an invitation.
 */
export const eventsLimit = rateLimit({
  name: 'events',
  limit: 30,
  windowMs: 60_000,
  key: (req) => deviceToken(req) ?? ip(req),
});

/**
 * Ad measurement, same shape and a tighter ceiling.
 *
 * These events increment the denormalised counters an advertiser is billed and
 * reported on, so forged volume is not merely noise in a statistic — it is a
 * number we would put in front of someone who paid for it.
 */
export const adEventsLimit = rateLimit({
  name: 'adevents',
  limit: 20,
  windowMs: 60_000,
  key: (req) => deviceToken(req) ?? ip(req),
});

/**
 * Crash reports.
 *
 * Deliberately roomy: an app in a crash loop legitimately produces a burst, and
 * the handler already collapses identical faults onto one row by fingerprint.
 * The ceiling is here to bound writes from a forged client, not to ration
 * reports from a broken one.
 */
export const clientErrorLimit = rateLimit({
  name: 'cerr',
  limit: 60,
  windowMs: 60_000,
  key: ip,
});

export const deviceRegisterLimit = rateLimit({
  name: 'devreg',
  limit: 10,
  windowMs: 60 * 60_000,
  key: ip,
});
