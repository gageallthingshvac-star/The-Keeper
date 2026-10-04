#!/usr/bin/env node
// Bundles Sunny Sports into ONE self-contained HTML file: every stylesheet, script, font and audio bank
// (core + every per-sport js/audio-bank-*.js) inlined.
//
//   node tools/build.mjs --out dist/sunny-sports.html            full standalone document
//   node tools/build.mjs --out page.html --fragment              no doctype/html/head/body wrapper
//                                                                (for hosts that add their own skeleton)
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf('--' + name); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const out = path.resolve(opt('out') || path.join(root, 'dist', 'sunny-sports.html'));
const fragment = !!opt('fragment');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fontURI = (file) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'fonts', path.basename(file))).toString('base64');
// A literal "</script" inside inlined code would end the tag early; "<\/script" means the same thing in JS.
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');
const safeStyle = (css) => css.replace(/<\/style/gi, '<\\/style');

const html = read('index.html');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

// style.css carries every @font-face, so the boot <style>'s duplicates are dropped.
const css = read('css/style.css').replace(/url\(['"]?\.\.\/fonts\/([^'")]+)['"]?\)/g, (_, f) => `url('${fontURI(f)}')`);
let headOut = head
  .replace(/@font-face\s*\{[^}]*\}/g, '')
  .replace(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>\n${safeStyle(css)}\n</style>`);
if (fragment) headOut = headOut.replace(/<meta charset[^>]*>\s*/i, '');

// The per-sport sample banks are loaded on demand by js/audio.js in the multi-file build; a single
// file cannot load anything, so every bank is inlined right after the core bank.
const sportBanks = fs.readdirSync(path.join(root, 'js')).filter(f => /^audio-bank-[a-z]+\.js$/.test(f)).sort().map(f => 'js/' + f);
const inline = (src) => `<script>\n${safeScript(read(src))}\n</script>`;
const bodyOut = body.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  src === 'js/audio-bank.js' ? [src, ...sportBanks].map(inline).join('\n') : inline(src));
if (!body.includes('<script src="js/audio-bank.js"></script>')) { console.error('index.html does not load js/audio-bank.js'); process.exit(1); }

const doc = fragment
  ? `${headOut.trim()}\n${bodyOut.trim()}\n`
  : `<!DOCTYPE html>\n<html lang="en">\n<head>${headOut}</head>\n<body>${bodyOut}</body>\n</html>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
const left = doc.match(/<(?:script|link)[^>]+(?:src|href)="(?!data:|https?:)[^"]+"/g);
console.log(`wrote ${out} (${(doc.length / 1024).toFixed(0)} KB${fragment ? ', fragment' : ''})`);
if (left) { console.error('unresolved local references:', left); process.exit(1); }
