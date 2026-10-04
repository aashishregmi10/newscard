import { z } from 'zod';
import {
  IngestApiEnum,
  IngestBasisEnum,
  IngestMethodEnum,
  LanguageEnum,
  LicenceStatusEnum,
} from './enums.js';

/**
 * The `sources` collection.  Spec Ch. 3.5.
 *
 * `licence.status` is the technical expression of the legal position in Ch. 15.5.
 * Only `agreed` may be ingested, the check lives in exactly one place
 * (worker/ingest/selectSources.ts), and it is re-checked at publish because a
 * source can be downgraded in between.
 */

export const SourceLicence = z.object({
  status: LicenceStatusEnum,
  agreementRef: z.string().nullable().optional(),
  agreedAt: z.date().nullable().optional(),
  /** Who to contact about a takedown. Required once status is `agreed` — a
   *  licensed source with no takedown contact is a 24-hour SLA we cannot meet. */
  contactEmail: z.string().email().nullable().optional(),

  /*
   * What the agreement covers beyond the headline and the link. Both are
   * licence TERMS — set on the licence endpoint, audited as a change of legal
   * position — and both default to no, so a publisher recorded before they
   * existed keeps exactly the behaviour it had.
   */

  /**
   * We may show this publisher's photographs.
   *
   * On: the collector looks for the story's photo where their feed has none,
   * and promoting a lead copies it into our media store, credited to them,
   * as the draft's picture. Off: a photo their own feed carries is still
   * shown to editors as a thumbnail, but it is never copied or served.
   */
  images: z.boolean().default(false),

  /**
   * We may use the whole article to draft a summary.
   *
   * On: the collector keeps the full text, and promoting sends it to the
   * summariser — which, on the free tier, means to Google, who say free-tier
   * content may be used to improve their products. Off: only what their own
   * feed syndicates is kept, and nothing is sent anywhere.
   */
  fullText: z.boolean().default(false),
});

export const SourceIngest = z.object({
  method: IngestMethodEnum,
  /**
   * On what basis we read this feed. See IngestBasisEnum.
   *
   * Defaults to `agreement`, the stricter of the two, so a source written
   * before this field existed keeps exactly the behaviour it had.
   */
  basis: IngestBasisEnum.default('agreement'),
  feedUrl: z.string().url().nullable().optional(),
  /** Which content API, when `method` is `api`. */
  api: IngestApiEnum.nullable().optional(),
  /** That API's posts endpoint, e.g. `https://example.com/wp-json/wp/v2/posts`. */
  apiUrl: z.string().url().nullable().optional(),
  /** The channel, when `method` is `youtube`. Always the `UC…` id, never the
   *  `@handle`, which its owner can change. */
  youtubeChannelId: z
    .string()
    .regex(/^UC[A-Za-z0-9_-]{22}$/, 'A YouTube channel id starts with UC and is 24 characters.')
    .nullable()
    .optional(),
  /** Never below 5, clamped in code and not only in the admin UI (Ch. 4.4). */
  pollIntervalMin: z.number().int().min(5).default(15),
  lastPolledAt: z.date().nullable().optional(),
  lastSuccessAt: z.date().nullable().optional(),
  /** At 5 the source auto-pauses and editorial is alerted. */
  consecutiveFailures: z.number().int().nonnegative().default(0),
});

export const Source = z
  .object({
    slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
    /** Exactly as the publisher writes their own name — verify against their
     *  masthead, not their domain. */
    displayName: z.string().min(1),
    homepageUrl: z.string().url(),
    logoUrl: z.string().url().nullable().optional(),
    language: LanguageEnum,
    licence: SourceLicence,
    ingest: SourceIngest,
    /** Plan §2e — tiebreaker only, when choosing which cluster member to
     *  summarise from. Sparse integers so one can be inserted without renumbering. */
    priority: z.number().int().default(50),
    isActive: z.boolean().default(true),
    /**
     * Whether small ads may sit on this publisher’s stories. The small ad sells
     * space on a card that carries their name and their reporting, and not
     * every licence agreement permits that. Absent means allowed; set false for
     * a publisher whose agreement says otherwise.
     */
    inlineAds: z.boolean().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.ingest.method === 'rss' && !s.ingest.feedUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingest', 'feedUrl'],
        message: 'feedUrl is required when ingest.method is "rss"',
      });
    }
    if (s.ingest.method === 'api' && (!s.ingest.api || !s.ingest.apiUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingest', 'apiUrl'],
        message: 'api and apiUrl are required when ingest.method is "api"',
      });
    }
    if (s.ingest.method === 'youtube' && !s.ingest.youtubeChannelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingest', 'youtubeChannelId'],
        message: 'youtubeChannelId is required when ingest.method is "youtube"',
      });
    }
    if (s.licence.status === 'agreed' && !s.licence.contactEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['licence', 'contactEmail'],
        message: 'contactEmail is required once a licence is agreed (takedown route)',
      });
    }
  });
export type Source = z.infer<typeof Source>;

/**
 * The one predicate that decides whether we may ingest from a publisher.
 *
 * -- Why this is not the same question as "may we publish" -------------------
 *
 * It used to demand `licence.status === 'agreed'`, which made it identical to
 * the publish gate — and that is what made ingestion unbuildable while Gate 1
 * was open. Reading a feed a publisher chose to syndicate, to learn that a
 * story exists, is not the act of reproducing it. A lead is a headline, a link
 * and a timestamp; it is shown to an editor and never to a reader.
 *
 * So there are two gates now, and they are deliberately different strengths:
 *
 *   this               → may we FETCH a reference?   public feed is enough
 *   publish.service.ts → may we PUBLISH a summary?   agreement, always
 *
 * `basis` defaults to `agreement`, so a source that predates the field behaves
 * exactly as it did. Nothing about publication changed.
 */
export function isPollable(s: {
  isActive: boolean;
  licence: { status: string };
  ingest: { method: string; basis?: string };
}): boolean {
  if (!s.isActive) return false;
  if (s.ingest.method !== 'rss' && s.ingest.method !== 'api' && s.ingest.method !== 'youtube') {
    return false;
  }
  if ((s.ingest.basis ?? 'agreement') === 'public_feed') return true;
  return s.licence.status === 'agreed';
}
