"""Face and head (skill doc section 7).

The head circle pivots at the neck and never slides sideways. The face is a set of shapes drawn inside it, driven
by trackers: turn (-1 left .. +1 right, 0 = facing camera) slides and squashes the features to sell a sphere
turning; blinks squash the eyes fully flat; expressions tween a handful of feature trackers.
"""
import numpy as np
from manim import (AnimationGroup, Circle, Ellipse, Rectangle, Succession, ValueTracker, VGroup, VMobject, Wait,
                   linear, smooth)
from manim.utils.rate_functions import ease_in_out_sine

from . import style as S

FEATURES = dict(turn=0.0, up=0.0, tilt=0.0, eyes_open=1.0, blink=1.0, xeyes=0.0, mouth_curve=0.0, mouth_open=0.0,
                smirk=0.0, lid=0.0, brow_angle=0.0, brow_y=0.0, eye_big=0.0, squint=0.0, tongue=0.0, teeth=0.0,
                wink=0.0)

# Expression presets: only the feature trackers listed here change; turn/up/tilt/blink are left alone.
EXPRESSIONS = {
    "neutral": dict(mouth_curve=0.0, mouth_open=0.0, smirk=0.0, lid=0.0, brow_angle=0.0, brow_y=0.0, eye_big=0.0,
                    squint=0.0, tongue=0.0, teeth=0.0, eyes_open=1.0, xeyes=0.0),
    "happy": dict(mouth_curve=1.0, brow_y=0.3),
    "smug": dict(smirk=1.0, lid=0.6, mouth_curve=0.2),
    "surprised": dict(eye_big=1.0, mouth_open=1.0, brow_y=1.0, smirk=0.0, lid=0.0, squint=0.0),
    "squint": dict(squint=1.0, brow_angle=0.7, lid=0.0),
    "disappointed": dict(eyes_open=0.0, mouth_curve=-0.35, brow_angle=-0.8, smirk=0.0),
    "strain": dict(squint=1.0, teeth=1.0, brow_angle=0.9, mouth_curve=0.0),
    "tongue_out": dict(tongue=1.0, squint=0.65, brow_angle=0.4),
    "dazed": dict(xeyes=1.0, mouth_open=0.35, mouth_curve=-0.2),
}


class Face:
    def __init__(self, fig, turn=0.0, rest=None):
        """rest: this character's resting face (feature values that "neutral" returns to), e.g. a friendly
        resting smile dict(mouth_curve=0.45)."""
        self.fig = fig
        self.rest = dict(rest or {})
        self.t = {k: ValueTracker(v) for k, v in FEATURES.items()}
        self.t["turn"].set_value(turn)
        for k, v in self.rest.items():
            self.t[k].set_value(v)
        seg = lambda w=S.FACE_W: VMobject().set_stroke(S.INK, w)
        self.eyes = [VMobject(), VMobject()]
        self.lids = [seg(3.5), seg(3.5)]
        self.brows = [seg(4), seg(4)]
        self.mouth = seg(4)
        self.teeth = VMobject()
        self.tongue = Ellipse(width=0.1, height=0.1).set_fill(S.TONGUE, 0).set_stroke(S.INK, 2, opacity=0)
        self.group = VGroup(*self.eyes, *self.lids, *self.brows, self.tongue, self.mouth, self.teeth)

    def v(self, key):
        return self.t[key].get_value()

    def set(self, **values):
        for k, val in values.items():
            self.t[k].set_value(val)

    # ------------------------------------------------------------ drawing
    def draw(self, J):
        R = S.HEAD_R
        c = J["head"]
        t, up = np.clip(self.v("turn"), -1, 1), self.v("up")
        sq = 1 - 0.4 * abs(t)
        cx, cy = c[0] + 0.55 * R * t, c[1] + 0.05 * R + 0.22 * R * up
        spacing = 0.34 * R * sq
        openness = self.v("eyes_open") * self.v("blink") * self.fig.idle_blink_factor()
        openness *= (1 - 0.8 * self.v("squint")) * (1 - 0.45 * self.v("lid"))
        xe, big = self.v("xeyes"), self.v("eye_big")
        far_side = -np.sign(t) if abs(t) > 0.02 else 0
        eye_pts = []
        for i, k in enumerate((-1, 1)):
            ex = cx + k * spacing
            scale = 1.0
            if k == far_side:  # the far eye moves a little less and gets slightly smaller
                ex = cx + k * spacing * 0.85
                scale = 1 - 0.25 * abs(t)
            ey = cy
            eye_pts.append((ex, ey))
            e = self.eyes[i]
            if k == 1 and self.v("wink") > 0.5 and xe < 0.5:  # wink: the right eye shuts in a happy arc
                w = 0.12 * R * sq * scale
                e.become(VMobject().set_points_smoothly([[ex - w, ey - 0.03 * R, 0], [ex, ey + 0.06 * R, 0],
                                                         [ex + w, ey - 0.03 * R, 0]]).set_stroke(S.INK, 4).set_fill(opacity=0))
            elif xe > 0.5:
                s = 0.12 * R * scale
                shape = VMobject().set_points_as_corners([[ex - s, ey - s, 0], [ex + s, ey + s, 0]])
                shape.append_points(VMobject().set_points_as_corners([[ex - s, ey + s, 0], [ex + s, ey - s, 0]]).points)
                e.become(shape.set_stroke(S.INK, 4).set_fill(opacity=0))
            elif big > 0.5:
                ring = Circle(radius=0.16 * R * scale).move_to([ex, ey, 0])
                ring.append_points(Circle(radius=0.035 * R).move_to([ex, ey, 0]).points)  # pupil
                e.become(ring.set_stroke(S.INK, 4).set_fill(opacity=0))
            elif openness < 0.15:
                w = 0.11 * R * sq * scale
                e.become(VMobject().set_points_as_corners([[ex - w, ey, 0], [ex + w, ey, 0]]).set_stroke(S.INK, 4))
            else:
                e.become(Ellipse(width=0.17 * R * sq * scale, height=0.21 * R * openness * scale)
                         .move_to([ex, ey, 0]).set_fill(S.INK, 1).set_stroke(S.INK, 1))
            # smug lid line across the top of the eye
            lid = self.v("lid")
            lw = 0.14 * R * sq * scale
            self.lids[i].set_points_as_corners([[ex - lw, ey + 0.03 * R, 0], [ex + lw, ey + 0.03 * R, 0]])
            self.lids[i].set_stroke(opacity=1.0 if lid > 0.3 and xe < 0.5 and big < 0.5 and openness >= 0.15 else 0.0)
            # brows (inner end down for angry/strain, up for sad)
            ba, by = self.v("brow_angle"), self.v("brow_y")
            show = abs(ba) > 0.05 or by > 0.05
            bw = 0.13 * R * sq * scale
            byy = ey + 0.3 * R + 0.12 * R * by
            inner, outer = (ex - k * bw, ex + k * bw)
            self.brows[i].set_points_as_corners([[outer, byy + ba * 0.07 * R, 0], [inner, byy - ba * 0.07 * R, 0]])
            self.brows[i].set_stroke(opacity=1.0 if show else 0.0)
        # mouth
        mx, my = cx, c[1] - 0.42 * R + 0.12 * R * up
        w = 0.36 * R * sq
        curve, smirk, mopen = self.v("mouth_curve"), self.v("smirk"), self.v("mouth_open")
        sside = np.sign(t) if abs(t) > 0.05 else 1.0
        if mopen > 0.08:
            self.mouth.become(Ellipse(width=0.17 * R * sq, height=0.26 * R * mopen + 0.02)
                              .move_to([mx, my - 0.03 * R, 0]).set_stroke(S.INK, 4).set_fill(S.INK, 0.85))
        else:
            left = [mx - w / 2, my + (smirk * 0.1 * R if sside < 0 else 0) + curve * 0.06 * R, 0]
            right = [mx + w / 2, my + (smirk * 0.1 * R if sside > 0 else 0) + curve * 0.06 * R, 0]
            mid = [mx, my - curve * 0.07 * R, 0]
            self.mouth.become(VMobject().set_points_smoothly([left, mid, right]).set_stroke(S.INK, 4).set_fill(opacity=0))
        teeth = self.v("teeth")
        if teeth > 0.5:
            box = Rectangle(width=0.36 * R * sq, height=0.13 * R).move_to([mx, my, 0])
            box.set_fill(S.WHITE, 1).set_stroke(S.INK, 3)
            box.append_points(VMobject().set_points_as_corners([[mx - 0.18 * R * sq, my, 0], [mx + 0.18 * R * sq, my, 0]]).points)
            self.teeth.become(box)
        else:
            self.teeth.become(VMobject().set_points_as_corners([[mx, my, 0], [mx, my + 1e-3, 0]]).set_stroke(opacity=0))
        tg = self.v("tongue")
        self.tongue.become(Ellipse(width=0.13 * R, height=0.17 * R).move_to([mx + sside * 0.13 * R, my - 0.1 * R, 0])
                           .set_fill(S.TONGUE, tg).set_stroke(S.INK, 2, opacity=tg))

    # ------------------------------------------------------------ actions (each returns an Animation)
    def _to(self, run_time=0.25, rate_func=smooth, **values):
        return AnimationGroup(*[self.t[k].animate(run_time=run_time, rate_func=rate_func).set_value(v)
                                for k, v in values.items()])

    def expression(self, name, run_time=0.25):
        values = dict(EXPRESSIONS[name])
        if name == "neutral":
            values.update(self.rest)
        return self._to(run_time, **values)

    def wink(self, hold=0.5):
        """Right eye shuts in a happy arc for a beat, with a little smile."""
        return Succession(self._to(0.08, wink=1.0, mouth_curve=max(0.8, self.v("mouth_curve"))), Wait(hold),
                          self._to(0.1, wink=0.0))

    def blink(self):
        """Eyes squash fully flat, hold two frames, reopen (~0.15 s)."""
        return Succession(self.t["blink"].animate(run_time=0.04, rate_func=linear).set_value(0.0),
                          Wait(0.07),
                          self.t["blink"].animate(run_time=0.04, rate_func=linear).set_value(1.0))

    def close_eyes(self, run_time=0.15):
        return self._to(run_time, eyes_open=0.0)

    def open_eyes(self, run_time=0.15):
        return self._to(run_time, eyes_open=1.0)

    def turn_to(self, turn, run_time=0.25):
        return self._to(run_time, turn=float(np.clip(turn, -1, 1)))

    def shake_head(self, times=3, slow=False, eyes_closed=False):
        sweep = 0.6 if slow else 0.3
        steps = []
        if eyes_closed:
            steps.append(self.close_eyes(0.15))
        for i in range(times):
            steps.append(self._to(sweep, rate_func=ease_in_out_sine, turn=-0.8 if i % 2 == 0 else 0.8))
        steps.append(self._to(sweep / 2, rate_func=ease_in_out_sine, turn=0.0))
        if eyes_closed:
            steps += [Wait(0.2), self.open_eyes(0.15)]
        return Succession(*steps)

    def nod(self, times=2, run_time=0.3):
        neck = self.fig.t["neck"]
        base = neck.get_value()
        steps = []
        for _ in range(times):
            steps.append(AnimationGroup(neck.animate(run_time=run_time / 2).set_value(base + 0.21),
                                        self.t["up"].animate(run_time=run_time / 2).set_value(-0.35)))
            steps.append(AnimationGroup(neck.animate(run_time=run_time / 2).set_value(base),
                                        self.t["up"].animate(run_time=run_time / 2).set_value(0.0)))
        return Succession(*steps)

    def look_at(self, target, run_time=0.2):
        """Eyes lead (turn + up), the head tilt follows 0.1 s later."""
        head = self.fig.solve()["head"]
        dx, dy = target[0] - head[0], target[1] - head[1]
        turn = float(np.clip(dx / 1.6, -0.9, 0.9))
        up = float(np.clip(dy / 2.5, -0.8, 0.8))
        return AnimationGroup(self._to(run_time, turn=turn, up=up),
                              Succession(Wait(0.1), self._to(run_time, tilt=-0.08 * up)))

    def talk(self, duration, seed=0):
        rng = np.random.default_rng(seed)
        steps, t = [], 0.0
        while t < duration - 0.12:
            d = float(rng.uniform(0.08, 0.17))
            steps.append(self.t["mouth_open"].animate(run_time=d, rate_func=smooth).set_value(float(rng.uniform(0.15, 0.6))))
            steps.append(self.t["mouth_open"].animate(run_time=d * 0.8, rate_func=smooth).set_value(0.0))
            t += d * 1.8
        return Succession(*steps)
