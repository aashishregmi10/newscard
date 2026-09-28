import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { connect, close, getDb } from '@saar/db';

/**
 * Issue an advertiser their report link.
 *
 * ── Why this has to exist ───────────────────────────────────────────────────
 *
 * The report page asks for a campaign ID and a report token, and the campaign
 * document holds only a sha256 of that token — deliberately, so a database dump
 * yields no working links. The plaintext is shown once, by whatever issued it.
 *
 * Until now the only thing that issued one was `npm run db:seed`, which printed
 * the tokens and moved on. So the moment that output scrolled away, every
 * campaign in the database had a report nobody alive could open: the page
 * worked, the endpoint worked, and the credential existed only as a hash.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 *   npm run ads:link                 list the campaigns and whether each has a
 *                                    token issued
 *   npm run ads:link -- <campaignId> mint a NEW token for that campaign, store
 *                                    its hash, and print the link once
 *
 * Minting is also how a link is revoked: the hash is replaced, so the token the
 * previous advertiser holds stops working the moment a new one is issued. That
 * is the behaviour you want when a relationship ends, and it is why there is no
 * separate revoke.
 *
 * ── Why the token is not put in the URL ─────────────────────────────────────
 *
 * The page takes it as a field rather than a query parameter, and this prints
 * it the same way. A token in a URL ends up in browser history, in referrer
 * headers, and in the logs of every proxy the link passes through — which for a
 * credential that never expires by itself is a poor place for it to rest.
 */

const TOKEN_PREFIX = 'rp_';

/** Where the advertiser goes. The page is on the editorial origin. */
const REPORT_PAGE = process.env.CMS_ORIGIN ?? 'http://localhost:5173';

interface CampaignRow {
  _id: ObjectId;
  name?: string;
  advertiserName?: string;
  status?: string;
  reportTokenHash?: string | null;
}

async function list(): Promise<void> {
  const rows = (await getDb()
    .collection('campaigns')
    .find({}, { projection: { name: 1, advertiserName: 1, status: 1, reportTokenHash: 1 } })
    .sort({ advertiserName: 1 })
    .toArray()) as unknown as CampaignRow[];

  if (rows.length === 0) {
    console.log('No campaigns. `npm run db:seed` creates the demonstration set.');
    return;
  }

  console.log('');
  for (const c of rows) {
    console.log(
      `  ${c._id.toString()}  ${String(c.status ?? '?').padEnd(9)}` +
        `${c.reportTokenHash ? 'issued    ' : 'NO TOKEN  '}` +
        `${c.advertiserName ?? '?'} — ${c.name ?? '?'}`,
    );
  }
  console.log('');
  console.log('  Issue or replace a link:');
  console.log('    npm run ads:link -- <campaignId>');
  console.log('');
}

async function issue(id: string): Promise<void> {
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    console.error(`"${id}" is not a campaign id. Run without arguments to list them.`);
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const _id = new ObjectId(id);
  const campaign = (await db
    .collection('campaigns')
    .findOne({ _id }, { projection: { name: 1, advertiserName: 1, reportTokenHash: 1 } })) as
    | CampaignRow
    | null;

  if (!campaign) {
    console.error('No such campaign. Run without arguments to list them.');
    process.exitCode = 1;
    return;
  }

  const replacing = Boolean(campaign.reportTokenHash);
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;

  await db.collection('campaigns').updateOne(
    { _id },
    {
      $set: {
        reportTokenHash: createHash('sha256').update(token).digest('hex'),
        updatedAt: new Date(),
      },
    },
  );

  console.log('');
  console.log(`  ${campaign.advertiserName ?? '?'} — ${campaign.name ?? '?'}`);
  if (replacing) {
    console.log('  The previous link stopped working just now.');
  }
  console.log('');
  console.log('  Send them these three lines:');
  console.log('');
  console.log(`    Report   ${REPORT_PAGE}/report/`);
  console.log(`    Campaign ${id}`);
  console.log(`    Token    ${token}`);
  console.log('');
  console.log('  Shown once. Nothing stores it in a readable form, so a lost token');
  console.log('  is replaced rather than looked up.');
  console.log('');
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  await connect({ uri });
  const arg = process.argv[2];
  if (arg === undefined || arg === '') await list();
  else await issue(arg);
  await close();
}

void main();
