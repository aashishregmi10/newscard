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

/**
 * Generous: one IP may be a whole CGNAT cell (see header note). 120 a minute
 * was one reader's worth — a feed page, Shorts, a vote card refreshing every
 * ten seconds — shared by everyone behind a carrier's address (launch review,
 * 7 Oct 2026). Twenty a second still stops a crude flood from one machine.
 */
export const publicReadLimit = rateLimit({
  name: 'read',
  limit: 1200,
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
  limit: 300,
  windowMs: 60_000,
  key: byIp,
});

/**
 * Every app launch registers, so behind one carrier address ten an hour turned
 * away most of a neighbourhood on launch day — and a device that fails to
 * register gets no push token. A per-IP ceiling for scripted floods only.
 */
export const deviceRegisterLimit = rateLimit({
  name: 'devreg',
  limit: 600,
  windowMs: 60 * 60_000,
  key: byIp,
});

/**
 * Signing in. Each one is a check against Google and a new session, so a
 * client hammering it is either broken or forging tokens. Two hundred an hour
 * from one address allows for a carrier's shared address on launch day while
 * still refusing a forger's loop. Deleting an account counts here too.
 */
export const readerSessionLimit = rateLimit({
  name: 'rsess',
  limit: 200,
  windowMs: 60 * 60_000,
  key: byIp,
});

/**
 * Votes and ratings. A reader rates six businesses at most per card, so thirty
 * a minute from one address — one CGNAT cell may be many readers — is roomy,
 * and the one-per-reader rule is the database's, not this limit's.
 */
export const interactionAnswerLimit = rateLimit({
  name: 'ixans',
  limit: 30,
  windowMs: 60_000,
  key: byIp,
});
