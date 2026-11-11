import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  projects: [
    // CI-safe: a scripted fake agent, no credentials.
    { name: 'fake', testMatch: /fake\.spec\.js/ },
    // Local only: real `claude` and `codex` in sandbox dirs (costs a few cents).
    { name: 'real', testMatch: /real\.spec\.js/, timeout: 300_000 },
  ],
});
