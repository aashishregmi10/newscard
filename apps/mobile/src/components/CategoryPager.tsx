import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import PagerView from 'react-native-pager-view';
import { StyleSheet } from 'react-native';

/**
 * Horizontal pager across categories.
 *
 * Swiping left from नेपाल moves to राजनीति, exactly as the category rail
 * suggests it should. Before this, the rail was tappable only — which quietly
 * teaches the reader that horizontal gestures do nothing, and that is a habit
 * every other app on their phone contradicts.
 *
 * ── Why a native pager rather than a ScrollView ─────────────────────────────
 * Each page contains a VERTICALLY paged card list, so two gesture recognisers
 * are competing on the same surface. `react-native-pager-view` resolves this in
 * native code: it claims a gesture only once horizontal travel dominates, and
 * hands everything else to the child. Doing the same with a JS ScrollView means
 * both lists fight over every touch, and the failure mode is a feed that
 * occasionally refuses to scroll vertically — intermittent, hard to reproduce,
 * and infuriating.
 *
 * offscreenPageLimit is 1: one page either side stays mounted so a swipe shows
 * content immediately rather than a skeleton, without holding every category's
 * list in memory (Ch. 12.4 memory budget).
 */

export interface CategoryPagerHandle {
  setPage: (index: number) => void;
}

interface Props {
  initialPage: number;
  /** Fired when the pager SETTLES on a page. */
  onPageChange: (index: number) => void;
  /**
   * Fired as soon as the swipe passes the halfway point, before it settles.
   *
   * The rail highlight follows this rather than onPageChange so the label moves
   * with the reader's thumb instead of a beat after it. Waiting for the settle
   * is the difference between a pager that feels attached to the finger and one
   * that feels like it is catching up.
   */
  onPageApproaching?: (index: number) => void;
  children: ReactNode;
}

export const CategoryPager = forwardRef<CategoryPagerHandle, Props>(function CategoryPager(
  { initialPage, onPageChange, onPageApproaching, children },
  ref,
) {
  const pager = useRef<PagerView>(null);
  /** Last index reported as approaching, so a frame-rate scroll event produces
   *  at most one state update per swipe. */
  const approaching = useRef(initialPage);

  useImperativeHandle(ref, () => ({
    setPage: (index: number) => pager.current?.setPage(index),
  }));

  return (
    <PagerView
      ref={pager}
      style={styles.pager}
      initialPage={initialPage}
      offscreenPageLimit={1}
      onPageSelected={(e) => onPageChange(e.nativeEvent.position)}
      onPageScroll={(e) => {
        if (!onPageApproaching) return;
        const { position, offset } = e.nativeEvent;
        const next = Math.round(position + offset);
        if (next === approaching.current) return;
        approaching.current = next;
        onPageApproaching(next);
      }}
      // No rubber-band at the ends. On the first and last category the bounce
      // reads as "something is there" when nothing is.
      overdrag={false}
    >
      {children}
    </PagerView>
  );
});

const styles = StyleSheet.create({
  pager: { flex: 1 },
});
