"""Prop base class and attachment helpers.

A Prop is a VGroup with named sub-parts (self.parts) and named points (self.pt(name)). Named points are
invisible marker dots inside the group, so they move, scale and rotate with the prop and actions can always
target them (grip points, connection points, screw holes, terminals...).

Attachments keep one mobject glued to a moving point every frame:
- connect(child, "child_point", parent, "parent_point"): stays attached until disconnect(child).
- figures holding things use StickFigure.grab / release (see actions.py), built on attach_to().
"""
import numpy as np
from manim import Dot, Line, VGroup, VMobject

from ..style import DETAIL_W, INK, PROP_W, P


class Prop(VGroup):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.parts = {}
        self._points = {}

    # ------------------------------------------------------------ building
    def part(self, name, mob):
        self.parts[name] = mob
        self.add(mob)
        return mob

    def mark(self, name, p):
        """Add a named point at p (in current coordinates); it moves with the prop from now on."""
        d = Dot(P(p[0], p[1]), radius=0.001).set_fill(opacity=0).set_stroke(width=0)
        d.is_marker = True
        self._points[name] = d
        self.add(d)
        return d

    def pt(self, name):
        return self._points[name].get_center()

    def has_pt(self, name):
        return name in self._points

    def point_names(self):
        return list(self._points)

    # ------------------------------------------------------------ styling helpers
    def set_z(self, z):
        self.set_z_index(z)
        return self


def outline(mob, color=INK, width=PROP_W):
    return mob.set_stroke(color, width)


def line(p, q, w=DETAIL_W, color=INK):
    return Line(P(*p[:2]), P(*q[:2]), stroke_width=w, color=color)


def poly(points, w=DETAIL_W, color=INK):
    return VMobject().set_points_as_corners([P(*p[:2]) for p in points]).set_stroke(color, w)


# ---------------------------------------------------------------- attachments
def attach_to(mob, mob_point, target_fn, rotate_fn=None, name="attach"):
    """Every frame, move mob so its named point (or a callable returning a point) sits on target_fn().
    rotate_fn() -> absolute angle to hold the mob at (radians), relative to its angle when attached."""
    detach(mob)
    get_mp = mob_point if callable(mob_point) else (lambda: mob.pt(mob_point))
    state = {"angle": 0.0}

    def follow(m):
        if rotate_fn is not None:
            ang = rotate_fn()
            m.rotate(ang - state["angle"], about_point=get_mp())
            state["angle"] = ang
        m.shift(target_fn() - get_mp())

    follow.attach_name = name
    mob.add_updater(follow)
    mob._attachment = follow
    follow(mob)
    return follow


def detach(mob):
    f = getattr(mob, "_attachment", None)
    if f is not None:
        mob.remove_updater(f)
        mob._attachment = None


def connect(child, child_point, parent, parent_point):
    """Keep child's named point on parent's named point until disconnect(child)."""
    return attach_to(child, child_point, lambda: parent.pt(parent_point), name="connect")


def disconnect(child):
    detach(child)


def is_attached(mob):
    return getattr(mob, "_attachment", None) is not None
