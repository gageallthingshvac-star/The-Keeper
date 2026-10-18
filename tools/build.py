#!/usr/bin/env python3
"""Build irontide.html: one self-contained, offline file.

Inlines src/style.css, vendor/three.r158.min.js and the game modules listed in
MODULES (in dependency order) into src/index.html. Run from anywhere:
    python3 tools/build.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
MODULES = ['util', 'data', 'design', 'sim', 'ai', 'progress',
           'audio', 'gfx', 'shipviz', 'yard', 'battle', 'ui', 'main']

def three_lib():
    lib = (ROOT / 'vendor' / 'three.r158.min.js').read_text()
    first, rest = lib.split('\n', 1)
    # r158's UMD build starts with a deprecation console.warn(...), — keep the comma expression valid
    if first.startswith('console.warn('):
        lib = 'void 0,\n' + rest
    return lib

def main():
    html = (SRC / 'index.html').read_text()
    css = (SRC / 'style.css').read_text()
    js = []
    for m in MODULES:
        code = (SRC / f'{m}.js').read_text()
        js.append(f'// ---------------------------------------------------------------- {m}.js\n{code}')
    game = "'use strict';\n" + '\n'.join(js)
    for name, chunk in (('three', three_lib()), ('game', game), ('style', css)):
        if '</script' in chunk.lower() or ('</style' in chunk.lower() and name == 'style'):
            sys.exit(f'{name}: contains a closing tag that would break the page')
    out = (html.replace('/*@STYLE@*/', css)
               .replace('/*@THREE@*/', three_lib())
               .replace('/*@GAME@*/', game))
    for marker in ('/*@STYLE@*/', '/*@THREE@*/', '/*@GAME@*/'):
        if marker in out:
            sys.exit(f'marker {marker} not replaced')
    dest = ROOT / 'irontide.html'
    dest.write_text(out)
    print(f'built {dest.name}: {len(out)//1024} KB')

if __name__ == '__main__':
    main()
