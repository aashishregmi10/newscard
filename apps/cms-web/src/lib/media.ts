/**
 * Resolving a media URL.
 *
 * -- Why the origin is not the CMS API ---------------------------------------
 *
 * The editorial backend is on 3001; media is served by the READ api on 3000. A
 * preview built against the CMS origin 404s, which looks exactly like a broken
 * upload and is not — the file is there, addressed to the wrong host. This was
 * worked out once and then copied into two components, where it could drift;
 * it lives here now and is imported.
 *
 * Stored URLs are relative ('/media/...') so that the same record works from a
 * handset, a laptop on the office network and a production domain. Anything
 * already absolute is passed through untouched, which is what makes this safe
 * to call on a value that might be either.
 */

const MEDIA_ORIGIN: string = import.meta.env.VITE_MEDIA_BASE ?? 'http://localhost:3000';

export function mediaUrl(path: string): string;
export function mediaUrl(path: string | null | undefined): string | null;
export function mediaUrl(path: string | null | undefined): string | null {
  if (path === null || path === undefined || path === '') return null;
  return /^https?:\/\//i.test(path) ? path : `${MEDIA_ORIGIN}${path}`;
}

/**
 * The first of several renditions that actually exists.
 *
 * An image record carries small, medium and large keys and any of them may be
 * null — a source that supplied only a thumbnail, a transcode that has not
 * finished. Picking `urls.md` and hoping is how a preview renders as a broken
 * image icon on the one story that matters.
 */
export function firstMediaUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const url = mediaUrl(candidate);
    if (url !== null) return url;
  }
  return null;
}
