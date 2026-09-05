import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { safeNotify, safeNotifySync } from '../lib/pushSupport';

/**
 * Notification tap → the right card.  Spec Ch. 10.7, test N-09.
 *
 * The single most important path in the notification feature. A tap must land
 * on the target story, not on a cold home screen that then navigates. This is
 * the loudest complaint theme about competing products, and it wastes the one
 * moment the reader actively chose to come back.
 *
 * Two entry points, and BOTH matter:
 *
 *   warm — the app is backgrounded; an event fires while the router is alive.
 *   cold — the app was killed; the tap launched it. The event is delivered
 *          once, before any listener exists, and is only retrievable via
 *          getLastNotificationResponseAsync. Handling only the warm case is
 *          the classic bug: it works in every casual test, because testers
 *          rarely force-stop the app first.
 */

interface NotificationData {
  slug?: string;
  deepLink?: string;
  type?: string;
}

/** Accepts either an explicit slug or a `newscard://article/<slug>` deep link. */
function targetFrom(data: NotificationData | undefined): string | null {
  if (!data) return null;
  if (typeof data.slug === 'string' && data.slug) return `/article/${data.slug}`;

  if (typeof data.deepLink === 'string') {
    const m = data.deepLink.match(/^newscard:\/\/article\/([^/?#]+)/i);
    if (m?.[1]) return `/article/${m[1]}`;
    if (/^newscard:\/\/bookmarks/i.test(data.deepLink)) return '/saved';
    if (/^newscard:\/\/settings/i.test(data.deepLink)) return '/settings';
    if (/^newscard:\/\/feed/i.test(data.deepLink)) return '/';
  }
  return null;
}

export function useNotificationRouting(): void {
  /** Guards against navigating twice when a cold-start tap also fires the
   *  listener on some platforms. */
  const handled = useRef<string | null>(null);

  const go = (path: string) => {
    if (handled.current === path) return;
    handled.current = path;
    router.push(path);
  };

  useEffect(() => {
    let alive = true;

    // Every call below is guarded. Expo Go on Android has no remote push
    // (SDK 53+), and an unguarded throw here happens inside a provider — which
    // takes the whole app down with the "something went wrong" screen. Reading
    // the news must never depend on notifications working.

    // Cold start: the tap that launched the app.
    void safeNotify((n) => n.getLastNotificationResponseAsync(), null).then(
      (response) => {
        if (!alive || !response) return;
        const target = targetFrom(
          response.notification.request.content.data as NotificationData | undefined,
        );
        if (target) go(target);
      },
    );

    // Warm: tapped while the app was already running or backgrounded.
    const sub = safeNotifySync(
      (n) =>
        n.addNotificationResponseReceivedListener((response) => {
          const target = targetFrom(
            response.notification.request.content.data as NotificationData | undefined,
          );
          if (target) {
            handled.current = null; // a fresh tap should always navigate
            go(target);
          }
        }),
      null,
    );

    return () => {
      alive = false;
      sub?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
