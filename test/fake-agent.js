#!/usr/bin/env node
// A scripted stand-in for a coding agent TUI, used by integration and e2e tests
// (and CI, where real agents have no credentials). Its screens imitate the
// structure recorded from Claude Code: spinner line, boxed permission prompt
// with a ❯ cursor, and an input box between rules.
//
// Usage: fake-agent.js <scenario> [--file name]
//   permission  ask to create <file>; Up/Down/Enter answer; then idle
//   stall       spin forever with a ticking timer and no progress
//   error       work briefly, then print an API error and go idle
//   crash       work briefly, then exit with status 3
//   idle        sit at the input prompt; typed lines trigger a short "turn"

import fs from 'node:fs';

const scenario = process.argv[2] || 'idle';
const fileArg = process.argv.indexOf('--file');
const file = fileArg > 0 ? process.argv[fileArg + 1] : 'fake.txt';
const cols = Math.min(process.stdout.columns || 100, 120);
const rule = '─'.repeat(cols);
const transcript = ['', ' ✻ fake-agent v1 (Claude-style test double)', ''];
let footer = null; // lines drawn under the transcript
let input = '';
let selected = 0;
let spinnerStart = 0;
let spinnerTimer = null;
const options = ['Yes', `Yes, and don't ask again for: touch ${file}`, 'No'];

function draw() {
  const out = ['\x1b[2J\x1b[H', ...transcript];
  if (footer) out.push(...footer());
  process.stdout.write(out.join('\r\n'));
}

function inputBox() {
  return [rule, `❯ ${input}`, rule, '  ⏸ manual mode on'];
}

function promptBox() {
  return [
    rule,
    ' Bash command',
    '',
    `   touch ${file}`,
    '   Create the requested file',
    '',
    ' Do you want to proceed?',
    ...options.map((o, i) => `${i === selected ? ' ❯' : '  '} ${i + 1}. ${o}`),
    '',
    ' Esc to cancel · Tab to amend',
  ];
}

function spin(verb) {
  spinnerStart = Date.now();
  const frames = ['·', '✢', '✳', '✶', '✻', '✽'];
  let n = 0;
  footer = () => [`${frames[n % frames.length]} ${verb}… (${Math.floor((Date.now() - spinnerStart) / 1000)}s · ↓ 12 tokens)`, '', ...inputBox()];
  spinnerTimer = setInterval(() => {
    n++;
    draw();
  }, 500);
  draw();
}

function stopSpin() {
  clearInterval(spinnerTimer);
  spinnerTimer = null;
}

function idle() {
  stopSpin();
  footer = inputBox;
  draw();
}

function turn(task, after) {
  transcript.push(`❯ ${task}`);
  spin('Working');
  setTimeout(() => {
    stopSpin();
    after();
  }, 1500);
}

let mode = 'idle';
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (buf) => {
  const s = buf.toString('utf8');
  if (s === '\x03') process.exit(130);
  if (mode === 'prompt') {
    if (s === '\x1b[A') selected = Math.max(0, selected - 1);
    else if (s === '\x1b[B') selected = Math.min(options.length - 1, selected + 1);
    else if (s === '\r') {
      mode = 'idle';
      if (selected < 2) {
        fs.writeFileSync(file, 'created by fake-agent\n');
        transcript.push(`● Bash(touch ${file})`, '  ⎿  (no output)', '', `● Created ${file}.`, '', '✻ Worked for 2s · done');
      } else {
        transcript.push('  ⎿  User rejected the command', '', '✻ Worked for 2s · done');
      }
      idle();
      return;
    } else if (s === '\x1b') {
      mode = 'idle';
      transcript.push('  ⎿  Interrupted by user');
      idle();
      return;
    }
    draw();
    return;
  }
  // idle input line
  if (s === '\r') {
    const task = input;
    input = '';
    if (task) turn(task, () => {
      transcript.push(`● Done: ${task}`, '', '✻ Worked for 1s · done');
      idle();
    });
    else draw();
  } else if (s === '\x7f') {
    input = input.slice(0, -1);
    draw();
  } else if (!s.startsWith('\x1b')) {
    input += s;
    draw();
  }
});

switch (scenario) {
  case 'permission':
    turn(`create ${file}`, () => {
      transcript.push('● Bash(touch ' + file + ')');
      mode = 'prompt';
      footer = promptBox;
      draw();
    });
    break;
  case 'stall':
    transcript.push('❯ refactor the parser');
    spin('Pondering');
    break;
  case 'error':
    turn('summarize the repo', () => {
      transcript.push('● API Error: Connection refused (ECONNREFUSED)', '', '✻ Worked for 1s · done');
      idle();
    });
    break;
  case 'crash':
    turn('run the migration', () => {
      process.stdout.write('\r\nfatal: simulated crash\r\n');
      process.exit(3);
    });
    break;
  default:
    idle();
}
