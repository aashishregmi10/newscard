import { z } from 'zod';
import {
  ArticleStatusEnum,
  DraftSourceEnum,
  ImageLicenceEnum,
  LanguageEnum,
  SpikeReasonEnum,
} from './enums.js';
import { HttpsUrl, LocalisedText, ObjectIdString, Slug } from './common.js';

/**
 * The `articles` collection.  Spec Ch. 3.2.
 *
 * Defined ONCE here. The TypeScript type, the API DTO, and the MongoDB
 * $jsonSchema validator are all derived from this object, so they cannot drift
 * from each other — which is the whole reason the shape lives in a package
 * rather than being repeated in the API and the worker.
 */

export const ArticleImage = z.object({
  sourceUrl: z.string().url().nullable().optional(),
  /** Required whenever `image` is non-null — enforced by the object, not by a
   *  comment, because an uncredited photograph is our highest legal risk. */
  credit: z.string().min(1),
  licence: ImageLicenceEnum,
  blurHash: z.string().min(6).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  urls: z.object({
    sm: z.string().url().nullable().optional(),
    md: z.string().url().nullable().optional(),
    lg: z.string().url().nullable().optional(),
  }),
});
export type ArticleImage = z.infer<typeof ArticleImage>;

export const Article = z.object({
  // --- identity and state (Ch. 3.2.1) ---
  slug: Slug,
  status: ArticleStatusEnum,
  language: LanguageEnum,
  categoryId: ObjectIdString,
  sourceId: ObjectIdString,
  publishedAt: z.date().nullable(),
  scheduledFor: z.date().nullable().optional(),
  retractedAt: z.date().nullable().optional(),
  retractionReason: z.string().min(1).nullable().optional(),
  spikeReason: SpikeReasonEnum.nullable().optional(),

  // --- content (Ch. 3.2.2) ---
  headline: z.string().min(10).max(90),
  /** Plain text only. No markup, no HTML entities, no newlines. The 1200 cap is
   *  a runaway-write rail; the REAL editorial limit lives in `config.summaryLimits`
   *  because Gate 2 may change it (Ch. 3.2.3). */
  summary: z.string().min(40).max(1200),
  summaryWordCount: z.number().int().nonnegative(),
  /** Grapheme clusters, not code points. See @newscard/shared countGraphemes. */
  summaryCharCount: z.number().int().nonnegative(),
  pullQuote: z.string().max(70).nullable().optional(),
  publisherUrl: HttpsUrl,
  publisherAuthor: z.string().nullable().optional(),
  publisherPublishedAt: z.date().nullable().optional(),
  tags: z.array(z.string()).default([]),

  // --- cross-source aggregation (plan §2) ---
  /** Groups the same story arriving from several publishers. Null until clustered. */
  clusterId: ObjectIdString.nullable().optional(),
  /** Wire agency that originated the copy, where identifiable (e.g. RSS).
   *  Crediting only the republishing outlet is an attribution error. */
  originatingAgency: z.string().nullable().optional(),

  // --- images (Ch. 3.2.4) ---
  image: ArticleImage.nullable(),

  // --- denormalised for the feed (Ch. 3.2.5) ---
  sourceName: z.string().min(1),
  sourceLogoUrl: z.string().url().nullable().optional(),
  categorySlug: z.string().min(1),
  categoryLabel: LocalisedText,

  // --- editorial audit (Ch. 3.2.6) ---
  authoredBy: ObjectIdString,
  reviewedBy: ObjectIdString.nullable().optional(),
  /** True when the sole-editor exception was used (Ch. 5.7). Visible in the audit
   *  trail rather than invisible in the code. */
  selfApproved: z.boolean().default(false),
  draftSource: DraftSourceEnum,
  revisionCount: z.number().int().nonnegative().default(0),
  /** INTERNAL ONLY. Must never reach a public endpoint — see ArticleCardDto. */
  editorialNotes: z.string().nullable().optional(),

  // --- ingestion flags (Ch. 4.5, 4.6) ---
  possibleDuplicate: z.boolean().default(false),
  possibleLanguageMismatch: z.boolean().default(false),
});
export type Article = z.infer<typeof Article>;

/**
 * The public card DTO.  Spec Ch. 6.3.
 *
 * Built by explicitly PICKING fields. Never by serialising a document and
 * deleting unwanted keys — a blacklist leaks every new field on the day it is
 * added, and `editorialNotes` would be the first.
 */
export const ArticleCardDto = z.object({
  id: z.string(),
  slug: z.string(),
  language: LanguageEnum,
  headline: z.string(),
  summary: z.string(),
  pullQuote: z.string().nullable(),
  category: z.object({ slug: z.string(), label: LocalisedText }),
  source: z.object({ name: z.string(), logoUrl: z.string().nullable() }),
  author: z.string().nullable(),
  originatingAgency: z.string().nullable(),
  publisherUrl: z.string(),
  publishedAt: z.string(),
  sourcePublishedAt: z.string().nullable(),
  image: z
    .object({
      credit: z.string(),
      blurHash: z.string().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      urls: z.object({
        sm: z.string().nullable(),
        md: z.string().nullable(),
        lg: z.string().nullable(),
      }),
    })
    .nullable(),
});
export type ArticleCardDto = z.infer<typeof ArticleCardDto>;

/** The exact key set a card response may contain. Asserted by a snapshot test so
 *  an accidental addition fails CI rather than shipping. */
export const ARTICLE_CARD_KEYS = Object.keys(ArticleCardDto.shape).sort();

/**
 * The state machine.  Spec Ch. 3.3.1.
 *
 * Encoded as data so `transition.service.ts` has one lookup rather than a switch
 * that someone extends inconsistently. A client-supplied status is ignored; an
 * illegal move returns 409 INVALID_TRANSITION.
 */
export const ALLOWED_TRANSITIONS: Record<
  z.infer<typeof ArticleStatusEnum>,
  ReadonlyArray<z.infer<typeof ArticleStatusEnum>>
> = {
  draft: ['in_review', 'spiked'],
  in_review: ['approved', 'draft', 'spiked'],
  approved: ['scheduled', 'published', 'draft', 'spiked'],
  scheduled: ['published', 'approved', 'spiked'],
  published: ['retracted'],
  spiked: [],
  retracted: [],
};

export function canTransition(
  from: z.infer<typeof ArticleStatusEnum>,
  to: z.infer<typeof ArticleStatusEnum>,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Statuses that are visible to readers. Exactly one — used by every feed query. */
export const PUBLIC_STATUSES = ['published'] as const;
