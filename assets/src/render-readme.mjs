// Renders README.md the way GitHub does (GitHub's markdown API + github-markdown-css)
// and screenshots it in light and dark, to check every README asset in both themes.
//   GH_TOKEN=… node assets/src/render-readme.mjs   → assets/src/render/readme-{light,dark}.png
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const out = path.join(root, 'assets/src/render');
fs.mkdirSync(out, { recursive: true });
const html = execFileSync('gh', ['api', 'markdown', '-f', `text=${fs.readFileSync(path.join(root, 'README.md'), 'utf8')}`, '-f', 'mode=gfm', '-f', 'context=vulbsti/tmuxherd'], { encoding: 'utf8' });
const css = await (await fetch('https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown.css')).text();
const page = `<!doctype html><html><head><meta charset="utf-8"><base href="file://${root}">
<style>${css} body{margin:0;padding:32px;background:var(--bgColor-default,#fff)} .markdown-body{max-width:880px;margin:0 auto}
@media (prefers-color-scheme: dark){body{background:#0d1117}}</style></head>
<body><article class="markdown-body">${html}</article></body></html>`;
const file = path.join(out, 'readme.html');
fs.writeFileSync(file, page);
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const p = await browser.newPage({ viewport: { width: 944, height: 900 }, colorScheme: scheme });
  await p.goto(`file://${file}`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, `readme-${scheme}.png`), fullPage: true });
  await p.close();
}
await browser.close();
console.log('ok');
