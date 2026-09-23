import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { parseRoute, routeToHash, type Route } from './nav';

/**
 * The React binding over nav.ts.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, because the
 * location bar is external state that can change without React's knowledge —
 * the Back button, a pasted URL, a link in another tab. The hook is the
 * supported way to read such a source without tearing, and it gets the
 * subscribe/unsubscribe lifecycle right in StrictMode, where an effect-based
 * version double-subscribes in development and hides the bug in production.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getSnapshot(): string {
  return window.location.hash;
}

/**
 * Go to a route.
 *
 * Exported as a plain function, not only as part of the hook, so that a
 * component can navigate without subscribing to the location — subscribing
 * means re-rendering on every navigation, which a button that only ever pushes
 * has no reason to do.
 *
 * `replace` is for corrections the editor did not ask for: canonicalising a
 * sloppy URL, or sending someone away from a screen their role cannot open.
 * Pushing those would put the bad URL in the history, where Back returns to it
 * and is bounced away again — a trap that looks like a frozen Back button.
 */
export function navigate(route: Route, options?: { replace?: boolean }): void {
  const hash = routeToHash(route);

  if (options?.replace === true) {
    window.history.replaceState(null, '', hash);
    /* replaceState deliberately does not fire hashchange, so the store above
       would never learn about it. Nothing else listens for this event, and
       re-reading the location is idempotent. */
    window.dispatchEvent(new Event('hashchange'));
    return;
  }

  /* Assigning an unchanged hash is a no-op in every browser — no event, no
     history entry — so re-clicking the section you are already in correctly
     does nothing rather than stacking duplicate entries. */
  window.location.hash = hash;
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot);
  const route = parseRoute(hash);
  const canonical = routeToHash(route);

  /**
   * Rewrite the location to the canonical spelling of whatever it resolved to.
   *
   * Two jobs: '#queue' and '#/Queue/' become '#/queue', and a URL that means
   * nothing at all stops claiming to. Without it the rail would highlight the
   * queue while the address bar still read '#/nonsense', and copying that
   * address would hand a colleague a link that does not work.
   *
   * `replaceState`, so correcting a URL does not add a history entry that Back
   * would return to and be corrected away from again.
   */
  useEffect(() => {
    if (window.location.hash !== canonical) {
      window.history.replaceState(null, '', canonical);
    }
  }, [canonical]);

  return route;
}

/** A stable navigate bound into the component tree, for props and callbacks. */
export function useNavigate(): (route: Route, options?: { replace?: boolean }) => void {
  return useCallback(navigate, []);
}
