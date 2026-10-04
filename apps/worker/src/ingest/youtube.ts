import { collections, getDb } from '@saar/db';
import { MAX_VIDEO_DURATION_S, SHORT_LEAD_TTL_DAYS } from '@saar/schemas';
import { createLogger } from '@saar/shared';
import { bodyText, FeedFetchError, politeGet } from './politeGet.js';
import { detectLanguage } from './toLead.js';

/**
 * Collecting Shorts from a licensed publisher's YouTube channel.
 *
 * ── Through the official API ────────────────────────────────────────────────
 *
 * The YouTube Data API v3, with a key from Google Cloud (free; 10,000 quota
 * units a day). A poll costs two units — the channel's latest fifty uploads,
 * then the details of the new ones — so a channel read every fifteen minutes
 * uses about two hundred a day. The public RSS feed was tried first and is not
 * enough: it carries only the fifteen latest uploads, and on a channel that
 * also posts long videos a Short can fall off it between polls.
 *
 * ── What counts as a Short ──────────────────────────────────────────────────
 *
 * The API does not say. Three checks do, all of which must pass:
 *
 *   1. ninety seconds or less — the same cap as an uploaded short, and the
 *      editor's choice when this was planned;
 *   2. its owner allows it to be embedded, or the app could not play it;
 *   3. it is taller than it is wide, from YouTube's documented oEmbed
 *      endpoint — which costs no quota.
 *
 * ── What is never done ──────────────────────────────────────────────────────
 *
 * The video is never downloaded. YouTube's terms forbid it without YouTube's
 * written permission, whatever the channel agrees; the app plays it with
 * YouTube's own player instead. The key is never logged.
 */

const log = createLogger({ level: 'info', service: 'ingest-youtube' });

const API = 'https://www.googleapis.com/youtube/v3';

/** A channel's first poll would otherwise import a month of Shorts as new. */
export const MAX_SHORT_AGE_DAYS = 7;

const JSON_LIMIT = 2 * 1024 * 1024;

export interface ChannelInfo {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
}

export interface YouTubeVideo {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  durationSeconds: number;
  embeddable: boolean;
  thumbnailUrl: string | null;
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

interface FetchOptions {
  fetchImpl?: typeof fetch;
}

/* The parts of YouTube's replies that are read. Everything optional: it is
   their JSON, and a missing field must not throw. */
interface ApiChannel {
  id?: unknown;
  snippet?: { title?: unknown; thumbnails?: { default?: { url?: string } } };
}
interface ApiPlaylistItem {
  contentDetails?: { videoId?: unknown };
}
interface ApiVideo {
  id?: unknown;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
}

function items<T>(json: Record<string, unknown>): T[] {
  return Array.isArray(json.items) ? (json.items as T[]) : [];
}

async function apiGet(path: string, params: Record<string, string>, key: string, o: FetchOptions) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);
  try {
    const res = await politeGet(url.toString(), {
      accept: 'application/json',
      maxBytes: JSON_LIMIT,
      ...(o.fetchImpl && { fetchImpl: o.fetchImpl }),
    });
    return JSON.parse(bodyText(res)) as Record<string, unknown>;
  } catch (e) {
    /* Without the URL: it carries the key. */
    if (e instanceof FeedFetchError) {
      throw new YouTubeApiError(
        e.status === 403
          ? 'YouTube refused the request — check that YOUTUBE_API_KEY is valid, has the YouTube Data API v3 enabled, and has quota left today.'
          : e.status === 400
            ? 'YouTube rejected the request — the API key may be malformed.'
            : `YouTube could not be reached (${e.reason}).`,
        e.status,
      );
    }
    throw new YouTubeApiError('YouTube returned something that was not JSON.');
  }
}

/** ISO 8601 durations as the API writes them: PT1M5S, PT45S, PT1H2M. */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso.trim());
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/** The uploads playlist is the channel id with UC changed to UU. */
export function uploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}

/**
 * Which channel an editor means.
 *
 * Accepts what they are likely to paste: `@handle`, a channel URL in any of
 * its forms, or the `UC…` id itself. Stored as the id, never the handle, which
 * the owner can change.
 */
export function channelQuery(input: string): { id: string } | { handle: string } | null {
  const raw = input.trim();
  if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return { id: raw };
  if (/^@[A-Za-z0-9._-]{3,30}$/.test(raw)) return { handle: raw };
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('@')) return { handle: parts[0] };
    if (parts[0] === 'channel' && parts[1] && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1])) {
      return { id: parts[1] };
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolveChannel(input: string, key: string, o: FetchOptions = {}): Promise<ChannelInfo> {
  const q = channelQuery(input);
  if (q === null) {
    throw new YouTubeApiError('Paste the channel as @handle, its youtube.com address, or its UC… id.');
  }
  const json = await apiGet(
    'channels',
    { part: 'snippet', ...('id' in q ? { id: q.id } : { forHandle: q.handle }) },
    key,
    o,
  );
  const item = items<ApiChannel>(json)[0];
  if (!item?.id) throw new YouTubeApiError('No YouTube channel by that name.');
  return {
    channelId: String(item.id),
    title: String(item.snippet?.title ?? ''),
    thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
  };
}

/** The channel's latest uploads, newest first: ids only. One quota unit. */
export async function latestUploads(channelId: string, key: string, o: FetchOptions = {}): Promise<string[]> {
  const json = await apiGet(
    'playlistItems',
    { part: 'contentDetails', maxResults: '50', playlistId: uploadsPlaylistId(channelId) },
    key,
    o,
  );
  return items<ApiPlaylistItem>(json)
    .map((i) => i.contentDetails?.videoId)
    .filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v));
}

function bestThumbnail(t: Record<string, { url?: string }> | undefined): string | null {
  if (!t) return null;
  return t.maxres?.url ?? t.standard?.url ?? t.high?.url ?? t.medium?.url ?? t.default?.url ?? null;
}

/** Details for up to fifty videos. One quota unit. */
export async function videoDetails(ids: string[], key: string, o: FetchOptions = {}): Promise<YouTubeVideo[]> {
  if (ids.length === 0) return [];
  const json = await apiGet(
    'videos',
    { part: 'snippet,contentDetails,status', id: ids.slice(0, 50).join(','), maxResults: '50' },
    key,
    o,
  );
  return items<ApiVideo>(json).map((v) => {
    const published = v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null;
    return {
      videoId: String(v.id),
      channelId: String(v.snippet?.channelId ?? ''),
      channelTitle: String(v.snippet?.channelTitle ?? ''),
      title: String(v.snippet?.title ?? '').trim(),
      description: String(v.snippet?.description ?? '').slice(0, 5000),
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      durationSeconds: parseIsoDuration(String(v.contentDetails?.duration ?? '')),
      embeddable: v.status?.embeddable === true && v.status?.privacyStatus === 'public',
      thumbnailUrl: bestThumbnail(v.snippet?.thumbnails),
    };
  });
}

/**
 * Whether a video is taller than it is wide, from YouTube's oEmbed endpoint.
 *
 * Null when YouTube will not say — usually because embedding is off, which
 * means the app could not play it either.
 */
export async function isVertical(videoId: string, o: FetchOptions = {}): Promise<boolean | null> {
  const target = encodeURIComponent(`https://www.youtube.com/shorts/${videoId}`);
  try {
    const res = await politeGet(`https://www.youtube.com/oembed?url=${target}&format=json`, {
      accept: 'application/json',
      maxBytes: 64 * 1024,
      ...(o.fetchImpl && { fetchImpl: o.fetchImpl }),
    });
    const j = JSON.parse(bodyText(res)) as { width?: unknown; height?: unknown };
    if (typeof j.width !== 'number' || typeof j.height !== 'number') return null;
    return j.height > j.width;
  } catch {
    return null;
  }
}

/**
 * Videos already turned down, so the next poll does not look them up again.
 *
 * In memory, and bounded: a restart forgets them and they are checked once
 * more, which costs one request and is the safe direction to be wrong in.
 */
const turnedDown = new Set<string>();
const TURNED_DOWN_MAX = 5_000;

function rememberTurnedDown(videoId: string): void {
  if (turnedDown.size >= TURNED_DOWN_MAX) turnedDown.clear();
  turnedDown.add(videoId);
}

/**
 * A channel's boilerplate: the lines it puts under every upload.
 *
 * Channels paste the same block into every description — a request to
 * subscribe, contact addresses, links, a wall of hashtags. Nepal Times' is
 * twenty lines and is, on its Shorts, the entire description. Left in, it is
 * what an editor reads in Incoming instead of what the clip is about, and it
 * is what a caption would be drafted from.
 *
 * Learned rather than listed: a line found in at least half of a batch of a
 * channel's videos (three or more) is theirs, not the clip's. Kept on the
 * publisher's record so a later poll that sees one new video can still strip
 * it. The title is never touched — only the description.
 */
export const BOILERPLATE_MIN_BATCH = 3;
const BOILERPLATE_MAX_LINES = 120;

const normaliseLine = (line: string): string => line.replace(/\s+/g, ' ').trim();

export function learnBoilerplate(descriptions: string[], previous: readonly string[] = []): string[] {
  const known = new Set(previous);
  if (descriptions.length >= BOILERPLATE_MIN_BATCH) {
    const counts = new Map<string, number>();
    for (const d of descriptions) {
      for (const line of new Set(d.split('\n').map(normaliseLine).filter(Boolean))) {
        counts.set(line, (counts.get(line) ?? 0) + 1);
      }
    }
    const threshold = Math.max(2, Math.ceil(descriptions.length / 2));
    for (const [line, n] of counts) if (n >= threshold) known.add(line);
  }
  return [...known].slice(-BOILERPLATE_MAX_LINES);
}

/** The description without the channel's boilerplate, links or hashtag-only lines. */
export function stripBoilerplate(description: string, boilerplate: readonly string[]): string {
  const drop = new Set(boilerplate);
  return description
    .split('\n')
    .map(normaliseLine)
    .filter((line) => line !== '' && !drop.has(line))
    .filter((line) => !/^(https?:\/\/\S+\s*)+$/.test(line))
    .filter((line) => !/^([#＃][\p{L}\p{M}\p{N}_]+\s*)+$/u.test(line))
    .join('\n')
    .slice(0, 5000);
}

/** Why a video was not offered as a Short. Counted in the poll report. */
export type ShortRejection = 'too_long' | 'not_embeddable' | 'not_vertical' | 'too_old' | 'no_title';

/** Pure: the checks the API's own fields can answer. Exported for tests. */
export function screenVideo(v: YouTubeVideo, now: Date): ShortRejection | null {
  if (v.title === '') return 'no_title';
  if (v.durationSeconds <= 0 || v.durationSeconds > MAX_VIDEO_DURATION_S) return 'too_long';
  if (!v.embeddable) return 'not_embeddable';
  if (v.publishedAt && now.getTime() - v.publishedAt.getTime() > MAX_SHORT_AGE_DAYS * 86_400_000) {
    return 'too_old';
  }
  return null;
}

export interface YouTubePollReport {
  sourceSlug: string;
  fetched: number;
  inserted: number;
  known: number;
  rejected: Partial<Record<ShortRejection, number>>;
  error: string | null;
}

interface YouTubeSource {
  _id: { toString(): string };
  slug: string;
  displayName: string;
  language: 'ne' | 'en';
  ingest: {
    youtubeChannelId?: string | null;
    consecutiveFailures?: number;
    youtubeBoilerplate?: string[] | null;
  };
}

/**
 * Read one channel. Same failure handling as a feed: a failure is counted on
 * the publisher, and five in a row pause it (see pollSources).
 */
export async function pollYouTubeSource(
  source: YouTubeSource,
  key: string,
  now: Date,
  o: FetchOptions = {},
  autoPauseAfter = 5,
): Promise<YouTubePollReport> {
  const c = collections(getDb());
  const shortLeads = getDb().collection('shortLeads');
  const report: YouTubePollReport = {
    sourceSlug: source.slug,
    fetched: 0,
    inserted: 0,
    known: 0,
    rejected: {},
    error: null,
  };
  const channelId = source.ingest?.youtubeChannelId;
  if (!channelId) {
    report.error = 'No YouTube channel set.';
    return report;
  }

  await c.sources.updateOne(
    { _id: source._id as never },
    { $set: { 'ingest.lastPolledAt': now, updatedAt: now } },
  );

  try {
    const ids = await latestUploads(channelId, key, o);
    report.fetched = ids.length;

    /* Only ask about the ones not already offered — the expensive part. */
    const seen = new Set(
      (await shortLeads.find({ videoId: { $in: ids } }, { projection: { videoId: 1 } }).toArray()).map(
        (d) => String(d.videoId),
      ),
    );
    report.known = seen.size;
    const fresh = ids.filter((id) => !seen.has(id) && !turnedDown.has(id));

    const details = await videoDetails(fresh, key, o);

    /* Learned from everything fetched, long videos included: that is where
       most of a channel's examples are. */
    const previous = source.ingest?.youtubeBoilerplate ?? [];
    const boilerplate = learnBoilerplate(
      details.map((d) => d.description),
      previous,
    );
    if (boilerplate.length !== previous.length) {
      await c.sources.updateOne(
        { _id: source._id as never },
        { $set: { 'ingest.youtubeBoilerplate': boilerplate } },
      );
      /* Shorts already waiting were stored before this was known. */
      const waiting = await shortLeads
        .find({ sourceId: source._id, status: 'new' }, { projection: { description: 1 } })
        .limit(200)
        .toArray();
      for (const w of waiting) {
        const cleaned = stripBoilerplate(String(w.description ?? ''), boilerplate);
        if (cleaned !== w.description) {
          await shortLeads.updateOne({ _id: w._id }, { $set: { description: cleaned, updatedAt: now } });
        }
      }
    }

    for (const v of details) {
      const rejection = screenVideo(v, now) ?? ((await isVertical(v.videoId, o)) === true ? null : 'not_vertical');
      if (rejection !== null) {
        report.rejected[rejection] = (report.rejected[rejection] ?? 0) + 1;
        rememberTurnedDown(v.videoId);
        continue;
      }
      try {
        await shortLeads.insertOne({
          sourceId: source._id,
          sourceSlug: source.slug,
          sourceName: source.displayName,
          videoId: v.videoId,
          channelId: v.channelId || channelId,
          channelTitle: v.channelTitle,
          title: v.title.slice(0, 300),
          description: stripBoilerplate(v.description, boilerplate),
          thumbnailUrl: v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          durationSeconds: v.durationSeconds,
          language: detectLanguage(v.title, source.language),
          publishedAt: v.publishedAt,
          fetchedAt: now,
          status: 'new',
          promotedVideoId: null,
          dismissedReason: null,
          purgeAt: new Date(now.getTime() + SHORT_LEAD_TTL_DAYS * 86_400_000),
          createdAt: now,
          updatedAt: now,
        });
        report.inserted += 1;
      } catch (e) {
        /* Two overlapping polls: the unique index decides, and that is fine. */
        if ((e as { code?: number }).code !== 11000) throw e;
      }
    }

    await c.sources.updateOne(
      { _id: source._id as never },
      { $set: { 'ingest.lastSuccessAt': now, 'ingest.consecutiveFailures': 0, updatedAt: now } },
    );
    log.info('channel polled', {
      source: source.slug,
      fetched: report.fetched,
      inserted: report.inserted,
      known: report.known,
      rejected: report.rejected,
    });
  } catch (e) {
    const failures = (source.ingest?.consecutiveFailures ?? 0) + 1;
    report.error = e instanceof Error ? e.message : String(e);
    await c.sources.updateOne(
      { _id: source._id as never },
      { $set: { 'ingest.consecutiveFailures': failures, updatedAt: now } },
    );
    log[failures >= autoPauseAfter ? 'error' : 'warn']('channel poll failed', {
      source: source.slug,
      failures,
      reason: report.error,
    });
  }
  return report;
}
