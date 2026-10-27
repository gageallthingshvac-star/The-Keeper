"""Sound for Smith Air shorts: real recorded effect cues (stickworld/audio/sfx, cut from the licensed recordings in
stickworld/audio/src by prep_audio.py; credits in src/CREDITS.md) and a music bed trimmed to the finished length.

Use SoundScene as the scene base class (with MovingCameraScene). Library actions trigger cues through cue()/snd(),
which do nothing when no SoundScene is running, so the library still works in silent test scenes.
"""
import os
import random

import numpy as np
from manim import Animation, Mobject

HERE = os.path.dirname(os.path.abspath(__file__))
SFX_DIR = os.path.join(HERE, "audio", "sfx")
MUSIC_DIR = os.path.join(HERE, "audio", "src")
SFX_TRIM = -5.0  # overall effects level, leaves headroom when cues overlap

_SCENE = None


def current_scene():
    return _SCENE


def snd(name, delay=0.0, gain=0.0):
    """Play cue `name` `delay` seconds from now (works mid-animation too)."""
    if _SCENE is not None:
        _SCENE.snd(name, delay, gain)


class Snd(Animation):
    """Plays a cue when it starts; its run time just holds the beat (use inside Succession/AnimationGroup)."""

    def __init__(self, name, run_time=1e-3, gain=0.0):
        super().__init__(Mobject(), run_time=max(run_time, 1e-3), remover=True)
        self.sound, self.gain = name, gain

    def begin(self):
        snd(self.sound, 0.0, self.gain)
        super().begin()

    def interpolate_mobject(self, alpha):
        pass


def cue(name, gain=0.0):
    return Snd(name, gain=gain)


def footsteps(fig, steps, run_time, gain=-15.0):
    """Footstep cue at each foot landing of a gait (steps = Gait.steps); skipped while the figure is hidden."""
    if _SCENE is None or fig.z_index < 7:
        return
    rng = random.Random(len(steps) * 31 + int(run_time * 100) + len(fig.name))
    for _, _, t1, a, b in steps:
        if np.linalg.norm(b - a) > 0.1:
            snd(f"step{rng.randint(1, 3)}", t1 * run_time, gain + rng.uniform(-2, 1))


class SoundScene:
    """Mixin for a Scene: tracks time inside play() so cues triggered mid-animation land on the right frame."""

    sfx_trim = SFX_TRIM

    def setup(self):
        global _SCENE
        super().setup()
        _SCENE = self
        self._play_t = 0.0

    def play(self, *args, **kwargs):
        self._play_t = 0.0
        super().play(*args, **kwargs)
        self._play_t = 0.0

    def update_to_time(self, t):
        self._play_t = t
        super().update_to_time(t)

    def snd(self, name, delay=0.0, gain=0.0):
        path = os.path.join(SFX_DIR, f"{name}.wav")
        self.add_sound(path, time_offset=self._play_t + delay, gain=gain + self.sfx_trim)

    def add_music(self, filename="music.mp3", level=-13.0, fade_out=2.5):
        """Lay the music under everything, trimmed and faded to the exact running time. Call last."""
        from pydub import AudioSegment, effects
        total = self.renderer.time
        bed = effects.normalize(AudioSegment.from_file(os.path.join(MUSIC_DIR, filename))[:int(total * 1000)])
        bed = bed.apply_gain(level).fade_in(400).fade_out(int(fade_out * 1000))
        path = os.path.join(SFX_DIR, "_music_bed.wav")
        bed.export(path, format="wav")
        self.add_sound(path, time_offset=-total)
