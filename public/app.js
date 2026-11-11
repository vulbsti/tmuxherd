// tmuxherd dashboard. Plain ES module, no framework, no build step.
// Contract: docs/api.md. Everything that came from a pane (screen text, names,
// prompt labels, cwd) is untrusted and goes into the DOM via textContent only.

import { renderAnsi } from './ansi.js';

const $ = (id) => document.getElementById(id);
const STATES = ['working', 'waiting', 'stalled', 'idle', 'exited'];
const HOVER_DELAY = 140;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canHover = matchMedia('(hover: hover) and (pointer: fine)');

const S = {
  panes: new Map(), // key -> view
  screens: new Map(), // key -> raw capture
  tiles: new Map(), // key -> tile record
  active: new Map(), // alert id -> alert
  history: [], // newest first
  thresholds: {},
  notify: {},
  presets: {},
  socket: 'tmuxherd',
  attach: '',
  filter: null,
  zoomKey: null,
  highlightKey: null,
  connected: false,
};

// ---------------------------------------------------------------- helpers

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  copy: ['M8 8h11v12H8z', 'M5 16V4h11'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  gear: ['M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z', 'M19.4 13.5l1.7 1.3-1.8 3.1-2-.8a7 7 0 0 1-1.8 1l-.3 2.1h-3.6l-.3-2.1a7 7 0 0 1-1.8-1l-2 .8-1.8-3.1 1.7-1.3a7 7 0 0 1 0-2.1L3.6 9.6l1.8-3.1 2 .8a7 7 0 0 1 1.8-1l.3-2.1h3.6l.3 2.1a7 7 0 0 1 1.8 1l2-.8 1.8 3.1-1.7 1.3a7 7 0 0 1 0 2.1z'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  branch: ['M7 4v10', 'M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 8c0 5-10 4-10 8'],
  open: ['M14 4h6v6', 'M20 4l-8 8', 'M18 14v6H4V6h6'],
  plus: ['M12 5v14', 'M5 12h14'],
};

function icon(name, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtClock(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let HOME = null;
function shortCwd(p) {
  if (!p) return '';
  let s = p;
  if (HOME && (s === HOME || s.startsWith(`${HOME}/`))) s = `~${s.slice(HOME.length)}`;
  const parts = s.split('/');
  if (parts.length > 4) s = `${parts[0] || ''}/…/${parts.slice(-2).join('/')}`.replace(/^\/…/, '…');
  return s;
}

// Guess $HOME from cwds like /home/<user>/… or /Users/<user>/… so paths shorten to ~.
function learnHome(views) {
  if (HOME) return;
  for (const v of views) {
    const m = /^(\/home\/[^/]+|\/Users\/[^/]+)(\/|$)/.exec(v.cwd || '');
    if (m) {
      HOME = m[1];
      return;
    }
  }
}

function basename(p) {
  return String(p || '').replace(/\/+$/, '').split('/').pop();
}

function isAlarm(v) {
  return v.state === 'stalled' || (v.state === 'exited' && v.pending);
}

function stateLabel(v) {
  if (v.state === 'exited') {
    if (v.exitStatus != null && v.exitStatus !== 0) return `exited ${v.exitStatus}`;
    return 'exited';
  }
  return v.state;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    const e = new Error('tmuxherd is not reachable');
    e.status = 0;
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok || (data && data.ok === false)) {
    const e = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

async function copyText(text, btn) {
  let ok;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = el('textarea');
    ta.value = text;
    ta.className = 'offscreen';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  if (btn) {
    btn.replaceChildren(icon(ok ? 'check' : 'copy'));
    btn.dataset.copied = ok ? 'true' : 'false';
    setTimeout(() => {
      btn.replaceChildren(icon('copy'));
      delete btn.dataset.copied;
    }, 1400);
  }
  if (!ok) toast({ kind: 'error', title: 'Copy failed', body: text });
}

// Width of one monospace cell relative to font-size, measured once.
let CELL = null;
function cellRatio() {
  if (CELL) return CELL;
  const probe = el('pre', 'term probe');
  probe.textContent = 'M'.repeat(100);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  const fs = parseFloat(getComputedStyle(probe).fontSize) || 12;
  probe.remove();
  CELL = { w: w / 100 / fs, lh: 1.2 };
  return CELL;
}

// ---------------------------------------------------------------- toasts

function toast({ kind = 'info', title, body, action, sticky = false, id = null, ttl = 7000 }) {
  const box = $('toasts');
  if (id) box.querySelector(`[data-alert-id="${CSS.escape(id)}"]`)?.remove();
  const t = el('div', 'toast');
  t.dataset.testid = 'toast';
  t.setAttribute('data-testid', 'toast');
  t.dataset.kind = kind;
  if (id) t.dataset.alertId = id;
  t.setAttribute('role', kind === 'error' || kind === 'stalled' || kind === 'dead' ? 'alert' : 'status');
  const text = el('div', 'toast-text');
  text.appendChild(el('strong', 'toast-title', title));
  if (body) text.appendChild(el('span', 'toast-body', body));
  t.appendChild(text);
  if (action) {
    const a = el('button', 'btn small', action.label);
    a.type = 'button';
    a.addEventListener('click', () => {
      action.run();
      t.remove();
    });
    t.appendChild(a);
  }
  const x = el('button', 'icon-btn small');
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss');
  x.appendChild(icon('close'));
  x.addEventListener('click', () => t.remove());
  t.appendChild(x);
  box.appendChild(t);
  while (box.children.length > 5) box.firstElementChild.remove();
  if (!sticky) setTimeout(() => t.remove(), ttl);
  return t;
}

// ---------------------------------------------------------------- answering prompts

async function answer(key, prompt, option, btn) {
  const v = S.panes.get(key);
  const name = v?.name || key;
  const group = btn.closest('.answers');
  group?.querySelectorAll('button').forEach((b) => (b.disabled = true));
  group?.setAttribute('aria-busy', 'true');
  const body = option === 'cancel' ? { fingerprint: prompt.fingerprint, action: 'cancel' } : { fingerprint: prompt.fingerprint, option };
  const label = option === 'cancel' ? 'Cancel' : prompt.options.find((o) => o.index === option)?.label || `option ${option + 1}`;
  try {
    const r = await api('POST', `/api/panes/${encodeURIComponent(key)}/answer`, body);
    for (const g of document.querySelectorAll(`.answers[data-key="${CSS.escape(key)}"]`)) g.dataset.sent = 'true';
    toast({ kind: 'ok', title: option === 'cancel' ? `Cancelled ${name}'s prompt` : `Answered ${name}`, body: r?.chosen || label, ttl: 4000 });
  } catch (e) {
    group?.querySelectorAll('button').forEach((b) => (b.disabled = false));
    if (e.status === 409) {
      showAnswerError(key, 'The prompt changed before the answer landed. Check the new question.');
      refreshState();
    } else {
      showAnswerError(key, e.message);
    }
  } finally {
    group?.removeAttribute('aria-busy');
  }
}

function showAnswerError(key, msg) {
  for (const g of document.querySelectorAll(`.answers[data-key="${CSS.escape(key)}"]`)) {
    let err = g.parentElement.querySelector(':scope > .answer-error');
    if (!err) {
      err = el('p', 'answer-error');
      err.setAttribute('role', 'alert');
      g.after(err);
    }
    err.textContent = msg;
  }
}

/** Option buttons + Cancel for a prompt. Rebuilt only when the prompt changes. */
function answerButtons(v, where) {
  const p = v.prompt;
  const wrap = el('div', 'answers');
  wrap.dataset.key = v.key;
  wrap.dataset.where = where;
  for (const o of p.options) {
    const b = el('button', 'answer');
    b.type = 'button';
    b.setAttribute('data-testid', `answer-${v.key}-${o.index}`);
    b.dataset.selected = String(Boolean(o.selected || p.selected === o.index));
    const num = el('span', 'answer-num', o.number != null ? String(o.number) : String(o.index + 1));
    const lab = el('span', 'answer-label', o.label);
    b.title = o.label;
    b.append(num, lab);
    if (b.dataset.selected === 'true') {
      b.appendChild(el('span', 'answer-cursor', 'cursor'));
      b.setAttribute('aria-description', 'the agent’s cursor is on this option');
    }
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      answer(v.key, p, o.index, b);
    });
    wrap.appendChild(b);
  }
  const c = el('button', 'answer cancel');
  c.type = 'button';
  c.setAttribute('data-testid', `answer-${v.key}-cancel`);
  c.append(el('span', 'answer-label', 'Cancel'), el('kbd', null, 'Esc'));
  c.addEventListener('click', (ev) => {
    ev.stopPropagation();
    answer(v.key, p, 'cancel', c);
  });
  wrap.appendChild(c);
  return wrap;
}

function promptSig(v) {
  const p = v.prompt;
  return p ? `${p.fingerprint}:${p.selected}` : '';
}

// ---------------------------------------------------------------- tiles

function makeTile(key) {
  const t = { key, sig: '', screenSig: null, scale: 0 };
  const a = el('article', 'tile');
  a.tabIndex = 0;
  a.setAttribute('data-testid', `tile-${key}`);
  a.dataset.key = key;

  const head = el('header', 'tile-head');
  const id = el('div', 'tile-id');
  t.name = el('span', 'name');
  t.harness = el('span', 'harness');
  t.wt = el('span', 'wt');
  t.wt.hidden = true;
  id.append(t.name, t.harness, t.wt);
  t.pill = el('span', 'pill');
  head.append(id, t.pill);

  t.cwd = el('div', 'tile-cwd');

  // The prompt panel overlays the bottom of the screen, so a waiting tile is
  // no taller than its neighbours and the grid never reflows.
  t.box = el('div', 'screen-box');
  t.term = el('pre', 'term');
  t.prompt = el('div', 'tile-prompt');
  t.prompt.hidden = true;
  t.box.append(t.term, t.prompt);

  t.foot = el('div', 'tile-foot');

  a.append(head, t.cwd, t.box, t.foot);
  t.el = a;

  a.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a')) return;
    openZoom(key);
  });
  a.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === a) {
      ev.preventDefault();
      openZoom(key);
    }
  });
  a.addEventListener('mouseenter', () => scheduleLift(t));
  a.addEventListener('mouseleave', () => drop(t));
  resizeObs.observe(t.box);
  return t;
}

const resizeObs = new ResizeObserver((entries) => {
  for (const en of entries) {
    const key = en.target.closest('.tile')?.dataset.key;
    const t = key && S.tiles.get(key);
    if (t) fitTile(t);
  }
});

function fitTile(t) {
  const v = S.panes.get(t.key);
  if (!v) return;
  const cols = v.width || 160;
  const rows = v.height || 45;
  const c = cellRatio();
  const fs = 12;
  const natW = cols * c.w * fs;
  const natH = rows * c.lh * fs;
  const w = t.box.clientWidth;
  if (!w) return;
  const scale = w / natW;
  t.term.style.width = `${natW}px`;
  t.term.style.height = `${natH}px`;
  t.term.style.transform = `scale(${scale})`;
  t.box.style.height = `${Math.ceil(natH * scale)}px`;
  t.scale = scale;
}

function updateTile(v) {
  let t = S.tiles.get(v.key);
  const isNew = !t;
  if (!t) {
    t = makeTile(v.key);
    S.tiles.set(v.key, t);
  }
  const a = t.el;
  a.dataset.state = v.state;
  a.dataset.alarm = String(isAlarm(v));
  a.dataset.dead = String(Boolean(v.dead));
  t.name.textContent = v.name;
  t.name.title = v.command || v.name;
  t.harness.textContent = v.harness;
  t.harness.dataset.harness = v.harness;
  if (v.worktree) {
    t.wt.hidden = false;
    t.wt.replaceChildren(icon('branch', 'ico tiny'), document.createTextNode(basename(v.worktree)));
    t.wt.title = `git worktree: ${v.worktree}`;
  } else t.wt.hidden = true;
  t.cwd.textContent = shortCwd(v.cwd);
  t.cwd.title = v.cwd || '';
  if (!v.own) {
    t.cwd.textContent += `  (adopted from ${v.socket})`;
  }
  updatePill(t.pill, v);

  const sig = promptSig(v);
  if (sig !== t.sig) {
    t.sig = sig;
    if (v.state === 'waiting' && v.prompt) {
      t.prompt.hidden = false;
      const q = el('p', 'tile-q', v.prompt.question || 'The agent is asking for input');
      const detail = (v.prompt.context || []).filter((x) => x.trim() && x.trim() !== v.prompt.question).slice(0, 2).join('  ');
      const children = [q];
      if (detail) children.push(el('code', 'tile-ctx', detail));
      children.push(answerButtons(v, 'tile'));
      t.prompt.replaceChildren(...children);
    } else {
      t.prompt.hidden = true;
      t.prompt.replaceChildren();
    }
  }

  // One footer line on every tile keeps heights uniform. Alarms take it over.
  let foot = '';
  if (isAlarm(v)) foot = v.reason || (v.state === 'stalled' ? 'No progress while work is pending' : 'Exited with work pending');
  else if (v.state === 'working' && v.activity) foot = v.activity;
  else if (v.state === 'waiting') foot = 'Waiting for your answer';
  else if (v.error) foot = v.error;
  else if (v.state === 'idle') foot = v.activity || 'Ready for input';
  else if (v.state === 'exited') foot = v.exitStatus != null ? `Exit status ${v.exitStatus}` : 'Process ended';
  t.foot.textContent = foot || '\u00a0';
  t.foot.title = foot;
  t.foot.dataset.alarm = String(isAlarm(v));

  if (isNew) {
    insertTile(t, v);
    fitTile(t);
    paintScreen(v.key);
  } else if (t.cols !== v.width || t.rows !== v.height) fitTile(t);
  t.cols = v.width;
  t.rows = v.height;
  applyFilter(t, v);
  if (S.highlightKey === v.key) flashTile(v.key);
}

function updatePill(pill, v) {
  pill.dataset.state = v.state;
  pill.dataset.alarm = String(isAlarm(v));
  const since = v.since ? ` for ${fmtDur(Date.now() - v.since)}` : '';
  pill.replaceChildren(el('b', null, stateLabel(v)), document.createTextNode(since));
}

function insertTile(t, v) {
  const grid = $('grid');
  // Stable order: creation time, then key. Tiles never jump while you watch them.
  const order = (x) => [x.created || 0, x.key];
  const [c0, k0] = order(v);
  for (const other of grid.children) {
    const ov = S.panes.get(other.dataset.key);
    if (!ov) continue;
    const [c1, k1] = order(ov);
    if (c1 > c0 || (c1 === c0 && k1 > k0)) {
      grid.insertBefore(t.el, other);
      return;
    }
  }
  grid.appendChild(t.el);
}

function removeTile(key) {
  const t = S.tiles.get(key);
  if (!t) return;
  resizeObs.unobserve(t.box);
  t.el.remove();
  S.tiles.delete(key);
}

function flashTile(key) {
  const t = S.tiles.get(key);
  if (!t) return;
  S.highlightKey = null;
  t.el.classList.remove('fresh');
  void t.el.offsetWidth;
  t.el.classList.add('fresh');
  t.el.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  setTimeout(() => t.el.classList.remove('fresh'), 3200);
}

// Screens arrive at up to ~4 Hz per pane; paint once per animation frame.
const dirty = new Set();
let rafPending = false;
function markScreen(key) {
  dirty.add(key);
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    for (const k of dirty) paintScreen(k);
    dirty.clear();
  });
}

function paintScreen(key) {
  const raw = S.screens.get(key);
  const t = S.tiles.get(key);
  if (t && raw != null && t.screenSig !== raw) {
    t.screenSig = raw;
    t.term.replaceChildren(renderAnsi(raw));
  }
  if (S.zoomKey === key && !Z.scrollback && raw != null) {
    const pinned = atBottom();
    Z.term.replaceChildren(renderAnsi(raw));
    if (pinned) pinBottom();
  }
}

// ---- hover lift: enlarge the tile in place, kept inside the viewport

let liftTimer = null;
function scheduleLift(t) {
  clearTimeout(liftTimer);
  if (!canHover.matches || S.zoomKey || $('spawn').open) return;
  liftTimer = setTimeout(() => lift(t), HOVER_DELAY);
}

function lift(t) {
  const a = t.el;
  if (!a.matches(':hover')) return;
  const r = a.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const m = 12;
  // Stay below the header when it is pinned to the top of the viewport.
  const barBottom = Math.max(0, document.querySelector('.bar').getBoundingClientRect().bottom);
  const topMin = barBottom + 8;
  // As large as the viewport allows, so the screen text becomes readable.
  const s = Math.min(2.6, (vw - 2 * m) / r.width, (vh - topMin - m) / r.height);
  if (s <= 1.05) return;
  const w = r.width * s;
  const h = r.height * s;
  // Grow around the tile's centre, then slide back inside the viewport.
  let left = r.left + r.width / 2 - w / 2;
  let top = r.top + r.height / 2 - h / 2;
  left = Math.min(Math.max(left, m), vw - m - w);
  top = Math.min(Math.max(top, topMin), vh - m - h);
  const dx = left - r.left;
  const dy = top - r.top;
  a.style.transformOrigin = '0 0';
  a.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  a.classList.add('lifted');
}

function drop(t) {
  clearTimeout(liftTimer);
  const a = t.el;
  if (!a.classList.contains('lifted')) return;
  a.classList.remove('lifted');
  a.style.transform = '';
  a.classList.add('settling');
  setTimeout(() => a.classList.remove('settling'), 220);
}

function dropAll() {
  for (const t of S.tiles.values()) drop(t);
}

// ---------------------------------------------------------------- header, filter, empty state

function renderCounts() {
  const n = Object.fromEntries(STATES.map((s) => [s, 0]));
  let alarms = 0;
  for (const v of S.panes.values()) {
    n[v.state] = (n[v.state] || 0) + 1;
    if (isAlarm(v)) alarms++;
  }
  for (const b of document.querySelectorAll('.count')) {
    const s = b.dataset.count;
    b.querySelector('b').textContent = String(n[s]);
    b.dataset.zero = String(n[s] === 0);
    b.setAttribute('aria-pressed', String(S.filter === s));
  }
  // An exited agent with pending work is an alarm too; mark the exited counter loud.
  const exitedBtn = document.querySelector('.count[data-count="exited"]');
  const loudExited = [...S.panes.values()].some((v) => v.state === 'exited' && v.pending);
  exitedBtn.dataset.alarm = String(loudExited);
  document.body.dataset.alarms = String(alarms);
  const empty = S.panes.size === 0;
  $('empty').hidden = !empty;
  $('grid').hidden = empty;
}

function applyFilter(t, v) {
  t.el.hidden = Boolean(S.filter) && v.state !== S.filter;
}

function setFilter(state) {
  S.filter = S.filter === state ? null : state;
  for (const [k, t] of S.tiles) applyFilter(t, S.panes.get(k));
  $('filter-note').hidden = !S.filter;
  if (S.filter) {
    const count = [...S.panes.values()].filter((v) => v.state === S.filter).length;
    $('filter-text').textContent = count ? `Showing ${count} ${S.filter} agent${count === 1 ? '' : 's'}.` : `No agent is ${S.filter} right now.`;
  }
  renderCounts();
}

// ---------------------------------------------------------------- inbox

function renderInbox() {
  const list = $('inbox-list');
  const waiting = [...S.panes.values()].filter((v) => v.state === 'waiting' && v.prompt).sort((a, b) => (a.since || 0) - (b.since || 0));
  const keep = new Set(waiting.map((v) => v.key));
  for (const item of [...list.children]) if (!keep.has(item.dataset.key)) item.remove();

  let prev = null;
  for (const v of waiting) {
    let item = list.querySelector(`:scope > [data-key="${CSS.escape(v.key)}"]`);
    if (!item) {
      item = el('article', 'inbox-item');
      item.dataset.key = v.key;
      item.setAttribute('data-testid', `inbox-item-${v.key}`);
    }
    const sig = promptSig(v);
    if (item.dataset.sig !== sig) {
      item.dataset.sig = sig;
      buildInboxItem(item, v);
    }
    const when = item.querySelector('.inbox-when');
    if (when) when.textContent = v.since ? `${fmtDur(Date.now() - v.since)}` : '';
    if (prev ? prev.nextSibling !== item : list.firstChild !== item) {
      if (prev) prev.after(item);
      else list.prepend(item);
    }
    prev = item;
  }
  $('inbox-count').textContent = String(waiting.length);
  $('inbox').dataset.empty = String(waiting.length === 0);
  $('inbox-empty').hidden = waiting.length > 0;
}

function buildInboxItem(item, v) {
  const p = v.prompt;
  const head = el('header', 'inbox-head');
  const who = el('button', 'inbox-who');
  who.type = 'button';
  who.title = 'Open this agent';
  who.append(el('span', 'name', v.name), el('span', 'harness', v.harness));
  who.addEventListener('click', () => openZoom(v.key));
  head.append(who, el('span', 'inbox-when'));
  const q = el('p', 'inbox-q', p.question || 'The agent is asking for input');
  const children = [head, q];
  const ctx = (p.context || []).filter((x, i, arr) => (x.trim() || (i > 0 && i < arr.length - 1)) && x.trim() !== p.question);
  if (ctx.length) {
    const pre = el('pre', 'inbox-ctx');
    pre.textContent = ctx.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    children.push(pre);
  }
  children.push(answerButtons(v, 'inbox'));
  if (p.footer) children.push(el('p', 'inbox-foot', p.footer));
  item.replaceChildren(...children);
}

// ---------------------------------------------------------------- alerts

const ALERT_TITLES = { stalled: 'Stalled', dead: 'Exited with work pending', waiting: 'Needs your answer', test: 'Test alert' };

function alertTitle(a) {
  return a.title || `${ALERT_TITLES[a.kind] || a.kind}: ${a.name}`;
}

function renderAlerts() {
  const act = $('alert-active');
  const items = [...S.active.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
  act.replaceChildren(...items.map((a) => alertRow(a, true)));
  if (!items.length) act.appendChild(el('li', 'side-empty', 'All clear. Stalls, crashes and unanswered prompts show up here.'));
  $('alerts-count').textContent = String(items.length);
  $('alerts-count').dataset.hot = String(items.some((a) => a.kind === 'stalled' || a.kind === 'dead'));
  const hist = $('alert-history');
  hist.replaceChildren(...S.history.slice(0, 50).map((a) => alertRow(a, false)));
  $('history-count').textContent = String(S.history.length);
  updateTitle();
}

function alertRow(a, live) {
  const li = el('li', 'alert-row');
  li.dataset.kind = a.kind;
  const resolved = !live && (Boolean(a.resolvedAt) || !S.active.has(a.id));
  li.dataset.resolved = String(resolved);
  const main = el('div', 'alert-main');
  main.appendChild(el('span', 'alert-title', alertTitle(a)));
  if (a.detail) main.appendChild(el('span', 'alert-detail', a.detail));
  const time = el('time', 'alert-time', fmtClock(a.at || a.since || Date.now()));
  if (resolved && a.resolvedAt) {
    main.appendChild(el('span', 'alert-resolved', `Cleared at ${fmtClock(a.resolvedAt)}`));
  }
  li.append(main, time);
  if (a.key && S.panes.has(a.key)) {
    const b = el('button', 'icon-btn small');
    b.type = 'button';
    b.setAttribute('aria-label', `Open ${a.name}`);
    b.appendChild(icon('open'));
    b.addEventListener('click', () => openZoom(a.key));
    li.appendChild(b);
  }
  return li;
}

function updateTitle() {
  const n = S.active.size;
  document.title = n ? `(${n}) tmuxherd` : 'tmuxherd';
}

function onAlert(a) {
  S.history.unshift(a);
  S.history.length = Math.min(S.history.length, 50);
  if (a.kind !== 'test') S.active.set(a.id, a);
  renderAlerts();
  const loud = a.kind === 'stalled' || a.kind === 'dead';
  toast({
    kind: a.kind,
    id: a.id,
    title: alertTitle(a),
    body: a.body || a.detail || '',
    sticky: loud,
    ttl: 9000,
    action: a.key && S.panes.has(a.key) ? { label: 'Open', run: () => openZoom(a.key) } : null,
  });
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(alertTitle(a), { body: a.body || a.detail || '', tag: a.id, requireInteraction: loud });
      n.onclick = () => {
        window.focus();
        if (a.key && S.panes.has(a.key)) openZoom(a.key);
        n.close();
      };
    } catch {
      /* some platforms only allow notifications from a service worker */
    }
  }
}

function onResolve(a) {
  S.active.delete(a.id);
  const h = S.history.find((x) => x.id === a.id);
  if (h) h.resolvedAt = a.resolvedAt || Date.now();
  $('toasts').querySelector(`[data-alert-id="${CSS.escape(a.id)}"]`)?.remove();
  renderAlerts();
}

// ---------------------------------------------------------------- zoom view

const Z = {
  root: $('zoom'),
  screen: $('zoom-screen'),
  term: $('zoom-term'),
  scrollback: false,
  focusTimer: null,
  promptSig: null,
  lastFocus: null,
  escAt: 0,
  escTimer: null,
};

function openZoom(key) {
  const v = S.panes.get(key);
  if (!v) return;
  dropAll();
  closeSettings();
  Z.lastFocus = document.activeElement;
  S.zoomKey = key;
  Z.scrollback = false;
  Z.promptSig = null;
  $('zoom-history').textContent = 'Load scrollback';
  Z.root.hidden = false;
  document.body.classList.add('zoomed');
  renderZoom();
  const raw = S.screens.get(key);
  Z.term.replaceChildren(raw != null ? renderAnsi(raw) : document.createTextNode(''));
  fitZoom();
  pinBottom();
  pokeFocus();
  clearInterval(Z.focusTimer);
  Z.focusTimer = setInterval(pokeFocus, 3000);
  Z.screen.focus();
}

function closeZoom() {
  if (!S.zoomKey) return;
  flushKeys();
  S.zoomKey = null;
  clearInterval(Z.focusTimer);
  Z.root.hidden = true;
  document.body.classList.remove('zoomed');
  disarmKill();
  Z.lastFocus?.focus?.();
}

function pokeFocus() {
  if (!S.zoomKey) return;
  api('POST', `/api/panes/${encodeURIComponent(S.zoomKey)}/focus`, {}).catch(() => {});
}

function renderZoom() {
  const v = S.panes.get(S.zoomKey);
  if (!v) return;
  Z.root.dataset.state = v.state;
  Z.root.dataset.alarm = String(isAlarm(v));
  $('zoom-name').textContent = v.name;
  $('zoom-harness').textContent = v.harness;
  $('zoom-harness').dataset.harness = v.harness;
  const wt = $('zoom-wt');
  wt.hidden = !v.worktree;
  if (v.worktree) {
    wt.replaceChildren(icon('branch', 'ico tiny'), document.createTextNode(basename(v.worktree)));
    wt.title = v.worktree;
  }
  updatePill($('zoom-pill'), v);
  $('zoom-cwd').textContent = shortCwd(v.cwd);
  $('zoom-cwd').title = v.cwd || '';
  $('zoom-attach').textContent = v.attach || S.attach;
  $('zoom-kill').hidden = !v.own;
  const alarm = $('zoom-alarm');
  alarm.hidden = !isAlarm(v) && !v.error;
  alarm.textContent = isAlarm(v) ? v.reason || 'No progress while work is pending' : v.error || '';
  alarm.dataset.loud = String(isAlarm(v));

  const zp = $('zoom-prompt');
  const sig = promptSig(v);
  if (sig !== Z.promptSig) {
    Z.promptSig = sig;
    if (v.state === 'waiting' && v.prompt) {
      zp.hidden = false;
      const q = el('p', 'zoom-q', v.prompt.question || 'The agent is asking for input');
      zp.replaceChildren(q, answerButtons(v, 'zoom'));
    } else {
      zp.hidden = true;
      zp.replaceChildren();
    }
  }
  updateCaptureBar();
}

// The pane's columns fill the screen box: font-size follows the box width,
// clamped to a readable range. Taller screens scroll, pinned to the bottom.
function fitZoom() {
  const v = S.panes.get(S.zoomKey);
  if (!v) return;
  const cols = v.width || 160;
  const c = cellRatio();
  const width = Z.screen.clientWidth - 24; // .term horizontal padding
  if (width <= 0) return;
  const pinned = atBottom();
  const min = width < 700 ? 6 : 10;
  const fs = Math.max(min, Math.min(16, width / (cols * c.w)));
  Z.term.style.fontSize = `${fs.toFixed(2)}px`;
  Z.term.style.width = `${Math.ceil(cols * c.w * fs) + 24}px`;
  if (pinned) pinBottom();
}

function atBottom() {
  const el = Z.screen;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
}

function pinBottom() {
  Z.screen.scrollTop = Z.screen.scrollHeight;
}

new ResizeObserver(() => {
  if (S.zoomKey) fitZoom();
}).observe(Z.screen);

async function toggleScrollback() {
  const btn = $('zoom-history');
  if (Z.scrollback) {
    Z.scrollback = false;
    Z.root.dataset.scrollback = 'false';
    btn.textContent = 'Load scrollback';
    const raw = S.screens.get(S.zoomKey);
    Z.term.replaceChildren(raw != null ? renderAnsi(raw) : document.createTextNode(''));
    fitZoom();
    pinBottom();
    return;
  }
  const key = S.zoomKey;
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const r = await api('GET', `/api/panes/${encodeURIComponent(key)}/screen?history=500`);
    if (S.zoomKey !== key) return;
    Z.scrollback = true;
    Z.root.dataset.scrollback = 'true';
    Z.term.replaceChildren(renderAnsi(r.screen || ''));
    fitZoom();
    Z.screen.scrollTop = Z.screen.scrollHeight;
    btn.textContent = 'Back to live';
  } catch (e) {
    btn.textContent = 'Load scrollback';
    toast({ kind: 'error', title: 'Could not load scrollback', body: e.message });
  } finally {
    btn.disabled = false;
  }
}

let killArmed = null;
function disarmKill() {
  clearTimeout(killArmed);
  killArmed = null;
  const b = $('zoom-kill');
  b.dataset.armed = 'false';
  b.textContent = 'Kill';
}

async function killPane() {
  const b = $('zoom-kill');
  const key = S.zoomKey;
  const v = S.panes.get(key);
  if (!v) return;
  if (!killArmed) {
    b.dataset.armed = 'true';
    b.textContent = `Kill ${v.name}?`;
    killArmed = setTimeout(disarmKill, 4000);
    return;
  }
  disarmKill();
  b.disabled = true;
  try {
    await api('DELETE', `/api/panes/${encodeURIComponent(key)}`);
    toast({ kind: 'ok', title: `Killed ${v.name}`, ttl: 4000 });
    closeZoom();
  } catch (e) {
    toast({ kind: 'error', title: `Could not kill ${v.name}`, body: e.message });
  } finally {
    b.disabled = false;
  }
}

// ---- keyboard capture

const KEYMAP = {
  Enter: 'Enter',
  Backspace: 'BSpace',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Delete: 'DC',
  Insert: 'IC',
};
for (let i = 1; i <= 12; i++) KEYMAP[`F${i}`] = `F${i}`;

const keyQueue = [];
let keyTimer = null;
let sending = Promise.resolve();

function queueText(text) {
  const last = keyQueue[keyQueue.length - 1];
  if (last && last.text != null) last.text += text;
  else keyQueue.push({ text });
  clearTimeout(keyTimer);
  keyTimer = setTimeout(flushKeys, 30);
}

function queueKey(k) {
  const last = keyQueue[keyQueue.length - 1];
  if (last && last.keys && last.keys.length < 50) last.keys.push(k);
  else keyQueue.push({ keys: [k] });
  clearTimeout(keyTimer);
  keyTimer = setTimeout(flushKeys, last && last.keys ? 30 : 0);
}

function flushKeys() {
  clearTimeout(keyTimer);
  const key = S.zoomKey;
  if (!key || !keyQueue.length) return;
  const batch = keyQueue.splice(0);
  // One request at a time, in order, so text and keys never overtake each other.
  sending = sending.then(async () => {
    for (const item of batch) {
      const body = item.text != null ? { text: item.text } : { keys: item.keys };
      try {
        await api('POST', `/api/panes/${encodeURIComponent(key)}/keys`, body);
      } catch (e) {
        toast({ kind: 'error', title: 'Keys not delivered', body: e.message, id: 'keys-error' });
        return;
      }
    }
  });
}

function onZoomKey(ev) {
  if (ev.isComposing || !S.zoomKey) return;
  const { key } = ev;
  if (key === 'Escape') {
    ev.preventDefault();
    const now = Date.now();
    if (Z.escTimer && now - Z.escAt < 450) {
      // Second Esc: release the keyboard instead of sending anything. Stop the
      // event here, or the zoom root's own Escape handler would close the view.
      ev.stopPropagation();
      clearTimeout(Z.escTimer);
      Z.escTimer = null;
      Z.screen.blur();
      $('zoom-close').focus();
      return;
    }
    Z.escAt = now;
    Z.escTimer = setTimeout(() => {
      Z.escTimer = null;
      queueKey('Escape');
    }, 450);
    return;
  }
  if (ev.metaKey) return; // leave Cmd shortcuts (copy, paste) to the browser
  if (ev.ctrlKey && !ev.altKey) {
    if (key.length === 1 && /[a-z]/i.test(key)) {
      if (key.toLowerCase() === 'v' && !ev.shiftKey) return; // paste event handles it
      ev.preventDefault();
      queueKey(`C-${key.toLowerCase()}`);
      return;
    }
    if (KEYMAP[key]) {
      ev.preventDefault();
      queueKey(`C-${KEYMAP[key]}`);
    }
    return;
  }
  if (key === 'Tab' && ev.shiftKey) {
    ev.preventDefault();
    queueKey('BTab');
    return;
  }
  if (KEYMAP[key]) {
    ev.preventDefault();
    if (ev.altKey) queueKey(`M-${KEYMAP[key]}`);
    else queueKey(KEYMAP[key]);
    return;
  }
  if (ev.altKey && key.length === 1) {
    ev.preventDefault();
    queueKey(`M-${key}`);
    return;
  }
  if (key.length === 1) {
    ev.preventDefault();
    queueText(key);
  }
}

function updateCaptureBar() {
  const on = document.activeElement === Z.screen;
  Z.root.dataset.capture = String(on);
  const v = S.panes.get(S.zoomKey);
  const dead = v?.dead;
  $('capture-state').textContent = dead ? 'Pane has exited' : on ? 'Keyboard captured' : 'Keyboard released';
  $('capture-hint').textContent = dead
    ? 'Nothing can be typed into an exited pane.'
    : on
      ? `Typing goes to ${v?.name || 'the agent'}. Esc sends Escape; press Esc twice to release.`
      : 'Click the screen to type into the agent. Esc closes this view.';
}

Z.screen.addEventListener('keydown', onZoomKey);
Z.screen.addEventListener('focus', updateCaptureBar);
Z.screen.addEventListener('blur', updateCaptureBar);
Z.screen.addEventListener('paste', (ev) => {
  const text = ev.clipboardData?.getData('text/plain');
  if (!text) return;
  ev.preventDefault();
  // Pasted newlines become Enter presses in most agents; send them as text and let the TUI decide.
  for (let i = 0; i < text.length; i += 3500) queueText(text.slice(i, i + 3500));
});
Z.root.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && document.activeElement !== Z.screen) {
    ev.preventDefault();
    closeZoom();
  }
});
Z.root.addEventListener('click', (ev) => {
  if (ev.target === Z.root) closeZoom();
});
$('zoom-close').addEventListener('click', closeZoom);
$('zoom-history').addEventListener('click', toggleScrollback);
$('zoom-kill').addEventListener('click', killPane);
$('zoom-copy').addEventListener('click', () => copyText($('zoom-attach').textContent, $('zoom-copy')));

// ---------------------------------------------------------------- spawn dialog

const spawn = $('spawn');
const sf = $('spawn-form');

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

function fillPresets() {
  const sel = $('spawn-preset');
  const cur = sel.value || lsGet('th.preset') || '';
  const opts = Object.entries(S.presets).map(([k, p]) => {
    const o = el('option', null, p.label || k);
    o.value = k;
    return o;
  });
  const custom = el('option', null, 'Custom command…');
  custom.value = 'custom';
  sel.replaceChildren(...opts, custom);
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : sel.options[0]?.value || 'custom';
}

function syncSpawnForm() {
  const preset = $('spawn-preset').value;
  const custom = preset === 'custom';
  sf.dataset.custom = String(custom);
  const wt = $('spawn-worktree').checked;
  sf.dataset.worktree = String(wt);
  const takesPrompt = !custom && Boolean(S.presets[preset]?.promptArg);
  $('spawn-prompt').disabled = !takesPrompt;
  $('spawn-args').disabled = custom;
  $('spawn-command').required = custom;
  $('spawn-branch').required = wt;
  let note = '';
  if (custom) note = 'The command runs through /bin/sh -c in the chosen directory. Screen format tells tmuxherd how to read its prompts.';
  else if (!takesPrompt) note = `${S.presets[preset]?.label || preset} does not take a first message.`;
  if (wt) note = `${note} The worktree is created next to the repository as <repo>.worktrees/<branch>, and the agent starts inside it.`.trim();
  $('spawn-note').textContent = note;
}

function openSpawn() {
  dropAll();
  closeSettings();
  fillPresets();
  if (!$('spawn-cwd').value) $('spawn-cwd').value = lsGet('th.cwd') || '';
  $('spawn-error').hidden = true;
  syncSpawnForm();
  spawn.showModal();
  (S.presets[$('spawn-preset').value] ? $('spawn-name') : $('spawn-command')).focus();
}

function closeSpawn() {
  spawn.close();
}

async function submitSpawn(ev) {
  ev.preventDefault();
  const err = $('spawn-error');
  err.hidden = true;
  const preset = $('spawn-preset').value;
  const body = { preset };
  const name = $('spawn-name').value.trim();
  const cwd = $('spawn-cwd').value.trim();
  if (name) body.name = name;
  if (cwd) body.cwd = cwd;
  if (preset === 'custom') {
    body.command = $('spawn-command').value.trim();
    body.harness = $('spawn-harness').value;
    if (!body.command) return showSpawnError('Enter the command to run.', $('spawn-command'));
  } else {
    const prompt = $('spawn-prompt').value;
    const args = $('spawn-args').value.trim();
    if (prompt.trim() && !$('spawn-prompt').disabled) body.prompt = prompt;
    if (args) body.args = args;
  }
  if ($('spawn-worktree').checked) {
    const branch = $('spawn-branch').value.trim();
    const base = $('spawn-base').value.trim();
    if (!branch) return showSpawnError('A worktree needs a branch name.', $('spawn-branch'));
    body.worktree = base ? { branch, base } : { branch };
  }
  const btn = $('spawn-submit');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    const r = await api('POST', '/api/spawn', body);
    lsSet('th.preset', preset);
    if (cwd) lsSet('th.cwd', cwd);
    S.highlightKey = r.key;
    closeSpawn();
    sf.reset();
    $('spawn-cwd').value = cwd;
    $('spawn-preset').value = preset;
    syncSpawnForm();
    toast({ kind: 'ok', title: `Started ${r.name}`, body: shortCwd(r.cwd), ttl: 4000 });
    if (S.panes.has(r.key)) flashTile(r.key);
  } catch (e) {
    showSpawnError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start agent';
  }
}

function showSpawnError(msg, field) {
  const err = $('spawn-error');
  err.textContent = msg;
  err.hidden = false;
  field?.focus();
}

$('new-agent').addEventListener('click', openSpawn);
$('new-agent-empty').addEventListener('click', openSpawn);
$('spawn-cancel').addEventListener('click', closeSpawn);
$('spawn-cancel-x').addEventListener('click', closeSpawn);
$('spawn-preset').addEventListener('change', syncSpawnForm);
$('spawn-worktree').addEventListener('change', () => {
  syncSpawnForm();
  if ($('spawn-worktree').checked) {
    if (!$('spawn-branch').value && $('spawn-name').value) $('spawn-branch').value = $('spawn-name').value.trim();
    $('spawn-branch').focus();
  }
});
sf.addEventListener('submit', submitSpawn);
sf.addEventListener('input', () => {
  $('spawn-error').hidden = true;
});
spawn.addEventListener('click', (ev) => {
  if (ev.target === spawn) closeSpawn(); // backdrop
});

// ---------------------------------------------------------------- settings popover

const pop = $('settings-pop');
const setBtn = $('settings-btn');

function openSettings() {
  fillSettings();
  pop.hidden = false;
  setBtn.setAttribute('aria-expanded', 'true');
  $('cfg-stall').focus();
}
function closeSettings() {
  pop.hidden = true;
  setBtn.setAttribute('aria-expanded', 'false');
}

function fillSettings() {
  const t = S.thresholds;
  const set = (id, v) => {
    if (document.activeElement !== $(id)) $(id).value = v ?? '';
  };
  set('cfg-stall', t.stallMinutes);
  set('cfg-dead', t.deadMinutes);
  set('cfg-waiting', t.waitingMinutes);
  $('cfg-notify-waiting').checked = Boolean(t.notifyWaiting);
  const ch = [];
  ch.push('This page shows alerts while it is open.');
  ch.push(S.notify.desktop ? 'Desktop notifications are on.' : 'Desktop notifications are off.');
  ch.push(S.notify.webhook ? 'A webhook is configured.' : 'No webhook is configured.');
  $('notify-channels').textContent = ch.join(' ');
  renderNotifyBtn();
}

function renderNotifyBtn() {
  const b = $('notify-enable');
  if (!('Notification' in window)) {
    b.disabled = true;
    b.textContent = 'Browser notifications unavailable';
    return;
  }
  const p = Notification.permission;
  b.dataset.perm = p;
  b.disabled = p !== 'default';
  b.textContent = p === 'granted' ? 'Browser notifications on' : p === 'denied' ? 'Browser notifications blocked' : 'Enable browser notifications';
  b.title = p === 'denied' ? 'Allow notifications for this site in your browser settings' : '';
}

let cfgTimer = null;
async function saveConfig() {
  clearTimeout(cfgTimer);
  const body = {};
  const num = (id, k) => {
    const raw = $(id).value.trim();
    if (raw === '') return true;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1440) {
      $(id).setAttribute('aria-invalid', 'true');
      return false;
    }
    $(id).removeAttribute('aria-invalid');
    body[k] = n;
    return true;
  };
  const ok = [num('cfg-stall', 'stallMinutes'), num('cfg-dead', 'deadMinutes'), num('cfg-waiting', 'waitingMinutes')].every(Boolean);
  const status = $('cfg-status');
  if (!ok) {
    status.dataset.kind = 'error';
    status.textContent = 'Minutes must be between 0 and 1440.';
    return;
  }
  body.notifyWaiting = $('cfg-notify-waiting').checked;
  status.dataset.kind = 'busy';
  status.textContent = 'Saving…';
  try {
    const r = await api('POST', '/api/config', body);
    S.thresholds = r.thresholds || S.thresholds;
    status.dataset.kind = 'ok';
    status.textContent = 'Saved. The watchdog uses these values from now on.';
  } catch (e) {
    status.dataset.kind = 'error';
    status.textContent = e.message;
  }
}

setBtn.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (pop.hidden) openSettings();
  else closeSettings();
});
document.addEventListener('click', (ev) => {
  if (!pop.hidden && !pop.contains(ev.target) && ev.target !== setBtn) closeSettings();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || pop.hidden) return;
  const inside = pop.contains(document.activeElement);
  closeSettings();
  if (inside) setBtn.focus();
});
$('cfg-form').addEventListener('input', () => {
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(saveConfig, 500);
});
$('cfg-form').addEventListener('change', saveConfig);
$('cfg-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  saveConfig();
});
$('notify-enable').addEventListener('click', async () => {
  try {
    await Notification.requestPermission();
  } catch {
    /* ignored: the button state shows the outcome */
  }
  renderNotifyBtn();
});
$('test-alert').addEventListener('click', async () => {
  const b = $('test-alert');
  b.disabled = true;
  try {
    await api('POST', '/api/test-alert', {});
  } catch (e) {
    toast({ kind: 'error', title: 'Test alert failed', body: e.message });
  } finally {
    b.disabled = false;
  }
});

// ---------------------------------------------------------------- live data

function applyState(st) {
  S.thresholds = st.thresholds || {};
  S.notify = st.notify || {};
  S.presets = st.presets || {};
  S.socket = st.socket || S.socket;
  S.attach = st.attach || `tmux -L ${S.socket} attach`;
  $('socket-name').textContent = S.socket;
  $('attach-cmd').textContent = S.attach;
  $('empty-socket').textContent = `tmux -L ${S.socket}`;
  learnHome(st.panes || []);

  const keys = new Set((st.panes || []).map((p) => p.key));
  for (const k of [...S.panes.keys()]) {
    if (!keys.has(k)) {
      S.panes.delete(k);
      S.screens.delete(k);
      removeTile(k);
    }
  }
  for (const v of st.panes || []) {
    S.panes.set(v.key, v);
    updateTile(v);
  }
  S.active = new Map((st.alerts || []).map((a) => [a.id, a]));
  if (st.recentAlerts) S.history = st.recentAlerts.slice();
  if (S.zoomKey && !S.panes.has(S.zoomKey)) closeZoom();
  else if (S.zoomKey) renderZoom();
  renderCounts();
  renderInbox();
  renderAlerts();
  if (!pop.hidden) fillSettings();
}

async function refreshState() {
  try {
    applyState(await api('GET', '/api/state'));
  } catch {
    /* the event stream will catch up on reconnect */
  }
}

function setConn(state) {
  const c = $('conn');
  c.dataset.conn = state;
  c.textContent = state === 'live' ? 'live' : state === 'connecting' ? 'connecting' : 'disconnected, retrying';
  S.connected = state === 'live';
  document.body.dataset.conn = state;
}

let es = null;
let retry = 0;
let retryTimer = null;

function connect() {
  clearTimeout(retryTimer);
  es?.close();
  es = new EventSource('/api/events', { withCredentials: true });
  const on = (name, fn) =>
    es.addEventListener(name, (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      fn(data);
    });
  on('hello', (st) => {
    retry = 0;
    setConn('live');
    applyState(st);
  });
  on('screen', ({ key, screen }) => {
    S.screens.set(key, screen);
    markScreen(key);
  });
  on('pane', (v) => {
    const had = S.panes.has(v.key);
    S.panes.set(v.key, v);
    if (!had) learnHome([v]);
    updateTile(v);
    if (S.zoomKey === v.key) renderZoom();
    renderCounts();
    renderInbox();
  });
  on('removed', ({ key }) => {
    S.panes.delete(key);
    S.screens.delete(key);
    removeTile(key);
    for (const [id, a] of S.active) if (a.key === key) S.active.delete(id);
    if (S.zoomKey === key) {
      closeZoom();
      toast({ kind: 'info', title: 'The agent you were viewing is gone', ttl: 4000 });
    }
    renderCounts();
    renderInbox();
    renderAlerts();
  });
  on('config', ({ thresholds }) => {
    if (!thresholds) return;
    S.thresholds = thresholds;
    if (!pop.hidden) fillSettings();
  });
  on('alert', onAlert);
  on('resolve', onResolve);
  es.onopen = () => setConn('live');
  es.onerror = () => {
    setConn('down');
    if (es.readyState === EventSource.CLOSED) {
      // The browser gave up (server restarted, or answered with an error). Back off and retry.
      retry = Math.min(retry + 1, 6);
      retryTimer = setTimeout(connect, 500 * 2 ** retry);
    }
  };
}

// ---------------------------------------------------------------- boot

for (const b of document.querySelectorAll('.count')) b.addEventListener('click', () => setFilter(b.dataset.count));
$('filter-clear').addEventListener('click', () => setFilter(S.filter));
$('attach-copy').appendChild(icon('copy'));
$('attach-copy').addEventListener('click', () => copyText(S.attach, $('attach-copy')));
$('zoom-copy').appendChild(icon('copy'));
$('zoom-close').appendChild(icon('close'));
$('spawn-cancel-x').appendChild(icon('close'));
setBtn.appendChild(icon('gear'));

// Relative times ("for 3m") tick without waiting for a state change.
setInterval(() => {
  for (const [k, t] of S.tiles) {
    const v = S.panes.get(k);
    if (v) updatePill(t.pill, v);
  }
  if (S.zoomKey) {
    const v = S.panes.get(S.zoomKey);
    if (v) updatePill($('zoom-pill'), v);
  }
  for (const item of $('inbox-list').children) {
    const v = S.panes.get(item.dataset.key);
    const when = item.querySelector('.inbox-when');
    if (v && when && v.since) when.textContent = fmtDur(Date.now() - v.since);
  }
}, 5000);

window.addEventListener('scroll', dropAll, { passive: true });
window.addEventListener('resize', dropAll);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.zoomKey) pokeFocus();
});

setConn('connecting');
renderCounts();
renderAlerts();
connect();
