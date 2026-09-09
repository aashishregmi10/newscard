/**
 * Real photographs for the demonstration corpus.
 *
 * ── Why Wikimedia Commons, and not a news site ──────────────────────────────
 *
 * The rule for this project is that we hold no licence to any news
 * photograph, so none is ever copied. That rule does not go away because a
 * demonstration would look better with photographs in it.
 *
 * Commons is the honest way to have both. Every file it serves carries an
 * explicit licence — public domain, CC0, or a CC BY / BY-SA that requires only
 * attribution — and the API returns the licence and the photographer with the
 * image. So each picture is stored WITH its credit and its licence string, the
 * card renders that credit, and the publish precondition that blocks an article
 * whose `image.licence` is null is satisfied honestly rather than bypassed.
 *
 * These are still not news photographs. They are real, relevant, correctly
 * licensed pictures standing in for the ones a licensed wire feed would supply.
 * The distinction matters and is recorded on every record this writes.
 *
 * Run: npm run media:fetch
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { STORIES } from './seedStories.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(ROOT, 'media');
const CACHE = join(MEDIA, 'commons-cache.json');

const API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Commons rate-limits anonymous callers and answers 429 once you go too fast.
 * Forty searches fired back to back got seven images and thirty-three refusals,
 * which looked exactly like "no photograph exists for this subject" — so the
 * requests are serialised and spaced, and a refusal is retried rather than
 * treated as an absence.
 */
const PAUSE_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 && attempt < 6) {
    // Honour Retry-After when the server sends one; it knows better than we do.
    const after = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 3000 * 2 ** attempt;
    process.stdout.write('~');
    await sleep(wait);
    return politeFetch(url, attempt + 1);
  }
  return res;
}

/**
 * Last resort when Commons has nothing usable for a subject.
 *
 * Lorem Picsum serves real photographs from Unsplash and exists precisely to be
 * a placeholder service, so there is no rights question and no rate limit. The
 * trade is that the picture is generic rather than about the story — which is
 * why it is the fallback and not the first choice, and why the credit says so
 * rather than pretending otherwise.
 */
async function fallbackPhoto(slug: string): Promise<Buffer | null> {
  // A timeout is not optional here. Without one a single stalled connection
  // holds the whole run open indefinitely, and the symptom is a script that
  // stops making progress while still appearing to be alive.
  try {
    const res = await fetch(`https://picsum.photos/seed/${encodeURIComponent(slug)}/1600/900`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Commons asks for a real user agent that identifies the caller. */
const UA = 'NEWSCARD-demo-seed/1.0 (development fixtures; contact via repository)';

export const RENDITIONS = [
  { name: 'sm', width: 320 },
  { name: 'md', width: 720 },
  { name: 'lg', width: 1080 },
] as const;

export interface FetchedImage {
  key: string;
  credit: string;
  licence: string;
  sourceUrl: string;
  blurHash: string;
  width: number;
  height: number;
  urls: { sm: string; md: string; lg: string };
}

/* ── Commons search ─────────────────────────────────────────────────────── */

interface CommonsHit {
  title: string;
  url: string;
  descriptionUrl: string;
  author: string;
  licence: string;
  width: number;
  height: number;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Licences we will store. Anything else — "Fair use", a bare "Copyrighted", an
 * unrecognised string — is skipped rather than guessed at, because the whole
 * point of recording the licence is that the record can be trusted.
 */
function acceptableLicence(raw: string): boolean {
  const l = raw.toLowerCase();
  if (!l) return false;
  if (l.includes('fair use') || l.includes('non-free') || l.includes('nc-')) return false;
  return (
    l.includes('cc0') ||
    l.includes('public domain') ||
    l.includes('cc by') ||
    l.includes('cc-by') ||
    l.startsWith('pd')
  );
}

async function searchCommons(query: string, limit = 12): Promise<CommonsHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
  });

  await sleep(PAUSE_MS);
  const res = await politeFetch(`${API}?${params}`);
  if (!res.ok) return [];

  const body = (await res.json()) as {
    query?: { pages?: Record<string, Record<string, unknown>> };
  };
  const pages = body.query?.pages;
  if (!pages) return [];

  const hits: CommonsHit[] = [];
  for (const page of Object.values(pages)) {
    const info = (page.imageinfo as Array<Record<string, unknown>> | undefined)?.[0];
    if (!info) continue;

    const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
    const licence = stripHtml(meta.LicenseShortName?.value ?? '');
    if (!acceptableLicence(licence)) continue;

    const width = Number(info.width ?? 0);
    const height = Number(info.height ?? 0);
    // Portrait and tiny images look wrong in a 16:9 card slot.
    if (width < 900 || height < 500 || width / height < 1.2) continue;

    hits.push({
      title: String(page.title ?? ''),
      url: String(info.url ?? ''),
      descriptionUrl: String(info.descriptionurl ?? ''),
      author: stripHtml(meta.Artist?.value ?? '') || 'Wikimedia Commons contributor',
      licence,
      width,
      height,
    });
  }
  return hits;
}

/* ── download and render ────────────────────────────────────────────────── */

/**
 * BlurHash's DC term only — the average colour, which is what removes the grey
 * flash while an image loads. Matches what scripts/lib/png.ts emits so the
 * client's decoder sees one format.
 */
const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function encode83(value: number, length: number): string {
  let out = '';
  for (let i = 1; i <= length; i++) {
    const digit = Math.floor(value / 83 ** (length - i)) % 83;
    out += B83[digit];
  }
  return out;
}

function flatBlurHash(r: number, g: number, b: number): string {
  // 1x1 component hash: size flag 0, quantised max 0, then the packed DC term.
  return encode83(0, 1) + encode83(0, 1) + encode83((r << 16) + (g << 8) + b, 4);
}

async function renderRenditions(
  buf: Buffer,
  key: string,
  cdnBase: string,
): Promise<Pick<FetchedImage, 'blurHash' | 'width' | 'height' | 'urls'>> {
  const dir = join(MEDIA, 'i', key);
  mkdirSync(dir, { recursive: true });

  // The 16:9 crop is decided ONCE, on the large rendition, and the smaller two
  // are derived from that result.
  //
  // `position: 'attention'` runs an entropy analysis to find the subject, which
  // is the right call for an unsupervised crop and is also expensive — running
  // it three times per photograph against a full-resolution source took about
  // two and a half minutes an image. Doing it once and downscaling the result
  // is visually identical and far faster.
  const large = await sharp(buf)
    .resize(1080, 608, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const urls: Record<string, string> = {};
  for (const r of RENDITIONS) {
    const out = await sharp(large)
      .resize(r.width, Math.round((r.width * 9) / 16), { fit: 'cover' })
      // Strips EXIF, which can carry the photographer's GPS location.
      .jpeg({ quality: 78, progressive: true })
      .toBuffer();
    writeFileSync(join(dir, `${r.width}.jpg`), out);
    urls[r.name] = `${cdnBase}/i/${key}/${r.width}.jpg`;
  }

  // One pixel is exactly the average colour.
  const { data } = await sharp(large).resize(1, 1, { fit: 'cover' }).raw().toBuffer({
    resolveWithObject: true,
  });

  return {
    blurHash: flatBlurHash(data[0] ?? 128, data[1] ?? 128, data[2] ?? 128),
    width: 1080,
    height: 608,
    urls: { sm: urls.sm!, md: urls.md!, lg: urls.lg! },
  };
}

/* ── orchestration ──────────────────────────────────────────────────────── */

/**
 * One search per category, not per story.
 *
 * Commons throttles the search generator hard — forty queries fired in sequence
 * got seven images and thirty-three refusals. Six broad queries returning fifty
 * results each cover the same corpus, stay well inside the rate limit, and
 * still give every card a picture that belongs to its section.
 */
const CATEGORY_QUERY: Record<string, string> = {
  nepal: 'Nepal village town people',
  politics: 'Nepal Kathmandu government building',
  business: 'Nepal market shop trade',
  world: 'Himalaya mountains landscape Nepal',
  sports: 'Nepal sport football cricket players',
  tech: 'Nepal technology computer electricity',
};

type Cache = Record<string, FetchedImage>;

function saveCache(cache: Cache): void {
  mkdirSync(MEDIA, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
}

function loadCache(): Cache {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

/**
 * One image per story, chosen deterministically from the search results so that
 * re-running produces the same corpus. Results are cached to disk: the network
 * is only touched for stories that do not already have a picture, which makes a
 * re-seed fast and keeps Commons from being hammered.
 */
export async function fetchAll(cdnBase: string, stockOnly = false): Promise<Cache> {
  const cache = loadCache();
  const wanted = STORIES.filter((s) => !s.noImage);

  // Group by query so one search serves every story that shares a subject, and
  // each of them takes a different result rather than all showing one photo.
  const byQuery = new Map<string, typeof wanted>();
  for (const s of wanted) {
    const q = CATEGORY_QUERY[s.category] ?? `Nepal ${s.category}`;
    const list = byQuery.get(q) ?? [];
    list.push(s);
    byQuery.set(q, list);
  }

  let fetched = 0;
  let reused = 0;
  let failed = 0;

  for (const [query, stories] of byQuery) {
    const missing = stories.filter((s) => !cache[s.slug]);
    if (missing.length === 0) {
      reused += stories.length;
      continue;
    }

    let hits: CommonsHit[] = [];
    if (!stockOnly) {
      try {
        hits = await searchCommons(query, 50);
      } catch {
        hits = [];
      }
    }

    if (hits.length === 0) {
      for (const story of missing) {
        const buf = await fallbackPhoto(story.slug);
        if (!buf) {
          failed++;
          continue;
        }
        const key = createHash('sha256').update(story.slug).digest('hex').slice(0, 12);
        cache[story.slug] = {
          key,
          credit: 'Lorem Picsum / Unsplash — stock photograph, not a news image',
          licence: 'Unsplash License',
          sourceUrl: 'https://picsum.photos',
          ...(await renderRenditions(buf, key, cdnBase)),
        };
        fetched++;
        saveCache(cache);
        process.stdout.write('o');
      }
      continue;
    }

    for (let i = 0; i < missing.length; i++) {
      const story = missing[i]!;
      const hit = hits[i % hits.length]!;
      try {
        await sleep(PAUSE_MS);
        const res = await politeFetch(hit.url);
        if (!res.ok) throw new Error(`http ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const key = createHash('sha256').update(story.slug).digest('hex').slice(0, 12);
        const rendered = await renderRenditions(buf, key, cdnBase);

        cache[story.slug] = {
          key,
          credit: `${hit.author} / Wikimedia Commons`,
          licence: hit.licence,
          sourceUrl: hit.descriptionUrl,
          ...rendered,
        };
        fetched++;
        saveCache(cache);
        process.stdout.write('.');
      } catch (e) {
        failed++;
        process.stdout.write('x');
      }
    }
  }

  if (fetched > 0) process.stdout.write('\n');
  saveCache(cache);

  console.log(`  ${fetched} fetched, ${reused} already cached, ${failed} without an image`);
  return cache;
}

/* Standalone run. */
if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-demo-images.ts')) {
  const cdn = process.env.CDN_BASE_URL ?? '/media';
  const stockOnly = process.argv.includes('--stock');
  console.log(
    stockOnly
      ? 'filling remaining stories from the placeholder photograph service'
      : 'fetching demonstration photographs from Wikimedia Commons',
  );
  console.log('every file is freely licensed and is stored with its credit\n');
  // Not top-level await: tsx compiles these scripts to CommonJS, where it is
  // unavailable.
  void fetchAll(cdn, stockOnly)
    .then(() => console.log('\ndone — media/commons-cache.json holds the credits and licences'))
    .catch((e: unknown) => {
      console.error('\nfetch failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
