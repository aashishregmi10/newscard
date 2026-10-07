/**
 * Every logo file the app and the editorial site use, from one source image.
 *
 *   node scripts/gen-brand.mjs
 *
 * The source is brand/saar-logo-source.jpg: SAAR's logo as the founders sent
 * it on 7 Oct 2026 — the mark (a rounded play-shape of text lines with a green
 * arrow), the wordmark and "SUMMARY · SHORT · SMART", on an off-white ground.
 * When a better original arrives (a transparent PNG or an SVG), replace that
 * file and run this again; nothing else needs to change.
 *
 * ── From a JPEG on white to logos on anything ───────────────────────────────
 *
 * The ground is removed: pixels close to its colour become transparent —
 * except the white lines INSIDE the mark, which are boxed in by it on every
 * side and stay white, as the logo draws them. Pixels on the
 * edge of the shapes are partly the ground (anti-aliasing): their opacity is
 * taken from how far they are from it and their colour un-mixed from it, so a
 * logo on a dark screen has no pale fringe.
 *
 * The wordmark is dark navy, unreadable on the dark theme, so a "-dark"
 * variant sets it and the tagline in near-white; the mark keeps its colours.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'brand', 'saar-logo-source.jpg');
const MOBILE = join(ROOT, 'apps', 'mobile', 'assets');
const WEB = join(ROOT, 'apps', 'cms-web', 'public', 'brand');

/** How close to the ground a pixel must be to count as ground (0–255, per channel). */
const GROUND_TOLERANCE = 18;
/** How far around an edge pixel to look for the solid colour it is a blend of. */
const EDGE_REACH = 3;
/** Where the mark ends and the wordmark begins, in the source's rows. */
const WORDMARK_FROM = 795;
const LIGHT_TEXT = [242, 242, 242];

const { data: rgb, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;

/* The ground's colour: the median of the border. */
const border = [];
for (let x = 0; x < W; x++) border.push(x, x + (H - 1) * W);
for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
const ground = [0, 1, 2].map((c) => {
  const v = border.map((i) => rgb[i * 3 + c]).sort((a, b) => a - b);
  return v[v.length >> 1];
});
const nearGround = (i) =>
  Math.max(...[0, 1, 2].map((c) => Math.abs(rgb[i * 3 + c] - ground[c]))) <= GROUND_TOLERANCE;

/*
 * Ground-coloured pixels are the ground — the letters' counters included —
 * except the mark's white lines. They are ground-coloured too, but they lie
 * inside the blue shape, and the shape is convex (a rounded triangle, its point
 * cut off where the green arrow begins): so the lines are the ground-coloured
 * pixels inside the convex hull of the blue ones. The gaps either side of the
 * arrow are outside it and stay clear. (A flood fill from the edges runs into
 * two of the lines through those gaps; tests on a line's width or on what
 * surrounds it break up on the JPEG's noise.)
 */
const isBlue = (i) => {
  const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
  return b > r + 30 && b >= g && b < 235;
};
/* Two points a row — the blue's leftmost and rightmost — are enough for the hull. */
const points = [];
for (let y = 0; y < WORDMARK_FROM; y++) {
  let first = -1;
  let last = -1;
  for (let x = 0; x < W; x++) {
    if (isBlue(y * W + x)) {
      if (first < 0) first = x;
      last = x;
    }
  }
  if (first >= 0) points.push([first, y], [last, y]);
}
/* Andrew's monotone chain. */
points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
const lower = [];
for (const pt of points) {
  while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
  lower.push(pt);
}
const upper = [];
for (const pt of [...points].reverse()) {
  while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
  upper.push(pt);
}
const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
/** Inside the hull, and at least `margin` pixels in from every side. */
function inHull(x, y, margin) {
  for (let k = 0; k < hull.length; k++) {
    const p = hull[k];
    const q = hull[(k + 1) % hull.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    if (cross(p, q, [x, y]) / len < margin) return false;
  }
  return true;
}
const outside = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (!nearGround(i)) continue;
  const x = i % W;
  const y = (i - x) / W;
  outside[i] = y < WORDMARK_FROM && inHull(x, y, 2) ? 0 : 1;
}

/** How much darker than the ground a pixel is, in its darkest channel. */
const darkness = (i) => Math.max(...[0, 1, 2].map((k) => ground[k] - rgb[i * 3 + k]));

/*
 * Opacity and un-mixed colour. Inside pixels away from the ground are solid.
 * An edge pixel is a blend of the ground and the solid colour beside it: its
 * opacity is its darkness over that colour's (the darkest pixel within
 * EDGE_REACH), so a blue edge un-mixes to blue, not to a pale outline.
 */
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  if (outside[i]) continue; // fully transparent
  const x = i % W;
  const y = (i - x) / W;
  let edge = false;
  for (let dy = -2; dy <= 2 && !edge; dy++) {
    for (let dx = -2; dx <= 2 && !edge; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && outside[yy * W + xx]) edge = true;
    }
  }
  const c = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
  let a = 1;
  if (edge) {
    let solidDark = 0;
    for (let dy = -EDGE_REACH; dy <= EDGE_REACH; dy++) {
      for (let dx = -EDGE_REACH; dx <= EDGE_REACH; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) solidDark = Math.max(solidDark, darkness(yy * W + xx));
      }
    }
    a = solidDark > 0 ? Math.min(1, Math.max(0, darkness(i) / solidDark)) : 0;
  }
  if (a <= 0.02) continue;
  for (let k = 0; k < 3; k++) {
    rgba[o + k] = Math.round(Math.min(255, Math.max(0, (c[k] - (1 - a) * ground[k]) / a)));
  }
  rgba[o + 3] = Math.round(a * 255);
}

const full = () => sharp(rgba, { raw: { width: W, height: H, channels: 4 } });

/** The bounding box of what is not transparent, between two rows. */
function bbox(fromRow, toRow) {
  let x0 = W;
  let x1 = 0;
  let y0 = H;
  let y1 = 0;
  for (let y = fromRow; y < toRow; y++) {
    for (let x = 0; x < W; x++) {
      if (rgba[(y * W + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const markBox = bbox(0, WORDMARK_FROM);
const logoBox = bbox(0, H);

/** The same pixels with the wordmark and tagline set in near-white. */
const darkRgba = Buffer.from(rgba);
for (let y = WORDMARK_FROM; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (darkRgba[o + 3] > 0) [darkRgba[o], darkRgba[o + 1], darkRgba[o + 2]] = LIGHT_TEXT;
  }
}
const fullDark = () => sharp(darkRgba, { raw: { width: W, height: H, channels: 4 } });

/** The mark, as a monochrome silhouette: Android's themed icon reads only the shape.
 *  The white lines inside are cut out, so the silhouette still shows them. */
const monoRgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const a = rgba[i * 4 + 3];
  const light = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) > 225;
  if (a > 0 && !light) {
    monoRgba[i * 4] = 255;
    monoRgba[i * 4 + 1] = 255;
    monoRgba[i * 4 + 2] = 255;
    monoRgba[i * 4 + 3] = a;
  }
}
const mono = () => sharp(monoRgba, { raw: { width: W, height: H, channels: 4 } });

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** A crop, fitted inside a box of `inner` pixels and centred on a square canvas. */
async function onSquare(source, box, size, inner, background, out) {
  const piece = await source()
    .extract(box)
    .resize({ width: inner, height: inner, fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  mkdirSync(dirname(out), { recursive: true });
  let img = sharp({ create: { width: size, height: size, channels: 4, background } }).composite([
    { input: piece, gravity: 'center' },
  ]);
  if (background.alpha === 1) img = img.flatten({ background: '#ffffff' });
  await img.png().toFile(out);
  console.log(`  ${out.slice(ROOT.length + 1)}  ${size}×${size}`);
}

/** A crop, trimmed to itself, scaled to a height. */
async function trimmed(source, box, height, out) {
  mkdirSync(dirname(out), { recursive: true });
  /* Palette PNGs: a quarter of the size, and the gradients hold at these sizes. */
  await source().extract(box).resize({ height }).png({ palette: true, quality: 92, effort: 10 }).toFile(out);
  const m = await sharp(out).metadata();
  console.log(`  ${out.slice(ROOT.length + 1)}  ${m.width}×${m.height}`);
}

console.log(`source ${W}×${H}, ground rgb(${ground.join(', ')})`);

/* ── the app ── */
await trimmed(full, markBox, 192, join(MOBILE, 'brand', 'saar-mark.png'));
await trimmed(full, logoBox, 540, join(MOBILE, 'brand', 'saar-logo.png'));
await trimmed(fullDark, logoBox, 540, join(MOBILE, 'brand', 'saar-logo-dark.png'));
/* The store and launcher icon: the mark on white, with room around it. */
await onSquare(full, markBox, 1024, 660, WHITE, join(MOBILE, 'icon.png'));
/* Android's adaptive icon: the mark inside the safe zone (the middle 66%,
 * which a launcher may mask to a circle), on a white layer of its own. */
await onSquare(full, markBox, 1024, 520, TRANSPARENT, join(MOBILE, 'android-icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
  .png()
  .toFile(join(MOBILE, 'android-icon-background.png'));
console.log('  apps/mobile/assets/android-icon-background.png  1024×1024');
await onSquare(mono, markBox, 1024, 520, TRANSPARENT, join(MOBILE, 'android-icon-monochrome.png'));
await onSquare(full, markBox, 1024, 900, TRANSPARENT, join(MOBILE, 'splash-icon.png'));
await onSquare(full, markBox, 48, 44, TRANSPARENT, join(MOBILE, 'favicon.png'));

/* ── the editorial site and the public site ── */
await trimmed(full, markBox, 256, join(WEB, 'saar-mark.png'));
await trimmed(full, logoBox, 480, join(WEB, 'saar-logo.png'));
await trimmed(fullDark, logoBox, 480, join(WEB, 'saar-logo-dark.png'));
await onSquare(full, markBox, 64, 58, TRANSPARENT, join(WEB, 'favicon.png'));
await onSquare(full, markBox, 180, 132, WHITE, join(WEB, 'apple-touch-icon.png'));

/*
 * Google's "G", for the Sign in with Google button. Google's own mark, not
 * SAAR's: its branding guidelines ask the button to carry it, in its colours,
 * unaltered. Drawn from the SVG Google's own sign-in button uses, and made
 * here only so every image the app ships comes from this one script.
 */
const GOOGLE_G = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;
await sharp(Buffer.from(GOOGLE_G), { density: 600 }).resize(96, 96).png().toFile(join(MOBILE, 'brand', 'google-g.png'));
console.log('  apps/mobile/assets/brand/google-g.png  96×96');
