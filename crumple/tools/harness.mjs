// Headless browser harness: bundle an ES module entry, run it in Chromium (software WebGL),
// collect console output, the value of window.__result, and screenshots.
//
//   node tools/harness.mjs <entry.js> [--out shot.png] [--w 390] [--h 844] [--dpr 1]
//                                      [--wait 8000] [--touch] [--css] [--markup]
//
// The entry runs as the page's only script. It can import 'three' and anything in src/.
// Protocol with the page:
//   window.__done = true            -> harness stops waiting (otherwise --wait ms timeout)
//   window.__result = any JSON      -> printed as RESULT <json>
//   window.__shots = ['name', ...]  -> not needed; instead call `await window.__shot('name')`
//                                      from the page to save <out-dir>/<name>.png at that moment.
// --css / --markup inline src/styles.css and src/page.html into the page (for UI work).
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';
import { bundle, inlineSafe } from '../build.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

export async function runHarness({
  entry,
  html, // alternative to entry: a full HTML string or file path to load as-is
  out,
  w = 390,
  h = 844,
  dpr = 1,
  wait = 8000,
  touch = false,
  css = false,
  markup = false,
  onPage, // async (page) => {} : drive the page with Playwright after load
} = {}) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
  }
  let pageHtml;
  if (html) {
    pageHtml = fs.existsSync(html) ? fs.readFileSync(html, 'utf8') : html;
  } else {
    const js = await bundle(path.resolve(entry), { minify: false });
    const cssText = css ? fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8') : '';
    const markupText = markup ? fs.readFileSync(path.join(root, 'src/page.html'), 'utf8') : '';
    pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>html,body{margin:0;height:100%}[hidden]{display:none!important}${cssText}</style></head><body>${markupText}<script>${inlineSafe(js)}</script></body></html>`;
  }
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: +dpr,
    hasTouch: !!touch,
    isMobile: !!touch,
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));
  const outDir = out ? path.dirname(path.resolve(out)) : process.cwd();
  await page.exposeFunction('__shot', async (name) => {
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  });
  const tmp = path.join(root, 'dist', `.harness-${process.pid}-${Math.floor(performance.now())}.html`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, pageHtml);
  let result;
  try {
    await page.goto(url.pathToFileURL(tmp).href);
    if (onPage) await onPage(page);
    await page.waitForFunction(() => window.__done === true, null, { timeout: +wait }).catch(() => {});
    result = await page.evaluate(() => (window.__result === undefined ? null : window.__result));
    if (out) await page.screenshot({ path: path.resolve(out) });
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
  return { logs, result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const entry = process.argv[2];
  if (!entry || entry.startsWith('--')) {
    console.error('usage: node tools/harness.mjs <entry.js|page.html> [--out shot.png] [--w 390] [--h 844] [--dpr 1] [--wait 8000] [--touch] [--css] [--markup]');
    process.exit(2);
  }
  const isHtml = entry.endsWith('.html');
  const { logs, result } = await runHarness({
    entry: isHtml ? undefined : entry,
    html: isHtml ? entry : undefined,
    out: arg('out'),
    w: arg('w', 390),
    h: arg('h', 844),
    dpr: arg('dpr', 1),
    wait: arg('wait', 8000),
    touch: !!arg('touch', false),
    css: !!arg('css', false),
    markup: !!arg('markup', false),
  });
  for (const l of logs) console.log(l);
  console.log('RESULT ' + JSON.stringify(result));
  if (logs.some((l) => l.startsWith('[pageerror]'))) process.exitCode = 1;
}
