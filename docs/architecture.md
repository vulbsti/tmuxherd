# Architecture

tmuxherd is one Node process with no runtime dependencies. tmux does the hard terminal work: it owns the PTYs, emulates the terminal, and keeps the screen state. tmuxherd watches tmux and acts on it.

```
browser ──SSE (screen/pane/alert)──▶ ┌──────────────── tmuxherd (node) ───────────────┐
        ◀──POST /answer, /keys,      │ server.js   auth, routes, SSE                   │
            /spawn ──────────────────│ supervisor  poll loop, registry of pane keys    │
                                     │ detect.js   screen  → visible state + prompt    │
                                     │ tracker.js  time    → stalled / exited          │
                                     │ watchdog.js state   → alerts (once per episode) │
                                     │ notify.js   desktop / webhook                   │
                                     │ answer.js   move → verify → Enter               │
                                     │ spawn.js    presets, git worktrees              │
                                     │ tmux.js     the only place tmux is invoked      │
                                     └───────────────┬─────────────────────────────────┘
                                                     │ tmux -L tmuxherd -f tmuxherd.conf
                                                     ▼   capture-pane -e -p / send-keys
                                     tmuxherd's own tmux server ── agent panes (claude, codex, pi, …)
                                     (your default tmux server is never touched)
```

The README links an illustrated version: `assets/architecture-*.svg`.

## Data flow, one tick

1. **List.** `Supervisor.tick()` runs once a second. It calls `list-panes -a` on tmuxherd's own server only, and `display-message -t %N` for each adopted pane. Pane metadata (harness, name, worktree, spawn time) is stored in tmux pane options (`@th_*`), so a dashboard restart loses nothing.
2. **Capture.** For each pane, `capture-pane -e -p` returns the visible screen with SGR colour escapes. A zoomed pane is also captured at 4 Hz while the browser keeps sending `focus`.
3. **Detect.** `detect(screen, hint)` is a pure function. It returns the visible state, a parsed prompt, a retrying flag and an error line:
   - The visible state is `working`, `waiting` or `idle`. For a generic harness it is `unknown`, and screen activity decides.
   - The prompt (`question`, `context`, `options[]`, `selected`, `fingerprint`) is found by looking for a block of two or more options where exactly one line carries a cursor glyph (`❯ › > ▶`), next to a question or a confirmation footer. Numbered menus (Claude and Codex permission prompts) and unnumbered cursor menus (Claude's folder-trust prompt) are both handled.
   - The working signals are the Claude spinner line (`✻ Verb… (12s · …)`), `esc to interrupt`, and Codex's `• Working (…)`.
   - The retrying signals are `Retrying in Ns · attempt n/10` and `Reconnecting... waiting for network`.
   - An error counts only if it is among the last lines printed above the input box. An old error the agent has since moved past is ignored.
4. **Track.** `PaneTracker` adds memory:
   - `progressKey(screen)` hashes the screen after stripping digits, spinner glyphs and spinner verbs, so a ticking timer is not progress.
   - `pending` is true from the moment the agent works or asks something, until it is cleanly idle.
   - **Stalled** means working or retrying with no progress for `stallMinutes`, *or* idle with an error on screen while `pending`.
   - **Exited** means the pane is dead (`remain-on-exit on` keeps it visible). It counts as dead with work pending if `pending` was true or the exit status is not 0.
5. **Watch.** `Watchdog.evaluate()` raises `stalled`, `dead` and `waiting` alerts once per episode. An episode is keyed by when it began, and it resolves when the condition clears.
6. **Push.** Changed screens, changed pane views and alerts go to every browser over Server-Sent Events. Alerts also go to the `Notifier` (desktop notifications, webhook).

## Answering a prompt

The browser sends `{fingerprint, option}`. `answerPrompt()` then:

1. re-captures and checks that the fingerprint still matches (otherwise `409`, and nothing is sent);
2. sends one `Up`/`Down`;
3. re-captures and waits until the cursor moved, re-checking the fingerprint;
4. repeats steps 2–3 until the cursor is on the target;
5. sends `Enter`.

It never types digits. Claude answers immediately on a digit, while Codex only moves the cursor, so typing digits would behave differently per harness and could leave a stray keystroke in the input box. See DECISIONS.md D6.

## Isolation and safety

- `src/tmux.js` is the only module that runs tmux. Every command is an argv array (no shell) and always carries `-L <socket>` and `-f <bundled conf>` (DECISIONS.md D4).
- `listPanes`, `newWindow`, `killPane`, `resizeWindow` and `killServer` refuse to run on a non-own server.
- The browser never sends tmux targets, only registry keys (`o12`, `a0-7`), resolved by `Supervisor.resolve()`.
- HTTP security (token→cookie, Host/Origin checks, CSP) is described in [SECURITY.md](../SECURITY.md).

## Why polling, not control mode or pipe-pane

`tmux -C` (control mode) and `pipe-pane` stream raw output bytes. To get a *screen*, you would then need a full terminal emulator in Node or the browser. `capture-pane` asks tmux, which already emulates the terminal, for the rendered screen. At 1 Hz this costs about 2% of one CPU core for 10 panes (see `bench/poll-cost.js` and the README). The trade-off is that the grid updates once a second rather than per byte.

## Files

| file | role |
|---|---|
| `bin/tmuxherd.js` | entry point |
| `src/cli.js` | flags, config file, `serve` / `ls` / `attach` |
| `src/server.js` | HTTP, SSE, auth |
| `src/supervisor.js` | poll loop, registry |
| `src/detect.js` | screen → state/prompt (pure) |
| `src/tracker.js` | state over time |
| `src/watchdog.js` | alert episodes |
| `src/notify.js` | desktop and webhook delivery |
| `src/answer.js` | prompt answering |
| `src/spawn.js` | presets, argv building, worktrees |
| `src/tmux.js` | the tmux wrapper |
| `src/tmuxherd.conf` | config for tmuxherd's own tmux server |
| `public/` | the dashboard (plain ES modules, no build) |
| `test/` | unit and integration tests (`node --test`) |
| `test/fixtures/captures/` | screens recorded from real agents |
| `e2e/` | Playwright: `fake.spec.js` (CI), `real.spec.js` (local, real agents) |
| `bench/poll-cost.js` | overhead benchmark |
