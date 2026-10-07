/**
 * Back up every collection of the database MONGO_URI names.
 *
 *   npx tsx scripts/backup-db.ts                 # into backups/<db>-<time>/
 *   npx tsx scripts/backup-db.ts --out D:/saar-backups
 *
 * The free Atlas tier keeps no backups of its own (launch review, 7 Oct 2026),
 * and mongodump is a separate install; this needs nothing but the driver.
 * Each collection becomes one file of Extended JSON, a document per line, so
 * dates and ids come back as dates and ids — scripts/restore-db.ts reads it.
 *
 * The files hold readers' data (hashed account ids, votes, install ids), so
 * keep them where the database itself would be kept: never in git (backups/
 * is ignored), never shared. Media (MEDIA_ROOT) is files on disk: copy that
 * folder alongside.
 */
import 'dotenv/config';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { BSON } from 'mongodb';
import { close, connect } from '@saar/db';
import { mongoHost } from './lib/localOnly.js';

const { EJSON } = BSON;

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');
  const outArg = process.argv.indexOf('--out');
  const db = await connect({ uri });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = resolve(outArg > 0 ? process.argv[outArg + 1]! : 'backups', `${db.databaseName}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  console.log(`Backing up ${db.databaseName} on ${mongoHost(uri)}\n  into ${dir}\n`);

  const manifest: Record<string, number> = {};
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  for (const name of names) {
    const file = createWriteStream(join(dir, `${name}.jsonl`), { encoding: 'utf8' });
    let n = 0;
    for await (const doc of db.collection(name).find({})) {
      if (!file.write(EJSON.stringify(doc, { relaxed: false }) + '\n')) await once(file, 'drain');
      n++;
    }
    file.end();
    await once(file, 'finish');
    manifest[name] = n;
    console.log(`  ${name.padEnd(24)} ${n}`);
  }

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ database: db.databaseName, host: mongoHost(uri), at: new Date().toISOString(), collections: manifest }, null, 2),
  );
  console.log(`\n${names.length} collections. Restore with: npx tsx scripts/restore-db.ts "${dir}"`);
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    await close();
    process.exit(1);
  });
