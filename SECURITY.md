# Security Policy

tmuxherd lets a browser type into your terminals. That is its job, and it is also the threat. This document says what it defends against, what it does not, and how to report problems.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab, then **Report a vulnerability**. Do not open a public issue for a vulnerability.

We aim to acknowledge a report within 7 days.

## Threat model

### What the token grants

Anyone holding the token can type into your agents and make them run commands. That is equivalent to a shell as your user. Treat the token like an SSH key or a shell session: do not paste it into chats, issues, screenshots or logs.

### Binding and access control

- tmuxherd binds `127.0.0.1` only by default.
- It generates a random 256-bit token on each launch and prints it in the URL.
- The first visit exchanges the token for an `HttpOnly; SameSite=Strict` cookie named `tmuxherd_<port>` and redirects, so the token leaves the address bar (and browser history, referrers and screen shares).
- A `Host` header check blocks DNS rebinding: only `127.0.0.1`, `localhost` and `[::1]` are accepted (plus any `--allowed-origin` host). `--allow-remote` turns this check off, because a remote bind is reached by other names.
- Browser cookies are scoped by host, **not by port**. Any other web server on `127.0.0.1` or `localhost` (a dev server, another user's process on a shared machine) receives the `tmuxherd_<port>` cookie whenever your browser visits it, and the cookie grants full control of your agents. On a single-user machine running servers you trust, this is fine. On a shared host, don't use the browser cookie: script against the API with `Authorization: Bearer <token>`, or browse through an SSH tunnel from your own machine. The token is new each launch, so restarting tmuxherd revokes a leaked cookie.
- State-changing requests need a same-origin `Origin` header, or else Bearer auth. A malicious web page in another tab cannot forge them.
- Request bodies must be JSON and are capped at 64 KB.
- A strict Content-Security-Policy with no inline scripts, and `X-Frame-Options: DENY`, limit script injection and clickjacking.

### tmux isolation

- tmuxherd controls only its own tmux server: `tmux -L tmuxherd -f <bundled conf>`. It never loads your `~/.tmux.conf`, so your plugins (for example session auto-restore or auto-save) cannot interact with it.
- Panes on other tmux servers are touched only if you explicitly adopt them with `--adopt <socket>:<%pane>`. Adopted panes are never killed or resized.
- Every pane operation is checked against a registry of known panes. The API never accepts raw tmux targets.

### Answering prompts

When you answer a permission prompt from the browser, tmuxherd moves the cursor, verifies the screen, then confirms. It first compares a fingerprint of the prompt with the one the browser displayed, so a stale click cannot approve a different prompt that appeared in the meantime.

### Remote access

Do not expose tmuxherd directly. Recommended options, best first:

1. **SSH tunnel.** On your local machine:
   ```
   ssh -N -L 7420:127.0.0.1:7420 yourhost
   ```
   Then open the printed URL locally. The server stays bound to loopback.
2. **`tailscale serve`**, which gives you HTTPS inside your tailnet.
3. **A reverse proxy with its own authentication** (and TLS) in front.

`--host 0.0.0.0` is refused unless you also pass `--allow-remote`, and a warning is then printed. Plain-HTTP remote binding is dangerous because the token and the cookie travel in cleartext: anyone on the network path can read them and take over your agents. Behind `tailscale serve` or a reverse proxy, start tmuxherd with `--allowed-origin https://<public-host>`, so that exact origin passes the `Host` and `Origin` checks. Every other host is still refused.

### `TMUXHERD_TOKEN`

Setting `TMUXHERD_TOKEN` fixes the token so scripts can use Bearer auth. The value can end up in shell history, process listings and CI logs. Prefer setting it from a file or a secrets manager, use a long random value, and rotate it by restarting with a new one.

### Webhooks

The webhook URL can only be set from the CLI or the config file, never from the browser. A compromised page or a stolen cookie therefore cannot redirect alert contents (which may include pane text) to an attacker's server.

## Out of scope

- An attacker who already runs code as your user or can read your process environment.
- Anything an agent does after you approve it. tmuxherd supervises agents; it does not sandbox them.
- Exposure caused by deliberately using `--allow-remote` over plain HTTP.
