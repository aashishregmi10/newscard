import { Fragment } from 'react';
import { routeToHash, type Route } from '../nav';
import { Icon } from './Icon';
import { Button } from './Button';

/**
 * Where this screen sits.
 *
 * -- Why the back control goes to the parent, not to history -----------------
 *
 * The obvious implementation is `history.back()`. It is wrong in two ways that
 * only show up in use: arriving here from outside the application — a link in a
 * chat, a bookmark — makes "back" leave the application entirely, and arriving
 * from a sibling story makes it go sideways rather than up. A crumb trail is a
 * statement about hierarchy, so its control should move up the hierarchy. It
 * navigates to the last crumb that has a destination, which is always the
 * parent and never a surprise.
 *
 * -- Why the trail is anchors -----------------------------------------------
 *
 * Same reason as the rail: middle-click, copy link address, and the browser's
 * own activation behaviour all come free with an `<a href>` and have to be
 * rebuilt badly on a button.
 *
 * -- Why the last crumb is not a link ----------------------------------------
 *
 * It is the page you are on. A link to here does nothing when clicked, which
 * teaches people that crumbs sometimes do nothing. `aria-current="page"` says
 * the same thing to a screen reader.
 */

export interface Crumb {
  label: string;
  /** Omitted on the final crumb — the page you are already on. */
  route?: Route;
}

interface BreadcrumbsProps {
  items: readonly Crumb[];
  /** Hides the back control, for a trail that is only one level deep. */
  showBack?: boolean;
}

export function Breadcrumbs({ items, showBack = true }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  /* The nearest ancestor that can actually be navigated to. Searched from the
     end, so a trail whose middle crumb has no route still finds a target. */
  const parent = [...items].reverse().find((crumb) => crumb.route !== undefined)?.route;

  return (
    <div className="crumbs">
      {showBack && parent !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          icon="arrowLeft"
          className="crumbs-back"
          aria-label="Back to the previous level"
          onClick={() => {
            window.location.hash = routeToHash(parent);
          }}
        />
      )}

      <nav aria-label="Breadcrumb">
        <ol className="crumbs-list">
          {items.map((crumb, index) => {
            const last = index === items.length - 1;

            return (
              <Fragment key={`${crumb.label}-${index}`}>
                <li className="crumbs-item">
                  {crumb.route !== undefined && !last ? (
                    <a className="crumbs-link" href={routeToHash(crumb.route)}>
                      {crumb.label}
                    </a>
                  ) : (
                    <span className="crumbs-current" aria-current={last ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
                {!last && (
                  /* Decorative: the list structure already conveys the nesting,
                     and a screen reader reading "chevron right" between every
                     level is noise. */
                  <li className="crumbs-sep" aria-hidden="true">
                    <Icon name="chevronRight" />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
