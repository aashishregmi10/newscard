import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { collections, getDb } from '@newscard/db';
import { AppError, NOTIF_DAILY_CAP_MAX } from '@newscard/shared';
import { LanguageEnum, PlatformEnum, clampDailyCap } from '@newscard/schemas';
import { asyncRoute } from '../middleware/index.js';
import { deviceRegisterLimit } from '../middleware/rateLimit.js';

/**
 * Device registration and notification preferences.  Spec Ch. 6.7.
 *
 * `deviceId` is a UUID the app generates and stores locally. It is NEVER
 * derived from a hardware identifier — not the advertising ID, not the Android
 * ID, not the IMEI. That is what lets the permission table in Ch. 15.2 be
 * honest, and why the app requests no identifier permissions at all.
 */

export const deviceRoutes = Router();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const RegisterSchema = z.object({
  deviceId: z.string().uuid(),
  platform: PlatformEnum,
  appVersion: z.string().min(1).max(32),
  osVersion: z.string().max(64).nullable().optional(),
  fcmToken: z.string().min(1).max(512).nullable().optional(),
  langPrefs: z.array(LanguageEnum).min(1),
});

const NotifPatchSchema = z.object({
  notif: z
    .object({
      enabled: z.boolean().optional(),
      channels: z
        .object({
          breaking: z.boolean().optional(),
          digest: z.boolean().optional(),
          categories: z.boolean().optional(),
        })
        .optional(),
      dailyCap: z.number().optional(),
    })
    .optional(),
  langPrefs: z.array(LanguageEnum).min(1).optional(),
  fcmToken: z.string().min(1).max(512).nullable().optional(),
});

/** Bearer token → the device it belongs to. Constant-time comparison. */
async function authenticateDevice(req: Request, deviceId: string) {
  const auth = req.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED');

  const token = auth.slice(7);
  const device = await collections(getDb()).devices.findOne({ deviceId });
  if (!device) throw new AppError('NOT_FOUND');

  const a = Buffer.from(sha256(token), 'utf8');
  const b = Buffer.from(device.tokenHash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('UNAUTHENTICATED');

  return device;
}

/**
 * POST /v1/devices — idempotent upsert keyed on deviceId.
 *
 * Called on first launch and whenever the FCM token rotates. Returns a bearer
 * token whose SHA-256 is all we store: a database dump must not yield working
 * credentials.
 */
deviceRoutes.post(
  '/devices',
  deviceRegisterLimit,
  asyncRoute(async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid device registration.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const c = collections(getDb());
    const { deviceId, platform, appVersion, osVersion, fcmToken, langPrefs } = parsed.data;

    const token = `dt_${randomBytes(32).toString('base64url')}`;
    const now = new Date();

    const existing = await c.devices.findOne({ deviceId });

    // Defaults live here and in the schema. `categories` is OFF: it is the
    // channel most likely to generate volume, and a reader who has not asked
    // for topical alerts should not receive them (Ch. 10.2).
    const defaults = {
      enabled: true,
      channels: { breaking: true, digest: true, categories: false },
      dailyCap: NOTIF_DAILY_CAP_MAX,
      sentToday: 0,
      lastSentAt: null,
    };

    await c.devices.updateOne(
      { deviceId },
      {
        $set: {
          tokenHash: sha256(token),
          platform,
          appVersion,
          osVersion: osVersion ?? null,
          fcmToken: fcmToken ?? null,
          langPrefs,
          lastSeenAt: now,
          updatedAt: now,
          // Preserve preferences the reader already chose; a reinstall of the
          // same deviceId should not silently re-enable anything.
          ...(existing ? {} : { notif: defaults }),
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    const saved = await c.devices.findOne({ deviceId });

    res.status(existing ? 200 : 201).json({
      deviceToken: token,
      notif: saved?.notif ?? defaults,
    });
  }),
);

/** PATCH /v1/devices/:deviceId — notification preferences. */
deviceRoutes.patch(
  '/devices/:deviceId',
  asyncRoute(async (req, res) => {
    const deviceId = String(req.params.deviceId ?? '');
    const device = await authenticateDevice(req, deviceId);

    const parsed = NotifPatchSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Invalid preferences.');

    const set: Record<string, unknown> = { updatedAt: new Date(), lastSeenAt: new Date() };
    const n = parsed.data.notif;

    if (n?.enabled !== undefined) set['notif.enabled'] = n.enabled;
    if (n?.channels?.breaking !== undefined) set['notif.channels.breaking'] = n.channels.breaking;
    if (n?.channels?.digest !== undefined) set['notif.channels.digest'] = n.channels.digest;
    if (n?.channels?.categories !== undefined) {
      set['notif.channels.categories'] = n.channels.categories;
    }
    // Clamped, not rejected — and the response reports what was actually
    // stored, so a client asking for 9 can see it received 3 (Ch. 6.7.2).
    if (n?.dailyCap !== undefined) set['notif.dailyCap'] = clampDailyCap(n.dailyCap);
    if (parsed.data.langPrefs) set.langPrefs = parsed.data.langPrefs;
    if (parsed.data.fcmToken !== undefined) set.fcmToken = parsed.data.fcmToken;

    await collections(getDb()).devices.updateOne({ _id: device._id }, { $set: set });
    const saved = await collections(getDb()).devices.findOne({ _id: device._id });

    res.json({ ok: true, notif: saved?.notif, langPrefs: saved?.langPrefs });
  }),
);
