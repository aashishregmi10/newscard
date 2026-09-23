import { useId } from 'react';
import { PER_PAGE_OPTIONS, type PerPage } from '../nav';
import { pageCountOf, pageRange, pageWindow } from '../lib/pagination';
import { Button } from './Button';
import { Select } from './Select';

/**
 * Paging a list.
 *
 * -- Why the range is spelled out --------------------------------------------
 *
 * "Showing 21 to 40 of 137" answers the question people actually have, which is
 * not "which page am I on" but "how much of this is left". A bare page number
 * makes you multiply.
 *
 * -- Why it is shown even when there is only one page ------------------------
 *
 * It was hidden for short lists, on the reasoning that a pager under six rows
 * is furniture. That is wrong for a tool: the footer is also where you go to
 * CHANGE the page size, and a control that appears only once a list is long
 * enough is a control nobody discovers. can-logistic's DataTable shows its
 * footer unconditionally — "1-5 of 5" with the arrows greyed — and it is right
 * to. The only case still hidden is a list with nothing in it, where an empty
 * state has already said so.
 *
 * -- What a screen reader gets ----------------------------------------------
 *
 * `<nav aria-label="Pagination">` so it appears in the landmark list, the
 * current page marked with `aria-current="page"`, and every number labelled
 * "Page 4" rather than "4" — a list of bare digits is unusable read aloud.
 * The range line is a live region, because after clicking "next" the only
 * change is content far away from the button that was pressed.
 */

interface PaginationProps {
  page: number;
  perPage: PerPage;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: PerPage) => void;
  /** Singular noun for the things being paged — 'story', 'short'. */
  noun?: string;
}

export function Pagination({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  noun = 'item',
}: PaginationProps) {
  const selectId = useId();
  const pageCount = pageCountOf(total, perPage);
  const current = Math.min(Math.max(1, page), pageCount);
  const { from, to } = pageRange(current, perPage, total);

  /* An empty list has an empty state above it that has already explained
     itself; a pager under it would be a control for nothing. */
  if (total === 0) return null;

  return (
    <nav className="pager" aria-label="Pagination">
      <p className="pager-range" role="status">
        {from}–{to} of {total} {total === 1 ? noun : `${noun}s`}
      </p>

      {
        <div className="pager-pages">
          <Button
            size="sm"
            variant="ghost"
            icon="chevronLeft"
            disabled={current <= 1}
            aria-label="Previous page"
            onClick={() => onPageChange(current - 1)}
          />

          {pageWindow(current, pageCount).map((token, index) =>
            token === 'gap' ? (
              /* Not a button, and hidden from assistive technology: it is a
                 statement that pages were left out, which the numbers either
                 side already make obvious when they are read in sequence. */
              <span className="pager-gap" key={`gap-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={token}
                type="button"
                className="pager-page"
                aria-label={`Page ${token}`}
                aria-current={token === current ? 'page' : undefined}
                onClick={() => onPageChange(token)}
              >
                {token}
              </button>
            ),
          )}

          <Button
            size="sm"
            variant="ghost"
            icon="chevronRight"
            disabled={current >= pageCount}
            aria-label="Next page"
            onClick={() => onPageChange(current + 1)}
          />
        </div>
      }

      <div className="pager-size">
        <label className="pager-size-label" htmlFor={selectId}>
          Per page
        </label>
        <Select
          id={selectId}
          className="pager-size-select"
          value={String(perPage)}
          onChange={(e) => {
            const next = Number(e.target.value);
            const chosen = PER_PAGE_OPTIONS.find((o) => o === next);
            if (chosen !== undefined) onPerPageChange(chosen);
          }}
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
    </nav>
  );
}
