"""Action library (skill doc section 8).

Every action is a StickFigure method that returns an Animation and only moves trackers. Bigger actions are built
from RigAnim (a per-frame function of eased progress) so they can lock feet, pin hands to moving objects and keep
held objects attached. Pose angles are relative and mirror with face_dir, so every pose works facing either way.
"""
import numpy as np
from manim import (Animation, AnimationGroup, FadeIn, FadeOut, Mobject, Succession, Wait, linear, rush_from, rush_into,
                   smooth, there_and_back)
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


def tween_value(tracker, value, run_time=0.3, rate_func=smooth):
    """Animate a ValueTracker to value, reading its start when the step actually begins. Use this instead of
    tracker.animate inside long Successions / action hooks (Manim's .animate on trackers can be overwritten there)."""
    st = {}
    return RigAnim(lambda a: tracker.set_value(st["v0"] + (value - st["v0"]) * a),
                   lambda: st.update(v0=tracker.get_value()), run_time, rate_func)


def Do(fn):
    """A zero-length step that runs fn when reached (for attaching/releasing inside a Succession)."""
    return RigAnim(lambda a: None, setup=fn, run_time=1e-3, rate_func=linear)


def lerp(a, b, t):
    return a + (b - a) * t


def _wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


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

    def relocate(self, x, ground=None):
        """Move the whole figure to x (standing on ground) instantly, pose kept, carried things following: for an
        off-screen move (walking out one side of the frame and back in somewhere else, e.g. around to the front door).
        Call it with Do() while the figure is out of shot."""
        g0 = self.ground_y()
        g = g0 if ground is None else ground
        dx, dy = x - self.v("x"), g - g0
        vals = {"x": x, "y": self.v("y") + dy}
        for side in "LR":
            vals[f"foot{side}_x"] = self.v(f"foot{side}_x") + dx
            vals[f"foot{side}_y"] = self.v(f"foot{side}_y") + dy
        self.set(**vals)

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

    def expression(self, name, run_time=0.25, hold=None):
        """Timed expression: holds for its beat, then the face eases back to rest (hold=KEEP to keep it)."""
        return self.face.expression(name, run_time, hold)

    def look_at(self, target, run_time=0.2):
        return self.face.look_at(target, run_time)

    def blink(self):
        return self.face.blink()

    def wink(self, hold=0.5):
        return self.face.wink(hold)

    def thumbs_up(self, hold=0.7, wink=True, sound="ding", face=None):
        """Job-done signature: face to the camera, big smile, near hand comes up in front of the chest and pops into a
        thumbs-up with a twinkle and a ding (and a wink), holds, then the arm drops back to rest. face=+1/-1 turns the
        body first so the hand comes up clear of whatever he's standing next to."""
        from manim import Star, UpdateFromAlphaFunc
        proto = Star(4, outer_radius=0.3, inner_radius=0.08).set_fill(S.SPARK, 1).set_stroke(S.INK, 2).set_z_index(S.Z_FX)
        star = proto.copy().scale(0.01)

        def twinkle(m, a):
            tip = self.hand("R") + np.array([0.3 * self.sg, 0.38, 0])
            m.become(proto.copy().scale(max(0.01, float(np.sin(np.pi * a)))).rotate(1.5 * a).move_to(tip))

        show = [self.t["thumb"].animate(run_time=0.15, rate_func=ease_out_back).set_value(1.0),
                UpdateFromAlphaFunc(star, twinkle, run_time=0.5, rate_func=linear, introducer=True, remover=True)]
        if sound:
            show.append(Snd(sound, gain=-4))
        if wink:
            show.append(self.face.wink(hold * 0.7))
        lead_in = [self.turn(face, 0.2)] if face is not None else []
        return Succession(*lead_in, AnimationGroup(self.pose({"shoulder_R": 0.55, "elbow_R": 2.05}, 0.3),
                                         self.face._to(0.3, turn=0.0, up=0.05), self.expression("happy", 0.3)),
                          AnimationGroup(*show), Wait(max(0.0, hold - 0.5)),
                          AnimationGroup(self.t["thumb"].animate(run_time=0.15).set_value(0.0),
                                         self.pose({"shoulder_R": 0.12, "elbow_R": 0.18}, 0.3)))

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

    # ------------------------------------------------------------ contact-to-contact motion (ladders, scrambling)
    def _hand_goal(self, side):
        """Where an IK-locked hand is being driven now (its pin or its target trackers), else None."""
        if self.v(f"arm{side}_lock") < 0.5:
            return None
        pin = self.pins[side]
        return pin if pin is not None else np.array([self.v(f"hand{side}_x"), self.v(f"hand{side}_y")])

    def keyframes(self, keys, run_time=None, step_time=0.32, lift=0.16, creak=False, gain=-15.0):
        """Pose-to-pose motion with planted contacts. keys: list of dicts with any of hip=(x, y), footL/footR=(x, y),
        handL/handR=(x, y), a callable, or None (arm back to rest in FK), spine, neck and other joint angles.
        Between keys every foot or hand that changes lifts off in a small arc and lands on its new point, so
        nothing slides; the hips glide from stance to stance. Footstep cue on each foot landing (and a creak on
        every other one with creak=True, for ladders)."""
        n = len(keys)
        rt = run_time or step_time * n
        st = {}
        res = lambda q: np.array((q() if callable(q) else q)[:2], dtype=float)

        def setup():
            if min(self.v("legL_lock"), self.v("legR_lock")) < 1:
                self.plant_feet()
            angles = sorted({k for key in keys for k in key if k in self.t and k not in ("x", "y")})
            s0 = dict(hip=self.hip_point()[:2].copy(), footL=np.array([self.v("footL_x"), self.v("footL_y")]),
                      footR=np.array([self.v("footR_x"), self.v("footR_y")]),
                      handL=self._hand_goal("L"), handR=self._hand_goal("R"), **{k: self.v(k) for k in angles})
            states = [s0]
            for key in keys:
                nxt = dict(states[-1])
                for k, v in key.items():
                    nxt[k] = v if (v is None or callable(v) or k not in ("hip", "footL", "footR", "handL", "handR")) \
                        else np.array(v[:2], dtype=float)
                states.append(nxt)
            st.update(states=states, angles=angles, seg=-1)
            for side in "LR":
                self.pins[side] = None
            rng = np.random.default_rng(n * 7 + len(self.name))
            k_land = 0
            for i in range(n):
                for f in ("footL", "footR"):
                    a, b = states[i][f], states[i + 1][f]
                    if float(np.linalg.norm(b - a)) > 0.05:
                        snd(f"step{rng.integers(1, 4)}", (i + 1) / n * rt, gain + rng.uniform(-2, 1))
                        if creak and k_land % 2 == 0:
                            snd("creak", (i + 0.6) / n * rt, gain + 2)
                        k_land += 1

        def begin_segment(i):
            a = st["states"][i]
            st["hand0"] = {}
            for side in "LR":
                cur, nxt = a[f"hand{side}"], st["states"][i + 1][f"hand{side}"]
                st["hand0"][side] = self.hand(side)[:2].copy() if cur is None else None
                if cur is not None and nxt is None:  # letting go: FK rest pose fades in under the IK
                    self.set(**{f"shoulder_{side}": 0.12 if side == "R" else -0.12, f"elbow_{side}": 0.18})

        def update(alpha):
            seg = min(int(alpha * n), n - 1)
            if seg != st["seg"]:
                for j in range(st["seg"] + 1, seg + 1):
                    begin_segment(j)
                st["seg"] = seg
            w = alpha * n - seg
            e = smooth(w)
            a, b = st["states"][seg], st["states"][seg + 1]
            sg = self.sg
            hip = a["hip"] + (b["hip"] - a["hip"]) * e
            self.set(x=hip[0], y=hip[1])
            for f in ("footL", "footR"):
                p0, p1 = a[f], b[f]
                p = p0 + (p1 - p0) * e
                if float(np.linalg.norm(p1 - p0)) > 0.05:
                    p = p + lift * np.sin(np.pi * w) * np.array([-0.45 * sg, 1.0])
                self.set(**{f"{f}_x": p[0], f"{f}_y": p[1]})
            for side in "LR":
                h0, h1 = a[f"hand{side}"], b[f"hand{side}"]
                if h0 is None and h1 is None:
                    self.set(**{f"arm{side}_lock": 0.0})
                    continue
                if h1 is None:  # releasing: hold the old point while the FK rest pose takes over
                    p, lock = res(h0), 1.0 - e
                else:
                    start = st["hand0"][side] if h0 is None else res(h0)
                    p = start + (res(h1) - start) * e
                    if h0 is not None and float(np.linalg.norm(res(h1) - res(h0))) > 0.05:
                        p = p + 0.09 * np.sin(np.pi * w) * np.array([-0.6 * sg, 0.8])
                    lock = e if h0 is None else 1.0
                self.set(**{f"hand{side}_x": p[0], f"hand{side}_y": p[1], f"arm{side}_lock": lock})
            for k in st["angles"]:
                self.t[k].set_value(lerp(a[k], b[k], e))

        return RigAnim(update, setup, rt, linear)

    def climb(self, treads, landing, lip=None, floor_y=None, down=False, step_time=0.3, hunch=0.0):
        """Climb a ladder or pull-down stair the right way: chest to the ladder, body close and parallel to the rails,
        knees bending in toward it. treads = tread points bottom to top (the set's tread_0..), landing = the floor
        point to stand on at the top, lip = hand-hold at the top edge (the attic set's "lip"). Feet go tread to tread,
        alternating, the opposite hand moves up the rail with each step, eyes up the ladder; at the top both feet come
        onto the top tread, the hands go to the lip and the floor, one foot steps up, then the other.
        Going up, start standing at climb_start(treads) facing the ladder. down=True comes down the same way, still
        facing the ladder (backing down, eyes down): start standing at the landing facing the ladder, end on the floor
        (floor_y, default one riser under tread_0)."""
        T = [np.array(p[:2], dtype=float) for p in treads]
        sg = 1.0 if T[-1][0] >= T[0][0] else -1.0
        m = (T[-1][0] - T[0][0]) / (T[-1][1] - T[0][1])
        lean = float(np.arctan(abs(m)))                   # ladder angle from vertical; the body leans the same
        n = np.array([-sg * np.cos(lean), np.sin(lean)])  # off the ladder, toward the climber
        rise = T[1][1] - T[0][1]
        rail = lambda y: np.array([T[0][0] + (y - T[0][1]) * m, y])
        L = np.array(landing[:2], dtype=float)
        lip = np.array(lip[:2], dtype=float) if lip is not None else L + np.array([-sg * 0.35, 0.25])
        floor = floor_y if floor_y is not None else (self.ground_y() if not down else T[0][1] - rise)
        x0 = self.v("x") if not down else climb_start(treads)
        hip_on = lambda t: rail(t[1] + 0.95) + n * 0.42  # hips tucked in close to the rails
        K = [dict(hip=np.array([x0, floor + S.STAND_HIP]), footL=np.array([x0 - sg * S.STANCE, floor]),
                  footR=np.array([x0 + sg * S.STANCE, floor]), handL=None, handR=None, spine=0.0, neck=0.0)]

        def step(**kw):
            nxt = dict(K[-1])
            nxt.update({k: (np.array(v, dtype=float) if isinstance(v, (tuple, list, np.ndarray)) else v) for k, v in kw.items()})
            K.append(nxt)

        h0 = hip_on(T[0]) + np.array([-sg * 0.1, -0.12])  # first step: the other foot is still on the floor
        step(footR=T[0], hip=h0, handL=rail(h0[1] + 1.65), handR=rail(h0[1] + 0.9), spine=lean, neck=-0.1)
        for j in range(1, len(T)):
            foot, hand = ("footL", "handR") if j % 2 else ("footR", "handL")
            h = hip_on(T[j])
            step(**{foot: T[j], hand: rail(h[1] + 1.65), "hip": h})
        top = T[-1]
        lower = "footL" if (len(T) - 1) % 2 == 0 else "footR"   # the foot still on the tread below the top one
        upper = "footR" if lower == "footL" else "footL"
        A = np.array([L[0] - sg * S.STANCE, L[1]])
        B = np.array([L[0] + sg * S.STANCE, L[1]])
        step(**{lower: top + np.array([-sg * 0.06, 0]), "hip": top + np.array([-sg * 0.12, 1.3]), "handL": lip,
                "handR": np.array([A[0] - sg * 0.05, L[1] + 0.03]), "spine": 0.5, "neck": -0.2})
        step(**{lower: A, "hip": np.array([lip[0] - sg * 0.1, L[1] + 0.5]), "handL": None, "handR": None, "spine": 0.5})
        step(**{upper: B, "hip": np.array([L[0], L[1] + S.STAND_HIP]), "spine": hunch, "neck": 0.0})
        keys = K[1:] if not down else K[-2::-1]
        rt = step_time * (0.85 if down else 1.0) * len(keys)
        eyes = 0.3 if not down else -0.3
        return Succession(self.turn(sg, 0.2, face_turn=0.65 * sg),   # chest to the ladder, always
                          AnimationGroup(self.keyframes(keys, run_time=rt, creak=True),
                                         Succession(self.face._to(0.25, up=eyes), Wait(max(0.0, rt - 0.5)),
                                                    self.face._to(0.25, up=0.0))))

    # ------------------------------------------------------------ attic mishaps
    def fall_through(self, hole_x, floor_y=None, hole=None, depth=None, run_time=0.45):
        """Step onto a gap between joists and plunge one leg through the ceiling up to the hip: the foot nearest
        hole_x steps onto it, the leg drops straight through while the hips hit the floor and the other knee folds up;
        arms fly up, surprised face, CRASH. hole: a CeilingHole prop that bursts open (with debris falling under
        it) on impact. The stuck leg is remembered for kick_leg() and pull_out()."""
        F = self.ground_y() if floor_y is None else floor_y
        depth = depth if depth is not None else S.LEG * 0.92
        st = {}

        def setup():
            feet = self.feet()
            k = "L" if abs(feet[0][0] - hole_x) <= abs(feet[1][0] - hole_x) else "R"
            st["k"] = k
            st["f0"] = np.array([self.v(f"foot{k}_x"), self.v(f"foot{k}_y")])
            st["hip0"] = self.hip_point()[:2].copy()
            self._stuck = dict(side=k, hole_x=hole_x, floor=F)

        def step_onto(a):
            k = st["k"]
            p = st["f0"] + (np.array([hole_x, F]) - st["f0"]) * a + np.array([0, 0.15 * np.sin(np.pi * a)])
            hip = st["hip0"] + np.array([(hole_x - st["f0"][0]) * 0.45 * a, 0])
            self.set(**{f"foot{k}_x": p[0], f"foot{k}_y": p[1]}, x=hip[0], y=hip[1])

        def plunge(a):
            k = st["k"]
            hip1 = np.array([hole_x, F + 0.12])
            hipA = st["hip0"] + np.array([(hole_x - st["f0"][0]) * 0.45, 0])
            hip = hipA + (hip1 - hipA) * a
            self.set(x=hip[0], y=hip[1], **{f"foot{k}_x": hole_x, f"foot{k}_y": F - (depth - 0.12) * a})

        hit = [Snd("crash", gain=-3), Snd("rip", gain=-6)]
        if hole is not None:
            hit += [hole.burst(0.15), FX.debris(hole.pt("bottom"), run_time=1.1)]
        flail = dict(shoulder_L=2.6, elbow_L=0.5, shoulder_R=2.8, elbow_R=0.4, spine=-0.1, neck=-0.2)
        return Succession(RigAnim(step_onto, setup, run_time * 0.6, smooth),
                          AnimationGroup(RigAnim(plunge, None, 0.16, rush_into), self.pose(flail, 0.16, rush_from),
                                         self.face._to(0.1, mouth_open=0.7), self.expression("surprised", 0.1),
                                         self.t["hair"].animate(run_time=0.1).set_value(0.6), *hit))

    def kick_leg(self, times=3, run_time=0.9):
        """Flail the leg stuck through the ceiling (after fall_through)."""
        k, hx, F = self._stuck["side"], self._stuck["hole_x"], self._stuck["floor"]
        st = {}

        def setup():
            st["y"] = self.v(f"foot{k}_y")

        def update(a):
            ph = 2 * np.pi * times * a
            self.set(**{f"foot{k}_x": hx + 0.2 * np.sin(ph), f"foot{k}_y": st["y"] + 0.12 * (1 - np.cos(ph)) * 0.5})

        return RigAnim(update, setup, run_time, linear)

    # ------------------------------------------------------------ bags and hand tools
    def _back_spot(self):
        """Where a slung bag's handle rides (middle of the back) and the angle it hangs at (flat against the back)."""
        J = self.solve()
        d = J["shoulder"] - J["hip"]
        d = d / max(1e-6, float(np.linalg.norm(d)))
        b = np.array([-self.sg * d[1], self.sg * d[0], 0.0])        # points out of his back
        spot = J["hip"] + (J["shoulder"] - J["hip"]) * 0.72 + b * 0.1
        return spot, float(np.arctan2(b[1], b[0])) + np.pi / 2

    @staticmethod
    def _hang_angle(obj, grip):
        v = obj.pt("center") - obj.pt(grip)
        return float(np.arctan2(v[1], v[0])) + np.pi / 2                # 0 = hanging upright from its handle

    def sling(self, obj, grip="handle", side="R", run_time=0.5):
        """Swing a bag onto his back by its handle (both hands free for a ladder): the hand lifts it over the shoulder
        and it settles flat against his back like a pack, riding there (and leaning with him) until unsling().
        Grabs it first unless it is already in a hand."""
        st = {}

        def setup():
            detach(obj)
            obj._z_before_grab = None
            obj.set_z_index(S.Z_FIGURE - 0.4)
            st["p0"], st["a0"] = obj.pt(grip).copy(), self._hang_angle(obj, grip)
            self.pin(side, lambda: obj.pt(grip))

        def update(a):
            spot, ang = self._back_spot()
            want = st["a0"] + _wrap(ang - st["a0"]) * a
            obj.rotate(want - self._hang_angle(obj, grip), about_point=obj.pt(grip))
            p = st["p0"] + (spot - st["p0"]) * a + np.array([0, 0.3 * np.sin(np.pi * a), 0])
            obj.shift(p - obj.pt(grip))

        def hang():
            a0 = self._back_spot()[1]
            attach_to(obj, grip, lambda: self._back_spot()[0], rotate_fn=lambda: _wrap(self._back_spot()[1] - a0),
                      name=f"slung_{self.name}")

        steps = [] if is_attached(obj) else [self.grab(obj, side, grip)]
        steps += [RigAnim(update, setup, run_time, smooth), Do(hang), self.let_go((side,), 0.3)]
        return Succession(*steps)

    def wear(self, obj, grip="handle"):
        """Put a bag on his back instantly (the end state of sling()): for a figure who arrives already carrying it."""
        detach(obj)
        obj._z_before_grab = None
        obj.set_z_index(S.Z_FIGURE - 0.4)
        spot, ang = self._back_spot()
        obj.rotate(ang - self._hang_angle(obj, grip), about_point=obj.pt(grip))
        obj.shift(spot - obj.pt(grip))
        a0 = ang
        attach_to(obj, grip, lambda: self._back_spot()[0], rotate_fn=lambda: _wrap(self._back_spot()[1] - a0),
                  name=f"slung_{self.name}")
        return obj

    def unsling(self, obj, at, grip="handle", side="R", z=S.Z_PROP_FRONT, run_time=0.55):
        """Take a slung bag off his back and set it down upright with its bottom centre at `at` (crouching)."""
        st = {}

        def setup():
            detach(obj)
            st["a0"], st["c0"] = self._hang_angle(obj, grip), obj.pt("center").copy()
            upright = obj.copy().rotate(-st["a0"], about_point=obj.pt(grip))
            st["c1"] = np.array([at[0], at[1] + upright.pt("center")[1] - upright.get_bottom()[1], 0.0])
            obj.set_z_index(S.Z_HELD)
            self.pin(side, lambda: obj.pt(grip))

        def update(a):
            obj.rotate(st["a0"] * (1 - a) - self._hang_angle(obj, grip), about_point=obj.pt("center"))
            c = st["c0"] + (st["c1"] - st["c0"]) * a + np.array([0, 0.25 * np.sin(np.pi * a), 0])
            obj.shift(c - obj.pt("center"))

        return Succession(self.reach(side, lambda: obj.pt(grip), 0.3, lean=False),
                          AnimationGroup(RigAnim(update, setup, run_time, smooth),
                                         self.pose({"drop": 0.55, "spine": 0.45, "neck": -0.2}, run_time)),
                          Do(lambda: obj.set_z_index(z)), Snd("thump", gain=-14),
                          AnimationGroup(self.pose({"drop": 0.0, "spine": 0.0, "neck": 0.0}, 0.3), self.let_go((side,), 0.3)))

    def fetch_tool(self, bag, tool, side="R", grip="grip"):
        """Crouch, reach into the bag's opening and come up holding the tool (it appears in the hand at the opening)."""
        def take():
            tool.shift(self.hand(side) - tool.pt(grip))
            attach_to(tool, grip, lambda: self.hand(side), name=f"held_{self.name}_{side}")
            tool.set_z_index(S.Z_HELD)

        return Succession(AnimationGroup(self.pose({"drop": 0.55, "spine": 0.5, "neck": -0.25}, 0.3),
                                         self.reach(side, lambda: bag.pt("opening"), 0.3, lean=False)),
                          Do(take), AnimationGroup(FadeIn(tool, scale=0.6, run_time=0.12), Snd("tools", gain=-10)),
                          AnimationGroup(self.pose({"drop": 0.0, "spine": 0.1, "neck": 0.0}, 0.3),
                                         self.reach(side, lambda: self.solve()["shoulder"] + np.array([self.sg * 0.55, -0.35, 0]),
                                                    0.3, lean=False)))

    def stow_tool(self, bag, tool, side="R"):
        """Crouch and put the tool back in the bag; the hand comes back empty."""
        return Succession(AnimationGroup(self.pose({"drop": 0.55, "spine": 0.5, "neck": -0.25}, 0.3),
                                         self.reach(side, lambda: bag.pt("opening"), 0.3, lean=False)),
                          Do(lambda: detach(tool)), AnimationGroup(FadeOut(tool, scale=0.6, run_time=0.12), Snd("tools", gain=-12)),
                          AnimationGroup(self.pose({"drop": 0.0, "spine": 0.0, "neck": 0.0}, 0.3), self.let_go((side,), 0.3)))

    def use_tool(self, tool, point, tip="tip", grip="grip", side="R", turns=3, run_time=0.9, sound="click", radius=0.05):
        """Put the tool's working point on a spot and work it: the hand goes round in small circles (a tubing cutter
        walking round a pipe, a screwdriver turning) with a sound each turn; turns=0 just holds it there (a torch
        on a joint). The tool must be held in that hand (fetch_tool)."""
        st = {}
        P0 = np.array([point[0], point[1], 0.0])

        def setup():
            st["c"] = P0 - (tool.pt(tip) - tool.pt(grip))
            for i in range(turns):
                if sound:
                    snd(sound, (i + 0.5) / max(turns, 1) * run_time, -6)

        def update(a):
            ang = 2 * np.pi * turns * a
            p = st["c"] + radius * np.array([np.sin(ang), 0.5 * (1 - np.cos(ang)), 0]) * (1 if turns else 0)
            self.set(**{f"hand{side}_x": p[0], f"hand{side}_y": p[1], f"arm{side}_lock": 1.0})

        to_spot = self.reach(side, lambda: P0 - (tool.pt(tip) - tool.pt(grip)), 0.3, lean=False)
        return Succession(AnimationGroup(to_spot, self.look_at(P0, 0.2)), RigAnim(update, setup, run_time, linear))

    def sweep_breakers(self, panel, on=False, side="R", order=None, per=0.075, main=True, each=None, at_main=None):
        """Run a hand down the breaker panel flipping every breaker (click, click, click...) and the main last:
        the panicked everything-off, or the satisfying everything-back-on. The door must be open.
        each(k, n) -> an animation to run with the k-th flip (lights dimming one circuit at a time); at_main -> an
        animation to run as the main goes."""
        idx = list(range(panel.n_breakers)) if order is None else list(order)
        steps = []
        for k, i in enumerate(idx):
            extra = [each(k, len(idx))] if each is not None else []
            steps.append(AnimationGroup(self.reach(side, panel.pt(f"breaker_{i}"), per, lean=False),
                                        Succession(Wait(per * 0.6), panel.flip(i, on, per * 0.5)),
                                        Succession(Wait(per * 0.7), Snd("click", gain=-12)), *extra))
        if main:
            extra = [Succession(Wait(0.12), at_main)] if at_main is not None else []
            steps.append(AnimationGroup(self.reach(side, panel.pt("main"), 0.15, lean=False),
                                        Succession(Wait(0.1), panel.flip("main", on, 0.08)),
                                        Succession(Wait(0.12), Snd("clunk", gain=-4)), *extra))
        return Succession(*steps)

    # ------------------------------------------------------------ loads
    def slide_push(self, obj, x, grips=("grip_R_low", "grip_R"), run_time=None, lean=0.45, sound="creak"):
        """Push or drag a heavy box along the floor: both hands to its near side (grips: far hand, near hand), lean in
        and walk to x; the box slides with the hands, flat on the floor (no bobbing), scraping."""
        st = {}
        gL, gR = (lambda: obj.pt(grips[0])), (lambda: obj.pt(grips[1]))

        def hook():
            st["off"] = obj.pt("base")[0] - self.v("x")
            st["y"] = obj.pt("base")[1]
            attach_to(obj, "base", lambda: np.array([self.v("x") + st["off"], st["y"], 0.0]), name=f"pushed_{self.name}")

        walk = self.walk_to(x, face=self.sg, hands={"L": gL, "R": gR}, run_time=run_time, max_stride=0.55, spine=lean)
        steps = [AnimationGroup(self.grab2(obj, grips[0], grips[1], keep_pinned=True),
                                self.pose({"spine": lean}, 0.35)), Do(hook)]
        steps.append(AnimationGroup(walk, Snd(sound, gain=-4)) if sound else walk)
        steps += [Do(lambda: detach(obj))]
        return Succession(*steps)

    def wheel_to(self, x, load, pivot="axle", handle="handle", run_time=None, ground=None):
        """Roll a hand-truck load: hands stay on the handle (take it first with grab2(load, handle, handle,
        keep_pinned=True) and tip it back with tilt()), walk to x, and the load rolls along at the same distance
        from the hips, its wheels on the floor."""
        st = {}

        def hook():
            p = load.pt(pivot)
            st["off"], st["y"] = p[0] - self.v("x"), p[1]
            attach_to(load, pivot, lambda: np.array([self.v("x") + st["off"], st["y"], 0.0]), name=f"wheeled_{self.name}")

        hd = lambda: load.pt(handle)
        return Succession(Do(hook), self.walk_to(x, ground, face=self.sg, hands={"L": hd, "R": hd}, run_time=run_time,
                                                 max_stride=0.6), Do(lambda: detach(load)))

    def let_go(self, sides=("L", "R"), run_time=0.3):
        """Hands that were pinned to something come away and drop back to rest."""
        def free():
            for s_ in sides:
                self.bake_arm(s_)

        return Succession(Do(free), AnimationGroup(*[self.pose({ARM_KEYS[s_][0]: 0.12 if s_ == "R" else -0.12,
                                                               ARM_KEYS[s_][1]: 0.18}, run_time) for s_ in sides]))

    def haul(self, rope, progress, amount, pulls=5, run_time=None, toward=None, lean=0.3):
        """Hand-over-hand haul on a rope: the hands take turns reaching out along the rope toward `toward` (where the
        rope comes from, e.g. the hatch lip), gripping and pulling it in to the belly, while the load's progress
        tracker (see props.base.ride) gains `amount` with each pull. The rope's end follows whichever hand pulls."""
        rt = run_time or 0.42 * pulls
        st = {}
        tw = np.array(toward[:2], dtype=float)

        def far_near():
            J = self.solve()
            sh = J["shoulder"][:2]
            d = tw - sh
            d = d / max(1e-6, float(np.linalg.norm(d)))
            far = sh + d * ARM_LEN * 0.92
            near = self.hip_point()[:2] + np.array([self.sg * 0.3, 0.45])
            return far, near

        def setup():
            st.update(p0=progress.get_value(), i=-1)
            for side in "LR":
                h = self.hand(side)
                self.pins[side] = None
                self.set(**{f"hand{side}_x": h[0], f"hand{side}_y": h[1], f"arm{side}_lock": 1.0})
            st["s0"] = self.v("spine")

        def update(alpha):
            i = min(int(alpha * pulls), pulls - 1)
            w = alpha * pulls - i
            if i != st["i"]:
                st["i"] = i
                st["act"] = "R" if i % 2 == 0 else "L"
                st["oth"] = "L" if st["act"] == "R" else "R"
                st["a0"] = self.hand(st["act"])[:2].copy()
                st["b0"] = self.hand(st["oth"])[:2].copy()
                rope.hold(lambda s_=st["act"]: self.hand(s_))
                snd("yank" if i % 2 == 0 else "creak", 0.05, -12)
            far, near = far_near()
            e = smooth(w)
            pa = st["a0"] + (near - st["a0"]) * e                                  # the gripping hand pulls in
            pb = st["b0"] + (far - st["b0"]) * e + np.array([0, 0.18 * np.sin(np.pi * w)])  # the other reaches out
            self.set(**{f"hand{st['act']}_x": pa[0], f"hand{st['act']}_y": pa[1],
                        f"hand{st['oth']}_x": pb[0], f"hand{st['oth']}_y": pb[1]})
            self.set(spine=st["s0"] + lean * (0.5 - e) * 0.6)
            progress.set_value(st["p0"] + amount * (i + e) / pulls)

        return RigAnim(update, setup, rt, linear)

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


def climb_start(treads):
    """Where to stand (hip x) facing a ladder or pull-down stair before climb(): right up against its foot."""
    t0, t1 = np.array(treads[0][:2]), np.array(treads[-1][:2])
    return float(t0[0] - (0.35 if t1[0] >= t0[0] else -0.35))


# ---------------------------------------------------------------- helping someone out of a hole
def pull_out(helper, stuck, stand_x, side="R", run_time=0.8):
    """helper grabs the hand stuck raises and leans back; stuck comes up out of the hole (after fall_through): the
    trapped foot rises straight out, then both feet land standing at stand_x on the same floor."""
    k, hx, F = stuck._stuck["side"], stuck._stuck["hole_x"], stuck._stuck["floor"]
    o = "R" if k == "L" else "L"
    d = S.STANCE if hx > stand_x else -S.STANCE      # the trapped foot lands on the hole's side of stand_x
    st = {}

    def meet():
        a, b = stuck.solve()["shoulder"], helper.solve()["shoulder"]
        return (a + b) / 2 + np.array([0, 0.25, 0])

    def link():
        helper.bake_arm(side)                          # helper's hand now rides with his body (FK)...
        stuck.pin("R", lambda: helper.hand(side))      # ...and the stuck one's hand rides with it

    def setup():
        st["hip0"] = stuck.hip_point()[:2].copy()
        st["kf0"] = np.array([stuck.v(f"foot{k}_x"), stuck.v(f"foot{k}_y")])
        st["of0"] = np.array([stuck.v(f"foot{o}_x"), stuck.v(f"foot{o}_y")])

    def update(a):
        stuck.set(x=lerp(st["hip0"][0], stand_x, a), y=lerp(st["hip0"][1], F + S.STAND_HIP, ease_out_cubic(a)))
        up = smooth(min(1.0, a / 0.55))                   # the trapped foot comes straight up out of the hole first,
        over = smooth(max(0.0, (a - 0.45) / 0.55))        # then swings over to stand
        stuck.set(**{f"foot{k}_x": lerp(hx, stand_x + d, over),
                     f"foot{k}_y": lerp(st["kf0"][1], F + 0.25, up) - 0.25 * over})
        of = st["of0"] + (np.array([stand_x - d, F]) - st["of0"]) * over
        stuck.set(**{f"foot{o}_x": of[0], f"foot{o}_y": of[1] + 0.12 * np.sin(np.pi * over)})

    m = lambda: st.setdefault("meet", meet())          # fixed once the reach starts
    reach = AnimationGroup(stuck.reach("R", m, 0.3, lean=False), helper.reach(side, m, 0.35))
    heave = AnimationGroup(helper.pose({"spine": -0.35}, run_time * 0.6, rush_from), helper.expression("strain", 0.2),
                           RigAnim(update, setup, run_time, smooth), Snd("yank", gain=-4),
                           stuck.pose({"spine": 0.0, "neck": 0.0, "shoulder_L": -0.12, "elbow_L": 0.18}, run_time),
                           stuck.t["hair"].animate(run_time=run_time).set_value(0.0))
    settle = AnimationGroup(helper.pose({"spine": 0.0}, 0.3), helper.expression("neutral", 0.2),
                            Succession(Do(lambda: stuck.unpin("R")), stuck.let_go(("R",), 0.3)),
                            Succession(Do(lambda: helper.unpin(side)), helper.let_go((side,), 0.3)))
    return Succession(reach, Do(link), heave, Do(lambda: stuck.plant_feet(F)), settle)


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
