"""Extra HVAC equipment props for later episodes: split condenser, air handler, furnace, cased coil, line set,
thermostat, condensate drain, filter rack and breaker panel.

Also holds small shared helpers used by tools_more.py: inch size IN, rect(), teardrop(), tube drawing along a
rounded path, the SevenSeg LCD digits and Tween (an UpdateFromAlphaFunc that reads its start state on begin).
"""
import numpy as np
from manim import (
    DOWN, CapStyleType, Circle, Dot, Line, LineJointType, Polygon, Rectangle, RoundedRectangle,
    ManimColor, UpdateFromAlphaFunc, VGroup, VMobject, linear, smooth,
)

from ..style import (
    CONCRETE, COLD_AIR, DETAIL_W, H, HARD_HAT, HEAT, INK, METAL, METAL_DARK, METAL_HI, NEW_UNIT,
    NEW_UNIT_DARK, OLD_UNIT, OLD_UNIT_DARK, PROP_W, ROOF, WHITE, Z_BEHIND, Z_PROP, P,
)
from .base import Prop

IN = H / 69.0  # one inch, sized against a 5'9" figure

ICE = "#CFEFFF"
ICE_EDGE = "#7FBFE6"

# a few material colours style.py has no name for
COPPER = "#C87533"
COPPER_HI = "#E9A774"
FOAM = "#2E2E2E"        # black closed-cell pipe insulation
BRASS = "#C9A44A"
FLAME_BLUE = "#3C78D8"
LCD_ON = "#D6ECF8"      # back-lit LCD (pale COLD_AIR)
LCD_OFF = "#B9BDB6"     # dark LCD
WATER = COLD_AIR

LINESET_SEP = 0.17      # centre distance between the two line-set tubes (and the matching service valves)


# ================================================================ shared helpers
def mix(a, b, t):
    """Colour a blended toward b by t (0..1); accepts hex strings."""
    return ManimColor(a).interpolate(ManimColor(b), float(t))


def rect(x0, y0, x1, y1, fill=None, w=PROP_W, r=0.0, opacity=1.0, color=INK):
    """Rectangle by corners (any order), INK outline, optional fill and corner radius."""
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    if r > 0:
        m = RoundedRectangle(width=x1 - x0, height=y1 - y0, corner_radius=min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    else:
        m = Rectangle(width=x1 - x0, height=y1 - y0)
    m.move_to(P((x0 + x1) / 2, (y0 + y1) / 2))
    if fill is None:
        m.set_fill(opacity=0)
    else:
        m.set_fill(fill, opacity)
    return m.set_stroke(color, w)


def seg(p, q, w=DETAIL_W, color=INK, opacity=1.0):
    return Line(P(*p[:2]), P(*q[:2]), stroke_width=w, color=color).set_stroke(opacity=opacity)


def teardrop(base, w, h, fill, stroke=DETAIL_W, angle=0.0):
    """Drop / flame shape, round bottom at `base` (bottom point), pointed tip h above it."""
    x, y = base[0], base[1]

    def q(px, py):
        return P(x + px * w, y + py * h)

    m = VMobject()
    m.start_new_path(q(0, 1))
    m.add_cubic_bezier_curve_to(q(0.08, 0.8), q(0.5, 0.6), q(0.5, 0.32))
    m.add_cubic_bezier_curve_to(q(0.5, 0.12), q(0.28, 0), q(0, 0))
    m.add_cubic_bezier_curve_to(q(-0.28, 0), q(-0.5, 0.12), q(-0.5, 0.32))
    m.add_cubic_bezier_curve_to(q(-0.5, 0.6), q(-0.08, 0.8), q(0, 1))
    m.set_fill(fill, 1).set_stroke(INK, stroke)
    if angle:
        m.rotate(angle, about_point=P(x, y))
    return m


def screws(x0, y0, x1, y1, inset=0.07, r=0.025):
    return VGroup(*[Dot(P(x, y), radius=r, color=INK) for x in (x0 + inset, x1 - inset)
                    for y in (y0 + inset, y1 - inset)])


def _resample(pts, n):
    pts = np.asarray(pts, dtype=float)
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    keep = np.concatenate([[True], d > 1e-9])
    pts = pts[keep]
    if len(pts) < 2:
        return np.repeat(pts[:1], n, axis=0)
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(d)])
    t = np.linspace(0.0, s[-1], n)
    return np.stack([np.interp(t, s, pts[:, k]) for k in range(3)], axis=1)


def rounded_path(points, radius=0.3, n=None, step=0.025):
    """Polyline through `points` with each corner replaced by a bend of up to `radius`; returns n (or dense)
    evenly spaced points, like bent copper or a pipe run."""
    pts = [P(*p[:2]) for p in points]
    if len(pts) < 2:
        raise ValueError("a path needs at least two points")
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        la, lc = np.linalg.norm(b - a), np.linalg.norm(c - b)
        if la < 1e-9 or lc < 1e-9:
            continue
        r = min(radius, la / 2, lc / 2)
        p0, p2 = b + (a - b) / la * r, b + (c - b) / lc * r
        for t in np.linspace(0, 1, 12):
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t ** 2 * p2)
    out.append(pts[-1])
    out = np.array(out)
    if n is None:
        length = np.sum(np.linalg.norm(np.diff(out, axis=0), axis=1))
        n = max(8, int(length / step))
    return _resample(out, n)


def offset_path(pts, d):
    """Points shifted sideways by d (positive = left of the direction of travel)."""
    t = np.gradient(pts, axis=0)
    ln = np.linalg.norm(t, axis=1, keepdims=True)
    ln[ln < 1e-12] = 1.0
    t = t / ln
    nrm = np.stack([-t[:, 1], t[:, 0], np.zeros(len(t))], axis=1)
    return pts + nrm * d


def tube(pts, width, color, outline=DETAIL_W, cap=CapStyleType.ROUND):
    """Flat outlined tube (hose, pipe, wire) along dense points: a wide INK stroke under a coloured one."""
    outer = VMobject(joint_type=LineJointType.ROUND).set_points_as_corners(pts) \
        .set_stroke(INK, width * 100 + 2 * outline).set_fill(opacity=0)
    inner = VMobject(joint_type=LineJointType.ROUND).set_points_as_corners(pts) \
        .set_stroke(color, width * 100).set_fill(opacity=0)
    outer.set_cap_style(cap)
    inner.set_cap_style(cap)
    return VGroup(outer, inner)


class Tween(UpdateFromAlphaFunc):
    """UpdateFromAlphaFunc that reads its start state on begin() and calls apply(start, alpha); animate the prop or a part, never a new VGroup wrapper."""

    def __init__(self, mob, read, apply, run_time=0.5, rate_func=smooth, **kwargs):
        self._read, self._apply, self._start = read, apply, None
        super().__init__(mob, self._update, run_time=run_time, rate_func=rate_func, **kwargs)

    def _update(self, mob, alpha):
        if self._start is None:
            self._start = self._read()
        self._apply(self._start, alpha)

    def begin(self):
        self._start = self._read()
        super().begin()


# ---------------------------------------------------------------- seven-segment LCD digits
_SEGS = {"0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg",
         "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "", "E": "adefg", "r": "eg", "o": "cdeg",
         "L": "def", "H": "bcefg", "C": "adef", "F": "aefg", "P": "abefg", "n": "ceg", "u": "cde",
         "A": "abcefg", "O": "abcdef", "_": "d"}


class SevenSeg(VGroup):
    """Row of n seven-segment LCD digits centred on the origin; set_text("72.5") lights them right-aligned, set_level(0..1) dims them."""

    def __init__(self, n, height, color=INK, ghost=0.07, slant=0.1, thickness=0.16, **kwargs):
        super().__init__(**kwargs)
        self.n, self.ghost, self.level, self.text = n, ghost, 1.0, ""
        h, w, e = height, 0.5 * height, 0.11 * height
        pitch = w + 0.36 * h
        sw = h * thickness * 100
        self.digits = []
        for i in range(n):
            x0 = i * pitch

            def p(x, y, x0=x0):
                return P(x0 + x + slant * y, y)

            ends = {"a": (p(e, h), p(w - e, h)), "b": (p(w, h - e), p(w, h / 2 + e)),
                    "c": (p(w, h / 2 - e), p(w, e)), "d": (p(e, 0), p(w - e, 0)),
                    "e": (p(0, h / 2 - e), p(0, e)), "f": (p(0, h - e), p(0, h / 2 + e)),
                    "g": (p(e, h / 2), p(w - e, h / 2))}
            d = {}
            for k, (s, t) in ends.items():
                ln = Line(s, t, stroke_width=sw, color=color)
                ln.set_cap_style(CapStyleType.ROUND)
                d[k] = ln
                self.add(ln)
            d["dp"] = Dot(p(w + 0.17 * h, 0), radius=0.075 * h, color=color)
            self.add(d["dp"])
            self.digits.append(d)
        self.move_to(P(0, 0))
        self.set_text("")

    def set_text(self, s):
        cells = []
        for ch in str(s):
            if ch == "." and cells and not cells[-1][1]:
                cells[-1] = (cells[-1][0], True)
            elif ch == ".":
                cells.append((" ", True))
            else:
                cells.append((ch, False))
        cells = cells[-self.n:]
        cells = [(" ", False)] * (self.n - len(cells)) + cells
        lv, gh = self.level, self.ghost * self.level
        for d, (ch, dp) in zip(self.digits, cells):
            on = _SEGS.get(ch, "")
            for k in "abcdefg":
                d[k].set_stroke(opacity=lv if k in on else gh)
            d["dp"].set_fill(opacity=lv if dp else 0)
        self.text = str(s)
        return self

    def set_level(self, level):
        self.level = float(level)
        return self.set_text(self.text)


def fmt_number(value, digits, decimals=None):
    """Format a number to fit `digits` seven-segment cells (a decimal point rides on a digit, so it is free).
    Integers show as integers, floats with one decimal unless `decimals` says otherwise; overflow shows "OL"."""
    v = float(value)
    if decimals is None:
        decimals = 0 if v.is_integer() else 1
    for dec in range(decimals, -1, -1):
        s = f"{v:.{dec}f}"
        if len(s.replace(".", "")) <= digits:
            return s
    return "OL"


def _palette(new):
    return (NEW_UNIT, NEW_UNIT_DARK) if new else (OLD_UNIT, OLD_UNIT_DARK)


def _mark_in(prop, part, name, p):
    """A named point that belongs to a sub-part, so it follows that part when it moves on its own."""
    d = prop.mark(name, p)
    prop.remove(d)
    part.add(d)
    return d


# ================================================================ equipment
class SplitCondenser(Prop):
    """Split condenser on a pad at (x, ground_y); points lineset_suction, lineset_liquid, lineset, whip_terminal, lift_L, lift_R, top, base."""

    def __init__(self, x=0.0, ground_y=0.0, new=True, pad=True, mirror=False, **kwargs):
        """new=False gives the tan old-unit colours; mirror=True puts the valves on the left (lift_L stays the left one)."""
        super().__init__(**kwargs)
        fill, dark = _palette(new)
        W, HB = 30 * IN, 29 * IN
        x0, x1 = x - W / 2, x + W / 2
        y = ground_y
        if pad:
            self.part("pad", rect(x - W / 2 - 0.22, y, x + W / 2 + 0.22, y + 0.16, CONCRETE, PROP_W))
            y += 0.16
        self.part("base", rect(x0 - 0.03, y, x1 + 0.03, y + 0.1, ROOF, PROP_W))
        yb, yt = y + 0.1, y + 0.1 + HB
        self.part("cabinet", rect(x0, yb, x1, yt, fill, PROP_W))
        # coil behind a wire guard, service corner on the right
        sx = x1 - 0.48
        cx0, cy0, cy1 = x0 + 0.13, yb + 0.12, yt - 0.12
        coil = rect(cx0, cy0, sx - 0.06, cy1, dark, DETAIL_W)
        fins = VGroup(*[seg((fx, cy0), (fx, cy1), w=1.2, opacity=0.35) for fx in np.arange(cx0 + 0.06, sx - 0.08, 0.06)])
        guard = VGroup(*[seg((cx0, gy), (sx - 0.06, gy), w=DETAIL_W) for gy in np.arange(cy0 + 0.14, cy1, 0.15)])
        self.part("coil", VGroup(coil, fins, guard))
        self.part("corner_l", seg((x0 + 0.13, yb), (x0 + 0.13, yt), w=DETAIL_W))
        panel = rect(sx, yb + 0.1, x1 - 0.06, yt - 0.1, fill, DETAIL_W)
        plate = rect(sx + 0.08, yt - 0.62, x1 - 0.14, yt - 0.42, WHITE, 1.5)
        lines = VGroup(*[seg((sx + 0.11, ly), (x1 - 0.17, ly), w=1.2, color=METAL_DARK)
                         for ly in (yt - 0.48, yt - 0.52, yt - 0.56)])
        self.part("service_panel", VGroup(panel, screws(sx, yb + 0.1, x1 - 0.06, yt - 0.1), plate, lines))
        # top: lid, fan guard with grille wires, motor cap
        self.part("lid", rect(x0 - 0.05, yt, x1 + 0.05, yt + 0.09, dark, PROP_W))
        gy0, gy1 = yt + 0.09, yt + 0.2
        shroud = Polygon(P(x0 + 0.12, gy0), P(x0 + 0.24, gy1), P(x1 - 0.24, gy1), P(x1 - 0.12, gy0)) \
            .set_fill(fill, 1).set_stroke(INK, PROP_W)
        wires = VGroup(*[seg((gx, gy0 + 0.01), (gx, gy1 - 0.01), w=1.5) for gx in np.arange(x0 + 0.26, x1 - 0.24, 0.08)])
        cap = rect(x - 0.13, gy1, x + 0.13, gy1 + 0.06, dark, DETAIL_W, r=0.02)
        self.part("grille", VGroup(shroud, wires, cap))
        # service valves on the right side; suction above liquid so a LineSet leaving to the right lines up
        ys, yl = yb + 0.28 + LINESET_SEP, yb + 0.28
        valves = VGroup()
        for vy, od in ((ys, 0.075), (yl, 0.05)):
            body = rect(x1, vy - 0.06, x1 + 0.13, vy + 0.06, METAL_DARK, DETAIL_W)
            stem = rect(x1 + 0.03, vy + 0.06, x1 + 0.1, vy + 0.12, BRASS, 1.5)
            stub = tube(np.array([P(x1 + 0.13, vy), P(x1 + 0.24, vy)]), od, COPPER, cap=CapStyleType.BUTT)
            valves.add(stub, body, stem)
        self.part("valves", valves)
        # electrical whip fitting high on the service corner
        wy = yt - 0.32
        self.part("whip_fitting", VGroup(rect(x1, wy - 0.06, x1 + 0.08, wy + 0.06, METAL_DARK, DETAIL_W),
                                         rect(x1 + 0.08, wy - 0.045, x1 + 0.13, wy + 0.045, METAL, 1.5)))
        self.mark("lineset_suction", (x1 + 0.24, ys))
        self.mark("lineset_liquid", (x1 + 0.24, yl))
        self.mark("lineset", (x1 + 0.24, (ys + yl) / 2))
        self.mark("whip_terminal", (x1 + 0.13, wy))
        self.mark("lift_L", (x0, yb + 0.05))
        self.mark("lift_R", (x1, yb + 0.05))
        self.mark("top", (x, gy1 + 0.06))
        self.mark("base", (x, ground_y))
        if mirror:
            self.flip(about_point=P(x, ground_y))
            self._points["lift_L"], self._points["lift_R"] = self._points["lift_R"], self._points["lift_L"]
        self.set_z_index(Z_PROP)


class AirHandler(Prop):
    """Upright air handler at (x, floor_y); points supply_top, return_bottom, filter_slot, power_in, lineset_suction,
    lineset_liquid, lineset, drain, base, grip_L/grip_R (cabinet sides at chest height of a figure on the same floor),
    grip_L_low/grip_R_low (a little lower, for two-handed pushes), top_L/top_R (top corners)."""

    def __init__(self, x=0.0, floor_y=0.0, new=True, mirror=False, drain_side="left", **kwargs):
        """new=False gives the old-unit colours; mirror=True swaps the sides; drain_side="right" puts the condensate
        stub under the refrigerant stubs instead of on the left."""
        super().__init__(**kwargs)
        fill, dark = _palette(new)
        W, HH = 21.5 * IN, 50 * IN
        x0, x1, y0, y1 = x - W / 2, x + W / 2, floor_y, floor_y + HH
        self.part("collar", rect(x0 + 0.1, y1, x1 - 0.1, y1 + 0.12, METAL, PROP_W))
        self.part("cabinet", rect(x0, y0, x1, y1, fill, PROP_W))
        ym = y0 + 0.5 * HH
        up = rect(x0 + 0.07, ym + 0.03, x1 - 0.07, y1 - 0.07, fill, DETAIL_W)
        lo = rect(x0 + 0.07, y0 + 0.42, x1 - 0.07, ym - 0.03, fill, DETAIL_W)
        plate = rect(x - 0.22, ym - 0.5, x + 0.22, ym - 0.22, WHITE, 1.5)
        txt = VGroup(*[seg((x - 0.17, ty), (x + 0.17, ty), w=1.2, color=METAL_DARK) for ty in (ym - 0.3, ym - 0.36, ym - 0.42)])
        self.part("upper_panel", VGroup(up, screws(x0 + 0.07, ym + 0.03, x1 - 0.07, y1 - 0.07)))
        self.part("lower_panel", VGroup(lo, screws(x0 + 0.07, y0 + 0.42, x1 - 0.07, ym - 0.03), plate, txt))
        # filter slot near the bottom with the filter edge and a pull tab showing
        fy = y0 + 0.24
        slot = rect(x0 + 0.1, fy - 0.07, x1 - 0.1, fy + 0.07, dark, DETAIL_W)
        edge = rect(x0 + 0.16, fy - 0.04, x1 - 0.16, fy + 0.04, OLD_UNIT, 1.5)
        tab = rect(x - 0.08, fy - 0.03, x + 0.08, fy + 0.03, WHITE, 1.5)
        self.part("filter_slot", VGroup(slot, edge, tab))
        # junction box on the left with a knockout
        jy = y1 - 0.5
        jbox = rect(x0 - 0.2, jy - 0.16, x0, jy + 0.16, METAL_DARK, DETAIL_W)
        ko = rect(x0 - 0.26, jy - 0.05, x0 - 0.2, jy + 0.05, METAL, 1.5)
        self.part("jbox", VGroup(jbox, ko))
        # refrigerant stubs (right) and condensate drain stub (left) at the coil / drain-pan level
        ys, yl = ym + 0.55 + LINESET_SEP, ym + 0.55
        stubs = VGroup(
            tube(np.array([P(x1, ys), P(x1 + 0.2, ys)]), 0.13, FOAM, cap=CapStyleType.BUTT),
            tube(np.array([P(x1, yl), P(x1 + 0.2, yl)]), 0.05, COPPER, cap=CapStyleType.BUTT),
        )
        self.part("stubs", stubs)
        dy = ym + 0.22
        dx0, dd = (x0, -1) if drain_side == "left" else (x1, 1)
        self.part("drain_stub", VGroup(tube(np.array([P(dx0, dy), P(dx0 + dd * 0.16, dy)]), 0.075, WHITE, cap=CapStyleType.BUTT),
                                       rect(min(dx0, dx0 + dd * 0.04), dy - 0.07, max(dx0, dx0 + dd * 0.04), dy + 0.07, WHITE, 1.5)))
        self.mark("supply_top", (x, y1 + 0.12))
        self.mark("return_bottom", (x, y0))
        self.mark("filter_slot", (x, fy))
        self.mark("power_in", (x0 - 0.26, jy))
        self.mark("lineset_suction", (x1 + 0.2, ys))
        self.mark("lineset_liquid", (x1 + 0.2, yl))
        self.mark("lineset", (x1 + 0.2, (ys + yl) / 2))
        self.mark("drain", (dx0 + dd * 0.16, dy))
        self.mark("base", (x, y0))
        for side, gx in (("L", x0), ("R", x1)):
            self.mark(f"grip_{side}", (gx, y0 + 0.4 * H))
            self.mark(f"grip_{side}_low", (gx, y0 + 0.28 * H))
            self.mark(f"top_{side}", (gx, y1))
        if mirror:
            self.flip(about_point=P(x, floor_y))
        self.set_z_index(Z_PROP)


class Furnace(Prop):
    """Upflow gas furnace at (x, floor_y); points supply_top, return_bottom, burner_window, flue, gas_in, power_in, base; method burner(on)."""

    def __init__(self, x=0.0, floor_y=0.0, new=True, lit=False, mirror=False, **kwargs):
        """lit=True starts with the burner on; mirror=True swaps the sides."""
        super().__init__(**kwargs)
        fill, dark = _palette(new)
        W, HF = 17.5 * IN, 40 * IN
        x0, x1, y0, y1 = x - W / 2, x + W / 2, floor_y, floor_y + HF
        self.part("collar", rect(x0 + 0.08, y1, x1 - 0.08, y1 + 0.1, METAL, PROP_W))
        # flue: PVC out of the left side, elbow up
        fy = y1 - 0.42
        flue_pts = rounded_path([(x0, fy), (x0 - 0.22, fy), (x0 - 0.22, y1 + 0.55)], radius=0.12)
        self.part("flue_pipe", tube(flue_pts, 0.11, WHITE, cap=CapStyleType.BUTT))
        self.part("cabinet", rect(x0, y0, x1, y1, fill, PROP_W))
        ym = y0 + 0.52 * HF
        up = rect(x0 + 0.07, ym + 0.03, x1 - 0.07, y1 - 0.07, fill, DETAIL_W)
        louvres = VGroup(*[rect(x - 0.3, ly - 0.018, x + 0.3, ly + 0.018, dark, 1.5, r=0.015)
                           for ly in (y1 - 0.2, y1 - 0.28, y1 - 0.36)])
        self.part("upper_door", VGroup(up, louvres, screws(x0 + 0.07, ym + 0.03, x1 - 0.07, y1 - 0.07)))
        lo = rect(x0 + 0.07, y0 + 0.08, x1 - 0.07, ym - 0.03, fill, DETAIL_W)
        plate = rect(x - 0.2, ym - 0.45, x + 0.2, ym - 0.2, WHITE, 1.5)
        txt = VGroup(*[seg((x - 0.15, ty), (x + 0.15, ty), w=1.2, color=METAL_DARK) for ty in (ym - 0.28, ym - 0.33, ym - 0.38)])
        self.part("lower_door", VGroup(lo, plate, txt, screws(x0 + 0.07, y0 + 0.08, x1 - 0.07, ym - 0.03)))
        # burner sight window with a row of flames
        wy = ym + 0.36
        self.part("window", rect(x - 0.22, wy - 0.12, x + 0.22, wy + 0.12, "#2A2A2A", DETAIL_W, r=0.03))
        flames = VGroup()
        for fx in np.linspace(x - 0.14, x + 0.14, 4):
            flames.add(VGroup(teardrop((fx, wy - 0.1), 0.075, 0.17, HEAT, 1.2),
                              teardrop((fx, wy - 0.1), 0.045, 0.075, FLAME_BLUE, 0)))
        self.part("flames", flames)
        self._flame_s, self._flame_level = 1.0, 1.0
        self.burner_on = True
        # gas line: black iron stub on the right with a yellow-handled shutoff
        gy = y1 - 0.62
        self.part("gas", VGroup(tube(np.array([P(x1, gy), P(x1 + 0.34, gy)]), 0.06, "#3A3A3A", cap=CapStyleType.BUTT),
                                rect(x1 + 0.12, gy - 0.05, x1 + 0.2, gy + 0.05, BRASS, 1.5),
                                rect(x1 + 0.1, gy + 0.05, x1 + 0.3, gy + 0.09, HARD_HAT, 1.5, r=0.02)))
        jy = y0 + 0.75
        self.part("jbox", rect(x0 - 0.16, jy - 0.13, x0, jy + 0.13, METAL_DARK, DETAIL_W))
        self.mark("supply_top", (x, y1 + 0.1))
        self.mark("return_bottom", (x, y0))
        self.mark("burner_window", (x, wy))
        self.mark("flue", (x0 - 0.22, y1 + 0.55))
        self.mark("gas_in", (x1 + 0.34, gy))
        self.mark("power_in", (x0 - 0.16, jy))
        self.mark("base", (x, y0))
        if mirror:
            self.flip(about_point=P(x, floor_y))
        self.set_z_index(Z_PROP)
        if not lit:
            self._set_flames(0.0)

    def _set_flames(self, level):
        level = float(np.clip(level, 0, 1))
        s = 0.15 + 0.85 * level
        fl = self.parts["flames"]
        fl.stretch(s / self._flame_s, 1, about_edge=DOWN)
        self._flame_s = s
        for f in fl:
            f.set_fill(opacity=level).set_stroke(opacity=level)
        self.burner_on = level > 0.5
        self._flame_level = level

    def burner(self, on=True, run_time=0.4):
        """Animate the flames in the sight window on or off."""
        target = 1.0 if on else 0.0
        return Tween(self.parts["flames"], lambda: self._flame_level,
                     lambda s, a: self._set_flames(s + (target - s) * a), run_time=run_time)


class EvapCoil(Prop):
    """Cased A-coil at (x, bottom_y), sized to sit on a Furnace; points lineset_suction, lineset_liquid, lineset, drain, top, bottom."""

    def __init__(self, x=0.0, bottom_y=0.0, width=17.5 * IN, new=True, mirror=False, iced=False, **kwargs):
        """width defaults to the Furnace width; mirror=True puts the stubs and drain on the left; iced=True starts
        frozen solid (dirty filter, no airflow): melt() thaws it."""
        super().__init__(**kwargs)
        fill, dark = _palette(new)
        HC = 21 * IN
        x0, x1, y0, y1 = x - width / 2, x + width / 2, bottom_y, bottom_y + HC
        self.part("case", rect(x0, y0, x1, y1, fill, PROP_W))
        # the A seen through the access panel: two finned slabs leaning together over a drain pan
        py = y0 + 0.16
        pan = rect(x0 + 0.08, y0 + 0.06, x1 - 0.08, py, dark, DETAIL_W)
        slabs = VGroup()
        for s in (-1, 1):
            b0, b1 = P(x + s * (width / 2 - 0.12), py), P(x + s * (width / 2 - 0.3), py)
            t0, t1 = P(x + s * 0.03, y1 - 0.1), P(x + s * 0.14, y1 - 0.1)
            slab = Polygon(b0, b1, t1, t0).set_fill(dark, 1).set_stroke(INK, DETAIL_W)
            fins = VGroup(*[Line(b0 + (t0 - b0) * k, b1 + (t1 - b1) * k, stroke_width=1.2, color=INK).set_stroke(opacity=0.45)
                            for k in np.linspace(0.08, 0.92, 9)])
            slabs.add(slab, fins)
        self.part("coil", VGroup(pan, slabs))
        self.part("panel_edge", rect(x0 + 0.05, y0 + 0.04, x1 - 0.05, y1 - 0.04, None, 1.5))
        ys, yl = y0 + 0.62 + LINESET_SEP, y0 + 0.62
        self.part("stubs", VGroup(
            tube(np.array([P(x1, ys), P(x1 + 0.2, ys)]), 0.13, FOAM, cap=CapStyleType.BUTT),
            tube(np.array([P(x1, yl), P(x1 + 0.2, yl)]), 0.05, COPPER, cap=CapStyleType.BUTT)))
        dy = y0 + 0.11
        self.part("drain_stub", VGroup(tube(np.array([P(x1, dy), P(x1 + 0.16, dy)]), 0.075, WHITE, cap=CapStyleType.BUTT),
                                       rect(x1, dy - 0.07, x1 + 0.04, dy + 0.07, WHITE, 1.5)))
        self.mark("lineset_suction", (x1 + 0.2, ys))
        self.mark("lineset_liquid", (x1 + 0.2, yl))
        self.mark("lineset", (x1 + 0.2, (ys + yl) / 2))
        self.mark("drain", (x1 + 0.16, dy))
        self.mark("top", (x, y1))
        self.mark("bottom", (x, y0))
        # ice: a frosty blue crust over the A-coil and the suction stub, with sparkly highlights
        rng = np.random.default_rng(4)
        crust = Polygon(P(x0 + 0.1, y0 + 0.12), P(x - 0.1, y1 - 0.05), P(x + 0.1, y1 - 0.05), P(x1 - 0.1, y0 + 0.12),
                        P(x1 - 0.28, y0 + 0.2), P(x, y1 - 0.38), P(x0 + 0.28, y0 + 0.2))
        crust.set_fill(ICE, 0.85).set_stroke(ICE_EDGE, 2.5)
        icicles = VGroup(*[Polygon(P(ix - 0.035, y0 + 0.14), P(ix + 0.035, y0 + 0.14), P(ix, y0 + 0.14 - rng.uniform(0.08, 0.16)))
                           .set_fill(ICE, 0.9).set_stroke(ICE_EDGE, 1.5) for ix in np.linspace(x0 + 0.25, x1 - 0.25, 5)])
        stub_ice = rect(x1 - 0.02, ys - 0.11, x1 + 0.24, ys + 0.11, ICE, 2.0, r=0.05, opacity=0.85, color=ICE_EDGE)
        glints = VGroup(*[seg((gx - 0.04, gy), (gx + 0.04, gy), w=2, color=WHITE) for gx, gy in
                          ((x - 0.25, y0 + 0.6), (x + 0.2, y0 + 0.9), (x1 + 0.1, ys + 0.04))])
        self.part("ice", VGroup(crust, icicles, stub_ice, glints))
        self._ice_base = [(m, m.get_fill_opacity(), m.get_stroke_opacity()) for m in self.parts["ice"].family_members_with_points()]
        self._ice = 1.0 if iced else 0.0
        self._apply_ice(self._ice)
        if mirror:
            self.flip(about_point=P(x, bottom_y))
        self.set_z_index(Z_PROP)

    def _apply_ice(self, k):
        self._ice = k
        for m, fo, so in self._ice_base:
            m.set_fill(opacity=fo * k)
            m.set_stroke(opacity=so * k)

    def melt(self, run_time=1.5):
        """The ice shrinks and fades away (pair with the drain's drip())."""
        return Tween(self.parts["ice"], lambda: self._ice, lambda s0, a: self._apply_ice(s0 * (1 - a)), run_time=run_time,
                     rate_func=linear)


class LineSet(Prop):
    """Insulated suction + bare copper liquid line bent along points; points end_a, end_b, suction_a, liquid_a, suction_b, liquid_b; method reshape(points)."""

    N = 180

    def __init__(self, points, sep=LINESET_SEP, suction_side=1, radius=0.3, **kwargs):
        """points = centreline, bends rounded to radius; suction rides left of the direction of travel (suction_side=-1 swaps)."""
        super().__init__(**kwargs)
        self.sep, self.side, self.radius = sep, suction_side, radius
        path = rounded_path(points, radius, n=self.N)
        self.part("suction", tube(path, 0.13, FOAM))
        liquid = tube(path, 0.055, COPPER)
        hi = VMobject().set_points_as_corners(path).set_stroke(COPPER_HI, 1.6).set_fill(opacity=0)
        hi.set_cap_style(CapStyleType.ROUND)
        liquid.add(hi)
        self.part("liquid", liquid)
        for nm in ("end_a", "end_b", "suction_a", "liquid_a", "suction_b", "liquid_b"):
            self.mark(nm, (0, 0))
        self._set_path(path)
        self.set_z_index(Z_BEHIND)

    def _set_path(self, path):
        self._path = np.array(path)
        s = offset_path(self._path, self.side * self.sep / 2)
        q = offset_path(self._path, -self.side * self.sep / 2)
        for m in self.parts["suction"]:
            m.set_points_as_corners(s)
        o, i, hi = self.parts["liquid"]
        o.set_points_as_corners(q)
        i.set_points_as_corners(q)
        hi.set_points_as_corners(offset_path(q, 0.012)[2:-2])
        for nm, p in (("end_a", self._path[0]), ("end_b", self._path[-1]), ("suction_a", s[0]),
                      ("suction_b", s[-1]), ("liquid_a", q[0]), ("liquid_b", q[-1])):
            self._points[nm].move_to(p)

    def reshape(self, points, run_time=0.8, **kwargs):
        """Animate the pair re-bending onto a new centreline (same rules as the constructor)."""
        target = rounded_path(points, self.radius, n=self.N)
        return Tween(self, lambda: self._path.copy(), lambda s, a: self._set_path(s + (target - s) * a),
                     run_time=run_time, **kwargs)


class Thermostat(Prop):
    """Wall thermostat at center with an LCD temperature; points screen, button_up, button_down, terminal, wall; methods set_temp(value), screen_on(on)."""

    def __init__(self, center=(0, 0), temp=72, on=True, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        hgt = 0.12 * H
        wid = 1.25 * hgt
        self.part("plate", rect(cx - wid / 2 - 0.03, cy - hgt / 2 - 0.03, cx + wid / 2 + 0.03, cy + hgt / 2 + 0.03,
                                METAL_HI, DETAIL_W, r=0.06))
        self.part("body", rect(cx - wid / 2, cy - hgt / 2, cx + wid / 2, cy + hgt / 2, WHITE, PROP_W, r=0.07))
        sx0, sx1, sy0, sy1 = cx - wid / 2 + 0.07, cx + wid / 2 - 0.17, cy - hgt / 2 + 0.14, cy + hgt / 2 - 0.07
        self.part("screen", rect(sx0, sy0, sx1, sy1, LCD_ON, DETAIL_W, r=0.025))
        digits = SevenSeg(2, 0.16).move_to(P((sx0 + sx1) / 2 - 0.03, (sy0 + sy1) / 2))
        self.part("digits", digits)
        deg = Circle(radius=0.022).move_to(P(digits.get_right()[0] + 0.035, digits.get_top()[1] - 0.025)) \
            .set_fill(opacity=0).set_stroke(INK, 1.8)
        self.part("degree", deg)
        bx = cx + wid / 2 - 0.09
        up = Polygon(P(bx - 0.045, cy + 0.02), P(bx + 0.045, cy + 0.02), P(bx, cy + 0.09)).set_fill(METAL, 1).set_stroke(INK, 1.5)
        dn = Polygon(P(bx - 0.045, cy - 0.02), P(bx + 0.045, cy - 0.02), P(bx, cy - 0.09)).set_fill(METAL, 1).set_stroke(INK, 1.5)
        self.part("buttons", VGroup(up, dn))
        leds = VGroup(*[Dot(P(cx - wid / 2 + 0.12 + i * 0.08, cy - hgt / 2 + 0.07), radius=0.016, color=METAL_DARK)
                        for i in range(3)])
        self.part("leds", leds)
        self.mark("screen", ((sx0 + sx1) / 2, (sy0 + sy1) / 2))
        self.mark("button_up", (bx, cy + 0.05))
        self.mark("button_down", (bx, cy - 0.05))
        self.mark("terminal", (cx, cy - hgt / 2 + 0.03))
        self.mark("wall", (cx, cy))
        self.temp = int(round(temp))
        self._level = 1.0
        self._show(self.temp)
        self.set_z_index(Z_PROP)
        if not on:
            self._apply_level(0.0)

    def _show(self, v):
        v = int(np.clip(v, -9, 99))
        self.parts["digits"].set_text(str(v))

    def _apply_level(self, lv):
        self._level = float(lv)
        self.parts["digits"].set_level(lv)
        self.parts["degree"].set_stroke(opacity=lv)
        self.parts["screen"].set_fill(mix(LCD_OFF, LCD_ON, lv), 1)

    def set_temp(self, value, run_time=0.8, **kwargs):
        """Animate the digits ticking a degree at a time to value (display range -9..99)."""
        target = int(round(value))

        def apply(s, a):
            v = int(round(s + (target - s) * a))
            if v != self.temp or a >= 1:
                self.temp = v
                self._show(v)

        return Tween(self.parts["digits"], lambda: self.temp, apply, run_time=run_time, **kwargs)

    def screen_on(self, on=True, run_time=0.3, **kwargs):
        """Animate the screen backlight and digits on or off."""
        target = 1.0 if on else 0.0
        return Tween(self, lambda: self._level,
                     lambda s, a: self._apply_level(s + (target - s) * a), run_time=run_time, **kwargs)


class CondensateDrain(Prop):
    """PVC condensate drain with a vented P-trap, starting at inlet; points inlet, trap, vent, outlet; method drip()."""

    def __init__(self, inlet=(0, 0), direction=1, stub=0.3, run=1.4, drop=1.0, slope=0.06, **kwargs):
        """direction=-1 runs it left; stub, run (sloped by slope) and drop set the lengths."""
        super().__init__(**kwargs)
        d = 1 if direction >= 0 else -1
        x, y = inlet[0], inlet[1]
        r, depth = 0.11, 0.34
        xa, xd = x + d * stub, x + d * (stub + 2 * r)
        xe, ye = xd + d * run, y - slope
        way = [(x, y), (xa, y), (xa, y - depth), (xd, y - depth), (xd, y), (xe, ye), (xe, ye - drop)]
        path = rounded_path(way, radius=r)
        self.part("pipe", tube(path, 0.08, WHITE, cap=CapStyleType.BUTT))
        vent = tube(np.array([P(xd, y), P(xd, y + 0.32)]), 0.08, WHITE, cap=CapStyleType.BUTT)
        cap = rect(xd - 0.07, y + 0.3, xd + 0.07, y + 0.37, WHITE, DETAIL_W, r=0.015)
        tee = rect(xd - 0.08, y - 0.08, xd + 0.08, y + 0.08, WHITE, DETAIL_W)
        hub = rect(x + d * 0.02, y - 0.07, x + d * 0.1, y + 0.07, WHITE, DETAIL_W)
        elbow = rect(xe - 0.08, ye - 0.08, xe + 0.08, ye + 0.08, WHITE, DETAIL_W)
        self.part("fittings", VGroup(vent, cap, tee, hub, elbow))
        self.mark("inlet", (x, y))
        self.mark("trap", ((xa + xd) / 2, y - depth))
        self.mark("vent", (xd, y + 0.37))
        self.mark("outlet", (xe, ye - drop))
        self.set_z_index(Z_BEHIND)

    def drip(self, n=3, run_time=1.5, fall=0.8):
        """n drops form at the outlet and fall over run_time, then remove themselves."""
        from manim import FadeIn, FadeOut, LaggedStart, Succession  # local: keeps the import list short
        o = self.pt("outlet")
        anims = []
        for i in range(n):
            drop = teardrop((o[0], o[1] - 0.12), 0.07, 0.11, WATER, 1.5).set_z_index(Z_PROP)
            anims.append(Succession(FadeIn(drop, shift=0.06 * DOWN, run_time=0.35),
                                    FadeOut(drop, shift=fall * DOWN, run_time=0.45, rate_func=lambda t: t * t)))
        each = 0.8
        lag = 0.0 if n == 1 else max(0.0, (run_time - each) / (each * (n - 1)))
        return LaggedStart(*anims, lag_ratio=lag, run_time=run_time)


class FilterRack(Prop):
    """Filter rack in a duct run at center, the filter is part "filter"; points grip (rides on the filter), slot, duct_left, duct_right."""

    def __init__(self, center=(0, 0), width=1.5, height=1.0, dirty=False, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        x0, x1, y0, y1 = cx - width / 2, cx + width / 2, cy - height / 2, cy + height / 2
        # the filter: cardboard frame + pleats, mostly hidden inside the rack, its top edge and tab showing
        fx0, fx1, fy0, fy1 = x0 + 0.1, x1 - 0.1, y0 + 0.2, y1 + 0.3
        media = "#9A9184" if dirty else WHITE
        frame = rect(fx0, fy0, fx1, fy1, OLD_UNIT, DETAIL_W)
        inner = rect(fx0 + 0.07, fy0 + 0.07, fx1 - 0.07, fy1 - 0.07, media, 1.5)
        n = int((fx1 - fx0 - 0.14) / 0.07)
        zig = [P(fx0 + 0.07 + i * (fx1 - fx0 - 0.14) / n, fy0 + 0.07 if i % 2 else fy1 - 0.07) for i in range(n + 1)]
        pleats = VMobject().set_points_as_corners(zig).set_stroke(METAL_DARK, 1.2).set_fill(opacity=0)
        tab = rect(cx - 0.1, fy1 - 0.02, cx + 0.1, fy1 + 0.07, WHITE, 1.5, r=0.02)
        filt = self.part("filter", VGroup(frame, inner, pleats, tab))
        _mark_in(self, filt, "grip", (cx, fy1 + 0.04))
        # rack front (drawn over the filter) and the slot lip
        self.part("collars", VGroup(rect(x0 - 0.12, y0 + 0.08, x0, y1 - 0.08, METAL, DETAIL_W),
                                    rect(x1, y0 + 0.08, x1 + 0.12, y1 - 0.08, METAL, DETAIL_W)))
        self.part("rack", VGroup(rect(x0, y0, x1, y1, METAL, PROP_W),
                                 seg((x0 + 0.06, y1 - 0.08), (x1 - 0.06, y1 - 0.08), w=1.5, color=METAL_DARK),
                                 seg((x0 + 0.06, y0 + 0.08), (x1 - 0.06, y0 + 0.08), w=1.5, color=METAL_DARK)))
        self.part("slot", rect(x0 + 0.06, y1 - 0.03, x1 - 0.06, y1 + 0.03, "#3A3A3A", DETAIL_W))
        self.mark("slot", (cx, y1))
        self.mark("duct_left", (x0 - 0.12, cy))
        self.mark("duct_right", (x1 + 0.12, cy))
        self.set_z_index(Z_PROP)


class BreakerPanel(Prop):
    """Breaker panel at center (parts breaker_i, toggle_i, main, toggle_main, door); points door_handle, breaker_i, main, top, bottom; methods flip(index, on), open_door()."""

    ROWS = 8

    def __init__(self, center=(0, 0), opened=False, **kwargs):
        super().__init__(**kwargs)
        cx, cy = center[0], center[1]
        W, HP = 14.5 * IN, 28 * IN
        x0, x1, y0, y1 = cx - W / 2, cx + W / 2, cy - HP / 2, cy + HP / 2
        self.part("box", rect(x0, y0, x1, y1, METAL, PROP_W))
        self.part("deadfront", rect(x0 + 0.07, y0 + 0.07, x1 - 0.07, y1 - 0.07, METAL_HI, DETAIL_W))
        # main breaker (handle moves up = on)
        my = y1 - 0.24
        self.part("main", rect(cx - 0.2, my - 0.1, cx + 0.2, my + 0.1, "#3A3A3A", DETAIL_W, r=0.02))
        self.part("toggle_main", rect(cx - 0.12, my - 0.035, cx + 0.12, my + 0.035, WHITE, 1.5, r=0.015))
        self.mark("main", (cx, my))
        self._main_dy = 0.045
        self.parts["toggle_main"].shift(P(0, self._main_dy))
        # branch breakers: two columns, toggle toward the centre = on
        bw, bh, gap = 0.3, 0.1, 0.022
        top = my - 0.2
        self.breaker_on, self._col = [], []
        i = 0
        for row in range(self.ROWS):
            by = top - row * (bh + gap)
            for s in (-1, 1):
                bx = cx + s * (bw / 2 + 0.015)
                self.part(f"breaker_{i}", rect(bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2, "#3A3A3A", 1.5))
                tg = rect(bx - 0.05, by - 0.028, bx + 0.05, by + 0.028, WHITE, 1.2, r=0.01)
                self.part(f"toggle_{i}", tg.shift(P(-s * 0.06, 0)))
                self.mark(f"breaker_{i}", (bx, by))
                self.breaker_on.append(True)
                self._col.append(s)
                i += 1
        self.n_breakers = i
        self.main_on = True
        # door, hinged on the left, latch on the right
        dx0, dx1, dy0, dy1 = x0 + 0.04, x1 - 0.04, y0 + 0.04, y1 - 0.04
        door = VGroup(rect(dx0, dy0, dx1, dy1, METAL, PROP_W),
                      rect(dx0 + 0.1, dy1 - 0.42, dx1 - 0.16, dy1 - 0.12, None, 1.5, color=METAL_DARK),
                      rect(dx1 - 0.1, cy - 0.12, dx1 - 0.04, cy + 0.12, "#3A3A3A", 1.5, r=0.02))
        self.part("door", door)
        _mark_in(self, door, "door_handle", (dx1 - 0.07, cy))
        self.mark("door_hinge", (dx0, cy))
        self.mark("top", (cx, y1))
        self.mark("bottom", (cx, y0))
        self.set_z_index(Z_PROP)
        self._door_closed = door.copy()
        self._door_hinge0 = self.pt("door_hinge")
        self._box_w0 = self.parts["box"].width
        self._door_open = 0.0
        if opened:
            self._set_door(1.0)

    # ------------------------------------------------------------ breakers
    def flip(self, index, on=False, run_time=0.25, **kwargs):
        """Animate breaker index (0.., or "main") on/off; branch toggles sit toward the centre when on, the main moves up."""
        if index == "main":
            body, tg = self.parts["main"], self.parts["toggle_main"]
            target = np.array([0.0, self._main_dy if on else -self._main_dy, 0.0])

            def done():
                self.main_on = bool(on)
        else:
            body, tg = self.parts[f"breaker_{index}"], self.parts[f"toggle_{index}"]
            s = self._col[index]
            target = np.array([-s * 0.06 if on else s * 0.06, 0.0, 0.0])

            def done():
                self.breaker_on[index] = bool(on)

        def apply(start, a):
            tg.move_to(body.get_center() + start + (target - start) * a)
            if a >= 1:
                done()

        return Tween(tg, lambda: tg.get_center() - body.get_center(), apply, run_time=run_time, **kwargs)

    # ------------------------------------------------------------ door
    def _set_door(self, k):
        """k=0 closed, 1 swung open to the left of the hinge (seen nearly edge-on, inside showing)."""
        door = self.parts["door"]
        hinge = self.pt("door_hinge")
        k_scale = self.parts["box"].width / self._box_w0  # the panel may have been scaled since it was built
        door.become(self._door_closed.copy().scale(k_scale, about_point=self._door_hinge0).shift(hinge - self._door_hinge0))
        door.stretch(1 - 1.3 * k, 0, about_point=hinge)
        if k > 0.5:
            door[0].set_fill(mix(METAL, METAL_DARK, min(1, (k - 0.5) * 2)), 1)
        self._door_open = k

    def open_door(self, opened=True, run_time=0.6, **kwargs):
        """Animate the door swinging open past its left hinge (opened=False closes it)."""
        target = 1.0 if opened else 0.0
        return Tween(self.parts["door"], lambda: self._door_open,
                     lambda s, a: self._set_door(s + (target - s) * a), run_time=run_time, **kwargs)
