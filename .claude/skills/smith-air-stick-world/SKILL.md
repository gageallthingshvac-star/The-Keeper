---
name: smith-air-stick-world
description: Build vertical stick figure HVAC YouTube Shorts for Smith Air in Manim Community Edition using the fixed reusable stickworld library (jointed rig characters, HVAC props, sets, action library, recorded sound, timing config). Use for ANY stick figure, HVAC short, or animation request in this project, and whenever a scene, character, prop, sound or action is added or fixed.
---

# Smith Air Stick World

You are building short, funny stick figure animations about HVAC work. The owner (Gage) records his own voiceover afterward; the videos carry recorded sound effects and a quiet music bed underneath it. The visuals must make physical sense: every motion is caused by a body part, and nothing moves on its own. Follow this file exactly. Do not invent a new drawing style, rig or file layout. If something is not covered here, add it to the library in the same style and update this file's library list.

## 1. Output standards (never change unless asked)

- Engine: Python + Manim Community Edition 0.22, in the existing venv (`/home/user/manim-venv`; run `manim` and `python` from its `bin/`). Install into it if anything is missing (Manim needs the pango/cairo dev libraries on a fresh machine).
- Format: vertical 1080x1920, 30 fps, MP4 with audio (recorded effects + music bed, mixed with headroom for the voiceover).
- Workflow: render a low-quality preview first, check it, then the final:
  - preview: `manim -ql -r 540,960 episodes/<file>.py <SceneName>`
  - final: `manim -qh --fps 30 -r 1080,1920 episodes/<file>.py <SceneName>`
- Length: under 60 seconds. Every scene duration lives in a TIMING dict at the top of the episode file so it can be retimed to the voiceover (a scene that finishes early holds to its TIMING value).
- No text overlays, titles, outros, "subscribe" or calls to action, and no on-screen effect words by default: gags are sold with recorded sound (section 9b). Comic effect words (`effects.effect_word`) exist and are used only when Gage asks. End the video on the final action.
- Shorts-safe framing: keep faces and gags out of the bottom ~20% of the frame (y < -4.8, where the YouTube title and buttons sit) and the right ~10% (x > 3.6).
- Before handing back, scrub the preview at each scene boundary (save stills with ffmpeg or `-s`) and check the Quality checklist in section 10.

## 2. Project layout

```
.claude/skills/smith-air-stick-world/SKILL.md   this file
stickworld/
  __init__.py
  style.py        colours, stroke widths, figure proportions, z layers, setup_frame()
  rig.py          StickFigure: tracker-driven jointed rig, FK/IK, idle breathing and blinks
  face.py         Face: turn, blink, nod, look_at, expressions, talk
  actions.py      action library (walk, reach, grab, pull, yank_plug, peel, zapped...) + Gait + carry_together
  episode.py      EpisodeScene: TIMING blocks, background(), timing report, music
  audio.py        SoundScene, Snd/cue/snd, footsteps, music bed
  audio/          src/ (licensed recordings + CREDITS.md + licenses/), sfx/ (cut cues), prep_audio.py
  props/          base.py (Prop, attach/connect), hvac.py (+hvac_more.py), tools.py (+tools_more.py),
                  vehicles.py, effects.py (+effects_more.py)
  sets.py         house_side, driveway (+ sets_more.py: attic, crawlspace, rooftop, utility_closet)
  camera.py       punch_in, pan_to, reset, shake (MovingCameraScene)
  test_scene.py   exercises every action, expression, prop and set
episodes/
  ep01_package_unit.py   one file per short; only scene logic + TIMING (writes <file>_timing.md)
```

Episode files import from stickworld and contain NO custom drawing code. If an episode needs something new, add it to the library first (with a line in test_scene.py).

## 3. Style

- Background: plain white. Ground line: one black line across the frame.
- Figures: black (#111111) lines, stroke width 8 for limbs and body, head circle stroke 8, filled white.
- Props: flat shapes, black outlines stroke 5, minimal fill colour (constants in style.py):
  - old unit: dull beige (#C9B79C) with rust (#8B4513) spots and streaks, parody brand badge "LEMONNOX"
  - new unit: clean gray-blue (#9FB4C7) with a shine, badge "BRRRIER", sparkle on arrival
  - ducts and flashing: light gray (#BFBFBF), sheet-metal look (thin highlight lines; darker underside when peeled)
  - high voltage whip: thick gray conduit with a black outline; 2 black + 1 green conductors when pulled
  - low voltage wire: thin bundled red/white/green/yellow strands; 8 conductors (black, brown, green, blue, yellow, red, white, orange) when stripped
  - tools: red drills, black "MILWACKO" tool bag with a red band (deliberately garbled brand)
  - cold air: light blue (#7EC8F0) wavy lines; heat: light orange (#F5A15A); smoke: gray puffs that drift up and fade
- Scale: a figure stands about 520 px tall (H ~ 4.33 units) in the 1920 px frame. A package unit is about as tall as a figure's chest. Keep props in believable proportion to the figures.

## 4. Characters

Two recurring techs, both StickFigure instances.

- TECH1 ("Lead", `name="lead"`): the competent one. Plain head, carries the tool bag. Calm, deliberate timing, a little smug.
- TECH2 ("Rookie", `name="rookie", accessory="cap"`): the goofy one. Red ball cap with a brim that follows the face turn. Slightly faster, twitchier timing; overreacts.
- Optional extras (same class): HOMEOWNER (`accessory="hair_tuft"`), GC/BUILDER (`accessory="hard_hat"`). Add new accessories in rig.py `_draw_accessory`.
- Hair spikes (`hair` tracker) and the cap attach to the head and turn with it.

## 5. The rig (rig.py) — mandatory

The figure is a jointed skeleton driven by ValueTrackers; an updater redraws it every frame. Never animate a figure by shifting or transforming its line shapes directly.

- Joints: root (hips: trackers `x`, `y`) -> `spine` -> `neck` -> head; spine top -> `shoulder_L/R` -> `elbow_L/R` -> hand; hips -> `hip_L/R` -> `knee_L/R` -> foot. L = far limb (drawn behind), R = near limb (drawn in front, over the head).
- Angles: radians from "hanging straight down", positive = toward the way the figure faces. Arms are relative to the spine. Elbows bend forward only (0..2.8), knees backward only (-2.8..0); both are clamped.
- Bone lengths (H = 520 px): head radius 0.09H, neck 0.04H, torso 0.32H, upper arm 0.17H, forearm 0.16H, thigh 0.22H, shin 0.22H.
- Animate trackers only: `fig.angle("elbow_R").animate.set_value(...)`, `fig.pose({...} or "name", run_time, rate_func)`, or a library action.
- Feet: each leg has a lock tracker (`legL_lock`); locked legs solve two-bone IK to their planted foot point (`footL_x/y`), so the hips can move or crouch (`pose({"drop": 0.6})`) while the feet stay put. No sliding feet. `bake_leg()` hands a leg back to FK (jumps, kicks, sitting).
- Hands: `armL_lock` blends FK into IK toward a hand target (`handL_x/y`) or a pinned callable (`fig.pin("R", fn)`), so a hand can stay on a moving object. `bake_arm()` freezes the drawn arm into FK so it moves with the body again.
- Facing: `face_dir` (+1 right / -1 left, tweenable via `fig.turn(dir)`) mirrors the rig's angles, never the shapes.
- Idle life (on by default, `fig.idle(False)` to stop): breathing (torso scale 1.0 -> 1.01 over 2 s) and an automatic blink every 2.5–4 s.
- Squash & stretch: `sy` tracker (about the feet). Zap jitter: `jitter` tracker (20 Hz random joint offsets).
- POSES (actions.py): stand, crouch, reach_forward, reach_up, pull_back, carry_low, carry_high, lean_back, point, arms_crossed, hands_on_hips, shrug, flinch, celebrate, sit.

## 6. Holding objects — mandatory

- `fig.grab(obj, side, grip)`: look at the object -> reach (IK) -> 0.1 s -> attach. The object then follows the hand every frame (`rotate=True` to turn with the forearm) until release. It is raised to the held layer and goes back to its own layer when released.
- `fig.grab2(obj, grip_L, grip_R)`: both hands; the object follows the midpoint of the hands and turns with the line between them. `keep_pinned=True` pins the hands to the grips instead (the object drives the hands, for shared loads).
- `fig.release(obj, settle="drop"|"place"|"throw", ...)`: drop falls with gravity, a small bounce and a THUD for heavy things; place moves it to a target with the hands still on it, then lets go; throw follows a parabolic arc with spin.
- `carry_together([figs], obj, grips, run_time, path=|walk=|rise=|rot=)`: several figures move one object with their hands locked on its grip points, stepping with planted feet (`walk=(dx, dy)`) or standing up out of a squat (`rise=`).
- Nothing a figure interacts with may move unless a hand (or a clearly shown force like gravity, a thrown arc, or the explicit "rewind" gag) is moving it. If an object comes loose, the arm motion that causes it happens first.
- Screws: unscrewing shows a drill held to the screw for a beat (`Screw.back_out()` + "drill" cue), then the screw pops out on a small arc (`fly_off`). Screwing in reverses it (`fly_in` loose, then `drive_in` with the drill).

## 7. Face and head (face.py) — mandatory

The head circle pivots at the neck and never slides sideways. The face is separate shapes inside it (eyes, mouth, brows, lids, tongue, teeth).

- `face.turn` from -1 (left) to +1 (right), 0 = camera: features slide up to 0.55 x head radius and squash (1.0 -> 0.6 at the edge); the far eye moves a little less and gets smaller; the head tilts up to ~6 degrees with the turn.
- `fig.shake_head(times=3, slow=False, eyes_closed=False)`: sweeps -0.8 <-> +0.8 with ease in-out, ending at 0; slow = 0.6 s per sweep; eyes_closed shuts the eyes BEFORE the first sweep and opens them after a 0.2 s hold.
- `fig.blink()`: eyes squash fully flat (never partly open), hold two frames, reopen (~0.15 s).
- `fig.nod(times=2)`, `fig.look_at(point)` (eyes lead, head tilt follows 0.1 s later), `fig.talk(duration)`.
- `fig.expression(name)`: neutral, happy, smug, surprised, squint, disappointed, strain, tongue_out, dazed (X eyes). Individual feature trackers: `face._to(run_time, mouth_open=..., ...)`.

## 8. Action library (actions.py)

Every action is a StickFigure method that returns an Animation and only moves trackers; bigger ones use RigAnim (a per-frame function of eased progress). Use anticipation and follow-through.

- `walk_to(x, ground=None, speed=1.0, run_time=None, face=None, hold=(), hands=None)`: real walk cycle (Gait): planted feet, the swing foot lifts in an arc, hips dip at double support and rise at mid-stance, opposite arm swing, slight forward lean, turns to face the way it goes, settles at the stop, footstep cues on every landing. `face` different from the travel direction walks backward; `hold=("R",)` keeps a carrying arm still; `hands={"R": fn}` keeps a hand on a moving point.
- `run_to(x, ground)`, `step_back(distance)`.
- `hop_out(truck, land_x, ground, tumble=False)`: door opens, steps (or tumbles face-first) out of the cab, door closes. `get_up(ground)` after a tumble.
- `reach(side, point_or_fn, run_time, lean=True, pin=False)`: two-bone IK; leans the spine if the point is out of reach (pass `lean=False` when a pose is already driving the spine).
- `grab`, `grab2`, `release`, `carry_together`: section 6. `lift(obj)`: crouch with a straight back, grab, stand up straining. `carry_walk(x, ground)`.
- `pull(side, strength)`: anticipation lean in, strong pull back with a back step.
- `yank_plug(obj, foot_point, ...)`: grab with both hands, foot planted on the unit, lean back straining, POP (cue), stumble back two steps holding the object, small wobble.
- `foot_to(side, point)`: put a foot on something (IK leg).
- peel: hand pinches `FlashingPanel.pt("free_end")`, the figure steps back toward the house with that hand pinned (`walk_to(..., hands=...)`) while `panel.peel_to(0.6)` runs, lets go, and the sheet flops the rest of the way (`peel_to(1.0)` with a bounce). The sheet bends along a smooth curve (rounded fold at the hinge), never as a rigid rectangle.
- `thread_wire(cable, terminal, tip_offset=, pace=)`: tongue_out + squint, the hand inches toward the terminal, misses above and below with tiny jerks (tink), then succeeds; follow with `exhale()`.
- `push_switch(switch, on)`: reach the handle, then flip with a wrist snap while the hand rides the handle.
- `point_at(target)`, `shrug()`, `facepalm()`, `hands_on_hips()`, `arms_crossed()`, `celebrate()` (fist pump), `wipe_brow()`.
- `zapped(source=point)`: zap cue, arcs from the source to the hand, body jitters at 20 Hz for 0.5 s, hair/cap spikes straight up, X eyes, smoke off the head, dazed stars, then a recovery blink. `hair_down()` later.
- `flinch()`: crouch, arms over the head, eyes squeezed; then slowly peek.

Timing rules: big actions 0.6–1.2 s; small gestures 0.3–0.5 s; holds of at least 0.3 s after a gag lands. Default rate_func smooth; there_and_back for nods, rush_from for snaps, ease_out_back for pops.

Scene helpers (episode.py): `with self.block("name"):` for each TIMING entry; `self.background(anim)` to let an action (a figure walking somewhere) run across the next several plays; `self.finish()` at the end.

## 9. Props and sets

Every prop is a `Prop` (props/base.py) with named sub-parts (`prop.parts`) and named points (`prop.pt(name)`) that move with it, so actions can target grip points and connection points.

- hvac.py: `PackageUnit(cx, pad_top, old)` (points grip_L/R(+_low), supply_open, return_open, whip_terminal, lv_terminal, foot_spot, top_center, panel_screw_0..3; `arrive_sparkle()`), `Disconnect(center, on)` (handle, pivot, whip_out; `flip(on)`), `Duct(x_wall, x_unit, y)` (unit_end, wall_end, grip_L/R), `FlashingPanel(x_hinge, x_free, y0, y1, kind="top"|"side")` (free_end; `peel_to(p)`), `Screw(p)` (`back_out`, `drive_in`, `fly_off`, `fly_in`), `HighVoltageWhip(...)` / `LowVoltageWire(...)` (Cable: `connect_end(fn)`, `free_end()`, `strip(on)`, `reshape(c2)`; add `.mob` and `.end` to the scene). hvac_more.py: SplitCondenser, AirHandler, Furnace, EvapCoil, LineSet, Thermostat, CondensateDrain, FilterRack, BreakerPanel.
- tools.py: `ToolBag(handle_top)` (handle, opening), `Drill(grip, face)` (grip, tip, `tip_offset`). tools_more.py: Screwdriver, Multimeter, GaugeSet, RecoveryMachine, RefrigerantTank, Level, Dolly, Ladder, Flashlight, MasticBucket, MasticBrush.
- vehicles.py: `WorkTruck(front_x, street_y)` (driver_seat, passenger_seat, door_step, door_hinge, bed_center, bed_floor, bed_rail, exhaust; `drive_in(dx, riders)` rolls in with turning wheels, a bounce and an exhaust puff; `open_door()`, `close_door()`, `bounce()`). No lettering unless asked. Riders sit behind the cab at `Z_FIGURE_HIDDEN` with tucked legs.
- effects.py: `smoke`, `dust`, `sparkles`, `stars`, `bolt`, `zap_arcs`, `cold_air(clock, lanes, x_from, x_to)`, `vibration_lines(clock, anchors)`, `hum_shake(mob, clock)`, `effect_word` (on request only). effects_more.py: heat_waves, motion_lines, sweat, question_mark.
- sets.py: `house_side(ground_y, wall_x, pad)` (ground, wall_face, disconnect_mount, pad_center, window, sky), `driveway(street_y, curb_y)` (street, curb, truck_front, lawn). sets_more.py: attic, crawlspace, rooftop, utility_closet.
- camera.py: `punch_in(scene, point, zoom)`, `pan_to`, `reset`, `shake`.

Connections: `connect(child, "point", parent, "point")` / `Cable.connect_end(fn)` keep things attached while they move, until a figure's action disconnects them.

### 9b. Sound

- Effects are real recordings (stickworld/audio/src, credits and licenses in src/CREDITS.md), cut into cues in stickworld/audio/sfx by `prep_audio.py`. Cue names: truck, squeak, cough, whoosh, whoosh_long, thump, thud, crash, tools, rattle, zap, fizz, clunk, drill, ping, catch, creak, chomp, pop_big, pop, pop_small, clatter, yank, crickets, rip, chime, ding, tink, click, rewind, hum, step1–3.
- Trigger with `Snd("name")` inside an animation group, `self.snd("name", delay)` in a scene, or let actions do it (footsteps, zap, pop, tink...). Cues land on the exact frame even mid-animation.
- Music: `audio/src/music.mp3` ("Happy Whistling Ukulele", Rafael Krux, CC0), laid under everything by `finish()`, trimmed and faded to the running time at about -13 dB below the effects.
- New sounds: only CC0 / public domain / CC BY (record the credit line). Never NC/ND, "personal use", or sounds ripped from games, films or YouTube. Add the file to audio/src, a line to CREDITS.md, a cue to prep_audio.py, and rerun it. The video description must carry the CC BY credit lines listed in CREDITS.md.

## 10. Quality checklist (check before every handoff)

- Every moving object is held by a hand, attached by a connection, or obviously under gravity, a throw or a gag.
- Hands actually reach objects before grabbing; no grabbing from a distance.
- Feet do not slide while standing or walking; walking feet plant and lift.
- Heads turn by moving the face features inside the circle; the head never slides sideways as a whole.
- Blinks and closed eyes go fully flat.
- Elbows and knees bend the natural way.
- Each gag has anticipation, the action, and a hold of at least 0.3 s.
- Props are in proportion; nothing clips through the ground or the wall; nothing important sits in the Shorts UI zones.
- Sound cues land on their actions; the mix leaves room for the voiceover (peaks around -4 dB).
- Frame is 1080x1920 at 30 fps, video under 60 s, no text overlays.
- Report: the output file path, total length, and the scene-by-scene timing table (scene, start, end; written to `episodes/<file>_timing.md`) so Gage can record his voiceover to it.

## 11. How episodes are requested and written

Gage will describe the short in plain language as a list of scenes. For each episode:

1. Create `episodes/epNN_<slug>.py`: a class deriving from `EpisodeScene` with a TIMING dict (scene name -> seconds) and one `with self.block(name):` per scene that only calls library actions.
2. If a scene needs a new prop, action, expression or sound, add it to the library (with a line in test_scene.py) instead of hard-coding it in the episode.
3. Render the preview, check the checklist, fix problems, then render the final.
4. Hand back the file path, the timing table, and up to three suggestions for making the gags land better. Do not change the gags Gage chose without asking.

## 12. Episode 01 reference (package unit changeout)

`episodes/ep01_package_unit.py`, the pattern for future shorts (~58.7 s):

1. arrive: the truck rolls in (wheels turning) and stops with a bounce and an exhaust puff; the old unit coughs a puff of smoke.
2. hop_out: TECH1 opens the door and steps out; TECH2 tumbles out face-first and gets up. TECH1 lifts the MILWACKO bag out of the truck bed and walks up to the unit; TECH2 wanders to the yard.
3. zap: TECH1 fights the screwed-down flashing (rattle) while TECH2 crouches and grabs the live whip: zapped(). TECH1 slowly shakes his head, then pulls the disconnect (clunk).
4. drills: TECH1 pulls two drills from the bag, tosses one to TECH2; they drive the flashing screws out row by row (crouching for the bottom row); drills back in the bag.
5. peel: TECH1 peels the top panel, then the side panel, back toward the house like a banana (hand on the edge, stepping back), and pretends to take a bite (chomp).
6. ducts: TECH1 yank_plug()s each duct off the unit, foot on the cabinet: POP, stumble, throws it on the pile.
7. pull_start: TECH1 grabs the whip and the low voltage low on the unit and rips them out in one lawnmower pull (conductors out). Nothing happens (crickets, two blinks). TECH2 stares and slowly shakes his head, eyes closed.
8. carry_toss: both squat, grip the old unit, rattle it loose, RIIIP, carry it down to the truck and toss it in the bed (crash, bounce, camera shake).
9. new_unit: the new unit slides in with sparkles while they walk back.
10. rewind: tape-rewind sound; the ducts click back in, the flashing un-peels, the screws fly back loose and the techs drive them in with the drills.
11. thread: punch-in; TECH1 kneels and thread_wire()s the low voltage into the grommet: tongue out, squint, misses twice, gets it; the conductors slide in; exhale.
12. power_up: TECH1 flips the disconnect back on; the new unit hums and cold air flows into the house. End.
