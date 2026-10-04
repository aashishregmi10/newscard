import { ImageRejected, processImage, storeImage } from '@saar/media';
import { FeedFetchError, politeGet } from '@saar/worker';

/**
 * Bringing a publisher's photograph into a draft, when a lead is promoted.
 *
 * ── When ────────────────────────────────────────────────────────────────────
 *
 * Only on promote, only when the publisher's licence says `images`, and only
 * for the one story an editor chose. Never for every lead the collector finds:
 * most are dismissed, and copying forty photographs to keep one would be forty
 * copies of somebody else's work we had no use for.
 *
 * ── How ─────────────────────────────────────────────────────────────────────
 *
 * Fetched with the collector's own manners (politeGet), then through exactly
 * the pipeline an editor's upload takes — the 640-pixel floor, the 16:9 crop,
 * the three renditions and the blurhash — so a publisher's photo and an
 * uploaded one are indistinguishable to everything downstream, and the
 * composer can replace or remove it the same way.
 *
 * Credited to the publisher by name with the `publisher_licensed` licence: the
 * credit is what the licence obliges us to print, and it is set here, at the
 * one moment we know where the picture came from.
 *
 * ── Failure ─────────────────────────────────────────────────────────────────
 *
 * Never fatal. A missing, slow, oversized or too-small photo leaves the draft
 * without one and says why in words; the story is the product, the picture is
 * not.
 */

/** A news photograph at full resolution is rarely over five; fifteen is slack. */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 10_000;

export interface ImportedPhoto {
  credit: string;
  licence: 'publisher_licensed';
  sourceUrl: string;
  blurHash: string;
  width: number;
  height: number;
  urls: { sm: string; md: string; lg: string };
}

export type PhotoImport = { ok: true; image: ImportedPhoto } | { ok: false; reason: string };

export async function importPublisherPhoto(
  url: string,
  credit: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<PhotoImport> {
  let bytes: Uint8Array;
  try {
    const res = await politeGet(url, {
      accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8',
      maxBytes: MAX_PHOTO_BYTES,
      timeoutMs: PHOTO_TIMEOUT_MS,
      ...(options.fetchImpl && { fetchImpl: options.fetchImpl }),
    });
    const type = res.headers.get('content-type') ?? '';
    if (type !== '' && !type.startsWith('image/')) {
      return { ok: false, reason: `Their photo link returned ${type.split(';')[0]}, not an image.` };
    }
    bytes = res.bytes;
  } catch (e) {
    if (e instanceof FeedFetchError) {
      return {
        ok: false,
        reason:
          e.reason === 'timeout'
            ? 'Their server took too long to send the photo.'
            : e.reason === 'too_large'
              ? 'Their photo is larger than 15 MB.'
              : `Their server would not send the photo (${e.message})`,
      };
    }
    return { ok: false, reason: 'Their photo could not be fetched.' };
  }

  try {
    const stored = await storeImage(await processImage(Buffer.from(bytes)));
    return {
      ok: true,
      image: {
        credit,
        licence: 'publisher_licensed',
        sourceUrl: url,
        blurHash: stored.blurHash,
        width: stored.width,
        height: stored.height,
        urls: stored.urls,
      },
    };
  } catch (e) {
    /* ImageRejected carries an editor-readable reason, the same one an upload
       would show — "The image is 480px wide; cards need at least 640px". */
    if (e instanceof ImageRejected) return { ok: false, reason: e.message };
    return { ok: false, reason: 'Their photo could not be processed.' };
  }
}
