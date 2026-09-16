/**
 * Copy a local database into another MongoDB — in practice, the development
 * database on this machine into the Atlas cluster.
 *
 *   npm run db:migrate            copy, refusing to overwrite a non-empty target
 *   npm run db:migrate -- --force replace the target's collections
 *   npm run db:migrate -- --dry   report what would move and change nothing
 *
 * ── What it deliberately does ───────────────────────────────────────────────
 *
 * Copies documents with their _id values intact. That is the whole point: the
 * article ids in this database are referenced by cursors, deep links, saved
 * cards on a phone and advertiser report tokens. A migration that reassigns ids
 * is not a migration, it is a reseed that happens to preserve the text.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * It does not copy `sessions`, and it does not copy `readEvents` or `adEvents`
 * by default. Sessions are signed against a secret and would be invalid on the
 * other side; the event collections are behavioural data on a TTL, they are
 * large, and carrying them to a new deployment means importing a liability
 * rather than an asset. `--with-events` overrides that if you want the history.
 *
 * Indexes and validators are NOT copied here. They are declared in
 * packages/db and applied by `npm run db:init`, which is the only thing that
 * should ever create them — copying them would give the new cluster whatever
 * this machine happened to have, including anything stale.
 */

import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import { MongoClient, type Document } from 'mongodb';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: join(ROOT, '.env') });

const FROM = process.env.MIGRATE_FROM ?? 'mongodb://localhost:27017/newscard';
const TO = process.env.MONGO_URI;

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry');
const withEvents = process.argv.includes('--with-events');

/** Never carried across. See the note at the top of the file. */
const NEVER = new Set(['sessions']);
const EVENTS = new Set(['readEvents', 'adEvents', 'clientErrors']);

/** Documents per insertMany. Large enough to be fast, small enough that a
 *  failure does not lose much and the progress line still moves. */
const BATCH = 500;

async function srvFallback(uri: string): Promise<void> {
  if (!uri.startsWith('mongodb+srv://')) return;
  const host = uri.split('@')[1]?.split(/[/?]/)[0];
  if (!host) return;
  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
  } catch {
    dns.setServers(['1.1.1.1', '8.8.8.8', ...dns.getServers()]);
  }
}

function describe(uri: string): string {
  // Never print the password. This output is pasted into issues and chats.
  return uri.replace(/\/\/([^:]+):[^@]+@/, '//$1:<password>@');
}

async function main(): Promise<void> {
  if (!TO) {
    console.error('MONGO_URI is not set — that is the destination. Check .env.');
    process.exit(1);
  }

  await srvFallback(FROM);
  await srvFallback(TO);

  const src = new MongoClient(FROM, { serverSelectionTimeoutMS: 10_000 });
  const dst = new MongoClient(TO, { serverSelectionTimeoutMS: 20_000 });

  await src.connect();
  await dst.connect();

  const from = src.db();
  const to = dst.db();

  console.log(`from : ${describe(FROM)}  (db: ${from.databaseName})`);
  console.log(`to   : ${describe(TO)}  (db: ${to.databaseName})`);
  console.log(dryRun ? '\nDRY RUN — nothing will be written\n' : '');

  const names = (await from.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .filter((n) => !NEVER.has(n))
    .filter((n) => withEvents || !EVENTS.has(n))
    .sort();

  if (names.length === 0) {
    console.log('nothing to copy — the source has no collections.');
    return;
  }

  // Check the whole destination BEFORE writing anything. Discovering a
  // conflict half way through leaves a database that is neither the old one
  // nor the new one.
  if (!force && !dryRun) {
    const clashes: string[] = [];
    for (const name of names) {
      const n = await to.collection(name).estimatedDocumentCount();
      if (n > 0) clashes.push(`${name} (${n})`);
    }
    if (clashes.length > 0) {
      console.error(
        `\nThe destination already holds documents in: ${clashes.join(', ')}.\n` +
          `Re-run with --force to replace them, or point MONGO_URI at an empty database.`,
      );
      process.exit(1);
    }
  }

  let totalDocs = 0;
  for (const name of names) {
    const count = await from.collection(name).estimatedDocumentCount();
    if (count === 0) {
      console.log(`  ${name.padEnd(16)} empty, skipped`);
      continue;
    }

    if (dryRun) {
      console.log(`  ${name.padEnd(16)} would copy ${count}`);
      totalDocs += count;
      continue;
    }

    if (force) await to.collection(name).deleteMany({});

    const cursor = from.collection(name).find({});
    let batch: Document[] = [];
    let moved = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      // ordered:false so one bad document does not stop the rest — the summary
      // at the end is what reports whether everything arrived.
      await to.collection(name).insertMany(batch, { ordered: false });
      moved += batch.length;
      batch = [];
    };

    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const arrived = await to.collection(name).estimatedDocumentCount();
    const ok = arrived >= count;
    console.log(`  ${name.padEnd(16)} ${String(moved).padStart(5)} copied  ${ok ? '✓' : `⚠ destination reports ${arrived}`}`);
    totalDocs += moved;
  }

  console.log(`\n${dryRun ? 'would copy' : 'copied'} ${totalDocs} documents across ${names.length} collections`);

  if (!dryRun) {
    console.log('\nNext: npm run db:init   — creates the indexes and validators on the new cluster.');
    console.log('They are declared in packages/db and are deliberately not copied.');
  }

  await src.close();
  await dst.close();
}

main().catch((e: unknown) => {
  console.error('\nmigration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
