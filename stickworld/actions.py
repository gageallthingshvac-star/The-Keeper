"""Action library (skill doc section 8).

Every action is a StickFigure method that returns an Animation and only moves trackers. Bigger actions are built
from RigAnim (a per-frame function of eased progress) so they can lock feet, pin hands to moving objects and keep
held objects attached. Pose angles are relative and mirror with face_dir, so every pose works facing either way.
"""
import numpy as np
from manim import (Animation, AnimationGroup, Mobject, Succession, Wait, linear, rush_from, rush_into, smooth,
                   there_and_back)
from manim.utils.rate_functions import ease_in_out_sine, ease_out_back, ease_out_bounce, ease_out_cubic

from . import style as S
from .audio import Snd, footsteps, snd
from .props.base import attach_to, detach, is_attached
from .props import effects as FX

ARM_LEN = S.UPPER_ARM + S.FOREARM


# ---------------------------------------------------------------- animation plumbing
class RigAnim(Animation):
    """Calls update(eased_alpha) every frame; setup() runs when the animation actually starts."""

    def __init__(self, update, setup=None, run_time=1.0, rate_func=smooth):
        super().__init__(Mobject(), run_time=run_time, rate_func=rate_func, remover=True)
        self._update, self._setup = update, setup

    def begin(self):
        if self._setup:
            self._setup()
        super().begin()

    def interpolate_mobject(self, alpha):
        self._update(self.rate_func(alpha))


def Do(fn):
    """A zero-length step that runs fn when reached (for attaching/releasing inside a Succession)."""
    return RigAnim(lambda a: None, setup=fn, run_time=1e-3, rate_func=linear)


def lerp(a, b, t):
    return a + (b - a) * t


def rel_angle(frm, to, sg):
    """Angle of to-frm measured from straight down, + toward facing sg."""
    return float(np.arctan2((to[0] - frm[0]) * sg, -(to[1] - frm[1])))


# ---------------------------------------------------------------- named poses (relative angles; doc section 5)
POSES = {
    "stand": dict(spine=0.0, neck=0.0, shoulder_L=-0.12, elbow_L=0.18, shoulder_R=0.12, elbow_R=0.18, drop=0.0),
    "crouch": dict(spine=0.45, neck=-0.15, shoulder_L=0.5, elbow_L=0.6, shoulder_R=0.6, elbow_R=0.6, drop=0.8),
    "reach_forward": dict(spine=0.15, shoulder_R=1.45, elbow_R=0.1, shoulder_L=0.2, elbow_L=0.3),
    "reach_up": dict(spine=-0.05, shoulder_R=2.9, elbow_R=0.15, shoulder_L=0.1, elbow_L=0.3),
    "pull_back": dict(spine=-0.35, shoulder_R=1.25, elbow_R=0.3, shoulder_L=1.1, elbow_L=0.35),
    "carry_low": dict(spine=-0.05, shoulder_R=0.45, elbow_R=0.9, shoulder_L=0.35, elbow_L=0.9),
    "carry_high": dict(spine=-0.1, shoulder_R=1.9, elbow_R=0.6, shoulder_L=1.8, elbow_L=0.6),
    "lean_back": dict(spine=-0.3),
    "point": dict(shoulder_R=1.55, elbow_R=0.0, shoulder_L=-0.12, elbow_L=0.18),
    "arms_crossed": dict(shoulder_L=0.4, elbow_L=2.2, shoulder_R=0.45, elbow_R=2.25),
    "hands_on_hips": dict(shoulder_L=-0.55, elbow_L=1.75, shoulder_R=-0.5, elbow_R=1.75),
    "shrug": dict(shoulder_L=0.45, elbow_L=1.35, shoulder_R=0.55, elbow_R=1.35, neck=-0.12),
    "flinch": dict(spine=0.35, neck=0.2, shoulder_R=2.6, elbow_R=1.9, shoulder_L=2.4, elbow_L=1.8, drop=0.55),
    "celebrate": dict(shoulder_R=3.0, elbow_R=0.35, shoulder_L=-0.25, elbow_L=0.3),
    "sit": dict(spine=0.0, hip_L=1.25, knee_L=-1.45, hip_R=1.35, knee_R=-1.5, shoulder_L=0.5, elbow_L=0.9,
                shoulder_R=0.6, elbow_R=0.9),
}
ARM_KEYS = {"L": ("shoulder_L", "elbow_L"), "R": ("shoulder_R", "elbow_R")}
LEG_KEYS = {"L": ("hip_L", "knee_L"), "R": ("hip_R", "knee_R")}


# ---------------------------------------------------------------- gait (planted feet)
class Gait:
    """Foot-planted walking: each foot stays fixed until its turn to step, then lifts and swings in an arc to the
    next foothold. The hips dip so the planted foot stays reachable and rise a little at mid-stance."""

    def __init__(self, fig, hip1, run_time, rate_func=smooth, run=False, steps=None, max_stride=None):
        self.rf = rate_func
        self.h0 = fig.hip_point()
        self.h1 = np.array([hip1[0], hip1[1], 0.0])
        d = self.h1 - self.h0
        dist = float(np.linalg.norm(d))
        self.dirx = float(np.sign(d[0])) if abs(d[0]) > 0.05 else fig.sg
        step_time = 0.19 if run else 0.27
        max_stride = max_stride or (1.25 if run else 0.85)
        self.lift = 0.3 if run else 0.18
        self.bob = 0.09 if run else 0.06
        self.start = [p.copy() for p in fig.feet()]
        feet = [p.copy() for p in self.start]
        if steps is None:
            want = max(1, int(round(run_time / step_time)) - 1)
            stride = float(np.clip(dist / want, 0.3, max_stride))
            steps = max(1, int(round(dist / stride)))
        slots = steps + 1
        u = d / dist if dist > 1e-6 else np.array([self.dirx, 0, 0])
        g0 = min(feet[0][1], feet[1][1])
        g1 = self.h1[1] - S.STAND_HIP
        k = 0 if np.dot(feet[0] - self.h0, u) <= np.dot(feet[1] - self.h0, u) else 1  # back foot steps first
        self.steps = []
        for i in range(slots):
            t0, t1 = i / slots, (i + 1) / slots
            if i >= slots - 2:  # last two steps settle into a standing stance at the destination
                lead = i == slots - 2
                to = np.array([self.h1[0] + (1 if lead else -1) * self.dirx * S.STANCE, g1, 0.0])
            else:
                e = rate_func(t1)
                to = self.h0 + d * e + u * (dist / steps) * 0.5
                to[1] = g0 + (g1 - g0) * e
            self.steps.append((k, t0, t1, feet[k].copy(), to))
            feet[k] = to
            k = 1 - k

    def at(self, alpha):
        hip = self.h0 + (self.h1 - self.h0) * self.rf(alpha)
        feet, swing = [], None
        for k in (0, 1):
            pos = self.start[k]
            for kk, t0, t1, a, b in self.steps:
                if kk != k or alpha < t0:
                    continue
                if alpha >= t1:
                    pos = b
                else:
                    w = (alpha - t0) / (t1 - t0)
                    lift = self.lift * min(1.0, float(np.linalg.norm(b - a)) / 0.3)
                    pos = a + (b - a) * (w * w * (3 - 2 * w)) + np.array([0, lift * np.sin(np.pi * w), 0])
                    swing = (k, w)
            feet.append(pos)
        if swing:
            hip[1] += self.bob * np.sin(np.pi * swing[1])  # rise as the swing leg passes under the body
        reach = S.LEG * 0.985
        for k in (0, 1):
            if swing and swing[0] == k:
                continue
            dx = feet[k][0] - hip[0]
            if abs(dx) < reach:
                hip[1] = min(hip[1], feet[k][1] + np.sqrt(reach ** 2 - dx ** 2))
        return hip, feet, swing


# ---------------------------------------------------------------- the mixin
class ActionsMixin:
    # ------------------------------------------------------------ helpers
    def _drawn_arm_angles(self, side):
        J, sg = self.solve(), self.sg
        up = rel_angle(J["shoulder"], J[f"elbow_{side}"], sg)
        fo = rel_angle(J[f"elbow_{side}"], J[f"hand_{side}"], sg)
        spine = self.v("spine")
        return up - spine, fo - up

    def bake_arm(self, side):
        """Freeze whatever the arm is drawn as into its FK angles and stop IK (so it moves with the body)."""
        sh, el = self._drawn_arm_angles(side)
        self.set(**{f"shoulder_{side}": sh, f"elbow_{side}": max(0.0, el), f"arm{side}_lock": 0.0})
        self.pins[side] = None

    def bake_leg(self, side):
        J, sg = self.solve(), self.sg
        th = rel_angle(J["hip"], J[f"knee_{side}"], sg)
        sh = rel_angle(J[f"knee_{side}"], J[f"foot_{side}"], sg)
        self.set(**{f"hip_{side}": th, f"knee_{side}": min(0.0, sh - th), f"leg{side}_lock": 0.0})

    def plant_feet(self, ground=None):
        """Lock both legs with the feet where they are drawn now (optionally snapped to a ground height)."""
        J = self.solve()
        for side in "LR":
            f = J[f"foot_{side}"]
            self.set(**{f"foot{side}_x": f[0], f"foot{side}_y": f[1] if ground is None else ground, f"leg{side}_lock": 1.0})

    def lock_hand(self, side, point=None):
        h = self.hand(side) if point is None else point
        self.set(**{f"hand{side}_x": h[0], f"hand{side}_y": h[1], f"arm{side}_lock": 1.0})

    def pin(self, side, fn):
        """Keep a hand on a moving point (fn() -> point) via IK until unpin/bake."""
        self.lock_hand(side)
        self.pins[side] = fn

    def unpin(self, side):
        h = self.hand(side)
        self.pins[side] = None
        self.lock_hand(side, h)

    def _lean_for(self, side, target):
        """Spine lean needed so target is within arm's reach (0 change if already reachable)."""
        spine0 = self.v("spine")
        f = self.v("face_dir")
        hip = self.hip_point()

        def dist(sp):
            sh = hip + S.TORSO * np.array([f * np.sin(sp), np.cos(sp), 0])
            return float(np.linalg.norm(np.array(target[:2]) - sh[:2]))

        if dist(spine0) <= ARM_LEN * 0.97:
            return spine0
        best = min(np.linspace(-1.2, 1.3, 126), key=lambda sp: (max(0, dist(sp) - ARM_LEN * 0.95), abs(sp - spine0)))
        return float(best)

    # ------------------------------------------------------------ poses and turning
    def pose(self, target, run_time=S.SMALL_GESTURE, rate_func=smooth, **extra):
        """Tween many joints at once. target: a POSES name or a dict of joint -> angle (+ optional 'drop' to
        crouch with planted feet). Arms named in the pose are released from IK first."""
        tgt = dict(POSES[target]) if isinstance(target, str) else dict(target)
        tgt.update(extra)
        st = {}

        def setup():
            for side, (sh, el) in ARM_KEYS.items():
                if (sh in tgt or el in tgt) and self.v(f"arm{side}_lock") > 0:
                    self.bake_arm(side)
            if "drop" in tgt and min(self.v("legL_lock"), self.v("legR_lock")) < 1:
                self.plant_feet()
            st["start"] = {k: self.v(k) for k in tgt if k in self.t}
            if "drop" in tgt:
                st["start"]["y"] = self.v("y")
                st["y1"] = self.ground_y() + S.STAND_HIP - tgt["drop"]

        def update(a):
            for k, v0 in st["start"].items():
                if k == "y":
                    self.t["y"].set_value(lerp(v0, st["y1"], a))
                else:
                    self.t[k].set_value(lerp(v0, tgt[k], a))

        return RigAnim(update, setup, run_time, rate_func)

    def turn(self, direction, run_time=0.2, face_turn=None):
        """Face right (+1) or left (-1): mirrors the rig's angles and turns the face."""
        ft = 0.5 * direction if face_turn is None else face_turn
        return AnimationGroup(self.t["face_dir"].animate(run_time=run_time).set_value(float(direction)),
                              self.face.turn_to(ft, run_time))

    def expression(self, name, run_time=0.25):
        return self.face.expression(name, run_time)

    def look_at(self, target, run_time=0.2):
        return self.face.look_at(target, run_time)

    def blink(self):
        return self.face.blink()

    def shake_head(self, times=3, slow=False, eyes_closed=False):
        return self.face.shake_head(times, slow, eyes_closed)

    def nod(self, times=2):
        return self.face.nod(times)

    def talk(self, duration, seed=0):
        return self.face.talk(duration, seed)

    # ------------------------------------------------------------ locomotion
    def walk_to(self, x, ground=None, speed=1.0, run_time=None, face=None, hold=(), hands=None, run=False,
                steps=None, max_stride=None, rate_func=smooth, sound=True, gain=-15.0, **target):
        """Real walk cycle with planted feet to x, standing on `ground` (default: the ground it's on now).
        face can differ from travel (walking backward); hold=("R",) keeps an arm still (carrying);
        hands={"R": fn} keeps a hand on a moving point."""
        hands = hands or {}
        st = {}

        def setup():
            ty = (self.ground_y() if ground is None else ground) + S.STAND_HIP
            rt = self._walk_rt
            for side in "LR":
                if self.v(f"leg{side}_lock") < 1:
                    self.plant_feet()
                    break
            g = Gait(self, (x, ty), rt, rate_func, run=run, steps=steps, max_stride=max_stride)
            st["g"] = g
            st["face0"], st["face1"] = self.v("face_dir"), (g.dirx if face is None else face)
            st["turn0"] = self.face.v("turn")
            st["turn1"] = 0.65 * st["face1"]
            st["start"] = {k: self.v(k) for k in target}
            st["arms"] = {s: (self.v(f"shoulder_{s}"), self.v(f"elbow_{s}")) for s in "LR"}
            st["spine0"] = self.v("spine")
            for side, fn in hands.items():
                self.pin(side, fn)
            if sound:
                footsteps(self, g.steps, rt, gain)

        def update(alpha):
            g = st["g"]
            hip, feet, swing = g.at(alpha)
            turn = min(1.0, alpha / 0.15)
            env = min(1.0, alpha / 0.12, (1 - alpha) / 0.12)
            self.set(x=hip[0], y=hip[1], footL_x=feet[0][0], footL_y=feet[0][1], footR_x=feet[1][0], footR_y=feet[1][1],
                     face_dir=lerp(st["face0"], st["face1"], turn))
            self.face.set(turn=lerp(st["turn0"], st["turn1"], turn))
            lean = (0.2 if run else 0.06) * env * (1 if st["face1"] == g.dirx else -0.5)
            self.set(spine=st["spine0"] * (1 - env) + lean if "spine" not in target else
                     lerp(st["start"]["spine"], target["spine"], g.rf(alpha)))
            for k, v0 in st["start"].items():
                if k != "spine":
                    self.t[k].set_value(lerp(v0, target[k], g.rf(alpha)))
            if swing:
                k, w = swing
                amp = (0.8 if run else 0.45) * env
                fwd = -amp + 2 * amp * (w * w * (3 - 2 * w))
                arm_sw = {"R": fwd, "L": -fwd} if k == 0 else {"L": fwd, "R": -fwd}
                same_dir = 1 if st["face1"] == g.dirx else -1
                for s in "LR":
                    if s in hold or s in hands or self.v(f"arm{s}_lock") > 0:
                        continue
                    sh0, el0 = st["arms"][s]
                    self.set(**{f"shoulder_{s}": sh0 * (1 - env) + arm_sw[s] * same_dir,
                                f"elbow_{s}": el0 * (1 - env) + (1.1 if run else 0.35) * env})

        ty_guess = (self.ground_y() if ground is None else ground) + S.STAND_HIP
        dist0 = float(np.hypot(x - self.v("x"), ty_guess - self.v("y")))
        self._walk_rt = run_time or max(0.5, dist0 / ((3.8 if run else 1.9) * speed) + 0.25)
        return RigAnim(update, setup, self._walk_rt, linear)

    def run_to(self, x, ground=None, **kw):
        return self.walk_to(x, ground, run=True, **kw)

    def step_back(self, distance=0.6, run_time=0.45, **kw):
        """A short backward step or two while still facing the same way."""
        return self.walk_to(self.v("x") - self.sg * distance, face=self.sg, run_time=run_time, **kw)

    def hop_out(self, truck, land_x, ground, run_time=0.7, tumble=False):
        """Door opens, the figure steps (or tumbles) out of the cab onto the ground beside it, door closes."""
        st = {}

        def setup():
            self.set_z_index(S.Z_FIGURE)
            for side in "LR":
                self.bake_leg(side)
            st["x0"], st["y0"] = self.v("x"), self.v("y")
            st["start"] = {k: self.v(k) for k in ("hip_L", "knee_L", "hip_R", "knee_R", "spine", "shoulder_L",
                                                  "elbow_L", "shoulder_R", "elbow_R")}
            if tumble:
                st["end"] = dict(hip_L=0.5, knee_L=-0.4, hip_R=0.1, knee_R=-0.8, spine=1.45, shoulder_L=2.6,
                                 elbow_L=0.2, shoulder_R=2.4, elbow_R=0.2)
                st["y1"] = ground + 0.45
            else:
                st["end"] = dict(hip_L=-0.1, knee_L=-0.15, hip_R=0.35, knee_R=-0.5, spine=0.08, shoulder_L=0.4,
                                 elbow_L=0.4, shoulder_R=-0.3, elbow_R=0.4)
                st["y1"] = ground + S.STAND_HIP

        def update(a):
            arc = (0.9 if tumble else 0.45) * 4 * a * (1 - a)
            self.set(x=lerp(st["x0"], land_x, a), y=lerp(st["y0"], st["y1"], a) + arc)
            for k, v0 in st["start"].items():
                self.t[k].set_value(lerp(v0, st["end"][k], a))

        out = RigAnim(update, setup, run_time, ease_out_cubic if tumble else smooth)
        land = [Do(lambda: self.plant_feet(ground)), Snd("thump", gain=-6 if tumble else -12)]
        if not tumble:
            land.append(self.pose("stand", 0.25))
        return Succession(truck.open_door(), out, *land, truck.close_door())

    def get_up(self, ground, run_time=0.5):
        """From lying face-down (after a tumble) back to standing."""
        st = {}

        def setup():
            st["x"] = self.v("x")
            st["s"] = {k: self.v(k) for k in ("spine", "y", "shoulder_L", "elbow_L", "shoulder_R", "elbow_R")}
            for side in "LR":
                self.bake_leg(side)
            st["legs"] = {k: self.v(k) for k in ("hip_L", "knee_L", "hip_R", "knee_R")}

        def update(a):
            end = dict(spine=0.0, y=ground + S.STAND_HIP, shoulder_L=-0.12, elbow_L=0.18, shoulder_R=0.12, elbow_R=0.18)
            for k, v0 in st["s"].items():
                self.t[k].set_value(lerp(v0, end[k], a))
            for k, v0 in st["legs"].items():
                self.t[k].set_value(lerp(v0, 0.0, a))

        return Succession(RigAnim(update, setup, run_time, ease_out_back), Do(lambda: self.plant_feet(ground)))

    # ------------------------------------------------------------ hands
    def reach(self, side, point, run_time=0.35, rate_func=smooth, lean=True, pin=False, **target):
        """Two-bone IK: the hand travels to point (or a callable). Leans the spine if it's out of reach."""
        tgt = point if callable(point) else (lambda p=np.array(point, dtype=float): p)
        st = {}

        def setup():
            p0 = self.hand(side)
            st["p0"] = p0
            self.pins[side] = None
            self.lock_hand(side, p0)
            st["spine0"] = self.v("spine")
            st["spine1"] = self._lean_for(side, tgt()) if lean else st["spine0"]
            if "spine" in target:
                st["spine1"] = target["spine"]
            st["start"] = {k: self.v(k) for k in target if k != "spine"}

        def update(a):
            p = st["p0"] + (tgt() - st["p0"]) * a
            self.set(**{f"hand{side}_x": p[0], f"hand{side}_y": p[1]})
            if abs(st["spine1"] - st["spine0"]) > 1e-4:  # only lean when needed, so a pose can drive the spine too
                self.set(spine=lerp(st["spine0"], st["spine1"], a))
            for k, v0 in st["start"].items():
                self.t[k].set_value(lerp(v0, target[k], a))

        steps = [RigAnim(update, setup, run_time, rate_func)]
        if pin:
            steps.append(Do(lambda: self.pin(side, tgt)))
        return Succession(*steps)

    def grab(self, obj, side="R", grip="handle", rotate=False, look=True, run_time=0.35, hang=None):
        """look -> reach -> 0.1 s -> grab. The object then follows the hand (and its forearm angle if rotate)."""
        grip_fn = lambda: obj.pt(grip)

        def attach():
            self.bake_arm(side)
            rot = None
            if rotate:
                a0 = self.solve()[f"forearm_angle_{side}"] * self.sg
                rot = lambda: self.solve()[f"forearm_angle_{side}"] * self.sg - a0
            attach_to(obj, grip, lambda: self.hand(side), rotate_fn=rot, name=f"held_{self.name}_{side}")
            obj._z_before_grab = obj.z_index
            obj.set_z_index(max(obj.z_index, S.Z_HELD) if hang is None else hang)

        steps = []
        if look:
            steps.append(self.look_at(grip_fn(), 0.15))
        steps += [self.reach(side, grip_fn, run_time), Wait(0.1), Do(attach)]
        return Succession(*steps)

    def grab2(self, obj, grip_L="grip_L", grip_R="grip_R", run_time=0.4, look=True, keep_pinned=False):
        """Two-handed grab: the object follows the midpoint of the hands and turns with the line between them.
        keep_pinned leaves the hands IK-pinned to the grips (the object then drives the hands instead)."""
        gL, gR = (lambda: obj.pt(grip_L)), (lambda: obj.pt(grip_R))

        def attach():
            if keep_pinned:
                self.pin("L", gL)
                self.pin("R", gR)
                return
            self.bake_arm("L")
            self.bake_arm("R")
            hand_line = lambda: self.hand("R") - self.hand("L")
            v0 = hand_line()
            a0 = float(np.arctan2(v0[1], v0[0]))
            mid_obj = lambda: (obj.pt(grip_L) + obj.pt(grip_R)) / 2
            mid_hands = lambda: (self.hand("L") + self.hand("R")) / 2
            rot = lambda: float(np.arctan2(hand_line()[1], hand_line()[0])) - a0
            attach_to(obj, mid_obj, mid_hands, rotate_fn=rot, name=f"held2_{self.name}")

        steps = []
        if look:
            steps.append(self.look_at((gL() + gR()) / 2, 0.15))
        steps += [AnimationGroup(self.reach("L", gL, run_time), self.reach("R", gR, run_time)), Wait(0.1), Do(attach)]
        return Succession(*steps)

    def release(self, obj, settle="drop", target=None, ground=None, heavy=False, run_time=None, spin=0.0,
                sides=("R",), rest=True, sound=True):
        """drop: falls with gravity and a small bounce (THUD if heavy). place: moves to target with the hands on it,
        then lets go. throw: parabolic arc with spin to target."""
        def let_go():
            detach(obj)
            if getattr(obj, "_z_before_grab", None) is not None:  # back to its own layer once it's not in a hand
                obj.set_z_index(obj._z_before_grab)
                obj._z_before_grab = None

        steps = [Do(let_go)]
        st = {}
        if settle == "drop":
            rt = run_time or 0.4

            def setup():
                st["p"] = obj.get_center()
                st["dy"] = (ground if ground is not None else self.ground_y()) - obj.get_bottom()[1]

            def update(a):
                obj.move_to(st["p"] + np.array([0, st["dy"] * a, 0]))

            fall = [RigAnim(update, setup, rt, ease_out_bounce)]
            if sound:
                fall.append(Succession(Wait(rt * 0.36), Snd("thud" if heavy else "thump", gain=-6 if heavy else -10)))
            steps.append(AnimationGroup(*fall))
        elif settle == "place":
            def setup_place():
                for s in sides:
                    off = self.hand(s) - obj.get_center()
                    self.pin(s, lambda o=off: obj.get_center() + o)

            steps = [Do(lambda: detach(obj)), Do(setup_place), obj.animate(run_time=run_time or 0.5).move_to(target), Do(let_go)]
            steps += [Do(lambda s=s: self.bake_arm(s)) for s in sides]
        elif settle == "throw":
            rt = run_time or 0.65

            def setup_throw():
                st["p0"] = obj.get_center()
                st["copy"] = obj.copy()

            def update_throw(a):
                p0, p1 = st["p0"], np.array(target, dtype=float)
                ctrl = (p0 + p1) / 2 + np.array([0, max(1.2, abs(p1[0] - p0[0]) * 0.6), 0])
                pos = (1 - a) ** 2 * p0 + 2 * (1 - a) * a * ctrl + a * a * p1
                obj.become(st["copy"].copy().rotate(spin * a).move_to(pos))

            throw = [RigAnim(update_throw, setup_throw, rt, linear)]
            if sound:
                throw.append(Snd("whoosh", gain=-6))
            steps.append(AnimationGroup(*throw))
        if rest:
            steps.append(AnimationGroup(*[self.pose({ARM_KEYS[s][0]: 0.12 if s == "R" else -0.12, ARM_KEYS[s][1]: 0.18}, 0.3)
                                          for s in sides]))
        return Succession(*steps)

    # ------------------------------------------------------------ physical actions
    def pull(self, side="R", toward=None, strength=1.0, step=0.5, run_time=0.6):
        """Anticipation (lean in 0.15 s), then a strong pull back with a spine lean and a back step."""
        return Succession(self.pose({"spine": 0.2}, 0.15),
                          AnimationGroup(self.pose({"spine": -0.35 * strength}, run_time * 0.6, rush_from),
                                         self.step_back(step, run_time)))

    def yank_plug(self, obj, foot_point, grip_L="grip_L", grip_R="grip_R", stumble=1.1, stumble_y=0.0,
                  strain_time=0.45, cue="pop_big", pre=None, grab_time=0.35, wobble=True):
        """Foot on the unit, grab, lean back straining, POP, stumble back two steps holding the object, wobble.
        pre: a callable run at the POP (e.g. disconnect the object from what it was plugged into)."""
        lean_back = {"spine": -0.35}
        strain = [self.pose({"spine": -0.42 if k % 2 == 0 else -0.33}, 0.08, linear) for k in range(int(strain_time / 0.08))]
        steps = [self.grab2(obj, grip_L, grip_R, grab_time, look=False),
                 AnimationGroup(self.foot_to("R", foot_point, 0.25), self.pose(lean_back, 0.25), self.expression("strain", 0.2)),
                 Succession(*strain)]
        if pre is not None:
            steps.append(Do(pre))
        steps += [AnimationGroup(Snd(cue), self.expression("surprised", 0.1),
                                 self.walk_to(self.v("x") - self.sg * stumble, self.ground_y() + stumble_y,
                                              face=self.sg, hold=("L", "R"), run_time=0.55, rate_func=ease_out_cubic,
                                              spine=-0.45, max_stride=1.0))]
        if wobble:
            steps += [self.pose({"spine": -0.12}, 0.15), self.pose({"spine": 0.08}, 0.15)]
        steps.append(self.expression("neutral", 0.15))
        return Succession(*steps)

    def foot_to(self, side, point, run_time=0.3):
        """Move one foot to a point (e.g. plant it on the unit) with the leg in IK."""
        st = {}

        def setup():
            st["p0"] = np.array([self.v(f"foot{side}_x"), self.v(f"foot{side}_y")])

        def update(a):
            p = st["p0"] + (np.array(point[:2]) - st["p0"]) * a
            lift = 0.25 * np.sin(np.pi * a)
            self.set(**{f"foot{side}_x": p[0], f"foot{side}_y": p[1] + lift})

        return RigAnim(update, setup, run_time, smooth)

    def thread_wire(self, wire, terminal, side="R", tip_offset=None, ready_dx=0.45, pace=1.0):
        """Tongue out + squint, hand inches toward the terminal, misses past it twice with tiny jerks, then succeeds;
        relieved exhale. The wire end must already be held (attached) to this hand."""
        tip_offset = np.array([0.12 * self.sg, 0, 0]) if tip_offset is None else tip_offset  # the tip leads
        T = np.array(terminal, dtype=float)
        # hand position that puts the wire tip at the terminal + (dx along the facing direction, dy); dx < 0 = short of it
        hand_for = lambda dx, dy: T + np.array([dx * self.sg, dy, 0]) - tip_offset
        ready = hand_for(-ready_dx, 0.0)
        k = pace
        return Succession(
            AnimationGroup(self.reach(side, ready, 0.35 * k, lean=False), self.expression("tongue_out", 0.25), self.look_at(T, 0.2)),
            self.reach(side, hand_for(-0.1, 0.16), 0.3 * k, rate_func=ease_in_out_sine, lean=False),
            AnimationGroup(Snd("tink", gain=-4), self.reach(side, hand_for(-0.3, 0.2), 0.18 * k, rate_func=rush_from, lean=False)),
            self.reach(side, hand_for(-0.1, -0.17), 0.3 * k, rate_func=ease_in_out_sine, lean=False),
            AnimationGroup(Snd("tink", gain=-4), self.reach(side, hand_for(-0.32, -0.12), 0.18 * k, rate_func=rush_from, lean=False)),
            self.reach(side, hand_for(-0.12, 0.0), 0.45 * k, lean=False),
            self.reach(side, hand_for(0.0, 0.0), 0.35 * k, rate_func=ease_in_out_sine, lean=False),
        )

    def exhale(self):
        return Succession(AnimationGroup(self.expression("neutral", 0.2), self.pose({"spine": 0.1, "neck": 0.12}, 0.25)),
                          AnimationGroup(self.pose({"spine": 0.0, "neck": 0.0}, 0.3), self.expression("happy", 0.25)))

    def lift(self, obj, grip_L="grip_L", grip_R="grip_R", run_time=0.6):
        """Crouch with knees bent and back straight, grab, stand up straining."""
        return Succession(self.pose({"drop": 0.6, "spine": 0.15, "neck": -0.1}, 0.35),
                          self.grab2(obj, grip_L, grip_R),
                          AnimationGroup(self.expression("strain", 0.2), self.pose({"drop": 0.0, "spine": -0.05}, run_time)),
                          self.expression("neutral", 0.3))

    def carry_walk(self, x, ground=None, run_time=None, **kw):
        return self.walk_to(x, ground, run_time=run_time, hold=("L", "R"), max_stride=0.6, **kw)

    def push_switch(self, switch, on, side="R", run_time=0.25):
        """Reach the handle, then flip it with a small wrist snap; the hand rides the handle."""
        handle = lambda: switch.pt("handle")
        return Succession(self.reach(side, handle, 0.3), Wait(0.08),
                          Do(lambda: self.pin(side, handle)),
                          switch.flip(on, run_time),
                          Do(lambda: self.unpin(side)))

    # ------------------------------------------------------------ gestures
    def point_at(self, target, run_time=0.35):
        side = "R"
        J = self.solve()
        return AnimationGroup(self.look_at(target), self.reach(side, J["shoulder"] + (np.array(target) - J["shoulder"]) /
                                                              max(1e-6, np.linalg.norm(np.array(target) - J["shoulder"])) * ARM_LEN * 0.98, run_time))

    def shrug(self):
        return Succession(AnimationGroup(self.pose("shrug", 0.3), self.expression("neutral", 0.2)), Wait(0.35),
                          self.pose("stand", 0.3))

    def facepalm(self, side="R"):
        face = lambda: self.solve()["head"] + np.array([0.12 * self.sg, 0.0, 0])
        return Succession(AnimationGroup(self.reach(side, face, 0.3), self.pose({"neck": 0.25, "spine": 0.1}, 0.3),
                                         self.face.close_eyes(0.2)),
                          Wait(0.5), AnimationGroup(self.pose("stand", 0.35), self.face.open_eyes(0.2)))

    def hands_on_hips(self):
        return self.pose("hands_on_hips", 0.35)

    def arms_crossed(self):
        return self.pose("arms_crossed", 0.4)

    def celebrate(self, times=2):
        pumps = []
        for _ in range(times):
            pumps += [self.pose({"shoulder_R": 3.0, "elbow_R": 0.35}, 0.15, rush_from),
                      self.pose({"shoulder_R": 2.4, "elbow_R": 1.2}, 0.15)]
        return Succession(self.expression("happy", 0.15), *pumps, self.pose("stand", 0.3))

    def wipe_brow(self, side="R"):
        brow = lambda dx: self.solve()["head"] + np.array([dx * self.sg, 0.22, 0])
        return Succession(self.reach(side, lambda: brow(-0.25), 0.25), self.reach(side, lambda: brow(0.3), 0.3),
                          self.pose("stand", 0.3))

    def flinch(self, peek=True):
        steps = [AnimationGroup(self.pose("flinch", 0.2, rush_from), self.expression("squint", 0.1), self.face.close_eyes(0.1)),
                 Wait(0.4)]
        if peek:
            steps += [AnimationGroup(self.pose({"shoulder_R": 1.6, "elbow_R": 1.6, "drop": 0.35}, 0.5), self.face.open_eyes(0.3),
                                     self.expression("surprised", 0.3))]
        return Succession(*steps)

    def zapped(self, source=None, side="R", run_time=0.5):
        """ZAP: body jitters at 20 Hz, hair/cap spikes straight up, X eyes, arcs from the source, smoke off the head,
        then a dazed recovery with stars."""
        arcs = [FX.zap_arcs(lambda: np.array(source, dtype=float), lambda: self.hand(side), run_time)] if source is not None else []
        shock = AnimationGroup(Snd("zap", gain=1),
                               self.t["jitter"].animate(run_time=0.05).set_value(1.0),
                               self.t["hair"].animate(run_time=0.08).set_value(1.0),
                               self.face._to(0.05, xeyes=1.0, mouth_open=0.6), *arcs)
        settle = AnimationGroup(self.t["jitter"].animate(run_time=0.15).set_value(0.0),
                                self.pose("stand", 0.3), self.face._to(0.2, mouth_open=0.25, mouth_curve=-0.2))
        dazed = AnimationGroup(Snd("fizz", gain=-6), FX.smoke(self.solve()["head"] + np.array([0, 0.55, 0]), n=4, seed=2, run_time=0.75),
                               FX.stars(lambda: self.solve()["head"], 1.0),
                               Succession(Wait(0.75), self.face._to(0.1, xeyes=0.0), self.blink(), self.expression("neutral", 0.15)))
        return Succession(shock, Wait(run_time), settle, dazed)

    def hair_down(self, run_time=0.6):
        return self.t["hair"].animate(run_time=run_time).set_value(0.0)


# ---------------------------------------------------------------- two people, one object
def carry_together(figs, obj, grips, run_time, path=None, walk=None, rise=0.0, rot=None, rate_func=smooth,
                   leans=None, max_stride=0.5, step_gain=-12.0):
    """Several figures move one object with their hands locked on its grip points.
    path(a) -> object centre (default: follow the figures' average travel); walk=(dx, dy) makes every figure step
    (planted feet) by that offset; rise stands them up out of a squat by that much with feet planted;
    rot(a) -> object rotation in radians."""
    st = {}

    def setup():
        st["c0"] = obj.get_center()
        st["copy"] = obj.copy()
        st["s0"] = {f: {k: f.v(k) for k in ("x", "y", "spine")} for f in figs}
        st["gaits"] = {}
        for f in figs:
            for side, g in grips[f].items():
                f.pin(side, lambda g=g: obj.pt(g))
            if walk is not None:
                hip1 = (f.v("x") + walk[0], f.v("y") + walk[1])
                gait = Gait(f, hip1, run_time * 1.3, rate_func, max_stride=max_stride)
                st["gaits"][f] = gait
                footsteps(f, gait.steps, run_time, step_gain)

    def update(a):
        e = rate_func(a)
        if path is not None:
            c = path(e)
        elif walk is not None:
            c = st["c0"] + np.array([walk[0], walk[1], 0]) * e
        else:
            c = st["c0"]
        ang = rot(e) if rot is not None else 0.0
        obj.become(st["copy"].copy().rotate(ang).move_to(c))
        for i, f in enumerate(figs):
            s0 = st["s0"][f]
            if f in st["gaits"]:
                hip, feet, _ = st["gaits"][f].at(a)
                f.set(x=hip[0], y=hip[1], footL_x=feet[0][0], footL_y=feet[0][1], footR_x=feet[1][0], footR_y=feet[1][1])
            elif rise:
                f.set(y=s0["y"] + rise * e)
            if leans is not None:
                f.set(spine=lerp(s0["spine"], leans[i], e))

    return RigAnim(update, setup, run_time, linear)
