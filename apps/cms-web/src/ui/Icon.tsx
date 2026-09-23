import type { ReactNode } from 'react';

/**
 * The icon set.
 *
 * -- Why these are drawn here and not installed ------------------------------
 *
 * This application has exactly two dependencies, react and react-dom, and an
 * icon library would be the third — for thirty shapes totalling a few kilobytes
 * of path data. Every icon library also arrives as a thousand components, a
 * tree-shaking configuration to keep them out of the bundle, and its own
 * opinion about sizing and stroke that then has to be overridden. Drawing them
 * costs one file and buys a set that is internally consistent by construction.
 *
 * -- The grid ---------------------------------------------------------------
 *
 * Every icon is drawn on a 24x24 box with about 2px of optical padding, stroked
 * at 1.7 with round caps and joins, and never filled. Consistency in those four
 * numbers is the whole reason a set reads as a set; a single filled icon among
 * thirty stroked ones looks like a mistake even to someone who cannot say why.
 *
 * -- Accessibility ----------------------------------------------------------
 *
 * Hidden from assistive technology by default, because the overwhelming
 * majority sit beside a text label that already says the same thing and a
 * screen reader should not read it twice. An icon that is the ONLY content —
 * the duplicate and language flags in the queue, an icon-only button — passes
 * `title`, which promotes it to `role="img"` with an accessible name and also
 * gives sighted users the native tooltip.
 */

export type IconName =
  | 'alertCircle'
  | 'alertTriangle'
  | 'arrowLeft'
  | 'ban'
  | 'bell'
  | 'check'
  | 'checkCircle'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'clock'
  | 'copy'
  | 'externalLink'
  | 'fileText'
  | 'globe'
  | 'image'
  | 'inbox'
  | 'info'
  | 'layers'
  | 'logout'
  | 'newspaper'
  | 'pencil'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send'
  | 'smartphone'
  | 'tag'
  | 'trash'
  | 'upload'
  | 'video'
  | 'x'
  | 'zap';

/**
 * Path data only — no `svg` element, no stroke settings. Those live once in the
 * component below, so an icon added later cannot arrive with a different stroke
 * width or a stray fill.
 */
const SHAPES: Record<IconName, ReactNode> = {
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8v4.6" />
      <path d="M12 15.8h.01" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M10.3 4.9 2.9 17.7a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.8v4.4" />
      <path d="M12 17.6h.01" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19.2 12H4.8" />
      <path d="m11.2 5.2-6.4 6.8 6.4 6.8" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m6.1 6.1 11.8 11.8" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.6a6 6 0 1 0-12 0c0 3.6-.9 5.2-1.7 6.1a.8.8 0 0 0 .6 1.3h14.2a.8.8 0 0 0 .6-1.3c-.8-.9-1.7-2.5-1.7-6.1z" />
      <path d="M10 20.2a2.3 2.3 0 0 0 4 0" />
    </>
  ),
  check: <path d="M5.4 12.5 9.8 17l8.8-9.4" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m8.4 12.2 2.6 2.6 4.6-5" />
    </>
  ),
  chevronDown: <path d="m6.4 9.4 5.6 5.6 5.6-5.6" />,
  chevronLeft: <path d="M14.6 6.4 9 12l5.6 5.6" />,
  chevronRight: <path d="M9.4 6.4 15 12l-5.6 5.6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3 1.8" />
    </>
  ),
  copy: (
    <>
      <rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2.2" />
      <path d="M15.4 8.6V5.8a2.2 2.2 0 0 0-2.2-2.2H5.8a2.2 2.2 0 0 0-2.2 2.2v7.4a2.2 2.2 0 0 0 2.2 2.2h2.8" />
    </>
  ),
  externalLink: (
    <>
      <path d="M13.6 4.4h6v6" />
      <path d="M19.6 4.4 11 13" />
      <path d="M17.6 14.4V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.4a2 2 0 0 1 2-2h3.6" />
    </>
  ),
  fileText: (
    <>
      <path d="M13.8 3.4H7.4a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.4z" />
      <path d="M13.8 3.4v3.4a2 2 0 0 0 2 2h2.8" />
      <path d="M9 13.2h6" />
      <path d="M9 16.6h6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.6a12.6 12.6 0 0 1 3.2 8.4 12.6 12.6 0 0 1-3.2 8.4 12.6 12.6 0 0 1-3.2-8.4A12.6 12.6 0 0 1 12 3.6z" />
    </>
  ),
  image: (
    <>
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.6" />
      <circle cx="8.9" cy="10.1" r="1.6" />
      <path d="m3.6 17.4 4.6-4.3a2.1 2.1 0 0 1 2.9 0l4.3 4.1" />
      <path d="m14.6 14.6 1.3-1.2a2.1 2.1 0 0 1 2.9 0l1.8 1.7" />
    </>
  ),
  inbox: (
    <>
      <path d="M2.4 12h5l1.5 2.8h6.2L16.6 12h5" />
      <path d="M6.5 4.4h11a2 2 0 0 1 1.8 1.1l2.3 5.1a2 2 0 0 1 .2.8v6.2a2 2 0 0 1-2 2H4.2a2 2 0 0 1-2-2v-6.2a2 2 0 0 1 .2-.8l2.3-5.1a2 2 0 0 1 1.8-1.1z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 16v-4.6" />
      <path d="M12 8.2h.01" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.4 8.6 4.5-8.6 4.5-8.6-4.5z" />
      <path d="m3.4 12.4 8.6 4.5 8.6-4.5" />
      <path d="m3.4 16.6 8.6 4.5 8.6-4.5" />
    </>
  ),
  logout: (
    <>
      <path d="M9.6 20.4H6a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h3.6" />
      <path d="m15.4 16.4 4.6-4.4-4.6-4.4" />
      <path d="M20 12H9.2" />
    </>
  ),
  newspaper: (
    <>
      <path d="M17.6 20.4H5.2a2 2 0 0 1-2-2V6a1.4 1.4 0 0 1 1.4-1.4h11A1.4 1.4 0 0 1 17 6v12.4a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.4h-4" />
      <path d="M7 8.6h6.4" />
      <path d="M7 12.2h6.4" />
      <path d="M7 15.8h4.2" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.2 19.8v-3.2L16.4 4.4a2.2 2.2 0 0 1 3.2 3.2L7.4 19.8z" />
      <path d="m15.2 5.6 3.2 3.2" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5.2v13.6" />
      <path d="M5.2 12h13.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.6 9.6A8.6 8.6 0 0 0 5.8 6.4L3.4 8.6" />
      <path d="M3.4 4.4v4.2h4.2" />
      <path d="M3.4 14.4a8.6 8.6 0 0 0 14.8 3.2l2.4-2.2" />
      <path d="M20.6 19.6v-4.2h-4.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.6" />
      <path d="m15.9 15.9 4.5 4.5" />
    </>
  ),
  send: (
    <>
      <path d="M20.8 3.2 11 13" />
      <path d="M20.8 3.2 14.6 20.8l-3.5-7.8-7.9-3.5z" />
    </>
  ),
  smartphone: (
    <>
      <rect x="6.8" y="2.6" width="10.4" height="18.8" rx="2.4" />
      <path d="M11 18.4h2" />
    </>
  ),
  tag: (
    <>
      <path d="M11.4 3.6H5.6a2 2 0 0 0-2 2v5.8a2 2 0 0 0 .6 1.4l7.6 7.6a2 2 0 0 0 2.8 0l5.8-5.8a2 2 0 0 0 0-2.8l-7.6-7.6a2 2 0 0 0-1.4-.6z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.2 6.6h15.6" />
      <path d="M9.6 6.6V5.4a1.8 1.8 0 0 1 1.8-1.8h1.2a1.8 1.8 0 0 1 1.8 1.8v1.2" />
      <path d="M6.6 6.6 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.7-12.4" />
      <path d="M10.4 10.6v6.2" />
      <path d="M13.6 10.6v6.2" />
    </>
  ),
  upload: (
    <>
      <path d="M20.4 15.4V18a2.4 2.4 0 0 1-2.4 2.4H6A2.4 2.4 0 0 1 3.6 18v-2.6" />
      <path d="m7.8 8.8 4.2-4.2 4.2 4.2" />
      <path d="M12 4.6v10.8" />
    </>
  ),
  video: (
    <>
      <rect x="2.8" y="4.4" width="18.4" height="15.2" rx="3" />
      <path d="M10.2 9.3 15 12l-4.8 2.7z" />
    </>
  ),
  x: (
    <>
      <path d="M17.6 6.4 6.4 17.6" />
      <path d="m6.4 6.4 11.2 11.2" />
    </>
  ),
  zap: <path d="M12.8 2.6 4.4 13.4h6.4l-.6 8 8.4-10.8h-6.4z" />,
};

export interface IconProps {
  name: IconName;
  className?: string;
  /**
   * The accessible name. Supply it only when the icon is the sole carrier of
   * the meaning; supplying it beside a visible label makes a screen reader say
   * the same word twice.
   */
  title?: string;
}

export function Icon({ name, className, title }: IconProps) {
  const labelled = title !== undefined && title !== '';

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      /* Sized in em so an unclassed icon matches the text it sits in; every CSS
         rule that sets an explicit width wins over this. */
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      /* IE and old Edge put SVGs in the tab order. Harmless to keep, and it is
         one attribute against a keyboard trap that is invisible in testing. */
      focusable="false"
    >
      {labelled && <title>{title}</title>}
      {SHAPES[name]}
    </svg>
  );
}
