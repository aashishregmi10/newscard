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

/* ────────────────────────────────────────────────────────────────────────────
 * Who gets the slot.
 *
 * Everything above decides WHERE an ad may go. Everything below decides WHICH
 * campaign fills it, and it is the part an advertiser is paying for.
 *
 * ── "Paid more, shown more" under time pricing ──────────────────────────────
 *
 * Advertising is sold by time: "Rs 5,000 for one week". So what "paid more"
 * has to mean is more money PER DAY. Weighting on the raw price would treat
 * Rs 10,000 for a week (Rs 1,429 a day) and Rs 10,000 for a month (Rs 333 a
 * day) as the same purchase, and let the month-long buyer take slots the
 * week-long one paid four times as much for.
 *
 *   weight(c)          = price(c) ÷ days booked(c)
 *   P(slot goes to c)  = weight(c) ÷ Σ weight(eligible campaigns)
 *   share of voice     = that probability
 *
 * Three campaigns at Rs 20,000/week, Rs 10,000/week and Rs 10,000/month get
 * 62%, 31% and 7%. The editorial site shows these numbers before a campaign is
 * saved, and serving draws from them, and both call the same functions here —
 * so what a client is promised and what they are served cannot drift apart.
 *
 * ── How a page is filled, per placement ──────────────────────────────────────
 *
 * Full-card: two or so slots a page, never the same campaign twice — a
 * weighted draw without replacement (pickDistinctWeighted).
 *
 * Small ad: one on every story, so twenty slots a page and repeats are
 * certain. Independent random draws would clump — the same hotel four stories
 * running, by chance — and the obvious patch, "never the same advertiser twice
 * in a row", is wrong: with two advertisers it forces strict alternation, and
 * a Rs 10,000/week client gets exactly as much as a Rs 5,000/week one. So the
 * small ad uses a smooth weighted interleave (interleaveWeighted): every page
 * delivers the shares above to within one slot, repeats are spread as evenly
 * as the shares allow, and a random starting phase keeps the heaviest
 * campaign from always taking the first story.
 *
 * Neither needs state shared between server processes — which strict
 * turn-taking across requests would.
 *
 * ── House ads ────────────────────────────────────────────────────────────────
 *
 * A campaign priced at 0 is ours — "Advertise with SAAR". It never competes
 * with a paying customer: it is drawn only when no paid campaign is eligible
 * for the slot, so empty inventory is not wasted and a client is never
 * displaced by an ad that paid nothing.
 * ──────────────────────────────────────────────────────────────────────────── */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days a campaign runs, rounding a part-day up. Never less than one, so
 *  a same-day booking has a finite weight rather than an infinite one. */
export function flightDays(startsAt: Date, endsAt: Date): number {
  const span = endsAt.getTime() - startsAt.getTime();
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.max(1, Math.ceil(span / DAY_MS));
}

export interface PricedCampaign {
  pricePaisa: number;
  startsAt: Date;
  endsAt: Date;
}

/** Price per day, in paisa. The weight a campaign is drawn with. */
export function campaignWeight(c: PricedCampaign): number {
  const price = Number.isFinite(c.pricePaisa) && c.pricePaisa > 0 ? c.pricePaisa : 0;
  return price / flightDays(c.startsAt, c.endsAt);
}

export interface Weighted<T> {
  item: T;
  weight: number;
}

/**
 * The campaigns a slot is actually drawn from, with their weights.
 *
 * Paying campaigns if there are any, weighted by price per day. Otherwise the
 * house ads, with equal turns — they all paid nothing, so none has a claim
 * over another.
 */
export function servingPool<T extends PricedCampaign>(eligible: readonly T[]): Array<Weighted<T>> {
  const paid = eligible
    .map((item) => ({ item, weight: campaignWeight(item) }))
    .filter((x) => x.weight > 0);
  if (paid.length > 0) return paid;
  return eligible.map((item) => ({ item, weight: 1 }));
}

/** Each entry's share of the draws, summing to 1 — or all 0 for an empty pool. */
export function shareOfVoice<T>(pool: ReadonlyArray<Weighted<T>>): number[] {
  const total = pool.reduce((sum, x) => sum + Math.max(0, x.weight), 0);
  return pool.map((x) => (total > 0 ? Math.max(0, x.weight) / total : 0));
}

/** A random number in [0, 1). Injected so the tests can be deterministic. */
export type Rng = () => number;

/**
 * `count` picks, in proportion to weight and spread out: a smooth weighted
 * interleave (the scheme nginx uses to balance weighted servers).
 *
 * Every step, each entry banks its weight; the entry with the most banked
 * wins the slot and pays back the total. Over any run of n picks each entry
 * gets n × its share, to within one — so a page of twenty small ads delivers
 * the shares of voice exactly, not merely on average — and an entry’s picks
 * are spaced as evenly as its share allows. Nothing is carried between
 * requests; the random starting balances are only there so the heaviest
 * entry does not take the first slot of every page.
 */
export function interleaveWeighted<T>(
  pool: ReadonlyArray<Weighted<T>>,
  count: number,
  rng: Rng = Math.random,
): T[] {
  const live = pool.filter((x) => x.weight > 0);
  if (count <= 0 || live.length === 0) return [];
  const total = live.reduce((sum, x) => sum + x.weight, 0);
  const banked = live.map(() => rng() * total);
  const out: T[] = [];
  for (let n = 0; n < count; n++) {
    let best = 0;
    for (let i = 0; i < live.length; i++) {
      banked[i]! += live[i]!.weight;
      if (banked[i]! > banked[best]!) best = i;
    }
    banked[best]! -= total;
    out.push(live[best]!.item);
  }
  return out;
}

/**
 * Up to `count` DIFFERENT entries, each draw proportional to weight.
 *
 * For the full-card ad, where one page never shows the same campaign twice:
 * two identical posters on one screen read as a bug and annoy the advertiser
 * as much as the reader. Efraimidis–Spirakis keys — one random draw per
 * entry, raised to 1/weight, highest first — which is exact weighted sampling
 * without replacement in a single pass.
 */
export function pickDistinctWeighted<T>(
  pool: ReadonlyArray<Weighted<T>>,
  count: number,
  rng: Rng = Math.random,
): T[] {
  if (count <= 0) return [];
  return pool
    .filter((x) => x.weight > 0)
    .map((x) => ({ item: x.item, key: rng() ** (1 / x.weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.item);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The small ad's density.
 *
 * It sits ON a story, in the row with save and share, rather than taking a
 * card of its own, so the full-card spacing rules above do not describe it.
 * The newsroom chose every story; that is the default here, and it is a
 * setting rather than a constant so it can be turned down without an app
 * release if readers say it is too much.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface InlineAdConfig {
  /** A small ad on every Nth story. 1 is every story. */
  everyNCards: number;
  /** The first story, counting from 1, that may carry one. */
  firstAdAfter: number;
  /** Per device per day. Null is no cap. */
  maxPerDay: number | null;
}

export const DEFAULT_INLINE_ADS: InlineAdConfig = {
  everyNCards: 1,
  firstAdAfter: 1,
  maxPerDay: null,
};

export function clampInline(cfg: Partial<InlineAdConfig> | undefined): InlineAdConfig {
  const c = { ...DEFAULT_INLINE_ADS, ...(cfg ?? {}) };
  return {
    everyNCards: Math.max(1, Math.floor(c.everyNCards)),
    firstAdAfter: Math.max(1, Math.floor(c.firstAdAfter)),
    maxPerDay: c.maxPerDay === null ? null : Math.max(0, Math.floor(c.maxPerDay)),
  };
}

/**
 * Which stories in a page carry a small ad, as indices into the page.
 *
 * By absolute position, like adSlotsForPage, so the pattern does not restart
 * at every page boundary.
 */
export function inlineSlotsForPage(
  contentCount: number,
  pageOffset: number,
  cfg: Partial<InlineAdConfig> | undefined,
  shownToday: number,
): number[] {
  const { everyNCards, firstAdAfter, maxPerDay } = clampInline(cfg);
  const remaining = maxPerDay === null ? Infinity : maxPerDay - shownToday;
  if (remaining <= 0 || contentCount <= 0) return [];

  const slots: number[] = [];
  for (let i = 0; i < contentCount; i++) {
    const absolute = pageOffset + i + 1;
    if (absolute < firstAdAfter) continue;
    if ((absolute - firstAdAfter) % everyNCards !== 0) continue;
    slots.push(i);
    if (slots.length >= remaining) break;
  }
  return slots;
}
