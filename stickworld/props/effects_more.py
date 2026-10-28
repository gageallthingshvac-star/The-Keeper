"""Extra cartoon effects: heat waves, speed lines, a flying sweat drop, a popping question mark and falling debris.

Each function returns one Animation that adds its own mobjects and removes them again at the end (FadeOut),
so a scene can just self.play(heat_waves(p)) alongside other animations.
"""
import numpy as np
from manim import (
    BOLD, DOWN, LEFT, ORIGIN, PI, RIGHT, UP, Dot, Ellipse, FadeIn, FadeOut, LaggedStart, Succession, Text,
    UpdateFromAlphaFunc, VGroup, VMobject, linear, rate_functions, smooth,
)

from ..style import COLD_AIR, DETAIL_W, HEAD_R, HEAT, INK, PROP_W, WHITE, Z_FX, P
from .hvac_more import teardrop


def _unit(v):
    v = np.array([v[0], v[1], 0.0], dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else RIGHT.astype(float)


# ================================================================ heat waves
class HeatWaves(VGroup):
    """A few light-orange wavy lines rising from `center` (bottom middle of the group), spread over `width`."""

    def __init__(self, center=(0, 0), width=0.8, height=0.8, n=3, amp=0.05, wavelength=0.38, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        self.amp, self.wavelength, self.wave_h = amp, wavelength, height
        for i, bx in enumerate(np.linspace(cx - width / 2, cx + width / 2, n) if n > 1 else [cx]):
            ln = VMobject().set_stroke(HEAT, PROP_W).set_fill(opacity=0)
            ln.base = np.array([bx, cy + (0.08 if i % 2 else 0.0), 0.0])
            ln.phase = i * 1.7
            self._shape(ln, 0.0, 0.0)
            self.add(ln)
        self.set_z_index(Z_FX)

    def _shape(self, ln, rise, phase):
        ys = np.linspace(0, self.wave_h, 14)
        pts = [ln.base + np.array([self.amp * np.sin(2 * PI * y / self.wavelength + ln.phase + phase), y + rise, 0])
               for y in ys]
        ln.set_points_smoothly(pts)


def heat_waves(center, run_time=1.2, width=0.8, height=0.8, rise=0.5, n=3):
    """Heat shimmering up from `center`: wavy HEAT lines fade in, wobble upward and fade out."""
    hw = HeatWaves(center, width=width, height=height, n=n)
    anims = []
    for ln in hw:
        def wobble(m, a, ln=ln):
            hw._shape(m, rise * a, 2.5 * PI * a)

        anims.append(Succession(FadeIn(ln, shift=0.1 * UP, run_time=0.25),
                                UpdateFromAlphaFunc(ln, wobble, run_time=0.5, rate_func=linear),
                                FadeOut(ln, shift=0.2 * UP, run_time=0.3)))
    return LaggedStart(*anims, lag_ratio=0.2, run_time=run_time)


# ================================================================ speed lines
class MotionLines(VGroup):
    """Speed lines trailing `mob`, which moves along `direction`. follow() keeps them behind it as it moves."""

    def __init__(self, mob, direction=RIGHT, n=3, length=0.7, gap=0.12, **kwargs):
        super().__init__(**kwargs)
        self.mob = mob
        d = _unit(direction)
        perp = np.array([-d[1], d[0], 0.0])
        c = mob.get_center()
        # half extents of the mobject along and across the motion
        corners = [mob.get_corner(v) - c for v in (UP + LEFT, UP + RIGHT, DOWN + LEFT, DOWN + RIGHT)]
        along = max(abs(np.dot(k, d)) for k in corners)
        across = max(abs(np.dot(k, perp)) for k in corners)
        tail = c - d * (along + gap)
        for i, o in enumerate(np.linspace(-0.6, 0.6, n) if n > 1 else [0.0]):
            ln_len = length * (1.0, 0.7, 0.85, 0.6)[i % 4]
            p0 = tail + perp * o * across - d * (0.08 * (i % 2))
            line = VMobject().set_points_as_corners([p0, p0 - d * ln_len]).set_stroke(INK, DETAIL_W + 1)
            self.add(line)
        self.anchor = Dot(c, radius=0.001).set_fill(opacity=0).set_stroke(width=0)
        self.add(self.anchor)
        self._offset = c - mob.get_center()
        self.set_z_index(Z_FX)

    def follow(self, m=None, dt=0):
        self.shift(self.mob.get_center() + self._offset - self.anchor.get_center())



def motion_lines(mob, direction=RIGHT, run_time=0.6, n=3, length=0.7):
    """Speed lines behind `mob` while it moves along `direction`; they ride along with it, then fade."""
    ml = MotionLines(mob, direction, n=n, length=length)
    ml.add_updater(lambda m, dt: m.follow())
    hold = UpdateFromAlphaFunc(ml, lambda m, a: None, run_time=0.35 * run_time)
    return Succession(FadeIn(ml, run_time=0.15 * run_time, suspend_mobject_updating=False),
                      hold,
                      FadeOut(ml, run_time=0.5 * run_time, suspend_mobject_updating=False))


# ================================================================ sweat drop
class SweatDrop(VGroup):
    """Light-blue teardrop with a highlight, round end at `base`, tip pointing up (rotate to aim the tip)."""

    def __init__(self, base=(0, 0), size=0.26, **kwargs):
        super().__init__(**kwargs)
        b = P(base[0], base[1])
        self.add(teardrop(b, 0.62 * size, size, COLD_AIR, DETAIL_W))
        self.add(Ellipse(width=0.12 * size, height=0.22 * size).move_to(b + P(-0.1 * size, 0.32 * size))
                 .set_fill(WHITE, 1).set_stroke(width=0))
        self.set_z_index(Z_FX)


def sweat(head_point, side=1, run_time=0.7, size=0.26):
    """A sweat drop pops off the side of the head (head_point = head centre; side +1 right, -1 left),
    arcs outward and falls, fading."""
    s = 1 if side >= 0 else -1
    h = P(head_point[0], head_point[1])
    start = h + P(s * HEAD_R * 1.05, HEAD_R * 0.55)
    proto = SweatDrop((0, 0), size)
    dx, up, fall = 0.55 * s, 0.25, 0.9

    def state(a):
        pos = start + P(dx * a, up * a - fall * a * a)
        vel = np.array([dx, up - 2 * fall * a, 0.0])
        ang = np.arctan2(-vel[1], -vel[0]) - PI / 2  # tip trails behind the motion
        return pos, ang

    drop = proto.copy()
    p0, a0 = state(0.0)
    drop.rotate(a0, about_point=ORIGIN).shift(p0)

    def fly(m, a):
        p, ang = state(a)
        m.become(proto.copy().rotate(ang, about_point=ORIGIN).shift(p))

    return Succession(FadeIn(drop, scale=0.4, run_time=0.2 * run_time),
                      UpdateFromAlphaFunc(drop, fly, run_time=0.6 * run_time, rate_func=linear),
                      FadeOut(drop, shift=0.1 * DOWN, run_time=0.2 * run_time))


# ================================================================ question mark
class QuestionMark(VGroup):
    """Bold ink '?' whose bottom sits at `point` (put it just above a head)."""

    def __init__(self, point=(0, 0), height=0.55, **kwargs):
        super().__init__(**kwargs)
        q = Text("?", font="DejaVu Sans", weight=BOLD).set(height=height).set_fill(INK, 1).set_stroke(width=0)
        q.move_to(P(point[0], point[1]) + UP * height / 2)
        self.add(q)
        self.set_z_index(Z_FX)


def question_mark(point, run_time=1.0, height=0.55):
    """A '?' pops up above `point` (top of the head), wobbles, then floats up and fades."""
    base = P(point[0], point[1]) + 0.12 * UP
    q = QuestionMark(base, height)
    state = {"ang": 0.0}

    def wobble(m, a):
        ang = 0.18 * np.sin(3 * PI * a) * (1 - a)
        m.rotate(ang - state["ang"], about_point=base)
        state["ang"] = ang

    return Succession(FadeIn(q, scale=0.2, run_time=0.25 * run_time, rate_func=rate_functions.ease_out_back),
                      UpdateFromAlphaFunc(q, wobble, run_time=0.5 * run_time, rate_func=smooth),
                      FadeOut(q, shift=0.2 * UP, run_time=0.25 * run_time))


# ================================================================ falling debris
def debris(pos, width=0.6, n=9, fall=2.2, run_time=1.0, seed=4, colors=None):
    """Bits of drywall and insulation burst from `pos` and fall under gravity, tumbling and fading (a foot through
    the ceiling, a panel ripped off). colors: fill colours to pick from (default white chips + pink fluff)."""
    from ..style import INSULATION, SMOKE
    rng = np.random.default_rng(seed)
    colors = colors or [WHITE, WHITE, INSULATION]
    p0 = P(pos[0], pos[1])
    anims = []
    for i in range(n):
        size = rng.uniform(0.06, 0.13)
        k = rng.integers(3, 6)
        pts = [P(size * np.cos(a) * rng.uniform(0.6, 1.2), size * np.sin(a) * rng.uniform(0.6, 1.2))
               for a in np.sort(rng.uniform(0, 2 * PI, k))]
        chip = VMobject().set_points_as_corners(pts + [pts[0]])
        chip.set_fill(colors[i % len(colors)], 1).set_stroke(INK, 1.5).set_z_index(Z_FX)
        x0 = rng.uniform(-width / 2, width / 2)
        vx = x0 * 0.8 + rng.uniform(-0.3, 0.3)
        f = fall * rng.uniform(0.7, 1.15)
        spin = rng.uniform(-6, 6)
        chip.move_to(p0 + P(x0, 0))
        proto = chip.copy()

        def drop(m, a, proto=proto, x0=x0, vx=vx, f=f, spin=spin):
            m.become(proto.copy().rotate(spin * a).move_to(p0 + P(x0 + vx * a, 0.15 * a - f * a * a)))
            m.set_opacity(max(0.0, 1.0 - max(0.0, a - 0.7) / 0.3))

        anims.append(UpdateFromAlphaFunc(chip, drop, run_time=run_time * rng.uniform(0.75, 1.0), rate_func=linear,
                                         remover=True))
    puff = Ellipse(width=width * 1.3, height=0.3).move_to(p0 + P(0, -0.1)).set_fill(SMOKE, 0.6).set_stroke(INK, 2, opacity=0.4)
    puff.set_z_index(Z_FX)
    anims.append(FadeOut(puff, shift=0.45 * DOWN, scale=1.8, run_time=0.6 * run_time))
    return LaggedStart(*anims, lag_ratio=0.04)
