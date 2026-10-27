"""Exercise every character action, expression, prop and set in the library (skill doc section 2).

    manim -ql -r 540,960 stickworld/test_scene.py StickWorldTest
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from manim import FadeIn, FadeOut, PI, Succession, ValueTracker, VGroup, Wait, linear

from stickworld import camera
from stickworld import style as S
from stickworld.actions import POSES, Do, carry_together
from stickworld.audio import Snd
from stickworld.episode import EpisodeScene
from stickworld.face import EXPRESSIONS
from stickworld.props import effects as FX
from stickworld.props import hvac, tools
from stickworld.props.hvac import Disconnect, Duct, FlashingPanel, HighVoltageWhip, LowVoltageWire, PackageUnit, Screw
from stickworld.props.tools import Drill, ToolBag
from stickworld.props.vehicles import WorkTruck
from stickworld.rig import StickFigure
from stickworld.sets import driveway, house_side
from stickworld.style import P

G = -0.4


class StickWorldTest(EpisodeScene):
    TIMING = {}
    MUSIC = None

    def construct(self):
        house = house_side(G, -3.35, pad=(-2.05, 1.85))
        drive = driveway(-5.8, -2.7, G)
        self.add(house, drive)
        a = StickFigure(x=-2.4, ground=G, face_dir=1, name="lead")
        b = StickFigure(x=2.6, ground=G, face_dir=-1, accessory="cap", name="rookie")
        c = StickFigure(x=0.2, ground=-4.2, face_dir=1, accessory="hard_hat", name="gc")
        d = StickFigure(x=-1.5, ground=-4.2, face_dir=-1, accessory="hair_tuft", name="owner")
        self.add(a, b, c, d)

        with self.block("poses"):
            for name in POSES:
                if name != "sit":
                    self.play(a.pose(name, 0.25), b.pose(name, 0.25))
            self.play(a.pose("stand", 0.25), b.pose("stand", 0.25))

        with self.block("face"):
            for name in EXPRESSIONS:
                self.play(a.expression(name, 0.15), b.expression(name, 0.15), c.expression(name, 0.15), d.expression(name, 0.15))
                self.wait(0.15)
            self.play(a.expression("neutral"), b.expression("neutral"), c.expression("neutral"), d.expression("neutral"))
            self.play(a.shake_head(3, slow=True, eyes_closed=True), b.nod(2), c.blink(), d.look_at(P(4, 4)))
            self.play(a.talk(1.0), b.face.turn_to(0.9), c.turn(-1), d.turn(1))

        with self.block("locomotion"):
            self.play(c.walk_to(2.0), d.run_to(-3.6))
            self.play(c.step_back(0.6), d.walk_to(-2.2, face=1, run_time=1.0))  # walking backward
            self.play(a.walk_to(-1.2, G - 1.0), b.walk_to(3.2, G))

        with self.block("holding"):
            bag = ToolBag(P(-0.4, G - 1.5))
            self.add(bag)
            self.play(a.grab(bag, "R", "handle"))
            self.play(a.walk_to(-2.8, G, hold=("R",)))
            self.play(a.release(bag, "drop", ground=G - 0.6))
            drill = Drill(a.hand("R"), 1)
            self.add(drill)
            self.play(a.grab(drill, "R", "grip", rotate=True))
            self.play(a.pose("reach_up", 0.4), a.pose("stand", 0.4))
            self.play(a.release(drill, "throw", target=P(1.0, G - 1.6), spin=2 * PI))
            spare = Duct(1.0, 2.6, -3.9, 0.5)
            self.add(spare)
            self.play(c.walk_to(1.8, -4.2, face=-1))
            self.play(c.lift(spare))
            self.play(c.release(spare, "place", target=P(2.4, -3.4), sides=("L", "R")))

        unit = PackageUnit(-0.1, G + 0.13, old=True)
        x0 = unit.bounds[0]
        duct = Duct(-3.35, x0 - 0.1, unit.pt("supply_open")[1])
        flash = FlashingPanel(-3.35, x0 - 0.05, unit.pt("return_open")[1] - 0.38, unit.pt("supply_open")[1] + 0.31, "side")
        top = FlashingPanel(-3.35, x0 - 0.05, unit.pt("supply_open")[1] + 0.31, unit.pt("supply_open")[1] + 0.51, "top")
        screw = Screw(P(x0 - 0.35, unit.pt("supply_open")[1] + 0.41))
        disc = Disconnect(house.pt("disconnect_mount"))
        whip = HighVoltageWhip(disc.pt("whip_out"), unit.pt("whip_terminal"), (0, -1.6), (-1.6, -0.2))
        lv = LowVoltageWire((-3.35, G + 0.25), unit.pt("lv_terminal"), (0.9, -0.05), (-1.0, -0.4))
        self.add(duct, flash, top, screw, unit, disc, whip.mob, whip.end, lv.mob, lv.end)
        whip.connect_end(lambda: unit.pt("whip_terminal"))
        lv.connect_end(lambda: unit.pt("lv_terminal"))

        with self.block("hvac"):
            self.play(a.walk_to(-2.9, G, face=-1), b.walk_to(3.0, G))
            self.play(a.push_switch(disc, False), Snd("clunk"))
            self.play(screw.back_out(), Snd("drill", 0.4))
            self.play(screw.fly_off(P(2, 9)))
            self.play(screw.fly_in(), screw.drive_in())
            self.play(a.walk_to(-2.6, G, face=1))
            self.play(a.reach("R", lambda: top.pt("free_end")))
            self.play(top.peel_to(0.6, 0.6), a.walk_to(-3.5, G, face=1, hands={"R": lambda: top.pt("free_end")}, run_time=0.6))
            self.play(Do(lambda: a.bake_arm("R")))
            self.play(top.peel_to(1.0, 0.3), flash.peel_to(1.0, 0.6))
            self.play(top.peel_to(0.0, 0.5), flash.peel_to(0.0, 0.5))
            self.play(a.walk_to(-2.85, G, face=1))
            self.play(a.yank_plug(duct, unit.pt("foot_spot"), stumble=0.8, stumble_y=-1.0))
            self.play(a.release(duct, "throw", target=P(-3.4, G - 2.2), sides=("L", "R")))
            self.play(b.walk_to(0.9, G, face=-1), b.pose({"drop": 0.7, "spine": 0.5}))
            self.play(b.reach("R", unit.pt("whip_terminal") + P(0.1, 0.05)))
            self.play(b.zapped(source=unit.pt("whip_terminal")))
            self.play(b.hair_down(0.4), b.flinch())
            self.play(b.pose("stand"), b.walk_to(3.0, G))
            self.play(a.walk_to(-1.35, G, face=1), a.pose({"drop": 0.8, "spine": 0.55}))
            self.play(a.reach("R", (unit.pt("whip_terminal") + unit.pt("lv_terminal")) / 2, lean=False))
            whip.connect_end(lambda: a.hand("R"))
            lv.connect_end(lambda: a.hand("R"))
            self.play(a.pose({"drop": 0.0, "spine": -0.4}, 0.25), a.reach("R", a.hip_point() + P(-1.7, 3.2), 0.25, lean=False),
                      whip.strip(True), lv.strip(True), Snd("yank"))
            whip.free_end()
            self.play(whip.end.animate.move_to(P(-2.0, G + 0.1)), a.pose({"drop": 0.7, "spine": 0.35}))
            self.play(lv.reshape((0.7, -0.35)), a.walk_to(0.9, G, face=-1))
            tip = P(0.12 * a.sg, 0)
            lv.connect_end(lambda: a.hand("R") + tip)
            self.play(a.pose({"drop": 0.7, "spine": 0.35}))
            self.play(a.thread_wire(lv, unit.pt("lv_terminal"), tip_offset=tip))
            lv.connect_end(lambda: unit.pt("lv_terminal"))
            self.play(lv.strip(False), lv.reshape((-1.0, -0.4)), a.exhale())
            self.play(a.walk_to(-2.9, G, face=-1), a.pose("stand"))
            self.play(a.push_switch(disc, True))

        with self.block("together"):
            x0, x1 = unit.bounds[0], unit.bounds[1]
            self.play(a.walk_to(x0 - 0.62, G, face=1), b.walk_to(x1 + 0.62, G, face=-1))
            self.play(a.pose({"drop": 0.45}), b.pose({"drop": 0.45}),
                      a.grab2(unit, "grip_L", "grip_L_low", keep_pinned=True), b.grab2(unit, "grip_R", "grip_R_low", keep_pinned=True))
            grips = {a: {"R": "grip_L", "L": "grip_L_low"}, b: {"R": "grip_R", "L": "grip_R_low"}}
            cc = unit.get_center()
            self.play(carry_together([a, b], unit, grips, 0.5, path=lambda e: cc + P(0, 0.45) * e, rise=0.45))
            self.play(carry_together([a, b], unit, grips, 1.6, walk=(0.6, -1.2)))
            self.play(carry_together([a, b], unit, grips, 1.6, walk=(-0.6, 1.2)))
            for f in (a, b):
                f.pins = {"L": None, "R": None}
                f.bake_arm("L")
                f.bake_arm("R")
            self.play(a.celebrate(), b.shrug(), c.facepalm(), d.wipe_brow())
            self.play(a.hands_on_hips(), b.arms_crossed(), c.point_at(P(0, 3)), d.flinch())

        with self.block("truck_fx"):
            truck = WorkTruck(-3.95 + 9, -5.8)
            self.add(truck)
            self.play(truck.drive_in(-9, 1.2))
            self.play(truck.open_door(), Wait(0.2), truck.close_door())
            self.play(FX.smoke(P(0, 3)), FX.dust(P(1, G)), FX.sparkles([P(-1, 3), P(1, 3.5)]), FX.stars(lambda: c.head_center()))
            self.play(FX.zap_arcs(lambda: P(-1, 2), lambda: P(1, 2), 0.5))
            self.play(FX.effect_word("ZAP!", P(0, 4.5)))
            clock = ValueTracker(0)
            air = FX.cold_air(clock, [1.2, 1.4, 1.6], -1.9, -4.6)
            hum = FX.vibration_lines(clock, [(P(1.9, G + 1.0), 0.0)])
            FX.hum_shake(unit, clock)
            self.add(air, hum)
            self.play(clock.animate(run_time=1.5, rate_func=linear).set_value(1.5))
            self.remove(air, hum)
            self.play(camera.punch_in(self, P(0, 0.5), 0.5), Wait(0.3))
            self.play(camera.shake(self), Wait(0.1))
            self.play(camera.reset(self))

        self.extras_gallery()
        self.finish(music=False)

    def extras_gallery(self):
        """Every extra prop and set from *_more.py, laid out for a visual check."""
        pass
