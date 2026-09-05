import { z } from 'zod';

/**
 * Every enumerated value in the system.  Spec Ch. 3.1.
 *
 * Stored as lowercase strings, never integers. An integer enum saves nothing and
 * makes a database dump unreadable at 3am.
 */

export const LanguageEnum = z.enum(['ne', 'en']);
export type Language = z.infer<typeof LanguageEnum>;

/** Spec Ch. 3.3 — the article lifecycle. */
export const ArticleStatusEnum = z.enum([
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'spiked',
  'retracted',
]);
export type ArticleStatus = z.infer<typeof ArticleStatusEnum>;

/** Spec Ch. 3.5 — only `agreed` may be ingested. This is the legal gate. */
export const LicenceStatusEnum = z.enum(['agreed', 'pending', 'refused', 'unknown']);
export type LicenceStatus = z.infer<typeof LicenceStatusEnum>;

/** Spec Ch. 3.2.4 — anything outside this list must not be published. */
export const ImageLicenceEnum = z.enum(['publisher_licensed', 'agency', 'cc_by', 'own']);
export type ImageLicence = z.infer<typeof ImageLicenceEnum>;

/** Spec Ch. 3.2.6 — always `human` in MVP. Recorded from day one so v1 can
 *  measure correction rates for assisted drafts against a real baseline. */
export const DraftSourceEnum = z.enum(['human', 'llm_assisted']);
export type DraftSource = z.infer<typeof DraftSourceEnum>;

export const IngestMethodEnum = z.enum(['rss', 'api', 'manual']);
export type IngestMethod = z.infer<typeof IngestMethodEnum>;

export const StaffRoleEnum = z.enum(['author', 'reviewer', 'admin']);
export type StaffRole = z.infer<typeof StaffRoleEnum>;

export const NotificationTypeEnum = z.enum([
  'breaking',
  'digest',
  'category',
  'correction',
  'article_retracted',
]);
export type NotificationType = z.infer<typeof NotificationTypeEnum>;

export const PlatformEnum = z.enum(['android', 'ios']);
export type Platform = z.infer<typeof PlatformEnum>;

/** Set by Gate 2 (spec Ch. 1.7). Stored in `config`, never hard-coded. */
export const LimitTypeEnum = z.enum(['words', 'graphemes']);
export type LimitType = z.infer<typeof LimitTypeEnum>;

/** Plan §2b — why a clustered duplicate was spiked. */
export const SpikeReasonEnum = z.enum(['editorial', 'clustered', 'duplicate', 'stale']);
export type SpikeReason = z.infer<typeof SpikeReasonEnum>;
