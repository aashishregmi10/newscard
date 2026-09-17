import 'dotenv/config';
import { connect, close, collections, getDb } from '@saar/db';

/**
 * Demo doctor — exercises every surface a demonstration touches.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A demo fails on the thing nobody thought to check: the one category with no
 * stories, the advertiser report whose token was regenerated, the feed that
 * works in English and returns nothing in Nepali. Each is invisible until
 * somebody is watching, and then it is the only thing they remember.
 *
 * So this walks the whole surface and says what is wrong BEFORE the demo,
 * in the same spirit as `npm run mobile:doctor`.
 *
 * It is read-only against content: it registers a throwaway device and posts a
 * measurement event, because those paths cannot be checked any other way, and
 * it removes both afterwards.
 *
 * Run: npm run demo:check
 */

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const CMS = `http://localhost:${process.env.CMS_PORT ?? 3001}`;

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

let failures = 0;
let warnings = 0;

const ok = (msg: string, detail = '') =>
  console.log(`  ${c.green('ok')}    ${msg}${detail ? ' ' + c.dim(detail) : ''}`);
const bad = (msg: string, detail = '') => {
  failures++;
  console.log(`  ${c.red('FAIL')}  ${msg}${detail ? '\n        ' + c.dim(detail) : ''}`);
};
const warn = (msg: string, detail = '') => {
  warnings++;
  console.log(`  ${c.yellow('warn')}  ${msg}${detail ? '\n        ' + c.dim(detail) : ''}`);
};
const section = (t: string) => console.log(`\n${c.bold(t)}`);

async function get(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`\n${c.bold('SAAR demo check')} ${c.dim('· every surface a demonstration touches')}`);

  /* ── are the servers even up? ───────────────────────────────────────────── */
  section('Servers');

  const health = await get(`${API}/v1/health`);
  if (!health) {
    bad('the read API is not running', `expected at ${API} — start it with: npm run dev:api`);
  } else {
    const body = (await health.json()) as { status: string; db: boolean };
    if (body.db) ok('read API', `${API} · database reachable`);
    else bad('the read API is up but cannot reach the database');
  }

  const cmsUp = await get(`${CMS}/api/auth/me`, {
    headers: { 'X-Requested-With': 'newscard-cms' },
  });
  if (!cmsUp) bad('the CMS API is not running', `expected at ${CMS} — start it with: npm run dev:cms`);
  else ok('CMS API', CMS);

  const web = await get('http://localhost:5173/');
  if (!web) warn('the editorial web app is not running', 'start it with: npm run dev:cms-web');
  else ok('editorial web app', 'http://localhost:5173');

  if (!health) {
    console.log(c.red('\nThe read API is down; nothing else can be checked.\n'));
    process.exit(1);
  }

  /* ── content the demo relies on ─────────────────────────────────────────── */
  await connect({ uri: process.env.MONGO_URI! });
  const db = getDb();
  const col = collections(db);

  section('Content');

  const published = await col.articles.countDocuments({ status: 'published' });
  if (published >= 20) ok('published stories', `${published}`);
  else bad(`only ${published} published stories`, 'run: npm run db:seed');

  const byLang = await col.articles
    .aggregate<{ _id: string; n: number }>([
      { $match: { status: 'published' } },
      { $group: { _id: '$language', n: { $sum: 1 } } },
    ])
    .toArray();
  const ne = byLang.find((x) => x._id === 'ne')?.n ?? 0;
  const en = byLang.find((x) => x._id === 'en')?.n ?? 0;
  if (ne > 5 && en > 5) ok('both languages have stories', `ne=${ne} en=${en}`);
  else bad('one language is thin or empty', `ne=${ne} en=${en} — the bilingual demo needs both`);

  // A minority with no image is DESIGNED, not a gap: the card has to handle it
  // (Ch. 7.2.1), and a corpus where every story has a photograph never exercises
  // that. Only a majority without one is a problem worth raising.
  const noImage = await col.articles.countDocuments({ status: 'published', image: null });
  if (noImage === 0) {
    warn('every published story has an image', 'the text-only card layout is never exercised');
  } else if (noImage < published / 3) {
    ok('a few stories have no image', `${noImage} of ${published} — text-only cards are covered`);
  } else {
    bad(`${noImage} of ${published} published stories have no image`, 'the feed will look bare');
  }

  const shorts = await db.collection('videos').countDocuments({ status: 'published' });
  if (shorts >= 4) ok('published shorts', `${shorts}`);
  else bad(`only ${shorts} published shorts`, 'the Shorts tab will look empty');

  /* ── the editorial queue: the workflow demo ─────────────────────────────── */
  section('Editorial queue');

  const queued = await col.articles.countDocuments({
    status: { $in: ['draft', 'in_review', 'approved'] },
  });
  if (queued === 0) {
    bad(
      'the editorial queue is EMPTY',
      'Every story is published, so the newsroom workflow cannot be shown at all.\n        Run: npm run demo:seed',
    );
  } else {
    const byStatus = await col.articles
      .aggregate<{ _id: string; n: number }>([
        { $match: { status: { $in: ['draft', 'in_review', 'approved'] } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ])
      .toArray();
    const map = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    const stages = ['draft', 'in_review', 'approved'].filter((s) => (map[s] ?? 0) > 0);
    if (stages.length === 3) {
      ok('queue covers every stage', byStatus.map((s) => `${s._id}=${s.n}`).join(' '));
    } else {
      warn(
        'the queue does not cover every workflow stage',
        `present: ${stages.join(', ') || 'none'} — a demo of review and approval needs all three`,
      );
    }
  }

  const staff = await col.staff.countDocuments({ isActive: true });
  if (staff >= 1) ok('an editorial account exists', `${staff} active`);
  else bad('no active staff account', 'nobody can sign in to the CMS');

  /* ── the reader-facing API ──────────────────────────────────────────────── */
  section('Reader API');

  const cats = await get(`${API}/v1/categories`);
  const catList = cats ? ((await cats.json()) as { items: Array<{ slug: string }> }).items : [];
  if (catList.length >= 7) ok('categories', catList.map((x) => x.slug).join(', '));
  else bad(`only ${catList.length} categories`);

  for (const slug of ['top', ...catList.map((x) => x.slug).filter((s) => s !== 'top')]) {
    const r = await get(`${API}/v1/feed?category=${slug}&lang=ne,en&limit=5`);
    if (!r || !r.ok) {
      bad(`feed for "${slug}" failed`, r ? `HTTP ${r.status}` : 'no response');
      continue;
    }
    const body = (await r.json()) as { items: unknown[] };
    if (body.items.length > 0) ok(`feed · ${slug}`, `${body.items.length} cards`);
    else bad(`feed · ${slug} is EMPTY`, 'swiping to this section shows nothing');
  }

  // Ads only appear once a session is a few cards in, which is exactly the
  // condition a casual check misses.
  const adFeed = await get(`${API}/v1/feed?category=top&lang=ne,en&limit=20&seen=10&adsToday=0`);
  if (adFeed?.ok) {
    const body = (await adFeed.json()) as { items: Array<{ kind?: string }> };
    const ads = body.items.filter((i) => i.kind === 'ad').length;
    if (ads > 0) ok('sponsored cards appear in the feed', `${ads} in 20`);
    else warn('no sponsored card in a 20-card page', 'check campaign flight dates and daily cap');
  } else bad('the ad-bearing feed request failed');

  const vids = await get(`${API}/v1/videos?limit=5`);
  if (vids?.ok) {
    const body = (await vids.json()) as { items: Array<{ renditions: unknown[] }> };
    if (body.items.length > 0 && body.items.every((v) => v.renditions.length >= 1)) {
      ok('shorts feed', `${body.items.length} shorts, all with renditions`);
    } else bad('shorts feed is empty or missing renditions');
  } else bad('the shorts feed failed');

  /* ── media actually serves ──────────────────────────────────────────────── */
  section('Media');

  const one = await get(`${API}/v1/feed?limit=1&lang=ne,en`);
  const card = one?.ok
    ? ((await one.json()) as { items: Array<{ image?: { urls: Record<string, string> } }> }).items[0]
    : undefined;
  const imgPath = card?.image?.urls?.md;
  if (!imgPath) {
    warn('the first card has no image to check');
  } else {
    const img = await get(`${API}${imgPath}`);
    if (img?.ok) {
      const cache = img.headers.get('cache-control') ?? '';
      ok('image served', `${imgPath} · ${cache.includes('immutable') ? 'immutable cache' : cache}`);
    } else bad(`image 404s: ${imgPath}`, 'media files are missing — run: npm run media:fetch');
  }

  const v = await get(`${API}/v1/videos?limit=1`);
  const vid = v?.ok
    ? ((await v.json()) as { items: Array<{ renditions: Array<{ url: string }>; posterUrl: string }> })
        .items[0]
    : undefined;
  if (vid) {
    const poster = await get(`${API}${vid.posterUrl}`);
    if (poster?.ok) ok('video poster served');
    else bad(`video poster 404s: ${vid.posterUrl}`);
    const rend = await get(`${API}${vid.renditions[0]!.url}`);
    if (rend?.ok) ok('video rendition served', vid.renditions[0]!.url);
    else bad('video rendition 404s');
  }

  /* ── advertiser reporting ───────────────────────────────────────────────── */
  section('Advertiser reporting');

  const reportPage = await get(`${API}/report`);
  if (reportPage?.ok) ok('report page served', `${API}/report`);
  else bad('the report page 404s');

  const campaign = await db.collection('campaigns').findOne({ status: 'live' });
  if (!campaign) bad('no live campaign');
  else if (!campaign.reportTokenHash) {
    warn('the live campaign has no report token', 'the advertiser report cannot be opened');
  } else {
    ok('a live campaign has a report token', String(campaign.name ?? campaign._id));
    const unauth = await get(`${API}/v1/ads/campaigns/${campaign._id.toString()}/report`);
    if (unauth?.status === 401) ok('the report refuses an unauthenticated request');
    else bad(`the report should refuse without a token, got ${unauth?.status}`);
  }

  /* ── notifications ──────────────────────────────────────────────────────── */
  section('Notifications');

  const devices = await col.devices.countDocuments();
  const withToken = await col.devices.countDocuments({ fcmToken: { $ne: null } });
  if (withToken > 0) {
    ok('devices that can receive a push', `${withToken} of ${devices}`);
  } else {
    warn(
      `none of the ${devices} registered devices holds a push token`,
      'Push cannot be demonstrated. A handset needs a DEVELOPMENT BUILD (Expo Go\n        cannot receive push on Android) and notification permission granted.',
    );
  }

  const quiet = (() => {
    const now = new Date();
    const m = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 345) % 1440;
    return m >= 21 * 60 + 30 || m < 6 * 60 + 30;
  })();
  if (quiet) {
    warn(
      'it is currently QUIET HOURS in Nepal (21:30–06:30)',
      'A live send will be held or suppressed. Use the CMS test-send to one device instead.',
    );
  } else ok('outside quiet hours — a live send will go out now');

  /* ── device registration and measurement, the write paths ───────────────── */
  section('Write paths');

  // A valid v4-shaped UUID. Not a memorable word: `deadbeef` is hex, `demo`
  // is not, and the registration route is right to refuse it.
  const deviceId = '00000000-0000-4000-8000-0000deadbeef';
  const reg = await get(`${API}/v1/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      platform: 'android',
      appVersion: '0.1.0',
      langPrefs: ['ne', 'en'],
    }),
  });
  if (reg?.ok) {
    ok('a device can register', `HTTP ${reg.status}`);
    const article = await col.articles.findOne({ status: 'published' });
    const ev = await get(`${API}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        events: [{ articleId: article!._id.toString(), dwellMs: 4000, completed: true }],
      }),
    });
    if (ev?.status === 202) ok('read events are accepted');
    else bad(`read events returned ${ev?.status}`);
    await db.collection('readEvents').deleteMany({ deviceId });
    await col.devices.deleteOne({ deviceId });
  } else {
    bad(`device registration returned ${reg?.status ?? 'nothing'}`);
  }

  /* ── verdict ────────────────────────────────────────────────────────────── */
  console.log('');
  if (failures === 0 && warnings === 0) {
    console.log(c.green(c.bold('Everything checked is working. The demo is ready.\n')));
  } else if (failures === 0) {
    console.log(
      c.yellow(`${warnings} warning(s), nothing broken. Read them before you present.\n`),
    );
  } else {
    console.log(c.red(`${failures} failure(s) and ${warnings} warning(s). Fix the failures.\n`));
  }

  await close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await close();
  process.exit(1);
});
