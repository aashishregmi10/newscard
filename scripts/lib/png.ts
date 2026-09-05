import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder, and a BlurHash encoder for the average colour.
 *
 * WHY THIS EXISTS AND WHAT IT IS NOT:
 *
 * We have no licence to any real news photograph, so the seed cannot contain
 * one. These are SYNTHETIC placeholder images — flat gradients — generated
 * deterministically per article so the image pipeline (three renditions, CDN
 * URLs, blurHash placeholders, layout reservation) can be exercised end to end
 * without any rights question.
 *
 * Production images come from the ingestion pipeline as WebP via sharp
 * (Ch. 4.8). PNG is used here only because it can be written with node:zlib and
 * no native dependency.
 */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Encode a vertical two-stop gradient as an 8-bit RGB PNG.
 * Filter byte 0 (None) on every scanline — larger than an optimal encoder would
 * produce, and irrelevant for fixtures.
 */
export function gradientPng(width: number, height: number, top: Rgb, bottom: Rgb): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: None
    const t = height === 1 ? 0 : y / (height - 1);
    const r = Math.round(top.r + (bottom.r - top.r) * t);
    const g = Math.round(top.g + (bottom.g - top.g) * t);
    const b = Math.round(top.b + (bottom.b - top.b) * t);
    for (let x = 0; x < width; x++) {
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ blurhash */

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function base83(value: number, length: number): string {
  let out = '';
  for (let i = 1; i <= length; i++) {
    const digit = Math.floor(value / 83 ** (length - i)) % 83;
    out += B83[digit];
  }
  return out;
}

const sRgbToLinear = (v: number): number => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

const linearToSRgb = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return Math.round(
    (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255 + 0.5,
  );
};

/**
 * A valid 1x1-component BlurHash: size flag, max-AC, and the DC term.
 *
 * One component encodes the average colour and nothing else, which is exactly
 * what a flat gradient placeholder needs. Six characters, and decoders treat it
 * like any other hash — so the client's placeholder path is genuinely exercised
 * rather than stubbed.
 */
export function blurHashFlat(avg: Rgb): string {
  const linear = {
    r: sRgbToLinear(avg.r),
    g: sRgbToLinear(avg.g),
    b: sRgbToLinear(avg.b),
  };
  const dc =
    (linearToSRgb(linear.r) << 16) + (linearToSRgb(linear.g) << 8) + linearToSRgb(linear.b);

  // components 1x1 -> (1-1)*9 + (1-1) = 0 ; no AC terms -> quantised max 0
  return base83(0, 1) + base83(0, 1) + base83(dc, 4);
}

export const averageOf = (a: Rgb, b: Rgb): Rgb => ({
  r: Math.round((a.r + b.r) / 2),
  g: Math.round((a.g + b.g) / 2),
  b: Math.round((a.b + b.b) / 2),
});
