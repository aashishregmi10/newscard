/**
 * Resolving a media URL.
 *
 * -- Why this is same-origin now ---------------------------------------------
 *
 * It used to point at http://localhost:3000, because media is served by the
 * READ api and a preview built against the CMS origin 404s — the file is there,
 * addressed to the wrong host, which looks exactly like a broken upload.
 *
 * The editorial origin proxies /media to the reader API now, so a bare path
 * resolves correctly from this site in development and in production, and the
 * cross-origin problem simply stops existing. The override remains for a
 * deployment that puts media on a CDN of its own.
 *
 * Stored URLs are relative ('/media/...') so that the same record works from a
 * handset, a laptop on the office network and a production domain. Anything
 * already absolute is passed through untouched, which is what makes this safe
 * to call on a value that might be either.
 */

const MEDIA_ORIGIN: string = import.meta.env.VITE_MEDIA_BASE ?? '';

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
