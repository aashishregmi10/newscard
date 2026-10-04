import { collections, getDb } from '@saar/db';
import { isPollable } from '@saar/schemas';
import { createLogger } from '@saar/shared';
import type { FeedItem } from '@saar/shared';
import { fetchFeed, FeedFetchError } from './fetchFeed.js';
import { fetchWordPressPosts } from './wordpress.js';
import { readArticlePage, MAX_ARTICLE_CHARS } from './enrich.js';
import { pollYouTubeSource, type YouTubePollReport } from './youtube.js';
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
  /** New leads given a photo or the full story from their own page. */
  enriched: number;
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
/** Logged once per process, not once a minute. */
let warnedNoYouTubeKey = false;

/** YouTube channels read on the last run, for callers that want them. */
export let lastYouTubeReports: YouTubePollReport[] = [];

export async function pollDueSources(
  now: Date = new Date(),
  options: { youtubeKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<PollReport[]> {
  const youtubeKey = (options.youtubeKey ?? process.env.YOUTUBE_API_KEY ?? '').trim();
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
  lastYouTubeReports = [];
  for (const source of due) {
    /*
     * YouTube channels feed Shorts, through their own collector. Without a
     * key they are skipped rather than failed: a missing setting is not the
     * channel's fault, and counting it would pause every channel in five
     * minutes.
     */
    if ((source.ingest?.method as string) === 'youtube') {
      if (youtubeKey === '') {
        if (!warnedNoYouTubeKey) {
          warnedNoYouTubeKey = true;
          log.warn('YouTube channels are not being read', {
            fix: 'set YOUTUBE_API_KEY in .env (free: Google Cloud, YouTube Data API v3)',
          });
        }
        continue;
      }
      lastYouTubeReports.push(
        await pollYouTubeSource(
          source as never,
          youtubeKey,
          now,
          options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
          AUTO_PAUSE_AFTER_FAILURES,
        ),
      );
      continue;
    }
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
  licence?: { images?: boolean; fullText?: boolean } | null;
  ingest: {
    method?: string;
    api?: string | null;
    apiUrl?: string | null;
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
    enriched: 0,
    notModified: false,
    error: null,
    paused: false,
  };

  const viaWordPress = source.ingest?.method === 'api' && source.ingest.api === 'wordpress';
  const feedUrl = viaWordPress ? source.ingest?.apiUrl : source.ingest?.feedUrl;
  if (!feedUrl) {
    report.error = viaWordPress ? 'No API URL.' : 'No feed URL.';
    return report;
  }
  const mayUseImages = source.licence?.images === true;
  const mayUseFullText = source.licence?.fullText === true;

  /* Stamped before the attempt, not after. A run that crashes mid-fetch must
     not leave the source looking un-polled and get hammered on the next tick. */
  await c.sources.updateOne(
    { _id: source._id as never },
    { $set: { 'ingest.lastPolledAt': now, updatedAt: now } },
  );

  let result: {
    items: FeedItem[];
    notModified: boolean;
    etag: string | null;
    lastModified: string | null;
  };
  try {
    if (viaWordPress) {
      /*
       * The API hands over the full story and the photograph whatever the
       * licence says. What we KEEP is decided here: the full text only under
       * `fullText` (otherwise the excerpt, as their feed would have said), the
       * photograph only under `images`.
       */
      const posts = await fetchWordPressPosts(feedUrl);
      result = {
        items: posts.map((p) => ({
          ...p,
          content: mayUseFullText ? p.content : null,
          imageUrl: mayUseImages ? p.imageUrl : null,
        })),
        notModified: false,
        etag: null,
        lastModified: null,
      };
    } else {
      const feed = await fetchFeed(feedUrl, {
        etag: source.ingest?.etag ?? null,
        lastModified: source.ingest?.lastModified ?? null,
      });
      result = {
        items: feed.feed?.items ?? [],
        notModified: feed.notModified,
        etag: feed.etag,
        lastModified: feed.lastModified,
      };
    }
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

  const items = result.items;
  report.fetched = items.length;
  /** New leads whose photo or full text the story page might supply. */
  const toEnrich: EnrichJob[] = [];

  for (const item of items) {
    const outcome = toLead(item, context, now);
    if (!outcome.ok) {
      report.rejected[outcome.reason] = (report.rejected[outcome.reason] ?? 0) + 1;
      continue;
    }

    try {
      const inserted = await c.leads.insertOne({
        ...outcome.lead,
        sourceId: source._id as never,
        createdAt: now,
        updatedAt: now,
      } as never);
      report.inserted += 1;

      /* Only an RSS story can be missing what the page has; the WordPress
         API already gave everything the licence lets us keep. */
      const needImage = !viaWordPress && mayUseImages && outcome.lead.feedImageUrl === null;
      const needText =
        !viaWordPress &&
        mayUseFullText &&
        (outcome.lead.feedContent?.length ?? 0) < SHORT_TEXT_CHARS;
      if (needImage || needText) {
        toEnrich.push({
          id: inserted.insertedId,
          url: outcome.lead.canonicalUrl,
          needImage,
          needText,
        });
      }
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

  report.enriched = await enrichLeads(source.slug, toEnrich);

  log.info('feed polled', {
    source: source.slug,
    via: viaWordPress ? 'wordpress' : 'rss',
    fetched: report.fetched,
    inserted: report.inserted,
    duplicates: report.duplicates,
    enriched: report.enriched,
  });
  return report;
}

/** Below this, a feed's "content" is an excerpt and the page has the story. */
const SHORT_TEXT_CHARS = 600;

/** Story pages read per poll, at most. The rest wait: a lead is never lost
 *  for lacking a photo, it is only shown without one. */
const MAX_ENRICH_PER_POLL = 20;

/** One page a second from any one publisher. */
const ENRICH_GAP_MS = 1_000;

interface EnrichJob {
  id: unknown;
  url: string;
  needImage: boolean;
  needText: boolean;
}

/**
 * Read the story pages a new batch of leads needs, one at a time.
 *
 * Runs after the poll's own writes, so a slow or failing page can delay only
 * itself. Each lead is updated on its own; a failure leaves it exactly as the
 * feed made it.
 */
async function enrichLeads(sourceSlug: string, queue: EnrichJob[]): Promise<number> {
  const c = collections(getDb());
  let enriched = 0;
  for (const [i, job] of queue.slice(0, MAX_ENRICH_PER_POLL).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, ENRICH_GAP_MS));
    try {
      const page = await readArticlePage(job.url);
      const set: Record<string, unknown> = {};
      if (job.needImage && page.imageUrl !== null) set.feedImageUrl = page.imageUrl;
      if (job.needText && page.text !== null) {
        set.feedContent = page.text.slice(0, MAX_ARTICLE_CHARS);
      }
      if (Object.keys(set).length === 0) continue;
      await c.leads.updateOne(
        { _id: job.id as never },
        { $set: { ...set, updatedAt: new Date() } },
      );
      enriched += 1;
    } catch (e) {
      log.warn('story page unreadable', {
        source: sourceSlug,
        url: job.url,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return enriched;
}

/** Runs the collector on a timer. Started alongside the notification sweeps. */
export function startIngestion(everyMs = 60_000): () => void {
  const run = () => {
    void pollDueSources().catch((e: unknown) => {
      /* One bad run must never take the process down — the next tick is a
         minute away and the sweeps beside it are unrelated. */
      log.error('ingest run failed', { error: e instanceof Error ? e.message : String(e) });
    });
  };

  const timer = setInterval(run, everyMs);
  timer.unref?.();

  /*
   * A tick at startup, like the other two loops.
   *
   * It costs nothing and cannot cause a stampede: `pollDueSources` only touches
   * a source whose `pollIntervalMin` has elapsed since `lastPolledAt`, so
   * restarting the process six times in a minute still polls each publisher
   * once. Without it, a deploy means the first collection is a minute late for
   * no reason.
   */
  run();

  return () => clearInterval(timer);
}
