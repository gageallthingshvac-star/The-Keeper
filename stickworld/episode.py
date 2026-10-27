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

from manim import MovingCameraScene

from .audio import SoundScene
from .style import setup_frame

setup_frame()


class EpisodeScene(SoundScene, MovingCameraScene):
    TIMING = {}
    MUSIC = "music.mp3"
    MUSIC_LEVEL = -13.0

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

    def finish(self, music=True):
        if music and self.MUSIC:
            self.add_music(self.MUSIC, self.MUSIC_LEVEL)
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
