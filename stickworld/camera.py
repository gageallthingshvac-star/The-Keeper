"""Camera helpers for the vertical frame (needs a MovingCameraScene). Each returns an Animation."""
import random

import numpy as np
from manim import Succession, linear, smooth

from .style import FRAME_H, FRAME_W


def punch_in(scene, point, zoom=0.55, run_time=0.8, rate_func=smooth):
    """Zoom toward point; zoom is the fraction of the full frame left visible (0.5 = 2x closer)."""
    frame = scene.camera.frame
    return frame.animate(run_time=run_time, rate_func=rate_func).set(height=FRAME_H * zoom).move_to(point)


def pan_to(scene, point, run_time=0.8, rate_func=smooth):
    return scene.camera.frame.animate(run_time=run_time, rate_func=rate_func).move_to(point)


def reset(scene, run_time=0.8, rate_func=smooth):
    return scene.camera.frame.animate(run_time=run_time, rate_func=rate_func).set(height=FRAME_H).move_to(np.zeros(3))


def shake(scene, amount=0.15, n=7, run_time=0.45, seed=11):
    frame = scene.camera.frame
    base = frame.get_center()
    rng = random.Random(seed)
    moves = [base + np.array([rng.uniform(-amount, amount), rng.uniform(-amount, amount), 0]) for _ in range(n - 1)] + [base]
    return Succession(*[frame.animate(run_time=run_time / n, rate_func=linear).move_to(m) for m in moves])
