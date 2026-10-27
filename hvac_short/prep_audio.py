"""Turn the licensed recordings in ./audio_src (see audio_src/CREDITS.md) into ready-to-mix cues in ./sfx.

Each cue is trimmed to the moment it is used for, has leading silence removed, is peak-normalised,
and gets a short fade so nothing clicks. Run:  python prep_audio.py
"""
import os

from pydub import AudioSegment, effects
from pydub.silence import detect_leading_silence

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "audio_src")
OUT = os.path.join(HERE, "sfx")


def load(name):
    for ext in (".wav", ".ogg", ".mp3", ".flac"):
        path = os.path.join(SRC, name + ext)
        if os.path.exists(path):
            return AudioSegment.from_file(path).set_channels(1).set_frame_rate(44100)
    raise FileNotFoundError(name)


def lead_trim(seg, thresh=-38.0):
    return seg[detect_leading_silence(seg, silence_threshold=thresh, chunk_size=5):]


def loudest(seg, ms, step=20):
    """The ms-long window with the most energy (finds the chirp / squeal / clap in a long take)."""
    if len(seg) <= ms:
        return seg
    best, best_at = -1e9, 0
    for at in range(0, len(seg) - ms, step):
        level = seg[at:at + ms].rms
        if level > best:
            best, best_at = level, at
    return seg[best_at:best_at + ms]


def finish(seg, max_ms=None, fade_in=4, fade_out=30, peak=-1.0):
    if max_ms:
        seg = seg[:max_ms]
    seg = effects.normalize(seg, headroom=-peak)
    return seg.fade_in(fade_in).fade_out(min(fade_out, len(seg) // 3))


def cue(slot, src=None, max_ms=None, fade_out=30, window=None, lead=True, thresh=-38.0):
    seg = load(src or slot)
    if window:
        seg = loudest(seg, window)
    elif lead:
        seg = lead_trim(seg, thresh)
    return finish(seg, max_ms, fade_out=fade_out)


def build():
    os.makedirs(OUT, exist_ok=True)
    cues = {
        "squeak": cue("squeak"),
        "cough": cue("cough"),
        "whoosh": cue("whoosh"),
        "whoosh_long": cue("whoosh_long"),
        "thump": cue("thump", max_ms=600, fade_out=150),
        "thud": cue("thud", max_ms=900, fade_out=250),
        "crash": cue("crash"),
        "tools": cue("tools", max_ms=800, fade_out=200),
        "rattle": cue("rattle", max_ms=1150, fade_out=200),
        "zap": cue("zap", max_ms=950, fade_out=250),
        "fizz": cue("fizz", max_ms=1100, fade_out=500),
        "clunk": cue("clunk"),
        "drill": cue("drill", max_ms=480, fade_out=80),
        "ping": cue("ping"),
        "catch": cue("catch", max_ms=300, fade_out=120),
        "creak": cue("creak"),
        "chomp": cue("chomp"),
        "pop_big": cue("pop_big"),
        "pop": cue("pop"),
        "pop_small": cue("pop_small"),
        "clatter": cue("clatter", max_ms=1300, fade_out=450),
        "yank": cue("yank"),
        "crickets": cue("crickets", window=1400, fade_out=300),
        "rip": cue("rip"),
        "chime": cue("chime"),
        "ding": cue("ding", max_ms=1100, fade_out=500),
        "tink": cue("tink"),
        "click": cue("click"),
        "rewind": cue("rewind", max_ms=1100, fade_out=300),
    }
    # truck pulling in: engine winding down, brakes squeal as it stops
    engine = finish(load("truck")[:1700], fade_out=600)
    brakes = finish(loudest(load("brake_squeak"), 700), fade_out=250).apply_gain(-5)
    cues["truck"] = engine.overlay(brakes, position=950)
    # new unit running: compressor buzz under fan noise, easing in
    compressor = finish(load("hum")[:4300], fade_out=10).apply_gain(-3)
    fan = finish(load("hum_fan")[:4300], fade_out=10)
    cues["hum"] = effects.normalize(compressor.overlay(fan), headroom=1.0).fade_in(450).fade_out(60)
    # three footstep variations (slight pitch/speed shifts) so walking doesn't sound looped
    step = lead_trim(load("footstep"))[:260]
    for i, rate in enumerate((0.93, 1.0, 1.08), start=1):
        shifted = step._spawn(step.raw_data, overrides={"frame_rate": int(step.frame_rate * rate)}).set_frame_rate(44100)
        cues[f"step{i}"] = finish(shifted, fade_out=90)

    for name, seg in cues.items():
        seg.export(os.path.join(OUT, f"{name}.wav"), format="wav")
    print(f"wrote {len(cues)} cues to {OUT}")


if __name__ == "__main__":
    build()
