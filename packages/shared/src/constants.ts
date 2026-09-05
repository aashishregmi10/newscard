/** Values fixed by the spec that must agree across client, API, worker, and CMS. */

export const LANGUAGES = ['ne', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Nepal Time is UTC+05:45. Every scheduling rule is expressed in NPT because
 *  editorial and audience rhythms are local (spec Ch. 1.9). */
export const NPT_OFFSET_MINUTES = 5 * 60 + 45;

/** Spec Ch. 6.5.1 — server clamps any client request to this. */
export const FEED_PAGE_SIZE = 20;

/** Spec Ch. 10.1 — a product decision expressed in code. No user and no editor
 *  may raise the per-device cap above this. */
export const NOTIF_DAILY_CAP_MAX = 3;
export const NOTIF_MIN_GAP_MINUTES = 90;
export const QUIET_HOURS_NPT = { startMinute: 21 * 60 + 30, endMinute: 6 * 60 + 30 } as const;

/** Plan §2d — feed source diversity. Bites at 3 sources, not 30. */
export const MAX_CONSECUTIVE_SAME_SOURCE = 2;
export const MAX_SOURCE_SHARE_OF_PAGE = 0.4;

/** Spec Ch. 3.2.2 — longer headlines break the two-line card layout. */
export const HEADLINE_MAX_CHARS = 90;
export const PULL_QUOTE_MAX_CHARS = 70;

/** Spec Ch. 9.3 */
export const ARTICLE_CACHE_DAYS = 7;
export const ARTICLE_CACHE_MAX_CARDS = 400;

/** Spec Ch. 3.8.1 / 3.6.1 */
export const READ_EVENT_TTL_DAYS = 90;
export const DEVICE_IDLE_DELETE_DAYS = 180;

export const IMAGE_RENDITIONS = ['sm', 'md', 'lg'] as const;
export type ImageRendition = (typeof IMAGE_RENDITIONS)[number];

/** Spec Ch. 3.4.1 — seven categories at launch. Fewer categories with reliable
 *  daily volume beats many that are empty three days a week. */
export const MVP_CATEGORY_SLUGS = [
  'top',
  'nepal',
  'politics',
  'business',
  'world',
  'sports',
  'tech',
] as const;
