// Alert delivery outside the browser: desktop notifications and webhooks.
// Browser notifications are sent by the page itself from the SSE alert stream.

import { execFile } from 'node:child_process';

const TITLES = {
  stalled: 'Agent stalled',
  dead: 'Agent exited with work pending',
  waiting: 'Agent needs your answer',
  test: 'tmuxherd test alert',
};

export function alertText(alert) {
  const title = `${TITLES[alert.kind] || alert.kind}: ${alert.name}`;
  const body = `${alert.harness} · ${alert.detail || ''}`.trim();
  return { title, body };
}

/** Desktop notification via notify-send (Linux) or osascript (macOS). Never throws. */
export function desktopNotify(alert, { platform = process.platform, exec = execFile } = {}) {
  const { title, body } = alertText(alert);
  return new Promise((resolve) => {
    const done = (err) => resolve(!err);
    if (platform === 'darwin') {
      const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      exec('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`], { timeout: 5000 }, done);
    } else {
      exec('notify-send', ['--app-name=tmuxherd', title, body], { timeout: 5000 }, done);
    }
  });
}

/**
 * POST an alert to a webhook.
 *   json  — the alert object (default)
 *   slack — {"text": "..."} (Slack, Mattermost, Discord-compatible /slack endpoints)
 *   text  — plain text body (ntfy.sh and similar)
 */
export async function webhookNotify(alert, { url, format = 'json', fetchImpl = fetch, timeoutMs = 5000 }) {
  const { title, body } = alertText(alert);
  let payload;
  let type;
  if (format === 'slack') {
    payload = JSON.stringify({ text: `*${title}*\n${body}` });
    type = 'application/json';
  } else if (format === 'text') {
    payload = `${title}\n${body}`;
    type = 'text/plain; charset=utf-8';
  } else {
    payload = JSON.stringify({ source: 'tmuxherd', ...alert, title, body });
    type = 'application/json';
  }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': type },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export class Notifier {
  /** @param {{desktop?:boolean, webhook?:string|null, webhookFormat?:string, log?:(s:string)=>void}} o */
  constructor({ desktop = false, webhook = null, webhookFormat = 'json', log = () => {} } = {}) {
    this.desktop = desktop;
    this.webhook = webhook;
    this.webhookFormat = webhookFormat;
    this.log = log;
  }

  async send(alert) {
    const results = {};
    if (this.desktop) results.desktop = await desktopNotify(alert);
    if (this.webhook) results.webhook = await webhookNotify(alert, { url: this.webhook, format: this.webhookFormat });
    if (results.desktop === false) this.log('desktop notification failed (is notify-send installed?)');
    if (results.webhook === false) this.log('webhook delivery failed');
    return results;
  }
}
