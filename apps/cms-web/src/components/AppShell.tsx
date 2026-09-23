import { useEffect, useRef, type ReactNode } from 'react';
import type { Staff } from '../api';
import { Routes, canAccess, routeToHash, type Route, type Section } from '../nav';
import { usePreventStrayFileDrop } from '../hooks/usePreventStrayFileDrop';
import { Button, Icon, type IconName } from '../ui';

/**
 * The frame: a persistent drawer, a toolbar beside it, and the screen beneath.
 *
 * -- Matched to can-logistic -------------------------------------------------
 *
 * Its SidebarLayout puts the logo and the navigation in a 250px drawer, and
 * who-you-are and what-you-can-do in an AppBar offset to the right of it. The
 * division is worth keeping: the drawer answers "where can I go", the bar
 * answers "who am I". Mixing them is what made the sign-out control sit
 * awkwardly at the foot of a list of sections.
 *
 * -- Why the navigation items are links --------------------------------------
 *
 * They were buttons calling a setter. As anchors pointing at the hash they get,
 * for free, everything a button cannot do: middle-click to open the queue in a
 * second tab, "copy link address" to send a colleague to the screen you are
 * looking at, the browser's own focus and activation behaviour, and a status
 * bar that previews the destination. The click handler is the browser's.
 *
 * -- Why the section you are on is still shown -------------------------------
 *
 * Previously it was hidden — `{!shorts && <button>Shorts</button>}` — so the
 * only cue to where you were was which control had disappeared, and every
 * screen needed its own back button to compensate. Here the item stays, and
 * `aria-current` marks it for both the eye and a screen reader.
 */

interface RailSection {
  section: Section;
  route: Route;
  label: string;
  icon: IconName;
}

/*
 * The rail always links to a section's default view — page one, unfiltered.
 * Remembering where you were in a list and returning you there sounds helpful
 * and is not: clicking "Queue" after working elsewhere and landing on page
 * four of a filter you set an hour ago reads as a broken link.
 */
const SECTIONS: readonly RailSection[] = [
  { section: 'queue', route: Routes.queue(), label: 'Queue', icon: 'inbox' },
  { section: 'shorts', route: Routes.shorts(), label: 'Shorts', icon: 'video' },
  { section: 'sources', route: Routes.sources(), label: 'Publishers', icon: 'newspaper' },
  {
    section: 'notifications',
    route: Routes.notifications(),
    label: 'Notifications',
    icon: 'bell',
  },
];

interface AppShellProps {
  staff: Staff;
  section: Section;
  /**
   * How many stories are waiting, as of the last time the queue was loaded.
   * Null before it ever has been. Deliberately not refetched while another
   * section is open: a number that is a few minutes old is useful, and a
   * background poll to keep a badge honest is not worth the requests.
   */
  queueCount: number | null;
  /** Changes whenever the screen does; see the effect below. */
  routeKey: string;
  onSignOut: () => void;
  signingOut: boolean;
  children: ReactNode;
}

export function AppShell({
  staff,
  section,
  queueCount,
  routeKey,
  onSignOut,
  signingOut,
  children,
}: AppShellProps) {
  usePreventStrayFileDrop();

  const mainRef = useRef<HTMLElement | null>(null);
  const settled = useRef(false);

  /**
   * What navigation does to the scroll position and to focus.
   *
   * Scrolling to the top is the obvious half: without it, opening a story from
   * the bottom of a long queue drops you at the bottom of the composer, looking
   * at the reminder text instead of the headline field.
   *
   * Moving focus is the half that gets left out. In a page-loading application
   * the browser resets focus for you and a screen reader starts reading the new
   * page; in this one the DOM changes underneath and focus stays wherever it
   * was, so someone using a screen reader gets no indication that anything
   * happened at all. Focusing the region is the accepted remedy.
   *
   * Skipped on the first render, where there is no navigation to announce and
   * taking focus would only fight whatever the screen wanted it on.
   */
  useEffect(() => {
    const el = mainRef.current;
    if (el === null) return;

    if (!settled.current) {
      settled.current = true;
      return;
    }

    el.scrollTop = 0;
    el.focus({ preventScroll: true });
  }, [routeKey]);

  const visible = SECTIONS.filter((s) => canAccess(s.route, staff.role));
  const current = visible.find((s) => s.section === section);

  return (
    <div className="app">
      <nav className="rail" aria-label="Sections">
        <div className="rail-brand">
          <span className="rail-mark">SAAR</span>
          <span className="rail-sub">Editorial</span>
        </div>

        <ul className="rail-nav">
          {visible.map((item) => {
            const isCurrent = item.section === section;
            const count = item.section === 'queue' ? queueCount : null;

            return (
              <li key={item.section}>
                <a
                  className="rail-item"
                  href={routeToHash(item.route)}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  <Icon name={item.icon} className="rail-icon" />
                  <span className="rail-label">{item.label}</span>
                  {count !== null && count > 0 && (
                    <span className="rail-count">
                      {count}
                      {/* The digit alone is ambiguous once the label is hidden
                          at narrow widths, so the meaning is carried in text
                          that is always there for a screen reader. */}
                      <span className="sr-only"> waiting</span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/*
        * The toolbar.
        *
        * Material's AppBar as can-logistic configures it: the page's own
        * background colour, no shadow, a divider beneath. It names the section
        * rather than repeating the brand, because the drawer beside it already
        * carries the brand and the section is the thing that changes.
        */}
      <header className="toolbar-bar">
        <h2 className="toolbar-title">{current?.label ?? 'Editorial'}</h2>

        <div className="toolbar-actions">
          <div className="who">
            <span className="rail-avatar" aria-hidden="true">
              {staff.email.slice(0, 1)}
            </span>
            <span className="rail-identity">
              <span className="rail-email" title={staff.email}>
                {staff.email}
              </span>
              <span className="rail-role">{staff.role}</span>
            </span>
          </div>

          <Button
            variant="ghost"
            icon="logout"
            busy={signingOut}
            onClick={onSignOut}
            aria-label={`Sign out — signed in as ${staff.email}`}
            title="Sign out"
          />
        </div>
      </header>

      {/*
        * The scroll container, and the only one.
        *
        * `tabIndex={-1}` makes it focusable by script without putting it in the
        * tab order; the ring is suppressed because a 2px outline around the
        * entire screen on every navigation is noise, and the announcement — not
        * the outline — is what the focus is for.
        */}
      <main className="main" ref={mainRef} tabIndex={-1} data-focus-ring="none">
        {children}
      </main>
    </div>
  );
}
