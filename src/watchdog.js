// Turns tracker snapshots into alerts. An alert fires once per episode and
// resolves when the condition clears. Delivery (browser, desktop, webhook)
// is the notifier's job.
//
// Rules (all thresholds configurable):
//   stalled  — tracker state is `stalled` and the agent has made no progress
//              with work pending for >= stallMinutes
//   dead     — pane exited with work pending, for >= deadMinutes (default 0)
//   waiting  — a prompt has waited for an answer for >= waitingMinutes (default 0)

export const WATCHDOG_DEFAULTS = { stallMinutes: 5, deadMinutes: 0, waitingMinutes: 0, notifyWaiting: true };

export class Watchdog {
  constructor(opts = {}) {
    this.opts = { ...WATCHDOG_DEFAULTS, ...opts };
    /** @type {Map<string, {kind:string, episode:number, alert:object}>} */
    this.active = new Map();
  }

  configure(opts) {
    Object.assign(this.opts, opts);
  }

  /**
   * @param {string} paneId
   * @param {{name?:string, harness?:string}} meta
   * @param {ReturnType<import('./tracker.js').PaneTracker['snapshot']>} s
   * @param {number} now
   * @param {object|null} prompt
   * @returns {{fired: object[], resolved: object[]}}
   */
  evaluate(paneId, meta, s, now, prompt = null) {
    const fired = [];
    const resolved = [];
    const want = [];
    const min = 60_000;
    if (s.state === 'stalled' && s.stuckSince != null && now - s.stuckSince >= this.opts.stallMinutes * min) {
      want.push({ kind: 'stalled', episode: s.stuckSince, detail: s.reason });
    }
    // Error-stalls are explicit; they alert after the same N minutes as silent stalls.
    if (s.state === 'exited' && s.pending && s.deadAt != null && now - s.deadAt >= this.opts.deadMinutes * min) {
      want.push({ kind: 'dead', episode: s.deadAt, detail: s.reason });
    }
    if (this.opts.notifyWaiting && s.state === 'waiting' && s.waitingSince != null && now - s.waitingSince >= this.opts.waitingMinutes * min) {
      want.push({ kind: 'waiting', episode: s.waitingSince, detail: prompt?.question || 'needs input' });
    }

    const wantedKinds = new Set(want.map((w) => w.kind));
    for (const w of want) {
      const id = `${paneId}:${w.kind}`;
      const cur = this.active.get(id);
      if (cur && cur.episode === w.episode) continue;
      const alert = {
        id: `${id}:${w.episode}`,
        paneId,
        kind: w.kind,
        name: meta.name || paneId,
        harness: meta.harness || 'generic',
        detail: w.detail || '',
        since: w.episode,
        at: now,
      };
      this.active.set(id, { kind: w.kind, episode: w.episode, alert });
      fired.push(alert);
    }
    for (const [id, cur] of this.active) {
      if (!id.startsWith(`${paneId}:`)) continue;
      if (!wantedKinds.has(cur.kind)) {
        this.active.delete(id);
        resolved.push({ ...cur.alert, resolvedAt: now });
      }
    }
    return { fired, resolved };
  }

  /** Drop a pane's alerts (pane gone). Returns them, marked resolved. */
  forget(paneId, now = Date.now()) {
    const out = [];
    for (const [id, cur] of [...this.active]) {
      if (id.startsWith(`${paneId}:`)) {
        this.active.delete(id);
        out.push({ ...cur.alert, resolvedAt: now, reason: 'pane removed' });
      }
    }
    return out;
  }

  list() {
    return [...this.active.values()].map((v) => v.alert);
  }
}
