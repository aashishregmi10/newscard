import { useRef, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
 * A field for filtering a list.
 *
 * -- Why not `type="search"` -------------------------------------------------
 *
 * Because Chrome and Safari draw their own clear button inside it, in their own
 * style, at their own size — so the field would carry two crosses that do the
 * same thing and look nothing like each other. The same reasoning as the file
 * input: where a browser insists on drawing its own control, this application
 * either accepts it everywhere or replaces it everywhere.
 *
 * -- Why Escape clears --------------------------------------------------------
 *
 * It is what every search field on the platform does, so people try it without
 * thinking. Focus stays in the field afterwards, because the reason to clear is
 * almost always to type something else.
 */

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shows a spinner in place of the clear control while a search is running. */
  busy?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  busy = false,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value !== '') {
      /* Stopped here so the key does not also close a dialog or drawer this
         field happens to be inside. Clearing the field is what the person
         meant; closing the thing around it is not. */
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };

  return (
    <div className={disabled ? 'search search-disabled' : 'search'}>
      <Icon name="search" className="search-icon" />
      <input
        ref={inputRef}
        id={id}
        className="search-input"
        type="text"
        /* A search keyboard on a phone, without the browser's own clear button
           that `type="search"` would bring with it. */
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {busy ? (
        <span className="search-trailing">
          <Spinner />
        </span>
      ) : (
        value !== '' && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear the search"
            disabled={disabled}
            onClick={clear}
          >
            <Icon name="x" />
          </button>
        )
      )}
    </div>
  );
}
