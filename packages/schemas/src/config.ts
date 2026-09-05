import { z } from 'zod';
import { LimitTypeEnum } from './enums.js';

/**
 * The `config` single-document collection.  Spec Ch. 3.13.
 *
 * Runtime configuration that must be changeable without a release. Read at API
 * start-up and refreshed every 60 seconds.
 */

export const SummaryLimit = z.object({
  min: z.number().int().positive(),
  max: z.number().int().positive(),
});

/**
 * Gate 2 output (spec Ch. 1.7). The ONLY place the summary length lives.
 *
 * A minimum is specified as well as a maximum: a twelve-word summary is not a
 * short, it is a headline with extra steps, and it reads as low effort.
 */
export const SummaryLimits = z.object({
  limitType: LimitTypeEnum,
  limits: z.object({ ne: SummaryLimit, en: SummaryLimit }),
  headlineMaxChars: z.number().int().positive(),
  pullQuoteMaxChars: z.number().int().positive(),
});
export type SummaryLimits = z.infer<typeof SummaryLimits>;

export const AppConfig = z.object({
  summaryLimits: SummaryLimits,
  feedPageSize: z.number().int().positive().default(20),
  prefetchCount: z.number().int().positive().default(20),
  prefetchCountSaver: z.number().int().positive().default(5),
  notifDailyCapMax: z.number().int().min(0).max(3).default(3),
  notifMinGapMin: z.number().int().nonnegative().default(90),
  minSupportedVersion: z.string().default('1.0.0'),
  killSwitch: z.object({ video: z.boolean().default(true) }),
});
export type AppConfig = z.infer<typeof AppConfig>;

/**
 * Pre-Gate-2 default. 60 words in both languages is the INHERITED number, not a
 * validated one — Ch. 1.7 Gate 2 must confirm it works in Devanagari before the
 * product is branded around it.
 */
export const DEFAULT_CONFIG: AppConfig = {
  summaryLimits: {
    limitType: 'words',
    limits: { ne: { min: 45, max: 60 }, en: { min: 45, max: 60 } },
    headlineMaxChars: 90,
    pullQuoteMaxChars: 70,
  },
  feedPageSize: 20,
  prefetchCount: 20,
  prefetchCountSaver: 5,
  notifDailyCapMax: 3,
  notifMinGapMin: 90,
  minSupportedVersion: '1.0.0',
  killSwitch: { video: true },
};
