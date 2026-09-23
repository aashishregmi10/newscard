import { Routes } from '../nav';
import type { Crumb } from '../ui';

/**
 * Breadcrumb trails, defined once.
 *
 * can-logistic's PageBreadcrumbs takes the screen-specific part of the trail
 * and prepends its own root — "Dashboard" — so every screen in the application
 * shows at least two levels and the root is impossible to get wrong or to
 * forget. The same arrangement here, with "Editorial" as the root, pointing at
 * the queue because that is this application's home.
 *
 * A list screen gets a trail exactly as a detail screen does. That is worth
 * saying because it is tempting to treat crumbs as a detail-screen ornament:
 * they are how you get back OUT, and a list two clicks from the top needs that
 * as much as a record does.
 */
export const ROOT_CRUMB: Crumb = { label: 'Editorial', route: Routes.queue() };

/** The root, followed by whatever this screen adds. */
export function crumbs(...trail: readonly Crumb[]): Crumb[] {
  return [ROOT_CRUMB, ...trail];
}
