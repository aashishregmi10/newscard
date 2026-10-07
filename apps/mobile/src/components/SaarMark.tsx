import { memo } from 'react';
import { Image, StyleSheet } from 'react-native';

/**
 * SAAR's logo, from the founders' artwork of 7 Oct 2026.
 *
 * The images are made by scripts/gen-brand.mjs from brand/saar-logo-source.jpg
 * — transparent, and the full logo in two versions, because its wordmark is
 * dark navy and would vanish on the dark theme. To change the logo, replace
 * the source and run the script; nothing here changes.
 */

const MARK = require('../../assets/brand/saar-mark.png') as number;
const LOGO = require('../../assets/brand/saar-logo.png') as number;
const LOGO_ON_DARK = require('../../assets/brand/saar-logo-dark.png') as number;

/** Width over height of the mark, and of the full logo, as the images are cut. */
const MARK_RATIO = 195 / 192;
const LOGO_RATIO = 506 / 540;

/**
 * The mark alone, on every story card beside the publisher's name. It is a
 * logo, so it does not grow with the reader's text size: the name beside it is
 * what must stay readable.
 */
function SaarMarkInner({ size = 18 }: { size?: number }) {
  return (
    <Image
      source={MARK}
      style={[styles.mark, { width: Math.round(size * MARK_RATIO), height: size }]}
      resizeMode="contain"
      accessible
      accessibilityLabel="SAAR"
    />
  );
}

export const SaarMark = memo(SaarMarkInner);

/** The mark, the wordmark and "SUMMARY · SHORT · SMART", for the theme. */
function SaarLogoInner({ height, onDark }: { height: number; onDark: boolean }) {
  return (
    <Image
      source={onDark ? LOGO_ON_DARK : LOGO}
      style={{ width: Math.round(height * LOGO_RATIO), height }}
      resizeMode="contain"
      accessible
      accessibilityLabel="SAAR — Summary · Short · Smart"
    />
  );
}

export const SaarLogo = memo(SaarLogoInner);

const styles = StyleSheet.create({
  mark: { flexShrink: 0 },
});
