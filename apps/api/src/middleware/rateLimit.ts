import { ensureRateCounterIndexes } from '@saar/db';
import { rateLimit, byIp, byDeviceToken } from '@saar/http';

/**
 * Rate limiting rules for the public read API.  Spec Ch. 6.10.
 *
 * The counter lives in @saar/db and the Express adapter in @saar/http. What is
 * left here is the table of limits, which is where it belongs: a limit is a
 * product decision about one route, not a property of limiting.
 *
 * ── The Nepal-specific tuning that matters ──────────────────────────────────
 * Carrier-grade NAT is widespread here, so a single apparent IP can be an
 * entire mobile cell rather than one person. Per-IP limits are therefore set
 * generously and exist only to blunt crude abuse; the per-device limits do the
 * real work. A limit tuned as though one IP equals one user locks out a whole
 * neighbourhood.
 *
 * Every rule here fails OPEN, which is the default: if the counter store is
 * unavailable, serving the news matters more than enforcing a limit whose
 * purpose is to blunt abuse. The CMS sign-in limiter answers this the opposite
 * way, and says why.
 */

/** Kept under its old name — server.ts and the integration suite both call it. */
export const ensureRateLimitIndexes = ensureRateCounterIndexes;

export type { RateRule } from '@saar/http';
export { rateLimit } from '@saar/http';

/** Generous: one IP may be a whole CGNAT cell (see header note). */
export const publicReadLimit = rateLimit({
  name: 'read',
  limit: 120,
  windowMs: 60_000,
  key: byIp,
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
  key: byDeviceToken,
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
  key: byDeviceToken,
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
  key: byIp,
});

export const deviceRegisterLimit = rateLimit({
  name: 'devreg',
  limit: 10,
  windowMs: 60 * 60_000,
  key: byIp,
});
