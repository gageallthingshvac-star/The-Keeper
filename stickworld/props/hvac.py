"""HVAC props for the package-unit changeout (skill doc section 9). Extra equipment lives in hvac_more.py.

PackageUnit, Disconnect, Duct, FlashingPanel, Screw, Cable (HighVoltageWhip, LowVoltageWire).
"""
import random

import numpy as np
from manim import (PI, TAU, Animation, AnimationGroup, CapStyleType, Circle, CubicBezier, Difference, Dot, Ellipse, Line,
                   Polygon, Rectangle, RoundedRectangle, Rotate, Text, UpdateFromAlphaFunc, ValueTracker, VGroup,
                   VMobject, linear, smooth)
from manim.utils.rate_functions import ease_out_back

from .. import style as S
from ..style import P
from .base import Prop, attach_to, detach, line, poly
from . import effects as FX


# ---------------------------------------------------------------- package unit
class PackageUnit(Prop):
    """Residential package unit, side view. Built with its bottom-centre at (cx, pad_top).
    Points: grip_L/grip_R (+ _low), supply_open, return_open, whip_terminal, lv_terminal, foot_spot, top_center,
    bottom_center, panel_screw_0..3. Method: arrive_sparkle()."""

    W, CAB_H = 3.6, 2.4

    def __init__(self, cx, pad_top, old=True, brand=None, supply_y=None, return_y=None):
        super().__init__()
        W, CH = self.W, self.CAB_H
        x0, x1 = cx - W / 2, cx + W / 2
        rail_top = pad_top + 0.12
        top = rail_top + CH
        fill = S.OLD_UNIT if old else S.NEW_UNIT
        dark = S.OLD_UNIT_DARK if old else S.NEW_UNIT_DARK
        coil_c = "#8F877A" if old else "#5F7D98"
        coil_x = x0 + 1.75
        self.part("rail", Rectangle(width=W + 0.06, height=0.12).move_to(P(cx, pad_top + 0.06)).set_fill("#4A4A4A", 1).set_stroke(S.INK, 4))
        self.part("cabinet", Rectangle(width=W, height=CH).move_to(P(cx, rail_top + CH / 2)).set_fill(fill, 1).set_stroke(S.INK, S.PROP_W + 1))
        cy0, cy1 = rail_top + 0.14, top - 0.12
        self.part("coil", Rectangle(width=x1 - 0.1 - coil_x - 0.08, height=cy1 - cy0)
                  .move_to(P((coil_x + 0.08 + x1 - 0.1) / 2, (cy0 + cy1) / 2)).set_fill(coil_c, 1).set_stroke(S.INK, 4))
        self.part("fins", VGroup(*[line((x, cy0), (x, cy1), 1.5, "#3A3A3A") for x in np.arange(coil_x + 0.16, x1 - 0.12, 0.09)]))
        self.part("guard", VGroup(*[line((coil_x + 0.08, y), (x1 - 0.1, y), 2.5) for y in np.arange(cy0 + 0.3, cy1, 0.32)]))
        self.part("post", line((coil_x, rail_top), (coil_x, top), 5))
        self.part("top", Rectangle(width=W + 0.16, height=0.1).move_to(P(cx, top + 0.05)).set_fill(dark, 1).set_stroke(S.INK, 5))
        lid = top + 0.1
        self.part("shroud", Polygon(P(coil_x + 0.15, lid), P(coil_x + 0.3, lid + 0.26), P(x1 - 0.3, lid + 0.26), P(x1 - 0.15, lid))
                  .set_fill(dark, 1).set_stroke(S.INK, 5))
        self.part("grille", VGroup(*[line((x, lid + 0.03), (x, lid + 0.23), 2) for x in np.arange(coil_x + 0.35, x1 - 0.32, 0.11)]))
        # access panels (blower, controls) with screws and handles
        panels = VGroup()
        pa, pb = (x0 + 0.12, x0 + 0.9), (x0 + 0.98, coil_x - 0.1)
        for i, (a, b) in enumerate((pa, pb)):
            r = Rectangle(width=b - a, height=CH - 0.24).move_to(P((a + b) / 2, rail_top + CH / 2)).set_fill(opacity=0).set_stroke(S.INK, 3)
            h = RoundedRectangle(width=0.26, height=0.07, corner_radius=0.03).move_to(P((a + b) / 2, rail_top + CH * 0.62)).set_fill("#333333", 1).set_stroke(S.INK, 2)
            panels.add(r, h)
            for j, c in enumerate(((a + 0.08, top - 0.2), (b - 0.08, top - 0.2))):
                panels.add(Dot(P(*c), radius=0.035, color=S.INK))
                self.mark(f"panel_screw_{2 * i + j}", c)
        self.part("panels", panels)
        self.part("vents", VGroup(*[line((pa[0] + 0.12, y), (pa[1] - 0.12, y), 3) for y in np.arange(rail_top + 0.3, rail_top + 1.0, 0.15)]))
        self.part("plate", VGroup(Rectangle(width=0.5, height=0.32).move_to(P((pb[0] + pb[1]) / 2, rail_top + CH * 0.8)).set_fill(S.WHITE, 1).set_stroke(S.INK, 2),
                                  *[line(((pb[0] + pb[1]) / 2 - 0.18, rail_top + CH * 0.8 + dy), ((pb[0] + pb[1]) / 2 + 0.18, rail_top + CH * 0.8 + dy), 1.5, "#777777")
                                    for dy in (0.08, 0.0, -0.08)]))
        word, plate_c, ink_c = brand or (("LEMONNOX", "#F2E6A0", "#7A4A12") if old else ("BRRRIER", "#FFFFFF", "#1F5FA8"))
        badge = RoundedRectangle(width=1.15, height=0.32, corner_radius=0.07).move_to(P((coil_x + x1) / 2, top - 0.45)).set_fill(plate_c, 1).set_stroke(S.INK, 3)
        self.part("badge", VGroup(badge, Text(word, font="DejaVu Sans", weight="BOLD", slant="ITALIC").set(width=0.98).move_to(badge).set_fill(ink_c)))
        # connections: supply/return openings on the house side, whip conduit fitting and LV grommet low on the controls
        sy = supply_y if supply_y is not None else rail_top + CH * 0.72
        ry = return_y if return_y is not None else rail_top + CH * 0.3
        for name, y in (("supply_open", sy), ("return_open", ry)):
            self.part(name, Rectangle(width=0.1, height=0.62).move_to(P(x0 - 0.05, y)).set_fill(dark, 1).set_stroke(S.INK, 3))
            self.mark(name, (x0 - 0.1, y))
        whip = ((pb[0] + pb[1]) / 2 - 0.1, rail_top + 0.38)
        lv = ((pb[0] + pb[1]) / 2 + 0.25, rail_top + 0.72)
        self.part("whip_fitting", Rectangle(width=0.2, height=0.2).move_to(P(*whip)).set_fill("#555555", 1).set_stroke(S.INK, 3))
        self.part("grommet", Circle(radius=0.085).move_to(P(*lv)).set_fill("#222222", 1).set_stroke("#777777", 4))
        self.mark("whip_terminal", whip)
        self.mark("lv_terminal", lv)
        if old:
            rng = random.Random(3)
            spots = VGroup()
            for _ in range(11):
                e = Ellipse(width=rng.uniform(0.12, 0.36), height=rng.uniform(0.08, 0.2))
                e.move_to(P(rng.uniform(x0 + 0.15, x1 - 0.15), rng.uniform(rail_top + 0.08, top - 0.15)))
                spots.add(e.set_fill(rng.choice([S.RUST, S.RUST_LIGHT]), 0.75).set_stroke(width=0))
            for x in (x0 + 0.3, x0 + 1.15, coil_x + 0.5, x1 - 0.5):
                spots.add(line((x, top - 0.05), (x + 0.02, top - 0.7), 3, S.RUST).set_stroke(opacity=0.7))
            self.part("rust", spots)
        else:
            self.part("shine", VGroup(line((x0 + 0.25, rail_top + 1.1), (x0 + 0.65, rail_top + 1.8), 6, S.WHITE),
                                      line((x0 + 0.25, rail_top + 0.7), (x0 + 0.45, rail_top + 1.05), 6, S.WHITE)).set_stroke(opacity=0.75))
        self.mark("grip_L", (x0, rail_top + CH * 0.62))
        self.mark("grip_R", (x1, rail_top + CH * 0.62))
        self.mark("grip_L_low", (x0, rail_top + CH * 0.35))
        self.mark("grip_R_low", (x1, rail_top + CH * 0.35))
        self.mark("foot_spot", (x0, rail_top + 0.75))
        self.mark("top_center", (cx, lid + 0.26))
        self.mark("bottom_center", (cx, pad_top))
        self.bounds = (x0, x1, pad_top, lid + 0.26)
        self.set_z_index(S.Z_PROP)

    def arrive_sparkle(self, run_time=1.2, seed=8):
        x0, x1, y0, y1 = (self.get_left()[0], self.get_right()[0], self.get_bottom()[1], self.get_top()[1])
        pts = [P(x0 - 0.2, y1 + 0.3), P(x1 + 0.3, y1 + 0.2), P((x0 + x1) / 2, y1 + 0.55), P(x1 + 0.35, (y0 + y1) / 2),
               P(x0 + 0.5, (y0 + y1) / 2), P((x0 + x1) / 2 + 0.6, y0 + 0.5)]
        return FX.sparkles(pts, run_time, seed)


# ---------------------------------------------------------------- disconnect
class Disconnect(Prop):
    """Wall-mounted fused disconnect with a lever on its right side (up = ON). Points: handle, pivot, whip_out.
    Method: flip(on)."""

    def __init__(self, center, on=True, w=0.62, h=0.86):
        super().__init__()
        c = P(*center[:2])
        self.part("box", Rectangle(width=w, height=h).move_to(c).set_fill("#C7C7C7", 1).set_stroke(S.INK, S.PROP_W))
        self.part("door_line", line((c[0] - w / 2 + 0.07, c[1] - h / 2 + 0.07), (c[0] - w / 2 + 0.07, c[1] + h / 2 - 0.07), 2))
        self.part("hub", Rectangle(width=0.14, height=0.18).move_to(c + P(-w * 0.15, -h * 0.3)).set_fill("#555555", 1).set_stroke(S.INK, 2))
        pivot = c + P(w / 2 + 0.03, 0.02)
        self.pivot = pivot
        lever = VGroup(Line(pivot, pivot + P(0, 0.46), stroke_width=12, color=S.CAP_RED).set_cap_style(CapStyleType.ROUND),
                       Dot(pivot, radius=0.07, color=S.INK))
        tip = Dot(pivot + P(0, 0.44), radius=0.001).set_fill(opacity=0).set_stroke(width=0)
        lever.add(tip)
        self._points["handle"] = tip
        self.part("lever", lever)
        self.mark("pivot", pivot)
        self.mark("whip_out", (c[0], c[1] - h / 2))
        self.on = True
        if not on:
            lever.rotate(PI, about_point=pivot)
            self.on = False
        self.set_z_index(S.Z_PROP_FRONT)

    def flip(self, on, run_time=0.25):
        if on == self.on:
            return AnimationGroup()
        self.on = on
        return Rotate(self.parts["lever"], -PI if on else PI, about_point=self.pivot, rate_func=ease_out_back, run_time=run_time)


# ---------------------------------------------------------------- ducts, flashing, screws
class Duct(Prop):
    """Sheet-metal duct section from the wall (x_wall) to the unit (x_unit). Points: unit_end, wall_end, grip_L,
    grip_R, center."""

    def __init__(self, x_wall, x_unit, y_center, height=0.62):
        super().__init__()
        cx = (x_wall + x_unit) / 2
        w = x_unit - x_wall
        self.part("box", Rectangle(width=w, height=height).move_to(P(cx, y_center)).set_fill(S.METAL, 1).set_stroke(S.INK, S.PROP_W))
        self.part("flanges", VGroup(*[line((x, y_center - height / 2), (x, y_center + height / 2), 3) for x in (x_wall + 0.15, x_unit - 0.15)]))
        self.part("seam", line((x_wall + 0.15, y_center + height * 0.2), (x_unit - 0.15, y_center + height * 0.2), 2, S.METAL_HI))
        self.mark("unit_end", (x_unit, y_center))
        self.mark("wall_end", (x_wall, y_center))
        self.mark("grip_L", (cx - w * 0.22, y_center + height / 2))
        self.mark("grip_R", (cx + w * 0.22, y_center + height / 2))
        self.mark("center", (cx, y_center))
        self.set_z_index(S.Z_PROP)


class FlashingPanel(Prop):
    """Bendable sheet-metal flashing hinged at the house end (x_hinge) with its free end toward the unit (x_free).
    peel (0 flat .. 1 folded back over the hinge) bends it along a smooth curve: a rounded fold at the hinge, then the
    rest of the sheet. kind="top" curls up and back like peeling tape; kind="side" swings back toward the house with
    its edges bowing. Points: free_end (follows the sheet), hinge. Method: peel_to(p)."""

    def __init__(self, x_hinge, x_free, y0, y1, kind="side"):
        super().__init__()
        self.kind = kind
        self.xh, self.L = x_hinge, x_free - x_hinge
        self.y0, self.y1 = y0, y1
        self.peel = ValueTracker(0.0)
        self.part("sheet", VMobject())
        self.part("lines", VGroup(*[VMobject() for _ in range(2)]))
        self.part("curl", VMobject())
        self.mark("free_end", (x_free, (y0 + y1) / 2))
        self.mark("hinge", (x_hinge, (y0 + y1) / 2))
        self.add_updater(lambda m: m._redraw())
        self._redraw()
        self.set_z_index(S.Z_FLASHING + (0.1 if kind == "top" else 0))

    def _centerline(self, p, n=26):
        """Points along the sheet from the hinge to the free end, as (dx, dy) offsets, and the end direction."""
        phi = PI * p
        r = 0.12 if self.kind == "top" else 0.16
        L = self.L
        arc_len = min(L, r * phi)
        pts = []
        for s in np.linspace(0, L, n):
            if s <= arc_len:
                t = s / r
                pts.append((r * np.sin(t), r * (1 - np.cos(t))))
            else:
                ax, ay = r * np.sin(phi), r * (1 - np.cos(phi))
                pts.append((ax + (s - arc_len) * np.cos(phi), ay + (s - arc_len) * np.sin(phi)))
        return np.array(pts), phi

    def _redraw(self):
        p = float(np.clip(self.peel.get_value(), 0, 1))
        pts, phi = self._centerline(p)
        back = p > 0.5
        color = S.METAL_BACK if back else S.METAL
        ym = (self.y0 + self.y1) / 2
        if self.kind == "top":
            th = (self.y1 - self.y0) / 2
            top_edge, bot_edge = [], []
            for i in range(len(pts)):
                j = min(i + 1, len(pts) - 1)
                k = max(i - 1, 0)
                d = pts[j] - pts[k]
                nrm = np.array([-d[1], d[0]]) / (np.linalg.norm(d) + 1e-9)
                c = np.array([self.xh + pts[i][0], ym + pts[i][1]])
                top_edge.append(P(*(c + nrm * th)))
                bot_edge.append(P(*(c - nrm * th)))
            outline = top_edge + bot_edge[::-1]
            end = P(self.xh + pts[-1][0], ym + pts[-1][1])
        else:
            lift = 0.25  # the side sheet mostly swings back toward the house; a little lift sells the curve
            bulge = 0.16 * np.sin(PI * p)
            n = len(pts)
            top_edge = [P(self.xh + x, self.y1 + y * lift + bulge * np.sin(PI * i / (n - 1))) for i, (x, y) in enumerate(pts)]
            bot_edge = [P(self.xh + x, self.y0 + y * lift - bulge * np.sin(PI * i / (n - 1))) for i, (x, y) in enumerate(pts)]
            outline = top_edge + bot_edge[::-1]
            end = P(self.xh + pts[-1][0], ym + pts[-1][1] * lift)
        sheet = VMobject().set_points_as_corners(outline + [outline[0]]).set_fill(color, 1).set_stroke(S.INK, 4)
        self.parts["sheet"].become(sheet)
        # highlight lines along the sheet (sheet-metal look)
        for i, frac in enumerate((0.3, 0.72)):
            ln = [top_edge[k] * (1 - frac) + bot_edge[k] * frac for k in range(len(top_edge))]
            self.parts["lines"][i].become(VMobject().set_points_as_corners(ln[1:-1]).set_stroke(S.METAL_HI if not back else S.METAL_DARK, 2))
        self._points["free_end"].move_to(end)

    def peel_to(self, p, run_time=0.6, rate_func=smooth):
        return self.peel.animate(run_time=run_time, rate_func=rate_func).set_value(p)


class Screw(Prop):
    """Sheet-metal screw head. Points: head. Methods: back_out(), drive_in(), fly_off(target), fly_in(to)."""

    def __init__(self, p):
        super().__init__()
        p = P(*p[:2])
        self.part("head", Circle(radius=0.085).move_to(p).set_fill("#6A6A6A", 1).set_stroke(S.INK, 2))
        self.part("slot", VGroup(line(p + P(-0.05, 0), p + P(0.05, 0), 2.5, S.WHITE), line(p + P(0, -0.05), p + P(0, 0.05), 2.5, S.WHITE)))
        self.mark("head", p)
        self.home = p
        self.set_z_index(S.Z_SCREW)

    def back_out(self, run_time=0.4):
        """Spins out (counter-clockwise) and stands proud of the surface."""
        start = self.copy()
        return UpdateFromAlphaFunc(self, lambda m, a: m.become(start.copy().scale(1 + 0.3 * a).rotate(TAU * 3 * a)),
                                   run_time=run_time, rate_func=linear)

    def drive_in(self, run_time=0.4):
        start = self.copy()
        return UpdateFromAlphaFunc(self, lambda m, a: m.become(start.copy().scale((1 - 0.3 * a / 1.3)).rotate(-TAU * 3 * a)),
                                   run_time=run_time, rate_func=linear)

    def fly_off(self, target, run_time=0.5, arc=1.2):
        return self.animate(path_arc=arc, run_time=run_time).move_to(target).rotate(3 * PI)

    def fly_in(self, to=None, run_time=0.45, arc=1.2):
        """Flies back and sits loose (proud) in its hole, ready to be driven in."""
        to = self.home if to is None else to
        return self.animate(path_arc=arc, run_time=run_time).move_to(to).set(width=0.17 * 1.3)


# ---------------------------------------------------------------- cables
class Cable:
    """A bendable cable from a fixed start to a movable end (self.end, an invisible Dot).
    connect_end(fn) keeps the end on a point (a terminal, a hand); show (0..1) pulls the stripped conductors out of
    the jacket when it's disconnected. c2 (the last bezier handle) sets how the cable runs into its end.
    Add cable.mob and cable.end to the scene."""

    def __init__(self, start, end, c1, c2, width, color, outline=False, conductors=(), tail_len=0.4, tail_w=4,
                 spread=0.3, strands=None, z=S.Z_WIRE):
        self.start, self.c1, self.c2 = P(*start[:2]), P(*c1[:2]), P(*c2[:2])
        self.w, self.color, self.outline = width, color, outline
        self.conductors, self.tail_len, self.tail_w, self.spread = conductors, tail_len, tail_w, spread
        self.strands, self.z = strands, z
        self.show = ValueTracker(0.0)
        self.end = Dot(P(*end[:2]), radius=0.001).set_fill(opacity=0).set_stroke(width=0)
        self.mob = self.build()
        self.mob.add_updater(lambda m: m.become(self.build()))

    def pt(self, name="end"):
        return self.end.get_center()

    def build(self):
        e = self.end.get_center()
        pts = (self.start, self.start + self.c1, e + self.c2, e)
        layers = []
        if self.outline:
            layers.append(CubicBezier(*pts).set_stroke(S.INK, self.w + 7))
        if self.strands:
            for i, col in enumerate(self.strands):
                off = (i - (len(self.strands) - 1) / 2) * 0.016
                q = [p + np.array([0, off, 0]) for p in pts]
                layers.append(CubicBezier(*q).set_stroke(col if col != "#FFFFFF" else "#E8E8E8", self.w))
        else:
            layers.append(CubicBezier(*pts).set_stroke(self.color, self.w))
        show = self.show.get_value()
        d = -self.c2 / (np.linalg.norm(self.c2) + 1e-9)
        base = np.arctan2(d[1], d[0])
        n = len(self.conductors)
        for k, col in enumerate(self.conductors):
            ang = base + (k - (n - 1) / 2) * self.spread
            tip = e + max(1e-3, self.tail_len * show) * np.array([np.cos(ang), np.sin(ang), 0])
            op = 1.0 if show > 0.02 else 0.0
            layers.append(Line(e, tip).set_stroke(S.INK, self.tail_w + 3, opacity=op))
            layers.append(Line(e, tip).set_stroke(col, self.tail_w, opacity=op))
        return VGroup(*[m.set_cap_style(CapStyleType.ROUND) for m in layers]).set_z_index(self.z)

    def connect_end(self, fn):
        attach_to(self.end, lambda: self.end.get_center(), fn, name="cable_end")

    def free_end(self):
        detach(self.end)

    def strip(self, on=True, run_time=0.2):
        return self.show.animate(run_time=run_time).set_value(1.0 if on else 0.0)

    def reshape(self, c2_to, run_time=0.4):
        c2_from = self.c2.copy()
        c2_to = P(*c2_to[:2])
        return UpdateFromAlphaFunc(Dot(radius=0.001).set_opacity(0),
                                   lambda m, a: setattr(self, "c2", c2_from + (c2_to - c2_from) * smooth(a)),
                                   run_time=run_time, rate_func=linear, remover=True)


def HighVoltageWhip(start, end, c1, c2):
    """Thick black-outlined gray conduit whip; two black + one green conductor when pulled out."""
    return Cable(start, end, c1, c2, 13, "#5A5A5A", outline=True, conductors=S.WHIP_CONDUCTORS,
                 tail_len=0.6, tail_w=7, spread=0.42)


def LowVoltageWire(start, end, c1, c2):
    """Thin thermostat cable: red/white/green/yellow strands bundled; eight colour-coded conductors when stripped."""
    return Cable(start, end, c1, c2, 2.5, "#8A7560", strands=S.LV_STRANDS, conductors=S.LV_CONDUCTORS,
                 tail_len=0.48, tail_w=3.5, spread=0.19)


# extra equipment (split condenser, air handler, furnace, thermostat, breaker panel...) lives in hvac_more.py
try:
    from .hvac_more import *  # noqa: F401,F403
except ImportError:
    pass
except Exception as exc:  # a broken optional extra must not take the core library down with it
    import warnings
    warnings.warn(f"stickworld: could not load hvac_more: {exc!r}")
