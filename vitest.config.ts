import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

/**
 * Loaded here rather than in a setup file so MONGO_TEST_URI is in process.env
 * before any test module is collected — the integration suites read it at
 * module scope.
 */
loadDotenv();

/*
 * The reader API validates its settings the first time a route asks for them,
 * and two are required. A developer has them from .env; CI has no .env. The
 * suites passed there only when app.test.ts — which loads test values into the
 * settings cache — happened to run before the files that call those routes,
 * and adding test files changed the order (CI, 7 Oct 2026). So the suites get
 * test values here, before any worker starts, never overriding a real .env.
 * Tests connect through MONGO_TEST_URI; this MONGO_URI is only validated.
 */
process.env.MONGO_URI ??= process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
process.env.CURSOR_SECRET ??= 'test-only-cursor-secret-at-least-32-characters';

export default defineConfig({
  test: {
    include: ['{apps,packages,scripts}/**/__tests__/**/*.test.ts'],
    /**
     * apps/mobile runs its own suite — `npm run test:mobile`, and its own CI
     * job.
     *
     * Not a preference. Vite resolves the nearest tsconfig.json for every file
     * it transforms, and apps/mobile/tsconfig.json extends `expo/tsconfig.base`,
     * which resolves only from apps/mobile/node_modules. The app is deliberately
     * not an npm workspace, so the root install never creates that directory.
     *
     * Locally it is there, because anyone running the app has installed it —
     * which is why this was invisible until CI, whose server job installs the
     * workspace and not the app, failed to transform either mobile test file and
     * exited having run no tests at all.
     *
     * Setting esbuild.tsconfigRaw does not avoid it: Vite loads the file's
     * tsconfig first and merges the raw options over it, so the lookup still
     * happens. The app owning its own runner is the honest arrangement anyway —
     * it already owns its node_modules, its lockfile and its CI job.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/mobile/**'],
    // Integration suites share collections; running files in parallel means one
    // file's beforeEach wipe lands in the middle of another file's assertions.
    fileParallelism: false,
  },
});
