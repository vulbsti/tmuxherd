// Answering an agent's selection prompt from the browser: move, verify, confirm.
// See DECISIONS.md D6 for why we never type digits.

import { detect } from './detect.js';

export class AnswerError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function look(server, paneId, hint) {
  const screen = await server.capture(paneId);
  return detect(screen, hint);
}

/**
 * @param {import('./tmux.js').TmuxServer} server
 * @param {string} paneId
 * @param {{fingerprint:string, option?:number, action?:'cancel'}} req
 * @param {{harness?:string|null, command?:string}} hint
 * @param {{stepMs?:number, timeoutMs?:number, check?:() => Promise<unknown>}} [opts]
 *   `check` runs before every keystroke and must throw if the pane is no longer
 *   the one the caller verified (DECISIONS D18), so a swapped pane gets no keys.
 */
export async function answerPrompt(server, paneId, req, hint = {}, { stepMs = 80, timeoutMs = 2500, check = async () => {} } = {}) {
  if (typeof req?.fingerprint !== 'string') throw new AnswerError('fingerprint required', 400);
  // Re-check the pane before every capture and every keystroke, so a pane that
  // was swapped mid-answer is neither read nor typed into.
  const press = async (key) => {
    await check();
    await server.sendKeys(paneId, [key]);
  };
  const peek = async () => {
    await check();
    return look(server, paneId, hint);
  };

  // 1. The prompt the user saw must still be the prompt on screen.
  let d = await peek();
  if (!d.prompt) throw new AnswerError('no prompt is showing any more');
  if (d.prompt.fingerprint !== req.fingerprint) throw new AnswerError('the prompt changed since you saw it; refresh and try again');

  if (req.action === 'cancel') {
    await press('Escape');
    return { ok: true, sent: ['Escape'] };
  }

  const target = req.option;
  if (!Number.isInteger(target) || target < 0 || target >= d.prompt.options.length) {
    throw new AnswerError('option out of range', 400);
  }

  // 2. Move the cursor. One key at a time keeps slow TUIs in step.
  const sent = [];
  const deadline = Date.now() + timeoutMs;
  while (d.prompt.selected !== target) {
    if (Date.now() > deadline) throw new AnswerError('cursor did not reach the option in time');
    const key = d.prompt.selected < target ? 'Down' : 'Up';
    await press(key);
    sent.push(key);
    // 3. Verify by looking again (the TUI may redraw asynchronously).
    const before = d.prompt.selected;
    for (;;) {
      await sleep(stepMs);
      d = await peek();
      if (!d.prompt || d.prompt.fingerprint !== req.fingerprint) {
        throw new AnswerError('the prompt changed while selecting; nothing was confirmed');
      }
      if (d.prompt.selected !== before) break;
      if (Date.now() > deadline) throw new AnswerError('cursor did not move; nothing was confirmed');
    }
    if (sent.length > 20) throw new AnswerError('too many cursor moves; nothing was confirmed');
  }

  // 4. Confirm.
  await press('Enter');
  sent.push('Enter');

  // Wait briefly for the prompt to go away so the response reflects reality.
  let after = d;
  for (let t = 0; t < 10; t++) {
    await sleep(stepMs);
    after = await peek();
    if (!after.prompt || after.prompt.fingerprint !== req.fingerprint) break;
  }
  return {
    ok: true,
    sent,
    chosen: d.prompt.options[target].label,
    stillShowing: Boolean(after.prompt && after.prompt.fingerprint === req.fingerprint),
  };
}
