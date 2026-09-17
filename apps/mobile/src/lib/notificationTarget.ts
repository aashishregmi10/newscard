/**
 * Where a notification tap should land.  Spec Ch. 10.7, test N-09.
 *
 * ── Why this is separated from the hook ─────────────────────────────────────
 *
 * The routing hook does two things: subscribe to the platform's notification
 * events, and decide where a payload points. Only the first needs React Native;
 * the second is string parsing with several branches, and it is the half that
 * can be quietly wrong.
 *
 * It matters because a tap is the one moment a reader actively chose to come
 * back. Landing them on a cold home screen wastes it, and that is the loudest
 * complaint theme about competing products. A payload we fail to parse is
 * indistinguishable, to the reader, from an app that ignored them.
 */

export interface NotificationData {
  slug?: string;
  deepLink?: string;
  type?: string;
}

/**
 * Accepts either an explicit slug or a `saar://…` deep link.
 *
 * `slug` wins when present: it is unambiguous, while a deep link has to be
 * parsed and could carry a query string or a fragment the route must not
 * inherit.
 */
export function targetFrom(data: NotificationData | undefined | null): string | null {
  if (!data) return null;
  if (typeof data.slug === 'string' && data.slug) return `/article/${data.slug}`;

  if (typeof data.deepLink === 'string') {
    // Stops at ?, # or a further /, so a tracking parameter cannot become part
    // of the slug and produce a 404 on a story that exists.
    const m = data.deepLink.match(/^saar:\/\/article\/([^/?#]+)/i);
    if (m?.[1]) return `/article/${m[1]}`;
    if (/^saar:\/\/bookmarks/i.test(data.deepLink)) return '/saved';
    if (/^saar:\/\/settings/i.test(data.deepLink)) return '/settings';
    if (/^saar:\/\/feed/i.test(data.deepLink)) return '/';
  }
  return null;
}
