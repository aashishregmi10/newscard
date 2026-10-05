import sharp from 'sharp';
import { flatBlurHash } from './blurHash.js';
import { ImageRejected, type ProcessedImage, type ProcessedRendition } from './images.js';

/**
 * A business's or candidate's photo on an Interaction card: square.
 *
 * Not processImage, which cuts to the story card's 16:9, and not the ad logo,
 * which is kept tiny and letterboxed. A candidate's photo is a face or a shop
 * front in a square tile of a 2×2 grid, so it is cropped square from the
 * middle-weighted "attention" point — where the face usually is — and kept
 * large enough to fill half a phone's width on a dense screen.
 *
 * Re-encoded as JPEG, which strips EXIF (location included) as for every
 * photograph we store.
 */

/** Half a phone's width at 2x, with room to spare. */
export const MIN_SQUARE_SOURCE = 320;

/** The formats an editor's photo may arrive in. Anything else is refused by name. */
export const SQUARE_IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;

const SQUARE_SIZES = [
  { name: 'sm', width: 160 },
  { name: 'md', width: 320 },
  { name: 'lg', width: 640 },
] as const;

export async function processSquareImage(input: Buffer): Promise<ProcessedImage> {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new ImageRejected('That file could not be read as an image.', 'unreadable');
  }
  if (!meta.width || !meta.height || !meta.format) {
    throw new ImageRejected('That file could not be read as an image.', 'unreadable');
  }
  if (!(SQUARE_IMAGE_FORMATS as readonly string[]).includes(meta.format)) {
    throw new ImageRejected(
      `That is a ${meta.format.toUpperCase()} file. Use a JPEG, PNG or WebP photo.`,
      'unreadable',
    );
  }
  /* The short side is what survives a square crop. Orientation 5–8 swaps the
     sides once the phone's rotation is applied. */
  const sideways = (meta.orientation ?? 1) >= 5;
  const shortSide = Math.min(meta.width, meta.height);
  if (shortSide < MIN_SQUARE_SOURCE) {
    const [w, h] = sideways ? [meta.height, meta.width] : [meta.width, meta.height];
    throw new ImageRejected(
      `The photo is ${w}×${h}px; it is cropped square, so its shorter side needs at least ${MIN_SQUARE_SOURCE}px.`,
      'too_small',
    );
  }

  const upright = await sharp(input).rotate().toBuffer();

  const renditions: ProcessedRendition[] = [];
  for (const r of SQUARE_SIZES) {
    const out = await sharp(upright)
      .resize(r.width, r.width, { fit: 'cover', position: sharp.strategy.attention, withoutEnlargement: false })
      .flatten({ background: '#ffffff' })
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
