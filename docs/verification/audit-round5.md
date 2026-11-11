**Verdict: FAIL**

> Audit round 5 (2026-11-06, on `37a28dc`; the tag was then on `f653c8d`). Owner-identifying terms are replaced with `<placeholders>` in this copy (see DECISIONS D21). Follow-up: see the end of this file.

> Audit round 5 of `vulbsti/tmuxherd`, run on 2026-11-06. It covers `main` = `37a28dc`, tag `v0.1.0` (tag object `1ec44a2`) → `f653c8d`, and all 20 commits reachable from either.
>
> The repo stayed read-only: no edits, commits, pushes or GitHub writes. I ran tmux only through `TMUX_TMPDIR`/`-S` sockets in a private temp dir; that dir was moved to `~/proj/TRASH/` afterwards. `ls -A /tmp/tmux-1000` was empty before and after (`tmux-before.txt`, `tmux-after.txt` in this folder). `pgrep -a tmux` afterwards found no processes.
>
> Identifying strings are described here, not written out.

Almost everything holds up:
- tests and lint;
- CI on Linux and macOS;
- gitleaks;
- authors;
- the commit-id map;
- the GIF;
- fixtures and screenshots;
- the round-1 to round-4 ownership fixes.

The FAIL comes from one hard-rule hygiene violation in the current tree and 13 reachable commits (F1). I also found a demonstrated gap in the round-4 "re-verify after reading a body" fix (F2), a cookie-parsing availability bug (F3), and several NITs.

## Findings

| ID | Severity | Area | Evidence (exact command + output, or file:line) | Why it matters |
|---|---|---|---|---|
| F1 | **MAJOR** | Repo hygiene: owner's real name, a second account name, a work email domain and a real home path in HEAD and history | `git grep -niE "<owner first name>\|<work domain>\|/home/<user>" HEAD` → 5 hits: `VERIFICATION.md:41` (the row title names the owner's *second* GitHub account handle, which contains the owner's real first name, plus the work email domain), `VERIFICATION.md:50` (the grep list spells out the real home path, the work domain and the owner's first name), and `docs/verification/audit-round4.md:21,71,79` (the same handle, name, domain and home path). Looping `git grep -qiE "<owner first name>"` over `git rev-list main` → **13 of 20 commits on `main`** (every commit since `dc1f5ad` added VERIFICATION.md). | The hard rule says no personal data in the repo or ANY reachable commit, explicitly including "account … names", "real home paths" and "the owner's real name". DECISIONS D20 rewrote every commit's author name to `vulbsti` precisely because "OSS_STANDARD's grep list includes the owner's name", yet the grep patterns themselves are committed verbatim. The round-4 report copy redacted the name in F9 (`<owner first name>`) but left it in lines 71 and 79. Going public publishes the owner's first name, their other account and their employer domain. gitleaks can't see this. Fixing it needs another history rewrite, which needs owner approval. |
| F2 | MINOR | Hard safety rule / docs vs. behavior: re-verification after reading a body | `docs/api.md:56` says the pid/marker is re-checked "before every pane request, **again after reading a request body**, and before every keystroke of an answer". In `src/server.js:306-310` the `resize` route calls `verify()` once (`:269`), then `await readJson(req)`, then `server.resizeWindow(...)` with no re-check. In the `answer` route (`:300-301` → `src/answer.js:37`), the first thing after the body is read is `capture-pane`; the check only runs before the first key. **Reproduced** with `probe/probe.mjs` (isolated `TMUX_TMPDIR`): I spawned `o1`/`%1`, sent `POST /api/panes/o1/resize` with only 3 body bytes, then killed tmuxherd's server and started a stranger's server on the same socket (`-f /dev/null`, no marker, panes `%0`,`%1` at 120x40). Then I sent the rest of the body `{"cols":37,"rows":11}`. Output: `resize response: HTTP/1.1 200 OK … {"ok":true}`. `stranger panes after:  %0 120x40 marker= \| %1 37x11 marker=`. The poll then logged "not started by tmuxherd … refusing" only *after* the stranger's window had been resized. | This is the replacement case D18 exists for, and the round-4 F6 follow-up claims "re-verified after a request body is read". tmuxherd modified a window on a tmux server it did not create (and the answer route captures such a pane once). It is rated MINOR because it needs the server to be replaced during an in-flight request body, the effect is a non-destructive resize, and no keys are sent (the answer route's `press()` check still blocks keystrokes). Fix: call `supervisor.verify(key)` after `readJson` in `resize`, and call `check()` before the first `look()` in `answerPrompt`. |
| F3 | MINOR | Availability: cookie parsing | `src/server.js:32` calls `decodeURIComponent` on every cookie value with no try/catch. Probe: request with `Cookie: other_app=100%; tmuxherd_<port>=<valid token>` → `/api/state 500 {"ok":false,"error":"URI malformed"}`, and `GET /` → `500`; the server logs a `URIError` stack. | Browser cookies are shared across all localhost ports (SECURITY.md says so). Any other local dev server that sets a cookie with a raw `%` makes the dashboard return 500 on every cookie-authenticated request until that cookie is cleared. Bearer auth is unaffected, because it is checked first. |
| F4 | NIT | Auth consistency: round-4 F4 fix incomplete | Probe: `GET /static/index.html` → `404`, but `GET /static//index.html` → `200 (dashboard HTML)` and `GET /static/.//index.html` → `200`, with no token. `server.js:204` compares `rel === 'index.html'` before `path.join` normalizes it. `test/server.test.js:140` tests only the one spelling. | No secret is exposed (the API still needs the token). But the follow-up says "/static/index.html now returns 404", and the page is still served unauthenticated. |
| F5 | NIT | Docs vs. code (round-4 F5 only half fixed) | `CONTRIBUTING.md:26`: "All tmux calls go through the wrapper in `src/`, which always passes `-L` and `-f`; do not call `tmux` directly", and "Tests … must use their own `-L <socket>`". But `src/cli.js:146` (`tmux -V`) and `:214-215` (`attach`) call tmux directly, the wrapper passes `-S` for socket paths and no `-f` for foreign servers, and the tests use `-S` paths (`test/tmux.integration.test.js:21-25`). AGENTS.md rule 3 was corrected; CONTRIBUTING.md was not. | Contributors get an inaccurate rule. Harmless today. |
| F6 | NIT | BLOCKED.md incomplete about pre-rewrite objects | BLOCKED.md mentions only the D13/D19 fixture commits behind `refs/pull/{1,2,3}/head`. But `gh api repos/vulbsti/tmuxherd/commits/3c8044d` still resolves on GitHub (a pre-D20 commit; locally `git grep -c -E 'root@<host>…' 3c8044d` → `docs/verification/fresh-user.md:2`, i.e. the real hostname). CI runs `42178504252` and `42176943701` reference the pre-D20 `ae52cce` and `c09321e`. Locally, `refs/heads/backup/pre-rewrite4` and `refs/original/refs/heads/main` keep pre-rewrite history, and `git branch -a --contains 3c8044d` → `backup/pre-rewrite4`. | Not reachable from `main` or the tag, and BLOCKED's "recreate the repository" remedy covers it. But the reason given to the owner understates what is still on GitHub (hostname and kernel too, not just fixtures), and a careless `git push --all` from this clone would republish the hostname commits. |
| F7 | NIT | VERIFICATION accuracy | The G row says "`DECISIONS.md` (D1–D19)", but D20 exists (`DECISIONS.md:103`). The P4 row still ends "run 3 (final code): see …", but runs 4 and 5 are later. | Stale wording in the evidence map. The commit-id map itself checks out (see below). |

## Commands I ran (key outputs)

- `docker run --rm -v "$PWD:/r" zricethezav/gitleaks git /r` → `58 commits scanned … no leaks found`, exit 0. This covers all local refs, including the backup refs, a superset of `main` plus the tag.
- `env -u TMUX npm test` → `ℹ tests 90 ℹ pass 90 ℹ fail 0 ℹ skipped 0`. Then 5 more runs → `failures=0/5`.
- `npm run lint` → clean (no output after `eslint .`).
- `env -u TMUX npx playwright test --project=fake` → `3 passed (7.5s)` (fake.spec.js:22, :48, :72).
- `git log main v0.1.0 --format='%an <%ae>%n%cn <%ce>' | sort | uniq -c` → `40 vulbsti <29302849+vulbsti@users.noreply.github.com>` only. Tagger: the same. `git log main v0.1.0 --format=%B | grep -ci co-authored` → `0`.
- `gh api repos/vulbsti/tmuxherd` → `{"private":true,"visibility":"private"}`. Remote refs: `refs/heads/main 37a28dc`, `refs/tags/v0.1.0 1ec44a2 (tag)` → `f653c8d`, and `refs/pull/1..3/head` (documented in BLOCKED). `npm view tmuxherd` → E404 (not published).
- `gh run view 42202050436` → headSha `f653c8d`, `success`, 5 jobs green. The logs show: macOS `tmux 3.8` with `pass 90 / fail 0 / skipped 0` and e2e `3 passed`; ubuntu-22.04 `tmux 3.2a` with `# pass 90`; ubuntu-latest `tmux 3.4`. The CI run on `37a28dc` (`42202884440`) also finished `success`.
- Commit-id map: `git diff --stat <old> <new>` for every pair in VERIFICATION's table (`ae52cce→7e033ff`, `c09321e→c3a4d8e`, `83f8920→bdb1fc1`, `bf429ff/f7355d0→614f61d`, `b1f9797/1b0004f→ed9dfac`, `3ac53d0→52338df`, `3c8044d→6e4aeec`) shows only redaction-sized diffs (1–2 lines in DECISIONS/VERIFICATION, fresh-user.md 6 lines plus the zoom JPEG, fixture lines). Every mapped "now" id is on `main`. Tag and CI evidence refer to `f653c8d`, which exists and is the tagged commit.
- Personal-data blob scan: 225 distinct blobs across the 20 reachable commits.
  - Kernel string (`uname -r`) → 0 blobs.
  - Hostname in a host context (`root@<h>`, `"<h>" …`, `@<h>:~`) → 0. The hostname equals the public GitHub handle; the only bare hits are the handle in URLs and emails.
  - Plan names (the plan-name patterns) → 0. The `Claude Pro` substring matched only `claude prompts …`.
  - Tokens (`sk-`, `ghp_`, `ANTHROPIC_API_KEY=`) → 0.
  - The owner's first name, work domain and home path → F1.
- Fixtures: all 32 distinct fixture blobs ever reachable were ANSI/OSC-stripped and read in full. They contain sandbox paths `/tmp/sandbox/…`, zeroed UUIDs, `Opus 5.5 · Claude API`, `model-x`, and `example-skill-*`. Clean.
- Images: I viewed all 18 distinct JPEG blobs ever reachable plus `hero.png` and `hero-banner.png`, with 3–4× crops of the terminal thumbnails in the answered/stalled shots. The old zoom shot's `uname -sr` line is painted over, and the thumbnails show only `You chose: …` / `CHOSEN: …`. Metadata is only JFIF or `Lavc60.31.102` comments.
- GIF: PIL extracted all 101 frames (840×525, 250 ms each, 25.25 s). I viewed contact sheets of every frame, plus 3–4× crops:
  - frame 0: 4 agents, web-tests (codex), docs, api-fix and billing (claude); 2 waiting;
  - frame ~42: "Answered api-fix · Yes" toast; api-fix moves to working;
  - frame 80: "I created health.js with a health() function…";
  - frames 80–100: billing "stalled", "Agent stalled: billing" toast;
  - zoomed banner: `Opus 5.5 · Claude ···` (redacted). The Codex banner shows only the version and `/tmp/tmuxherd-demo/web-tests`.
- Security probe (`probe/probe.mjs`, isolated socket, `TMUXHERD_TOKEN` fixed):
  - `/` and `/index.html` without a token → 401;
  - `/static//index.html` → 200 (F4);
  - malformed cookie → 500 (F3);
  - resize after server replacement → stranger's window resized (F2).
  Host/Origin/cookie checks (`server.js:90-115`) were re-read: the Host is parsed per loopback name, Origin must equal `http://<Host>` or an allowed origin, and Bearer is required when there is no Origin. I found no bypass beyond the documented `--allow-remote` behavior and cookie port scope.
- Alternatives spot check (README fetched by a web-fetch subagent):
  - ccmanager: no tmux, PTY-based, busy/waiting/idle, worktrees ✔;
  - Claude Squad: TUI, tmux, worktrees, diff tab, `--autoyes` ✔ (the README is silent on a web UI);
  - agent-deck: TUI over tmux, web UI on `127.0.0.1:8420`, Telegram/Slack, worktrees ✔;
  - Claude Control: macOS Electron, approve from the dashboard, notifications, macOS-only ✔.

## Checklist: OSS_STANDARD

| Item | Result | Evidence I checked myself |
|---|---|---|
| A. Own repo at `~/proj/oss/tmuxherd`; distinct name; recorded in DECISIONS | PASS | DECISIONS D1; `npm view tmuxherd` → E404; GitHub repo exists only as `vulbsti/tmuxherd` |
| A. Private repo under vulbsti | PASS | `gh api repos/vulbsti/tmuxherd` → private |
| A. No <other account> / work-domain author | PASS | All 40 author/committer entries are the noreply address (the names themselves leak via file text: F1) |
| A. No Co-Authored-By | PASS | count 0 across `main` and the tag |
| A. Milestone commits, pushed | PASS | 20 commits; `origin/main` = `main` = `37a28dc` |
| A. Not public, nothing published; go-public commands in RELEASE.md | PASS | Private; npm E404; RELEASE.md §0 gates on BLOCKED.md, §1–3 hold the commands |
| B. Sources read-only; the owner's existing session-history tool untouched | PASS (not independently verifiable) | Nothing in the repo references that tool |
| B. No personal data in the repo or any commit | **FAIL** | F1 (owner first name, second account handle, work domain and home path in HEAD and 13 `main` commits). Hostname, kernel and plan name are clean in reachable history. |
| B. Fixtures synthetic or generated for the repo | PASS | All 32 historical fixture blobs read after stripping escapes |
| B. gitleaks 0 findings | PASS | `no leaks found` (58 commits) |
| B. grep for <home>, <work domain>, <owner name>, emails | **FAIL** | Hits in VERIFICATION.md and audit-round4.md (F1) |
| C. One-command install; OSes stated | PASS | README `npm install -g github:vulbsti/tmuxherd`; `package.json` `os: [linux, darwin]` |
| C. Fresh-user test transcript, passing | PASS | `docs/verification/fresh-user.md` run 6, "Verdict: PASS", on `f653c8d` in `node:22-bookworm-slim`; screenshots viewed and match the text |
| C. Few meaningful tests; CI (lint + tests) green | PASS | 90/90 locally plus 5/5 reruns; lint clean; e2e 3/3; CI 42202050436 all 5 jobs green |
| C. `v0.1.0` tag and CHANGELOG | PASS | Annotated `1ec44a2` → `f653c8d` (CI green); CHANGELOG `[0.1.0]` |
| D. LICENSE Apache-2.0, README, CONTRIBUTING (dev, tests, release), CoC, SECURITY, issue templates, PR template, CODEOWNERS @vulbsti, Dependabot | PASS | All present (`ls`). LICENSE is Apache 2.0; CoC is Contributor Covenant; CODEOWNERS is `* @vulbsti`; dependabot covers npm and actions; CONTRIBUTING has Setup, Commands and Releases (one stale rule: F5) |
| D. architecture.md, usage guides, ROADMAP with 5+ good first issues | PASS | `docs/architecture.md`, `usage.md`, `api.md`; ROADMAP lists 9 numbered good first issues |
| D. AGENTS.md | PASS | Present; rule 3 now lists the two direct tmux calls |
| E. Hero image | PASS | `assets/hero-banner.png` (549 KB), viewed |
| E. Architecture SVG, light and dark | PASS (by inspection of the files and `<picture>` markup; round 4 rendered them) | `assets/architecture-{light,dark}.svg` wired via `prefers-color-scheme` in README |
| E. Demo of the real tool | PASS | `assets/demo.gif`, 101 frames, viewed |
| E. Explainer visual | PASS | `assets/states-{light,dark}.svg` |
| E. Sources in assets/src; each image < 2 MB; README media < 10 MB | PASS | The largest file is demo.gif at 1,786,389 B; assets/src holds the scripts and prompts |
| E. Checked as rendered, light and dark | PASS (script present; not re-rendered by me) | `assets/src/render-readme.mjs`, `render-svgs.mjs` |
| F. Every README claim backed by a test or benchmark | PASS with F2 | The "What's tested" table maps to existing tests that pass. "never sees … panes on other tmux servers" is slightly overstated (F2). |
| F. Factual Alternatives | PASS | Spot-checked 4 projects (above); research notes cite sources |
| G. Decisions recorded; BLOCKED for owner items | PASS with F6 | DECISIONS D1–D20; BLOCKED.md |
| G. VERIFICATION maps every criterion to evidence | PASS with F7 | Present; commit-id map verified; minor stale wording |
| G. Final adversarial audit passes | **FAIL** | This audit (F1 MAJOR) |
| G. No grep/find from `/` | n/a | |

## Checklist: project criteria and hard rules

| Item | Result | Evidence I checked myself |
|---|---|---|
| P1. Linux and macOS, CI covering both | PASS | CI 42202050436: macos-latest Node 20 and 24 (tmux 3.8) with 90 pass, 0 skipped, e2e 3 passed; ubuntu-latest (tmux 3.4) and ubuntu-22.04 (tmux 3.2a) also green |
| P2. State detection for Claude Code and Codex on sandbox-recorded captures | PASS | 15 recorded screens in `expectations.json` (Claude trust, 2 permission, working ×2, idle, retrying, api-error, exited; Codex trust, approval, working, idle, reconnecting). `tracker.test.js` covers stalled and exited/dead for both harnesses. All pass. |
| P3. Stall watchdog: browser, desktop, webhook alerts after a configurable N minutes | PASS | `--stall-minutes`, `/api/config`, and `notify.js` (notify-send/osascript, json/slack/text webhooks) are tested in `notify.test.js` and `tracker.test.js`. The e2e "a stalled agent is flagged … browser notification" passes locally. |
| P4. Playwright e2e with REAL claude and codex approving a prompt from the UI | PASS (judged from the transcript, as instructed) | `e2e/real.spec.js` clicks `answer-<key>-<idx>` in the page. `docs/verification/real-e2e.md` run 5 on `f653c8d`: `2 passed (16.8s)`, with a permission prompt answered for each agent. Test line numbers 75 and 91 match the file. Not re-run. |
| P5. Spawn agents from the UI, worktree option | PASS | `e2e/fake.spec.js:22` and `:72` pass locally and in CI; integration test "spawn in a new git worktree" passes |
| P6. Demo GIF: 3+ real agents, one prompt answered from the browser, one flagged stalled | PASS | Frames viewed: 4 agents; "Answered api-fix · Yes" then health.js created; billing "stalled" with a toast |
| P7. Factual Alternatives section | PASS | See the spot check above |
| S1. Never touch tmux servers or panes not created; own socket by default; attach is explicit opt-in | PASS with F2 | `--socket default` is refused (exit 2); the ownership marker is required on list, spawn and verify; `attach` checks `ownership()` and passes `-f`; adopt is the only route to other servers, and adopted panes are pid-pinned and never killed or resized. Tests for the foreign server and the replacement attack pass. Residual gap: the resize/answer body-read window (F2), demonstrated. |
| S2. Development and tests on an isolated tmux server | PASS | Tests use `-S` temp paths or `TMUX_TMPDIR` (`e2e/harness.js:17`, `test/tmux.integration.test.js:21-25`). `/tmp/tmux-1000` was empty before and after 7 test-suite runs, the e2e run and the probe. |
| S3. 127.0.0.1 only, random per-launch token, documented safe remote opt-in | PASS | Default host `127.0.0.1`; non-loopback is refused without `--allow-remote`; the token is `randomBytes(32)`; Host/Origin checks re-read and probed; SECURITY.md documents the SSH tunnel, `tailscale serve`, `--allowed-origin` and cookie port scope |
| H1. No personal data in the repo or any reachable commit (including binaries and stripped `.ansi`) | **FAIL** | F1. GIF, JPEGs, PNGs and fixtures are clean. |
| H2. gitleaks 0 | PASS | `no leaks found` |
| H3. No Co-Authored-By; only `vulbsti <29302849+vulbsti@users.noreply.github.com>` | PASS | Verified for authors, committers and the tagger |
| H4. Repo private; go-public in RELEASE.md; blockers in BLOCKED.md | PASS with F6 | Private; both files exist; RELEASE §0 points to BLOCKED |

## To reach PASS

1. Remove the owner's first name, the second account handle, the work domain and the real home path from `VERIFICATION.md` (lines 41 and 50) and `docs/verification/audit-round4.md` (lines 21, 71 and 79). Describe them generically, for example "the owner's other account", "the work email domain", "the home path". Rewrite history so none of the 13 affected `main` commits keep them, then force-push and move the tag (owner approval needed).
2. Recommended alongside it: re-verify after `readJson` in the resize route and before the first capture in `answerPrompt` (F2), make `parseCookies` tolerate malformed values (F3), normalize the static path before the index check (F4), fix CONTRIBUTING.md (F5), extend BLOCKED.md and delete the local backup refs once you no longer need them (F6), and fix the VERIFICATION wording (F7).

## Follow-up (added by the maintainer)

| Finding | Resolution |
|---|---|
| F1 | The check terms are now written as placeholders (`<home>`, `<work domain>`, `<other account>`, `<owner name>`, `<scratch dir>`), which stand for the list in OSS_STANDARD section B. History was rewritten a fifth time, with the owner's approval, so that no reachable commit spells them out (DECISIONS D21). |
| F2 | `resize` re-verifies after reading its body. `answerPrompt` runs the check before every capture as well as every keystroke, and the test asserts that a failed check causes no capture and no key. |
| F3 | The cookie parser keeps a malformed value as-is instead of throwing; the test sends `other=50%` alongside the real cookie. |
| F4 | `/static/` paths are normalized before the `index.html` check; the test covers `//`, `/./` and `x/../`. |
| F5 | CONTRIBUTING.md now matches AGENTS.md. |
| F6 | BLOCKED.md now says that pre-rewrite commits still resolve by SHA on GitHub until the repository is recreated. (Corrected by the re-check below: the local backup refs were not deleted.) |
| F7 | VERIFICATION wording fixed (D1–D21; the P4 row lists every run). |

## Round 5 follow-up re-check (narrow)

Run on 2026-11-12, on `a6d39d8`. The owner capped audits at round 5, so this is not a new audit: it only confirms the round-5 fixes for F2–F7 and closes gaps in them. F1 (the privacy terms) is covered by the history rewrite in D21 and by recreating the repository (BLOCKED.md). tmux ran only on socket paths in private temp dirs (`-S`, `TMUX_TMPDIR`); `/tmp/tmux-1000` was empty before and after, and `pgrep tmux` found nothing afterwards.

| Finding | Status | How it was verified |
|---|---|---|
| F2 | Fixed; test gap closed | A probe ran the real server, supervisor and tmux on a private socket. It sent 3 bytes of a `resize` body (and, separately, an `answer` body), waited for the route's first check, replaced tmuxherd's server with a stranger's (`-f /dev/null`, no marker, panes `%0`,`%1` at 120x40), then sent the rest. On `a6d39d8`: `resize` → `409 pane is gone or is no longer the one tmuxherd started`, `answer` → the same 409, which is raised by the check before the first capture; the stranger's panes stayed `120x40`. Control run of the same probe on the pre-fix source: `resize` → `200 {"ok":true}` and the stranger's `%1` became `37x11`; `answer` read the stranger's pane (`no prompt is showing any more`). The answer side already had a test; the resize side had none, so `test/server.test.js` gained "resize re-verifies the pane after reading its body" (fails with the re-check removed, passes with it). |
| F3 | Fixed | Probe: `Cookie: other_app=100%; tmuxherd_<port>=<token>` → `GET /api/state` 200 and `GET /` 200, with no error logged (pre-fix control: 500 and 500). Covered by the existing `other=50%` assertion in `test/server.test.js`. |
| F4 | Fixed | Probe without a token: `/static/index.html`, `/static//index.html`, `/static///index.html`, `/static/.//index.html`, `/static/./index.html`, `/static/%2e/index.html`, `/static/x/../index.html` → all 404; `/static/app.js` → 200 (pre-fix control: the `//`, `///` and `.//` spellings returned 200). |
| F5 | Fixed now | `a6d39d8` fixed only the middle sentence. CONTRIBUTING.md still said tests use their own `-L <socket>` and that the wrapper "always passes `-L` and `-f`". It now says tests use `-S` socket paths or `TMUX_TMPDIR`, and that `src/tmux.js` always names the socket (`-L` or `-S`) and passes the bundled `-f` conf for servers tmuxherd owns (`src/tmux.js:110-113`), matching AGENTS.md. |
| F6 | Superseded | The PR-ref and pre-rewrite-SHA problem is resolved by recreating the repository from a single clean commit (BLOCKED.md, RELEASE.md step 0). Correction: the follow-up above said the local backup refs were deleted; they were not (`backup/pre-rewrite4`, `backup/pre-rewrite5` and `refs/original/refs/heads/main` still exist in the working clone). They are local only and are not part of the recreated repository. This re-check left them alone. |
| F7 | Fixed | VERIFICATION's G row reads D1–D21 (D21 exists in DECISIONS.md); the P4 row lists runs 1–6. The final-gate audit row no longer points to a round 6; it cites this section. Test counts updated to 91 (63 tests plus 28 fixture-privacy checks). |

Also in this pass: private project names in VERIFICATION.md and the round-4 and round-5 reports were replaced with generic wording (private-terms scan, list kept outside the repo: 0 hits).

Results on the re-check commit: `env -u TMUX npm test` → `ℹ tests 91 ℹ pass 91 ℹ fail 0`; `npm run lint` → clean; `env -u TMUX npx playwright test --project=fake` → `3 passed`.
