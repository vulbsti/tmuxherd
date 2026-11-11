// State detection on screens recorded from real Claude Code / Codex / Pi runs
// in sandbox directories (see test/fixtures/captures/README.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect, findPrompt, progressKey, stripAnsi } from '../src/detect.js';

const dir = new URL('./fixtures/captures/', import.meta.url);
const expectations = JSON.parse(fs.readFileSync(new URL('./fixtures/expectations.json', import.meta.url), 'utf8'));

for (const [file, want] of Object.entries(expectations)) {
  for (const ext of ['txt', 'ansi']) {
    const name = file.replace(/\.txt$/, `.${ext}`);
    const url = new URL(name, dir);
    if (!fs.existsSync(url)) continue;
    test(`${name} → ${want.state}${want.prompt ? ` (${want.prompt.kind})` : ''}`, () => {
      const screen = fs.readFileSync(url, 'utf8');
      // In production the pane's current command names the harness.
      const d = detect(screen, { command: want.harness });
      // Without the hint the screen-only fallback may not know, but must never guess wrong.
      assert.ok([want.harness, 'generic'].includes(detect(screen).harness), 'screen-only harness fallback');
      assert.equal(d.harness, want.harness);
      assert.equal(d.state, want.state);
      if ('retrying' in want) assert.equal(d.retrying, want.retrying);
      if ('error' in want) assert.equal(Boolean(d.error), want.error);
      if (!want.prompt) {
        assert.equal(d.prompt, null);
        return;
      }
      const p = d.prompt;
      assert.equal(p.kind, want.prompt.kind);
      if (want.prompt.question) assert.equal(p.question, want.prompt.question);
      if (want.prompt.options) assert.deepEqual(p.options.map((o) => o.label), want.prompt.options);
      if (want.prompt.optionCount) assert.equal(p.options.length, want.prompt.optionCount);
      assert.equal(p.selected, want.prompt.selected);
      if (want.prompt.contextIncludes) assert.ok(p.context.some((l) => l.includes(want.prompt.contextIncludes)), p.context.join('\n'));
    });
  }
}

test('ANSI and plain captures of the same prompt give the same fingerprint', () => {
  const plain = detect(fs.readFileSync(new URL('claude-perm-bash.txt', dir), 'utf8'));
  const ansi = detect(fs.readFileSync(new URL('claude-perm-bash.ansi', dir), 'utf8'));
  assert.equal(plain.prompt.fingerprint, ansi.prompt.fingerprint);
});

test('the fingerprint ignores cursor position but not the options', () => {
  const screen = stripAnsi(fs.readFileSync(new URL('claude-perm-edit.txt', dir), 'utf8'));
  const moved = screen.replace(' ❯ 1. Yes', '   1. Yes').replace('   2. Yes, and', ' ❯ 2. Yes, and');
  const a = findPrompt(screen.split('\n'));
  const b = findPrompt(moved.split('\n'));
  assert.equal(b.selected, 1);
  assert.equal(a.fingerprint, b.fingerprint);
  const other = screen.replace('second.txt?', 'third.txt?');
  assert.notEqual(findPrompt(other.split('\n')).fingerprint, a.fingerprint);
});

test('a numbered list in agent output is not mistaken for a prompt', () => {
  const screen = [
    '● Here is the plan:',
    '  1. Read the config',
    '  2. Update the parser',
    '  3. Run the tests',
    '',
    '────────────────────────────────────────',
    '❯ ',
    '────────────────────────────────────────',
  ].join('\n');
  const d = detect(screen, { harness: 'claude' });
  assert.equal(d.prompt, null);
  assert.equal(d.state, 'idle');
});

test('a ticking timer and animated spinner do not count as progress', () => {
  const a = '✻ Infusing… (3s · ↓ 94 tokens)\n  ⎿  Running… (3s)';
  const b = '✶ Moseying… (47s · ↓ 94 tokens)\n  ⎿  Running… (45s)';
  const c = '✶ Moseying… (47s · ↓ 94 tokens)\n  ⎿  hello\n  ⎿  Running… (45s)';
  assert.equal(progressKey(a), progressKey(b));
  assert.notEqual(progressKey(b), progressKey(c));
});

test('an old error above a later successful turn is not reported', () => {
  const screen = [
    '❯ Say hi',
    '● API Error: Connection refused (ECONNREFUSED)',
    '❯ try again',
    '● Hi!',
    '✻ Worked for 2s · done',
    '● Anything else?',
    '',
    '────────────────────────────────────────',
    '❯ ',
    '────────────────────────────────────────',
  ].join('\n');
  assert.equal(detect(screen, { harness: 'claude' }).error, null);
});
