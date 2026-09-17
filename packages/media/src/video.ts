import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { MAX_VIDEO_DURATION_S } from '@saar/schemas';
import { flatBlurHash } from './blurHash.js';

/**
 * Transcoding an uploaded clip into the three renditions the player chooses
 * between.  Contract §5, "video encoding pipeline".
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * The renditions in the demo corpus were produced by a seed script against
 * stock footage. Nothing produced them for an upload, so a real newsroom would
 * have had ONE file served to every device — which on a weak connection is the
 * difference between video that plays and video that stalls. The player has
 * always chosen a rendition; there was simply never more than one to choose.
 *
 * ── Why execFile and not a wrapper library ──────────────────────────────────
 *
 * ffmpeg-static ships the binary and nothing else, which is the whole appeal:
 * the arguments below are the documented ones, visible, and debuggable by
 * pasting them into a terminal. A wrapper would add a dependency and a layer
 * between the code and the thing that is actually hard.
 *
 * Promisified rather than sync, because this runs inside a server: a 60-second
 * clip at three renditions blocks the event loop for long enough to stall every
 * other request if it is done synchronously.
 */

const run = promisify(execFile);

/**
 * The ladder.
 *
 * Three heights rather than a continuous range, because the client picks by
 * connection class (metered / Data Saver / Wi-Fi) and a fourth step adds
 * encoding time without giving that decision anything new to choose.
 *
 * Level 3.1 and yuv420p are the compatibility floor: older Android hardware
 * decoders refuse anything higher, and a clip that will not decode is worse
 * than one that is slightly too large.
 */
export const VIDEO_LADDER = [
  { quality: 'low' as const, height: 640, bitrate: '400k', audio: '48k' },
  { quality: 'medium' as const, height: 960, bitrate: '900k', audio: '64k' },
  { quality: 'high' as const, height: 1280, bitrate: '1600k', audio: '96k' },
];

export interface TranscodedRendition {
  quality: 'low' | 'medium' | 'high';
  filename: string;
  width: number;
  height: number;
  bytes: number;
}

export interface TranscodedVideo {
  durationSeconds: number;
  posterFilename: string;
  posterBlurHash: string;
  renditions: TranscodedRendition[];
}

export class VideoRejected extends Error {
  constructor(
    message: string,
    readonly reason: 'unreadable' | 'too_long' | 'no_duration',
  ) {
    super(message);
    this.name = 'VideoRejected';
  }
}

function ffmpegBinary(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary for this platform.');
  return ffmpegPath as unknown as string;
}

async function ffmpeg(args: string[]): Promise<void> {
  await run(ffmpegBinary(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * How long the clip is.
 *
 * ffprobe is not shipped with ffmpeg-static, so this reads the duration out of
 * ffmpeg's own stderr during a null-muxer pass. Slower than ffprobe and one
 * fewer dependency to install on the server.
 */
export async function probeDuration(file: string): Promise<number> {
  const parse = (text: string): number => {
    const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  };

  // Read stderr from BOTH paths. A null mux over a readable file exits ZERO
  // and still prints the duration to stderr; only a file ffmpeg cannot open
  // exits non-zero. Reading stderr only from the failure branch — which is the
  // obvious way to write this — reports every valid video as unreadable.
  try {
    const { stderr } = await run(ffmpegBinary(), ['-hide_banner', '-i', file, '-f', 'null', '-'], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return parse(stderr.toString());
  } catch (e) {
    return parse((e as { stderr?: string | Buffer }).stderr?.toString() ?? '');
  }
}

/** Crop the centre to 9:16 against whichever dimension binds, then scale. */
const verticalFilter = (h: number): string =>
  `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${Math.round((h * 9) / 16 / 2) * 2}:${h},setsar=1`;

/**
 * Source clip in, three vertical MP4s and a poster out.
 *
 * Landscape footage loses its edges, which is what every vertical-video product
 * does and is why shorts are shot for it — a letterboxed landscape clip with
 * bars top and bottom reads as a mistake rather than as a format.
 */
export async function transcodeShort(srcPath: string, outDir: string): Promise<TranscodedVideo> {
  const duration = await probeDuration(srcPath);
  if (duration <= 0) {
    throw new VideoRejected('That file could not be read as a video.', 'unreadable');
  }
  if (duration > MAX_VIDEO_DURATION_S) {
    throw new VideoRejected(
      `The clip is ${Math.round(duration)}s. Shorts are capped at ${MAX_VIDEO_DURATION_S}s — past that the data cost stops being something a reader can absorb without noticing.`,
      'too_long',
    );
  }

  await mkdir(outDir, { recursive: true });

  const renditions: TranscodedRendition[] = [];
  for (const r of VIDEO_LADDER) {
    const filename = `${r.height}.mp4`;
    const out = join(outDir, filename);
    await ffmpeg([
      '-i', srcPath,
      '-vf', verticalFilter(r.height),
      '-c:v', 'libx264',
      '-profile:v', 'main',
      // Baseline-friendly level so older Android hardware decoders accept it.
      '-level', '3.1',
      '-preset', 'veryfast',
      '-b:v', r.bitrate,
      '-maxrate', r.bitrate,
      '-bufsize', `${parseInt(r.bitrate, 10) * 2}k`,
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
      filename,
      width: Math.round((r.height * 9) / 16 / 2) * 2,
      height: r.height,
      bytes: (await stat(out)).size,
    });
  }

  // Poster from one second in: frame zero is often a fade from black.
  const posterRaw = join(outDir, 'poster-raw.png');
  await ffmpeg([
    '-ss', String(Math.min(1, duration / 2)),
    '-i', srcPath,
    '-frames:v', '1',
    '-vf', verticalFilter(1280),
    posterRaw,
  ]);

  const posterFilename = 'poster.jpg';
  const poster = await sharp(await readFile(posterRaw))
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
  await sharp(poster).toFile(join(outDir, posterFilename));

  const { data } = await sharp(poster)
    .resize(1, 1, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // The raw frame is an intermediate, not an output. Leaving it behind doubles
  // the storage every short costs for a file nothing ever serves.
  await unlink(posterRaw).catch(() => undefined);

  return {
    durationSeconds: Math.round(duration),
    posterFilename,
    posterBlurHash: flatBlurHash(data[0] ?? 128, data[1] ?? 128, data[2] ?? 128),
    renditions,
  };
}
