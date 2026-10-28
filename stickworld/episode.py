"""Episode base class: sound + moving camera + TIMING-driven scene blocks and the timing report.

    class Ep(EpisodeScene):
        TIMING = {"arrive": 3.0, ...}          # seconds per scene, in order
        def construct(self):
            with self.block("arrive"):
                ...library actions...
            self.finish()                       # music bed + timing table

A block that finishes early is padded with a hold to its TIMING value (retime to a voiceover by editing TIMING);
one that runs long is reported. finish() prints the table and writes it next to the episode file.
"""
import os
import sys
from contextlib import contextmanager

import numpy as np
from manim import LEFT as LEFT_, RIGHT as RIGHT_, UL as UL_, MovingCameraScene

from .audio import SoundScene
from .style import setup_frame

setup_frame()


class EpisodeScene(SoundScene, MovingCameraScene):
    TIMING = {}
    MUSIC = "music.mp3"
    EPISODE = None      # series episode number (shown by episode_tag(); see stickworld/continuity.py)
    MUSIC_LEVEL = -13.0
    PEAK_DB = -5.5      # mix peak ceiling; AAC encoding adds up to ~3 dB on sharp transients, so the MP4 lands near -3

    def setup(self):
        super().setup()
        self.timeline = []

    @contextmanager
    def block(self, name):
        t0 = self.renderer.time
        yield
        used = self.renderer.time - t0
        target = self.TIMING.get(name, used)
        if used < target - 1e-3:
            self.wait(target - used)
        self.timeline.append((name, t0, self.renderer.time, used, target))

    def episode_tag(self, number=None, hold=2.2):
        """Series tag: a small work-order ticket reading "EP n" pops into the top-left corner, holds while the hook plays,
        then slides away. It rides with the camera (stays put on screen through zooms and pans). Call once at the
        start of construct(); it runs in the background, so it takes no time."""
        from manim import RoundedRectangle, Text, VGroup
        from manim.utils.rate_functions import ease_out_back, smooth
        from . import style as S
        n = number if number is not None else self.EPISODE
        card = RoundedRectangle(width=1.6, height=0.62, corner_radius=0.1).set_fill(S.WHITE, 1).set_stroke(S.INK, 5)
        stripe = RoundedRectangle(width=0.22, height=0.62, corner_radius=0.1).set_fill(S.TOOL_RED, 1).set_stroke(S.INK, 5)
        stripe.align_to(card, LEFT_)
        word = Text(f"EP {n}", font="DejaVu Sans", weight="BOLD").set(height=0.34).set_fill(S.INK, 1)
        word.move_to(card).shift(RIGHT_ * 0.11)
        base = VGroup(card, stripe, word).set_z_index(S.Z_WORD)
        tag = base.copy()
        st = {"t": 0.0}
        t_in, t_out = 0.35, 0.35 + hold

        def place(m, dt):
            st["t"] += dt
            t = st["t"]
            if t > t_out + 0.45:
                m.remove_updater(place)
                self.remove(m)
                return
            fr = self.camera.frame
            s = fr.height / S.FRAME_H
            pop = max(0.01, ease_out_back(min(1.0, t / t_in)))
            out = smooth(min(1.0, max(0.0, (t - t_out) / 0.4)))
            corner = fr.get_corner(UL_) + np.array([1.2, -0.95, 0]) * s
            m.become(base.copy().scale(s * pop).move_to(corner + np.array([-2.6 * s * out, 0, 0])))
            m.set_opacity(1.0 - out)

        tag.add_updater(place)
        self.add(tag)

    def background(self, anim):
        """Run an animation alongside whatever plays next (across several play() calls), e.g. a figure walking
        home while the next beats happen. It advances with the clock and cleans itself up when done."""
        from manim import Mobject
        anim._setup_scene(self)
        anim.begin()
        holder, state = Mobject(), {"t": 0.0}

        def advance(m, dt):
            state["t"] += dt
            a = min(1.0, state["t"] / max(anim.run_time, 1e-6))
            anim.interpolate(a)
            if a >= 1.0:
                anim.finish()
                m.remove_updater(advance)
                self.remove(m)

        holder.add_updater(advance)
        self.add(holder)

    def finish(self, music=True, tail_fade=0.35):
        if music and self.MUSIC:
            self.add_music(self.MUSIC, self.MUSIC_LEVEL)
        # cues that ring past the last frame would make the file longer than the picture: cut the mix to length
        fw = self.renderer.file_writer
        total_ms = int(self.renderer.time * 1000)
        if getattr(fw, "includes_sound", False) and fw.audio_segment is not None and len(fw.audio_segment) > total_ms:
            fw.audio_segment = fw.audio_segment[:total_ms].fade_out(int(tail_fade * 1000))
        # keep headroom for the voiceover: cap the mix peak (cues that land together can stack up)
        if getattr(fw, "includes_sound", False) and fw.audio_segment is not None and fw.audio_segment.max_dBFS > self.PEAK_DB:
            fw.audio_segment = fw.audio_segment.apply_gain(self.PEAK_DB - fw.audio_segment.max_dBFS)
        rows = ["| Scene | Start (s) | End (s) | Action (s) | TIMING (s) |", "| --- | --- | --- | --- | --- |"]
        for name, a, b, used, target in self.timeline:
            flag = " (over)" if used > target + 1e-3 else ""
            rows.append(f"| {name} | {a:.2f} | {b:.2f} | {used:.2f}{flag} | {target:.2f} |")
        total = self.renderer.time
        rows.append(f"\nTotal: {total:.2f} s")
        table = "\n".join(rows)
        print("\n" + table)
        src = sys.modules[type(self).__module__].__file__
        out = os.path.splitext(src)[0] + "_timing.md"
        with open(out, "w") as fh:
            fh.write(f"# {type(self).__name__} timing\n\n{table}\n")
