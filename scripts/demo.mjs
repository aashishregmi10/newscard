#!/usr/bin/env node
/**
 * Start everything a demonstration needs, in one command.
 *
 *   npm run demo
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A demo needs three servers running at once, in three terminals, started in no
 * particular order but all of them before the phone is picked up. Forgetting
 * one does not announce itself: the app shows "could not reach the server", or
 * the editorial site loads and cannot sign in, and the person presenting is
 * debugging in front of the person they are presenting to.
 *
 * So this starts all three, checks the things that have actually gone wrong
 * before, and prints the address the phone needs — which is the other thing
 * that is always looked up at the wrong moment.
 *
 * Metro stays separate, on purpose. `npm run mobile` prints a QR code that has
 * to be readable, and interleaving it with three servers' logs makes it
 * unscannable.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

let failed = 0;
const ok = (m) => console.log(`  ${c.green('ok')}    ${m}`);
const bad = (m, hint) => {
  failed++;
  console.log(`  ${c.red('FAIL')}  ${m}${hint ? `\n        ${c.dim(hint)}` : ''}`);
};
const warn = (m, hint) => console.log(`  ${c.yellow('warn')}  ${m}${hint ? `\n        ${c.dim(hint)}` : ''}`);

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** The address the handset must use. localhost on a phone means the phone. */
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

console.log(`\n${c.bold('SAAR demo')} ${c.dim('· preflight')}\n`);

/* ── the things that have actually gone wrong before ────────────────────── */

if (!existsSync(join(ROOT, '.env'))) {
  bad('no .env file', 'copy .env.example to .env and fill in MONGO_URI');
} else {
  ok('.env present');
}

const mediaDir = join(ROOT, 'media', 'i');
if (!existsSync(mediaDir) || readdirSync(mediaDir).length === 0) {
  bad('no images in media/', 'run: npm run media:fetch');
} else {
  const images = readdirSync(mediaDir).length;
  const videos = existsSync(join(ROOT, 'media', 'v'))
    ? readdirSync(join(ROOT, 'media', 'v')).length
    : 0;
  ok(`media present ${c.dim(`${images} image sets, ${videos} videos`)}`);
  if (videos === 0) warn('no videos', 'the Shorts tab will be empty — run: npm run media:videos');
}

const PORTS = [
  { port: 3000, name: 'read API' },
  { port: 3001, name: 'CMS API' },
  { port: 5173, name: 'editorial web' },
];
for (const { port, name } of PORTS) {
  if (await portFree(port)) ok(`port ${port} free ${c.dim(`(${name})`)}`);
  else bad(`port ${port} is already in use (${name})`, 'stop whatever is holding it, or the server will not start');
}

if (failed > 0) {
  console.log(c.red(`\n${failed} problem(s). Fix them and run this again.\n`));
  process.exit(1);
}

/* ── start the three servers ────────────────────────────────────────────── */

const SERVERS = [
  { name: 'api  ', colour: '\x1b[36m', script: 'dev:api' },
  { name: 'cms  ', colour: '\x1b[35m', script: 'dev:cms' },
  { name: 'web  ', colour: '\x1b[33m', script: 'dev:cms-web' },
];

console.log(`\n${c.bold('Starting')}\n`);

const children = SERVERS.map(({ name, colour, script }) => {
  // One string rather than an args array: npm needs a shell on Windows, and
  // passing args alongside shell:true is deprecated because they are
  // concatenated rather than escaped. These are our own literals, but the
  // warning is noise in front of a client and the fix is free.
  const child = spawn(`npm run ${script}`, {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Prefixed so three logs in one terminal stay readable.
  const tag = `${colour}${name}\x1b[0m │ `;
  const pipe = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        // dotenv's banner, three times over, is noise.
        if (line.includes('injected env')) continue;
        if (line.trim()) console.log(tag + line);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
});

/* ── tell the presenter what they need ──────────────────────────────────── */

setTimeout(() => {
  const lan = lanAddress();
  console.log(`\n${c.bold('Ready')}\n`);
  console.log(`  Editorial      ${c.cyan('http://localhost:5173')}`);
  console.log(`                 ${c.dim('editor@example.invalid / seed-editor-password')}`);
  console.log(`  Reader API     ${c.cyan('http://localhost:3000')}`);
  console.log(`  Ad report      ${c.cyan('http://localhost:3000/report')}`);
  if (lan) {
    console.log(`\n  ${c.bold('For the phone')} ${c.dim('— it must be on this Wi-Fi')}`);
    console.log(`                 ${c.cyan(`http://${lan}:3000`)}`);
    console.log(`                 ${c.dim('Windows Firewall must allow inbound 3000 and 8082.')}`);
  }
  console.log(`\n  ${c.bold('Then, in another terminal')}`);
  console.log(`                 ${c.cyan('npm run mobile')}   ${c.dim('— Metro, with the QR code')}`);
  console.log(`\n  ${c.dim('Check everything:')} ${c.cyan('npm run demo:check')}`);
  console.log(`  ${c.dim('Restore the queue:')} ${c.cyan('npm run demo:seed')}`);
  console.log(`\n  ${c.dim('Ctrl-C stops all three.')}\n`);
}, 9000);

/* ── one Ctrl-C stops everything ────────────────────────────────────────── */

let stopping = false;
const stopAll = () => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${c.dim('stopping…')}`);
  for (const child of children) {
    // On Windows a detached npm wrapper survives a plain kill, so the process
    // tree is taken down by taskkill. Everywhere else SIGTERM is enough.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exit(0);
};

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
