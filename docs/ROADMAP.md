# Roadmap

tmuxherd should stay small: a dependency-free supervisor that works with any terminal agent. Bigger features ship only if they keep that.

## Next (0.2)
- **Hook-assisted detection.** Claude Code and Codex can run hooks on notification and stop events. An optional hook that POSTs to tmuxherd would make "waiting" and "done" exact for those harnesses. Screen detection would remain the fallback.
- **Alert replay.** Persist the alert history across dashboard restarts, in tmux options or a small JSON file.
- **Per-agent thresholds.** A long test run should not trip the same stall timer as a chat turn.

## 0.1.1 (small fixes from the last fresh-user run)
- `tmuxherd --help` should say `attach [session]`, matching usage.md (good first issue 9 goes further).
- `tmuxherd ls` should sort rows by creation time; today their order can change between runs.
- The tile hover preview can cover the right-hand inbox and alerts rail; keep it inside the grid.
- Tile durations refresh about every 5 s; tick them every second.
- `tmuxherd ls` leaves the directory column empty for an exited agent; fall back to the start directory stored with the agent.

## Good first issues
Each of these is scoped to a few files and has a clear test.

1. **Gemini CLI preset and captures.** Add a `gemini` preset in `src/spawn.js`, record working/idle/permission captures in a sandbox (see AGENTS.md), add expectations, and adjust `detect.js` if needed.
   *Done when:* `npm test` covers three Gemini screens.
2. **OpenCode preset and captures.** Same as above for `opencode`.
3. **`tmuxherd ls --watch`.** Re-print the table every N seconds (like `watch`), coloured by state.
   *Files:* `src/cli.js`. *Test:* a CLI test using a temp socket.
4. **Copy a prompt's context to the clipboard.** A small button on each inbox item.
   *Files:* `public/app.js`.
5. **Keyboard shortcuts for the inbox.** `j`/`k` to move between waiting agents and `1`–`9` to pick an option, with a visible focus ring.
   *Files:* `public/app.js`. *Test:* extend `e2e/fake.spec.js`.
6. **ntfy and Discord webhook formats.** Add `--webhook-format ntfy` (title header plus priority) and `discord` (`{content}`).
   *Files:* `src/notify.js`. *Test:* `test/notify.test.js` with a stub `fetch`.
7. **Configurable worktree location.** A `worktreeDir` config key, with `<repo>.worktrees` as the default.
   *Files:* `src/spawn.js`, `src/cli.js`. *Test:* extend the worktree integration test.
8. **Kill-and-clean-worktree action.** When killing an agent that has a worktree, offer `git worktree remove` if the tree is clean.
   *Files:* `src/server.js`, `src/spawn.js`, `public/app.js`.
9. **`tmuxherd attach <agent-name>`.** Today the argument is a tmux session name. Resolve it to the agent's window too, falling back to the session name.
   *Files:* `src/cli.js`. *Test:* a CLI test on a temp socket.

## Later
- A read-only share link (a second token that only grants `GET`).
- A narrow mobile layout tuned for answering prompts on a phone over an SSH tunnel or tailnet.
- Remote fleets: one dashboard over several machines' tmuxherd APIs.

## Not planned
- Bundling a terminal emulator (xterm.js) or a PTY layer: tmux already is one. For heavy interactive work, use `tmuxherd attach`.
- Auto-approving prompts. tmuxherd shows you the exact prompt and makes answering fast; deciding stays with you.
