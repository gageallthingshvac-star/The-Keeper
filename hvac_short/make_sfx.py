"""Synthesize the cartoon sound effects used by hvac_short.py into ./sfx/*.wav (no downloads needed).

Run:  python make_sfx.py
"""
import os
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfx")
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def noise(dur):
    return rng.standard_normal(int(SR * dur))


def band(x, lo=None, hi=None, order=4):
    if lo and hi:
        sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    elif hi:
        sos = signal.butter(order, hi, "lowpass", fs=SR, output="sos")
    else:
        sos = signal.butter(order, lo, "highpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def decay(dur, rate):
    return np.exp(-rate * t_axis(dur))


def sweep(f0, f1, dur, shape="exp"):
    t = t_axis(dur)
    f = f0 * (f1 / f0) ** (t / dur) if shape == "exp" else f0 + (f1 - f0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def fade(x, a=0.005, r=0.02):
    n = len(x)
    env = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        env[:na] = np.linspace(0, 1, na)
    if nr:
        env[-nr:] *= np.linspace(1, 0, nr)
    return x * env


def pad(x, dur):
    out = np.zeros(int(SR * dur))
    out[:min(len(x), len(out))] += x[:len(out)]
    return out


def mix(*parts, dur=None):
    dur = dur or max(len(p) / SR + at for p, at in parts)
    out = np.zeros(int(SR * dur))
    for p, at in parts:
        i = int(at * SR)
        n = min(len(p), len(out) - i)
        out[i:i + n] += p[:n]
    return out


def clang(dur=0.6, freqs=(420, 1130, 1870, 2650, 3400), rate=7.0):
    t = t_axis(dur)
    x = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-rate * (1 + i * 0.4) * t)
            for i, f in enumerate(freqs))
    return x + 0.3 * band(noise(dur), 2000, 8000) * decay(dur, 60)


def save(name, x, peak=0.85):
    x = fade(np.asarray(x, dtype=float))
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def build():
    # truck: engine rumble winding down, then a brake squeak
    d = 1.6
    t = t_axis(d)
    rpm = 55 - 20 * t / d
    eng = signal.sawtooth(2 * np.pi * np.cumsum(rpm) / SR) * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * t))
    eng = band(eng, hi=400) + 0.3 * band(noise(d), 60, 300)
    eng *= np.clip(1.3 - t / d, 0, 1)
    squeak = sweep(2300, 1900, 0.35) * (1 + 0.3 * np.sin(2 * np.pi * 28 * t_axis(0.35))) * decay(0.35, 4)
    save("truck", mix((eng, 0), (0.35 * squeak, 1.05), dur=1.6))
    save("squeak", sweep(1500, 1250, 0.22) * (1 + 0.4 * np.sin(2 * np.pi * 35 * t_axis(0.22))) * decay(0.22, 8))

    # old unit coughing a puff of smoke
    save("cough", mix((band(noise(0.18), 150, 1200) * decay(0.18, 18), 0),
                      (band(noise(0.25), 120, 900) * decay(0.25, 12), 0.22)))
    # whoosh (hops, tosses, slides)
    d = 0.4
    env = np.sin(np.pi * t_axis(d) / d) ** 2
    save("whoosh", band(noise(d), 300, 2500) * env)
    d = 0.8
    env = np.sin(np.pi * t_axis(d) / d) ** 2
    save("whoosh_long", band(noise(d), 200, 1800) * env)
    # body landings
    save("thump", mix((sweep(110, 45, 0.3) * decay(0.3, 12), 0), (0.4 * band(noise(0.08), 80, 600) * decay(0.08, 50), 0)))
    save("thud", mix((sweep(90, 35, 0.6) * decay(0.6, 7), 0), (0.5 * band(noise(0.15), 60, 500) * decay(0.15, 30), 0)))
    save("crash", mix((sweep(85, 35, 0.7) * decay(0.7, 6), 0), (0.7 * clang(1.1, (310, 870, 1410, 2230, 2980), 4.5), 0.01),
                      (0.4 * band(noise(0.3), 500, 4000) * decay(0.3, 15), 0.0)))
    # tool bag set down: jingle of tools
    save("tools", mix(*[(0.6 * clang(0.25, (rng.uniform(1500, 3500), rng.uniform(3500, 5000)), 22), k * 0.05)
                        for k in range(5)], (0.5 * band(noise(0.1), 100, 800) * decay(0.1, 40), 0)))
    # flashing rattling against its screws
    save("rattle", mix(*[(0.7 * clang(0.12, (rng.uniform(700, 1400), rng.uniform(2000, 3200)), 40), k * 0.085)
                         for k in range(12)], dur=1.15))
    # ZAP: buzzing arc with crackles
    d = 0.75
    t = t_axis(d)
    buzz = signal.square(2 * np.pi * 120 * t) * (0.6 + 0.4 * rng.random(len(t)).round())
    crackle = band(noise(d), 2000, 9000) * (rng.random(len(t)) > 0.97)
    gate = band((rng.random(len(t)) > 0.5).astype(float), hi=40)
    save("zap", (0.6 * band(buzz, 100, 4000) + 1.2 * band(crackle, 1500, 9000)) * (0.5 + gate) * np.clip(1.2 - t / d, 0, 1))
    save("fizz", band(noise(0.9), 3000, 10000) * decay(0.9, 4) * (0.7 + 0.3 * rng.random(int(SR * 0.9))))
    # disconnect handle
    save("clunk", mix((sweep(140, 70, 0.3) * decay(0.3, 14), 0), (0.6 * clang(0.25, (900, 1650, 2400), 25), 0)))
    # cordless drill: motor whine ramping up
    d = 0.45
    t = t_axis(d)
    f = 170 + 120 * np.clip(t / 0.12, 0, 1)
    motor = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 7.1) / SR)
    motor *= 0.75 + 0.25 * np.sin(2 * np.pi * 32 * t)
    save("drill", band(motor, 120, 6000) + 0.15 * band(noise(d), 1000, 6000))
    save("ping", sweep(3600, 2400, 0.18) * decay(0.18, 18))
    save("catch", band(noise(0.06), 200, 2000) * decay(0.06, 70))
    # sheet metal bending back
    d = 0.55
    t = t_axis(d)
    bend = sweep(260, 820, d) * (1 + 0.25 * np.sin(2 * np.pi * 14 * t)) * np.sin(np.pi * t / d)
    save("creak", bend + 0.3 * band(noise(d), 1500, 6000) * np.sin(np.pi * t / d) + 0.4 * clang(d, (520, 1310, 2190), 9))
    save("chomp", mix((band(noise(0.12), 300, 3500) * decay(0.12, 30), 0), (band(noise(0.12), 250, 3000) * decay(0.12, 30), 0.15)))
    # duct pops
    save("pop_big", mix((sweep(420, 90, 0.25) * decay(0.25, 14), 0), (band(noise(0.04), 500, 6000) * decay(0.04, 120), 0)))
    save("pop", mix((sweep(700, 180, 0.15) * decay(0.15, 25), 0), (0.7 * band(noise(0.03), 800, 7000) * decay(0.03, 150), 0)))
    save("pop_small", mix((sweep(1300, 500, 0.08) * decay(0.08, 45), 0), (0.5 * band(noise(0.02), 1500, 8000), 0)))
    save("clatter", mix((clang(0.7, (380, 990, 1720, 2600), 6), 0), (0.6 * clang(0.5, (450, 1180, 2050), 8), 0.12)))
    # lawnmower cord yank, then crickets
    d = 0.3
    t = t_axis(d)
    save("yank", band(noise(d), 600, 5000) * np.sin(np.pi * t / d) * (0.6 + 0.4 * signal.sawtooth(2 * np.pi * np.cumsum(60 + 400 * t) / SR)))
    chirp = np.sin(2 * np.pi * 4600 * t_axis(0.04)) * np.sin(np.pi * t_axis(0.04) / 0.04)
    save("crickets", mix(*[(chirp, base + k * 0.06) for base in (0.0, 0.5, 1.0) for k in range(3)], dur=1.3), peak=0.5)
    save("rip", band(noise(0.55), 400, 6000) * (rng.random(int(SR * 0.55)) > 0.35) * np.clip(1.4 - t_axis(0.55) / 0.55, 0, 1))
    # sparkle chime + small success ding
    notes = [1046.5, 1318.5, 1568.0, 2093.0]
    save("chime", mix(*[(np.sin(2 * np.pi * f * t_axis(0.7)) * decay(0.7, 6), k * 0.08) for k, f in enumerate(notes)]))
    save("ding", mix(*[(np.sin(2 * np.pi * f * t_axis(0.6)) * decay(0.6, 7), k * 0.1) for k, f in enumerate((1568.0, 2093.0))]))
    save("tink", np.sin(2 * np.pi * 2700 * t_axis(0.25)) * decay(0.25, 22) + 0.5 * np.sin(2 * np.pi * 4100 * t_axis(0.25)) * decay(0.25, 30))
    save("click", mix((band(noise(0.01), 2000, 9000), 0), (np.sin(2 * np.pi * 2900 * t_axis(0.06)) * decay(0.06, 60), 0),
                      (0.6 * sweep(200, 90, 0.08) * decay(0.08, 40), 0)))
    # VHS-style rewind squeal
    d = 1.0
    t = t_axis(d)
    save("rewind", sweep(700, 2600, d) * (1 + 0.3 * np.sin(2 * np.pi * 11 * t)) * np.sin(np.pi * t / d) ** 0.5
         + 0.3 * band(noise(d), 1000, 5000) * np.sin(np.pi * t / d), peak=0.6)
    # new unit running: compressor hum + fan + air
    d = 4.0
    t = t_axis(d)
    hum = np.sin(2 * np.pi * 120 * t) + 0.5 * np.sin(2 * np.pi * 240 * t) + 0.25 * np.sin(2 * np.pi * 360 * t)
    fan = band(noise(d), 150, 1200) * (0.8 + 0.2 * np.sin(2 * np.pi * 18 * t))
    air = band(noise(d), 800, 4000)
    ramp = np.clip(t / 0.6, 0, 1)
    save("hum", (0.5 * hum + 0.6 * fan + 0.35 * air) * ramp, peak=0.6)


if __name__ == "__main__":
    build()
    print("wrote", sorted(os.listdir(OUT)))
