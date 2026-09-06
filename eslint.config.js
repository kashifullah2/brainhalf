// ---------------------------------------------------------------------------
// Lint configuration.
//
// There was no linter at all, and the two tsconfigs said so in a comment:
// `noUnusedLocals` and `noUnusedParameters` were doing the job by hand. The
// compiler is good at unused code and bad at everything else, so this deliberately
// adds only rules that catch things tsc cannot see, and no stylistic rules — a
// formatter argument is not what this codebase needs.
//
// The one that earns its place is react-hooks/exhaustive-deps. Several comments in
// src/ record bugs caused by a missing dependency (AuthContext's logout closure
// captured a stale GOOGLE_CLIENT_ID and silently stopped calling
// disableAutoSelect); that is exactly the class this rule finds.
// ---------------------------------------------------------------------------

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      // Untracked scaffolding for a different project that happens to sit in this
      // working tree. Not ours to lint.
      'apps/**',
      'packages/**',
      '.replit-artifact/**',
      // Vendored agent skill definitions, not application code.
      '.agents/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // tsc already reports these, with better messages and file positions.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',

      // An error, not a warning, now that there are none left.
      //
      // All 22 occurrences turned out to be avoidable. The interesting ones were
      // not at real untyped edges at all: `doc: any` on the document side panel
      // meant a rename in the API type would have surfaced as a blank drawer at
      // runtime, and eighteen `catch (e: any)` blocks then read `e.message`, which
      // is `undefined` for anything thrown that is not an Error -- a toast with an
      // empty description. src/lib/humanize-error.ts:errorMessage() replaced those.
      //
      // Where a third-party shape genuinely is unknown, narrow it once with a
      // declared interface at the boundary (see BedrockReply in
      // server/ocr-provider.ts) rather than letting `any` spread inward.
      '@typescript-eslint/no-explicit-any': 'error',

      // Real-bug rules.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'require-atomic-updates': 'off',
      'no-console': 'off', // server logging is intentional and reviewed
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Config and build scripts run in Node.
    files: ['*.config.{ts,js,mjs}', 'scripts/**/*.{js,mjs}', '*.cjs'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
