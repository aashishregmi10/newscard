import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError, channelFor, isQuietHours, nextQuietWindowEnd } from '@saar/shared';
import { LanguageEnum, NotificationTypeEnum } from '@saar/schemas';
import { dispatchNotification, isValidPushToken, sendPush } from '@saar/worker';
import { requireRole, requireAuth } from '../auth/requireRole.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Composing and sending notifications.  Spec Ch. 10.
 *
 * The send itself is synchronous. An editor who presses Send needs to know what
 * happened — how many went, how many the gate stopped and why — and "queued"
 * tells them nothing they can act on. At a hundred thousand devices this stops
 * being reasonable and a queue goes in front of dispatchNotification; nothing
 * about this route changes when it does.
 *
 * Every rule about who receives what lives in the gate (@saar/shared). This
 * file composes copy, writes a record, and reports the outcome.
 */

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth);

const LocalisedInput = z.object({
  ne: z.string().min(1, 'Nepali copy is required').max(160),
  en: z.string().min(1, 'English copy is required').max(160),
});

/**
 * Both languages, always.
 *
 * A device tells us which languages its reader accepts, and the gate refuses to
 * send copy in a language they have not asked for. Allowing a single-language
 * notification would therefore not reach half the audience — it would look like
 * a delivery problem, and it would be an editorial one.
 */
const ComposeSchema = z.object({
  type: NotificationTypeEnum,
  articleId: z.string().optional().nullable(),
  title: LocalisedInput,
  body: LocalisedInput,
  audience: z
    .object({
      languages: z.array(LanguageEnum).min(1).default(['ne', 'en']),
      categories: z.array(z.string()).default([]),
    })
    .default({ languages: ['ne', 'en'], categories: [] }),
});

/**
 * GET /cms/notifications/targets — everything the compose form needs.
 *
 * The device summary is here rather than in a separate diagnostics screen
 * because the commonest reason a send appears to do nothing is that no handset
 * has a push token yet. An editor should be able to see that BEFORE they write
 * the copy, not infer it afterwards from a zero.
 */
notificationRoutes.get(
  '/cms/notifications/targets',
  requireRole('notification.send'),
  asyncRoute(async (_req, res) => {
    const c = collections(getDb());

    const [articles, devices] = await Promise.all([
      c.articles
        .find({ status: 'published' })
        .sort({ publishedAt: -1 })
        .limit(40)
        .project({ slug: 1, headline: 1, language: 1, categorySlug: 1, publishedAt: 1 })
        .toArray(),
      c.devices.find({}).project({ platform: 1, fcmToken: 1, langPrefs: 1, notif: 1 }).toArray(),
    ]);

    const withToken = devices.filter((d) => isValidPushToken(d.fcmToken as string | null));

    const now = new Date();
    res.json({
      articles: articles.map((a) => ({
        id: a._id.toString(),
        slug: a.slug,
        headline: a.headline,
        language: a.language,
        categorySlug: a.categorySlug,
        publishedAt: (a.publishedAt as Date | null)?.toISOString() ?? null,
      })),
      devices: {
        total: devices.length,
        withToken: withToken.length,
        notifEnabled: devices.filter((d) => d.notif?.enabled).length,
      },
      /** Surfaced so the CMS can warn before a send, not explain after one. */
      quietHours: {
        active: isQuietHours(now),
        opensAt: isQuietHours(now) ? nextQuietWindowEnd(now).toISOString() : null,
      },
    });
  }),
);

/** GET /cms/notifications — what has been sent, most recent first. */
notificationRoutes.get(
  '/cms/notifications',
  requireRole('notification.send'),
  asyncRoute(async (_req, res) => {
    const docs = await collections(getDb())
      .notifications.find({})
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();

    res.json({
      items: docs.map((d) => ({
        id: d._id.toString(),
        type: d.type,
        title: d.title,
        deepLink: d.deepLink,
        audience: d.audience,
        sentAt: d.sentAt ? (d.sentAt as Date).toISOString() : null,
        stats: d.stats,
        // Until receipts are reconciled, stats.delivered is the count Expo
        // ACCEPTED. The CMS needs to know which of the two it is showing, or it
        // repeats the overstatement in a nicer font.
        receiptsCheckedAt:
          (d as { receiptsCheckedAt?: Date | null }).receiptsCheckedAt?.toISOString() ?? null,
        dispatch: (d as { dispatch?: unknown }).dispatch ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  }),
);

/**
 * POST /cms/notifications — compose, record, send.
 *
 * The record is written BEFORE the send, not after. A dispatch that crashes
 * half way through must leave evidence that it was attempted; writing the row
 * afterwards means the one send worth investigating is the one with no row.
 */
notificationRoutes.post(
  '/cms/notifications',
  requireRole('notification.send'),
  asyncRoute(async (req, res) => {
    const parsed = ComposeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'This notification is not ready to send.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const c = collections(getDb());
    const { type, title, body, audience } = parsed.data;
    const articleId = parsed.data.articleId || null;

    let deepLink = 'saar://feed';
    let articleObjectId: ObjectId | null = null;

    if (articleId) {
      if (!ObjectId.isValid(articleId)) throw new AppError('BAD_REQUEST', 'Malformed article id.');
      const article = await c.articles.findOne({ _id: new ObjectId(articleId) });
      if (!article) throw new AppError('NOT_FOUND', 'That story no longer exists.');

      // A notification is a promise that there is something to read. Linking to
      // an unpublished story delivers a tap that lands on nothing, and the
      // reader has no way to tell that from a broken app.
      if (article.status !== 'published') {
        throw new AppError(
          'VALIDATION_FAILED',
          `That story is ${article.status}, not published — a notification would link to a card nobody can open.`,
          { status: article.status },
        );
      }

      articleObjectId = article._id;
      deepLink = `saar://article/${article.slug}`;
    } else if (type !== 'digest') {
      // Only a digest legitimately points at the feed as a whole. Everything
      // else is about a specific story, and sending it without one is almost
      // always a mistake in the form rather than an intention.
      throw new AppError(
        'VALIDATION_FAILED',
        `A ${type} notification needs a story to link to.`,
      );
    }

    const now = new Date();
    const _id = new ObjectId();

    await c.notifications.insertOne({
      _id,
      type,
      articleId: articleObjectId,
      title,
      body,
      deepLink,
      audience,
      sentAt: null,
      stats: { attempted: 0, delivered: 0, suppressed: 0 },
      createdBy: new ObjectId(req.staff!.staffId),
      createdAt: now,
      updatedAt: now,
    } as never);

    await writeAudit({
      action: 'notification.send',
      entityType: 'notification',
      entityId: _id.toString(),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { type, deepLink, audience, channel: channelFor(type) },
      ip: req.ip ?? null,
    });

    const report = await dispatchNotification(_id.toString());

    res.status(201).json({ id: _id.toString(), report });
  }),
);

/**
 * POST /cms/notifications/test — send to one named handset, bypassing the gate.
 *
 * ── Why this is allowed to bypass a severity-1 rule ─────────────────────────
 *
 * The gate exists to protect READERS from volume: the cap, the minimum gap and
 * quiet hours are all promises to someone who did not ask to be interrupted.
 * None of those promises are owed to the editor's own device, which they are
 * deliberately pointing at themselves to check that copy renders and that a tap
 * opens the right card.
 *
 * So the exemption is narrow and it is visible: exactly one device, named
 * explicitly by id — never "all", never a language, never a channel — no
 * notifications row, and an audit line every time. Without it the only way to
 * verify a send is to wait until 06:30, which is how untested copy ships.
 */
const TestSchema = z.object({
  deviceId: z.string().uuid('Enter the device id from the app’s Settings screen'),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(160),
  deepLink: z.string().min(1).default('saar://feed'),
});

notificationRoutes.post(
  '/cms/notifications/test',
  requireRole('notification.send'),
  asyncRoute(async (req, res) => {
    const parsed = TestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid test notification.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { deviceId, title, body, deepLink } = parsed.data;
    const device = await collections(getDb()).devices.findOne({ deviceId });
    if (!device) throw new AppError('NOT_FOUND', 'No device is registered with that id.');

    if (!isValidPushToken(device.fcmToken)) {
      // The single most common failure, and it is worth naming precisely: the
      // handset registered but never obtained a push token, which in practice
      // means Expo Go rather than a development build, or permission refused.
      throw new AppError(
        'VALIDATION_FAILED',
        'That device has registered but holds no push token. It needs a development build (Expo Go cannot receive push on Android) and notification permission granted.',
      );
    }

    const outcome = await sendPush([
      { deviceId, token: device.fcmToken, title, body, data: { type: 'test', deepLink } },
    ]);

    await writeAudit({
      action: 'notification.test',
      entityType: 'device',
      entityId: deviceId,
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { title, deepLink, accepted: outcome.accepted.length },
      ip: req.ip ?? null,
    });

    if (outcome.unregistered.length > 0) {
      await collections(getDb()).devices.updateOne(
        { deviceId },
        { $set: { fcmToken: null, updatedAt: new Date() } },
      );
      throw new AppError(
        'VALIDATION_FAILED',
        'Expo reports that device as no longer registered — the app was uninstalled, or the token has rotated. Its token has been cleared; reopen the app to register again.',
      );
    }

    if (outcome.failed.length > 0) {
      throw new AppError('BAD_REQUEST', outcome.failed[0]!.message);
    }

    res.json({ ok: true, accepted: outcome.accepted.length });
  }),
);
