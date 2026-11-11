> Run 1 (2026-11-05). This run found the tmux 3.3a pane-listing bug and five doc gaps. They were fixed in the next commit, and the fresh-user test was rerun: see [fresh-user.md](fresh-user.md).

**Verdict: FAIL.** On Debian bookworm's tmux 3.3a, which the README says is supported ("tmux ≥ 3.2"), a spawned agent is never listed: `tmuxherd ls`, `/api/state` and the keys API all act as if it does not exist, and nothing reports an error. Every Quickstart step passed only after I upgraded tmux to 3.5a, which the README does not tell you to do. `git` is also a required install that no doc lists.

# Fresh-user verification: install and Quickstart from the README only

- Date: 2026-11-05 (Thu, ~17:00 UTC)
- Source: bare repo at commit `5d0cb71` ("Detect usage-limit waits as a retry-type stall; track SVG render script"), installed as `git+file:///src/tmuxherd.git`. This stands in for `github:vulbsti/tmuxherd`, which is private.
- Image: `node:22-bookworm-slim` (Debian 12.15), running as root
- Versions: node v22.23.4, npm 10.9.9, tmuxherd 0.1.0, tmux 3.3a (Debian bookworm; fails) and then 3.5a (Debian trixie; works), git 2.39.5, Docker 29.8.0 (snap)
- Docs used: `README.md`, `docs/usage.md`, `docs/api.md`. I did not read any source code.

## Harness note (not a doc problem)

I started the container as instructed, with `-v …/fresh/tmuxherd.git:/src/tmuxherd.git:ro`. The mount was empty inside the container: this Docker is the snap build, and the snap cannot see the host's `/tmp`. I removed the container, started it again without `-v`, and streamed the same bare repo into the same path:

```
$ docker run --rm -d --name th-fresh node:22-bookworm-slim sleep 3600
$ tar -C …/fresh -cf - tmuxherd.git | docker exec -i th-fresh bash -c 'mkdir -p /src && tar -C /src -xf - && chmod -R a-w /src/tmuxherd.git'
```

tar kept the host uid (1000) on the files, so git refused the repo ("dubious ownership … safe.directory"). I fixed this with `chown -R root:root /src/tmuxherd.git`. All of this is my setup, not something a real user would hit.

## Transcript

### 0. Read the docs
README Quickstart: "You need tmux ≥ 3.2 and Node ≥ 20", then `npm install -g github:vulbsti/tmuxherd` and `tmuxherd --open`. The README gives no tmux install command. `docs/usage.md` → Requirements gives `sudo apt install tmux`. Neither doc mentions git.

### 1. Starting state
```
$ docker exec th-fresh bash -lc 'node --version; which tmux git curl sudo'
v22.23.4
                      # none of tmux, git, curl or sudo is installed
```

### 2. Install as the README says (before installing anything else)
```
$ npm install -g git+file:///src/tmuxherd.git
npm error code ENOENT
npm error syscall spawn git
npm error enoent An unknown git error occurred
rc=254
```
**Friction 1: git is an undocumented requirement.** I expected the one-line install to work on a machine that has Node ≥ 20, as the Quickstart says. What happened: `npm install -g github:…` runs git, and git is not in slim or minimal images, and not on every fresh server. The error ("An unknown git error occurred") does not say that git is missing. Workaround after recording it: `apt-get install git`.

```
$ apt-get update -qq && apt-get install -y -qq git      # rc=0, git 2.39.5
$ npm install -g git+file:///src/tmuxherd.git
added 1 package in 485ms
$ tmuxherd --version
0.1.0
$ tmuxherd --help        # clear usage text; lists ls, attach, --open, --port, TMUXHERD_TOKEN, …
```

### 3. Run it before tmux is installed (to check the error)
```
$ tmuxherd
tmuxherd: tmux is not installed (Linux: apt/dnf install tmux, macOS: brew install tmux)
rc=1
```
Good: the message is clear and matches usage.md Troubleshooting.

### 4. Install tmux (usage.md: `sudo apt install tmux`; root with no sudo, so `apt-get`)
```
$ apt-get install -y -qq tmux
$ tmux -V
tmux 3.3a
```
3.3a meets the documented "≥ 3.2".

### 5. Start it as the Quickstart says, in the background
```
$ nohup tmuxherd --open > /tmp/th.log 2>&1 &
$ cat /tmp/th.log
tmuxherd 0.1.0 ready
  dashboard: http://127.0.0.1:7420/?token=<redacted>
  tmux:      tmux -L tmuxherd attach    (agents keep running if you stop the dashboard)
```
**Friction 2 (minor): `--open` fails silently when there is no browser.** I expected a line like "could not open a browser; open the URL above". Nothing was printed. The URL is still printed, so this does no harm.

I installed curl for the checks below (`apt-get install curl`). It is not part of the README flow.

### Quickstart step A: the dashboard loads with the token URL
```
$ curl -sS -i -c /tmp/jar "$URL"
HTTP/1.1 303 See Other
location: /
set-cookie: tmuxherd_7420=<token>; HttpOnly; SameSite=Strict; Path=/
$ curl -sS -b /tmp/jar -L http://127.0.0.1:7420/   -> status=200 size=11264 text/html, <title>tmuxherd</title>, contains "New agent"
$ curl -sS http://127.0.0.1:7420/  (no cookie)       -> 401
$ /static/app.js 200 48149 · /static/style.css 200 30789 · /static/favicon.svg 200 379
$ GET /api/state (cookie) -> {version:'0.1.0', panes:0, presets:[claude,codex,pi,shell], session:'herd', socket:'tmuxherd'}
```
**PASS.** This matches docs/api.md (303 to `/`, a cookie named `tmuxherd_<port>`).

### Quickstart step B: spawn a `shell` agent through the API
```
$ mkdir -p /root/demo
$ curl -sS -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    -d '{"preset":"shell","name":"demo","cwd":"/root/demo"}' http://127.0.0.1:7420/api/spawn
HTTP/1.1 201 Created
{"ok":true,"key":"o1","paneId":"%1","name":"demo","cwd":"/root/demo","harness":"generic","worktree":null,"argv":["/bin/sh"]}
log: [5:01:21 PM] spawned demo (/bin/sh) in /root/demo
```
**PASS** as far as the API response goes. (Small note: the docs do not say that the `shell` preset runs `/bin/sh` rather than `$SHELL`.)

### Quickstart step C: `tmuxherd ls` shows it (tmux 3.3a)
```
$ tmuxherd ls
no agents on tmux socket "tmuxherd"
$ tmuxherd ls --json
[]
$ GET /api/state                    -> "panes":[]   (also after waiting 6+ s)
$ GET /api/panes/o1/screen          -> 404 {"ok":false,"error":"unknown pane o1"}
$ tmux -L tmuxherd list-panes -a -F '#{pane_id} #{session_name}:#{window_name} dead=#{pane_dead}'
%0 herd:home dead=0
%1 herd:demo dead=0
$ tmux -L tmuxherd show-options -w -t %1 | grep @
@th_command /bin/sh   @th_created 1793898081820   @th_harness generic   @th_name demo
```
**FAIL (Friction 3, blocking).** I expected `ls` to list `demo`, since the spawn returned 201 with key `o1`. What happened: the pane exists on tmuxherd's tmux server with its metadata, but tmuxherd never adds it to its registry. The spawn response's own key `o1` then returns 404. Nothing in the log or on stderr says anything went wrong.

Things I tried, all from the docs or black-box:
- **Restart the dashboard** (usage.md: "Start the dashboard again and it picks them all up"): Ctrl-C (SIGINT), then `tmuxherd` again. `ls` still printed `no agents`, and `/api/state` still had `panes: []`.
- **Run as a non-root user** (`useradd dev`, `TMUXHERD_TOKEN=… tmuxherd --port 7421`, spawn with `cwd: "~/demo"`): got 201 again, and `ls` still printed `no agents`. So root is not the cause.
- **Upgrade tmux** (stop both instances, `tmux -L tmuxherd kill-server`, add `deb http://deb.debian.org/debian trixie main`, `apt-get install -t trixie tmux`, giving **tmux 3.5a**). Note that this also pulled in trixie's libc, so tmux is the most likely variable but not the only one that changed.

```
$ nohup tmuxherd > /tmp/th3.log 2>&1 &
$ POST /api/spawn {"preset":"shell","name":"demo","cwd":"/root/demo"}  -> 201 {"key":"o1",…}
$ tmuxherd ls
o1     demo               generic idle         0s  /root/demo
```
**PASS on tmux 3.5a.** Conclusion: the documented minimum "tmux ≥ 3.2" is wrong, or 3.3a has a bug that tmuxherd's startup check does not catch. Either the floor needs raising (and the startup version check with it, since usage.md's "needs tmux 3.2" message implies one exists), or the 3.3a path needs fixing. The failure is silent: `ls` says "no agents" when it should give an error, which makes this very hard for a new user to diagnose. Debian 12 is a common server OS and ships 3.3a, so many users will hit this.

### Quickstart step D: type a command via the keys API and see the output (tmux 3.5a)
```
$ curl -sS -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    -d '{"text":"echo hello-from-tmuxherd; uname -s","keys":["Enter"]}' http://127.0.0.1:7420/api/panes/o1/keys
{"ok":true}
$ GET /api/panes/o1/screen   (SGR escapes stripped)
# echo hello-from-tmuxherd; uname -s
hello-from-tmuxherd
Linux
#
$ tmuxherd ls
o1     demo               generic idle         0s  /root/demo
```
**PASS on tmux 3.5a.** On 3.3a this step could not run, because the key returned 404.

### Extra check: the cookie and Origin rules the browser UI depends on
```
POST /api/panes/o1/focus, cookie, no Origin        -> 403 {"ok":false,"error":"missing origin"}
POST /api/panes/o1/focus, cookie, Origin same-host -> 200 {"ok":true}
```
This matches docs/api.md.

Not exercised: `tmuxherd attach` (no TTY in `docker exec` without `-t`), answering a real permission prompt (no AI agents in the container), and worktree spawn.

### Cleanup
```
$ docker rm -f th-fresh
```

## Doc problems found

1. **The tmux minimum is wrong, and the failure is silent (blocking).** README and usage.md say "tmux ≥ 3.2". On Debian 12's tmux 3.3a, spawn returns 201, but the pane never shows up in `tmuxherd ls`, `/api/state` or the keys API (404 on its own key). No error is logged. The same steps work on tmux 3.5a. Fix the floor (and the startup check), or support 3.3. Also make `ls` and the server report that they cannot read the panes, instead of reporting "no agents".
2. **git is an undocumented prerequisite.** `npm install -g github:…` needs git, and node slim images and minimal servers do not have it. npm's error ("An unknown git error occurred", `spawn git ENOENT`) does not name the cause. Add git to the Quickstart and usage.md Requirements (until the npm package exists).
3. **The README Quickstart gives no tmux install command.** It is only in usage.md, under "More". This is minor, but a one-liner such as `sudo apt install tmux git` next to "You need tmux ≥ 3.2" would cover both 1 and 2.
4. **`--open` with no browser available does nothing and says nothing.** This is minor: the URL is printed anyway.
5. **Docs do not say what the `shell` preset runs.** It runs `/bin/sh`, not the user's `$SHELL`. This is minor.
6. **No curl examples for the API.** The Quickstart is UI-only, and a headless user has to put together the Bearer, `Content-Type` and spawn-body rules from api.md by hand. It worked on the first try, but one `curl` spawn example in api.md would help.
