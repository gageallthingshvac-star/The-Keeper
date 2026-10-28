---
name: smith-air-stick-world
description: Build vertical stick figure HVAC YouTube Shorts for Smith Air in Manim Community Edition using the fixed reusable stickworld library (jointed rig characters, HVAC props, sets, action library, recorded sound, timing config). Use for ANY stick figure, HVAC short, or animation request in this project, and whenever a scene, character, prop, sound or action is added or fixed.
---

# Smith Air Stick World

You are building short, funny stick figure animations about HVAC work. The owner (Gage) records his own voiceover afterward; the videos carry recorded sound effects and a quiet music bed underneath it. The visuals must make physical sense: every motion is caused by a body part, and nothing moves on its own. Follow this file exactly. Do not invent a new drawing style, rig or file layout. If something is not covered here, add it to the library in the same style and update this file's library list.

## 1. Output standards (never change unless asked)

- Engine: Python + Manim Community Edition 0.22, in the existing venv (`/home/user/manim-venv`; run `manim` and `python` from its `bin/`). Install into it if anything is missing (Manim needs the pango/cairo dev libraries on a fresh machine).
- Format: vertical 1080x1920, 60 fps (smoother motion reads as more satisfying; Gage asked for maximum polish), MP4 with audio (recorded effects + music bed, mixed with headroom for the voiceover).
- Workflow: render a low-quality preview first, check it, then the final:
  - preview: `manim -ql -r 540,960 episodes/<file>.py <SceneName>`
  - final: `manim -qh --fps 60 -r 1080,1920 episodes/<file>.py <SceneName>`
- Length: under 60 seconds. Every scene duration lives in a TIMING dict at the top of the episode file so it can be retimed to the voiceover (a scene that finishes early holds to its TIMING value).
- The only on-screen text is the series tag: `self.episode_tag()` pops a small "EP n" work-order ticket into the top-left corner for the first ~2.5 s (Gage asked for numbered episodes). Otherwise no text overlays, titles, outros, "subscribe" or calls to action, and no on-screen effect words by default: gags are sold with recorded sound (section 9b). Comic effect words (`effects.effect_word`) exist and are used only when Gage asks. End the video on the final action.
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
  actions.py      action library (walk, climb, reach, grab, pull, haul, yank_plug, zapped...) + Gait + carry_together, pull_out
  episode.py      EpisodeScene: TIMING blocks, background(), timing report, music
  audio.py        SoundScene, Snd/cue/snd, footsteps, music bed
  audio/          src/ (licensed recordings + CREDITS.md + licenses/), sfx/ (cut cues), prep_audio.py
  props/          base.py (Prop, attach/connect), hvac.py (+hvac_more.py), tools.py (+tools_more.py),
                  vehicles.py, effects.py (+effects_more.py), home.py (couch, TV, wall clock, lockout tag, filter)
  sets.py         house_side, driveway (+ sets_more.py: attic, house_night, crawlspace, rooftop, utility_closet)
  continuity.py   season memory: what each episode starts with (rookie_marks, trophies)
  camera.py       punch_in, pan_to, reset, shake (MovingCameraScene)
  test_scene.py   exercises every action, expression, prop and set
episodes/
  ep01_package_unit.py   one file per short; only scene logic + TIMING (writes <file>_timing.md)
  ep02_attic_air_handler.py
  ep03_movie_night.py
  SERIES.md              the season bible (arc, cast, episode guide, continuity tracker)
  renders/               final MP4s
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

- TECH1 ("Lead", `name="lead", rest_face=dict(mouth_curve=0.45)`): THE MAIN CHARACTER, in every episode, and the likeable one. Warm, easy resting smile (his "neutral" face returns to it), calm and competent, patient with the rookie (he helps him up, he doesn't gloat). Signature: when the job is done he turns to the camera and gives a thumbs-up with a wink, a twinkle and a ding (`thumbs_up()`); end every episode on it. No facial hair and no blush on anyone (Gage's call). Carries the tool bag; deliberate timing.
- TECH2 ("Rookie", `name="rookie", accessory="cap", marks=C.rookie_marks(ep)`): the goofy one, learning across the season (scars carry over, see 9d). Red ball cap with a brim that follows the face turn. Slightly faster, twitchier timing; overreacts.
- Optional extras (same class): HOMEOWNER (`accessory="hair_tuft"`, the EP2 Sweaty Neighbor), the EP3 movie-night NEIGHBOR (`accessory="bun"`: hair bun with a hairline), GC/BUILDER (`accessory="hard_hat"`). Add new accessories in rig.py `_draw_accessory`.
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
- Pinned hands (`grab2(obj, a, b, keep_pinned=True)`, `pin()`) stay on the object while it moves; `let_go(sides)` takes them off and drops the arms to rest. Pin hands to a point of the prop that owns it (`dolly.pt("handle")`), not of a Bundle that will later be split.
- Loads made of several props (an air handler standing on a hand truck): `bundle(*props)` (props/base.py) moves them as one rigid Prop (add the bundle, not the props; `pt()` finds points in its members); `unbundle(scene, b, prop)` hands a prop back. `ride(mob, point, path, angle, progress)` drives a prop along a path with a ValueTracker (a rope haul or a slide feeds it); `turn_about(mob, angle, point)` tips it about one of its points (hand truck back onto its wheels, laying it down). Stop a ride with `detach(mob)`.
- Nothing a figure interacts with may move unless a hand (or a clearly shown force like gravity, a thrown arc, or the explicit "rewind" gag) is moving it. If an object comes loose, the arm motion that causes it happens first.
- Screws: unscrewing shows a drill held to the screw for a beat (`Screw.back_out()` + "drill" cue), then the screw pops out on a small arc (`fly_off`). Screwing in reverses it (`fly_in` loose, then `drive_in` with the drill).

## 7. Face and head (face.py) — mandatory

The head circle pivots at the neck and never slides sideways. The face is separate shapes inside it (eyes, mouth, brows, lids, tongue, teeth).

- `face.turn` from -1 (left) to +1 (right), 0 = camera: features slide up to 0.55 x head radius and squash (1.0 -> 0.6 at the edge); the far eye moves a little less and gets smaller; the head tilts up to ~6 degrees with the turn.
- `fig.shake_head(times=3, slow=False, eyes_closed=False)`: sweeps -0.8 <-> +0.8 with ease in-out, ending at 0; slow = 0.6 s per sweep; eyes_closed shuts the eyes BEFORE the first sweep and opens them after a 0.2 s hold.
- `fig.blink()`: eyes squash fully flat (never partly open), hold two frames, reopen (~0.15 s).
- `fig.nod(times=2)`, `fig.look_at(point)` (eyes lead, head tilt follows 0.1 s later), `fig.talk(duration)`.
- `StickFigure(..., rest_face=dict(...))` gives a character its own resting face ("neutral" returns to it). `fig.wink(hold)`: the right eye shuts in a happy arc for a beat.
- Expressions are timed (Gage's rule): an expression lasts only as long as the moment needs. After its tween it holds for its natural beat (`face.EXPRESSION_HOLD`: surprised 0.7 s, happy 1.1 s, disappointed 1.2 s...) and then the face eases back on its own to the character's resting face (the lead's smile). Pass `hold=seconds` when the moment is longer (squinting through a whole brazing job), `hold=KEEP` (from stickworld.face) only for a final pose that must stay to the end. Talking pauses the relax.
- `fig.expression(name, run_time, hold=None)`: neutral, happy, smug, surprised, squint, disappointed, strain, tongue_out, dazed (X eyes). Individual feature trackers: `face._to(run_time, mouth_open=..., ...)`.

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
- `thumbs_up(hold, wink=True, face=None)`: (face=±1 turns the body first so the hand comes up clear of props) face to camera, near hand pops into a thumbs-up (fist + thumb drawn by the `thumb` tracker) with a twinkle star and a ding, big smile and a wink, then the arm drops. The lead's job-done signature.
- `keyframes(keys, run_time)`: pose-to-pose motion with planted contacts (keys of hip, footL/R, handL/R (point, callable or None = rest), joint angles); every changing foot or hand lifts in a small arc and lands, nothing slides. Base for climbing and scrambling.
- `climb(treads, landing, lip, hunch=, down=False)`: ladder / pull-down stair, always chest to the ladder: the figure first turns to face it, keeps its body close and parallel to the rails, knees bending in toward it, eyes up the ladder. Stand at `climb_start(treads)`; feet go tread to tread, the opposite hand moves up the rail, at the top the hands go to the lip and the floor and the feet step off to `landing`. `down=True` comes down still facing the ladder (backing down, eyes down): stand at the landing first. Footsteps + creaks. Never climb with the back to a ladder.
- `fall_through(hole_x, floor, hole=CeilingHole)`: steps onto a gap between joists, one leg plunges through the ceiling to the hip, arms fly up, CRASH + rip, the hole bursts and debris falls into the room. Then `kick_leg(times)` and module-level `pull_out(helper, stuck, stand_x)` (hands meet, helper leans back, the stuck foot comes straight up out of the hole, both feet land standing).
- Tools up a ladder: `sling(bag)` swings the tool bag onto his back like a pack (hands free; it leans with him), `unsling(bag, floor_point)` sets it down upright at the work spot. `fetch_tool(bag, tool)` crouches and comes up with the tool from the bag's opening, `use_tool(tool, point, turns=3)` puts the tool's tip on a spot and works it in small circles (turns=0 holds it, for a torch), `stow_tool(bag, tool)` puts it back. Work with real tools: a tubing cutter to cut copper, a torch to braze, drills for screws.
- `wear(bag)`: the bag is already on his back (the end state of `sling`), for a figure who arrives carrying it; `unsling` sets it down when he gets to work (do, if it would hide what he's working on). `relocate(x, ground)` (call with Do while he's out of shot) moves a figure instantly, pose kept: walking out one side of the frame and back in elsewhere (around to the front door) instead of floating up a cutaway between the street and the house.
- `slide_push(obj, x, grips)`: both hands on a heavy box's near side, lean in, walk; it scrapes along flat on the floor. `wheel_to(x, load)`: walk a hand-truck load with both hands on the handle (take it with grab2 keep_pinned, tip it back with turn_about first).
- `haul(rope, progress, amount, pulls, toward=lip)`: hand-over-hand on a Rope; each pull advances the load's ride tracker; the rope's hauler end follows the pulling hand.
- `sweep_breakers(panel, on, side="R", order=None, per=0.075, main=True, each=None, at_main=None)`: the hand runs down an open BreakerPanel flipping breaker after breaker (click, click...) and the main last. `each(k, n)` returns an animation to run with the k-th flip (the house dimming one circuit at a time: `tween_value(dark, ...)`), `at_main` one to run with the main. `order=` skips circuits (all back on except the one being locked out).

Timing rules: big actions 0.6–1.2 s; small gestures 0.3–0.5 s; holds of at least 0.3 s after a gag lands. Default rate_func smooth; there_and_back for nods, rush_from for snaps, ease_out_back for pops.

Scene helpers (episode.py): `with self.block("name"):` for each TIMING entry; `self.background(anim)` to let an action (a figure walking somewhere) run across the next several plays; `self.finish()` at the end.

## 9. Props and sets

Every prop is a `Prop` (props/base.py) with named sub-parts (`prop.parts`) and named points (`prop.pt(name)`) that move with it, so actions can target grip points and connection points.

- hvac.py: `PackageUnit(cx, pad_top, old)` (points grip_L/R(+_low), supply_open, return_open, whip_terminal, lv_terminal, foot_spot, top_center, panel_screw_0..3; `arrive_sparkle()`), `Disconnect(center, on)` (handle, pivot, whip_out; `flip(on)`), `Duct(x_wall, x_unit, y)` (unit_end, wall_end, grip_L/R), `FlashingPanel(x_hinge, x_free, y0, y1, kind="top"|"side")` (free_end; `peel_to(p)`), `Screw(p)` (`back_out`, `drive_in`, `fly_off`, `fly_in`), `HighVoltageWhip(...)` / `LowVoltageWire(...)` (Cable: `connect_end(fn)`, `free_end()`, `strip(on)`, `reshape(c2)`; add `.mob` and `.end` to the scene). hvac_more.py: SplitCondenser, AirHandler (`drain_side="left"|"right"`; points grip_L/R(+_low), top_L/R, lineset, drain, supply_top, base...), Furnace, EvapCoil, LineSet (`reshape(points)`), Thermostat (`set_temp`; `mode("cool"|"fan"|None)` lights a snowflake / fan icon under the screen, point `mode_button` to press), CondensateDrain, FilterRack, BreakerPanel.
- hvac_more.py `EvapCoil(..., iced=True)` starts frozen solid (ice over the A-coil, a frost rim and icicles hanging off the case, readable from across the room); `coil.melt(run_time)` shrinks and fades it (pair with `CondensateDrain.drip(n)` and a WallClock spin for a time-lapse). `Icicle(coil.pt("icicle"), length, width)` is a loose one to snap off (grab "grip"), hold up and drop: the clearest way to show "it's frozen".
- tools.py: `ToolBag(handle_top)` (handle, opening), `Drill(grip, face)` (grip, tip, `tip_offset`). tools_more.py: Screwdriver, Multimeter, GaugeSet, RecoveryMachine, RefrigerantTank, Level, Dolly (hand truck; `facing=-1` puts the nose plate on the left; points handle, axle, nose, load, base), Ladder, Flashlight (`beam(on)`; `hold(hand_fn, aim=point)` rides the hand and keeps the beam pointed at its target while the body moves), MasticBucket, MasticBrush, `Rope(*anchors, tail_to=)` (anchors are points or callables, anchors[0] is the hauler's end with the slack tail to a coil; `hold(fn)`, `throw(anchors)`), `TubingCutter(grip, face)` (grip, tip), `Torch(grip, face)` (MAP-gas brazing torch; grip, tip; `flame(on)`).
- vehicles.py: `WorkTruck(front_x, street_y)` (driver_seat, passenger_seat, door_step, door_hinge, bed_center, bed_floor, bed_rail, exhaust; `drive_in(dx, riders)` rolls in with turning wheels, a bounce and an exhaust puff; `open_door()`, `close_door()`, `bounce()`). No lettering unless asked. Riders sit behind the cab at `Z_FIGURE_HIDDEN` with tucked legs.
- effects.py: `smoke`, `dust`, `sparkles`, `stars`, `bolt`, `zap_arcs`, `cold_air(clock, lanes, x_from, x_to, vertical=False)` (vertical: lanes are x positions, air pours down out of a register), `vibration_lines(clock, anchors)`, `hum_shake(mob, clock)`, `effect_word` (on request only). effects_more.py: heat_waves, motion_lines, sweat, question_mark, debris (drywall chips + insulation falling), spark_shower, impact_burst, squash_land, glow, pop, `lights_out(level, region, figures)` (power cut: a near-black overlay over the region as the `level` tracker goes 0 -> 1, leaving only the figures' eyes; a flashlight raised above it in z lights the dark).
- home.py: `Couch(x, floor_y, width, facing)` (seat, seat_far, arm, base; a sitter's hips go at `seat`), `TV(x, floor_y, facing, on, reach)` (side view; the picture shows as a flickering coloured glow cone; `screen(on)`), `WallClock(center, radius, hour)` (`spin(hours, run_time)`: time-lapse hands), `LockoutTag(hang)` (red tag on a string at a breaker), `Filter(center, width, height, dirty)` (loose pleated filter; grip, center).
- sets.py: `house_side(ground_y, wall_x, pad)` (ground, wall_face, disconnect_mount, pad_center, window, sky), `driveway(street_y, curb_y)` (street, curb, truck_front, lawn). sets_more.py: attic, crawlspace, rooftop, utility_closet, CeilingHole.
  - `attic(floor_y, room_floor=, hatch_x=, stair_foot="left", walkway=(x0, x1), register_x=, light_x=, thermostat_x=, work_x=, plenum_x=, plenum_y=)`: gable attic over a room in cutaway; the pull-down stair runs from the hatch to the room floor with even ~11 in risers and is drawn in front of props (a hauled load rides between its rails). Anchors: hatch, lip, ceiling, stair_top, stair_bottom, tread_0.. (`.treads`), room_floor, thermostat_spot (60 in up), register, plenum_bottom, work_spot, walkway_left/right, peak. Headroom is low toward the eaves (about 5.6 - 0.75|x| above the floor): keep standing figures within |x| < 1.4, hunch (spine 0.15) in the attic.
  - `CeilingHole(x, top_y, bottom_y)`: the hole a foot leaves (dark gap, torn drywall flaps, insulation fluff); `burst()`.
  - `house_night(floor_y, room_color=, partition_x=, register_x=, window_x=, clock_x=, trunk_x=, trunk_y=)`: a house cut open at night under a starry sky (living room left, utility closet right behind a partition with a doorway, moon in the window, ceiling register, supply trunk into the ceiling). Add `driveway()` BEFORE it (its night tint darkens the yard). Anchors: floor, ceiling, doorway, couch_spot, tv_spot, thermostat_spot, panel_spot, equipment_spot, clock_spot, register, window, front_step. Tween `parts["room"]` from ROOM_HOT to ROOM_COOL for the payoff.
- camera.py: `punch_in(scene, point, zoom)`, `pan_to`, `reset`, `shake`.

Connections: `connect(child, "point", parent, "point")` / `Cable.connect_end(fn)` keep things attached while they move, until a figure's action disconnects them.

Prop-building notes:
- hvac_more.py holds shared drawing helpers for new props: `IN` (one inch at figure scale), `rect`, `seg`, `tube`, `rounded_path`, `offset_path`, `teardrop`, `SevenSeg` (LCD digits), `Tween` (an UpdateFromAlphaFunc that reads its start state when it begins). Material colours not in style.py (copper, brass, hoses, dirt...) are defined at the top of the *_more files; move one into style.py if a second file needs it.
- Animate a ValueTracker (a clock, a darkness level, a ride's progress) with `actions.tween_value(tracker, value, run_time)` when it sits inside a Succession or an action hook; `tracker.animate` gets overwritten there. Effects that are rebuilt every frame should keep a fixed set of shapes and update them (an updater), not `always_redraw` with a changing number of shapes, which loses their z order.
- Never animate a freshly built `VGroup(...)` of a prop's parts (`VGroup(a, b).animate...`): Manim adds that wrapper to the scene, so the parts draw twice and outlive the prop. Animate the prop, one part, or use an UpdateFromAlphaFunc on the prop.
- Points that live on a moving sub-part (a filter's grip, a panel door handle) move with that part: animate `prop.parts["filter"]`, not the whole prop.
- Small printed labels on equipment (R-410A, IN/OUT, MASTIC) can be turned off with `label=None` / `labels=False`.

### 9b. Sound

- Effects are real recordings (stickworld/audio/src, credits and licenses in src/CREDITS.md), cut into cues in stickworld/audio/sfx by `prep_audio.py`. Cue names: truck, squeak, cough, whoosh, whoosh_long, thump, thud, crash, tools, rattle, zap, fizz, clunk, drill, ping, catch, creak, pop_big, pop, pop_small, clatter, yank, crickets, rip, chime, ding, tink, click, rewind, hum, step1–3.
- Trigger with `Snd("name")` inside an animation group, `self.snd("name", delay)` in a scene, or let actions do it (footsteps, zap, pop, tink...). Cues land on the exact frame even mid-animation.
- Mix ceiling: `finish()` caps the mix peak at `PEAK_DB` (-5.5 dB) because AAC encoding overshoots sharp transients by up to ~3 dB; the MP4 then peaks around -3 to -4 dB, leaving room for the voiceover.
- Music: `audio/src/music.mp3` ("Happy Whistling Ukulele", Rafael Krux, CC0), laid under everything by `finish()`, trimmed and faded to the running time at about -13 dB below the effects.
- New sounds: only CC0 / public domain / CC BY (record the credit line). Never NC/ND, "personal use", or sounds ripped from games, films or YouTube. Add the file to audio/src, a line to CREDITS.md, a cue to prep_audio.py, and rerun it. The video description must carry the CC BY credit lines listed in CREDITS.md.

## 9c. Polish: make it satisfying (researched; apply on every episode)

Game "juice" and classic animation principles, layered with restraint (big beats only):
- Contact shadows anchor everything (figures draw their own; add `ground_shadow(prop, floor_y, span=)` for big props, one per floor they touch). Without them nothing has weight.
- Impacts stack 4-6 responses inside ~0.1 s: the sound, `impact_burst(point)`, `camera.shake`, dust, squash (`squash_land(prop)` on landings), and a 0.08 s hit-stop `self.wait(0.08)` after the biggest hits. Never on routine actions.
- Particles sell heat and power: `spark_shower(point_or_fn)` for torches, zaps and grinding; `glow(point)` for metal taking heat; `heat_waves` for hot rooms. `pop(mob)` for things snapping/ticking (never `.animate` + there_and_back on something that changes during the pop).
- Ease everything (smooth in/out); overshoot (`ease_out_back`) only for pops and arrivals; damped wobble to settle.
- The camera works: open close on the problem (the first frame must show tension: sweat, a broken unit, the 78), pull back to reveal as the heroes arrive, slow drifts under calm beats (`self.background(camera.punch_in(..., run_time=4))`), punch in on the satisfying details (a torch on copper, digits ticking down, a screw driving home), `camera.follow(scene, fn)` for a moving subject, swoop between close-ups with a quiet whoosh, and end on a gentle push-in on the payoff. Keep the focal point centred so it stays out of the Shorts UI zones.
- Completion payoffs ("just right"): things click into place with a click and a small pop/sparkle; a colour change that resolves the problem (`attic(room_color=ROOM_HOT)` -> tween parts["room"] to ROOM_COOL when the AC comes on); one degree per click on a thermostat.

## 9d. Series and continuity (episodes remember)

The shorts form one season-long story (`episodes/SERIES.md`, "The Rookie's First Summer") while each still works alone.
- `stickworld/continuity.py`: `EPISODES` (per episode: job, the rookie's mistake, the lesson, what he earns, whether a LEMONNOX gets hauled off), `rookie_marks(ep)` (scars he starts with), `trophies(ep)` (LEMONNOX badges on the truck at the start), `title(ep)`.
- Rig marks (`StickFigure(..., marks=...)`, `fig.add_mark(name)` / `remove_mark(name)` on screen): `cap_tag` (the price tag still swinging off his brand-new cap; EP1 only, it burns off at the zap), `scorched_cap` (soot burnt into the cap from EP1's zap on), `shin_bandage` (plaster on his near shin, from EP2). `dusty` (filter dust on his face) is a temporary gag mark, not a scar. New scars get drawn in `rig._draw_marks` and listed in `continuity.DRAWN_MARKS`.
- `WorkTruck(..., trophies=n)` shows n LEMONNOX badges on the bed side; `truck.add_trophy()` slaps on the next one.
- Every episode: one rookie mistake, one lesson, one callback to an earlier lesson, the lead's thumbs-up at the end.

## 10. Quality checklist (check before every handoff)

- The story makes sense with the sound off (Gage: "EP 3 doesn't make sense"). Every beat is caused by the one before it: the problem is shown, then found on screen (someone discovers the cause: a frozen coil, a dead wire) before anyone fixes it; every character action has a visible reason (someone asks, points, reacts); every prop a figure uses comes from somewhere (bag, pocket, truck). Watch the preview as a stranger would: if a beat needs the voiceover to make sense, restage it.
- Every moving object is held by a hand, attached by a connection, or obviously under gravity, a throw or a gag.
- Hands actually reach objects before grabbing; no grabbing from a distance.
- Feet do not slide while standing or walking; walking feet plant and lift.
- Heads turn by moving the face features inside the circle; the head never slides sideways as a whole.
- Blinks and closed eyes go fully flat.
- Elbows and knees bend the natural way.
- Each gag has anticipation, the action, and a hold of at least 0.3 s.
- Props are in proportion; nothing clips through the ground or the wall; nothing important sits in the Shorts UI zones.
- Sound cues land on their actions; the mix leaves room for the voiceover (peaks around -4 dB).
- Frame is 1080x1920 at 60 fps, video under 60 s, no text overlays.
- Report: the output file path, total length, and the scene-by-scene timing table (scene, start, end; written to `episodes/<file>_timing.md`) so Gage can record his voiceover to it.

## 11. How episodes are requested and written

Gage will describe the short in plain language as a list of scenes. For each episode:

0. Read `episodes/SERIES.md` (the season arc): the episode's row gives its mistake, lesson, callback and what the rookie earns; `stickworld/continuity.py` gives the starting state.
1. Create `episodes/epNN_<slug>.py`: a class deriving from `EpisodeScene` with `EPISODE = NN`, a TIMING dict (scene name -> seconds), `self.episode_tag()` first in construct(), the rookie built with `marks=C.rookie_marks(NN)`, any truck with `trophies=C.trophies(NN)`, and one `with self.block(name):` per scene that only calls library actions.
2. If a scene needs a new prop, action, expression or sound, add it to the library (with a line in test_scene.py) instead of hard-coding it in the episode.
3. Render the preview, check the checklist, fix problems, then render the final.
4. Hand back the file path, the timing table, and up to three suggestions for making the gags land better. Do not change the gags Gage chose without asking.

## 12. Episode 01 reference (package unit changeout)

`episodes/ep01_package_unit.py`, the pattern for future shorts (~58.3 s). The pilot: the rookie's cap still has its price tag on (`cap_tag`), which burns off at the zap and leaves the scorch he wears all season; he pockets the first LEMONNOX badge.

1. arrive: the truck rolls in (wheels turning) and stops with a bounce and an exhaust puff; the old unit coughs a puff of smoke.
2. hop_out: TECH1 opens the door and steps out; TECH2 tumbles out face-first and gets up. TECH1 lifts the MILWACKO bag out of the truck bed and walks up to the unit; TECH2 wanders to the yard.
3. zap: TECH1 fights the screwed-down flashing (rattle) while TECH2 crouches and grabs the live whip: zapped(). TECH1 slowly shakes his head, then pulls the disconnect (clunk).
4. drills: TECH1 pulls two drills from the bag, tosses one to TECH2; they drive the flashing screws out row by row (crouching for the bottom row); drills back in the bag.
5. peel: TECH1 peels the top panel, then the side panel, back toward the house like a banana (hand on the edge, stepping back), and pretends to take a bite (no sound: Gage cut the chomp).
6. ducts: TECH1 yank_plug()s each duct off the unit, foot on the cabinet: POP, stumble, throws it on the pile.
7. pull_start: TECH1 grabs the whip and the low voltage low on the unit and rips them out in one lawnmower pull (conductors out). Nothing happens (crickets, two blinks). TECH2 stares and slowly shakes his head, eyes closed.
8. carry_toss: both squat, grip the old unit, rattle it loose, RIIIP, carry it down to the truck and toss it in the bed (crash, bounce, camera shake). TECH2 pries the LEMONNOX badge off the wreck, holds it up (ding, sparkles) and pockets it.
9. new_unit: the new unit slides in with sparkles while they walk back.
10. rewind: tape-rewind sound; the ducts click back in, the flashing un-peels, the screws fly back loose and the techs drive them in with the drills.
11. thread: punch-in; TECH1 kneels and thread_wire()s the low voltage into the grommet: tongue out, squint, misses twice, gets it; the conductors slide in; exhale.
12. power_up: TECH1 flips the disconnect back on; the new unit hums and cold air flows into the house; TECH1 gives the camera his thumbs-up and wink. End.

## 13. Episode 02 reference (attic air handler swap)

`episodes/ep02_attic_air_handler.py` (~58 s), one static cutaway (attic on top, the hot room below), camera punch-ins for the gag and the ending. Callback: TECH2 proudly kills the air handler's disconnect first thing (the EP1 lesson); TECH1 turns it back on at the end.

1. arrive: opens close on the homeowner sweating in a warm room at the thermostat (78) under heat waves, then pulls back as TECH1 walks in with the bag and TECH2 wheels the new BRRRIER air handler in on the hand truck; the homeowner points at the hatch.
2. climb: TECH1 slings the MILWACKO bag on his back, climbs the pull-down stair facing it, steps off and sets the bag down by the unit; TECH2 follows once the stair is clear.
3. joist: punch-in; TECH1 explains, TECH2 nods, steps back off the walkway end and puts a leg through the ceiling right beside the homeowner's face (crash, debris, shake); leg kicks; TECH1 shakes his head, pulls him out and points him back down the hatch.
4. old_out: TECH2 backs down the stair facing it; TECH1 takes the tubing cutter from the bag and cuts the line set, scrapes the old LEMONNOX unit to the hatch and it tips in, slides down the stair, slams the floor, topples and skids out of frame; TECH2 dives clear, the homeowner flinches.
5. dolly_up: TECH2 tips the hand truck back and rolls it to the stair; TECH1 throws a rope down, TECH2 hooks it; TECH1 hauls hand over hand, then grabs the handle and swings the unit up and out onto its spot under the plenum; lays the empty hand truck down.
6. connect: TECH1 bends the line set back onto the stubs, takes the torch from the bag, lights it and brazes the joint (flame, sparkles, fizz), puts it away, clicks the condensate drain on, exhales.
7. thermostat: the homeowner presses down 78 -> 72 (six clicks).
8. cold_air: the unit hums, cold air pours out of the register over the homeowner (eyes closed, arms out); TECH2 fist-pumps; TECH1 gives the camera his thumbs-up and wink. Slow punch-in. End.

## 14. Episode 03 reference (movie night)

`episodes/ep03_movie_night.py` (~47.5 s), one night cutaway (`house_night`: living room and utility closet above, the street and truck below), lights-out gag in the middle. Built and then audited twice (a first-time viewer with no explanation, and an HVAC tech) until every beat followed from the one before it with the sound off:

1. hook: opens close on the neighbor (bun) sweating on the couch in front of the TV, tugging her collar; looks up at the ceiling vent (nothing comes out), then at the thermostat (81); pulls back to the whole house. No heat waves at the vent: they read as a heater blowing.
2. arrive: the truck (two LEMONNOX badges) rolls in; both hop out, walk off left along the street and come in at the left of the house (`relocate`: around to the front door, never floating up the cutaway). TECH1 wears the MILWACKO bag; TECH2 carries nothing yet (a fix must not arrive before its problem).
3. diagnose: TECH1 sets the bag down by the furnace, snaps an icicle off the frozen coil (pop, chips), turns and holds it up to TECH2, both surprised, drops it (tink, it shatters). He points at the panel: shut this unit off. TECH2 looks at it and nods.
4. breakers: callback to EP1: TECH2 touches his scorched cap, panics, runs to the panel and flips every breaker one by one in a close shot (`sweep_breakers(per=0.11)`, the room dimming step by step, the TV dying), then the main: pitch black, only eyes, crickets. TECH1's flashlight from his back pocket lights him and the panel (both raised above the dark); you SEE him flip every breaker back on except the furnace's; the main brings the house back. Close-up: the lockout tag comes out of his shirt pocket onto that one breaker; he points at it, then at the furnace; TECH2 nods, sheepish.
5. filter: TECH1 pulls the filthy filter: dust bomb (TECH2 goes `dusty`). He holds it up beside the iced coil, looks from one to the other and nods (the cause). TECH2 runs the dirty one out and comes back with a clean one; it clicks home (pop, sparkles). A return duct joins the filter rack to the furnace.
6. power_on: TECH2 sets the thermostat to FAN (fan icon); TECH1 takes the tag off and flips the furnace breaker on (clunk, hum): the blower melts the ice, the drain drips. TECH2 sets COOL (snowflake): cold air pours from the register, the thermostat ticks 81 -> 72, the room goes from hot to cool, the neighbor relaxes, eyes closed.
7. finale: TECH1 walks out to the cooled-off neighbor and gives the camera his thumbs-up and wink beside her.
