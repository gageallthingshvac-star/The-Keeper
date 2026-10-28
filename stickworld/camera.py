"""Camera helpers for the vertical frame (needs a MovingCameraScene). Each returns an Animation."""
import random

import numpy as np
from manim import Succession, linear, smooth

from .style import FRAME_H, FRAME_W


def punch_in(scene, point, zoom=0.55, run_time=0.8, rate_func=smooth):
    """Zoom toward point; zoom is the fraction of the full frame left visible (0.5 = 2x closer). Returns a built
    Animation, so it can also run under scene.background() (a slow drift across several beats)."""
    frame = scene.camera.frame
    return frame.animate(run_time=run_time, rate_func=rate_func).set(height=FRAME_H * zoom).move_to(point).build()


def pan_to(scene, point, run_time=0.8, rate_func=smooth):
    return scene.camera.frame.animate(run_time=run_time, rate_func=rate_func).move_to(point).build()


def reset(scene, run_time=0.8, rate_func=smooth):
    return scene.camera.frame.animate(run_time=run_time, rate_func=rate_func).set(height=FRAME_H).move_to(np.zeros(3)).build()


def follow(scene, target, offset=(0.0, 0.0), stiffness=3.5):
    """Follow cam: every frame the camera eases toward target() (a callable point) + offset, like a camera operator
    keeping the action framed (a tech climbing, a unit sliding down the stair). Stop with unfollow(scene)."""
    frame = scene.camera.frame
    off = np.array([offset[0], offset[1], 0.0])

    def chase(m, dt):
        goal = np.array(target(), dtype=float) + off
        k = 1.0 - np.exp(-stiffness * dt)
        m.move_to(m.get_center() + (goal - m.get_center()) * k)

    unfollow(scene)
    frame._follow = chase
    frame.add_updater(chase)
    if frame not in scene.mobjects:
        scene.add(frame)


def unfollow(scene):
    frame = scene.camera.frame
    f = getattr(frame, "_follow", None)
    if f is not None:
        frame.remove_updater(f)
        frame._follow = None


def shake(scene, amount=0.15, n=7, run_time=0.45, seed=11):
    frame = scene.camera.frame
    base = frame.get_center()
    rng = random.Random(seed)
    moves = [base + np.array([rng.uniform(-amount, amount), rng.uniform(-amount, amount), 0]) for _ in range(n - 1)] + [base]
    return Succession(*[frame.animate(run_time=run_time / n, rate_func=linear).move_to(m) for m in moves])
