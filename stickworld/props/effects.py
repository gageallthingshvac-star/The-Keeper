"""Effects: smoke, sparkles, cold air, vibration lines, dust, stars, zap arcs and (optional) comic effect words.

Each function returns an Animation that adds its shapes, plays and cleans up after itself. Persistent effects
(cold air, vibration) are always_redraw groups driven by a ValueTracker clock you animate.
"""
import random

import numpy as np
from manim import (DOWN, LEFT, PI, RIGHT, TAU, UP, Arc, Circle, FadeIn, FadeOut, GrowFromCenter, LaggedStart, Star,
                   Succession, Text, UpdateFromAlphaFunc, VGroup, VMobject, Wait, always_redraw, linear)
from manim.utils.rate_functions import ease_out_back

from .. import style as S


def smoke(pos, n=5, r=0.22, spread=0.35, rise=1.0, run_time=1.1, seed=0, color=S.SMOKE):
    """Gray puffs that drift up and fade."""
    rng = random.Random(seed)
    anims = []
    for _ in range(n):
        c = Circle(radius=r * rng.uniform(0.7, 1.3)).set_fill(color, 0.8).set_stroke(S.INK, 3, opacity=0.5)
        c.move_to(pos + np.array([rng.uniform(-spread, spread), rng.uniform(-spread / 2, spread / 2), 0])).set_z_index(S.Z_FX)
        drift = UP * rise + RIGHT * rng.uniform(-0.35, 0.35)
        anims.append(Succession(FadeIn(c, scale=0.2, run_time=run_time * 0.3),
                                FadeOut(c, shift=drift, scale=2.2, run_time=run_time * 0.7)))
    return LaggedStart(*anims, lag_ratio=0.15)


def dust(pos, width=1.0, run_time=0.7, seed=1):
    """Low puffs kicked out sideways when something lands."""
    rng = random.Random(seed)
    anims = []
    for k in (-1, 1):
        for i in range(3):
            c = Circle(radius=0.14 * rng.uniform(0.8, 1.3)).set_fill(S.SMOKE, 0.6).set_stroke(S.INK, 2, opacity=0.4)
            c.move_to(pos + np.array([k * (width / 2 + 0.1 * i), 0.08, 0])).set_z_index(S.Z_FX)
            anims.append(FadeOut(c, shift=np.array([k * 0.5, 0.25, 0]), scale=2.0, run_time=run_time))
    return LaggedStart(*anims, lag_ratio=0.05)


def sparkles(points, run_time=1.0, seed=0):
    rng = random.Random(seed)
    anims = []
    for p in points:
        s = Star(4, outer_radius=rng.uniform(0.22, 0.36), inner_radius=0.07).set_fill(S.SPARK, 1).set_stroke(S.INK, 3)
        s.move_to(p).set_z_index(S.Z_FX)
        anims.append(Succession(FadeIn(s, scale=0.1, run_time=run_time * 0.35, rate_func=ease_out_back),
                                FadeOut(s, scale=0.1, run_time=run_time * 0.4)))
    return LaggedStart(*anims, lag_ratio=0.2)


def stars(head_fn, run_time=1.0, n=3):
    """Dazed stars circling a head (head_fn() -> head centre each frame)."""
    group = VGroup(*[Star(5, outer_radius=0.13, inner_radius=0.055).set_fill(S.SPARK, 1).set_stroke(S.INK, 2)
                     for _ in range(n)]).set_z_index(S.Z_FX)

    def orbit(m, a):
        c = head_fn() + UP * (S.HEAD_R + 0.15)
        for i, st in enumerate(m):
            ang = TAU * (a * 1.6 + i / n)
            st.move_to(c + np.array([0.55 * np.cos(ang), 0.14 * np.sin(ang), 0]))
            st.set_opacity(min(1.0, 6 * a, 6 * (1 - a)))

    return UpdateFromAlphaFunc(group, orbit, run_time=run_time, rate_func=linear, remover=True)


def bolt(a, b, seed=0, color="#FFE135"):
    """A jagged electric arc from a to b (a mobject you add/remove yourself for flicker)."""
    rng = random.Random(seed)
    pts = [a]
    for t in np.linspace(0, 1, 8)[1:-1]:
        p = a + (b - a) * t
        pts.append(p + np.array([rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), 0]))
    pts.append(b)
    under = VMobject().set_points_as_corners(pts).set_stroke(S.INK, 14)
    over = VMobject().set_points_as_corners(pts).set_stroke(color, 7)
    return VGroup(under, over).set_z_index(S.Z_FX)


def zap_arcs(a_fn, b_fn, run_time=0.5, rate=20):
    """Flickering arcs between two moving points for run_time seconds."""
    holder = VGroup().set_z_index(S.Z_FX)

    def flick(m, a):
        k = int(a * run_time * rate)
        m.become(bolt(a_fn(), b_fn(), seed=k) if a < 1 else VGroup())
        m.set_z_index(S.Z_FX)

    return UpdateFromAlphaFunc(holder, flick, run_time=run_time, rate_func=linear, remover=True)


def effect_word(word, pos, height=1.0, angle=0.12, hold=S.GAG_HOLD):
    """Comic effect word: bold, black outline, yellow fill, pops in with overshoot, holds, fades.
    Not used in Smith Air episodes by default (they use recorded sound instead); available on request."""
    t = Text(word, font="DejaVu Sans", weight="BOLD").set(height=height)
    t.set_fill(S.WORD_FILL, 1).set_stroke(S.INK, 10, background=True).rotate(angle).move_to(pos).set_z_index(S.Z_WORD)
    return Succession(GrowFromCenter(t, run_time=0.18, rate_func=ease_out_back), Wait(hold),
                      FadeOut(t, scale=1.3, run_time=0.22))


def cold_air(clock, lanes, x_from, x_to, period=2.6, length=0.95, amp=0.08):
    """Wavy light-blue lines flowing from x_from toward x_to along each lane y; drive with clock (seconds)."""
    direction = np.sign(x_to - x_from)
    span = abs(x_to - x_from)

    def build():
        t = clock.get_value()
        g = VGroup()
        for i, y in enumerate(lanes * 3):
            prog = ((t * 1.25 + i * 0.37) % period) / period
            head = x_from + direction * prog * (span + length)
            xs = np.linspace(head - direction * length, head, 24)
            pts = [np.array([x, y + amp * np.sin(7 * x + t * 9 + i), 0]) for x in xs]
            fade = min(1.0, t / 0.6) * float(np.clip((span + length - abs(head - x_from)) / 0.8, 0, 1)) * float(np.clip(prog * 6, 0, 1))
            g.add(VMobject().set_points_smoothly(pts).set_stroke(S.COLD_AIR, 10, opacity=fade))
        return g.set_z_index(S.Z_FX)

    return always_redraw(build)


def vibration_lines(clock, anchors):
    """Little hum arcs ")))" flickering at each (point, direction) anchor; drive with clock."""

    def build():
        t = clock.get_value()
        ramp = min(1.0, t / 0.4)
        g = VGroup()
        for (p, ang) in anchors:
            for k in range(3):
                op = ramp * (0.5 + 0.5 * np.sin(t * 30 + k * 2))
                g.add(Arc(radius=0.25 + 0.2 * k, start_angle=ang - 0.55, angle=1.1, arc_center=p).set_stroke(S.INK, 4, opacity=op))
        return g.set_z_index(S.Z_FX)

    return always_redraw(build)


def hum_shake(mob, clock, amount=0.025):
    """Updater that makes mob buzz in place while clock advances. Returns the updater (remove it to stop)."""
    home = mob.get_center()

    def buzz(m):
        t = clock.get_value()
        m.move_to(home + amount * np.array([np.sin(t * 95), np.sin(t * 77), 0]))

    mob.add_updater(buzz)
    return buzz


# extra effects (heat waves, motion lines, sweat, question mark) live in effects_more.py
try:
    from .effects_more import *  # noqa: F401,F403
except ImportError:
    pass
except Exception as exc:  # a broken optional extra must not take the core library down with it
    import warnings
    warnings.warn(f"stickworld: could not load effects_more: {exc!r}")
