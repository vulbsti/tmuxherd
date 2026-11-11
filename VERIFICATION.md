# Verification

This file maps every criterion, from `OSS_STANDARD.md` (A–G) and the project brief (P1–P7, S1–S3), to its evidence: a command and its output, or a file. It was first checked on 2026-11-05 and last re-checked on 2026-11-06, after audit round 4.

**Commit ids.** History was rewritten four times (DECISIONS D13, D19, D20), so reports written earlier cite ids that no longer exist on `main`. Current equivalents (same tree content, except the redactions):

| Cited as | Now |
|---|---|
| `ae52cce` | `7e033ff` |
| `c09321e` (audit-round-3 fixes, the previous tag) | `c3a4d8e` |
| `83f8920` | `bdb1fc1` |
| `bf429ff`, earlier `f7355d0` (macOS socket-path fix, real e2e run 3) | `614f61d` |
| `b1f9797`, earlier `1b0004f` (audit-round-2 fixes) | `ed9dfac` |
| `3ac53d0` | `52338df` |
| `3c8044d` | `6e4aeec` |

`git log --oneline main` lists them all.

## Project criteria

| # | Criterion | Evidence |
|---|---|---|
| P1 | Works on Linux; macOS supported, with CI on `macos-latest` | The CI matrix in `.github/workflows/ci.yml`: `ubuntu-latest` and `macos-latest` × Node 20 and 24, plus `ubuntu-22.04` (tmux 3.2a, the minimum supported). The green run is linked in the final-gate section. The first CI run caught two macOS-only test problems (window auto-rename names, the `/var`→`/private/var` symlink); they were fixed in the next commit. macOS support is documented in `docs/usage.md` → Requirements. Linux was also verified on tmux 3.3a (Debian 12): `docker run … node:22-bookworm-slim` → `tmux 3.3a`, all tests passed (59 at the time) |
| P2 | State detection for Claude Code and Codex (working, waiting, idle, stalled, exited), tested on captures recorded in our own sandbox | `test/fixtures/captures/`: 15 screens recorded on 2026-11-05 from real Claude Code 2.1.318 and Codex CLI 0.166.0 runs in scratch dirs on an isolated tmux server, then sanitized (`test/fixtures/captures/README.md`). `test/detect.test.js` checks working, waiting (permission and trust), idle, retrying and error against `test/fixtures/expectations.json`, plus negative cases. `test/tracker.test.js` covers stalled (no progress, the recorded retry loop, error after work, usage-limit wait) and exited / dead with work pending. `npm test` → `ℹ pass 91 ℹ fail 0` (63 tests plus 28 fixture-privacy checks; 90 before the round-5 follow-up added the resize re-check test) |
| P3 | Stall watchdog: browser notification plus optional desktop notification or webhook, after N minutes, configurable | `src/watchdog.js` and `src/notify.js`. Flags `--stall-minutes`, `--dead-minutes`, `--waiting-minutes`, `--desktop-notify`, `--webhook`, `--webhook-format`; runtime changes via `POST /api/config`; docs in `docs/usage.md` → Watchdog. Tests: `test/tracker.test.js` (alerts once per episode, after N minutes), `test/notify.test.js` (webhook json/slack/text, notify-send/osascript), `e2e/fake.spec.js` "a stalled agent is flagged and raises an alert toast and a browser notification" (asserts that the page constructs a `Notification` titled with the agent name; headless Chromium can't show real ones). Recorded Codex captures cover stalled (reconnect loop) and dead-with-work-pending in `test/tracker.test.js` |
| P4 | Answer permission prompts from the browser; a Playwright e2e runs real `claude` and `codex` and approves a prompt from the UI | `e2e/real.spec.js`. Transcript in `docs/verification/real-e2e.md` (run 1, and run 2 after the audit fixes): Claude needed 2 prompts (folder trust, then "Do you want to create hello.txt?"), and Codex needed 2 ("Trust this folder?", then "Would you like to run the following command?"). All four were answered by clicking `answer-<key>-<n>` in the dashboard, and both agents created `hello.txt`. Run 1: `2 passed (20.9s)`; run 2 (after the audit fixes): `2 passed (13.8s)`; runs 3–6 on later code, the last on the tagged commit: see `docs/verification/real-e2e.md` and the final-gate section |
| P5 | Spawn an agent pane from the UI, optionally in a new git worktree | `e2e/fake.spec.js`: "spawn from the UI…" and "spawn a shell in a new git worktree from the UI, then type into it from the zoom view" (both pass, in CI too). `test/tmux.integration.test.js` "spawn in a new git worktree" (branch created, reuse refused) |
| P6 | Demo GIF: 3 or more concurrent real agents, one waiting on a prompt answered from the browser, one flagged stalled | `assets/demo.gif` (1.77 MB), recorded by `assets/src/record-demo.mjs` with 4 real agents (Codex `web-tests`, Claude `docs`, Claude `api-fix`, Claude `billing`). The `api-fix` permission prompt is answered from the inbox and `health.js` appears (the script's output lists the sandbox files `[".git","README.md","health.js"]`). `billing` points at a closed port and is flagged **stalled**, with a toast. Timeline: `assets/src/demo-timeline.json`. Conversion: `assets/src/make-gif.sh` |
| P7 | Factual Alternatives section, written after checking each project | README → Alternatives. Research notes, with a source URL for every project checked against its README, docs or site on 2026-11-05: `docs/verification/alternatives-research.md`. It covers 17 projects. Uncertain claims are hedged: Conductor's deal is reported as an "acquisition", and "acquihire" is not verified |
| S1 | Never touch panes or servers the tool didn't create; its own socket by default; attaching is opt-in | `src/tmux.js` (one wrapper; `listPanes`, `newWindow`, `killPane`, `resizeWindow` and `killServer` refuse non-own servers), `src/supervisor.js` `resolve()`, `--adopt`. Adopted panes are pinned to their pid (D15). Own panes are refused if the server lacks tmuxherd's ownership marker (D16). Every pane route re-verifies the pane's pid and marker, so a replaced server is never reached (D18). `tmuxherd attach` checks ownership too. Tests: "foreign panes are invisible unless adopted; adopted panes cannot be killed" (including the pid pinning), "own server never loads the user's ~/.tmux.conf" (with a control run). DECISIONS D4 and D5 |
| S2 | Development and tests on an isolated server; the owner's tmux untouched; `tmux ls` before and after | **Before** (2026-11-05T17:14+05:30): `tmux ls` → `error connecting to /tmp/tmux-1000/default (No such file or directory)`; no server. **After** (2026-11-05T22:34+05:30): `tmux ls` → same error; `/tmp/tmux-1000/` is empty; the saved session snapshot is unchanged. One incident, recorded in DECISIONS D4: the first experiment's private server loaded `~/.tmux.conf` and restored saved sessions into itself. That server was killed within a minute, before any auto-save. Tests use temp-dir socket paths or `TMUX_TMPDIR` |
| S3 | 127.0.0.1 only, a random per-launch token, documented remote opt-in | `src/server.js` and `src/cli.js` (`--host` other than loopback is refused without `--allow-remote`; `--allowed-origin` for proxies). Tests in `test/server.test.js`: token required, token→HttpOnly SameSite=Strict cookie, Host check (421), Origin check (403), JSON only (415), `--allowed-origin` admits exactly one origin, CLI refusals. Docs: `SECURITY.md` → Remote access, `docs/usage.md` → Remote access |

## OSS_STANDARD

### A. Repo and identity
| Item | Evidence |
|---|---|
| Own repo at `~/proj/oss/tmuxherd`; name free on GitHub, PyPI and npm | DECISIONS D1 (npm 404, PyPI 404, GitHub repo search 0 results on 2026-11-05) |
| Private GitHub repo under vulbsti, token passed per command | `gh repo view vulbsti/tmuxherd --json visibility,url` → `{"url":"https://github.com/vulbsti/tmuxherd","visibility":"PRIVATE"}`. Created with `GH_TOKEN=$(gh auth token -u vulbsti) gh repo create … --private`. Pushed over HTTPS with a per-command credential helper (no `gh auth switch`) |
| No <other account>, no <work domain> author | `git log --format='%ae%n%ce' \| sort -u` → `29302849+vulbsti@users.noreply.github.com` (only). `git log --format='%an%n%cn' \| sort -u` → `vulbsti` (only; D20) |
| No `Co-Authored-By` | `git log --format=%B \| grep -ci co-authored` → `0` |
| Commits at verified milestones, pushed | `git log --oneline` (milestones: core+UI+tests, visuals, fixes found by CI and the fresh-user test, demo, release) |
| Not public, not published, nobody contacted | Visibility is PRIVATE (above). No `npm publish` was run. `RELEASE.md` holds the exact go-public and publish commands for the owner |

### B. Sources and privacy
| Item | Evidence |
|---|---|
| Sources read-only | Only `sed`, `cat` and `grep` reads of the vault regions, the owner's private notes and agent projects, and the tmux-cli skill; no code was copied. The owner's existing session-history tool and its timers were never touched |
| No personal data | Four audit rounds each found setup details: in fixtures, a slash-command menu, then plan, status-line and model text, then the same text hidden between ANSI colour codes; and in round 4, the host name and kernel copied into an old fresh-user report and screenshot from a `--network host` container. Each was sanitized, and history was rewritten and force-pushed with the owner's approval (DECISIONS D13, D19, D20). `test/fixtures-privacy.test.js` now checks the ANSI-stripped text of every capture for home paths, real UUIDs, plan names, slash-menu rows and emails (28 checks, all pass). The demo was re-recorded with `--setting-sources project,local`, and the plan name was redacted on the page during recording. Repo grep over `<home>`, `<work domain>`, `<owner name>`, `<scratch dir>` and email addresses → only the noreply author. Old PR refs and pre-rewrite commits were left behind by recreating the repository from a single clean commit; see `BLOCKED.md` |
| gitleaks: 0 findings over the full history | see the final-gate section below |
| No rm | Deletions were moved to `~/proj/TRASH/tmuxherd-*` |

### C. Usable by other people
| Item | Evidence |
|---|---|
| One-command install; OSes stated | README Quickstart: `npm install -g github:vulbsti/tmuxherd` (`npx tmuxherd` once published). Linux and macOS stated in the README and `package.json` `os` |
| Fresh-user test | Six runs, each by a fresh subagent given only the README, in a clean `node:22-bookworm-slim` container (Debian 12, tmux 3.3a). **Run 1** (`docs/verification/fresh-user-run1.md`): FAIL. It found a real bug (tmux 3.3a rewrites control characters, so every pane was silently dropped) and 5 doc gaps, all fixed. **Run 2**: PASS, through the HTTP API only (the audit noted it skipped the UI). **Run 3**: PASS through the browser UI, run on the code before the round-2 audit fixes (its report was replaced by run 4's). It covers New agent, answering a prompt from the inbox, typing in the zoom view, `tmuxherd ls`, `tmuxherd attach`, and agents surviving a dashboard stop. Its minor findings (sudo/-y, the prompt rule missing from usage.md, dialog labels, and the `ls` time column always showing 0s) were fixed afterwards. **Runs 4–6** (`fresh-user-run4.md`, `fresh-user-run5.md`, and `fresh-user.md` for run 6): see the final-gate section below |
| Few meaningful tests, no bloat | 63 behaviour tests plus 28 fixture-privacy checks: detection on real captures, tracker and watchdog with a fake clock, real-tmux integration, the HTTP security boundary, notifier formats. Plus 3 UI e2e tests and 2 real-agent e2e tests |
| CI (lint plus tests) green on the private repo | see the final-gate section below |
| `v0.1.0` tag and `CHANGELOG.md` | see the final-gate section below; `CHANGELOG.md` |

### D. Maintainable
| Item | Evidence |
|---|---|
| LICENSE (Apache-2.0), README, CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY, issue templates (bug, feature), PR template, CODEOWNERS (`@vulbsti`), Dependabot | `ls LICENSE README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md .github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml .github/pull_request_template.md .github/CODEOWNERS .github/dependabot.yml`. Dependabot is live: it opened 3 PRs on the first push, and the bumps were applied on main |
| `docs/architecture.md`, usage guides, ROADMAP with 5+ good first issues | `docs/architecture.md`, `docs/usage.md`, `docs/api.md`, `docs/ROADMAP.md` (9 scoped good first issues) |
| AGENTS.md | `AGENTS.md` (safety rules, commands, how to update detection when a TUI changes) |

### E. Visuals
| Item | Evidence |
|---|---|
| Hero image | `assets/hero-banner.png` (549 KB), made from the photo `assets/src/hero.png`, which was generated with codex `gpt-6-luna` via `assets/src/gen-hero.sh`; prompt in `assets/src/hero-prompt.txt`; variant choice in `assets/src/hero-notes.md`; title composited by `assets/src/compose-banner.py` |
| Architecture diagram (SVG, light and dark) | `assets/architecture-light.svg` and `assets/architecture-dark.svg`, switched by `<picture>` and `prefers-color-scheme` |
| Demo of the real tool | `assets/demo.gif` (see P6) |
| Explainer visual | `assets/states-{light,dark}.svg`: the state machine plus the normalization inset (computed with the real `progressKey()`), with a CSS-animated pulse on the working→stalled edge |
| Sources in `assets/src/`; each image < 2 MB; README media < 10 MB | `du -cb` of the README media → 2,368,157 bytes total. `find assets -maxdepth 1 -size +2M` → none |
| Checked as rendered in a GitHub README, light and dark | `assets/src/render-readme.mjs` renders README.md through GitHub's markdown API (`gh api markdown`, gfm, repo context) with github-markdown-css, then screenshots it with `colorScheme` light and dark. I inspected both. Each SVG was also checked on `#fff` and `#0d1117` (`assets/src/render-svgs.mjs`) |

### F. Honesty
| Item | Evidence |
|---|---|
| Every README claim backed by a test or benchmark | README → "What's tested" maps each claim to a test file. Overhead numbers come from `bench/poll-cost.js` (10 panes: 1.9 % CPU, p50 23 ms; 30 panes: 3.4 %, p50 45 ms). Limits are listed, including the small fixture corpus and that Pi's prompt screens are not yet covered |
| Factual Alternatives | P7 |

### G. How to work
| Item | Evidence |
|---|---|
| Manager plus subagents, verified | Delegated to subagents: alternatives research, the frontend, OSS boilerplate, visuals, five fresh-user runs, the audits. I checked each one myself: e2e runs, screenshots, renders, reviewing SECURITY.md (which led to adding `--allowed-origin`), and reproducing the fresh-user bug on tmux 3.3a |
| Decisions recorded; BLOCKED for owner-only items | `DECISIONS.md` (D1–D21), `BLOCKED.md` |
| Final adversarial audit | see the final-gate section below |

## Final gate

| Item | Evidence |
|---|---|
| CI green on the private repo (lint, unit and integration tests, Playwright e2e, zero-runtime-deps audit) | run 42202050436 (pre-release repository, deleted), commit `f653c8d` (the audit-round-4 fixes, after the fourth rewrite): all five jobs succeeded (`ubuntu-latest` and `macos-latest` × Node 20 and 24, plus `ubuntu-22.04`/tmux 3.2a). Failed runs along the way, each fixed: macOS test portability, the dead-status race, the macOS socket-path length in the foreign-server test, and a lint error. Earlier green runs: 42176943701 on `c09321e` and 42174203082 on `f7355d0`, both before later rewrites |
| `v0.1.0` tag | annotated tag `1ec44a2` → `f653c8d` (the CI-green commit; tagger `vulbsti`): `gh api repos/vulbsti/tmuxherd/git/refs/tags/v0.1.0`. It was moved there with the owner's approval after each history rewrite (DECISIONS D13, D19, D20). Everything up to that commit, including the zoom-view Esc fix, is under `[0.1.0]` in `CHANGELOG.md`; `[Unreleased]` is empty |
| Test stability | On `f653c8d`, `npm test` ran 15× in a row: `failures=0/15`, each run `ℹ tests 90 ℹ pass 90 ℹ fail 0` (62 tests plus 28 fixture-privacy checks). The same loop gave `0/15` on `c09321e` (now `c3a4d8e`) and after the round-2 flake fix (DECISIONS D17) |
| gitleaks: 0 findings over the full history | `docker run --rm -v "$PWD:/r" zricethezav/gitleaks git /r` → `no leaks found` (rerun after each history rewrite; last run on `f653c8d`, 2026-11-06). Authors and committers: only `vulbsti <29302849+vulbsti@users.noreply.github.com>`. `Co-Authored-By` count: 0 |
| Owner's tmux untouched (final) | `tmux ls` → `error connecting to /tmp/tmux-1000/default (No such file or directory)`, the same as before any work; `/tmp/tmux-1000/` holds no leftover sockets |
| Fresh-user test on the final code | **Run 6** (`docs/verification/fresh-user.md`, screenshots `fresh-user-*.jpg`): PASS through the browser UI on `f653c8d`, the final code. It covers New agent (shell and custom), answering a non-default option from the inbox, typing in the zoom view with Esc Esc release, `ls`, `ls --json`, `attach`, agents surviving a dashboard stop, settings, stall and exited alerts, Kill, worktree spawn, the Bearer-token API, and the Host/Origin checks. Its doc gaps (`option` is 0-based, `ls` can't show stalled, where a test alert appears) are fixed in the docs. The cosmetic `ls` items are on the 0.1.1 list in `docs/ROADMAP.md`. **Run 5** (`fresh-user-run5.md`, on `c09321e`) and **run 4** (`fresh-user-run4.md`) also passed; their doc findings were fixed, and run 4's zoom-view Esc bug is fixed in 0.1.0 |
| Real-agent e2e on the final code | `docs/verification/real-e2e.md` run 5 on `f653c8d`: `2 passed (16.8s)`, real Claude Code and Codex permission prompts approved from the browser through the per-keystroke re-check. Earlier runs 1–4 are in the same file |
| Adversarial audit | **Round 1: FAIL**, 2 MAJOR and 9 MINOR findings, all fixed: the fixture leak and history rewrite; the fresh-user test redone through the UI; Notification API e2e; Codex stall/dead tests; XDG isolation; adopted-pane pid pinning; timeline and hero placement; stale docs. **Round 2: FAIL**, 3 MAJOR and 3 MINOR findings, all fixed: a foreign server on our socket name was treated as own (now an ownership marker, D16); flaky crash test from tmux sometimes never recording an exit status (D17); more local-setup details in fixtures (sanitized, history rewritten again with approval); a no-op Codex retry test; VERIFICATION inconsistencies; no reruns on the final code (real e2e run 3, fresh-user run 4). **Round 3: FAIL**, 2 BLOCKER, 1 MAJOR and 4 MINOR findings, all fixed: the replacement attack via stale views (D18, with a test); plan name and status line hidden in `.ansi` fixtures and in the demo GIF (sanitized, privacy test added, demo re-recorded, history rewritten); late exit status 0 now withdraws an unknown-status alert; `attach` ownership check; stale docs. **Round 4** (`docs/verification/audit-round4.md`): **FAIL**, 1 MAJOR, 2 MINOR and 8 NIT findings, all addressed: host name, kernel and author name in older commits (history rewritten a fourth time with approval, D20); RELEASE.md now gates going public on BLOCKED.md; localhost cookie scope documented; the pane is re-verified before every answer keystroke; `/static/index.html` behind auth; `attach` uses the bundled conf; tests isolated from the developer's config; doc accuracy. **Round 5** (`docs/verification/audit-round5.md`): **FAIL**, 1 MAJOR, 2 MINOR and 4 NIT findings, all fixed: the privacy grep terms were written out in docs (now placeholders, history rewritten a fifth time with approval, D21); `resize` and answer-time captures now re-verify the pane; a malformed foreign cookie no longer breaks auth; `/static/` path variants; CONTRIBUTING, BLOCKED and VERIFICATION wording. Round 5 was the last full audit: the owner capped audits there, so no round 6 was run. Its fixes were then confirmed by a narrow re-check of F2–F7 only (probes against a private tmux socket, a new resize re-check test, the remaining CONTRIBUTING wording fixed): see "Round 5 follow-up re-check (narrow)" at the end of `docs/verification/audit-round5.md` |

## CI on the re-created repository (2026-11-12)

The repository was re-created from clean history on 2026-11-12 (BLOCKED.md → Resolved). Earlier run ids refer to the pre-release repository, which was deleted on 2026-11-12. First CI run on the new repository: [run 43094199665](https://github.com/vulbsti/tmuxherd/actions/runs/43094199665) on `e437757` (the published release commit): test on ubuntu-latest (Node 20, 24), ubuntu-22.04 (Node 22), macos-latest (Node 20, 24): 5/5 success. Before the push, every object was checked by the owner's out-of-repo privacy gate (private-terms scan of text, messages and binary strings; author identities; gitleaks): 0 findings.
