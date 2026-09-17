# 3. Edge cases

> **Verdict: exceptional.** The strongest dimension of this codebase by a wide margin. What
> weaknesses exist are of one specific kind — promises the system makes and does not keep — plus one
> genuine hole nobody has noticed.

---

## The standard

The edge cases that matter are not the ones in the tutorial's "error handling" section. They share
three properties:

**They arise where the domain meets reality** — time zones that are not whole hours, scripts that do
not have one code point per character, networks that are intermittent by default, platforms with
lifecycles you do not control.

**They fail silently.** A loud failure gets fixed. These produce a slightly wrong number, a card
shown twice, a notification that never arrives — outcomes indistinguishable from normal operation
until someone counts.

**They are invisible in the happy-path corpus.** An English-only test fixture cannot reveal a
Devanagari bug. A fast local network cannot reveal an offline bug. A test that publishes one article
cannot reveal the same-millisecond bug.

Judged this way, most codebases handle approximately none of them, because you only learn them by
shipping and being wrong.

---

## Where SAAR is strong

### Ordering and identity

**Two articles published in the same millisecond.** Sorting on `publishedAt` alone orders them
non-deterministically, so at a page boundary one card duplicates and another disappears. The cursor
at [`cursor.ts:95`](../../packages/shared/src/cursor.ts) encodes the compound `(publishedAt, _id)`
key and resumes with a strict inequality on both. Offset pagination is never used anywhere, because
new articles are inserted at the head of the sort order and `skip/limit` shows the reader the same
card twice.

The cursor is also **signed with HMAC and expires after 24 hours**, and the signature is compared in
constant time. An unsigned cursor is a way for a client to ask the database for arbitrary ranges —
it is a query parameter that reaches a `$lt` filter.

### Language and script

**`"क्ष".length === 3`.** Devanagari conjuncts are multiple code points and one visual character.
Counting code points makes Nepali summaries appear a third longer than they are, which pushes
editors to write too little; slicing by code-unit index splits a conjunct and renders a broken
glyph. [`grapheme.ts:33`](../../packages/shared/src/grapheme.ts) uses `Intl.Segmenter` with
grapheme granularity, caches segmenters per locale, and exposes one `measureSummary()` that both the
CMS counter and the publish precondition call — *"two implementations would drift."*

The structural decision behind it matters more than the code: **the seed corpus is bilingual from
day one**, precisely so this class of bug cannot hide behind English fixtures.

### Time and place

**Nepal Time is UTC+05:45.** Not a whole hour. The notification daily cap is three per *reader's*
day, and the day boundary falls at 18:15 UTC — mid-afternoon, not a suspicious-looking midnight. A
UTC-based reset would roll the counter over at 05:45 local, so a reader could receive three before
breakfast and three more after it. [`dispatch.ts:68`](../../apps/worker/src/dispatch.ts) computes
the Nepali day key, and the six tests written for it assert the 18:14/18:15 boundary explicitly.

**The counter is corrected at read time, not reset by a job.** `effectiveSentToday` treats a count
whose `lastSentAt` falls on a previous Nepali day as zero. The alternative — a nightly cron — can
fail silently and leave every device permanently capped, which is the kind of outage nobody notices
for a week.

**Quiet hours wrap midnight.** 21:30–06:30 is a union, not a range, and
[`notificationGate.ts`](../../packages/shared/src/notificationGate.ts) implements it as one.

**Carrier-grade NAT.** In Nepal a single apparent IP can be an entire mobile cell rather than one
person. Per-IP limits are therefore deliberately generous and exist only to blunt crude abuse; the
per-device limits do the real work. A limit tuned as though one IP equals one user locks out a
neighbourhood.

### Platform lifecycle

**A module that throws at import time.** `expo-notifications` throws on import in Expo Go on Android
since SDK 53. Because the import lived in a provider the root layout imported, the failure cascaded:
the layout module became `undefined`, expo-router destructured it, and the app showed *"Sorry,
something went wrong"* — naming neither the module nor the cause. Guarding call sites cannot help;
the throw happens during module-graph evaluation. The fix at
[`pushSupport.ts:46`](../../apps/mobile/src/lib/pushSupport.ts) is a lazy `require` inside a `try`,
cached so a failing environment is not retried on every render.

**The notification tap that arrives before any listener exists.** A cold-start tap is delivered once,
at launch, and is only retrievable via `getLastNotificationResponseAsync`. Handling only the warm
case works in every casual test, because testers rarely force-stop the app first.
[`useNotificationRouting.ts:18`](../../apps/mobile/src/hooks/useNotificationRouting.ts) handles both,
and guards against double-navigation when a platform fires both.

**Two settings that make a delivered notification invisible.** Without a foreground handler,
expo-notifications suppresses anything arriving while the app is open — which is most of a session.
Without an Android channel named `default`, Android 8+ drops a notification naming a channel that
does not exist. Both fail with the send reporting success at every layer.

**Tokens rotate.** A rotated push token fails silently: the send succeeds, Expo accepts it, the phone
never rings. The app now re-fetches on every launch where permission already exists.

### Network reality

**Offline is a normal operating mode, not an exception.** The governing rule in
[`cache.ts`](../../apps/mobile/src/db/cache.ts) is that a story the app has ever downloaded stays
readable until evicted, and `useFeed` paints from cache *before* the network call rather than after
it fails. A blank feed with a populated cache is treated as severity-1. SQLite rather than
key-value, because eviction needs an ordered range query, not a scan of every key.

**A rejected promise must not be cached.** `open()` clears `dbPromise` on failure — otherwise one
transient failure at boot disables the cache for the entire session, and the symptom is an app that
is mysteriously slower today.

**A DNS resolver that refuses SRV queries.** `mongodb+srv://` requires an SRV lookup, which VPN
clients, ad-blocking DNS proxies and some corporate resolvers break. Every one fails identically
with `querySrv ECONNREFUSED`, which reads like the cluster being down.
[`client.ts:38`](../../packages/db/src/client.ts) tries the system resolver first and only falls
back to public resolvers if it fails — never overriding a resolver that works, which matters for
split-horizon DNS and private endpoints.

**Fail open on reads, fail closed on login.** The rate limiter for public reads continues serving if
its counter store is unavailable ([`rateLimit.ts:55`](../../apps/api/src/middleware/rateLimit.ts)) —
a limiter that takes the site down when its database hiccups has caused a worse outage than the one
it prevented. The login limiter does the opposite
([`cms-api/.../rateLimit.ts:57`](../../apps/cms-api/src/middleware/rateLimit.ts)): unlimited password
guesses are worse than an editor waiting. **The same mechanism with opposite failure modes, chosen
per use — this asymmetry is the mark of someone who has thought about it rather than applied a
pattern.**

### State and money

**The daily ad cap that a restart would defeat.** The count lives on the device, because only the
device knows what was actually rendered. It must be loaded *before* the feed request — reporting
zero would reset the cap on every cold start.

**One impression per ad instance.** Scrolling back up past the same card is not a second impression.
Billing twice for a card the reader merely passed twice is quietly overcharging.

**410 versus 404.** A retracted story returns `GONE`, not `NOT_FOUND`
([`routes/index.ts:37`](../../apps/api/src/routes/index.ts)). The distinction is load-bearing on the
client: 404 means "never existed", 410 means "we withdrew it", and only the latter should purge a
bookmark and show a withdrawal notice. A retracted story is usually retracted because it was
*wrong*, which makes this the one correctness failure that damages trust rather than merely
annoying.

**A transaction replaced by a narrower guarantee.** Publishing performs four reads and one write.
The transaction was only protecting read-then-write consistency, so
[`publish.service.ts:56`](../../apps/cms-api/src/services/publish.service.ts) closes that race with
a compare-and-swap whose filter re-asserts the status the checks were made against. The motivation
is stated plainly: requiring a replica set forced Docker on anyone who just wanted to run the CMS.

---

## Where SAAR is weak

### 🔴 High — TTL indexes keyed on a clock the client controls

This one has not been noticed, and it is the most interesting defect in the codebase.

Three collections expire rows with a MongoDB TTL index:

| Collection | TTL field | Window |
|---|---|---|
| `readEvents` | `occurredAt` | 90 days |
| `adEvents` | `occurredAt` | 400 days |
| `clientErrors` | `lastSeen` | 60 days |

And all three take that timestamp **from the request body, unbounded**:

```ts
occurredAt: z.string().datetime().optional(),   // events, ads, clientErrors — no min, no max
```

The consequences are both silent:

- **A handset with a slow clock** — common on cheap Android, and universal after a flat battery —
  sends `occurredAt` weeks in the past. The row is written, the TTL monitor sees it is already
  expired, and it is deleted within the minute. The measurement simply vanishes, and it vanishes
  disproportionately from exactly the low-end devices this product targets.
- **A handset with a fast clock, or a forged request,** sends a date in 2030. The row **never
  expires**. The index comment says *"behavioural data we no longer need is a liability, not an
  asset"* — which is correct, and which the client's clock can override. For `clientErrors` it is
  worse: `lastSeen` also drives the "what is broken this week" ordering, so one future-dated report
  pins itself to the top of the operations view permanently.

A retention guarantee is a privacy commitment. This one is only as strong as the least accurate
clock in the fleet.

**The fix is standard and small**: store both times. Keep `occurredAt` as the client's claim for
analysis, add a server-set `receivedAt`, and move the TTL index to `receivedAt`. Clamp `occurredAt`
into a sane window (not future, not more than a few days old) so reports stay meaningful.

### ⚠️ Medium — three promises the system makes and does not keep

These are documented honestly in the code, which is far better than hiding them, but they are still
unkept:

1. **Quiet-hours holds are computed and dropped.** The gate returns `deferUntil` for breaking news
   during quiet hours and the comment says *"held, not dropped"*. Nothing schedules the retry. The
   CMS surfaces the count in red rather than folding it into suppressions, so it is visible — but
   those readers receive nothing.
2. **`delivered` means "accepted by Expo".** `checkReceipts()` exists, is exported, and is called by
   nothing.
3. **Shutdown does not drain.** Both servers call `server.close()` without awaiting its callback and
   then `process.exit(0)`. Every in-flight request is cut. On a rolling deploy that is a burst of
   failed reads for real users — the classic "deploys cause a blip" that nobody ever tracks down.

### ⚠️ Medium — batch endpoints with no idempotency

`POST /v1/events` and `POST /v1/ads/events` accept batches of up to 50. Neither carries an
idempotency key, and the ad route increments denormalised campaign counters that an advertiser is
billed and reported on.

Today the client does not retry — telemetry is explicitly best-effort and a dropped batch is a
rounding error. That is a sound decision. But it means **the absence of idempotency is load-bearing
on a client-side decision that is one bug fix away from changing.** The first person who adds a
retry queue, reasonably, will double-bill without anyone noticing.

### ℹ️ Low — `sentToday` and `lastSentAt` must agree

`effectiveSentToday` is correct, but it makes the two fields a coupled pair: the counter is
meaningless without its timestamp. Any future code path that writes one without the other
reintroduces the bug the function exists to prevent. A single `{ count, dayKey }` sub-document would
make the invariant unbreakable rather than merely currently-unbroken.

---

## What to change

1. **Split `occurredAt` from `receivedAt` and move all three TTL indexes to the server-set field**
   (P1 — it is a privacy commitment, not a tidiness issue). Clamp the client value on the way in.
2. **Deliver quiet-hours holds or stop calling them holds**; **reconcile receipts or rename
   `delivered`.**
3. **Await `server.close()` before exiting**, with a timeout so a hung connection cannot block a
   deploy indefinitely.
4. **Accept an idempotency key on both batch endpoints** before anyone adds a client retry, not
   after.
5. **Fuse `sentToday` and its day key into one value** so they cannot be written apart.
