import { z } from 'zod';
import { LanguageEnum, LeadStatusEnum } from './enums.js';
import { ObjectIdString } from './common.js';

/**
 * The `leads` collection — what the collector finds.
 *
 * ── WHAT A LEAD IS, AND IS NOT ──────────────────────────────────────────────
 *
 * A lead is a POINTER to somebody else's story: a headline, a canonical link, a
 * timestamp, and which of our sections it looks like. It is the answer to "this
 * story exists, and you have not written about it yet."
 *
 * It is NOT the story. Nothing in this collection is ever rendered to a reader,
 * and two fields in particular — `feedExtract` and `feedImageUrl` — carry the
 * publisher's own words and the publisher's own picture. They exist so an
 * editor can triage forty headlines without opening forty tabs, and for no
 * other reason.
 *
 *   - `feedExtract` is what the publisher chose to put in their public feed.
 *     It must never appear in a reader-facing DTO. Our summary is written from
 *     scratch, by a person, after reading the original.
 *   - `feedImageUrl` is a link to THEIR file on THEIR server. It is never
 *     downloaded, never copied into our media store, and never served. An image
 *     we host is an image we are licensing, and we license none of these.
 *
 * The rule the whole product rests on: we summarise in our own words, we
 * attribute, and we link back. A lead is the first half of that and must not
 * become a shortcut past the second.
 *
 * ── WHY THEY EXPIRE ─────────────────────────────────────────────────────────
 *
 * `purgeAt` drives a TTL index. A lead nobody acted on within a month is not an
 * asset, it is a copy of someone else's headline sitting in our database for no
 * reason. Holding less is both the lighter and the safer position.
 *
 * Unlike the three TTL indexes the engineering review flagged, this one is keyed
 * on a date the SERVER sets at write time — never a client clock.
 */

/** A month. Long enough that a quiet fortnight loses nothing; short enough that
 *  the collection never becomes an archive of other people's headlines. */
export const LEAD_TTL_DAYS = 30;

export const Lead = z.object({
  sourceId: ObjectIdString,
  /** Denormalised so the triage list needs no lookup per row. */
  sourceSlug: z.string().min(1),
  sourceName: z.string().min(1),

  /**
   * The publisher's own URL for the story, after redirect and tracking-parameter
   * stripping. This is the dedup key and, once promoted, becomes the article's
   * `publisherUrl` — which is the link every reader taps to reach them.
   */
  canonicalUrl: z.string().url(),

  headline: z.string().min(1).max(300),

  /** THEIR words, for triage only. Never rendered to a reader. See above. */
  feedExtract: z.string().max(2000).nullable(),
  /** THEIR image, by URL. Never downloaded, never served. See above. */
  feedImageUrl: z.string().url().nullable(),

  language: LanguageEnum,
  /** What the feed claimed. Null when it said nothing usable. */
  publishedAt: z.date().nullable(),
  fetchedAt: z.date(),

  /**
   * Stable hash of the normalised headline and URL.
   *
   * The unique index on `canonicalUrl` already stops the same link arriving
   * twice. This catches the other case: a publisher who re-issues the same story
   * under a new URL, which is common when a story is corrected.
   */
  fingerprint: z.string().min(16),

  status: LeadStatusEnum.default('new'),
  /** Set when an editor turns this into a draft, so it is never offered twice. */
  promotedArticleId: ObjectIdString.nullable().optional(),
  dismissedReason: z.string().max(200).nullable().optional(),

  /**
   * Groups leads that are the same story from different publishers, so an
   * editor summarises once. Computed by the clustering pass; null until then.
   */
  clusterKey: z.string().nullable().optional(),

  /** Server-set. Drives the TTL index. */
  purgeAt: z.date(),
});
export type Lead = z.infer<typeof Lead>;

/**
 * Strip the tracking parameters that make one story look like five.
 *
 * Publishers append utm_*, fbclid and friends per channel, so the same article
 * arrives with a different URL from the feed, from a share, and from a
 * newsletter. Without this the unique index on `canonicalUrl` is decorative and
 * an editor sees the same story three times.
 *
 * Deliberately a fixed list rather than "strip everything": plenty of real
 * article URLs carry a meaningful query (`?id=1234` on older Nepali CMSs), and
 * dropping that would produce a link that 404s for the reader who taps it.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
]);

export function canonicaliseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  /* A feed is not a place we follow arbitrary schemes from. javascript:, data:
     and file: have no business here, and a lead's URL is put in an href. */
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }

  /* A fragment identifies a position within a page, never a different story. */
  url.hash = '';
  /* Trailing slash: '/a/story' and '/a/story/' are one page on every CMS. */
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  url.hostname = url.hostname.toLowerCase();

  return url.toString();
}
