"""Vehicles (skill doc section 9): the work truck, side view, facing left. No lettering unless asked."""
import numpy as np
from manim import (Circle, Difference, Polygon, Rectangle, RoundedRectangle, Succession, UpdateFromAlphaFunc, VGroup,
                   linear, there_and_back)
from manim.utils.rate_functions import ease_out_cubic

from .. import style as S
from ..style import P
from .base import Prop, line
from . import effects as FX


class WorkTruck(Prop):
    """Pickup facing left with its front bumper at front_x and tyres on street_y.
    Points: driver_seat, passenger_seat (hip positions), door_step (ground beside the door), bed_center, bed_floor,
    bed_rail, tailgate, exhaust. Methods: drive_in(dx, riders), open_door(), close_door(), bounce(), exhaust_puff()."""

    LENGTH = 8.3

    def __init__(self, front_x, street_y, colour=S.WHITE):
        super().__init__()
        x0, g = front_x, street_y
        wr = 0.55
        body_y0 = g + 0.6
        hood_top, cab_top, rail = g + 1.85, g + 3.15, g + 2.1
        cab_x0, cab_x1 = x0 + 1.25, x0 + 3.65
        bed_x1 = x0 + self.LENGTH
        front = Polygon(P(x0, body_y0), P(x0, hood_top - 0.1), P(x0 + 0.15, hood_top), P(cab_x0, hood_top + 0.05),
                        P(cab_x0 + 0.65, cab_top), P(cab_x1, cab_top), P(cab_x1, body_y0))
        window = Polygon(P(cab_x0 + 0.38, hood_top + 0.2), P(cab_x0 + 0.85, cab_top - 0.18), P(cab_x1 - 0.15, cab_top - 0.18),
                         P(cab_x1 - 0.15, hood_top + 0.2))
        self.part("bed", Rectangle(width=bed_x1 - cab_x1 - 0.05, height=rail - body_y0).move_to(P((cab_x1 + 0.05 + bed_x1) / 2, (rail + body_y0) / 2))
                  .set_fill(colour, 1).set_stroke(S.INK, S.PROP_W + 1))
        self.part("cab", Difference(front, window).set_fill(colour, 1).set_stroke(S.INK, S.PROP_W + 1))
        self.part("window_frame", window.copy().set_fill(opacity=0).set_stroke(S.INK, 5))
        door_x0, door_x1 = cab_x0 + 0.3, cab_x1 - 0.1
        self.part("door_opening", Rectangle(width=door_x1 - door_x0, height=hood_top + 0.15 - body_y0 - 0.12)
                  .move_to(P((door_x0 + door_x1) / 2, (hood_top + 0.15 + body_y0 + 0.12) / 2)).set_fill("#2B2B2B", 1).set_stroke(S.INK, 3).set_opacity(0))
        door = VGroup(Rectangle(width=door_x1 - door_x0, height=hood_top + 0.15 - body_y0 - 0.12)
                      .move_to(P((door_x0 + door_x1) / 2, (hood_top + 0.15 + body_y0 + 0.12) / 2)).set_fill(colour, 1).set_stroke(S.INK, 4),
                      line((door_x1 - 0.55, hood_top - 0.25), (door_x1 - 0.25, hood_top - 0.25), 5))
        self.part("door", door)
        self._door_open = False
        self.part("rack", VGroup(line((cab_x1 + 0.3, rail), (cab_x1 + 0.3, cab_top - 0.25), 6), line((bed_x1 - 0.3, rail), (bed_x1 - 0.3, cab_top - 0.25), 6),
                                 line((cab_x1 + 0.3, cab_top - 0.25), (bed_x1 - 0.3, cab_top - 0.25), 6)))
        self.part("light", Circle(radius=0.15).move_to(P(x0 + 0.12, hood_top - 0.4)).set_fill(S.SPARK, 1).set_stroke(S.INK, 3))
        self.part("bumper", RoundedRectangle(width=0.35, height=0.42, corner_radius=0.06).move_to(P(x0 - 0.05, body_y0 + 0.15)).set_fill(S.INK, 1))
        # dark frame/running board between the wheels (also hides the riders' legs)
        self.part("chassis", Rectangle(width=bed_x1 - x0 - 1.2, height=0.42).move_to(P((x0 + 0.6 + bed_x1 - 0.6) / 2, body_y0 - 0.15))
                  .set_fill("#2E2E2E", 1).set_stroke(S.INK, 3))
        self.part("exhaust_pipe", Rectangle(width=0.35, height=0.09).move_to(P(bed_x1 + 0.1, body_y0 + 0.05)).set_fill("#555555", 1).set_stroke(S.INK, 2))
        wheels = VGroup()
        for wx in (x0 + 1.0, bed_x1 - 1.25):
            c = P(wx, g + wr)
            hub = VGroup(Circle(radius=0.21).move_to(c).set_fill("#CCCCCC", 1).set_stroke(S.INK, 2),
                         *[line(c, c + 0.17 * P(np.cos(t), np.sin(t)), 4, "#555555") for t in (np.pi / 2, np.pi / 2 + 2.094, np.pi / 2 + 4.189)])
            wheels.add(VGroup(Circle(radius=wr).move_to(c).set_fill(S.INK, 1).set_stroke(S.INK, 2), hub))
        self.part("wheels", wheels)
        self.mark("door_hinge", (door_x0, (body_y0 + hood_top) / 2))
        self.mark("driver_seat", (cab_x0 + 0.95, g + 0.75))
        self.mark("passenger_seat", (cab_x0 + 1.75, g + 0.75))
        self.mark("door_step", ((door_x0 + door_x1) / 2, g))
        self.mark("bed_center", ((cab_x1 + bed_x1) / 2, rail))
        self.mark("bed_floor", ((cab_x1 + bed_x1) / 2, body_y0 + 0.35))
        self.mark("bed_rail", ((cab_x1 + bed_x1) / 2, rail))
        self.mark("tailgate", (bed_x1, rail))
        self.mark("exhaust", (bed_x1 + 0.3, body_y0 + 0.05))
        self.street_y = g
        self.set_z_index(S.Z_TRUCK)
        self.parts["door_opening"].set_z_index(S.Z_TRUCK + 0.05)
        self.parts["door"].set_z_index(S.Z_TRUCK + 0.2)

    def body(self):
        return VGroup(*[m for k, m in self.parts.items() if k != "wheels"])

    def drive_in(self, dx, run_time=1.4, riders=(), rate_func=ease_out_cubic):
        """Roll in by dx (negative = to the left); wheels turn by exactly the distance covered; riders move along."""
        st = {}

        def update(m, a):
            if "start" not in st:
                st["start"] = m.copy()
                st["riders"] = [(f, f.v("x")) for f in riders]
            e = rate_func(a)
            m.become(st["start"].copy().shift(np.array([dx * e, 0, 0])))
            for wheel in m.parts["wheels"]:
                hub = wheel[1]
                hub.rotate(-dx * e / 0.55, about_point=wheel[0].get_center())
            for f, x0 in st["riders"]:
                f.set(x=x0 + dx * e)

        puff = FX.smoke(self.pt("exhaust") + np.array([dx, 0, 0]), n=3, r=0.15, rise=0.5, run_time=0.9, seed=5)
        return Succession(UpdateFromAlphaFunc(self, update, run_time=run_time, rate_func=linear), self.bounce(riders), puff)

    def bounce(self, riders=(), depth=0.16, run_time=0.32):
        st = {}

        def update(m, a):
            if "start" not in st:
                st["start"] = m.copy()
                st["riders"] = [(f, f.v("y")) for f in riders]
            d = -depth * there_and_back(a)
            m.become(st["start"].copy())
            m.body().shift(np.array([0, d, 0]))
            for f, y0 in st["riders"]:
                f.set(y=y0 + d)

        return UpdateFromAlphaFunc(self, update, run_time=run_time, rate_func=linear)

    def open_door(self, run_time=0.25):
        door, hole = self.parts["door"], self.parts["door_opening"]
        st = {}

        def update(m, a):
            if "start" not in st:
                st["start"], st["hinge"] = m.copy(), self.pt("door_hinge")
            m.become(st["start"].copy().stretch(1 - 0.78 * a, 0, about_point=st["hinge"]))
            hole.set_opacity(a)
            hole.set_stroke(opacity=a)

        return UpdateFromAlphaFunc(door, update, run_time=run_time, rate_func=ease_out_cubic)

    def close_door(self, run_time=0.2):
        door, hole = self.parts["door"], self.parts["door_opening"]
        st = {}

        def update(m, a):
            if "start" not in st:
                st["start"], st["hinge"] = m.copy(), self.pt("door_hinge")
                st["w0"] = m.width
                st["full"] = hole.width
            m.become(st["start"].copy().stretch((st["w0"] + (st["full"] - st["w0"]) * a) / st["w0"], 0, about_point=st["hinge"]))
            hole.set_opacity(1 - a)
            hole.set_stroke(opacity=1 - a)

        return UpdateFromAlphaFunc(door, update, run_time=run_time, rate_func=linear)

    def exhaust_puff(self):
        return FX.smoke(self.pt("exhaust"), n=3, r=0.15, rise=0.5, run_time=0.9, seed=6)
