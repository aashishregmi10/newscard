/**
 * Remove duplicate leads — the same canonicalUrl stored more than once — so the
 * unique index the collector relies on (lead_url_unique) can be built.
 *
 *   npx tsx scripts/dedupe-leads.ts            # shows what it would remove
 *   npx tsx scripts/dedupe-leads.ts --apply    # removes it
 *
 * Duplicates exist because the index was missing: syncIndexes used to stop at
 * its first failure, so the collector ran without its dedupe (launch review,
 * 7 Oct 2026). Of each group it keeps the copy an editor has acted on —
 * promoted (a draft points at it) before dismissed before new — and, among
 * equals, the oldest. Leads are the collector's raw material and expire after
 * 30 days on their own; nothing here touches articles.
 *
 * Unlike the seed scripts this runs against whatever MONGO_URI names, because
 * the database that needs it is the shared one. The dry run is the default.
 */
import 'dotenv/config';
import { close, connect } from '@saar/db';
import { mongoHost } from './lib/localOnly.js';

const RANK: Record<string, number> = { promoted: 0, dismissed: 1, new: 2 };

interface Copy {
  _id: unknown;
  status?: string;
  fetchedAt?: Date;
  promotedArticleId?: unknown;
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');
  const apply = process.argv.includes('--apply');
  const db = await connect({ uri });
  const leads = db.collection('leads');
  console.log(`${apply ? 'Removing' : 'Dry run —'} duplicate leads in ${db.databaseName} on ${mongoHost(uri)}\n`);

  const groups = await leads
    .aggregate<{ _id: string; copies: Copy[] }>(
      [
        { $match: { canonicalUrl: { $type: 'string' } } },
        {
          $group: {
            _id: '$canonicalUrl',
            n: { $sum: 1 },
            copies: { $push: { _id: '$_id', status: '$status', fetchedAt: '$fetchedAt', promotedArticleId: '$promotedArticleId' } },
          },
        },
        { $match: { n: { $gt: 1 } } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const remove: unknown[] = [];
  for (const g of groups) {
    const sorted = [...g.copies].sort(
      (a, b) =>
        (RANK[a.status ?? 'new'] ?? 3) - (RANK[b.status ?? 'new'] ?? 3) ||
        (a.fetchedAt?.getTime() ?? 0) - (b.fetchedAt?.getTime() ?? 0),
    );
    const [keep, ...extra] = sorted;
    remove.push(...extra.map((c) => c._id));
    if (groups.length <= 20 || g === groups[0]) {
      console.log(`  ${g._id}\n    keep ${String(keep!._id)} (${keep!.status ?? 'new'}), remove ${extra.length}`);
    }
  }
  if (groups.length > 20) console.log(`  … and ${groups.length - 1} more URLs`);

  console.log(`\n${groups.length} URL(s) stored more than once; ${remove.length} extra copies.`);
  if (!apply) {
    console.log('Nothing removed. Run again with --apply to remove them, then npm run db:init.');
    return;
  }
  const r = await leads.deleteMany({ _id: { $in: remove as never[] } });
  console.log(`Removed ${r.deletedCount}. Now run: npm run db:init`);
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    await close();
    process.exit(1);
  });
