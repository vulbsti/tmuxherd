#!/usr/bin/env node
// Measures what supervision costs: CPU time of the tmuxherd process and of the
// tmux server, plus tick latency, with N panes polled at 1 Hz.
//
//   node bench/poll-cost.js [panes=10] [seconds=30]
//
// Panes run the fake agent: half idle, half with a live spinner (redrawing
// twice a second), which is the expensive case for capture + detect.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TmuxServer } from '../src/tmux.js';
import { Supervisor } from '../src/supervisor.js';
import { spawnAgent } from '../src/spawn.js';

const N = Number(process.argv[2] || 10);
const SECONDS = Number(process.argv[3] || 30);
const FAKE = new URL('../test/fake-agent.js', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxherd-bench-'));
const own = new TmuxServer({ socketPath: path.join(tmp, 'bench.sock'), own: true });

function procCpuMs(pid) {
  // utime + stime in clock ticks (Linux). macOS: returns null.
  try {
    const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const ticks = Number(f[11]) + Number(f[12]);
    return (ticks * 1000) / 100;
  } catch {
    return null;
  }
}

for (let i = 0; i < N; i++) {
  await spawnAgent(own, { preset: 'custom', harness: 'claude', name: `a${i}`, cwd: tmp, command: `node ${FAKE} ${i % 2 ? 'stall' : 'idle'}` });
}
const serverPid = Number(execFileSync('tmux', ['-S', path.join(tmp, 'bench.sock'), 'display-message', '-p', '#{pid}'], { encoding: 'utf8' }).trim());
const sup = new Supervisor({ own, intervalMs: 1000 });
await sup.tick(); // warm up

const t0 = process.cpuUsage();
const s0 = procCpuMs(serverPid);
const lat = [];
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  const a = performance.now();
  await sup.tick();
  lat.push(performance.now() - a);
  await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (performance.now() - a))));
}
const d = process.cpuUsage(t0);
const s1 = procCpuMs(serverPid);
lat.sort((x, y) => x - y);
const pct = (ms) => ((ms / (SECONDS * 1000)) * 100).toFixed(1);
const result = {
  panes: N,
  seconds: SECONDS,
  ticks: lat.length,
  tickMsP50: Number(lat[Math.floor(lat.length / 2)].toFixed(1)),
  tickMsP95: Number(lat[Math.floor(lat.length * 0.95)].toFixed(1)),
  tmuxherdCpuPct: Number(pct((d.user + d.system) / 1000)),
  tmuxServerCpuPct: s0 != null && s1 != null ? Number(pct(s1 - s0)) : null,
  rssMb: Number((process.memoryUsage().rss / 1e6).toFixed(0)),
  node: process.version,
  platform: `${os.platform()} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
};
console.log(JSON.stringify(result, null, 2));
await own.killServer();
fs.rmSync(tmp, { recursive: true, force: true });
