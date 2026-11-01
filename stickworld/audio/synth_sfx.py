"""Synthesized effect cues (our own sounds, no licence needed), written into audio/sfx next to the recorded ones:
boom (808 sub hit for impact frames), glint (bright metallic shine for the shades), riser (noise swell before a hit).

    python stickworld/audio/synth_sfx.py
"""
import os
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfx")


def _write(name, x, peak=0.85):
    x = x / max(1e-9, np.abs(x).max()) * peak
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def boom():
    t = np.arange(int(1.3 * SR)) / SR
    f = 38 + 140 * np.exp(-t / 0.045)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    click = np.random.default_rng(3).standard_normal(len(t)) * np.exp(-t / 0.004)
    click = sosfilt(butter(2, 3000, "low", fs=SR, output="sos"), click) * 0.5
    return np.tanh(2.2 * (sub + click))


def glint():
    t = np.arange(int(0.6 * SR)) / SR
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in
            ((2637, 1.0, 0.25), (3951, 0.6, 0.18), (5274, 0.35, 0.12), (7040, 0.2, 0.07)))
    return x * np.minimum(1.0, t / 0.002)


def riser():
    t = np.arange(int(0.9 * SR)) / SR
    noise = np.random.default_rng(5).standard_normal(len(t))
    out = np.zeros_like(noise)
    for k in range(9):                                    # a band-pass sweeping up, in steps
        a, b = int(k * len(t) / 9), int((k + 1) * len(t) / 9)
        lo = 300 * 2 ** (k * 0.55)
        out[a:b] = sosfilt(butter(2, [lo, lo * 2.2], "band", fs=SR, output="sos"), noise)[a:b]
    tone = np.sin(2 * np.pi * np.cumsum(180 * 2 ** (2.2 * t / t[-1])) / SR) * 0.25
    return (out + tone) * (t / t[-1]) ** 2


if __name__ == "__main__":
    _write("boom", boom())
    _write("glint", glint(), 0.6)
    _write("riser", riser(), 0.6)
    print("boom, glint, riser written to", OUT)
