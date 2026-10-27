"""Tools (skill doc section 9). ToolBag and Drill here; the rest of the kit lives in tools_more.py."""
import numpy as np
from manim import Arc, PI, Rectangle, RoundedRectangle, Text, VGroup

from .. import style as S
from ..style import P
from .base import Prop, line


class ToolBag(Prop):
    """Black tool bag with a red band and a (deliberately garbled) brand. Built hanging from its handle top.
    Points: handle, opening, center."""

    def __init__(self, handle_top, brand="MILWACKO", scale=1.0):
        super().__init__()
        w, h = 1.15 * scale, 0.6 * scale
        box = RoundedRectangle(width=w, height=h, corner_radius=0.09).set_fill("#1E1E1E", 1).set_stroke(S.INK, 4)
        band = Rectangle(width=w - 0.02, height=0.24 * scale).move_to(box).set_fill(S.TOOL_RED, 1).set_stroke(width=0)
        logo = Text(brand, font="DejaVu Sans", weight="BOLD", slant="ITALIC").set(width=w * 0.82).move_to(band).set_fill(S.WHITE)
        handle = Arc(radius=0.24 * scale, start_angle=0, angle=PI).set_stroke(S.INK, 6).next_to(box, np.array([0, 1, 0]), buff=-0.02)
        for name, m in (("box", box), ("band", band), ("logo", logo), ("handle", handle)):
            self.part(name, m)
        self.mark("handle", handle.get_top() + np.array([0, -0.03, 0]))
        self.mark("opening", box.get_top() + np.array([0, -0.08, 0]))
        self.mark("center", box.get_center())
        self.shift(P(*handle_top[:2]) - handle.get_top())
        self.set_z_index(S.Z_HELD)


class Drill(Prop):
    """Cordless drill, pistol grip. Built with its grip at `grip`, pointing toward `face` (+1 right / -1 left).
    Points: grip, tip."""

    TIP = np.array([0.62, 0.09, 0])

    def __init__(self, grip, face=1, scale=1.0):
        super().__init__()
        k = scale
        self.part("grip", Rectangle(width=0.13 * k, height=0.32 * k).move_to(P(-0.02 * k, -0.13 * k)).set_fill("#222222", 1).set_stroke(S.INK, 3))
        self.part("battery", Rectangle(width=0.3 * k, height=0.11 * k).move_to(P(0.0, -0.34 * k)).set_fill(S.TOOL_RED, 1).set_stroke(S.INK, 3))
        self.part("barrel", RoundedRectangle(width=0.55 * k, height=0.19 * k, corner_radius=0.06 * k).move_to(P(0.1 * k, 0.09 * k))
                  .set_fill(S.TOOL_RED, 1).set_stroke(S.INK, 3))
        self.part("chuck", Rectangle(width=0.1 * k, height=0.11 * k).move_to(P(0.42 * k, 0.09 * k)).set_fill("#666666", 1).set_stroke(S.INK, 2))
        self.part("bit", line((0.47 * k, 0.09 * k), (0.62 * k, 0.09 * k), 3, "#888888"))
        self.mark("grip", (0, 0))
        self.mark("tip", (0.62 * k, 0.09 * k))
        if face < 0:
            self.stretch(-1, 0, about_point=np.zeros(3))
        self.tip_offset = np.array([0.62 * k * face, 0.09 * k, 0])
        self.shift(P(*grip[:2]))
        self.set_z_index(S.Z_HELD + 0.1)


# the rest of the kit (screwdriver, multimeter, gauges, recovery machine, tank, level, dolly, ladder, flashlight,
# mastic) lives in tools_more.py
try:
    from .tools_more import *  # noqa: F401,F403
except ImportError:
    pass
except Exception as exc:  # a broken optional extra must not take the core library down with it
    import warnings
    warnings.warn(f"stickworld: could not load tools_more: {exc!r}")
