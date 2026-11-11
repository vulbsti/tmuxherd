import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'assets/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-control-regex': 'off', // ANSI/tmux escape handling is the point of this project
      eqeqeq: ['error', 'smart'],
    },
  },
  { files: ['public/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  // Playwright callbacks (addInitScript/evaluate) run in the page.
  { files: ['e2e/**/*.js', 'assets/src/**/*.mjs'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
];
