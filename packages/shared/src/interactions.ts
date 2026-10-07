/**
 * Interactions: a question whose few options readers rate with stars, or a
 * vote between a few candidates, shown to readers as a card in the feed.
 *
 * Pure rules shared by the editorial server, which enforces them, and the
 * editorial site, which restates the checks so an editor sees a problem on the
 * field rather than at Save (apps/cms-web/src/lib/interactions.ts; a test holds
 * the two to the same cases). No database, no clock it is not handed.
 */

export type InteractionType = 'rating' | 'vote';

export const INTERACTION_LIMITS = {
  title: { min: 5, max: 120 },
  name: { min: 2, max: 60 },
  detail: { max: 60 },
  credit: { min: 2, max: 120 },
  /**
   * How many options or candidates. A rating is a list of rows, each a name
   * over five stars, and a vote of names is a list too; six is what fits on one
   * card at the reader's normal text size without the card having to scroll
   * inside a feed that scrolls. A vote of photos is a 2×2 grid, so four
   * (`photoVote`).
   */
  options: { rating: { min: 2, max: 6 }, vote: { min: 2, max: 6 } },
  photoVote: { max: 4 },
} as const;

/**
 * How many options an Interaction may have. A vote is all photos or all
 * names: with photos it is a 2×2 grid, so four; as names, a list of six.
 */
export function optionRange(type: InteractionType, withPhotos: boolean): { min: number; max: number } {
  const r = INTERACTION_LIMITS.options[type];
  return type === 'vote' && withPhotos ? { min: r.min, max: INTERACTION_LIMITS.photoVote.max } : r;
}

export interface InteractionShape {
  type: InteractionType;
  title: string;
  options: ReadonlyArray<{
    name: string;
    detail: string | null;
    image: { credit: string } | null;
  }>;
  /** ISO dates, or null for "now" and "never". */
  opensAt: string | null;
  closesAt: string | null;
}

export interface InteractionProblem {
  /** 'title', 'options', 'options.2.name', 'options.0.image', 'closesAt'. */
  field: string;
  message: string;
}

/** Names compare as a reader would: case, spacing and Unicode form aside. */
function sameNameKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Every problem with an Interaction, in field order. Empty means it may be saved. */
export function interactionProblems(v: InteractionShape): InteractionProblem[] {
  const out: InteractionProblem[] = [];
  const L = INTERACTION_LIMITS;
  const noun = v.type === 'vote' ? 'candidate' : 'option';

  const title = v.title.trim();
  if (title.length < L.title.min) {
    out.push({
      field: 'title',
      message:
        title.length === 0
          ? v.type === 'vote'
            ? 'Write the question readers are voting on.'
            : 'Write the question readers are rating, such as "How was the service?"'
          : `At least ${L.title.min} characters.`,
    });
  } else if (title.length > L.title.max) {
    out.push({ field: 'title', message: `At most ${L.title.max} characters (now ${title.length}).` });
  }

  /* A vote with any photo is a vote of photos: every candidate needs one. */
  const photos = v.type === 'vote' && v.options.some((o) => o.image !== null);
  const range = optionRange(v.type, photos);
  if (v.options.length < range.min) {
    out.push({ field: 'options', message: `Add at least ${range.min} ${noun}s.` });
  } else if (v.options.length > range.max) {
    out.push({
      field: 'options',
      message: photos
        ? `At most ${range.max} candidates with photos — the card is a 2×2 grid. Without photos, up to ${L.options.vote.max}.`
        : `At most ${range.max} ${noun}s.`,
    });
  }

  const seen = new Map<string, number>();
  v.options.forEach((o, i) => {
    const name = o.name.trim();
    if (name.length < L.name.min) {
      out.push({
        field: `options.${i}.name`,
        message: name.length === 0 ? `Give this ${noun} a name.` : `At least ${L.name.min} characters.`,
      });
    } else if (name.length > L.name.max) {
      out.push({ field: `options.${i}.name`, message: `At most ${L.name.max} characters.` });
    } else {
      const key = sameNameKey(name);
      const first = seen.get(key);
      if (first !== undefined) {
        out.push({ field: `options.${i}.name`, message: `Same name as ${noun} ${first + 1}.` });
      } else {
        seen.set(key, i);
      }
    }

    if (o.detail !== null && o.detail.trim().length > L.detail.max) {
      out.push({ field: `options.${i}.detail`, message: `At most ${L.detail.max} characters.` });
    }

    if (o.image === null) {
      if (photos) {
        out.push({
          field: `options.${i}.image`,
          message: 'Give every candidate a photo, or none: a vote shows all photos or all names.',
        });
      }
    } else {
      const credit = o.image.credit.trim();
      if (credit.length < L.credit.min || credit.length > L.credit.max) {
        out.push({
          field: `options.${i}.image`,
          message: 'Say who took or owns this photo — the credit is printed with it.',
        });
      }
    }
  });

  const opens = v.opensAt === null ? null : Date.parse(v.opensAt);
  const closes = v.closesAt === null ? null : Date.parse(v.closesAt);
  if (opens !== null && Number.isNaN(opens)) out.push({ field: 'opensAt', message: 'Not a date.' });
  if (closes !== null && Number.isNaN(closes)) out.push({ field: 'closesAt', message: 'Not a date.' });
  if (v.type === 'vote' && v.closesAt === null) {
    out.push({ field: 'closesAt', message: 'A vote needs a closing date.' });
  }
  if (opens !== null && closes !== null && !Number.isNaN(opens) && !Number.isNaN(closes) && closes <= opens) {
    out.push({ field: 'closesAt', message: 'The closing date must be after the opening date.' });
  }

  return out;
}

/* ── where the cards go ────────────────────────────────────────────────────── */

export interface InteractionSpacing {
  /** Stories before the first Interaction. */
  firstAfter: number;
  /** Stories between one Interaction and the next. */
  every: number;
}

/**
 * After the 6th story, then every 12th. Not the 4th: the first full-card ad
 * sits there (DEFAULT_AD_DENSITY), and two cards that are not stories, one after
 * the other, is the opening of a feed that has stopped being news.
 */
export const DEFAULT_INTERACTION_SPACING: InteractionSpacing = { firstAfter: 6, every: 12 };

/**
 * Which content positions on this page are followed by an Interaction card.
 *
 * Like adSlotsForPage, a function of ABSOLUTE position (`pageOffset` is the
 * stories the reader has passed), so pages do not restart the count. Returns
 * indices into the page's stories: "insert after this one". A slot that lands
 * on a full-card ad's slot moves one story later, so the two are never side by
 * side — and if that pushes it off the end of the page, it is skipped rather
 * than squeezed in.
 */
export function interactionSlotsForPage(
  contentCount: number,
  pageOffset: number,
  adSlots: readonly number[],
  spacing: InteractionSpacing = DEFAULT_INTERACTION_SPACING,
): number[] {
  const first = Math.max(1, Math.floor(spacing.firstAfter));
  const every = Math.max(2, Math.floor(spacing.every));
  const ads = new Set(adSlots);
  const slots: number[] = [];
  for (let i = 0; i < contentCount; i++) {
    const absolute = pageOffset + i + 1;
    if (absolute < first || (absolute - first) % every !== 0) continue;
    const at = ads.has(i) ? i + 1 : i;
    if (at < contentCount && !ads.has(at)) slots.push(at);
  }
  return slots;
}

/**
 * Which Interaction a slot shows: the live ones in turn, by absolute slot
 * number, so a reader scrolling on sees the next one rather than the same one
 * again.
 */
export function interactionForSlot(slotAbsolute: number, liveCount: number, spacing = DEFAULT_INTERACTION_SPACING): number {
  if (liveCount <= 0) return -1;
  const n = Math.max(0, Math.floor((slotAbsolute - spacing.firstAfter) / spacing.every));
  return n % liveCount;
}

/* ── results ───────────────────────────────────────────────────────────────── */

/**
 * Whole percentages that add up to exactly 100 (largest remainder), so a
 * reader never sees 33 + 33 + 33. All zeros when nobody has voted.
 */
export function votePercentages(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c * 100) / total);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rest: r - Math.floor(r) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/** The average to one decimal place, or null before anyone has rated. */
export function averageStars(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}
