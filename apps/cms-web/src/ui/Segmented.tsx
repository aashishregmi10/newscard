import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Two controls that were one, and should never have been.
 *
 * `Segmented` picks exactly one of a few options. `ToggleGroup` turns any
 * number of them on and off independently. They were previously drawn
 * identically, which is why a notification going to readers of both languages
 * looked like a single wide selection spanning two labels — with no way to tell
 * that clicking the lit half would switch it off. One is a joined strip, the
 * other is separated pills with tick boxes, and the difference is now visible
 * before you click anything.
 */

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** For a label in a language other than the surrounding page. */
  lang?: string;
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/**
 * A radio group, with the keyboard behaviour a radio group is supposed to have.
 *
 * Arrow keys move between options and select as they go; Home and End jump to
 * the ends; the group holds ONE tab stop, so tabbing through a form does not
 * mean pressing Tab once per option. This is the WAI-ARIA radio pattern, and it
 * is what a native `<input type="radio">` set does for free — which is the
 * behaviour people have in their fingers whether or not they could describe it.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = options.findIndex((o) => o.value === value);
  /* Nothing selected yet: the first option it is still possible to choose takes
     the tab stop, so the group can be reached at all. */
  const tabIndexOf = selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => o.disabled !== true);

  /** Step to the next selectable option, wrapping. Gives up after a full lap so
   *  a group whose options are all disabled cannot spin. */
  const move = (from: number, delta: number) => {
    const n = options.length;
    for (let step = 0; step < n; step++) {
      const i = (((from + delta * (step + 1)) % n) + n) % n;
      const option = options[i];
      if (option !== undefined && option.disabled !== true) {
        onChange(option.value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        /* Starting one before the first and stepping forward lands on the first
           option that is actually selectable. */
        event.preventDefault();
        move(options.length - 1, 1);
        break;
      case 'End':
        event.preventDefault();
        move(0, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel} aria-describedby={describedBy}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          className="seg"
          lang={option.lang}
          aria-checked={option.value === value}
          tabIndex={i === tabIndexOf ? 0 : -1}
          disabled={disabled || option.disabled === true}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleGroupProps<T extends string> {
  options: ReadonlyArray<Option<T>>;
  value: readonly T[];
  onChange: (value: T[]) => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/**
 * Independent on/off choices.
 *
 * Each is its own button with `aria-pressed`, so each is its own tab stop and
 * each announces its own state — which is correct here, because unlike a radio
 * group there is no single answer to move between. The tick box is drawn rather
 * than a real checkbox: the button already carries the state, and a checkbox
 * inside it would make a screen reader announce it a second time.
 */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: ToggleGroupProps<T>) {
  const toggle = (v: T) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <div className="toggle-group" role="group" aria-label={ariaLabel} aria-describedby={describedBy}>
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className="toggle"
            lang={option.lang}
            aria-pressed={on}
            disabled={disabled || option.disabled === true}
            onClick={() => toggle(option.value)}
          >
            <span className="toggle-box" aria-hidden="true">
              {on && <Icon name="check" />}
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
