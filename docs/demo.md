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

### 5 · Advertising (3 minutes)

**Advertising** in the sidebar.

- The two panels at the top are the two things we sell: the **full-card ad**
  (a poster between stories) and the **small ad** (beside share, on stories).
  Each bar is a campaign's **share of voice** — its price per day over the
  total per day of everyone running in that placement. Pay twice as much per
  day, get shown twice as often.
- **New campaign**: type a price and the share of voice it would buy appears
  beside it, before anything is saved. The phone preview on the right is drawn
  from the same fields the app receives.
- Open a running campaign: what it paid, the share it paid for beside the share
  it actually got, views, clicks, and cost per 1,000 views. **Issue a report
  link** shows the advertiser's token once.
- On the phone: a **small ad** sits beside share on every story, labelled
  "Ad" / "विज्ञापन"; the **poster card** appears at most one card in ten,
  never before the fourth, twelve a day. Tap either and it opens outside the app.
  Those limits are enforced on the server, so a future build cannot quietly
  raise them.
- Open the **advertiser report** at `http://localhost:5173/report/` with that
  campaign ID and token. What they paid for, delivery, viewability against a
  one-second threshold, click-through, reach and cost — an advertiser gets a
  link rather than an account, and sees nothing about any reader.

Seeded demo data has both placements. On a database you did not seed, create a
small-ad campaign from **New campaign** before showing it — without one,
stories carry no small ad.

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
- **Search, editorial analytics, personalised ordering, the home-screen widget
  and iOS** are Phase 2 and are not built. (Advertisers deliberately have no
  account: their report is the public page above.) The clustering you can see in the queue is seeded rather than
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
