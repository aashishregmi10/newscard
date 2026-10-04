import sharp from 'sharp';
import { flatBlurHash } from '@saar/media';
import { countGraphemes, graphemes } from '@saar/shared';
import { summarise } from '@saar/summarise';
import { politeGet } from '@saar/worker';

/**
 * Turning a YouTube Short into a short draft.
 *
 * Everything here prepares a STARTING POINT the editor changes: their title,
 * cleaned of channel boilerplate and cut to our 80; a caption drafted in our
 * words when the licence lets their text go to the summariser; and the
 * poster's placeholder colour. Nothing is downloaded but the thumbnail's
 * average colour — the video stays on YouTube.
 */

/** A short's title is shorter than a headline: it sits over the picture. */
export const SHORT_TITLE_MAX = 80;
const CAPTION_MAX = 400;
/** The editor is waiting on Promote; past this the caption is theirs to write. */
const CAPTION_BUDGET_MS = 8_000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Their title, as a starting point.
 *
 * Channels append their own name and hashtags to every upload —
 * "आज कहाँ पर्छ पानी ? || Nepal Times #shorts". Our card already credits them,
 * so the suffix goes, and the result is cut at a word to fit.
 */
export function cleanYouTubeTitle(title: string, channelTitle: string): string {
  let t = title.replace(/#[\p{L}\p{M}\p{N}_]+/gu, ' ');
  if (channelTitle.trim() !== '') {
    const name = escapeRegExp(channelTitle.trim());
    t = t.replace(new RegExp(`\\s*(\\|\\||\\||-|–|—|:)\\s*${name}\\s*$`, 'iu'), '');
  }
  t = t.replace(/\s*(\|\||\|)\s*$/u, '').replace(/\s+/g, ' ').trim();
  if (countGraphemes(t) <= SHORT_TITLE_MAX) return t;

  const g = graphemes(t).slice(0, SHORT_TITLE_MAX - 1).join('');
  const cut = g.lastIndexOf(' ');
  return `${(cut > SHORT_TITLE_MAX / 2 ? g.slice(0, cut) : g).trim()}…`;
}

/** Links, hashtags and "subscribe" lines are not the story. */
export function descriptionForCaption(description: string): string {
  return description
    .split('\n')
    .filter((line) => !/subscribe|follow us|facebook|instagram|tiktok|twitter|x\.com|youtube\.com/i.test(line))
    .join(' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\p{L}\p{M}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A caption in our words, or empty with the reason.
 *
 * Only when their licence says `fullText`, as for an article — their
 * description is their words. Without the AI there is no caption: their own
 * sentences would be their caption, not ours, and a short reaches readers
 * without the summary check an article has. The editor writes it.
 */
export async function draftCaption(input: {
  description: string;
  title: string;
  language: 'ne' | 'en';
  mayUseText: boolean;
}): Promise<{ caption: string; note: string | null }> {
  if (!input.mayUseText) {
    return { caption: '', note: "Their licence does not cover using their text, so write the caption yourself." };
  }
  const text = descriptionForCaption(input.description);
  const source = text.length >= 40 ? text : `${input.title}. ${text}`.trim();

  const timeout = new Promise<null>((r) => setTimeout(() => r(null), CAPTION_BUDGET_MS));
  const result = await Promise.race([
    summarise({
      text: source,
      title: input.title,
      language: input.language,
      band: { limitType: 'graphemes', min: 1, max: CAPTION_MAX },
      kind: 'caption',
    }),
    timeout,
  ]);

  if (result === null) return { caption: '', note: 'The AI took too long to draft a caption. Write it yourself.' };
  if (result.source !== 'gemini') {
    return { caption: '', note: `No caption was drafted: ${result.note ?? 'the AI was unavailable.'}` };
  }
  const caption =
    countGraphemes(result.text) <= CAPTION_MAX
      ? result.text
      : `${graphemes(result.text).slice(0, CAPTION_MAX - 1).join('')}…`;
  return { caption, note: null };
}

/** The thumbnail's average colour, as the flat blurhash every poster carries. */
export async function posterBlurHash(thumbnailUrl: string): Promise<string | null> {
  try {
    const res = await politeGet(thumbnailUrl, { accept: 'image/*', maxBytes: 2 * 1024 * 1024 });
    const { data } = await sharp(Buffer.from(res.bytes))
      .resize(1, 1, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return flatBlurHash(data[0] ?? 128, data[1] ?? 128, data[2] ?? 128);
  } catch {
    return null;
  }
}
