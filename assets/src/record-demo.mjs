// Records the README demo with REAL agents (needs logged-in `claude` and `codex`):
//   node assets/src/record-demo.mjs        → assets/src/render/demo.webm + timeline.json
//   bash assets/src/make-gif.sh            → assets/demo.gif
//
// Four agents in throwaway sandbox dirs on an isolated tmux socket:
//   web-tests  Codex, working on a small real task
//   docs       Claude Code (accept-edits mode), finishes on its own
//   api-fix    Claude Code (ask-first mode): raises a permission prompt, approved on camera
//   billing    Claude Code pointed at an unreachable API → retry loop → flagged stalled
// The stall threshold is 0.5 min so the flag appears within the recording.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startTmuxherd } from '../../e2e/harness.js';

const OUT = new URL('./render/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(os.tmpdir(), 'tmuxherd-demo');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sandbox(name, readme) {
  const d = path.join(ROOT, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d]);
  fs.writeFileSync(path.join(d, 'README.md'), readme);
  return d;
}

const th = await startTmuxherd(['--stall-minutes', '0.5']);
const state = () => th.api('GET', '/api/state');
const pane = async (name) => (await state()).panes.find((p) => p.name === name);

async function clearTrust(name, timeout = 60_000) {
  // Folder-trust prompts in brand-new sandbox dirs are answered before recording.
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const p = await pane(name);
    if (p?.state === 'waiting' && p.prompt?.kind === 'trust') {
      const idx = p.prompt.options.findIndex((o) => /trust/i.test(o.label));
      await th.api('POST', `/api/panes/${p.key}/answer`, { fingerprint: p.prompt.fingerprint, option: idx });
      return;
    }
    if (p && p.state !== 'waiting' && Date.now() > end - timeout + 8000) return; // no trust prompt shown
    await sleep(500);
  }
}

async function waitFor(name, pred, timeout = 120_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const p = await pane(name);
    if (p && pred(p)) return p;
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${name}\n${JSON.stringify(await pane(name), null, 1)}`);
}

try {
  const d = {
    web: sandbox('web-tests', '# web-tests\n'),
    docs: sandbox('docs', '# todo-cli\n'),
    api: sandbox('api-fix', '# api\nA tiny HTTP API.\n'),
    billing: sandbox('billing', '# billing\nInvoices and payment retries.\n'),
  };

  await th.api('POST', '/api/spawn', { preset: 'codex', name: 'web-tests', cwd: d.web, args: '-a on-request -s workspace-write', prompt: 'Write fib.py that prints the first 15 Fibonacci numbers, then run it with python3 and show the output.' });
  await th.api('POST', '/api/spawn', { preset: 'claude', name: 'docs', cwd: d.docs, args: '--permission-mode acceptEdits --setting-sources project,local', prompt: 'Rewrite README.md as three short lines describing a tiny todo-list CLI.' });
  await th.api('POST', '/api/spawn', { preset: 'claude', name: 'api-fix', cwd: d.api, args: '--permission-mode default --setting-sources project,local', prompt: 'Create health.js exporting a function health() that returns { ok: true }. Nothing else.' });
  await Promise.all(['web-tests', 'docs', 'api-fix'].map((n) => clearTrust(n)));
  await waitFor('api-fix', (p) => p.state === 'waiting' && p.prompt?.kind === 'permission');

  await th.api('POST', '/api/spawn', { preset: 'custom', harness: 'claude', name: 'billing', cwd: d.billing, command: "ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude --permission-mode default --setting-sources project,local 'Summarize README.md in one line.'" });
  await clearTrust('billing');
  await waitFor('billing', (p) => p.state === 'working');

  // ---- recording
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    bypassCSP: true, // only to inject the visible mouse cursor below
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const t0 = Date.now();
  const timeline = [];
  const mark = (label) => timeline.push({ label, t: (Date.now() - t0) / 1000 });
  // Privacy: Claude Code's banner shows the account's plan name. Redact it
  // wherever it renders (the README caption says so). --setting-sources above
  // keeps the recorder's personal status line, hooks and output style out.
  await context.addInitScript(() => {
    // The renderer may split "Claude" and "Max" into separate styled spans, so
    // decide per container (by its full text) and mask the plan word in every node.
    const PLAN = /Claude\s+(Max|Pro|Team|Enterprise)\b/;
    const scrub = (root) => {
      if (!root || !(root.textContent || '').match(PLAN)) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (/\b(Max|Pro|Team|Enterprise)\b/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\b(Max|Pro|Team|Enterprise)\b/g, (m) => '·'.repeat(m.length));
      }
    };
    window.addEventListener('DOMContentLoaded', () => {
      scrub(document.body);
      new MutationObserver((ms) => ms.forEach((m) => {
        // Scrub the nearest screen-sized container so split spans are seen together.
        let el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        for (let i = 0; i < 4 && el && el.parentElement && !/screen/.test(el.className || ''); i++) el = el.parentElement;
        scrub(el);
      }))
        .observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  });
  await context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      Object.assign(c.style, { position: 'fixed', zIndex: 99999, width: '18px', height: '18px', pointerEvents: 'none', left: '-40px', top: '-40px',
        borderRadius: '50%', border: '2px solid #fff', background: 'rgba(0,0,0,.35)', boxShadow: '0 0 0 1px #000', transform: 'translate(-50%,-50%)', transition: 'left .05s, top .05s' });
      document.body.appendChild(c);
      document.addEventListener('mousemove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    });
  });
  const page = await context.newPage();
  await page.goto(th.url);
  mark('dashboard');
  await sleep(3500);

  const s = await state();
  const key = (n) => s.panes.find((p) => p.name === n).key;
  const glide = async (loc) => {
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  };

  await glide(page.getByTestId(`tile-${key('web-tests')}`));
  mark('hover web-tests');
  await sleep(2800);
  await glide(page.getByTestId(`tile-${key('api-fix')}`));
  mark('hover api-fix');
  await sleep(2500);
  const yes = page.getByTestId(`answer-${key('api-fix')}-0`).first();
  await glide(yes);
  await sleep(900);
  await yes.click();
  mark('approved api-fix');
  await sleep(1500);
  await page.mouse.move(640, 790, { steps: 15 });
  await waitFor('api-fix', (p) => p.state === 'idle', 60_000);
  mark('api-fix idle');
  await page.getByTestId(`tile-${key('billing')}`).waitFor();
  await page.locator(`[data-testid="tile-${key('billing')}"][data-state="stalled"]`).waitFor({ timeout: 90_000 });
  mark('billing stalled');
  await sleep(1500);
  await glide(page.getByTestId(`tile-${key('billing')}`));
  mark('hover billing');
  await sleep(3500);
  mark('end');
  const video = page.video();
  await context.close();
  await browser.close();
  fs.renameSync(await video.path(), path.join(OUT, 'demo.webm'));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
  fs.writeFileSync(new URL('./demo-timeline.json', import.meta.url), JSON.stringify(timeline, null, 1)); // committed copy
  console.log(JSON.stringify({ timeline, files: fs.readdirSync(d.api) }, null, 1));
} finally {
  await th.stop();
}
