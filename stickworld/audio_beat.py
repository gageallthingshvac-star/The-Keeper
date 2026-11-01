"""Smith Air's own music bed: a chill lo-fi hip-hop beat synthesized from scratch (no licence needed), arranged to an
episode's edit so the music moves with the picture.

Sections (each starts at a time in the episode):
  intro  Rhodes chords through a muffled "radio" filter, vinyl crackle, no drums (the hook, the problem)
  drop   full beat: boom-bap drums, sub bass, open Rhodes (the techs arrive)
  break  the band stops dead with a tape-stop: a mistake lands (play crickets over it), then chords alone
  full   same as drop (back in after a break)
  end    the last chord rings out and the beat stops (after the payoff)

    from stickworld.audio_beat import make_track
    path = make_track(duration=58.7, sections=[(0, "intro"), (3.4, "drop"), (12.1, "break"), (13.4, "full"), (57.5, "end")])
"""
import hashlib
import os

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

SR = 44100
BPM = 88.0
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "audio", "gen")

# vi - ii - V - I in C, jazzy voicings (MIDI): Am9, Dm9, G13, Cmaj9; bass roots an octave or two down
CHORDS = [(57, [60, 64, 67, 71]), (50, [53, 57, 60, 64]), (55, [53, 59, 64, 69]), (48, [52, 55, 59, 62])]


def _hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def _lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x)


def _highpass(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def _bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


# ---------------------------------------------------------------- instruments
def _kick(rng):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.26)
    click = rng.standard_normal(n) * np.exp(-t / 0.002) * 0.25
    return np.tanh(1.6 * (body + _lowpass(click, 4000))) * 0.95


def _snare(rng):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    noise = _bandpass(rng.standard_normal(n), 1200, 7000) * np.exp(-t / 0.13)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) * 0.6
    hit = noise * 0.9 + tone
    room = fftconvolve(hit, rng.standard_normal(int(0.45 * SR)) * np.exp(-np.arange(int(0.45 * SR)) / SR / 0.12))[:n]
    room /= max(1e-9, np.abs(room).max())
    return 0.8 * hit / max(1e-9, np.abs(hit).max()) + 0.18 * room


def _hat(rng, open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    x = _highpass(rng.standard_normal(n), 7000) * np.exp(-t / (0.09 if open_ else 0.018))
    return x / max(1e-9, np.abs(x).max()) * 0.5


def _rhodes_note(m, dur, vel=1.0):
    n = int((dur + 1.4) * SR)
    t = np.arange(n) / SR
    f = _hz(m)
    env = np.minimum(1.0, t / 0.006) * np.exp(-t / 1.1)
    env *= np.where(t > dur, np.exp(-(t - dur) / 0.25), 1.0)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.6 * t)
    tone = (np.sin(2 * np.pi * f * t) + 0.32 * np.sin(2 * np.pi * 2 * f * t + 0.3) + 0.1 * np.sin(2 * np.pi * 3 * f * t)
            + 0.05 * np.sin(2 * np.pi * 7.03 * f * t) * np.exp(-t / 0.08))      # the tine "bell" on the attack
    detune = 0.5 * np.sin(2 * np.pi * f * 1.003 * t)                             # a touch of chorus
    return (tone + detune) * env * trem * vel


def _bass_note(m, dur, vel=1.0):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    f = _hz(m)
    env = np.minimum(1.0, t / 0.01) * np.exp(-t / 0.7) * np.where(t > dur, np.exp(-(t - dur) / 0.06), 1.0)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return np.tanh(1.3 * x) * env * vel


def _add(buf, x, at):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i]


# ---------------------------------------------------------------- arrangement
def _section_at(sections, t):
    name = sections[0][1]
    for s_t, s_name in sections:
        if t >= s_t:
            name = s_name
    return name


def _gate(sections, n, which):
    """Per-sample 0..1 gain for a stem, with short ramps at section changes."""
    g = np.zeros(n)
    for k, (s_t, s_name) in enumerate(sections):
        e_t = sections[k + 1][0] if k + 1 < len(sections) else n / SR
        on = 1.0 if s_name in which else 0.0
        g[int(s_t * SR):int(e_t * SR)] = on
    ramp = int(0.03 * SR)
    return np.convolve(g, np.ones(ramp) / ramp, mode="same")


def _tape_stop(x, at, length=0.45):
    """Playback slows to a halt over `length` seconds starting at `at`, then silence (the band stops dead)."""
    i0 = int(at * SR)
    if i0 >= len(x):
        return x
    n = int(length * SR)
    rate = np.linspace(1.0, 0.0, n) ** 1.5
    pos = i0 + np.cumsum(rate)
    seg = np.interp(pos, np.arange(len(x)), x) * np.linspace(1, 0, n) ** 0.5
    y = x.copy()
    y[i0:i0 + n] = seg[: len(y[i0:i0 + n])]
    return y


def make_track(duration, sections, seed=7, bpm=BPM):
    """Render the beat for `duration` seconds following `sections` [(time, name)...]; returns a cached WAV path."""
    key = hashlib.md5(repr((round(duration, 3), [(round(a, 3), b) for a, b in sections], seed, bpm, 3)).encode()).hexdigest()[:12]
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"beat_{key}.wav")
    if os.path.exists(path):
        return path
    rng = np.random.default_rng(seed)
    n = int((duration + 1.5) * SR)
    beat = 60.0 / bpm
    six = beat / 4
    swing = 0.17 * six
    drums, bass, keys = np.zeros(n), np.zeros(n), np.zeros(n)
    kick, snare = _kick(rng), _snare(rng)
    hats = [_hat(rng) for _ in range(4)]
    ohat = _hat(rng, open_=True)
    bars = int(duration / (4 * beat)) + 2
    for b in range(bars):
        t0 = b * 4 * beat
        root, voicing = CHORDS[b % 4]
        # drums: boom-bap with swung 16th ghost hats
        for step in range(16):
            t = t0 + step * six + (swing if step % 2 else 0.0)
            if step in (0, 10) or (step == 7 and b % 2 == 1):
                _add(drums, kick * (1.0 if step == 0 else 0.8), t)
            if step in (4, 12):
                _add(drums, snare * (1.0 if step == 12 else 0.92), t)
            if step % 2 == 0:
                _add(drums, hats[step // 2 % 4] * (0.55 if step % 4 == 0 else 0.42), t)
            elif rng.random() < 0.45:
                _add(drums, hats[(step + 1) % 4] * 0.16, t)
            if step == 14 and b % 4 == 3:
                _add(drums, ohat * 0.35, t)
        # bass: root on 1, a pickup on the "and" of 3
        _add(bass, _bass_note(root - 12, beat * 1.6, 1.0), t0)
        _add(bass, _bass_note(root - 12 + (7 if b % 2 else 12), beat * 0.5, 0.7), t0 + 2.5 * beat + swing)
        # keys: strummed chord on 1, a soft re-hit on the "and" of 2
        for i, m in enumerate(voicing):
            _add(keys, _rhodes_note(m, beat * 1.4, 0.32), t0 + 0.012 * i)
            _add(keys, _rhodes_note(m, beat * 1.2, 0.16), t0 + 1.5 * beat + swing + 0.01 * i)
    keys_open = _lowpass(keys, 3800)
    keys_radio = _highpass(_lowpass(keys, 900), 250) * 1.3
    crackle = np.zeros(n)
    pops = rng.random(n) < 7.0 / SR
    crackle[pops] = rng.uniform(-1, 1, pops.sum())
    crackle = _highpass(crackle, 1500) * 0.35 + _lowpass(rng.standard_normal(n), 4000) * 0.012
    # stems through the arrangement
    full = ("drop", "full")
    g_drum, g_bass = _gate(sections, n, full), _gate(sections, n, full)
    g_open = _gate(sections, n, full + ("break", "end"))
    g_radio = _gate(sections, n, ("intro",))
    mix = (0.85 * drums * g_drum + 0.7 * _lowpass(bass, 600) * g_bass + 0.75 * keys_open * g_open
           + 0.75 * keys_radio * g_radio + crackle)
    # breaks stop the band dead (tape stop); the end lets the last chord ring
    for k, (s_t, s_name) in enumerate(sections):
        if s_name == "break":
            mix = _tape_stop(mix, s_t)
            back = sections[k + 1][0] if k + 1 < len(sections) else duration
            i0, i1 = int((s_t + 0.45) * SR), int(back * SR)
            mix[i0:i1] = crackle[i0:i1] + 0.75 * keys_open[i0:i1] * np.linspace(0, 1, max(1, i1 - i0)) ** 2
        if s_name == "end":
            i0 = int(s_t * SR)
            mix[i0:] = (0.75 * keys_open[i0:] * np.exp(-np.arange(n - i0) / SR / 0.9) + crackle[i0:] * 0.5)
    mix = np.tanh(1.2 * _lowpass(mix, 9000, order=1)) * 0.9          # warm tape saturation, lo-fi top end
    mix = mix[: int(duration * SR)]
    mix /= max(1e-9, np.abs(mix).max())
    pcm = (mix * 0.89 * 32767).astype(np.int16)
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path
