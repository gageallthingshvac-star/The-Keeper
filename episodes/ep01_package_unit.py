"""Smith Air Stick World, episode 01: package unit changeout.

Preview:  manim -ql -r 540,960 episodes/ep01_package_unit.py Ep01PackageUnit
Final:    manim -qh --fps 30 -r 1080,1920 episodes/ep01_package_unit.py Ep01PackageUnit
Retime to a voiceover by editing TIMING (seconds per scene; a scene that finishes early holds to its TIMING).
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from manim import (DOWN, LEFT, PI, UP, AnimationGroup, FadeIn, FadeOut, LaggedStart, Succession, Transform, ValueTracker,
                   Wait, linear, rush_from, smooth, there_and_back)
from manim.utils.rate_functions import ease_out_back, ease_out_bounce

from stickworld import camera
from stickworld import continuity as C
from stickworld import style as S
from stickworld.actions import Do, carry_together, tween_value
from stickworld.audio import Snd
from stickworld.episode import EpisodeScene
from stickworld.props import effects as FX
from stickworld.props.base import attach_to, detach, ground_shadow
from stickworld.props.effects_more import impact_burst, spark_shower
from stickworld.props.home import LockoutTag
from stickworld.props.hvac import Disconnect, Duct, FlashingPanel, HighVoltageWhip, LowVoltageWire, PackageUnit, Screw
from stickworld.props.tools import Drill, ToolBag
from stickworld.props.vehicles import WorkTruck
from stickworld.rig import StickFigure
from stickworld.sets import driveway, house_side
from stickworld.style import FRAME_H, P

# ---------------------------------------------------------------- layout (kept clear of the Shorts UI along the bottom)
G = -0.4            # yard ground
WX = -3.35          # house wall face
UCX = -0.1          # unit centre
STREET = -5.8
TRUCK_FRONT = -3.95
T2_HOME = 3.0
BOOKEND = (P(-0.3, G + 1.7), 0.62)   # opening and closing shot: close on the unit (the replay reads as after -> before)
WORK = (P(-0.6, 0.7), 0.75)           # the working frame: house wall to unit, truck mostly out of shot


class Ep01PackageUnit(EpisodeScene):
    EPISODE = 1
    TIMING = {
        "arrive": 2.95,
        "hop_out": 4.55,
        "zap": 7.5,
        "drills": 4.85,
        "peel": 4.55,
        "ducts": 6.25,
        "pull_start": 4.7,
        "carry_toss": 7.85,
        "new_unit": 2.5,
        "rewind": 2.45,
        "thread": 4.2,
        "power_up": 6.1,
    }

    # ------------------------------------------------------------ set up the world
    def build(self):
        self.house = house_side(G, WX, pad=(UCX - 1.95, UCX + 1.95))
        self.drive = driveway(STREET, curb_y=-2.7, lawn_from=G)
        self.unit = PackageUnit(UCX, G + 0.13, old=True)
        x0 = self.unit.bounds[0]
        self.x0 = x0
        sup, ret = self.unit.pt("supply_open")[1], self.unit.pt("return_open")[1]
        self.ducts = [Duct(WX, x0 - 0.1, sup), Duct(WX, x0 - 0.1, ret)]
        self.duct_home = [d.copy() for d in self.ducts]
        self.top = FlashingPanel(WX, x0 - 0.05, sup + 0.31, sup + 0.51, "top")
        self.side = FlashingPanel(WX, x0 - 0.05, ret - 0.38, sup + 0.31, "side")
        rows = (sup + 0.41, sup - 0.05, ret - 0.2)
        self.screw_rows = [(Screw(P(x0 - 0.35, y)), Screw(P(-2.95, y))) for y in rows]  # (Tech 2's, Tech 1's)
        self.disc = Disconnect(self.house.pt("disconnect_mount"))
        self.whip = HighVoltageWhip(self.disc.pt("whip_out"), self.unit.pt("whip_terminal"), (0, -1.6), (-1.6, -0.2))
        self.lv = LowVoltageWire((WX, G + 0.25), self.unit.pt("lv_terminal"), (0.9, -0.05), (-1.0, -0.4))
        self.truck = WorkTruck(TRUCK_FRONT + 9, STREET, trophies=C.trophies(self.EPISODE))
        self.bag = ToolBag(self.truck.pt("bed_rail") + P(-1.0, 0.22)).set_z_index(S.Z_FIGURE_HIDDEN + 0.3)
        attach_to(self.bag, "handle", lambda: self.truck.pt("bed_rail") + P(-1.0, 0.19))
        sit = dict(legL_lock=0.0, legR_lock=0.0, hip_L=1.35, knee_L=-2.6, hip_R=1.45, knee_R=-2.6,
                   shoulder_L=1.0, elbow_L=0.8, shoulder_R=1.1, elbow_R=0.8)
        self.t1 = StickFigure(x=self.truck.pt("driver_seat")[0], ground=STREET, face_dir=-1, name="lead", rest_face=dict(mouth_curve=0.45))
        self.t2 = StickFigure(x=self.truck.pt("passenger_seat")[0], ground=STREET, face_dir=-1, accessory="cap", name="rookie",
                                marks=C.rookie_marks(self.EPISODE))
        for f in (self.t1, self.t2):
            f.set(y=STREET + 0.72, **sit).set_z_index(S.Z_FIGURE_HIDDEN)
        self.add(self.house, self.drive, *self.ducts, self.side, self.top, *[s for r in self.screw_rows for s in r],
                 self.unit, self.disc, self.whip.mob, self.whip.end, self.lv.mob, self.lv.end, self.t1, self.t2,
                 self.truck, self.bag)
        self.whip.connect_end(lambda: self.unit.pt("whip_terminal"))
        self.lv.connect_end(lambda: self.unit.pt("lv_terminal"))
        # soft contact shadows anchor the big props to the ground
        self.add(ground_shadow(self.unit, G + 0.13), ground_shadow(self.truck, STREET, width=6.0, height=0.22),
                 ground_shadow(self.bag, G, width=1.2))

    # ------------------------------------------------------------ helpers built from library actions
    def fetch_drills(self, t1_x=-3.7, t2_x=-1.45):
        """Tech 1 pulls two drills from the bag and tosses one to Tech 2. Returns (drill1, drill2)."""
        t1, t2, bag = self.t1, self.t2, self.bag
        moves = [t1.walk_to(t1_x, G, face=1, run_time=0.4)]
        if abs(t2.v("x") - t2_x) > 0.05:
            moves.append(t2.walk_to(t2_x, G, face=-1, speed=1.8))
        self.play(*moves)
        self.play(t1.pose({"drop": 0.75, "spine": 0.75, "neck": -0.2}, 0.25),
                  t1.reach("R", lambda: bag.pt("opening"), 0.25, lean=False),
                  t1.reach("L", lambda: bag.pt("opening") + P(0.12, 0), 0.25, lean=False))
        d1, d2 = Drill(t1.hand("R"), face=1), Drill(t1.hand("L"), face=-1)
        attach_to(d1, "grip", lambda: t1.hand("R"))
        attach_to(d2, "grip", lambda: t1.hand("L"))
        self.play(FadeIn(d1, scale=0.6), FadeIn(d2, scale=0.6), Snd("tools", gain=-10), run_time=0.1)
        self.play(t1.pose({"drop": 0.0, "spine": 0.0, "neck": 0.0, "shoulder_R": 0.9, "elbow_R": 0.7,
                           "shoulder_L": 1.7, "elbow_L": 0.4}, 0.25))
        catch = t2.shoulder_point() + P(-0.95, -0.45)
        self.play(Succession(Do(lambda: detach(d2)), AnimationGroup(t2.reach("R", catch, 0.4),
                  Succession(Snd("whoosh", gain=-8), d2.animate(path_arc=-1.3, run_time=0.4).move_to(catch).rotate(2 * PI)))),
                  t1.pose({"shoulder_L": -0.3, "elbow_L": 0.2}, 0.3))
        attach_to(d2, "grip", lambda: t2.hand("R"))
        self.snd("catch", gain=-6)
        return d1, d2

    def drill_rows(self, drills, driving_in):
        t1, t2 = self.t1, self.t2
        flying = []  # screws still flying off overlap the next row's reach
        for r, (s2, s1) in enumerate(self.screw_rows):
            low = r == 2
            h1 = s1.pt("head") - drills[0].tip_offset
            h2 = s2.pt("head") - drills[1].tip_offset
            crouch = {"drop": 0.85, "spine": 0.35} if low else {"drop": 0.0, "spine": 0.08}
            self.play(*flying, t1.pose(dict(crouch), 0.22), t2.pose(dict(crouch), 0.22),
                      t1.reach("R", h1, 0.22, lean=False), t2.reach("R", h2, 0.22, lean=False),
                      t1.expression("squint", 0.2), t2.expression("squint", 0.2))
            spin = [s1.drive_in(0.35), s2.drive_in(0.35)] if driving_in else [s1.back_out(0.35), s2.back_out(0.35)]
            self.play(*spin, Snd("drill", 0.35))
            flying = []
            if not driving_in:
                rng = random.Random(20 + r)
                self.snd("ping", 0.05, gain=-6)
                flying = [s.fly_off(P(rng.uniform(-6, 6), 9.0), 0.3, rng.choice([-1, 1]) * 1.2) for s in (s1, s2)]
        if flying:
            self.play(*flying)

    def stow_drills(self, drills):
        t1, t2, bag = self.t1, self.t2, self.bag
        for d in drills:
            detach(d)
        self.snd("tools", 0.4, gain=-8)
        self.play(*[d.animate(path_arc=1.3, run_time=0.45).move_to(bag.pt("opening")).scale(0.3) for d in drills],
                  t1.pose({"shoulder_R": 1.6, "elbow_R": 0.2, "drop": 0.0, "spine": 0.0}, 0.3),
                  t2.pose({"shoulder_R": 1.8, "elbow_R": 0.2, "drop": 0.0, "spine": 0.0}, 0.3),
                  t1.expression("neutral"), t2.expression("neutral"))
        self.remove(*drills)

    def peel(self, panel, stand_x=-2.55, back_x=-3.45):
        t1 = self.t1
        free = lambda: panel.pt("free_end")
        if abs(t1.v("x") - stand_x) > 0.05:
            self.play(t1.walk_to(stand_x, G, face=1, run_time=0.5))
        self.play(t1.reach("R", free, 0.25))
        self.snd("creak", gain=-4)
        self.play(panel.peel_to(0.6, 0.55, smooth), t1.walk_to(back_x, G, face=1, hands={"R": free}, run_time=0.55))
        self.play(Do(lambda: t1.bake_arm("R")))
        self.play(panel.peel_to(1.0, 0.3, ease_out_bounce), t1.pose({"shoulder_R": 0.4, "elbow_R": 0.6}, 0.3))

    # ------------------------------------------------------------ the episode
    def construct(self):
        self.build()
        self.episode_tag()
        t1, t2, truck, unit, bag = self.t1, self.t2, self.truck, self.unit, self.bag

        with self.block("arrive"):
            # frame 1 is the problem: close on the old LEMONNOX coughing smoke; pull back as the truck rolls up
            self.camera.frame.set(height=FRAME_H * BOOKEND[1]).move_to(BOOKEND[0])
            self.snd("cough", 0.0, gain=-2)
            self.snd("cough", 0.5, gain=-4)
            self.snd("truck", 0.05)
            self.background(FX.smoke(unit.pt("top_center") + P(0.5, 0.25), n=5, seed=1, run_time=0.8))
            self.background(Succession(Wait(0.5), FX.smoke(unit.pt("top_center") + P(0.2, 0.2), n=5, seed=2, run_time=0.8)))
            self.play(truck.drive_in(-9, 1.4, riders=(t1, t2)),
                      Succession(Wait(0.7), camera.reset(self, 1.1)))

        with self.block("hop_out"):
            self.play(t1.hop_out(truck, truck.pt("door_step")[0] - 0.35, STREET))
            bag_x = bag.pt("handle")[0]
            self.play(
                Succession(t2.hop_out(truck, TRUCK_FRONT + 1.3, STREET, run_time=0.65, tumble=True),
                           t2.get_up(STREET, 0.45),
                           t2.walk_to(T2_HOME, G, speed=1.35, run_time=1.4)),
                Succession(t1.walk_to(bag_x - 0.55, STREET, face=1, run_time=0.85),
                           t1.grab(bag, "R", "handle", run_time=0.3),
                           t1.pose({"shoulder_R": 0.15, "elbow_R": 0.1}, 0.2),
                           t1.walk_to(-2.75, G, speed=1.3, hold=("R",), run_time=1.35)),
                Succession(Wait(1.2), camera.punch_in(self, WORK[0], WORK[1], 1.0)))

        with self.block("zap"):
            side, disc = self.side, self.disc
            self.play(t1.release(bag, "place", target=P(-3.1, G + 0.33), run_time=0.35), t1.turn(1, 0.2))
            # Tech 1 fights the screwed-down flashing while Tech 2 wanders over to unhook the whip
            self.play(t1.reach("R", lambda: side.pt("free_end"), 0.3), t1.expression("strain", 0.2),
                      t2.walk_to(unit.pt("whip_terminal")[0] + 0.85, G, face=-1, run_time=1.3),
                      Succession(Wait(0.3), Snd("rattle", gain=-5)))
            t1.pin("R", lambda: side.pt("free_end"))
            self.play(Succession(*[t1.pose({"spine": -0.32 if k % 2 == 0 else 0.05}, 0.2) for k in range(4)]),
                      t2.pose({"drop": 0.7, "spine": 0.55}, 0.4),
                      Succession(Wait(0.4), t2.reach("R", unit.pt("whip_terminal") + P(-0.25, 0.05), 0.35)))
            self.play(t2.zapped(source=unit.pt("whip_terminal")),
                      Succession(Wait(0.55), Do(lambda: (t2.remove_mark("cap_tag"), t2.add_mark("scorched_cap")))),  # price tag burns off; the cap stays scorched for the series
                      spark_shower(unit.pt("whip_terminal"), 0.55, rate=48, speed=(1.6, 3.4), spread=(0.2, 2.9),
                                   colors=("#FFFFFF", "#BFE8FF", "#FFD54A")),
                      camera.punch_in(self, P(0.1, 0.4), 0.72, 0.25), Succession(Wait(0.25), camera.shake(self, 0.09, run_time=0.3)),
                      Succession(Wait(0.4), Do(lambda: t1.unpin("R")),
                                 AnimationGroup(t1.pose("stand", 0.3), t1.expression("neutral", 0.2), t1.look_at(t2.head_center())),
                                 Wait(0.1), t1.shake_head(2, slow=True)))
            # power off at the disconnect, close up, and locked out with a tag from his shirt pocket
            self.play(t1.walk_to(-2.9, G, face=-1, run_time=0.5), camera.punch_in(self, disc.get_center() + P(0.35, -0.25), 0.3, 0.5))
            self.play(t1.push_switch(disc, False, run_time=0.2), Succession(Wait(0.25), Snd("clunk")))
            chest = lambda: t1.hip_point() + P(0.18 * t1.sg, 1.0)
            self.lockout = tag = LockoutTag(disc.pt("handle")).set_z_index(S.Z_PROP_FRONT + 0.5)
            self.play(t1.reach("R", chest, 0.2, lean=False))
            attach_to(tag, "hang", lambda: t1.hand("R"))
            self.play(FadeIn(tag, scale=0.5, run_time=0.12))
            self.play(t1.reach("R", lambda: disc.pt("handle"), 0.25, lean=False), Succession(Wait(0.22), Snd("tink", gain=-4)))
            detach(tag)
            self.play(t1.let_go(("R",)), camera.punch_in(self, WORK[0], WORK[1], 0.45))

        with self.block("drills"):
            drills = self.fetch_drills()
            self.drill_rows(drills, driving_in=False)
            self.stow_drills(drills)

        with self.block("peel"):
            self.background(t2.walk_to(T2_HOME, G, speed=1.5))  # Tech 2 heads home while the peel starts
            self.play(t2.hair_down(0.5), t1.walk_to(-2.55, G, face=1, run_time=0.5))
            self.peel(self.top)
            self.peel(self.side)
            mouth = lambda: t1.head_center() + P(0.3 * t1.sg, -0.15)
            self.play(t1.reach("R", mouth, 0.25), t1.face.turn_to(0.0, 0.2))
            self.play(Succession(t1.face._to(0.1, mouth_open=0.5), t1.face._to(0.1, mouth_open=0.0),
                                 t1.face._to(0.1, mouth_open=0.5), t1.face._to(0.1, mouth_open=0.0)),
                      t1.expression("happy", 0.3))
            self.play(t1.pose("stand", 0.25), t1.expression("neutral", 0.25))

        with self.block("ducts"):
            piles = (P(-3.55, G - 1.95), P(-3.3, G - 2.45))
            for i, duct in enumerate(self.ducts):
                big = i == 0
                self.play(t1.walk_to(-2.85, G, face=1, run_time=0.4 if big else 0.55))
                self.play(t1.yank_plug(duct, unit.pt("foot_spot") + P(-0.02, 0.0 if big else -0.3), stumble=0.75,
                                       stumble_y=-1.15, strain_time=0.4 if big else 0.16, cue="pop_big" if big else "pop",
                                       grab_time=0.3, wobble=big))
                self.snd("clatter", 0.45, gain=-5)
                self.play(t1.release(duct, "throw", target=piles[i], spin=0.3 if big else -0.25, sides=("L", "R"), run_time=0.45))

        with self.block("pull_start"):
            whip, lv = self.whip, self.lv
            grab = (unit.pt("whip_terminal") + unit.pt("lv_terminal")) / 2
            self.play(t1.walk_to(-1.35, G, face=1, run_time=0.5))
            self.play(t1.pose({"drop": 0.8, "spine": 0.55}, 0.3), t1.reach("R", grab, 0.3, lean=False))
            for cable, dx in ((whip, -0.05), (lv, 0.05)):
                cable.connect_end(lambda dx=dx: t1.hand("R") + P(dx, 0))
            self.play(t1.pose({"drop": 0.95, "spine": 0.75}, 0.2), t1.expression("strain", 0.2))
            self.snd("yank")
            self.play(t1.pose({"drop": 0.0, "spine": -0.4}, 0.22, rush_from),
                      t1.reach("R", t1.hip_point() + P(-1.7 * t1.sg, 3.2), 0.22, rate_func=rush_from, lean=False),
                      whip.strip(True, 0.15), lv.strip(True, 0.15), t1.expression("neutral", 0.2))
            self.snd("crickets", 0.1, gain=-2)
            self.play(Succession(Wait(0.1), t1.blink(), Wait(0.12), t1.blink()))
            whip.free_end()
            lv.free_end()
            self.snd("thump", 0.25, gain=-12)
            self.play(whip.end.animate(rate_func=ease_out_bounce).move_to(P(-1.95, G + 0.1)),
                      lv.end.animate(rate_func=ease_out_bounce).move_to(P(0.35, G + 0.12)),
                      t1.pose("stand", 0.4), run_time=0.45)
            self.play(t2.look_at(t1.head_center(), 0.2))
            self.play(t2.shake_head(2, slow=True, eyes_closed=True), t1.expression("surprised", 0.3))

        with self.block("carry_toss"):
            x0, x1 = unit.bounds[0], unit.bounds[1]
            self.play(t1.walk_to(x0 - 0.62, G, face=1, run_time=0.55), t2.walk_to(x1 + 0.62, G, face=-1, run_time=0.8))
            self.play(t1.pose({"drop": 0.45, "spine": 0.15}, 0.25), t2.pose({"drop": 0.45, "spine": 0.15}, 0.25),
                      t1.grab2(unit, "grip_L", "grip_L_low", 0.25, keep_pinned=True, look=False),
                      t2.grab2(unit, "grip_R", "grip_R_low", 0.25, keep_pinned=True, look=False))
            grips = {t1: {"R": "grip_L", "L": "grip_L_low"}, t2: {"R": "grip_R", "L": "grip_R_low"}}
            for f in (t1, t2):
                f.set_z_index(S.Z_FIGURE_HIDDEN + 0.3)
            unit.set_z_index(S.Z_FIGURE_HIDDEN + 0.2)
            self.play(carry_together([t1, t2], unit, grips, 0.5, rot=lambda e: 0.04 * np.sin(8 * PI * e), rate_func=linear),
                      Snd("rattle", gain=-4), t1.expression("strain", 0.2), t2.expression("strain", 0.2))
            c = unit.get_center()
            self.play(Snd("rip"), carry_together([t1, t2], unit, grips, 0.45, path=lambda e: c + UP * 0.45 * e, rise=0.45))
            c1 = unit.get_center()
            walk = (1.15, -3.8)
            self.play(carry_together([t1, t2], unit, grips, 2.2, walk=walk), t1.expression("neutral"), t2.expression("neutral"),
                      camera.reset(self, 1.2))
            c2 = unit.get_center()
            self.play(carry_together([t1, t2], unit, grips, 0.35, path=lambda e: c2 + P(-0.4, -0.35) * e, leans=(-0.3, 0.3)))
            for f in (t1, t2):
                f.bake_arm("L")
                f.bake_arm("R")
            land = P(truck.pt("bed_center")[0], truck.pt("bed_floor")[1] + unit.height / 2 - 0.05)
            unit.set_z_index(S.Z_TRUCK - 0.1)
            self.play(t1.release(unit, "throw", target=land, spin=-0.25, run_time=0.65, sides=("L", "R"), rest=False),
                      t1.pose({"shoulder_R": 2.3, "elbow_R": 0.2, "shoulder_L": 2.1, "elbow_L": 0.2, "spine": 0.15}, 0.3),
                      t2.pose({"shoulder_R": 2.3, "elbow_R": 0.2, "shoulder_L": 2.1, "elbow_L": 0.2, "spine": 0.15}, 0.3))
            self.play(Snd("crash", gain=1), truck.bounce(depth=0.2), unit.animate(rate_func=there_and_back, run_time=0.32).shift(DOWN * 0.2),
                      camera.shake(self, 0.16), FX.dust(P(land[0], truck.pt("bed_rail")[1]), 4.0),
                      impact_burst(P(land[0], truck.pt("bed_rail")[1] + 0.9), 1.5),
                      t1.pose("stand", 0.4), t2.pose("stand", 0.4))
            # the first trophy of the season: the rookie pries the LEMONNOX badge off the lemon and keeps it
            badge = unit.parts["badge"]
            t2.set_z_index(S.Z_TRUCK - 0.05)
            self.play(t2.reach("R", lambda: badge.get_center(), 0.3), t2.look_at(badge.get_center()))
            unit.remove(badge)
            self.add(badge.set_z_index(S.Z_HELD))
            attach_to(badge, lambda: badge.get_center(), lambda: t2.hand("R"))
            self.play(Snd("yank", gain=-8), t2.pose({"shoulder_R": 2.7, "elbow_R": 0.3}, 0.3, rush_from), t2.expression("happy", 0.2))
            self.play(Snd("ding", gain=-8), FX.sparkles([t2.hand("R") + P(0.25, 0.3)], 0.5, 9), Wait(0.25))
            self.play(t2.reach("R", lambda: t2.hip_point() + P(-0.2 * t2.sg, -0.05), 0.25), Succession(Wait(0.2), FadeOut(badge, run_time=0.1)))
            detach(badge)

        with self.block("new_unit"):
            new = PackageUnit(UCX + 8, G + 0.13, old=False)
            self.new_unit = new
            self.add(new)
            self.snd("whoosh_long", gain=-3)
            self.play(new.animate(rate_func=ease_out_back, run_time=1.1).shift(LEFT * 8),
                      t1.walk_to(-2.9, G, speed=1.6), t2.walk_to(T2_HOME, G, speed=1.6), camera.punch_in(self, WORK[0], WORK[1], 1.0))
            for f in (t1, t2):
                f.set_z_index(S.Z_FIGURE)
            self.snd("chime", gain=-4)
            self.play(new.arrive_sparkle(0.7), t1.face.turn_to(0.6), t2.face.turn_to(-0.6), run_time=0.85)

        with self.block("rewind"):
            new = self.new_unit
            self.snd("rewind", gain=-4)
            self.snd("creak", 0.75, gain=-6)
            self.snd("ping", 1.35, gain=-8)
            self.play(Succession(
                          AnimationGroup(LaggedStart(*[Transform(d, h, path_arc=1.4, run_time=0.55) for d, h in zip(self.ducts, self.duct_home)], lag_ratio=0.4),
                                         Succession(Wait(0.45), Snd("click")), Succession(Wait(0.7), Snd("click")),
                                         self.whip.end.animate(path_arc=-1.0, run_time=0.55).move_to(new.pt("whip_terminal")),
                                         self.whip.strip(False, 0.55)),
                          LaggedStart(self.side.peel_to(0.0, 0.4, ease_out_back), self.top.peel_to(0.0, 0.4, ease_out_back), lag_ratio=0.4),
                          LaggedStart(*[s.fly_in(run_time=0.3) for row in self.screw_rows for s in row], lag_ratio=0.1),
                          AnimationGroup(LaggedStart(*[s.drive_in(0.25) for row in self.screw_rows for s in row], lag_ratio=0.15),
                                         Snd("drill", 0.6))),   # the rewind runs the drilling backwards too: screws home
                      t1.look_at(new.get_center(), 0.3), t2.look_at(new.get_center(), 0.3),
                      Succession(Wait(1.6), AnimationGroup(t1.expression("surprised", 0.2), t2.expression("surprised", 0.2))))
            self.whip.connect_end(lambda: new.pt("whip_terminal"))

        with self.block("thread"):
            lv = self.lv
            self.play(camera.punch_in(self, P(0.3, 0.45), 0.6, 0.55), t1.walk_to(0.9, G, face=-1, run_time=0.55),
                      t2.walk_to(T2_HOME + 0.4, G, run_time=0.5))
            self.play(t1.pose({"drop": 0.9, "spine": 0.55}, 0.3), t1.reach("R", lambda: lv.end.get_center(), 0.3, lean=False))
            tip = P(0.12 * t1.sg, 0)  # wire tip leads the hand
            lv.connect_end(lambda: t1.hand("R") + tip)
            self.play(lv.reshape((0.7, -0.35), 0.25), t1.pose({"drop": 0.7, "spine": 0.35}, 0.25))
            self.play(t1.thread_wire(lv, new.pt("lv_terminal"), tip_offset=tip, pace=0.8))
            self.snd("ding", gain=-4)
            self.play(lv.strip(False, 0.3), FX.sparkles([new.pt("lv_terminal") + P(-0.3, 0.3), new.pt("lv_terminal") + P(0.25, 0.35)], 0.6, 12))
            lv.connect_end(lambda: new.pt("lv_terminal"))
            self.play(lv.reshape((-1.0, -0.4), 0.4), t1.exhale(), t1.pose("stand", 0.4))

        with self.block("power_up"):
            # tag off, power on (close up), then the payoff in the opening's framing: cold air, hum, thumbs-up
            tag, disc = self.lockout, self.disc
            chest = lambda: t1.hip_point() + P(0.18 * t1.sg, 1.0)
            self.background(t2.walk_to(1.15, G, face=-1, run_time=1.4))   # the rookie takes his place by the unit
            self.play(t1.walk_to(-2.9, G, face=-1, speed=2.0), camera.punch_in(self, disc.get_center() + P(0.35, -0.25), 0.3, 0.5))
            self.play(t1.reach("R", lambda: tag.pt("hang"), 0.2, lean=False))
            attach_to(tag, "hang", lambda: t1.hand("R"))
            self.play(t1.reach("R", chest, 0.2, lean=False), Succession(Wait(0.12), FadeOut(tag, run_time=0.08)))
            detach(tag)
            self.play(t1.push_switch(disc, True, run_time=0.2), Succession(Wait(0.25), Snd("clunk")))
            clock = ValueTracker(0.0)
            sup = self.duct_home[0].pt("center")[1]
            air = FX.cold_air(clock, [sup - 0.17, sup, sup + 0.17], new.pt("supply_open")[0] + 0.05, WX - 1.3)
            hum = FX.vibration_lines(clock, [(P(new.get_right()[0] + 0.05, G + 1.1), 0.0), (new.pt("top_center") + P(0.4, 0.1), PI / 2)])
            FX.hum_shake(new, clock)
            self.add(air, hum)
            self.background(tween_value(clock, 6.0, 6.0, rate_func=linear))
            self.snd("hum", 0.1, gain=-2)
            self.play(camera.punch_in(self, BOOKEND[0], BOOKEND[1], 0.75), t1.walk_to(-1.9, G, face=1, run_time=0.75),
                      Succession(Wait(0.4), t2.expression("happy", 0.3)))
            self.play(t1.thumbs_up(hold=0.65))
            # the rookie's own try: a leftover static spark off his thumb
            self.play(t2.thumb_try())
            self.play(t2.thumb_spoiled(AnimationGroup(Snd("zap", gain=-10),
                                                      spark_shower(t2.hand("R") + P(0, 0.2), 0.35, rate=90, speed=(1.2, 2.6),
                                                                   spread=(0.2, 2.9), colors=("#FFFFFF", "#BFE8FF", "#FFD54A")),
                                                      t2.t["hair"].animate(rate_func=there_and_back, run_time=0.6).set_value(1.0))))

        self.finish()
