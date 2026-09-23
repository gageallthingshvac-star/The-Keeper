#!/usr/bin/env python3
"""Fold recorded sound effects into the game.

Reads voice/sfx/<slot>/*.mp3 (any order, any filenames) and rewrites the
SFX_CLIPS table in updraft.html. Re-runnable: it replaces the whole table.

    voice/sfx/block/1.mp3, 2.mp3, ...   ->  SFX_CLIPS.block = [ ... ]

Warns about anything longer than the slot's stated maximum, since an
overlong clip on a frequent event is the one mistake that ruins a mix.
"""
import base64, json, os, re, sys, subprocess

GAME, ROOT = "updraft.html", "voice/sfx"
SLOTS = {s["slot"]: s for s in json.load(open("voice/sfx.json"))}

def ffmpeg():
    try:
        import imageio_ffmpeg; return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception: return None

def seconds(FF, path):
    if not FF: return None
    p = subprocess.run([FF, "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr)
    return float(m.group(1))*3600 + float(m.group(2))*60 + float(m.group(3)) if m else None

FF = ffmpeg()
table, total, warned = {}, 0, []
for slot in SLOTS:
    d = os.path.join(ROOT, slot)
    if not os.path.isdir(d): continue
    files = sorted(f for f in os.listdir(d) if f.lower().endswith((".mp3", ".m4a", ".wav", ".aac", ".ogg")))
    uris = []
    for f in files:
        p = os.path.join(d, f)
        b = open(p, "rb").read()
        if len(b) < 300: continue
        dur = seconds(FF, p)
        if dur and dur > SLOTS[slot]["max"] * 1.6:
            warned.append("  %s/%s is %.2fs, well past the %.2fs this slot wants"
                          % (slot, f, dur, SLOTS[slot]["max"]))
        mime = {"mp3":"audio/mpeg","m4a":"audio/mp4","wav":"audio/wav",
                "aac":"audio/aac","ogg":"audio/ogg"}[f.rsplit(".",1)[1].lower()]
        uris.append("data:%s;base64,%s" % (mime, base64.b64encode(b).decode()))
        total += len(b)
    if uris: table[slot] = uris

if not table:
    print("nothing in %s — make a folder per slot and drop the takes in" % ROOT); sys.exit(1)

body = ",\n".join('  %s: [\n%s\n  ]' % (json.dumps(k),
        ",\n".join('    "%s"' % u for u in v)) for k, v in sorted(table.items()))
src = open(GAME, encoding="utf-8").read()
new, n = re.subn(r"const SFX_CLIPS = \{.*?\};",
                 lambda m: "const SFX_CLIPS = {\n%s\n};" % body, src, count=1, flags=re.S)
if not n:
    print("could not find SFX_CLIPS in " + GAME); sys.exit(1)
open(GAME, "w", encoding="utf-8").write(new)
for slot in SLOTS:
    got, want = len(table.get(slot, [])), SLOTS[slot]["takes"]
    mark = "ok " if got >= want else ("-- " if got == 0 else "!! ")
    print("%s%-7s %d/%d" % (mark, slot, got, want))
if warned:
    print("\nlong clips:"); print("\n".join(warned))
print("\npacked %d clips, %.2f MB of audio, %s is now %.2f MB"
      % (sum(len(v) for v in table.values()), total/1e6, GAME, len(new)/1e6))
