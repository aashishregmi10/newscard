import { z } from 'zod';
import { INTERACTION_LIMITS } from '@saar/shared';
import { LanguageEnum } from './enums.js';

/**
 * Interactions — a question whose few options readers rate with stars, or a
 * vote between a few candidates — and the readers' answers to them.
 *
 * ── Collections ─────────────────────────────────────────────────────────────
 *
 *   interactions    what editors make. Its options or candidates are its
 *                   `options`; once it is live they are locked, so a result
 *                   always means what it says.
 *   votes           one per reader per vote. Final.
 *   ratings         one per reader per option, all sent together. Final.
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

/** An option's or candidate's photo: square renditions, and whose it is. */
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

/* ── what the app receives ─────────────────────────────────────────────────── */

export const InteractionOptionDto = z.object({
  id: z.string(),
  name: z.string(),
  detail: z.string().nullable(),
  image: z
    .object({
      credit: z.string(),
      blurHash: z.string().nullable(),
      urls: z.object({
        sm: z.string().nullable(),
        md: z.string().nullable(),
        lg: z.string().nullable(),
      }),
    })
    .nullable(),
});
export type InteractionOptionDto = z.infer<typeof InteractionOptionDto>;

/**
 * An Interaction as a card in the feed. Discriminated from stories and ads on
 * `kind`, and sent only to an app that asks for it (`interactions=1`): an older
 * app would try to draw it as a story.
 *
 * Nothing about the reader is in here — the feed is cached and shared — so the
 * card asks for its own state (InteractionStateDto) once it is on screen.
 */
export const InteractionCardDto = z.object({
  kind: z.literal('interaction'),
  id: z.string(),
  type: InteractionTypeEnum,
  language: LanguageEnum,
  title: z.string(),
  options: z.array(InteractionOptionDto),
  /** ISO. Null: a rating with no closing date. */
  closesAt: z.string().nullable(),
});
export type InteractionCardDto = z.infer<typeof InteractionCardDto>;

/**
 * Results, one shape for both kinds, in the order of the options. A vote fills
 * `votes` and `percent` (whole numbers adding up to 100); a rating fills
 * `ratings` and `average` (one decimal, null before the first).
 */
export const InteractionResultsDto = z.object({
  type: InteractionTypeEnum,
  /** Votes in all, or star ratings in all. */
  total: z.number(),
  /** The readers who answered: voters, or readers who rated. */
  respondents: z.number(),
  /** A rating's every star averaged — its overall score. Null on a vote, and before the first. */
  average: z.number().nullable(),
  options: z.array(
    z.object({
      id: z.string(),
      votes: z.number(),
      percent: z.number(),
      ratings: z.number(),
      average: z.number().nullable(),
    }),
  ),
});
export type InteractionResultsDto = z.infer<typeof InteractionResultsDto>;

/** Where one reader stands with one Interaction, and what they may see of it. */
export const InteractionStateDto = z.object({
  id: z.string(),
  /** No more answers: closed by an editor, or past its closing date. */
  closed: z.boolean(),
  /** The candidate this reader voted for. */
  myVote: z.string().nullable(),
  /** The options this reader has rated, and how. */
  myRatings: z.array(z.object({ optionId: z.string(), stars: z.number() })),
  /**
   * Shown only once this reader has answered, or it has closed — for a vote
   * and a rating alike — so early answers do not steer later ones.
   */
  results: InteractionResultsDto.nullable(),
});
export type InteractionStateDto = z.infer<typeof InteractionStateDto>;

/** A signed-in reader's session, as POST /v1/readers/session returns it. */
export const ReaderSessionDto = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type ReaderSessionDto = z.infer<typeof ReaderSessionDto>;
