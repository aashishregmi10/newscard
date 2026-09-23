import type { BadgeTone, IconName } from '../ui';
import { humanise } from './format';

/**
 * How a lifecycle state looks.
 *
 * The mapping lives here rather than in the queue, because the same states are
 * drawn in three places — the queue row, the composer header and the shorts
 * list — and three copies is three chances for "approved" to be green in one of
 * them and amber in another.
 *
 * Each state carries a word, an icon and a tone. The word is what it means, the
 * icon is what it means to someone who cannot separate the tones, and the tone
 * is what makes a column of them scannable at arm's length.
 */

export interface StatusLook {
  label: string;
  tone: BadgeTone;
  icon: IconName;
  /** Colours the lead glyph on a list row. */
  leadClass: string;
}

const ARTICLE_STATUS: Readonly<Record<string, StatusLook>> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'pencil', leadClass: 'item-lead-draft' },
  in_review: { label: 'In review', tone: 'warn', icon: 'clock', leadClass: 'item-lead-review' },
  approved: { label: 'Approved', tone: 'ok', icon: 'checkCircle', leadClass: 'item-lead-ok' },
  published: { label: 'Published', tone: 'ok', icon: 'send', leadClass: 'item-lead-ok' },
  spiked: { label: 'Spiked', tone: 'bad', icon: 'ban', leadClass: 'item-lead-bad' },
};

const SHORT_STATUS: Readonly<Record<string, StatusLook>> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'pencil', leadClass: 'item-lead-draft' },
  published: { label: 'Published', tone: 'ok', icon: 'send', leadClass: 'item-lead-ok' },
  retracted: { label: 'Withdrawn', tone: 'bad', icon: 'ban', leadClass: 'item-lead-bad' },
};

/**
 * A state this build has never heard of.
 *
 * It happens during a rollout: the server gains a state and browsers keep the
 * previous bundle for as long as their tab stays open. Rendering the raw token
 * readably is the difference between a row that looks unfamiliar and a row that
 * looks empty — and an editor will act on an unfamiliar row by asking, which is
 * the correct outcome.
 */
function unknownStatus(status: string): StatusLook {
  return {
    label: humanise(status),
    tone: 'neutral',
    icon: 'info',
    leadClass: 'item-lead-draft',
  };
}

export function articleStatus(status: string): StatusLook {
  return ARTICLE_STATUS[status] ?? unknownStatus(status);
}

export function shortStatus(status: string): StatusLook {
  return SHORT_STATUS[status] ?? unknownStatus(status);
}
