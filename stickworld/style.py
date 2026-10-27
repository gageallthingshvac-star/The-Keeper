"""Smith Air Stick World: colours, stroke widths, sizes, layers and easing defaults.

Everything is in Manim units. The frame is 9 x 16 units (1080 x 1920 px), so 1 unit = 120 px.
"""
import numpy as np
from manim import config, smooth

# ---------------------------------------------------------------- frame
FRAME_W, FRAME_H = 9.0, 16.0
PX = FRAME_H / 1920  # one pixel of the final 1080x1920 frame, in units


def setup_frame():
    """Force a portrait 9:16 frame whatever -q / -r preset the command line used."""
    if config.pixel_width > config.pixel_height:
        config.pixel_width, config.pixel_height = config.pixel_height, config.pixel_width
    config.frame_height = FRAME_H
    config.frame_width = FRAME_W
    config.background_color = WHITE


# ---------------------------------------------------------------- colours
WHITE = "#FFFFFF"
INK = "#111111"
OLD_UNIT = "#C9B79C"
OLD_UNIT_DARK = "#B3A184"
RUST = "#8B4513"
RUST_LIGHT = "#A0522D"
NEW_UNIT = "#9FB4C7"
NEW_UNIT_DARK = "#7F98AF"
METAL = "#BFBFBF"
METAL_DARK = "#9C9C9C"
METAL_BACK = "#A9A9A9"  # underside of peeled sheet metal
METAL_HI = "#E4E4E4"    # thin sheet-metal highlight lines
COLD_AIR = "#7EC8F0"
HEAT = "#F5A15A"
SMOKE = "#9E9E9E"
WORD_FILL = "#FFD23F"
CAP_RED = "#C0392B"
HARD_HAT = "#F2C230"
TOOL_RED = "#C8102E"   # drills / tool bag accents
CONCRETE = "#D2D2D2"
WALL = "#F3F0EA"
SIDING = "#D8D2C8"
ROOF = "#5E5E5E"
GRASS = "#7A9A6A"
WOOD = "#C69C6D"
INSULATION = "#F4C2A1"
TONGUE = "#E87A8A"
SPARK = "#FFD54A"
LV_STRANDS = ["#D63A2F", "#FFFFFF", "#2E9E44", "#F2D21B"]  # low-voltage cable look (red/white/green/yellow)
LV_CONDUCTORS = ["#111111", "#7B4A1E", "#2E9E44", "#2F6FD6", "#F2D21B", "#D63A2F", "#FFFFFF", "#F28C1B"]
WHIP_CONDUCTORS = ["#111111", "#111111", "#2E9E44"]

# ---------------------------------------------------------------- strokes
LIMB_W = 8      # figure limbs, body and head outline
PROP_W = 5      # prop outlines
DETAIL_W = 2.5  # small prop details
FACE_W = 5

# ---------------------------------------------------------------- figure proportions (doc section 5)
H = 520 * PX            # standing figure height, ~4.33 units
HEAD_R = 0.09 * H
NECK = 0.04 * H
TORSO = 0.32 * H
UPPER_ARM = 0.17 * H
FOREARM = 0.16 * H
THIGH = 0.22 * H
SHIN = 0.22 * H
LEG = THIGH + SHIN
STAND_HIP = LEG * 0.975  # hip height above the ground when standing (knees not locked)
STANCE = 0.18            # half the gap between the feet when standing

# ---------------------------------------------------------------- layers (z_index)
Z_SET = 0
Z_SET_FRONT = 0.5
Z_BEHIND = 1
Z_PROP = 2
Z_FLASHING = 3
Z_PROP_FRONT = 3.5
Z_SCREW = 4
Z_WIRE = 5
Z_FIGURE_HIDDEN = 5.5   # a figure sitting inside the truck cab
Z_TRUCK = 6
Z_FIGURE = 7
Z_HELD = 7.5
Z_FX = 9
Z_WORD = 10

# ---------------------------------------------------------------- timing defaults (doc section 8)
BIG_ACTION = 0.8
SMALL_GESTURE = 0.4
GAG_HOLD = 0.35
DEFAULT_RATE = smooth


def P(x, y):
    return np.array([float(x), float(y), 0.0])
