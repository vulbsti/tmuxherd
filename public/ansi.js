// ANSI SGR -> DOM renderer for `tmux capture-pane -e -p` output.
//
// Pane text is untrusted: everything is built with createElement/textContent,
// never innerHTML. The 16 basic colours map to CSS classes (fg0..fg15,
// bg0..bg15) so the theme owns them; 256-colour and truecolor values are set
// through the CSSOM (el.style), which the page's CSP allows.
// Non-SGR escapes (cursor movement, OSC titles, DCS, charset selection) are dropped.

const CUBE = [0, 95, 135, 175, 215, 255];

/** xterm 256-colour index (16..255) -> [r, g, b]. */
export function xterm256(n) {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return [v, v, v];
  }
  const i = n - 16;
  return [CUBE[Math.floor(i / 36)], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]];
}

function freshStyle() {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false, strike: false, hidden: false };
}

// A colour is null (default), {i: 0..255} or {rgb: [r, g, b]}.
function colorKey(c) {
  if (!c) return '-';
  return c.rgb ? c.rgb.join(',') : `i${c.i}`;
}

function styleKey(s) {
  return [colorKey(s.fg), colorKey(s.bg), +s.bold, +s.dim, +s.italic, +s.underline, +s.inverse, +s.strike, +s.hidden].join('|');
}

const DEFAULT_KEY = styleKey(freshStyle());

/** Read an extended colour (38/48/58) starting at params[at]. Returns [colour|null, consumed]. */
function extendedColor(params, at) {
  const p = params[at];
  // Colon form arrives as one parameter: "38:5:n" or "38:2:[cs]:r:g:b".
  if (p.includes(':')) {
    const sub = p.split(':').map((x) => (x === '' ? null : Number(x)));
    if (sub[1] === 5 && sub[2] != null) return [{ i: clamp(sub[2], 0, 255) }, 1];
    if (sub[1] === 2) {
      const rgb = sub.length >= 6 ? sub.slice(3, 6) : sub.slice(2, 5);
      if (rgb.length === 3 && rgb.every((v) => v != null)) return [{ rgb: rgb.map((v) => clamp(v, 0, 255)) }, 1];
    }
    return [null, 1];
  }
  const mode = Number(params[at + 1]);
  if (mode === 5) return [{ i: clamp(Number(params[at + 2]) || 0, 0, 255) }, 3];
  if (mode === 2) {
    const rgb = [params[at + 2], params[at + 3], params[at + 4]].map((v) => clamp(Number(v) || 0, 0, 255));
    return [{ rgb }, 5];
  }
  return [null, 1];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function applySgr(s, raw) {
  const params = raw === '' ? ['0'] : raw.split(';');
  for (let k = 0; k < params.length; ) {
    const p = params[k];
    const head = p.includes(':') ? Number(p.split(':')[0]) : Number(p === '' ? 0 : p);
    if (head === 38 || head === 48 || head === 58) {
      const [c, used] = extendedColor(params, k);
      if (head === 38) s.fg = c;
      else if (head === 48) s.bg = c;
      k += used;
      continue;
    }
    k++;
    if (head === 0) Object.assign(s, freshStyle());
    else if (head === 1) s.bold = true;
    else if (head === 2) s.dim = true;
    else if (head === 3) s.italic = true;
    else if (head === 4) s.underline = p.includes(':') ? p.split(':')[1] !== '0' : true;
    else if (head === 7) s.inverse = true;
    else if (head === 8) s.hidden = true;
    else if (head === 9) s.strike = true;
    else if (head === 21) s.underline = true; // double underline
    else if (head === 22) s.bold = s.dim = false;
    else if (head === 23) s.italic = false;
    else if (head === 24) s.underline = false;
    else if (head === 27) s.inverse = false;
    else if (head === 28) s.hidden = false;
    else if (head === 29) s.strike = false;
    else if (head >= 30 && head <= 37) s.fg = { i: head - 30 };
    else if (head === 39) s.fg = null;
    else if (head >= 40 && head <= 47) s.bg = { i: head - 40 };
    else if (head === 49) s.bg = null;
    else if (head >= 90 && head <= 97) s.fg = { i: head - 90 + 8 };
    else if (head >= 100 && head <= 107) s.bg = { i: head - 100 + 8 };
  }
}

// Paint one colour onto a span. role is 'fg' or 'bg'. `swapped` marks a
// default colour that inverse video moved to the other side.
function paint(span, cls, role, c, swappedDefault) {
  if (!c) {
    if (swappedDefault) cls.push(role === 'fg' ? 'fg-inv' : 'bg-inv');
    return;
  }
  if (c.i != null && c.i < 16) {
    cls.push(`${role}${c.i}`);
    return;
  }
  const [r, g, b] = c.rgb || xterm256(c.i);
  const css = `rgb(${r}, ${g}, ${b})`;
  if (role === 'fg') span.style.color = css;
  else span.style.backgroundColor = css;
}

function makeSpan(doc, s, text) {
  const span = doc.createElement('span');
  const cls = [];
  let fg = s.fg;
  let bg = s.bg;
  if (s.inverse) {
    [fg, bg] = [bg, fg];
    // Default colours swap too: fg becomes the terminal background and vice versa.
    paint(span, cls, 'fg', fg, !fg);
    paint(span, cls, 'bg', bg, !bg);
  } else {
    paint(span, cls, 'fg', fg, false);
    paint(span, cls, 'bg', bg, false);
  }
  if (s.bold) cls.push('b');
  if (s.dim) cls.push('d');
  if (s.italic) cls.push('i');
  if (s.underline && s.strike) cls.push('us');
  else if (s.underline) cls.push('u');
  else if (s.strike) cls.push('s');
  if (s.hidden) cls.push('h');
  if (cls.length) span.className = cls.join(' ');
  span.textContent = text;
  return span;
}

/**
 * Render a styled tmux capture into a DocumentFragment.
 * @param {string} text  capture-pane -e output
 * @param {Document} [doc]
 * @returns {DocumentFragment}
 */
export function renderAnsi(text, doc = document) {
  const frag = doc.createDocumentFragment();
  const s = freshStyle();
  let key = DEFAULT_KEY;
  let buf = '';
  const flush = () => {
    if (!buf) return;
    frag.appendChild(key === DEFAULT_KEY ? doc.createTextNode(buf) : makeSpan(doc, s, buf));
    buf = '';
  };

  const str = String(text ?? '');
  const n = str.length;
  for (let i = 0; i < n; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 0x1b) {
      const next = str[i + 1];
      if (next === '[') {
        // CSI: parameter bytes 0x30-0x3F, intermediates 0x20-0x2F, final 0x40-0x7E.
        let j = i + 2;
        while (j < n && str.charCodeAt(j) >= 0x20 && str.charCodeAt(j) <= 0x3f) j++;
        while (j < n && str.charCodeAt(j) >= 0x20 && str.charCodeAt(j) <= 0x2f) j++;
        if (j >= n) break;
        const final = str[j];
        const params = str.slice(i + 2, j);
        if (final === 'm' && /^[0-9;:]*$/.test(params)) {
          const before = key;
          // Apply to a copy first so we only split the run when the style really changes.
          const probe = { ...s };
          applySgr(probe, params);
          const after = styleKey(probe);
          if (after !== before) {
            flush();
            Object.assign(s, probe);
            key = after;
          }
        }
        i = j;
      } else if (next === ']' || next === 'P' || next === '^' || next === '_' || next === 'X') {
        // OSC / DCS / PM / APC / SOS: skip to BEL or ST (ESC \).
        let j = i + 2;
        while (j < n) {
          if (str.charCodeAt(j) === 0x07) break;
          if (str.charCodeAt(j) === 0x1b && str[j + 1] === '\\') {
            j++;
            break;
          }
          j++;
        }
        i = j;
      } else if (next === '(' || next === ')' || next === '*' || next === '+' || next === '#' || next === '%') {
        i += 2; // charset designation: ESC ( B
      } else {
        i += 1; // two-byte escape such as ESC = or ESC 7
      }
      continue;
    }
    if (ch === 0x0a || ch === 0x09) {
      buf += str[i];
      continue;
    }
    if (ch < 0x20 || ch === 0x7f) continue; // other C0 controls, including CR
    buf += str[i];
  }
  flush();
  return frag;
}

