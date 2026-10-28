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
        a = StickFigure(x=-2.4, ground=G, face_dir=1, name="lead", rest_face=dict(mouth_curve=0.45))
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
            self.play(a.thumbs_up(), b.wink())
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
        """Every extra prop, effect and set from *_more.py, laid out and exercised once."""
        from manim import RIGHT, Circle
        from stickworld.props.effects_more import heat_waves, motion_lines, question_mark, sweat
        from stickworld.props.hvac_more import (AirHandler, BreakerPanel, CondensateDrain, EvapCoil, FilterRack, Furnace,
                                                LineSet, SplitCondenser, Thermostat)
        from stickworld.props.tools_more import (Dolly, Flashlight, GaugeSet, Ladder, Level, MasticBrush, MasticBucket,
                                                 Multimeter, RecoveryMachine, RefrigerantTank, Screwdriver)
        from stickworld.sets_more import attic, crawlspace, rooftop, utility_closet

        self.clear()
        with self.block("sets_more"):
            for build, anchor in ((attic, "work_spot"), (crawlspace, "work_spot"), (rooftop, "curb"), (utility_closet, "equipment_spot")):
                st = build()
                spot = st.pt(anchor)
                fig = StickFigure(x=spot[0] + 1.2, ground=spot[1], face_dir=-1, name=build.__name__)
                if build is crawlspace:
                    fig.set(**{"spine": 0.9})
                    self.add(st, fig)
                    self.play(fig.pose({"drop": 1.1, "spine": 0.9}, 0.3))
                else:
                    self.add(st, fig)
                self.play(fig.look_at(spot), fig.expression("happy"), Wait(0.5))
                self.remove(st, fig)

        with self.block("hvac_more"):
            g1, g2 = 2.0, -5.5
            cond = SplitCondenser(-2.8, g1)
            ah = AirHandler(2.6, g1, mirror=True)
            ls = LineSet([cond.pt("lineset"), (-1.2, cond.pt("lineset")[1]), (-1.2, 4.5), (ah.get_left()[0], 4.5)])
            fur = Furnace(-3.0, g2)
            coil = EvapCoil(-3.0, fur.pt("supply_top")[1])
            th = Thermostat((0.2, 0.6))
            drn = CondensateDrain(coil.pt("drain"))
            rack = FilterRack((0.3, -4.0))
            bp = BreakerPanel((2.9, -3.2))
            self.add(cond, ah, ls, fur, coil, th, drn, rack, bp)
            self.play(fur.burner(True), th.set_temp(65), bp.open_door())
            self.play(bp.flip(2, False), bp.flip("main", False), drn.drip(n=2, run_time=1.0), th.screen_on(False))
            self.play(th.screen_on(True), ls.reshape([cond.pt("lineset"), (-1.6, 4.0), (ah.get_left()[0], 4.0)]),
                      rack.parts["filter"].animate.shift(np.array([0, 0.9, 0])))
            self.remove(cond, ah, ls, fur, coil, th, drn, rack, bp)

        with self.block("tools_more"):
            g = -0.8
            mm, gs = Multimeter((-2.8, 3.6)), GaugeSet((1.2, 3.8))
            lvl, fl = Level((0.0, 1.6)), Flashlight((-3.4, 1.5))
            drv, brush = Screwdriver((-3.6, 5.6)), MasticBrush((-2.2, 5.6), angle=0.0)
            yard = [RecoveryMachine(-3.1, g), RefrigerantTank(-1.6, g), MasticBucket(-0.5, g), Dolly(1.0, g),
                    Ladder(3.2, g, height=2.2)]
            tall = [Ladder(-2.4, -6.8, height=4.5), Ladder(1.6, -6.8, height=4.6, kind="straight", lean=0.25)]
            fig = StickFigure(x=-0.3, ground=-6.8, face_dir=1, name="tester")
            self.add(mm, gs, lvl, fl, drv, brush, *yard, *tall, fig)
            self.play(mm.reading(240), gs.needles(118, 340), lvl.tilt(0.12), fl.beam(True))
            self.play(mm.probes_to((-2.0, 2.6), (-1.6, 2.5)), gs.hoses_to(low=(0.6, 2.4), high=(2.0, 2.5)), lvl.tilt(-0.12), fl.beam(False))
            self.play(fig.grab(fl, "R", "grip"))
            self.play(fl.beam(True), fig.pose("point", 0.4))
            self.remove(mm, gs, lvl, fl, drv, brush, *yard, *tall, fig)

        with self.block("effects_more"):
            fig = StickFigure(x=-1.0, ground=-2.0, face_dir=1, name="fx")
            box = Circle(radius=0.4).move_to(P(-3.0, -4.5)).set_stroke(S.INK, 5)
            self.add(fig, box)
            self.play(heat_waves(P(1.5, -1.0), run_time=1.0), sweat(fig.head_center(), side=1), question_mark(fig.head_center() + P(0, S.HEAD_R)))
            self.play(motion_lines(box, RIGHT, run_time=0.8), box.animate.shift(RIGHT * 4), run_time=0.8)
            self.remove(fig, box)

        with self.block("attic_actions"):
            from stickworld.actions import climb_start, pull_out
            from stickworld.props.tools_more import Torch, TubingCutter
            from stickworld.props.base import bundle, detach, ride, turn_about, unbundle
            from stickworld.props.effects_more import debris
            from stickworld.props.tools_more import Rope
            from stickworld.sets_more import CeilingHole
            F, RF = 0.5, -5.1
            st = attic(F, room_floor=RF, hatch_x=-2.0, walkway=(-1.2, 1.45), register_x=1.4, thermostat_x=2.45,
                       work_x=0.0, plenum_x=0.0, plenum_y=AirHandler(0.0, F).pt("supply_top")[1])
            treads, lip = [st.pt(n) for n in st.treads], st.pt("lip")
            box = AirHandler(0.0, F, new=False, drain_side="right")
            hole = CeilingHole(2.05, F - 0.05, st.pt("ceiling")[1])
            dl = Dolly(-0.6, RF, facing=-1)
            load = bundle(dl, AirHandler(-1.305, RF + 0.05, drain_side="right"))
            rope = Rope((1.2, F + 0.12), tail_to=(1.2, F))
            up = StickFigure(x=climb_start(treads), ground=RF, face_dir=-1, name="climber")
            bag = ToolBag(up.hand("R"), scale=0.8)
            cutter, torch = TubingCutter((0, 0), face=-1), Torch((0, 0), face=-1)
            low = StickFigure(x=0.35, ground=RF, face_dir=-1, accessory="cap", name="pusher")
            self.add(st, box, load, rope, up, low, bag)
            self.play(up.sling(bag))
            self.play(up.climb(treads, (-0.75, F), lip, hunch=0.15))
            self.play(up.walk_to(1.0, spine=0.15), up.turn(-1))
            self.play(up.unsling(bag, (1.6, F)), Wait(0.1))
            self.play(up.turn(1))
            self.play(up.fetch_tool(bag, cutter))
            self.play(up.use_tool(cutter, P(1.6, F + 2.1), turns=2, run_time=0.6))
            self.play(up.stow_tool(bag, cutter))
            self.play(up.fetch_tool(bag, torch))
            self.play(torch.flame(True))
            self.play(up.use_tool(torch, P(1.6, F + 2.1), turns=0, run_time=0.5))
            self.play(torch.flame(False), up.stow_tool(bag, torch), up.turn(-1))
            self.play(up.slide_push(box, -0.3, run_time=1.2))
            self.play(up.let_go(), up.walk_to(1.2, face=-1), FadeOut(box))
            self.play(up.fall_through(2.05, F, hole=hole), debris(P(-3.0, -2.0), run_time=0.8))
            self.play(up.kick_leg(2, 0.6))
            helper = StickFigure(x=0.4, ground=F, face_dir=1, name="helper")
            self.add(helper)
            self.play(pull_out(helper, up, 1.15))
            self.play(low.grab2(dl, "handle", "handle", keep_pinned=True), turn_about(load, -0.351, "axle", 0.4),
                      low.walk_to(0.71, face=-1, run_time=0.4))
            self.play(low.wheel_to(-2.0, load, run_time=1.2), up.reach("R", P(1.2, F + 0.15), 0.3))
            self.play(Do(lambda: rope.hold(lambda: up.hand("R"))), up.walk_to(1.35, face=-1, run_time=0.4))
            self.play(rope.throw([lambda: up.hand("R"), lip, lambda: dl.pt("handle")], 0.45))
            haul = ValueTracker(0.0)
            a0 = load.pt("axle")[:2].copy()
            self.play(Do(lambda: ride(load, "axle", lambda s: a0 + np.array([0.344, 0.939]) * 3.0 * s, None, haul)),
                      low.let_go(), up.haul(rope, haul, 1.0, pulls=4, toward=lip))
            self.play(Do(lambda: detach(load)), Do(lambda: unbundle(self, load, dl)), turn_about(dl, -PI / 2, "axle", 0.4))
            clock = ValueTracker(0.0)
            air = FX.cold_air(clock, [1.15, 1.4, 1.65], st.pt("register")[1], RF + 2.5, vertical=True)
            self.add(air)
            self.play(clock.animate(run_time=1.5, rate_func=linear).set_value(1.5))
            self.remove(air, st, load, dl, rope, up, low, helper, hole, bag)
