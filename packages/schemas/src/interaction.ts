import { z } from 'zod';
import { INTERACTION_LIMITS } from '@saar/shared';
import { LanguageEnum } from './enums.js';

/**
 * Interactions — a star rating of a few businesses, or a vote between a few
 * candidates — and the readers' answers to them.
 *
 * ── Collections ─────────────────────────────────────────────────────────────
 *
 *   interactions    what editors make. Its businesses or candidates are its
 *                   `options`; once it is live they are locked, so a result
 *                   always means what it says.
 *   votes           one per reader per vote. Final.
 *   ratings         one per reader per business. Final.
 *   readers         a signed-in reader: an HMAC of Google's account number,
 *                   and nothing else — no name, no email.
 *   readerSessions  the app's sign-in, by the hash of its token.
 *
 * Results are counted from `votes` and `ratings` when asked, never kept as
 * running totals that could drift from the answers they summarise.
 *
 * The rules an editor's input must meet (counts, unique names, a photo for
 * every candidate, dates) are `interactionProblems` in @saar/shared, so the
 * editorial site can restate them; these are the shapes.
 */

export const InteractionTypeEnum = z.enum(['rating', 'vote']);
export type InteractionType = z.infer<typeof InteractionTypeEnum>;

export const InteractionStatusEnum = z.enum(['draft', 'live', 'closed']);
export type InteractionStatus = z.infer<typeof InteractionStatusEnum>;

const L = INTERACTION_LIMITS;

/** A business's or candidate's photo: square renditions, and whose it is. */
export const OptionImage = z.object({
  credit: z.string().trim().min(L.credit.min).max(L.credit.max),
  blurHash: z.string().max(100).nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  urls: z.object({
    sm: z.string().max(500).nullable(),
    md: z.string().max(500).nullable(),
    lg: z.string().max(500).nullable(),
  }),
});
export type OptionImage = z.infer<typeof OptionImage>;

/** Short and URL-safe: it travels in vote requests and in results. */
export const OptionId = z.string().regex(/^[a-z0-9]{6,16}$/, 'must be 6–16 lowercase letters and digits');

export const InteractionOption = z.object({
  id: OptionId,
  name: z.string().trim().min(1).max(L.name.max),
  detail: z.string().trim().max(L.detail.max).nullable(),
  image: OptionImage.nullable(),
});
export type InteractionOption = z.infer<typeof InteractionOption>;

/**
 * What the editorial site sends to create a draft or replace one. An option
 * without an id is new; the server gives it one.
 */
export const InteractionInput = z.object({
  type: InteractionTypeEnum,
  language: LanguageEnum,
  categorySlug: z.string().trim().min(1).max(40).nullable(),
  title: z.string().max(500),
  options: z
    .array(
      z.object({
        id: OptionId.optional(),
        name: z.string().max(500),
        detail: z.string().max(500).nullable(),
        image: OptionImage.nullable(),
      }),
    )
    .max(20),
  opensAt: z.string().datetime({ offset: true }).nullable(),
  closesAt: z.string().datetime({ offset: true }).nullable(),
});
export type InteractionInput = z.infer<typeof InteractionInput>;

export const Interaction = z.object({
  type: InteractionTypeEnum,
  status: InteractionStatusEnum,
  language: LanguageEnum,
  categorySlug: z.string().nullable(),
  title: z.string().min(1).max(L.title.max),
  options: z.array(InteractionOption),
  /** When readers may start answering. Null only on a draft: "when published". */
  opensAt: z.date().nullable(),
  /** When they must stop. Null: a rating that stays open until an editor closes it. */
  closesAt: z.date().nullable(),
  publishedAt: z.date().nullable(),
  closedAt: z.date().nullable(),
  createdBy: z.string(),
});
export type Interaction = z.infer<typeof Interaction>;

export const Stars = z.number().int().min(1).max(5);
