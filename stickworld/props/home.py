"""Furniture and household bits for indoor episodes: couch, TV (with a flickering glow), wall clock (time-lapse
hands), lockout tag and a loose air filter.

Same rules as every prop: flat shapes, INK outlines, named points that move with the prop.
"""
import numpy as np
from manim import Circle, Line, Polygon, UpdateFromAlphaFunc, VGroup, VMobject, linear

from ..style import DETAIL_W, INK, METAL_DARK, OLD_UNIT, PROP_W, TOOL_RED, WHITE, Z_PROP, Z_SET, P
from .base import Prop
from .hvac_more import Tween, mix, rect, seg

COUCH = "#6F9C9A"
COUCH_DARK = "#56807E"
CABINET = "#8A6A4F"
TV_GLOW = ("#9FD3FF", "#C9E8FF", "#B9B4FF", "#FFF2C2")


class Couch(Prop):
    """Couch seen from the side, facing `facing` (backrest on the other side). Points: seat (hip spot for a sitter),
    seat_far, arm, base."""

    def __init__(self, x=0.0, floor_y=0.0, width=2.6, facing=1, **kwargs):
        super().__init__(**kwargs)
        g = floor_y
        x0, x1 = x - width / 2, x + width / 2
        seat_y, back_y, arm_y = g + 0.78, g + 1.75, g + 1.12
        legs = VGroup(*[rect(lx - 0.06, g, lx + 0.06, g + 0.16, CABINET, DETAIL_W) for lx in (x0 + 0.25, x1 - 0.25)])
        base = rect(x0 + 0.05, g + 0.14, x1 - 0.05, seat_y - 0.2, COUCH_DARK, PROP_W, r=0.08)
        cushion = rect(x0 + 0.32, seat_y - 0.26, x1 - 0.3, seat_y, COUCH, PROP_W, r=0.1)
        back = rect(x0, g + 0.14, x0 + 0.42, back_y, COUCH, PROP_W, r=0.18)
        arm = rect(x1 - 0.36, g + 0.14, x1, arm_y, COUCH, PROP_W, r=0.15)
        self.part("legs", legs)
        self.part("base", base)
        self.part("back", back)
        self.part("cushion", cushion)
        self.part("arm", arm)
        self.part("pillow", rect(x0 + 0.38, seat_y - 0.05, x0 + 0.78, seat_y + 0.55, mix(COUCH, WHITE, 0.45), DETAIL_W, r=0.12))
        self.mark("seat", (x0 + 1.05, seat_y + 0.05))
        self.mark("seat_far", (x1 - 0.75, seat_y + 0.05))
        self.mark("arm", (x1 - 0.18, arm_y))
        self.mark("base", (x, g))
        if facing < 0:
            self.flip(about_point=P(x, g))
        self.set_z_index(Z_PROP)


class TV(Prop):
    """Flat-screen TV on a low cabinet, seen from the side, screen facing `facing`: the picture shows as the light it
    throws, a soft flickering glow cone toward the viewer's side. Points: screen, base. Methods: screen(on)."""

    def __init__(self, x=0.0, floor_y=0.0, facing=-1, on=True, reach=4.0, **kwargs):
        super().__init__(**kwargs)
        g = floor_y
        self.part("cabinet", VGroup(rect(x - 0.7, g, x + 0.7, g + 0.62, CABINET, PROP_W, r=0.04),
                                    seg((x - 0.62, g + 0.33), (x + 0.62, g + 0.33), w=1.5),
                                    rect(x - 0.12, g + 0.42, x + 0.12, g + 0.48, mix(CABINET, WHITE, 0.4), 1.2)))
        sy0, sy1 = g + 0.85, g + 2.05
        self.part("stand", rect(x - 0.05, g + 0.62, x + 0.05, sy0, "#2B2B2B", DETAIL_W))
        self.part("panel", rect(x - 0.07, sy0, x + 0.07, sy1, "#1E1E1E", PROP_W, r=0.03))
        sx = x + facing * 0.08
        glow = Polygon(P(sx, sy1 - 0.05), P(sx, sy0 + 0.05), P(sx + facing * reach, g + 0.1), P(sx + facing * reach, g + 3.4))
        self.part("glow", glow.set_fill(TV_GLOW[0], 0.0).set_stroke(width=0))
        self.parts["glow"].set_z_index(Z_SET + 0.7)
        self.mark("screen", (sx, (sy0 + sy1) / 2))
        self.mark("base", (x, g))
        self._level = 1.0 if on else 0.0
        self._tick = 0
        self.set_z_index(Z_PROP)
        self.parts["glow"].set_z_index(Z_SET + 0.7)
        self.parts["glow"].add_updater(self._flicker)
        self._flicker(self.parts["glow"])

    def _flicker(self, m):
        self._tick += 1
        k = self._tick
        col = TV_GLOW[(k // 9) % len(TV_GLOW)]
        wobble = 0.8 + 0.2 * np.sin(k * 0.9) * np.sin(k * 0.37)
        m.set_fill(col, 0.22 * self._level * wobble)

    def screen(self, on=True, run_time=0.15):
        target = 1.0 if on else 0.0

        def apply(s0, a):
            self._level = s0 + (target - s0) * a

        return Tween(self.parts["panel"], lambda: self._level, apply, run_time=run_time)


class WallClock(Prop):
    """Round wall clock; method spin(hours) whirls the hands round (a time-lapse). Points: center."""

    def __init__(self, center=(0, 0), radius=0.32, hour=8.0, **kwargs):
        super().__init__(**kwargs)
        c = P(center[0], center[1])
        self.part("face", Circle(radius=radius).move_to(c).set_fill(WHITE, 1).set_stroke(INK, PROP_W))
        ticks = VGroup()
        for i in range(12):
            a = np.pi / 2 - i * np.pi / 6
            d = np.array([np.cos(a), np.sin(a), 0])
            ticks.add(Line(c + d * radius * 0.78, c + d * radius * 0.92, stroke_width=2.5 if i % 3 else 4, color=INK))
        self.part("ticks", ticks)
        self.part("hour", Line(c, c + np.array([0, radius * 0.5, 0]), stroke_width=5, color=INK))
        self.part("minute", Line(c, c + np.array([0, radius * 0.75, 0]), stroke_width=3.5, color=INK))
        self.part("pin", Circle(radius=0.03).move_to(c).set_fill(TOOL_RED, 1).set_stroke(INK, 1.5))
        self.mark("center", (center[0], center[1]))
        self._hours = 0.0
        self._set(hour)
        self.set_z_index(Z_PROP)

    def _set(self, hours):
        dh = hours - self._hours
        c = self.pt("center")
        self.parts["minute"].rotate(-2 * np.pi * dh, about_point=c)
        self.parts["hour"].rotate(-2 * np.pi * dh / 12, about_point=c)
        self._hours = hours

    def spin(self, hours=1.0, run_time=1.0):
        """Hands whirl forward `hours` hours (time passing)."""
        st = {}

        def upd(m, a):
            if "h0" not in st:
                st["h0"] = self._hours
            self._set(st["h0"] + hours * a)

        return UpdateFromAlphaFunc(self, upd, run_time=run_time, rate_func=linear)


class LockoutTag(Prop):
    """Red DANGER-style lockout tag hanging from a string at `hang` (a breaker). Points: hang, tag."""

    def __init__(self, hang=(0, 0), **kwargs):
        super().__init__(**kwargs)
        h = P(hang[0], hang[1])
        top = h + np.array([0.05, -0.18, 0])
        self.part("string", VMobject().set_points_smoothly([h, h + np.array([0.04, -0.09, 0]), top]).set_stroke(INK, 2))
        body = rect(top[0] - 0.11, top[1] - 0.36, top[0] + 0.11, top[1], TOOL_RED, DETAIL_W, r=0.03)
        band = rect(top[0] - 0.09, top[1] - 0.2, top[0] + 0.09, top[1] - 0.12, WHITE, 1.2)
        hole = Circle(radius=0.025).move_to(top + np.array([0, -0.05, 0])).set_fill(WHITE, 1).set_stroke(INK, 1.2)
        self.part("tag", VGroup(body, band, hole))
        self.mark("hang", (h[0], h[1]))
        self.mark("tag", (top[0], top[1] - 0.18))
        self.set_z_index(Z_PROP + 0.5)


class Filter(Prop):
    """Loose pleated air filter (cardboard frame), clean or filthy. arrow=+1/-1 prints the airflow arrow on the bottom
    edge (pointing toward the furnace). Points: grip (top tab), center."""

    def __init__(self, center=(0, 0), width=1.3, height=1.1, dirty=False, arrow=None, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        x0, x1, y0, y1 = cx - width / 2, cx + width / 2, cy - height / 2, cy + height / 2
        media = "#8E8577" if dirty else WHITE
        self.part("frame", rect(x0, y0, x1, y1, OLD_UNIT, DETAIL_W))
        self.part("media", rect(x0 + 0.07, y0 + 0.07, x1 - 0.07, y1 - 0.07, media, 1.5))
        n = int((width - 0.14) / 0.07)
        zig = [P(x0 + 0.07 + i * (width - 0.14) / n, y0 + 0.07 if i % 2 else y1 - 0.07) for i in range(n + 1)]
        self.part("pleats", VMobject().set_points_as_corners(zig).set_stroke(METAL_DARK, 1.2).set_fill(opacity=0))
        if dirty:
            rng = np.random.default_rng(9)
            self.part("grime", VGroup(*[Circle(radius=rng.uniform(0.04, 0.09)).move_to(P(rng.uniform(x0 + 0.15, x1 - 0.15), rng.uniform(y0 + 0.15, y1 - 0.15)))
                                        .set_fill("#5E574D", 0.7).set_stroke(width=0) for _ in range(9)]))
        self.part("tab", rect(cx - 0.1, y1 - 0.02, cx + 0.1, y1 + 0.08, WHITE, 1.5, r=0.02))
        if arrow:
            ay, d = y0 + 0.2, float(np.sign(arrow))
            tip = P(cx + d * 0.2, ay)
            self.part("arrow", VGroup(seg((cx - d * 0.2, ay), (cx + d * 0.08, ay), w=4),
                                      Polygon(tip, tip + P(-d * 0.13, 0.08), tip + P(-d * 0.13, -0.08)).set_fill(INK, 1).set_stroke(INK, 1)))
        self.mark("grip", (cx, y1 + 0.05))
        self.mark("center", (cx, cy))
        self.set_z_index(Z_PROP)
