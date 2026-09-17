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
