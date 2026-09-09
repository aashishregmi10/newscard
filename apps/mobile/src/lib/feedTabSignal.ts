/**
 * The Feed tab, pressed while the Feed tab is already open.
 *
 * Every app a reader already has behaves the same way here: the first press
 * returns to the top, the second refreshes. It is one of those conventions that
 * is invisible when present and mildly annoying when missing — the reader taps,
 * nothing happens, and they scroll back by hand.
 *
 * The tab bar and the list that has to respond are far apart in the tree: the
 * bar is in app/(tabs)/_layout.tsx, the list is one of several CategoryFeeds
 * inside a pager, two providers down. Threading a callback between them would
 * mean a context whose value changes on every press — and a context change
 * re-renders every mounted feed, which is precisely the cost we removed to make
 * the swipe smooth.
 *
 * So this is a plain subscription instead. Nothing here is state, nothing
 * re-renders, and only the feed that is actually on screen acts on it.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Returns an unsubscribe function, so it drops straight into a useEffect. */
export function onFeedTabPress(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitFeedTabPress(): void {
  // Copied before iterating: a listener that unsubscribes itself while the set
  // is being walked would otherwise skip the next one.
  for (const fn of [...listeners]) fn();
}
