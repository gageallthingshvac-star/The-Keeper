# Sunny Sports — Design & Engine Contract

A bright, friendly multi-sport game in the spirit of the classic living-room motion-sports games:
chunky, smiling characters ("Pals"), one-gesture controls that feel physical, big celebratory
feedback, and quick sessions you want to replay. It must feel like a **finished product**:
title screen, menus, profiles, how-to, pause, results, records, settings, sound, music.

Runs in any modern browser. **Phone-first** (touch swipes stand in for the motion controller),
fully playable with a mouse on desktop. No build step. No network: everything is local files.

---------------------------------------------------------------------------------------------------

## 1. Pillars

1. **One gesture, real physics feel.** Every sport is driven by a single, readable swipe/drag
   gesture whose *speed, direction, curve and timing* map onto the shot. Easy to learn, deep to master.
2. **Juice everywhere.** Every action has sound, motion and a reaction: pal expressions, crowd
   cheers, banners ("STRIKE!", "ACE!", "HOME RUN!"), camera moves, slow-mo on big moments, confetti.
3. **Readable at a glance.** Bright daylight palette, big rounded type, clear HUD, the camera
   always shows what matters. A 7-year-old and a grandparent should both get it in 10 seconds.
4. **Snappy.** Load fast, never make the player wait on an animation they can't skip (tap to skip
   replays/celebrations), 60 fps target on a mid-range phone.
5. **Come back.** Skill levels, personal records, medals, and friends (hot-seat multiplayer).

## 2. Art direction

- **Units: meters, Y up.** Real sport dimensions (bowling lane 18.29 m, tennis court 23.77 m…).
- **Sky:** clean gradient, saturated blue zenith (#3E9BF0) to pale horizon (#CDEBFF), soft fluffy
  low-poly clouds, sun. Distant rolling hills (#7CC56B → #5FAE57), round trees (#4FA64A canopy).
- **Lighting:** `HemisphereLight` (sky #FFFFFF / ground #A8C890, intensity ≈ 1.6) + warm
  `DirectionalLight` sun (#FFF6E5, intensity ≈ 2.6) with soft PCF shadows on medium/high quality.
  Three r159 uses physically-correct light units (`useLegacyLights = false`); these values are tuned for that.
  No tone mapping (`NoToneMapping`), `outputColorSpace = SRGBColorSpace`. Colors stay bright and clean.
- **Materials:** `MeshLambertMaterial` for environment, `MeshPhongMaterial` (shininess 30–60) for
  characters/equipment to get the glossy toy look. Flat colors + subtle canvas textures. No PBR maps.
- **Pals:** big round head (~1/3 of height), simple face (oval black eyes with white glint,
  brows, small nose, mouth), egg-shaped torso in their favorite color, short legs, **floating
  hands, no arms**. ~1.45 m tall. Expressions change with events.
- **UI:** white rounded panels with soft shadows, sky-blue accent `#1FA2FF`, sunshine yellow
  `#FFC93C`, success green `#3BC45B`, coral `#FF5A5F`. Fonts: **Fredoka** (display, 500–700) and
  **Nunito** (UI, 700–900), both bundled in `fonts/`. Generous touch targets (≥ 48 px).
  Everything respects iPhone safe areas.
- **Tone:** cheerful, warm, never snarky. Short words. Banners in ALL CAPS with a bounce.

## 3. Screen flow

```
Boot/Loading → Title ("Tap to start") → [first run: Pal Creator] → Main Menu (Plaza)
  Main Menu: 4 sport cards (name, icon, medal row, your skill level) + bottom bar: Pals · Records · Settings
  Sport card → Setup sheet: mode → players (hot-seat Pals) or CPU opponent → Start
  → How-to overlay (auto first time, always reachable from Pause) → Title card ("BOWLING") → Play
  Play: HUD (sport-owned) + pause button (top-left, core-owned)
  Pause: Resume · How to Play · Restart · Quit
  → Results: headline, players w/ avatars & scores, stats, new records, skill change, medals
            → Play Again · Change Mode · Menu
```

## 4. The four sports (summary — each sport file owns the detailed design)

| id | Sport | Gesture | Modes | Players |
|----|-------|---------|-------|---------|
| `bowling` | Bowling (indoor alley) | drag sideways to position, aim buttons, **swipe up** to roll; swipe curve = hook | 10 Frames · Spare Challenge · 100-Pin | 1–4 hot-seat |
| `tennis` | Tennis (sunny stadium) | auto-run; **swipe** to swing, timing aims, speed = power; tap+swipe to serve | Quick Match · Match · Rally Challenge | 1 vs CPU |
| `baseball` | Home Run Derby | **swipe across** to swing; timing pulls/pushes, swipe angle = launch | Derby (10 pitches) · Sudden Death | 1 vs CPU pitcher |
| `golf` | Golf (9-hole parkland) | aim, **pull down then flick up**; pull = power, flick straightness = accuracy | Beginner 3 · Expert 3 · Full 9 | 1–4 hot-seat |

## 5. Files & ownership

All scripts are **classic scripts** (no ES modules — must work from `file://`), each wrapped in an
IIFE, attaching to the global `window.SS`. Load order is fixed in `index.html`:

```
sports/
  index.html               shell markup + script tags                      (engine owner)
  css/style.css            all core UI styles                              (ui owner)
  fonts/*.woff2            Fredoka + Nunito                                 (vendored)
  lib/three.min.js         three.js r159 UMD → global THREE                (vendored, never edit)
  js/util.js               SS namespace, math, easing, tween, rng, emitter  (engine owner)
  js/save.js               persistence: profiles, settings, skills, records (engine owner)
  js/audio.js              synthesized SFX + music                          (audio owner)
  js/engine.js             renderer, loop, time, input, camera fit, debug   (engine owner)
  js/world.js              sky, lights, terrain bits, crowd, fx, textures   (art owner)
  js/pals.js               Pal characters + portraits + CPU roster          (art owner)
  js/ui.js                 UI kit: banners, hints, modals, HUD helpers      (ui owner)
  js/sports/bowling.js     one file per sport, fully self-contained         (sport owner)
  js/sports/tennis.js
  js/sports/baseball.js
  js/sports/golf.js
  js/main.js               boot, screens, menu scene, editor, results flow  (ui owner)
  tools/shoot.mjs          headless playtest driver (Playwright)
  tools/gallery.html       dev showcase of SS.world + SS.pals (?view=lineup|faces|anims|…)
  tools/soundboard.html    dev board: play/analyze every sfx, loop and music track
```

A sport file must not edit any other file. If a sport needs something generic, it implements a
local helper inside its own file.

## 6. Core API (exact contract)

### 6.1 `js/util.js` — `SS.util`, namespace

```js
window.SS = window.SS || {};      // every file does: const SS = window.SS;
SS.THREE = THREE;
SS.VERSION = '1.0.0';
SS.util = {
  clamp(v, a, b), lerp(a, b, t), invLerp(a, b, v), remap(v, a0, a1, b0, b1, clamp=true),
  damp(current, target, lambda, dt),          // frame-rate independent smoothing, scalar
  dampVec3(vec, target, lambda, dt),          // in place
  smoothstep(e0, e1, x), sign(x), wrapAngle(a), angleDiff(a, b),
  ease: { linear, inQuad, outQuad, inOutQuad, outCubic, inOutCubic, outBack, outElastic, outBounce },
  rng(seed) -> { next() /*0..1*/, range(a,b), int(a,b) /*inclusive*/, pick(arr), chance(p), seed },
  tween(target, props, duration, {ease, delay, onUpdate, realtime=false}) -> Promise
        // animates numeric props (supports nested via {'position.x': 3}); game-time unless realtime
  emitter() -> { on(evt, fn) -> off, once(evt, fn), off(evt, fn), emit(evt, ...args), clear() },
  uid() -> string, fmt: { int(n) /* 1,234 */, meters(m) /* "123 m" */, time(s) /* 1:05 */ },
  hash(str) -> int,
  tick(dt, rdt),               // engine calls every frame to advance tweens (dt = game-time, rdt = real-time)
};
SS.sports = {}; SS.sportOrder = []; SS.registerSport(def);
```

### 6.2 `js/save.js` — `SS.save` (localStorage key `sunnysports.v1`)

```js
SS.save = {
  data,                        // live object; call dirty() after mutating directly
  dirty(),                     // debounced write (500 ms)
  flush(),                     // write now (also on visibilitychange hidden / pagehide)
  reset(),                     // wipe everything (confirmed by UI)
  // profiles (Pal profiles, see 6.6 for the profile shape)
  profiles() -> Profile[], getProfile(id), upsertProfile(p) -> p, deleteProfile(id),
  activeProfile() -> Profile|null, setActiveProfile(id),
  // settings
  settings,   // { music:0.6, sfx:0.9, haptics:true, quality:'auto'|'low'|'medium'|'high', hints:true, leftHanded:false }
  setSetting(key, value),      // persists + emits SS.save.events 'setting' (key, value)
  events,                      // SS.util.emitter()
  // progression
  skill(profileId, sportId) -> { level, history /* last 20 levels */, games, best },
  addSkill(profileId, sportId, delta) -> { before, after, rankBefore, rankAfter },
  rankFor(level) -> { id, name, min },   // Rookie 0 · Amateur 300 · Pro 1000 · Star 1600 · Legend 2200 (max 2500)
  record(sportId, key, value, { higherIsBetter=true, profileId, label, fmt }) -> { isNew, previous },
  records(sportId) -> { [key]: { value, label, fmt, profileId, name, date } },
  stat(sportId, profileId, key, inc=1) -> newValue, stats(sportId, profileId) -> object,
  awardMedal(sportId, medalId, profileId) -> bool /* true if newly earned */, medals(sportId) -> Set(medalId),
  seen(flag) -> bool /* returns previous value and marks it seen */, isSeen(flag) -> bool,
};
```

### 6.3 `js/engine.js` — `SS.engine`, `SS.input`, `SS.debug`

```js
SS.engine = {
  init(canvas),                 // called once by main.js
  renderer,                     // THREE.WebGLRenderer (antialias, shadowMap PCFSoft, sRGB)
  scene, camera,                // currently rendered
  setView(scene, camera),
  quality,                      // 'low' | 'medium' | 'high' (resolved; 'auto' measures fps then settles)
  setQuality(q), onQuality(fn) -> off,   // low: no shadows, DPR 1; medium: shadows 1024, DPR ≤1.5; high: 2048, DPR ≤2
  time,                         // game seconds (stops while paused, scaled)
  realTime,                     // seconds since start (never stops)
  timeScale,                    // 1 = normal
  slowmo(scale, realSeconds, {ease}),    // temporary time-scale, eases back to 1
  paused, pause(), resume(),    // game-time + sport updates stop; realtime updates continue
  addUpdate(fn, priority=0) -> off,      // fn(dt, time): game-time, dt clamped ≤ 1/20 and scaled; not called while paused
  addRealtimeUpdate(fn) -> off,          // fn(rdt, realTime): always called (UI animation)
  after(seconds, fn) -> cancel,          // game-time timer (pauses with game)
  shake(amount=0.12, duration=0.35),     // camera shake applied at render, decays
  size,                         // { w, h, aspect, dpr } css px
  onResize(fn) -> off,          // fn(size)
  fitCamera(camera, { vFov=50, minHFov=60 }),   // sets camera.aspect & fov so horizontal FOV ≥ minHFov;
                                // the engine re-applies it automatically on resize to any camera having camera.userData.fit = {vFov, minHFov}
  project(vec3, camera=engine.camera) -> { x, y, visible },   // css px
  disposeObject(obj3d),         // dispose geometries/materials/textures under obj, skipping anything with userData.shared === true
  fps,                          // smoothed
  events,                       // SS.util.emitter(): 'pause' 'resume' 'hidden' 'visible' 'quality' 'resize' 'contextlost'
                                // 'hidden' fires when the tab/app is backgrounded; main.js reacts by opening the pause menu
};

SS.input = {   // unified pointer (mouse/touch/pen) + keyboard; listens on the canvas & HUD layer
  on(evt, fn) -> off,   // evts: 'down' 'move' 'up' 'tap' 'swipe' 'key'
  scope() -> { on(evt, fn) -> off, off() /* removes all listeners of this scope */ },
  isDown, pointer,      // current pointer state or null
  enabled,              // set false to ignore input (e.g. during cutscenes)
};
// Pointer payload p (down/move/up/tap):
//   { id, x, y /*css px*/, nx, ny /* -1..1, ny UP-positive */, t /*ms*/,
//     sx, sy /*start x,y of this press*/, dx, dy /*px from start, screen y DOWN-positive*/,
//     ndx, ndy /* dx,dy divided by min(w,h) */, duration /*s since down*/ }
// Swipe payload s (emitted on release when travel ≥ 12 px, after 'up'):
//   { start:p, end:p, dx, dy, dist, duration,
//     vx, vy, speed            // px/s, measured over the last ~90 ms of travel (release velocity)
//     nvx, nvy, nspeed         // same / min(w,h)  → device-independent "short sides per second"
//     peakSpeed, npeakSpeed,   // max instantaneous speed over the gesture
//     angle,                   // atan2(-dy, dx): 0 = right, +PI/2 = up
//     lateral,                 // signed max perpendicular deviation from the start→end chord, / min(w,h);
//                              //   + = bowed to the RIGHT of the direction of travel
//     straightness,            // chord length / path length (1 = perfectly straight)
//     path: [{x, y, t}] }      // raw samples
// Tap: release within 250 ms and < 12 px travel.
// Key payload: { key, code, down /*bool*/, repeat }
// Pointer events starting on interactive DOM (buttons, inputs, any element with
// class .ss-block or inside #ss-screens/#ss-overlay) never reach SS.input.

SS.debug = {      // test hooks used by tools/shoot.mjs and agents
  params,          // parsed URL params
  state() -> object,   // { screen, sport, mode, paused, fps, quality, ...sportInstance.debugState?.() }
  sport,           // current sport instance (or null)
  ctx,             // current sport ctx
  timeScale(x),    // set engine.timeScale
  log(...args),    // console.log only when ?debug=1
};
```

**URL parameters** (parsed in engine, acted on by main.js):
`?sport=<id>` jump straight into a sport after boot (skips title/menu/how-to/title card when `skip=1`),
`&mode=<modeId>`, `&players=<n>` (hot-seat count, auto-creates guest Pals), `&opp=<rosterIndex>`,
`&seed=<int>`, `&quality=low|medium|high`, `&mute=1`, `&debug=1`, `&screen=menu|editor|records|settings|pals|results`
(open a screen directly for screenshots; `results` shows sample data over the menu), `&reset=1` (wipe save first).
Without `skip=1`, `?sport=` still jumps straight in but shows the first-visit how-to and the title card.
Unknown sports/screens fall back to the title screen.

### 6.4 `js/audio.js` — `SS.audio` (100 % synthesized with WebAudio, no files)

```js
SS.audio = {
  unlock(),            // resume AudioContext on first user gesture (engine calls it on first pointerdown)
  sfx(name, { vol=1, rate=1, pan=0, intensity=1, delay=0 }={}),
  loop(name, { vol=1, rate=1 }={}) -> { setVolume(v, rampSec=0.1), setRate(r, rampSec=0.1), stop(fadeSec=0.2) },
  music(trackId|null, { fade=0.8 }={}),  // crossfades; same id = no-op
  duck(amount=0.5, seconds=1.5),         // temporarily lower music (big moments)
  setVolumes({ music, sfx }),            // 0..1 (main.js wires to settings)
  suspend(), resumeAll(),                // engine calls on pause / tab hidden
  ctx,                                   // AudioContext (may be null before unlock)
};
```

SFX names (all must exist; unknown names log a warning once and do nothing):
- UI: `ui_tap` `ui_select` `ui_back` `ui_open` `ui_close` `ui_error` `ui_tick` `ui_toggle` `pop` `swish`
  `star` `coin` `levelup` `count_beep` `count_go` `type` (keyboard tick for name entry)
- Generic: `whoosh` (intensity) `swing_light` `swing_heavy` `thud` `bounce_soft` `splash` `wood_knock`
  `camera_flash` `firework` (intensity) `confetti`
- Crowd/people: `crowd_cheer` (intensity 0..1, length scales) `crowd_aww` `crowd_gasp` `crowd_ooh`
  `crowd_applause` (intensity) `crowd_laugh` `whistle` `voice_yay` `voice_aw` `voice_hup` (grunt on swing)
- Fanfares: `fanfare_small` `fanfare_big` `fanfare_record` `jingle_win` `jingle_lose` `jingle_start` `jingle_perfect`
- Bowling: `bowl_release` `pins_hit` (intensity 0..1 = how many/fast) `pin_clatter` `gutter_drop` `ball_return` `sweep`
- Tennis: `racket_hit` (intensity) `racket_frame` (mishit) `ball_bounce_court` `serve_toss` `net_hit` `line_call`
- Baseball: `bat_crack` (intensity; 1 = sweet spot) `bat_foul` `mitt_pop` `pitch_whoosh` `ump_strike` (short synth "hey!")
  `ball_land_grass`
- Golf: `golf_drive` (intensity) `golf_iron` `golf_chip` `golf_putt` (intensity) `golf_cup` `golf_land_grass`
  `golf_land_sand` `golf_tree` `golf_water` `flag_flap`

Loops: `ball_roll` (bowling; use rate+volume for speed) `crowd_ambience` `park_ambience` (birds, breeze)
`stadium_ambience` `wind` (volume = strength) `alley_ambience` (distant pins, murmur).

Music tracks (cheerful, light, loopable, sequenced synth — marimba/bell/pluck/bass/soft drums):
`title` `menu` `editor` `bowling` `tennis` `baseball` `golf` `results`. Keep music under SFX in the mix.

### 6.5 `js/world.js` — `SS.world` (shared environment & effects)

```js
SS.world = {
  // Sky dome + fog + lights. Returns handles. Adds everything to scene.
  environment(scene, {
    sky: 'day' | 'golden' | 'indoor',   // indoor = no sky dome; neutral ambient + ceiling-ish lights, no sun shadow
    fog: true, fogNear: 60, fogFar: 260,
    hills: true, hillRadius: 180,       // ring of soft distant hills (skipped indoor)
    clouds: 10,                         // count (skipped indoor)
    trees: { ring: 70, count: 40 } | false,   // scattered round trees on a ring (skipped indoor)
    shadow: { center: Vector3, size: 30, mapSize: auto by quality },
  }) -> { sun, hemi, sky, setShadowFocus(centerVec3, size), update(dt), dispose() },
  tree(kind='round'|'pine'|'bush', scale=1, rng) -> THREE.Group,
  cloud(scale=1, rng) -> THREE.Group,
  texture(name, opts) -> THREE.Texture (cached, userData.shared=true):
      'grass' 'grass_stripes' 'fairway' 'rough' 'green' 'sand' 'dirt' 'clay' 'hardcourt'
      'wood_lane' 'wood' 'carpet' 'checker' 'noise' 'brick' 'banner' (opts:{text,color,bg})
  mat(color, { kind='lambert'|'phong'|'basic'|'standard', map, emissive, transparent, opacity, side, shininess }={})
      -> cached shared material (userData.shared = true). Do not mutate returned materials; clone() first.
  crowd(scene, {
      rows: [{ x, y, z, length, facing /*radians, direction the pals look*/ }],   // each row = a bleacher line
      spacing: 0.75, density: 0.85, scale: 1, rng, seed })
      -> { group, cheer(intensity=1, seconds=2), gasp(), wave(), setMood('idle'|'tense'), update(dt), dispose() }
      // low-poly instanced pals (InstancedMesh: body, head, 2 hands), random shirts/skin, idle bob;
      // cheer = jumping + raised hands. Must stay cheap: 300 spectators < 2 ms/frame.
  stands(scene, { x, y, z, width, rows, rise, depth, facing, color }) -> Group   // bleachers geometry (to seat a crowd on)
  // FX (auto-updated by the engine each frame; all are fire-and-forget unless a handle is returned)
  confetti(scene, position, { count=120, spread=3, colors }),
  burst(scene, position, { count=20, color=0xffffff, speed=3, size=0.06, gravity=-9.8, life=0.8 }),   // dust, sparkles
  fireworks(scene, position, { count=3, colors }),
  ring(scene, position, { color=0xffffff, radius=0.5, life=0.6 }),     // expanding ground ring (impact/landing marker)
  trail(object3d, { color=0xffffff, width=0.08, length=24, opacity=0.6 }) -> { update(), clear(), dispose(), visible },
  blobShadow(radius=0.5, opacity=0.35) -> Mesh   // soft radial shadow decal (use under balls/pals on low quality or always for balls)
  label3d(text, { color, bg, size }) -> Sprite   // canvas-text sprite (distance markers etc.)
  update(dt),            // engine calls; advances FX
};
```

### 6.6 `js/pals.js` — `SS.pals`

Profile shape (stored in save):
```js
{ id, name /* ≤ 10 chars */, skin /*0..5*/, hairStyle /*0..9*/, hairColor /*index*/, eyes /*0..5*/,
  eyeColor /*index*/, brows /*0..4*/, nose /*0..3*/, mouth /*0..4*/, glasses /*0..3, 0 none*/,
  facial /*0..3, 0 none*/, shirt /*color index*/, pants /*color index*/, height /*0..1*/, build /*0..1*/,
  cheeks /*bool, blush*/, created /*ms*/, isGuest /*bool*/ }
```

```js
SS.pals = {
  OPTIONS,                 // { skins:[hex], hairColors:[hex], shirts:[hex] (12 favorite colors), pants:[hex],
                           //   eyeColors:[hex], hairStyles:[{name}], eyes:[{name}], brows:[{name}], noses, mouths, glasses, facial }
  defaultProfile(name='You') -> Profile, randomProfile(rng, name) -> Profile, sanitize(p) -> Profile,
  CPU_ROSTER,              // ≥ 12 entries: { profile, skill /*0..1*/, title /* 'Rookie' etc. */ }, ordered by skill
  rosterFor(level) -> entry   // a fitting opponent for a skill level
  create(profile, { shadows=true, detail='high'|'low' }={}) -> Pal,
  portrait(profile, size=128) -> HTMLCanvasElement   // head-and-shoulders, transparent bg; cached by profile hash
  portraitURL(profile, size) -> dataURL
};

// Pal instance — origin at feet center, faces +Z. Hands are floating spheres.
pal.root                      // THREE.Group (add to scene; position/rotate this)
pal.profile, pal.height       // top-of-head height in meters (~1.35–1.6 depending on profile.height)
pal.parts                     // { body, head, handL, handR, footL, footR, face } Object3Ds
pal.headCenter                // Vector3, root-local
pal.update(dt)                // MUST be called each frame (animations, blinking, smoothing)
pal.play(anim, { loop, speed=1, fade=0.15 }={})   // 'idle' 'idle_ready' (sporty crouch) 'walk' 'run' 'cheer'
                                                   // 'jump' 'clap' 'wave' 'sad' 'shrug' 'dance' 'bow' 'hop' 'stumble'
                                                   // returns Promise resolving when a non-looping anim ends
pal.setSpeed(mps)             // for walk/run: syncs stride to ground speed
pal.setExpression(name, holdSeconds=0)   // 'neutral' 'happy' 'joy'(^^ eyes, open grin) 'sad' 'surprised' 'focus' 'wince' 'proud'
                                         // holdSeconds 0 = until changed; >0 = return to neutral after
pal.lookAt(worldVec3|null)    // head yaw/pitch toward a point (clamped), null = forward
// Manual posing for sport swings (blends over the current animation while active):
pal.pose({ handL, handR /* root-local Vector3 targets */, twist /*torso yaw rad*/, lean /*forward pitch rad*/,
           tilt /*side roll rad*/, crouch /*0..1 knee bend*/, stance /*0..1 feet apart*/ }, { blend=1, lambda=18 }={})
pal.releasePose(fadeSeconds=0.2)  // hand control back to animations
pal.handWorld('L'|'R', outVec3) -> Vector3   // current world position of a hand
pal.attach(object3d, 'L'|'R', { position, rotation }={}) -> object3d   // parent equipment to a hand
pal.detach(object3d)
pal.setFacing(yawRadians)     // convenience: root.rotation.y
pal.setVisible(bool), pal.dispose()
```

Character spec: at `height = 0.5` the pal is ~1.45 m: feet → hips 0.45 m, torso egg 0.45–0.98 m,
head sphere radius ≈ 0.24 centered ≈ 1.22 m. Hands: spheres r ≈ 0.075, resting at ±0.32 m x,
0.72 m y, 0.06 m z. `build` widens torso, `height` scales legs+torso (head size constant-ish).
Hair = sculpted caps / buns / spikes from primitives. Eyes are small black ellipsoids with a white
glint sphere; mouth is a curved tube or extruded arc whose shape changes per expression; brows are
small rounded boxes that tilt with expression. Automatic random blinking. Cheek blush optional.

### 6.7 `js/ui.js` — `SS.ui`

DOM layers (in `index.html`, all inside `#ss-root` over the canvas):
`#ss-hud` (sport HUD, cleared on exit, pointer-events none except `.ss-block` children) ·
`#ss-screens` (menus) · `#ss-overlay` (pause, results, modals) · `#ss-fx` (banners, toasts, hints) ·
`#ss-fade` (transition curtain).

```js
SS.ui = {
  root, hud, screens, overlay, fx,      // elements
  css(id, cssText),                     // inject a <style id=...> once (sports use this for HUD styles)
  el(tag, className, html?) -> HTMLElement    // tiny DOM helper
  icon(name) -> svg string   // 'pause' 'play' 'home' 'retry' 'gear' 'trophy' 'medal' 'user' 'users' 'back' 'close'
                             // 'check' 'star' 'left' 'right' 'up' 'down' 'rotate-left' 'rotate-right' 'map' 'sound' 'mute' 'info' 'flag' 'wind'
  button(label, onClick, { kind='primary'|'secondary'|'ghost'|'round', icon, sfx='ui_select' }) -> HTMLButtonElement
  banner(text, { sub, kind='great'|'good'|'info'|'bad'|'huge', duration=1.6, color }) -> Promise
        // big center pop with bounce + shine; 'huge' for STRIKE/HOME RUN/ACE (plays no sound — sports pick sounds)
  toast(text, { duration=2, icon }) -> void       // small pill top-center
  hint({ gesture, text, x, y }) -> { hide(), el }  // animated hand glyph demonstrating the gesture
        // gestures: 'swipe-up' 'swipe-up-curve' 'swipe-left' 'swipe-right' 'swipe-across' 'drag-down-up'
        //           'drag-h' 'tap' 'hold' ; x,y css px anchor (default bottom center)
  label(text, { className }) -> { el, set(text), at(x, y), show(bool), remove() }   // floating label (pair with engine.project)
  meter({ label, vertical=false, zones:[{from, to, color}] }) -> { el, set(v01), marker(v01, color), flash(color), remove() }
  choose(title, options: [{ id, label, desc, icon }], { sub }) -> Promise<id|null>
  confirm(title, text, { yes='OK', no='Cancel' }) -> Promise<bool>
  countdown(n=3) -> Promise     // 3·2·1·GO with sfx
  titleCard(title, sub, { accent }) -> Promise   // big swooping sport/hole title (~1.6 s, tap to skip)
  howTo(sport) -> Promise       // overlay built from sport.howTo
  setPauseVisible(bool),
  transition(fn) -> Promise     // fade curtain in → await fn() → fade out
  portraitImg(profile, size) -> HTMLImageElement|HTMLCanvasElement
  scorePopup(text, x, y, { color }) // small floating "+1" style text at screen pos
};
```

Shared CSS classes sports may use in their HUD (styled in `css/style.css`):
`.ss-panel` (white rounded card + shadow) · `.ss-chip` (pill) · `.ss-chip.dark` ·
`.ss-hud-top` `.ss-hud-bottom` `.ss-hud-tl` `.ss-hud-tr` `.ss-hud-bl` `.ss-hud-br` (safe-area-aware anchors) ·
`.ss-big` (large display number) · `.ss-small` · `.ss-avatar` (round portrait frame) ·
`.ss-scorecard` (table: `th`, `td`, `.cur` highlighted column, `.mark` strike/spare glyph cell) ·
`.ss-btn` `.ss-btn.primary` `.ss-btn.round` `.ss-block` (receives pointer events in HUD) ·
`.ss-pop` (pop-in animation) · `.ss-pulse` · `.ss-hidden`.
CSS variables: `--accent` (set per sport by main.js), `--blue` `--yellow` `--green` `--coral` `--ink` `--ink-soft`
`--panel` `--radius` `--sat` `--sab` `--sal` `--sar` (safe-area insets), `--font-display` `--font-ui`.

### 6.8 Sport module contract

```js
// SS.registerSport is defined in util.js (so sport files can call it at load time). It stores the
// definition in SS.sports[id] and appends id to SS.sportOrder (menu order = script order).
SS.registerSport({
  id: 'bowling', name: 'Bowling', tagline: 'Curve it into the pocket!',
  accent: '#FF5A5F', tint: '#FFE6E6',
  icon: '<svg viewBox="0 0 64 64">…</svg>',   // flat, colorful, readable at 48 px
  music: 'bowling',
  players: { min: 1, max: 4 },               // hot-seat humans. 1 = single player
  opponent: false,                           // true → setup asks for a CPU opponent from SS.pals.CPU_ROSTER
  modes: [{ id: 'game', name: '10 Frames', desc: 'A full game. Can you roll a 200?' }, …],   // first = default
  howTo: { steps: [{ gesture: 'drag-h', text: 'Drag sideways to line up your shot' }, …], tips: ['…'] },
  medals: [{ id: 'bronze', name: 'Bronze', desc: 'Score 100 in 10 Frames' }, { id: 'silver', … }, { id: 'gold', … }, { id: 'platinum', … }],
  create(ctx) -> instance | Promise<instance>,
});
```

`ctx` given to `create` (built by main.js):
```js
{ THREE, scene /* fresh THREE.Scene */, camera /* fresh PerspectiveCamera, userData.fit preset {vFov:50,minHFov:60} */,
  sport /* the definition */, mode /* mode id */,
  players: [{ profile, index, isCpu:false }],      // ≥ 1 human
  opponent: { profile, skill /*0..1*/, title } | null,
  rng /* SS.util.rng(seed) */, seed,
  input /* SS.input.scope() — auto-cleared on exit */, hud /* SS.ui.hud, emptied on exit */,
  ui: SS.ui, audio: SS.audio, world: SS.world, pals: SS.pals, engine: SS.engine, save: SS.save, util: SS.util,
  alive /* getter: false after exit */,
  wait(seconds) -> Promise   // game-time; never resolves after exit (so async flows just stop)
  every(seconds, fn) -> cancel,
  onUpdate(fn) -> off        // extra per-frame game-time callbacks, auto-removed on exit
  finish(result),            // match over → main.js shows Results (see below)
  awardMedal(medalId) -> bool,
  skillFor(profile) -> number,   // current skill level of a human player for this sport
  setPausable(bool),
  restart(), quit(),         // same as the pause-menu actions
}
```

`instance` returned by `create`:
```js
{ start(),                  // called after the title card: begin play
  update(dt, t),            // every frame (game-time, not while paused)
  onResize?(size), onPause?(), onResume?(),
  dispose(),                // sport cleans its own listeners/loops; main.js then disposes the scene graph
  debugState?() -> object,  // merged into SS.debug.state()
  debug?: { … }             // sport-specific test helpers, e.g. autoplay(true), setLeave([7,10]), skipTo(hole)
}
```

`result` passed to `ctx.finish(result)`:
```js
{ outcome: 'win' | 'lose' | 'draw' | 'done',
  title: 'You Win!',                 // header
  headline: '187', headlineLabel: 'Final Score',
  players: [{ profileId, name, profile, score /* display string */, place /*1-based*/, isCpu, skillDelta /* humans */ }],
  stats: [{ label: 'Strikes', value: '5' }],
  records: [{ label: 'High Score', value: '187', isNew: true }],   // sport calls SS.save.record() itself and reports here
  medals: ['gold'],                  // medal ids newly earned this game
  celebrate: true,                   // confetti + fanfare on results
}
```
main.js applies `skillDelta` via `SS.save.addSkill` and animates the before → after skill bar, shows
rank-ups, medals and records, increments `games` stats, then offers Play Again / Change Mode / Menu.

Skill guidance: typical deltas −40…+80 per game; beating a stronger opponent / scoring above your
expected score gains more. Levels 0–2500, "Pro" at 1000.

## 7. Engine behaviors every sport can rely on
- Pausing (button, Escape key, tab hidden) freezes `update`, `ctx.wait`, `ctx.every`, `engine.after`,
  tweens (non-realtime), suspends audio loops; resume continues seamlessly.
- On exit (quit/restart/finish→menu) main.js: calls `instance.dispose()`, clears `ctx.input` scope,
  empties HUD, removes `onUpdate`s, disposes scene graph via `engine.disposeObject(scene)`.
- `camera.userData.fit = { vFov, minHFov }` keeps framing sane in portrait and landscape.
- The first pointerdown unlocks audio.

## 8. Testing
- Serve nothing: open `index.html` directly (file://) or via any static server.
- `node tools/shoot.mjs --url "index.html?sport=golf&skip=1&seed=3" --size 390x844 --out <dir> --steps '[…]'`
  drives a headless Chromium (SwiftShader WebGL) with swipes/taps/screenshots and prints console errors.
  Test both **390x844** (phone portrait) and **844x390** (phone landscape) and **1280x720** (desktop).
- Headless SwiftShader is slow (often 10–30 fps); gameplay must be dt-correct regardless.
- Every sport exposes `instance.debug.autoplay(on)` that makes the sport play itself with good,
  slightly varied inputs (used for soak tests: a full game must complete without errors).

## 9. Definition of done (quality bar)
- Zero console errors/warnings in normal play, any orientation, from title to results and back, repeatedly.
- No soft-locks: every state has a way forward; Pause → Quit always works; Restart always works.
- Gesture → outcome mapping feels fair and *learnable*; good input reliably gives good results; outcomes
  vary meaningfully with input quality; there is a skill ceiling.
- Every action has audio + visual feedback. Big moments get banner + crowd + pal reaction + camera.
- Camera never clips through geometry or loses the ball. HUD never covers the action.
- Runs ≥ 50 fps on mid phones at 'medium' (keep draw calls modest: merge static geometry, instancing).
- Text fits at 320 px wide. Touch targets ≥ 44 px. Safe areas respected.
- Code: readable, sectioned, no dead code, no `TODO`s left.

---------------------------------------------------------------------------------------------------

## 10. As built: extensions & clarifications (binding, same weight as §6)

Everything in §6 works as written. The items below are what the implementation adds or pins down;
sport modules may rely on all of them.

### 10.1 Sport files today
`js/sports/*.js` currently hold **placeholder modules**: the `SS.registerSport` metadata (name, tagline,
accent/tint, icon, music, players/opponent, modes, howTo, medals) is final and tuned for the menu; `create()`
is a three-shot practice scene. A sport owner keeps the metadata (adjusting medal wording to the real
rules if needed) and replaces `create()` and everything below it.

| id | accent / tint | modes | players / opponent |
|----|---------------|-------|--------------------|
| bowling | `#FF5A5F` / `#FFE8E6` | `game` 10 Frames · `spare` Spare Challenge · `hundred` 100-Pin | 1–4 / – |
| tennis | `#8E5BE0` / `#F1EAFF` | `quick` Quick Match · `match` Match · `rally` Rally Challenge | 1 / CPU |
| baseball | `#2E86F0` / `#E4F0FF` | `derby` Home Run Derby · `sudden` Sudden Death | 1 / CPU |
| golf | `#2FAE55` / `#E5F7E8` | `beginner` Beginner 3 · `expert` Expert 3 · `full9` Full 9 | 1–4 / – |

Keep taglines ≤ 23 characters (they are single-line on landscape menu cards).

### 10.2 Sport module obligations (learned from integration)
- **Fill your HUD inside `create()`**, not in `start()`: the HUD is visible under the how-to and title card.
- **Stop your own audio loops in `dispose()`** (`handle.stop()`); main.js does not track them.
- `instance.debug.autoplay(on)` must take effect from the current state (if the sport is waiting for input
  when it is switched on, it plays that shot), and must drive the game to `ctx.finish()` unattended.
- Use `ctx.input` (auto-cleared), `ctx.wait/every/onUpdate` (auto-cancelled). Anything else you register
  (engine events, world handles you update manually, DOM listeners outside `ctx.hud`) is yours to remove.
- Records: call `SS.save.record()` yourself; `fmt` may be a `SS.util.fmt` name (`'meters'`, `'time'`, `'int'`)
  or a template like `'{v} pins'` — the Records screen formats stored values with it.
- `ctx.awardMedal(id)` credits the **first** player (null for a guest); a mid-game award shows a toast + `coin`
  and is added to the results' medal list automatically even if `result.medals` omits it.
- Skill is applied and games/wins are counted only for saved, non-guest humans; `ctx.skillFor(guest)` is 0.
- After Restart or Play Again there is **no title card**: `start()` is called right after the iris opens.
- `ctx.hud` children: sports should put `.ss-pop` on chips/children, not on `.ss-hud-*` anchors
  (those use `transform` for centering).

### 10.3 Shell behaviour (main.js, ui.js)
- The core pause button is `#ss-pause`, a sibling of `#ss-hud` (a sport emptying the HUD can't remove it).
- While a game is loaded `#ss-root` has class `is-playing`; toasts then sit below the top-center HUD row.
- Banners, hints and pop-ups are hidden while the pause menu or a modal is open; don't rely on banners during
  your own `ui.choose()`.
- In short landscape (height ≤ 520 px) a default-positioned `ui.hint()` tucks into the bottom-right corner.
- `.ss-hud-top` is capped to the width between the side buttons (pause at top-left) and wraps its children
  onto a second row on narrow phones; keep top-center HUD rows to two or three short chips.
- On every exit (quit, restart, finish → menu, launch) main.js also clears `#ss-fx` (banners, hints, toasts,
  countdowns, title cards **and DOM confetti**), resets slow-mo, re-enables `SS.input`, and resumes the engine.
- `SS.ui` extensions: `events` ('pause' when the pause button is pressed, 'back' for Escape with no modal open),
  `esc`, `sfx`, `haptic(ms)`, `letters(text)`, `gestureSVG(name)`, `modal({className, dismissValue, backdrop})`
  → `{el, panel, close(v), result}`, `closeTop()`, `modalOpen()`, `confetti({count, colors})` (DOM, over panels),
  `clearFx()`, `pauseButton`, `GESTURES`, `ICONS`. Extra icons: edit plus trash dice lock sparkle chart bulb crown.
  `button()` also takes `className`, `haptic`, `sfx: null` (silent); `confirm()` takes `{ danger: true }`.
- `SS.app` (tests): `showScreen(id, opts)`, `launch(cfg, {intro})`, `openSetup(sport)`, `openPause()`,
  `sampleResults()`, `plaza`, getters `game`, `screen`.
  `SS.debug.screen` ∈ title · menu · editor · pals · records · settings · play · results.
- Setup choices are remembered per sport in `SS.save.settings.lastSetup` (wiped by reset).

### 10.4 Engine & input (engine.js)
- `addUpdate(fn, priority)`: **lower priority runs first** (stable). Use ~100 for a camera follow.
- Pausing is *claimed*: auto-pauses (tab hidden, blur, context lost) resume by themselves unless
  `engine.pause()` was called meanwhile. Window blur counts as hidden (desktop: clicking browser chrome pauses).
- While paused or `input.enabled === false`, pointer events are dropped and only the Escape key is delivered;
  a press in progress gets an `up` with `cancelled: true` (no tap/swipe).
- Pointer `move` fires only while pressed. Swipe `vx/vy` use screen axes (vy > 0 = moving down), like dx/dy.
  Extra fields: `pointerType`, `cancelled`. Release velocity ignores a lift-off gap < 50 ms; a longer stop
  before lifting reads as slow (nspeed → 0). A 400 ms press without moving is neither tap nor swipe.
- Extras: `engine.tier` (`{shadows, shadowMapSize, dpr, maxPixels}`), `QUALITY_TIERS`, `qualitySetting`
  ('auto' or a tier), `hidden`, event `'contextrestored'`, `project()` also returns `behind` and `z`,
  `slowmo()` returns a Promise, `init()` returns false (with a friendly card) without WebGL.
- `fitCamera(cam, opts)`: explicit opts are written back into `cam.userData.fit`, so the automatic refit keeps them.
  Cameras without `userData.fit` just get their aspect synced each frame.
- Auto quality: medium on phones / high on desktop, measures 3 s after a 1.2 s warm-up once a scene has ≥ 8 draw
  calls, steps down below 42 fps (at most twice), re-measures on `setView`. Headless runs settle at low:
  pass `&quality=high` for art screenshots.

### 10.5 util.js & save.js
- `tween()` promise has `.cancel(complete=false)` and always resolves; `SS.util.killTweens(target)`;
  a newer tween on the same property takes it over. Easing may be a function or a name (`'outBack'`).
- `fmt.meters` keeps one decimal below 10 m (`'3.4 m'`); `fmt.time` shows h:mm:ss past an hour.
  `angleDiff(a, b) = wrap(b − a)`.
- `rankFor()` also returns `index` and `next` (next rank or null). Extras: `SS.save.RANKS`, `LEVEL_MAX`,
  `medalInfo(sportId, medalId)` → `{profileId, name, date}`, `persistent` (false without storage),
  events `'reset' 'profile' 'active' 'medal'` besides `'setting'`.
- `addSkill` also bumps `skill.games` and `best`. `upsertProfile` assigns id/created when missing.
  `deleteProfile` removes that profile's skills and stats (records stay). A null profileId is stored as `'_'`.

### 10.6 Audio (audio.js)
- `SS.audio.names = { sfx, loops, music }`, `SS.audio.track` (current track id), `_analyze()` (tools).
- Before the first user gesture sfx are silent no-ops; `music()` and `loop()` handles are held and start on unlock.
- `suspend()` (game paused, page visible): loops fade out, music ducks behind the pause menu, **UI sfx still play**.
  Tab hidden: the AudioContext itself is suspended. `?mute=1` creates no sound at all.
- Volumes follow `SS.save.settings` automatically. `ui_toggle` plays 'on' for intensity ≥ 0.5, else 'off'.

### 10.7 World (world.js)
- Environments, crowds, trails and FX are advanced by `SS.world.update(dt)` (called by the engine). Calling a
  handle's own `update()` switches that handle to manual mode. Disposing the scene stops them automatically.
- `environment()` extras: `ground` (grass apron at y = −0.3, default true outdoors — pass `false` for pits/water
  below that), `seed`, `sunAzimuth`, `sunElevation`, `background` (indoor). Handle has `group`, `sunDir`;
  `setShadowFocus(size)` alone is fine. Indoor sun is configured but `castShadow = false` (set it if wanted).
  Shadow-map size follows the quality tier. Clouds are one merged mesh.
- `texture(name, { repeat:[x,y] })` returns a cached repeating copy (never mutate returned textures);
  ground textures take `color`; `checker` takes `colors`, `cells`; `banner` takes `width`, `height`.
- `mat()` also takes `vertexColors`, `flatShading`, `fog`, `depthWrite`.
- `stands()` group has `userData.rows` ready for `crowd({ rows })`; crowd handle has `count`.
- `burst({colors})`, `confetti({floor})` (pieces settle at y = floor), `trail({maxJump})` + `handle.mesh`,
  `label3d()` sprite has `userData.setText(text)`; `bg: null` draws outlined text without a pill.
- Exports `mergeGeometries(list)`, `paint(geo, hex)` (vertex colors), `gradient`, `SKIES`.

### 10.8 Pals (pals.js)
- `play()` resolves when a one-shot ends **or is replaced**; replaying the running loop only updates speed;
  after a one-shot the pal returns to its last loop (idle by default). Walk/run default to 1.3 / 4 m/s.
- Emotional anims set a matching expression only if the face is neutral or auto-set (a sport's explicit
  `setExpression` is never overridden).
- `pose()` with `lambda: Infinity` (or ≥ 1000) snaps. `create(p, { shadows:false })` casts no shadow —
  add `SS.world.blobShadow()` under it if it needs contact.
- Extras: `SS.pals.ANIMATIONS`, `EXPRESSIONS`, `OPTIONS.shirtNames`, roster entries have `tag` (flavour line),
  `pal.parts.neck`. A pal costs ~15 draw calls (+ the same again in the shadow pass) — budget accordingly.
- Portraits use one dedicated alpha renderer (one extra WebGL context), are synchronous and cached.

### 10.9 Performance reference (menu plaza, 390×844)
low: ~62 draw calls / 98k triangles · medium (shadows): ~103 calls / 161k triangles. Title view (whole plaza):
~124 / ~165 calls. Seven Pals account for ~105 of the low-quality calls.
