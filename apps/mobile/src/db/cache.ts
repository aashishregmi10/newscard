import * as SQLite from 'expo-sqlite';
import type { Card } from '../api/client';

/**
 * Local article cache.  Spec Ch. 9.
 *
 * Connectivity in Nepal is intermittent by default, not exceptionally. Offline
 * is a normal operating mode, and the governing rule is simple:
 *
 *   A story the app has ever downloaded stays readable until it is evicted.
 *   Opening with no connection shows the last feed immediately, with a quiet
 *   banner. It never shows a spinner, an error page, or a blank screen.
 *
 * SQLite rather than a key-value store because eviction needs an ordered range
 * query, not a full scan of every key (Ch. 9.2).
 *
 * EVERY function here is failure-tolerant. The cache is an optimisation; if it
 * cannot open, the app must still fetch and display news.
 */

const DB_NAME = 'newscard.db';

/** Ch. 9.3 — whichever limit is reached first. */
export const RETENTION_DAYS = 7;
export const MAX_CARDS = 400;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS articles (
    id            TEXT PRIMARY KEY NOT NULL,
    slug          TEXT NOT NULL,
    language      TEXT NOT NULL,
    category_slug TEXT NOT NULL,
    published_at  INTEGER NOT NULL,
    cached_at     INTEGER NOT NULL,
    payload       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_articles_feed
    ON articles (category_slug, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_cached
    ON articles (cached_at);
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function open(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(SCHEMA);
      return db;
    })().catch((e: unknown) => {
      // Do NOT keep a rejected promise cached. Every later call would reject
      // forever, so a single transient failure at boot would disable the cache
      // for the entire session. Clearing it lets the next call retry.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/**
 * Store a page. The whole card is kept, not a reference — a cached entry whose
 * content has been evicted is useless precisely when the network is gone.
 */
export async function putCards(cards: Card[], categorySlug: string): Promise<void> {
  if (cards.length === 0) return;
  const db = await open();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    for (const c of cards) {
      await db.runAsync(
        `INSERT INTO articles (id, slug, language, category_slug, published_at, cached_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           cached_at = excluded.cached_at`,
        c.id,
        c.slug,
        c.language,
        categorySlug,
        Date.parse(c.publishedAt) || now,
        now,
        JSON.stringify(c),
      );
    }
  });
}

export async function getCards(
  categorySlug: string,
  languages: Array<'ne' | 'en'>,
  limit = 40,
): Promise<Card[]> {
  const db = await open();
  const placeholders = languages.map(() => '?').join(',');

  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM articles
      WHERE category_slug = ?
        AND language IN (${placeholders})
      ORDER BY published_at DESC
      LIMIT ?`,
    categorySlug,
    ...languages,
    limit,
  );

  return rows
    .map((r) => {
      try {
        return JSON.parse(r.payload) as Card;
      } catch {
        // One corrupt row must not blank the whole feed.
        return null;
      }
    })
    .filter((c): c is Card => c !== null);
}

/**
 * Evict by age, then by count.  Ch. 9.3.
 *
 * Bookmarked stories live in a separate store and are never evicted — a
 * bookmark is a promise, and re-fetching it needs a network the reader may not
 * have.
 */
export async function evict(): Promise<number> {
  const db = await open();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const byAge = await db.runAsync('DELETE FROM articles WHERE cached_at < ?', cutoff);
  const byCount = await db.runAsync(
    `DELETE FROM articles WHERE id IN (
       SELECT id FROM articles ORDER BY published_at DESC LIMIT -1 OFFSET ?
     )`,
    MAX_CARDS,
  );

  return (byAge.changes ?? 0) + (byCount.changes ?? 0);
}

/** Ch. 9.7 — a retracted story must disappear even from a device that has been
 *  offline for days. */
export async function purge(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await open();
  await db.runAsync(`DELETE FROM articles WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export async function stats(): Promise<{ count: number; oldest: number | null }> {
  const db = await open();
  const row = await db.getFirstAsync<{ n: number; oldest: number | null }>(
    'SELECT COUNT(*) AS n, MIN(cached_at) AS oldest FROM articles',
  );
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null };
}

export async function clear(): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM articles');
}
