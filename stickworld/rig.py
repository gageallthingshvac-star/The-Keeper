"""The jointed stick-figure rig (skill doc section 5).

Every joint angle is a ValueTracker; the root (hips) is a tracker pair. An updater redraws the figure every frame
from those numbers, so animations only ever change trackers.

Angle convention: radians measured from "hanging straight down", positive = toward the way the figure faces.
face_dir (+1 right / -1 left, tweenable) mirrors those angles when drawing, never the shapes.
- spine: lean of the torso (+ forward). neck: extra head tilt (+ forward / nodding down).
- shoulder_X: upper arm, relative to the spine. elbow_X: forearm relative to the upper arm, 0..2.8 (bends forward).
- hip_X: thigh relative to vertical. knee_X: shin relative to the thigh, -2.8..0 (bends backward).
Side L is the far limb (drawn behind the body), R the near limb (drawn in front).

Feet are planted: each leg has a lock tracker (1 = IK to its planted foot point, 0 = plain FK angles), so the hips
can move or crouch while the feet stay put. Hands work the same way: a lock tracker blends FK into IK toward a hand
target (a tracker pair, or a pinned callable that follows a moving object).
"""
import numpy as np
from manim import TAU, CapStyleType, Circle, Ellipse, Polygon, RoundedRectangle, ValueTracker, VGroup, VMobject

from . import style as S
from .face import Face
from .actions import ActionsMixin

JOINTS = ("spine", "neck", "shoulder_L", "elbow_L", "shoulder_R", "elbow_R", "hip_L", "knee_L", "hip_R", "knee_R")
LIMITS = {"elbow_L": (0.0, 2.8), "elbow_R": (0.0, 2.8), "knee_L": (-2.8, 0.0), "knee_R": (-2.8, 0.0)}
REST = dict(spine=0.0, neck=0.0, shoulder_L=-0.12, elbow_L=0.18, shoulder_R=0.12, elbow_R=0.18,
            hip_L=0.0, knee_L=0.0, hip_R=0.0, knee_R=0.0)
ARM = S.UPPER_ARM + S.FOREARM


def dirv(a, f=1.0):
    """Unit vector at angle a from straight down, + toward facing f."""
    return np.array([f * np.sin(a), -np.cos(a), 0.0])


def upv(a, f=1.0):
    return np.array([f * np.sin(a), np.cos(a), 0.0])


def two_bone(root, target, l1, l2, sg, bend):
    """Two-bone IK in the figure's forward-relative frame.
    Returns (first bone abs angle, second bone abs angle). bend=+1 puts the middle joint forward (knees),
    bend=-1 puts it back/down (elbows)."""
    rx, ry = (target[0] - root[0]) * sg, target[1] - root[1]
    d = float(np.hypot(rx, ry))
    d = float(np.clip(d, 1e-4, l1 + l2 - 1e-4))
    theta = np.arctan2(rx, -ry)
    cos_a = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    a1 = theta + bend * np.arccos(np.clip(cos_a, -1, 1))
    mx, my = l1 * np.sin(a1), -l1 * np.cos(a1)
    tx, ty = rx, ry
    if np.hypot(rx, ry) > l1 + l2:  # out of reach: point straight at it
        a1 = theta
        mx, my = l1 * np.sin(a1), -l1 * np.cos(a1)
    a2 = np.arctan2(tx - mx, -(ty - my))
    return a1, a2


def wrap(a):
    return (a + np.pi) % TAU - np.pi


class StickFigure(ActionsMixin, VGroup):
    def __init__(self, x=0.0, ground=0.0, face_dir=1.0, accessory=None, name="", turn=None, rest_face=None, marks=(),
                 **pose):
        super().__init__()
        self.name = name
        self.accessory = accessory
        self.marks = set(marks)  # series continuity: scars a character carries from episode to episode
        self.ground = ground
        self.clock = 0.0
        self.idle_on = True
        self._blink_at = 1.2 + (hash(name) % 7) * 0.3
        self.pins = {"L": None, "R": None}
        self.t = {k: ValueTracker(v) for k, v in {**REST, **pose}.items() if k in JOINTS}
        for k in JOINTS:
            self.t.setdefault(k, ValueTracker(REST[k]))
        hip_y = ground + S.STAND_HIP
        extra = dict(x=x, y=hip_y, face_dir=face_dir, hair=0.0, sy=1.0, jitter=0.0, thumb=0.0,
                     legL_lock=1.0, legR_lock=1.0, armL_lock=0.0, armR_lock=0.0,
                     footL_x=x - face_dir * S.STANCE, footL_y=ground, footR_x=x + face_dir * S.STANCE, footR_y=ground,
                     handL_x=x, handL_y=hip_y, handR_x=x, handR_y=hip_y)
        for k, v in extra.items():
            self.t[k] = ValueTracker(v)
        self.face = Face(self, turn=0.45 * face_dir if turn is None else turn, rest=rest_face)
        self._build()
        self.add_updater(self._tick)
        self._redraw()
        for side in "LR":  # hand targets start where the hands are
            h = self.joints[f"hand_{side}"]
            self.t[f"hand{side}_x"].set_value(h[0])
            self.t[f"hand{side}_y"].set_value(h[1])
        self.set_z_index(S.Z_FIGURE)

    # ------------------------------------------------------------ tracker access
    def v(self, key):
        return self.t[key].get_value()

    def set(self, **values):
        for k, val in values.items():
            self.t[k].set_value(val)
        return self

    def tracker(self, key):
        return self.t[key]

    angle = tracker  # fig.angle("elbow_R").animate.set_value(...)

    @property
    def sg(self):
        return 1.0 if self.v("face_dir") >= 0 else -1.0

    # ------------------------------------------------------------ drawing
    def _seg(self, w=S.LIMB_W):
        m = VMobject().set_stroke(S.INK, w)
        m.set_points_as_corners([np.zeros(3), np.array([0, 0.01, 0])])
        m.set_cap_style(CapStyleType.ROUND)
        return m

    def _build(self):
        self.parts = {}
        order = ["thigh_L", "shin_L", "upper_L", "fore_L", "torso", "neck", "thigh_R", "shin_R"]
        for n in order:
            self.parts[n] = self._seg()
        self.parts["head"] = Circle(radius=S.HEAD_R).set_stroke(S.INK, S.LIMB_W).set_fill(S.WHITE, 1)
        self.parts["hair"] = VGroup(*[self._seg(5) for _ in range(5)])
        self.parts["acc"] = VMobject().set_stroke(S.INK, 4)
        self.parts["acc_brim"] = self._seg(7)
        for n in ("upper_R", "fore_R"):
            self.parts[n] = self._seg()
        self.parts["fist"] = VGroup()
        self.parts["shadow"] = Ellipse(width=0.8, height=0.12).set_fill(S.INK, S.SHADOW_OPACITY).set_stroke(width=0)
        self.add(self.parts["shadow"])  # contact shadow, drawn first so the body is over it
        for n in order:
            self.add(self.parts[n])
        self.parts["bandage"] = VGroup()  # on the near shin, over the leg
        self.add(self.parts["bandage"])
        self.add(self.parts["hair"], self.parts["head"])
        self.add(self.face.group)
        self.parts["scorch"] = VGroup()   # soot on the cap, over the cap
        self.parts["cap_tag"] = VGroup()
        self.parts["dust"] = VGroup()
        self.add(self.parts["acc"], self.parts["acc_brim"], self.parts["scorch"], self.parts["cap_tag"], self.parts["dust"],
                 self.parts["upper_R"], self.parts["fore_R"], self.parts["fist"])

    def _tick(self, m, dt):
        self.clock += dt
        self._redraw()

    def solve(self):
        """Forward kinematics (+ IK where locked) from the trackers. Returns a dict of joint points."""
        tv = {k: tr.get_value() for k, tr in self.t.items()}
        f = tv["face_dir"]
        sg = 1.0 if f >= 0 else -1.0
        jit = tv["jitter"]
        if jit > 1e-3:
            rng = np.random.default_rng(int(self.clock * 20) + 7)
            noise = rng.uniform(-1, 1, 12) * 0.22 * jit
        else:
            noise = np.zeros(12)
        breath = 1.0 + (0.005 + 0.005 * np.sin(TAU * self.clock / 2.0) if self.idle_on else 0.0)
        hip = np.array([tv["x"], tv["y"], 0.0])
        spine = tv["spine"] + noise[0]
        shoulder = hip + S.TORSO * breath * upv(spine, f)
        turn = self.face.v("turn")
        tilt = self.face.v("tilt") + 0.1 * turn * sg  # up to ~6 degrees of head tilt follows the turn
        neck_a = spine + tv["neck"] + tilt + noise[1]
        neck_top = shoulder + S.NECK * upv(neck_a, f)
        head = neck_top + S.HEAD_R * upv(neck_a, f)
        J = dict(hip=hip, shoulder=shoulder, neck_top=neck_top, head=head, neck_angle=neck_a, f=f, sg=sg)
        for i, side in enumerate("LR"):
            # legs
            a_fk, k_fk = tv[f"hip_{side}"] + noise[2 + i], tv[f"knee_{side}"]
            lock = tv[f"leg{side}_lock"]
            thigh_a, shin_a = a_fk, a_fk + k_fk
            if lock > 1e-3:
                foot = (tv[f"foot{side}_x"], tv[f"foot{side}_y"])
                ia, ib = two_bone(hip, foot, S.THIGH, S.SHIN, sg, +1)
                thigh_a = a_fk + wrap(ia - a_fk) * lock
                shin_a = (a_fk + k_fk) + wrap(ib - (a_fk + k_fk)) * lock
            knee_rel = np.clip(wrap(shin_a - thigh_a), *LIMITS[f"knee_{side}"])
            shin_a = thigh_a + knee_rel
            knee = hip + S.THIGH * dirv(thigh_a, f)
            J[f"knee_{side}"], J[f"foot_{side}"] = knee, knee + S.SHIN * dirv(shin_a, f)
            # arms (relative to the spine)
            up_a = spine + tv[f"shoulder_{side}"] + noise[4 + i]
            fo_a = up_a + tv[f"elbow_{side}"] + noise[6 + i]
            lock = tv[f"arm{side}_lock"]
            if lock > 1e-3:
                pin = self.pins[side]
                tgt = pin() if pin is not None else (tv[f"hand{side}_x"], tv[f"hand{side}_y"])
                ia, ib = two_bone(shoulder, tgt, S.UPPER_ARM, S.FOREARM, sg, -1)
                up_a = up_a + wrap(ia - up_a) * lock
                fo_a = fo_a + wrap(ib - fo_a) * lock
            elbow_rel = np.clip(wrap(fo_a - up_a), *LIMITS[f"elbow_{side}"])
            fo_a = up_a + elbow_rel
            elbow = shoulder + S.UPPER_ARM * dirv(up_a, f)
            J[f"elbow_{side}"], J[f"hand_{side}"] = elbow, elbow + S.FOREARM * dirv(fo_a, f)
            J[f"forearm_angle_{side}"] = fo_a
        sy = tv["sy"]
        if abs(sy - 1) > 1e-3:  # squash & stretch about the lower foot
            base = min(J["foot_L"][1], J["foot_R"][1])
            sx = 1 / np.sqrt(sy)
            for k, p in J.items():
                if isinstance(p, np.ndarray):
                    J[k] = np.array([hip[0] + (p[0] - hip[0]) * sx, base + (p[1] - base) * sy, 0.0])
            J["head_scale"] = (sx, sy)
        J["hair"] = tv["hair"]
        return J

    def _draw_shadow(self, J):
        """Soft contact shadow on the surface under the feet; fades when the feet are on different levels (ladders,
        a leg through the ceiling) or the body leaves the ground."""
        fL, fR = J["foot_L"], J["foot_R"]
        g = min(fL[1], fR[1])
        level = float(np.clip(1.0 - (abs(fL[1] - fR[1]) - 0.08) / 0.25, 0.0, 1.0))
        air = float(np.clip(1.0 - (J["hip"][1] - g - S.STAND_HIP - 0.15) / 0.8, 0.0, 1.0))
        k = level * air * (self.shadow_on if hasattr(self, "shadow_on") else 1.0)
        w = max(0.62, abs(fL[0] - fR[0]) + 0.5)
        sh = self.parts["shadow"]
        sh.stretch_to_fit_width(w).stretch_to_fit_height(0.12).move_to(np.array([(fL[0] + fR[0]) / 2, g, 0.0]))
        sh.set_fill(S.INK, S.SHADOW_OPACITY * k)

    def _redraw(self):
        J = self.joints = self.solve()
        P = self.parts
        self._draw_shadow(J)
        for side in "LR":
            P[f"thigh_{side}"].set_points_as_corners([J["hip"], J[f"knee_{side}"]])
            P[f"shin_{side}"].set_points_as_corners([J[f"knee_{side}"], J[f"foot_{side}"]])
            P[f"upper_{side}"].set_points_as_corners([J["shoulder"], J[f"elbow_{side}"]])
            P[f"fore_{side}"].set_points_as_corners([J[f"elbow_{side}"], J[f"hand_{side}"]])
        P["torso"].set_points_as_corners([J["hip"], J["shoulder"]])
        P["neck"].set_points_as_corners([J["shoulder"], J["neck_top"]])
        head = P["head"]
        head.become(Circle(radius=S.HEAD_R).set_stroke(S.INK, S.LIMB_W).set_fill(S.WHITE, 1).move_to(J["head"]))
        if "head_scale" in J:
            head.stretch(J["head_scale"][0], 0).stretch(J["head_scale"][1], 1)
        self._draw_hair(J)
        self._draw_accessory(J)
        self._draw_marks(J)
        self._draw_thumb(J)
        self.face.draw(J)

    def _draw_hair(self, J):
        hair = J["hair"]
        c, na, f = J["head"], J["neck_angle"], J["f"]
        for i, spoke in enumerate(self.parts["hair"]):
            ang = na * f + np.linspace(-0.9, 0.9, 5)[i]
            d = np.array([np.sin(ang), np.cos(ang), 0])
            base = c + d * S.HEAD_R
            spoke.set_points_as_corners([base, base + d * (0.02 + 0.55 * S.HEAD_R * 2.2 * hair)])
            spoke.set_stroke(opacity=1.0 if hair > 0.03 else 0.0)

    def _draw_marks(self, J):
        """Continuity scars (see stickworld/continuity.py): "scorched_cap" = soot burnt into the cap from the EP1 zap,
        "shin_bandage" = a sticking plaster on the near shin from the EP2 ceiling."""
        scorch, band = self.parts["scorch"], self.parts["bandage"]
        if "scorched_cap" in self.marks and self.accessory == "cap":
            R, c = S.HEAD_R, J["head"]
            turn = self.face.v("turn")
            side = np.sign(turn) if abs(turn) > 0.05 else J["sg"]
            cc = c + np.array([0, R * 0.28 + 0.55 * R * J["hair"], 0])
            blob_c = cc + np.array([-side * 0.3 * R, 0.55 * R, 0])
            rng = np.random.default_rng(5)
            pts = [blob_c + np.array([np.cos(t) * 0.3 * R * rng.uniform(0.7, 1.15), np.sin(t) * 0.2 * R * rng.uniform(0.7, 1.15), 0])
                   for t in np.linspace(0, 2 * np.pi, 9)[:-1]]
            blob = Polygon(*pts).set_fill("#3B2A22", 0.9).set_stroke(width=0)
            specks = [Circle(radius=0.035 * R * k).move_to(blob_c + np.array([dx * R, dy * R, 0])).set_fill("#2A1E18", 1).set_stroke(width=0)
                      for k, dx, dy in ((1.0, side * 0.08, 0.28), (0.8, -side * 0.62, 0.05), (0.6, side * 0.35, -0.12))]
            scorch.become(VGroup(blob, *specks))
        elif len(scorch.submobjects):
            scorch.become(VGroup())
        tag = self.parts["cap_tag"]
        if "cap_tag" in self.marks and self.accessory == "cap":   # brand-new cap: the price tag is still on it
            R, c = S.HEAD_R, J["head"]
            turn = self.face.v("turn")
            side = np.sign(turn) if abs(turn) > 0.05 else J["sg"]
            knot = c + np.array([-side * 1.0 * R, 0.4 * R, 0])
            swing = 0.25 * np.sin(self.clock * 3.1)
            d = np.array([np.sin(swing) * -side, -np.cos(swing), 0])
            end = knot + d * 0.2
            string = VMobject().set_points_as_corners([knot, end]).set_stroke(S.INK, 2)
            card = Polygon(end + np.array([-0.07, 0.0, 0]), end + np.array([0.07, 0.0, 0]), end + np.array([0.07, -0.13, 0]),
                           end + np.array([-0.07, -0.13, 0])).set_fill(S.WHITE, 1).set_stroke(S.INK, 2)
            tag.become(VGroup(string, card, VMobject().set_points_as_corners([end + np.array([-0.04, -0.07, 0]), end + np.array([0.04, -0.07, 0])])
                                                         .set_stroke(S.TOOL_RED, 2)))
        elif len(tag.submobjects):
            tag.become(VGroup())
        dust = self.parts["dust"]
        if "dusty" in self.marks:   # grey filter dust all over his face (temporary, not a series scar)
            R, c = S.HEAD_R, J["head"]
            rng = np.random.default_rng(13)
            dots = [Circle(radius=rng.uniform(0.02, 0.05)).move_to(c + np.array([rng.uniform(-0.75, 0.75) * R, rng.uniform(-0.7, 0.8) * R, 0]))
                    .set_fill("#8E8577", 0.85).set_stroke(width=0) for _ in range(14)]
            dust.become(VGroup(*dots))
        elif len(dust.submobjects):
            dust.become(VGroup())
        if "shin_bandage" in self.marks:
            k0, f0 = J["knee_R"], J["foot_R"]
            d = f0 - k0
            d = d / max(1e-6, float(np.linalg.norm(d)))
            mid = k0 + (f0 - k0) * 0.45
            nrm = np.array([-d[1], d[0], 0])
            hw, hl = 0.09, 0.17
            corners = [mid + d * hw + nrm * hl, mid + d * hw - nrm * hl, mid - d * hw - nrm * hl, mid - d * hw + nrm * hl]
            pad = Polygon(*corners).set_fill("#E8C39E", 1).set_stroke(S.INK, 2.5)
            holes = [Circle(radius=0.012).move_to(mid + nrm * o).set_fill("#B08B66", 1).set_stroke(width=0) for o in (-0.05, 0.05)]
            band.become(VGroup(pad, *holes))
        elif len(band.submobjects):
            band.become(VGroup())

    def add_mark(self, name):
        """Give the figure a continuity scar from now on (it then appears in every later episode too)."""
        self.marks.add(name)

    def remove_mark(self, name):
        self.marks.discard(name)

    def _draw_thumb(self, J):
        """Near hand closed in a fist with the thumb straight up (thumbs-up), popped in by the `thumb` tracker."""
        k = self.v("thumb")
        fist = self.parts["fist"]
        if k < 0.02:
            if len(fist.submobjects):
                fist.become(VGroup())
            return
        k *= 1.25  # big enough to read on a phone
        h, sg = J["hand_R"], J["sg"]
        c = h + np.array([sg * 0.04, 0.03, 0])
        w, hh = 0.24 * k, 0.2 * k
        block = RoundedRectangle(width=w, height=hh, corner_radius=0.07 * k).move_to(c)
        thumb = RoundedRectangle(width=0.085 * k, height=0.2 * k, corner_radius=0.04 * k)
        thumb.move_to(c + np.array([-sg * 0.06 * k, hh / 2 + 0.085 * k, 0]))
        creases = [VMobject().set_points_as_corners([c + np.array([sg * 0.02 * k, dy * k, 0]), c + np.array([sg * 0.11 * k, dy * k, 0])])
                   .set_stroke(S.INK, 3) for dy in (-0.045, 0.0, 0.045)]
        fist.become(VGroup(thumb.set_fill(S.WHITE, 1).set_stroke(S.INK, 5), block.set_fill(S.WHITE, 1).set_stroke(S.INK, 5),
                           *creases).set_z_index(self.z_index))

    def _draw_accessory(self, J):
        acc, brim = self.parts["acc"], self.parts["acc_brim"]
        if not self.accessory:
            acc.set_stroke(opacity=0).set_fill(opacity=0)
            brim.set_stroke(opacity=0)
            return
        R, c = S.HEAD_R, J["head"]
        turn = self.face.v("turn")
        lift = 0.55 * R * J["hair"]
        side = np.sign(turn) if abs(turn) > 0.05 else J["sg"]
        if self.accessory in ("cap", "hard_hat"):
            r = R * (1.06 if self.accessory == "cap" else 1.14)
            cc = c + np.array([0, R * 0.28 + lift, 0])
            pts = [cc + np.array([r * np.cos(t), r * 0.95 * np.sin(t), 0]) for t in np.linspace(0, np.pi, 20)]
            color = S.CAP_RED if self.accessory == "cap" else S.HARD_HAT
            acc.become(Polygon(*pts).set_fill(color, 1).set_stroke(S.INK, 4))
            if self.accessory == "cap":
                length = R * (0.35 + 0.65 * abs(turn))
                brim.set_points_as_corners([cc + np.array([-side * 0.2 * R, 0, 0]), cc + np.array([side * (r * 0.4 + length), -0.03, 0])])
                brim.set_stroke(S.CAP_RED, 8, opacity=1)
            else:
                brim.set_points_as_corners([cc + np.array([-r * 1.25, 0, 0]), cc + np.array([r * 1.25, 0, 0])])
                brim.set_stroke(S.HARD_HAT, 8, opacity=1)
        elif self.accessory == "bun":
            # hair pulled back into a bun at the back of the head, with a hair tie
            back = -side
            bun_c = c + np.array([back * 0.78 * R, 0.62 * R, 0])
            bun = Circle(radius=0.36 * R).move_to(bun_c).set_fill(S.INK, 1).set_stroke(S.INK, 3)
            acc.become(bun)
            brim.set_points_as_corners([c + np.array([side * 0.55 * R, 0.85 * R, 0]), c + np.array([0, 1.04 * R, 0]),
                                        bun_c + np.array([-back * 0.25 * R, 0.08 * R, 0])])
            brim.set_stroke(S.INK, 7, opacity=1)
        elif self.accessory == "hair_tuft":
            top = c + np.array([0, R, 0])
            pts = [top + np.array([dx, 0, 0]) for dx in np.linspace(-0.35 * R, 0.35 * R, 5)]
            tuft = VMobject().set_points_smoothly([pts[0], top + np.array([-0.1 * R, 0.35 * R, 0]), pts[2],
                                                  top + np.array([0.15 * R, 0.4 * R, 0]), pts[4]])
            acc.become(tuft.set_stroke(S.INK, 4).set_fill(opacity=0))
            brim.set_stroke(opacity=0)

    # ------------------------------------------------------------ queries
    def hand(self, side="R"):
        return self.solve()[f"hand_{side}"]

    def foot(self, side="R"):
        return self.solve()[f"foot_{side}"]

    def head_center(self):
        return self.solve()["head"]

    def shoulder_point(self):
        return self.solve()["shoulder"]

    def hip_point(self):
        return np.array([self.v("x"), self.v("y"), 0.0])

    def feet(self):
        return [np.array([self.v("footL_x"), self.v("footL_y"), 0.0]), np.array([self.v("footR_x"), self.v("footR_y"), 0.0])]

    def ground_y(self):
        return min(self.v("footL_y"), self.v("footR_y"))

    def idle(self, on=True):
        self.idle_on = on
        return self

    def idle_blink_factor(self):
        """Automatic blink every 2.5-4 s while idle: 1 = open, 0 = shut."""
        if not self.idle_on:
            return 1.0
        if self.clock >= self._blink_at + 0.15:
            rng = np.random.default_rng(int(self._blink_at * 1000) + len(self.name))
            self._blink_at = self.clock + rng.uniform(2.5, 4.0)
        return 0.0 if 0.0 <= self.clock - self._blink_at <= 0.15 else 1.0  # fully shut, never half-open
