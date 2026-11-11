# tmuxherd: alternatives and adjacent tools

Researched 2026-11-05. Every row was checked against the project's current GitHub README, repo metadata (via the GitHub API) or official website/docs. Stars and dates are as of 2026-11-05. "Not verified" means I could not confirm it from a primary source. It does not mean "no".

Reference point (as described by the tmuxherd author, not independently checked): local web dashboard on 127.0.0.1 with a token; a grid of live tmux panes plus zoom; spawning agent panes, optionally in git worktrees; per-agent state (working / waiting for permission / idle / stalled / exited); answering permission prompts from the browser; a stall watchdog with browser, desktop and webhook notifications; harness-agnostic; Linux and macOS; zero runtime dependencies (Node).

## Comparison table

| Project | Form factor | OS | License | Agents | tmux-based | Answer permission prompts from UI/remote | State / stall detection + notifications | Git worktrees | Stars | Last commit / release |
|---|---|---|---|---|---|---|---|---|---|---|
| **Conductor** | Desktop app (+ iOS remote) | macOS only | Closed source | Claude Code, Codex, Cursor, OpenCode | No (not mentioned) | Yes in desktop app (Claude Code tool approvals, opt-in, since 0.45.0). From iOS: not verified | macOS notification on tool-permission request. Stall detection: not verified | Yes | n/a (closed) | 0.93.0, 2026-11-04 ("joining Meta") |
| **Claude Squad** | TUI | macOS, Linux (install script also handles Windows/mingw, untested) | AGPL-3.0 | Claude Code, Codex, Gemini, Aider, any command | Yes | Only `--autoyes` auto-accept (experimental). No manual remote answering | Statuses Running/Ready/Paused/Loading. No notifications found in code | Yes | ~8.7k | v1.0.20, 2026-08-20 |
| **Vibe Kanban** | Web UI (local, `npx`) | macOS, Linux, Windows/WSL | Apache-2.0 | 10+: Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen Code | No | Yes, tool approvals in UI (approvals service in code) | OS desktop notifications + sound. Stall: not verified | Yes | ~28.6k | Commit 2026-11-04. Last release v0.1.44, 2026-04-24. **Company sunset announced 2026-04-10**, now community-maintained |
| **agent-deck** | TUI + local web UI (127.0.0.1:8420) + Telegram/Slack/Discord bridge | macOS, Linux, WSL | MIT | Claude, Codex, Gemini CLI, OpenCode, Pi, Copilot, Hermes, shell/custom | Yes | Yes: web terminal pane, Command Center "waiting decisions", Telegram conductor | Running/waiting/idle/error via hooks + pane parsing. Web push, tmux status bar, Telegram/Slack. Watchdog nudges children stuck "waiting" >10 min | Yes (+ setup/teardown scripts, sparse checkout) | ~1.2k | v1.16.36, 2026-11-02 |
| **ccmanager** | TUI (PTY, no tmux) | macOS, Linux, Windows | MIT | Claude Code, Gemini, Codex, Cursor Agent, Copilot CLI, Cline, OpenCode, Kimi, MCode, Grok Build | No | No remote. Experimental AI auto-approval | Busy/waiting/idle per harness. Status-change hooks → user-wired notifications. No stall | Yes | ~1.3k | v4.4.11, 2026-10-27 |
| **Crystal → Nimbalyst** | Desktop app (Electron) + iOS companion | macOS, Windows, Linux | MIT | Codex, Claude Code. OpenCode, Copilot (alpha). Gemini provider | No | Mobile "reply" and approve diffs. Tool-permission answering: not verified | Push notification "when an agent is waiting" (iOS). Stall: not verified | Yes | Crystal ~3.1k (deprecated Feb 2026). Nimbalyst ~2.0k | Nimbalyst v0.81.7, 2026-10-16 |
| **Sculptor** (Imbue) | Desktop app | macOS (Apple Silicon), Linux x64/ARM64 | MIT | Claude Code, Pi (integrated). Any terminal agent | Not verified | Integrated Claude runs with tool permissions auto-approved. Own ask-question/plan-approval panel | Notifications mentioned in harness docs. Stall: not verified | Yes (default workspace mode) | ~245 | sculptor-v0.49.0, 2026-10-21 |
| **cmux** (Manaflow) | Native terminal app (Ghostty-based) + iOS beta | macOS only | GPL-3.0-or-later (server parts BUSL-1.1) | Any terminal agent; hooks for Claude Code, Codex, OpenCode, pi | No (can attach to tmux) | Typing in the terminal. iOS app attaches to terminals (paid Pro beta) | Attention rings, notification panel, macOS notifications via OSC 9/99/777 or `cmux notify`. No stall detection | Not a listed feature | ~28.7k | v0.65.2.2, 2026-10-27 |
| **CloudCLI** (claude-code-ui) | Web UI (responsive/mobile) + desktop companion | Any Node 22+ host (Windows desktop app listed) | AGPL-3.0-or-later | Claude Code, Cursor CLI, Codex (OpenCode in code) | No | Yes, permission-request banner in chat UI | Notifications: not verified. Stall: no | Not verified | ~14.4k | v1.37.7, 2026-10-31 |
| **Happy** (slopus) | Mobile apps (iOS/Android) + web + CLI wrapper + desktop | CLI: Node. Desktop: macOS, Windows, Linux | MIT | Claude Code, Codex, Grok, Antigravity/Gemini, OpenClaw, any ACP agent | Optional (tmux util in daemon code), not core | Yes, approval prompts on phone for Claude Code | Push notifications (APNs/FCM). Stall: not verified | Worktree UI in mobile app source. Not documented in README | ~24.5k | Commit 2026-11-05. cli-1.2.5, 2026-09-22 |
| **opcode** (formerly Claudia) | Desktop app (Tauri) | macOS, Linux, Windows | AGPL-3.0 | Claude Code only | No | Not verified | Not verified | Not listed | ~22.4k | Last code commit 2025-10-16. v0.2.0, 2025-08-31. Effectively dormant |
| **uzi** | CLI | Not stated (Go + tmux) | MIT | claude, codex, aider, cursor, any | Yes | `uzi auto` auto-presses Enter on prompts | `uzi ls -w` status. No notifications | Yes | ~580 | 2025-06-04 (v0.0.2). Dormant |
| **Tmux-Orchestrator** | Scripts + prompts | Not stated | No license file | Claude | Yes | No | Self-scheduled check-ins. No detection | No (branches) | ~1.8k | 2025-07-14. Dormant |
| **Omnara** | Was terminal↔web/mobile sync. Now managed-agent platform | Daemon on macOS/Linux | Apache-2.0 | Old: Claude Code, Codex. Now: any model via its own agent loop | No | Yes (platform approvals) | Not verified | No | ~3.4k | omnarad-v0.2.17, 2026-11-04. **Pivoted**, no longer a CLI-agent supervisor |
| **Claude Control** | Desktop app (Electron) | macOS only | MIT | Claude Code only | Optional | Yes: approve/reject from dashboard (via tmux send-keys) | Working/Idle/Waiting/Errored/Finished via hooks. macOS notifications + sounds. No stall | Yes | ~140 | 2026-09-07 |
| **agent-dashboard** (bjornjee) | TUI + LAN PWA | macOS, Linux | MIT | Claude Code, Codex | Yes | Yes, approve/reject + reply from phone PWA | blocked/waiting/running/review states. Browser notifications | Not verified | ~26 | 2026-07-12 |
| **Xum** (coder, formerly Mux) | Desktop app | macOS, Linux | AGPL-3.0 | Its own agent loop (multi-model). Does not supervise external CLIs | No | n/a | Sidebar agent status | Yes (+ SSH runtime) | ~2.1k | v0.32.1, 2026-10-27 |

## Per-project notes

### Conductor (Melty Labs): https://www.conductor.build
- A macOS app for running parallel Claude Code, Codex, Cursor and OpenCode agents in isolated workspaces, then reviewing and merging their diffs. Docs say workspaces are separate checkouts created with git worktrees. Also has plan mode, a diff viewer, checks and PR creation. Closed source.
- Tool approvals: 0.41.0 (2026-03-19) shipped tool approval as an enterprise setting. 0.45.0 (2026-04-01) let users turn on Claude Code tool approvals in Settings → Account, and added a macOS notification when an agent requests tool permission.
- 0.92.0 "Remote control" (2026-10-23): from the iOS app you can browse and create workspaces, read chats, send messages, pick models and stop agents. The page does not mention approving tools from the phone.
- **Meta:** Axios reported on 2026-11-04 that Meta acquired Conductor, and TechCrunch says Meta confirmed it. Terms were not disclosed. Conductor's own changelog entry 0.93.0 (2026-11-04) is titled "Conductor is joining Meta". It says Conductor Cloud goes read-only on Nov 13 and shuts down on Nov 20, 2026, and that the local app gets new models and critical fixes "until early 2027". Coverage calls it an **acquisition**. I found no primary source that uses the word "acquihire", so that framing is not verified. SiliconANGLE adds: more than 100k users, a $22M Series A in March 2026 (Spark, Matrix), founders Charlie Holtz (CEO) and Jackson de Campos (CTO). I could not verify from a primary source which Meta team the founders join.
- Sources: https://www.conductor.build/ · https://www.conductor.build/docs/ · https://www.conductor.build/docs/concepts/workspaces-and-branches · https://www.conductor.build/changelog · https://www.conductor.build/changelog/0.93.0-conductor-is-joining-meta · https://www.conductor.build/changelog/0.45.0-file-previews-codex-personalities · https://www.conductor.build/changelog/0.92.0-remote-control · https://techcrunch.com/2026/11/04/meta-acquires-ai-coding-startup-conductor/ · https://siliconangle.com/2026/11/04/meta-acquires-ai-coding-startup-conductor-whose-app-runs-several-coding-agents-at-once/

### Claude Squad: https://github.com/smtg-ai/claude-squad
- A Go TUI (`cs`) that runs each agent in its own tmux session plus git worktree. It shows a preview tab and a diff tab, and can commit, push, pause and resume sessions. Requires tmux and gh. Agents are set with `-p` or config profiles.
- Prompt detection is string matching in `session/tmux/tmux.go` (e.g. "No, and tell Claude what to do differently", "Yes, allow once"), used for `--autoyes` and status. There is no web or remote UI. A code search for "notification" found nothing.
- Sources: README, `session/tmux/tmux.go`, `session/instance.go`, `install.sh`.

### Vibe Kanban (bloop): https://github.com/BloopAI/vibe-kanban
- A local web app (`npx vibe-kanban`, Rust backend, binds 127.0.0.1 by default) that combines a kanban board with workspaces. Each workspace gets a branch (worktree), a terminal and a dev server. It also has diff review with inline comments, a built-in browser preview and PR creation. Its approvals service handles tool approval and question requests in the UI. Native desktop notifications cover macOS, Linux and Windows/WSL.
- **Status:** the README headline reads "Vibe Kanban is sunsetting". The blog post (2026-04-10) says bloop is shutting down, cloud and remote features ended after 30 days, local workspaces keep working, and the project continues as community-maintained open source. Commits are still landing (latest 2026-11-04), but the last GitHub release is from 2026-04-24.
- Sources: README · https://www.vibekanban.com/blog/shutdown · `crates/services/src/services/notification.rs` · `crates/executors/src/approvals.rs`

### agent-deck: https://github.com/asheshgoplani/agent-deck
- **Closest competitor to tmuxherd.** A Go TUI over tmux with a local web UI (`agent-deck web`). The web UI binds 127.0.0.1:8420 by default, accepts an optional `--token`/`--token-file` bearer token (required for non-loopback binds), and has `--read-only` and `--push` (Web Push) modes. The web UI includes a terminal pane, a fleet pane and a Command Center with "waiting decisions" and a message box.
- Status detection combines hooks (Claude, Codex, Gemini, Pi, Hermes) with pane-frame classification, scored against a golden corpus. States are running, waiting, idle, error and stopped.
- Notifications: a tmux status-bar list of waiting sessions, a `notify-daemon` for status transitions, a "conductor" session with Telegram/Slack/Discord/Mattermost bridges and heartbeats, and a watchdog. The watchdog auto-restarts errored critical sessions and nudges child sessions stuck in "waiting" with an unchanged pane for more than 10 min. Note that this watchdog is scoped to conductor children.
- Also: worktrees with setup/teardown scripts, Docker sandbox, session fork, MCP and skills managers, a cost dashboard and remote instances over SSH.
- I did not verify whether the web UI shows a simultaneous multi-pane grid.
- Sources: README · `docs/COMMAND-CENTER.md` · `docs/status-detection.md` · `cmd/agent-deck/web_cmd.go` · `scripts/watchdog/README.md` · `internal/web/static/app/` file listing

### ccmanager: https://github.com/kbwo/ccmanager
- A Node/TypeScript TUI that runs agents in its own PTYs, with no tmux. It has per-harness state detection (busy/waiting/idle), worktree create/merge/delete, `.worktreeinclude`, session restore after restart, devcontainer integration, and status-change hooks you wire to notification tools. Auto-approval is experimental. The README explicitly positions it against Claude Squad. There is no web or remote UI.
- Sources: README.

### Crystal → Nimbalyst (Stravu): https://github.com/stravu/crystal → https://github.com/Nimbalyst/nimbalyst
- Crystal, an Electron app for parallel Claude Code/Codex sessions in worktrees, was deprecated in February 2026 and replaced by Nimbalyst. Nimbalyst is a visual workspace: a session kanban, worktree-isolated parallel sessions, an embedded terminal, and markdown, diagram and mockup editors. Its iOS companion shows which agents need you, lets you reply by text or voice, review diffs, and receive push notifications when an agent is waiting.
- Sources: both READMEs, https://nimbalyst.com/

### Sculptor (Imbue): https://github.com/imbue-ai/sculptor
- A desktop app (Mac Apple Silicon, Linux x64/ARM64) for parallel agents. Workspaces default to git worktrees. It has integrated Claude Code and Pi harnesses and can run any terminal agent. The integrated Claude runs sandboxed with tool permissions auto-approved, and Sculptor adds its own ask-question/plan-approval panel. Its README calls it an "experimental research preview".
- Sources: README · `docs/help/workspaces.md` · `docs/help/integrated_harnesses.md`

### cmux (Manaflow): https://github.com/manaflow-ai/cmux
- A native macOS terminal built on libghostty, with vertical tabs, notification rings and a notification panel, an in-app scriptable browser, SSH workspaces, Claude Code teams as splits, and a CLI/socket API. It is a terminal, not a supervisor: "a primitive, not a solution". It is macOS only. The iOS app is in TestFlight beta and gated behind cmux Pro.
- Sources: README FAQ · LICENSE

### CloudCLI / Claude Code UI (siteboon): https://github.com/siteboon/claudecodeui
- A self-hosted web/mobile UI with chat, shell terminal, file explorer, git explorer and plugins, covering Claude Code, Cursor CLI and Codex. It discovers existing sessions and has a permission-request banner in the chat composer. A paid hosted "CloudCLI Cloud" is also offered. It is session- and chat-centric rather than a grid of live terminals.
- Sources: README · code search (`src/modules/chat/composer/PermissionRequestsBanner.tsx`)

### Happy (slopus): https://github.com/slopus/happy
- An end-to-end encrypted mobile, web and desktop client. You wrap agents with `happy claude`, `happy codex` or `happy acp <agent>`, or spawn them from the phone via a daemon. It gives an approval prompt for Claude Code (the README notes that agy has none). It sends push notifications through its own push server and supports multiplayer sessions. It needs its relay server, which can be self-hosted.
- Sources: README · `packages/happy-cli/README.md` · https://happy.engineering/ · code search (tmux util, mobile worktree views)

### opcode (formerly Claudia): https://github.com/winfunc/opcode
- A Tauri GUI for Claude Code covering projects and sessions, custom agents, usage analytics, MCP management and checkpoints. `getAsterisk/claudia` redirects to `winfunc/opcode` (confirmed via the GitHub API). The last code commit was 2025-10-16, and only a README edit came after it (2026-09-18).
- Sources: README · GitHub API commit list

### uzi: https://github.com/devflowinc/uzi
- A Go CLI that runs N agents in tmux + worktrees with dev-server port management. It has `uzi auto` (auto-presses Enter on trust and confirmation prompts), `broadcast` and `checkpoint`. It has been dormant since June 2025.

### Tmux-Orchestrator: https://github.com/Jedward23/Tmux-Orchestrator
- Prompts and scripts that have Claude agents (orchestrator → PM → engineers) manage each other across tmux windows and schedule their own check-ins. It has no UI, no detection and no license file. Last commit was 2025-07-14.

### Omnara: https://github.com/omnara-ai/omnara
- Before October 2025, its README pitched "Mission Control for Your AI Agents": `omnara` wrapped Claude Code or Codex and synced the session to web and iOS. The current README is "the open-source managed agent platform", a self-hostable alternative to Claude Managed Agents with its own agent loop, permissions and approvals. It is no longer a CLI-agent supervisor.
- Sources: current README and README at commit `be6ef79` (pre-2025-10-01)

### Claude Control: https://github.com/sverrirsig/claude-control
- A macOS Electron dashboard for Claude Code only. It auto-discovers `claude` processes and uses hooks for Working/Idle/Waiting/Errored/Finished. You can approve or reject permission prompts from the dashboard (in tmux via send-keys). It has macOS notifications, sounds, worktree creation and cleanup, and PR badges.

### agent-dashboard: https://github.com/bjornjee/agent-dashboard
- A Bubble Tea TUI over `tmux capture-pane` for Claude Code and Codex, plus a LAN PWA that can approve/reject, reply, create sessions and send browser notifications. It enforces workflow gates through hooks and skills. Very small (26 stars) but conceptually close.

### Xum (formerly coder/mux): https://github.com/coder/xum
- A desktop "coding agent multiplexer" with local, worktree and SSH runtimes. It uses its **own** agent loop and does not supervise external CLIs. It is listed only because the name and positioning overlap.

### Long tail (seen in search, not evaluated in depth)
danilotorrisi/claude-session-manager (2 stars), wolfpeter/claude-session-manager (0), bruceyxli/claude-code-monitor (13), hoangsonww/Claude-Code-Agent-Monitor, Stargx/claude-code-dashboard, LukasReindlGit/ai-dashboard. Several are tmux plus web dashboards for Claude Code with remote approval, which shows that the space has many small one-person tools.

## Where tmuxherd is genuinely different, and where others are ahead

**Different.** Few tools combine all of these: a browser grid of many *live* tmux panes at once (not a list with one attached session), being harness-agnostic by working at the terminal level, a dedicated *stall* state with a watchdog that fires browser, desktop *and* generic webhook notifications, Linux and macOS support, and zero runtime dependencies. Most GUI competitors are macOS-only (Conductor, cmux, Claude Control), Claude-only (Claude Control, opcode), need a relay or cloud account (Happy, Omnara, CloudCLI Cloud), or bring their own heavyweight stack (Electron/Tauri apps, Vibe Kanban's Rust server). The TUI tools (Claude Squad, ccmanager, uzi) have no browser surface or remote permission answering at all. Several notable projects are also winding down or dormant: Conductor (acquired by Meta, cloud closes 2026-11-20), Vibe Kanban (company sunset), Crystal (deprecated), opcode, uzi and Tmux-Orchestrator. That leaves room for a small, maintained, dependency-free tool.

**Competitors are clearly ahead.**
- **agent-deck** has the same architecture: tmux underneath, a 127.0.0.1 web UI with a bearer token, push notifications, and worktrees. It is far more mature, with hook-plus-pane status detection tested against a golden corpus, Pi/Codex/Gemini/OpenCode support, Telegram/Slack bridges, an SSH remote fleet, session fork, Docker sandboxes, cost tracking and a waiting-too-long watchdog. tmuxherd's honest pitch against it is simplicity: no Go binary, zero deps, and a grid-first view. It is not a feature advantage.
- **Conductor, Nimbalyst, Sculptor and Vibe Kanban** are well ahead on the review loop: diff viewers, inline comments, PR create and merge, plan mode and checks. tmuxherd supervises terminals and does not help you review or merge agent output.
- **Happy, Nimbalyst, Conductor and cmux** ship native mobile apps with push notifications. A localhost-only dashboard needs the user to set up their own tunnel to be reachable from a phone.
- Hook-based state detection (agent-deck, Claude Control, Happy) is likely more reliable than pure screen-scraping for the harnesses that offer hooks. Screen-scraping is tmuxherd's price for being harness-agnostic, so it should be measured and documented.
- **Adoption:** Vibe Kanban, cmux, Happy, opcode and CloudCLI each have 14k–29k stars, and Claude Squad has ~8.7k. tmuxherd enters a crowded space and will be judged on reliability and footprint rather than novelty.
