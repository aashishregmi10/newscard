import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { INITIAL_FIT, nextFit, type FitState } from './cardFit';

/**
 * Measures a card and fits its story into it — see ./cardFit for the rules.
 *
 * ── Why the text is hidden until the first measurement ──────────────────────
 * A card that does not fit is laid out once at full size, measured, and laid
 * out again smaller. Shown, that is text visibly jumping a size. Hidden, the
 * text arrives a frame after the photograph, which nobody can see. Almost
 * always this happens off screen anyway — the list lays out the next card
 * before the reader reaches it — and the result is remembered, so a card
 * scrolled back to is right the first time.
 *
 * A timer lifts the hiding regardless. Text that never appears is the one
 * failure worse than text that is cut off.
 */

/** Settled results by card, height and text size. */
const cache = new Map<string, FitState>();
const CACHE_MAX = 600;

function remember(key: string, s: FitState): void {
  if (cache.size >= CACHE_MAX) {
    // Maps iterate in insertion order: this drops the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, s);
}

const REVEAL_AFTER_MS = 400;

export function useCardFit(key: string, height: number) {
  const [state, setState] = useState(() => ({ key, s: cache.get(key) ?? INITIAL_FIT }));
  const current = state.key === key ? state.s : (cache.get(key) ?? INITIAL_FIT);

  const measured = useRef({ text: 0, stripBottom: 0 });
  const latest = useRef({ key, current, height });
  latest.current = { key, current, height };
  const scheduled = useRef(false);

  const evaluate = useCallback(() => {
    scheduled.current = false;
    const { text, stripBottom } = measured.current;
    if (!text || !stripBottom) return;
    const { key: k, current: c, height: h } = latest.current;

    // Always re-checked, never trusted: if the card no longer fits for any
    // reason, it is fitted again from where it stands.
    const next = nextFit({ ...c, done: false }, { text, overflow: stripBottom - h });
    if (next.done) remember(k, next);
    if (next.fit === c.fit && next.collapse === c.collapse && next.done === c.done) return;
    setState({ key: k, s: next });
  }, []);

  /** Both measurements of one layout arrive together; this waits for both. */
  const schedule = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    requestAnimationFrame(evaluate);
  }, [evaluate]);

  const onTextLayout = useCallback(
    (e: LayoutChangeEvent) => {
      measured.current.text = e.nativeEvent.layout.height;
      schedule();
    },
    [schedule],
  );

  const onStripLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const l = e.nativeEvent.layout;
      measured.current.stripBottom = l.y + l.height;
      schedule();
    },
    [schedule],
  );

  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (current.done) return;
    const t = setTimeout(() => setRevealed(true), REVEAL_AFTER_MS);
    return () => clearTimeout(t);
  }, [current.done]);

  return {
    fit: current.fit,
    collapseImage: current.collapse,
    textHidden: !current.done && !revealed,
    onTextLayout,
    onStripLayout,
  };
}
