import { defineConfig } from 'vitest/config';

/**
 * The mobile app's own test suite.
 *
 * It is separate from the root one because this app is deliberately not an npm
 * workspace: it keeps its own node_modules and lockfile so Metro cannot resolve
 * two copies of React. That decision also means `expo/tsconfig.base`, which
 * this app's tsconfig extends, resolves only from HERE — so the root runner
 * cannot transform these files at all unless the app happens to be installed.
 *
 * Only modules with no React Native imports are testable this way, which is a
 * useful constraint rather than a limitation: it keeps the decisions (what to
 * show, where a notification points) separable from the platform code that
 * runs them.
 */
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
