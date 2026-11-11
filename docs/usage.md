# Using tmuxherd

## Requirements
- Linux or macOS
- tmux 3.2 or newer
  - Debian/Ubuntu: `sudo apt install tmux`
  - Fedora: `sudo dnf install tmux`
  - macOS: `brew install tmux`
- Node.js 20 or newer
- git, to install from GitHub and to create worktrees
- The agents you want to run (`claude`, `codex`, `pi`, …), already logged in

Windows is not supported natively. Under WSL2 it behaves like Linux, but that is untested.

## Start
```bash
tmuxherd            # prints a URL with ?token=…; open it
tmuxherd --open     # same, and opens your browser
```

The token in the URL is swapped for a cookie on first visit. Stop the dashboard with Ctrl-C. **Your agents keep running** in tmuxherd's tmux server. Start the dashboard again and it picks them all up, including names, harness and worktree, because those are stored in tmux itself.

```bash
tmuxherd ls          # one line per agent: key, name, harness, state, uptime, cwd
tmuxherd ls --json   # the same, as the API's pane objects (from one fresh poll, so `since` and `lastProgress` are "now")
```

`ls` is a one-shot snapshot, not the watchdog. It shows what the screen says right now (working, waiting, idle or exited). It can't show **stalled**, because a stall needs minutes of history; the dashboard and its alerts have that.

```bash
tmuxherd attach [session]   # attach your terminal to tmuxherd's tmux server (default session "herd"; Ctrl-b d to detach)
                            # --help calls this argument [name]; it is a tmux session name, not an agent name
```

tmuxherd's tmux server always has a `home` window. It is a placeholder that keeps the session alive when no agents are running, and the dashboard and `ls` hide it. With no agents, `tmuxherd attach` lands there. Inside tmux, press `Ctrl-b w` to pick an agent's window, or go straight to one with `tmux -L tmuxherd attach -t herd:<agent-name>`.

## The zoom view
Click a tile to zoom in. While the screen has focus, every key goes to the agent; Esc sends Escape. Press **Esc twice quickly** to release the keyboard, then Esc again (or ×) to close the view. **Load scrollback** fetches the last 500 lines, and **Kill** stops an agent tmuxherd started after a second click to confirm (adopted panes cannot be killed).

## Spawning agents
Click **New agent**:

| field (dialog label) | meaning |
|---|---|
| **Agent** | `claude`, `codex`, `pi`, `shell` (your `$SHELL`, else `/bin/sh`), or `custom` |
| **Command** (custom only) | any command line, run through `/bin/sh -c` |
| **Screen format** (custom only) | which detector reads the screen: `claude`, `codex`, `pi`, or `generic` for anything else |
| **Name** | window name; letters, digits, `.`, `_` and `-` |
| **Directory** | where the agent starts; `~` works |
| **First message** | optional prompt, passed as the agent's prompt argument |
| **Extra arguments** | e.g. `--permission-mode default` for Claude Code, or `-a on-request -s workspace-write` for Codex |
| **Create a git worktree** / **Branch** / **From** | creates `<repo>.worktrees/<branch>` next to your repo on a new branch (from `From`, default `HEAD`), and starts the agent there |

Your own presets go in the config file (see below).

## The states

| state | meaning |
|---|---|
| **working** | a spinner or "esc to interrupt" is on screen and the screen is changing |
| **waiting** | the agent shows a selection prompt: a permission request, folder trust, or any cursor menu |
| **idle** | at its input prompt, with nothing in flight |
| **stalled** | the agent has work in flight but is getting nowhere: **(a)** working or retrying with no meaningful screen change for `stall-minutes`, or **(b)** idle with an API, auth, network or rate-limit error right after it was working |
| **exited** | the process ended. If it was busy, or exited non-zero, that counts as *dead with work pending* |

"Meaningful change" ignores digits, spinner glyphs and spinner words, so `✻ Pondering… (3s)` → `✶ Musing… (4m 10s)` is *not* progress.

For agents tmuxherd doesn't know (the `custom` preset with screen format `generic`), it can still detect prompts. Working versus idle comes from whether the screen changed in the last few seconds.

**What counts as a prompt.** Near the bottom of the screen, tmuxherd looks for a block of two or more options where exactly one line carries a cursor glyph (`❯`, `›`, `>`, `▶`). The block also needs a question line above it (ending in `?`) or a confirmation footer below it (`Enter to confirm`, `Esc to cancel`, `Press enter…`). Options may be numbered (`❯ 1. Yes`) or plain (`❯ Yes`); plain ones need the footer. tmuxherd answers by sending Up or Down until the cursor is on your choice, then Enter. So a custom tool's menu only has to react to arrow keys and Enter. For example:

```
Do you want to proceed?
❯ 1. Yes
  2. No
Enter to confirm · Esc to cancel
```

## Answering prompts
Waiting agents appear in the inbox with the exact question and the context lines the agent shows (the command, the file, the reason). Click an option. tmuxherd checks that the prompt on screen is still the one you saw, moves the cursor to your choice, verifies it, then presses Enter. If the prompt changed in the meantime, nothing is sent and you see "prompt changed".

## Watchdog and notifications
```bash
tmuxherd --stall-minutes 10                 # default 5
tmuxherd --dead-minutes 0                   # alert on dead-with-work-pending immediately (default)
tmuxherd --waiting-minutes 2                # only alert on prompts that waited 2+ minutes (default 0)
tmuxherd --no-notify-waiting                # no alerts for prompts at all
tmuxherd --desktop-notify                   # notify-send on Linux, osascript on macOS
tmuxherd --webhook https://ntfy.sh/my-topic --webhook-format text
tmuxherd --webhook https://hooks.slack.com/services/… --webhook-format slack
tmuxherd --webhook https://example.com/hook  # JSON: {source, kind, name, harness, detail, since, at, title, body, …}
```

- Thresholds can also be changed at runtime from the dashboard's settings panel.
- **Browser notifications** need one click on "Enable notifications". Use **Send test alert** to check every channel. It shows a toast in the dashboard and goes to every configured desktop and webhook channel. It is not added to the Alerts list, which only holds real alerts.
- Each alert fires once per episode and clears when the condition does.

## Config file
`$XDG_CONFIG_HOME/tmuxherd/config.json` (usually `~/.config/tmuxherd/config.json`), or `--config <file>`. Command-line flags override it.

```json
{
  "port": 7420,
  "stallMinutes": 8,
  "deadMinutes": 0,
  "waitingMinutes": 0,
  "notifyWaiting": true,
  "desktopNotify": true,
  "webhook": "https://ntfy.sh/my-agents",
  "webhookFormat": "text",
  "presets": {
    "claude-safe": { "label": "Claude (ask first)", "argv": ["claude", "--permission-mode", "default"], "promptArg": true, "harness": "claude" },
    "aider": { "label": "Aider", "argv": ["aider"], "promptArg": false, "harness": "generic" }
  }
}
```

## Supervising panes you already have (opt-in)
By default tmuxherd only sees agents it started. To watch an agent that is already running in your normal tmux, adopt that one pane explicitly:

```bash
tmux display -p '#{pane_id}'              # run inside that pane → e.g. %7
tmuxherd --adopt default:%7               # socket name (or path) : pane id; repeatable
```

tmuxherd then captures that pane, detects its state, and lets you answer its prompts and type into it. It never kills or resizes an adopted pane, and never lists the other panes on that server.

## Remote access
tmuxherd binds 127.0.0.1. To reach it from another machine:
```bash
ssh -N -L 7420:127.0.0.1:7420 your-workstation   # then open the printed URL on your laptop
```
or put it behind `tailscale serve` and start it with `--allowed-origin https://<machine>.<tailnet>.ts.net`. See [SECURITY.md](../SECURITY.md) before doing anything else.

## Troubleshooting
- **"tmux is not installed" / "needs tmux 3.2"**: install or upgrade tmux.
- **Port in use**: another tmuxherd is running; use `--port 0` for a random port.
- **An agent shows the wrong state**: capture its screen (`tmux -L tmuxherd capture-pane -p -t %N`), redact it, and open an issue with the capture. Detection is screen-based, and TUIs change.
- **Desktop notifications don't appear**: check `notify-send "test"` works (Linux needs `libnotify-bin`), or allow notifications for Script Editor on macOS.
