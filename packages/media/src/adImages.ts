import sharp from 'sharp';
import { flatBlurHash } from './blurHash.js';
import { ImageRejected, type ProcessedImage, type ProcessedRendition } from './images.js';

/**
 * Advertisers' images: the full-card poster and the small ad's logo.
 *
 * ── Why these do not go through processImage ─────────────────────────────────
 *
 * processImage crops everything to the story card's 16:9, choosing the crop by
 * entropy. That is right for a news photograph nobody is supervising and wrong
 * for both of these:
 *
 *   A poster is a designed thing — a price, a phone number, a logo in a
 *   corner. Cropping a portrait poster to landscape cuts off the top and the
 *   bottom, which is where designers put exactly those. So a poster keeps its
 *   own shape and is only scaled.
 *
 *   A logo is shown at about twenty pixels, beside the text of the small ad.
 *   Asking for 640 pixels of source would refuse most logos a small business
 *   actually has. So a logo is squared and kept small.
 *
 * Both are re-encoded, which strips EXIF, for the same reason as photographs.
 */

export type AdImageKind = 'poster' | 'logo';

/** A poster fills a phone screen, so it needs the same width a card photo does. */
export const MIN_POSTER_WIDTH = 640;
/** Enough for the largest logo rendition at 2x on a dense screen. */
export const MIN_LOGO_WIDTH = 64;

/**
 * How tall or wide a poster may be, as height ÷ width.
 *
 * A full-card slot on a phone is roughly 1 : 1.6. A square or a 9:16 story
 * format both sit well in it, letterboxed; a banner four times as wide as it
 * is tall would be a strip across the middle of an empty card, and is refused
 * now rather than discovered on a phone.
 */
export const POSTER_MIN_RATIO = 0.75;
export const POSTER_MAX_RATIO = 2.2;

const POSTER_WIDTHS = [
  { name: 'sm', width: 360 },
  { name: 'md', width: 720 },
  { name: 'lg', width: 1080 },
] as const;

const LOGO_SIZES = [
  { name: 'sm', width: 64 },
  { name: 'md', width: 128 },
  { name: 'lg', width: 256 },
] as const;

export async function processAdImage(input: Buffer, kind: AdImageKind): Promise<ProcessedImage> {
  let meta;
  try {
    meta = await sharp(input).rotate().metadata();
  } catch {
    throw new ImageRejected('That file could not be read as an image.', 'unreadable');
  }
  if (!meta.width || !meta.height) {
    throw new ImageRejected('That file could not be read as an image.', 'unreadable');
  }

  const min = kind === 'poster' ? MIN_POSTER_WIDTH : MIN_LOGO_WIDTH;
  if (meta.width < min) {
    throw new ImageRejected(
      kind === 'poster'
        ? `The poster is ${meta.width}px wide; it fills a phone screen, so it needs at least ${min}px.`
        : `The logo is ${meta.width}px wide; it needs at least ${min}px.`,
      'too_small',
    );
  }

  if (kind === 'poster') {
    const ratio = meta.height / meta.width;
    if (ratio < POSTER_MIN_RATIO || ratio > POSTER_MAX_RATIO) {
      throw new ImageRejected(
        ratio < POSTER_MIN_RATIO
          ? 'That image is too wide for a full-card poster. Use a portrait or square design.'
          : 'That image is too tall for a full-card poster. Use something no taller than 9:20.',
        'too_small',
      );
    }
  }

  /* `rotate()` with no argument applies the EXIF orientation before it is
     stripped, so a phone photo of a poster is not stored on its side. */
  const upright = await sharp(input).rotate().toBuffer();

  const renditions: ProcessedRendition[] = [];
  if (kind === 'poster') {
    for (const r of POSTER_WIDTHS) {
      const out = await sharp(upright)
        .resize({ width: r.width, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toBuffer({ resolveWithObject: true });
      renditions.push({
        name: r.name,
        width: out.info.width,
        height: out.info.height,
        filename: `${r.width}.jpg`,
        data: out.data,
      });
    }
  } else {
    for (const r of LOGO_SIZES) {
      /* PNG, not JPEG: logos are flat colour and often transparent, and JPEG
         puts a halo round both. */
      const out = await sharp(upright)
        .resize(r.width, r.width, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer({ resolveWithObject: true });
      renditions.push({
        name: r.name,
        width: out.info.width,
        height: out.info.height,
        filename: `${r.width}.png`,
        data: out.data,
      });
    }
  }

  const { data } = await sharp(upright)
    .flatten({ background: '#ffffff' })
    .resize(1, 1, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const largest = renditions[renditions.length - 1]!;
  return {
    blurHash: flatBlurHash(data[0] ?? 128, data[1] ?? 128, data[2] ?? 128),
    width: largest.width,
    height: largest.height,
    renditions,
  };
}
