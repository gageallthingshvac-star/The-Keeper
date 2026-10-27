"""Stick-figure YouTube Short: HVAC package unit changeout.

Preview:  manim -ql hvac_short.py PackageUnitChangeout
Final:    manim -qh --fps 30 -r 1080,1920 hvac_short.py PackageUnitChangeout
"""
import random

import numpy as np
from manim import *
from manim.utils.rate_functions import (
    ease_in_out_sine,
    ease_out_back,
    ease_out_bounce,
    ease_out_cubic,
    ease_out_elastic,
)

# ---------------------------------------------------------------- frame setup
# Force portrait 9:16 no matter which -q preset is used.
if config.pixel_width > config.pixel_height:
    config.pixel_width, config.pixel_height = config.pixel_height, config.pixel_width
config.frame_height = 16
config.frame_width = 9
config.background_color = WHITE

# ---------------------------------------------------------------- palette
INK = "#111111"
OLD_C = "#BDB5A6"
OLD_LID = "#A39A89"
RUST = "#8B4513"
RUST2 = "#A0522D"
NEW_C = "#8EA9C1"
NEW_LID = "#6F8FAB"
OLD_COIL = "#8F877A"
NEW_COIL = "#5F7D98"
AIR_C = "#7CC6EE"
DUCT_C = "#DADADA"
FLASH_C = "#B4BCC4"
WALL_C = "#F3F0EA"
SIDING_C = "#D8D2C8"
CAP_C = "#C0392B"
BAG_C = "#4A4A4A"
SMOKE_C = "#9E9E9E"
SPARK_C = "#FFD54A"
LW = 9

# ---------------------------------------------------------------- layout
GROUND = -1.5
HIP = GROUND + 1.1
STREET = -6.6
SHIP = STREET + 1.1
WALL_X = -3.2
UNIT_L, UNIT_R, UNIT_TOP = -1.2, 2.0, 0.55
PAD_TOP = GROUND + 0.12
BASE_TOP = PAD_TOP + 0.1
LID_TOP = UNIT_TOP + 0.08
COIL_X = 0.5
WHIP_END = np.array([-0.05, -1.0, 0])   # conduit fitting, low on the control panel
LV_END = np.array([0.35, -0.72, 0])      # low-voltage grommet on the control panel
RING = LV_END
WHIP_TAILS = ["#111111", "#111111", "#2E9E44"]
LV_TAILS = ["#111111", "#7B4A1E", "#2E9E44", "#2F6FD6", "#F2D21B", "#D63A2F", "#FFFFFF", "#F28C1B"]
PIVOT = np.array([-3.58, 0.6, 0])
SUPPLY_Y = (-0.15, 0.35)
RETURN_Y = (-1.0, -0.5)
FLASH_Y0, FLASH_Y1 = -1.12, 0.47
STRIP_H = (FLASH_Y1 - FLASH_Y0) / 3
STRIP_Y = [FLASH_Y1 - STRIP_H * (i + 0.5) for i in range(3)]  # top, middle, bottom
T2_HOME = 3.0


def P3(x, y):
    return np.array([x, y, 0.0])


def dirv(a):
    """Unit vector at angle a measured from straight down, + toward the right."""
    return np.array([np.sin(a), -np.cos(a), 0.0])


def ik2(root, target, l1, l2, bend):
    d = target - root
    dist = np.clip(np.linalg.norm(d[:2]), 1e-3, l1 + l2 - 1e-3)
    theta = np.arctan2(d[0], -d[1])
    cos_a = (l1 ** 2 + dist ** 2 - l2 ** 2) / (2 * l1 * dist)
    a = theta + bend * np.arccos(np.clip(cos_a, -1, 1))
    elbow = root + l1 * dirv(a)
    d2 = target - elbow
    b = np.arctan2(d2[0], -d2[1])
    return a, (b - a + PI) % TAU - PI


def seg(p, q, w=LW, color=INK):
    return Line(p, q, stroke_width=w, color=color).set_cap_style(CapStyleType.ROUND)


# ---------------------------------------------------------------- stick figure
class Stick(VGroup):
    T, U, A, R = 1.0, 0.55, 0.55, 0.32
    DEF = dict(x=0.0, y=HIP, lean=0.0, l1=0.15, k1=0.0, l2=-0.15, k2=0.0,
               a1=0.25, e1=-0.1, a2=-0.25, e2=0.1, hx=0.0, hy=0.0, hair=0.0,
               tongue=0.0, squint=0.0, sy=1.0, look=0.0, face=-1.0)

    def __init__(self, cap=False, **st):
        super().__init__()
        self.cap = cap
        self.state = {**self.DEF, **st}
        self.add(*self._parts(self.state))
        self.hands = [None, self[8].get_end(), self[6].get_end()]

    def _up(self, s):
        return np.array([np.sin(s["lean"]), np.cos(s["lean"]), 0.0])

    def shoulder(self, s):
        return P3(s["x"], s["y"]) + self._up(s) * (self.T - 0.08)

    def _parts(self, s):
        hip = P3(s["x"], s["y"])
        up = self._up(s)
        neck = hip + self.T * up
        sh = neck - 0.08 * up
        k1 = hip + self.U * dirv(s["l1"]); f1 = k1 + self.U * dirv(s["l1"] + s["k1"])
        k2 = hip + self.U * dirv(s["l2"]); f2 = k2 + self.U * dirv(s["l2"] + s["k2"])
        e1 = sh + self.A * dirv(s["a1"]); h1 = e1 + self.A * dirv(s["a1"] + s["e1"])
        e2 = sh + self.A * dirv(s["a2"]); h2 = e2 + self.A * dirv(s["a2"] + s["e2"])
        hc = neck + up * (self.R + 0.03) + P3(s["hx"], s["hy"])
        parts = [seg(hip, neck), seg(hip, k1), seg(k1, f1), seg(hip, k2), seg(k2, f2),
                 seg(sh, e2), seg(e2, h2), seg(sh, e1), seg(e1, h1)]
        parts.append(Circle(radius=self.R).move_to(hc)
                     .set_stroke(INK, LW).set_fill(WHITE, 1))
        lx = s["look"] * 0.11
        eh = 0.05 * (1 - s["squint"]) + 0.004
        for dx in (-0.085, 0.085):
            ex, ey = hc[0] + lx + dx, hc[1] + 0.05
            parts.append(seg(P3(ex, ey - eh), P3(ex, ey + eh), w=8))
        parts.append(seg(hc + P3(lx - 0.07, -0.14), hc + P3(lx + 0.07, -0.14), w=4))
        parts.append(Ellipse(width=0.11, height=0.15).move_to(hc + P3(lx + 0.03, -0.21))
                     .set_fill("#E87A8A", s["tongue"]).set_stroke(INK, 2, opacity=s["tongue"]))
        hl = 0.02 + 0.4 * s["hair"]
        for ang in np.linspace(-0.9, 0.9, 5):
            d = np.array([np.sin(ang), np.cos(ang), 0])
            base = hc + d * self.R
            parts.append(seg(base, base + d * hl, w=5)
                         .set_stroke(opacity=1.0 if s["hair"] > 0.03 else 0.0))
        if self.cap:
            lift = 0.45 * s["hair"]
            cc = hc + P3(0, self.R * 0.3 + lift)
            pts = [cc + P3(self.R * 1.08 * np.cos(t), self.R * 1.0 * np.sin(t)) for t in np.linspace(0, PI, 18)]
            parts.append(Polygon(*pts).set_fill(CAP_C, 1).set_stroke(INK, 4))
            f = s["face"]
            parts.append(seg(cc + P3(-f * 0.15, 0.0), cc + P3(f * 0.62, -0.02), w=7, color=CAP_C))
        g = VGroup(*parts)
        if abs(s["sy"] - 1) > 1e-3:
            base = P3(s["x"], min(f1[1], f2[1]))
            g.stretch(s["sy"], 1, about_point=base)
            g.stretch(1 / np.sqrt(s["sy"]), 0, about_point=base)
        return parts

    def rebuild(self):
        parts = self._parts(self.state)
        for m, n in zip(self.submobjects, parts):
            m.become(n)
        self.hands = [None, self[8].get_end(), self[6].get_end()]

    def head(self):
        return self[9].get_center()

    def arm(self, pt, which=1, bend=None, **over):
        s = {**self.state, **over}
        sh = self.shoulder(s)
        pt = P3(pt[0], pt[1])
        if bend is None:
            bend = -1 if np.arctan2(pt[0] - sh[0], -(pt[1] - sh[1])) > 0 else 1
        a, e = ik2(sh, pt, self.A, self.A, bend)
        return {**over, f"a{which}": a, f"e{which}": e}

    def leg(self, pt, which=1, bend=None, **over):
        s = {**self.state, **over}
        if bend is None:
            bend = 1 if s["face"] > 0 else -1
        a, k = ik2(P3(s["x"], s["y"]), P3(pt[0], pt[1]), self.U, self.U, bend)
        return {**over, f"l{which}": a, f"k{which}": k}


class Pose(Animation):
    """Interpolate a stick figure's joint state (angles, not points)."""

    def __init__(self, fig, rt=0.3, rf=smooth, arc=0.0, **target):
        self.fig, self.target, self.arc = fig, target, arc
        super().__init__(fig, run_time=rt, rate_func=rf)

    def begin(self):
        self.s0 = dict(self.fig.state)
        self.s1 = {**self.s0, **self.target}
        super().begin()

    def interpolate_mobject(self, alpha):
        a = self.rate_func(alpha)
        s = {k: self.s0[k] + (self.s1[k] - self.s0[k]) * a for k in self.s0}
        s["y"] += self.arc * 4 * alpha * (1 - alpha)
        self.fig.state = s
        self.fig.rebuild()


class Walk(Animation):
    def __init__(self, fig, x, y=None, steps=4, rt=1.0, swing=0.45, hold=(), rf=linear):
        self.fig, self.tx, self.ty, self.steps = fig, x, y, steps
        self.swing, self.hold = swing, hold
        super().__init__(fig, run_time=rt, rate_func=rf)

    def begin(self):
        self.s0 = dict(self.fig.state)
        if self.ty is None:
            self.ty = self.s0["y"]
        d = self.tx - self.s0["x"]
        self.face = float(np.sign(d)) if abs(d) > 1e-3 else self.s0["face"]
        super().begin()

    def interpolate_mobject(self, alpha):
        a = self.rate_func(alpha)
        s0 = self.s0
        s = dict(s0)
        sw = np.sin(self.steps * PI * alpha)
        env = min(1.0, alpha * 8, (1 - alpha) * 8)
        s["x"] = s0["x"] + (self.tx - s0["x"]) * a
        s["y"] = s0["y"] + (self.ty - s0["y"]) * a + 0.08 * abs(sw) * env
        s["l1"] = s0["l1"] * (1 - env) + self.swing * sw * env
        s["l2"] = s0["l2"] * (1 - env) - self.swing * sw * env
        s["k1"] = s0["k1"] * (1 - env) - 0.35 * self.face * max(0, -sw) * env
        s["k2"] = s0["k2"] * (1 - env) - 0.35 * self.face * max(0, sw) * env
        if 1 not in self.hold:
            s["a1"] = s0["a1"] * (1 - env) - 0.45 * sw * env
            s["e1"] = s0["e1"] * (1 - env) + 0.3 * self.face * env
        if 2 not in self.hold:
            s["a2"] = s0["a2"] * (1 - env) + 0.45 * sw * env
            s["e2"] = s0["e2"] * (1 - env) + 0.3 * self.face * env
        s["lean"] = s0["lean"] * (1 - env) + 0.08 * self.face * env
        s["face"] = self.face
        s["look"] = 0.6 * self.face
        self.fig.state = s
        self.fig.rebuild()


# ---------------------------------------------------------------- wires
class Wire:
    def __init__(self, start, end, c1, c2, width, color, outline=False,
                 tails=(), tail_len=0.3, tail_w=3, spread=0.2):
        self.start, self.c1, self.c2 = P3(*start[:2]), P3(*c1), P3(*c2)
        self.w, self.color, self.outline = width, color, outline
        self.tails, self.tail_len, self.tail_w, self.spread = tails, tail_len, tail_w, spread
        self.show = ValueTracker(0.0)  # 0 = conductors hidden inside the unit, 1 = stripped ends showing
        self.end = Dot(P3(*end[:2]), radius=0.001).set_opacity(0)
        self.mob = self.build()
        self.mob.add_updater(lambda m: m.become(self.build()))

    def build(self):
        e = self.end.get_center()
        pts = (self.start, self.start + self.c1, e + self.c2, e)
        layers = []
        if self.outline:
            layers.append(CubicBezier(*pts).set_stroke(INK, self.w + 7))
        layers.append(CubicBezier(*pts).set_stroke(self.color, self.w))
        show = self.show.get_value()
        d = -self.c2 / np.linalg.norm(self.c2)
        base = np.arctan2(d[1], d[0])
        n = len(self.tails)
        for k, col in enumerate(self.tails):
            ang = base + (k - (n - 1) / 2) * self.spread
            tip = e + max(1e-3, self.tail_len * show) * P3(np.cos(ang), np.sin(ang))
            op = 1.0 if show > 0.02 else 0.0
            layers.append(Line(e, tip).set_stroke(INK, self.tail_w + 3, opacity=op))
            layers.append(Line(e, tip).set_stroke(col, self.tail_w, opacity=op))
        return VGroup(*[m.set_cap_style(CapStyleType.ROUND) for m in layers]).set_z_index(5)


# ---------------------------------------------------------------- props
def make_unit(new=False):
    """Residential package unit, side view: blower/control panels left, condenser coil right, fan on top."""
    fill, lid_c, coil_c = (NEW_C, NEW_LID, NEW_COIL) if new else (OLD_C, OLD_LID, OLD_COIL)
    w, h = UNIT_R - UNIT_L, UNIT_TOP - BASE_TOP
    cx, cy = (UNIT_L + UNIT_R) / 2, (UNIT_TOP + BASE_TOP) / 2
    rail = Rectangle(width=w + 0.06, height=BASE_TOP - PAD_TOP).move_to(P3(cx, (BASE_TOP + PAD_TOP) / 2)) \
        .set_fill("#4A4A4A", 1).set_stroke(INK, 4)
    cab = Rectangle(width=w, height=h).move_to(P3(cx, cy)).set_fill(fill, 1).set_stroke(INK, 6)
    lid = Rectangle(width=w + 0.14, height=0.08).move_to(P3(cx, UNIT_TOP + 0.04)) \
        .set_fill(lid_c, 1).set_stroke(INK, 5)
    # condenser fan shroud + grille on top
    shroud = Polygon(P3(COIL_X + 0.15, LID_TOP), P3(COIL_X + 0.28, LID_TOP + 0.2),
                     P3(UNIT_R - 0.28, LID_TOP + 0.2), P3(UNIT_R - 0.15, LID_TOP)) \
        .set_fill(lid_c, 1).set_stroke(INK, 5)
    grille = VGroup(*[seg(P3(x, LID_TOP + 0.02), P3(x, LID_TOP + 0.18), w=2)
                      for x in np.arange(COIL_X + 0.32, UNIT_R - 0.3, 0.1)])
    # condenser coil behind a wire guard
    cy0, cy1 = BASE_TOP + 0.12, UNIT_TOP - 0.1
    coil = Rectangle(width=UNIT_R - 0.1 - COIL_X - 0.08, height=cy1 - cy0) \
        .move_to(P3((COIL_X + 0.08 + UNIT_R - 0.1) / 2, (cy0 + cy1) / 2)).set_fill(coil_c, 1).set_stroke(INK, 4)
    fins = VGroup(*[seg(P3(x, cy0), P3(x, cy1), w=1.5, color="#3A3A3A")
                    for x in np.arange(COIL_X + 0.16, UNIT_R - 0.12, 0.08)])
    guard = VGroup(*[seg(P3(COIL_X + 0.08, y), P3(UNIT_R - 0.1, y), w=2.5)
                     for y in np.arange(cy0 + 0.25, cy1, 0.28)])
    post = seg(P3(COIL_X, BASE_TOP), P3(COIL_X, UNIT_TOP), w=5)
    # blower and control access panels
    panels = VGroup()
    for x0, x1 in ((UNIT_L + 0.1, -0.35), (-0.27, COIL_X - 0.08)):
        pnl = Rectangle(width=x1 - x0, height=h - 0.2).move_to(P3((x0 + x1) / 2, cy)) \
            .set_fill(opacity=0).set_stroke(INK, 3)
        handle = RoundedRectangle(width=0.22, height=0.06, corner_radius=0.03) \
            .move_to(P3((x0 + x1) / 2, cy + 0.15)).set_fill("#333333", 1).set_stroke(INK, 2)
        screws = VGroup(*[Dot(pnl.get_corner(c) + 0.07 * (-c), radius=0.03, color=INK) for c in (UL, UR, DL, DR)])
        panels.add(pnl, handle, screws)
    vents = VGroup(*[seg(P3(UNIT_L + 0.25, y), P3(-0.5, y), w=3) for y in np.arange(BASE_TOP + 0.25, cy - 0.15, 0.13)])
    plate = Rectangle(width=0.4, height=0.28).move_to(P3(0.07, 0.05)).set_fill(WHITE, 1).set_stroke(INK, 2)
    plate_txt = VGroup(*[seg(P3(-0.08, y), P3(0.22, y), w=1.5, color="#777777")
                         for y in (0.12, 0.05, -0.02)])
    fitting = Rectangle(width=0.18, height=0.18).move_to(WHIP_END).set_fill("#555555", 1).set_stroke(INK, 3)
    ring = Circle(radius=0.075).move_to(RING).set_fill("#222222", 1).set_stroke("#777777", 4)
    g = VGroup(rail, cab, coil, fins, guard, post, lid, shroud, grille, panels, vents, plate, plate_txt, fitting, ring)
    rng = random.Random(3)
    if new:
        g.add(VGroup(seg(P3(UNIT_L + 0.2, BASE_TOP + 0.9), P3(UNIT_L + 0.55, BASE_TOP + 1.5), w=6, color=WHITE),
                     seg(P3(UNIT_L + 0.2, BASE_TOP + 0.55), P3(UNIT_L + 0.38, BASE_TOP + 0.85), w=6, color=WHITE))
              .set_stroke(opacity=0.75))
    else:
        spots = VGroup()
        for _ in range(10):
            e = Ellipse(width=rng.uniform(0.12, 0.32), height=rng.uniform(0.08, 0.2))
            e.move_to(P3(rng.uniform(UNIT_L + 0.15, UNIT_R - 0.15), rng.uniform(BASE_TOP + 0.08, UNIT_TOP - 0.15)))
            spots.add(e.set_fill(rng.choice([RUST, RUST2]), 0.75).set_stroke(width=0))
        for x in (-0.9, -0.1, 1.0, 1.6):
            spots.add(seg(P3(x, UNIT_TOP - 0.05), P3(x + 0.02, UNIT_TOP - 0.6), w=3, color=RUST).set_stroke(opacity=0.7))
        g.add(spots)
    g.set_z_index(2)
    return g


def make_duct(y0, y1):
    cx = (WALL_X + UNIT_L) / 2
    r = Rectangle(width=UNIT_L - WALL_X, height=y1 - y0).move_to(P3(cx, (y0 + y1) / 2)) \
        .set_fill(DUCT_C, 1).set_stroke(INK, 5)
    fl = VGroup(*[seg(P3(x, y0), P3(x, y1), w=3) for x in (WALL_X + 0.15, UNIT_L - 0.15)])
    seam = seg(P3(WALL_X + 0.15, (y0 + y1) / 2), P3(UNIT_L - 0.15, (y0 + y1) / 2), w=2, color="#AAAAAA")
    return VGroup(r, fl, seam).set_z_index(2)


def make_strip(cy):
    cx = (WALL_X + UNIT_L) / 2
    r = Rectangle(width=UNIT_L - WALL_X + 0.06, height=STRIP_H).move_to(P3(cx, cy)) \
        .set_fill(FLASH_C, 1).set_stroke(INK, 4)
    crease = seg(P3(WALL_X + 0.1, cy + STRIP_H * 0.28), P3(UNIT_L - 0.1, cy + STRIP_H * 0.28), w=2, color="#8D959E")
    return VGroup(r, crease).set_z_index(3)


def make_screw(p):
    c = Circle(radius=0.075).move_to(p).set_fill("#6A6A6A", 1).set_stroke(INK, 2)
    x = VGroup(seg(p + P3(-0.045, 0), p + P3(0.045, 0), w=2, color=WHITE),
               seg(p + P3(0, -0.045), p + P3(0, 0.045), w=2, color=WHITE))
    return VGroup(c, x).set_z_index(4)


def make_truck():
    front = Polygon(P3(-0.75, -6.15), P3(-0.75, -5.4), P3(0.35, -5.3), P3(0.8, -4.3),
                    P3(2.0, -4.3), P3(2.0, -6.15))
    window = Polygon(P3(0.6, -5.15), P3(0.92, -4.5), P3(1.85, -4.5), P3(1.85, -5.15))
    cab = Difference(front, window).set_fill(WHITE, 1).set_stroke(INK, 6)
    win_frame = window.copy().set_fill(opacity=0).set_stroke(INK, 5)
    bed = Rectangle(width=2.7, height=1.1).move_to(P3(3.4, -5.6)).set_fill(WHITE, 1).set_stroke(INK, 6)
    door = VGroup(seg(P3(0.55, -5.25), P3(0.55, -6.05), w=3), seg(P3(1.25, -5.4), P3(1.5, -5.4), w=4))
    light = Circle(radius=0.12).move_to(P3(-0.68, -5.6)).set_fill(SPARK_C, 1).set_stroke(INK, 3)
    bumper = Rectangle(width=0.25, height=0.3).move_to(P3(-0.8, -5.95)).set_fill(INK, 1).set_stroke(INK, 2)
    label = Text("HVAC", font="DejaVu Sans", weight=BOLD).set(height=0.36).move_to(P3(3.4, -5.6)).set_fill(INK)
    rack = VGroup(seg(P3(2.2, -5.05), P3(2.2, -4.55), w=5), seg(P3(4.6, -5.05), P3(4.6, -4.55), w=5),
                  seg(P3(2.2, -4.55), P3(4.6, -4.55), w=5))
    body = VGroup(rack, bed, cab, win_frame, door, light, bumper, label)
    wheels = VGroup()
    for x in (0.05, 3.8):
        wheels.add(Circle(radius=0.45).move_to(P3(x, -6.15)).set_fill(INK, 1).set_stroke(INK, 2),
                   Circle(radius=0.17).move_to(P3(x, -6.15)).set_fill("#CCCCCC", 1).set_stroke(INK, 2))
    t = VGroup(body, wheels).set_z_index(6)
    t.body, t.wheels = body, wheels
    return t


def make_bag(p):
    box = RoundedRectangle(width=0.62, height=0.38, corner_radius=0.08).set_fill(BAG_C, 1).set_stroke(INK, 4)
    handle = Arc(radius=0.17, start_angle=0, angle=PI).set_stroke(INK, 5).next_to(box, UP, buff=-0.02)
    stripe = seg(box.get_left() + RIGHT * 0.06, box.get_right() + LEFT * 0.06, w=3, color="#BBBBBB")
    g = VGroup(box, stripe, handle).set_z_index(7.5)
    g.shift(p - handle.get_top())
    return g


def sfx_text(word, pos, h=1.0, color="#FFD400", angle=0.12):
    t = Text(word, font="DejaVu Sans", weight=BOLD).set(height=h)
    t.set_fill(color, 1).set_stroke(INK, 10, background=True)
    return t.rotate(angle).move_to(pos).set_z_index(10)


def sfx(word, pos, h=1.0, color="#FFD400", angle=0.12, hold=0.35):
    t = sfx_text(word, pos, h, color, angle)
    return Succession(GrowFromCenter(t, run_time=0.18, rate_func=ease_out_back),
                      Wait(hold),
                      FadeOut(t, scale=1.35, run_time=0.22))


def puff(pos, n=5, r=0.17, spread=0.3, rise=0.8, rt=1.0, seed=0, color=SMOKE_C):
    rng = random.Random(seed)
    anims = []
    for _ in range(n):
        c = Circle(radius=r * rng.uniform(0.7, 1.3)).set_fill(color, 0.8).set_stroke(INK, 3, opacity=0.5)
        c.move_to(pos + P3(rng.uniform(-spread, spread), rng.uniform(-spread / 2, spread / 2))).set_z_index(9)
        drift = UP * rise + RIGHT * rng.uniform(-0.3, 0.3)
        anims.append(Succession(FadeIn(c, scale=0.2, run_time=rt * 0.3),
                                FadeOut(c, shift=drift, scale=2.2, run_time=rt * 0.7)))
    return LaggedStart(*anims, lag_ratio=0.15)


def sparkles(points, rt=1.0, seed=0):
    rng = random.Random(seed)
    anims = []
    for p in points:
        s = Star(4, outer_radius=rng.uniform(0.2, 0.32), inner_radius=0.06) \
            .set_fill(SPARK_C, 1).set_stroke(INK, 3).move_to(p).set_z_index(9)
        anims.append(Succession(FadeIn(s, scale=0.1, run_time=rt * 0.35, rate_func=ease_out_back),
                                FadeOut(s, scale=0.1, run_time=rt * 0.4)))
    return LaggedStart(*anims, lag_ratio=0.2)


def bolt(a, b, seed):
    rng = random.Random(seed)
    pts = [a]
    for t in np.linspace(0, 1, 7)[1:-1]:
        p = a + (b - a) * t
        pts.append(p + P3(rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15)))
    pts.append(b)
    under = VMobject().set_points_as_corners(pts).set_stroke(INK, 14)
    over = VMobject().set_points_as_corners(pts).set_stroke("#FFE135", 7)
    return VGroup(under, over).set_z_index(9)


# ---------------------------------------------------------------- the short
class PackageUnitChangeout(MovingCameraScene):
    def construct(self):
        self.build_set()
        self.scene_arrive()
        self.scene_hop_out()
        self.scene_disconnect_zap()
        self.scene_banana_flashing()
        self.scene_duct_yank()
        self.scene_wire_pullstart()
        self.scene_rip_unit()
        self.scene_new_unit()
        self.scene_rewind()
        self.scene_thread_needle()
        self.scene_power_up()

    # ------------------------------------------------------------ helpers
    def pose(self, fig, rt=0.3, rf=smooth, arc=0.0, **kw):
        return Pose(fig, rt=rt, rf=rf, arc=arc, **kw)

    def shake_head(self, fig, n=4, amt=0.07, rt=0.3):
        anims = [self.pose(fig, rt=rt, rf=ease_in_out_sine, hx=amt * (1 if i % 2 else -1)) for i in range(n)]
        anims.append(self.pose(fig, rt=rt / 2, hx=0.0))
        return Succession(*anims)

    def cam_shake(self, amt=0.15, n=6, rt=0.4):
        f = self.camera.frame
        base = f.get_center()
        rng = random.Random(11)
        moves = [base + P3(rng.uniform(-amt, amt), rng.uniform(-amt, amt)) for _ in range(n - 1)] + [base]
        return Succession(*[f.animate(run_time=rt / n, rate_func=linear).move_to(m) for m in moves])

    def crouch(self, fig, drop, lean, spread=0.25, **over):
        """Bend the knees (feet stay on the ground) and lean the torso."""
        s = {**fig.state, **over}
        d = {**over, "y": HIP - drop, "lean": lean}
        d = fig.leg(P3(s["x"] - spread, GROUND), 1, **d)
        return fig.leg(P3(s["x"] + spread, GROUND), 2, **d)

    def follow(self, mob, fig, which=1, offset=None):
        if offset is None:
            offset = mob.get_center() - fig.hands[which]
        mob.add_updater(lambda m: m.move_to(fig.hands[which] + offset))

    # ------------------------------------------------------------ set
    def build_set(self):
        wall = Rectangle(width=2.0, height=7.0).move_to(P3(WALL_X - 1.0, GROUND + 3.5)) \
            .set_fill(WALL_C, 1).set_stroke(INK, 6)
        siding = VGroup(*[seg(P3(WALL_X - 2.0, y), P3(WALL_X, y), w=2, color=SIDING_C)
                          for y in np.arange(GROUND + 0.45, GROUND + 7.0, 0.45)])
        roof = Polygon(P3(-4.6, 5.5), P3(-2.75, 5.5), P3(-2.75, 5.8), P3(-4.6, 7.2)) \
            .set_fill("#5E5E5E", 1).set_stroke(INK, 5)
        ground = seg(P3(-4.6, GROUND), P3(4.6, GROUND), w=6)
        street = seg(P3(-4.6, STREET), P3(4.6, STREET), w=6)
        curb = seg(P3(-4.6, -4.2), P3(4.6, -4.2), w=3, color="#BBBBBB")
        rng = random.Random(5)
        tufts = VGroup()
        for _ in range(14):
            p = P3(rng.uniform(-4.2, 4.2), rng.choice([GROUND, rng.uniform(-4.0, -1.9)]))
            tufts.add(VGroup(seg(p, p + P3(-0.08, 0.16), w=3), seg(p, p + P3(0.0, 0.2), w=3),
                             seg(p, p + P3(0.08, 0.16), w=3)).set_stroke(color="#7A9A6A"))
        self.add(VGroup(wall, siding, roof, ground, street, curb, tufts).set_z_index(0))

        box = Rectangle(width=0.55, height=0.8).move_to(P3(-3.9, 0.6)).set_fill("#C7C7C7", 1).set_stroke(INK, 5)
        pad = Rectangle(width=UNIT_R - UNIT_L + 0.3, height=PAD_TOP - GROUND) \
            .move_to(P3((UNIT_L + UNIT_R) / 2, (PAD_TOP + GROUND) / 2)).set_fill("#CFCFCF", 1).set_stroke(INK, 4)
        self.add(box.set_z_index(3.5), pad.set_z_index(1))
        self.lever = VGroup(seg(PIVOT, PIVOT + UP * 0.37, w=10, color=CAP_C),
                            Dot(PIVOT, radius=0.06, color=INK)).set_z_index(3.6)
        self.add(self.lever)

        self.ducts = [make_duct(*SUPPLY_Y), make_duct(*RETURN_Y)]
        self.duct_home = [d.copy() for d in self.ducts]
        self.strips = [make_strip(y) for y in STRIP_Y]
        self.strip_home = [st.copy() for st in self.strips]
        self.screws = [make_screw(P3(x, y)) for y in STRIP_Y for x in (UNIT_L - 0.2, -2.2)]
        self.screw_home = [s.copy() for s in self.screws]
        self.unit = make_unit(new=False)
        self.add(*self.ducts, *self.strips, *self.screws, self.unit)

        self.whip = Wire((-3.9, 0.2), WHIP_END, (0.0, -1.3), (-1.4, -0.3), 12, "#5A5A5A", outline=True,
                         tails=WHIP_TAILS, tail_len=0.6, tail_w=7, spread=0.42)
        self.lv = Wire((WALL_X, -1.22), LV_END, (0.8, -0.1), (-0.9, -0.45), 5, "#8A7560",
                       tails=LV_TAILS, tail_len=0.5, tail_w=4, spread=0.2)
        self.add(self.whip.end, self.lv.end, self.whip.mob, self.lv.mob)

        self.truck = make_truck().shift(RIGHT * 9)
        sit = dict(y=-6.13, l1=-1.85, k1=3.4, l2=-1.75, k2=3.3, a1=-0.9, e1=-0.6, a2=-0.7, e2=-0.6)
        self.t1 = Stick(x=1.05 + 9, face=-1, look=-0.6, **sit).set_z_index(5)
        self.t2 = Stick(cap=True, x=1.55 + 9, face=-1, look=0.0, **sit).set_z_index(5)
        self.bag = make_bag(P3(-0.25, -4.95))
        self.add(self.t1, self.t2, self.truck)

    # ------------------------------------------------------------ 1
    def scene_arrive(self):
        t1, t2 = self.t1, self.t2
        self.add(self.bag.shift(RIGHT * 9))
        self.play(
            self.truck.animate.shift(LEFT * 9), self.bag.animate.shift(LEFT * 9),
            self.pose(t1, rt=1.3, rf=ease_out_cubic, x=1.05),
            self.pose(t2, rt=1.3, rf=ease_out_cubic, x=1.55),
            Succession(Wait(0.3), puff(P3(1.1, LID_TOP + 0.2), n=4, seed=1, rt=1.0)),
            Succession(Wait(0.35), Wiggle(self.unit, scale_value=1.02, rotation_angle=0.03, run_time=0.6)),
            run_time=1.3, rate_func=ease_out_cubic,
        )
        body = VGroup(self.truck.body, self.bag)
        self.play(
            body.animate(rate_func=there_and_back).shift(DOWN * 0.18),
            self.pose(t1, rt=0.3, rf=there_and_back, y=-6.31),
            self.pose(t2, rt=0.3, rf=there_and_back, y=-6.31),
            run_time=0.3,
        )
        self.play(body.animate(rate_func=there_and_back).shift(DOWN * 0.06), run_time=0.2)

    # ------------------------------------------------------------ 2
    def scene_hop_out(self):
        t1, t2, bag = self.t1, self.t2, self.bag
        stand = dict(l1=0.15, k1=0.0, l2=-0.15, k2=0.0, a1=0.25, e1=-0.1, a2=-0.25, e2=0.1)
        self.play(self.pose(t1, rt=0.12, sy=0.9))
        self.play(self.pose(t1, rt=0.6, arc=2.4, rf=linear, x=-1.15, y=SHIP, sy=1.0, a1=-2.5, e1=0.3,
                            a2=2.5, e2=-0.3, l1=0.2, l2=-0.5, k1=0, k2=0.4))
        t1.set_z_index(7)
        self.play(self.pose(t1, rt=0.1, sy=0.75, **stand))
        self.play(self.pose(t1, rt=0.2, rf=ease_out_back, sy=1.0, look=0.6, face=1))
        handle = bag[2].get_top()
        self.play(self.pose(t1, rt=0.25, **t1.arm(handle + DOWN * 0.03, 1, lean=0.2)))
        self.follow(bag, t1, 1)
        bag.set_z_index(7.5)
        self.play(self.pose(t1, rt=0.2, rf=ease_out_back, lean=0.0, a1=0.2, e1=0.0))

        # Tech 2 tumbles out
        self.play(
            self.pose(t2, rt=0.7, arc=2.2, rf=linear, x=-2.7, y=SHIP - 0.3, lean=-1.3,
                      a1=-2.8, e1=0, a2=-2.4, e2=0, l1=0.6, k1=0.3, l2=0.2, k2=0.5, look=-0.8),
            self.pose(t1, rt=0.7, look=-0.7, face=-1),
        )
        t2.set_z_index(7)
        self.play(sfx("THUMP", P3(-2.4, -3.6), h=0.6, color="#FF8A00", angle=-0.15, hold=0.15),
                  self.pose(t2, rt=0.35, rf=ease_out_back, y=SHIP, lean=0.0, look=0.4, face=1, **stand))

        self.play(
            Walk(t1, -2.85, HIP, steps=9, rt=2.3, hold=(1,), rf=smooth),
            Walk(t2, T2_HOME, HIP, steps=9, rt=2.3, rf=smooth),
        )

    # ------------------------------------------------------------ 3
    def scene_disconnect_zap(self):
        t1, t2, bag = self.t1, self.t2, self.bag
        bag.clear_updaters()
        self.play(bag.animate(path_arc=0.8).move_to(P3(-3.85, GROUND - 0.25)),
                  self.pose(t1, rt=0.4, a1=-0.6, e1=0.2, face=-1, look=-0.6))
        tip = PIVOT + UP * 0.37
        self.play(self.pose(t1, rt=0.3, **t1.arm(tip, 1, lean=-0.2), squint=0.3))
        self.play(
            Rotate(self.lever, PI, about_point=PIVOT, rate_func=ease_out_back, run_time=0.25),
            self.pose(t1, rt=0.25, rf=rush_from, **t1.arm(PIVOT + DOWN * 0.37, 1, lean=-0.1)),
        )
        self.play(sfx("CLUNK", P3(-2.6, 2.3), h=0.75, color="#FF8A00", angle=0.1, hold=0.3),
                  self.pose(t1, rt=0.4, lean=0.0, a1=0.2, e1=-0.1, squint=0.0, look=0.6, face=1))

        # Tech 2 goes for the whip anyway
        self.play(Walk(t2, WHIP_END[0] + 0.75, steps=5, rt=1.0, rf=smooth))
        c = self.crouch(t2, 0.35, -0.6, face=-1)
        self.play(self.pose(t2, rt=0.55, rf=smooth, look=-0.7, **t2.arm(WHIP_END + P3(-0.2, 0.06), 1, **c)))
        zap = sfx_text("ZAP!", P3(0.9, 3.1), h=1.5, angle=0.15)
        self.play(GrowFromCenter(zap, rate_func=ease_out_back), run_time=0.15)
        for i in range(6):
            b = bolt(WHIP_END, t2.hands[1], seed=i)
            self.add(b)
            self.play(self.pose(t2, rt=0.07, rf=linear, lean=0.12 * (1 if i % 2 else -1), hair=1.0,
                                squint=-1.0, a2=1.8 * (1 if i % 2 else -1), e2=0.4, y=HIP, k1=0.0, k2=0.0,
                                l1=0.35 * (1 if i % 2 else -1), l2=-0.35 * (1 if i % 2 else -1)))
            self.remove(b)
        self.play(FadeOut(zap, scale=1.3), self.pose(
            t2, rt=0.25, lean=0.0, a1=0.15, e1=0.0, a2=-0.15, e2=0.0, l1=0.12, l2=-0.12, k1=0.0, k2=0.0,
            y=HIP, look=0.0), run_time=0.25)
        self.play(puff(t2.head() + UP * 0.5, n=5, seed=2, rt=1.1), Wait(0.3), run_time=1.1)
        self.play(self.pose(t2, rt=0.12, squint=0.95), run_time=0.12)
        self.play(self.pose(t2, rt=0.12, squint=-1.0), run_time=0.12)

        # Tech 1: slow, disappointed head shake
        self.play(self.pose(t1, rt=0.3, squint=0.5, look=0.8))
        self.play(self.shake_head(t1, n=4, amt=0.08, rt=0.32))
        self.play(Walk(t2, T2_HOME, steps=4, rt=0.9, rf=smooth), self.pose(t1, rt=0.4, squint=0.0, look=0.6))

    # ------------------------------------------------------------ 4
    def scene_banana_flashing(self):
        t1, t2 = self.t1, self.t2
        self.play(Walk(t1, -0.75, steps=4, rt=0.7, rf=smooth))
        self.play(self.pose(t1, rt=0.25, face=-1, look=-0.7, **t1.arm(P3(-1.8, 1.2), 1, lean=-0.1)))
        flights = []
        rng = random.Random(9)
        for i, s in enumerate(self.screws):
            target = P3(rng.uniform(-6, 6), rng.choice([9.0, 8.5]))
            flights.append(AnimationGroup(
                s.animate(path_arc=rng.choice([-1, 1]) * 1.2, run_time=0.6).move_to(target).rotate(5 * PI),
                sfx("pop", s.get_center() + P3(rng.uniform(-0.4, 0.4), 0.45), h=0.3, color="#FFD400",
                    angle=rng.uniform(-0.3, 0.3), hold=0.05),
            ))
        self.play(LaggedStart(*flights, lag_ratio=0.3), self.pose(t2, rt=2.0, hair=0.0, squint=0.0, look=-0.6))

        # banana peel back toward the house: one flick per strip, top to bottom
        self.peeled = []
        for i, (lean, ang) in enumerate(((-0.15, -0.45), (-0.3, 0.0), (-0.5, 0.45))):
            st = self.strips[i]
            pivot = P3(WALL_X, STRIP_Y[i])
            peeled = st.copy().stretch(-0.55, 0, about_point=pivot).rotate(ang, about_point=pivot)
            self.peeled.append(peeled)
            corner = P3(UNIT_L - 0.08, STRIP_Y[i] + STRIP_H / 2)
            self.play(self.pose(t1, rt=0.2, **t1.arm(corner, 1, lean=lean)))
            self.play(Transform(st, peeled, rate_func=ease_out_back),
                      self.pose(t1, rt=0.32, rf=rush_from,
                                **t1.arm(P3(-2.0, STRIP_Y[i] + 0.3), 1, lean=-0.1)),
                      run_time=0.32)
        # pretend bite
        mouth = t1.head() + P3(-0.28, -0.12)
        self.play(self.pose(t1, rt=0.25, look=-0.2, **t1.arm(mouth, 1, lean=0.0)))
        self.play(sfx("CHOMP", P3(-1.0, 2.6), h=0.75, color="#FFD400", angle=-0.1, hold=0.3),
                  Succession(self.pose(t1, rt=0.15, hy=-0.07, squint=0.8),
                             self.pose(t1, rt=0.15, hy=0.0),
                             self.pose(t1, rt=0.15, hy=-0.07),
                             self.pose(t1, rt=0.15, hy=0.0, squint=0.0)))
        self.play(self.pose(t1, rt=0.25, a1=-0.2, e1=0.0, look=0.0))

    # ------------------------------------------------------------ 5
    def yank_duct(self, idx, hand_y, hip_y, foot_y, pile, big=True):
        t1 = self.t1
        duct = self.ducts[idx]
        base = dict(x=-2.25, y=hip_y, lean=-0.3, face=1.0, look=0.7)
        target = {**t1.leg(P3(UNIT_L - 0.02, foot_y), 1, bend=1, **base)}
        target = {**target, **t1.leg(P3(-2.75, GROUND), 2, bend=1, **target)}
        target = {**target, **t1.arm(P3(-1.95, hand_y), 1, **target)}
        target = {**target, **t1.arm(P3(-1.75, hand_y), 2, **target)}
        self.play(self.pose(t1, rt=0.35 if big else 0.25, rf=ease_out_back, squint=0.6, **target))
        for k in range(4 if big else 2):
            self.play(self.pose(t1, rt=0.07, rf=linear, lean=-0.38 if k % 2 == 0 else -0.3, hx=-0.03 if k % 2 == 0 else 0.0))
        self.follow(duct, t1, 1)
        stumble = dict(x=-2.95, y=HIP - 1.3, lean=-0.55, l1=0.9, k1=-0.4, l2=-0.3, k2=0.2, squint=-0.8, hx=0.0)
        stumble = {**stumble, **t1.arm(P3(-2.4, HIP - 0.3), 1, **stumble)}
        stumble = {**stumble, **t1.arm(P3(-2.2, HIP - 0.3), 2, **stumble)}
        word = sfx("POP!", P3(-1.0, 2.8), h=1.3, color="#FF8A00", angle=-0.12, hold=0.35) if big else \
            sfx("pop!", P3(-1.0, 2.2), h=0.6, color="#FF8A00", angle=0.12, hold=0.2)
        self.play(word, self.pose(t1, rt=0.35, rf=ease_out_cubic, **stumble))
        if big:
            self.play(self.pose(t1, rt=0.15, lean=-0.2, l1=0.3, k1=0.0, l2=-0.25, k2=0.0))
            self.play(self.pose(t1, rt=0.15, lean=0.12))
        duct.clear_updaters()
        self.play(duct.animate(path_arc=-1.6, run_time=0.65).move_to(pile).rotate(0.08 if big else -0.06),
                  self.pose(t1, rt=0.45, lean=0.1, squint=0.0, look=0.7, l1=0.15, l2=-0.15, k1=0, k2=0,
                            a1=2.4, e1=-0.3, a2=0.5, e2=0.0))

    def scene_duct_yank(self):
        t1 = self.t1
        self.play(Walk(t1, -2.25, steps=2, rt=0.4, rf=smooth))
        self.yank_duct(0, sum(SUPPLY_Y) / 2, HIP - 0.05, -0.75, P3(3.0, -3.25), big=True)
        self.play(Walk(t1, -2.25, HIP, steps=3, rt=0.5, rf=smooth))
        self.yank_duct(1, sum(RETURN_Y) / 2, HIP - 0.3, -1.1, P3(3.0, -3.95), big=False)

    # ------------------------------------------------------------ 6
    def scene_wire_pullstart(self):
        t1, t2 = self.t1, self.t2
        self.play(Walk(t1, -0.75, HIP, steps=3, rt=0.6, rf=smooth))
        grab = (WHIP_END + LV_END) / 2
        c = self.crouch(t1, 0.4, 0.45, face=1)
        self.play(self.pose(t1, rt=0.3, look=0.5, **t1.arm(grab, 1, **c)))
        self.play(self.whip.end.animate.move_to(t1.hands[1] + LEFT * 0.04),
                  self.lv.end.animate.move_to(t1.hands[1] + RIGHT * 0.04), run_time=0.15)
        self.follow(self.whip.end, t1, 1, LEFT * 0.04)
        self.follow(self.lv.end, t1, 1, RIGHT * 0.04)
        # wind up, then YANK like a lawnmower cord
        wind = self.crouch(t1, 0.5, 0.6)
        self.play(self.pose(t1, rt=0.3, squint=0.6, **t1.arm(grab + P3(0.1, -0.05), 1, **wind)))
        yank = dict(y=HIP, lean=-0.4, l1=0.15, k1=0.0, l2=-0.35, k2=0.0, a2=0.6, e2=0.3)
        self.play(self.pose(t1, rt=0.2, rf=rush_from, squint=0.0, **t1.arm(P3(-1.6, 2.6), 1, **yank)),
                  self.whip.show.animate(rate_func=rush_from).set_value(1.0),
                  self.lv.show.animate(rate_func=rush_from).set_value(1.0), run_time=0.2)
        # ...nothing happens
        dots = VGroup(*[Dot(t1.head() + P3(-0.2 + 0.2 * k, 0.75), radius=0.06, color=INK) for k in range(3)]).set_z_index(10)
        self.play(LaggedStart(*[FadeIn(d, scale=0.3) for d in dots], lag_ratio=0.5), run_time=0.45)
        self.wait(0.6)
        self.play(self.pose(t1, rt=0.3, look=0.8))
        for e in (self.whip.end, self.lv.end):
            e.clear_updaters()
        self.play(FadeOut(dots),
                  self.whip.end.animate(rate_func=ease_out_bounce).move_to(P3(-1.4, GROUND + 0.1)),
                  self.lv.end.animate(rate_func=ease_out_bounce).move_to(P3(0.6, GROUND + 0.12)),
                  self.pose(t1, rt=0.5, lean=0.0, a1=0.2, e1=-0.1, a2=-0.2, e2=0.1), run_time=0.5)
        # Tech 2 is not impressed
        self.play(self.pose(t2, rt=0.3, look=-1.0, squint=0.45))
        self.play(self.shake_head(t2, n=4, amt=0.08, rt=0.38), self.pose(t1, rt=0.5, squint=-0.6))
        self.play(self.pose(t2, rt=0.2, squint=0.0), self.pose(t1, rt=0.2, squint=0.0))

    # ------------------------------------------------------------ 7
    def scene_rip_unit(self):
        t1, t2, unit = self.t1, self.t2, self.unit
        self.play(Walk(t1, -1.75, HIP, steps=2, rt=0.45, rf=smooth), Walk(t2, UNIT_R + 0.55, HIP, steps=2, rt=0.45, rf=smooth))
        g1 = {**t1.arm(P3(UNIT_L, 0.25), 1, face=1, look=0.7, lean=0.0)}
        g1 = {**g1, **t1.arm(P3(UNIT_L, -0.1), 2, **g1)}
        g2 = {**t2.arm(P3(UNIT_R, 0.25), 1, face=-1, look=-0.7, lean=0.0)}
        g2 = {**g2, **t2.arm(P3(UNIT_R, -0.1), 2, **g2)}
        self.play(self.pose(t1, rt=0.25, **g1), self.pose(t2, rt=0.25, **g2))
        self.play(self.pose(t1, rt=0.3, squint=0.7, lean=-0.3, x=-1.85),
                  self.pose(t2, rt=0.3, squint=0.7, lean=0.3, x=UNIT_R + 0.65),
                  Wiggle(unit, scale_value=1.0, rotation_angle=0.05, n_wiggles=4, run_time=0.3))

        start = unit.get_center()
        land = P3(-2.4, -3.6)
        ctrl = P3(-0.6, 4.5)
        orig = unit.copy()

        def fly(m, a):
            pos = (1 - a) ** 2 * start + 2 * (1 - a) * a * ctrl + a ** 2 * land
            m.become(orig.copy().rotate(0.5 * np.sin(a * 2.5 * PI) * (1 - a)).move_to(pos))

        self.play(
            UpdateFromAlphaFunc(unit, fly, run_time=1.0, rate_func=linear),
            self.pose(t1, rt=0.45, rf=ease_out_cubic, x=-2.4, y=HIP - 0.5, lean=-0.7, l1=1.2, k1=0.2, l2=0.6,
                      k2=0.3, a1=2.6, e1=0.0, a2=2.0, e2=0.0, squint=-1.0),
            self.pose(t2, rt=0.45, rf=ease_out_cubic, x=UNIT_R + 1.3, y=HIP - 0.5, lean=0.7, l1=-1.2, k1=-0.2, l2=-0.6,
                      k2=-0.3, a1=-2.6, e1=0.0, a2=-2.0, e2=0.0, squint=-1.0),
        )
        bottom = unit.get_bottom()
        self.play(
            sfx("THUD", P3(-2.3, -0.6), h=1.1, color="#C47A3A", angle=-0.08, hold=0.4),
            Succession(unit.animate(run_time=0.08).stretch(0.85, 1, about_point=bottom),
                       unit.animate(run_time=0.35, rate_func=ease_out_elastic).stretch(1 / 0.85, 1, about_point=bottom)),
            puff(bottom + LEFT * 1.3, n=3, seed=4, rt=0.7, rise=0.4),
            puff(bottom + RIGHT * 1.3, n=3, seed=5, rt=0.7, rise=0.4),
            self.cam_shake(0.18, 7, 0.45),
        )
        rock_orig = unit.copy()
        self.play(UpdateFromAlphaFunc(unit, lambda m, a: m.become(rock_orig.copy().rotate(
            0.08 * np.exp(-3 * a) * np.sin(a * 6 * PI), about_point=bottom)), run_time=0.7),
            self.pose(t1, rt=0.4, rf=ease_out_back, x=-2.3, y=HIP, lean=0.0, l1=0.15, k1=0, l2=-0.15, k2=0,
                      a1=0.2, e1=-0.1, a2=-0.2, e2=0.1, squint=0.0, look=-0.5, face=-1),
            self.pose(t2, rt=0.4, rf=ease_out_back, x=T2_HOME, y=HIP, lean=0.0, l1=0.15, k1=0, l2=-0.15, k2=0,
                      a1=0.2, e1=-0.1, a2=-0.2, e2=0.1, squint=0.0, look=-0.5, face=-1))
        self.play(puff(unit.get_top() + RIGHT * 0.9, n=3, seed=6, rt=0.8, rise=0.6))

    # ------------------------------------------------------------ 8
    def scene_new_unit(self):
        t1, t2 = self.t1, self.t2
        new = make_unit(new=True).shift(RIGHT * 7.5)
        self.add(new)
        self.new = new
        self.play(
            new.animate(rate_func=ease_out_back, run_time=1.1).shift(LEFT * 7.5),
            Succession(Wait(0.05), self.pose(t2, rt=0.55, arc=1.8, rf=linear, l1=0.7, k1=-1.2, l2=-0.4, k2=-1.0,
                                             a1=2.4, a2=-2.4, squint=-1.0, look=0.7, face=1),
                       self.pose(t2, rt=0.25, rf=ease_out_back, l1=0.15, k1=0, l2=-0.15, k2=0, a1=0.2, a2=-0.2,
                                 squint=0.0, look=-0.6, face=-1)),
            self.pose(t1, rt=0.6, look=0.7, face=1),
        )
        pts = [P3(-1.4, 1.2), P3(2.2, 1.1), P3(0.9, 1.5), P3(2.3, -0.4), P3(-0.4, 0.0), P3(1.2, -0.9)]
        self.play(sparkles(pts, rt=0.8, seed=8), run_time=1.3)

    # ------------------------------------------------------------ 9
    def scene_rewind(self):
        t1 = self.t1
        self.play(self.pose(t1, rt=0.3, face=-1, look=-0.6, **t1.arm(P3(-3.0, 1.6), 1, lean=0.0)))
        self.play(
            LaggedStart(*[Transform(d, h, path_arc=1.4, run_time=0.6) for d, h in zip(self.ducts, self.duct_home)],
                        lag_ratio=0.5),
            Succession(Wait(0.45), sfx("CLICK", P3(-1.0, 2.6), h=0.8, color="#7CC6EE", angle=0.1, hold=0.1)),
            Succession(Wait(0.75), sfx("CLICK", P3(-2.6, -2.6), h=0.8, color="#7CC6EE", angle=-0.1, hold=0.1)),
            self.whip.end.animate(path_arc=-1.0, run_time=0.6).move_to(WHIP_END),
            self.whip.show.animate(run_time=0.6, rate_func=rush_into).set_value(0.0),
        )
        self.play(LaggedStart(*[Transform(st, h, run_time=0.4, rate_func=ease_out_back)
                                for st, h in zip(reversed(self.strips), reversed(self.strip_home))], lag_ratio=0.45))
        self.play(LaggedStart(*[Transform(s, h, path_arc=1.2, run_time=0.45)
                                for s, h in zip(reversed(self.screws), reversed(self.screw_home))], lag_ratio=0.35),
                  self.pose(t1, rt=0.8, a1=0.2, e1=-0.1))

    # ------------------------------------------------------------ 10
    def scene_thread_needle(self):
        t1 = self.t1
        frame = self.camera.frame
        lv = self.lv
        self.play(Walk(t1, 1.05, HIP, steps=6, rt=1.0, rf=smooth),
                  frame.animate(run_time=1.0).scale(0.5).move_to(P3(0.5, -0.5)))
        pick = self.crouch(t1, 0.55, -0.75, face=-1, look=-0.6)
        self.play(self.pose(t1, rt=0.3, **t1.arm(lv.end.get_center(), 1, **pick)))
        self.follow(lv.end, t1, 1, LEFT * 0.1)
        focus = {**self.crouch(t1, 0.45, -0.45), "tongue": 1.0, "squint": 0.8, "hx": -0.04, "look": -0.8}
        hand = lambda dx, dy: RING + P3(0.1 + dx, dy)  # hand target that puts the wire tip at RING + (dx, dy)
        ready = hand(0.3, 0.0)
        self.play(self.pose(t1, rt=0.35, **t1.arm(ready, 1, **focus)))
        # miss #1: bonks above the grommet
        self.play(self.pose(t1, rt=0.25, **t1.arm(hand(0.09, 0.13), 1)))
        self.play(sfx("tink", RING + P3(-0.1, 0.5), h=0.22, color="#FFD400", angle=0.2, hold=0.1),
                  self.pose(t1, rt=0.25, rf=ease_out_back, **t1.arm(ready + P3(0.05, 0.05), 1)))
        # miss #2: bonks below it
        self.play(self.pose(t1, rt=0.25, **t1.arm(hand(0.09, -0.14), 1)))
        self.play(sfx("tink", RING + P3(-0.1, -0.5), h=0.22, color="#FFD400", angle=-0.2, hold=0.1),
                  self.pose(t1, rt=0.25, rf=ease_out_back, hy=-0.03, **t1.arm(ready, 1)))
        # got it: the eight conductors slide in
        self.play(self.pose(t1, rt=0.5, rf=smooth, **t1.arm(hand(0.15, 0.0), 1)))
        self.play(self.pose(t1, rt=0.4, rf=ease_in_out_sine, **t1.arm(hand(0.0, 0.0), 1)),
                  lv.show.animate(run_time=0.4).set_value(0.0))
        self.play(sparkles([RING + P3(-0.25, 0.25), RING + P3(0.2, 0.3)], rt=0.6, seed=12),
                  self.pose(t1, rt=0.35, rf=ease_out_back, tongue=0.0, squint=0.0, hx=0.0, hy=0.0))
        lv.end.clear_updaters()
        self.play(self.pose(t1, rt=0.25, rf=ease_out_back, y=HIP, lean=0.0, l1=0.15, k1=0.0, l2=-0.15, k2=0.0,
                            a1=-2.6, e1=0.4),
                  lv.end.animate(run_time=0.25).move_to(LV_END))
        self.play(self.pose(t1, rt=0.25, a1=-0.2, e1=0.0),
                  frame.animate(run_time=0.8).scale(2.0).move_to(ORIGIN))

    # ------------------------------------------------------------ 11
    def scene_power_up(self):
        t1, t2, new = self.t1, self.t2, self.new
        self.play(Walk(t1, -2.85, HIP, steps=6, rt=1.0, rf=smooth))
        self.play(self.pose(t1, rt=0.25, face=-1, look=-0.6, **t1.arm(PIVOT + DOWN * 0.37, 1, lean=-0.1)))
        self.play(
            Rotate(self.lever, -PI, about_point=PIVOT, rate_func=ease_out_back, run_time=0.25),
            self.pose(t1, rt=0.25, rf=rush_from, **t1.arm(PIVOT + UP * 0.37, 1, lean=-0.2)),
        )
        T = ValueTracker(0)
        home = new.get_center()
        new.add_updater(lambda m: m.move_to(home + 0.025 * P3(np.sin(T.get_value() * 95), np.sin(T.get_value() * 77))))

        def hum():
            t = T.get_value()
            ramp = min(1.0, t / 0.4)
            g = VGroup()
            for k in range(3):
                op = ramp * (0.5 + 0.5 * np.sin(t * 30 + k * 2))
                g.add(Arc(radius=0.25 + 0.2 * k, start_angle=-0.55, angle=1.1, arc_center=P3(UNIT_R - 0.05, -0.3))
                      .set_stroke(INK, 4, opacity=op))
                g.add(Arc(radius=0.2 + 0.18 * k, start_angle=PI / 2 - 0.5, angle=1.0,
                          arc_center=P3((COIL_X + UNIT_R) / 2, LID_TOP + 0.1)).set_stroke(INK, 4, opacity=op))
            return g.set_z_index(8)

        def air():
            t = T.get_value()
            g = VGroup()
            for i in range(7):
                y = SUPPLY_Y[0] + (0.15, 0.25, 0.35)[i % 3]
                prog = (t * 1.3 + i * 0.47) % 3.3
                xr = UNIT_L + 0.15 - prog * 1.15
                xs = np.linspace(xr - 0.95, xr, 24)
                pts = [P3(x, y + 0.07 * np.sin(7 * x + t * 9 + i)) for x in xs]
                op = min(1.0, t / 0.6) * np.clip((xr + 4.4) / 0.9, 0, 1) * np.clip((UNIT_L + 0.3 - xr) / 0.4, 0, 1)
                g.add(VMobject().set_points_smoothly(pts).set_stroke(AIR_C, 10, opacity=op)
                      .set_cap_style(CapStyleType.ROUND))
            return g.set_z_index(8)

        hum_m = always_redraw(hum)
        air_m = always_redraw(air)
        self.add(hum_m, air_m)
        dur = 4.0
        self.play(
            T.animate(run_time=dur, rate_func=linear).set_value(dur),
            sfx("CLUNK", P3(-2.6, 2.3), h=0.75, color="#FF8A00", angle=0.1, hold=0.3),
            Succession(self.pose(t1, rt=0.4, lean=0.0, a1=0.2, e1=-0.1, look=0.7, face=1),
                       Wait(1.0), self.pose(t1, rt=0.5, look=-0.6, face=-1, squint=0.3)),
            Succession(Wait(0.6), self.pose(t2, rt=0.3, look=-0.8, squint=-0.6),
                       Wait(1.2), self.pose(t2, rt=0.4, squint=0.4)),
        )
