/**
 * Design tokens.  Spec Ch. 11.6 (type scale) and Ch. 11.7 (colour).
 *
 * Night mode is a genuine dark theme with recomputed tokens, not a colour
 * inversion — inversion turns news photographs into negatives.
 */

export const light = {
  textPrimary: '#1A1A1A',
  textSecondary: '#5B6670',
  surface: '#FFFFFF',
  surfaceRaised: '#F4F7FA',
  accent: '#1F4E79',
  divider: '#BFCDD9',
  strip: '#111417',
  stripText: '#F2F2F2',
} as const;

export const dark = {
  textPrimary: '#F2F2F2',
  textSecondary: '#A8B2BC',
  surface: '#121417',
  surfaceRaised: '#1C1F24',
  accent: '#6FA8DC',
  divider: '#2B3038',
  strip: '#000000',
  stripText: '#F2F2F2',
} as const;

/** Widened to `string` deliberately: `as const` above gives each palette its own
 *  literal types, so a Theme typed as `typeof light` would reject `dark`. */
export type Theme = { readonly [K in keyof typeof light]: string };

/**
 * Line height differs by script and this is the single most important
 * typographic value in the app.
 *
 * Devanagari has significant activity above and below the headline stroke —
 * vowel signs, conjuncts, the ि / ी marks. At Latin line spacing those marks
 * from one line visually collide with the next. 1.70 vs 1.55 is the difference
 * between Nepali text that looks professionally set and text that looks cramped.
 */
export const LINE_HEIGHT = { ne: 1.7, en: 1.55 } as const;

export const TYPE = {
  headline: { size: 20, weight: '600' as const, lineHeight: 1.3, maxLines: 3 },
  summary: { size: 16, weight: '400' as const },
  attribution: { size: 12, weight: '400' as const, lineHeight: 1.4 },
  chip: { size: 13, weight: '600' as const },
} as const;

/** Ch. 11.6.1 — multiplies with the OS font scale, capped at a combined 1.8. */
export const TEXT_SCALE = { small: 0.88, default: 1, large: 1.15, xlarge: 1.35 } as const;
export type TextSizeSetting = keyof typeof TEXT_SCALE;

/**
 * The bundled Devanagari face.
 *
 * ── Why this is shipped rather than left to the system ──────────────────────
 *
 * Android OEMs do not agree on Devanagari. Samsung, Xiaomi and stock Android
 * each supply a different face with different metrics, so the same card was
 * laid out differently on every handset: conjuncts of different widths, a
 * headline that fits on two lines here and wraps to three there, and vowel
 * marks sitting at different heights against the 1.70 line height this app
 * tunes. Latin varies far less, which is why only this one is bundled — 647 KB
 * is a real cost in a data-conscious app, and it buys consistency in the script
 * that actually differs.
 *
 * It is a variable font. Weight axes are honoured where the platform supports
 * them and fall back to the regular instance where they do not, which is still
 * a consistent shape on every device rather than an unknown one.
 */
export const FONT_DEVANAGARI = 'NotoSansDevanagari';

/**
 * The family for a given language, or undefined to mean "the system face".
 *
 * Returns undefined for English on purpose: the system sans is well matched to
 * each platform and shipping a Latin face too would add weight for a difference
 * almost nobody would see.
 */
export function fontFor(language: 'ne' | 'en'): string | undefined {
  return language === 'ne' ? FONT_DEVANAGARI : undefined;
}
