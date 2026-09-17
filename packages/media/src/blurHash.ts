/**
 * The flat blurHash used as an image placeholder.  Spec Ch. 8.4.
 *
 * ── Why one component and not a real blurHash ───────────────────────────────
 *
 * A full blurHash encodes a 4×3 grid of DCT components and decodes to a
 * recognisable blur of the photograph. This encodes ONE: the average colour.
 *
 * That is deliberate. The placeholder exists to reserve the layout and give the
 * card a colour that belongs to the image, so nothing shifts when the photo
 * arrives. A reader looking at a 320px card for 200 milliseconds cannot tell a
 * blurred thumbnail from a flat tone, and the flat one costs six characters on
 * the wire instead of thirty and no decode on the device.
 *
 * It stays in the blurHash wire format so the decision is reversible: if a real
 * blur is ever wanted, the field and every consumer of it already work.
 */

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

export function encode83(value: number, length: number): string {
  let out = '';
  for (let i = 1; i <= length; i++) {
    out += B83[Math.floor(value / 83 ** (length - i)) % 83];
  }
  return out;
}

/** A 1×1-component hash: size flag 0, quantised max 0, then the packed DC term. */
export function flatBlurHash(r: number, g: number, b: number): string {
  return encode83(0, 1) + encode83(0, 1) + encode83((r << 16) + (g << 8) + b, 4);
}
