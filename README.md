# NEWSCARD

Bilingual short-form news for the Nepali market. Nepali (Devanagari) and English in one feed,
each card attributed to its publisher, designed for entry-level Android on metered data.

> **`NEWSCARD` is a working codename, not the product name.** It cannot be chosen until the
> summary-length experiment (Gate 2, below) concludes — a brand built around a specific word count
> would be invalidated if that count changes. Use it in code and package names; never in a
> user-visible string.

The behavioural specification of record is **`docs/NEWSCARD-Technical-Specification.docx`**
(19 chapters). This README covers only how to run the code. Where the two disagree, the spec wins
and the code is wrong.

---

## Status

| Area | State |
|---|---|
| `packages/shared` | Cursor codec, grapheme/Devanagari utilities, clustering, errors, RBAC — **79 tests passing** |
| `packages/schemas` | Full Chapter 3 data model in Zod, DTO whitelist, state machine, Mongo validators |
| `packages/db` | Not started |
| `apps/api` | Not started |
| `apps/cms-api` / `cms-web` | Not started |
| `apps/worker` | **Blocked on Gate 1** (see below) |
| `apps/mobile` | Not started |

---

## Prerequisites

- Node 20+ (developed on 25)
- Docker Desktop
- npm 10+ (this repo uses **npm workspaces**, not pnpm — see *Tooling notes*)

## Getting started

```bash
npm install
npm run db:up      # mongo (single-node replica set), minio, mailhog
npm test
npm run typecheck
```

### Why the replica set matters

`infra/docker-compose.dev.yml` runs MongoDB as a **single-node replica set**, initiated
automatically by the healthcheck. This is not optional: the publish flow uses a transaction, and
MongoDB transactions require a replica set. A standalone `mongod` fails at runtime with
*"Transaction numbers are only allowed on a replica set member"*, which reads like an application
bug and is not.

---

## Layout

```
apps/
  api/        public read API          → api.newscard.np
  cms-api/    editorial backend        → cms.newscard.np (separate host, on purpose)
  cms-web/    editorial frontend
  worker/     ingestion + scheduled jobs
  mobile/     Expo React Native
packages/
  schemas/    Zod models — SINGLE SOURCE OF TRUTH for the data model
  shared/     cursor, grapheme/Devanagari, clustering, errors, permissions
  db/         Mongo client, collections, indexes, migrations
infra/        docker-compose, Dockerfiles
scripts/      seed, checks, backfills
docs/         the specification
```

Dependency direction is one-way: `schemas → shared → db → apps`. No app imports another app.

### The single source of truth

Each collection is defined **once** in `packages/schemas`, and the TypeScript type, the public DTO,
and the MongoDB `$jsonSchema` validator are all derived from it. Two defect classes become
structurally impossible: a new field cannot leak into an API response on the day it is added, and
the database validator cannot drift from the application.

---

## The four critical modules

A bug in any of these is a severity-1 incident rather than a defect. They carry 100% branch
coverage and should not be changed without review.

| Module | Invariant |
|---|---|
| `shared/src/cursor.ts` | Pagination never duplicates or skips a card, including same-millisecond publishes |
| `shared/src/grapheme.ts` | Devanagari is measured in grapheme clusters, never code points |
| `worker/src/ingest/selectSources.ts` | Only licensed sources are ever ingested |
| `worker/src/notify/sendGate.ts` | The notification daily cap cannot be exceeded |

---

## Two gates before this ships

Neither needs code. Both can reshape or end the project, so they run in parallel with development.

**Gate 1 — publisher licensing.** We summarise other organisations' reporting and link back. That
is only sustainable with their agreement. Contact five publishers; if none agree, the aggregation
model is dead and the product pivots to original micro-reporting.
*Blocks:* `apps/worker` only. Everything else is buildable meanwhile, because the CMS supports
manual entry — which is the MVP content strategy anyway.

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

---

## Tooling notes

**npm workspaces, not pnpm.** The plan called for pnpm, but neither pnpm nor corepack is installed
on the development machine, and a global install seemed the wrong thing to do unprompted. npm
workspaces are adequate here. Switching later is: delete `node_modules`, add `pnpm-workspace.yaml`,
`pnpm install`. The trade-off accepted meanwhile is no strict linking, so an undeclared
(phantom) dependency will not be caught.
