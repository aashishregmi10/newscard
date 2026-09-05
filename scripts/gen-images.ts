/**
 * Generate synthetic placeholder images for the seed corpus.
 *
 * These are NOT news photographs and must never be presented as such. We hold no
 * licence to any real image, so the seed generates flat gradients instead —
 * deterministic per slug, tinted by category, in the same three renditions the
 * production pipeline emits (Ch. 4.8). That way the client's image path
 * (rendition selection, layout reservation, blurHash placeholder, Data Saver
 * tap-to-load) is exercised for real without any rights question.
 *
 * Written to `media/` and served by the API at /media in development. In
 * production the same keys sit behind a CDN.
 *
 * Run: npm run media:gen
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradientPng, blurHashFlat, averageOf, type Rgb } from './lib/png.js';
import { SEED_SLUGS } from './seedStories.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(ROOT, 'media');

/** Muted, print-like tints. Nothing that could be mistaken for a photograph. */
const PALETTE: Record<string, [Rgb, Rgb]> = {
  nepal: [{ r: 34, g: 62, b: 90 }, { r: 96, g: 128, b: 156 }],
  politics: [{ r: 74, g: 44, b: 62 }, { r: 142, g: 106, b: 122 }],
  business: [{ r: 30, g: 72, b: 64 }, { r: 104, g: 150, b: 138 }],
  world: [{ r: 46, g: 50, b: 84 }, { r: 116, g: 122, b: 158 }],
  sports: [{ r: 74, g: 66, b: 30 }, { r: 154, g: 142, b: 90 }],
  tech: [{ r: 40, g: 48, b: 68 }, { r: 108, g: 122, b: 152 }],
  top: [{ r: 44, g: 54, b: 70 }, { r: 118, g: 132, b: 152 }],
};

export const RENDITIONS = [
  { name: 'sm', width: 320, height: 180 },
  { name: 'md', width: 720, height: 405 },
  { name: 'lg', width: 1080, height: 608 },
] as const;

export interface GeneratedImage {
  key: string;
  blurHash: string;
  width: number;
  height: number;
  urls: { sm: string; md: string; lg: string };
  bytes: Record<string, number>;
}

/**
 * Deterministic from the slug, so re-running the generator produces identical
 * keys and the seed's URLs stay valid.
 */
export function generateFor(slug: string, categorySlug: string, cdnBase: string): GeneratedImage {
  const key = createHash('sha256').update(slug).digest('hex').slice(0, 12);
  const [a, b] = PALETTE[categorySlug] ?? PALETTE.top!;

  // Nudge the gradient per-slug so two stories in one category do not look
  // identical in the feed.
  const jitter = parseInt(key.slice(0, 2), 16) % 28;
  const top: Rgb = { r: a.r + jitter, g: a.g + jitter, b: a.b + jitter };
  const bottom: Rgb = { r: b.r + jitter, g: b.g + jitter, b: b.b + jitter };

  const dir = join(MEDIA, 'i', key);
  mkdirSync(dir, { recursive: true });

  const bytes: Record<string, number> = {};
  for (const r of RENDITIONS) {
    const png = gradientPng(r.width, r.height, top, bottom);
    writeFileSync(join(dir, `${r.width}.png`), png);
    bytes[r.name] = png.length;
  }

  return {
    key,
    blurHash: blurHashFlat(averageOf(top, bottom)),
    width: 1080,
    height: 608,
    urls: {
      sm: `${cdnBase}/i/${key}/320.png`,
      md: `${cdnBase}/i/${key}/720.png`,
      lg: `${cdnBase}/i/${key}/1080.png`,
    },
    bytes,
  };
}

/** Regenerate every image the seed will reference. */
export function generateAll(cdnBase: string): { count: number; bytes: number } {
  let bytes = 0;
  for (const { slug, category } of SEED_SLUGS) {
    const img = generateFor(slug, category, cdnBase);
    bytes += Object.values(img.bytes).reduce((x, y) => x + y, 0);
  }
  return { count: SEED_SLUGS.length * RENDITIONS.length, bytes };
}

/* Standalone run. `require.main` is undefined once bundled, so the filename
   check keeps this from firing when the module is merely imported by seed.ts. */
if (process.argv[1]?.replace(/\\/g, '/').endsWith('gen-images.ts')) {
  const cdn = process.env.CDN_BASE_URL ?? 'http://localhost:3000/media';
  const { count, bytes } = generateAll(cdn);
  console.log(`generated ${count} images in media/`);
  console.log(`total ${(bytes / 1024).toFixed(0)} KB — synthetic placeholders, not photographs`);
}
