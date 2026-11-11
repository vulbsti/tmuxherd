// End-to-end through the real browser UI, with the scripted fake agent.
// Runs in CI on Linux and macOS (no agent credentials needed).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startTmuxherd } from './harness.js';

const FAKE = new URL('../test/fake-agent.js', import.meta.url).pathname;
let th;

test.beforeAll(async () => {
  th = await startTmuxherd(['--stall-minutes', '0.05']);
});
test.afterAll(async () => th?.stop());

async function keyOf(name) {
  const s = await th.api('GET', '/api/state');
  return s.panes.find((p) => p.name === name)?.key;
}

test('spawn from the UI, see the permission prompt, approve it from the browser', async ({ page }) => {
  const work = fs.mkdtempSync(path.join(th.dir, 'w-'));
  await page.goto(th.url);
  await expect(page).toHaveURL(`${th.base}/`); // token stripped from the address bar

  await page.getByTestId('new-agent').first().click();
  await page.getByTestId('spawn-preset').selectOption('custom');
  await page.getByTestId('spawn-name').fill('needs-ok');
  await page.getByTestId('spawn-cwd').fill(work);
  await page.getByTestId('spawn-command').fill(`node ${FAKE} permission --file approved.txt`);
  await page.getByTestId('spawn-harness').selectOption('claude');
  await page.getByTestId('spawn-submit').click();

  await expect.poll(() => keyOf('needs-ok')).toBeTruthy();
  const key = await keyOf('needs-ok');
  await expect(page.getByTestId(`tile-${key}`)).toHaveAttribute('data-state', 'waiting', { timeout: 10_000 });
  const item = page.getByTestId(`inbox-item-${key}`);
  await expect(item).toContainText('Do you want to proceed?');
  await expect(item).toContainText('touch approved.txt'); // the exact command is shown

  await page.getByTestId(`answer-${key}-0`).first().click();
  await expect.poll(() => fs.existsSync(path.join(work, 'approved.txt')), { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId(`tile-${key}`)).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
  await expect(page.getByTestId(`inbox-item-${key}`)).toHaveCount(0);
});

test('a stalled agent is flagged and raises an alert toast and a browser notification', async ({ page }) => {
  // Headless Chromium always reports notification permission as "denied", even after
  // grantPermissions. So this stub reports "granted" and records what the page creates;
  // it tests the page's behaviour, not the browser's notification UI.
  await page.addInitScript(() => {
    window.__notified = [];
    function Recording(title, opts) {
      window.__notified.push({ title, body: opts?.body });
    }
    Recording.permission = 'granted';
    Recording.requestPermission = async () => 'granted';
    window.Notification = Recording;
  });
  await page.goto(th.url);
  await th.api('POST', '/api/spawn', { preset: 'custom', harness: 'claude', name: 'stuck', cwd: th.dir, command: `node ${FAKE} stall` });
  await expect.poll(() => keyOf('stuck')).toBeTruthy();
  const key = await keyOf('stuck');
  const tile = page.getByTestId(`tile-${key}`);
  await expect(tile).toHaveAttribute('data-state', 'working');
  await expect(tile).toHaveAttribute('data-state', 'stalled', { timeout: 15_000 });
  await expect(page.getByTestId('toast').filter({ hasText: 'stuck' }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__notified.map((n) => n.title).join('\n'))).toMatch(/stalled.*stuck|stuck.*stalled/i);
});

test('spawn a shell in a new git worktree from the UI, then type into it from the zoom view', async ({ page }) => {
  const repo = fs.mkdtempSync(path.join(th.dir, 'repo-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a]);
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');

  await page.goto(th.url);
  await page.getByTestId('new-agent').first().click();
  await page.getByTestId('spawn-preset').selectOption('shell');
  await page.getByTestId('spawn-cwd').fill(repo);
  await page.getByTestId('spawn-worktree').check();
  await page.getByTestId('spawn-branch').fill('try-ui');
  await page.getByTestId('spawn-submit').click();

  const wt = path.join(path.dirname(repo), `${path.basename(repo)}.worktrees`, 'try-ui');
  await expect.poll(() => fs.existsSync(path.join(wt, '.git'))).toBe(true);
  await expect.poll(() => keyOf('try-ui')).toBeTruthy();
  const key = await keyOf('try-ui');

  await page.getByTestId(`tile-${key}`).click();
  await page.keyboard.type('echo typed-$((40+2))');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await th.api('GET', `/api/panes/${key}/screen`)).screen, { timeout: 10_000 }).toContain('typed-42');
});
