"""Extra hand tools and service gear for later episodes: screwdriver, multimeter, gauge manifold, recovery machine,
refrigerant tank, level, hand truck, ladders, flashlight, mastic bucket and brush, rope, tubing cutter, brazing torch."""
import numpy as np
from manim import (
    BOLD, PI, UP, Arc, CapStyleType, Circle, Difference, Dot, Ellipse, Line, Polygon, Text, Union, VGroup,
    VMobject,
)

from ..style import (
    CAP_RED, DETAIL_W, HARD_HAT, INK, METAL, METAL_DARK, METAL_HI, OLD_UNIT, PROP_W, ROOF, SPARK, TOOL_RED,
    WHITE, WOOD, Z_PROP, P,
)
from .base import Prop, attach_to
from .hvac_more import BRASS, IN, LCD_ON, SevenSeg, Tween, fmt_number, mix, rect, rounded_path, seg, teardrop, tube

R410A = "#E9A0AE"       # rose cylinder colour
HOSE_BLUE = "#2F6FD6"
HOSE_YELLOW = "#F2D21B"
HOSE_RED = "#D63A2F"
FACE_DARK = "#3A3A3A"   # moulded dark-grey tool faces / rubber
MASTIC = "#8E8E8E"
VIAL = "#C8E66A"
ROPE = "#C9A86A"
MAPP = "#F2C230"         # yellow MAP-gas cylinder
FLAME_OUT = "#F5A15A"
FLAME_IN = "#4FA3FF"


def _cubic(s, c1, c2, e, n=40):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * s + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * e


def _sag_path(start, end, start_dir, end_dir, slack=0.35, n=40):
    """A hanging cable/hose from start (leaving along start_dir) to end (arriving from end_dir)."""
    s, e = P(*start[:2]), P(*end[:2])
    k = slack + 0.3 * np.linalg.norm(e - s)
    return _cubic(s, s + np.asarray(start_dir, float) * k, e + np.asarray(end_dir, float) * k, e, n)


def _tail(pts, length):
    """The last `length` of a dense path (for an end fitting that follows the hose)."""
    d = np.cumsum(np.linalg.norm(np.diff(pts[::-1], axis=0), axis=1))
    k = int(np.searchsorted(d, length)) + 2
    return pts[-k:]


def _set_tube(t, pts):
    for m in t:
        m.set_points_as_corners(pts)


# ================================================================ small hand tools
class Screwdriver(Prop):
    """Screwdriver held at grip, tip along angle (0 = right); points grip, tip."""

    def __init__(self, grip=(0, 0), angle=0.0, color=TOOL_RED, **kwargs):
        super().__init__(**kwargs)
        gx, gy = grip[0], grip[1]
        self.part("shaft", rect(gx + 0.12, gy - 0.016, gx + 0.43, gy + 0.016, METAL, DETAIL_W))
        self.part("blade", Polygon(P(gx + 0.43, gy - 0.016), P(gx + 0.47, gy - 0.008), P(gx + 0.47, gy + 0.008),
                                   P(gx + 0.43, gy + 0.016)).set_fill(METAL_DARK, 1).set_stroke(INK, 1.5))
        handle = rect(gx - 0.14, gy - 0.05, gx + 0.1, gy + 0.05, color, PROP_W, r=0.045)
        ridges = VGroup(*[seg((gx - 0.1, y), (gx + 0.05, y), w=1.5, opacity=0.6) for y in (gy - 0.018, gy + 0.018)])
        ferrule = rect(gx + 0.09, gy - 0.032, gx + 0.13, gy + 0.032, METAL_HI, 1.5)
        self.part("handle", VGroup(handle, ridges, ferrule))
        self.mark("grip", (gx, gy))
        self.mark("tip", (gx + 0.47, gy))
        if angle:
            self.rotate(angle, about_point=P(gx, gy))
        self.set_z_index(Z_PROP)


class Multimeter(Prop):
    """Multimeter at center with leads and probes; points grip, display, jack_com, jack_v, probe_red, probe_black, red_grip, black_grip; methods reading(value), probes_to()."""

    BARS = 12

    def __init__(self, center=(0, 0), value=0, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        w, h = 0.4, 0.66
        self.part("holster", rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, HARD_HAT, PROP_W, r=0.07))
        self.part("face", rect(cx - w / 2 + 0.04, cy - h / 2 + 0.04, cx + w / 2 - 0.04, cy + h / 2 - 0.04, FACE_DARK, DETAIL_W, r=0.04))
        ly = cy + 0.18
        self.part("lcd", rect(cx - 0.15, ly - 0.095, cx + 0.15, ly + 0.095, LCD_ON, DETAIL_W, r=0.02))
        self.part("digits", SevenSeg(4, 0.08).move_to(P(cx, ly + 0.025)))
        bars = VGroup(*[rect(cx - 0.12 + i * 0.022, ly - 0.075, cx - 0.12 + i * 0.022 + 0.014, ly - 0.045, INK, 0)
                        for i in range(self.BARS)])
        self.part("bars", bars)
        dy = cy - 0.06
        dial = Circle(radius=0.085).move_to(P(cx, dy)).set_fill(METAL, 1).set_stroke(INK, DETAIL_W)
        ticks = VGroup(*[Dot(P(cx + 0.115 * np.cos(a), dy + 0.115 * np.sin(a)), radius=0.01, color=WHITE)
                         for a in np.linspace(PI * 0.15, PI * 0.85, 6)])
        pointer = Line(P(cx, dy), P(cx - 0.05, dy + 0.065), stroke_width=3, color=INK)
        self.part("dial", VGroup(dial, ticks, pointer))
        jy = cy - 0.24
        self.part("jacks", VGroup(
            Circle(radius=0.024).move_to(P(cx - 0.08, jy)).set_fill(INK, 1).set_stroke(METAL_HI, 1.5),
            Circle(radius=0.024).move_to(P(cx + 0.08, jy)).set_fill(CAP_RED, 1).set_stroke(METAL_HI, 1.5)))
        self.mark("jack_com", (cx - 0.08, jy))
        self.mark("jack_v", (cx + 0.08, jy))
        self.mark("grip", (cx, cy - 0.12))
        self.mark("display", (cx, ly))
        # leads and probes (built pointing down at the origin, then placed by _place_probes)
        self._probe0, self._w0 = {}, self.parts["holster"].width
        for nm, col in (("red", CAP_RED), ("black", FACE_DARK)):
            self.part(f"lead_{nm}", tube(np.array([P(0, 0), P(0, -0.1)]), 0.022, col))
            body = rect(-0.025, 0.06, 0.025, 0.3, col, DETAIL_W, r=0.012)
            guard = rect(-0.04, 0.06, 0.04, 0.085, col, 1.5, r=0.01)
            tip = rect(-0.007, 0.0, 0.007, 0.06, METAL, 1.2)
            probe = VGroup(tip, body, guard)
            self.part(f"probe_{nm}", probe)
            self._probe0[nm] = probe.copy()
            self.mark(f"probe_{nm}", (0, 0))
            self.mark(f"{nm}_grip", (0, 0))
        self._place_probes((cx + 0.32, cy - 1.15), (cx - 0.32, cy - 1.15))
        self.value = 0.0
        self._show(value, value)
        self.set_z_index(Z_PROP)

    def _place_probes(self, red_tip, black_tip):
        for nm, tip, jack in (("red", red_tip, "jack_v"), ("black", black_tip, "jack_com")):
            t = P(*tip[:2])
            probe = self.parts[f"probe_{nm}"]
            k = self.parts["holster"].width / self._w0  # the meter may have been scaled since it was built
            probe.become(self._probe0[nm].copy().scale(k, about_point=P(0, 0)).shift(t))
            self._points[f"probe_{nm}"].move_to(t)
            self._points[f"{nm}_grip"].move_to(t + 0.19 * k * UP)
            path = _sag_path(self.pt(jack), t + 0.3 * k * UP, (0, -1, 0), (0, 1, 0), slack=0.15 * k)
            _set_tube(self.parts[f"lead_{nm}"], path)

    def probes_to(self, red_tip, black_tip, run_time=0.6, **kwargs):
        """Animate the probe tips (pointing down) onto two points, the leads re-hanging from the jacks."""
        r1, b1 = P(*red_tip[:2]), P(*black_tip[:2])

        def apply(s, a):
            self._place_probes(s[0] + (r1 - s[0]) * a, s[1] + (b1 - s[1]) * a)

        return Tween(self, lambda: (self.pt("probe_red"), self.pt("probe_black")), apply, run_time=run_time, **kwargs)

    @staticmethod
    def _range(v):
        for r in (6, 60, 600, 6000):
            if abs(v) <= r:
                return r
        return 6000

    def _show(self, v, target):
        dec = 0 if float(target).is_integer() else 1
        self.parts["digits"].set_text(fmt_number(v, 4, dec))
        frac = min(1.0, abs(v) / self._range(target))
        n_on = int(round(frac * self.BARS))
        for i, b in enumerate(self.parts["bars"]):
            b.set_fill(INK, 1.0 if i < n_on else 0.08)
        self.value = float(v)

    def reading(self, value, run_time=0.6, **kwargs):
        """Animate the display counting to value with an auto-ranging bar graph (too big shows OL)."""
        return Tween(self.parts["digits"], lambda: self.value,
                     lambda s, a: self._show(s + (value - s) * a if a < 1 else value, value), run_time=run_time, **kwargs)


class GaugeSet(Prop):
    """Manifold gauge set at center (parts needle_low, needle_high, hose_*); points grip, hook, gauge_low, gauge_high, hose_low, hose_center, hose_high; methods needles(low, high), hoses_to()."""

    SWEEP = 1.5 * PI
    LOW_MAX, HIGH_MAX = 250.0, 800.0

    def __init__(self, center=(0, 0), **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        # hoses first so the block covers their tops
        self._ports = {}
        ends = {"low": (cx - 0.34, cy - 0.85), "center": (cx, cy - 0.95), "high": (cx + 0.34, cy - 0.85)}
        for nm, px, col in (("low", cx - 0.22, HOSE_BLUE), ("center", cx, HOSE_YELLOW), ("high", cx + 0.22, HOSE_RED)):
            self._ports[nm] = self.mark(f"port_{nm}", (px, cy - 0.06))
            self.part(f"hose_{nm}", tube(np.array([P(0, 0), P(0, -0.1)]), 0.045, col))
            self.part(f"fitting_{nm}", tube(np.array([P(0, 0), P(0, -0.1)]), 0.06, BRASS, cap=CapStyleType.BUTT))
            self.mark(f"hose_{nm}", ends[nm])
        self.part("block", rect(cx - 0.44, cy - 0.08, cx + 0.44, cy + 0.08, METAL, PROP_W, r=0.03))
        self.part("sight", Circle(radius=0.035).move_to(P(cx, cy)).set_fill(HOSE_YELLOW, 0.6).set_stroke(INK, 1.5))
        self.part("knob_low", rect(cx - 0.6, cy - 0.065, cx - 0.44, cy + 0.065, HOSE_BLUE, DETAIL_W, r=0.025))
        self.part("knob_high", rect(cx + 0.44, cy - 0.065, cx + 0.6, cy + 0.065, HOSE_RED, DETAIL_W, r=0.025))
        hook = Arc(radius=0.06, start_angle=-PI / 2, angle=1.4 * PI, arc_center=P(cx, cy + 0.25)).set_stroke(INK, 3.5)
        self.part("hook", VGroup(seg((cx, cy + 0.08), (cx, cy + 0.19), w=3.5), hook))
        self.mark("hook", (cx, cy + 0.31))
        self.mark("grip", (cx, cy))
        self._angle = {}
        for nm, gx, col in (("low", cx - 0.24, HOSE_BLUE), ("high", cx + 0.24, HOSE_RED)):
            gy = cy + 0.27
            bezel = Circle(radius=0.2).move_to(P(gx, gy)).set_fill(col, 1).set_stroke(INK, PROP_W)
            face = Circle(radius=0.16).move_to(P(gx, gy)).set_fill(WHITE, 1).set_stroke(INK, 1.5)
            ticks = VGroup()
            for k in range(9):
                a = 1.25 * PI - self.SWEEP * k / 8
                u = np.array([np.cos(a), np.sin(a), 0])
                ticks.add(Line(P(gx, gy) + 0.115 * u, P(gx, gy) + 0.15 * u, stroke_width=1.6 if k % 2 else 2.4, color=INK))
            self.part(f"gauge_{nm}", VGroup(bezel, face, ticks))
            a0 = 1.25 * PI
            u = np.array([np.cos(a0), np.sin(a0), 0])
            needle = Line(P(gx, gy) - 0.03 * u, P(gx, gy) + 0.13 * u, stroke_width=3, color=INK)
            needle.set_cap_style(CapStyleType.ROUND)
            self.part(f"needle_{nm}", needle)
            self.part(f"hub_{nm}", Dot(P(gx, gy), radius=0.022, color=INK))
            self.mark(f"gauge_{nm}", (gx, gy))
            self._angle[nm] = a0
        self._hang({k: self.pt(f"hose_{k}") for k in ("low", "center", "high")}, free=True)
        self._free = True
        self.set_z_index(Z_PROP)

    # ------------------------------------------------------------ needles
    def _set_needle(self, nm, ang):
        self.parts[f"needle_{nm}"].rotate(ang - self._angle[nm], about_point=self.pt(f"gauge_{nm}"))
        self._angle[nm] = ang

    def _to_angle(self, v, vmax, fraction):
        f = v if fraction else v / vmax
        return 1.25 * PI - self.SWEEP * float(np.clip(f, -0.15, 1))   # below 0: the compound gauge's vacuum range

    def needles(self, low, high, run_time=1.0, fraction=False, **kwargs):
        """Animate the needles to low/high psig (low dial 0-250, high 0-800), or to 0..1 of the sweep with fraction=True.
        A negative low reading swings the needle below zero: pulling a vacuum."""
        lo, hi = self._to_angle(low, self.LOW_MAX, fraction), self._to_angle(high, self.HIGH_MAX, fraction)

        def apply(s, a):
            self._set_needle("low", s[0] + (lo - s[0]) * a)
            self._set_needle("high", s[1] + (hi - s[1]) * a)

        return Tween(self, lambda: (self._angle["low"], self._angle["high"]), apply, run_time=run_time, **kwargs)

    # ------------------------------------------------------------ hoses
    def _hang(self, ends, free):
        for nm, e in ends.items():
            s = self._ports[nm].get_center()
            path = _sag_path(s, e, (0, -1, 0), (0, 1, 0) if free else (0, -1, 0), slack=0.25)
            _set_tube(self.parts[f"hose_{nm}"], path)
            _set_tube(self.parts[f"fitting_{nm}"], _tail(path, 0.08))
            self._points[f"hose_{nm}"].move_to(P(*e[:2]))

    def hoses_to(self, low=None, high=None, center=None, run_time=0.8, **kwargs):
        """Hose ends onto points (they arrive from below, as onto service ports)."""
        goal = {"low": low, "center": center, "high": high}

        def read():
            return {k: self.pt(f"hose_{k}") for k in goal}

        def apply(s, a):
            ends = {k: s[k] if goal[k] is None else s[k] + (P(*goal[k][:2]) - s[k]) * a for k in goal}
            self._hang(ends, free=False)

        return Tween(self, read, apply, run_time=run_time, **kwargs)


# ================================================================ bigger gear
class RecoveryMachine(Prop):
    """Refrigerant recovery machine at (x, ground_y); points handle, port_in, port_out, power, base."""

    def __init__(self, x=0.0, ground_y=0.0, labels=True, **kwargs):
        """labels=False drops the tiny IN / OUT port labels."""
        super().__init__(**kwargs)
        g = ground_y
        W, HB = 15 * IN, 11 * IN
        x0, x1, y0, y1 = x - W / 2, x + W / 2, g + 0.05, g + 0.05 + HB
        self.part("feet", VGroup(rect(x0 + 0.06, g, x0 + 0.2, y0 + 0.01, FACE_DARK, 1.5),
                                 rect(x1 - 0.2, g, x1 - 0.06, y0 + 0.01, FACE_DARK, 1.5)))
        # carry handle: two posts and a bar
        hy = y1 + 0.2
        self.part("handle", VGroup(rect(x - 0.3, y1 - 0.02, x - 0.24, hy, FACE_DARK, DETAIL_W),
                                   rect(x + 0.24, y1 - 0.02, x + 0.3, hy, FACE_DARK, DETAIL_W),
                                   rect(x - 0.32, hy - 0.02, x + 0.32, hy + 0.06, FACE_DARK, DETAIL_W, r=0.03)))
        self.part("body", rect(x0, y0, x1, y1, TOOL_RED, PROP_W, r=0.06))
        px0, px1, py0, py1 = x0 + 0.08, x1 - 0.08, y0 + 0.08, y1 - 0.08
        self.part("panel", rect(px0, py0, px1, py1, METAL_HI, DETAIL_W, r=0.03))
        vents = VGroup(*[rect(px0 + 0.06, vy - 0.012, px0 + 0.26, vy + 0.012, FACE_DARK, 0, r=0.01)
                         for vy in np.linspace(py0 + 0.08, py1 - 0.08, 5)])
        gx, gy = x - 0.02, (py0 + py1) / 2 + 0.07
        gauge = VGroup(Circle(radius=0.1).move_to(P(gx, gy)).set_fill(WHITE, 1).set_stroke(INK, DETAIL_W),
                       Line(P(gx, gy), P(gx + 0.05, gy + 0.06), stroke_width=2.5, color=CAP_RED),
                       Dot(P(gx, gy), radius=0.015, color=INK))
        knob = VGroup(Circle(radius=0.07).move_to(P(gx, py0 + 0.1)).set_fill(FACE_DARK, 1).set_stroke(INK, DETAIL_W),
                      Line(P(gx, py0 + 0.1), P(gx, py0 + 0.16), stroke_width=2.5, color=WHITE))
        switch = rect(px1 - 0.13, py1 - 0.13, px1 - 0.05, py1 - 0.05, HOSE_RED, 1.5, r=0.01)
        self.part("controls", VGroup(vents, gauge, knob, switch))
        # brass ports out of the right side
        ports = VGroup()
        for py in (y0 + 0.42, y0 + 0.2):
            ports.add(rect(x1, py - 0.04, x1 + 0.1, py + 0.04, BRASS, 1.5), rect(x1 + 0.1, py - 0.03, x1 + 0.14, py + 0.03, BRASS, 1.2))
        self.part("ports", ports)
        if labels:
            lab = VGroup(Text("IN", font="DejaVu Sans", weight=BOLD).set(height=0.045).move_to(P(px1 - 0.09, y0 + 0.42)),
                         Text("OUT", font="DejaVu Sans", weight=BOLD).set(height=0.045).move_to(P(px1 - 0.09, y0 + 0.2)))
            self.part("labels", lab.set_fill(INK, 1).set_stroke(width=0))
        self.mark("handle", (x, hy + 0.02))
        self.mark("port_in", (x1 + 0.14, y0 + 0.42))
        self.mark("port_out", (x1 + 0.14, y0 + 0.2))
        self.mark("power", (x0, y0 + 0.2))
        self.mark("base", (x, g))
        self.set_z_index(Z_PROP)


class RefrigerantTank(Prop):
    """30 lb refrigerant cylinder at (x, ground_y), rose R-410A by default; points handle, valve, top, base."""

    def __init__(self, x=0.0, ground_y=0.0, color=R410A, label="R-410A", **kwargs):
        """label=None leaves the label band off; e.g. color="#9CCB8E", label="R-22" for an old green R-22 jug."""
        super().__init__(**kwargs)
        g = ground_y
        R = 0.33
        self.part("foot", rect(x - R + 0.04, g, x + R - 0.04, g + 0.08, color, DETAIL_W))
        shell = Union(rect(x - R, g + 0.07, x + R, g + 0.9, color, PROP_W, r=0.06),
                      Ellipse(width=2 * R, height=0.38).move_to(P(x, g + 0.9)))
        self.part("shell", shell.set_fill(color, 1).set_stroke(INK, PROP_W))
        self.part("seam", seg((x - R, g + 0.2), (x + R, g + 0.2), w=1.5, opacity=0.5))
        # valve inside the collar: brass body, hand wheel, side outlet
        vy = g + 1.07
        self.part("valve_body", VGroup(rect(x - 0.035, vy, x + 0.035, vy + 0.08, BRASS, 1.5),
                                       rect(x + 0.035, vy + 0.02, x + 0.1, vy + 0.05, BRASS, 1.2),
                                       rect(x - 0.08, vy + 0.08, x + 0.08, vy + 0.11, FACE_DARK, 1.5, r=0.01)))
        collar = Difference(rect(x - 0.24, g + 0.98, x + 0.24, g + 1.3),
                            rect(x - 0.16, g + 1.06, x + 0.16, g + 1.2, r=0.04))
        self.part("collar", collar.set_fill(color, 1).set_stroke(INK, PROP_W))
        if label:
            band = rect(x - 0.24, g + 0.36, x + 0.24, g + 0.6, WHITE, DETAIL_W, r=0.02)
            txt = Text(label, font="DejaVu Sans", weight=BOLD).set(width=0.38).move_to(P(x, g + 0.48)).set_fill(INK, 1).set_stroke(width=0)
            self.part("label", VGroup(band, txt))
        self.mark("handle", (x, g + 1.25))
        self.mark("valve", (x + 0.1, vy + 0.035))
        self.mark("top", (x, g + 1.3))
        self.mark("base", (x, g))
        self.set_z_index(Z_PROP)


class Level(Prop):
    """Spirit level at center; points center, end_l, end_r, vial, grip, grip_left; method tilt(angle)."""

    def __init__(self, center=(0, 0), length=24 * IN, angle=0.0, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        L, T = length, 0.13
        x0, x1 = cx - L / 2, cx + L / 2
        self.part("bar", rect(x0, cy - T / 2, x1, cy + T / 2, HARD_HAT, PROP_W, r=0.015))
        self.part("caps", VGroup(rect(x0, cy - T / 2, x0 + 0.06, cy + T / 2, FACE_DARK, DETAIL_W),
                                 rect(x1 - 0.06, cy - T / 2, x1, cy + T / 2, FACE_DARK, DETAIL_W)))
        holes = VGroup(*[rect(hx - 0.13, cy - 0.028, hx + 0.13, cy + 0.028, WHITE, DETAIL_W, r=0.028)
                         for hx in (x0 + 0.3, x1 - 0.3)])
        self.part("hand_holes", holes)
        self.part("vial", rect(cx - 0.17, cy - 0.042, cx + 0.17, cy + 0.042, VIAL, DETAIL_W, r=0.04))
        self.part("bubble", Ellipse(width=0.075, height=0.05).move_to(P(cx, cy)).set_fill(WHITE, 1).set_stroke(INK, 1.5))
        self.part("index", VGroup(seg((cx - 0.05, cy - 0.042), (cx - 0.05, cy + 0.042), w=1.5),
                                  seg((cx + 0.05, cy - 0.042), (cx + 0.05, cy + 0.042), w=1.5)))
        self.mark("center", (cx, cy))
        self.mark("vial", (cx, cy))
        self.mark("end_l", (x0, cy))
        self.mark("end_r", (x1, cy))
        self.mark("grip", (x1 - 0.3, cy))
        self.mark("grip_left", (x0 + 0.3, cy))
        self.angle = 0.0
        self.set_z_index(Z_PROP)
        if angle:
            self._set_tilt(angle)

    def _set_tilt(self, ang):
        self.rotate(ang - self.angle, about_point=self.pt("center"))
        self.angle = ang
        axis = self.pt("end_r") - self.pt("end_l")
        axis /= np.linalg.norm(axis)
        # the bubble floats to the high end; a vial is sensitive, so it reaches the stop by about 5 degrees
        off = 0.12 * float(np.clip(np.sin(ang) / np.sin(np.radians(5)), -1, 1))
        self.parts["bubble"].move_to(self.pt("vial") + axis * off)

    def tilt(self, angle, run_time=0.5, **kwargs):
        """Animate the level to angle (radians CCW from as built) about its centre; the bubble runs to the high end."""
        return Tween(self, lambda: self.angle, lambda s, a: self._set_tilt(s + (angle - s) * a), run_time=run_time, **kwargs)


class Dolly(Prop):
    """Hand truck standing at (x, ground_y), nose plate toward facing; points handle, nose, load, axle, base."""

    def __init__(self, x=0.0, ground_y=0.0, facing=1, height=48 * IN, **kwargs):
        """facing=+1 puts the nose plate on the right."""
        super().__init__(**kwargs)
        g, r = ground_y, 0.26
        ax, ay = x - 0.2, g + r
        self.part("bracket", VGroup(seg((ax, ay), (x, g + 0.5), w=PROP_W), seg((ax, ay), (x, g + 0.12), w=PROP_W)))
        tire = Circle(radius=r).move_to(P(ax, ay)).set_fill(FACE_DARK, 1).set_stroke(INK, PROP_W)
        hub = Circle(radius=0.1).move_to(P(ax, ay)).set_fill(METAL, 1).set_stroke(INK, DETAIL_W)
        self.part("wheel", VGroup(tire, hub, Dot(P(ax, ay), radius=0.025, color=INK)))
        top = g + height
        frame = [P(x, g + 0.04), P(x, top - 0.25), P(x - 0.24, top)]
        self.part("frame", tube(rounded_path(frame, radius=0.2), 0.06, TOOL_RED))
        grip = rounded_path([(x - 0.06, top - 0.19), (x - 0.24, top)], radius=0.1)
        self.part("grip", tube(grip, 0.085, FACE_DARK))
        self.part("crossbars", VGroup(*[Dot(P(x, y), radius=0.03, color=INK) for y in (g + 0.9, g + 1.6, g + 2.3)]))
        self.part("nose_plate", rect(x - 0.03, g, x + 0.44, g + 0.05, METAL_DARK, DETAIL_W))
        self.mark("handle", (x - 0.15, top - 0.1))
        self.mark("nose", (x + 0.44, g + 0.05))
        self.mark("load", (x + 0.22, g + 0.05))
        self.mark("axle", (ax, ay))
        self.mark("base", (x, g))
        if facing < 0:
            self.flip(about_point=P(x, g))
        self.set_z_index(Z_PROP)


class Ladder(Prop):
    """Step ladder (A-frame, side view) or straight ladder (front view) at (x, ground_y); points rung_0..rung_<n-1>, top, foot_front/foot_rear or foot_left/foot_right."""

    PITCH = 12 * IN

    def __init__(self, x=0.0, ground_y=0.0, height=72 * IN, kind="step", facing=-1, lean=0.0, **kwargs):
        """kind="step": treads toward facing (-1 = left); kind="straight": lean radians off vertical, top toward +x, feet kept on the ground."""
        super().__init__(**kwargs)
        g, top = ground_y, ground_y + height
        self.kind = kind
        if kind == "step":
            spread = 0.19 * height
            ff, fr = P(x - spread, g), P(x + spread * 0.9, g)
            tf, tr = P(x - 0.1, top - 0.08), P(x + 0.12, top - 0.08)
            self.part("rear_rail", tube(np.array([fr, tr]), 0.08, METAL, cap=CapStyleType.BUTT))
            sy = g + 0.42 * height
            k = (sy - g) / (top - 0.08 - g)
            pf, pr = ff + (tf - ff) * k, fr + (tr - fr) * k
            mid = (pf + pr) / 2 + 0.06 * UP
            self.part("spreader", VGroup(Line(pf, mid, stroke_width=3.5, color=INK), Line(mid, pr, stroke_width=3.5, color=INK),
                                         Dot(mid, radius=0.025, color=INK)))
            self.part("front_rail", tube(np.array([ff, tf]), 0.1, METAL, cap=CapStyleType.BUTT))
            n = int((height - 0.3) / self.PITCH)
            treads = VGroup()
            for i in range(n):
                y = g + (i + 1) * self.PITCH
                k = (y - g) / (top - 0.08 - g)
                rx = (ff + (tf - ff) * k)[0]
                treads.add(rect(rx - 0.26, y - 0.055, rx + 0.06, y, METAL_DARK, DETAIL_W))
                self.mark(f"rung_{i}", (rx - 0.1, y))
            self.part("treads", treads)
            self.part("top_cap", rect(x - 0.24, top - 0.12, x + 0.24, top, ROOF, PROP_W, r=0.02))
            self.part("feet", VGroup(rect(ff[0] - 0.07, g, ff[0] + 0.07, g + 0.05, FACE_DARK, 1.5),
                                     rect(fr[0] - 0.07, g, fr[0] + 0.07, g + 0.05, FACE_DARK, 1.5)))
            self.mark("top", (x, top))
            self.mark("foot_front", ff)
            self.mark("foot_rear", fr)
            self.n_rungs = n
            if facing > 0:
                self.flip(about_point=P(x, g))
        else:
            half = 0.47
            self.part("rungs", VGroup())
            n = int((height - 0.2) / self.PITCH)
            for i in range(n):
                y = g + (i + 1) * self.PITCH
                self.parts["rungs"].add(tube(np.array([P(x - half, y), P(x + half, y)]), 0.055, METAL_DARK, cap=CapStyleType.BUTT))
                self.mark(f"rung_{i}", (x, y))
            for s in (-1, 1):
                self.part("rail_l" if s < 0 else "rail_r",
                          tube(np.array([P(x + s * half, g), P(x + s * half, top)]), 0.08, METAL, cap=CapStyleType.BUTT))
            self.part("feet", VGroup(*[rect(x + s * half - 0.07, g, x + s * half + 0.07, g + 0.05, FACE_DARK, 1.5) for s in (-1, 1)]))
            self.mark("top", (x, top))
            self.mark("foot_left", (x - half, g))
            self.mark("foot_right", (x + half, g))
            self.n_rungs = n
            if lean:  # lean as a shear: feet stay on the ground, rungs stay level
                k = np.tan(lean)
                self.apply_function(lambda q: q + np.array([(q[1] - g) * k, 0.0, 0.0]))
        self.set_z_index(Z_PROP)


class Flashlight(Prop):
    """Flashlight held at grip, aimed along angle (0 = right); points grip, lens, beam_end, tail; method beam(on)."""

    def __init__(self, grip=(0, 0), angle=0.0, on=False, length=2.4, **kwargs):
        super().__init__(**kwargs)
        gx, gy = grip[0], grip[1]
        lx = gx + 0.24
        beams = VGroup()
        for half, op in ((np.radians(15), 0.16), (np.radians(8), 0.22)):
            far = [P(lx + length * np.cos(t), gy + length * np.sin(t)) for t in np.linspace(-half, half, 9)]
            cone = Polygon(P(lx, gy - 0.055), *far, P(lx, gy + 0.055)).set_fill(SPARK, op).set_stroke(width=0)
            cone.max_opacity = op
            beams.add(cone)
        self.part("beam", beams)
        self.part("body", rect(gx - 0.17, gy - 0.042, gx + 0.12, gy + 0.042, FACE_DARK, PROP_W, r=0.02))
        self.part("knurl", VGroup(*[seg((kx, gy - 0.03), (kx, gy + 0.03), w=1.2, color=METAL_DARK)
                                    for kx in np.arange(gx - 0.1, gx + 0.08, 0.035)]))
        self.part("head", Polygon(P(gx + 0.12, gy - 0.042), P(gx + 0.21, gy - 0.068), P(gx + 0.21, gy + 0.068),
                                  P(gx + 0.12, gy + 0.042)).set_fill(FACE_DARK, 1).set_stroke(INK, PROP_W))
        self.part("lens", rect(gx + 0.21, gy - 0.065, lx, gy + 0.065, WHITE, DETAIL_W))
        self.part("button", rect(gx + 0.02, gy + 0.042, gx + 0.08, gy + 0.065, TOOL_RED, 1.5, r=0.01))
        self.mark("grip", (gx, gy))
        self.mark("lens", (lx, gy))
        self.mark("beam_end", (lx + length, gy))
        self.mark("tail", (gx - 0.17, gy))
        if angle:
            self.rotate(angle, about_point=P(gx, gy))
        self._angle = angle
        self.set_z_index(Z_PROP)
        self._level = 1.0
        self._set_beam(1.0 if on else 0.0)

    def hold(self, hand_fn, aim=None):
        """Ride hand_fn() by the grip (attach_to); with aim (a point or a callable) the lens keeps pointing at it,
        so the beam stays on its target while the arm and body move. detach(flashlight) lets go."""
        if aim is None:
            return attach_to(self, "grip", hand_fn)
        target = aim if callable(aim) else (lambda: np.array(aim, dtype=float))

        def heading():
            d = target() - hand_fn()
            return float(np.arctan2(d[1], d[0])) - self._angle

        return attach_to(self, "grip", hand_fn, rotate_fn=heading)

    def _set_beam(self, lv):
        self._level = float(lv)
        for cone in self.parts["beam"]:
            cone.set_fill(SPARK, cone.max_opacity * lv)
        self.parts["lens"].set_fill(mix(WHITE, SPARK, lv), 1)
        self.is_on = lv > 0.5

    def beam(self, on=True, run_time=0.25, **kwargs):
        """Animate the beam cone and lens glow on or off."""
        target = 1.0 if on else 0.0
        return Tween(self, lambda: self._level,
                     lambda s, a: self._set_beam(s + (target - s) * a), run_time=run_time, **kwargs)


class MasticBucket(Prop):
    """2-gallon mastic bucket with a wire bail at (x, ground_y); points handle, rim, base."""

    def __init__(self, x=0.0, ground_y=0.0, label="MASTIC", **kwargs):
        """label=None leaves a plain label band."""
        super().__init__(**kwargs)
        g = ground_y
        bail_c = P(x, g + 0.52)
        self.part("bail", VGroup(Arc(radius=0.34, start_angle=0, angle=PI, arc_center=bail_c).set_stroke(INK, 3.5),
                                 rect(x - 0.09, g + 0.835, x + 0.09, g + 0.885, FACE_DARK, 1.5, r=0.02)))
        goop = VMobject().set_points_smoothly([P(x - 0.31, g + 0.63), P(x - 0.18, g + 0.7), P(x - 0.04, g + 0.67),
                                               P(x + 0.1, g + 0.73), P(x + 0.31, g + 0.63)])
        goop.add_line_to(P(x - 0.31, g + 0.63))
        self.part("mastic", goop.set_fill(MASTIC, 1).set_stroke(INK, DETAIL_W))
        self.part("pail", Polygon(P(x - 0.27, g), P(x + 0.27, g), P(x + 0.31, g + 0.6), P(x - 0.31, g + 0.6))
                  .set_fill(WHITE, 1).set_stroke(INK, PROP_W))
        self.part("rim", rect(x - 0.335, g + 0.58, x + 0.335, g + 0.66, WHITE, DETAIL_W, r=0.015))
        self.part("ribs", VGroup(seg((x - 0.3, g + 0.54), (x + 0.3, g + 0.54), w=1.5)))
        band = rect(x - 0.23, g + 0.17, x + 0.23, g + 0.41, METAL_HI, DETAIL_W)
        self.part("label", VGroup(band))
        if label:
            self.parts["label"].add(Text(label, font="DejaVu Sans", weight=BOLD).set(width=0.32).move_to(P(x, g + 0.29))
                                    .set_fill(INK, 1).set_stroke(width=0))
        drip = VMobject().set_points_smoothly([P(x + 0.13, g + 0.6), P(x + 0.135, g + 0.5), P(x + 0.15, g + 0.47),
                                               P(x + 0.165, g + 0.5), P(x + 0.17, g + 0.6)])
        self.part("drip", drip.set_fill(MASTIC, 1).set_stroke(INK, 1.5))
        self.part("ears", VGroup(*[Dot(P(x + s * 0.335, g + 0.52), radius=0.03, color=INK) for s in (-1, 1)]))
        self.mark("handle", (x, g + 0.86))
        self.mark("rim", (x, g + 0.66))
        self.mark("base", (x, g))
        self.set_z_index(Z_PROP)


class MasticBrush(Prop):
    """Chip brush loaded with mastic, held at grip, bristles along angle (0 = right); points grip, tip."""

    def __init__(self, grip=(0, 0), angle=0.0, **kwargs):
        super().__init__(**kwargs)
        gx, gy = grip[0], grip[1]
        self.part("handle", rect(gx - 0.15, gy - 0.03, gx + 0.1, gy + 0.03, WOOD, DETAIL_W, r=0.025))
        self.part("ferrule", rect(gx + 0.09, gy - 0.065, gx + 0.16, gy + 0.065, METAL, DETAIL_W))
        self.part("bristles", Polygon(P(gx + 0.16, gy - 0.06), P(gx + 0.27, gy - 0.07), P(gx + 0.3, gy - 0.035),
                                      P(gx + 0.31, gy), P(gx + 0.3, gy + 0.04), P(gx + 0.27, gy + 0.07), P(gx + 0.16, gy + 0.06))
                  .set_fill(OLD_UNIT, 1).set_stroke(INK, DETAIL_W))
        self.part("mastic", Polygon(P(gx + 0.23, gy - 0.068), P(gx + 0.27, gy - 0.07), P(gx + 0.3, gy - 0.035),
                                    P(gx + 0.31, gy), P(gx + 0.3, gy + 0.04), P(gx + 0.27, gy + 0.07), P(gx + 0.23, gy + 0.067))
                  .set_fill(MASTIC, 1).set_stroke(INK, 1.5))
        self.mark("grip", (gx, gy))
        self.mark("tip", (gx + 0.31, gy))
        if angle:
            self.rotate(angle, about_point=P(gx, gy))
        self.set_z_index(Z_PROP)


class Rope(Prop):
    """A rope strung through anchors (points, or callables returning a point, e.g. a hand or a load's hook), redrawn
    every frame so it stays taut between moving things. anchors[0] is the hauler's end: with tail_to, the slack
    hangs from it down to a coil lying at that point. Methods: hold(fn) (the hauler's end follows a new point, e.g.
    the other hand), throw(anchors, run_time) (the rope pays out from anchors[0] through the others and its far end
    lands on the last one)."""

    def __init__(self, *anchors, tail_to=None, width=4.5, color=ROPE, **kwargs):
        super().__init__(**kwargs)
        self.anchors = list(anchors)
        self.tail_to = tail_to
        self._reveal = None  # while thrown: (anchors, fraction of the path shown)
        self.part("under", VMobject().set_stroke(INK, width + 3).set_fill(opacity=0))
        self.part("rope", VMobject().set_stroke(color, width).set_fill(opacity=0))
        self.part("tail_under", VMobject().set_stroke(INK, width + 3).set_fill(opacity=0))
        self.part("tail", VMobject().set_stroke(color, width).set_fill(opacity=0))
        self.part("coil", VGroup())
        if tail_to is not None:
            c = P(tail_to[0], tail_to[1])
            self.parts["coil"].add(*[Ellipse(width=0.42 - 0.06 * k, height=0.13).move_to(c + P(0.03 * k, 0.05 + 0.045 * k))
                                     .set_fill(color, 1).set_stroke(INK, DETAIL_W) for k in range(3)])
        for k in ("under", "rope", "tail_under", "tail"):
            self.parts[k].set_cap_style(CapStyleType.ROUND)
        self.add_updater(lambda m: m._redraw())
        self._redraw()
        self.set_z_index(Z_PROP + 1.2)

    @staticmethod
    def _at(a):
        p = a() if callable(a) else a
        return P(p[0], p[1])

    def _path(self):
        if self._reveal is None:
            return [self._at(a) for a in self.anchors]
        anchors, frac = self._reveal
        pts = [self._at(a) for a in anchors]
        lens = [float(np.linalg.norm(b - a)) for a, b in zip(pts[:-1], pts[1:])]
        want, out = frac * sum(lens), [pts[0]]
        for (a, b), L in zip(zip(pts[:-1], pts[1:]), lens):
            if want <= L:
                out.append(a + (b - a) * (want / max(L, 1e-9)))
                break
            out.append(b)
            want -= L
        return out

    def _redraw(self):
        pts = self._path()
        if len(pts) < 2:
            pts = [pts[0], pts[0] + P(0, 0.001)]
        for k in ("under", "rope"):
            self.parts[k].set_points_as_corners(pts)
        if self.tail_to is not None:
            a, b = pts[0], P(self.tail_to[0], self.tail_to[1]) + P(0, 0.1)
            mid = (a + b) / 2 + P(0, -0.25)
            curve = VMobject().set_points_smoothly([a, (a + mid) / 2 + P(0, -0.12), mid, (mid + b) / 2, b])
            for k in ("tail_under", "tail"):
                self.parts[k].set_points(curve.points)

    def hold(self, fn):
        self.anchors[0] = fn

    def throw(self, anchors, run_time=0.5):
        """The rope pays out from anchors[0] through the others and its end lands on the last (callables allowed)."""
        from manim import UpdateFromAlphaFunc
        from manim.utils.rate_functions import ease_out_cubic

        def setup(m, a):
            m._reveal = (list(anchors), a)
            if a >= 1.0:
                m._reveal = None
                m.anchors = list(anchors)

        return UpdateFromAlphaFunc(self, setup, run_time=run_time, rate_func=ease_out_cubic)


class TubingCutter(Prop):
    """Copper tubing cutter held by its red knob: a C-frame with the cutting wheel, opening toward `face`.
    Points: grip, tip (where the pipe sits in the jaw)."""

    def __init__(self, grip=(0, 0), face=1, **kwargs):
        super().__init__(**kwargs)
        gx, gy = grip[0], grip[1]
        jx, jy = gx + 0.02, gy + 0.3
        self.part("knob", rect(gx - 0.055, gy - 0.08, gx + 0.055, gy + 0.17, TOOL_RED, DETAIL_W, r=0.035))
        self.part("knurl", VGroup(*[seg((gx - 0.04, y), (gx + 0.04, y), w=1.5) for y in (gy - 0.03, gy + 0.02, gy + 0.07)]))
        frame = Arc(radius=0.12, start_angle=0.75 * PI, angle=1.5 * PI, arc_center=P(jx, jy))
        frame.set_stroke(INK, 11)
        frame_in = frame.copy().set_stroke(METAL, 6)
        self.part("frame", VGroup(frame, frame_in))
        self.part("wheel", Circle(radius=0.045).move_to(P(jx - 0.06, jy)).set_fill(METAL_HI, 1).set_stroke(INK, DETAIL_W))
        self.part("roller", Circle(radius=0.03).move_to(P(jx + 0.06, jy)).set_fill(METAL_DARK, 1).set_stroke(INK, 1.5))
        self.mark("grip", (gx, gy))
        self.mark("tip", (jx, jy))
        if face < 0:
            self.flip(about_point=P(gx, gy))
        self.set_z_index(Z_PROP)


class Torch(Prop):
    """Hand brazing torch screwed onto a yellow MAP-gas cylinder, nozzle angled toward `face`.
    Points: grip (middle of the cylinder), tip (nozzle end). Method: flame(on) (blue core, orange outer flame,
    flickering while lit)."""

    def __init__(self, grip=(0, 0), face=1, **kwargs):
        super().__init__(**kwargs)
        gx, gy = grip[0], grip[1]
        self.part("cylinder", VGroup(rect(gx - 0.085, gy - 0.25, gx + 0.085, gy + 0.2, MAPP, DETAIL_W, r=0.06),
                                     rect(gx - 0.085, gy - 0.05, gx + 0.085, gy + 0.03, INK, 0)))
        self.part("valve", rect(gx - 0.04, gy + 0.2, gx + 0.04, gy + 0.26, BRASS, DETAIL_W))
        self.part("head", rect(gx - 0.07, gy + 0.26, gx + 0.08, gy + 0.4, FACE_DARK, DETAIL_W, r=0.025))
        self.part("trigger", rect(gx + 0.08, gy + 0.28, gx + 0.12, gy + 0.33, TOOL_RED, 1.5))
        a, b = P(gx + 0.06, gy + 0.36), P(gx + 0.3, gy + 0.46)
        self.part("nozzle", tube(np.array([a, b]), 0.05, METAL, cap=CapStyleType.BUTT))
        ang = float(np.arctan2(b[1] - a[1], b[0] - a[0]))
        outer = teardrop(b, 0.15, 0.38, FLAME_OUT, 0, angle=ang - PI / 2)
        inner = teardrop(b, 0.07, 0.2, FLAME_IN, 0, angle=ang - PI / 2)
        self.part("flame", VGroup(outer, inner).set_opacity(0.0))
        self.mark("grip", (gx, gy))
        self.mark("tip", (b[0], b[1]))
        self._lit = 0.0
        self._tick = 0
        if face < 0:
            self.flip(about_point=P(gx, gy))
        self.set_z_index(Z_PROP)
        self.parts["flame"].add_updater(self._flicker)

    def _flicker(self, m):
        self._tick += 1
        if self._lit <= 0.01:
            return
        k = 1.0 + 0.08 * np.sin(self._tick * 2.3) + 0.05 * np.sin(self._tick * 5.1)
        base = self.pt("tip")
        m.stretch(k / getattr(m, "_k", 1.0), 0, about_point=base).stretch(k / getattr(m, "_k", 1.0), 1, about_point=base)
        m._k = k

    def flame(self, on=True, run_time=0.2):
        """Light (whoomp) or shut off the flame."""
        target = 1.0 if on else 0.0

        def apply(s0, a):
            self._lit = s0 + (target - s0) * a
            f = self.parts["flame"]
            f[0].set_fill(FLAME_OUT, 0.9 * self._lit)
            f[1].set_fill(FLAME_IN, 0.95 * self._lit)

        return Tween(self.parts["flame"], lambda: self._lit, apply, run_time=run_time)
