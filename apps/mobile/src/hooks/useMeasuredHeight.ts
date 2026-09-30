import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * The height a full-screen page actually has, measured rather than worked out.
 *
 * A paged list snaps every `height` pixels, so its pages must be exactly as
 * tall as the area they are drawn in. That area used to be computed — window
 * height minus the status bar, a rail of 52 and a tab bar of 58 — and every
 * number in that sum was wrong on some phone: the rail and tab bar grow with
 * the text size, the tab bar grows by the navigation-bar inset, and Android
 * reports the window height differently from one maker to the next. Each
 * error left the bottom of every card, the "read the full story" strip,
 * hidden under the tab bar.
 *
 * Measuring the container asks the layout engine instead, which is the one
 * thing that knows.
 *
 * `estimate` is used for the frames before the first measurement, so nothing
 * has to wait on it. Changes smaller than a pixel are ignored: layout reports
 * fractions, and a list whose page height moves by 0.3 re-lays every page.
 */
export function useMeasuredHeight(estimate: number): [number, (e: LayoutChangeEvent) => void] {
  const [measured, setMeasured] = useState<number | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.floor(e.nativeEvent.layout.height);
    if (h <= 0) return;
    setMeasured((prev) => (prev !== null && Math.abs(prev - h) < 1 ? prev : h));
  }, []);

  return [measured ?? Math.floor(estimate), onLayout];
}
