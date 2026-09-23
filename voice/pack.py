#!/usr/bin/env python3
"""Fold the rendered audio into the game.

Reads voice/audio/*.mp3, base64s each one, and rewrites the VOICE_CLIPS table
in updraft.html so the recorded tier is live. Re-runnable: it always replaces
the whole table rather than appending to it.
"""
import base64, json, os, re, sys

GAME = "updraft.html"
LINES = json.load(open("voice/lines.json"))
have, missing, total = [], 0, 0
for e in LINES:
    p = os.path.join("voice/audio", e["id"] + ".mp3")
    if not os.path.exists(p):
        missing += 1
        continue
    b = open(p, "rb").read()
    total += len(b)
    have.append((e["text"], "data:audio/mpeg;base64," + base64.b64encode(b).decode()))

if not have:
    print("no audio found in voice/audio — render some first"); sys.exit(1)

body = ",\n".join('  %s: "%s"' % (json.dumps(t), d) for t, d in have)
table = "const VOICE_CLIPS = {\n%s\n};" % body
src = open(GAME, encoding="utf-8").read()
new, n = re.subn(r"const VOICE_CLIPS = \{.*?\};", lambda m: table, src, count=1, flags=re.S)
if not n:
    print("could not find the VOICE_CLIPS table in " + GAME); sys.exit(1)
open(GAME, "w", encoding="utf-8").write(new)
print("packed %d clips (%d missing), %.2f MB of audio, %s is now %.2f MB"
      % (len(have), missing, total / 1e6, GAME, len(new) / 1e6))
