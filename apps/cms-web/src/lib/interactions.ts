/**
 * The rules an Interaction must meet — the editorial site's copy.
 *
 * The rules themselves live in packages/shared/src/interactions.ts, and it is
 * the server's copy that refuses to save. This one exists so an editor sees
 * each problem on its field while typing rather than after pressing Save; the
 * editorial site is built apart from the server packages, so it is restated
 * here (as overlap.ts restates the own-words rule). The two must agree:
 * src/__tests__/interactions.test.ts holds them to the same cases.
 */

export type InteractionType = 'rating' | 'vote';

export const INTERACTION_LIMITS = {
  title: { min: 5, max: 120 },
  name: { min: 2, max: 60 },
  detail: { max: 60 },
  credit: { min: 2, max: 120 },
  /**
   * How many businesses or candidates. A vote is a 2×2 grid, so four at most.
   * A rating is a list of rows, and six is what fits on one card at the
   * reader's normal text size without the card having to scroll inside a feed
   * that scrolls.
   */
  options: { rating: { min: 2, max: 6 }, vote: { min: 2, max: 4 } },
} as const;

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
  const noun = v.type === 'vote' ? 'candidate' : 'business';

  const title = v.title.trim();
  if (title.length < L.title.min) {
    out.push({
      field: 'title',
      message:
        title.length === 0
          ? v.type === 'vote'
            ? 'Write the question readers are voting on.'
            : 'Write a title, such as "Best coffee in Kathmandu".'
          : `At least ${L.title.min} characters.`,
    });
  } else if (title.length > L.title.max) {
    out.push({ field: 'title', message: `At most ${L.title.max} characters (now ${title.length}).` });
  }

  const range = L.options[v.type];
  if (v.options.length < range.min) {
    out.push({ field: 'options', message: `Add at least ${range.min} ${noun === 'business' ? 'businesses' : 'candidates'}.` });
  } else if (v.options.length > range.max) {
    out.push({
      field: 'options',
      message: `At most ${range.max} ${noun === 'business' ? 'businesses' : 'candidates'}${v.type === 'vote' ? ' — the card is a 2×2 grid' : ''}.`,
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
      if (v.type === 'vote') {
        out.push({ field: `options.${i}.image`, message: 'Every candidate needs a photo.' });
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
