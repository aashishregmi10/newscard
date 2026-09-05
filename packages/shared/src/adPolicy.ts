/**
 * Advertising density policy.
 *
 * ── The problem this exists to solve ────────────────────────────────────────
 * Too many ads and readers leave; too few and the product does not pay for
 * itself. Both failures are real, and the second one is invisible until it is
 * fatal, which is why teams drift toward the first.
 *
 * The competitor research behind this product is unusually clear on where the
 * line is. The single loudest complaint about the reference app was ad density:
 * "every second article is an ad". That is roughly 1 in 2. Reviews describing
 * the app as usable put it nearer 1 in 8 to 1 in 12.
 *
 * So the density is a POLICY, enforced server-side like the notification cap,
 * not a knob an ad server is free to turn. It is expressed here as pure,
 * testable functions with a hard ceiling that configuration cannot exceed.
 *
 * The economics for Nepal make restraint cheap: at these audience sizes the
 * difference between 1-in-10 and 1-in-5 is a rounding error in revenue and a
 * measurable difference in retention. Density is not where the money is —
 * direct-sold sponsorship rates are.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Absolute floor on spacing. Configuration may be more conservative, never
 *  less. An ad every 4 cards is already past what readers tolerate. */
export const MIN_CARDS_BETWEEN_ADS = 6;

/** Cards a reader sees before the first ad of a session.
 *  The opening of the feed is the product's first impression; selling it is
 *  the cheapest possible way to lose someone on day one. */
export const MIN_CARDS_BEFORE_FIRST_AD = 4;

/** Ceiling on how often an ad may appear, whatever config says. */
export const MAX_AD_RATIO = 1 / MIN_CARDS_BETWEEN_ADS;

export interface AdDensityConfig {
  /** Serve at most one ad per this many cards. Clamped to >= MIN_CARDS_BETWEEN_ADS. */
  everyNCards: number;
  /** Cards before the first ad. Clamped to >= MIN_CARDS_BEFORE_FIRST_AD. */
  firstAdAfter: number;
  /** Per device per day. Zero disables advertising entirely. */
  maxAdsPerDay: number;
}

export const DEFAULT_AD_DENSITY: AdDensityConfig = {
  everyNCards: 10,
  firstAdAfter: 4,
  maxAdsPerDay: 12,
};

/** Apply the hard limits. Config is advisory; these bounds are not. */
export function clampDensity(cfg: Partial<AdDensityConfig> | undefined): AdDensityConfig {
  const c = { ...DEFAULT_AD_DENSITY, ...(cfg ?? {}) };
  return {
    everyNCards: Math.max(MIN_CARDS_BETWEEN_ADS, Math.floor(c.everyNCards)),
    firstAdAfter: Math.max(MIN_CARDS_BEFORE_FIRST_AD, Math.floor(c.firstAdAfter)),
    maxAdsPerDay: Math.max(0, Math.floor(c.maxAdsPerDay)),
  };
}

/**
 * Which slots in a page should hold an ad.
 *
 * `pageOffset` is how many content cards the reader has already passed, so
 * placement is a function of ABSOLUTE position rather than page boundaries.
 * Without that, an ad lands at the same spot on every page and the reader sees
 * a metronome; worse, changing the page size would silently change the density.
 *
 * Returns indices into the content array, meaning "insert an ad AFTER this many
 * content cards".
 */
export function adSlotsForPage(
  contentCount: number,
  pageOffset: number,
  cfg: AdDensityConfig,
  adsAlreadyShownToday: number,
): number[] {
  const { everyNCards, firstAdAfter, maxAdsPerDay } = clampDensity(cfg);

  const remaining = maxAdsPerDay - adsAlreadyShownToday;
  if (remaining <= 0 || contentCount === 0) return [];

  const slots: number[] = [];

  for (let i = 0; i < contentCount; i++) {
    const absolute = pageOffset + i + 1; // 1-based count of cards passed
    if (absolute < firstAdAfter) continue;

    // The first ad sits at `firstAdAfter`, then every `everyNCards` after it.
    if ((absolute - firstAdAfter) % everyNCards !== 0) continue;

    slots.push(i);
    if (slots.length >= remaining) break;
  }

  return slots;
}

/** Actual ratio of ads to cards, for reporting and for tests to assert against. */
export function adRatio(adCount: number, contentCount: number): number {
  const total = adCount + contentCount;
  return total === 0 ? 0 : adCount / total;
}

/**
 * Is this placement acceptable? Used by tests and by the integration suite to
 * assert the invariant directly rather than trusting the generator.
 */
export function violatesAdPolicy(
  slots: readonly number[],
  contentCount: number,
  pageOffset: number,
  cfg: AdDensityConfig,
): string | null {
  const { everyNCards, firstAdAfter } = clampDensity(cfg);

  for (let i = 1; i < slots.length; i++) {
    const gap = slots[i]! - slots[i - 1]!;
    if (gap < everyNCards) {
      return `ads ${gap} cards apart (minimum ${everyNCards})`;
    }
  }

  const first = slots[0];
  if (first !== undefined && pageOffset + first + 1 < firstAdAfter) {
    return `first ad after only ${pageOffset + first + 1} cards (minimum ${firstAdAfter})`;
  }

  // NOTE: deliberately no ratio check here.
  //
  // Spacing is the invariant that governs the reading experience; the ratio is
  // a statistic derived from it. Over a short window the ratio spikes even when
  // spacing is perfect — 2 ads inside an 8-card page is 0.20 while every gap is
  // still a correct 6. Asserting a hard ratio per page would fail correct
  // placements and push someone to "fix" the spacing, which is the thing that
  // actually matters. The asymptotic ratio is asserted over a long run in the
  // tests instead.

  return null;
}
