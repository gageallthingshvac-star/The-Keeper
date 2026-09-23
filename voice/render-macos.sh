#!/bin/bash
# Render every line with a macOS Premium voice. This is the cheapest route to
# the recorded tier if you have a Mac: the Premium voices are the same engine
# Apple ships in its own products, they are a free download, and `say` writes
# them straight to a file.
#
#   1. System Settings > Accessibility > Spoken Content > System Voice >
#      Manage Voices, and download an English voice marked Premium.
#   2. say -v '?' | grep en_        to see the exact name it installed under
#   3. VOICE="Daniel (Premium)" ./voice/render-macos.sh
#
# Needs ffmpeg for the mp3 step: brew install ffmpeg
set -euo pipefail
VOICE="${VOICE:-Daniel (Premium)}"
OUT="${OUT:-voice/audio}"
mkdir -p "$OUT"
python3 - "$OUT" "$VOICE" <<'PY'
import json, subprocess, sys, os, shutil
out, voice = sys.argv[1], sys.argv[2]
lines = json.load(open('voice/lines.json'))
have_ffmpeg = shutil.which('ffmpeg') is not None
for i, e in enumerate(lines, 1):
    mp3 = os.path.join(out, e['id'] + '.mp3')
    if os.path.exists(mp3):
        continue
    aiff = os.path.join(out, e['id'] + '.aiff')
    subprocess.run(['say', '-v', voice, '-r', '175', '-o', aiff, e['text']], check=True)
    if have_ffmpeg:
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', aiff,
                        '-ac', '1', '-ar', '24000', '-b:a', '32k', mp3], check=True)
        os.remove(aiff)
    print('%3d/%d  %s  %s' % (i, len(lines), e['id'], e['text'][:52]))
print('\ndone ->', out)
print('now run:  python3 voice/pack.py')
PY
