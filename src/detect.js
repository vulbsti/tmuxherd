// Screen-state detection for terminal coding agents.
//
// detect() is a pure function: (screen text, harness hint) -> what the agent
// is visibly doing *right now*. Anything that depends on time (stalls, dead
// with work pending) lives in tracker.js.
//
// Patterns were derived from sandbox recordings of Claude Code 2.1.x and
// Codex CLI 0.166 (see test/fixtures/captures). TUIs change; when a harness
// update breaks a pattern, add a capture + expectation and adjust here.

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

const RULE_RE = /^\s*[─━═╌┄-]{12,}\s*$/;
const CURSOR_GLYPHS = '❯›>▶➜→';
const OPTION_RE = new RegExp(`^(\\s*)(?:([${CURSOR_GLYPHS}])\\s*)?(\\d{1,2})[.)]\\s+(.+?)\\s*$`);
const BARE_CURSOR_RE = new RegExp(`^(\\s*)([${CURSOR_GLYPHS}])\\s+(\\S.*?)\\s*$`);
const FOOTER_RE = /(enter (to )?(confirm|select|continue)|esc (to )?(cancel|back|go back)|press enter|↑\/↓|tab to amend)/i;
const PERMISSION_RE = /(do you want to|would you like to (run|make|apply|allow)|requires approval|allow (this|command|tool)|approve|permission|proceed\?)/i;
const TRUST_RE = /\btrust\b/i;

// "✻ Infusing… (3s · ↓ 94 tokens)" — glyph, verb with ellipsis, open paren.
const CLAUDE_SPINNER_RE = /^\s*\S\s+[A-Z][\p{L}'-]*…\s*\(/u;
const ESC_INTERRUPT_RE = /esc to interrupt/i;
const RETRY_RE = /(Retrying in \d+\s*s|attempt \d+\s*\/\s*\d+|Reconnecting\.\.\.|waiting for network|Re-connecting|limit reached · continuing automatically)/i;
const ERROR_RE = /(API Error|Please run \/login|Invalid API key|authentication[_ ]error|OAuth token (has )?expired|stream disconnected|rate[- ]limit|usage limit|hit your (usage )?limit|Connection failed|ECONNREFUSED|ENOTFOUND|Credit balance is too low|^\s*■\s)/i;

/** @typedef {'working'|'waiting'|'idle'|'unknown'} VisibleState */

/**
 * @param {string} screen  pane capture, with or without ANSI escapes
 * @param {{harness?: string|null, command?: string}} [hint]
 */
export function detect(screen, hint = {}) {
  const text = stripAnsi(screen);
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  // Trim trailing empty lines: the visible screen is padded to pane height.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const harness = guessHarness(text, hint);
  const prompt = findPrompt(lines);
  const tail = lines.slice(-30);
  const retrying = tail.some((l) => RETRY_RE.test(l));
  const working = !prompt && (retrying || isWorking(tail, harness));
  const error = !prompt && !working ? findError(lines, harness) : null;

  /** @type {VisibleState} */
  let state;
  if (prompt) state = 'waiting';
  else if (working) state = 'working';
  else if (harness === 'generic') state = 'unknown';
  else state = 'idle';

  return {
    harness,
    state,
    retrying: !prompt && retrying,
    error,
    prompt,
    activity: activityLine(tail, harness),
  };
}

export function guessHarness(text, { harness, command } = {}) {
  if (harness) return harness;
  const cmd = (command || '').toLowerCase();
  if (cmd === 'claude') return 'claude';
  if (cmd === 'codex') return 'codex';
  if (cmd === 'pi') return 'pi';
  // Fallbacks for panes started through a wrapper (sh -c, npx, …).
  if (/Claude Code v\d|\b(manual|auto) mode on\b|accept edits on|shift\+tab to cycle/.test(text)) return 'claude';
  if (/OpenAI Codex \(v|Ask Codex to do anything|for shortcuts/.test(text)) return 'codex';
  return 'generic';
}

function isWorking(tail, harness) {
  if (tail.some((l) => ESC_INTERRUPT_RE.test(l))) return true;
  if (harness === 'claude' || harness === 'generic') {
    if (tail.some((l) => CLAUDE_SPINNER_RE.test(l))) return true;
  }
  if (harness === 'codex') {
    if (tail.some((l) => /^\s*[◦•]\s+(Working|Thinking)\b/.test(l))) return true;
  }
  if (harness === 'pi') {
    if (tail.some((l) => /^\s*\S\s+(Working|Thinking)\.\.\./.test(l))) return true;
  }
  return false;
}

/**
 * Return the error line if the last thing the agent printed was an error.
 * Only the region just above the input box counts, so an old error that the
 * agent has since moved past does not keep the pane flagged.
 */
function findError(lines, harness) {
  let end = lines.length;
  // Claude: the input box is the last "rule / ❯ / rule" sandwich.
  // Codex: the input line is the last line starting with "› " that is not an option.
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    const l = lines[i];
    if ((harness === 'claude' && RULE_RE.test(l) && i + 1 < lines.length && /^\s*❯/.test(lines[i + 1])) ||
        (harness === 'codex' && /^›\s(?!\d)/.test(l))) {
      end = i;
      break;
    }
  }
  const region = lines.slice(0, end).filter((l) => l.trim() && !RULE_RE.test(l));
  // A finished-turn summary ("✻ Cogitated for 3m 4s", "Worked for 12s") may follow the error.
  const recent = region.slice(-4);
  for (let i = recent.length - 1; i >= 0; i--) {
    if (ERROR_RE.test(recent[i])) return recent[i].trim().replace(/^[●■⚠•]\s*/, '').slice(0, 200);
  }
  return null;
}

function activityLine(tail, harness) {
  for (let i = tail.length - 1; i >= 0; i--) {
    const l = tail[i];
    if (CLAUDE_SPINNER_RE.test(l) || ESC_INTERRUPT_RE.test(l) || RETRY_RE.test(l)) return l.trim().slice(0, 160);
  }
  if (harness === 'claude') {
    for (let i = tail.length - 1; i >= 0; i--) if (/^\s*●\s/.test(tail[i])) return tail[i].trim().slice(0, 160);
  }
  return null;
}

// ---------------------------------------------------------------- prompts

/**
 * Find an interactive selection menu near the bottom of the screen.
 * A menu is a block of ≥2 options where exactly one line carries a cursor
 * glyph, near a confirmation footer or a question. Returns null otherwise.
 */
export function findPrompt(lines) {
  const start = Math.max(0, lines.length - 45);
  // Walk upward from the bottom to find the lowest option block.
  for (let i = lines.length - 1; i >= start; i--) {
    const block = readOptionBlock(lines, i);
    if (!block) continue;
    const { first, last, options } = block;
    const below = lines.slice(last + 1, last + 5);
    const hasFooter = below.some((l) => FOOTER_RE.test(l));
    const ctx = contextAbove(lines, first);
    const question = pickQuestion(ctx);
    if (!hasFooter && !question) continue;
    if (!options.numbered && !hasFooter) continue; // bare cursor lists need a footer
    const selected = options.list.findIndex((o) => o.selected);
    const kind = TRUST_RE.test(question || '') ? 'trust'
      : PERMISSION_RE.test([question, ...ctx].join('\n')) ? 'permission' : 'menu';
    const opts = options.list.map((o, idx) => ({ index: idx, number: o.number, label: o.label, selected: o.selected }));
    return {
      kind,
      question: question || ctx[ctx.length - 1] || '',
      context: ctx,
      options: opts,
      selected,
      footer: (below.find((l) => FOOTER_RE.test(l)) || '').trim(),
      fingerprint: fingerprint([question || '', ...opts.map((o) => o.label)].join('\u0000')),
    };
  }
  return null;
}

/** Try to read an option block whose last line is lines[i]. */
function readOptionBlock(lines, i) {
  const numbered = OPTION_RE.exec(lines[i]);
  const bare = !numbered && BARE_CURSOR_RE.exec(lines[i]);
  if (!numbered && !bare) return null;

  if (numbered) {
    // Collect upward while lines are options or wrapped continuations.
    const opts = [];
    let j = i;
    let pendingCont = [];
    for (; j >= 0; j--) {
      const m = OPTION_RE.exec(lines[j]);
      if (m) {
        const label = [m[4], ...pendingCont.reverse()].join(' ').replace(/\s+/g, ' ').trim();
        opts.unshift({ number: Number(m[3]), label, selected: Boolean(m[2]), indent: m[1].length });
        pendingCont = [];
        if (Number(m[3]) === 1) break;
        continue;
      }
      // Continuation of a wrapped option label: indented, non-empty, not a rule.
      if (opts.length && lines[j].trim() && /^\s{3,}\S/.test(lines[j]) && !RULE_RE.test(lines[j]) && pendingCont.length < 2) {
        pendingCont.push(lines[j].trim());
        continue;
      }
      break;
    }
    if (opts.length < 2 || opts[0].number !== 1) return null;
    for (let k = 1; k < opts.length; k++) if (opts[k].number !== opts[k - 1].number + 1) return null;
    if (opts.filter((o) => o.selected).length !== 1) return null;
    return { first: j, last: i, options: { numbered: true, list: opts } };
  }

  // Bare cursor menu: one "❯ label" line among siblings that share its label column.
  const col = bare[1].length + bare[2].length + lines[i].slice(bare[1].length + 1).search(/\S/);
  const sibling = (l) => l && l.length > col && /^\s+$/.test(l.slice(0, col)) && /\S/.test(l[col]);
  // Expand from a cursor line; `i` may be a sibling too, so locate the cursor line nearby.
  let first = i;
  let last = i;
  while (first - 1 >= 0 && (sibling(lines[first - 1]) || BARE_CURSOR_RE.test(lines[first - 1]))) first--;
  while (last + 1 < lines.length && (sibling(lines[last + 1]) || BARE_CURSOR_RE.test(lines[last + 1]))) last++;
  const list = [];
  for (let k = first; k <= last; k++) {
    const b = BARE_CURSOR_RE.exec(lines[k]);
    list.push({ number: null, label: (b ? b[3] : lines[k]).trim(), selected: Boolean(b) });
  }
  if (list.length < 2 || list.filter((o) => o.selected).length !== 1) return null;
  return { first, last, options: { numbered: false, list } };
}

/** Up to 14 meaningful lines above an option block, stopping at a horizontal rule. */
function contextAbove(lines, first) {
  const out = [];
  for (let k = first - 1; k >= 0 && out.length < 14; k--) {
    const l = lines[k];
    if (RULE_RE.test(l) && !/╌/.test(l)) break;
    if (/^\s*[╌┄]{6,}\s*$/.test(l)) continue;
    if (!l.trim()) {
      if (out.length && k - 1 >= 0 && !lines[k - 1].trim()) break; // two blank lines = new section
      continue;
    }
    out.unshift(l.trim());
  }
  return out;
}

const QUESTION_LEAD_RE = /^(do you|would you|trust|allow|proceed|are you sure|continue)/i;
function pickQuestion(ctx) {
  // Lines that contain a question; the part up to the first "?" is the question.
  const qs = ctx.map((l) => (/\?(\s|$)/.test(l) ? l.slice(0, l.indexOf('?') + 1) : null));
  for (let k = qs.length - 1; k >= 0; k--) if (qs[k] && QUESTION_LEAD_RE.test(qs[k])) return qs[k];
  for (let k = qs.length - 1; k >= 0; k--) if (qs[k] && /\?\s*$/.test(ctx[k])) return qs[k];
  for (let k = qs.length - 1; k >= 0; k--) if (qs[k]) return qs[k];
  return null;
}

/** FNV-1a 32-bit, hex. Stable across processes; not security sensitive. */
export function fingerprint(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalize a screen for progress comparison: strip escapes, digits, spinner
 * glyphs and spinner verbs, and rotating tips, so a ticking timer or an
 * animated spinner is not mistaken for progress.
 */
export function progressKey(screen) {
  return fingerprint(
    stripAnsi(screen)
      .split('\n')
      .filter((l) => !/\bTip:/.test(l))
      .map((l) => l
        .replace(/[\p{L}'-]*…/gu, '…')
        .replace(/\d+/g, '')
        .replace(/[✻✶✳✢✽·*◦•◐◓◑◒⠁-⣿]/g, '')
        .replace(/\s+/g, ' ')
        .trim())
      .join('\n'),
  );
}
