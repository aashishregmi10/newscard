import { z } from 'zod';
import { ObjectIdString } from './common.js';

/**
 * The `readEvents` collection.  Spec Ch. 3.8.
 *
 * The only behavioural data we collect, deliberately coarse and keyed on
 * deviceId rather than any personal identity. A TTL index expires rows after 90
 * days: raw behavioural data we do not need is a liability, not an asset.
 */

/** Longer than this almost always means the phone was left on the screen. */
export const MAX_DWELL_MS = 120_000;

export const ReadEvent = z.object({
  deviceId: z.string().uuid(),
  articleId: ObjectIdString,
  dwellMs: z.number().int().nonnegative().max(MAX_DWELL_MS),
  completed: z.boolean(),
  /** The single most important metric we have, because it is what we owe our
   *  publishers. Reported to each of them monthly (Ch. 14.5). */
  openedArticle: z.boolean(),
  shared: z.boolean(),
  occurredAt: z.date(),
});
export type ReadEvent = z.infer<typeof ReadEvent>;

/** Clamp rather than reject — a bad clock should not lose the whole batch. */
export function clampDwell(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(MAX_DWELL_MS, Math.trunc(ms));
}

/**
 * Read threshold.  Spec Ch. 14.4.
 *
 * A fixed threshold would treat a 45-word summary and a 75-word one identically.
 * 200 wpm is conservative for a second language on a small screen; the 0.6
 * factor allows that a reader who grasps a story does not read every word.
 * These constants are estimates and should be revisited against real dwell data.
 */
export function readThresholdMs(summaryWordCount: number): number {
  const raw = (summaryWordCount / 200) * 60_000 * 0.6;
  return Math.max(2500, Math.min(12_000, Math.round(raw)));
}
