# Recorded pane captures

These screens were recorded with `tmux capture-pane -p` (`.txt`) and `capture-pane -e -p` (`.ansi`, with SGR colour escapes). The agents were real ones running in throwaway sandbox directories on an isolated tmux server, on 2026-11-05:

- Claude Code 2.1.318
- Codex CLI 0.166.0
- Pi

Sanitizing:
- Sandbox paths were rewritten to `/tmp/sandbox/…`.
- Session UUIDs were zeroed.
- Local setup details were removed: Pi's installed skills, extensions, packages and model; the account plan name in Claude's banner; the Codex model name; Claude's slash-command menu (which lists installed skills and plugins); and the recorder's custom status-line rows, which are blanked. Styled `.ansi` rows that differed from their sanitized `.txt` row after stripping escapes were replaced by the plain row. `test/fixtures-privacy.test.js` enforces this on the ANSI-stripped text.

The tasks were trivial: create `hello.txt`, `curl -sI https://example.com`. Error screens came from pointing the agent at a closed local port: `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, and a Codex provider with `base_url = "http://127.0.0.1:9/v1"`.

Expected classifications live in `../expectations.json`. When a harness update changes its TUI, record a new capture the same way, add it here with its expectation, and adjust `src/detect.js` until `npm test` passes.
