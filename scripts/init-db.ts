/**
 * Create collections, apply validators, sync indexes.
 * Idempotent — safe to run on every deploy and as often as you like locally.
 *
 * Run: npm run db:init
 */

import 'dotenv/config';
import {
  connect,
  close,
  warnIfNoTransactions,
  applyValidators,
  syncIndexes,
  ALL_INDEXES,
} from '@newscard/db';

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Copy .env.example to .env first.');
  process.exit(1);
}

async function main(): Promise<void> {
  const db = await connect({ uri: uri! });
  console.log(`connected to ${db.databaseName}`);

  // Creating collections, validators and indexes needs no transaction, so a
  // standalone server is fine for this script. Publishing from the CMS is what
  // requires a replica set, and that process asserts separately.
  const tx = await warnIfNoTransactions();
  console.log(tx ? 'replica set OK — transactions available' : 'standalone — CMS publish unavailable');

  const validators = await applyValidators(db);
  for (const v of validators) {
    console.log(`  validator ${v.action.padEnd(7)} ${v.collection}`);
  }

  const indexes = await syncIndexes(db);
  let created = 0;
  for (const r of indexes) {
    for (const name of r.created) {
      console.log(`  index   created  ${r.collection}.${name}`);
      created++;
    }
  }

  const total = Object.values(ALL_INDEXES).reduce((n, list) => n + list.length, 0);
  console.log(`\n${created} index(es) created, ${total} declared in total.`);
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error('\n' + (e instanceof Error ? e.message : String(e)));
    await close();
    process.exit(1);
  });
