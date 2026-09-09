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
