// Starts a tmuxherd server on an isolated tmux socket for one test file.
// TMUX_TMPDIR points tmux at a private socket directory, so neither the
// user's default server nor their socket directory is ever touched.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/tmuxherd.js', import.meta.url).pathname;

export async function startTmuxherd(args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxherd-e2e-'));
  const sockDir = path.join(dir, 'sock');
  fs.mkdirSync(sockDir, { mode: 0o700 });
  const socket = 'e2e';
  const token = `e2e-${process.pid}-${Date.now()}`;
  const env = { ...process.env, TMUX_TMPDIR: sockDir, TMUXHERD_TOKEN: token };
  delete env.TMUX; // never inherit a parent tmux session
  const child = spawn(process.execPath, [BIN, '--socket', socket, '--port', '0', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => (log += d));
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`tmuxherd did not start:\n${out}\n${log}`)), 10_000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /dashboard: (http:\/\/\S+)/.exec(out);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    child.on('exit', (code) => reject(new Error(`tmuxherd exited ${code}:\n${out}\n${log}`)));
  });
  const base = new URL(url).origin;
  const tmux = (...a) => execFileSync('tmux', ['-L', socket, ...a], { env, encoding: 'utf8' });
  return {
    url,
    base,
    token,
    dir,
    tmux,
    log: () => log,
    api: async (method, p, body) => {
      const res = await fetch(base + p, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.json();
    },
    async stop() {
      child.kill('SIGTERM');
      try { tmux('kill-server'); } catch { /* already gone */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
