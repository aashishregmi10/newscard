import { MongoClient, type Db } from 'mongodb';

/**
 * The single MongoClient for a process.
 *
 * The driver pools connections internally; creating a client per request is a
 * classic way to exhaust a server's connection limit under load.
 */

let client: MongoClient | undefined;
let db: Db | undefined;

export interface ConnectOptions {
  uri: string;
  /** Overrides the database named in the URI. Used by the integration harness. */
  dbName?: string;
}

export async function connect(opts: ConnectOptions): Promise<Db> {
  if (db) return db;

  client = new MongoClient(opts.uri, {
    // Fail fast on a wrong URI rather than hanging for the 30s default: a dev
    // whose Docker is not running should be told in seconds.
    serverSelectionTimeoutMS: 5_000,
    retryWrites: true,
  });

  await client.connect();
  db = opts.dbName ? client.db(opts.dbName) : client.db();
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('connect() must be called before getDb()');
  return db;
}

export function getClient(): MongoClient {
  if (!client) throw new Error('connect() must be called before getClient()');
  return client;
}

export async function close(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}

/**
 * Assert the deployment supports transactions.
 *
 * The publish flow (spec Fig. 4.3) runs in a transaction, and MongoDB requires a
 * replica set for that — even a single-node one. A standalone mongod fails at
 * the first publish with "Transaction numbers are only allowed on a replica set
 * member", which reads like an application bug and is not. Checking at startup
 * turns a confusing runtime failure into a clear boot-time message.
 */
export async function supportsTransactions(): Promise<boolean> {
  const info = (await getClient().db('admin').command({ hello: 1 })) as {
    setName?: string;
    msg?: string;
  };
  // A replica set reports setName; a sharded cluster reports isdbgrid. A
  // standalone reports neither, and cannot start a transaction.
  return typeof info.setName === 'string' || info.msg === 'isdbgrid';
}

const STANDALONE_ADVICE =
  'MongoDB is running as a standalone server, which cannot run transactions.\n\n' +
  'Either:\n' +
  '  • start the dev stack — `npm run db:up` runs mongo with --replSet rs0 and\n' +
  '    initiates it automatically, on port 27018; or\n' +
  '  • point MONGO_URI at any MongoDB configured as a replica set.\n\n' +
  'MONGO_URI should end with ?replicaSet=rs0&directConnection=true';

/**
 * Require transaction support. Used by the CMS, which publishes.
 *
 * Failing at boot with this message is far better than failing at the first
 * publish with "Transaction numbers are only allowed on a replica set member",
 * which reads like an application bug and is not.
 */
export async function assertReplicaSet(): Promise<void> {
  if (!(await supportsTransactions())) {
    throw new Error(STANDALONE_ADVICE);
  }
}

/**
 * Warn, but continue. Used by the public read API.
 *
 * The feed never opens a transaction — it is a single indexed find. Refusing to
 * start would force a replica set (and therefore Docker) on anyone who only
 * wants to run the reader app, which is a cost with no benefit. The CMS still
 * asserts, because it is the process that actually needs them.
 */
export async function warnIfNoTransactions(): Promise<boolean> {
  const ok = await supportsTransactions();
  if (!ok) {
    console.warn(
      '\n[warning] ' + STANDALONE_ADVICE.split('\n')[0] +
        '\n          The read API does not need them, so it will start anyway.' +
        '\n          Publishing from the CMS will not work against this server.\n',
    );
  }
  return ok;
}
