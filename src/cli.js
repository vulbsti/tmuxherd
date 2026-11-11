// Command-line entry: argument parsing, config file, and the serve/ls/attach commands.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { TmuxServer, ForeignServerError, parseAdoptSpec, run, BUNDLED_CONF } from './tmux.js';
import { Supervisor } from './supervisor.js';
import { Notifier } from './notify.js';
import { createServer, newToken } from './server.js';
import { DEFAULT_PRESETS } from './spawn.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `tmuxherd ${VERSION} — supervise terminal coding agents in tmux from your browser

Usage:
  tmuxherd [serve] [options]   start the dashboard (default)
  tmuxherd ls [--json]         print every agent and its state, then exit
  tmuxherd attach [name]       attach your terminal to tmuxherd's tmux server

Options:
  -p, --port <n>             port on 127.0.0.1 (default 7420; 0 = random)
      --socket <name>        tmux socket name for tmuxherd's own server (default "tmuxherd")
      --session <name>       tmux session new agents go into (default "herd")
      --stall-minutes <n>    working with no progress (or erroring) this long = stalled alert (default 5)
      --dead-minutes <n>     alert when an agent exited with work pending for this long (default 0)
      --waiting-minutes <n>  alert when a prompt has waited this long (default 0)
      --no-notify-waiting    don't alert on pending prompts
      --desktop-notify       also send desktop notifications (notify-send / osascript)
      --webhook <url>        also POST alerts to this URL
      --webhook-format <f>   json (default) | slack | text
      --adopt <sock>:<%id>   opt in to supervising one existing pane on another tmux
                             server, e.g. --adopt default:%3 (repeatable). Adopted panes
                             are never killed or resized.
      --interval <ms>        poll interval (default 1000)
      --config <file>        JSON config (default $XDG_CONFIG_HOME/tmuxherd/config.json)
      --open                 open the dashboard in your browser
      --host <addr>          bind address (default 127.0.0.1). Non-loopback needs --allow-remote
      --allow-remote         permit a non-loopback bind (read SECURITY.md first)
      --allowed-origin <url> accept this extra origin, e.g. behind tailscale serve or a
                             reverse proxy: --allowed-origin https://box.tailnet.ts.net
  -h, --help                 show this help
  -v, --version              print the version

Environment:
  TMUXHERD_TOKEN             use this token instead of a random one (for scripted use)
`;

const OPTIONS = {
  port: { type: 'string', short: 'p' },
  socket: { type: 'string' },
  session: { type: 'string' },
  'stall-minutes': { type: 'string' },
  'dead-minutes': { type: 'string' },
  'waiting-minutes': { type: 'string' },
  'no-notify-waiting': { type: 'boolean' },
  'desktop-notify': { type: 'boolean' },
  webhook: { type: 'string' },
  'webhook-format': { type: 'string' },
  adopt: { type: 'string', multiple: true },
  interval: { type: 'string' },
  config: { type: 'string' },
  open: { type: 'boolean' },
  host: { type: 'string' },
  'allow-remote': { type: 'boolean' },
  'allowed-origin': { type: 'string', multiple: true },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function num(v, name, { min = 0, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be a number between ${min} and ${max}`);
  return n;
}

export function defaultConfigPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'tmuxherd', 'config.json');
}

/** Merge defaults < config file < flags. Exported for tests. */
export function resolveOptions(argv, env = process.env) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const cfgPath = values.config || defaultConfigPath(env);
  let file = {};
  if (fs.existsSync(cfgPath)) {
    try {
      file = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      throw new Error(`could not parse ${cfgPath}: ${e.message}`, { cause: e });
    }
  } else if (values.config) throw new Error(`config file not found: ${cfgPath}`);

  const pick = (flag, key, conv = (x) => x) => (values[flag] != null ? conv(values[flag]) : file[key]);
  const o = {
    command: positionals[0] || 'serve',
    rest: positionals.slice(1),
    port: pick('port', 'port', (v) => num(v, 'port', { max: 65535 })) ?? 7420,
    host: pick('host', 'host') ?? '127.0.0.1',
    allowRemote: Boolean(values['allow-remote'] ?? file.allowRemote ?? false),
    socket: pick('socket', 'socket') ?? 'tmuxherd',
    session: pick('session', 'session') ?? 'herd',
    stallMinutes: pick('stall-minutes', 'stallMinutes', (v) => num(v, 'stall-minutes')) ?? 5,
    deadMinutes: pick('dead-minutes', 'deadMinutes', (v) => num(v, 'dead-minutes')) ?? 0,
    waitingMinutes: pick('waiting-minutes', 'waitingMinutes', (v) => num(v, 'waiting-minutes')) ?? 0,
    notifyWaiting: values['no-notify-waiting'] ? false : (file.notifyWaiting ?? true),
    desktop: Boolean(values['desktop-notify'] ?? file.desktopNotify ?? false),
    webhook: pick('webhook', 'webhook') ?? null,
    webhookFormat: pick('webhook-format', 'webhookFormat') ?? 'json',
    adopt: values.adopt ?? file.adopt ?? [],
    allowedOrigins: values['allowed-origin'] ?? file.allowedOrigins ?? [],
    interval: pick('interval', 'interval', (v) => num(v, 'interval', { min: 100, max: 60000 })) ?? 1000,
    open: Boolean(values.open),
    json: Boolean(values.json),
    help: Boolean(values.help),
    version: Boolean(values.version),
    presets: { ...DEFAULT_PRESETS, ...(file.presets || {}) },
    token: env.TMUXHERD_TOKEN || null,
  };
  for (const u of o.allowedOrigins) {
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`--allowed-origin ${u} is not a URL`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search) throw new Error(`--allowed-origin must be a bare origin like https://host[:port], got ${u}`);
  }
  if (!['json', 'slack', 'text'].includes(o.webhookFormat)) throw new Error('--webhook-format must be json, slack or text');
  if (o.socket === 'default') throw new Error('--socket default is the normal tmux server; tmuxherd needs its own (use --adopt for existing panes)');
  if (!/^[A-Za-z0-9_.-]+$/.test(o.socket)) throw new Error('--socket must be a plain name');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(o.host);
  if (!loopback && !o.allowRemote) throw new Error(`refusing to bind ${o.host}: pass --allow-remote if you really mean it (see SECURITY.md)`);
  for (const [k, p] of Object.entries(o.presets)) {
    if (!Array.isArray(p.argv) || !p.argv.length || !p.argv.every((s) => typeof s === 'string')) throw new Error(`preset ${k}: argv must be a non-empty string array`);
  }
  return o;
}

async function checkTmux() {
  try {
    const v = (await run('tmux', ['-V'])).trim();
    const m = /tmux (?:next-)?(\d+)\.(\d+)/.exec(v);
    if (m && (Number(m[1]) < 3 || (Number(m[1]) === 3 && Number(m[2]) < 2))) {
      throw new Error(`${v} found; tmuxherd needs tmux 3.2 or newer`);
    }
    return v;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('tmux is not installed (Linux: apt/dnf install tmux, macOS: brew install tmux)', { cause: e });
    throw e;
  }
}

function buildSupervisor(o) {
  const own = new TmuxServer({ socketName: o.socket, own: true });
  const adopted = o.adopt.map((spec) => {
    const { socketName, socketPath, paneId } = parseAdoptSpec(spec);
    if (socketName === o.socket) throw new Error(`--adopt ${spec}: panes on tmuxherd's own server are already supervised`);
    return { server: new TmuxServer({ socketName, socketPath, own: false }), paneId };
  });
  return new Supervisor({
    own,
    adopted,
    intervalMs: o.interval,
    watchdog: { stallMinutes: o.stallMinutes, deadMinutes: o.deadMinutes, waitingMinutes: o.waitingMinutes, notifyWaiting: o.notifyWaiting },
  });
}

function fmtAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  let o;
  try {
    o = resolveOptions(argv);
  } catch (e) {
    stderr.write(`tmuxherd: ${e.message}\n`);
    return 2;
  }
  if (o.help) {
    stdout.write(HELP);
    return 0;
  }
  if (o.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  try {
    await checkTmux();
  } catch (e) {
    stderr.write(`tmuxherd: ${e.message}\n`);
    return 1;
  }

  if (o.command === 'attach') {
    const owner = await new TmuxServer({ socketName: o.socket, own: true }).ownership();
    if (owner === 'foreign') {
      stderr.write(`tmuxherd: ${new ForeignServerError(o.socket).message}\n`);
      return 1;
    }
    if (owner === 'none') {
      stderr.write(`tmuxherd: no tmuxherd server is running on socket "${o.socket}"\n`);
      return 1;
    }
    const target = o.rest[0];
    const args = ['-L', o.socket, '-f', BUNDLED_CONF, 'attach', ...(target ? ['-t', target] : [])];
    const child = spawn('tmux', args, { stdio: 'inherit' });
    return new Promise((r) => child.on('exit', (code) => r(code ?? 0)));
  }

  const sup = buildSupervisor(o);
  if ((await sup.own.ownership()) === 'foreign') {
    stderr.write(`tmuxherd: ${new ForeignServerError(o.socket).message}\n`);
    return 1;
  }

  if (o.command === 'ls') {
    // Two polls so the tracker has a baseline; ls shows current visible states.
    await sup.tick();
    const panes = sup.list();
    if (o.json) stdout.write(`${JSON.stringify(panes, null, 2)}\n`);
    else if (!panes.length) stdout.write(`no agents on tmux socket "${o.socket}"\n`);
    else {
      const now = Date.now();
      for (const p of panes) {
        const extra = p.state === 'waiting' ? `  ? ${p.prompt?.question || ''}` : p.reason ? `  (${p.reason})` : '';
        // A one-shot poll has no history, so the time column is uptime since spawn.
        const up = p.created ? fmtAge(now - p.created) : '-';
        stdout.write(`${p.key.padEnd(6)} ${p.name.padEnd(18).slice(0, 18)} ${p.harness.padEnd(7)} ${p.state.padEnd(8)} ${up.padStart(6)}  ${p.cwd}${extra}\n`);
      }
    }
    return 0;
  }

  if (o.command !== 'serve') {
    stderr.write(`tmuxherd: unknown command "${o.command}" (try --help)\n`);
    return 2;
  }

  const token = o.token || newToken();
  const log = (s) => stderr.write(`[${new Date().toLocaleTimeString()}] ${s}\n`);
  const notifier = new Notifier({ desktop: o.desktop, webhook: o.webhook, webhookFormat: o.webhookFormat, log });
  const srv = createServer({ supervisor: sup, notifier, token, port: o.port, allowRemote: o.allowRemote, allowedOrigins: o.allowedOrigins, presets: o.presets, session: o.session, version: VERSION, log });
  sup.on('log', log);
  let port;
  try {
    port = await srv.listen(o.host);
  } catch (e) {
    stderr.write(`tmuxherd: cannot listen on ${o.host}:${o.port}: ${e.message}${e.code === 'EADDRINUSE' ? ' (another tmuxherd? use --port 0 for a random port)' : ''}\n`);
    return 1;
  }
  sup.start();
  const shownHost = o.host.includes(':') ? `[${o.host}]` : o.host;
  const url = `http://${shownHost}:${port}/?token=${token}`;
  if (!['127.0.0.1', 'localhost', '::1'].includes(o.host)) {
    stderr.write('WARNING: listening on a non-loopback address. Anyone who can reach this port and has the token can type into your agents.\n');
  }
  stdout.write(`tmuxherd ${VERSION} ready\n  dashboard: ${url}\n  tmux:      tmux -L ${o.socket} attach    (agents keep running if you stop the dashboard)\n`);
  if (o.adopt.length) stdout.write(`  adopted:   ${o.adopt.join(', ')}\n`);
  if (o.open) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
    const warn = () => stderr.write(`tmuxherd: could not open a browser (${opener}); open the dashboard URL above yourself\n`);
    child.on('error', warn);
    child.on('exit', (code) => code && warn());
    child.unref();
  }

  return new Promise((resolve) => {
    const stop = async () => {
      sup.stop();
      await srv.close();
      resolve(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
