# Running the demo

Everything below has been verified working end to end. Where something cannot
be shown yet, it says so rather than leaving you to find out in the room.

---

## Before you start

```bash
npm run demo
```

Starts the read API, the editorial backend and the editorial site together,
after checking the things that have actually gone wrong before — a missing
`.env`, absent media, a port already held by a server someone forgot to stop.
It prints the LAN address the phone needs.

Then, in a second terminal, because its QR code has to stay readable:

```bash
npm run mobile
```

And to confirm the whole surface before anyone is watching:

```bash
npm run demo:check
```

That walks every endpoint a demo touches — all seven sections, both languages,
the shorts feed, media, the advertiser report, the write paths — and tells you
what is wrong **before** you present rather than during. A demo fails on the one
category with no stories, and that is invisible until somebody is looking.

**Firewall.** The phone reaches your machine on **3000** (API and media) and
**8082** (Metro). Windows will prompt the first time; if it was refused once, the
app shows "could not reach the server" with no other clue.

---

## The demo, in order

The order matters: it builds from what a reader sees, to how it gets there, to
what it is worth commercially.

### 1 · The product, on a phone (3 minutes)

Hand over the handset, or mirror it.

- **Swipe down** through the feed. One story per card, the whole thing in sixty
  words. Attribution is on every card.
- **Swipe sideways** between sections. Seven of them, and the rail highlight
  follows your thumb rather than snapping after you let go.
- **Tap a card** — the publisher's article opens *inside* the app, so dismissing
  it returns to the exact card rather than a cold start.
- **Settings → text size and theme.** Four sizes, light and dark. Change the
  language to Nepali-only and come back: the feed is a different product.
- **Turn Wi-Fi and mobile data off**, then pull to refresh. The stories stay.
  This is the point worth dwelling on — connectivity here is intermittent by
  default, and the app treats offline as normal rather than exceptional.

### 2 · Shorts (1 minute)

- The **Shorts tab**. Vertical video, muted, autoplaying only on Wi-Fi.
- **On mobile data** the play button carries the download size — "1.4 MB" — so
  the reader decides whether to spend it. Turn on **Data Saver** in Settings and
  come back to show it.
- **Tap to pause**, and **drag the bar** to scrub.

### 3 · The newsroom (4 minutes) — the half they are buying

Open **http://localhost:5173** · `editor@example.invalid` / `seed-editor-password`

- The **queue**: seven stories waiting, across draft, in review and approved.
  Keyboard-driven — `j` `k` to move, `↵` to open.
- Open **"वर्षापछि सडक मर्मतको काम तीव्र"**. It says *3 sources are covering this
  story. Summarise it once — the others will be spiked as duplicates.* That is
  the clustering: one editorial task instead of three.
- Watch the **counter** as you type. It counts what a reader sees — क्ष is one
  character, not three — and the publish gate uses the same measurement, so the
  number on screen is the number that decides.
- Attach a **photograph**. It asks for the credit and the licence at the moment
  you choose the file, because that is the last point at which anyone knows the
  answer — and publishing refuses an image without a recognised licence.
- Open the **approved** story, **"Trekking routes reopen for the autumn season"**,
  and press **Publish**.
- **Pull to refresh on the phone.** It is at the top of the feed.

That last beat is the demo. Everything before it is description.

### 4 · Shorts, from the newsroom (1 minute)

**Shorts** in the top bar. Upload a clip: it transcodes to three sizes plus a
cover frame while you write the title, then saves as a draft and publishes.
Withdrawing it removes it from the reader's feed immediately.

### 5 · Advertising (2 minutes)

- Scroll the feed until a **sponsored card** appears. Labelled, tinted, with the
  advertiser named — and at most one in ten cards, never before the fourth card
  of a session, twelve a day. Those limits are enforced on the server, so a
  future build cannot quietly raise them.
- Open the **advertiser report** at `http://localhost:3000/report`. Delivery,
  viewability against a one-second threshold, click-through, and dwell — broken
  down by section and day. It opens on a per-campaign token, so an advertiser
  gets a link rather than an account, and sees nothing about any reader.

### 6 · Notifications (2 minutes) — *needs a development build*

**Notifications** in the top bar.

- The **Reach** panel says how many handsets can actually receive one, before
  you write anything.
- Compose in both languages — a device tells us which languages its reader
  accepts, and we never send copy in one they have not asked for.
- **Send**, and the result names every reader the gate stopped and why: daily
  cap, quiet hours, channel switched off. "Sent to 4 of 60" with no explanation
  reads as a bug and is usually a policy working.

---

## Between rehearsals

Publishing from the queue empties it. Put it back:

```bash
npm run demo:seed
```

Idempotent — it clears what it seeded last time, so it will not accumulate.

---

## What will not work yet

Say these plainly if asked; none of them is a defect.

- **Push notifications need a development build on a real handset.** Expo Go
  cannot receive remote push on Android since SDK 53. Until a build is installed
  and permission granted, `demo:check` will warn that no device holds a token,
  and the CMS Reach panel will read 0.
- **Search, automated ingestion, the advertiser portal, editorial analytics,
  personalised ordering, the home-screen widget and iOS** are Phase 2 and are
  not built. The clustering you can see in the queue is seeded rather than
  computed from live feeds.
- **Quiet hours.** Between 21:30 and 06:30 Nepal time a live send is held or
  suppressed by design. Demonstrating push in the evening means using the
  **test send to one handset**, which bypasses the gate deliberately and is
  written to the audit trail.

---

## When something goes wrong

| Symptom | Cause |
|---|---|
| App says "could not reach the server" | Phone is not on the same Wi-Fi, or the firewall is blocking 3000 |
| Feed loads, images do not | Media is served on 3000 — check that port specifically |
| Editorial site loads, sign-in fails | The CMS API on 3001 is not running; `npm run demo` starts it |
| Queue is empty | You published everything in a rehearsal — `npm run demo:seed` |
| "Port already in use" | A server from a previous run is still up; `npm run demo` names the port |
| Notification sends to 0 devices | No handset holds a push token — see above |

Anything else: `npm run demo:check` names the broken surface directly.
