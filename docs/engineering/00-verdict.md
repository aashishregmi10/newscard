# SAAR engineering review — verdict

A critique of this codebase against four questions: how large applications are structured, what
clean maintainable code looks like, how edge cases are handled, and whether it meets the standards
expected of a production system in September 2026.

This is not a tutorial. It assumes the principles and spends its words on judgement. Every claim
cites a file and a line, and every number can be reproduced with a command given at the end.

**Read this file for the conclusion.** The four that follow are the working.

| | Document |
|---|---|
| 1 | [Structure](01-structure.md) — how the application is put together |
| 2 | [Clean code](02-clean-code.md) — what the code is like to change |
| 3 | [Edge cases](03-edge-cases.md) — what happens when reality misbehaves |
| 4 | [Standards](04-standards.md) — measured against current practice |

---

## Scorecard

| Topic | Verdict | One-line summary |
|---|---|---|
| Structure | **Strong, with one hole** | The dependency graph is real and enforced — but the single-source-of-truth claim breaks at the largest consumer |
| Clean code | **Strong** | Unusually good at recording *why*; the risk is prose drifting from code, which has already happened once |
| Edge cases | **Exceptional** | The best dimension of this codebase by a wide margin. Three promises are unkept, and they are unkept loudly |
| Standards | **Good, unevenly applied** | Security and type discipline are above the bar; test distribution and observability are below it |

The short version: **this codebase is written by someone who has been burned before and wrote down
why.** Its failures are not the usual ones. There is no SQL injection, no secret in git, no
`any` sprinkled to make the compiler quiet, no blacklist DTO. The weaknesses are subtler — a
contract held together by discipline instead of types, promises the system makes and does not keep,
and a test suite that is thorough exactly where the code is easiest to test.

---

## The headline finding

**The "single source of truth" is not the source of truth for the largest consumer.**

The README states, correctly, that each collection is defined once in `packages/schemas` and the
TypeScript type, the public DTO and the MongoDB validator are all derived from it. That holds for
`apps/api` and `apps/cms-api`.

It does not hold for `apps/mobile`, which is 5,678 lines of TypeScript — the largest single
application in this repository.
Mobile is deliberately not an npm workspace (Metro would otherwise resolve two copies of React), so
it cannot import `@saar/schemas`. Instead,
[`apps/mobile/src/api/client.ts:58`](../../apps/mobile/src/api/client.ts) declares its own `Card`
interface, a hand-maintained duplicate of `ArticleCardDto` at
[`packages/schemas/src/article.ts:119`](../../packages/schemas/src/article.ts).

They agree today, field for field. I checked. That is the problem: they agree because someone
remembered, and nothing fails if someone forgets. Add a field server-side and mobile silently
ignores it. Change `pullQuote` from `string | null` to `string` and mobile keeps a null check that
is now dead, or worse, the reverse. The compiler that guards every other boundary in this system is
absent at the busiest one.

This is a good architectural decision (keeping Metro sane) that grew a bad consequence, which is the
most common way real systems acquire holes. The fix is not to make mobile a workspace — that would
reintroduce the React problem. It is to generate the client types from the schemas, or to add a
contract test that fails when they diverge.

---

## What to change, in order

### P1 — the system claims things that are not true

Untrue claims are worse than missing features, because people act on them.

1. **Close the mobile contract gap.** Generate `client.ts` types from `@saar/schemas` at build
   time, or add a test that asserts `Card` and `ArticleCardDto` have identical shape. The test is
   an afternoon; the generator is a day and worth more.
2. **Deliver quiet-hours holds, or stop calling them holds.** The gate at
   [`notificationGate.ts:101`](../../packages/shared/src/notificationGate.ts) returns `deferUntil`
   for breaking news during quiet hours, documented as "held, not dropped". Nothing schedules the
   retry. Today those readers simply do not receive it. The CMS shows the count in red, so it is
   visible rather than hidden — but visible-and-broken is still broken.
3. **Reconcile receipts, or rename `delivered` to `accepted`.** `checkReceipts()` is written and
   exported in [`expoPush.ts`](../../apps/worker/src/push/expoPush.ts) and nothing calls it. The
   number the CMS shows as delivered means "Expo accepted the message". A delivery dashboard that
   always reads 100% is worse than none, because it is believed.

### P2 — risk concentrated where nothing is watching

4. **First tests on mobile.** Not coverage targets — three specific tests, in this order:
   `useFeed` paints from cache before the network resolves; cursor pagination does not duplicate at
   a page boundary; a notification tap routes correctly from cold start. These are the three places
   where a regression is invisible in review and obvious to a reader.
5. **Drain in-flight requests on shutdown.** Both servers call `server.close()` without awaiting
   its callback and then `process.exit(0)`
   ([`api/server.ts:34`](../../apps/api/src/server.ts),
   [`cms-api/server.ts`](../../apps/cms-api/src/server.ts)). Every request in flight is cut. On a
   rolling deploy this is a burst of failed reads for real users.
6. **Validate the CMS environment with Zod.** `apps/api` parses and validates env at boot and fails
   with a readable message; `apps/cms-api` reads raw `process.env` at
   [line 33](../../apps/cms-api/src/server.ts) and discovers problems later. The asymmetry is
   accidental, not principled.
7. **A logger that honours `LOG_LEVEL` — or delete the setting.** It is validated at
   [`config/index.ts:18`](../../apps/api/src/config/index.ts) and never read. All logging is
   `console.log`. The config promises a knob that does not exist.

### P3 — hygiene

8. **Express 5** (clears the outstanding `qs` advisory; the middleware is already written to
   survive `req.query` becoming a getter) and **Vitest 3** (clears a critical advisory).
9. **Deduplicate the two Express middleware stacks** before they drift further. They already have:
   the API's `errorHandler` grew a 413 message the CMS's did not.
10. **Accessibility pass** on the settings, feed and shorts screens, which carry no accessibility
    props at all.
11. **Delete the dead vocabulary**: `UPGRADE_REQUIRED` and `MAINTENANCE` error codes are defined and
    never constructed; `SESSION_SECRET` is documented in `.env.example` as required and never read
    by any code.

---

## Reproducing the evidence

Every number in these documents comes from one of these. Run them from the repository root.

```bash
# Test files by area — shows the concentration in pure packages
find apps packages -path "*__tests__*" -name "*.test.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" | sed 's#/src/.*##' | sort | uniq -c
```

```bash
# Directories with no tests at all
for d in apps/api apps/cms-api apps/cms-web apps/mobile apps/worker packages/shared packages/schemas packages/db; do n=$(find $d -path "*__tests__*" -name "*.test.ts*" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null | wc -l); [ "$n" = "0" ] && echo "$d has no tests"; done
```

```bash
# Configuration that is declared and never read
grep -rn "SESSION_SECRET\|LOG_LEVEL" --include="*.ts" apps packages | grep -v node_modules | grep -v dist
```

```bash
# Error codes defined but never constructed
for c in UPGRADE_REQUIRED MAINTENANCE; do echo "$c: $(grep -rn "'$c'" --include='*.ts' apps packages | grep -v node_modules | grep -v dist | grep -v errors.ts | wc -l) uses"; done
```

```bash
# The two type declarations that must agree and are not checked
sed -n '/^export interface Card /,/^}/p' apps/mobile/src/api/client.ts
```

```bash
# Source lines by area, for the test-distribution argument
for d in packages/shared packages/schemas packages/db apps/api apps/cms-api apps/cms-web apps/mobile apps/worker; do echo "$d $(git ls-files "$d" | grep -E '\.(ts|tsx)$' | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"; done
```

---

*Reviewed against commit `17cadc0`, 17 September 2026. CI green on all three jobs; 192 tests
passing; typecheck, lint and the forbidden-dependency check clean.*
