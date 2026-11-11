// Render every assets/*.svg to PNG the way a GitHub README shows it: as an
// <img> on the light (#ffffff) and the dark (#0d1117) page background.
//
//   node assets/src/render-svgs.mjs [scale] [delayMs]
//
// Output: assets/src/render/<name>.on-light.png and <name>.on-dark.png
// (gitignored). `delayMs` waits before the screenshot, to catch a later
// frame of a CSS animation; the default 0 shows the first frame.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..');
const out = path.join(here, 'render');
const scale = Number(process.argv[2] || 1);
const delay = Number(process.argv[3] || 0);
fs.mkdirSync(out, { recursive: true });

const backgrounds = { light: '#ffffff', dark: '#0d1117' };
const svgs = fs.readdirSync(assets).filter((f) => f.endsWith('.svg')).sort();

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1040, height: 800 } });
for (const file of svgs) {
  const url = pathToFileURL(path.join(assets, file)).href;
  for (const [mode, bg] of Object.entries(backgrounds)) {
    // GitHub caps README images at the column width (about 1012 px wide).
    // A file:// page, so the file:// image is allowed to load.
    const html = path.join(out, '_page.html');
    fs.writeFileSync(html, `<!doctype html><body style="margin:0;padding:24px;background:${bg}">
      <img id="i" src="${url}" style="display:block;max-width:100%"></body>`);
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => document.getElementById('i').complete);
    if (delay) await page.waitForTimeout(delay);
    const dest = path.join(out, `${file.replace(/\.svg$/, '')}.on-${mode}${delay ? `.t${delay}` : ''}.png`);
    await page.locator('body').screenshot({ path: dest });
    console.log(path.relative(assets, dest));
  }
}
await browser.close();
