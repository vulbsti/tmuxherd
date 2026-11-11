# AGENTS.md: working on tmuxherd as an AI coding agent

tmuxherd is a tool for supervising coding agents, so it should be easy for coding agents to maintain. Read this before changing anything.

## Ground rules (safety)
1. **Never touch the user's tmux.** Do not run bare `tmux …`, `tmux kill-server`, or anything against the default socket.
   - Tests use socket *paths* in a temp dir (`-S`), or `TMUX_TMPDIR=<tempdir>` (see `e2e/harness.js`).
   - When you run tmuxherd by hand, use your own `--socket <name>` (and `TMUX_TMPDIR=<tempdir>` if you can), then clean up with `tmux -L <name> kill-server`.
2. **Never pass the user's `~/.tmux.conf` to a server tmuxherd owns.** `src/tmux.js` always adds `-f src/tmuxherd.conf`. Keep it that way. Why: DECISIONS.md D4.
3. **All tmux invocations that act on a server go through `src/tmux.js`.** Do not call `execFile('tmux', …)` anywhere else in `src/`. There are two exceptions in `src/cli.js`: `tmux -V` (a version check, no server), and `tmuxherd attach`, which hands the terminal to `tmux -L <socket> -f <bundled conf> attach` only after `ownership()` has confirmed the server is ours.
4. **The browser addresses panes by registry key only** (`o12`, `a0-7`). Never add an endpoint that accepts a raw tmux target.
5. **Keep zero runtime dependencies.** CI fails if `package.json` gains `dependencies`. Dev dependencies are fine.

## Commands
```bash
npm ci
npm test                 # unit + integration (node --test), about 5 s, needs tmux >= 3.2
npm run lint
npx playwright install chromium && npm run e2e   # UI e2e with the fake agent
TMUXHERD_REAL_AGENTS=1 npm run e2e:real          # real claude + codex; only if asked, costs tokens
node bench/poll-cost.js 10 30                    # overhead numbers quoted in the README
```

## Where things live
See `docs/architecture.md` for the data flow. The short version:
- `src/detect.js`: what the screen shows (pure; test it with captures).
- `src/tracker.js`: what that means over time (stalled, exited with work pending).
- `src/answer.js`: move, verify, then confirm.
- `public/`: plain ES modules, no build step. The CSP forbids inline scripts and style attributes; set colours through `el.style` from JS.

## When a harness changes its TUI
This is the most common maintenance task.
1. Reproduce in a sandbox dir on your own socket, e.g. `tmux -L dev -f /dev/null new -d 'claude …'`, then `tmux -L dev capture-pane -p -t … > x.txt`. Capture with `-e` too, for a `.ansi` copy.
2. Capture with the agent idle, never with a slash-command menu open, and start the agent with `--setting-sources project,local` (Claude Code) so your personal status line, hooks and output style stay out. Sanitize home paths, usernames, session IDs, plan or model names, and private skill or plugin names. `npm test` runs `test/fixtures-privacy.test.js`, which checks the ANSI-stripped text: a plain grep misses words split by colour codes.
3. Add it to `test/fixtures/captures/` and its expectation to `test/fixtures/expectations.json`.
4. Change `src/detect.js` until `npm test` passes. Do not loosen unrelated patterns; there are negative tests, such as numbered lists in agent output not being prompts.

## Adding a harness
Add a preset in `src/spawn.js` (`DEFAULT_PRESETS`) and a `guessHarness` rule. Then add working/idle/prompt captures as above. The generic path already handles any agent that shows a cursor menu.

## Style
- Plain ESM JavaScript with JSDoc where it helps; 2 spaces; `npm run lint` clean.
- Prefer a few meaningful tests over many shallow ones. Every README claim must point at a test or a benchmark.
- Record design decisions with their reasons in `DECISIONS.md`.
- Commits are small and descriptive, with no `Co-Authored-By` trailers.
