import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

/**
 * A dropdown you can type into.
 *
 * -- When to use this instead of Select --------------------------------------
 *
 * Select wraps the native control and is the right answer for a short, fixed
 * list — four licences, two languages, a dozen sections. It is the wrong answer
 * the moment the list is data: the notification screen offers every published
 * story, and finding one in a native dropdown means scrolling a window eight
 * rows tall with no way to search it.
 *
 * The rule is roughly a dozen. Below that, the native control wins on every
 * count — it is the platform's, it works on a phone, and it cannot have a
 * keyboard bug. Above it, being able to type is worth giving that up.
 *
 * -- Why the filtered list is what the keys move through ---------------------
 *
 * The active index points into the FILTERED options, not the full set. Keeping
 * it against the full list and skipping hidden entries is the version that
 * looks right until you type: the highlight appears to jump two rows, because
 * it is moving through options that are no longer drawn.
 *
 * -- Disabled options are still shown ----------------------------------------
 *
 * A publisher with no agreed licence is listed, greyed, with the reason beside
 * it. Hiding it would be kinder to the code and worse for the editor, who would
 * search for a publisher they know exists, fail to find it, and conclude the
 * search is broken rather than that the licence has lapsed.
 */

export interface ComboOption<T extends string> {
  value: T;
  label: string;
  /** A second line — a section, a date, a reason. Also searched. */
  hint?: string;
  disabled?: boolean;
  /** Why it cannot be chosen. Shown in place of the hint when disabled. */
  disabledReason?: string;
  lang?: string;
}

interface ComboboxProps<T extends string> {
  options: readonly ComboOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  placeholder?: string;
  /** Offers a control to go back to nothing selected. */
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  /** Shown when the list is empty before any filtering. */
  emptyLabel?: string;
}

function matches(option: ComboOption<string>, query: string): boolean {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(needle) ||
    (option.hint ?? '').toLowerCase().includes(needle)
  );
}

export function Combobox<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  clearable = false,
  disabled = false,
  id,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  emptyLabel = 'Nothing to choose from',
}: ComboboxProps<T>) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const listId = `${baseId}-listbox`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(
    () => options.filter((option) => matches(option, query)),
    [options, query],
  );

  /* Closed, the field shows what is chosen. Open, it shows what you are typing.
     One input doing both jobs is what makes it a combo box rather than a text
     field that happens to sit above a list. */
  const displayed = open ? query : (selected?.label ?? '');

  const firstEnabled = (from: number, delta: number): number => {
    const n = filtered.length;
    for (let step = 0; step < n; step += 1) {
      const i = (((from + delta * step) % n) + n) % n;
      if (filtered[i]?.disabled !== true) return i;
    }
    return -1;
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    const index = filtered.findIndex((o) => o.value === value);
    setActiveIndex(index >= 0 ? index : firstEnabled(0, 1));
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const choose = (index: number) => {
    const option = filtered[index];
    if (option === undefined || option.disabled === true) return;
    onChange(option.value);
    close();
    inputRef.current?.focus();
  };

  /* Closing on a press outside rather than on blur: blur fires before the click
     that caused it lands, so a blur-based close cancels the option the person
     was clicking on. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /** Keep the highlighted option in view when the keyboard moves it. */
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => firstEnabled(i + 1, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => firstEnabled(i - 1, -1));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActiveIndex(firstEnabled(0, 1));
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActiveIndex(firstEnabled(filtered.length - 1, -1));
        }
        break;
      case 'Enter':
        if (open && activeIndex >= 0) {
          /* Only swallowed when it is actually selecting something, so Enter in
             a closed combo box still submits the form around it. */
          event.preventDefault();
          choose(activeIndex);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        /* Tab commits nothing and closes. Selecting on Tab is a real pattern
           but it means passing through a field changes its value, which is
           surprising in a form you are only navigating. */
        if (open) close();
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={disabled ? 'combo combo-disabled' : 'combo'}
      ref={rootRef}
      /*
       * Tells the Field around it whether to float its label. The CSS can work
       * this out for a bare input with `:placeholder-shown`, but not through
       * this wrapper — and a combo box is "filled" when something is SELECTED,
       * which is not the same as the input having text in it.
       */
      data-filled={selected !== null || open ? 'true' : 'false'}
    >
      <div className="combo-field">
        <input
          ref={inputRef}
          id={baseId}
          className="combo-input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined
          }
          aria-describedby={describedBy}
          aria-label={ariaLabel}
          placeholder={selected === null ? placeholder : undefined}
          value={displayed}
          disabled={disabled}
          lang={open ? undefined : selected?.lang}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setActiveIndex(0);
          }}
          onMouseDown={() => {
            if (open) close();
            else openList();
          }}
          onKeyDown={onKeyDown}
        />

        {clearable && selected !== null && !open && (
          <button
            type="button"
            className="combo-clear"
            aria-label="Clear the selection"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            <Icon name="x" />
          </button>
        )}

        <Icon name="chevronDown" className="combo-chevron" />
      </div>

      {open && (
        /* The popup needs a name of its own, and it is not the field's: the
           input is already labelled by the Field around it, and reusing that
           label here would have a screen reader announce "Story, combo box" and
           then "Story, list box" as though they were two controls. */
        <ul className="combo-list" id={listId} role="listbox" aria-label="Suggestions">
          {filtered.length === 0 ? (
            /* Not an option: there is nothing here to select, and marking it
               `role="option"` would have a screen reader offer it as a choice. */
            <li className="combo-empty" role="presentation">
              {options.length === 0 ? emptyLabel : `Nothing matches “${query}”`}
            </li>
          ) : (
            filtered.map((option, index) => {
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
                  /* Pointer down, not click: the field keeps focus, so the
                     browser never gets a chance to blur and close the list out
                     from under the selection. */
                  onPointerDown={(e) => {
                    e.preventDefault();
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
