import type { Db, IndexDescription } from 'mongodb';
import { READ_EVENT_TTL_DAYS, AD_EVENT_TTL_DAYS, CLIENT_ERROR_TTL_DAYS, DEVICE_IDLE_DELETE_DAYS } from '@saar/shared';

/**
 * Every index in the system.  Spec Ch. 3.15.
 *
 * Two rules govern this file:
 *
 *   1. An index without a named query is dead weight on every write. Each entry
 *      below records the query it serves.
 *   2. A query without an index is a collection scan that nobody notices until
 *      the collection is large.
 *
 * FIELD ORDER IS LOAD-BEARING. MongoDB can only use a compound index efficiently
 * when the query's equality fields come first and the sort matches the remaining
 * prefix. Reordering the feed indexes silently turns the feed query into a
 * collection scan — it still works in staging with 200 documents and falls over
 * in production with 200,000. Do not "tidy" these.
 */

interface IndexSpec extends IndexDescription {
  /** Human note: what query this exists for. Not passed to MongoDB. */
  serves: string;
}

const ARTICLES: IndexSpec[] = [
  {
    key: { status: 1, language: 1, publishedAt: -1, _id: -1 },
    name: 'feed_by_language',
    serves: 'GET /v1/feed — main feed, including the stable (publishedAt,_id) tiebreak',
  },
  {
    key: { status: 1, categoryId: 1, publishedAt: -1, _id: -1 },
    name: 'feed_by_category',
    serves: 'GET /v1/feed?category=<slug>',
  },
  {
    key: { slug: 1 },
    name: 'slug_unique',
    unique: true,
    serves: 'GET /v1/articles/:slug — deep-link resolution',
  },
  {
    key: { publisherUrl: 1 },
    name: 'publisher_url_unique',
    unique: true,
    sparse: true,
    serves: 'Ingestion duplicate prevention (dedupe rule D1)',
  },
  {
    key: { status: 1, scheduledFor: 1 },
    name: 'scheduler_sweep',
    sparse: true,
    serves: 'publish-scheduled job — promotes articles whose time has passed',
  },
  {
    key: { sourceId: 1, publishedAt: -1 },
    name: 'by_source',
    serves: 'Per-publisher reporting, and bulk retraction when a takedown covers a whole catalogue',
  },
  {
    key: { clusterId: 1, publishedAt: -1 },
    name: 'by_cluster',
    sparse: true,
    serves: 'Cross-source clustering — fetch every member of a story cluster (plan §2a)',
  },
];

const SOURCES: IndexSpec[] = [
  {
    key: { 'licence.status': 1, isActive: 1 },
    name: 'ingestable_sources',
    serves: 'Ingestion source selection — the licence gate',
  },
  {
    key: { slug: 1 },
    name: 'source_slug_unique',
    unique: true,
    serves: 'Source lookup by slug',
  },
];

const LEADS: IndexSpec[] = [
  {
    key: { canonicalUrl: 1 },
    name: 'lead_url_unique',
    unique: true,
    serves: 'Ingestion dedup — the same story must not be offered twice',
  },
  {
    /* The triage screen: new leads, newest first. Status is an equality match
       so it leads; fetchedAt carries the sort. Reordering these makes the
       default view a collection scan. */
    key: { status: 1, fetchedAt: -1 },
    name: 'lead_triage',
    serves: 'GET /cms/leads — the triage queue',
  },
  {
    key: { sourceId: 1, fetchedAt: -1 },
    name: 'lead_by_source',
    serves: 'Per-publisher lead history and volume checks',
  },
  {
    key: { fingerprint: 1 },
    name: 'lead_fingerprint',
    serves: 'Catching a story re-issued under a new URL',
  },
  {
    key: { clusterKey: 1 },
    name: 'lead_cluster',
    sparse: true,
    serves: 'Grouping the same story from several publishers',
  },
  {
    /*
     * Expiry keyed on a date this server sets at write time.
     *
     * Note the contrast with the three TTLs the engineering review flagged as a
     * High finding: those are keyed on a client-supplied clock, so a handset
     * with a wrong date controls its own retention. Nothing client-side ever
     * touches `purgeAt`.
     */
    key: { purgeAt: 1 },
    name: 'lead_expiry',
    expireAfterSeconds: 0,
    serves: 'A lead nobody acted on is not an asset — it expires',
  },
];

const CATEGORIES: IndexSpec[] = [
  { key: { slug: 1 }, name: 'category_slug_unique', unique: true, serves: 'Category lookup' },
  { key: { order: 1 }, name: 'category_order', serves: 'GET /v1/categories — display order' },
];

const DEVICES: IndexSpec[] = [
  {
    key: { deviceId: 1 },
    name: 'device_id_unique',
    unique: true,
    serves: 'POST /v1/devices — idempotent registration upsert',
  },
  {
    key: { fcmToken: 1 },
    name: 'fcm_token_unique',
    unique: true,
    // PARTIAL, not sparse. A sparse index skips documents where the field is
    // MISSING, but still indexes an explicit null — and we store null for every
    // device that has not granted notification permission yet. With `sparse`
    // the second such device fails with a duplicate-key error on null, which
    // presents as "registration silently does nothing".
    partialFilterExpression: { fcmToken: { $type: 'string' } },
    serves: 'Token rotation and dedupe, ignoring devices with no token yet',
  },
  {
    // An install not seen for 180 days is deleted, push token and all — the
    // Privacy Policy says so. A TTL index rather than a job: nothing to run,
    // nothing to forget to run. lastSeenAt is set by the server's clock on
    // every registration (each app launch), never the phone's.
    key: { lastSeenAt: 1 },
    name: 'device_last_seen',
    expireAfterSeconds: DEVICE_IDLE_DELETE_DAYS * 24 * 60 * 60,
    serves: 'Automatic deletion of installs idle for 180 days',
  },
];

const READ_EVENTS: IndexSpec[] = [
  {
    // receivedAt, NOT occurredAt. occurredAt comes from the handset, and a TTL
    // index keyed on a clock we do not control fails silently in both
    // directions: a slow clock deletes the row within the minute, a fast one
    // means it never expires. Retention is a privacy commitment, so it is
    // measured by the one clock we own.
    key: { receivedAt: 1 },
    name: 'ttl_90d',
    // Behavioural data we no longer need is a liability, not an asset. MongoDB
    // expires these rows without an application job.
    expireAfterSeconds: READ_EVENT_TTL_DAYS * 24 * 60 * 60,
    serves: 'Automatic expiry (Ch. 3.8.1)',
  },
  {
    key: { articleId: 1, occurredAt: -1 },
    name: 'events_by_article',
    serves: 'Per-article performance reporting, incl. publisher tap-through',
  },
];

const BOOKMARKS: IndexSpec[] = [
  {
    key: { userId: 1, articleId: 1 },
    name: 'bookmark_unique',
    unique: true,
    serves: 'Duplicate prevention (v1, once accounts exist)',
  },
];

const STAFF: IndexSpec[] = [
  { key: { email: 1 }, name: 'staff_email_unique', unique: true, serves: 'CMS login' },
  { key: { isActive: 1 }, name: 'staff_active', serves: 'Active-editor count for the sole-editor rule' },
];

const NOTIFICATIONS: IndexSpec[] = [
  { key: { sentAt: -1 }, name: 'notif_recent', serves: 'In-app notification history (30 days)' },
  { key: { articleId: 1 }, name: 'notif_by_article', sparse: true, serves: 'Collapse-key lookup' },
];

const CAMPAIGNS: IndexSpec[] = [
  {
    key: { status: 1, language: 1, startsAt: 1, endsAt: 1 },
    name: 'campaign_eligibility',
    serves: 'Ad selection — the live/in-flight/language filter on every feed request carrying an ad',
  },
  {
    key: { advertiserId: 1 },
    name: 'campaign_by_advertiser',
    serves: 'Advertiser reporting across all of their campaigns',
  },
];

const AD_EVENTS: IndexSpec[] = [
  {
    key: { campaignId: 1, type: 1, occurredAt: -1 },
    name: 'ad_events_by_campaign',
    serves:
      'Daily pacing (servedToday) and every report aggregation. Without it, pacing scans the ' +
      'whole event collection on each ad served — the one query on the serving hot path',
  },
  {
    key: { placement: 1, occurredAt: -1 },
    name: 'ad_events_by_placement',
    serves:
      'Delivered share: of all views in one placement over a period, how many each campaign ' +
      'got — the number that proves the weighting did what the share of voice promised',
  },
  {
    // Server clock, for the same reason as readEvents above.
    key: { receivedAt: 1 },
    name: 'ad_events_ttl',
    expireAfterSeconds: AD_EVENT_TTL_DAYS * 24 * 60 * 60,
    serves: 'Automatic expiry of raw events; campaign totals are denormalised and survive',
  },
];

const ADVERTISERS: IndexSpec[] = [
  { key: { name: 1 }, name: 'advertiser_name_unique', unique: true, serves: 'Seed and CMS lookup' },
];

const CLIENT_ERRORS: IndexSpec[] = [
  {
    key: { fingerprint: 1 },
    name: 'client_error_fingerprint',
    unique: true,
    serves: 'The upsert on every report — one row per distinct fault, not per occurrence',
  },
  {
    key: { lastSeen: -1 },
    name: 'client_error_recent',
    serves: 'GET /v1/client-errors — what is broken this week',
  },
  {
    key: { lastSeen: 1 },
    name: 'client_error_ttl',
    expireAfterSeconds: CLIENT_ERROR_TTL_DAYS * 24 * 60 * 60,
    serves: 'Expiry — lastSeen is set from the server clock, never the report',
  },
];

const VIDEOS: IndexSpec[] = [
  {
    key: { status: 1, language: 1, publishedAt: -1, _id: -1 },
    name: 'videos_by_language',
    serves: 'GET /v1/videos — the shorts feed, including the stable (publishedAt,_id) tiebreak',
  },
  {
    key: { status: 1, categorySlug: 1, publishedAt: -1, _id: -1 },
    name: 'videos_by_category',
    serves: 'GET /v1/videos?category=<slug>',
  },
  { key: { slug: 1 }, name: 'video_slug_unique', unique: true, serves: 'Deep-link resolution' },
  {
    /* One short per YouTube video. Partial, because an uploaded short has no
       youtubeId and a unique index over missing values would allow only one. */
    key: { youtubeId: 1 },
    name: 'video_youtube_unique',
    unique: true,
    partialFilterExpression: { youtubeId: { $type: 'string' } },
    serves: 'Promoting the same YouTube Short twice',
  },
];

const SHORT_LEADS: IndexSpec[] = [
  {
    key: { videoId: 1 },
    name: 'short_lead_video_unique',
    unique: true,
    serves: 'Collector dedup — a Short is offered once, however often the channel is read',
  },
  {
    key: { status: 1, fetchedAt: -1 },
    name: 'short_lead_triage',
    serves: 'GET /cms/short-leads — the Incoming tab on Shorts',
  },
  {
    key: { purgeAt: 1 },
    name: 'short_lead_expiry',
    expireAfterSeconds: 0,
    serves: 'A Short nobody acted on expires, like a lead',
  },
];

const INTERACTIONS: IndexSpec[] = [
  {
    key: { status: 1, opensAt: -1 },
    name: 'interaction_live',
    serves: 'The feed: what is live now; the editorial list by tab',
  },
];

const VOTES: IndexSpec[] = [
  {
    /* The rule "one vote per reader" lives here, not in a read-then-write two
       taps could both pass. */
    key: { interactionId: 1, readerId: 1 },
    name: 'vote_one_per_reader',
    unique: true,
    serves: 'POST /v1/interactions/:id/vote; GET …/me',
  },
  {
    key: { interactionId: 1, optionId: 1 },
    name: 'vote_tally',
    serves: 'Counting a vote',
  },
];

const RATINGS: IndexSpec[] = [
  {
    key: { interactionId: 1, optionId: 1, readerId: 1 },
    name: 'rating_one_per_reader',
    unique: true,
    serves: 'POST /v1/interactions/:id/ratings — one rating per reader per option',
  },
  {
    /* One Send per reader, who may skip options and so could otherwise send
       again for the ones skipped. A Send's first rating is marked `first`; a
       second Send's first rating collides here, and nothing of it is kept. */
    key: { interactionId: 1, readerId: 1, first: 1 },
    name: 'rating_one_send_per_reader',
    unique: true,
    partialFilterExpression: { first: true },
    serves: 'POST /v1/interactions/:id/ratings — one Send per reader',
  },
  {
    key: { interactionId: 1, readerId: 1 },
    name: 'rating_by_reader',
    serves: 'GET /v1/interactions/:id/me',
  },
];

const READERS: IndexSpec[] = [
  { key: { subHash: 1 }, name: 'reader_sub_unique', unique: true, serves: 'Sign-in: one reader per Google account' },
];

const READER_SESSIONS: IndexSpec[] = [
  { key: { tokenHash: 1 }, name: 'reader_session_token', unique: true, serves: 'Every signed-in request' },
  {
    key: { expiresAt: 1 },
    name: 'reader_session_expiry',
    expireAfterSeconds: 0,
    serves: 'A session ends on its own date',
  },
];

export const ALL_INDEXES = {
  articles: ARTICLES,
  sources: SOURCES,
  leads: LEADS,
  categories: CATEGORIES,
  devices: DEVICES,
  readEvents: READ_EVENTS,
  bookmarks: BOOKMARKS,
  staff: STAFF,
  notifications: NOTIFICATIONS,
  advertisers: ADVERTISERS,
  campaigns: CAMPAIGNS,
  adEvents: AD_EVENTS,
  clientErrors: CLIENT_ERRORS,
  videos: VIDEOS,
  shortLeads: SHORT_LEADS,
  interactions: INTERACTIONS,
  votes: VOTES,
  ratings: RATINGS,
  readers: READERS,
  readerSessions: READER_SESSIONS,
} as const;

export interface SyncResult {
  collection: string;
  created: string[];
  existing: string[];
  /** Could not be built — a duplicate under a unique index, most often. The rest went on. */
  failed: Array<{ name: string; error: string }>;
}

/**
 * Does the live index match what we declare?
 *
 * Compares the key and the options that change BEHAVIOUR. Cosmetic fields the
 * server adds (`v`, `ns`) are ignored, and an absent option on either side is
 * treated as its default rather than as a difference.
 */
function sameDefinition(live: Record<string, unknown>, spec: Record<string, unknown>): boolean {
  if (JSON.stringify(live.key) !== JSON.stringify(spec.key)) return false;

  const opts = ['unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression'] as const;
  for (const o of opts) {
    const a = live[o] ?? (o === 'unique' || o === 'sparse' ? false : undefined);
    const b = spec[o] ?? (o === 'unique' || o === 'sparse' ? false : undefined);
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  }
  return true;
}

/** The options of a live index, in the form createIndex takes, to put it back. */
function asSpec(live: Record<string, unknown>): IndexDescription {
  const spec: Record<string, unknown> = { key: live.key, name: live.name };
  for (const o of ['unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression'] as const) {
    if (live[o] !== undefined) spec[o] = live[o];
  }
  return spec as unknown as IndexDescription;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Idempotent. Safe to run on every deploy.
 *
 * One index that cannot be built does not stop the others. It used to: on
 * 7 Oct 2026 a duplicate URL in `leads` failed its unique index, the sync
 * stopped there, and every collection after it went without its indexes —
 * the votes' and ratings' "one per reader" included — for as long as nobody
 * read the error. Now each failure is recorded, the sync carries on, and the
 * caller reports them all.
 *
 * A changed definition has to replace the old index under the same name (and
 * MongoDB keeps no two indexes on one key with different options), so the old
 * one is dropped first — and if the new one then cannot be built, the old one
 * is put back. A collection is never left without the index it had.
 */
export async function syncIndexes(db: Db): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const [collection, specs] of Object.entries(ALL_INDEXES)) {
    const coll = db.collection(collection);
    const created: string[] = [];
    const existing: string[] = [];
    const failed: SyncResult['failed'] = [];

    // A collection with no documents and no validator does not exist yet, and
    // listing its indexes throws "ns does not exist" rather than returning [].
    // createIndex will create it, so an absent namespace just means "no indexes".
    let live: Array<Record<string, unknown>> = [];
    try {
      live = (await coll.indexes()) as Array<Record<string, unknown>>;
    } catch (e) {
      if (!/ns does not exist|NamespaceNotFound/i.test(message(e))) {
        failed.push({ name: '(listing indexes)', error: message(e) });
        results.push({ collection, created, existing, failed });
        continue;
      }
    }
    const byName = new Map(live.map((i) => [String(i.name), i]));

    for (const { serves: _serves, ...spec } of specs) {
      const name = spec.name ?? JSON.stringify(spec.key);
      const current = spec.name ? byName.get(spec.name) : undefined;

      if (current && sameDefinition(current, spec)) {
        existing.push(name);
        continue;
      }

      try {
        // An index whose OPTIONS changed must be dropped and rebuilt —
        // createIndex is a no-op when the name already exists, so without this
        // a corrected definition silently never takes effect and the old,
        // broken index keeps enforcing the old rule.
        if (current) await coll.dropIndex(spec.name!);
        try {
          await coll.createIndex(spec.key, spec);
        } catch (e) {
          if (current) await coll.createIndex(current.key as IndexDescription['key'], asSpec(current));
          throw e;
        }
        created.push(name);
      } catch (e) {
        failed.push({ name, error: message(e) });
      }
    }

    results.push({ collection, created, existing, failed });
  }

  return results;
}
