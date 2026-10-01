#!/usr/bin/env node
// Headless playtest driver for Sunny Sports.
//
//   node tools/shoot.mjs --url "index.html?sport=bowling&skip=1" --size 390x844 \
//        --out /tmp/shots --steps '[{"wait":1500},{"shot":"start"}]'
//
// --steps takes inline JSON or a path to a .json file. Coordinates are viewport
// fractions (0..1). Steps:
//   {"wait": ms}                                   real-time sleep
//   {"waitFor": "js expr", "timeout": ms}          poll until truthy
//   {"shot": "name"}                               screenshot -> <out>/<name>.png
//   {"burst": {"name":"n","count":6,"interval":250}} n-0.png .. n-5.png
//   {"tap": [fx, fy]}
//   {"swipe": {"from":[fx,fy],"to":[fx,fy],"ms":220,"bend":0.0,"steps":14,"hold":0}}
//        bend: sideways bow as a fraction of swipe length (+ = bows to the right of travel)
//        hold: ms to hold still at "from" before moving
//   {"drag": {"path":[[fx,fy],...], "ms":400}}     polyline drag
//   {"down":[fx,fy]} {"move":[fx,fy]} {"up":true}
//   {"key": "Space"}                               keyboard press (Playwright key name)
//   {"eval": "js expr"}                            prints JSON result
//   {"log": "text"}
// Console errors and page errors are printed at the end with a count.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const target = args.url || 'index.html';
const pageUrl = /^https?:|^file:/.test(target) ? target : url.pathToFileURL(path.join(root, target.split('?')[0])).href + (target.includes('?') ? '?' + target.split('?').slice(1).join('?') : '');
const [W, H] = String(args.size || '390x844').split('x').map(Number);
const out = path.resolve(args.out || '/tmp/ss-shots');
fs.mkdirSync(out, { recursive: true });
let steps = [];
if (args.steps) {
  const s = String(args.steps);
  steps = JSON.parse(fs.existsSync(s) ? fs.readFileSync(s, 'utf8') : s);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(args.dpr || 1) });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => {
  const t = m.type();
  if (t === 'error') errors.push('console.error: ' + m.text());
  if (args.verbose || t === 'error' || t === 'warning') console.log(`[${t}] ${m.text()}`);
});
page.on('pageerror', e => { errors.push('pageerror: ' + (e.stack || e.message)); console.log('[pageerror]', e.stack || e.message); });

const px = ([fx, fy]) => [fx * W, fy * H];
const sleep = ms => page.waitForTimeout(ms);

await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
console.log('loaded', pageUrl, `${W}x${H}`);

for (const step of steps) {
  const k = Object.keys(step)[0];
  const v = step[k];
  try {
    if (k === 'wait') await sleep(v);
    else if (k === 'waitFor') await page.waitForFunction(v, null, { timeout: step.timeout || 15000, polling: 100 });
    else if (k === 'shot') { await page.screenshot({ path: path.join(out, v + '.png') }); console.log('shot', path.join(out, v + '.png')); }
    else if (k === 'burst') {
      for (let i = 0; i < (v.count || 6); i++) {
        await page.screenshot({ path: path.join(out, `${v.name}-${i}.png`) });
        await sleep(v.interval || 250);
      }
      console.log('burst', v.name, v.count || 6);
    }
    else if (k === 'tap') { const [x, y] = px(v); await page.mouse.click(x, y); }
    else if (k === 'down') { const [x, y] = px(v); await page.mouse.move(x, y); await page.mouse.down(); }
    else if (k === 'move') { const [x, y] = px(v); await page.mouse.move(x, y, { steps: 4 }); }
    else if (k === 'up') await page.mouse.up();
    else if (k === 'key') await page.keyboard.press(v);
    else if (k === 'swipe') {
      const [x0, y0] = px(v.from), [x1, y1] = px(v.to);
      const n = v.steps || 14, ms = v.ms || 220, bend = v.bend || 0;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      // right-hand normal of travel direction in screen space (y down)
      const nx = -dy / len, ny = dx / len;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      if (v.hold) await sleep(v.hold);
      for (let i = 1; i <= n; i++) {
        const t = i / n, b = Math.sin(Math.PI * t) * bend * len;
        await page.mouse.move(x0 + dx * t + nx * b, y0 + dy * t + ny * b);
        await sleep(ms / n);
      }
      await page.mouse.up();
    }
    else if (k === 'drag') {
      const pts = v.path.map(px), ms = v.ms || 400;
      await page.mouse.move(...pts[0]);
      await page.mouse.down();
      for (let i = 1; i < pts.length; i++) { await page.mouse.move(...pts[i], { steps: 3 }); await sleep(ms / pts.length); }
      await page.mouse.up();
    }
    else if (k === 'eval') { const r = await page.evaluate(v); console.log('eval', v.slice(0, 80), '=>', JSON.stringify(r)); }
    else if (k === 'log') console.log('--', v);
    else console.log('unknown step', k);
  } catch (e) {
    errors.push(`step ${k} failed: ${e.message}`);
    console.log(`step ${k} failed:`, e.message);
  }
}

console.log(`ERRORS: ${errors.length}`);
for (const e of errors) console.log('  ' + e.split('\n').slice(0, 4).join('\n    '));
await browser.close();
