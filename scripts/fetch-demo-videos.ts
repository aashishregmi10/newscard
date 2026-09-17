/**
 * Sample shorts for the video tab.
 *
 * Same rule as the photographs: we hold no licence to anyone's news footage, and
 * a demonstration is not a reason to relax that. Wikimedia Commons carries real
 * Nepal footage under CC-BY and CC-BY-SA with a named author, and the API
 * returns the licence with the file — so each clip is stored WITH its credit,
 * and the publish gate that blocks unlicensed media is satisfied honestly.
 *
 * Commons serves .ogv and .webm. Neither plays reliably on iOS, so every clip is
 * transcoded to H.264/AAC in an MP4 container, which is the one format both
 * platforms have hardware decoders for. That transcode is also where the shorts
 * format is imposed: cropped to 9:16, trimmed, and encoded at three bitrates.
 *
 * Run: npm run media:videos
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
// One implementation, in @saar/media. The copy that used to live here read
// ffmpeg’s stderr only from the FAILURE path — but a null mux over a readable
// file exits zero, so it returned 0 for every valid video. The `|| want.seconds`
// fallback below is what hid it.
import { probeDuration } from '@saar/media';
import sharp from 'sharp';
import { DEMO_VIDEOS } from './seedVideosData.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(ROOT, 'media');
const CACHE = join(MEDIA, 'video-cache.json');
const TMP = join(MEDIA, '.tmp');

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'NEWSCARD-demo-seed/1.0 (development fixtures; contact via repository)';

/** Commons throttles anonymous callers. One search per subject, spaced. */
const PAUSE_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Three bitrates, all vertical.
 *
 * `low` exists for Data Saver and for the connection that cannot carry
 * anything else — 360x640 at 400 kbps is watchable and costs about 1 MB for
 * twenty seconds, which is a number a reader on a metered plan can absorb.
 */
const LADDER = [
  { quality: 'low' as const, height: 640, bitrate: '400k', audio: '48k' },
  { quality: 'medium' as const, height: 960, bitrate: '900k', audio: '64k' },
  { quality: 'high' as const, height: 1280, bitrate: '1600k', audio: '96k' },
];

export interface FetchedVideo {
  key: string;
  credit: string;
  licence: string;
  sourceUrl: string;
  durationSeconds: number;
  posterUrl: string;
  posterBlurHash: string;
  renditions: Array<{
    quality: 'low' | 'medium' | 'high';
    url: string;
    width: number;
    height: number;
    bytes: number;
  }>;
}

type Cache = Record<string, FetchedVideo>;

/* ── Commons ────────────────────────────────────────────────────────────── */

interface Hit {
  title: string;
  url: string;
  descriptionUrl: string;
  author: string;
  licence: string;
  width: number;
  height: number;
  bytes: number;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function acceptableLicence(raw: string): boolean {
  const l = raw.toLowerCase();
  if (!l || l.includes('fair use') || l.includes('non-free') || l.includes('nc-')) return false;
  return l.includes('cc0') || l.includes('public domain') || l.includes('cc by') || l.includes('cc-by');
}

async function politeFetch(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180_000) });
  if (res.status === 429 && attempt < 5) {
    const after = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 3000 * 2 ** attempt);
    return politeFetch(url, attempt + 1);
  }
  return res;
}

async function searchVideos(query: string): Promise<Hit[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:video ${query}`,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
  });

  await sleep(PAUSE_MS);
  const res = await politeFetch(`${API}?${params}`);
  if (!res.ok) return [];

  const body = (await res.json()) as { query?: { pages?: Record<string, Record<string, unknown>> } };
  const pages = body.query?.pages;
  if (!pages) return [];

  const hits: Hit[] = [];
  for (const page of Object.values(pages)) {
    const info = (page.imageinfo as Array<Record<string, unknown>> | undefined)?.[0];
    if (!info) continue;
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
    const licence = stripHtml(meta.LicenseShortName?.value ?? '');
    if (!acceptableLicence(licence)) continue;

    const bytes = Number(info.size ?? 0);
    // A 800 MB source would take longer to download than the whole demo is
    // worth. Anything over 60 MB is skipped rather than waited on.
    if (bytes > 150 * 1024 * 1024 || bytes < 80 * 1024) continue;

    hits.push({
      title: String(page.title ?? ''),
      url: String(info.url ?? ''),
      descriptionUrl: String(info.descriptionurl ?? ''),
      author: stripHtml(meta.Artist?.value ?? '') || 'Wikimedia Commons contributor',
      licence,
      width: Number(info.width ?? 0),
      height: Number(info.height ?? 0),
      bytes,
    });
  }
  return hits;
}

/* ── transcode ──────────────────────────────────────────────────────────── */

function ffmpeg(args: string[]): void {
  execFileSync(ffmpegPath as unknown as string, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}


/**
 * Source clip in, three vertical MP4s and a poster out.
 *
 * `crop` takes the centre of the frame at 9:16. Landscape footage loses its
 * edges, which is what every vertical-video product does and is why shorts are
 * shot for it — a letterboxed landscape clip with bars top and bottom looks
 * like a mistake rather than a format.
 */
function renderShort(
  src: string,
  key: string,
  startAt: number,
  seconds: number,
  cdnBase: string,
): Omit<FetchedVideo, 'key' | 'credit' | 'licence' | 'sourceUrl'> {
  const dir = join(MEDIA, 'v', key);
  mkdirSync(dir, { recursive: true });

  const vf = (h: number) =>
    // Crop the centre to 9:16 against whichever dimension binds, then scale.
    `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${Math.round((h * 9) / 16 / 2) * 2}:${h},setsar=1`;

  const renditions: FetchedVideo['renditions'] = [];
  for (const r of LADDER) {
    const out = join(dir, `${r.height}.mp4`);
    ffmpeg([
      '-ss', String(startAt),
      '-t', String(seconds),
      '-i', src,
      '-vf', vf(r.height),
      '-c:v', 'libx264',
      '-profile:v', 'main',
      // Baseline-friendly level so older Android hardware decoders accept it.
      '-level', '3.1',
      '-preset', 'veryfast',
      '-b:v', r.bitrate,
      '-maxrate', r.bitrate,
      '-bufsize', String(parseInt(r.bitrate) * 2) + 'k',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', r.audio,
      '-ac', '2',
      // Moves the index to the front so playback can start before the whole
      // file has arrived. Without it a short buffers for its entire length.
      '-movflags', '+faststart',
      out,
    ]);
    renditions.push({
      quality: r.quality,
      url: `${cdnBase}/v/${key}/${r.height}.mp4`,
      width: Math.round((r.height * 9) / 16 / 2) * 2,
      height: r.height,
      bytes: statSync(out).size,
    });
  }

  // Poster from one second in: frame zero is often a fade from black.
  const posterRaw = join(dir, 'poster-raw.png');
  ffmpeg(['-ss', String(startAt + 1), '-i', src, '-frames:v', '1', '-vf', vf(1280), posterRaw]);

  return {
    durationSeconds: seconds,
    posterUrl: `${cdnBase}/v/${key}/poster.jpg`,
    posterBlurHash: '',
    renditions,
  };
}

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
function encode83(value: number, length: number): string {
  let out = '';
  for (let i = 1; i <= length; i++) out += B83[Math.floor(value / 83 ** (length - i)) % 83];
  return out;
}

/* ── orchestration ──────────────────────────────────────────────────────── */

function loadCache(): Cache {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

function saveCache(c: Cache): void {
  mkdirSync(MEDIA, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

/**
 * Git Bash on Windows rewrites a bare leading-slash argument into a Windows
 * path, so `CDN_BASE_URL=/media` arrives as "C:/Program Files/Git/media" and
 * every URL written to the cache is nonsense. It is silent, and the symptom is
 * media that 404s on the phone while the JSON looks plausible.
 */
function normaliseCdnBase(raw: string): string {
  const trimmed = raw.replace(/[\\/]+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Anything that ends in a "media" segment is the relative base we intended,
  // however many drive letters the shell prepended on the way here.
  if (/[\\/]media$/i.test(trimmed) || trimmed === 'media') return '/media';
  return trimmed;
}

export async function fetchAllVideos(rawCdnBase: string): Promise<Cache> {
  const cdnBase = normaliseCdnBase(rawCdnBase);
  const cache = loadCache();
  mkdirSync(TMP, { recursive: true });

  // One search per distinct query, results shared across the shorts that use it.
  const byQuery = new Map<string, typeof DEMO_VIDEOS>();
  for (const v of DEMO_VIDEOS) {
    const list = byQuery.get(v.searchQuery) ?? [];
    list.push(v);
    byQuery.set(v.searchQuery, list);
  }

  let made = 0;
  let reused = 0;
  let failed = 0;

  for (const [query, wanted] of byQuery) {
    const missing = wanted.filter((v) => !cache[v.slug]);
    reused += wanted.length - missing.length;
    if (missing.length === 0) continue;

    let hits: Hit[] = [];
    try {
      hits = await searchVideos(query);
    } catch {
      hits = [];
    }
    if (hits.length === 0) {
      console.log(`  no usable footage for "${query}" (${missing.length})`);
      failed += missing.length;
      continue;
    }

    for (let i = 0; i < missing.length; i++) {
      const want = missing[i]!;
      const hit = hits[i % hits.length]!;
      const key = createHash('sha256').update(want.slug).digest('hex').slice(0, 12);
      const tmp = join(TMP, `${key}-src`);

      try {
        const res = await politeFetch(hit.url);
        if (!res.ok) throw new Error(`http ${res.status}`);
        writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));

        const total = await probeDuration(tmp);
        // Start a little in, and never ask for more than the source holds.
        const startAt = total > want.seconds + 4 ? 2 : 0;
        const seconds = Math.max(6, Math.min(want.seconds, Math.floor(total - startAt) || want.seconds));

        const rendered = renderShort(tmp, key, startAt, seconds, cdnBase);

        // Poster: crushed to JPEG and given an average colour, exactly as the
        // still images are, so the client has one placeholder path.
        const dir = join(MEDIA, 'v', key);
        const raw = join(dir, 'poster-raw.png');
        await sharp(raw).jpeg({ quality: 76, progressive: true }).toFile(join(dir, 'poster.jpg'));
        const { data } = await sharp(raw).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
        const blur =
          encode83(0, 1) +
          encode83(0, 1) +
          encode83(((data[0] ?? 128) << 16) + ((data[1] ?? 128) << 8) + (data[2] ?? 128), 4);

        cache[want.slug] = {
          key,
          credit: `${hit.author} / Wikimedia Commons`,
          licence: hit.licence,
          sourceUrl: hit.descriptionUrl,
          ...rendered,
          posterBlurHash: blur,
        };
        made++;
        saveCache(cache);
        process.stdout.write('.');
      } catch (e) {
        failed++;
        process.stdout.write('x');
        void e;
      }
    }
  }

  if (made > 0) process.stdout.write('\n');
  saveCache(cache);
  console.log(`  ${made} encoded, ${reused} already cached, ${failed} without footage`);
  return cache;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-demo-videos.ts')) {
  const cdn = process.env.CDN_BASE_URL ?? '/media';
  console.log('fetching CC-licensed footage from Wikimedia Commons and encoding vertical shorts');
  console.log('every clip is stored with its photographer and licence\n');
  void fetchAllVideos(cdn)
    .then(() => console.log('\ndone — media/video-cache.json holds the credits'))
    .catch((e: unknown) => {
      console.error('\nfailed:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
