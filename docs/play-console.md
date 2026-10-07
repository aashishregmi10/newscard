# Google Play Console: what to enter

A fill-in sheet for publishing SAAR (package `com.saar.news`), drafted on 7 Oct 2026 from Google Play's
current requirements and from what the app actually does.

Replace `saar.example.com` with the real domain (docs/deploy.md). Fill the contact emails into
`apps/cms-web/src/siteInfo.ts` before submitting.

Every claim below is true of the code as committed; keep it that way when the app changes. Where a claim
rests on a specific file, it says which.

---

## 1. Store listing

**Category:** News & Magazines. **Default language:** English (United States). **Translation added:**
Nepali (ne-NP).

**Contact details:** email (required: the publishers' or support inbox); website
`https://saar.example.com`; phone optional.

**Privacy policy URL:** `https://saar.example.com/privacy`

### English (en-US)

**App name** (limit 30):

```
SAAR – News in 60 words
```

**Short description** (limit 80):

```
Nepal's news in 60 words a story, in Nepali and English, every source credited.
```

**Full description** (limit 4000):

```
SAAR brings Nepal's news to you one story at a time — each summarised in about 60 words, in Nepali, English, or both.

Read what matters, quickly
• One story per card: swipe up for the next story, sideways for the next section.
• Every summary names the publisher who did the reporting and links to their full article.
• Summaries are drafted with the help of AI and checked by an editor before they are published.

Built for Nepal
• Nepali and English in one feed — you choose.
• Made for everyday phones and slow connections; stories you have already downloaded stay readable offline.
• Data Saver keeps photos and videos from loading until you tap.

Short videos
• News shorts, played with YouTube's player.

Save, share, take part
• Save stories to read later, even without a connection.
• Share a story along with its source.
• Vote in polls and give ratings — sign in with Google only if you want to take part. We never store your name or email, and you can delete your account at any time.

Quiet notifications
• Only if you turn them on: at most three a day (corrections aside), and never between 9:30 pm and 6:30 am.

Comfortable to read
• Dark mode and adjustable text size.

SAAR is free, and supported by advertising from local businesses.

Privacy policy: https://saar.example.com/privacy
```

### Nepali (ne-NP)

**App name:**

```
SAAR – ६० शब्दमा समाचार
```

**Short description:**

```
नेपालका समाचार, हरेक ६० शब्दमा — नेपाली र अंग्रेजीमा, स्रोतसहित।
```

**Full description:**

```
SAAR ले नेपालका समाचार एक–एक गरी तपाईंसम्म ल्याउँछ — हरेक समाचार करिब ६० शब्दमा, नेपाली, अंग्रेजी वा दुवैमा।

छिटो, तर पूरा
• एउटा कार्डमा एउटा समाचार: अर्को समाचारका लागि माथि स्वाइप, अर्को विषयका लागि छेउतिर।
• हरेक सारांशमा समाचार तयार पार्ने प्रकाशकको नाम र उनीहरूको पूरा लेखको लिङ्क हुन्छ।
• सारांश AI को सहयोगमा तयार हुन्छ, र प्रकाशनअघि सम्पादकले जाँच्छन्।

नेपालका लागि बनाइएको
• नेपाली र अंग्रेजी एउटै फिडमा — रोज्ने तपाईं।
• सामान्य फोन र ढिलो इन्टरनेटमा पनि चल्छ; डाउनलोड भइसकेका समाचार इन्टरनेट नभए पनि पढ्न सकिन्छ।
• डेटा सेभरले तपाईंले नथिचेसम्म तस्बिर र भिडियो लोड हुन दिँदैन।

छोटा भिडियो
• समाचारका छोटा भिडियो, YouTube को प्लेयरमा।

सुरक्षित गर्नुहोस्, सेयर गर्नुहोस्, भाग लिनुहोस्
• पछि पढ्न समाचार सुरक्षित गर्नुहोस् — इन्टरनेट नभए पनि पढ्न सकिन्छ।
• स्रोतसहित समाचार सेयर गर्नुहोस्।
• मतदान र रेटिङमा भाग लिनुहोस् — चाहनुभए मात्र Google बाट साइन इन गर्नुहोस्। हामी तपाईंको नाम वा इमेल राख्दैनौं, र खाता जुनसुकै बेला मेटाउन सकिन्छ।

शान्त सूचना
• तपाईंले खोले मात्र: दिनमा बढीमा तीनवटा (सुधारबाहेक), र राति ९:३० देखि बिहान ६:३० सम्म कहिल्यै होइन।

पढ्न सहज
• डार्क मोड र मिलाउन मिल्ने अक्षरको आकार।

SAAR निःशुल्क छ, र स्थानीय व्यवसायका विज्ञापनबाट चल्छ।

गोपनीयता नीति: https://saar.example.com/privacy
```

### Graphics

| Asset | File | Play's rule |
|---|---|---|
| App icon | `brand/store/play-icon-512.png` | 512 × 512, 32-bit PNG, ≤ 1 MB |
| Feature graphic | `brand/store/play-feature-graphic-1024x500.png` | 1024 × 500, no transparency |
| Phone screenshots | take them (below) | at least 2, up to 8; at least 4 at ≥ 1080 px to be eligible for promotion |

Both images are made by `node scripts/gen-brand.mjs` from the logo.

**Screenshots to take** on a phone, with a `preview` build pointed at production and real (licensed)
stories. Take them full screen, in portrait:

1. A Nepali story card in the feed.
2. An English story card.
3. The section bar, sideways (Nepal, Politics, Sport…).
4. Shorts, with a video playing.
5. A vote card, before voting.
6. A rating card, after rating (averages showing).
7. A photo opened full screen, or the Saved screen.
8. The same story card in dark mode.

No sample ("नमुना") content, and nothing a publisher has not licensed: the screenshots are public.

---

## 2. App content (Policy → App content)

| Declaration | Answer |
|---|---|
| Privacy policy | `https://saar.example.com/privacy` |
| Ads | **Yes, my app contains ads** (in-house ads count) |
| App access | **Some functionality is restricted**, then the instructions below |
| Content rating | Complete the IARC questionnaire (category: news). Answer that the app reports real events, has no user-to-user communication, and no gambling or purchases. |
| Target audience | 13 and over (13–15, 16–17, 18+). Not under 13. Not designed to appeal to children. |
| News apps | **Yes, a news app.** Parent entity: commercial or private (as the company is registered). Contact URL: `https://saar.example.com/#/contact`, which must show a working email address. It is also reachable in the app: Settings → Contact and corrections. |
| Data safety | Section 3 |
| Advertising ID | **No.** AD_ID is blocked in `apps/mobile/app.json`; confirm in App bundle explorer. |
| Government apps | No |
| Financial features | None |
| Health | None |

**App access instructions** (for the reviewer, in English):

```
Reading needs no account. Votes and ratings (cards in the main feed after the 6th story) need a Google sign-in.
Test account: <a Google account you create for reviewers> / <its password>
Steps: open the app → choose a language → "Sign in with Google" (or "Not now", then sign in from a vote card or Settings → Account). To delete the account: Settings → Account → Delete account and data.
```

---

## 3. Data safety

**Does the app collect or share user data?** Yes, it collects; it shares nothing with third parties. Expo,
Google (sign-in and notifications) and MongoDB Atlas act as service providers.

**Is all data encrypted in transit?** Yes, once the server is on HTTPS (docs/deploy.md).

**Can users ask for their data to be deleted?** Yes. Web link: `https://saar.example.com/delete-account`.

| Category → type | Collected | Required? | Purposes |
|---|---|---|---|
| Personal info → **User IDs** (a keyed one-way code of the Google account; only when signed in) | Yes | Optional | App functionality (one vote per account), Account management |
| Device or other IDs (random install ID; push token) | Yes | Required | App functionality (notifications), Analytics, Advertising or marketing (ad limits and reports) |
| App activity → **App interactions** (stories read and for how long; ad views and taps) | Yes | Required | Analytics, Advertising or marketing |
| App activity → **Other actions** (votes and ratings) | Yes | Optional | App functionality |
| App info and performance → **Crash logs**, **Diagnostics** | Yes | Required | App functionality, Analytics |

Not collected: name, email, phone, address, location, contacts, photos, files, messages, calendar,
financial or health data, or the advertising ID. The Google name and email arrive in the sign-in token,
which is checked and discarded; Play's form counts that as "processed ephemerally", which needs no
disclosure.

These rest on the inventory in `apps/cms-web/src/components/LegalPages.tsx` (the Privacy Policy). Change
both together.

---

## 4. Release

1. **Account.** Pay the US$25 fee, verify your identity, verify the contact email and phone, and (for a
   personal account) prove you have an Android device using the Play Console app.
2. **Create the app** with package `com.saar.news`. That also registers the package name for Android
   developer verification.
3. **Internal testing.** Upload the AAB from `npx eas-cli build -p android --profile production` (in
   `apps/mobile`). Wait for the **pre-launch report**, and in **App bundle explorer** check the
   permissions (no AD_ID, no SYSTEM_ALERT_WINDOW) and the 16 KB page-size support.
4. **Google Cloud.** Add the SHA-1 of Play's app signing key to the Android OAuth client (docs/deploy.md,
   step 5). Until then, Google sign-in fails in builds from Play.
5. **Personal account only:** a closed test with at least 12 testers opted in for 14 days in a row, then
   **Apply for production** (the review takes about 7 days). An organization account skips this.
6. **Production.** The first review takes up to about 7 days. From the first update on, use staged
   rollouts.

Sources for these rules (all checked 7 Oct 2026) are listed in the launch plan; start from
support.google.com/googleplay/android-developer.
