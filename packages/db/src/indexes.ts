import type { Db, IndexDescription } from 'mongodb';
import { READ_EVENT_TTL_DAYS } from '@newscard/shared';

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
    sparse: true,
    serves: 'Token rotation and dedupe',
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

export const ALL_INDEXES = {
  articles: ARTICLES,
  sources: SOURCES,
  categories: CATEGORIES,
  devices: DEVICES,
  readEvents: READ_EVENTS,
  bookmarks: BOOKMARKS,
  staff: STAFF,
  notifications: NOTIFICATIONS,
} as const;

export interface SyncResult {
  collection: string;
  created: string[];
  existing: string[];
}

/** Idempotent. Safe to run on every deploy. */
export async function syncIndexes(db: Db): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const [collection, specs] of Object.entries(ALL_INDEXES)) {
    const coll = db.collection(collection);

    // A collection with no documents and no validator does not exist yet, and
    // listing its indexes throws "ns does not exist" rather than returning [].
    // createIndex will create it, so an absent namespace just means "no indexes".
    let existingNames = new Set<string>();
    try {
      existingNames = new Set(
        (await coll.indexes()).map((i) => i.name).filter((n): n is string => Boolean(n)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/ns does not exist|NamespaceNotFound/i.test(msg)) throw e;
    }

    const created: string[] = [];
    const existing: string[] = [];

    for (const { serves: _serves, ...spec } of specs) {
      if (spec.name && existingNames.has(spec.name)) {
        existing.push(spec.name);
        continue;
      }
      await coll.createIndex(spec.key, spec);
      created.push(spec.name ?? JSON.stringify(spec.key));
    }

    results.push({ collection, created, existing });
  }

  return results;
}
