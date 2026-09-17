import sharp from 'sharp';
import { flatBlurHash } from './blurHash.js';

/**
 * Turning an uploaded photograph into the three renditions the card uses.
 *
 * ── Where this came from ────────────────────────────────────────────────────
 *
 * This logic existed and could only be run from a seed script
 * (scripts/fetch-demo-images.ts). The editorial composer had no way to attach
 * an image at all, so every picture in the system arrived by running a script
 * against a stock photo library. Moving it here is what lets an editor upload
 * one — and it stays ONE implementation, so the seed corpus and real editorial
 * images are produced identically.
 *
 * ── Two decisions that cost real time to learn ──────────────────────────────
 *
 * The 16:9 crop is decided ONCE, on the large rendition, and the smaller two
 * are derived from that result. `position: 'attention'` runs an entropy
 * analysis to find the subject, which is the right call for a crop nobody is
 * supervising and is also expensive — running it three times per photograph
 * against a full-resolution source took about two and a half minutes an image.
 * Doing it once and downscaling is visually identical and far faster.
 *
 * Re-encoding as JPEG strips EXIF. That is not a size optimisation: EXIF can
 * carry the photographer's GPS coordinates, and a news photograph is exactly
 * the kind of image where that matters to someone.
 */

export const IMAGE_RENDITIONS = [
  { name: 'sm', width: 320 },
  { name: 'md', width: 720 },
  { name: 'lg', width: 1080 },
] as const;

export type ImageRenditionName = (typeof IMAGE_RENDITIONS)[number]['name'];

/** The canonical card aspect. Everything is cropped to it. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 608;

export interface ProcessedRendition {
  name: ImageRenditionName;
  width: number;
  height: number;
  /** Written by the caller, which is what decides where media lives. */
  filename: string;
  data: Buffer;
}

export interface ProcessedImage {
  blurHash: string;
  width: number;
  height: number;
  renditions: ProcessedRendition[];
}

export class ImageRejected extends Error {
  constructor(
    message: string,
    readonly reason: 'unreadable' | 'too_small',
  ) {
    super(message);
    this.name = 'ImageRejected';
  }
}

/**
 * Smallest source we will accept.
 *
 * Below this the large rendition is an upscale, which looks worse on the card
 * than no image at all — and an editor who uploaded a thumbnail by mistake
 * should be told now rather than discover it on a phone.
 */
export const MIN_SOURCE_WIDTH = 640;

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new ImageRejected('That file could not be read as an image.', 'unreadable');
  }

  if (!meta.width || !meta.height) {
    throw new ImageRejected('That file could not be read as an image.', 'unreadable');
  }
  if (meta.width < MIN_SOURCE_WIDTH) {
    throw new ImageRejected(
      `The image is ${meta.width}px wide; cards need at least ${MIN_SOURCE_WIDTH}px or it will be upscaled.`,
      'too_small',
    );
  }

  const large = await sharp(input)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const renditions: ProcessedRendition[] = [];
  for (const r of IMAGE_RENDITIONS) {
    const height = Math.round((r.width * CARD_HEIGHT) / CARD_WIDTH);
    const data = await sharp(large)
      .resize(r.width, height, { fit: 'cover' })
      .jpeg({ quality: 78, progressive: true })
      .toBuffer();
    renditions.push({ name: r.name, width: r.width, height, filename: `${r.width}.jpg`, data });
  }

  // One pixel is exactly the average colour.
  const { data } = await sharp(large)
    .resize(1, 1, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    blurHash: flatBlurHash(data[0] ?? 128, data[1] ?? 128, data[2] ?? 128),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    renditions,
  };
}
