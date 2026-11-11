# Decisions

Decisions made while building tmuxherd, newest last. Each has the reason, so a future maintainer can revisit it.

## D1. Name: `tmuxherd`
Checked 2026-11-05: npm `tmuxherd` → 404 (free), PyPI → 404 (free), GitHub repository search for `tmuxherd` → 0 results. Rejected `paneherd` (an existing GitHub repo) and `agentherd` (4 GitHub repos). The name says what it is: a herd of agents, living in tmux.

## D2. Node.js, zero runtime dependencies, no build step
Everyone who runs Claude Code, Codex CLI or Pi already has Node, so `npx tmuxherd` / `npm i -g` is the shortest install path. Zero runtime dependencies keeps the supply-chain surface of a tool that can type into your terminals as small as possible. Plain ESM JavaScript with JSDoc, Node ≥ 20. Dev-only dependencies: ESLint and Playwright.

## D3. tmux is the terminal emulator; the browser only renders snapshots
The server polls `tmux capture-pane -e -p` (styled screen snapshot) and pushes changed frames over Server-Sent Events. The browser turns SGR escapes into styled spans. There is no xterm.js and no PTY in the server, because tmux already owns the PTY and the screen state. Keys go back through `tmux send-keys`. Trade-off: about 1 fps for the grid (faster for the zoomed pane) instead of a byte stream. That is enough to supervise agents; for heavy interactive work, `tmux -L tmuxherd attach` is one click away.

## D4. Own tmux server, own config, never the user's
tmuxherd runs `tmux -L tmuxherd -f <bundled tmuxherd.conf>`.

Finding from the first sandbox run (2026-11-05): `tmux -L <private>` **still loads `~/.tmux.conf`**. With a session-restore plugin in that config, the user's saved sessions were recreated inside the private server within one second. The plugin's periodic auto-save would then have overwritten the user's saved snapshot with the private server's contents. The dev server was killed within a minute, and the saved snapshot was verified unchanged.

So "own socket" is not isolation on its own. The server must also start with its own config file. Every tmux call goes through a single wrapper that always passes `-L` and `-f`.

## D5. Foreign panes are untouchable unless explicitly adopted
Every capture, send-keys or kill is checked against the registry first. The registry holds every pane on tmuxherd's own server, plus panes the user adopted at launch with `--adopt <socket>:<%pane>`. tmuxherd never runs `list-panes -a` on a foreign server, and never kills an adopted pane.

## D6. Answering prompts: move, verify, confirm
Recorded behaviour:
- Claude Code answers a numbered menu as soon as a digit is pressed.
- Codex only moves the cursor on a digit and needs Enter.
- Claude's folder-trust menu has no numbers at all, and its cursor starts on "No, exit".

So tmuxherd never types digits. To answer, it:
1. re-captures the pane and checks that the prompt fingerprint matches the one the browser saw (blocking stale answers);
2. sends Up/Down to reach the target option;
3. re-captures and checks that the cursor is on the target;
4. only then sends Enter.

During recording, a blind `1` sent after a prompt had already gone landed in Claude's input box as text. That is the race this guards against.

## D7. Stall = no meaningful screen change while work is pending
A Claude retry loop (`Retrying in 9s · attempt 9/10`) and Codex's `Reconnecting... waiting for network (1m 15s …)` both show a live spinner and a ticking timer. The tracker therefore hashes a normalized screen: digits, spinner glyphs and spinner verbs are stripped. An agent is **stalled** when either:
- it is in a working or retrying state and the normalized screen has not changed for `stallMinutes`, or
- it is idle with an error on screen (`API Error`, `Please run /login`, …) right after it was working.

An agent is **exited** when its pane is dead; it counts as dead *with work pending* if it was working or waiting when it died, or exited non-zero. Pure timer heuristics like these are documented as heuristics, and the thresholds are configurable.

## D8. Auth: random per-launch token → HttpOnly cookie; Host and Origin checks
- The server binds 127.0.0.1 only.
- A 256-bit token is printed in the launch URL. The first visit swaps it for an `HttpOnly; SameSite=Strict` cookie and redirects, so the token leaves the address bar.
- The `Host` header must be a loopback name (blocks DNS rebinding), and state-changing requests must carry a same-origin `Origin`.
- A strict CSP is set and there are no inline scripts.
- Binding to a non-loopback address requires `--allow-remote` plus a loud warning. The documented, recommended path is an SSH tunnel.

## D9. Pane metadata lives in tmux user options
Harness, display name, worktree path and spawn time are stored as pane options (`@th_harness`, …) on tmuxherd's own server. Restarting the dashboard loses nothing, and there is no state file to corrupt.

## D10. Worktrees go in a sibling directory
`git worktree add -b <branch> <repo>.worktrees/<branch>` keeps the repo's own tree clean (no `.gitignore` edits), and makes it obvious on disk which repo a worktree belongs to.

## D11. Codex trust entries in sandbox runs
Real-agent tests run Codex in throwaway directories. Codex records its folder-trust decision in the user's Codex config. That is harmless (one trusted-folder entry per sandbox path), and the e2e test reuses one stable sandbox path to avoid piling them up. Claude records trust in its own project config the same way.

## D12. License: Apache-2.0
This is the standard default. It includes a patent grant, which matters for tools companies adopt internally.

## D13. History rewritten before release to remove leaked setup details
The final audit found that one fixture (`claude-exited`) captured Claude Code's slash-command menu. That menu listed the maintainer's locally installed skills and plugins, and three fixtures carried an output-style header. The fixtures were sanitized, and every commit was rewritten with `git filter-branch --tree-filter`. With the owner's explicit approval, the still-private repo, which had no other clones, was force-pushed. Commit hashes quoted from before 2026-11-05 23:00 predate the rewrite. The safeguard against a repeat: capture with the agent idle and no menu open, and grep fixtures before committing (AGENTS.md).

## D14. Detection treats usage-limit waits as no progress
While recording the demo, a real Claude Code hit its plan's usage limit and showed `Usage limit reached · continuing automatically at 10:10pm`. That is exactly the hours-long silent wait this tool exists to surface, so the banner counts as a retry signal: stalled after `stallMinutes`.

## D15. Adopted panes are pinned to their process
`--adopt socket:%id` pins the adopted pane to the pid seen at first contact. If that tmux server restarts and reuses `%id` for a different process, the adoption is released instead of following the id. Every keystroke, answer or resize sent to an adopted pane re-checks the pid first.

## D16. The own server carries an ownership marker
Round 2 of the audit showed that `--socket <name>` pointed at a tmux server someone else had started would have been treated as tmuxherd's own: its panes listed, captured, typeable and killable. The bundled `tmuxherd.conf` now sets a global user option `@tmuxherd_owner 1`, which exists only on servers started with that file.
- `listPanes()` reads the marker from every pane (it is part of the list format, so it costs no extra tmux call) and throws `ForeignServerError` if any pane lacks it.
- `ensureSession()` refuses before creating anything.
- The CLI exits with an error at startup.

Test: "a server on our socket that tmuxherd did not start is refused, not managed".

## D17. A death with no exit status counts as work pending after 3 s
Under load, tmux 3.4 occasionally marks a pane dead without ever recording `pane_dead_status`. In the same state, `list-windows -a` stops showing the window even though the session still counts it. tmuxherd first reads the status from tmux's own `Pane is dead (status N, …)` line. If there is still no status 3 s after death, the agent is treated as dead with work pending (`exited (status unknown)`), because an unexplained death is exactly what the watchdog exists to report. The integration test accepts either path and asserts that exactly one dead alert fires.

## D18. Every pane operation re-verifies the pane
Round 3 of the audit showed a replacement attack. If tmuxherd's tmux server died and someone else started one on the same socket, pane ids would restart from %0, and a stale view could capture, type into or kill the stranger's panes before the next poll. That poll would also throw before clearing the stale views.

Now:
- every pane route, reads included, calls `Supervisor.verify(key)`, which re-describes the pane and requires the same pid plus the ownership marker (own panes) or the adoption pid (adopted panes);
- a failed listing drops every own view at once;
- the zoom poller verifies before each capture;
- `tmuxherd attach` checks ownership first.

Test: "if our server is replaced by a stranger's on the same socket, stale keys reach nothing".

## D19. Fixture privacy is enforced by a test, and history was cleaned three times
Audits found setup details leaking into fixtures three times:
- round 1: a slash-command menu;
- round 2: plan, status-line and Pi model text in `.txt` files;
- round 3: the same text hidden between colour codes in `.ansi` files, plus status-line layouts.

Each time the fixtures were sanitized and history was rewritten (`git filter-branch`) and force-pushed with the owner's approval. A plain grep is not enough for styled captures, so `test/fixtures-privacy.test.js` now checks the ANSI-stripped text of every capture against generic patterns: home paths, real UUIDs, plan names, slash-menu rows and emails. The demo is recorded with `--setting-sources project,local`, and the plan name in Claude's banner is redacted on the page during recording.

## D20. A fourth history rewrite; commits are authored as `vulbsti`
Audit round 4 found host details in four older commits. A fresh-user report from a container on `--network host` had copied the machine's hostname from a shell prompt and a tmux status line, and its zoom screenshot showed the host kernel version. Older VERIFICATION and DECISIONS text also named a session-restore snapshot file. `git filter-branch` replaced those strings, painted over the kernel line in the old screenshot, and set every commit's author and committer name to `vulbsti`, matching the noreply email (OSS_STANDARD's grep list includes the owner's name). The HEAD tree was byte-identical before and after. The owner approved the force-push and the tag move in chat.

Future fresh-user runs are told to keep host details out of their reports, and their screenshots are checked before commit. Commit ids cited in reports written before the rewrite are translated by the map in VERIFICATION.md.

## D21. Never spell out the owner's identifiers, even as grep terms; fifth history rewrite
VERIFICATION and the audit reports quoted OSS_STANDARD's privacy grep list word for word. That list is itself personal data: the owner's home path, work email domain, second account handle and name. Audit round 5 flagged it. Repo docs now write those terms as placeholders (`<home>`, `<work domain>`, `<other account>`, `<owner name>`, `<scratch dir>`), which stand for the list in OSS_STANDARD section B, and one scrub script rewrote every historical copy. The owner approved the force-push and the tag move in chat. The same rewrite carried the round-5 code fixes.
