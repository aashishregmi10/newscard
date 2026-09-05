# Making NEWSCARD interactive

## The line this plan will not cross

"Interactive" and "engaging" are not the same thing, and conflating them is how
news apps end up disliked.

The competitor research behind this product found the loudest complaints were
about **engagement mechanics**, not missing features: streak reminders that
could not be disabled, notification spam, a "not interested" control that did
nothing. Those are interactions that serve a retention metric at the reader's
expense.

So this plan sorts every idea into one of two buckets:

| | |
|---|---|
| **Responsiveness and agency** | The app answers instantly and does what the reader tells it. Build these. |
| **Engagement mechanics** | The app manufactures reasons to return. Rejected, and named below so nobody re-proposes them by accident. |

**Already rejected, and staying rejected:** streaks and daily-ritual counters,
"you haven't read today" nudges, leaderboards, unread badges designed to nag,
infinite auto-advancing video, and any notification whose purpose is re-entry
rather than news.

Everything below is also constrained by two things that do not bend: Nepali data
is metered, and target devices are entry-level. An interaction that costs a
megabyte or drops frames is not an improvement.

---

## Phase 1 — Make what exists feel alive (1 week)

Nothing new appears on screen. The app simply stops feeling inert. This is the
highest ratio of perceived quality to effort in the whole plan.

| Item | What it is | Why |
|---|---|---|
| **Haptics** | A light tap on bookmark, category change, and pull-to-refresh trigger | The single cheapest "this is a real app" signal. `expo-haptics`, no size cost |
| **Bookmark animation** | Icon scales 1 → 1.25 → 1 over 180 ms on save | Confirms an action whose result is otherwise invisible |
| **Card entrance** | Summary fades from 0.9 → 1 opacity as a card settles | Marks the boundary between stories without slowing the swipe |
| **Rail follows the pager** | The active chip slides and auto-scrolls into view as you swipe | Currently the rail updates but does not move; it looks disconnected from the gesture |
| **Skeleton → content crossfade** | 150 ms fade instead of a hard swap | Removes the flicker on every load |
| **Press states everywhere** | Every `Pressable` visibly responds | Several currently do not, which reads as a dead control |

All native-driver animations. No JS-thread work, so frame budgets in Ch. 12.4
are unaffected.

---

## Phase 2 — Give the reader real control (2 weeks)

Interaction that changes what the reader gets, not how often they come back.

**Follow topics and sources.** The inverse of "not interested", which already
works. A followed topic sorts higher in `top`; a followed source gets a small
mark. Both reversible in Settings, both purely local until v2 ranking exists.

**Adjustable summary length.** A per-reader preference between short (the
current limit) and extended (a longer summary the editor writes for significant
stories only). This directly answers the review-mining finding that readers want
*more depth on complex stories* while keeping the fast default.
*Cost: editorial writes two lengths for perhaps 10% of stories.*

**Reading position memory.** Reopening returns to the card you were on, with a
"jump to newest" affordance. Currently every launch resets to the top, which
punishes anyone reading in short bursts on a commute.

**Undo, everywhere.** Muting a topic, clearing bookmarks, hiding a source — each
gets a 5-second undo. Ch. 7.8 specifies this for "not interested" and it is not
built yet.

---

## Phase 3 — The two features readers actually asked for (3 weeks)

Both came directly out of the competitor review mining, and neither is a
gimmick.

### Text-to-speech read-aloud

The single most-requested missing feature in competitor reviews, and a genuine
differentiator in Nepal: it works while commuting, while working, and for
readers who find long-form reading difficult.

- Device TTS first (`expo-speech`) — free, offline, zero data.
- Nepali voice quality varies by handset. **Test on real devices before
  promising it**; a bad Nepali voice is worse than no voice.
- A "play all" queue turns the feed into a hands-free bulletin.
- Interacts well with Data Saver: audio from on-device TTS costs no bandwidth.

### Story context, not story quantity

Reviews complained that short summaries leave complex stories unexplained.

- **"Why this matters"** — one optional editor-written sentence on significant
  stories.
- **Related stories** — for clustered events, "3 other outlets covered this",
  which the clustering work already computes.
- Both are editorial effort, not engineering. Fits naturally into the composer.

---

## Phase 4 — Social, handled carefully (2 weeks, gated)

**Better share cards.** A rendered image card (Ch. 7.11) rather than plain text.
In Nepal, sharing happens overwhelmingly in WhatsApp and Viber, so this is the
main organic growth path. Attribution is baked into the image.

**Reactions, not comments.** Three or four fixed reactions per story, aggregate
counts only, no free text. Rationale: comments need continuous moderation, carry
real legal exposure around online speech in Nepal, and require staff we do not
have. Reactions give a sense of a shared audience at near-zero moderation cost.

**Polls** — one per day, attached to a story, results shown immediately. Cheap,
genuinely interesting, and no moderation burden.

> **Gate:** none of this ships until there is a named person responsible for
> handling abuse reports. A social feature without a moderator is a liability
> with a launch date.

---

## Phase 5 — Personalisation (v2, after real usage data)

Deliberately last, because it needs data that does not exist yet.

- Ranking within a recency window, never resurfacing a two-day-old story above
  breaking news.
- Signals: category dwell, explicit follows, explicit "not interested",
  bookmarks. No location, no cross-app data, no identity.
- **A visible control returns the reader to pure chronological.** Personalisation
  the reader cannot escape is a trap.

---

## Sequencing

```
week 1        Phase 1   feel                    ← do this first, it is cheap
weeks 2-3     Phase 2   control
weeks 4-6     Phase 3   read-aloud + context    ← the differentiators
weeks 7-8     Phase 4   social (gated on moderation)
v2            Phase 5   personalisation
```

Phase 1 before anything else. A responsive app with three features beats a
sluggish one with ten, and it is a week of work.

## What to measure

Not "time in app" — that metric rewards exactly the manipulative patterns this
plan rejects.

| Metric | Why |
|---|---|
| Cards read per session | Depth of engagement |
| Read-through rate | Whether summaries are worth reading |
| **Tap-through to publisher** | What we owe our sources — the obligation, not a vanity number |
| Share rate | Organic growth |
| Return rate at 7 and 30 days | Whether a habit formed honestly |
| Data per session | The reader's actual cost of using us |

If cards-read rises while tap-through falls, we are keeping the value and giving
publishers nothing — and that ends the licensing relationships the product
depends on.
