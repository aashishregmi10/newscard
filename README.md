# SAAR

Bilingual short-form news for the Nepali market. Nepali (Devanagari) and English in one feed,
each card attributed to its publisher, designed for entry-level Android on metered data.

> **`SAAR` is a working codename, not a settled product name.** It cannot be fixed until the
> summary-length experiment (Gate 2, below) concludes — a brand built around a specific word count
> would be invalidated if that count changes. Use it in code and package names; treat every
> user-visible string as provisional.
>
> The repository directory is still `newscard`, and that earlier codename survives in a few
> internal identifiers (the CMS session cookie, the CSRF header value, the CI test database name).
> They are deliberately left alone: renaming a cookie and the header that must match it is a
> two-sided change with no user-visible benefit.

The behavioural specification of record is the NEWSCARD Technical Specification (19 chapters),
held outside this repository. This README covers only how to run the code. Where the two disagree,
the spec wins and the code is wrong.

---

## Status

| Area | State |
|---|---|
| `packages/shared` | Cursor codec, grapheme/Devanagari utilities, clustering, errors, RBAC, the notification send gate |
| `packages/schemas` | Full Chapter 3 data model in Zod, DTO whitelist, state machine, Mongo validators |
| `packages/db` | Client, typed collections, index sync, validators, rate counters |
| `apps/api` | Feed, videos, categories, deep links, devices, read events, ad serving and measurement, crash intake, health |
| `apps/cms-api` | Sessions, RBAC, the editorial queue, create/edit/transition/publish/retract, notification sending, crash view |
| `apps/cms-web` | Login, queue, composer, new story, notification composer |
| `apps/worker` | Notification dispatch over Expo Push. Ingestion is **blocked on Gate 1** (see below) |
| `apps/mobile` | Expo app: feed, category rail, article, shorts, saved, settings, offline cache, notifications |

**192 tests passing** across 12 files. `npm run typecheck`, `npm run lint` and
`npm run check:forbidden` are clean, and CI runs all four on every push.

---

## Prerequisites

- Node 20+ (developed on 25)
- npm 10+ (this repo uses **npm workspaces**, not pnpm — see *Tooling notes*)
- A MongoDB: Atlas, a local install, or the bundled Docker stack. **Docker is not required.**

## Getting started

```bash
npm install
cp .env.example .env     # then fill in MONGO_URI and the two secrets
npm run db:init          # indexes and validators
npm run db:seed          # demonstration corpus
npm test
```

Then, in separate terminals:

```bash
npm run dev:api          # public read API      → http://localhost:3000
npm run dev:cms          # editorial backend    → http://localhost:3001
npm run dev:cms-web      # editorial frontend   → http://localhost:5173
npm run mobile           # Expo / Metro         → port 8082
```

`npm run mobile` is the **only** supported way to start the app. Never run `npx expo` from the
repository root — see `apps/mobile/RUNNING.md` for what breaks and why.

### Transactions are optional

`infra/docker-compose.dev.yml` will run MongoDB as a single-node replica set if you want one, but
nothing requires it. Publishing uses a transaction where the deployment offers one and a
compare-and-swap where it does not, so a standalone `mongod` — or an Atlas free tier — is enough.
The read API warns and continues; the CMS warns and continues.

### Notifications

Push needs a development build: Expo Go removed remote push on Android in SDK 53, and the app
detects that and disables the feature rather than failing silently. See `apps/mobile/eas.json`.
Sending is done from the CMS (**Notifications** in the top bar), and the send gate — daily cap,
minimum gap, quiet hours, per-channel and per-language consent — is enforced server-side in
`packages/shared/src/notificationGate.ts` before anything is dispatched.

---

## Layout

```
apps/
  api/        public read API          → api.saar.np
  cms-api/    editorial backend        → cms.saar.np (separate host, on purpose)
  cms-web/    editorial frontend
  worker/     notification dispatch; ingestion when Gate 1 clears
  mobile/     Expo React Native
packages/
  schemas/    Zod models — SINGLE SOURCE OF TRUTH for the data model
  shared/     cursor, grapheme/Devanagari, clustering, errors, permissions, the send gate
  db/         Mongo client, collections, indexes, validators, rate counters
infra/        docker-compose (optional)
scripts/      seed, media generation, checks, migrations
docs/         commercial documents
media/        generated demonstration images and video (gitignored)
```

Dependency direction is one-way: `schemas → shared → db → apps`. **No app imports another app** —
which is why the rate-limit counter lives in `packages/db` and each server keeps its own thin
Express adapter over it.

`apps/mobile` and `apps/cms-web` are deliberately **not** npm workspaces. Each keeps its own
`node_modules` and lockfile: Metro resolves modules by walking up from the project root, and a
hoisted install gives it two copies of React to choose between. CI therefore installs and checks
them in their own jobs.

### The single source of truth

Each collection is defined **once** in `packages/schemas`, and the TypeScript type, the public DTO,
and the MongoDB `$jsonSchema` validator are all derived from it. Two defect classes become
structurally impossible: a new field cannot leak into an API response on the day it is added, and
the database validator cannot drift from the application.

---

## The four critical modules

A bug in any of these is a severity-1 incident rather than a defect. They should not be changed
without review.

| Module | Invariant |
|---|---|
| `shared/src/cursor.ts` | Pagination never duplicates or skips a card, including same-millisecond publishes |
| `shared/src/grapheme.ts` | Devanagari is measured in grapheme clusters, never code points |
| `shared/src/notificationGate.ts` | The notification daily cap cannot be exceeded |
| `cms-api/src/services/publish.service.ts` | Only a licensed, reviewed story can reach the feed |

Source licensing is currently enforced at story creation and at publication in
`cms-api`. When automated ingestion arrives it gains a third enforcement point in `worker`, and
that module joins this table.

---

## Two gates before this ships

Neither needs code. Both can reshape or end the project, so they run in parallel with development.

**Gate 1 — publisher licensing.** We summarise other organisations' reporting and link back. That
is only sustainable with their agreement. Contact five publishers; if none agree, the aggregation
model is dead and the product pivots to original micro-reporting.
*Blocks:* automated ingestion only. Everything else is buildable meanwhile, because the CMS
supports manual entry — which is the MVP content strategy anyway.

**Gate 2 — does 60 words work in Devanagari?** The number is inherited from an English-language
product. Summarise five real articles in exactly 60 Nepali words by hand and see whether the facts
survive. The data model already stores a per-language limit in `config.summaryLimits`, so whatever
the answer is, it lands without a migration.

---

## Deliberate exclusions

Enforced mechanically by `npm run check:forbidden`, which fails on any of these appearing
**transitively**:

- **No advertising, attribution, or session-replay SDK.** Year one has no monetisation.
- **No LLM or ML runtime, no vector database.** The MVP has no model in the pipeline. Summaries are
  written by a person. Cross-source clustering is lexical (token overlap + proper-noun overlap +
  time decay), which at this scale is more accurate than embeddings and, unlike them, explainable.

The point of the check is not that these libraries are bad. It is that their presence invites
someone to switch them on before a baseline exists to measure against.

Crash reporting is first-party for the same reason: reports go to `POST /v1/client-errors` on our
own API, and are readable only through the CMS behind a staff session.

---

## Tooling notes

**npm workspaces, not pnpm.** The plan called for pnpm, but neither pnpm nor corepack is installed
on the development machine, and a global install seemed the wrong thing to do unprompted. npm
workspaces are adequate here. Switching later is: delete `node_modules`, add `pnpm-workspace.yaml`,
`pnpm install`. The trade-off accepted meanwhile is no strict linking, so an undeclared
(phantom) dependency will not be caught.

**Known dependency debt.** `npm audit` reports a moderate advisory in `qs`, reached through
Express 4. It is fixed in `qs@6.16.0`, which Express 4 does not allow; the real remedy is Express 5,
whose breaking change (`req.query` becomes a getter) the middleware is already written to survive.
Vitest 2 also carries advisories that Vitest 3 fixes. Neither is urgent, and both are version bumps
that deserve their own change rather than riding along with a feature.
