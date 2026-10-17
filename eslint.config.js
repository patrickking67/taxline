// Flat ESLint config for the Taxline monorepo.
// - TS rules (typescript-eslint, non-type-checked: fast, no project service needed)
//   for the service, the worker, and the site's lib/scripts.
// - eslint-plugin-astro for .astro components/pages.
// - Node globals for backend code, browser globals for site code.
// `astro check` remains the source of truth for .astro typechecking; this catches
// the rest (unused vars, no-undef, obvious foot-guns) across the repo.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/node_modules/**',
      '**/.data/**',
      '**/.wrangler/**',
      'site/astro.config.mjs',
      'cms/astro.config.mjs',
      'cms/emdash-env.d.ts',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    // Backend + tooling: Node runtime, console logging is expected.
    files: ['service/**/*.ts', 'workers/**/*.ts', 'knowledge-base/**/*.ts', 'scripts/**/*.mjs', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // Site code (lib + island scripts) runs in the browser.
    files: ['site/**/*.ts', 'site/**/*.astro'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Playwright specs, config, and the dist server run in Node.
    files: ['site/e2e/**', 'site/playwright.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: false },
  },
];
