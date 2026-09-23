import type { SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * The native select, redrawn.
 *
 * `appearance: none` plus a chevron of our own. The control is otherwise a real
 * `<select>` — the popup list is still the operating system's, which is the
 * correct trade: a hand-built listbox is the single most common source of
 * broken keyboard support on the web, and on a phone the native control is a
 * full-screen wheel that no replacement improves on.
 *
 * Only the closed control is ours to style. The open list is drawn by the OS
 * and ignores every token in this application, which is a limitation worth
 * knowing before someone tries to fix it.
 */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <span className="select-wrap">
      <select {...rest} className={className === undefined ? 'select' : `select ${className}`}>
        {children}
      </select>
      {/* Decorative: the select beside it is already announced as a combo box. */}
      <Icon name="chevronDown" className="select-chevron" />
    </span>
  );
}
