# Running the mobile app

## The one command

From the **repository root** (`D:\newscard`):

```bash
npm run mobile
```

That is the whole thing. It checks everything that has broken a start before,
repairs what it safely can, and then starts Metro from the right directory.

To check without starting anything:

```bash
npm run mobile:doctor
```

To start with a cleared Metro cache:

```bash
npm run mobile -- --clear
```

---

## The rule that matters

> **Never run `npx expo` from `D:\newscard`. Only from `D:\newscard\apps\mobile`.**

`npm run mobile` handles this for you. The rule matters because of what happens
when it is broken.

### What you see when it goes wrong

```
Unable to resolve module ../../App from D:\newscard\node_modules\expo\AppEntry.js

None of these files exist:
  * App(.android.ts|.native.ts|.ts|.android.tsx|…)
  * App
```

### Why that happens

`apps/mobile` is **not** an npm workspace. It has its own `node_modules` and its
own lockfile, on purpose — Metro resolves modules by walking up the directory
tree, and a hoisted install would give it two copies of React to choose between.

The cost of that decision is that Expo must be started from `apps/mobile`.
Started from the repository root, Expo reads the **root** `package.json`. That
file has no `main` field, so Expo falls back to its legacy entry point,
`expo/AppEntry.js`, which contains:

```js
import App from '../../App';
```

There is no `App.tsx` at the repository root, because this project uses
expo-router — its entry point is `expo-router/entry`, and screens live in
`apps/mobile/app/`. So the resolver fails, and the message it prints is about a
file that was never supposed to exist.

### What it leaves behind

Running Expo at the root does not just fail — it writes to the root on its way
out:

| What it does | Why it is a problem |
|---|---|
| Adds `expo` to the root `package.json` | The root now looks like an Expo app |
| Adds `@types/react` and `eslint` to the root | Unrequested dependency drift |
| Rewrites root `tsconfig.json` to extend `expo/tsconfig.base` | Changes compiler settings for the API and CMS |
| Creates `D:\newscard\.expo\` | Leftover dev-server state in the wrong place |

Because that debris persists, the *next* start can fail differently, which is
what turns a one-off mistake into a recurring one.

`npm run mobile` detects and reverses all four automatically, every time it runs.

---

## What the preflight checks

| Check | Why |
|---|---|
| Repository root is clean of Expo config | Reverses the debris described above |
| Entry point is `expo-router/entry` | The direct cause of the `../../App` error. Repaired automatically |
| `app/_layout.tsx` exists | expo-router needs a root layout, or the app mounts to a blank screen |
| No stray `App.tsx` | Two entry points disagreeing about what the app is |
| `apps/mobile/node_modules` present | It is not a workspace, so it needs its own install |
| `react` and `react-dom` agree | Two React versions corrupt Metro's module graph, and the error names an unrelated module |
| Native versions match the SDK | `npm install` does not know about Expo SDK compatibility; `npx expo install` does |
| Port 8081 is free | A Metro left running from a previous session |

When a repair is made, Metro is started with `--clear` — otherwise a stale cache
replays the previous error and it reads as "the fix did not work".

---

## Installing packages

```bash
# From apps/mobile — for anything expo-* or any native module
npx expo install <package>

# Plain npm is only safe for pure-JavaScript packages
npm install <package>
```

`npx expo install` picks the version that matches the installed SDK. `npm
install` picks the newest, which is how `react-native-pager-view` and
`react-native-reanimated` previously ended up on versions the SDK did not
expect — an app that bundles fine and then crashes on the device.

---

## If the phone cannot reach the dev server

The app derives the API address from the Expo host it was loaded from
(`apps/mobile/src/api/client.ts`), so a changed LAN IP needs no code edit. If
nothing loads at all:

1. Phone and computer must be on the same Wi-Fi network.
2. Windows Firewall must allow Node on private networks.
3. Some networks isolate clients from each other. Use a phone hotspot to rule
   this out, or start with `npm run mobile -- --tunnel`.

## If Metro behaves strangely after a dependency change

```bash
npm run mobile -- --clear
```

If that does not settle it, reinstall the app's dependencies only:

```bash
npm --prefix apps/mobile install
```

Never delete the root `node_modules` to fix a mobile problem — they are separate
installs, and the mobile app does not use the root one.
