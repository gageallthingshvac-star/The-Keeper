// Builds the game into single self-contained pages.
//   node build.mjs            -> ../crumple.html (standalone, three.js bundled in)
//                                dist/crumple.artifact.html (page fragment, three.js from CDN)
//   node build.mjs --dev      -> same, unminified with inline sourcemap
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(url.fileURLToPath(import.meta.url));
const src = (p) => path.join(root, 'src', p);
const dev = process.argv.includes('--dev');

export const TITLE = 'Crumple League';
export const THREE_VERSION = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules/three/package.json'), 'utf8')
).version;
export const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.min.js`;

// Resolves `import ... from 'three'` to the global THREE (for the CDN build).
const threeGlobal = {
  name: 'three-global',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, (a) => ({ path: a.path, namespace: 'three-global' }));
    b.onLoad({ filter: /.*/, namespace: 'three-global' }, () => ({
      contents: 'module.exports = window.THREE;',
      loader: 'js',
    }));
  },
};

export async function bundle(entry, { externalThree = false, minify = !dev } = {}) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    minify,
    sourcemap: dev ? 'inline' : false,
    target: 'es2020',
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
    absWorkingDir: root,
    // lets entries outside this folder (test pages, scratch files) import 'three' and src/
    nodePaths: [path.join(root, 'node_modules')],
    alias: { '@src': path.join(root, 'src') },
    plugins: externalThree ? [threeGlobal] : [],
  });
  return r.outputFiles[0].text;
}

// A script body must never contain a literal closing tag or HTML comment opener.
export const inlineSafe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// Mirrors the reset the artifact host wraps a page in, so both builds lay out the same.
const HOST_RESET =
  ':root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}';

export function standalonePage({ css, markup, js }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
<title>${TITLE}</title>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="${TITLE}" />
<meta name="theme-color" content="#0e1524" />
<style>${HOST_RESET}</style>
<style>
${css}
</style>
</head>
<body>
${markup}
<script>
${inlineSafe(js)}
</script>
</body>
</html>
`;
}

export function artifactPage({ css, markup, js }) {
  return `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
${markup}
<script src="${THREE_CDN}"></script>
<script>
${inlineSafe(js)}
</script>
`;
}

async function main() {
  const css = fs.readFileSync(src('styles.css'), 'utf8');
  const markup = fs.readFileSync(src('page.html'), 'utf8');

  const jsFull = await bundle(src('main.js'));
  const standalone = standalonePage({ css, markup, js: jsFull });
  const outStandalone = path.join(root, '..', 'crumple.html');
  fs.writeFileSync(outStandalone, standalone);

  const jsExt = await bundle(src('main.js'), { externalThree: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const outArtifact = path.join(root, 'dist', 'crumple.artifact.html');
  fs.writeFileSync(outArtifact, artifactPage({ css, markup, js: jsExt }));

  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
  console.log(`crumple.html              ${kb(standalone)}  (three r${THREE_VERSION} bundled)`);
  console.log(`dist/crumple.artifact.html ${kb(fs.readFileSync(outArtifact, 'utf8'))}  (three from CDN)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
