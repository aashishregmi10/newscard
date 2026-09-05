import { createHash, timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '@newscard/db';
import { AppError } from '@newscard/shared';
import { AdEventTypeEnum, VIEWABLE_THRESHOLD_MS } from '@newscard/schemas';
import { asyncRoute } from '../middleware/index.js';
import { buildCampaignReport } from '../services/adReport.service.js';

export const adRoutes = Router();

const EventsSchema = z.object({
  events: z
    .array(
      z.object({
        campaignId: z.string().regex(/^[0-9a-f]{24}$/),
        type: AdEventTypeEnum,
        dwellMs: z.number().int().nonnegative().max(600_000),
        categorySlug: z.string().max(40),
        occurredAt: z.string().datetime().optional(),
      }),
    )
    .max(50),
  deviceId: z.string().uuid(),
});

/**
 * POST /v1/ads/events — batched ad measurement.
 *
 * Batched and fire-and-forget for the same reason as reading events: on a
 * metered connection, measurement must never cost the reader more than the
 * content does.
 */
adRoutes.post(
  '/ads/events',
  asyncRoute(async (req, res) => {
    const parsed = EventsSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Invalid ad events.');

    const db = getDb();
    const now = new Date();

    const docs = parsed.data.events.map((e) => ({
      campaignId: new ObjectId(e.campaignId),
      deviceId: parsed.data.deviceId,
      type: e.type,
      // Clamped: a phone left on a card overnight is not two hours of
      // attention, and letting it through would inflate median dwell.
      dwellMs: Math.min(e.dwellMs, 120_000),
      categorySlug: e.categorySlug,
      occurredAt: e.occurredAt ? new Date(e.occurredAt) : now,
    }));

    if (docs.length > 0) {
      await db.collection('adEvents').insertMany(docs);

      // Keep the denormalised counters on the campaign in step, so serving can
      // enforce the impression goal without aggregating the event collection
      // on every request.
      const byCampaign = new Map<string, { imp: number; view: number; click: number }>();
      for (const d of docs) {
        const key = d.campaignId.toString();
        const acc = byCampaign.get(key) ?? { imp: 0, view: 0, click: 0 };
        if (d.type === 'impression') {
          acc.imp++;
          if (d.dwellMs >= VIEWABLE_THRESHOLD_MS) acc.view++;
        } else if (d.type === 'click') {
          acc.click++;
        }
        byCampaign.set(key, acc);
      }

      for (const [id, acc] of byCampaign) {
        await db.collection('campaigns').updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: {
              'stats.impressions': acc.imp,
              'stats.viewableImpressions': acc.view,
              'stats.clicks': acc.click,
            },
          },
        );
      }
    }

    res.status(202).json({ received: docs.length });
  }),
);

/**
 * The report is the advertiser's own commercial data, and campaign ids are
 * public — every ad card in the feed carries one. So the endpoint is gated on a
 * per-campaign secret issued to that advertiser, compared in constant time
 * against a stored hash.
 *
 * Deliberately NOT a login: most advertisers here are small local businesses
 * who will be sent a link, and an account they must create is an account they
 * will not use. The token is revocable by rotating reportTokenHash.
 */
async function assertReportToken(
  header: string | undefined,
  campaignId: ObjectId,
): Promise<void> {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const campaign = await getDb()
    .collection('campaigns')
    .findOne({ _id: campaignId }, { projection: { reportTokenHash: 1 } });

  const stored = (campaign as { reportTokenHash?: string | null } | null)?.reportTokenHash;

  // A campaign with no token issued is not readable by anyone holding a link,
  // and a missing campaign is reported the same way as a wrong token — neither
  // should tell a stranger which campaign ids exist.
  if (!supplied || !stored) throw new AppError('UNAUTHENTICATED', 'A report token is required.');

  const a = createHash('sha256').update(supplied).digest();
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('UNAUTHENTICATED', 'A report token is required.');
  }
}

/**
 * GET /v1/ads/campaigns/:id/report — what the advertiser actually bought.
 *
 * Read-only and aggregate. Nothing here describes an individual reader.
 */
adRoutes.get(
  '/ads/campaigns/:id/report',
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) throw new AppError('BAD_REQUEST', 'Malformed campaign id.');

    await assertReportToken(req.header('authorization'), new ObjectId(id));

    const Query = z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    });
    const q = Query.safeParse(req.query);
    if (!q.success) throw new AppError('BAD_REQUEST', 'Invalid date range.');

    const to = q.data.to ?? new Date();
    const from = q.data.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const report = await buildCampaignReport(id, from, to);
    if (!report) throw new AppError('NOT_FOUND', 'No such campaign.');

    res.setHeader('Cache-Control', 'no-store');
    res.json(report);
  }),
);
