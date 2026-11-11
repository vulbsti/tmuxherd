# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-11-06

First release.

### Added
- A local web dashboard on 127.0.0.1. It shows a live grid of agent panes with hover-zoom and a full zoom view you can type into.
- State detection for Claude Code, Codex CLI, Pi and generic agents: working, waiting, idle, stalled and exited. Tested on screens recorded from real sandbox runs.
- A prompt inbox: answer permission, trust and menu prompts from the browser. Answers use a move → verify → confirm sequence with a stale-prompt fingerprint check.
- A stall watchdog. It alerts on no-progress, retry loops, error-after-work, and exited-with-work-pending, through browser notifications, desktop notifications (`notify-send` / `osascript`) and webhooks (json, slack, text).
- Spawning agents from the UI with presets (claude, codex, pi, shell, custom), optionally in a new git worktree.
- `--adopt <socket>:<%pane>` to opt in to supervising an existing pane.
- `tmuxherd ls [--json]` and `tmuxherd attach`.
- Security: a per-launch token exchanged for an HttpOnly cookie, Host and Origin checks, a strict CSP, and its own tmux server with its own config and an ownership marker. Every pane operation first re-checks that the pane is still the one tmuxherd created or adopted.
- Zero runtime dependencies.
