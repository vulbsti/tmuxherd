// Guard: recorded captures must not carry the recorder's local setup.
// Checks the ANSI-stripped text, because styled captures can split a word
// across colour codes and slip past a plain grep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripAnsi } from '../src/detect.js';

const dir = new URL('./fixtures/captures/', import.meta.url);
const RULES = [
  ['home path', /\/(home|Users)\/[A-Za-z0-9._-]+/],
  ['real session UUID', /\b(?!0{8}-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/],
  ['account plan name', /Claude (Max|Pro|Team|Enterprise)\b/],
  ['slash-command menu row (lists installed skills/plugins)', /^\s{2,}\/[a-z][\w-]*(:[\w-]+)?\s{3,}\S/m],
  ['email address', /[\w.+-]+@[\w-]+\.[\w.]+/],
];

for (const name of fs.readdirSync(dir).filter((f) => /\.(txt|ansi)$/.test(f))) {
  test(`fixture ${name} carries no local setup details`, () => {
    const text = stripAnsi(fs.readFileSync(new URL(name, dir), 'utf8'));
    for (const [what, re] of RULES) assert.doesNotMatch(text, re, `${name}: ${what}`);
  });
}
