import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { safeNotify, safeNotifySync } from '../lib/pushSupport';
import { targetFrom, type NotificationData } from '../lib/notificationTarget';

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
 *
 * And the cold tap arrives before there is anywhere to go: the root layout
 * shows a blank surface, the language choice or the sign-in screen before it
 * mounts the navigator, and expo-router throws on a push before then — the
 * story was lost and the reader landed on the feed (launch review, 7 Oct
 * 2026). So a target waits until the caller says the navigator is up.
 */

/**
 * `targetFrom` — the decision about WHERE a payload points — lives in
 * ../lib/notificationTarget, so it can be tested without React Native. What
 * remains here is the subscription, which cannot be.
 */

export function useNotificationRouting(navigatorReady: boolean): void {
  /** Guards against navigating twice when a cold-start tap also fires the
   *  listener on some platforms. */
  const handled = useRef<string | null>(null);
  /** A tap that arrived before the navigator; opened once it is up. */
  const pending = useRef<string | null>(null);
  const ready = useRef(navigatorReady);
  ready.current = navigatorReady;

  const go = (path: string) => {
    if (handled.current === path) return;
    if (!ready.current) {
      pending.current = path;
      return;
    }
    handled.current = path;
    router.push(path);
  };

  useEffect(() => {
    if (!navigatorReady || pending.current === null) return;
    const path = pending.current;
    pending.current = null;
    go(path);
  }, [navigatorReady]);

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
     
  }, []);
}
