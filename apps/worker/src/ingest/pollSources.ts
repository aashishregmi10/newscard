import { collections, getDb } from '@saar/db';
import { isPollable } from '@saar/schemas';
import { createLogger } from '@saar/shared';
import { fetchFeed, FeedFetchError } from './fetchFeed.js';
import { toLead, type RejectReason, type SourceContext } from './toLead.js';

/**
 * The collector.
 *
 * Reads the feeds of publishers we are allowed to read, and writes what it
 * finds into `leads` for an editor to triage. It writes nothing to `articles`
 * and nothing a reader can see — promoting a lead into a draft is a person's
 * decision, made on the triage screen.
 *
 * ── The two gates, and which one this is ────────────────────────────────────
 *
 * This is the weaker gate, `isPollable`: may we FETCH a reference to a story?
 * A public feed is enough. The stronger gate is in publish.service.ts and is
 * untouched — may we PUBLISH a summary, which always needs an agreed licence.
 * Nothing this file does can move a story towards a reader.
 *
 * ── Why the failure handling is this careful ────────────────────────────────
 *
 * Fourteen publishers, one process, every fifteen minutes, forever. One
 * publisher's expired certificate must not stop the other thirteen, a run that
 * dies halfway must leave the database consistent, and a feed that has been
 * broken for a day must stop being requested — which is what the auto-pause at
 * five failures is for. That threshold has been documented in the schema since
 * the beginning and never implemented; it is implemented here.
 */

const log = createLogger({ level: 'info', service: 'ingest' });

/** Documented in the schema since the beginning: at five, the source pauses. */
export const AUTO_PAUSE_AFTER_FAILURES = 5;

export interface PollReport {
  sourceSlug: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  rejected: Partial<Record<RejectReason, number>>;
  notModified: boolean;
  error: string | null;
  paused: boolean;
}

/**
 * Poll every source that is due.
 *
 * "Due" means pollable, not paused, and `pollIntervalMin` has elapsed since the
 * last attempt — so a run every minute does not mean a request every minute.
 */
export async function pollDueSources(now: Date = new Date()): Promise<PollReport[]> {
  const c = collections(getDb());

  /* Served by `ingestable_sources`. The predicate is applied again in memory
     because it also reads `ingest.basis`, which is not in that index — the
     query narrows, the predicate decides. */
  const candidates = await c.sources.find({ isActive: true }).toArray();

  const due = candidates.filter((s) => {
    if (!isPollable(s as never)) return false;
    if ((s.ingest?.consecutiveFailures ?? 0) >= AUTO_PAUSE_AFTER_FAILURES) return false;
    const last = s.ingest?.lastPolledAt;
    if (!last) return true;
    const elapsedMin = (now.getTime() - new Date(last).getTime()) / 60_000;
    return elapsedMin >= (s.ingest?.pollIntervalMin ?? 15);
  });

  const reports: PollReport[] = [];
  /*
   * Sequential, deliberately. Fourteen publishers is not a throughput problem,
   * and firing fourteen simultaneous requests from one address is how a
   * collector gets itself rate-limited by a CDN it shares with other readers.
   */
  for (const source of due) {
    reports.push(await pollOne(source as never, now));
  }
  return reports;
}

interface SourceRecord {
  _id: { toString(): string };
  slug: string;
  displayName: string;
  language: 'ne' | 'en';
  homepageUrl: string;
  ingest: {
    feedUrl?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    consecutiveFailures?: number;
  };
}

async function pollOne(source: SourceRecord, now: Date): Promise<PollReport> {
  const c = collections(getDb());
  const report: PollReport = {
    sourceSlug: source.slug,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    rejected: {},
    notModified: false,
    error: null,
    paused: false,
  };

  const feedUrl = source.ingest?.feedUrl;
  if (!feedUrl) {
    report.error = 'No feed URL.';
    return report;
  }

  /* Stamped before the attempt, not after. A run that crashes mid-fetch must
     not leave the source looking un-polled and get hammered on the next tick. */
  await c.sources.updateOne(
    { _id: source._id as never },
    { $set: { 'ingest.lastPolledAt': now, updatedAt: now } },
  );

  let result;
  try {
    result = await fetchFeed(feedUrl, {
      etag: source.ingest?.etag ?? null,
      lastModified: source.ingest?.lastModified ?? null,
    });
  } catch (e) {
    const reason = e instanceof FeedFetchError ? `${e.reason}: ${e.message}` : String(e);
    const failures = (source.ingest?.consecutiveFailures ?? 0) + 1;
    report.error = reason;
    report.paused = failures >= AUTO_PAUSE_AFTER_FAILURES;

    await c.sources.updateOne(
      { _id: source._id as never },
      { $set: { 'ingest.consecutiveFailures': failures, updatedAt: now } },
    );

    log[report.paused ? 'error' : 'warn']('feed fetch failed', {
      source: source.slug,
      failures,
      paused: report.paused,
      reason,
    });
    return report;
  }

  if (result.notModified) {
    report.notModified = true;
    await c.sources.updateOne(
      { _id: source._id as never },
      { $set: { 'ingest.lastSuccessAt': now, 'ingest.consecutiveFailures': 0, updatedAt: now } },
    );
    return report;
  }

  const context: SourceContext = {
    id: source._id.toString(),
    slug: source.slug,
    displayName: source.displayName,
    language: source.language,
    homepageUrl: source.homepageUrl,
  };

  const items = result.feed?.items ?? [];
  report.fetched = items.length;

  for (const item of items) {
    const outcome = toLead(item, context, now);
    if (!outcome.ok) {
      report.rejected[outcome.reason] = (report.rejected[outcome.reason] ?? 0) + 1;
      continue;
    }

    try {
      await c.leads.insertOne({
        ...outcome.lead,
        sourceId: source._id as never,
        createdAt: now,
        updatedAt: now,
      } as never);
      report.inserted += 1;
    } catch (e) {
      /*
       * A duplicate is the normal case, not an error: a feed carries the same
       * twenty stories every fifteen minutes and only the new ones are new.
       * `lead_url_unique` is what decides, rather than a read-then-write that
       * two overlapping runs could both pass.
       */
      if (typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000) {
        report.duplicates += 1;
        continue;
      }
      throw e;
    }
  }

  await c.sources.updateOne(
    { _id: source._id as never },
    {
      $set: {
        'ingest.lastSuccessAt': now,
        'ingest.consecutiveFailures': 0,
        'ingest.etag': result.etag,
        'ingest.lastModified': result.lastModified,
        updatedAt: now,
      },
    },
  );

  log.info('feed polled', {
    source: source.slug,
    fetched: report.fetched,
    inserted: report.inserted,
    duplicates: report.duplicates,
  });
  return report;
}

/** Runs the collector on a timer. Started alongside the notification sweeps. */
export function startIngestion(everyMs = 60_000): () => void {
  const timer = setInterval(() => {
    void pollDueSources().catch((e: unknown) => {
      /* One bad run must never take the process down — the next tick is a
         minute away and the sweeps beside it are unrelated. */
      log.error('ingest run failed', { error: e instanceof Error ? e.message : String(e) });
    });
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
