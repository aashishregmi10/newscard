# 2. Clean code

> **Verdict: strong.** Unusually good at recording *why*. The risk it carries is that prose has no
> compiler, and this repository has already been bitten by that once.

---

## The standard

Clean code is not code that is pretty. It is code that is **cheap to change correctly** — where a
stranger, six months later, can make a modification and be right.

Three things predict that, and none of them is line length:

**Can the reader predict behaviour without running it?** Naming, small functions, one level of
abstraction per function. Not because short functions are virtuous, but because a reader holding
four things in their head makes mistakes.

**Does the code explain the decisions a reader cannot reconstruct?** What the code does is visible.
*Why it does that and not the obvious alternative* is invisible, and is the thing that gets
destroyed when someone tidies up. This is the only kind of comment that earns its maintenance cost.

**Is the same fact stated once?** Every duplicated fact is a future inconsistency with a date on it.

---

## Where SAAR is strong

### Comments record the failure that motivated the code

This is the most distinctive quality of the codebase, and it is genuinely rare. Most comments in
most codebases restate the line below them. These record what went wrong.

From [`pushSupport.ts:46`](../../apps/mobile/src/lib/pushSupport.ts):

> `expo-notifications` THROWS AT IMPORT TIME in Expo Go on Android […] Guarding the CALL SITES does
> not help. The throw happens while the module graph is being evaluated, long before any function
> runs.

A reader who does not know this will "simplify" the lazy `require` into a static import, because
the static import is obviously cleaner. The comment is the only thing standing between that
instinct and a blank white screen reading *"Sorry, something went wrong"* that names neither the
module nor the cause.

[`diversity.ts:11`](../../apps/api/src/services/diversity.ts) goes further and contains an actual
proof. The original plan said over-quota cards would be deferred to the next page rather than
dropped. The comment demonstrates that deferral and position-based cursors are **mutually
exclusive** — cursor at the last placed card loses the deferred ones; cursor at the first deferred
card duplicates the shown ones; there is no third position — and therefore the function permutes a
fixed window instead. That is a design decision with a rigorous justification, written down at the
one place someone would try to undo it.

Others in the same vein: [`cache.ts:59`](../../apps/mobile/src/db/cache.ts) explains why a rejected
promise must not stay cached (one transient failure at boot would otherwise disable the cache for
the entire session); [`useFeed.ts:88`](../../apps/mobile/src/hooks/useFeed.ts) explains why the ad
budget must resolve *before* the request (reporting zero would reset the daily cap on every cold
start — the whole cap, defeated by an app restart);
[`publish.service.ts:56`](../../apps/cms-api/src/services/publish.service.ts) explains why a
compare-and-swap replaced a transaction and what narrower guarantee that gives.

**The general lesson**: the comments worth writing are the ones that answer *"why isn't this the
obvious thing?"* If the answer is "it used to be, and here is what broke", write that down. It is
the cheapest institutional memory available, and it survives the person who learned it.

### Data instead of conditionals

Four separate policies are expressed as tables rather than branches:

| Policy | Where | Instead of |
|---|---|---|
| HTTP error vocabulary | [`errors.ts:9`](../../packages/shared/src/errors.ts) | status codes scattered through handlers |
| Who may do what | [`permissions.ts:12`](../../packages/shared/src/permissions.ts) | `if (role === 'admin')` in twelve places |
| Article lifecycle | [`article.ts:160`](../../packages/schemas/src/article.ts) | transition checks at each call site |
| Database indexes | [`indexes.ts:23`](../../packages/db/src/indexes.ts) | ad-hoc `createIndex` calls |

The permissions table is the clearest win: the entire authorisation surface can be audited by
reading one file. Routes declare the *permission* they need, never the roles that happen to have it,
so adding a role is a one-line change in one place rather than a grep.

The index table carries a `serves` field naming the query each index exists for. That is a small
idea with a large payoff — it makes an unused index detectable by reading, and it stops the usual
accretion of indexes nobody dares delete.

### Names that refuse to flatter

[`dispatch.ts`](../../apps/worker/src/dispatch.ts) reports `accepted`, not `delivered`, for messages
Expo acknowledged, and the comment says why: *"a dashboard that always reads 100% delivered […] is
worse than no dashboard, because it is believed."*

It also counts `noToken` separately from `suppressed`. Both mean "this device got nothing", and
collapsing them would be natural. They are kept apart because one is a setup problem and the other
is a policy decision, and they have completely different fixes. Refusing to let a broken thing
masquerade as a working one is a naming decision that most codebases get wrong.

### Clamp, don't reject — and report what you stored

Measurement inputs are clamped rather than rejected: a phone left on a card overnight does not cost
the rest of the batch, and `dailyCap` above the ceiling is clamped instead of erroring. Crucially,
the device-preferences endpoint **returns what was actually stored**, so a client asking for 9 can
see it received 3. Silently storing something different from what was asked is how clients develop
superstitions.

---

## Where SAAR is weak

### ⚠️ Medium — prose drifts, and has

The comment density is 22–42% in the files above. Most of it is justified. But high density has a
cost that is easy to ignore: **the prose becomes the documentation of record, and prose has no
compiler.**

This has already happened. Until yesterday the README's status table stated that `packages/db`,
`apps/api`, `apps/cms-api`, `apps/cms-web` and `apps/mobile` were all **"Not started"** — five
subsystems, tens of thousands of shipped lines, described as non-existent. Anyone onboarding would
have been actively misled by the repository's front door.

The same drift is visible in smaller ways: `AGENTS.md`, `RUNNING.md` and `docs/interactivity-plan.md`
still describe NEWSCARD after the rename to SAAR.

None of this argues for fewer comments. It argues that **the comments closest to the code age best
and the documents furthest from it age worst** — and that anything stating the *state* of the system
(rather than the *reasoning* behind a decision) should either be generated or deleted. A status
table in a README is a liability; a proof in `diversity.ts` is an asset. They are both prose, and
they age completely differently.

### ⚠️ Medium — the same fact stated twice

Read-event dwell is clamped by `clampDwell()` from `@saar/schemas`, which uses the named constant
`MAX_DWELL_MS`:

```ts
// apps/api/src/routes/events.routes.ts:68
dwellMs: clampDwell(e.dwellMs),
```

Ad-event dwell — the same concept, the same ceiling, in a route twenty lines away — does it by hand:

```ts
// apps/api/src/routes/ads.routes.ts:52
dwellMs: Math.min(e.dwellMs, 120_000),
```

Two implementations of one rule, one of them a bare literal. If the ceiling ever moves, the ad
numbers keep the old one, and nothing fails — the reports are simply wrong in a way no test covers.
This is exactly the defect class the schemas package exists to prevent, appearing inside the
codebase that built it.

### ⚠️ Medium — configuration that lies

`LOG_LEVEL` is validated at boot by a Zod enum at
[`config/index.ts:18`](../../apps/api/src/config/index.ts) — and then never read. All logging in
both servers is `console.log` and `console.error`. Setting `LOG_LEVEL=error` changes nothing.

A config key that is validated is a *promise*. Validating it and ignoring it is worse than not
having it, because the validation signals that someone thought about it.

`SESSION_SECRET` is the same failure in `.env.example`: documented as a required secret, read by
nothing.

### ℹ️ Low — dead vocabulary

`UPGRADE_REQUIRED` (426) and `MAINTENANCE` (503) are defined in the error table and never
constructed anywhere. They may be reserved deliberately for a forced-update flow that does not
exist yet. Either way, a reader cannot tell the difference between "reserved" and "forgotten", and
the table is the one place in this codebase where completeness is load-bearing.

### ℹ️ Low — a few functions carrying several jobs

[`useFeed.ts`](../../apps/mobile/src/hooks/useFeed.ts) is 172 lines doing five things: fetching,
cache-first painting, pagination, ad-budget coordination, and guarding against a response arriving
for a category the reader has left. Each is handled well and the comments are good. But five
responsibilities in one hook is why it has no tests — there is no seam to test through, only the
whole thing at once.

`app/(tabs)/settings.tsx` has the same shape at larger scale: every preference surface in one file.

---

## What to change

1. **Replace the ad-route clamp with `clampDwell()`** (five minutes, and it removes a whole
   defect class).
2. **Either honour `LOG_LEVEL` with a real logger, or delete it** — and delete `SESSION_SECRET`
   from `.env.example` at the same time.
3. **Resolve the dead error codes**: use them, or remove them with a note about what would bring
   them back.
4. **Split `useFeed`** into a cache-first data hook and a pagination hook. The immediate benefit is
   not tidiness; it is that the cache-first behaviour — the thing QA calls a severity-1 defect if it
   regresses — becomes testable in isolation. See [standards](04-standards.md) on test
   distribution.
5. **Adopt a rule about status prose**: anything describing what exists is generated or deleted;
   anything describing why a decision was made stays and is welcome. The README rewrite already
   follows this; making it explicit stops the next drift.
