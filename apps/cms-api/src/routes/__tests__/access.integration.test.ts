import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { createCmsApp } from '../../server.js';

/**
 * Every editorial route refuses a request with no session.
 *
 * -- Why this replaced the permission tests ------------------------------------
 *
 * There used to be three roles and a table of what each could do, and tests
 * asserting that an author got 403 here and a reviewer there. Every account is
 * an admin now, so the only line left is signed in or not — and that line used
 * to be drawn twice, once by the router-wide `requireAuth` and again by every
 * per-route role check. With the second gone, a router that forgot the first
 * would be quietly open to the internet.
 *
 * -- Why the list is read from the source -------------------------------------
 *
 * A hand-written list of routes is correct on the day it is written and wrong
 * the day someone adds one. This reads the route files themselves, so a new
 * route is covered the moment it exists, and a router mounted without
 * `requireAuth` fails here rather than in production.
 */

const app = createCmsApp();

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The sign-in routes are the one deliberate exception: they are how you get a session. */
const EXEMPT = new Set(['authRoutes']);

interface Route {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
}

function declaredRoutes(): Route[] {
  const out: Route[] = [];
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.routes.ts'))) {
    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    const re = /(\w+)\.(get|post|patch|put|delete)\(\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (EXEMPT.has(m[1]!)) continue;
      out.push({ method: m[2] as Route['method'], path: m[3]! });
    }
  }
  return out;
}

/** Real-looking parameters, so a 401 cannot be a 400 for a malformed id. */
const fill = (path: string) =>
  path.replace(/:id\b/g, '65f1c2a4b8e9d0123456789a').replace(/:slug\b/g, 'namuna-khabar');

describe('the editorial API without a session', () => {
  const routes = declaredRoutes();

  it('finds the routes it is meant to be checking', () => {
    /* Guards the guard: a regex that silently matched nothing would make every
       assertion below vacuous. */
    expect(routes.length).toBeGreaterThan(25);
    expect(routes).toContainEqual({ method: 'post', path: '/cms/articles/:id/publish' });
    expect(routes).toContainEqual({ method: 'post', path: '/cms/sources/:slug/licence' });
  });

  it.each(declaredRoutes().map((r) => [r.method.toUpperCase(), r.path, r] as const))(
    '%s %s is 401',
    async (_method, _path, r) => {
      /* The CSRF header is sent, so a refusal here is the session check and not
         the CSRF one answering first. */
      const agent = request(app);
      const res = await agent[r.method](`/api${fill(r.path)}`)
        .set('X-Requested-With', 'newscard-cms')
        .send({});
      expect(res.status).toBe(401);
    },
  );
});
