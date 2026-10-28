"""Smith Air Stick World, episode 02: attic air handler swap.

Preview:  manim -ql -r 540,960 episodes/ep02_attic_air_handler.py Ep02AtticAirHandler
Final:    manim -qh --fps 30 -r 1080,1920 episodes/ep02_attic_air_handler.py Ep02AtticAirHandler
Retime to a voiceover by editing TIMING (seconds per scene; a scene that finishes early holds to its TIMING).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from manim import DOWN, PI, AnimationGroup, FadeIn, Succession, ValueTracker, Wait, linear, there_and_back
from manim.utils.rate_functions import ease_in_quad, ease_out_bounce

from stickworld import camera
from stickworld import continuity as C
from stickworld.actions import Do, climb_start, pull_out
from stickworld.audio import Snd
from stickworld.episode import EpisodeScene
from stickworld.props import effects as FX
from stickworld.props.base import attach_to, bundle, detach, ground_shadow, ride, turn_about, unbundle
from stickworld.props.effects_more import glow, heat_waves, impact_burst, pop, spark_shower, squash_land
from stickworld.props.hvac_more import AirHandler, CondensateDrain, LineSet, Thermostat
from stickworld.props.tools import ToolBag
from stickworld.props.tools_more import Dolly, Rope, Torch, TubingCutter
from stickworld.rig import StickFigure
from stickworld.sets_more import ROOM_COOL, ROOM_HOT, CeilingHole, attic
from stickworld.style import FRAME_H

# ---------------------------------------------------------------- layout: attic on top, the hot room below
F = 0.5             # attic floor (top of the joists)
RF = -5.1           # room floor
HATCH_X = -2.0
AH_X = 0.0          # air handler spot under the plenum
HO_X = 1.5          # homeowner, at the thermostat
HOLE_X = 2.05       # the gap between joists the rookie finds
DOLLY_X = -0.6      # where the new unit waits in the room
LANDING_X = -0.75   # where you stand after coming up through the hatch
BAG_X = 0.8         # where the lead sets the tool bag down in the attic
LEAD_SPOT = 0.25
ROOKIE_SPOT = 1.15
HAUL_X = 1.35
TILT = 0.351        # stair angle from vertical; a loaded hand truck rides it lying back at this tilt


class Ep02AtticAirHandler(EpisodeScene):
    EPISODE = 2
    TIMING = {
        "arrive": 4.8,
        "climb": 8.0,
        "joist": 7.7,
        "old_out": 9.3,
        "dolly_up": 11.2,
        "connect": 6.8,
        "thermostat": 2.3,
        "cold_air": 4.2,
    }

    # ------------------------------------------------------------ set up the world
    def build(self):
        probe = AirHandler(AH_X, F)
        self.set_ = attic(F, room_floor=RF, hatch_x=HATCH_X, walkway=(-1.2, 1.45), register_x=HO_X - 0.05, light_x=-0.45,
                          thermostat_x=2.45, work_x=AH_X, plenum_x=AH_X, plenum_y=probe.pt("supply_top")[1],
                          room_color=ROOM_HOT)
        a = self.set_
        self.treads = [a.pt(n) for n in a.treads]
        self.B, top = a.pt("stair_bottom")[:2], a.pt("stair_top")[:2]
        self.u = (top - self.B) / np.linalg.norm(top - self.B)
        self.n = np.array([-self.u[1], self.u[0]])          # off the stair, on the side you stand on
        self.old = AirHandler(AH_X, F, new=False, drain_side="right")
        ly = self.old.pt("lineset")[1]
        self.LS_ON = [self.old.pt("lineset")[:2], (1.45, ly), (1.45, F - 0.02)]
        self.LS_OFF = [(1.15, ly - 0.32), (1.45, ly), (1.45, F - 0.02)]
        self.lineset = LineSet(self.LS_ON)
        d = self.old.pt("drain")
        self.drain = CondensateDrain(d, direction=1, stub=0.06, run=0.06, drop=d[1] - 0.06 - F)
        self.thermo = Thermostat(a.pt("thermostat_spot"), temp=78)
        self.hole = CeilingHole(HOLE_X, F - 0.05, a.pt("ceiling")[1])
        self.dolly = Dolly(DOLLY_X, RF, facing=-1)
        self.new = AirHandler(DOLLY_X - 0.705, RF + 0.05, new=True, drain_side="right")
        self.load = bundle(self.dolly, self.new)
        self.rope = Rope((1.45, F + 0.12), tail_to=(1.45, F))
        self.ho = StickFigure(HO_X, RF, 1, accessory="hair_tuft", name="homeowner")
        self.lead = StickFigure(5.4, RF, -1, name="lead", rest_face=dict(mouth_curve=0.45))
        self.bag = ToolBag(self.lead.hand("R"), scale=0.8)        # the lead carries the MILWACKO bag in
        self.cutter = TubingCutter((0, 0), face=-1)
        self.torch = Torch((0, 0), face=-1)
        # the rookie comes in rolling the new unit on the hand truck, tipped back onto its wheels
        self.load.shift(np.array([6.0, 0, 0]))
        self.load.rotate(-0.25, about_point=self.load.pt("axle"))
        self.rookie = StickFigure(self.load.pt("axle")[0] + 1.06, RF, -1, accessory="cap", name="rookie",
                                  marks=C.rookie_marks(self.EPISODE))   # still wearing the cap he scorched in EP1
        self.add(a, self.drain, self.lineset, self.old, self.thermo, self.load, self.rope, self.ho, self.lead, self.rookie,
                 self.bag)
        attach_to(self.bag, "handle", lambda: self.lead.hand("R"))
        attic_floor = (-1.15, 4.6)  # the attic floor, not over the hatch
        self.add(ground_shadow(self.old, F, span=attic_floor), ground_shadow(self.new, RF), ground_shadow(self.new, F, span=attic_floor),
                 ground_shadow(self.dolly, RF, width=0.7), ground_shadow(self.dolly, F, span=attic_floor),
                 ground_shadow(self.bag, F, span=(-1.0, 4.6)))
        self.rookie.pin("L", lambda: self.dolly.pt("handle"))
        self.rookie.pin("R", lambda: self.dolly.pt("handle"))

    def on_stair(self, along, off=0.0):
        return self.B + self.u * along + self.n * off

    def drop_old(self, progress):
        """Old unit: tips into the hatch, lands lying on the stair, slides down, slams the floor, topples and skids
        off to the left. Driven by progress 0..1 on its base point."""
        W2 = 0.675 + 0.04
        start = self.old.pt("base")[:2].copy()
        lie_top = self.on_stair(2.33, W2)
        lie_bot = self.on_stair(0.0, W2)
        down = np.array([-3.3, RF + 0.675])
        gone = np.array([-5.3, RF + 0.675])

        def path(s):
            if s < 0.2:
                w = s / 0.2
                return np.array([start[0] + (lie_top[0] - start[0]) * w, start[1] + (lie_top[1] - start[1]) * w * w])
            if s < 0.55:
                w = (s - 0.2) / 0.35
                return lie_top + (lie_bot - lie_top) * w * w
            if s < 0.8:
                w = (s - 0.55) / 0.25
                return lie_bot + (down - lie_bot) * w + np.array([0, 0.5 * np.sin(PI * w)])
            w = (s - 0.8) / 0.2
            return down + (gone - down) * w

        def angle(s):
            if s < 0.2:
                return -TILT * (s / 0.2)
            if s < 0.55:
                return -TILT
            if s < 0.8:
                return -TILT + (PI / 2 + TILT) * ease_in_quad((s - 0.55) / 0.25)
            return PI / 2

        return ride(self.old, "base", path, angle, progress)

    # ------------------------------------------------------------ scenes
    def construct(self):
        self.build()
        self.episode_tag()
        a, lead, rookie, ho = self.set_, self.lead, self.rookie, self.ho
        lip = a.pt("lip")
        landing = (LANDING_X, F)
        start_x = climb_start(self.treads)

        self.camera.frame.set(height=FRAME_H * 0.48).move_to(np.array([1.8, -1.6, 0]))   # open on the problem
        head = ho.head_center()
        with self.block("arrive"):
            self.play(lead.walk_to(start_x, speed=1.25, hold=("R",)),
                      rookie.wheel_to(DOLLY_X + 0.2 + 1.06, self.load, run_time=3.0),
                      Succession(AnimationGroup(heat_waves(head + np.array([0, 0.45, 0]), 1.2),
                                                heat_waves(head + np.array([-1.1, -1.4, 0]), 1.3, width=0.6),
                                                heat_waves(head + np.array([1.2, -2.2, 0]), 1.3, width=0.6)),
                                 AnimationGroup(FX.sweat(head, side=-1), ho.wipe_brow(), heat_waves(head + np.array([0.2, 0.5, 0]), 1.0)),
                                 AnimationGroup(ho.turn(-1), ho.expression("disappointed"))),
                      Succession(Wait(1.5), camera.reset(self, 1.5)))
            self.play(turn_about(self.load, 0.25, "axle", 0.4), rookie.walk_to(DOLLY_X + 0.65, face=-1, run_time=0.4),
                      ho.point_at(a.pt("hatch")), Snd("thump", gain=-14))
            self.play(rookie.let_go(), ho.pose("stand", 0.3), Wait(0.1))

        with self.block("climb"):
            self.background(camera.punch_in(self, np.array([-1.3, -0.5, 0]), 0.84, 4.0))
            self.background(Succession(Wait(1.3), rookie.walk_to(start_x, speed=1.15),
                                       rookie.climb(self.treads, landing, lip, hunch=0.15),
                                       rookie.walk_to(ROOKIE_SPOT, spine=0.15), rookie.turn(-1)))
            self.play(lead.sling(self.bag), lead.face._to(0.3, turn=0.6))
            self.play(lead.climb(self.treads, landing, lip, hunch=0.15), ho.turn(1), ho.look_at(a.pt("hatch")))
            self.play(lead.walk_to(LEAD_SPOT, spine=0.15), ho.expression("neutral"))
            self.play(lead.unsling(self.bag, (BAG_X, F)))
            self.wait(2.2)

        with self.block("joist"):
            self.play(lead.talk(0.8), lead.point_at(self.old.pt("top_R")), rookie.nod(2),
                      camera.punch_in(self, np.array([1.25, -0.3, 0]), 0.68, 0.8))
            ceil = a.pt("ceiling")[1]
            self.play(lead.pose("stand", 0.3), rookie.fall_through(HOLE_X, F, hole=self.hole),
                      Succession(Wait(0.4), AnimationGroup(camera.shake(self, 0.12, run_time=0.3),
                                                           impact_burst((HOLE_X, ceil - 0.25), 0.9))))
            self.wait(0.08)   # hit-stop: let the crunch land
            self.play(rookie.kick_leg(3, 0.9), rookie.expression("strain", 0.2),
                      Succession(AnimationGroup(ho.expression("surprised", 0.15), ho.pose({"spine": -0.25, "neck": -0.15}, 0.25),
                                                ho.look_at(rookie.foot(rookie._stuck["side"]))),
                                 FX.sweat(ho.head_center(), side=1)),
                      Succession(Wait(0.3), lead.shake_head(2)))
            self.play(lead.walk_to(0.75, spine=0.15), ho.pose({"spine": 0.0, "neck": 0.0}, 0.4))
            self.play(pull_out(lead, rookie, ROOKIE_SPOT))
            # the lead patches him up: a plaster on the shin he keeps for the rest of the series
            shin = lambda: rookie.solve()["knee_R"] + (rookie.solve()["foot_R"] - rookie.solve()["knee_R"]) * 0.45
            self.play(lead.pose({"drop": 0.75, "spine": 0.65, "neck": -0.2}, 0.3), lead.reach("R", shin, 0.3, lean=False),
                      rookie.look_at(shin(), 0.2))
            self.play(Do(lambda: rookie.add_mark("shin_bandage")), Snd("pop_small", gain=-8),
                      FX.sparkles([shin() + np.array([0.15, 0.12, 0])], 0.4, 4), rookie.expression("happy", 0.2))
            self.play(lead.pose({"drop": 0.0, "spine": 0.0, "neck": 0.0}, 0.3), lead.let_go(("R",), 0.3))
            self.play(lead.point_at(a.pt("hatch")), lead.talk(0.5), rookie.expression("disappointed"), camera.reset(self, 0.6))

        with self.block("old_out"):
            self.background(Succession(rookie.walk_to(LANDING_X), rookie.turn(1),
                                       rookie.climb(self.treads, landing, lip, floor_y=RF, down=True),
                                       rookie.expression("neutral")))
            self.play(lead.pose("stand", 0.2), lead.walk_to(1.05, face=-1, spine=0.15))
            self.play(lead.fetch_tool(self.bag, self.cutter))
            cut = (self.LS_ON[0][0] + 0.1, self.LS_ON[0][1])
            self.play(lead.use_tool(self.cutter, cut, turns=3, run_time=0.9))
            self.play(self.lineset.reshape(self.LS_OFF, 0.3), Snd("tink"), Snd("fizz", gain=-12))
            self.play(lead.stow_tool(self.bag, self.cutter))
            self.play(lead.slide_push(self.old, -0.25, run_time=1.85))
            prog = ValueTracker(0.0)
            self.play(lead.let_go(), Do(lambda: self.drop_old(prog)),
                      prog.animate(run_time=1.5, rate_func=linear).set_value(1.0),
                      lead.expression("squint", 0.2),
                      Succession(Wait(0.1), AnimationGroup(rookie.look_at(a.pt("hatch")), rookie.expression("surprised", 0.1)),
                                 Wait(0.1), AnimationGroup(rookie.run_to(-1.65, run_time=0.35), rookie.flinch(peek=False))),
                      Succession(Wait(0.82), AnimationGroup(Snd("crash"), FX.dust(np.array([-3.4, RF, 0]), 1.8),
                                                            impact_burst((-3.3, RF + 0.5), 1.3), camera.shake(self, 0.15, run_time=0.4),
                                                            ho.flinch(), FX.sweat(ho.head_center(), side=1))),
                      Succession(Wait(1.2), Snd("thud", gain=-4), Snd("clatter", gain=-8)))
            self.play(Do(lambda: detach(self.old)), lead.shrug())

        with self.block("dolly_up"):
            haul = ValueTracker(0.0)
            floor_pt = None
            self.play(Succession(rookie.pose("stand", 0.25), rookie.walk_to(DOLLY_X + 0.65, speed=1.4)),
                      rookie.expression("neutral", 0.2), ho.pose("stand", 0.4), ho.face.open_eyes(0.2),
                      ho.expression("neutral", 0.2), Succession(lead.walk_to(HAUL_X, spine=0.15), lead.turn(-1)),
                      lead.expression("neutral"))
            self.play(rookie.turn(-1), rookie.grab2(self.dolly, "handle", "handle", keep_pinned=True),
                      lead.pose({"drop": 0.7, "spine": 0.6}, 0.35))
            self.play(turn_about(self.load, -TILT, "axle", 0.4),
                      rookie.walk_to(DOLLY_X + 0.2 + 1.31, face=-1, run_time=0.4),
                      lead.reach("R", self.rope.pt("coil") if self.rope.has_pt("coil") else np.array([1.45, F + 0.15, 0]), 0.35))
            self.play(Do(lambda: self.rope.hold(lambda: lead.hand("R"))), lead.pose({"drop": 0.0, "spine": 0.25}, 0.3))
            wheel_x = self.B[0] - 0.09 + 1.31
            hook = lambda: self.dolly.pt("handle")
            via = lambda: lip if hook()[1] < lip[1] + 0.05 else (hook() + lead.hand("R")) / 2
            self.play(rookie.wheel_to(wheel_x, self.load, run_time=1.6),
                      Succession(Wait(1.1), lead.point_at(lip, 0.25),
                                 AnimationGroup(self.rope.throw([lambda: lead.hand("R"), via, hook], 0.45), Snd("whoosh", gain=-6))))
            self.play(Snd("click", gain=-2), Wait(0.15))
            axle0 = self.load.pt("axle")[:2].copy()

            def stair_path(s):
                p = self.on_stair(0.45 + 3.95 * s, 0.26)
                k = min(1.0, s / 0.1)
                return axle0 + (p - axle0) * k

            self.background(camera.punch_in(self, np.array([-1.1, -0.9, 0]), 0.8, 3.0))
            self.play(Do(lambda: ride(self.load, "axle", stair_path, None, haul)),
                      rookie.let_go(), rookie.step_back(0.55, run_time=0.5),
                      lead.haul(self.rope, haul, 1.0, pulls=4, run_time=1.9, toward=lip),
                      rookie.expression("happy", 0.3))
            self.play(Do(lambda: (detach(self.load), self.rope.hold(hook))), lead.let_go(run_time=0.2),
                      lead.walk_to(LEAD_SPOT - 0.05, face=-1, spine=0.3, run_time=0.55))
            self.play(lead.pose({"drop": 0.85, "spine": 0.7}, 0.3),
                      lead.grab2(self.dolly, "handle", "handle", keep_pinned=True, run_time=0.3))
            up = ValueTracker(0.0)
            p_hi = self.on_stair(6.6, 0.26)
            p_lo = self.load.pt("axle")[:2].copy()
            p_end = np.array([AH_X + 0.705 + 0.2, F + 0.26])

            def out_path(s):
                if s < 0.45:
                    return p_lo + (p_hi - p_lo) * (s / 0.45)
                w = (s - 0.45) / 0.55
                return p_hi + (p_end - p_hi) * w + np.array([0, 0.25 * np.sin(PI * w)])

            self.play(Do(lambda: ride(self.load, "axle", out_path, lambda s: TILT * max(0.0, (s - 0.45) / 0.55), up)),
                      up.animate(run_time=1.4, rate_func=linear).set_value(1.0),
                      lead.expression("strain", 0.2),
                      Succession(lead.pose({"drop": 0.0, "spine": 0.2}, 0.62),
                                 lead.walk_to(HAUL_X, face=-1, run_time=0.78, spine=0.15)),
                      Succession(Wait(1.38), Snd("thud", gain=-6)))
            self.play(Do(lambda: detach(self.load)), squash_land(self.load, 0.07, 0.4), FX.dust(np.array([AH_X + 0.2, F, 0]), 1.7),
                      lead.let_go(run_time=0.25), lead.expression("neutral", 0.2), camera.reset(self, 0.9))
            self.play(Do(lambda: unbundle(self, self.load, self.new)), Do(lambda: unbundle(self, self.load, self.dolly)))
            self.play(self.new.animate(run_time=0.12).shift(0.05 * DOWN),
                      turn_about(self.dolly, -PI / 2, "axle", 0.55, ease_in_quad),
                      Succession(Wait(0.5), Snd("clatter", gain=-6)))

        with self.block("connect"):
            self.background(Succession(rookie.walk_to(HO_X - 1.25), rookie.turn(1)))
            end = lambda: self.lineset.pt("end_a")
            stubs = self.new.pt("lineset")
            self.play(lead.reach("R", end, 0.3), lead.look_at(stubs),
                      camera.punch_in(self, stubs + np.array([0.3, 0.2, 0]), 0.34, 0.7), Snd("whoosh", gain=-16))
            self.play(Do(lambda: lead.pin("R", end)), self.lineset.reshape(self.LS_ON, 0.55))
            self.play(lead.let_go(("R",)))
            self.play(lead.fetch_tool(self.bag, self.torch))
            self.play(self.torch.flame(True), Snd("click", gain=-4), Snd("fizz", gain=-8))
            joint = stubs + np.array([0.04, 0.0, 0])
            self.play(lead.use_tool(self.torch, joint, turns=0, run_time=1.3), lead.expression("squint", 0.2),
                      Succession(Wait(0.3), AnimationGroup(
                          glow(joint, 1.2), spark_shower(lambda: self.torch.pt("tip"), 1.0, rate=34, speed=(1.0, 2.4)),
                          heat_waves(stubs + np.array([0, 0.15, 0]), 1.0, width=0.4, height=0.5), Snd("fizz", gain=-3))))
            self.play(self.torch.flame(False), lead.expression("neutral", 0.2))
            self.play(lead.stow_tool(self.bag, self.torch))
            self.play(lead.reach("L", self.drain.pt("inlet"), 0.3), lead.look_at(self.drain.pt("inlet")))
            self.play(Snd("click"), FX.sparkles([self.drain.pt("inlet") + np.array([0.08, 0.12, 0])], 0.45, 3))
            self.play(lead.let_go(("L",)), lead.exhale(),
                      camera.punch_in(self, self.thermo.pt("screen") + np.array([-0.35, -0.25, 0]), 0.3, 0.8),
                      Succession(Wait(0.15), Snd("whoosh", gain=-12)))

        with self.block("thermostat"):
            btn = self.thermo.pt("button_down")
            self.play(ho.turn(1), ho.reach("R", btn, 0.3), ho.look_at(self.thermo.pt("screen")), ho.expression("happy", 0.3))
            digits = self.thermo.parts["digits"]
            for t in range(77, 71, -1):
                self.play(self.thermo.set_temp(t, run_time=0.04), Snd("click", gain=-6),
                          ho.reach("R", btn + np.array([0.025, -0.01, 0]), 0.08, rate_func=there_and_back, lean=False),
                          pop(digits, 1.18, 0.17))
            self.play(self.thermo.parts["screen"].animate(run_time=0.3).set_fill("#BFE6FF"), Snd("ding", gain=-10),
                      FX.sparkles([self.thermo.pt("screen") + np.array([0.28, 0.2, 0])], 0.5, 5))
            self.play(ho.let_go(("R",)))

        with self.block("cold_air"):
            clock = ValueTracker(0.0)
            ah = self.new
            mid = ah.pt("base")[1] + 1.6
            hum = FX.vibration_lines(clock, [(np.array([ah.get_left()[0] - 0.12, mid, 0]), PI),
                                            (np.array([ah.get_right()[0] + 0.12, mid + 0.3, 0]), 0.0)])
            reg = a.pt("register")
            air = FX.cold_air(clock, [reg[0] - 0.25, reg[0], reg[0] + 0.25], reg[1] - 0.05, RF + 2.6, vertical=True)
            FX.hum_shake(ah, clock)
            self.add(hum, air)
            self.play(clock.animate(run_time=4.0, rate_func=linear).set_value(4.0), Snd("hum", gain=-6),
                      camera.punch_in(self, np.array([0.9, -0.9, 0]), 0.8, 2.2),
                      Succession(Wait(0.4), a.parts["room"].animate(run_time=2.4).set_fill(ROOM_COOL)),
                      Succession(Wait(0.6), AnimationGroup(ho.expression("happy", 0.3), ho.face.close_eyes(0.3),
                                                           ho.pose({"shoulder_L": 1.2, "elbow_L": 0.3, "shoulder_R": 1.3,
                                                                    "elbow_R": 0.3, "neck": -0.2}, 0.5))),
                      Succession(Wait(0.9), rookie.celebrate()),
                      Succession(Wait(1.2), lead.thumbs_up()))

        self.finish()
