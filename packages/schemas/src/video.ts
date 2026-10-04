import { z } from 'zod';
import { LanguageEnum } from './enums.js';
import { LocalisedText, ObjectIdString } from './common.js';

/**
 * Short video.
 *
 * ── Why this is its own collection rather than a field on `articles` ────────
 *
 * A short is a different editorial object, not an article that happens to have
 * a file attached. It has a duration, a poster frame, a mute state, a
 * watch-through curve and a caption track; an article has a summary measured in
 * words and a publisher link. Putting video on `articles` would mean every feed
 * query carries eight fields it never reads, and the word-count rules that
 * govern a summary would have to be made conditional on a field being null.
 *
 * The cost of the separation is that interleaving shorts INTO the reading feed
 * needs two cursors rather than one. That is a solved problem here — the
 * advertising system already interleaves a second entity type into a paged feed
 * without disturbing its ordering, and the same approach applies.
 *
 * ── The constraint that shapes everything below ─────────────────────────────
 *
 * Data is metered and expensive for most of this audience. So a short is capped
 * at 90 seconds, stored at three bitrates, and NEVER autoplays on a mobile
 * connection. `posterUrl` is not optional: the tab has to be browsable, and the
 * reader has to be able to choose what to spend their data on, before a single
 * byte of video is fetched.
 */

/** Ninety seconds. Past that it is not a short, and the data cost stops being
 *  something a reader can absorb without noticing. */
export const MAX_VIDEO_DURATION_S = 90;

export const VideoRendition = z.object({
  /** 360p / 540p / 720p — the player picks what the connection can carry. */
  quality: z.enum(['low', 'medium', 'high']),
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
});
export type VideoRendition = z.infer<typeof VideoRendition>;

export const VideoStatusEnum = z.enum(['draft', 'published', 'retracted']);

/**
 * Where a short's video lives.
 *
 *   upload   a file an editor uploaded, transcoded into our three renditions
 *            and served by us — with its size known, so the app can say what
 *            tapping play will cost
 *   youtube  a Short on a licensed publisher's YouTube channel, played in the
 *            app with YouTube's own player. Never downloaded: YouTube's terms
 *            forbid that without YouTube's written permission, whatever the
 *            channel agrees. It has no renditions; `youtubeId` is the video.
 */
export const VideoOriginEnum = z.enum(['upload', 'youtube']);
export type VideoOrigin = z.infer<typeof VideoOriginEnum>;

/** A YouTube video id: eleven characters of A–Z, a–z, 0–9, - and _. */
export const YouTubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export type VideoStatus = z.infer<typeof VideoStatusEnum>;

export const Video = z.object({
  slug: z.string().min(4).max(120),
  status: VideoStatusEnum,
  language: LanguageEnum,

  categoryId: ObjectIdString,
  sourceId: ObjectIdString,

  publishedAt: z.date().nullable(),

  /** Set together when a short is withdrawn. The reason is required by the
   *  route, and is what anyone asking "why did that clip disappear" reads. */
  retractedAt: z.date().nullable().optional(),
  retractionReason: z.string().min(1).nullable().optional(),

  /**
   * The last change to a LIVE short: when, by whom, and why. The same record
   * a published article keeps, for the same reason — `updatedAt` moves on
   * every save of a draft, so it cannot answer "when did what readers see
   * last change". Edits to a draft do not set these. The full before and
   * after of every edit is in `audit`.
   */
  lastEditedAt: z.date().nullable().optional(),
  lastEditedBy: ObjectIdString.nullable().optional(),
  lastEditReason: z.string().min(1).nullable().optional(),

  /** Shown over the poster. Shorter than an article headline: it competes with
   *  the picture for attention rather than sitting above it. */
  title: z.string().max(80),
  /** One or two sentences of context. A short without words is a clip; with
   *  them it is journalism. */
  caption: z.string().max(400),

  durationSeconds: z.number().positive().max(MAX_VIDEO_DURATION_S),

  /**
   * The still shown before playback, and the only thing fetched when the tab
   * opens. Never null — a video tab that must download video to render itself
   * is unusable on the connections this app targets.
   */
  posterUrl: z.string().min(1),
  posterBlurHash: z.string().min(6).nullable().optional(),

  /** Absent on shorts saved before YouTube existed here, which were uploads. */
  origin: VideoOriginEnum.default('upload'),
  /** The YouTube video, when `origin` is `youtube`. */
  youtubeId: YouTubeVideoId.nullable().optional(),

  /** At least one for an upload; none for a YouTube short, which YouTube serves. */
  renditions: z.array(VideoRendition),

  /** Same licensing discipline as a photograph. Publication is blocked without
   *  a recognised licence and a credit. */
  credit: z.string().min(1),
  licence: z.enum(['publisher_licensed', 'agency', 'cc_by', 'own']),
  sourceUrl: z.string().nullable().optional(),

  /** Denormalised so a video card needs no join, exactly as an article card. */
  sourceName: z.string().min(1),
  categorySlug: z.string().min(1),
  categoryLabel: LocalisedText,

  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Video = z.infer<typeof Video>;

/**
 * What the app receives. A `.pick()`-shaped whitelist for the same reason the
 * article DTO is one: a field added to the model tomorrow cannot leak to
 * readers today.
 */
export const VideoCardDto = z.object({
  kind: z.literal('video'),
  id: z.string(),
  slug: z.string(),
  language: LanguageEnum,
  title: z.string(),
  caption: z.string(),
  durationSeconds: z.number(),
  posterUrl: z.string(),
  posterBlurHash: z.string().nullable(),
  /** Empty for a YouTube short. */
  renditions: z.array(VideoRendition),
  /**
   * The YouTube video to play with YouTube's player, or null for an uploaded
   * short. Only sent to an app that says it can play one (`youtube=1`): an
   * older app would find no renditions and nothing to play.
   */
  youtubeId: z.string().nullable(),
  credit: z.string(),
  source: z.object({ name: z.string() }),
  category: z.object({ slug: z.string(), label: LocalisedText }),
  publishedAt: z.string(),
});
export type VideoCardDto = z.infer<typeof VideoCardDto>;

/**
 * Which rendition to play.
 *
 * Deliberately conservative: on an unknown connection the low rendition is
 * chosen, because guessing high and stalling is a worse experience than
 * guessing low and looking slightly soft. The reader can always ask for better.
 */
export function pickRendition(
  renditions: readonly VideoRendition[],
  opts: { unmetered: boolean; dataSaver: boolean },
): VideoRendition | undefined {
  if (renditions.length === 0) return undefined;
  const by = (q: VideoRendition['quality']) => renditions.find((r) => r.quality === q);

  if (opts.dataSaver) return by('low') ?? renditions[0];
  if (opts.unmetered) return by('high') ?? by('medium') ?? renditions[0];
  return by('medium') ?? by('low') ?? renditions[0];
}
