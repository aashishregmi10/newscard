import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

/**
 * Loaded here rather than in a setup file so MONGO_TEST_URI is in process.env
 * before any test module is collected — the integration suites read it at
 * module scope.
 */
loadDotenv();

export default defineConfig({
  test: {
    include: ['{apps,packages}/**/__tests__/**/*.test.ts'],
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
