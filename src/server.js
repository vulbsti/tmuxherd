// HTTP + Server-Sent Events API for the dashboard. Zero dependencies.
// Security model: DECISIONS.md D8 and SECURITY.md.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerPrompt } from './answer.js';
import { spawnAgent, DEFAULT_PRESETS } from './spawn.js';
import { alertText } from './notify.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseCookies(h = '') {
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(raw);
    } catch {
      out[part.slice(0, i).trim()] = raw; // another site's malformed cookie must not break ours
    }
  }
  return out;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} o
 * @param {import('./supervisor.js').Supervisor} o.supervisor
 * @param {import('./notify.js').Notifier} o.notifier
 * @param {string} o.token
 * @param {string} [o.host]
 * @param {number} [o.port]
 * @param {boolean} [o.allowRemote]
 * @param {object} [o.presets]
 * @param {string} [o.session]
 * @param {string} [o.version]
 * @param {(s:string)=>void} [o.log]
 */
export function createServer(o) {
  const { supervisor, notifier, token, allowRemote = false, presets = DEFAULT_PRESETS, session = 'herd', version = '0.0.0', log = () => {} } = o;
  // Extra origins (e.g. https://box.tailnet.ts.net behind `tailscale serve`) whose
  // Host and Origin are accepted in addition to loopback. Explicit opt-in only.
  const allowedOrigins = new Set((o.allowedOrigins || []).map((u) => new URL(u).origin));
  const allowedHosts = new Set([...allowedOrigins].map((u) => new URL(u).host.toLowerCase()));
  let port = o.port ?? 0;
  const cookieName = () => `tmuxherd_${port}`;
  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();
  const recentAlerts = [];

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  supervisor.on('pane', (v) => broadcast('pane', v));
  supervisor.on('removed', (key) => broadcast('removed', { key }));
  supervisor.on('screen', (key, screen) => broadcast('screen', { key, screen }));
  supervisor.on('alert', (a) => {
    recentAlerts.unshift({ ...a, ...alertText(a) });
    recentAlerts.length = Math.min(recentAlerts.length, 50);
    broadcast('alert', { ...a, ...alertText(a) });
    notifier.send(a).catch(() => {});
    log(`ALERT ${a.kind}: ${a.name} — ${a.detail}`);
  });
  supervisor.on('resolve', (a) => {
    const r = recentAlerts.find((x) => x.id === a.id);
    if (r) r.resolvedAt = a.resolvedAt;
    broadcast('resolve', a);
  });

  function checkHost(req) {
    if (allowRemote) return;
    const host = (req.headers.host || '').toLowerCase();
    if (allowedHosts.has(host)) return;
    const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    if (!LOOPBACK_HOSTS.has(name)) throw new HttpError(421, 'bad host header');
  }

  function authed(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ') && safeEqual(auth.slice(7), token)) return 'bearer';
    const c = parseCookies(req.headers.cookie)[cookieName()];
    if (c && safeEqual(c, token)) return 'cookie';
    return null;
  }

  function checkOrigin(req, how) {
    // Browsers always send Origin on cross-origin POST/DELETE. Cookie-authenticated
    // writes must come from our own page. Bearer clients (scripts) need no Origin.
    const origin = req.headers.origin;
    if (!origin) {
      if (how === 'bearer') return;
      throw new HttpError(403, 'missing origin');
    }
    if (origin !== `http://${req.headers.host}` && !allowedOrigins.has(origin)) throw new HttpError(403, 'cross-origin request refused');
  }

  async function readJson(req) {
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'expected application/json');
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new HttpError(413, 'body too large');
      chunks.push(c);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      throw new HttpError(400, 'invalid JSON');
    }
  }

  function send(res, status, body, headers = {}) {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    res.writeHead(status, {
      'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    });
    res.end(isStr ? body : JSON.stringify(body));
  }

  function serveStatic(res, rel) {
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(404, 'not found');
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      throw new HttpError(404, 'not found');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-security-policy': CSP,
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-cache',
    });
    res.end(data);
  }

  function stateBody() {
    return {
      version,
      panes: supervisor.list(),
      alerts: supervisor.alerts().map((a) => ({ ...a, ...alertText(a) })),
      recentAlerts,
      thresholds: { ...supervisor.watchdog.opts },
      notify: { desktop: notifier.desktop, webhook: Boolean(notifier.webhook) },
      presets: Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, { label: v.label, promptArg: v.promptArg }])),
      session,
      socket: supervisor.own.label,
      attach: `tmux -L ${supervisor.own.label} attach`,
    };
  }

  async function route(req, res) {
    checkHost(req);
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    // Token exchange: ?token=... -> HttpOnly cookie, then redirect to a clean URL.
    if (req.method === 'GET' && p === '/' && url.searchParams.has('token')) {
      if (!safeEqual(url.searchParams.get('token'), token)) throw new HttpError(401, 'wrong token');
      res.writeHead(303, {
        location: '/',
        'set-cookie': `${cookieName()}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
        'cache-control': 'no-store',
      });
      return res.end();
    }

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      if (!authed(req)) {
        return send(res, 401, 'tmuxherd: open the URL with ?token=… that was printed in the terminal where tmuxherd started.\n');
      }
      return serveStatic(res, 'index.html');
    }
    if (req.method === 'GET' && p.startsWith('/static/')) {
      const rel = path.posix.normalize(p.slice('/static/'.length)).replace(/^\/+/, '');
      if (rel === 'index.html') throw new HttpError(404, 'not found'); // the page itself is only served behind auth, at /
      return serveStatic(res, rel);
    }
    if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true });

    if (!p.startsWith('/api/')) throw new HttpError(404, 'not found');
    const how = authed(req);
    if (!how) throw new HttpError(401, 'unauthorized');
    if (req.method !== 'GET') checkOrigin(req, how);

    if (req.method === 'GET' && p === '/api/state') return send(res, 200, stateBody());

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`event: hello\ndata: ${JSON.stringify(stateBody())}\n\n`);
      for (const [key, screen] of supervisor.screens) res.write(`event: screen\ndata: ${JSON.stringify({ key, screen })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && p === '/api/spawn') {
      const body = await readJson(req);
      const r = await spawnAgent(supervisor.own, body, { presets, defaultSession: session });
      log(`spawned ${r.name} (${r.argv[0]}) in ${r.cwd}`);
      supervisor.tick().catch(() => {});
      return send(res, 201, { ok: true, key: `o${r.paneId.slice(1)}`, ...r });
    }

    if (req.method === 'POST' && p === '/api/config') {
      const body = await readJson(req);
      const next = {};
      for (const k of ['stallMinutes', 'deadMinutes', 'waitingMinutes']) {
        if (body[k] != null) {
          const n = Number(body[k]);
          if (!Number.isFinite(n) || n < 0 || n > 24 * 60) throw new HttpError(400, `${k} must be 0..1440`);
          next[k] = n;
        }
      }
      if (body.notifyWaiting != null) next.notifyWaiting = Boolean(body.notifyWaiting);
      supervisor.configure(next);
      broadcast('config', { thresholds: { ...supervisor.watchdog.opts } });
      return send(res, 200, { ok: true, thresholds: { ...supervisor.watchdog.opts } });
    }

    if (req.method === 'POST' && p === '/api/test-alert') {
      const a = { id: `test:${Date.now()}`, paneId: '-', kind: 'test', name: 'tmuxherd', harness: 'test', detail: 'notifications are working', since: Date.now(), at: Date.now() };
      broadcast('alert', { ...a, ...alertText(a) });
      const results = await notifier.send(a);
      return send(res, 200, { ok: true, results });
    }

    const m = /^\/api\/panes\/([oa][0-9-]+)(?:\/([a-z]+))?$/.exec(p);
    if (!m) throw new HttpError(404, 'not found');
    const [, key, action] = m;
    // Every pane route, reads included, re-verifies the pane first (DECISIONS D18).
    const { server, paneId, view } = await supervisor.verify(key);
    const hint = { harness: view.harness, command: undefined };

    if (req.method === 'GET' && action === 'screen') {
      const history = Math.min(5000, Math.max(0, Number(url.searchParams.get('history')) || 0));
      return send(res, 200, { key, screen: await server.capture(paneId, { history }) });
    }
    if (req.method === 'POST' && action === 'focus') {
      supervisor.setFocus(key);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'keys') {
      const body = await readJson(req);
      await supervisor.verify(key); // again: reading the body can take a while
      if (view.dead) throw new HttpError(409, 'pane is dead');
      if (typeof body.text === 'string' && body.text) {
        if (body.text.length > 4000) throw new HttpError(413, 'text too long');
        await server.sendText(paneId, body.text);
      }
      if (Array.isArray(body.keys) && body.keys.length) {
        if (body.keys.length > 50) throw new HttpError(413, 'too many keys');
        try {
          await server.sendKeys(paneId, body.keys);
        } catch (e) {
          throw new HttpError(400, e.message);
        }
      }
      supervisor.setFocus(key);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'answer') {
      const body = await readJson(req);
      const r = await answerPrompt(server, paneId, body, hint, { check: () => supervisor.verify(key) });
      log(`answered ${view.name}: ${r.chosen || 'cancel'}`);
      supervisor.tick().catch(() => {});
      return send(res, 200, r);
    }
    if (req.method === 'POST' && action === 'resize') {
      if (!view.own) throw new HttpError(403, 'adopted panes are never resized');
      const body = await readJson(req);
      await supervisor.verify(key); // again: reading the body can take a while
      await server.resizeWindow(paneId, body.cols, body.rows);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && !action) {
      if (!view.own) throw new HttpError(403, 'tmuxherd never kills adopted panes');
      await server.killPane(paneId);
      log(`killed ${view.name}`);
      supervisor.tick().catch(() => {});
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'not found');
  }

  const httpServer = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e.status || 500;
      if (status >= 500) log(`error: ${e.stack || e.message}`);
      if (!res.headersSent) send(res, status, { ok: false, error: e.message });
      else res.end();
    });
  });

  return {
    httpServer,
    listen(host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          port = httpServer.address().port;
          resolve(port);
        });
      });
    },
    get port() {
      return port;
    },
    close() {
      for (const c of clients) c.end();
      return new Promise((r) => httpServer.close(() => r()));
    },
  };
}
