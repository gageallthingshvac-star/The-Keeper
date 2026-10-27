"""Backgrounds (skill doc section 9). Each set is a Prop at z Z_SET with named anchor points.

house_side and driveway here; attic, crawlspace, rooftop and utility_closet live in sets_more.py.
"""
import random

import numpy as np
from manim import Polygon, Rectangle, VGroup

from . import style as S
from .style import P
from .props.base import Prop, line


def house_side(ground_y=-2.2, wall_x=-3.35, pad=None, window=True):
    """Side of the house on the left, yard ground across the frame, concrete pad for the unit.
    pad=(x0, x1). Anchors: ground, wall_face, disconnect_mount, pad_center (top of pad), pad_left, pad_right,
    supply_entry, return_entry, lv_entry, window, sky."""
    s = Prop()
    left = -4.8
    wall_top = ground_y + 7.4
    s.part("wall", Rectangle(width=wall_x - left, height=wall_top - ground_y).move_to(P((left + wall_x) / 2, (ground_y + wall_top) / 2))
           .set_fill(S.WALL, 1).set_stroke(S.INK, 6))
    s.part("siding", VGroup(*[line((left, y), (wall_x, y), 2, S.SIDING) for y in np.arange(ground_y + 0.5, wall_top, 0.5)]))
    s.part("roof", Polygon(P(left, wall_top), P(wall_x + 0.45, wall_top), P(wall_x + 0.45, wall_top + 0.35), P(left, wall_top + 1.7))
           .set_fill(S.ROOF, 1).set_stroke(S.INK, 5))
    if window:
        wx, wy = (left + wall_x) / 2 + 0.25, ground_y + 5.0
        s.part("window", VGroup(Rectangle(width=0.85, height=1.15).move_to(P(wx, wy)).set_fill("#DDEBF5", 1).set_stroke(S.INK, 5),
                                line((wx, wy - 0.57), (wx, wy + 0.57), 3), line((wx - 0.42, wy), (wx + 0.42, wy), 3)))
        s.mark("window", (wx, wy))
    s.part("ground", line((-4.8, ground_y), (4.8, ground_y), 6))
    rng = random.Random(5)
    tufts = VGroup()
    for _ in range(12):
        x = rng.uniform(wall_x + 0.2, 4.3)
        y = ground_y if rng.random() < 0.5 else rng.uniform(ground_y - 1.8, ground_y - 0.3)
        tufts.add(VGroup(line((x, y), (x - 0.09, y + 0.18), 3, S.GRASS), line((x, y), (x, y + 0.22), 3, S.GRASS),
                         line((x, y), (x + 0.09, y + 0.18), 3, S.GRASS)))
    s.part("tufts", tufts)
    if pad is not None:
        x0, x1 = pad
        s.part("pad", Rectangle(width=x1 - x0, height=0.13).move_to(P((x0 + x1) / 2, ground_y + 0.065)).set_fill(S.CONCRETE, 1).set_stroke(S.INK, 4))
        s.mark("pad_center", ((x0 + x1) / 2, ground_y + 0.13))
        s.mark("pad_left", (x0, ground_y + 0.13))
        s.mark("pad_right", (x1, ground_y + 0.13))
    s.mark("ground", (0, ground_y))
    s.mark("wall_face", (wall_x, ground_y + 2.0))
    s.mark("disconnect_mount", (wall_x - 0.62, ground_y + 3.3))
    s.mark("sky", (0.5, ground_y + 6.5))
    s.ground_y, s.wall_x = ground_y, wall_x
    s.set_z_index(S.Z_SET)
    return s


def driveway(street_y=-7.6, curb_y=-4.5, lawn_from=-2.2):
    """Street along the bottom of the frame with a curb and a strip of lawn up to the yard.
    Anchors: street, curb, truck_front (where a truck's front bumper stops), lawn."""
    s = Prop()
    s.part("street", line((-4.8, street_y), (4.8, street_y), 6))
    s.part("curb", line((-4.8, curb_y), (4.8, curb_y), 3, "#BBBBBB"))
    rng = random.Random(9)
    s.part("tufts", VGroup(*[VGroup(line((x, y), (x - 0.08, y + 0.16), 3, S.GRASS), line((x, y), (x + 0.08, y + 0.16), 3, S.GRASS))
                             for x, y in [(rng.uniform(-4.2, 4.2), rng.uniform(curb_y + 0.3, lawn_from - 0.4)) for _ in range(6)]]))
    s.mark("street", (0, street_y))
    s.mark("curb", (0, curb_y))
    s.mark("truck_front", (-3.95, street_y))
    s.mark("lawn", (0, (curb_y + lawn_from) / 2))
    s.street_y, s.curb_y = street_y, curb_y
    s.set_z_index(S.Z_SET)
    return s


try:
    from .sets_more import *  # noqa: F401,F403
except ImportError:
    pass
except Exception as exc:  # a broken optional extra must not take the core library down with it
    import warnings
    warnings.warn(f"stickworld: could not load sets_more: {exc!r}")
