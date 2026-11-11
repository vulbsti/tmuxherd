// Stall / dead-with-work-pending logic and the watchdog, with a fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect } from '../src/detect.js';
import { PaneTracker } from '../src/tracker.js';
import { Watchdog } from '../src/watchdog.js';

const cap = (n) => fs.readFileSync(new URL(`./fixtures/captures/${n}`, import.meta.url), 'utf8');
const MIN = 60_000;

function feed(tracker, now, screen, extra = {}) {
  return tracker.update({ now, screen, detection: detect(screen), dead: false, exitStatus: null, ...extra });
}

test('working with only a ticking timer becomes stalled after stallMinutes, and alerts once', () => {
  const t = new PaneTracker('p', { stallMinutes: 5 });
  const w = new Watchdog({ stallMinutes: 5 });
  const frame = (s) => `❯ refactor\n✻ Pondering… (${s}s · ↓ 12 tokens)\n`;
  let fired = [];
  for (let s = 0; s <= 6 * 60; s += 30) {
    const snap = feed(t, s * 1000, frame(s));
    fired.push(...w.evaluate('p', { name: 'a' }, snap, s * 1000).fired);
    if (s < 300) assert.equal(snap.state, 'working', `at ${s}s`);
  }
  assert.equal(t.state, 'stalled');
  assert.equal(t.reason, 'no screen progress');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].kind, 'stalled');
  // New output resolves the stall.
  const snap = feed(t, 7 * MIN, `${frame(420)}● wrote parser.ts\n`);
  assert.equal(snap.state, 'working');
  const { resolved } = w.evaluate('p', { name: 'a' }, snap, 7 * MIN);
  assert.equal(resolved.length, 1);
});

test('real output resets the stall clock', () => {
  const t = new PaneTracker('p', { stallMinutes: 5 });
  for (let m = 0; m <= 20; m++) {
    const snap = feed(t, m * MIN, `✻ Working… (${m}m · ↓ 1 tokens)\n● step ${'x'.repeat(m)}\n`);
    assert.equal(snap.state, 'working');
  }
});

test('recorded Claude retry loop: stalled after N minutes even though the retry text changes', () => {
  const t = new PaneTracker('p', { stallMinutes: 2 });
  const retry = cap('claude-retrying.txt');
  const variants = [retry, retry.replace('attempt 5/10', 'attempt 6/10'), retry.replace('attempt 5/10', 'attempt 7/10')];
  let snap;
  for (let s = 0; s <= 150; s += 10) snap = feed(t, s * 1000, variants[(s / 10) % 3]);
  assert.equal(snap.state, 'stalled');
  assert.equal(snap.reason, 'retrying without success');
});

test('recorded Claude API error after working → stalled immediately; same screen with no prior work → idle', () => {
  const busy = new PaneTracker('p');
  feed(busy, 0, cap('claude-thinking.txt'));
  assert.equal(feed(busy, 1000, cap('claude-api-error.txt')).state, 'stalled');

  const fresh = new PaneTracker('q');
  assert.equal(feed(fresh, 0, cap('claude-api-error.txt')).state, 'idle');
});

test('clean finish clears pending work; a later exit is not an alert', () => {
  const t = new PaneTracker('p');
  const w = new Watchdog();
  feed(t, 0, cap('codex-working.txt'));
  feed(t, 1000, cap('codex-idle.txt'));
  const snap = feed(t, 2000, cap('codex-idle.txt'), { dead: true, exitStatus: 0 });
  assert.equal(snap.state, 'exited');
  assert.equal(snap.pending, false);
  assert.deepEqual(w.evaluate('p', {}, snap, 2000).fired, []);
});

test('dying mid-task, or with a failure status, is dead-with-work-pending', () => {
  const w = new Watchdog({ deadMinutes: 1 });
  const t = new PaneTracker('p');
  feed(t, 0, cap('claude-working-bash.txt'));
  let snap = feed(t, 1000, cap('claude-working-bash.txt'), { dead: true, exitStatus: 0 });
  assert.equal(snap.state, 'exited');
  assert.equal(snap.pending, true);
  assert.equal(w.evaluate('p', {}, snap, 30_000).fired.length, 0, 'waits deadMinutes');
  snap = feed(t, 61_000, cap('claude-working-bash.txt'), { dead: true, exitStatus: 0 });
  assert.equal(w.evaluate('p', {}, snap, 61_000).fired[0].kind, 'dead');

  const t2 = new PaneTracker('q');
  const s2 = feed(t2, 0, 'bye', { dead: true, exitStatus: 2 });
  assert.equal(s2.pending, true);

  // tmux may report the pane dead one tick before its exit status...
  const t3 = new PaneTracker('r');
  assert.equal(feed(t3, 0, 'bye', { dead: true, exitStatus: null }).pending, false);
  assert.equal(feed(t3, 1000, 'bye', { dead: true, exitStatus: 3 }).pending, true);
  // ...or never record one at all: after 3 s an unexplained death counts as pending.
  const t4 = new PaneTracker('s');
  assert.equal(feed(t4, 0, 'bye', { dead: true, exitStatus: null }).pending, false);
  const s4 = feed(t4, 3500, 'bye', { dead: true, exitStatus: null });
  assert.equal(s4.pending, true);
  assert.equal(s4.reason, 'exited (status unknown)');
  // A clean status that arrives late withdraws the "unexplained death" verdict.
  assert.equal(feed(t4, 5000, 'bye', { dead: true, exitStatus: 0 }).pending, false);
});

test('waiting prompt alerts once per prompt, after waitingMinutes', () => {
  const t = new PaneTracker('p');
  const w = new Watchdog({ waitingMinutes: 1 });
  const screen = cap('codex-approval.txt');
  const d = detect(screen);
  let snap = feed(t, 0, screen);
  assert.equal(w.evaluate('p', {}, snap, 0, d.prompt).fired.length, 0);
  snap = feed(t, 61_000, screen);
  const { fired } = w.evaluate('p', {}, snap, 61_000, d.prompt);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].detail, 'Would you like to run the following command?');
  snap = feed(t, 120_000, screen);
  assert.equal(w.evaluate('p', {}, snap, 120_000, d.prompt).fired.length, 0);
});

test('a usage-limit wait ("continuing automatically at …") counts as no progress and stalls', () => {
  const t = new PaneTracker('p', { stallMinutes: 5 });
  const screen = (n) => `❯ fix the tests\n● Usage limit reached · continuing automatically at 10:10pm · esc to cancel\n✻ Waiting… (${n}s)\n`;
  let snap;
  for (let s = 0; s <= 6 * 60; s += 30) snap = feed(t, s * 1000, screen(s));
  assert.equal(snap.state, 'stalled');
  assert.equal(snap.reason, 'retrying without success');
});

test('recorded Codex screens: reconnect loop stalls; dying mid-turn is dead-with-work-pending', () => {
  const t = new PaneTracker('c', { stallMinutes: 2 });
  const rec = cap('codex-reconnecting.txt');
  let snap;
  for (let s = 0; s <= 150; s += 10) snap = feed(t, s * 1000, rec.replace('(19s •', `(${s}s •`));
  assert.equal(snap.state, 'stalled');
  assert.equal(snap.reason, 'retrying without success');

  const w = new Watchdog({ deadMinutes: 0 });
  const t2 = new PaneTracker('d');
  feed(t2, 0, cap('codex-working.txt'));
  const dead = feed(t2, 1000, cap('codex-working.txt'), { dead: true, exitStatus: 0 });
  assert.equal(dead.state, 'exited');
  assert.equal(dead.pending, true);
  assert.equal(w.evaluate('d', { name: 'cx' }, dead, 1000).fired[0].kind, 'dead');
});
