/*
 * THIS FILE IS A SIGNPOST. It is not part of the app.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 *
 * Running `npx expo start` from the repository root instead of from
 * apps/mobile is an easy mistake and an expensive one. Expo reads the ROOT
 * package.json, finds no `main`, falls back to its legacy entry
 * `expo/AppEntry.js`, and that file does:
 *
 *     import App from '../../App';
 *
 * Without this file the bundle fails with "Unable to resolve ../../App", which
 * says nothing about the actual mistake and sends people looking for a missing
 * component. Worse, by the time that error appears Expo has already written to
 * the repository root — adding `expo` and `@types/react` to package.json,
 * rewriting tsconfig.json to extend expo/tsconfig.base, and creating a root
 * .expo directory — so the NEXT run fails differently.
 *
 * With this file the bundle succeeds and the phone shows the instruction
 * instead of the puzzle. `npm run mobile` then cleans up the debris.
 *
 * It is plain .js on purpose: it must not be part of any TypeScript project,
 * and it must never be imported by anything real.
 */

const MESSAGE = [
  'Expo was started from the wrong folder.',
  '',
  'This is D:\\newscard, the repository root. The app lives in apps/mobile.',
  '',
  'Stop this server and run, from the repository root:',
  '',
  '    npm run mobile',
  '',
  'That starts Metro from apps/mobile on port 8082, and repairs the',
  'package.json and tsconfig.json that this run just modified.',
].join('\n');

// Thrown at import time so it reaches the phone as an error screen rather than
// rendering as a component nobody reads.
throw new Error(MESSAGE);
