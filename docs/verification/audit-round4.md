**Verdict: FAIL**

> Audit round 4 (2026-11-06, on `ae52cce`). Identifying strings the auditor quoted (hostname, kernel, plan name, owner's first name) are replaced with `<placeholders>` in this copy. Follow-up: see the end of this file and VERIFICATION.md.

Audit round 4 of `vulbsti/tmuxherd`. The audit covered `main` = `ae52cce`, tag `v0.1.0` (tag object `956dbbb`) → `c09321e`, and was run on 2026-11-06. The repo was read-only throughout: no edits, commits, pushes or GitHub writes. Every tmux command I ran went to sockets under my own temp dir. `ls -A /tmp/tmux-1000` was empty both before and after the work; see `tmux-before.txt` and `tmux-after.txt` in this folder. `pgrep -af tmux` afterwards found no leftover servers.

Almost everything holds up: code, tests, CI, safety model, GIF, alternatives and boilerplate. The FAIL comes from one hard-rule violation in git history (F1). Below that are several MINOR and NIT findings.

## Findings

| ID | Severity | Area | Evidence (command + output, or file:line) | Why it matters |
|---|---|---|---|---|
| F1 | **MAJOR** | Repo hygiene: real hostname in history | `for c in $(git rev-list main); do git grep -n -E 'root@<hostname>\|"<hostname>" [0-9]' $c; done` → hits in **4 reachable `main` commits**: `3c8044d`, `3ac53d0`, `b1f9797` and `bf429ff`, all in `docs/verification/fresh-user.md:152` `(tmux alternate screen) root@<hostname>:/#` and `:154` `[tmuxherd]0:home* 1:sh1 2:menu  "<hostname>" 17:22 05-Nov-26`. `hostname` → the same `<hostname>`, so this is the real machine hostname: the fresh-user container ran with `--network host` and inherited it. `git show 83f8920` redacts it to `root@…:~#`, so the author knew it was sensitive and fixed only HEAD. The round-3 history rewrite (`c09321e`) did not purge it. The same commits' text (`fresh-user.md:133`) and the historical blob `41c5c21` (old `fresh-user-zoom.jpg`, which I viewed) also show the host kernel `Linux <host kernel>`. | The hard rule is "No personal data … in ANY commit of its history: … real hostnames". `gitleaks` cannot see this, and VERIFICATION's "No personal data" row says history is clean. Fixing it needs another rewrite and force-push, which needs owner approval. (Mitigating factor: the hostname equals the public GitHub handle.) |
| F2 | MINOR | Go-public steps vs. known blocker | `RELEASE.md` §1 gives `gh repo edit … --visibility public` with no pointer to `BLOCKED.md`. `git fetch` of `refs/pull/{1,2,3}/head` into a scratch bare repo, then `git grep 'Claude <plan>' 9fdaefd` → `test/fixtures/captures/claude-{api-error,idle,perm-edit,retrying,thinking,working-bash}.txt:2: Opus 5.5 · Claude <plan>`. These PR refs stay on GitHub (`gh api repos/vulbsti/tmuxherd/git/matching-refs/` lists `refs/pull/1..3/head`). | The account plan name stays reachable on GitHub. `BLOCKED.md` records this correctly, but an owner who follows RELEASE.md's "exact go-public commands" verbatim publishes it. RELEASE.md §1 should start with the BLOCKED.md step. |
| F3 | MINOR | Token confidentiality | My probe `probe/probe.mjs` started tmuxherd on an isolated socket, opened `/?token=…` in Playwright Chromium, then browsed to a plain HTTP server on another `127.0.0.1` port. Output: `cookie sent to OTHER localhost port: YES (token leaked)`. The cookie (`server.js:190`, `tmuxherd_<port>=<token>; HttpOnly; SameSite=Strict; Path=/`) is not port-scoped, by RFC 6265. | Every other loopback HTTP listener the user visits receives the full token, which "is equivalent to a shell as your user" (SECURITY.md). Examples: another OS user's server on a shared machine, or a dev server that logs request headers. SECURITY.md doesn't mention it. Cross-origin writes are still blocked by the Origin check (verified: cross-port POST → fetch failed). |
| F4 | NIT | Auth consistency | Probe: `GET /static/index.html` with no token → `200` and the dashboard HTML. `GET /` with no token → `401` (`server.js:196-204`). | No secret is exposed (the API still needs the token), but the "page requires the token" claim (`test/server.test.js:66`) holds only for `/`. |
| F5 | NIT | Docs vs. code: tmux wrapper rule | `AGENTS.md` rule 3 says "All tmux invocations go through `src/tmux.js`", and `CONTRIBUTING.md:26` says "which always passes `-L` and `-f`". But `src/cli.js:146` runs `run('tmux',['-V'])` and `src/cli.js:214-215` runs `spawn('tmux', ['-L', o.socket, 'attach', …])` directly, without `-f`. | This is safe today: `attach` follows an ownership check and never starts a server. The project's own rule is still broken, and that path drops the `-f` guarantee. |
| F6 | NIT | "re-checks before every pane operation" (docs/api.md, D18) | In `server.js:267` the route calls `verify()`, then awaits `readJson(req)` (`:279`, `:297`). `answer.js:48-77` then sends up to about 21 `send-keys` over ≤2.5 s plus 10×80 ms with no further pid or marker check. | This is a small TOCTOU window. It is practically unexploitable, because each step needs the same prompt fingerprint on screen. The wording "every operation" is stronger than the code. |
| F7 | NIT | Docs vs. behavior: Host check | `docs/api.md` says the Host "must be `127.0.0.1`, `localhost` or `[::1]`. Anything else gets 421", and SECURITY.md says "Every other host is still refused". But `server.js:91` `if (allowRemote) return;` disables the Host check entirely under `--allow-remote`, and `--allowed-origin` adds hosts. | This is opt-in only and the token is still required. The docs overstate the protection. |
| F8 | NIT | VERIFICATION accuracy | The VERIFICATION header says "Everything was checked on 2026-11-05", but the final-gate rows are dated 11-06. It cites hashes that no longer exist on `main`: `1b0004f` (real-e2e run 3 and fresh-user run 4 are "on `1b0004f`") and `f7355d0`. `git fsck --unreachable` lists `1b0004f` as unreachable. "Round 4: see `docs/verification/audit-round4.md`" points to a file that doesn't exist. | The evidence trail points at commits nobody can check out. |
| F9 | NIT | Identity | `git log --all --format='%an'` → `<owner first name>` on all 18 commits, and the tag's tagger is `<owner first name>`. VERIFICATION's `<owner name>` check covered only emails (`%ae`) and file contents. | Author emails meet the bar (noreply only). The owner's real first name will be public; that's the owner's call, but VERIFICATION doesn't mention it. |
| F10 | NIT | Test hermeticity | `test/server.test.js:142-143`: `resolveOptions(['--socket','default'], {})` and `(['--host','0.0.0.0'], {})` pass `env={}`, so `defaultConfigPath` falls back to `os.homedir()/.config/tmuxherd/config.json` and reads the real user config if it exists. | The result depends on the developer's machine. Round 1 claimed "XDG-safe" tests. |
| F11 | NIT | Personal environment detail | `DECISIONS.md` D4 named the owner's specific session-restore plugin and its snapshot date. VERIFICATION S2 names `<snapshot file>`. | These are minor details about the owner's personal setup, not secrets. |

The round 1–3 fixes hold, re-checked:
- The ownership marker refuses a foreign server on the socket.
- A replaced server is unreachable through stale keys.
- Adopted panes are pinned to their pid, and kill and resize refuse them.
- `attach` checks ownership.
- The late exit status is handled.
- All 28 distinct fixture blobs in `main` history are clean once ANSI and OSC 8 escapes are stripped.
- The demo GIF frames show "Opus 5.5 · Claude ···" (redacted).
- gitleaks reports 0 findings.

## Commands I ran (key outputs)

- `docker run --rm -v "$PWD:/r" zricethezav/gitleaks git /r` → `18 commits scanned … no leaks found`, exit 0.
- `env -u TMUX npm test` → `ℹ tests 90 ℹ pass 90 ℹ fail 0`, then 6 more runs → `failures=0/6`.
- `npm run lint` → clean.
- `npx playwright test --project=fake` → `3 passed (7.5s)`.
- `git log --all --format='%ae %ce' | sort -u` → only `29302849+vulbsti@users.noreply.github.com` (18 commits). `git log --all --format=%B | grep -ci co-authored` → `0`.
- `gh api repos/vulbsti/tmuxherd` → `"private":true,"visibility":"private"`. `refs/heads/main` → `ae52cce…`. Tag `v0.1.0` → tag object `956dbbb` → commit `c09321e`.
- `gh run list` → `42178504252 ae52cce success` and `42176943701 c09321e success`. Both runs had 5 jobs succeed: ubuntu-latest and macos-latest × Node 20/24, plus ubuntu-22.04/Node 22. From the logs of 42178504252: macOS ran `tmux 3.8`, `ℹ pass 90 ℹ fail 0 ℹ skipped 0`, and e2e `3 passed`; ubuntu-22.04 ran `tmux 3.2a`.
- `node bench/poll-cost.js 10 10` → `tmuxherdCpuPct 1.1`, `tmuxServerCpuPct 0.7`, tick p95 17 ms, RSS 63 MB. That is the same order as the README (1.9 %, p95 87 ms).
- Probe `probe/probe.mjs` against a live instance:
  - `/api/state` without a token → 401.
  - `Host: evil.com` → 421. `Host: localhost.evil.com` → 421.
  - `/static/../src/cli.js`, `%2e%2e` and `..%2f` → 404.
  - The token visit redirects to `/`.
  - The cookie leaks to another loopback port (F3).
  - A cross-port POST fails.
- CLI refusals: `ls --socket default` → exit 2 "needs its own". `--socket ../x` → exit 2. `--host 0.0.0.0` → exit 2 "pass --allow-remote".
- Name check: `npm view tmuxherd` → 404. PyPI → 404. GitHub search `tmuxherd in:name` → only `vulbsti/tmuxherd`.
- Alternatives spot checks (web):
  - Conductor changelog 0.93.0 says "Conductor is joining Meta", with read-only on Nov 13 and shutdown on Nov 20. ✔
  - The Vibe Kanban blog post (2026-04-10) says bloop is shutting down and the project continues as community-maintained. ✔
  - The Claude Squad README shows a TUI, tmux, worktrees and `--autoyes`, with no web UI or notifications. ✔
  - agent-deck: Go TUI over tmux, web UI on 127.0.0.1:8420, Telegram/Slack bridges, worktrees, hook-assisted status. ✔ The README doesn't say whether the web UI uses a token, but the research notes cite `web_cmd.go`.
- Image review:
  - Extracted all 101 GIF frames (PIL) and viewed the key frames (0, 20, 38, 42, 75, 87, 100), with 4× crops of the terminal banners.
  - Viewed all 16 image blobs ever committed, including the superseded JPEG versions. The only finding is the kernel string in historical `41c5c21` (F1).
  - Metadata is limited to JFIF and `Lavc` comments.
  - Rendered all four SVGs on white and `#0d1117`; they are readable in both themes.

## Checklist: OSS_STANDARD

| Item | Result | Evidence I checked myself |
|---|---|---|
| A. Own repo at `~/proj/oss/tmuxherd`; distinct name; recorded in DECISIONS | PASS | DECISIONS D1. I re-ran the npm, PyPI and GitHub checks above. |
| A. Private repo under vulbsti | PASS | `gh api repos/vulbsti/tmuxherd` → private |
| A. No <other account> / <work domain> author | PASS | Only the noreply email (author and committer). Author name: F9 (NIT). |
| A. No Co-Authored-By | PASS | count 0, including the tag message |
| A. Milestone commits, pushed | PASS | 18 commits; `origin/main` = `main` = `ae52cce` |
| A. Not public, nothing published; RELEASE.md has the steps | PASS (with F2) | Private. `npm view` 404. RELEASE.md exists, but its go-public step lacks the BLOCKED gate (F2). |
| B. Sources read-only; the owner's existing session-history tool untouched | PASS (not independently verifiable) | Nothing in the repo references that tool. No source copies found. |
| B. No personal data (transcripts, tokens, .env, home paths, hostnames, plan names) in repo or ANY commit | **FAIL** | HEAD is clean, and fixtures, GIF and JPEGs are clean. The real hostname is in 4 `main` commits (F1). The plan name is in GitHub-retained PR refs (F2, documented in BLOCKED). No `.env` or secret files were ever committed (`git log --name-only`). |
| B. Fixtures synthetic or generated for the repo | PASS | Sandbox paths `/tmp/sandbox/…`, zeroed UUIDs, `model-x`, `example-skill-*`. The stripped fixtures read clean. |
| B. gitleaks 0 findings | PASS | `no leaks found` |
| B. grep for <home>, <work domain>, <owner name>, emails | PASS (files) | No `<home>` or `<work domain>` in any `main` blob. `docs/api.md` uses `/home/me`. Emails are only noreply ones. |
| C. One-command install; OSes stated | PASS | README `npm install -g github:vulbsti/tmuxherd`; `package.json` `os: [linux, darwin]` |
| C. Fresh-user test transcript, passing | PASS | `docs/verification/fresh-user.md` (run 5, PASS, on `c09321e`, container) plus screenshots. I read it; the screenshots match the text. |
| C. Few meaningful tests; CI (lint + tests) green | PASS | 90/90 locally, 6/6 reruns, lint clean, e2e 3/3. CI green on `c09321e` and `ae52cce`. |
| C. `v0.1.0` tag and CHANGELOG | PASS | Annotated tag → `c09321e` (green CI). CHANGELOG has `[0.1.0] - 2026-11-06`. |
| D. LICENSE Apache-2.0, README, CONTRIBUTING (dev, tests, release), CoC (Covenant 2.1), SECURITY, issue templates (bug, feature), PR template, CODEOWNERS @vulbsti, Dependabot | PASS | All present (`ls`). CODEOWNERS is `* @vulbsti`. `dependabot.yml` covers npm and actions. |
| D. architecture.md, usage guides, ROADMAP with 5+ good first issues | PASS | `docs/architecture.md`, `usage.md`, `api.md`; ROADMAP lists 9 numbered good first issues |
| D. AGENTS.md | PASS | Present and substantive (it has one stale rule; see F5). |
| E. Hero image | PASS | `assets/hero-banner.png` (549 KB), viewed: a CRT wall, not generic slop |
| E. Architecture SVG, light and dark | PASS | Rendered on `#fff` and `#0d1117`; both readable |
| E. Demo of the real tool | PASS | `assets/demo.gif`, 101 frames, 25 s, 840×525 |
| E. Explainer visual | PASS | `states-{light,dark}.svg`, rendered |
| E. Sources in assets/src; each image < 2 MB; README media < 10 MB | PASS | GIF 1,786,389 B is the largest file; the total is far under 10 MB. `assets/src` has scripts and prompts. |
| E. Checked as rendered in light and dark | PASS | My own render of the SVGs; the `render-readme.mjs` script exists |
| F. Every README claim backed by a test or benchmark | PASS | The "What's tested" table maps to existing tests. I re-ran the bench and the numbers are consistent. |
| F. Factual Alternatives | PASS | Spot-checked 4 projects against primary sources (above) |
| G. Decisions recorded; BLOCKED for owner items | PASS | DECISIONS D1–D19; BLOCKED.md |
| G. VERIFICATION maps every criterion to evidence | PASS (with F8) | Present, with stale hashes and dates (F8) |
| G. Final adversarial audit passes | **FAIL** | This audit: F1 is MAJOR |
| G. No grep/find from `/` | n/a | |

## Checklist: project criteria and hard rules

| Item | Result | Evidence I checked myself |
|---|---|---|
| P1. Linux and macOS, with CI covering both | PASS | CI logs for run 42178504252: macos-latest (tmux 3.8) ran 90 pass and 0 skipped, plus 3 e2e. Linux ran tmux 3.4 and 3.2a. |
| P2. State detection for Claude Code and Codex (working, waiting, idle, stalled, exited) on sandbox-recorded captures | PASS | `expectations.json` has 15 screens: Claude trust, 2 permission, working ×2, idle, retrying, api-error, exited; Codex trust, approval, working, idle, reconnecting. `tracker.test.js` covers stalled (timer, retry loop, error-after-work, usage limit, Codex reconnect) and exited or dead (Claude and Codex). All pass. |
| P3. Stall watchdog: browser, desktop and webhook alerts after a configurable N minutes | PASS | `--stall-minutes`, `/api/config`, `notify.js` (notify-send/osascript, json/slack/text webhooks), `notify.test.js`, and the e2e stall test asserting the toast and a `Notification`. All pass locally. |
| P4. Playwright e2e with REAL claude and codex approving a prompt from the UI | PASS (judged from the transcript, as instructed) | `e2e/real.spec.js` spawns from the UI and clicks `answer-<key>-<idx>`. `docs/verification/real-e2e.md` run 4 on `c09321e`: `2 passed (17.8s)`, with permission prompts answered for both. The test line numbers (75, 91) match the file. I did not re-run it. |
| P5. Spawn agents from the UI, with a worktree option | PASS | `e2e/fake.spec.js:22` and `:72` pass locally and in CI. The integration test "spawn in a new git worktree" passes. |
| P6. Demo GIF: 3+ real agents, one prompt answered from the browser, one flagged stalled | PASS | Frames show 4 agents (Codex web-tests; Claude docs, api-fix and billing). Frame 42 shows the "Answered api-fix · Yes" toast, and api-fix moves to working, then "I created health.js…" (frame 75). Frames 87–100 show billing "stalled" with the "Agent stalled: billing" toast. The README discloses the 30 s threshold and 6× speed-up. |
| P7. Factual Alternatives section | PASS | Spot checks above. Research notes cite sources. |
| S1. Never touch tmux servers or panes not created; own socket by default; attach is explicit opt-in | PASS | Code review: `tmux.js` (default refused; list, new-window, kill and resize are own-only; the marker is required) and `supervisor.verify()` (pid plus marker before every route). `--adopt` is the only way to reach other servers. Tests "foreign panes invisible…", "server on our socket … refused", and "replaced by a stranger's … stale keys reach nothing" pass. Residual TOCTOU nit: F6. |
| S2. Development and tests on an isolated tmux server | PASS | Tests use temp `-S` paths or `TMUX_TMPDIR` (`e2e/harness.js:17`). `/tmp/tmux-1000` was empty before and after all my runs (8 test-suite runs plus e2e plus bench). No tmux processes were left. |
| S3. 127.0.0.1 only, random per-launch token, documented safe remote opt-in | PASS (with F3, F7) | Default host is `127.0.0.1`. A non-loopback host is refused without `--allow-remote` (verified). The token is 32 random bytes (43 chars in base64url). The Host and Origin checks work (probe). SECURITY.md documents the SSH tunnel and tailscale serve. The cookie leaks to other loopback ports (F3); the Host check docs overstate it (F7). |
| H1. No personal data in repo or ANY commit (including binaries and stripped `.ansi`) | **FAIL** | F1 (hostname and kernel in 4 `main` commits); F2 (plan name in GitHub-retained PR refs, documented in BLOCKED) |
| H2. gitleaks 0 | PASS | `no leaks found` |
| H3. No Co-Authored-By; only author is `29302849+vulbsti@users.noreply.github.com` | PASS | Verified (F9 is a note on the author name) |
| H4. Repo private; go-public in RELEASE.md; blockers in BLOCKED.md | PASS (with F2) | Private. Both files exist; RELEASE.md doesn't link the blocker (F2). |

## To reach PASS

1. Rewrite `main` history to purge `root@<hostname>` and `"<hostname>" … 05-Nov-26` from `docs/verification/fresh-user.md` in `3c8044d`→`bf429ff`. While at it, remove `Linux <host kernel>` (text and the old `fresh-user-zoom.jpg` blob `41c5c21`). Force-push with owner approval and re-point `v0.1.0`. Future containers need an explicit `--hostname`.
2. Add "complete BLOCKED.md first" as step 0 of RELEASE.md §1 (F2).
3. Optional hardening and doc fixes: F3 (document the cookie behaviour, or keep the token out of a port-agnostic cookie), F4, F5, F7 and F8.

## Follow-up (added by the maintainer)

| Finding | Resolution |
|---|---|
| F1 | History was rewritten a fourth time with the owner's approval (DECISIONS D20). The hostname, kernel and snapshot strings were removed, the old screenshot was redacted, and the author name was set to `vulbsti`. The HEAD tree was unchanged. |
| F2 | RELEASE.md now has a step 0: clear BLOCKED.md before going public. |
| F3 | SECURITY.md now explains that cookies are scoped by host rather than port, and when to use the Bearer token or an SSH tunnel instead. |
| F4 | `/static/index.html` now returns 404, with a test. |
| F5 | `attach` passes `-f <bundled conf>`. AGENTS.md lists the two direct tmux calls. |
| F6 | The pane is re-verified after a request body is read and before every answer keystroke, with a test showing a failed check sends no keys. The api.md wording is updated. |
| F7 | api.md and SECURITY.md now say `--allow-remote` disables the Host check. |
| F8 | VERIFICATION has a commit-id map, a current date, and this report linked. |
| F9 | Covered by F1. |
| F10 | The CLI tests pass `XDG_CONFIG_HOME=/nonexistent`. |
| F11 | DECISIONS D4 and VERIFICATION S2 now describe the incident generically; history was cleaned too (D20). |
