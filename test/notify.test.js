// Webhook payload formats and failure handling (stub fetch, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookNotify, desktopNotify } from '../src/notify.js';

const alert = { id: 'x', kind: 'stalled', name: 'fix-auth', harness: 'claude', detail: 'API Error: 401', since: 1, at: 2 };

test('webhook formats: json carries the alert, slack wraps text, text is plain', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true };
  };
  for (const format of ['json', 'slack', 'text']) assert.equal(await webhookNotify(alert, { url: 'http://hook', format, fetchImpl }), true);
  const [json, slack, text] = calls;
  assert.equal(JSON.parse(json.init.body).kind, 'stalled');
  assert.equal(JSON.parse(json.init.body).title, 'Agent stalled: fix-auth');
  assert.match(JSON.parse(slack.init.body).text, /\*Agent stalled: fix-auth\*\nclaude · API Error: 401/);
  assert.equal(text.init.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(text.init.body, 'Agent stalled: fix-auth\nclaude · API Error: 401');
});

test('webhook failures return false instead of throwing', async () => {
  assert.equal(await webhookNotify(alert, { url: 'http://hook', fetchImpl: async () => ({ ok: false }) }), false);
  assert.equal(await webhookNotify(alert, { url: 'http://hook', fetchImpl: async () => { throw new Error('down'); } }), false);
});

test('desktop notification uses notify-send on Linux and osascript on macOS, with quotes escaped', async () => {
  const seen = [];
  const exec = (cmd, args, _o, cb) => { seen.push([cmd, args]); cb(null); };
  await desktopNotify(alert, { platform: 'linux', exec });
  await desktopNotify({ ...alert, name: 'say "hi"' }, { platform: 'darwin', exec });
  assert.equal(seen[0][0], 'notify-send');
  assert.deepEqual(seen[0][1].slice(1), ['Agent stalled: fix-auth', 'claude · API Error: 401']);
  assert.equal(seen[1][0], 'osascript');
  assert.match(seen[1][1][1], /with title "Agent stalled: say \\"hi\\""/);
});
