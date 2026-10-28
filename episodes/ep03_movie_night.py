"""Smith Air Stick World, episode 03: movie night (frozen coil, the breaker panic).

Season 1, EP3 (see episodes/SERIES.md). The story, cause by cause: the AC blows nothing on a hot night -> the lead
finds the coil frozen solid -> he asks the rookie to shut that unit off at the panel -> callback: since EP1's zap
the rookie is terrified of live power, so he shuts off EVERY breaker (movie night goes black) -> the lead turns the
house back on and tags out only the furnace's breaker -> the filthy filter (the reason it froze) comes out in a dust
bomb -> new filter -> power on: air flows again, the ice melts, cold air. Lesson: lock out the right breaker.

Preview:  manim -ql -r 540,960 episodes/ep03_movie_night.py Ep03MovieNight
Final:    manim -qh --fps 60 -r 1080,1920 episodes/ep03_movie_night.py Ep03MovieNight
Retime to a voiceover by editing TIMING (seconds per scene; a scene that finishes early holds to its TIMING).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from manim import PI, AnimationGroup, FadeIn, FadeOut, Succession, ValueTracker, Wait, linear

from stickworld import camera
from stickworld import continuity as C
from stickworld import style as S
from stickworld.actions import Do, tween_value
from stickworld.audio import Snd
from stickworld.episode import EpisodeScene
from stickworld.face import KEEP
from stickworld.props import effects as FX
from stickworld.props.base import attach_to, detach, ground_shadow
from stickworld.props.effects_more import debris, heat_waves, lights_out, pop
from stickworld.props.home import TV, Couch, Filter, LockoutTag, WallClock
from stickworld.props.hvac_more import (ICE, BreakerPanel, CondensateDrain, EvapCoil, FilterRack, Furnace, Icicle, LineSet,
                                        Thermostat)
from stickworld.props.tools_more import Flashlight
from stickworld.props.vehicles import WorkTruck
from stickworld.rig import StickFigure
from stickworld.sets import driveway
from stickworld.sets_more import ROOM_COOL, ROOM_HOT, house_night
from stickworld.style import FRAME_H, P

# ---------------------------------------------------------------- layout: the house on top, the street below
F = -0.6             # house floor
STREET, CURB = -5.8, -2.7
TRUCK_FRONT = -3.95
FURN_X = 3.3         # furnace + coil in the closet
RACK_X = 1.85        # return filter rack beside it
PANEL = (1.75, F + 3.1)
FURNACE_BREAKER = 9  # the one circuit that should be off
LEAD_SPOT = 2.55     # in the closet, between the rack and the furnace
ROOKIE_SPOT = 0.35   # living-room side of the doorway
DOOR_X = 1.15        # standing in the doorway, at the panel


class Ep03MovieNight(EpisodeScene):
    EPISODE = 3
    TIMING = {
        "hook": 3.0,
        "arrive": 7.2,
        "diagnose": 4.4,
        "breakers": 9.2,
        "filter": 6.1,
        "power_on": 7.0,
        "finale": 2.2,
    }

    # ------------------------------------------------------------ set up the world
    def build(self):
        self.drive = driveway(STREET, CURB, F - 0.45)
        self.furnace = Furnace(FURN_X, F, mirror=True)
        self.coil = EvapCoil(FURN_X, self.furnace.pt("supply_top")[1] - 0.1, mirror=True, iced=True)
        self.icicle = Icicle(self.coil.pt("icicle"), length=0.6, width=0.15)   # the loose one the lead snaps off
        self.house = house_night(F, room_color=ROOM_HOT, trunk_x=FURN_X, trunk_y=self.coil.pt("top")[1])
        h = self.house
        self.ceil = h.pt("ceiling")[1]
        self.couch = Couch(-2.6, F, width=2.6, facing=1)
        self.tv = TV(-0.15, F, facing=-1, reach=3.4)
        self.thermo = Thermostat(h.pt("thermostat_spot"), temp=81)
        self.clock = WallClock(h.pt("clock_spot"), hour=8.6)
        self.panel = BreakerPanel(PANEL)
        self.rack = FilterRack((RACK_X, F + 0.75), width=0.75, height=0.9, dirty=True)
        st = self.coil.pt("lineset")
        self.lineset = LineSet([st, (st[0] - 0.2, st[1]), (st[0] - 0.2, self.ceil + 0.1)])
        d = self.coil.pt("drain")
        self.drain = CondensateDrain(d, direction=-1, stub=0.06, run=0.06, drop=d[1] - 0.06 - F)
        self.truck = WorkTruck(TRUCK_FRONT + 9, STREET, trophies=C.trophies(self.EPISODE))   # the season's score so far
        # the neighbour on the couch (feet on the floor, watching the TV)
        seat = self.couch.pt("seat")
        self.nb = StickFigure(seat[0], F, 1, accessory="bun", name="neighbor")
        self.nb.set(y=seat[1] + 0.08, legL_lock=0.0, legR_lock=0.0, hip_L=1.4, knee_L=-1.45, hip_R=1.5, knee_R=-1.5,
                    shoulder_L=0.35, elbow_L=0.9, shoulder_R=0.45, elbow_R=0.9)
        # the techs ride in the cab
        sit = dict(legL_lock=0.0, legR_lock=0.0, hip_L=1.35, knee_L=-2.6, hip_R=1.45, knee_R=-2.6,
                   shoulder_L=1.0, elbow_L=0.8, shoulder_R=1.1, elbow_R=0.8)
        self.lead = StickFigure(self.truck.pt("driver_seat")[0], STREET, -1, name="lead", rest_face=dict(mouth_curve=0.45))
        self.rookie = StickFigure(self.truck.pt("passenger_seat")[0], STREET, -1, accessory="cap", name="rookie",
                                  marks=C.rookie_marks(self.EPISODE))      # EP1's scorched cap, EP2's shin plaster
        for f in (self.lead, self.rookie):
            f.set(y=STREET + 0.72, **sit).set_z_index(S.Z_FIGURE_HIDDEN)
        self.new_filter = Filter((0, 0), width=0.55, height=1.2).set_z_index(S.Z_FIGURE_HIDDEN + 0.1)
        attach_to(self.new_filter, "grip", lambda: self.rookie.hand("R"))
        self.flash = Flashlight((0, 0), angle=PI, length=1.5)
        self.tag = LockoutTag(self.panel.pt(f"breaker_{FURNACE_BREAKER}"))
        self.dark = ValueTracker(0.0)
        x0, x1 = -4.65, 4.65
        self.night = lights_out(self.dark, (x0, F - 0.12, x1, self.ceil + 0.06), [self.nb, self.lead, self.rookie])
        self.add(self.drive, h, self.lineset, self.drain, self.rack, self.furnace, self.coil, self.icicle, self.panel, self.thermo,
                 self.clock, self.tv, self.couch, self.nb, self.truck, self.lead, self.rookie, self.new_filter, self.night,
                 ground_shadow(self.couch, F, width=2.6), ground_shadow(self.furnace, F),
                 ground_shadow(self.truck, STREET, width=6.0, height=0.22))

    # ------------------------------------------------------------ scenes
    def construct(self):
        self.build()
        self.episode_tag()
        lead, rookie, nb, panel, truck = self.lead, self.rookie, self.nb, self.panel, self.truck
        self.camera.frame.set(height=FRAME_H * 0.5).move_to(np.array([-1.5, 1.5, 0]))   # open on the problem
        head = nb.head_center()

        with self.block("hook"):
            # a hot room, and the ceiling vent gives nothing: the neighbour stares up at it, then at the 81
            reg = self.house.pt("register")
            self.play(heat_waves(head + np.array([0.3, 0.5, 0]), 1.3), FX.sweat(head, side=1), nb.expression("disappointed", 0.3),
                      nb.pose({"shoulder_R": 2.5, "elbow_R": 1.9}, 0.3), Succession(Wait(0.1), nb.look_at(reg, 0.25)),
                      Succession(Wait(0.85), nb.look_at(self.thermo.pt("screen"), 0.3)))
            self.play(camera.reset(self, 1.4), heat_waves(head + np.array([-0.4, 0.4, 0]), 1.2),
                      Succession(Wait(0.4), nb.pose({"shoulder_R": 0.45, "elbow_R": 0.9}, 0.4)))

        with self.block("arrive"):
            self.snd("truck")
            self.play(truck.drive_in(-9, 1.4, riders=(lead, rookie)))
            door = truck.pt("door_step")[0]
            self.play(lead.hop_out(truck, door - 0.35, STREET),
                      Succession(Wait(0.25), rookie.hop_out(truck, door + 0.25, STREET, run_time=0.6)),
                      Do(lambda: self.new_filter.set_z_index(S.Z_HELD)))
            self.play(lead.walk_to(LEAD_SPOT, F, speed=1.6), Succession(Wait(0.2), rookie.walk_to(ROOKIE_SPOT, F, speed=1.5)),
                      nb.look_at(np.array([0.6, F + 2.5, 0]), 0.3))

        panel_c = np.array(PANEL + (0,))
        with self.block("diagnose"):
            # why no cold air: the coil is frozen solid. The lead snaps an icicle off it and shows the rookie
            icicle = self.icicle
            self.play(camera.punch_in(self, np.array([2.1, 2.2, 0]), 0.42, 0.6), rookie.look_at(icicle.pt("tip")),
                      lead.grab(icicle, "R", "grip"))
            h0 = lead.hand("R")
            self.play(lead.reach("R", h0 + np.array([-0.22, -0.1, 0]), 0.1, lean=False), Snd("pop_small", gain=-6),
                      Snd("tink", gain=-4), debris(h0, width=0.2, n=4, fall=1.0, run_time=0.5, seed=11, colors=[ICE, S.WHITE]))
            self.play(lead.turn(-1, 0.2), lead.reach("R", lambda: lead.head_center() + np.array([-0.5, 0.0, 0]), 0.3, lean=False),
                      lead.look_at(rookie.head_center()))
            self.play(lead.expression("surprised", 0.15), rookie.expression("surprised", 0.15),
                      FX.sparkles([icicle.pt("tip") + np.array([0.05, 0.15, 0])], 0.5, 5), Wait(0.45))
            self.play(lead.release(icicle, "drop", ground=F, run_time=0.3, sound=False), Succession(Wait(0.1), Snd("tink", gain=-2)))
            self.play(FadeOut(icicle, run_time=0.1),
                      debris(np.array([icicle.get_center()[0], F + 0.08, 0]), width=0.3, n=5, fall=0.3, run_time=0.4, seed=12,
                             colors=[ICE, S.WHITE]))
            # shut that unit off: the lead points at the panel and gives the rookie the job
            self.play(lead.point_at(panel_c, 0.3), Succession(Wait(0.2), lead.look_at(rookie.head_center())))
            self.play(rookie.nod(2), rookie.expression("happy", 0.2), lead.let_go(("R",)))

        with self.block("breakers"):
            # callback to EP1: he remembers the zap, touches his scorched cap... and panics
            self.play(rookie.reach("R", lambda: rookie.head_center() + np.array([-0.1, 0.45, 0]), 0.3, lean=False),
                      rookie.expression("surprised", 0.2), camera.punch_in(self, np.array([-0.4, 1.8, 0]), 0.78, 0.8))
            self.play(rookie.walk_to(DOOR_X, F, run=True, run_time=0.45, face=1), rookie.expression("strain", 0.2))
            self.play(panel.open_door(True, 0.3), rookie.reach("R", panel.pt("door_handle"), 0.25, lean=False))
            steps = lambda k, n: AnimationGroup(tween_value(self.dark, 0.55 * (k + 1) / n, 0.06),
                                                *( [self.tv.screen(False, 0.05)] if k == 5 else []))
            self.play(rookie.sweep_breakers(panel, on=False, per=0.07, each=steps,
                                            at_main=tween_value(self.dark, 1.0, 0.06)))
            # pitch dark: just eyes
            self.play(Snd("crickets", gain=-6), rookie.expression("happy", 0.2), Wait(0.45),
                      Succession(Wait(0.25), lead.expression("squint", 0.2, hold=1.1)),
                      Succession(Wait(0.4), nb.look_at(np.array([1.0, F + 3.2, 0]), 0.2), rookie.blink()))
            self.play(Succession(Wait(0.3), rookie.blink()), Wait(0.7))
            # the lead's flashlight clicks on, he runs every circuit back on except the furnace's and tags it out
            self.flash.set_z_index(S.Z_FX - 0.6)
            pocket = lambda: lead.hip_point() + np.array([0.28, 0.05, 0])   # back pocket (he faces left)
            self.play(lead.reach("L", pocket, 0.2, lean=False))
            self.flash.hold(lambda: lead.hand("L"), aim=panel_c + np.array([-0.15, 0.1, 0]))   # beam stays on the panel
            self.play(Do(lambda: lead.bake_arm("L")), FadeIn(self.flash, scale=0.6, run_time=0.12),
                      self.flash.beam(True, 0.1), Snd("click", gain=-4), lead.pose({"shoulder_L": 0.25, "elbow_L": 2.2}, 0.2))
            self.play(rookie.let_go(("R",)), rookie.step_back(0.7, run_time=0.4), lead.walk_to(2.45, F, face=-1, run_time=0.3))
            back_on = [i for i in range(panel.n_breakers) if i != FURNACE_BREAKER]
            self.play(lead.sweep_breakers(panel, on=True, per=0.06, order=back_on,
                                          at_main=AnimationGroup(tween_value(self.dark, 0.0, 0.1), self.tv.screen(True, 0.1),
                                                                 self.flash.beam(False, 0.1))))
            self.play(lead.reach("R", self.tag.pt("hang"), 0.25, lean=False), FadeIn(self.tag, scale=0.4, run_time=0.25),
                      Succession(Wait(0.2), Snd("tink", gain=-4)), nb.expression("happy", 0.2),
                      lead.reach("L", pocket, 0.25, lean=False), Succession(Wait(0.2), FadeOut(self.flash, run_time=0.1)),
                      camera.punch_in(self, np.array([2.5, 2.2, 0]), 0.36, 0.5))
            detach(self.flash)
            # only THIS breaker is off, and it's THAT unit's: the tag, then the furnace
            self.play(lead.let_go(("L",)), lead.point_at(self.tag.pt("tag"), 0.3))
            self.play(lead.turn(1, 0.2), lead.point_at(np.array([3.1, 1.9, 0]), 0.3))
            self.play(Wait(0.25))
            self.play(lead.turn(-1, 0.2), lead.let_go(("R",)), lead.look_at(rookie.head_center()), rookie.nod(2),
                      camera.reset(self, 0.6))

        with self.block("filter"):
            grip = lambda: self.rack.pt("grip")
            filt = self.rack.parts["filter"]
            old_c = filt.get_center().copy()
            self.play(lead.pose({"drop": 0.7, "spine": 0.45, "neck": -0.2}, 0.3), lead.reach("R", grip, 0.3, lean=False),
                      rookie.walk_to(1.3, F, face=1, run_time=0.4), camera.punch_in(self, np.array([1.9, 1.5, 0]), 0.5, 0.6))
            attach_to(filt, grip, lambda: lead.hand("R"))
            filt.set_z_index(S.Z_HELD)
            self.play(lead.pose({"drop": 0.0, "spine": -0.05, "neck": 0.0}, 0.45), rookie.pose({"spine": 0.45, "neck": -0.1}, 0.4),
                      Succession(Wait(0.25), Snd("rip", gain=-10)))
            puff = filt.get_center() + np.array([-0.3, 0.3, 0])
            self.play(FX.smoke(puff, n=9, r=0.4, spread=0.7, rise=0.6, run_time=1.0, color="#9E968A", seed=4),
                      Do(lambda: rookie.add_mark("dusty")), Snd("cough", gain=-2), rookie.face.close_eyes(0.1, hold=0.5),
                      lead.turn(1, 0.2), lead.face.close_eyes(0.1, hold=0.4), rookie.pose({"spine": -0.1, "neck": 0.1}, 0.3))
            self.play(lead.release(filt, "throw", target=P(3.95, F + 0.62), spin=-0.6, run_time=0.45), Snd("thump", gain=-10),
                      rookie.expression("disappointed", 0.2))
            # the new filter, clean white: rookie hands it over, it slides home with a click
            self.play(lead.turn(-1, 0.15), rookie.reach("R", P(1.95, F + 2.3), 0.3, lean=False),
                      lead.reach("R", lambda: self.new_filter.pt("grip"), 0.3, lean=False))
            detach(self.new_filter)
            attach_to(self.new_filter, "grip", lambda: lead.hand("R"))
            self.play(rookie.let_go(("R",)), lead.pose({"drop": 0.6, "spine": 0.4}, 0.35))
            self.play(lead.release(self.new_filter, "place", target=old_c, run_time=0.35, rest=False), Snd("click"),
                      Do(lambda: self.new_filter.set_z_index(S.Z_PROP - 0.1)))
            self.play(pop(self.new_filter, 1.08, 0.2), FX.sparkles([old_c + np.array([0.35, 0.5, 0])], 0.45, 6),
                      lead.pose({"drop": 0.0, "spine": 0.0}, 0.3), lead.let_go(("R",)), camera.reset(self, 0.7))

        with self.block("power_on"):
            # clean filter in, power back on: air moves across the coil again, the ice lets go, THEN it blows cold
            self.play(lead.pose("stand", 0.25), lead.reach("R", self.tag.pt("hang"), 0.3, lean=False), camera.reset(self, 0.5))
            run = ValueTracker(0.0)   # the blower running: hum lines and a shake for the rest of the episode
            hum = FX.vibration_lines(run, [(np.array([self.furnace.get_right()[0] + 0.15, F + 1.4, 0]), 0.0)])
            FX.hum_shake(self.furnace, run)
            self.add(hum)
            self.background(tween_value(run, 12.0, 12.0, rate_func=linear))
            self.play(FadeOut(self.tag, run_time=0.15), panel.flip(FURNACE_BREAKER, True, 0.12), Succession(Wait(0.1), Snd("clunk")),
                      Succession(Wait(0.2), Snd("hum", gain=-6)))
            self.play(lead.let_go(("R",)), panel.open_door(False, 0.3), lead.look_at(self.coil.pt("top")),
                      rookie.look_at(self.coil.pt("top")), camera.punch_in(self, np.array([2.6, 2.2, 0]), 0.45, 0.5))
            self.play(self.coil.melt(1.6), self.drain.drip(n=5, run_time=1.6, fall=0.6),
                      Succession(Wait(0.3), Snd("tink", gain=-14), Wait(0.4), Snd("tink", gain=-14), Wait(0.4), Snd("tink", gain=-14)),
                      Succession(Wait(1.1), FX.sparkles([self.coil.pt("top") + np.array([0.2, -0.4, 0])], 0.5, 8)))
            # ice gone: cold air pours out of the ceiling vent, the 81 ticks down, the room turns cool
            air_t = ValueTracker(0.0)
            reg = self.house.pt("register")
            air = FX.cold_air(air_t, [reg[0] - 0.25, reg[0], reg[0] + 0.25], reg[1] - 0.05, F + 2.0, vertical=True)
            self.add(air)
            digits = self.thermo.parts["digits"]
            ticks = [Succession(Wait(0.7 + 0.26 * i), AnimationGroup(self.thermo.set_temp(80 - i, run_time=0.04), pop(digits, 1.15, 0.16),
                                                                    Snd("click", gain=-14))) for i in range(9)]
            self.play(camera.reset(self, 0.6), air_t.animate(run_time=3.6, rate_func=linear).set_value(3.6),
                      Succession(Wait(0.3), self.house.parts["room"].animate(run_time=2.6).set_fill(ROOM_COOL)),
                      Succession(Wait(0.8), AnimationGroup(nb.expression("happy", 0.3, hold=KEEP), nb.face.close_eyes(0.3, hold=KEEP))),
                      *ticks)

        with self.block("finale"):
            self.play(lead.thumbs_up(), camera.punch_in(self, np.array([1.2, 2.0, 0]), 0.7, 1.6),
                      Succession(Wait(0.3), AnimationGroup(Do(lambda: rookie.remove_mark("dusty")),
                                                           FX.smoke(rookie.head_center(), n=4, r=0.2, spread=0.3, run_time=0.6, color="#B7B0A4", seed=8),
                                                           rookie.expression("happy", 0.2))))

        self.finish()
