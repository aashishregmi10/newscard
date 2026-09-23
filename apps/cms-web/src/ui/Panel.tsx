import { useId, type ReactNode } from 'react';

/**
 * A titled region.
 *
 * A `<section>` with a real heading rather than a styled `<div>`. That is what
 * puts the screen into a screen reader's landmark and heading lists, which is
 * how someone using one navigates a long page like the notification screen —
 * the alternative is listening to it from the top every time.
 *
 * `aria-labelledby` points at the heading instead of repeating the title in an
 * `aria-label`: one string, one place, and they cannot disagree.
 */
interface PanelProps {
  title?: ReactNode;
  /** A quiet note beside the title — a count, a unit, a caveat. */
  note?: ReactNode;
  actions?: ReactNode;
  /** Drop the body padding, for a panel whose content is a list of rows. */
  flush?: boolean;
  sunk?: boolean;
  /** Panels sit under the page's h1, so h2 is right unless one nests. */
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}

export function Panel({
  title,
  note,
  actions,
  flush = false,
  sunk = false,
  headingLevel = 2,
  className,
  children,
}: PanelProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <section
      className={['panel', sunk ? 'panel-sunk' : '', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby={title !== undefined ? headingId : undefined}
    >
      {title !== undefined && (
        <header className="panel-head">
          <Heading className="panel-title" id={headingId}>
            {title}
          </Heading>
          {note !== undefined && <span className="panel-head-note">{note}</span>}
          {actions !== undefined && <div className="panel-head-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel-body panel-body-flush' : 'panel-body'}>{children}</div>
    </section>
  );
}
