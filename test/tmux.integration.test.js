// Integration tests against real tmux, each on its own throwaway socket.
// They never touch the default tmux server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TmuxServer } from '../src/tmux.js';
import { Supervisor } from '../src/supervisor.js';
import { answerPrompt, AnswerError } from '../src/answer.js';
import { spawnAgent } from '../src/spawn.js';
import { detect } from '../src/detect.js';

const FAKE = new URL('./fake-agent.js', import.meta.url).pathname;
const servers = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxherd-test-'));
const FOREIGN = path.join(tmp, 'foreign.sock');

// Own servers use socket paths inside the test temp dir, so nothing is left
// behind in the user's tmux socket directory.
function own(suffix) {
  const s = new TmuxServer({ socketPath: path.join(tmp, `own-${suffix}.sock`), own: true });
  servers.push(s);
  return s;
}

after(async () => {
  for (const s of servers) await s.killServer();
  try { execFileSync('tmux', ['-S', FOREIGN, 'kill-server'], { stdio: 'ignore' }); } catch { /* gone */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 8000, step = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(step);
  }
}

test('own server never loads the user\'s ~/.tmux.conf', async () => {
  // A HOME whose tmux.conf sets a marker option. tmux reads $HOME/.tmux.conf
  // (and XDG paths) unless -f is given; our wrapper always passes -f.
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.writeFileSync(path.join(home, '.tmux.conf'), 'set -g @user_conf_loaded yes\n');
  const s = own('conf');
  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  try {
    await s.ensureSession('herd');
    const marker = await s.exec(['show-options', '-gqv', '@user_conf_loaded']);
    assert.equal(marker.trim(), '');
    const roe = await s.exec(['show-options', '-gv', 'remain-on-exit']);
    assert.equal(roe.trim(), 'on', 'bundled conf applied');
  } finally {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
  }
  // Control: the same HOME without -f does load it (proves the test can fail).
  const ctl = path.join(tmp, 'control.sock');
  execFileSync('tmux', ['-S', ctl, 'new-session', '-d', '-s', 'x'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } });
  const loaded = execFileSync('tmux', ['-S', ctl, 'show-options', '-gqv', '@user_conf_loaded'], { encoding: 'utf8' });
  execFileSync('tmux', ['-S', ctl, 'kill-server']);
  assert.equal(loaded.trim(), 'yes');
});

test('spawn → detect prompt → answer by move/verify/confirm → agent acts', async () => {
  const s = own('answer');
  const cwd = fs.mkdtempSync(path.join(tmp, 'ans-'));
  const { paneId } = await spawnAgent(s, { preset: 'custom', harness: 'claude', name: 'fake', cwd, command: `node ${FAKE} permission --file made.txt` });
  const d = await waitFor(async () => {
    const x = detect(await s.capture(paneId), { harness: 'claude' });
    return x.prompt ? x : null;
  });
  assert.equal(d.prompt.question, 'Do you want to proceed?');

  // A stale fingerprint is refused and nothing is sent.
  await assert.rejects(answerPrompt(s, paneId, { fingerprint: '00000000', option: 0 }), AnswerError);
  assert.equal(fs.existsSync(path.join(cwd, 'made.txt')), false);

  // If the pane stops verifying (replaced or gone), it is neither read nor typed into.
  const sent = [];
  const spy = { capture: async (...a) => { sent.push(['capture', ...a]); return s.capture(...a); }, sendKeys: async (...a) => { sent.push(a); } };
  const gone = async () => { throw new Error('pane is gone'); };
  await assert.rejects(answerPrompt(spy, paneId, { fingerprint: d.prompt.fingerprint, option: 1 }, { harness: 'claude' }, { check: gone }), /pane is gone/);
  assert.deepEqual(sent, []);

  const r = await answerPrompt(s, paneId, { fingerprint: d.prompt.fingerprint, option: 1 }, { harness: 'claude' });
  assert.deepEqual(r.sent, ['Down', 'Enter']);
  assert.match(r.chosen, /don't ask again/);
  await waitFor(() => fs.existsSync(path.join(cwd, 'made.txt')));
  const after = detect(await s.capture(paneId), { harness: 'claude' });
  assert.equal(after.prompt, null);
  assert.equal(after.state, 'idle');
});

test('choosing "No" from the bottom moves the cursor down twice and the agent does nothing', async () => {
  const s = own('no');
  const cwd = fs.mkdtempSync(path.join(tmp, 'no-'));
  const { paneId } = await spawnAgent(s, { preset: 'custom', harness: 'claude', name: 'fake', cwd, command: `node ${FAKE} permission --file nope.txt` });
  const d = await waitFor(async () => detect(await s.capture(paneId)).prompt);
  const r = await answerPrompt(s, paneId, { fingerprint: d.fingerprint, option: 2 });
  assert.deepEqual(r.sent, ['Down', 'Down', 'Enter']);
  await waitFor(async () => /User rejected/.test(await s.capture(paneId, { escapes: false })));
  assert.equal(fs.existsSync(path.join(cwd, 'nope.txt')), false);
});

test('foreign panes are invisible unless adopted; adopted panes cannot be killed', async () => {
  execFileSync('tmux', ['-S', FOREIGN, '-f', '/dev/null', 'new-session', '-d', '-s', 'theirs', 'sleep 600']);
  const foreignPane = execFileSync('tmux', ['-S', FOREIGN, 'display-message', '-p', '-t', 'theirs', '#{pane_id}'], { encoding: 'utf8' }).trim();

  const s = own('mine');
  await spawnAgent(s, { preset: 'custom', name: 'mine', cwd: tmp, command: 'sleep 600' });

  const sup = new Supervisor({ own: s });
  await sup.tick();
  assert.deepEqual(sup.list().map((v) => v.name), ['mine']);
  assert.throws(() => sup.resolve(`o${foreignPane.slice(1)}`), /unknown pane/);

  const foreign = new TmuxServer({ socketPath: FOREIGN, own: false });
  await assert.rejects(foreign.killPane(foreignPane), /refusing to kill/);
  await assert.rejects(foreign.listPanes(), /only allowed on the own server/);
  await assert.rejects(foreign.newWindow({ session: 'x', name: 'y', cwd: tmp, argv: ['true'] }), /only allowed on the own server/);

  const sup2 = new Supervisor({ own: s, adopted: [{ server: foreign, paneId: foreignPane }] });
  await sup2.tick();
  // Compare pane identity, not window names (tmux's automatic-rename differs by OS).
  const seen = sup2.list().map((v) => (v.own ? `own:${v.name}` : `adopted:${v.paneId}`)).sort();
  assert.deepEqual(seen, [`adopted:${foreignPane}`, 'own:mine']);
  // Pinned to the adopted process: if the same %id later runs something else, it is released.
  const adoptedKey = sup2.list().find((v) => !v.own).key;
  await sup2.verify(adoptedKey);
  sup2.adopted[0].pid = -1; // simulate: the server restarted and %id now belongs to another process
  await assert.rejects(sup2.verify(adoptedKey), /different process/);
  await sup2.tick();
  assert.deepEqual(sup2.list().map((v) => v.name), ['mine']);
  // The foreign pane is still alive and untouched.
  const alive = execFileSync('tmux', ['-S', FOREIGN, 'list-panes', '-a', '-F', '#{pane_id} #{pane_dead}'], { encoding: 'utf8' }).trim();
  assert.equal(alive, `${foreignPane} 0`);
});

test('spawn in a new git worktree', async () => {
  const s = own('wt');
  const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const r = await spawnAgent(s, { preset: 'shell', cwd: repo, worktree: { branch: 'feat/login' } });
  // realpath: on macOS the temp dir is behind a /var -> /private/var symlink.
  const real = fs.realpathSync(repo);
  const expected = path.join(path.dirname(real), `${path.basename(real)}.worktrees`, 'feat-login');
  assert.equal(r.cwd, expected);
  assert.equal(r.name, 'feat-login');
  assert.ok(fs.existsSync(path.join(expected, '.git')));
  assert.match(git('worktree', 'list'), /feat\/login/);
  const pane = await waitFor(async () => (await s.listPanes()).find((p) => p.paneId === r.paneId && p.cwd === expected));
  assert.equal(pane.worktree, expected);
  // Same branch again is refused rather than clobbered.
  await assert.rejects(spawnAgent(s, { preset: 'shell', cwd: repo, worktree: { branch: 'feat/login' } }), /already exists/);
});

test('supervisor flags a crashed agent as exited with work pending', async () => {
  const s = own('crash');
  await spawnAgent(s, { preset: 'custom', harness: 'claude', name: 'crashy', cwd: tmp, command: `node ${FAKE} crash` });
  const sup = new Supervisor({ own: s, watchdog: { deadMinutes: 0 } });
  const alerts = [];
  sup.on('alert', (a) => alerts.push(a));
  // tmux usually reports the exit status (3). Under load it sometimes never
  // records one; then the tracker counts the unexplained death as pending
  // after 3 s. Either way the agent must end up exited with work pending,
  // and exactly one dead alert must fire.
  const v = await waitFor(async () => {
    await sup.tick();
    return sup.list().find((x) => x.state === 'exited' && x.pending);
  }, { timeout: 12_000 });
  assert.ok(v.exitStatus === 3 || v.exitStatus === null, `exit status ${v.exitStatus}`);
  assert.equal(alerts.filter((a) => a.kind === 'dead').length, 1);
});

test('pane listing parses on every tmux version (no control-character separators)', async () => {
  const { parsePaneLine } = await import('../src/tmux.js');
  const s = own('parse');
  const { paneId } = await spawnAgent(s, { preset: 'custom', name: 'title-test', cwd: tmp, command: "printf '\\033]2;a|~%s~|b\\033\\\\' th; sleep 600" });
  const pane = await waitFor(async () => (await s.listPanes()).find((p) => p.paneId === paneId && p.title.includes('|')));
  assert.equal(pane.title, 'a|~th~|b');
  assert.equal(pane.name, 'title-test');
  assert.equal(parsePaneLine('garbage'), null);
});

test('a server on our socket that tmuxherd did not start is refused, not managed', async () => {
  const { ForeignServerError } = await import('../src/tmux.js');
  // Someone else's server, started without tmuxherd's config, on the socket we'd use.
  const sock = path.join(tmp, 'squatter.sock');
  execFileSync('tmux', ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'theirs', 'sleep 600']);
  const s = new TmuxServer({ socketPath: sock, own: true });
  try {
    assert.equal(await s.ownership(), 'foreign');
    await assert.rejects(s.listPanes(), ForeignServerError);
    await assert.rejects(spawnAgent(s, { preset: 'shell', cwd: tmp }), ForeignServerError);
    const sup = new Supervisor({ own: s });
    await assert.rejects(sup.tick(), ForeignServerError);
    assert.equal(sup.list().length, 0);
    // Nothing was created on their server.
    const panes = execFileSync('tmux', ['-S', sock, 'list-panes', '-a', '-F', '#{session_name}'], { encoding: 'utf8' }).trim();
    assert.equal(panes, 'theirs');

    // The CLI refuses at startup, too (-L names resolve under TMUX_TMPDIR).
    // Short path: macOS limits unix socket paths to ~104 bytes, and its tmpdir is long.
    const sockDir = fs.mkdtempSync('/tmp/th-');
    execFileSync('tmux', ['-L', 'squat', '-f', '/dev/null', 'new-session', '-d', 'sleep 600'], { env: { ...process.env, TMUX_TMPDIR: sockDir } });
    const bin = new URL('../bin/tmuxherd.js', import.meta.url).pathname;
    let err = '';
    try {
      execFileSync(process.execPath, [bin, 'ls', '--socket', 'squat'], { env: { ...process.env, TMUX_TMPDIR: sockDir, XDG_CONFIG_HOME: '/nonexistent' }, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      err = e.stderr;
      assert.equal(e.status, 1);
    }
    assert.match(err, /not started by tmuxherd/);
    execFileSync('tmux', ['-L', 'squat', 'kill-server'], { env: { ...process.env, TMUX_TMPDIR: sockDir } });
    fs.rmSync(sockDir, { recursive: true, force: true });
  } finally {
    execFileSync('tmux', ['-S', sock, 'kill-server']);
  }
});

test('if our server is replaced by a stranger\'s on the same socket, stale keys reach nothing', async () => {
  const sock = path.join(tmp, 'replaced.sock');
  const s = new TmuxServer({ socketPath: sock, own: true });
  servers.push(s);
  await spawnAgent(s, { preset: 'custom', name: 'mine', cwd: tmp, command: 'sleep 600' });
  const sup = new Supervisor({ own: s });
  await sup.tick();
  const key = sup.list()[0].key;
  await sup.verify(key); // ours: fine

  // Our server dies; someone else starts one on the same socket. Pane ids restart,
  // so the stranger's panes reuse ids our stale view still holds.
  await s.killServer();
  // kill-server returns before the old server has fully exited; retry until the socket is free.
  await waitFor(() => {
    try {
      execFileSync('tmux', ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'theirs', 'sleep 600'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  });
  execFileSync('tmux', ['-S', sock, 'new-window', '-d', 'sleep 600']);
  // Before the next poll, every action is refused by verify()...
  await assert.rejects(sup.verify(key), /no longer the one tmuxherd started/);
  assert.equal(sup.views.has(key), false);
  // ...and the next poll keeps no views into the foreign server.
  await sup.tick().catch(() => {});
  assert.equal(sup.list().length, 0);
  execFileSync('tmux', ['-S', sock, 'kill-server']);
});
