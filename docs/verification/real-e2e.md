# Real-agent e2e run

Command: `TMUXHERD_REAL_AGENTS=1 npx playwright test --project=real` (`e2e/real.spec.js`), run on Linux with Claude Code 2.1.318 and Codex CLI 0.166.0, both logged in.

Each test spawns the agent from the dashboard's New-agent dialog in a sandbox git repo, on an isolated tmux socket (`TMUX_TMPDIR` set to a temp dir). It answers every prompt by clicking the inbox button and checks that the agent then created `hello.txt`.

```
2026-11-05T17:50:17+05:30

Running 2 tests using 1 worker

claude prompts answered from UI: [{"kind":"trust","question":"Quick safety check: Is this a project you created or one you trust?","chose":"Yes, I trust this folder"},{"kind":"permission","question":"Do you want to create hello.txt?","chose":"Yes"}]
  ✓  1 [real] › e2e/real.spec.js:75:1 › Claude Code: approve a real file-write permission prompt from the browser (10.3s)
codex prompts answered from UI: [{"kind":"trust","question":"Trust this folder?","chose":"Trust and continue"},{"kind":"permission","question":"Would you like to run the following command?","chose":"Yes, proceed (y)"}]
  ✓  2 [real] › e2e/real.spec.js:91:1 › Codex CLI: approve a real command-approval prompt from the browser (9.9s)

  2 passed (20.9s)
```

## Run 2: after the tmux 3.3a, dead-status and adopted-pane fixes

Same command, on the code after audit round 1 (the commit hashes in this log predate the history rewrite, DECISIONS D13). The sandbox folders were already trusted from run 1, so only the permission prompts appeared.

```
2026-11-05T22:49:32+05:30
275c277

Running 2 tests using 1 worker

claude prompts answered from UI: [{"kind":"permission","question":"Do you want to create hello.txt?","chose":"Yes"}]
  ✓  1 [real] › e2e/real.spec.js:75:1 › Claude Code: approve a real file-write permission prompt from the browser (6.0s)
codex prompts answered from UI: [{"kind":"permission","question":"Would you like to run the following command?","chose":"Yes, proceed (y)"}]
  ✓  2 [real] › e2e/real.spec.js:91:1 › Codex CLI: approve a real command-approval prompt from the browser (7.1s)

  2 passed (13.8s)
exit=0
```

## Run 3: final code (`1b0004f`, after audit round 2)

```
2026-11-06T11:52:28+05:30
1b0004f

Running 2 tests using 1 worker

claude prompts answered from UI: [{"kind":"permission","question":"Do you want to create hello.txt?","chose":"Yes"}]
  ✓  1 [real] › e2e/real.spec.js:75:1 › Claude Code: approve a real file-write permission prompt from the browser (7.0s)
codex prompts answered from UI: [{"kind":"permission","question":"Would you like to run the following command?","chose":"Yes, proceed (y)"}]
  ✓  2 [real] › e2e/real.spec.js:91:1 › Codex CLI: approve a real command-approval prompt from the browser (8.1s)

  2 passed (15.6s)
exit=0
```

## Run 4: final code after audit round 3 (`c09321e`: every pane route re-verifies the pane)

```
2026-11-06T12:20:21+05:30
c09321e

Running 2 tests using 1 worker

claude prompts answered from UI: [{"kind":"permission","question":"Do you want to create hello.txt?","chose":"Yes"}]
  ✓  1 [real] › e2e/real.spec.js:75:1 › Claude Code: approve a real file-write permission prompt from the browser (9.4s)
codex prompts answered from UI: [{"kind":"permission","question":"Would you like to run the following command?","chose":"Yes, proceed (y)"}]
  ✓  2 [real] › e2e/real.spec.js:91:1 › Codex CLI: approve a real command-approval prompt from the browser (7.9s)

  2 passed (17.8s)
exit=0
```

## Run 5: final code after audit round 4 (`f653c8d`: the pane is re-verified before every answer keystroke)

Run 4's `c09321e` is `c3a4d8e` after the fourth history rewrite (see the commit-id map in VERIFICATION.md).

```
2026-11-06T12:53:05+05:30
f653c8d

Running 2 tests using 1 worker

claude prompts answered from UI: [{"kind":"permission","question":"Do you want to create hello.txt?","chose":"Yes"}]
  ✓  1 [real] › e2e/real.spec.js:75:1 › Claude Code: approve a real file-write permission prompt from the browser (8.4s)
codex prompts answered from UI: [{"kind":"permission","question":"Would you like to run the following command?","chose":"Yes, proceed (y)"}]
  ✓  2 [real] › e2e/real.spec.js:91:1 › Codex CLI: approve a real command-approval prompt from the browser (7.9s)

  2 passed (16.8s)
exit=0
```
