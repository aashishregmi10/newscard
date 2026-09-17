import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where media files live, and the URL prefix they are served under.
 *
 * ── Why this is one definition ──────────────────────────────────────────────
 *
 * Three places need to agree: the read API, which serves `/media` as static
 * files; the CMS, which writes uploads into it; and the seed scripts, which
 * generate the demonstration corpus. They agreed by coincidence — each computed
 * `../../../media` from its own file — and the first deployment that put the
 * API and the CMS on different paths would have separated them silently, with
 * the symptom being uploaded images that 404 only in production.
 *
 * It lives in @saar/shared rather than @saar/media because resolving a path is
 * not a media-processing concern, and the read API must not pull sharp and an
 * ffmpeg binary in to find out where a directory is.
 */

/**
 * The directory holding media.
 *
 * `MEDIA_ROOT` overrides it, which is what a real deployment sets: media
 * belongs on a mounted volume or an object store, not inside a checkout that
 * a deploy replaces.
 */
export function mediaRoot(): string {
  const fromEnv = process.env.MEDIA_ROOT;
  if (fromEnv) return resolve(fromEnv);
  // From packages/shared/dist (or src) up to the repository root.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'media');
}

/**
 * The public prefix media is served under.
 *
 * Relative by default, and that is deliberate: a relative URL survives the
 * development machine's IP changing, which a hardcoded LAN address does not.
 * Production sets the absolute CDN origin.
 */
export function mediaBaseUrl(): string {
  return process.env.CDN_BASE_URL ?? '/media';
}

/** Images live under `i/<key>/`, videos under `v/<key>/`. */
export const IMAGE_PREFIX = 'i';
export const VIDEO_PREFIX = 'v';
