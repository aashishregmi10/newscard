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
  onPageChange: (index: number) => void;
  children: ReactNode;
}

export const CategoryPager = forwardRef<CategoryPagerHandle, Props>(function CategoryPager(
  { initialPage, onPageChange, children },
  ref,
) {
  const pager = useRef<PagerView>(null);

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
    >
      {children}
    </PagerView>
  );
});

const styles = StyleSheet.create({
  pager: { flex: 1 },
});
