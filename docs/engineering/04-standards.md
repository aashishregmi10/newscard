# 4. Standards

> **Verdict: good, unevenly applied.** Security and type discipline sit above the bar for a product
> of this size. Test distribution and observability sit below it, and the gap between the two is the
> story.

---

## The standard

"Industry standard" is a phrase that usually means "what the last framework tutorial did". A more
useful test, in September 2026, is whether a system can answer four questions:

**Can the compiler stop a whole class of mistake?** Strict typing at boundaries, validation of
anything that crosses a process edge, generated rather than hand-copied contracts.

**Can an attacker get further than they should?** Credentials hashed with a memory-hard function,
sessions that can be revoked, constant-time comparison of anything secret, and limits on everything
unauthenticated.

**Will you find out when it breaks?** Structured logs with a correlation id, a metric per thing you
would page someone about, and tests concentrated where mistakes are likely rather than where testing
is easy.

**Can you upgrade it?** Locked dependencies, mechanical supply-chain policy, and a CI gate that runs
the same checks a reviewer would.

---

## Where SAAR is strong

### Type discipline

`tsconfig.base.json` enables `strict`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch` and `isolatedModules`, on `NodeNext` ESM with project references.
`noUncheckedIndexedAccess` in particular is still uncommon and is the setting that catches the
`array[i]` that is actually `undefined` — the single most common source of production `TypeError`s
in TypeScript code that believes itself safe.

The escape hatches are, measurably, not used. Across every source file outside tests: **zero
occurrences of `: any`, `as any` or `<any>`; zero `@ts-ignore`; zero `@ts-expect-error`; six
`eslint-disable` comments**, all for Express declaration merging or a deliberate
`exhaustive-deps` exception. That is a rare result. The usual pattern in a codebase this size is a
dozen `as any` casts marking the places someone was in a hurry, and each one is a hole in exactly
the guarantee the strict flags were turned on to provide.

Where a cast *is* necessary — the Mongo document types in `collections.ts` — it is confined to one
file and explained: the Zod types describe the domain where ids are hex strings, MongoDB stores
`ObjectId`, and the two are *deliberately* not pretended to be identical.

### Validation at every boundary

Every request body, query string and environment variable that crosses into the system is parsed by
a Zod schema before anything touches it. Both servers strip MongoDB operators from body, params and
query *before* any handler runs. The public DTO is a whitelist with a test asserting its key set.

### Security

Measured against the OWASP basics, this is better than most products at this stage:

| Control | Implementation |
|---|---|
| Password storage | Argon2id, 64 MB / t=3 / p=4 — real parameters, with a comment warning against reducing memory cost |
| Session management | Server-side and revocable, SHA-256 of the token stored, TTL index; explicitly *not* a JWT, because offboarding must revoke immediately |
| Cookies | `httpOnly`, `SameSite=Strict`, `Secure` in production |
| CSRF | Required header a browser will not add on a cross-site form post |
| Timing attacks | `timingSafeEqual` for cursors, device tokens and advertiser report tokens; length checked first because it throws on mismatch |
| Enumeration | One generic login message, and now equalised response timing |
| Rate limiting | Mongo-backed so it survives multiple processes, with per-route rules and a deliberate fail-open/fail-closed split |
| Secrets | Nothing sensitive tracked in git; verified |

The advertiser report token deserves a specific mention: campaign ids are public (every ad card
carries one), so the report is gated on a per-campaign secret compared in constant time against a
stored hash, and a missing campaign is reported identically to a wrong token. That is a considered
threat model, not a login bolted on.

### Data lifecycle

Expiry is done with TTL indexes rather than sweep jobs, so there is no cron to fail silently. Index
definitions live in one table with a `serves` field naming the query each exists for. The retention
periods are chosen and justified per collection rather than copied.

*(One serious caveat to this section — see [edge cases](03-edge-cases.md) on TTL fields keyed to a
client-supplied clock.)*

### Supply chain and CI

`check-forbidden-deps.ts` fails the build if any advertising, attribution, session-replay, LLM or ML
package appears **transitively**. This is unusual and it is the right instinct: the point is not that
those libraries are bad, but that their presence invites someone to switch them on before anyone
decided to. A policy enforced by a script outlives the person who set it.

CI runs typecheck, lint, the forbidden-dependency check and the full test suite against a real
MongoDB service container on every push, with concurrency cancellation. Three jobs, green.

---

## Where SAAR is weak

### 🔴 High — tests are concentrated where testing is easy, not where risk is

This is the most consequential standards gap, and it is best shown as a table.

| Area | Source lines | Tests |
|---|---|---|
| `packages/shared` | 1,610 | **99** |
| `apps/api` | 2,705 | 44 |
| `packages/schemas` | 1,215 | 23 |
| `apps/cms-api` | 2,190 | 20 |
| `apps/worker` | 533 | 6 |
| `packages/db` | 684 | **0** |
| `apps/cms-web` | 1,501 | **0** |
| `apps/mobile` | 5,678 | **0** |

Read it twice. **64% of the tests cover 18% of the code.** And **49% of the codebase — 7,863 lines
across mobile, the CMS frontend and the database package — has no tests at all.**

The 99 tests on `packages/shared` are not wasted; the cursor and the send gate genuinely are
severity-1 modules. But they are also *pure functions with no I/O*, which is to say the easiest
possible thing to test, and the part of the system that changes least. Meanwhile `apps/mobile` — the
largest application, the one that touches a filesystem, a network, a notification service and a
platform lifecycle, the one where the failures are hardest to reproduce because they happen on a
stranger's handset — has nothing.

The honest summary: **the test suite proves the parts that were never in much doubt.**

This is the normal shape of a suite that grew organically rather than by risk, and the fix is not a
coverage target. It is three specific tests, named in the [verdict](00-verdict.md).

### ⚠️ Medium — nothing observes the running system

There is a `requestId` on every request and response, echoed in error envelopes and shown in the
app's diagnostic screen. That is the hard part, and it is done.

What is missing is anything that consumes it. All logging is `console.log` / `console.error` as
free text, so nothing can be filtered, aggregated or searched by request id in practice. There are
no metrics and no traces. The `/v1/health` endpoint reports database reachability and uptime and
nothing about latency, error rate or queue depth.

Concretely, today you cannot answer: how many notifications failed yesterday; whether p95 feed
latency changed after a deploy; whether the rate limiter is firing on real users; how long a
dispatch takes as the device count grows. That last one matters because the inline-dispatch design
has a stated threshold beyond which it must change, and nothing measures the approach to it.

A structured logger honouring the `LOG_LEVEL` that is already validated is a small piece of work
with a large payoff, and it is a prerequisite for everything else here.

### ⚠️ Medium — outstanding dependency advisories

| Advisory | Severity | Path | Status |
|---|---|---|---|
| Vitest UI arbitrary file read | **Critical** (dev) | `vitest@2` | **Cleared** — Vitest 3 |
| Vite path traversal | High (dev) | via `vitest@2` | **Cleared** — Vitest 3 |
| `@vitest/mocker` path traversal | Moderate (dev) | `vitest` | Open; first fixed release is Vitest **4.1.11** |
| `qs` array-limit bypass + DoS | Moderate | Express → `qs` | Open; see below |

> **A correction.** An earlier draft of this document said the `qs` remedy was Express 5, on the
> reasoning that Express 4 pinned `~6.15.1` and so excluded the patched 6.16.0. Express 5 was
> adopted and the advisory **did not clear**: 5.2.1 resolves `qs@6.15.3` too. Express 5 and
> body-parser 2 do at least *permit* 6.16.0 (`^6.14.0` and `^6.15.2`), so an `overrides` entry
> should settle it — but npm on this machine does not apply the `overrides` field at all, verified
> by deleting the lockfile and regenerating. The upgrade was still worth doing; it just did not buy
> what was claimed.

Neither remaining advisory is exploitable in the current deployment — the Vitest one needs the UI
server, and the `qs` issues need specific query shapes — but "not currently exploitable" is a weaker
position than "patched".

### ⚠️ Medium — accessibility is partial

Accessibility props appear in `NewsCard` (7), `VideoCard` (4), `CardImage`, `CardMenu`, `FirstRun`,
`SponsoredCard` and `CategoryRail`. They appear **nowhere** in `settings.tsx`, `(tabs)/index.tsx` or
`(tabs)/videos.tsx`.

The pattern suggests a11y was applied while building components and skipped while assembling
screens. For a news product — where an older reader with a large font and a screen reader is a
completely ordinary user, not an edge case — the settings screen in particular is the wrong one to
leave bare, since it is where someone goes to make the app usable in the first place.

### ℹ️ Low — version drift between frontends

`apps/cms-web` is on React 18; `apps/mobile` is on React 19.2.3. Both are supported and nothing is
broken. It is worth resolving before someone writes a shared component and discovers the hard way
that it cannot be shared.

### ℹ️ Low — no published API contract

There is no OpenAPI document or generated client. For a two-consumer API this is defensible. It
stops being defensible the moment a third consumer exists, and it is the same finding as the mobile
contract gap in [structure](01-structure.md) seen from the standards side: the contract exists only
as agreement between two hand-written files.

---

## What to change

1. **Three tests on mobile** (P2) — cache-first paint, cursor pagination at a page boundary,
   cold-start notification routing. Not a coverage target; these three, because each protects a
   behaviour whose regression is invisible in review.
2. **A structured logger honouring `LOG_LEVEL`**, emitting JSON with the request id. This is the
   prerequisite for metrics, and it removes a lying config key at the same time.
3. **Vitest 3 and Express 5**, in that order — Vitest first because it is dev-only and therefore
   zero-risk to users, Express second because it needs the `req.query` behaviour re-verified.
4. **Accessibility pass on the three bare screens**, starting with settings.
5. **Log dispatch duration and device count**, so the inline-send threshold is observable before it
   is crossed.
