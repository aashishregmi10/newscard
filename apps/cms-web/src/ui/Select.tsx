import type { SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * The native select, redrawn.
 *
 * -- Superseded, and currently unused ----------------------------------------
 *
 * This used to say that leaving the popup to the operating system was the
 * correct trade, on the grounds that a hand-built listbox is the commonest
 * source of broken keyboard support on the web and that nothing improves on the
 * native control on a phone.
 *
 * Both of those are still true. What they were weighed against turned out to
 * matter more: only the CLOSED control was ours to style, so a form of Material
 * fields opened a Windows dropdown with a system-blue highlight in the middle of
 * it — the one element on the screen that belonged to a different application.
 * can-logistic, which this interface is matched to, uses MUI's Select, and MUI
 * does not use the native popup either.
 *
 * `Listbox` replaced it everywhere, implementing the full ARIA select-only
 * combobox pattern rather than approximating it, and accepting the loss on
 * touch because this is a desktop newsroom tool.
 *
 * It is kept, unused, for one reason: if a screen ever needs a genuinely native
 * control — a real phone surface, or a form that must post without JavaScript —
 * this is that control, and the floating-label rules in components.css still
 * carry the `.select-wrap` selectors it depends on. Delete both together, or
 * neither.
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
