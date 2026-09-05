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
    // Integration suites share collections; running files in parallel means one
    // file's beforeEach wipe lands in the middle of another file's assertions.
    fileParallelism: false,
  },
});
