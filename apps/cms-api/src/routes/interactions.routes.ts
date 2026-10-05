import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import {
  collections,
  countInteractionResults,
  getDb,
  interactionCollections,
  interactionPhase,
  type InteractionDoc,
} from '@saar/db';
import { AppError, interactionProblems } from '@saar/shared';
import { InteractionInput, OptionId, type InteractionOption } from '@saar/schemas';
import { requireAuth } from '../auth/requireAuth.js';
import { asyncRoute } from '../middleware/index.js';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Interactions in the editorial site: star ratings and votes, made here and
 * answered by readers in the app's feed.
 *
 * ── The life of one ─────────────────────────────────────────────────────────
 *
 *   draft   everything can change. It can be deleted.
 *   live    published. Its businesses or candidates, their names and photos are
 *           LOCKED: a vote's result must mean what readers voted on, so
 *           changing a candidate after the first vote would make the result a
 *           lie. Only the closing date can move, or it can be closed now.
 *   closed  by an editor, or by its closing date passing. Final results.
 *
 * Every change is audited. The rules an Interaction must meet are
 * `interactionProblems` (@saar/shared), which the editorial site restates so
 * the editor sees them on the field; here they are enforced.
 */

export const interactionRoutes = Router();
interactionRoutes.use(requireAuth);

const PER_PAGE = 10;
const TABS = ['live', 'drafts', 'closed'] as const;

const ListQuery = z.object({
  tab: z.enum(TABS).default('live'),
  page: z.coerce.number().int().min(1).default(1),
});

const LivePatch = z.object({ closesAt: z.string().datetime({ offset: true }).nullable() }).strict();

function tabFilter(tab: (typeof TABS)[number], now: Date): Record<string, unknown> {
  if (tab === 'drafts') return { status: 'draft' };
  if (tab === 'closed') {
    return { $or: [{ status: 'closed' }, { status: 'live', closesAt: { $ne: null, $lte: now } }] };
  }
  return { status: 'live', $or: [{ closesAt: null }, { closesAt: { $gt: now } }] };
}

const iso = (d: Date | null | undefined) => (d instanceof Date ? d.toISOString() : null);

async function toRow(d: InteractionDoc, now: Date) {
  return {
    id: String(d._id),
    type: d.type,
    status: d.status,
    phase: interactionPhase(d, now),
    language: d.language,
    categorySlug: d.categorySlug,
    title: d.title,
    options: d.options,
    opensAt: iso(d.opensAt),
    closesAt: iso(d.closesAt),
    publishedAt: iso(d.publishedAt),
    closedAt: iso(d.closedAt),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    results: await countInteractionResults(getDb(), d),
  };
}

function newOptionId(): string {
  return randomBytes(5).toString('hex');
}

/**
 * Check what the editor sent and turn it into what is stored. Throws the
 * rules' own words, field by field, so the site can put each on its field.
 */
async function prepare(body: unknown) {
  const parsed = InteractionInput.safeParse(body);
  if (!parsed.success) {
    throw new AppError('BAD_REQUEST', 'That is not an Interaction the editor could have sent.', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const v = parsed.data;
  const problems = interactionProblems({
    type: v.type,
    title: v.title,
    options: v.options.map((o) => ({ name: o.name, detail: o.detail, image: o.image })),
    opensAt: v.opensAt,
    closesAt: v.closesAt,
  });
  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', problems[0]!.message, { problems });
  }

  if (v.categorySlug !== null) {
    const category = await collections(getDb()).categories.findOne({ slug: v.categorySlug });
    if (!category) {
      throw new AppError('VALIDATION_FAILED', `No such section: ${v.categorySlug}.`, {
        problems: [{ field: 'categorySlug', message: 'No such section.' }],
      });
    }
  }

  /* Keep an option's id when the editor sent one, so a re-save of a draft does
     not reshuffle them; give new ones fresh ids. */
  const used = new Set<string>();
  const options: InteractionOption[] = v.options.map((o) => {
    let id = o.id !== undefined && OptionId.safeParse(o.id).success && !used.has(o.id) ? o.id : newOptionId();
    while (used.has(id)) id = newOptionId();
    used.add(id);
    const detail = o.detail?.trim() ?? '';
    return {
      id,
      name: o.name.trim().replace(/\s+/g, ' '),
      detail: detail === '' ? null : detail,
      image: o.image === null ? null : { ...o.image, credit: o.image.credit.trim() },
    };
  });

  return {
    type: v.type,
    language: v.language,
    categorySlug: v.categorySlug,
    title: v.title.trim().replace(/\s+/g, ' '),
    options,
    opensAt: v.opensAt === null ? null : new Date(v.opensAt),
    closesAt: v.closesAt === null ? null : new Date(v.closesAt),
  };
}

async function findOr404(idParam: unknown): Promise<InteractionDoc> {
  const id = String(idParam ?? '');
  if (!ObjectId.isValid(id)) throw new AppError('NOT_FOUND', 'No such Interaction.');
  const doc = await interactionCollections(getDb()).interactions.findOne({ _id: new ObjectId(id) });
  if (!doc) throw new AppError('NOT_FOUND', 'No such Interaction.');
  return doc;
}

/** GET /cms/interactions?tab=live|drafts|closed&page= — with results and tab counts. */
interactionRoutes.get(
  '/cms/interactions',
  asyncRoute(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Unknown tab.');
    const { tab, page } = parsed.data;
    const now = new Date();
    const { interactions } = interactionCollections(getDb());

    const sort: Record<string, 1 | -1> =
      tab === 'drafts' ? { updatedAt: -1, _id: -1 } : tab === 'closed' ? { closesAt: -1, closedAt: -1, _id: -1 } : { opensAt: -1, _id: -1 };
    const [total, docs, live, drafts, closed] = await Promise.all([
      interactions.countDocuments(tabFilter(tab, now)),
      interactions
        .find(tabFilter(tab, now))
        .sort(sort)
        .skip((page - 1) * PER_PAGE)
        .limit(PER_PAGE)
        .toArray(),
      interactions.countDocuments(tabFilter('live', now)),
      interactions.countDocuments(tabFilter('drafts', now)),
      interactions.countDocuments(tabFilter('closed', now)),
    ]);

    res.json({
      items: await Promise.all(docs.map((d) => toRow(d, now))),
      total,
      perPage: PER_PAGE,
      counts: { live, drafts, closed },
    });
  }),
);

/** GET /cms/interactions/:id */
interactionRoutes.get(
  '/cms/interactions/:id',
  asyncRoute(async (req, res) => {
    res.json({ interaction: await toRow(await findOr404(req.params.id), new Date()) });
  }),
);

/** POST /cms/interactions — a new draft. */
interactionRoutes.post(
  '/cms/interactions',
  asyncRoute(async (req, res) => {
    const fields = await prepare(req.body);
    const now = new Date();
    const doc = {
      ...fields,
      status: 'draft' as const,
      publishedAt: null,
      closedAt: null,
      createdBy: req.staff!.staffId,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await interactionCollections(getDb()).interactions.insertOne(doc as never);

    await writeAudit({
      action: 'interaction.create',
      entityType: 'interaction',
      entityId: String(insertedId),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: null,
      after: { type: fields.type, title: fields.title, options: fields.options.length },
      ip: req.ip ?? null,
    });

    res.status(201).json({ interaction: await toRow({ ...doc, _id: insertedId } as InteractionDoc, now) });
  }),
);

/**
 * PATCH /cms/interactions/:id
 *
 * A draft: replaced with what was sent, checked like a new one. Live: only
 * the closing date — everything a reader has answered stays as they saw it.
 */
interactionRoutes.patch(
  '/cms/interactions/:id',
  asyncRoute(async (req, res) => {
    const before = await findOr404(req.params.id);
    const now = new Date();
    const { interactions } = interactionCollections(getDb());
    let set: Record<string, unknown>;

    if (before.status === 'draft') {
      set = { ...(await prepare(req.body)), updatedAt: now };
    } else if (before.status === 'live') {
      const parsed = LivePatch.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          'INVALID_TRANSITION',
          'This Interaction is live: readers have answered what they saw, so only its closing date can change.',
        );
      }
      const closesAt = parsed.data.closesAt === null ? null : new Date(parsed.data.closesAt);
      if (before.type === 'vote' && closesAt === null) {
        throw new AppError('VALIDATION_FAILED', 'A vote needs a closing date.', {
          problems: [{ field: 'closesAt', message: 'A vote needs a closing date.' }],
        });
      }
      if (closesAt !== null && closesAt.getTime() <= now.getTime()) {
        throw new AppError('VALIDATION_FAILED', 'Pick a closing date in the future, or press Close now.', {
          problems: [{ field: 'closesAt', message: 'Pick a date in the future, or press Close now.' }],
        });
      }
      set = { closesAt, updatedAt: now };
    } else {
      throw new AppError('INVALID_TRANSITION', 'This Interaction is closed. Its results are final.');
    }

    await interactions.updateOne({ _id: before._id }, { $set: set });
    const after = (await interactions.findOne({ _id: before._id }))!;

    await writeAudit({
      action: 'interaction.update',
      entityType: 'interaction',
      entityId: String(before._id),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { title: before.title, options: before.options.length, closesAt: iso(before.closesAt) },
      after: { title: after.title, options: after.options.length, closesAt: iso(after.closesAt) },
      ip: req.ip ?? null,
    });

    res.json({ interaction: await toRow(after, now) });
  }),
);

/** POST /cms/interactions/:id/publish — live in the app, its options locked. */
interactionRoutes.post(
  '/cms/interactions/:id/publish',
  asyncRoute(async (req, res) => {
    const doc = await findOr404(req.params.id);
    if (doc.status !== 'draft') {
      throw new AppError('INVALID_TRANSITION', doc.status === 'live' ? 'Already live.' : 'This Interaction is closed.');
    }
    const problems = interactionProblems({
      type: doc.type,
      title: doc.title,
      options: doc.options,
      opensAt: iso(doc.opensAt),
      closesAt: iso(doc.closesAt),
    });
    if (problems.length > 0) throw new AppError('VALIDATION_FAILED', problems[0]!.message, { problems });

    const now = new Date();
    if (doc.closesAt !== null && doc.closesAt.getTime() <= now.getTime()) {
      throw new AppError('VALIDATION_FAILED', 'Its closing date has already passed. Move it later first.', {
        problems: [{ field: 'closesAt', message: 'This date has passed.' }],
      });
    }

    const { interactions } = interactionCollections(getDb());
    /* Guarded on status, so two editors pressing Publish publish it once. */
    const r = await interactions.updateOne(
      { _id: doc._id, status: 'draft' },
      { $set: { status: 'live', publishedAt: now, opensAt: doc.opensAt ?? now, updatedAt: now } },
    );
    if (r.modifiedCount === 0) throw new AppError('INVALID_TRANSITION', 'Already live.');

    await writeAudit({
      action: 'interaction.publish',
      entityType: 'interaction',
      entityId: String(doc._id),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'draft' },
      after: { status: 'live', opensAt: iso(doc.opensAt ?? now), closesAt: iso(doc.closesAt) },
      ip: req.ip ?? null,
    });

    res.json({ interaction: await toRow((await interactions.findOne({ _id: doc._id }))!, now) });
  }),
);

/** POST /cms/interactions/:id/close — no more answers; the results are final. */
interactionRoutes.post(
  '/cms/interactions/:id/close',
  asyncRoute(async (req, res) => {
    const doc = await findOr404(req.params.id);
    if (doc.status !== 'live') {
      throw new AppError('INVALID_TRANSITION', doc.status === 'draft' ? 'A draft is not open yet.' : 'Already closed.');
    }
    const now = new Date();
    const { interactions } = interactionCollections(getDb());
    await interactions.updateOne(
      { _id: doc._id, status: 'live' },
      { $set: { status: 'closed', closedAt: now, updatedAt: now } },
    );

    await writeAudit({
      action: 'interaction.close',
      entityType: 'interaction',
      entityId: String(doc._id),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { status: 'live' },
      after: { status: 'closed' },
      ip: req.ip ?? null,
    });

    res.json({ interaction: await toRow((await interactions.findOne({ _id: doc._id }))!, now) });
  }),
);

/** DELETE /cms/interactions/:id — drafts only; a live one is closed instead. */
interactionRoutes.delete(
  '/cms/interactions/:id',
  asyncRoute(async (req, res) => {
    const doc = await findOr404(req.params.id);
    if (doc.status !== 'draft') {
      throw new AppError(
        'INVALID_TRANSITION',
        'Only a draft can be deleted. A published Interaction keeps its results; close it instead.',
      );
    }
    await interactionCollections(getDb()).interactions.deleteOne({ _id: doc._id, status: 'draft' });

    await writeAudit({
      action: 'interaction.delete',
      entityType: 'interaction',
      entityId: String(doc._id),
      actorId: req.staff!.staffId,
      actorEmail: req.staff!.email,
      before: { title: doc.title, type: doc.type },
      after: null,
      ip: req.ip ?? null,
    });

    res.status(204).end();
  }),
);
