# Contributing to tmuxherd

## Setup

Requirements: Node >= 20 and tmux >= 3.2.

```
git clone https://github.com/vulbsti/tmuxherd.git
cd tmuxherd
npm ci
```

tmuxherd has zero runtime dependencies. Please do not add any. Dev dependencies (ESLint, Playwright) are fine.

## Commands

| Command | What it does |
| ------- | ------------ |
| `npm test` | Unit and integration tests, run on an isolated tmux socket. |
| `npm run lint` | ESLint. |
| `npm run e2e` | Playwright against a fake agent. Run `npx playwright install chromium` once first. |
| `npm run e2e:real` | Local only. Needs logged-in `claude` and `codex`, costs a few cents of tokens, and runs in sandbox directories. Not run in CI. |

## Golden rule: never touch the default tmux server

Tests and dev servers must use their own socket and never touch the default tmux server or your personal sessions: tests use socket paths in a temp dir (`-S`) or `TMUX_TMPDIR=<tempdir>`, and a dashboard you run by hand uses its own `--socket <name>`. Every tmux call that acts on a server goes through the wrapper in `src/tmux.js`, which always names the socket (`-L <name>` or `-S <path>`) and always passes the bundled `-f` conf for servers tmuxherd owns; do not call `tmux` directly. The only exceptions are `tmux -V` and `tmuxherd attach` (see AGENTS.md). Note that `tmux -L <name>` still loads `~/.tmux.conf` unless `-f` is given (see `DECISIONS.md`, D4).

## Adding a harness or updating detection

When an agent's TUI changes, or you add a new one:

1. Record a capture of the screen (`tmux -L <socket> capture-pane -e -p -t <pane>`) into `test/fixtures/captures/`.
2. Add the expected result (harness, state, prompt options) to `test/fixtures/expectations.json`.
3. Adjust `src/detect.js` until `npm test` passes.

Captures must not contain personal data: no usernames, home paths, hostnames, emails, tokens or private repository names. Redact before committing.

## Commits and pull requests

- Keep commits small and focused, with a clear message saying why.
- `Co-Authored-By` trailers are not required.
- Fill in the pull request template. New detection patterns need fixture captures.

## Releases (maintainer only)

1. Bump the version in `package.json`.
2. Update `CHANGELOG.md`.
3. `git tag vX.Y.Z`
4. `git push --tags`
5. `npm publish`

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
