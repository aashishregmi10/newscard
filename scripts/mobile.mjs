#!/usr/bin/env node
/**
 * The one supported way to start the mobile app.
 *
 *   npm run mobile              start Metro
 *   npm run mobile -- --clear   start Metro, discarding its cache
 *   npm run mobile:doctor       run the checks and stop, changing nothing
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The mobile app is NOT an npm workspace. It has its own node_modules and its
 * own lockfile, deliberately: Metro resolves modules by walking up from the
 * project root, and a hoisted install gives it two copies of React to choose
 * between. That decision is correct, and it has one sharp edge —
 *
 *   Expo must be started from apps/mobile, never from the repository root.
 *
 * Start it from the root and Expo reads the ROOT package.json. That file has no
 * `main`, so Expo falls back to its legacy entry point, expo/AppEntry.js, which
 * does `import App from '../../App'`. There is no App.tsx at the repository
 * root — this project uses expo-router, whose entry is `expo-router/entry` — so
 * the phone shows:
 *
 *   Unable to resolve module ../../App from
 *   D:\newscard\node_modules\expo\AppEntry.js
 *
 * which says nothing about the actual mistake. Worse, the attempt leaves debris
 * behind: it installs `expo` into the root package.json, adds @types/react and
 * eslint, rewrites the root tsconfig.json to extend expo/tsconfig.base, and
 * creates a root .expo directory. The next person to look at the repository
 * finds a root that half-believes it is an Expo app.
 *
 * So this script does three things, in order: clean up that debris if it is
 * present, verify everything else that has broken a start before, and only then
 * hand over to Expo with the working directory set correctly.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'apps', 'mobile');
const EXPO_CLI = join(MOBILE, 'node_modules', 'expo', 'bin', 'cli');

const args = process.argv.slice(2);
const doctorOnly = args.includes('--doctor');
const passThrough = args.filter((a) => a !== '--doctor');

/* ── output ─────────────────────────────────────────────────────────────── */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

let fixed = 0;
let failed = 0;

const ok = (msg) => console.log(`  ${c.green('ok')}    ${msg}`);
const fix = (msg) => {
  fixed++;
  console.log(`  ${c.yellow('fixed')} ${msg}`);
};
const bad = (msg, how) => {
  failed++;
  console.log(`  ${c.red('FAIL')}  ${msg}`);
  if (how) console.log(`        ${c.dim(how)}`);
};

/* ── helpers ────────────────────────────────────────────────────────────── */

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function portInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port, '127.0.0.1');
  });
}

/* ── checks ─────────────────────────────────────────────────────────────── */

/**
 * Undo the damage an accidental `expo` run at the repository root leaves
 * behind. Done first, and silently when there is nothing to do, so that one
 * mistake does not keep costing time on every later start.
 */
function checkRootContamination() {
  const rootPkgPath = join(ROOT, 'package.json');
  const rootPkg = readJson(rootPkgPath);
  let touched = false;

  if (rootPkg?.dependencies?.expo || rootPkg?.devDependencies?.expo) {
    delete rootPkg.dependencies?.expo;
    delete rootPkg.devDependencies?.expo;
    touched = true;
  }

  if (touched) {
    writeJson(rootPkgPath, rootPkg);
    fix('removed `expo` from the root package.json — it belongs only to apps/mobile');
  }

  const rootTs = readJson(join(ROOT, 'tsconfig.json'));
  if (rootTs?.extends === 'expo/tsconfig.base') {
    delete rootTs.extends;
    if (rootTs.compilerOptions && Object.keys(rootTs.compilerOptions).length === 0) {
      delete rootTs.compilerOptions;
    }
    writeJson(join(ROOT, 'tsconfig.json'), rootTs);
    fix('removed `extends: expo/tsconfig.base` from the root tsconfig.json');
  }

  const rootExpoDir = join(ROOT, '.expo');
  if (existsSync(rootExpoDir)) {
    rmSync(rootExpoDir, { recursive: true, force: true });
    fix('removed the stray .expo directory at the repository root');
  }

  if (existsSync(join(ROOT, 'node_modules', 'expo'))) {
    console.log(
      `  ${c.yellow('note')}  expo is still present in the ROOT node_modules.\n` +
        `        ${c.dim('Harmless now that the dependency is gone, but `npm install` at the root will prune it.')}`,
    );
  }

  if (!touched) ok('repository root is clean of Expo config');
}

/** The single most common cause of the red screen. */
function checkEntryPoint() {
  const pkg = readJson(join(MOBILE, 'package.json'));
  if (!pkg) return bad('apps/mobile/package.json is missing or unreadable');

  if (pkg.main !== 'expo-router/entry') {
    pkg.main = 'expo-router/entry';
    writeJson(join(MOBILE, 'package.json'), pkg);
    return fix('set apps/mobile package.json "main" to "expo-router/entry"');
  }
  ok('entry point is expo-router/entry');
}

/** expo-router needs app/_layout.tsx; without it the router renders nothing. */
function checkRouterRoot() {
  if (!existsSync(join(MOBILE, 'app', '_layout.tsx'))) {
    return bad(
      'apps/mobile/app/_layout.tsx is missing',
      'expo-router needs a root layout. Without it the app mounts and shows a blank screen.',
    );
  }
  ok('expo-router root layout is present');
}

/**
 * A stray App.tsx is how a project half-migrates back to the legacy entry
 * point: someone follows a tutorial, creates one, and now two entry points
 * disagree about what the app is.
 */
function checkNoLegacyEntry() {
  const strays = [];
  for (const dir of [ROOT, MOBILE]) {
    for (const name of ['App.tsx', 'App.ts', 'App.jsx', 'App.js']) {
      if (existsSync(join(dir, name))) strays.push(join(dir, name));
    }
  }
  if (strays.length > 0) {
    return bad(
      `a legacy entry file exists: ${strays.join(', ')}`,
      'This project routes through app/. Delete the file, or the two entry points will fight.',
    );
  }
  ok('no legacy App.tsx competing with the router');
}

/** apps/mobile is deliberately not a workspace, so it needs its own install. */
function checkInstall() {
  if (!existsSync(join(MOBILE, 'node_modules'))) {
    return bad(
      'apps/mobile/node_modules is missing',
      'Run: npm --prefix apps/mobile install',
    );
  }
  const required = ['expo', 'expo-router', 'react-native', 'react'];
  const missing = required.filter((m) => !existsSync(join(MOBILE, 'node_modules', m)));
  if (missing.length > 0) {
    return bad(
      `apps/mobile is missing: ${missing.join(', ')}`,
      'Run: npm --prefix apps/mobile install',
    );
  }
  ok('apps/mobile dependencies are installed');
}

/**
 * React and react-dom resolving to different versions corrupts Metro's module
 * graph, and the symptom is an unrelated-looking bundling error. Caret ranges
 * are how they drift apart, so both are pinned — this catches it if they slip.
 */
function checkReactPairing() {
  const react = readJson(join(MOBILE, 'node_modules', 'react', 'package.json'));
  const dom = readJson(join(MOBILE, 'node_modules', 'react-dom', 'package.json'));
  if (react && dom && react.version !== dom.version) {
    return bad(
      `react ${react.version} and react-dom ${dom.version} disagree`,
      'Pin both to the same exact version in apps/mobile/package.json, then reinstall.',
    );
  }
  ok(`react and react-dom agree${react ? ` (${react.version})` : ''}`);
}

/**
 * `expo install --check` compares every native module against the version the
 * installed SDK expects. A mismatch here is the difference between an app that
 * bundles and an app that crashes on the device — and `npm install` is how it
 * happens, because npm does not know about SDK compatibility.
 */
function checkNativeVersions() {
  const res = spawnSync(process.execPath, [EXPO_CLI, 'install', '--check'], {
    cwd: MOBILE,
    encoding: 'utf8',
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;

  if (res.status === 0) return ok('native module versions match the Expo SDK');

  const offenders = [...out.matchAll(/^\s*([@\w][\w@/.-]*)@\S+\s+-\s+expected/gm)].map((m) => m[1]);
  bad(
    offenders.length > 0
      ? `native versions do not match the SDK: ${offenders.join(', ')}`
      : 'native versions do not match the Expo SDK',
    'Run: npx expo install --fix   (from apps/mobile). Never use plain `npm install` for expo-* packages.',
  );
}

/** A Metro left running from a previous session holds the port and confuses the app. */
async function checkPort() {
  if (await portInUse(8081)) {
    console.log(
      `  ${c.yellow('note')}  port 8081 is already in use.\n` +
        `        ${c.dim('If this is an old Metro, Expo will offer to use another port — or stop it first.')}`,
    );
    return;
  }
  ok('port 8081 is free');
}

/* ── run ────────────────────────────────────────────────────────────────── */

console.log(`\n${c.bold('NEWSCARD mobile')} ${c.dim('· preflight')}\n`);

checkRootContamination();
checkEntryPoint();
checkRouterRoot();
checkNoLegacyEntry();
checkInstall();
checkReactPairing();
checkNativeVersions();
await checkPort();

console.log('');

if (failed > 0) {
  console.log(
    c.red(`${failed} check${failed === 1 ? '' : 's'} failed. Fix the above, then run this again.\n`),
  );
  process.exit(1);
}

if (doctorOnly) {
  console.log(c.green(`All checks passed${fixed > 0 ? ` (${fixed} repaired)` : ''}.\n`));
  process.exit(0);
}

/**
 * Clear Metro's cache whenever a repair was made. A stale cache after a config
 * change produces the previous error on the next run, which reads as "the fix
 * did not work" and sends people back to searching.
 */
const startArgs = ['start', ...passThrough];
if (fixed > 0 && !startArgs.includes('--clear')) {
  startArgs.push('--clear');
  console.log(c.dim('Repairs were made, so Metro starts with a cleared cache.\n'));
}

console.log(c.dim(`cwd: ${MOBILE}`));
console.log(c.dim(`run: expo ${startArgs.join(' ')}\n`));

// The Expo CLI is a plain Node entry point, so it is invoked directly rather
// than through npx. That avoids spawning a shell on Windows — which Node warns
// about, and which concatenates arguments without escaping them.
const child = spawn(process.execPath, [EXPO_CLI, ...startArgs], {
  cwd: MOBILE,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
