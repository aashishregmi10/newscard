/**
 * Restore a backup made by scripts/backup-db.ts into the database MONGO_URI
 * names.
 *
 *   npx tsx scripts/restore-db.ts backups/saar-2026-10-07T10-00-00
 *   npx tsx scripts/restore-db.ts <folder> --replace    # empty each collection first
 *
 * Without --replace it refuses to touch a collection that already holds
 * documents: a restore that merges into live data is two half-truths. Run
 * `npm run db:init` afterwards for the validators and indexes.
 *
 * A backup is only worth something if it restores, so try it once into a
 * scratch database (MONGO_URI=mongodb://localhost:27017/saar_restore_test).
 */
import 'dotenv/config';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { BSON } from 'mongodb';
import { close, connect } from '@saar/db';
import { mongoHost } from './lib/localOnly.js';

const { EJSON } = BSON;

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');
  const folder = process.argv[2];
  if (!folder || folder.startsWith('--')) throw new Error('Usage: npx tsx scripts/restore-db.ts <backup folder> [--replace]');
  const replace = process.argv.includes('--replace');
  const dir = resolve(folder);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    database: string;
    at: string;
    collections: Record<string, number>;
  };

  const db = await connect({ uri });
  console.log(
    `Restoring ${manifest.database} (backed up ${manifest.at})\n  into ${db.databaseName} on ${mongoHost(uri)}${replace ? ', replacing what is there' : ''}\n`,
  );

  /* Check every collection before writing to any, so a refusal leaves nothing half-done. */
  if (!replace) {
    const occupied: string[] = [];
    for (const name of Object.keys(manifest.collections)) {
      if ((await db.collection(name).estimatedDocumentCount()) > 0) occupied.push(name);
    }
    if (occupied.length > 0) {
      throw new Error(`These already hold documents: ${occupied.join(', ')}. Use --replace to empty them first.`);
    }
  }

  for (const [name, expected] of Object.entries(manifest.collections)) {
    const coll = db.collection(name);
    if (replace) await coll.deleteMany({});
    let batch: Record<string, unknown>[] = [];
    let n = 0;
    const lines = createInterface({ input: createReadStream(join(dir, `${name}.jsonl`), 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim() === '') continue;
      batch.push(EJSON.parse(line, { relaxed: false }) as Record<string, unknown>);
      if (batch.length === 500) {
        await coll.insertMany(batch, { ordered: false });
        n += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await coll.insertMany(batch, { ordered: false });
      n += batch.length;
    }
    console.log(`  ${name.padEnd(24)} ${n}${n === expected ? '' : `  (manifest says ${expected})`}`);
  }
  console.log('\nDone. Now: npm run db:init');
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    await close();
    process.exit(1);
  });
