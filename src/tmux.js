// Every tmux invocation in tmuxherd goes through this file.
//
// Safety model (see DECISIONS.md D4/D5):
//  - tmuxherd owns exactly one tmux server: `tmux -L <socketName> -f <bundled conf>`.
//    The bundled conf is always passed so the user's ~/.tmux.conf (plugins,
//    resurrect/continuum restore and auto-save) is never loaded into our server.
//  - Panes on any other server are only reachable if the user adopted them
//    explicitly at launch. Adopted panes are addressed by pane id on their own
//    socket and are never killed.
//  - Commands are argv arrays passed to execFile: no shell is involved.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const BUNDLED_CONF = fileURLToPath(new URL('./tmuxherd.conf', import.meta.url));

const PANE_FIELDS = [
  'pane_id', 'session_name', 'window_index', 'window_name', 'pane_index',
  'pane_pid', 'pane_dead', 'pane_dead_status', 'pane_current_command',
  'pane_current_path', 'pane_width', 'pane_height',
  '@th_harness', '@th_name', '@th_worktree', '@th_created', '@th_command', '@tmuxherd_owner',
  'pane_title', // free text set by the program in the pane: keep it last (see parsePaneLine)
];
// Field separator for list-panes output. It must be printable ASCII: tmux
// rewrites control characters in format output, and differently per version
// (3.4 prints "\\037", 3.3a replaces them, tabs included, with "_").
const SEP = '|~th~|';
const PANE_FORMAT = PANE_FIELDS.map((f) => `#{${f}}`).join(SEP);

export class TmuxError extends Error {}

export class ForeignServerError extends TmuxError {
  constructor(label) {
    super(`the tmux server on socket "${label}" was not started by tmuxherd (no @tmuxherd_owner marker); ` +
      'refusing to manage it. Pick another --socket, or use --adopt <socket>:<%pane> for individual panes.');
  }
}

/** Map a raw `list-panes` line to a pane record. */
export function parsePaneLine(line) {
  const v = line.split(SEP);
  if (v.length < PANE_FIELDS.length || !/^%\d+$/.test(v[0])) return null;
  // A pane title that happens to contain the separator is folded back together.
  if (v.length > PANE_FIELDS.length) v.splice(PANE_FIELDS.length - 1, Infinity, v.slice(PANE_FIELDS.length - 1).join(SEP));
  const rec = Object.fromEntries(PANE_FIELDS.map((f, i) => [f, v[i]]));
  return {
    paneId: rec.pane_id,
    session: rec.session_name,
    windowIndex: Number(rec.window_index),
    windowName: rec.window_name,
    paneIndex: Number(rec.pane_index),
    pid: Number(rec.pane_pid) || null,
    dead: rec.pane_dead === '1',
    exitStatus: rec.pane_dead === '1' && rec.pane_dead_status !== '' ? Number(rec.pane_dead_status) : null,
    command: rec.pane_current_command,
    cwd: rec.pane_current_path,
    width: Number(rec.pane_width),
    height: Number(rec.pane_height),
    title: rec.pane_title,
    harness: rec['@th_harness'] || null,
    name: rec['@th_name'] || null,
    worktree: rec['@th_worktree'] || null,
    created: rec['@th_created'] ? Number(rec['@th_created']) : null,
    spawnCommand: rec['@th_command'] || null,
    ownerMarked: rec['@tmuxherd_owner'] === '1',
  };
}

/** Low-level runner. Separated so tests can count/inspect calls. */
export function run(bin, args, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim();
        const e = new TmuxError(msg || 'tmux command failed');
        e.code = err.code;
        reject(e);
      } else resolve(stdout);
    });
  });
}

/**
 * A handle on one tmux server. `own` servers are created and fully managed by
 * tmuxherd; foreign handles (own=false) only allow pane-scoped commands.
 */
export class TmuxServer {
  /**
   * @param {object} o
   * @param {string} [o.socketName]  -L name (own server or a foreign one by name)
   * @param {string} [o.socketPath]  -S path (foreign server by path)
   * @param {boolean} o.own
   * @param {string} [o.bin]
   * @param {string} [o.conf]
   */
  constructor({ socketName, socketPath, own, bin = 'tmux', conf = BUNDLED_CONF }) {
    if (!socketName && !socketPath) throw new Error('socketName or socketPath required');
    if (own && socketName === 'default') throw new Error('refusing to manage the default tmux server');
    if (own && socketPath && /\/default$/.test(socketPath)) throw new Error('refusing to manage the default tmux server');
    this.socketName = socketName;
    this.socketPath = socketPath;
    this.own = own;
    this.bin = bin;
    this.conf = conf;
    this.label = socketName ? socketName : socketPath;
  }

  base() {
    const a = this.socketPath ? ['-S', this.socketPath] : ['-L', this.socketName];
    // -f only matters when a command starts the server; passing it always is
    // what guarantees the user's config never loads into our server.
    if (this.own) a.push('-f', this.conf);
    return a;
  }

  exec(args, opts) {
    return run(this.bin, [...this.base(), ...args], opts);
  }

  async isRunning() {
    try {
      await this.exec(['list-sessions', '-F', '#{session_name}']);
      return true;
    } catch {
      return false;
    }
  }

  /** All panes on our own server. Never called on foreign servers. */
  async listPanes() {
    if (!this.own) throw new Error('listPanes is only allowed on the own server');
    let out;
    try {
      out = await this.exec(['list-panes', '-a', '-F', PANE_FORMAT]);
    } catch (e) {
      if (/no server running|error connecting|No such file/i.test(e.message)) return [];
      throw e;
    }
    const lines = out.split('\n').filter((l) => l.trim());
    const panes = lines.map(parsePaneLine).filter(Boolean);
    if (lines.length && !panes.length) {
      throw new TmuxError(`could not parse tmux list-panes output (tmux version not supported?): ${lines[0].slice(0, 120)}`);
    }
    // The marker is a global option, so every pane reports it. A server someone
    // else started on our socket name has none: touch nothing on it.
    if (panes.some((p) => !p.ownerMarked)) throw new ForeignServerError(this.label);
    return panes;
  }

  /** 'none' (no server), 'ours' (started with our conf) or 'foreign'. */
  async ownership() {
    if (!this.own) return 'foreign';
    let v;
    try {
      v = await this.exec(['show-options', '-gqv', '@tmuxherd_owner']);
    } catch (e) {
      if (/no server running|error connecting|No such file/i.test(e.message)) return 'none';
      throw e;
    }
    return v.trim() === '1' ? 'ours' : 'foreign';
  }

  /** One pane by id; works on foreign servers because it targets only that pane. */
  async describePane(paneId) {
    assertPaneId(paneId);
    const out = await this.exec(['display-message', '-p', '-t', paneId, PANE_FORMAT]);
    return parsePaneLine(out.replace(/\n$/, ''));
  }

  /** Styled snapshot of the visible screen (plus `history` lines of scrollback). */
  async capture(paneId, { history = 0, escapes = true } = {}) {
    assertPaneId(paneId);
    const args = ['capture-pane', '-p', '-t', paneId];
    if (escapes) args.push('-e');
    if (history > 0) args.push('-S', String(-history));
    return this.exec(args);
  }

  /** Send tmux key names (e.g. ["Down","Enter"]). */
  async sendKeys(paneId, keys) {
    assertPaneId(paneId);
    for (const k of keys) assertKeyName(k);
    if (!keys.length) return Promise.resolve('');
    return this.exec(['send-keys', '-t', paneId, ...keys]);
  }

  /** Type literal text (no key-name interpretation). */
  async sendText(paneId, text) {
    assertPaneId(paneId);
    if (typeof text !== 'string' || !text) return Promise.resolve('');
    return this.exec(['send-keys', '-t', paneId, '-l', '--', text]);
  }

  async ensureSession(session) {
    if (!this.own) throw new Error('not own server');
    assertName(session);
    if ((await this.ownership()) === 'foreign') throw new ForeignServerError(this.label);
    try {
      await this.exec(['has-session', '-t', `=${session}`]);
    } catch {
      // A placeholder window keeps the session alive when all agents exit.
      await this.exec(['new-session', '-d', '-s', session, '-n', 'home', '-x', '200', '-y', '50']);
    }
  }

  /**
   * Start a new window running argv in cwd. Returns the new pane id.
   * @param {{session:string,name:string,cwd:string,argv:string[],env?:Record<string,string>,options?:Record<string,string>}} o
   */
  async newWindow({ session, name, cwd, argv, env = {}, options = {} }) {
    if (!this.own) throw new Error('spawning is only allowed on the own server');
    assertName(session);
    await this.ensureSession(session);
    const args = ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${session}:`, '-n', name, '-c', cwd];
    for (const [k, v] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`bad env name ${k}`);
      args.push('-e', `${k}=${v}`);
    }
    // tmux runs a multi-argument command directly (execvp), without a shell.
    // A single-argument command would go through /bin/sh, so wrap it in an
    // explicit `sh -c` only when the caller passed one shell string.
    args.push('--', ...argv);
    const paneId = (await this.exec(args)).trim();
    assertPaneId(paneId);
    for (const [k, v] of Object.entries(options)) await this.setPaneOption(paneId, k, v);
    return paneId;
  }

  setPaneOption(paneId, key, value) {
    assertPaneId(paneId);
    if (!/^@th_[a-z_]+$/.test(key)) throw new Error(`bad option ${key}`);
    return this.exec(['set-option', '-p', '-t', paneId, key, String(value)]);
  }

  async killPane(paneId) {
    if (!this.own) throw new Error('refusing to kill a pane on a foreign tmux server');
    assertPaneId(paneId);
    return this.exec(['kill-pane', '-t', paneId]);
  }

  async resizeWindow(paneId, cols, rows) {
    if (!this.own) throw new Error('refusing to resize a foreign pane');
    assertPaneId(paneId);
    const c = clampInt(cols, 20, 400);
    const r = clampInt(rows, 5, 200);
    return this.exec(['resize-window', '-t', paneId, '-x', String(c), '-y', String(r)]);
  }

  async killServer() {
    if (!this.own) throw new Error('refusing to kill a foreign tmux server');
    return this.exec(['kill-server']).catch(() => '');
  }

  attachCommand(paneId) {
    const sock = this.socketPath ? `-S ${shq(this.socketPath)}` : `-L ${this.socketName}`;
    return `tmux ${sock} attach -t ${paneId}`;
  }
}

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) throw new Error('not a number');
  return Math.min(hi, Math.max(lo, x));
}

export function assertPaneId(id) {
  if (typeof id !== 'string' || !/^%\d+$/.test(id)) throw new Error(`invalid pane id: ${id}`);
}

export function assertName(n) {
  if (typeof n !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(n)) throw new Error(`invalid name: ${n}`);
}

// Key names tmux understands, plus single printable characters and C-/M- chords.
const NAMED_KEYS = new Set([
  'Enter', 'Escape', 'Tab', 'BTab', 'BSpace', 'Space', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'PPage', 'NPage', 'DC', 'IC',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);
export function assertKeyName(k) {
  if (typeof k !== 'string') throw new Error('key must be a string');
  if (NAMED_KEYS.has(k)) return;
  if (/^(?:[CMS]-)+(?:[A-Za-z0-9]|Enter|Tab|Up|Down|Left|Right|BSpace|Space|Escape)$/.test(k)) return;
  throw new Error(`key not allowed: ${k}`);
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Parse an `--adopt` spec: `<socket-name-or-path>:%<id>`. */
export function parseAdoptSpec(spec) {
  const m = /^(.+):(%\d+)$/.exec(spec || '');
  if (!m) throw new Error(`--adopt expects <socket>:<%pane>, got "${spec}"`);
  const [, sock, paneId] = m;
  return sock.includes('/') ? { socketPath: path.resolve(sock), paneId } : { socketName: sock, paneId };
}
