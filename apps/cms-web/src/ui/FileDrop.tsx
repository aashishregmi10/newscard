import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Choosing a file.
 *
 * -- Why not just `<input type="file">` --------------------------------------
 *
 * Because the browser draws it as an operating-system button reading "Choose
 * File / No file chosen", which is a different size, a different typeface and a
 * different shape on every machine, ignores every token in this design system,
 * and is the single most obviously unfinished-looking element a web application
 * can put on a page.
 *
 * The input is still here. It is what actually opens the picker, what carries
 * `accept` to the OS dialog, and what a screen reader announces as a file
 * control. It is hidden inside a `<label>`, so the whole zone is the control and
 * a click anywhere on it works without a line of JavaScript — and, crucially,
 * without the security restriction that stops a synthetic click opening a file
 * dialog in some browsers.
 *
 * -- Three things this handles that a bare input does not --------------------
 *
 * 1. Dropping a file. `dragenter`/`dragleave` fire for every child element, so
 *    a naive boolean flickers as the pointer crosses the icon; the depth is
 *    counted instead.
 * 2. `accept` on a drop. The attribute filters the OS dialog and nothing else —
 *    a dropped file bypasses it entirely, and without this check a .mov lands in
 *    an image field and fails much later with a server error.
 * 3. Choosing the same file twice. `change` does not fire when the value has not
 *    changed, so re-picking a file after an upload failed appears to do nothing.
 *    The input is cleared after every selection.
 */

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;

  const patterns = accept
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p !== '');
  if (patterns.length === 0) return true;

  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

interface FileDropProps {
  /** Same syntax as the input attribute; also enforced on dropped files. */
  accept?: string;
  disabled?: boolean;
  onSelect: (file: File) => void;
  /** Called when a dropped file does not match `accept`. */
  onReject?: (message: string) => void;
  icon?: IconName;
  title: string;
  hint?: ReactNode;
  id?: string;
  'aria-describedby'?: string;
}

export function FileDrop({
  accept,
  disabled = false,
  onSelect,
  onReject,
  icon = 'upload',
  title,
  hint,
  id,
  'aria-describedby': describedBy,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  /* A counter, not a boolean: dragenter and dragleave fire for every descendant
     the pointer crosses, so a boolean turns the highlight on and off as the
     pointer passes over the icon inside the zone. */
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const take = (file: File | undefined) => {
    if (file === undefined) return;
    if (!matchesAccept(file, accept)) {
      onReject?.(`${file.name} is not a file this field accepts.`);
      return;
    }
    onSelect(file);
  };

  const onDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled) return;
    /* Without preventDefault on dragover the drop event never fires and the
       browser navigates to the file instead. */
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (disabled) return;
    take(event.dataTransfer.files[0]);
  };

  return (
    <label
      className={[
        'filedrop',
        dragging ? 'filedrop-dragging' : '',
        disabled ? 'filedrop-disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="filedrop-icon">
        <Icon name={icon} />
      </span>
      <span className="filedrop-text">
        <span className="filedrop-title">{title}</span>
        {hint !== undefined && <span className="filedrop-hint">{hint}</span>}
      </span>
      <input
        ref={inputRef}
        id={id}
        className="filedrop-input"
        type="file"
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          take(event.target.files?.[0]);
          /* Cleared so that picking the same file again still fires `change`.
             Nothing depends on the input holding a value — the File is handed
             straight to the caller. */
          event.target.value = '';
        }}
      />
    </label>
  );
}
