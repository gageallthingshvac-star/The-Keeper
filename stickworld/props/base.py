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


# ---------------------------------------------------------------- loads made of several props
class Bundle(Prop):
    """Several props moving as one rigid load (an air handler standing on a hand truck). Add the bundle to the
    scene instead of its props. pt(name) finds the named point in the bundle's props (first match), or
    pt("prop_index.name") / pt((prop, name)) to pick one. Use unbundle() to hand a prop back to the scene."""

    def __init__(self, *props, **kwargs):
        super().__init__(**kwargs)
        self.members = list(props)
        for p in props:
            self.add(p)

    def pt(self, name):
        if isinstance(name, tuple):
            return name[0].pt(name[1])
        if name in self._points:
            return self._points[name].get_center()
        for p in self.members:
            if p.has_pt(name):
                return p.pt(name)
        raise KeyError(name)

    def has_pt(self, name):
        return name in self._points or any(p.has_pt(name) for p in self.members)


def bundle(*props):
    return Bundle(*props)


def unbundle(scene, b, prop):
    """Take prop out of bundle b and put it back in the scene on its own, where it is now."""
    b.remove(prop)
    b.members.remove(prop)
    scene.add(prop)
    return prop


def ride(mob, point, path, angle=None, progress=None):
    """Drive mob along a path with a progress tracker: every frame its named point (or callable) sits on
    path(s) and it is turned to angle(s) radians (relative to how it is now), s = progress value (0..1 by
    convention). Animate the returned ValueTracker (or pass your own) — e.g. a rope haul feeds it.
    Stop with detach(mob)."""
    from manim import ValueTracker
    progress = progress if progress is not None else ValueTracker(0.0)
    attach_to(mob, point, lambda: np.array([*path(progress.get_value())[:2], 0.0], dtype=float),
              rotate_fn=(lambda: float(angle(progress.get_value()))) if angle is not None else None, name="ride")
    return progress


def turn_about(mob, angle, point, run_time=0.5, rate_func=None):
    """Rotate mob by angle (radians, + = counter-clockwise) about one of its named points or a fixed (x, y): tip a
    hand truck back onto its wheels, lay something down."""
    from manim import UpdateFromAlphaFunc, smooth
    st = {"a": 0.0}

    def upd(m, a):
        piv = m.pt(point) if isinstance(point, str) else np.array([point[0], point[1], 0.0])
        m.rotate(angle * a - st["a"], about_point=piv)
        st["a"] = angle * a

    return UpdateFromAlphaFunc(mob, upd, run_time=run_time, rate_func=rate_func or smooth)


def ground_shadow(mob, ground_y, width=None, height=0.14, fade=0.9, span=None):
    """Soft contact shadow on the floor at ground_y under a prop, following it every frame; it shrinks and fades as
    the prop leaves the floor (lifted, thrown, sliding away down a ladder). span=(x0, x1): only where that floor
    exists (not over a hatch opening). Add the returned mobject to the scene."""
    from manim import Ellipse, always_redraw
    from ..style import INK, SHADOW_OPACITY, Z_SET

    def build():
        lo, hi = mob.get_bottom()[1], mob.get_top()[1]
        gap = abs(lo - ground_y)
        k = float(np.clip(1.0 - gap / fade, 0.0, 1.0))
        cx = mob.get_center()[0]
        if span is not None and not (span[0] <= cx <= span[1]):
            k = 0.0
        w = (width or mob.width * 1.05) * (0.75 + 0.25 * k)
        e = Ellipse(width=max(w, 0.01), height=height).move_to(np.array([mob.get_center()[0], ground_y, 0.0]))
        return e.set_fill(INK, SHADOW_OPACITY * k).set_stroke(width=0).set_z_index(Z_SET + 0.6)

    return always_redraw(build)