// HTTP security boundary: token→cookie exchange, Host and Origin checks,
// content-type, adopted-pane protections. Uses a stub supervisor (no tmux).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createServer } from '../src/server.js';
import { Notifier } from '../src/notify.js';
import { Watchdog } from '../src/watchdog.js';
import { resolveOptions } from '../src/cli.js';

const TOKEN = 'a'.repeat(43);
const killed = [];
const stubServer = {
  label: 'stub',
  killPane: async (id) => killed.push(id),
  attachCommand: () => 'tmux -L stub attach',
};
class StubSupervisor extends EventEmitter {
  constructor() {
    super();
    this.own = stubServer;
    this.watchdog = new Watchdog();
    this.screens = new Map();
    this.views = new Map([
      ['o1', { key: 'o1', paneId: '%1', own: true, name: 'mine', harness: 'claude', state: 'idle' }],
      ['a0-7', { key: 'a0-7', paneId: '%7', own: false, adoptIndex: 0, name: 'theirs', harness: 'generic', state: 'idle' }],
    ]);
  }
  list() { return [...this.views.values()]; }
  alerts() { return []; }
  configure(o) { this.watchdog.configure(o); }
  tick() { return Promise.resolve(); }
  setFocus() { return true; }
  async verify(key) { return this.resolve(key); }
  resolve(key) {
    const view = this.views.get(key);
    if (!view) throw Object.assign(new Error('unknown pane'), { status: 404 });
    return { server: stubServer, paneId: view.paneId, view };
  }
}

let srv;
let port;
before(async () => {
  srv = createServer({ supervisor: new StubSupervisor(), notifier: new Notifier(), token: TOKEN, port: 0 });
  port = await srv.listen('127.0.0.1');
});
after(() => srv.close());

function req(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body != null) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
const cookie = () => `tmuxherd_${port}=${TOKEN}`;
const origin = () => `http://127.0.0.1:${port}`;

test('API and page require the token', async () => {
  assert.equal((await req('GET', '/api/state')).status, 401);
  assert.equal((await req('GET', '/')).status, 401);
  assert.equal((await req('GET', '/api/state', { headers: { cookie: `tmuxherd_${port}=wrong` } })).status, 401);
  assert.equal((await req('GET', '/?token=wrong')).status, 401);
});

test('token in URL is exchanged for an HttpOnly SameSite=Strict cookie and stripped from the URL', async () => {
  const r = await req('GET', `/?token=${TOKEN}`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  const c = r.headers['set-cookie'][0];
  assert.match(c, new RegExp(`^tmuxherd_${port}=`));
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  const page = await req('GET', '/', { headers: { cookie: cookie() } });
  // Another localhost site's malformed cookie (a raw %) must not break ours.
  assert.equal((await req('GET', '/', { headers: { cookie: `other=50%; ${cookie()}` } })).status, 200);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
});

test('non-loopback Host header is refused (DNS rebinding)', async () => {
  const r = await req('GET', '/api/state', { headers: { host: `evil.example:${port}`, authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 421);
  const ok = await req('GET', '/api/state', { headers: { host: `localhost:${port}`, authorization: `Bearer ${TOKEN}` } });
  assert.equal(ok.status, 200);
});

test('cookie-authenticated writes need a same-origin Origin and a JSON body', async () => {
  const json = { 'content-type': 'application/json', cookie: cookie() };
  assert.equal((await req('POST', '/api/config', { headers: json, body: { stallMinutes: 3 } })).status, 403, 'no Origin');
  assert.equal((await req('POST', '/api/config', { headers: { ...json, origin: 'http://evil.example' }, body: { stallMinutes: 3 } })).status, 403);
  assert.equal((await req('POST', '/api/config', { headers: { cookie: cookie(), origin: origin(), 'content-type': 'text/plain' }, body: 'stallMinutes=3' })).status, 415);
  const ok = await req('POST', '/api/config', { headers: { ...json, origin: origin() }, body: { stallMinutes: 3 } });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).thresholds.stallMinutes, 3);
  assert.equal((await req('POST', '/api/config', { headers: { ...json, origin: origin() }, body: { stallMinutes: -1 } })).status, 400);
});

test('bearer clients can write without Origin; unknown panes 404; adopted panes are never killed', async () => {
  const h = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await req('DELETE', '/api/panes/o99', { headers: h })).status, 404);
  assert.equal((await req('DELETE', '/api/panes/a0-7', { headers: h })).status, 403);
  assert.deepEqual(killed, []);
  assert.equal((await req('DELETE', '/api/panes/o1', { headers: h })).status, 200);
  assert.deepEqual(killed, ['%1']);
  // Raw tmux targets are not addressable at all.
  assert.equal((await req('DELETE', '/api/panes/%251', { headers: h })).status, 404);
});

test('resize re-verifies the pane after reading its body; a pane replaced meanwhile is not resized', async () => {
  const sup = new StubSupervisor();
  let checks = 0;
  sup.verify = async (key) => {
    if (++checks > 1) throw Object.assign(new Error('pane is gone or is no longer the one tmuxherd started'), { status: 409 });
    return sup.resolve(key);
  };
  const resized = [];
  stubServer.resizeWindow = async (...a) => resized.push(a);
  const s2 = createServer({ supervisor: sup, notifier: new Notifier(), token: TOKEN, port: 0 });
  const p2 = await s2.listen('127.0.0.1');
  try {
    const status = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: p2, method: 'POST', path: '/api/panes/o1/resize', headers: { host: `127.0.0.1:${p2}`, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', reject);
      r.end(JSON.stringify({ cols: 37, rows: 11 }));
    });
    assert.equal(status, 409);
    assert.equal(checks, 2);
    assert.deepEqual(resized, []);
  } finally {
    delete stubServer.resizeWindow;
    await s2.close();
  }
});

test('--allowed-origin admits exactly that proxy origin (Host and Origin), nothing else', async () => {
  const s2 = createServer({ supervisor: new StubSupervisor(), notifier: new Notifier(), token: TOKEN, port: 0, allowedOrigins: ['https://box.tail1234.ts.net'] });
  const p2 = await s2.listen('127.0.0.1');
  const call = (headers) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: p2, method: 'POST', path: '/api/config', headers: { 'content-type': 'application/json', cookie: `tmuxherd_${p2}=${TOKEN}`, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end('{}');
  });
  try {
    assert.equal(await call({ host: 'box.tail1234.ts.net', origin: 'https://box.tail1234.ts.net' }), 200);
    assert.equal(await call({ host: `127.0.0.1:${p2}`, origin: 'https://box.tail1234.ts.net' }), 200);
    assert.equal(await call({ host: 'other.tail1234.ts.net', origin: 'https://other.tail1234.ts.net' }), 421);
    assert.equal(await call({ host: 'box.tail1234.ts.net', origin: 'https://evil.example' }), 403);
  } finally {
    await s2.close();
  }
});

test('static files cannot escape public/', async () => {
  const r = await req('GET', '/static/../src/server.js');
  assert.notEqual(r.status, 200);
  const r2 = await req('GET', '/static/%2e%2e/package.json');
  assert.notEqual(r2.status, 200);
  // The dashboard page itself is only served behind auth, at /.
  for (const p of ['/static/index.html', '/static//index.html', '/static/.//index.html', '/static/x/../index.html']) {
    assert.equal((await req('GET', p)).status, 404, p);
  }
});

test('CLI refuses the default tmux server and unprotected remote binds', () => {
  const noConfig = { XDG_CONFIG_HOME: '/nonexistent' }; // never read the developer's own config
  assert.throws(() => resolveOptions(['--socket', 'default'], noConfig), /needs its own/);
  assert.throws(() => resolveOptions(['--host', '0.0.0.0'], noConfig), /allow-remote/);
  const o = resolveOptions(['--host', '0.0.0.0', '--allow-remote', '--config', '/dev/null'].slice(0, 3), { XDG_CONFIG_HOME: '/nonexistent' });
  assert.equal(o.allowRemote, true);
  assert.equal(resolveOptions([], { XDG_CONFIG_HOME: '/nonexistent' }).host, '127.0.0.1');
});
