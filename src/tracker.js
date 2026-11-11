// Per-pane state over time. detect() says what the screen shows now; the
// tracker adds memory: when did the screen last make progress, did this agent
// have work in flight, how long has a prompt been waiting, did it die mid-task.
//
// Final states: working | waiting | idle | stalled | exited
// See DECISIONS.md D7 for the definition of "stalled".

import { progressKey } from './detect.js';

const UNKNOWN_EXIT_MS = 3000;

export const DEFAULTS = {
  stallMinutes: 5, // no progress while working/retrying for this long -> stalled
  activeWindowSeconds: 4, // generic harness: screen changed within this window -> working
};

export class PaneTracker {
  constructor(paneId, { stallMinutes = DEFAULTS.stallMinutes, activeWindowSeconds = DEFAULTS.activeWindowSeconds } = {}) {
    this.paneId = paneId;
    this.stallMs = stallMinutes * 60_000;
    this.activeMs = activeWindowSeconds * 1000;
    this.key = null;
    this.lastProgress = null; // last time the normalized screen changed
    this.pending = false; // agent has work in flight (task given, not cleanly finished)
    this.state = null;
    this.since = null; // when `state` began
    this.stuckSince = null; // when the current no-progress-with-pending-work episode began
    this.reason = null;
    this.deadAt = null;
    this.pendingAtDeath = false;
    this.waitingSince = null;
    this.retrySince = null;
    this.errorSince = null;
  }

  /**
   * @param {object} o
   * @param {number} o.now           ms timestamp
   * @param {string} o.screen        raw capture
   * @param {ReturnType<import('./detect.js').detect>} o.detection
   * @param {boolean} o.dead
   * @param {number|null} o.exitStatus
   */
  update({ now, screen, detection, dead, exitStatus }) {
    const key = progressKey(screen);
    if (key !== this.key) {
      this.key = key;
      this.lastProgress = now;
    }
    const d = detection;
    let state;
    let reason = null;

    if (dead) {
      if (this.deadAt == null) {
        this.deadAt = now;
        this.pendingAtDeath = this.pending;
      }
      // Dying while busy, or with a failure status, leaves work pending. tmux can
      // report the pane dead before its exit status (or, under load on tmux 3.4,
      // never record one), so decide again on every tick:
      if (exitStatus != null) this.pending = this.pendingAtDeath || exitStatus !== 0;
      else this.pending = this.pendingAtDeath || now - this.deadAt >= UNKNOWN_EXIT_MS; // unexplained death
      state = 'exited';
      reason = exitStatus == null ? 'exited (status unknown)' : `exit status ${exitStatus}`;
      this.stuckSince = this.pending ? this.deadAt : null;
    } else {
      this.deadAt = null;
      let visible = d.state;
      if (visible === 'unknown') visible = now - this.lastProgress <= this.activeMs && this.since != null ? 'working' : 'idle';

      if (visible === 'waiting') {
        this.waitingSince ??= now;
        this.pending = true;
        state = 'waiting';
        this.stuckSince = null;
      } else {
        this.waitingSince = null;
        if (visible === 'working') {
          this.pending = true;
          this.errorSince = null;
          if (d.retrying) this.retrySince ??= now;
          else this.retrySince = null;
          // Retrying counts as no progress even though retry text changes.
          const lastReal = d.retrying ? Math.min(this.retrySince, this.lastProgress) : this.lastProgress;
          const stuckFor = now - lastReal;
          if (stuckFor >= this.stallMs) {
            state = 'stalled';
            reason = d.retrying ? 'retrying without success' : 'no screen progress';
            this.stuckSince = lastReal;
          } else {
            state = 'working';
            this.stuckSince = null;
          }
        } else {
          // idle
          this.retrySince = null;
          if (d.error && this.pending) {
            this.errorSince ??= now;
            state = 'stalled';
            reason = d.error;
            this.stuckSince = this.errorSince;
          } else {
            this.errorSince = null;
            this.pending = false;
            state = 'idle';
            this.stuckSince = null;
          }
        }
      }
    }

    if (state !== this.state) {
      this.state = state;
      this.since = now;
    }
    this.reason = reason;
    return this.snapshot(now);
  }

  snapshot(now) {
    return {
      state: this.state,
      since: this.since,
      reason: this.reason,
      pending: this.pending,
      lastProgress: this.lastProgress,
      stuckSince: this.stuckSince,
      waitingSince: this.waitingSince,
      deadAt: this.deadAt,
      idleFor: this.lastProgress != null ? now - this.lastProgress : 0,
    };
  }
}
