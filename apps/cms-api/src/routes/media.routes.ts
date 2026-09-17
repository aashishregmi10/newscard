import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { AppError } from '@saar/shared';
import { ImageLicenceEnum } from '@saar/schemas';
import {
  processImage,
  storeImage,
  transcodeShort,
  describeStoredVideo,
  videoWorkDir,
  newMediaKey,
  ImageRejected,
  VideoRejected,
} from '@saar/media';
import { rateLimit, byIp } from '@saar/http';
import { requireAuth, requireRole } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Editorial media upload.  Contract §4 — "image attachment, and video upload".
 *
 * ── What was missing ────────────────────────────────────────────────────────
 *
 * The composer had no way to attach anything. Every image in the system got
 * there by running a seed script against a stock photo library, and every video
 * likewise. A newsroom could write a story and could not illustrate it.
 *
 * ── Why the licence is required at upload and not at publish ────────────────
 *
 * Publishing already refuses an article whose image has no recognised licence,
 * and that check stays. But discovering it at publish means an editor finishes
 * a story and is then told the picture cannot be used — with no memory of where
 * it came from. Asking at the moment the file is chosen is the only point where
 * the person still knows the answer.
 *
 * ── Memory ──────────────────────────────────────────────────────────────────
 *
 * Images are held in memory, which is fine at a few megabytes. Video is written
 * straight to a temporary file: ffmpeg works on paths, and buffering a
 * 90-second clip to hand it back to disk anyway would be pure overhead on a
 * server sized for a newsroom rather than a video platform.
 */

export const mediaRoutes = Router();

mediaRoutes.use(requireAuth);

/** Generous per editor, tight enough that a broken client cannot fill a disk. */
const uploadLimit = rateLimit({
  name: 'cmsupload',
  limit: 60,
  windowMs: 60 * 60_000,
  key: byIp,
  message: 'Too many uploads. Try again shortly.',
});

const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_BYTES, files: 1 },
});

/**
 * POST /cms/media/image
 *
 * Returns the stored renditions. It does NOT attach them to an article — the
 * composer holds the result and saves it with the rest of the draft, so an
 * upload that the editor then abandons leaves an orphaned key rather than a
 * half-edited story.
 */
mediaRoutes.post(
  '/cms/media/image',
  requireRole('article.write'),
  uploadLimit,
  imageUpload.single('file'),
  asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError('BAD_REQUEST', 'No file was uploaded.');

    const credit = String(req.body?.credit ?? '').trim();
    const licence = String(req.body?.licence ?? '').trim();

    if (!credit) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A credit is required. It is what the licence obliges us to print, and it cannot be reconstructed later.',
      );
    }
    const parsedLicence = ImageLicenceEnum.safeParse(licence);
    if (!parsedLicence.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Choose a licence. Publishing refuses an image without a recognised one, and this is the last moment anyone knows which it is.`,
        { allowed: ImageLicenceEnum.options },
      );
    }

    let stored;
    try {
      stored = await storeImage(await processImage(file.buffer));
    } catch (e) {
      if (e instanceof ImageRejected) throw new AppError('VALIDATION_FAILED', e.message);
      throw e;
    }

    await writeAudit({
      action: 'media.image.upload',
      entityType: 'media',
      entityId: stored.key,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { licence: parsedLicence.data, bytes: file.size, originalName: file.originalname },
      ip: req.ip ?? null,
    });

    res.status(201).json({
      image: {
        credit,
        licence: parsedLicence.data,
        blurHash: stored.blurHash,
        width: stored.width,
        height: stored.height,
        urls: stored.urls,
      },
    });
  }),
);

/**
 * POST /cms/media/video
 *
 * Transcodes to the three renditions the player chooses between. Synchronous,
 * and deliberately so at this size: an editor uploading one clip wants to know
 * it worked, and a job queue whose failures surface somewhere else is a worse
 * answer for a newsroom publishing a handful of shorts a day. A 60-second clip
 * takes a few seconds at `veryfast`.
 *
 * When that stops being true, the change is a queue in front of
 * `transcodeShort` — the function itself does not change.
 */
mediaRoutes.post(
  '/cms/media/video',
  requireRole('article.write'),
  uploadLimit,
  videoUpload.single('file'),
  asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError('BAD_REQUEST', 'No file was uploaded.');

    const credit = String(req.body?.credit ?? '').trim();
    if (!credit) {
      throw new AppError('VALIDATION_FAILED', 'A credit is required for video, as for images.');
    }

    const key = newMediaKey();
    // ffmpeg reads from a path, so the upload lands in a temporary file first.
    const scratch = await mkdtemp(join(tmpdir(), 'saar-upload-'));
    const srcPath = join(scratch, 'source');

    try {
      await writeFile(srcPath, file.buffer);
      const transcoded = await transcodeShort(srcPath, videoWorkDir(key));
      const stored = describeStoredVideo(key, transcoded);

      await writeAudit({
        action: 'media.video.upload',
        entityType: 'media',
        entityId: key,
        actorId: req.staff!.staffId,
        actorEmail: req.staff!.email,
        before: null,
        after: {
          durationSeconds: stored.durationSeconds,
          bytes: file.size,
          originalName: file.originalname,
        },
        ip: req.ip ?? null,
      });

      res.status(201).json({ video: { ...stored, credit } });
    } catch (e) {
      if (e instanceof VideoRejected) throw new AppError('VALIDATION_FAILED', e.message);
      throw e;
    } finally {
      // The source is an intermediate. Leaving it behind fills the disk with
      // originals nothing serves.
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }),
);
