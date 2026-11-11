// The poll loop: list panes -> capture -> detect -> track -> watchdog -> events.
//
// Pane keys exposed to the browser:
//   own server pane %12          -> "o12"
//   adopted pane #0, pane %7     -> "a0-7"
// The browser never names a tmux target directly; every request goes through
// resolve(key), which only knows the registry. That is the enforcement point
// for "never touch a pane tmuxherd did not create or was not told to adopt".

import { EventEmitter } from 'node:events';
import { detect } from './detect.js';
import { PaneTracker } from './tracker.js';
import { Watchdog } from './watchdog.js';

export class Supervisor extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./tmux.js').TmuxServer} o.own
   * @param {{server: import('./tmux.js').TmuxServer, paneId: string}[]} [o.adopted]
   * @param {number} [o.intervalMs]
   * @param {number} [o.focusIntervalMs]
   * @param {object} [o.watchdog]  thresholds
   * @param {() => number} [o.now]
   */
  constructor({ own, adopted = [], intervalMs = 1000, focusIntervalMs = 250, watchdog = {}, now = Date.now }) {
    super();
    this.own = own;
    this.adopted = adopted;
    this.intervalMs = intervalMs;
    this.focusIntervalMs = focusIntervalMs;
    this.now = now;
    this.thresholds = { stallMinutes: 5, ...watchdog };
    this.watchdog = new Watchdog(this.thresholds);
    /** @type {Map<string, any>} key -> view */
    this.views = new Map();
    /** @type {Map<string, string>} key -> last raw screen */
    this.screens = new Map();
    /** @type {Map<string, PaneTracker>} */
    this.trackers = new Map();
    /** @type {Map<string, number>} key -> focus expiry */
    this.focus = new Map();
    this.timer = null;
    this.focusTimer = null;
    this.busy = false;
    this.lastError = null;
  }

  configure(thresholds) {
    Object.assign(this.thresholds, thresholds);
    this.watchdog.configure(thresholds);
    for (const t of this.trackers.values()) {
      if (thresholds.stallMinutes != null) t.stallMs = thresholds.stallMinutes * 60_000;
    }
  }

  start() {
    const loop = async () => {
      await this.tick().catch((e) => this.fail(e));
      this.timer = setTimeout(loop, this.intervalMs);
    };
    const floop = async () => {
      await this.tickFocused().catch((e) => this.fail(e));
      this.focusTimer = setTimeout(floop, this.focusIntervalMs);
    };
    loop();
    floop();
  }

  stop() {
    clearTimeout(this.timer);
    clearTimeout(this.focusTimer);
  }

  fail(e) {
    const msg = String(e?.message || e);
    if (msg !== this.lastError) this.emit('log', `poll error: ${msg}`);
    this.lastError = msg;
  }

  setFocus(key, ttlMs = 5000) {
    if (!this.views.has(key)) return false;
    this.focus.set(key, this.now() + ttlMs);
    return true;
  }

  /** Map a browser key to {server, paneId}. Throws if unknown. */
  resolve(key) {
    const view = this.views.get(key);
    if (!view) {
      const e = new Error(`unknown pane ${key}`);
      e.status = 404;
      throw e;
    }
    return { server: view.own ? this.own : this.adopted[view.adoptIndex].server, paneId: view.paneId, view };
  }

  /**
   * Before ANY capture or action on a pane, confirm it is still the pane we
   * registered: same process, and (for own panes) still on a server that
   * carries tmuxherd's ownership marker. This covers tmuxherd's server dying
   * and someone else starting one on the same socket, where pane ids restart
   * and a stale key would otherwise point at a stranger's pane.
   */
  async verify(key) {
    const r = this.resolve(key);
    const fail = (msg) => {
      const e = new Error(msg);
      e.status = 409;
      throw e;
    };
    if (r.view.own) {
      const p = await this.own.describePane(r.paneId).catch(() => null);
      if (!p || !p.ownerMarked || p.pid !== r.view.pid) {
        this.drop(key);
        fail('pane is gone or is no longer the one tmuxherd started');
      }
      return r;
    }
    const a = this.adopted[r.view.adoptIndex];
    const p = await a.server.describePane(a.paneId).catch(() => null);
    if (!p || a.released || p.pid !== a.pid) {
      this.drop(key);
      fail('adopted pane is gone or now runs a different process');
    }
    return r;
  }

  /** Forget one pane's view (and resolve its alerts). */
  drop(key) {
    const v = this.views.get(key);
    if (!v) return;
    this.views.delete(key);
    this.screens.delete(key);
    this.trackers.delete(key);
    this.focus.delete(key);
    for (const r of this.watchdog.forget(v.paneId + (v.own ? '' : `@${v.adoptIndex}`), this.now())) this.emit('resolve', { ...r, key });
    this.emit('removed', key);
  }

  async listAll() {
    const panes = (await this.own.listPanes())
      // The session placeholder window is an implementation detail.
      .filter((p) => !(p.windowName === 'home' && !p.harness))
      .map((p) => ({ ...p, key: `o${p.paneId.slice(1)}`, own: true }));
    for (let i = 0; i < this.adopted.length; i++) {
      const a = this.adopted[i];
      if (a.released) continue;
      try {
        const p = await a.server.describePane(a.paneId);
        if (!p) continue;
        // Pin the adoption to the process that was in the pane when we first saw it.
        // If that tmux server restarts and hands the same %id to another pane,
        // the pid changes and the adoption is released instead of following the id.
        a.pid ??= p.pid;
        if (p.pid !== a.pid) {
          a.released = true;
          this.emit('log', `adopted pane ${a.server.label}:${a.paneId} now runs a different process; released it`);
          continue;
        }
        panes.push({ ...p, key: `a${i}-${a.paneId.slice(1)}`, own: false, adoptIndex: i, socket: a.server.label });
      } catch {
        // Adopted pane is gone; it simply disappears from the view.
      }
    }
    return panes;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      let panes;
      try {
        panes = await this.listAll();
      } catch (e) {
        // If our server can't be listed (or is no longer ours), keep nothing
        // that points into it: stale keys must not reach a stranger's panes.
        for (const [key, v] of [...this.views]) if (v.own) this.drop(key);
        throw e;
      }
      const seen = new Set();
      await Promise.all(panes.map(async (p) => {
        seen.add(p.key);
        await this.observe(p);
      }));
      for (const key of [...this.views.keys()]) if (!seen.has(key)) this.drop(key);
      this.lastError = null;
      this.emit('tick', this.list());
    } finally {
      this.busy = false;
    }
  }

  async tickFocused() {
    const now = this.now();
    for (const [key, until] of this.focus) {
      if (until < now) {
        this.focus.delete(key);
        continue;
      }
      if (!this.views.has(key)) continue;
      let r;
      try {
        r = await this.verify(key);
      } catch {
        continue;
      }
      const screen = await r.server.capture(r.paneId).catch(() => null);
      if (screen != null && screen !== this.screens.get(key)) {
        this.screens.set(key, screen);
        this.emit('screen', key, screen);
      }
    }
  }

  async observe(p) {
    const server = p.own ? this.own : this.adopted[p.adoptIndex].server;
    let screen;
    try {
      screen = await server.capture(p.paneId);
    } catch {
      return;
    }
    const now = this.now();
    const hint = { harness: p.harness, command: p.command };
    const d = detect(screen, hint);
    let t = this.trackers.get(p.key);
    if (!t) {
      t = new PaneTracker(p.key, { stallMinutes: this.thresholds.stallMinutes });
      this.trackers.set(p.key, t);
    }
    // Fallback: tmux prints "Pane is dead (status N, …)" when remain-on-exit keeps the pane.
    let exitStatus = p.exitStatus;
    if (p.dead && exitStatus == null) {
      const m = /Pane is dead \((status|signal) (\d+)/.exec(screen);
      if (m) exitStatus = m[1] === 'status' ? Number(m[2]) : 128 + Number(m[2]);
    }
    const s = t.update({ now, screen, detection: d, dead: p.dead, exitStatus });
    const watchKey = p.paneId + (p.own ? '' : `@${p.adoptIndex}`);
    const { fired, resolved } = this.watchdog.evaluate(watchKey, { name: p.name || p.windowName, harness: d.harness }, s, now, d.prompt);

    const view = {
      key: p.key,
      paneId: p.paneId,
      pid: p.pid,
      own: p.own,
      adoptIndex: p.adoptIndex,
      socket: p.own ? this.own.label : p.socket,
      name: p.name || p.windowName || p.paneId,
      session: p.session,
      harness: d.harness,
      state: s.state,
      since: s.since,
      reason: s.reason,
      pending: s.pending,
      lastProgress: s.lastProgress,
      stuckSince: s.stuckSince,
      prompt: s.state === 'waiting' ? d.prompt : null,
      activity: d.activity,
      error: d.error,
      cwd: p.cwd,
      worktree: p.worktree,
      dead: p.dead,
      exitStatus,
      width: p.width,
      height: p.height,
      created: p.created,
      command: p.spawnCommand,
      attach: server.attachCommand(p.paneId),
    };
    const prev = this.views.get(p.key);
    this.views.set(p.key, view);
    if (!prev || viewChanged(prev, view)) this.emit('pane', view);
    if (screen !== this.screens.get(p.key)) {
      this.screens.set(p.key, screen);
      this.emit('screen', p.key, screen);
    }
    for (const a of fired) this.emit('alert', { ...a, key: p.key });
    for (const r of resolved) this.emit('resolve', { ...r, key: p.key });
  }

  list() {
    return [...this.views.values()];
  }

  alerts() {
    const byWatch = new Map([...this.views.values()].map((v) => [v.paneId + (v.own ? '' : `@${v.adoptIndex}`), v.key]));
    return this.watchdog.list().map((a) => ({ ...a, key: byWatch.get(a.paneId) }));
  }
}

const VIEW_FIELDS = ['state', 'since', 'reason', 'pending', 'name', 'harness', 'activity', 'error', 'cwd', 'dead', 'exitStatus', 'width', 'height', 'worktree', 'stuckSince'];
function viewChanged(a, b) {
  for (const f of VIEW_FIELDS) if (a[f] !== b[f]) return true;
  return (a.prompt?.fingerprint ?? null) !== (b.prompt?.fingerprint ?? null) || (a.prompt?.selected ?? null) !== (b.prompt?.selected ?? null);
}
