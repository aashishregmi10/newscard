/**
 * Editorial staff accounts, from the command line.
 *
 *   npx tsx scripts/staff.ts list
 *   npx tsx scripts/staff.ts add <email> "<Full name>"
 *   npx tsx scripts/staff.ts reset <email>        # new password, ends every session
 *   npx tsx scripts/staff.ts deactivate <email>   # can no longer sign in; history kept
 *
 * Until 7 Oct 2026 the only way to make an account was the seed script, which
 * makes editor@example.invalid with a password printed in the repository. A
 * production database needs real people, made deliberately — and no seed.
 *
 * Passwords are generated here, never typed: one shown once on screen is
 * better than one left in a shell's history. The person changes it after
 * signing in (the editorial site's account menu → Change password).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { close, collections, connect, getDb } from '@saar/db';
import { hashPassword } from '../apps/cms-api/src/auth/password.js';
import { mongoHost } from './lib/localOnly.js';

const usage = `Usage:
  npx tsx scripts/staff.ts list
  npx tsx scripts/staff.ts add <email> "<Full name>"
  npx tsx scripts/staff.ts reset <email>
  npx tsx scripts/staff.ts deactivate <email>`;

/** 20 characters from a 56-symbol alphabet without look-alikes: about 116 bits. */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(40);
  let out = '';
  for (const b of bytes) {
    if (b < 224) out += alphabet[b % 56];
    if (out.length === 20) break;
  }
  return out;
}

async function endSessions(staffId: unknown): Promise<number> {
  const r = await getDb().collection('sessions').deleteMany({ staffId });
  return r.deletedCount;
}

async function main(): Promise<void> {
  const [command, emailArg, ...rest] = process.argv.slice(2);
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');
  if (!command || (command !== 'list' && !emailArg)) {
    console.log(usage);
    process.exitCode = 1;
    return;
  }
  const db = await connect({ uri });
  console.log(`Staff in ${db.databaseName} on ${mongoHost(uri)}\n`);
  const staff = collections(db).staff;
  const email = emailArg?.trim().toLowerCase();

  if (command === 'list') {
    for (const s of await staff.find({}).sort({ email: 1 }).toArray()) {
      const last = s.lastLoginAt ? s.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : 'never';
      console.log(`  ${s.isActive ? 'active  ' : 'inactive'}  ${s.email.padEnd(32)} ${s.name}  (last sign-in ${last})`);
    }
    return;
  }

  if (command === 'add') {
    const name = rest.join(' ').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email!) || name === '') {
      console.log(usage);
      process.exitCode = 1;
      return;
    }
    if (await staff.findOne({ email })) throw new Error(`${email} already has an account. Use reset.`);
    const password = generatePassword();
    await staff.insertOne({
      email: email!,
      name,
      isActive: true,
      passwordHash: await hashPassword(password),
      failedLoginCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    console.log(`Added ${email}. Their password, shown once:\n\n    ${password}\n\nAsk them to change it after signing in.`);
    return;
  }

  const person = await staff.findOne({ email });
  if (!person) throw new Error(`No account for ${email}.`);

  if (command === 'reset') {
    const password = generatePassword();
    await staff.updateOne(
      { _id: person._id },
      {
        $set: {
          passwordHash: await hashPassword(password),
          failedLoginCount: 0,
          lockedUntil: null,
          isActive: true,
          updatedAt: new Date(),
        },
      },
    );
    const ended = await endSessions(person._id);
    console.log(`New password for ${email}, shown once:\n\n    ${password}\n\n${ended} session(s) ended.`);
    return;
  }

  if (command === 'deactivate') {
    await staff.updateOne({ _id: person._id }, { $set: { isActive: false, updatedAt: new Date() } });
    const ended = await endSessions(person._id);
    console.log(`${email} can no longer sign in; ${ended} session(s) ended. Their history is kept.`);
    return;
  }

  console.log(usage);
  process.exitCode = 1;
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    await close();
    process.exit(1);
  });
