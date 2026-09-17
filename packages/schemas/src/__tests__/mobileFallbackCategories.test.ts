import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MVP_CATEGORIES } from '../category.js';

/**
 * The mobile rail's bootstrap list must stay equal to MVP_CATEGORIES.
 *
 * ── Why this is a test and not an import ────────────────────────────────────
 *
 * apps/mobile is deliberately not an npm workspace and Metro's resolution is
 * confined to that directory, so the app cannot import this package. The list
 * is therefore written out twice, and the copy is exactly the kind that goes
 * quietly stale.
 *
 * It already did. The fallback held only `top`, so a reader who opened the app
 * while the API was unreachable got a single tab and no sign that six were
 * missing — the fetch that would have corrected it failed silently and never
 * ran again. The fix was to seed the rail with all seven; this is what stops
 * the two lists parting again.
 *
 * Read as text on purpose: parsing it needs neither the app's node_modules nor
 * its tsconfig, so this runs in the server suite, which is the one CI always
 * installs for.
 */

const FALLBACK_SOURCE = fileURLToPath(
  new URL('../../../../apps/mobile/app/(tabs)/index.tsx', import.meta.url),
);

/** Pull `{ slug, label.ne, label.en }` out of the FALLBACK_CATEGORIES literal. */
function readMobileFallback(): Array<{ slug: string; ne: string; en: string }> {
  const src = readFileSync(FALLBACK_SOURCE, 'utf8');

  const literal = /const FALLBACK_CATEGORIES:[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (!literal) {
    throw new Error(
      `FALLBACK_CATEGORIES not found in ${FALLBACK_SOURCE}. ` +
        'If it was renamed or moved, update this guard rather than deleting it.',
    );
  }

  const entry = /\{\s*slug:\s*'([^']+)',\s*label:\s*\{\s*ne:\s*'([^']+)',\s*en:\s*'([^']+)'\s*\}\s*\}/g;
  return [...literal[1].matchAll(entry)].map(([, slug, ne, en]) => ({ slug, ne, en }));
}

describe('mobile fallback categories', () => {
  it('matches MVP_CATEGORIES exactly, in order', () => {
    expect(readMobileFallback()).toEqual(
      MVP_CATEGORIES.map((c) => ({ slug: c.slug, ne: c.label.ne, en: c.label.en })),
    );
  });

  it('is all seven, so an unreachable API never costs the reader a section', () => {
    expect(readMobileFallback()).toHaveLength(7);
  });
});
