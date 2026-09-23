#!/usr/bin/env python3
"""Cut one long recording into the 139 clips.

The phone route: read or render every line into a single file, leaving a
clear pause between them, then

    python3 voice/split.py recording.m4a

It finds the silences, cuts on them, normalises each piece and writes
voice/audio/<id>.mp3 in the order the lines appear in lines.json. If the
number of pieces does not match the number of lines it says so and writes
nothing, because a silent off-by-one would put every line in the wrong
mouth for the rest of the game.

  --gap 0.45    how long a pause has to be to count as a break
  --floor -34   how quiet it has to be, in dB
  --from 0      skip the first N lines (for rendering in batches)
"""
import argparse, json, os, re, subprocess, sys

def ffmpeg():
    for c in ("ffmpeg", "/usr/bin/ffmpeg"):
        if subprocess.run(["which", c], capture_output=True).returncode == 0:
            return c
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit("no ffmpeg — pip install imageio-ffmpeg")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("recording")
    ap.add_argument("--gap", type=float, default=0.45)
    ap.add_argument("--floor", type=float, default=-34)
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--out", default="voice/audio")
    a = ap.parse_args()
    FF = ffmpeg()
    lines = json.load(open("voice/lines.json"))[a.start:]

    # 1. where are the quiet parts
    p = subprocess.run([FF, "-i", a.recording, "-af",
                        "silencedetect=noise=%ddB:d=%s" % (a.floor, a.gap),
                        "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    ends   = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    dur = float(re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr).group(1)) * 3600 \
        + float(re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr).group(2)) * 60 \
        + float(re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr).group(3))

    # 2. the loud parts between them are the takes
    cuts, at = [], 0.0
    if ends and (not starts or ends[0] < starts[0]):
        at = ends[0]                       # the file opens with a pause
        ends = ends[1:]
    for i, s in enumerate(starts):
        if s > at + 0.25:
            cuts.append((max(0, at - 0.08), min(dur, s + 0.12)))
        at = ends[i] if i < len(ends) else s
    if at < dur - 0.25:
        cuts.append((max(0, at - 0.08), dur))

    print("found %d takes for %d lines" % (len(cuts), len(lines)))
    if len(cuts) != len(lines):
        print("\nthat does not match, so nothing was written.")
        print("  too few  -> leave longer pauses, or raise --gap")
        print("  too many -> you paused mid-sentence; lower --gap or --floor")
        print("  or split the job: record the first 40 and use --from 0, then --from 40")
        sys.exit(1)

    os.makedirs(a.out, exist_ok=True)
    for (s, e), line in zip(cuts, lines):
        out = os.path.join(a.out, line["id"] + ".mp3")
        subprocess.run([FF, "-loglevel", "error", "-y", "-i", a.recording,
                        "-ss", "%.3f" % s, "-to", "%.3f" % e,
                        "-af", "loudnorm=I=-17:TP=-1.5:LRA=11,afade=t=in:d=0.02,"
                               "afade=t=out:st=%.3f:d=0.05" % max(0, e - s - 0.05),
                        "-ac", "1", "-ar", "24000", "-b:a", "32k", out], check=True)
        print("  %-10s %5.2fs  %s" % (line["id"], e - s, line["text"][:46]))
    print("\ndone -> %s\nnow run: python3 voice/pack.py" % a.out)

main()
