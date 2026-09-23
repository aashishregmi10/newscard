import { humanise } from './format';

/**
 * How a publisher reads on screen.
 *
 * -- Why this file imports nothing but a sibling ------------------------------
 *
 * Specifically NOT `import type { BadgeTone } from '../ui'`. `lib/status.ts`
 * does exactly that, and the consequence is that it cannot be unit-tested by
 * the repository's root runner — cms-web is deliberately not an npm workspace,
 * so the root runner cannot resolve React, and one type-only import of a
 * barrel that re-exports components is enough to pull it in.
 *
 * The tone and icon types are therefore written as literal unions. They are
 * structurally assignable to `BadgeTone` and `IconName`, so
 * `<Badge tone={look.tone} icon={look.icon}>` still typechecks at the call
 * site, and this file stays testable.
 */

export type LicenceTone = 'neutral' | 'ok' | 'warn' | 'bad';
export type LicenceIcon = 'checkCircle' | 'clock' | 'ban' | 'info';

export interface LicenceLook {
  label: string;
  tone: LicenceTone;
  icon: LicenceIcon;
  /** One sentence on what this status MEANS for the newsroom, not what it is. */
  blurb: string;
  /** Colours the lead glyph on a list row, matching the queue's convention. */
  leadClass: string;
}

const LICENCE: Readonly<Record<string, LicenceLook>> = {
  agreed: {
    label: 'Agreed',
    tone: 'ok',
    icon: 'checkCircle',
    blurb: 'Stories may be written and published against this publisher.',
    leadClass: 'item-lead-ok',
  },
  pending: {
    label: 'Pending',
    tone: 'warn',
    icon: 'clock',
    blurb: 'Talks are open. Nothing may be published against them yet.',
    leadClass: 'item-lead-review',
  },
  refused: {
    label: 'Refused',
    tone: 'bad',
    icon: 'ban',
    blurb: 'They declined. Nothing may be written or published against them.',
    leadClass: 'item-lead-bad',
  },
  unknown: {
    label: 'Not asked',
    tone: 'neutral',
    icon: 'info',
    blurb: 'Nobody has approached this publisher yet. Treat them as unlicensed.',
    leadClass: 'item-lead-draft',
  },
};

/**
 * A status this build has never heard of.
 *
 * Same rollout tolerance as `lib/status.ts`: the server can gain a value while
 * a browser keeps the previous bundle for as long as its tab stays open.
 * Rendering the raw token readably is the difference between a row that looks
 * unfamiliar and a row that looks empty — and an unfamiliar licence status is
 * something an editor will ask about, which is the right outcome.
 */
export function licenceLook(status: string): LicenceLook {
  return (
    LICENCE[status] ?? {
      label: humanise(status),
      tone: 'neutral',
      icon: 'info',
      blurb: 'This licence status is not one this version understands. Treat as unlicensed.',
      leadClass: 'item-lead-draft',
    }
  );
}

/** 'RSS every 15 minutes' · 'Manual entry' · 'API every 30 minutes'. */
export function ingestSummary(ingest: { method: string; pollIntervalMin: number }): string {
  if (ingest.method === 'manual') return 'Manual entry';
  const label = ingest.method === 'rss' ? 'RSS' : 'API';
  const mins = ingest.pollIntervalMin;
  return `${label} every ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
}

/**
 * The schema says a source auto-pauses at five consecutive failures.
 *
 * Nothing implements that yet — this constant is displayed, not enforced. When
 * the poller exists it should move to `@saar/shared` and this file should
 * import it, rather than the two drifting apart.
 */
export const AUTO_PAUSE_AFTER_FAILURES = 5;

export type IngestHealthState = 'manual' | 'never' | 'ok' | 'failing' | 'stalled';

export interface IngestHealth {
  state: IngestHealthState;
  label: string;
  tone: LicenceTone;
}

/**
 * What the poller's telemetry says.
 *
 * Nothing writes these fields yet, so today every non-manual publisher reports
 * `never`. That is honest rather than broken, and the screen says so in words
 * next to it.
 */
export function ingestHealth(ingest: {
  method: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}): IngestHealth {
  if (ingest.method === 'manual') {
    return { state: 'manual', label: 'Entered by hand', tone: 'neutral' };
  }
  if (ingest.consecutiveFailures >= AUTO_PAUSE_AFTER_FAILURES) {
    return {
      state: 'stalled',
      label: `Paused after ${ingest.consecutiveFailures} failures`,
      tone: 'bad',
    };
  }
  if (ingest.consecutiveFailures > 0) {
    return {
      state: 'failing',
      label: `${ingest.consecutiveFailures} failed since the last success`,
      tone: 'warn',
    };
  }
  if (ingest.lastSuccessAt === null) {
    return { state: 'never', label: 'Never polled', tone: 'neutral' };
  }
  return { state: 'ok', label: 'Polling normally', tone: 'ok' };
}

/**
 * Everything a row shows, lowercased once.
 *
 * The same trick `Queue.tsx` uses, and it is why the list needs no second
 * filter control: typing "pending" narrows to unlicensed publishers and "rss"
 * to the ones with a feed, because both words are already on the row.
 */
export function sourceHaystack(source: {
  slug: string;
  displayName: string;
  language: string;
  licence: { status: string };
  ingest: { method: string };
}): string {
  return `${source.displayName} ${source.slug} ${source.language} ${source.licence.status} ${source.ingest.method}`.toLowerCase();
}

/**
 * A slug proposed from a display name.
 *
 * Only ever a starting point — the field stays editable until the publisher is
 * created, after which the slug is their address and cannot change. Devanagari
 * has no ASCII transliteration here, so a Nepali masthead yields an empty
 * suggestion and the editor types one; guessing at romanisation would produce
 * a worse slug than a person would, with more confidence.
 */
export function suggestSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
