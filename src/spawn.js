// Spawning agent panes, optionally in a fresh git worktree.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pexec = promisify(execFile);

/** Built-in presets. A config file can add or override presets (same shape). */
export const DEFAULT_PRESETS = {
  claude: { label: 'Claude Code', argv: ['claude'], promptArg: true, harness: 'claude' },
  codex: { label: 'Codex CLI', argv: ['codex'], promptArg: true, harness: 'codex' },
  pi: { label: 'Pi', argv: ['pi'], promptArg: true, harness: 'pi' },
  shell: { label: 'Shell', argv: [process.env.SHELL || '/bin/sh'], promptArg: false, harness: 'generic' },
};

export class SpawnError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Minimal shell-like word splitting for the "extra args" field: quotes, no expansion. */
export function splitArgs(s) {
  if (!s) return [];
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (q) throw new SpawnError('unbalanced quote in arguments');
  if (has || cur) out.push(cur);
  return out;
}

export function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function sanitizeName(n, fallback) {
  const s = String(n || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || fallback;
}

/** Build the argv for a spawn request. Pure; tested directly. */
export function buildArgv(req, presets = DEFAULT_PRESETS) {
  if (req.preset === 'custom') {
    const cmd = String(req.command || '').trim();
    if (!cmd) throw new SpawnError('custom command is empty');
    const harness = req.harness || 'generic';
    if (!['claude', 'codex', 'pi', 'generic'].includes(harness)) throw new SpawnError(`unknown harness "${harness}"`);
    return { argv: ['/bin/sh', '-c', cmd], harness };
  }
  const p = presets[req.preset];
  if (!p) throw new SpawnError(`unknown preset "${req.preset}"`);
  const argv = [...p.argv, ...splitArgs(req.args || '')];
  if (req.prompt && String(req.prompt).trim()) {
    if (!p.promptArg) throw new SpawnError(`preset "${req.preset}" does not take a prompt`);
    argv.push(String(req.prompt));
  }
  return { argv, harness: p.harness };
}

async function git(cwd, args) {
  try {
    const { stdout } = await pexec('git', ['-C', cwd, ...args], { timeout: 30_000 });
    return stdout.trim();
  } catch (e) {
    throw new SpawnError(`git ${args[0]} failed: ${(e.stderr || e.message || '').trim()}`);
  }
}

/**
 * Create `<repo>.worktrees/<branch>` next to the repository root on a new branch.
 * @returns {Promise<{path:string, branch:string, repo:string}>}
 */
export async function createWorktree(cwd, { branch, base }) {
  if (!branch) throw new SpawnError('worktree branch is required');
  const repo = await git(cwd, ['rev-parse', '--show-toplevel']);
  const valid = await git(repo, ['check-ref-format', '--branch', branch]).catch(() => null);
  if (!valid) throw new SpawnError(`"${branch}" is not a valid branch name`);
  const exists = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).catch(() => null);
  if (exists) throw new SpawnError(`branch "${branch}" already exists`);
  const dir = path.join(path.dirname(repo), `${path.basename(repo)}.worktrees`, branch.replace(/\//g, '-'));
  if (fs.existsSync(dir)) throw new SpawnError(`${dir} already exists`);
  const args = ['worktree', 'add', '-b', branch, dir];
  if (base) args.push(base);
  await git(repo, args);
  return { path: dir, branch, repo };
}

/**
 * @param {import('./tmux.js').TmuxServer} server  own server
 * @param {object} req  {preset, name?, cwd, prompt?, args?, command?, session?, worktree?: {branch, base?}}
 */
export async function spawnAgent(server, req, { presets = DEFAULT_PRESETS, defaultSession = 'herd', now = Date.now } = {}) {
  const cwd0 = path.resolve(expandHome(String(req.cwd || '').trim() || os.homedir()));
  let st;
  try {
    st = fs.statSync(cwd0);
  } catch {
    throw new SpawnError(`directory does not exist: ${cwd0}`);
  }
  if (!st.isDirectory()) throw new SpawnError(`not a directory: ${cwd0}`);

  const { argv, harness } = buildArgv(req, presets);
  let cwd = cwd0;
  let worktree = null;
  if (req.worktree && req.worktree.branch) {
    worktree = await createWorktree(cwd0, req.worktree);
    cwd = worktree.path;
  }
  const name = sanitizeName(req.name || (worktree ? worktree.branch : ''), `${req.preset}-${String(now()).slice(-4)}`);
  const session = sanitizeName(req.session, defaultSession);
  const paneId = await server.newWindow({
    session,
    name,
    cwd,
    argv,
    options: {
      '@th_harness': harness,
      '@th_name': name,
      '@th_created': String(now()),
      // Display only. Must not contain tmux.js's list-panes separator.
      '@th_command': argv.join(' ').replaceAll('|~th~|', '|~ th~|').slice(0, 300),
      ...(worktree ? { '@th_worktree': worktree.path } : {}),
    },
  });
  return { paneId, name, cwd, harness, worktree, argv };
}
