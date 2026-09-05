import { z } from 'zod';
import { LanguageEnum, NotificationTypeEnum } from './enums.js';
import { LocalisedText, ObjectIdString } from './common.js';

/** The `notifications` collection.  Spec Ch. 3.9. */
export const Notification = z.object({
  type: NotificationTypeEnum,
  /** Null for digests, which link to the feed rather than a card. */
  articleId: ObjectIdString.nullable(),
  /** Both languages required — we never send an English title to a Nepali-only
   *  device. The server pre-localises; the client never chooses. */
  title: LocalisedText,
  body: LocalisedText,
  deepLink: z.string().min(1),
  audience: z.object({
    languages: z.array(LanguageEnum).min(1),
    categories: z.array(z.string()).default([]),
  }),
  sentAt: z.date().nullable(),
  stats: z.object({
    attempted: z.number().int().nonnegative().default(0),
    delivered: z.number().int().nonnegative().default(0),
    /** Watch this: a high value means we are generating more than the cap
     *  allows, i.e. editorial should send less. Reviewed weekly (Ch. 10.10). */
    suppressed: z.number().int().nonnegative().default(0),
  }),
  createdBy: ObjectIdString.nullable(),
});
export type Notification = z.infer<typeof Notification>;

/**
 * Types exempt from the daily cap.  Spec Ch. 15.7 point 4.
 *
 * Correcting an error is not a marketing message. Without this exemption the
 * users most likely to have seen the error are the least likely to see the
 * correction — which is exactly backwards.
 */
export const CAP_EXEMPT_TYPES = ['correction', 'article_retracted'] as const;

export function isCapExempt(type: z.infer<typeof NotificationTypeEnum>): boolean {
  return (CAP_EXEMPT_TYPES as readonly string[]).includes(type);
}
