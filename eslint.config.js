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
      // One-off codemods from an earlier refactor, kept in the tree but not part
      // of the application. See the report: they are candidates for deletion.
      'fix-imports.cjs',
      'split-api-client.cjs',
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

      // `any` is used deliberately at the provider boundaries, where the shape is
      // whatever a third party sent. Warn so it stays visible without failing the
      // build over a cast that is genuinely at an untyped edge.
      '@typescript-eslint/no-explicit-any': 'warn',

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
