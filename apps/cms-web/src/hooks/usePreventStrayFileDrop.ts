import { useEffect } from 'react';

/**
 * Stop a missed drop from throwing the application away.
 *
 * Drop a video file anywhere on a web page that is not expecting one and the
 * browser navigates to it: the tab becomes a video player, and everything the
 * editor had not yet saved is gone. On the shorts screen — a page whose entire
 * purpose is receiving dropped video — the target is one box among a screenful
 * of form, so missing it is not an unusual accident.
 *
 * The fix is the standard pair. `preventDefault` on dragover makes the window a
 * valid drop target, which is what stops the browser handling the drop itself;
 * `preventDefault` on drop then discards it.
 *
 * Two conditions keep this from breaking anything real:
 *
 *   - Only file drags. Dragging a selection inside a textarea to move it is a
 *     genuine editing gesture and must keep working.
 *   - Only drags no drop zone has claimed. A FileDrop calls preventDefault in
 *     its own handler, which runs first — React dispatches at the root, below
 *     the window — so `defaultPrevented` tells us to leave it alone. Without
 *     that check the cursor would read "not allowed" over the very box the
 *     editor is aiming at.
 */
export function usePreventStrayFileDrop(): void {
  useEffect(() => {
    const isFileDrag = (event: DragEvent): boolean =>
      event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes('Files');

    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'none';
    };

    const onDrop = (event: DragEvent) => {
      if (!isFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
