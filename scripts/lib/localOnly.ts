/**
 * The seed and demo scripts invent sample data and delete real data — seed.ts
 * empties articles, sources, staff and advertisers before it starts. On 7 Oct
 * 2026 the development .env pointed at the same Atlas database that would
 * serve readers, and nothing stood between `npm run db:seed` and it.
 *
 * So they run only against a database on this machine, unless told in so many
 * words: `--force-remote`.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

/** The first host in a MongoDB connection string, without credentials or port. */
export function mongoHost(uri: string): string {
  const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
  const authority = afterScheme.split(/[/?]/)[0] ?? '';
  const hosts = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  const first = hosts.split(',')[0] ?? '';
  return first.startsWith('[') ? first.slice(0, first.indexOf(']') + 1) : (first.split(':')[0] ?? '');
}

export function isLocalMongo(uri: string): boolean {
  return LOCAL_HOSTS.has(mongoHost(uri).toLowerCase());
}

/** Exit unless MONGO_URI is set and local, or --force-remote was passed. Returns the URI. */
export function requireLocalDatabase(script: string, argv: readonly string[] = process.argv): string {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  if (!isLocalMongo(uri) && !argv.includes('--force-remote')) {
    console.error(
      [
        `${script} writes sample data and deletes real data, and MONGO_URI points at ${mongoHost(uri)} —`,
        'not a database on this machine. Refusing.',
        '',
        '  Use a local database:  npm run db:up, and MONGO_URI=mongodb://localhost:27017/saar',
        '  Or, if you really mean that database, run it again with --force-remote.',
      ].join('\n'),
    );
    process.exit(1);
  }
  return uri;
}
