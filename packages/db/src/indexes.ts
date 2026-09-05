import type { Db, IndexDescription } from 'mongodb';
import { READ_EVENT_TTL_DAYS, AD_EVENT_TTL_DAYS } from '@newscard/shared';

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
    key: { lastSeenAt: 1 },
    name: 'device_last_seen',
    serves: 'prune-devices job — deletes devices idle for 180 days',
  },
];

const READ_EVENTS: IndexSpec[] = [
  {
    key: { occurredAt: 1 },
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
    key: { occurredAt: 1 },
    name: 'ad_events_ttl',
    expireAfterSeconds: AD_EVENT_TTL_DAYS * 24 * 60 * 60,
    serves: 'Automatic expiry of raw events; campaign totals are denormalised and survive',
  },
];

const ADVERTISERS: IndexSpec[] = [
  { key: { name: 1 }, name: 'advertiser_name_unique', unique: true, serves: 'Seed and CMS lookup' },
];

export const ALL_INDEXES = {
  articles: ARTICLES,
  sources: SOURCES,
  categories: CATEGORIES,
  devices: DEVICES,
  readEvents: READ_EVENTS,
  bookmarks: BOOKMARKS,
  staff: STAFF,
  notifications: NOTIFICATIONS,
  advertisers: ADVERTISERS,
  campaigns: CAMPAIGNS,
  adEvents: AD_EVENTS,
} as const;

export interface SyncResult {
  collection: string;
  created: string[];
  existing: string[];
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

/** Idempotent. Safe to run on every deploy. */
export async function syncIndexes(db: Db): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const [collection, specs] of Object.entries(ALL_INDEXES)) {
    const coll = db.collection(collection);

    // A collection with no documents and no validator does not exist yet, and
    // listing its indexes throws "ns does not exist" rather than returning [].
    // createIndex will create it, so an absent namespace just means "no indexes".
    let live: Array<Record<string, unknown>> = [];
    try {
      live = (await coll.indexes()) as Array<Record<string, unknown>>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/ns does not exist|NamespaceNotFound/i.test(msg)) throw e;
    }
    const byName = new Map(live.map((i) => [String(i.name), i]));

    const created: string[] = [];
    const existing: string[] = [];

    for (const { serves: _serves, ...spec } of specs) {
      const name = spec.name;
      const current = name ? byName.get(name) : undefined;

      if (current) {
        // An index whose OPTIONS changed must be dropped and rebuilt —
        // createIndex is a no-op when the name already exists, so without this
        // a corrected definition silently never takes effect and the old,
        // broken index keeps enforcing the old rule.
        if (sameDefinition(current, spec)) {
          existing.push(name!);
          continue;
        }
        await coll.dropIndex(name!);
      }

      await coll.createIndex(spec.key, spec);
      created.push(name ?? JSON.stringify(spec.key));
    }

    results.push({ collection, created, existing });
  }

  return results;
}
