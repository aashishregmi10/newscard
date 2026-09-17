# 1. Structure

> **Verdict: strong, with one hole.** The dependency graph is real and mechanically enforced. The
> hole is that the largest consumer sits outside it.

---

## The standard

Structure is judged by two questions, and neither is about folder names.

**Can you tell where a change goes?** In a well-structured system, a new requirement has an obvious
home, and two engineers asked independently would put it in the same place. This is what layering
buys — not tidiness, but agreement.

**Does a change stay where you put it?** A change that requires touching four unrelated files was
mis-housed, and a boundary that is only a convention will be crossed the first time crossing it is
convenient. The distinction between a codebase with structure and one with a diagram of structure is
whether the compiler, the linter or the build enforces the boundary. Documentation does not.

Everything else — hexagonal, clean, onion, whatever it is called this year — is a restatement of the
same two questions.

---

## Where SAAR is strong

### The dependency graph is enforced, not described

`schemas → shared → db → apps`, one-way, with no app importing another. That is stated in the
README, which proves nothing. What proves it is `tsconfig.base.json` setting `composite: true` and
every package declaring explicit `references` — so the direction is checked by `tsc -b` on every
build and in CI.

The convincing evidence is what happened when the rule was put under pressure. The CMS needed the
rate limiter that already existed in `apps/api`. The easy move is an import across apps. Instead the
counter primitive moved *down* to
[`packages/db/src/rateCounter.ts:42`](../../packages/db/src/rateCounter.ts), and each server kept a
thin Express adapter over it. That is the architecture doing its job: the rule made the easy thing
impossible and the resulting design is better than the shortcut would have been.

Most codebases have a stated dependency direction and at least one violation nobody has noticed.
This one does not — I looked.

### Pure core, imperative shell — with the seam in the right place

[`notificationGate.ts:101`](../../packages/shared/src/notificationGate.ts) decides whether a given
device may receive a given notification. It is pure, takes an injected clock, touches no database,
and carries 27 tests. [`dispatch.ts`](../../apps/worker/src/dispatch.ts) is the part that has a
database: it loads devices, calls the gate, sends, and writes back.

The seam is placed thoughtfully. The gate takes `sentToday` as an *input* — it does not compute it.
Computing it requires knowing what "today" means in Nepal and whether the stored counter is stale,
which is the caller's problem, solved in `effectiveSentToday` at
[`dispatch.ts:80`](../../apps/worker/src/dispatch.ts). A less careful design would have pushed the
date arithmetic into the gate and made the whole thing untestable without a clock and a database.

This is the single most reusable idea in the codebase: **policy is pure and testable; the part that
knows about I/O is thin and boring.**

### One definition, three artifacts

A collection is defined once in `packages/schemas`, and the TypeScript type, the public DTO and the
MongoDB `$jsonSchema` validator all derive from it. Two whole defect classes become structurally
impossible: a new field cannot leak into an API response on the day it is added, and the database
validator cannot drift from the application.

The DTO mapper at [`articleCard.dto.ts:12`](../../apps/api/src/dto/articleCard.dto.ts) picks fields
explicitly rather than serialising the document and deleting unwanted keys. Its comment names the
field that would have leaked first — `editorialNotes` — and a test in `@saar/schemas` asserts the
key set. A blacklist would have been three lines shorter and wrong forever.

### Entry points are thin

`createApp()` at [`app.ts:29`](../../apps/api/src/app.ts) builds the Express application and returns
it; `server.ts` does the environment parsing, the database connection and `listen()`. This is why
`app.test.ts` can mount the whole API in-process without a port. It is a small thing that is
routinely got wrong, and getting it wrong makes integration testing so awkward that people stop.

### The exceptions are documented and enforced

`apps/mobile` and `apps/cms-web` are deliberately not workspaces. The reason is written down —
Metro resolves modules by walking up from the project root, and a hoisted install gives it two
copies of React — and it is *enforced* by `metro.config.js` confining resolution to that directory,
not merely hoped for.

Most codebases have accidental structure. This one has a considered exception with a rationale and a
mechanism. That is the difference between a decision and a situation.

---

## Where SAAR is weak

### ⚠️ High — the source of truth is not the source of truth for mobile

`apps/mobile` is 5,678 lines of TypeScript — the largest single application here, and larger than the public API and the CMS API combined. It cannot import
`@saar/schemas`, because of the workspace decision above. So
[`client.ts:58`](../../apps/mobile/src/api/client.ts) hand-declares `Card`, a duplicate of
`ArticleCardDto` at [`article.ts:119`](../../packages/schemas/src/article.ts).

They match today. Nothing checks that they will tomorrow. Concretely, all of these pass typecheck,
lint and CI while being wrong:

- the server adds a field → mobile silently never reads it
- the server changes `pullQuote` to non-nullable → mobile keeps a dead null check
- the server changes `publishedAt` to nullable → mobile crashes on a real card, in production, on
  a handset you cannot reach

The last one is the one to worry about, because the DTO leak test protects the server's *output*
shape and nothing protects mobile's *assumption* about it.

This is worth dwelling on as a general lesson: **a good decision (keep Metro sane) grew a bad
consequence (an unchecked contract), and the consequence arrived silently, later, in a different
file.** That is how real systems acquire holes. Not through bad decisions — through good ones whose
second-order effects nobody revisited.

### ⚠️ Medium — `apps/cms-web` is outside the type graph

The root `tsconfig.json` has project references to `shared`, `schemas`, `db`, `api`, `worker` and
`cms-api`. Not `cms-web`. So `npm run typecheck` at the root **does not check the editorial
frontend at all** — it is checked only by its own `npm run build`, which until recently nothing ran.

CI now has a job for it, so the gap is closed at the gate. But the local command still lies: a
developer running `npm run typecheck` and seeing it pass has not checked 1,501 lines.

### ⚠️ Medium — two middleware stacks, already drifting

`apps/api/src/middleware/index.ts` and `apps/cms-api/src/middleware/index.ts` both define
`requestId`, `sanitizeMongo`, `errorHandler`, `notFoundHandler` and `asyncRoute`, near-identically.

They have already diverged. The API's `errorHandler` handles a 413 with the message *"Request body
is too large."*; the CMS's falls through to the generic *"The request was malformed."* Nobody
decided that. It is the normal fate of copied code: the copies are equal on the day they are made
and never again.

The `sanitizeMongo` duplication is the one that matters, because it is a security control. Two
copies of a security control means a fix applied to one and not the other, and no test will tell
you.

### ⚠️ Medium — configuration discipline is asymmetric

`apps/api` parses its environment through a Zod schema at
[`config/index.ts`](../../apps/api/src/config/index.ts) and fails at boot with a readable message
naming the bad variable. `apps/cms-api` reads `process.env` inline —
`Number(process.env.CMS_PORT ?? 3001)` at [line 33](../../apps/cms-api/src/server.ts) — and finds
out about problems later, as `NaN` or `undefined` somewhere unhelpful.

The first approach is clearly right and is already written. The second exists because nobody ported
it, not because anyone decided the CMS deserved less.

A symptom of the same laxity: `SESSION_SECRET` is documented in `.env.example` as a required secret
and is **never read by any code**. Sessions use `randomBytes(32)` per session, which is correct —
but a required-looking secret that does nothing teaches people to ignore the file it lives in.

### ℹ️ Low — the worker is a library pretending to be a worker

`dispatchNotification` is called inline from the HTTP request that composes a notification. The
comment in [`worker/src/index.ts`](../../apps/worker/src/index.ts) says so explicitly and explains
why: at this scale the editor should see the real outcome rather than "queued".

That reasoning is right. The gap is that nothing measures when it stops being right. A send to a
hundred thousand devices cannot sit inside an HTTP request, and the failure mode is a gateway
timeout mid-dispatch with half the devices updated. There is no metric, alert, or even a logged
duration that would tell you the threshold is approaching.

### ℹ️ Low — `scripts/` is a drawer

Fourteen files: seeds, media fetchers, an Atlas migration, a dependency check, the mobile launcher.
Some are one-shot, some are routine, some are CI gates. No subdivision, no convention about which
are safe to re-run. `check-forbidden-deps.ts` is a CI gate and `migrate-to-atlas.ts` is a one-time
operation, and nothing in the layout distinguishes them.

This is the least important finding here, and it is the kind of thing that is trivial to fix now and
annoying in a year.

---

## What to change

1. **Close the mobile contract gap** (P1). Two options, in order of preference:
   - *Generate* `apps/mobile/src/api/types.ts` from `@saar/schemas` via a script in `scripts/`,
     run in CI, with the output committed so Metro never needs the workspace. A day's work, and it
     makes the drift impossible rather than detectable.
   - *Or* a contract test in `packages/schemas/src/__tests__/` that imports mobile's `Card` by
     relative path and asserts the key sets and nullability agree. An afternoon, and it catches
     drift at CI rather than preventing it.
2. **Add `cms-web` to the root project references**, or rename the script so `npm run typecheck`
   stops implying a completeness it does not have.
3. **Extract the shared Express middleware.** It cannot go in `@saar/shared` (that package must not
   depend on Express). A fourth small package — `@saar/http` — is the honest answer, and the
   `rateCounter` precedent shows the team is willing to create one when the rule demands it.
4. **Port the Zod env schema to `cms-api`**, and delete `SESSION_SECRET` from `.env.example`.
5. **Log the dispatch duration and device count** so the inline-send threshold is observable before
   it is exceeded.
