// Real agents, real prompts, answered by clicking the dashboard.
// Local only: needs logged-in `claude` and `codex` on PATH. Costs a few cents.
//   npm run e2e:real
// Sandbox dirs are stable paths so the agents' folder-trust records don't pile up.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startTmuxherd } from './harness.js';

test.skip(!process.env.TMUXHERD_REAL_AGENTS, 'set TMUXHERD_REAL_AGENTS=1 to run against real agents');

const SANDBOX = path.join(os.tmpdir(), 'tmuxherd-real-e2e');
let th;

function sandbox(name) {
  const d = path.join(SANDBOX, name);
  fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(path.join(d, '.git'))) execFileSync('git', ['init', '-q', d]);
  fs.rmSync(path.join(d, 'hello.txt'), { force: true });
  return d;
}

test.beforeAll(async () => {
  th = await startTmuxherd();
});
test.afterAll(async () => th?.stop());

/**
 * Drive one agent to completion by answering every prompt it shows through the
 * UI: trust the sandbox folder, then approve the first "yes"-style option.
 * Returns the list of prompts answered.
 */
async function approveUntil(page, key, done, { timeout = 240_000 } = {}) {
  const answered = [];
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (done()) return answered;
    const s = await th.api('GET', '/api/state');
    const pane = s.panes.find((p) => p.key === key);
    if (pane?.state === 'waiting' && pane.prompt) {
      const idx = pane.prompt.options.findIndex((o) => /trust|^yes\b/i.test(o.label));
      expect(idx, `no approving option in ${JSON.stringify(pane.prompt.options)}`).toBeGreaterThanOrEqual(0);
      await expect(page.getByTestId(`inbox-item-${key}`)).toBeVisible();
      await page.getByTestId(`answer-${key}-${idx}`).first().click();
      answered.push({ kind: pane.prompt.kind, question: pane.prompt.question, chose: pane.prompt.options[idx].label });
      // Wait for that prompt to leave before looking again.
      await expect.poll(async () => {
        const p = (await th.api('GET', '/api/state')).panes.find((x) => x.key === key);
        return p?.prompt?.fingerprint !== pane.prompt.fingerprint;
      }, { timeout: 15_000 }).toBe(true);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`timed out; answered ${JSON.stringify(answered)}\n${th.log()}`);
}

async function spawnFromUi(page, { preset, name, cwd, args, prompt }) {
  await page.getByTestId('new-agent').first().click();
  await page.getByTestId('spawn-preset').selectOption(preset);
  await page.getByTestId('spawn-name').fill(name);
  await page.getByTestId('spawn-cwd').fill(cwd);
  await page.getByTestId('spawn-args').fill(args);
  await page.getByTestId('spawn-prompt').fill(prompt);
  await page.getByTestId('spawn-submit').click();
  let key;
  await expect.poll(async () => {
    key = (await th.api('GET', '/api/state')).panes.find((p) => p.name === name)?.key;
    return key;
  }).toBeTruthy();
  return key;
}

test('Claude Code: approve a real file-write permission prompt from the browser', async ({ page }) => {
  const dir = sandbox('claude');
  await page.goto(th.url);
  const key = await spawnFromUi(page, {
    preset: 'claude',
    name: 'real-claude',
    cwd: dir,
    args: '--permission-mode default',
    prompt: 'Create a file named hello.txt containing the word hi. Nothing else.',
  });
  const answered = await approveUntil(page, key, () => fs.existsSync(path.join(dir, 'hello.txt')));
  console.log('claude prompts answered from UI:', JSON.stringify(answered));
  expect(answered.some((a) => a.kind === 'permission')).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8')).toMatch(/hi/);
});

test('Codex CLI: approve a real command-approval prompt from the browser', async ({ page }) => {
  const dir = sandbox('codex');
  await page.goto(th.url);
  const key = await spawnFromUi(page, {
    preset: 'codex',
    name: 'real-codex',
    cwd: dir,
    args: '-a on-request -s read-only',
    prompt: 'Create a file named hello.txt containing the word hi using a shell command. Nothing else.',
  });
  const answered = await approveUntil(page, key, () => fs.existsSync(path.join(dir, 'hello.txt')));
  console.log('codex prompts answered from UI:', JSON.stringify(answered));
  expect(answered.some((a) => a.kind === 'permission')).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8')).toMatch(/hi/);
});
