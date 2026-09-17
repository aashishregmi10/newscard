import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaRoot, mediaBaseUrl, IMAGE_PREFIX, VIDEO_PREFIX } from '@saar/shared';
import type { ProcessedImage } from './images.js';
import type { TranscodedVideo } from './video.js';

/**
 * Putting processed media where the API will serve it from.
 *
 * ── Why keys are random rather than derived from the filename ───────────────
 *
 * The seed derives its keys from the story slug, which is right for a corpus
 * that must regenerate identically. An upload must not: two editors uploading
 * `photo.jpg` would collide, and a key derived from the file's CONTENT would
 * mean re-uploading the same picture silently overwrites the first story's
 * image while it is live.
 *
 * ── Why the files are immutable ─────────────────────────────────────────────
 *
 * A key is written once and never rewritten. The API serves `/media` with a
 * one-year immutable cache, which is only safe because of that — replacing a
 * file under a key that is already cached on a reader's phone produces an image
 * that is wrong for a year and cannot be invalidated. Replacing an image means
 * a new key.
 */

export interface StoredImage {
  key: string;
  blurHash: string;
  width: number;
  height: number;
  urls: { sm: string; md: string; lg: string };
}

export interface StoredVideo {
  key: string;
  durationSeconds: number;
  posterUrl: string;
  posterBlurHash: string;
  renditions: Array<{
    quality: 'low' | 'medium' | 'high';
    url: string;
    width: number;
    height: number;
    bytes: number;
  }>;
}

/** Twelve hex characters, matching the shape the seed corpus already uses. */
export function newMediaKey(): string {
  return randomBytes(6).toString('hex');
}

export function videoWorkDir(key: string): string {
  return join(mediaRoot(), VIDEO_PREFIX, key);
}

export async function storeImage(processed: ProcessedImage): Promise<StoredImage> {
  const key = newMediaKey();
  const dir = join(mediaRoot(), IMAGE_PREFIX, key);
  await mkdir(dir, { recursive: true });

  const base = mediaBaseUrl();
  const urls: Record<string, string> = {};

  for (const r of processed.renditions) {
    await writeFile(join(dir, r.filename), r.data);
    urls[r.name] = `${base}/${IMAGE_PREFIX}/${key}/${r.filename}`;
  }

  return {
    key,
    blurHash: processed.blurHash,
    width: processed.width,
    height: processed.height,
    urls: { sm: urls.sm!, md: urls.md!, lg: urls.lg! },
  };
}

/**
 * Turn a transcode into the URLs the video document stores.
 *
 * The files are already on disk — ffmpeg wrote them there, because it works on
 * paths rather than buffers — so this only maps filenames to public URLs.
 */
export function describeStoredVideo(key: string, t: TranscodedVideo): StoredVideo {
  const base = mediaBaseUrl();
  return {
    key,
    durationSeconds: t.durationSeconds,
    posterUrl: `${base}/${VIDEO_PREFIX}/${key}/${t.posterFilename}`,
    posterBlurHash: t.posterBlurHash,
    renditions: t.renditions.map((r) => ({
      quality: r.quality,
      url: `${base}/${VIDEO_PREFIX}/${key}/${r.filename}`,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
    })),
  };
}
