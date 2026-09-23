import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

/**
 * A dropdown with a list we draw ourselves.
 *
 * -- Why this exists, when Select already did --------------------------------
 *
 * `Select` wraps the native control, and the note on it says the operating
 * system's popup is the correct trade. That was a defensible position and it is
 * no longer the one we hold: the OS list ignores every token in this design
 * system, so a form of Material fields opened a Windows dropdown with a blue
 * system highlight in the middle of it. It is the same complaint the file input
 * gets in FileDrop — the one element on the screen that looks like it belongs
 * to a different application.
 *
 * can-logistic, which this interface is matched to, uses MUI's `Select` with
 * `MenuItem`, and MUI does not use the native popup either. This reproduces
 * that in CSS, because cms-web has two dependencies and is staying that way.
 *
 * -- What is given up, and why it is affordable ------------------------------
 *
 * A hand-built listbox is a common source of broken keyboard support, so the
 * whole ARIA select-only combobox pattern is implemented here rather than
 * approximated: roving `aria-activedescendant`, type-ahead, Home/End, Escape,
 * and focus returned to the trigger on close.
 *
 * The real loss is touch: on a phone the native control is a full-screen wheel
 * that nothing hand-built improves on. This is a newsroom tool used on a
 * desktop, which is what makes the trade payable here and would not make it
 * payable in the reader app.
 *
 * -- Why it borrows the combo box's popup ------------------------------------
 *
 * Because they must be identical. Two dropdowns on adjacent screens with
 * different row heights and different tints is exactly the kind of drift a
 * design system exists to prevent, so the list, the rows, the tick and the
 * disabled state are one set of rules serving both — see `.combo-list` and the
 * selectors beside it in patterns.css.
 */

export interface ListboxOption<T extends string> {
  value: T;
  label: string;
  /** A second line — a reason, a qualifier. */
  hint?: string;
  disabled?: boolean;
  /** Why it cannot be chosen. Shown in place of the hint when disabled. */
  disabledReason?: string;
  lang?: string;
}

interface ListboxProps<T extends string> {
  options: readonly ListboxOption<T>[];
  value: T | '';
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Shown when there is nothing to choose from at all. */
  emptyLabel?: string;
}

/** How long consecutive keystrokes count as one type-ahead word. */
const TYPEAHEAD_MS = 600;

export function Listbox<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  id,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  placeholder,
  emptyLabel = 'Nothing to choose from',
}: ListboxProps<T>) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const listId = `${baseId}-list`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const typeahead = useRef({ buffer: '', at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const firstEnabled = () => options.findIndex((o) => o.disabled !== true);

  const openList = () => {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled());
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined || option.disabled === true) return;
    onChange(option.value);
    close();
  };

  /*
   * Pointerdown rather than click, and on the document rather than a backdrop.
   *
   * A backdrop element would swallow the first click on whatever the editor was
   * actually reaching for, so dismissing the list would cost them the button
   * they were aiming at. Pointerdown closes before that click lands anywhere.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      /* No focus return: the pointer is already somewhere else, and pulling it
         back would fight whatever the editor just chose to do. */
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /* The highlighted row has to be visible to be a highlight. `nearest` rather
     than `center` so arrowing one row does not scroll the whole list. */
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  /** Step to the next selectable row, skipping disabled ones, without wrapping
   *  past the end — wrapping in a select surprises people more than it helps. */
  const step = (from: number, delta: number) => {
    let i = from;
    for (;;) {
      i += delta;
      if (i < 0 || i >= options.length) return;
      if (options[i]?.disabled !== true) {
        setActiveIndex(i);
        return;
      }
    }
  };

  const edge = (to: 'first' | 'last') => {
    const order = to === 'first' ? options.map((_, i) => i) : options.map((_, i) => i).reverse();
    const found = order.find((i) => options[i]?.disabled !== true);
    if (found !== undefined) setActiveIndex(found);
  };

  const jumpToTyped = (char: string) => {
    const now = Date.now();
    const buffer =
      now - typeahead.current.at > TYPEAHEAD_MS ? char : typeahead.current.buffer + char;
    typeahead.current = { buffer, at: now };

    const query = buffer.toLowerCase();
    const found = options.findIndex(
      (o) => o.disabled !== true && o.label.toLowerCase().startsWith(query),
    );
    if (found < 0) return;
    if (open) setActiveIndex(found);
    else onChange(options[found]!.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    // A printable character is type-ahead whether the list is open or shut.
    if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      jumpToTyped(event.key);
      return;
    }

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(activeIndex, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(activeIndex, -1);
        break;
      case 'Home':
        event.preventDefault();
        edge('first');
        break;
      case 'End':
        event.preventDefault();
        edge('last');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        /* Not prevented: the list closes and focus moves on, which is what Tab
           is for. Committing the highlight here would select something the
           editor never looked at. */
        close(false);
        break;
      default:
        break;
    }
  };

  const shownPlaceholder = placeholder?.trim() ?? '';

  return (
    <div
      ref={rootRef}
      className={disabled ? 'combo listbox listbox-disabled' : 'combo listbox'}
      /* Tells the Field whether to float its label. A selection is a value even
         though there is no input for the CSS to inspect; see Field.tsx. */
      data-filled={selected !== undefined || open ? 'true' : 'false'}
    >
      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        className="listbox-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined
        }
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        disabled={disabled}
        lang={selected?.lang}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="listbox-value">
          {selected?.label ?? shownPlaceholder}
        </span>
      </button>

      {/* Decorative: the button beside it is already announced as a combo box. */}
      <Icon name="chevronDown" className="combo-chevron" />

      {open && (
        <ul
          className="combo-list"
          id={listId}
          role="listbox"
          /* Named separately from the field. The trigger already carries the
             Field's label, and reusing it here makes a screen reader announce
             the same name twice as though they were two controls. */
          aria-label="Options"
        >
          {options.length === 0 ? (
            /* Not an option: there is nothing here to select, and marking it
               `role="option"` would have a screen reader offer it as a choice. */
            <li className="combo-empty" role="presentation">
              {emptyLabel}
            </li>
          ) : (
            options.map((option, index) => {
              const isDisabled = option.disabled === true;
              const secondary = isDisabled ? (option.disabledReason ?? option.hint) : option.hint;

              return (
                <li
                  key={option.value}
                  id={`${baseId}-option-${index}`}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  role="option"
                  className="combo-option"
                  aria-selected={option.value === value}
                  aria-disabled={isDisabled || undefined}
                  data-active={index === activeIndex}
                  lang={option.lang}
                  /* Pointer down, not click: the document listener above would
                     otherwise close the list on the same gesture and the click
                     would land on nothing. */
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    choose(index);
                  }}
                  onMouseEnter={() => {
                    if (!isDisabled) setActiveIndex(index);
                  }}
                >
                  <span className="combo-tick">
                    {option.value === value && <Icon name="check" />}
                  </span>
                  <span className="combo-text">
                    <span className="combo-label">{option.label}</span>
                    {secondary !== undefined && secondary !== '' && (
                      <span className="combo-hint">{secondary}</span>
                    )}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
