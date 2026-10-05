# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Starting the app

`npm run mobile` from the repository root. Never `npx expo` from `D:\newscard` —
Expo would read the root package.json, fall back to `expo/AppEntry.js`, and fail
with `Unable to resolve module ../../App`. See RUNNING.md in this directory.

`apps/mobile` is deliberately NOT an npm workspace: it has its own node_modules
and lockfile so Metro cannot resolve two copies of React. `metro.config.js`
enforces that by confining resolution to this directory.

Install expo-* and native packages with `npx expo install`, never `npm install`.

# Adding a native module requires a rebuild — and a lazy import

JavaScript ships over Metro. **Native modules do not.** Add a native dependency
and every already-installed development build lacks it until someone rebuilds,
including your colleague who just pulled the branch.

A missing native module throws when it is **imported**, not when it is called:

```
Error: Cannot find native module 'ExpoWebBrowser'
```

A static `import * as X from 'expo-something'` therefore kills the module that
contains it, and the failure cascades upward. It does not look like a missing
module — it looks like this:

```
WARN  Route "./(tabs)/index.tsx" is missing the required default export.
```

Three routes reported a missing default export and none of them had one
missing; they had all failed to evaluate. That is the signature of this bug, and
it has now happened twice: once with `expo-notifications`, once with
`expo-web-browser`.

So any module that might not be in the installed binary is **required lazily,
inside a try, with a fallback** — see `src/lib/pushSupport.ts` and
`src/lib/openArticle.ts`. Guarding the call site does not help; the throw
happens while the module graph is being evaluated, before any function runs.

`npm run demo:check` and CI's `expo export` will not catch this. Both run
against JavaScript, and this is the one class of failure that only a real
handset sees.

# react-native-worklets is pinned to 0.10.4 — do not "fix" it

Reanimated's worklets have three halves that must be the SAME version: the
native code in the installed APK, the JavaScript in node_modules, and the Babel
plugin Metro loaded when it started. Any difference and every module that
touches Reanimated throws while loading:

```
[Worklets] Mismatch between JavaScript code version and Worklets Babel plugin version (0.10.1 vs. 0.10.4)
```

followed by `Cannot read property 'ErrorBoundary' of undefined` from the tabs
layout, because the route failed to evaluate (see above).

The development builds up to and including dc91b425 (4 Oct 2026) were built with
0.10.4, pulled in by reanimated. `npx expo install` prefers the SDK's 0.10.1, and
installing that on 5 Oct produced exactly the error above. So the package is
pinned to 0.10.4 and listed in `expo.install.exclude` in package.json, which
keeps `expo install --check` (and `npm run mobile`'s doctor) from asking for
0.10.1.

To change the version: change it, rebuild the APK, and restart Metro with
`npm run mobile -- --clear` — all three, together.
