import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint configuration.
 *
 * `npm run lint` was in package.json from the beginning and had never once run:
 * ESLint was not installed, so the script failed with "eslint is not
 * recognized". A lint gate that has never executed is not a lint gate, and the
 * 186 tests it sits beside were equally unenforced with no CI to run them.
 *
 * The rules below are deliberately close to the recommended sets. A large
 * bespoke rule list on a codebase that has never been linted produces hundreds
 * of findings, all of which get suppressed in one commit, which leaves the
 * project exactly where it started. Start where it passes, then tighten.
 *
 * The rules that are NOT default are the two that encode decisions specific to
 * this project — see the notes on each.
 */

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/media/**',
      'apps/mobile/assets/**',
      'apps/api/public/**',
      'App.js', // the wrong-folder signpost; see the file for why
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // Deliberate: a caught error that is intentionally ignored is written as
      // an empty catch with a comment saying why, and this codebase does that
      // in a dozen places where a failure genuinely must not propagate.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // An unused parameter prefixed with _ is a signature being honoured, not
      // a mistake — Express middleware and React props do this constantly.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `any` is a real smell here but not yet an error: the codebase is strict
      // TypeScript throughout and the few remaining uses are at MongoDB
      // boundaries. Warn so they are visible without failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // The two React apps: the mobile client and the editorial web interface.
  //
  // The hooks rules matter more here than anywhere: the codebase already
  // carried `eslint-disable react-hooks/exhaustive-deps` comments in four
  // context providers for a plugin that was never installed, so the rule they
  // were suppressing had never run — the suppression was the only part working.
  {
    files: ['apps/mobile/**/*.{ts,tsx}', 'apps/cms-web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023, __DEV__: 'readonly' },
    },
    rules: {
      // require() is how a module that throws at IMPORT time is loaded lazily.
      // expo-notifications does exactly that in Expo Go on Android, and the
      // lazy require in src/lib/pushSupport.ts is the fix for a crash that
      // took three wrong guesses to find. Banning it would invite its return.
      '@typescript-eslint/no-require-imports': 'off',
      // The two CLASSIC hooks rules, not the plugin's recommended set.
      //
      // v6 of this plugin ships the React Compiler rules in `recommended`, and
      // they flag 26 places here — nearly all of them the documented pattern of
      // assigning to a ref during render so a stable callback can read a fresh
      // value. That pattern is deliberate and is what keeps the feed from
      // re-rendering on every swipe. Turning those on now would mean 26
      // suppressions in one commit, which leaves the project where it started.
      // They are worth revisiting as a separate piece of work.
      'react-hooks/rules-of-hooks': 'error',
      // A dependency the author deliberately left out is a judgement call that
      // deserves a comment, not a build failure.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Scripts are operational tools: they log, and they exit.
  {
    files: ['scripts/**/*.{ts,mts,mjs}'],
    rules: { 'no-console': 'off' },
  },
);
