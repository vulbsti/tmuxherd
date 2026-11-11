# HTTP API

The dashboard is a thin client over this API, and scripts and other agents can use it too. All endpoints live on `127.0.0.1:<port>`.

## Authentication

- **Browser:** open the printed `/?token=…` URL once. The server swaps the token for an `HttpOnly; SameSite=Strict` cookie named `tmuxherd_<port>`, then redirects to `/`.
- **Scripts:** send `Authorization: Bearer <token>`. To choose the token yourself, set `TMUXHERD_TOKEN` when starting tmuxherd.

Rules for every request:
- The `Host` header must be `127.0.0.1`, `localhost` or `[::1]` (or a host named by `--allowed-origin`). Anything else gets `421` (protection against DNS rebinding). `--allow-remote` disables this check.
- Cookie-authenticated `POST`/`DELETE` requests need a same-origin `Origin` header, or they get `403`.
- Request bodies must be `application/json` (otherwise `415`) and at most 64 KB.

Errors have the form `{ "ok": false, "error": "message" }`.

## Pane keys

The API never accepts raw tmux targets. Panes are addressed by key:
- `o<N>`: pane `%N` on tmuxherd's own server.
- `a<i>-<N>`: pane `%N` adopted with the i-th `--adopt` flag.

A key outside the current registry gets `404`.

## Pane view object

```json
{
  "key": "o3", "paneId": "%3", "pid": 48211, "own": true, "socket": "tmuxherd",
  "name": "fix-auth", "session": "herd", "harness": "claude",
  "state": "waiting",            // working | waiting | idle | stalled | exited
  "since": 1762343000000,        // when this state began (ms)
  "reason": null,                // stalled/exited explanation
  "pending": true,               // the agent has work in flight
  "lastProgress": 1762343000000, // last meaningful screen change
  "stuckSince": null,
  "prompt": {                    // only when state == "waiting"
    "kind": "permission",        // permission | trust | menu
    "question": "Do you want to proceed?",
    "context": ["Bash command", "curl -sI https://example.com | head -1", "…"],
    "options": [{ "index": 0, "number": 1, "label": "Yes", "selected": true }, …],
    "selected": 0,
    "footer": "Esc to cancel · Tab to amend",
    "fingerprint": "cfde8796"
  },
  "activity": "✻ Infusing… (5s · ↓ 94 tokens)",
  "error": null,
  "cwd": "/home/me/repo", "worktree": null,
  "dead": false, "exitStatus": null,
  "width": 160, "height": 45,
  "created": 1762342900000, "command": "claude --permission-mode default",
  "attach": "tmux -L tmuxherd attach -t %3"
}
```

`pid` is the pane's process id. tmuxherd re-checks it (and, for its own panes, the ownership marker) before every pane request, again after reading a request body, and before every keystroke of an answer. A stale `key` therefore never reaches a different process.

## Endpoints

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/state` | | `{version, panes[], alerts[], recentAlerts[], thresholds, notify, presets, session, socket, attach}` |
| GET | `/api/events` | | Server-Sent Events, described below |
| GET | `/api/panes/:key/screen?history=N` | | `{key, screen}`: the styled capture (ANSI SGR escapes) plus N lines of scrollback |
| POST | `/api/panes/:key/focus` | `{}` | Polls this pane at about 4 Hz for 5 s. Re-send while it is shown zoomed. |
| POST | `/api/panes/:key/keys` | `{text?: string, keys?: string[]}` | `text` is typed literally. `keys` are tmux key names: `Enter`, `Escape`, `Tab`, `BTab`, `BSpace`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`, `DC`, `F1`–`F12`, and `C-x` / `M-x` chords. |
| POST | `/api/panes/:key/answer` | `{fingerprint, option}` or `{fingerprint, action: "cancel"}` | `option` is the 0-based `index` from `prompt.options`, not the displayed `number`. Returns `{ok, sent[], chosen, stillShowing}`, or `409` if the prompt changed. |
| POST | `/api/panes/:key/resize` | `{cols, rows}` | Own panes only. |
| DELETE | `/api/panes/:key` | | Kills the pane. Own panes only; adopted panes get `403`. |
| POST | `/api/spawn` | see below | `201 {ok, key, paneId, name, cwd, harness, worktree, argv}` |
| POST | `/api/config` | `{stallMinutes?, deadMinutes?, waitingMinutes?, notifyWaiting?}` | Changes watchdog thresholds at runtime. |
| POST | `/api/test-alert` | `{}` | Sends a test alert to the browser, the desktop and the webhook. |

### Example (no browser needed)

Uses `curl` and `openssl`.

```bash
TMUXHERD_TOKEN=$(openssl rand -hex 24) tmuxherd --port 7420 &   # or copy the token from the printed URL
H=(-H "Authorization: Bearer $TMUXHERD_TOKEN" -H 'content-type: application/json')
curl -s "${H[@]}" -X POST localhost:7420/api/spawn -d '{"preset":"shell","name":"demo","cwd":"~"}'
curl -s "${H[@]}" -X POST localhost:7420/api/panes/o1/keys -d '{"text":"echo hello","keys":["Enter"]}'
curl -s "${H[@]}" localhost:7420/api/panes/o1/screen | head -c 300
```

The pane key (`o1` here) is in the spawn response as `key`.

### Spawn body

```json
{
  "preset": "claude",          // claude | codex | pi | shell | custom | <config preset>
  "name": "fix-auth",          // optional; [A-Za-z0-9_.-]
  "cwd": "~/code/app",         // directory must exist
  "prompt": "fix the failing auth test", // optional; passed as the agent's first message
  "args": "--permission-mode default",   // optional extra CLI args (quotes supported, no shell)
  "command": "aider --model x",          // preset=custom only; run via /bin/sh -c
  "harness": "generic",                  // preset=custom only: claude|codex|pi|generic
  "session": "herd",                     // optional tmux session
  "worktree": { "branch": "fix-auth", "base": "main" } // optional: new git worktree
}
```

The worktree is created at `<repo>.worktrees/<branch>`, next to the repository, on a new branch. The agent starts inside it.

## Events (`/api/events`)

| event | data |
|---|---|
| `hello` | the same object as `GET /api/state`, sent once on connect |
| `screen` | `{key, screen}`, sent whenever a pane's styled capture changes |
| `pane` | a pane view, sent whenever its state, prompt or metadata changes |
| `removed` | `{key}` |
| `alert` | `{id, key, paneId, kind: "stalled"\|"dead"\|"waiting"\|"test", name, harness, detail, since, at, title, body}` |
| `resolve` | the alert that cleared, plus `resolvedAt` (also sent when a pane with active alerts is removed) |
| `config` | `{thresholds}` after any `POST /api/config` |
