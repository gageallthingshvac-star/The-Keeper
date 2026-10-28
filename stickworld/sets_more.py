"""Extra backdrops for later episodes: attic, crawlspace, rooftop and utility closet.

Each function returns a Prop at z_index Z_SET that fills the 9 x 16 frame (x -4.5..4.5, y -8..8) and names its
anchors with mark(), e.g. attic().pt("hatch"). Everything is drawn in cutaway section, flat, INK outlines.
"""
import numpy as np
from manim import Circle, Ellipse, Polygon, VGroup, VMobject

from .props.base import Prop
from .props.hvac_more import IN, mix, rect, seg, tube
from .style import (
    CONCRETE, DETAIL_W, H, HARD_HAT, INK, INSULATION, METAL, METAL_DARK, METAL_HI, OLD_UNIT, PROP_W, ROOF,
    SIDING, SPARK, WALL, WHITE, WOOD, Z_PROP_FRONT, Z_SET, P,
)

DIRT = "#A68A64"
VAPOR = "#2B2B2B"                                 # black poly vapour barrier
SHEATHING = mix(WOOD, WHITE, 0.35)  # plywood / OSB, lighter than framing lumber
CLOSET_WALL = mix(WALL, CONCRETE, 0.35)
ROOM_HOT = "#F9DCC0"    # a hot room: warm peach walls
ROOM_COOL = "#E3F0F8"   # the same room once the AC is on

X0, X1, Y0, Y1 = -4.5, 4.5, -8.0, 8.0
BLEED = 0.15  # draw backgrounds a little past the frame edge


def _fill(x0, y0, x1, y1, color, opacity=1.0):
    """Flat background area, no outline."""
    return rect(x0, y0, x1, y1, color, 0, opacity=opacity)


def _joists(x0, x1, top, depth, spacing=16 * IN, skip=(), batts=True, sag=None, bw=0.1):
    """Floor/ceiling joists seen end-on with pink batts between them. skip = [(xa, xb)] openings;
    sag = x of one batt that droops below the joists (crawlspace gag)."""
    edges = [e for a, b in skip for e in (a - bw / 2, b + bw / 2)]  # framing either side of an opening
    xs = [x for x in np.arange(x0, x1 + 1e-6, spacing)
          if not any(a - bw <= x <= b + bw for a, b in skip) and all(abs(x - e) > 0.3 for e in edges)]
    xs = sorted(xs + edges)
    g = VGroup()
    if batts:
        for xa, xb in zip(xs[:-1], xs[1:]):
            if any(a < (xa + xb) / 2 < b for a, b in skip):
                continue
            l, r = xa + bw / 2 + 0.01, xb - bw / 2 - 0.01
            if sag is not None and l < sag < r:
                b = VMobject().set_points_smoothly([P(l, top - 0.05), P(l + 0.05, top - depth - 0.25),
                                                    P((l + r) / 2, top - depth - 0.45), P(r - 0.05, top - depth - 0.25),
                                                    P(r, top - 0.05)])
                b.add_line_to(P(l, top - 0.05))
                b.set_fill(INSULATION, 1).set_stroke(INK, DETAIL_W)
            else:
                b = rect(l, top - depth + 0.03, r, top - 0.01, INSULATION, DETAIL_W, r=0.07)
            fluff = VGroup(*[VMobject().set_points_smoothly([P(l + 0.12, y), P(l + 0.25, y + 0.04), P(l + 0.38, y)])
                             .set_stroke(INK, 1.2, opacity=0.45) for y in (top - depth * 0.35, top - depth * 0.7)])
            g.add(b, fluff)
    for x in xs:
        g.add(rect(x - bw / 2, top - depth, x + bw / 2, top, WOOD, DETAIL_W))
    return g


def _blocks(x0, y0, x1, y1, course=8 * IN, unit=16 * IN, color=CONCRETE, w=PROP_W):
    """Concrete-block (or brick) wall/pier in section with mortar lines."""
    g = VGroup(rect(x0, y0, x1, y1, color, w))
    rows = int(round((y1 - y0) / course))
    for i in range(1, rows):
        y = y0 + i * (y1 - y0) / rows
        g.add(seg((x0, y), (x1, y), w=1.5, opacity=0.6))
    for i in range(rows):
        ya, yb = y0 + i * (y1 - y0) / rows, y0 + (i + 1) * (y1 - y0) / rows
        off = 0.0 if i % 2 else unit / 2
        for x in np.arange(x0 + off + unit / 2, x1 - 0.05, unit):
            g.add(seg((x, ya), (x, yb), w=1.5, opacity=0.6))
    return g


def _pebbles(x0, x1, y0, y1, n, seed):
    rng = np.random.default_rng(seed)
    g = VGroup()
    for _ in range(n):
        w = rng.uniform(0.08, 0.2)
        g.add(Ellipse(width=w, height=w * rng.uniform(0.5, 0.8))
              .move_to(P(rng.uniform(x0, x1), rng.uniform(y0, y1)))
              .set_fill(mix(DIRT, INK, 0.25), 1).set_stroke(INK, 1.2, opacity=0.6))
    return g


def _cloud(cx, cy, s=1.0):
    pts = [P(cx + s * dx, cy + s * dy) for dx, dy in
           ((-0.7, 0), (-0.6, 0.22), (-0.3, 0.3), (-0.1, 0.48), (0.25, 0.42), (0.4, 0.26), (0.7, 0.22), (0.75, 0))]
    c = VMobject().set_points_smoothly(pts)
    c.add_line_to(P(cx - 0.7 * s, cy))
    return c.set_fill(WHITE, 1).set_stroke(INK, DETAIL_W, opacity=0.5)


# ================================================================ attic
def attic(floor_y=-2.4, room_floor=None, hatch_x=-2.6, stair_foot="left", walkway=None, light_x=2.0,
          register_x=None, thermostat_x=3.1, work_x=1.4, plenum_x=None, plenum_y=None, room_color=WALL, stud_x=None):
    """Gable attic over a room: rafters meeting at the ridge with a collar tie, joists with pink batts, a
    plywood walkway and a framed hatch with a pull-down stair into the room below.
    room_floor: draw the room's floor at that height (the stair lands on it); stair_foot "left"/"right": which way
    the stair runs down from the hatch; walkway=(x0, x1); register_x: a supply register in the room ceiling;
    plenum_x/plenum_y: a supply plenum hung from the rafters whose bottom sits at plenum_y (an air handler slides
    in under it). room_color: the room's wall colour (start a hot room warm, ROOM_HOT, and tween parts["room"] to
    ROOM_COOL when the AC comes on). stud_x: a 2x4 standing from the floor to the rafter (mount a service disconnect on
    it at anchor "stud_mount"). The stair is drawn in front of props (Z_PROP_FRONT) so a load hauled up it sits between the rails.
    Anchors: hatch, lip (top of the hatch curb on the stair-top side), floor_left, floor_right, work_spot, peak,
    walkway_left, walkway_right, ceiling (underside), stair_top, stair_bottom, tread_0.. (bottom up; .treads = list
    of names), and with room_floor: room_floor, thermostat_spot (60 in up); register; plenum_bottom."""
    F = floor_y
    s = Prop()
    peak, half_span, jd = 5.6, 7.5, 0.36
    PY, slope = F + peak, peak / half_span
    tv = 0.45 * np.sqrt(1 + slope ** 2)  # vertical thickness of a 2x8 rafter

    def y_in(x):
        return PY - slope * abs(x)

    xe = X1 + BLEED
    ceil = F - jd - 0.05
    # room below and the attic air (pale, wood-toned)
    s.part("room", _fill(X0 - BLEED, Y0 - BLEED, X1 + BLEED, ceil, room_color))
    s.part("air", Polygon(P(-xe, F), P(-xe, y_in(xe)), P(0, PY), P(xe, y_in(xe)), P(xe, F))
           .set_fill(WOOD, 0.16).set_stroke(width=0))
    # gable-end vent on the far wall
    vx0, vx1, vy0, vy1 = -0.45, 0.45, F + 3.35, F + 4.05
    s.part("gable_vent", VGroup(rect(vx0, vy0, vx1, vy1, WHITE, DETAIL_W),
                                *[seg((vx0 + 0.05, y), (vx1 - 0.05, y), w=DETAIL_W, color=METAL_DARK)
                                  for y in np.arange(vy0 + 0.1, vy1 - 0.05, 0.1)]))

    def chevron(a, b, color, w=PROP_W):
        return Polygon(P(-xe, y_in(xe) + a), P(0, PY + a), P(xe, y_in(xe) + a),
                       P(xe, y_in(xe) + b), P(0, PY + b), P(-xe, y_in(xe) + b)).set_fill(color, 1).set_stroke(INK, w)

    s.part("sky", VGroup(_cloud(-2.7, PY + 2.2, 1.0), _cloud(2.6, PY + 3.4, 0.8)))
    s.part("shingles", chevron(tv + 0.07, tv + 0.19, ROOF))
    s.part("sheathing", chevron(tv, tv + 0.07, SHEATHING, DETAIL_W))
    s.part("rafters", chevron(0, tv, WOOD))
    s.part("ridge", rect(-0.07, PY - 0.14, 0.07, PY + tv, WOOD, DETAIL_W))
    ty = F + 4.6
    tx = (PY - ty - 0.3) / slope
    s.part("collar_tie", rect(-tx, ty, tx, ty + 0.3, WOOD, PROP_W))
    # floor: drywall ceiling below, joists + batts, plywood walkway; hatch opening on the left
    hx0, hx1 = hatch_x - 0.7, hatch_x + 0.7
    s.part("drywall", VGroup(rect(-xe, ceil, hx0 - 0.1, F - jd, WHITE, DETAIL_W),
                             rect(hx1 + 0.1, ceil, xe, F - jd, WHITE, DETAIL_W)))
    s.part("joists", _joists(-4.6, 4.7, F - 0.05, jd - 0.05, skip=[(hx0 - 0.05, hx1 + 0.05)]))
    s.part("hatch_frame", VGroup(rect(hx0 - 0.1, ceil, hx0, F + 0.28, WOOD, DETAIL_W),
                                 rect(hx1, ceil, hx1 + 0.1, F + 0.28, WOOD, DETAIL_W)))
    wx0, wx1 = walkway if walkway is not None else (hx1 + 0.35, 3.45)
    s.part("walkway", rect(wx0, F - 0.05, wx1, F, SHEATHING, DETAIL_W))
    # pull-down stair hanging from the hatch into the room
    foot_y = room_floor if room_floor is not None else Y0 - 0.3
    if stair_foot == "left":
        top, bot = P(hx1 - 0.05, ceil), P(hx0 - 0.55, foot_y)
    else:
        top, bot = P(hx0 + 0.05, ceil), P(hx1 + 0.55, foot_y)
    treads = VGroup()
    tread_pts = []
    n_rise = max(2, int(round((ceil - foot_y) / 0.72)))  # even risers of about 11 in from the floor to the hatch
    for y in (foot_y + (ceil - foot_y) * np.arange(n_rise - 1, 0, -1) / n_rise):
        k = (ceil - y) / (ceil - bot[1])
        x = top[0] + (bot[0] - top[0]) * k
        treads.add(rect(x - 0.2, y - 0.05, x + 0.2, y, WOOD, DETAIL_W))
        tread_pts.append((x, y))
    s.part("stair", VGroup(tube(np.array([top, bot]), 0.09, WOOD), treads,
                           rect(hx0, ceil - 0.06, hx1, ceil, SHEATHING, DETAIL_W)))
    if room_floor is not None:
        s.part("room_floor", VGroup(_fill(-xe, Y0 - BLEED, xe, room_floor - 0.25, CONCRETE),
                                    rect(-xe, room_floor - 0.25, xe, room_floor, mix(WOOD, WHITE, 0.55), PROP_W),
                                    rect(-xe, room_floor, xe, room_floor + 0.1, WHITE, DETAIL_W)))
    if register_x is not None:
        rx = register_x
        s.part("register", VGroup(rect(rx - 0.42, ceil - 0.08, rx + 0.42, ceil, METAL, DETAIL_W),
                                  *[seg((x, ceil - 0.07), (x, ceil - 0.01), w=1.5, color=METAL_DARK)
                                    for x in np.arange(rx - 0.34, rx + 0.36, 0.085)]))
        s.mark("register", (rx, ceil - 0.08))
    # a ceiling light in the room below
    lx = light_x
    dome = Polygon(*[P(lx + 0.32 * np.cos(t), ceil - 0.06 + 0.2 * np.sin(t)) for t in np.linspace(np.pi, 2 * np.pi, 13)])
    s.part("light", VGroup(rect(lx - 0.2, ceil - 0.06, lx + 0.2, ceil, WHITE, DETAIL_W),
                           dome.set_fill(WHITE, 1).set_stroke(INK, DETAIL_W)))
    s.mark("hatch", ((hx0 + hx1) / 2, F))
    s.mark("floor_left", (-3.9, F - 0.05))
    s.mark("floor_right", (3.9, F - 0.05))
    s.mark("work_spot", (work_x, F))
    s.mark("ceiling", (0, ceil))
    s.mark("stair_top", tuple(top[:2]))
    s.mark("stair_bottom", tuple(bot[:2]))
    s.treads = []
    for i, (x, y) in enumerate(reversed(tread_pts)):
        s.mark(f"tread_{i}", (x, y))
        s.treads.append(f"tread_{i}")
    if room_floor is not None:
        s.mark("room_floor", (0, room_floor))
        s.mark("thermostat_spot", (thermostat_x, room_floor + 60 * IN))
    if plenum_x is not None:
        px, py = plenum_x, plenum_y if plenum_y is not None else F + 3.3
        pw, ph = 0.62, 0.55
        box = rect(px - pw, py, px + pw, py + ph, METAL, PROP_W)
        seams = VGroup(seg((px - pw + 0.08, py + ph - 0.1), (px + pw - 0.08, py + ph - 0.1), w=1.5, color=METAL_HI),
                       seg((px - pw, py + 0.08), (px + pw, py + 0.08), w=DETAIL_W))
        takeoff = VGroup(Circle(radius=0.2).move_to(P(px + 0.25, py + ph / 2)).set_fill(METAL_DARK, 1).set_stroke(INK, DETAIL_W),
                         Circle(radius=0.12).move_to(P(px + 0.25, py + ph / 2)).set_fill(VAPOR, 1).set_stroke(INK, 1.5))
        straps = VGroup(*[seg((x, py + ph), (x, y_in(x) - 0.02), w=DETAIL_W, color=METAL_DARK) for x in (px - pw + 0.12, px + pw - 0.12)])
        s.part("plenum", VGroup(straps, box, seams, takeoff))
        s.mark("plenum_bottom", (px, py))
    s.mark("lip", ((hx1 + 0.05) if stair_foot == "left" else (hx0 - 0.05), F + 0.28))
    if stud_x is not None:
        s.part("stud", rect(stud_x - 0.07, F, stud_x + 0.07, y_in(stud_x) + 0.05, WOOD, DETAIL_W))
        s.mark("stud_mount", (stud_x, F + 3.0))
    s.mark("walkway_left", (wx0, F))
    s.mark("walkway_right", (wx1, F))
    s.mark("peak", (0, PY))
    s.set_z_index(Z_SET)
    s.parts["stair"].set_z_index(Z_PROP_FRONT)
    return s


# ================================================================ house at night (living room + utility closet)
NIGHT_SKY = "#1B2A4A"
NIGHT_GLASS = "#22355E"
MOON = "#FFF3B0"


def house_night(floor_y=-0.6, room_color=WALL, partition_x=1.0, register_x=-2.2, window_x=-3.25, clock_x=-1.3,
                trunk_x=None, trunk_y=None, trunk_w=1.1):
    """A house cut open at night: living room on the left, utility closet on the right behind a partition wall with
    a doorway, ceiling and gable roof against a starry sky, a night window with the moon, a ceiling register, wood
    floor on a foundation. Draw the yard and street below with sets.driveway() (added BEFORE this set, whose
    night_tint part darkens it). room_color: ROOM_HOT for a hot house, tween parts["room"] to ROOM_COOL later.
    Anchors: floor, ceiling, doorway, couch_spot, tv_spot, thermostat_spot, panel_spot, equipment_spot, clock_spot,
    register, window, front_step (where you step up from the yard). trunk_x/trunk_y: a sheet-metal supply trunk
    rising from trunk_y (the top of the equipment) into the ceiling."""
    F = floor_y
    s = Prop()
    xa, xb = X0 - BLEED, X1 + BLEED
    ceil = F + 92 * IN
    px0, px1 = partition_x, partition_x + 0.2
    rw = 4.25
    door_h = 82 * IN
    peak = ceil + 2.2
    # sky with stars and the room colours
    s.part("sky", _fill(xa, ceil, xb, Y1 + BLEED, NIGHT_SKY))
    rng = np.random.default_rng(11)
    roof_at = lambda x: peak + 0.32 - (peak - ceil - 0.4) * abs(x) / (X1 + BLEED)
    stars = VGroup()
    while len(stars) < 18:
        sx = rng.uniform(-4.35, 4.35)
        lo = roof_at(sx) + 0.25
        if lo < Y1 - 0.15:
            stars.add(Circle(radius=rng.uniform(0.02, 0.045)).move_to(P(sx, rng.uniform(lo, Y1 - 0.1)))
                      .set_fill(WHITE, rng.uniform(0.5, 1.0)).set_stroke(width=0))
    s.part("stars", stars)
    s.part("room", _fill(xa, F, px0, ceil, room_color))
    s.part("closet_wall", _fill(px1, F, xb, ceil, CLOSET_WALL))
    s.part("baseboards", VGroup(rect(xa, F, px0, F + 0.14, WHITE, DETAIL_W), rect(px1, F, rw, F + 0.14, WHITE, DETAIL_W)))
    # night window with the moon
    wx0, wx1, wy0, wy1 = window_x - 0.65, window_x + 0.65, F + 2.2, F + 3.9
    s.part("window", VGroup(rect(wx0, wy0, wx1, wy1, NIGHT_GLASS, PROP_W),
                            Circle(radius=0.22).move_to(P(wx1 - 0.35, wy1 - 0.4)).set_fill(MOON, 1).set_stroke(width=0),
                            Circle(radius=0.2).move_to(P(wx1 - 0.27, wy1 - 0.34)).set_fill(NIGHT_GLASS, 1).set_stroke(width=0),
                            *[Circle(radius=0.025).move_to(P(sx, sy)).set_fill(WHITE, 1).set_stroke(width=0)
                              for sx, sy in ((wx0 + 0.3, wy1 - 0.3), (wx0 + 0.55, wy0 + 0.6), (wx1 - 0.5, wy0 + 0.4))],
                            seg((window_x, wy0), (window_x, wy1), w=DETAIL_W), seg((wx0, (wy0 + wy1) / 2), (wx1, (wy0 + wy1) / 2), w=DETAIL_W),
                            rect(wx0 - 0.1, wy0 - 0.12, wx1 + 0.1, wy0, WHITE, DETAIL_W)))
    s.part("curtains", VGroup(Polygon(P(wx0 - 0.3, wy1 + 0.2), P(wx0 + 0.25, wy1 + 0.2), P(wx0 - 0.05, wy0 - 0.3), P(wx0 - 0.3, wy0 - 0.3)),
                              Polygon(P(wx1 + 0.3, wy1 + 0.2), P(wx1 - 0.25, wy1 + 0.2), P(wx1 + 0.05, wy0 - 0.3), P(wx1 + 0.3, wy0 - 0.3)))
           .set_fill("#C96F5B", 1).set_stroke(INK, DETAIL_W))
    # floor + foundation
    s.part("floor", VGroup(rect(xa, F - 0.45, xb, F - 0.12, mix(CONCRETE, INK, 0.12), PROP_W),
                           rect(xa, F - 0.12, xb, F, WOOD, PROP_W)))
    # ceiling, attic and roof
    s.part("ceiling", VGroup(rect(xa, ceil, xb, ceil + 0.06, WHITE, DETAIL_W), _joists(-4.6, 4.7, ceil + 0.45, 0.38)))
    s.part("roof", VGroup(Polygon(P(xa, ceil + 0.5), P(0, peak), P(xb, ceil + 0.5), P(xb, ceil + 0.08), P(xa, ceil + 0.08))
                          .set_fill(mix(WOOD, WHITE, 0.6), 1).set_stroke(width=0),
                          Polygon(P(xa - 0.2, ceil + 0.42), P(0, peak), P(xb + 0.2, ceil + 0.42), P(xb + 0.2, ceil + 0.72),
                                  P(0, peak + 0.32), P(xa - 0.2, ceil + 0.72)).set_fill(ROOF, 1).set_stroke(INK, PROP_W)))
    # partition wall in section (header over the doorway) and the closet's right wall
    s.part("partition", VGroup(rect(px0, F + door_h + 0.1, px1, ceil, WALL, PROP_W),
                               rect(px0 - 0.05, F + door_h, px1 + 0.05, F + door_h + 0.1, WOOD, DETAIL_W),
                               rect(px0 - 0.07, F, px0, F + door_h + 0.1, WHITE, DETAIL_W),
                               rect(px1, F, px1 + 0.07, F + door_h + 0.1, WHITE, DETAIL_W)))
    s.part("right_wall", rect(rw, F, xb, ceil, WALL, PROP_W))
    # ceiling register over the couch
    s.part("register", VGroup(rect(register_x - 0.42, ceil - 0.08, register_x + 0.42, ceil, METAL, DETAIL_W),
                              *[seg((x, ceil - 0.07), (x, ceil - 0.01), w=1.5, color=METAL_DARK)
                                for x in np.arange(register_x - 0.34, register_x + 0.36, 0.085)]))
    if trunk_x is not None:
        tx0, tx1 = trunk_x - trunk_w / 2, trunk_x + trunk_w / 2
        s.part("trunk", VGroup(rect(tx0, trunk_y, tx1, ceil, METAL, PROP_W),
                               *[seg((tx0 + 0.06, y), (tx1 - 0.06, y), w=1.5, color=METAL_HI) for y in np.arange(trunk_y + 0.35, ceil - 0.1, 0.45)]))
    # the yard at night: a blue tint over whatever is drawn below the house (sets.driveway)
    s.part("night_tint", _fill(xa, Y0 - BLEED, xb, F - 0.45, NIGHT_SKY, 0.42))
    s.mark("floor", (0, F))
    s.mark("ceiling", (0, ceil))
    s.mark("doorway", ((px0 + px1) / 2, F))
    s.mark("couch_spot", (-2.6, F))
    s.mark("tv_spot", (-0.15, F))
    s.mark("thermostat_spot", (0.55, F + 60 * IN))
    s.mark("panel_spot", (px1 + 0.75, F + 3.1))
    s.mark("equipment_spot", (3.15, F))
    s.mark("clock_spot", (clock_x, F + 4.55))
    s.mark("register", (register_x, ceil - 0.08))
    s.mark("window", (window_x, (wy0 + wy1) / 2))
    s.mark("front_step", (-4.3, F))
    s.set_z_index(Z_SET)
    s.parts["night_tint"].set_z_index(Z_SET + 0.3)
    return s


class CeilingHole(Prop):
    """A foot-sized hole punched through the attic floor's drywall and batts, seen in section: a dark gap with
    torn drywall edges and insulation fluff hanging into the room. Built at x between top_y (top of the batts) and
    bottom_y (underside of the drywall). Points: center, bottom. Method: burst()."""

    def __init__(self, x, top_y, bottom_y, width=0.55):
        super().__init__()
        w = width
        rng = np.random.default_rng(int(abs(x) * 100) + 3)
        jag = [P(x - w / 2 + w * t, bottom_y - rng.uniform(0.02, 0.12)) for t in np.linspace(0, 1, 7)]
        gap = Polygon(P(x - w / 2, top_y), P(x + w / 2, top_y), *reversed(jag)).set_fill("#3A3128", 1).set_stroke(INK, DETAIL_W)
        self.part("gap", gap)
        flaps = VGroup(Polygon(P(x - w / 2, bottom_y + 0.02), P(x - w / 2 - 0.12, bottom_y - 0.22), P(x - w / 2 + 0.12, bottom_y - 0.05)),
                       Polygon(P(x + w / 2, bottom_y + 0.02), P(x + w / 2 + 0.1, bottom_y - 0.18), P(x + w / 2 - 0.14, bottom_y - 0.04)))
        self.part("flaps", flaps.set_fill(WHITE, 1).set_stroke(INK, DETAIL_W))
        fluff = VGroup(*[VMobject().set_points_smoothly([P(x + dx, bottom_y - 0.02), P(x + dx + 0.04, bottom_y - 0.14 - 0.06 * k),
                                                          P(x + dx - 0.03, bottom_y - 0.24 - 0.05 * k)])
                         .set_stroke(INSULATION, 6) for k, dx in enumerate((-0.15, 0.02, 0.17))])
        self.part("fluff", fluff)
        self.mark("center", (x, (top_y + bottom_y) / 2))
        self.mark("bottom", (x, bottom_y))
        self.set_z_index(Z_SET + 0.5)

    def burst(self, run_time=0.15):
        from manim import GrowFromCenter
        from manim.utils.rate_functions import ease_out_back
        return GrowFromCenter(self, run_time=run_time, rate_func=ease_out_back)


# ================================================================ crawlspace
def crawlspace(floor_y=-4.0):
    """Crawlspace under a house: joist ceiling about 0.55 H over a dirt floor with a black vapour barrier,
    block piers on footings, foundation walls (access opening on the left, vent on the right), the room above.
    Anchors: entry, ceiling_y (a point on the joist bottoms; use .pt("ceiling_y")[1]), work_spot, floor_left,
    floor_right, register."""
    F = floor_y
    s = Prop()
    C = F + 0.55 * H
    jd = 9.25 * IN
    sub = C + jd
    room_floor = sub + 0.1
    xa, xb = X0 - BLEED, X1 + BLEED
    # the house above
    s.part("room", _fill(xa, room_floor, xb, Y1 + BLEED, WALL))
    s.part("floor_boards", VGroup(rect(xa, sub, xb, sub + 0.06, SHEATHING, DETAIL_W),
                                  rect(xa, sub + 0.06, xb, room_floor, WOOD, DETAIL_W)))
    s.part("baseboard", rect(xa, room_floor, xb, room_floor + 0.12, WHITE, DETAIL_W))
    wy0 = room_floor + 2.3
    s.part("window", VGroup(rect(-1.6, wy0, 0.2, wy0 + 2.4, WHITE, PROP_W),
                            seg((-0.7, wy0), (-0.7, wy0 + 2.4), w=DETAIL_W), seg((-1.6, wy0 + 1.2), (0.2, wy0 + 1.2), w=DETAIL_W),
                            rect(-1.75, wy0 - 0.1, 0.35, wy0, WHITE, DETAIL_W)))
    rx = 2.85
    s.part("register", VGroup(rect(rx - 0.3, room_floor, rx + 0.3, room_floor + 0.04, METAL, DETAIL_W)))
    # crawl air, dirt, footings, vapour barrier
    s.part("air", _fill(xa, F, xb, C, CONCRETE, 0.28))
    s.part("dirt", VGroup(_fill(xa, Y0 - BLEED, xb, F, DIRT), _pebbles(-4.0, 4.0, Y0 + 0.3, F - 0.5, 38, 7)))
    piers = [-1.3, 2.1]
    for i, px in enumerate(piers):
        s.part(f"footing_{i}", rect(px - 0.62, F - 0.4, px + 0.62, F, CONCRETE, PROP_W))
    wave = [P(x, F + 0.05 + 0.025 * np.sin(x * 7.3) + 0.015 * np.sin(x * 17.0)) for x in np.linspace(-4.1, 4.1, 60)]
    barrier = VMobject().set_points_smoothly(wave)
    barrier.add_line_to(P(4.1, F - 0.05))
    barrier.add_line_to(P(-4.1, F - 0.05))
    barrier.add_line_to(wave[0])
    s.part("vapor_barrier", VGroup(barrier.set_fill(VAPOR, 0.92).set_stroke(INK, DETAIL_W),
                                   *[seg((x, F - 0.02), (x + 0.16, F + 0.04), w=1.5, color=METAL_DARK)
                                     for x in (-3.4, -2.2, 0.0, 0.9, 3.0)]))
    # joists with batts (one sagging), piers with a short beam under the joists, register boot
    s.part("joists", _joists(-4.6, 4.7, sub, jd, sag=-2.5))
    s.part("boot", rect(rx - 0.25, C + 0.08, rx + 0.25, sub, METAL, DETAIL_W))
    for i, px in enumerate(piers):
        s.part(f"pier_{i}", VGroup(_blocks(px - 0.42, F, px + 0.42, C - 0.3),
                                   rect(px - 0.75, C - 0.3, px + 0.75, C, WOOD, PROP_W)))
    # foundation walls: access opening on the left, vent on the right
    wtop = sub
    ox0, oy0, oy1 = -4.05, F + 0.1, F + 1.45
    s.part("wall_left", VGroup(_blocks(xa, F - 0.4, ox0, oy0, unit=0.6), _blocks(xa, oy1, ox0, wtop, unit=0.6),
                               rect(ox0 - 0.06, oy0, ox0, oy1, WOOD, DETAIL_W)))
    s.part("wall_right", VGroup(_blocks(4.05, F - 0.4, xb, wtop, unit=0.6),
                                rect(4.05, C - 0.75, 4.5, C - 0.4, METAL_HI, DETAIL_W),
                                *[seg((4.1, y), (4.45, y), w=1.5) for y in np.arange(C - 0.7, C - 0.42, 0.06)]))
    s.mark("entry", (ox0 + 0.1, F))
    s.mark("ceiling_y", (0, C))
    s.mark("work_spot", (0.4, F))
    s.mark("floor_left", (-3.6, F))
    s.mark("floor_right", (3.6, F))
    s.mark("register", (rx, room_floor))
    s.set_z_index(Z_SET)
    return s


# ================================================================ rooftop
def rooftop(roof_y=-2.4):
    """Flat commercial roof: membrane over insulation and steel deck, bar joist and drop ceiling below, brick
    parapet with coping on the right, an equipment curb, an open roof hatch with its ladder, a vent stack and a
    distant skyline. Anchors: curb (top centre where a rooftop unit sits), hatch (top of the hatch opening),
    edge (roof surface at the parapet), parapet_top, ceiling."""
    R = roof_y
    s = Prop()
    xa, xb = X0 - BLEED, X1 + BLEED
    # sky: distant buildings and clouds
    sky = VGroup()
    for bx0, bx1, bh in ((-4.7, -3.5, 2.9), (-3.4, -2.4, 4.3), (-2.3, -0.9, 2.2), (-0.8, 0.4, 3.6),
                         (0.5, 1.9, 2.6), (2.0, 3.0, 4.6), (3.1, 4.7, 3.1)):
        sky.add(rect(bx0, R + 0.5, bx1, R + bh, METAL_HI, DETAIL_W, color=METAL))
        for wy in np.arange(R + 1.0, R + bh - 0.3, 0.55):
            for wx in np.arange(bx0 + 0.2, bx1 - 0.15, 0.35):
                sky.add(rect(wx, wy, wx + 0.14, wy + 0.22, WHITE, 0))
    sky.add(_cloud(-2.6, 5.6, 1.1), _cloud(1.0, 4.4, 0.7))
    s.part("sun", Circle(radius=0.6).move_to(P(2.9, 6.3)).set_fill(SPARK, 1).set_stroke(INK, PROP_W))
    s.part("skyline", sky)
    # building section under the roof
    deck = R - 0.48
    s.part("plenum", _fill(xa, R - 2.3, xb, deck, METAL_HI, 0.6))
    s.part("office", _fill(xa, Y0 - BLEED, xb, R - 2.3, WALL))
    s.part("ceiling", VGroup(rect(xa, R - 2.36, xb, R - 2.3, WHITE, DETAIL_W),
                             *[rect(x - 0.45, R - 2.36, x + 0.45, R - 2.32, METAL_HI, 1.5) for x in (-2.4, 0.8)]))
    s.part("ducts", VGroup(rect(0.9, R - 1.4, 1.8, deck, METAL, DETAIL_W), rect(2.2, R - 1.25, 3.2, deck, METAL, DETAIL_W)))
    tc, bc = R - 0.56, R - 1.55
    web = [P(x, tc if i % 2 == 0 else bc) for i, x in enumerate(np.arange(xa, xb + 0.5, 0.5))]
    s.part("bar_joist", VGroup(rect(xa, tc - 0.06, xb, tc, METAL_DARK, DETAIL_W), rect(xa, bc - 0.06, xb, bc, METAL_DARK, DETAIL_W),
                               VMobject().set_points_as_corners(web).set_stroke(METAL_DARK, 3)))
    corr = [P(x, deck + (0.08 if i % 2 else 0.0)) for i, x in enumerate(np.arange(xa, xb + 0.2, 0.14))]
    s.part("roof_deck", VGroup(_fill(xa, deck, xb, deck + 0.08, METAL), VMobject().set_points_as_corners(corr).set_stroke(INK, DETAIL_W),
                               rect(xa, deck + 0.08, xb, R - 0.06, OLD_UNIT, DETAIL_W),
                               *[seg((x, deck + 0.08), (x, R - 0.06), w=1.5, opacity=0.5) for x in np.arange(-4.0, 4.5, 1.2)],
                               rect(xa, R - 0.06, xb, R, METAL_HI, PROP_W)))
    # parapet on the right: brick wall up through the roof, coping cap, membrane turned up its face
    px0 = 4.05
    s.part("parapet", VGroup(_blocks(px0, Y0 - BLEED, xb, R + 1.0, course=0.18, unit=0.36, color=SIDING),
                             rect(px0 - 0.06, R + 1.0, xb, R + 1.1, METAL, DETAIL_W),
                             rect(px0 - 0.05, R, px0, R + 0.75, METAL_HI, DETAIL_W)))
    # equipment curb
    cx0, cx1, ch = 0.4, 3.6, 14 * IN
    s.part("curb", VGroup(rect(cx0, R, cx1, R + ch, METAL, PROP_W),
                          rect(cx0 + 0.08, R + ch - 0.12, cx1 - 0.08, R + ch - 0.04, WOOD, DETAIL_W),
                          Polygon(P(cx0 - 0.18, R), P(cx0, R), P(cx0, R + 0.18)).set_fill(METAL_HI, 1).set_stroke(INK, DETAIL_W),
                          Polygon(P(cx1 + 0.18, R), P(cx1, R), P(cx1, R + 0.18)).set_fill(METAL_HI, 1).set_stroke(INK, DETAIL_W)))
    # vent stack
    s.part("vent_stack", VGroup(rect(-1.1, R, -0.9, R + 0.5, ROOF, DETAIL_W), rect(-1.2, R, -0.8, R + 0.08, METAL_HI, DETAIL_W)))
    # roof hatch: curb box, lid propped open, ladder rails poking up, ladder down through the building
    hx0, hx1, hh = -3.7, -2.0, 0.75
    lad = VGroup()
    for lx in (hx0 + 0.45, hx1 - 0.45):
        lad.add(tube(np.array([P(lx, Y0 - 0.2), P(lx, R + hh + 0.75)]), 0.07, HARD_HAT))
    for y in np.arange(R - 0.3, Y0, -12 * IN):
        lad.add(seg((hx0 + 0.45, y), (hx1 - 0.45, y), w=PROP_W, color=INK))
    s.part("hatch_shaft", rect(hx0 + 0.15, R - 2.3, hx1 - 0.15, R, WALL, DETAIL_W))
    s.part("ladder", lad)
    lid = rect(0, -0.06, hx1 - hx0, 0.06, METAL, PROP_W).rotate(np.radians(100), about_point=P(0, 0)).shift(P(hx1, R + hh))
    s.part("hatch", VGroup(lid, seg((hx1, R + hh * 0.55), (hx1 - 0.33, R + hh + 0.9), w=3),
                           rect(hx0, R, hx1, R + hh, METAL, PROP_W),
                           rect(hx0 - 0.12, R, hx1 + 0.12, R + 0.16, METAL_HI, DETAIL_W),
                           rect(hx0 - 0.03, R + hh - 0.08, hx1 + 0.03, R + hh, METAL_DARK, DETAIL_W)))
    s.mark("curb", ((cx0 + cx1) / 2, R + ch))
    s.mark("hatch", ((hx0 + hx1) / 2, R + hh))
    s.mark("edge", (px0, R))
    s.mark("parapet_top", ((px0 + X1) / 2, R + 1.1))
    s.mark("ceiling", (0, R - 2.36))
    s.set_z_index(Z_SET)
    return s


# ================================================================ utility closet
def utility_closet(floor_y=-2.4):
    """Utility closet in section: back wall between a left wall (with the doorway and the door swung open into
    the hallway) and a right wall, a shelf, ceiling joists with insulation and the roof above, slab floor.
    Anchors: door (threshold), hall (hallway floor spot), equipment_spot, wall_mount, shelf, ceiling."""
    F = floor_y
    s = Prop()
    xa, xb = X0 - BLEED, X1 + BLEED
    ceil = F + 8 * 12 * IN
    lw0, lw1 = -2.15, -1.8       # left wall (doorway)
    rw0 = 4.1                    # right wall inner face
    door_h = 80 * IN
    # backgrounds: hallway wall, closet back wall, attic, ground
    s.part("hall_wall", _fill(xa, F, lw0, ceil, WALL))
    s.part("back_wall", _fill(lw0, F, rw0, ceil, CLOSET_WALL))  # also seen through the doorway
    s.part("attic", _fill(xa, ceil + 0.5, xb, Y1 + BLEED, WOOD, 0.16))
    s.part("roof", Polygon(P(xa, ceil + 1.6), P(xb, ceil + 4.4), P(xb, Y1 + BLEED), P(xa, Y1 + BLEED)).set_fill(WHITE, 1).set_stroke(width=0))
    s.part("rafter", Polygon(P(xa, ceil + 1.6), P(xb, ceil + 4.4), P(xb, ceil + 4.05), P(xa, ceil + 1.25)).set_fill(WOOD, 1).set_stroke(INK, PROP_W))
    s.part("roof_deck", Polygon(P(xa, ceil + 1.6), P(xb, ceil + 4.4), P(xb, ceil + 4.6), P(xa, ceil + 1.8)).set_fill(ROOF, 1).set_stroke(INK, PROP_W))
    s.part("ground", VGroup(_fill(xa, Y0 - BLEED, xb, F - 0.9, DIRT), _pebbles(-4.2, 4.2, Y0 + 0.3, F - 1.3, 30, 3),
                            rect(xa, F - 0.9, xb, F - 0.45, mix(CONCRETE, INK, 0.15), DETAIL_W),
                            rect(xa, F - 0.45, xb, F, CONCRETE, PROP_W)))
    s.part("hall_floor", rect(xa, F - 0.05, lw0, F, WOOD, DETAIL_W))
    s.part("baseboards", VGroup(rect(xa, F, lw0, F + 0.14, WHITE, DETAIL_W), rect(lw1, F, rw0, F + 0.14, WHITE, DETAIL_W)))
    # ceiling: drywall + joists + batts
    s.part("ceiling", VGroup(rect(xa, ceil, xb, ceil + 0.05, WHITE, DETAIL_W), _joists(-4.6, 4.7, ceil + 0.45, 0.4)))
    # walls in section: left wall only above the doorway (header), right wall full height
    s.part("left_wall", VGroup(rect(lw0, F + door_h + 0.1, lw1, ceil, WALL, PROP_W),
                               rect(lw0 - 0.05, F + door_h, lw1 + 0.05, F + door_h + 0.1, WOOD, DETAIL_W)))
    s.part("right_wall", rect(rw0, F, xb, ceil, WALL, PROP_W))
    # the door, opened 90 degrees into the hallway (seen face-on), hinged at the doorway
    dx0, dx1 = lw0 - 32 * IN, lw0 - 0.04
    panels = VGroup(*[rect(dx0 + 0.25, y0, dx1 - 0.25, y1, None, DETAIL_W)
                      for y0, y1 in ((F + 0.4, F + 2.2), (F + 2.65, F + door_h - 0.35))])
    knob = VGroup(rect(dx0 + 0.12, F + 2.33, dx0 + 0.3, F + 2.4, METAL, 1.5, r=0.02))
    s.part("door", VGroup(rect(dx0, F + 0.04, dx1, F + door_h - 0.04, WHITE, PROP_W), panels, knob))
    s.part("casing", VGroup(rect(lw0 - 0.08, F, lw0, F + door_h + 0.12, WHITE, DETAIL_W),
                            rect(lw1, F, lw1 + 0.08, F + door_h + 0.12, WHITE, DETAIL_W),
                            rect(lw0, F, lw1, F + 0.03, WOOD, 1.5)))
    s.part("switch", rect(dx0 - 0.25, F + 2.9, dx0 - 0.1, F + 3.15, WHITE, DETAIL_W, r=0.02))
    # shelf with a filter box and a paint can
    sy, sx0 = F + 4.4, 2.3
    s.part("shelf", VGroup(rect(sx0, sy - 0.07, rw0, sy, WOOD, PROP_W),
                           *[Polygon(P(x, sy - 0.07), P(x + 0.04, sy - 0.07), P(x + 0.04, sy - 0.4)).set_fill(METAL_DARK, 1).set_stroke(INK, 1.5)
                             for x in (sx0 + 0.25, rw0 - 0.35)],
                           rect(sx0 + 0.15, sy, sx0 + 1.05, sy + 0.62, OLD_UNIT, DETAIL_W),
                           seg((sx0 + 0.15, sy + 0.5), (sx0 + 1.05, sy + 0.5), w=1.5),
                           rect(rw0 - 0.6, sy, rw0 - 0.2, sy + 0.42, METAL, DETAIL_W),
                           rect(rw0 - 0.62, sy + 0.36, rw0 - 0.18, sy + 0.42, METAL_DARK, 1.5)))
    s.mark("door", ((lw0 + lw1) / 2, F))
    s.mark("hall", (-3.2, F))
    s.mark("equipment_spot", (0.9, F))
    s.mark("wall_mount", (3.2, F + 2.6))
    s.mark("shelf", (3.2, sy))
    s.mark("ceiling", (0.9, ceil))
    s.set_z_index(Z_SET)
    return s
