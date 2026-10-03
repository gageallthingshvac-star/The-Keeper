/* Sunny Sports — sports/baseball.js
 * BASEBALL — a Home Run Derby at "Sunny Park": you bat against a CPU pitcher.
 *
 *   A sideways swipe swings IMMEDIATELY (on 'move', once travel + speed thresholds are crossed).
 *   Timing at the contact plane decides the quality: perfect → sweet spot (centre field), early →
 *   pulled, late → opposite field, way off → foul tip / whiff. The swipe's vertical angle sets the
 *   launch (up-and-across = fly ball, flat = line drive, down = grounder), pitch height nudges it,
 *   and swipe speed is bat speed (exit velocity; shown on the Power bar after each swing, measured against a
 *   fixed yardstick so a flick has the same power on any screen). Timing matters most: a perfect swing keeps
 *   ~98 % of the bat's power, the edge of the window about half. The ball then flies with drag + backspin
 *   lift, bounces and rolls, rattles off the wall or lands in the stands; two middle infielders and three
 *   outfielders run down and catch (or field) what they can reach.
 *
 * Sections: registration · constants & helpers · pitch model · contact model · flight model ·
 * fielding model · create(): venue · characters & equipment · camera · HUD · game state ·
 * pitch flow · ball in play · results · input · per-frame · autoplay & debug · lifecycle.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // ---------------------------------------------------------------------------------------------
  // Registration data
  // ---------------------------------------------------------------------------------------------

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<g transform="rotate(42 32 32)">' +
    '<path d="M30.2 56V38C30.2 30 27.2 24 27.2 15.5 27.2 9.5 29.3 6 32 6S36.8 9.5 36.8 15.5C36.8 24 33.8 30 33.8 38V56Z" fill="#E2AE6E"/>' +
    '<path d="M33.6 9.2C35.2 11 35.6 14 35.4 17" stroke="#F6D7A8" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '<rect x="30.1" y="44" width="3.8" height="12" rx="1.5" fill="#2E86F0"/>' +
    '<ellipse cx="32" cy="57" rx="4.4" ry="2.2" fill="#8A5A34"/></g>' +
    '<circle cx="44" cy="44" r="13.5" fill="#FFFFFF" stroke="#D9E1EC" stroke-width="1.6"/>' +
    '<path d="M35.2 34.4C39.8 39.6 39.8 48.4 35.2 53.6M52.8 34.4C48.2 39.6 48.2 48.4 52.8 53.6" stroke="#E8343A" stroke-width="2.2" fill="none" stroke-dasharray="2.2 2.2" stroke-linecap="round"/>' +
    '</svg>';

  const DEF = {
    id: 'baseball',
    name: 'Baseball',
    tagline: 'Swing for the fences!',
    accent: '#2E86F0',
    tint: '#E4F0FF',
    icon: ICON,
    music: 'baseball',
    players: { min: 1, max: 1 },
    opponent: true,
    modes: [
      { id: 'derby', name: 'Home Run Derby', desc: 'Ten pitches. Hit as many home runs as you can.' },
      { id: 'sudden', name: 'Sudden Death', desc: 'Homer after homer. Three outs and you\'re done!' },
    ],
    howTo: {
      steps: [
        { gesture: 'swipe-right', text: 'Start your swipe just before the ball reaches you' },
        { gesture: 'swipe-across', text: 'Flick fast and angle it up to lift it deep' },
        { gesture: 'tap', text: 'Tap to skip the replay and get the next pitch' },
      ],
      tips: [
        'Early swings pull the ball, late swings go the other way. Perfect timing goes deep to centre.',
        'Timing is king, but a lazy swipe won\'t clear the wall: watch the Power bar. Up-and-across at about 30° is home run territory.',
        'Let pitches outside the box go by: a Ball doesn\'t count. A slow, fidgety wind-up means a slow pitch: wait for it!',
        'On a keyboard, Space swings level for line drives. Swipe with the mouse to lift it out.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Hit 3 home runs in one Derby' },
      { id: 'silver', name: 'Silver', desc: 'Hit 6 home runs in one Derby' },
      { id: 'gold', name: 'Gold', desc: 'Hit 9 home runs in one Derby' },
      { id: 'platinum', name: 'Platinum', desc: 'Go 10 for 10 in a Derby, or hit a 150 m blast' },
    ],
    create,
  };

  // ---------------------------------------------------------------------------------------------
  // Constants & small helpers
  // ---------------------------------------------------------------------------------------------

  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const easeIn = t => t * t;
  const easeOut = t => 1 - (1 - t) * (1 - t);

  function gauss(rng) {
    let u = 0;
    while (u <= 1e-9) u = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng.next());
  }

  // Field (meters). Home plate at the origin, centre field toward −Z, +X = the first-base side.
  // Spray angle phi: 0 = straight to centre, + toward right field. Fair territory: |phi| ≤ 45°.
  const MOUND_Z = -18.44, MOUND_H = 0.25;
  const BASE_D = 27.43 / Math.SQRT2;          // bases sit at (±19.4, −19.4) and (0, −38.8)
  const WALL_H = 3.0;
  const FAIR = Math.PI / 4;
  const STAND_FRONT = 1.3, STAND_RISE = 0.6, STAND_DEPTH = 6 * 0.85;
  const BERM_FROM = STAND_FRONT + STAND_DEPTH + 0.5, BERM_TO = 44;
  /** Height of whatever is behind the outfield wall, d meters past it (bleachers, then a grassy berm). */
  function outfieldSurface(d) {
    if (d < STAND_FRONT) return -1;
    if (d < STAND_FRONT + STAND_DEPTH) return 2.7 + (d - STAND_FRONT) * STAND_RISE;
    if (d < BERM_FROM) return 2.7 + 6 * STAND_RISE + 1.3;
    return 7.3 + (Math.min(d, BERM_TO) - BERM_FROM) * 0.26;
  }
  const wallR = phi => 100 + 20 * Math.cos(2 * clamp(phi, -FAIR, FAIR));   // 100 m down the lines, 120 m to centre
  const sprayOf = (x, z) => Math.atan2(x, -z);

  // Pitches
  const RELEASE = { x: -0.32, y: 1.86, z: MOUND_Z + 1.05 };   // right-handed pitcher, nominal hand at release
  const ZONE = { x: 0.26, y0: 0.46, y1: 1.06 };               // ball centre must cross inside to be a strike
  const CONTACT_Z = -0.32;                                    // ideal contact plane (just in front of the plate)
  const MITT_Z = 1.0;
  // Swing timing (game seconds; err = swing + LEAD − ball at the contact plane; − early, + late)
  const LEAD = 0.05;                         // the bat needs this long from the swipe to reach the zone
  const T_PERFECT = 0.022, T_GOOD = 0.05, T_FAIR = 0.105, T_TIP = 0.135;
  const T_SWEET = 0.008;                     // dead centre: a little extra pop (the 150 m blasts live here)
  const REACH = 0.3;                         // how far outside the zone the bat can still get to a pitch

  // Ball flight
  const BALL_R = 0.07;                       // drawn ~1.9× life size so it reads on a phone
  const GRAV = 9.8, DRAG = 0.0058, LIFT = 0.0026;
  const SIM_HZ = 240, SAMPLE_HZ = 60;
  // exit velocity = EV_TOP · bat (swipe speed) · timing · reach · pitch location · swing plane (· sweet spot)
  const EV_TOP = 52, TF_MIN = 0.5, EV_JITTER = 0.025;
  const BAT_SOFT_EASY = 0.27, BAT_SOFT_PRO = 0.38;   // bat-factor loss per unit of missing swipe speed
  const POWER_LOW = 0.4, POWER_OK = 0.66;              // power bar colours; a good swing below POWER_OK gets "swipe faster"
  // Home-run distance tiers (≈ top 15 % / 5 % of a strong hitter's homers; 150 m is the platinum blast)
  const BIG = { fanfare: 140, slowmo: 143, monster: 146, blast: 150 };

  const PITCH_TYPES = {
    // family: tint of the pitch trail against easy pitchers. Tells (see PITCH_TELLS): the curve comes over the top,
    // the slider from a low side-arm slot, the change-up and the wobbler from a slow, fidgety wind-up.
    fastball: { name: 'Fastball', tMul: 1.0, bx: 0.0, by: 0.1, pow: 2, hump: 0.1, wob: 0, spin: 42, family: 'fast' },
    slider: { name: 'Slider', tMul: 1.09, bx: 0.36, by: -0.18, pow: 2.6, hump: 0.12, wob: 0, spin: 34, family: 'break', rx: -0.22, ry: -0.3 },
    curve: { name: 'Curveball', tMul: 1.24, bx: 0.2, by: -0.62, pow: 2, hump: 0.42, wob: 0, spin: 28, family: 'break', rx: 0.1, ry: 0.22 },
    change: { name: 'Change-up', tMul: 1.34, bx: -0.14, by: -0.26, pow: 2, hump: 0.2, wob: 0, spin: 22, slowArm: 1.25, family: 'slow' },
    splitter: { name: 'Splitter', tMul: 1.06, bx: -0.04, by: -0.5, pow: 4, hump: 0.12, wob: 0, spin: 12, family: 'break' },
    wobbler: { name: 'Wobbler', tMul: 1.28, bx: 0, by: -0.14, pow: 2, hump: 0.16, wob: 0.15, spin: 1.5, slowArm: 1.18, family: 'slow' },
  };
  const FAMILY_COLOR = { fast: 0xFFFFFF, break: 0x5EC2FF, slow: 0xFFA43A };
  const PITCH_IDS = Object.keys(PITCH_TYPES);

  // ---------------------------------------------------------------------------------------------
  // Pitch model (pure). A pitch is a parametric path from the release point to its crossing point
  // at the plate (s = t / T reaches 1 at z = 0): straight line + late break (s^pow) + hump + wobble.
  // ---------------------------------------------------------------------------------------------

  function pitchWeights(s) {
    return {
      fastball: 1,
      change: 0.2 + 0.35 * s,
      curve: s < 0.12 ? 0 : 0.15 + 0.4 * s,
      slider: s < 0.3 ? 0 : 0.5 * s,
      splitter: s < 0.5 ? 0 : 0.5 * s,
      wobbler: s < 0.65 ? 0 : 0.35 * s,
    };
  }

  function pickPitchType(s, rng, mood) {
    const w = pitchWeights(s);
    if (mood && mood.avoid) w[mood.avoid] *= 0.25;                 // rarely the same pitch three times running
    if (mood && mood.wary) w.fastball *= lerp(1, 0.45, s);          // just gave up a homer: mix in off-speed
    let sum = 0;
    for (const k of PITCH_IDS) sum += w[k];
    let r = rng.next() * sum;
    for (const k of PITCH_IDS) { r -= w[k]; if (r <= 0) return k; }
    return 'fastball';
  }

  /** opts: { type, loc: 'strike'|'ball', mood: { avoid, wary } } → pitch description (positions via pitchPos). */
  function makePitch(skill, rng, opts = {}) {
    const type = PITCH_TYPES[opts.type] ? opts.type : pickPitchType(skill, rng, opts.mood);
    const def = PITCH_TYPES[type];
    const T = clamp(lerp(0.7, 0.56, skill) * def.tMul, 0.55, 0.88);
    const ballP = lerp(0.13, 0.3, skill) + (opts.mood && opts.mood.wary ? 0.12 * skill : 0);
    const strike = opts.loc ? opts.loc === 'strike' : !rng.chance(ballP);
    let cx, cy;
    if (opts.easy) {   // a friendly first pitch: a fastball down the middle
      cx = rng.range(-0.08, 0.08); cy = rng.range(0.74, 0.86);
    } else if (strike) {
      const spread = lerp(0.55, 1, skill);
      cx = rng.range(-0.21, 0.21) * spread;
      cy = 0.76 + rng.range(-0.27, 0.27) * spread;
    } else {
      const side = rng.int(0, 3);
      if (side < 2) { cx = (side ? 1 : -1) * rng.range(0.36, 0.6); cy = rng.range(0.42, 1.12); }
      else if (side === 2) { cx = rng.range(-0.3, 0.3); cy = rng.range(1.2, 1.42); }
      else { cx = rng.range(-0.3, 0.3); cy = rng.range(0.14, 0.36); }
    }
    const p0 = { x: RELEASE.x + (def.rx || 0), y: RELEASE.y + (def.ry || 0), z: RELEASE.z };
    const dz = -p0.z;
    const P = {
      type, name: def.name, def, T, cx, cy,
      strike: Math.abs(cx) <= ZONE.x && cy >= ZONE.y0 && cy <= ZONE.y1,
      p0, aimX: cx - def.bx, aimY: cy - def.by,
      ease: lerp(1.25, 1, skill),   // easy pitchers' timing windows are a little wider (see contactModel)
      skill,
      ph1: rng.next() * TAU, ph2: rng.next() * TAU,
      tc: (CONTACT_Z - p0.z) / dz * T,
      tm: (MITT_Z - p0.z) / dz * T,
      vPlate: dz / T,
      kmh: Math.round(dz / T * 3.6 * 1.3),
      spin: def.spin * rng.range(0.85, 1.15),
    };
    return P;
  }

  function wobble(P, s, a, ph) {
    return P.def.wob * (Math.sin(a * s + ph) - (1 - s) * Math.sin(ph) - s * Math.sin(a + ph));
  }

  function pitchPos(P, s, out) {
    const d = P.def;
    const k = Math.pow(Math.max(0, s), d.pow);
    out.x = lerp(P.p0.x, P.aimX, s) + d.bx * k + (d.wob ? wobble(P, s, 9.5, P.ph1) : 0);
    out.y = lerp(P.p0.y, P.aimY, s) + d.by * k + d.hump * 4 * s * (1 - s) + (d.wob ? 0.8 * wobble(P, s, 7.3, P.ph2) : 0);
    out.z = lerp(P.p0.z, 0, s);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Contact model (pure). sw: { err (s), angle (deg, swipe elevation), speed (0..1) }; H = batter side.
  // ---------------------------------------------------------------------------------------------

  function timingLabel(err) {
    const a = Math.abs(err);
    if (a <= T_PERFECT) return 'perfect';
    if (a <= T_GOOD) return 'good';
    if (a <= T_FAIR) return err < 0 ? 'early' : 'late';
    return err < 0 ? 'way-early' : 'way-late';
  }

  /** 1 on the sweet spot, barely less across the perfect window, then down to 0 at the edge of the fair window. */
  function timingQuality(ae) {
    if (ae <= T_SWEET) return 1;
    if (ae <= T_PERFECT) return 1 - 0.06 * (ae - T_SWEET) / (T_PERFECT - T_SWEET);
    return 0.94 * (1 - Math.pow((Math.min(ae, T_FAIR) - T_PERFECT) / (T_FAIR - T_PERFECT), 0.9));
  }

  /** Square contact launches around 20–34°; getting under the ball (high launch) loses exit velocity fast,
   *  topping it (low launch) a little: this is what makes the swipe angle matter. */
  function planeFactor(L) {
    if (L > 34) { const d = L - 34; return Math.max(0.5, 1 - 0.01 * d - 0.0004 * d * d); }
    if (L < 20) return Math.max(0.6, 1 - 0.016 * (20 - L));
    return 1;
  }

  /** Bat speed factor: 1 at a full-power swipe. Easy pitchers forgive a softer swing (never add distance). */
  function batFactor(speed, skill) {
    return 1 - (1 - clamp(speed, 0, 1)) * lerp(BAT_SOFT_EASY, BAT_SOFT_PRO, clamp(skill, 0, 1));
  }

  function contactModel(P, sw, H, rng) {
    const e = sw.err / (P.ease || 1);
    const ae = Math.abs(e);
    const timing = timingLabel(e);
    const ox = Math.max(0, Math.abs(P.cx) - ZONE.x), oy = Math.max(0, ZONE.y0 - P.cy, P.cy - ZONE.y1);
    const off = Math.hypot(ox, oy);
    if (ae > T_TIP) return { kind: 'whiff', why: sw.err < 0 ? 'early' : 'late', timing, err: sw.err };
    if (off > REACH) return { kind: 'whiff', why: 'reach', timing, err: sw.err };
    if (ae > T_FAIR) {
      // Foul tip: a glancing touch that spins back toward the backstop.
      const back = H * (sw.err < 0 ? -1 : 1);
      return {
        kind: 'tip', timing, err: sw.err, q: 0,
        ev: rng.range(13, 20), launch: rng.range(25, 62),
        spray: back * rng.range(105, 150),
      };
    }
    const qt = timingQuality(ae);
    const qc = 1 - (off / REACH) * 0.55;
    const ux = P.cx / ZONE.x, uy = (P.cy - 0.78) / 0.3;
    const loc = off > 0 ? 1 : 1 - 0.05 * (ux * ux + uy * uy);   // middle-middle goes furthest
    const bat = batFactor(sw.speed, P.skill || 0);
    const sweet = ae <= T_SWEET && off === 0;
    const n = 1 - qt;
    const angle = clamp(sw.angle, -50, 70);
    const launch = clamp(4 + angle * 0.9 + (P.cy - 0.76) * 20 + gauss(rng) * (1.5 + 10 * n) + (off > 0 ? gauss(rng) * 9 * off / REACH : 0), -35, 80);
    // timing decides most of it: a perfect swing keeps ~98 % of the bat's power, the edge of the window about half
    const ev = EV_TOP * bat * (TF_MIN + (1 - TF_MIN) * qt) * qc * loc * planeFactor(launch) * (sweet ? 1.025 : 1) * (1 + clamp(gauss(rng), -2.5, 0.6) * EV_JITTER);
    const spray = H * e * 400 + 25 * P.cx + gauss(rng) * (2.5 + 5 * n);
    return { kind: 'hit', timing, sweet, err: sw.err, q: qt * qc, ev, launch, spray, spin: clamp(1 + gauss(rng) * 0.07, 0.8, 1.2) };
  }

  // ---------------------------------------------------------------------------------------------
  // Flight model (pure): drag + decaying backspin lift, bounces, roll, the outfield wall, the stands.
  // Samples are stored at SAMPLE_HZ so live playback, the fielders and simulate() share one path.
  // ---------------------------------------------------------------------------------------------

  function launchVelocity(ev, launchDeg, sprayDeg) {
    const la = launchDeg * DEG, sp = sprayDeg * DEG;
    return { x: ev * Math.cos(la) * Math.sin(sp), y: ev * Math.sin(la), z: -ev * Math.cos(la) * Math.cos(sp) };
  }

  /** air: { wx, wz (wind, m/s), lift (backspin multiplier) } or null for still air. */
  function accel(vx, vy, vz, t, lift, air, out) {
    const ax = air ? vx - air.wx : vx, az = air ? vz - air.wz : vz;   // drag acts on the velocity through the air
    const v = Math.hypot(vx, vy, vz), h = Math.hypot(vx, vz), va = Math.hypot(ax, vy, az);
    out.x = -DRAG * va * ax; out.y = -GRAV - DRAG * va * vy; out.z = -DRAG * va * az;
    if (lift && h > 0.01 && v > 0.01) {
      const L = LIFT * (air ? air.lift : 1) * Math.exp(-t / 6) * v;
      out.x += L * (-vy * vx / h); out.y += L * h; out.z += L * (-vy * vz / h);
    }
    return out;
  }

  /** Carry distance on an empty field (where the ball would come down at ground level). */
  function carryDistance(x, y, z, vx, vy, vz, air) {
    const dt = 1 / SIM_HZ, a = {};
    let t = 0;
    while (t < 14) {
      accel(vx, vy, vz, t, true, air, a);
      vx += a.x * dt; vy += a.y * dt; vz += a.z * dt;
      x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
      if (y <= 0 && vy < 0) break;
    }
    return Math.hypot(x, z);
  }

  function simFlight(x, y, z, vx, vy, vz, maxT = 11, air = null) {
    const out = {
      pts: [x, y, z], events: [], hr: false, hrT: -1, hrY: 0, hrPt: null, landT: -1, land: null,
      wallT: -1, standsT: -1, stopT: -1, overT: -1, endT: 0, maxR: 0, apexT: 0,
      proj: carryDistance(x, y, z, vx, vy, vz, air),
    };
    const dt = 1 / SIM_HZ, per = SIM_HZ / SAMPLE_HZ, a = {};
    let t = 0, i = 0, rolling = false, bounced = false, done = false;
    while (!done && t < maxT) {
      if (rolling) {
        const h = Math.hypot(vx, vz), dec = 3.4 * dt;
        if (h <= dec) { vx = 0; vz = 0; } else { vx -= vx / h * dec; vz -= vz / h * dec; }
        vy = 0; y = BALL_R;
      } else {
        const up = vy > 0;
        accel(vx, vy, vz, t, !bounced, air, a);
        vx += a.x * dt; vy += a.y * dt; vz += a.z * dt;
        if (up && vy <= 0 && !bounced) out.apexT = t;
      }
      x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
      if (!rolling && y <= BALL_R && vy < 0) {
        if (out.landT < 0) out.landT = t, out.land = { x, z, r: Math.hypot(x, z) };
        out.events.push({ t, type: 'bounce', x, y: 0, z, v: -vy });
        y = BALL_R; bounced = true;
        vy = -vy * 0.36; vx *= 0.7; vz *= 0.7;
        if (vy < 1.0) { rolling = true; vy = 0; }
      }
      const r = Math.hypot(x, z), phi = sprayOf(x, z);
      out.maxR = Math.max(out.maxR, r);
      if (Math.abs(phi) <= FAIR + 0.01) {
        const R = wallR(phi);
        if (!out.hr && r >= R - BALL_R && r < R + 1) {
          if (y >= WALL_H) {
            if (!bounced) { out.hr = true; out.hrT = t; out.hrY = y; out.hrPt = { x, y, z }; }
            else { out.overT = t; out.events.push({ t, type: 'over', x, y, z, v: 0 }); done = true; }
          } else {
            const nx = x / r, nz = z / r, vr = vx * nx + vz * nz;
            if (vr > 0) {
              vx -= 1.38 * vr * nx; vz -= 1.38 * vr * nz; vx *= 0.75; vz *= 0.75; vy *= 0.8;
              out.events.push({ t, type: 'wall', x, y, z, v: vr });
              if (out.wallT < 0) out.wallT = t;
            }
            const k = (R - BALL_R) / r; x *= k; z *= k;
          }
        }
        if (out.hr) {
          const surf = outfieldSurface(r - R);
          if (surf >= 0 && y <= surf + BALL_R) {
            out.standsT = t; out.events.push({ t, type: r - R < BERM_FROM ? 'stands' : 'berm', x, y, z, v: Math.hypot(vx, vy, vz) }); done = true;
          }
        }
      }
      else if (r > 20) {
        // foul territory: the line bleachers (~15 m off the lines) and the backstop/grandstand behind home
        const perp = r * Math.sin(Math.abs(phi) - FAIR);
        if ((perp > 14.6 && y < 1.0 + (perp - 14.6) * 0.6 && y < 5) || (z > 16.9 && y < 4.6)) {
          out.events.push({ t, type: 'seats', x, y, z, v: Math.hypot(vx, vy, vz) }); out.stopT = t; done = true;
        }
      }
      if (rolling && vx === 0 && vz === 0) { out.stopT = t; done = true; }
      if (y < -0.3) done = true;
      if (++i % per === 0 || done) out.pts.push(x, y, z);
    }
    out.endT = t;
    return out;
  }

  function samplePath(fl, t, out) {
    const pts = fl.pts, n = pts.length / 3;
    const f = clamp(t * SAMPLE_HZ, 0, n - 1);
    const i = Math.min(n - 2, Math.floor(f)), k = n > 1 ? f - i : 0;
    if (n < 2) { out.set(pts[0], pts[1], pts[2]); return out; }
    out.set(lerp(pts[i * 3], pts[i * 3 + 3], k), lerp(pts[i * 3 + 1], pts[i * 3 + 4], k), lerp(pts[i * 3 + 2], pts[i * 3 + 5], k));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Fielding model (pure). A fielder can be at a point by react + (dist − reach) / speed; he picks the
  // reachable descending sample closest to glove height. A wall-scraper can be robbed at the wall.
  // ---------------------------------------------------------------------------------------------

  const OUTFIELD = [
    { id: 'lf', phi: -27 * DEG, r: 76 },
    { id: 'cf', phi: 0, r: 84 },
    { id: 'rf', phi: 27 * DEG, r: 76 },
  ];

  // the middle infielders take the pop-ups and the grounders hit at them (no corner infielders: the lines stay open)
  const INFIELD = [
    { id: 'ss', phi: -16 * DEG, r: 41 },
    { id: '2b', phi: 16 * DEG, r: 41 },
  ];

  function fielderSpots() {
    const list = OUTFIELD.map(o => ({ id: o.id, x: o.r * Math.sin(o.phi), z: -o.r * Math.cos(o.phi), react: 0.4, speed: 6.4, reach: 1.0, minR: 30, maxR: 140, of: true }));
    for (const o of INFIELD) list.push({ id: o.id, x: o.r * Math.sin(o.phi), z: -o.r * Math.cos(o.phi), r: o.r, react: 0.45, speed: 6.0, reach: 1.0, minR: 14, maxR: 72, of: false, inf: true });
    list.push({ id: 'p', x: 0, z: MOUND_Z, react: 0.5, speed: 5.0, reach: 0.9, minR: 6, maxR: 40, of: false });
    return list;
  }

  function findCatch(fl, fielders) {
    const pts = fl.pts, n = pts.length / 3;
    const limitT = fl.landT >= 0 ? fl.landT : fl.hr ? fl.hrT : fl.endT;
    let best = null;
    for (let fi = 0; fi < fielders.length; fi++) {
      const f = fielders[fi];
      let pick = null;
      for (let k = 1; k < n; k++) {
        const t = k / SAMPLE_HZ;
        if (t > limitT) break;
        const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
        if (y > 2.45 || y < 0.12 || y >= pts[k * 3 - 2]) continue;
        const r = Math.hypot(x, z), phi = sprayOf(x, z);
        if (Math.abs(phi) > FAIR + 0.03 || r > wallR(phi) - 0.6 || r < f.minR || r > f.maxR) continue;
        const dive = y < 0.7;
        const d = Math.hypot(x - f.x, z - f.z);
        const arrive = f.react + Math.max(0, d - (dive ? f.reach + 1.2 : f.reach)) / f.speed;
        if (arrive > t) continue;
        const score = Math.abs(y - 1.3);
        if (!pick || score < pick.score - 1e-6) pick = { fi, k, t, x, y, z, dive, leap: y > 2.0, score, arrive };
      }
      if (f.inf) {
        // a ball on the ground (or about to be) that comes through an infielder's depth: he can get in front of it
        for (let k = 1; k < n; k++) {
          const t = k / SAMPLE_HZ;
          if (pick && t >= pick.t) break;
          const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
          const r = Math.hypot(x, z);
          if (r > f.r + 4) break;
          if (y > 0.9 || r < f.r - 11 || t < fl.landT || fl.landT < 0) continue;
          if (Math.abs(sprayOf(x, z)) > FAIR) continue;
          const d = Math.hypot(x - f.x, z - f.z);
          const arrive = f.react + Math.max(0, d - f.reach - 0.6) / f.speed;
          if (arrive > t) continue;
          pick = { fi, k, t, x, y, z, ground: true, dive: d > f.reach + 3.5, score: 0, arrive };
          break;
        }
      }
      if (pick && (!best || pick.t < best.t)) best = pick;
    }
    if (!best && fl.hr && fl.hrY <= WALL_H + 1.6) {
      // a wall-scraper: an outfielder who gets to the wall in time leaps and takes it back
      const W = fl.hrPt;
      for (let fi = 0; fi < fielders.length; fi++) {
        const f = fielders[fi];
        if (!f.of) continue;
        const d = Math.hypot(W.x - f.x, W.z - f.z);
        const arrive = f.react + Math.max(0, d - 1.5) / (f.speed * 1.25);
        if (arrive <= fl.hrT && (!best || arrive < best.arrive)) {
          best = { fi, k: Math.round(fl.hrT * SAMPLE_HZ), t: fl.hrT, x: W.x, y: W.y, z: W.z, robbed: true, leap: true, arrive };
        }
      }
    }
    return best;
  }

  /** → { kind: 'hr'|'hit'|'out'|'foul', label, dist, tone } */
  function classify(res, fl, cat) {
    if (res.kind === 'tip') return { kind: 'foul', label: 'FOUL TIP', dist: 0, tone: 'tip' };
    const fair = Math.abs(res.spray) <= 45;
    if (!fair) return { kind: 'foul', label: 'FOUL BALL', dist: fl.land ? Math.round(fl.land.r) : Math.round(fl.proj), tone: 'foul' };
    if (cat) {
      const r = Math.hypot(cat.x, cat.z);
      if (cat.robbed) return { kind: 'out', label: 'ROBBED!', dist: Math.round(fl.proj), tone: 'robbed' };
      if (cat.ground) return { kind: 'out', label: 'GROUND OUT', dist: Math.round(r), tone: 'ground' };
      if (cat.dive) return { kind: 'out', label: 'DIVING CATCH!', dist: Math.round(r), tone: 'catch' };
      if (r < 50 && res.launch > 45) return { kind: 'out', label: 'POP OUT', dist: Math.round(r), tone: 'catch' };
      if (res.launch < 14) return { kind: 'out', label: 'LINE OUT', dist: Math.round(r), tone: 'catch' };
      if (r >= 92) return { kind: 'out', label: 'LONG FLY OUT', dist: Math.round(r), tone: 'long' };
      return { kind: 'out', label: 'FLY OUT', dist: Math.round(r), tone: 'catch' };
    }
    if (fl.hr) return { kind: 'hr', label: 'HOME RUN!', dist: Math.round(fl.proj), tone: 'hr' };
    if (fl.overT >= 0) return { kind: 'hit', label: 'GROUND-RULE DOUBLE', dist: Math.round(fl.land ? fl.land.r : fl.proj), tone: 'hit' };
    const landR = fl.land ? fl.land.r : fl.maxR;
    if (landR < 34 && res.launch < 12) {
      if (fl.maxR < 40) return { kind: 'out', label: 'GROUND OUT', dist: Math.round(fl.maxR), tone: 'ground' };
      return { kind: 'hit', label: 'SINGLE!', dist: Math.round(fl.maxR), tone: 'hit' };
    }
    if (fl.wallT >= 0 && (fl.landT < 0 || fl.wallT < fl.landT)) return { kind: 'hit', label: 'OFF THE WALL!', dist: Math.round(fl.proj), tone: 'wall' };
    const phiL = fl.land ? Math.abs(sprayOf(fl.land.x, fl.land.z)) / DEG : 0;
    if (landR >= 108 && phiL > 17 && phiL < 33) return { kind: 'hit', label: 'TRIPLE!', dist: Math.round(landR), tone: 'hit' };
    if (landR >= 82) return { kind: 'hit', label: 'DOUBLE!', dist: Math.round(landR), tone: 'hit' };
    return { kind: 'hit', label: 'SINGLE!', dist: Math.round(landR), tone: 'hit' };
  }

  /** Air for one batted ball: the wind ({ speed m/s, dir rad: 0 = blowing out to centre, + toward right }) and its backspin. */
  function airFor(res, wind) {
    const w = wind || { speed: 0, dir: 0 };
    return { wx: w.speed * Math.sin(w.dir), wz: -w.speed * Math.cos(w.dir), lift: res.spin || 1 };
  }

  /** Full pure outcome of one swing on one pitch (used by simulate()). */
  function resolveSwing(P, sw, H, rng, fielders, wind) {
    const res = contactModel(P, sw, H, rng);
    if (res.kind === 'whiff') return { res, out: { kind: 'strike', label: 'STRIKE!', dist: 0 } };
    const v = launchVelocity(res.ev, res.launch, res.spray);
    const fl = simFlight(P.cx, P.cy, CONTACT_Z, v.x, v.y, v.z, res.kind === 'tip' ? 2.5 : 11, airFor(res, wind));
    const fair = Math.abs(res.spray) <= 45 && res.kind === 'hit';
    const cat = fair ? findCatch(fl, fielders) : null;
    return { res, fl, cat, out: classify(res, fl, cat) };
  }

  const QUALITY = { perfect: 1, great: 0.85, good: 0.7, mediocre: 0.45, ok: 0.45, bad: 0.2, awful: 0 };

  /**
   * Monte Carlo of n swings at strikes (pure; SS.debug.sport.debug.simulate wraps it). quality: 0..1 or a name
   * (perfect/great/good/mediocre/bad) → timing spread, swipe angle and swipe speed. Below 0.9 the batter can be
   * fooled: off-speed pitches draw early swings, breaking balls and the wobbler widen the timing spread.
   * o: { skill, type, seed, errMs | errSdMs, angle, speed, wind (m/s out) }; without o.wind each swing gets a breeze
   * like the game's. makeRng(seed) → { next, range, chance, int }.
   */
  function simulateModel(n, quality, o, skill, H, makeRng) {
    const q = typeof quality === 'string' ? (QUALITY[quality] != null ? QUALITY[quality] : 0.5) : clamp(Number(quality), 0, 1);
    const r = makeRng(o.seed == null ? 1234 : o.seed);
    const sErr = lerp(0.1, 0.012, q), mAng = lerp(8, 29, q), sAng = lerp(22, 5, q);
    const fooled = Math.max(0, 0.9 - q) / 0.9;
    const spots = fielderSpots();
    const counts = { hr: 0, hit: 0, out: 0, foul: 0, whiff: 0 };
    let hrDist = 0, maxDist = 0, perfect = 0;
    const labels = {};
    for (let i = 0; i < n; i++) {
      const P = makePitch(o.skill == null ? skill : o.skill, r, { type: o.type, loc: 'strike' });
      let err;
      if (o.errMs != null) err = o.errMs / 1000;
      else {
        const def = P.def;
        const bias = -(1 - 1 / def.tMul) * P.T * fooled * 0.5;              // timed for a fastball: early on slow stuff
        const widen = 1 + fooled * (def.wob ? 0.8 : def.family === 'break' ? 0.45 : 0);
        err = bias + gauss(r) * (o.errSdMs != null ? o.errSdMs / 1000 : sErr) * widen;
      }
      const sw = {
        err,
        angle: o.angle != null ? o.angle : mAng + gauss(r) * sAng,
        speed: o.speed != null ? o.speed : clamp(lerp(0.4, 1, q) + r.range(-0.15, 0.1), 0, 1),
      };
      const air = o.wind != null ? { speed: Number(o.wind), dir: 0 } : { speed: clamp(r.range(-1, 1.6) + gauss(r) * 0.35, -1.5, 2), dir: r.range(-0.6, 0.6) };
      const x = resolveSwing(P, sw, H, r, spots, air);
      const k = x.out.kind === 'strike' ? 'whiff' : x.out.kind;
      counts[k] += 1;
      labels[x.out.label] = (labels[x.out.label] || 0) + 1;
      if (x.res.timing === 'perfect') perfect++;
      if (k === 'hr') { hrDist += x.out.dist; maxDist = Math.max(maxDist, x.out.dist); }
    }
    const pct = v => Math.round(v / n * 1000) / 10;
    return {
      n, quality: q, 'hr%': pct(counts.hr), 'hit%': pct(counts.hit), 'out%': pct(counts.out), 'foul%': pct(counts.foul), 'whiff%': pct(counts.whiff),
      avgHr: counts.hr ? Math.round(hrDist / counts.hr) : 0, maxHr: maxDist, 'perfect%': pct(perfect), labels,
    };
  }

  // =============================================================================================
  // create()
  // =============================================================================================

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, engine, util: U } = ctx;
    const V3 = THREE.Vector3;
    const MODE = ctx.mode === 'sudden' ? 'sudden' : 'derby';
    const me = ctx.players[0].profile;
    const opp = ctx.opponent || { profile: pals.CPU_ROSTER[0].profile, skill: 0.1, title: 'Rookie' };
    const SKILL = clamp(Number(opp.skill) || 0, 0, 1);
    const H = SS.save && SS.save.settings && SS.save.settings.leftHanded ? -1 : 1;   // 1 = right-handed batter
    const rng = ctx.rng;
    const DERBY_PITCHES = 10;
    const GOAL = MODE === 'derby' ? Math.round(clamp(2 + SKILL * 4, 2, 6)) : Math.round(clamp(2 + SKILL * 5, 2, 7));
    const BATTER_POS = new V3(H * -0.8, 0, -0.12);

    // =============================================================================================
    // Venue: "Sunny Park"
    // =============================================================================================

    const env = world.environment(scene, {
      sky: 'day', fogNear: 170, fogFar: 560, hillRadius: 270, clouds: 12,
      trees: { ring: 185, count: 56 }, seed: 11,
      shadow: { center: new V3(0, 0, -8.5), size: 32 },
    });

    /** Accumulates flat-shaded, vertex-colored triangles (merged with other parts later). */
    function builder() {
      const p = [], n = [], c = [], idx = [];
      const col = new THREE.Color(), e1 = new V3(), e2 = new V3(), nn = new V3();
      return {
        quad(a, b, cc, d, color) {
          e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          e2.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
          nn.crossVectors(e1, e2).normalize();
          col.set(color);
          const base = p.length / 3;
          for (const v of [a, b, cc, d]) { p.push(v[0], v[1], v[2]); n.push(nn.x, nn.y, nn.z); c.push(col.r, col.g, col.b); }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        },
        geometry() {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
          g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
          g.setIndex(idx);
          return g;
        },
      };
    }

    const statics = [];   // vertex-colored parts merged into one mesh
    const glows = [];     // unlit parts (lamp faces) merged into one mesh
    function put(list, geo, color, x = 0, y = 0, z = 0, ry = 0) {
      if (color != null) world.paint(geo, color);
      if (ry) geo.rotateY(ry);
      geo.translate(x, y, z);
      list.push(geo);
      return geo;
    }
    const box = (w, h, d, color, x, y, z, ry) => put(statics, new THREE.BoxGeometry(w, h, d), color, x, y, z, ry);
    const polar = (r, phi) => [r * Math.sin(phi), -r * Math.cos(phi)];
    const faceHome = (x, z) => Math.atan2(-x, -z);

    // Ground: outfield grass, warning track, painted infield ----------------------------------------
    const grassGeo = new THREE.CircleGeometry(150, 96);
    grassGeo.rotateX(-Math.PI / 2);
    const grass = new THREE.Mesh(grassGeo, world.mat(0xffffff, { map: world.texture('grass_stripes', { repeat: [26, 26] }) }));
    grass.rotation.y = Math.PI / 4;
    grass.receiveShadow = true;
    scene.add(grass);

    function trackGeometry() {
      const segs = 96, pos = [], uv = [], idx = [];
      const a0 = -FAIR - 6 * DEG, a1 = FAIR + 6 * DEG;
      for (let i = 0; i <= segs; i++) {
        const phi = lerp(a0, a1, i / segs), R = wallR(phi);
        for (const r of [R - 4.6, R - 0.05]) {
          const [x, z] = polar(r, phi);
          pos.push(x, 0, z); uv.push(x / 3.2, z / 3.2);
        }
        if (i < segs) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    const track = new THREE.Mesh(trackGeometry(), new THREE.MeshLambertMaterial({
      map: world.texture('dirt', { color: '#C99567' }), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }));
    track.position.y = 0.006;
    track.receiveShadow = true;
    scene.add(track);

    // Grassy berm behind the outfield bleachers (where the long ones land)
    function bermGeometry() {
      const segs = 72, rings = 6, pos = [], uv = [], idx = [];
      const a0 = -FAIR - 8 * DEG, a1 = FAIR + 8 * DEG;
      for (let i = 0; i <= segs; i++) {
        const phi = lerp(a0, a1, i / segs), R = wallR(phi);
        for (let j = 0; j <= rings; j++) {
          const d = lerp(BERM_FROM - 1.5, BERM_TO + 6, j / rings);
          const [x, z] = polar(R + d, phi);
          const y = d > BERM_TO ? outfieldSurface(BERM_TO) - (d - BERM_TO) * 1.6 : outfieldSurface(Math.max(d, BERM_FROM));
          pos.push(x, y, z); uv.push(x / 9, z / 9);
        }
        if (i < segs) for (let j = 0; j < rings; j++) {
          const k = i * (rings + 1) + j, k2 = k + rings + 1;
          idx.push(k, k2, k + 1, k + 1, k2, k2 + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    const berm = new THREE.Mesh(bermGeometry(), world.mat(0xffffff, { map: world.texture('grass', { color: '#6CC24E' }) }));
    berm.receiveShadow = true;
    scene.add(berm);

    // Infield: one canvas texture (dirt skin, infield grass, mound circle, chalk, batter's boxes), cropped to the
    // painted area and drawn as an opaque, alpha-tested decal (a blended layer this size is costly on phones).
    // Texels are finer across (x) than along the line of sight (z), which the batting view foreshortens anyway.
    const INF = { x0: -30, z0: -48, w: 60, d: 52, SX: 2048, SZ: 1024 };
    function paintInfield() {
      const cv = document.createElement('canvas');
      cv.width = INF.SX; cv.height = INF.SZ;
      const g = cv.getContext('2d');
      g.setTransform(INF.SX / INF.w, 0, 0, INF.SZ / INF.d, -INF.x0 * INF.SX / INF.w, -INF.z0 * INF.SZ / INF.d);   // draw in meters
      const pattern = (tex, tile) => {
        const p = g.createPattern(tex.image, 'repeat');
        if (p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix().scale(tile / tex.image.width));
        return p;
      };
      const dirt = pattern(world.texture('dirt', { color: '#CC9062' }), 3.2);
      const turf = pattern(world.texture('grass', { color: '#62B84B' }), 4.5);
      const circle = (x, z, r) => { g.beginPath(); g.arc(x, z, r, 0, TAU); };
      // dirt skin: arc around the mound, clipped to fair territory (+ a little apron past the lines)
      g.save();
      const m = 2.4 * Math.SQRT2;
      g.beginPath();
      g.moveTo(0, m); g.lineTo(70, m - 70); g.lineTo(-70, m - 70); g.closePath();
      g.clip();
      circle(0, MOUND_Z, 29); g.fillStyle = dirt; g.fill();
      g.restore();
      // infield grass (diamond inset from the base paths), with soft mowing stripes
      const ins = BASE_D - 1.6 * Math.SQRT2;
      g.beginPath();
      g.moveTo(0, -BASE_D + ins); g.lineTo(ins, -BASE_D); g.lineTo(0, -BASE_D - ins); g.lineTo(-ins, -BASE_D); g.closePath();
      g.fillStyle = turf; g.fill();
      g.save(); g.clip();
      g.translate(0, -BASE_D); g.rotate(Math.PI / 4);
      for (let i = -8; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,220,0.07)' : 'rgba(0,50,0,0.05)'; g.fillRect(i * 3.05, -30, 3.05, 60); }
      g.restore();
      g.lineWidth = 0.12; g.strokeStyle = 'rgba(110,70,35,0.35)'; g.stroke();
      // home circle, mound, base cut-outs
      for (const [x, z, r] of [[0, -0.25, 4.0], [0, MOUND_Z, 2.74], [BASE_D, -BASE_D, 1.6], [-BASE_D, -BASE_D, 1.6], [0, -2 * BASE_D, 1.6]]) {
        circle(x, z, r); g.fillStyle = dirt; g.fill();
        g.lineWidth = 0.1; g.strokeStyle = 'rgba(110,70,35,0.3)'; g.stroke();
      }
      // chalk: foul lines (only where they cross the dirt; chalk strips carry them on over the grass), boxes
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.09; g.lineCap = 'square';
      g.globalCompositeOperation = 'source-atop';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 0.22, 0.22); g.lineTo(s * 40, -39.78); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
      for (const s of [-1, 1]) g.strokeRect(s > 0 ? 0.37 : -1.59, -1.16, 1.22, 1.83);
      g.beginPath();
      g.moveTo(-0.55, 0.67); g.lineTo(-0.55, 3.0); g.lineTo(0.55, 3.0); g.lineTo(0.55, 0.67);
      g.stroke();
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    }
    const infieldGeo = new THREE.PlaneGeometry(INF.w, INF.d);
    infieldGeo.rotateX(-Math.PI / 2);
    const infield = new THREE.Mesh(infieldGeo, new THREE.MeshLambertMaterial({
      map: paintInfield(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    infield.position.set(INF.x0 + INF.w / 2, 0.01, INF.z0 + INF.d / 2);
    infield.receiveShadow = true;
    infield.renderOrder = -1;   // first: everything under it (the outfield grass) is then depth-rejected
    scene.add(infield);

    // Mound
    const moundGeo = new THREE.CylinderGeometry(0.9, 2.74, MOUND_H, 40, 1);
    const moundUv = moundGeo.attributes.uv, moundPos = moundGeo.attributes.position;
    for (let i = 0; i < moundUv.count; i++) moundUv.setXY(i, moundPos.getX(i) / 3.2, moundPos.getZ(i) / 3.2);
    const mound = new THREE.Mesh(moundGeo, new THREE.MeshLambertMaterial({ map: world.texture('dirt', { color: '#CC9062' }) }));
    mound.position.set(0, MOUND_H / 2, MOUND_Z);
    mound.receiveShadow = true;
    scene.add(mound);

    // Static structures (one merged vertex-colored mesh) ----------------------------------------------
    // Home plate, bases, rubber
    const plateShape = new THREE.Shape([[0, 0.22], [0.216, 0.0], [0.216, -0.216], [-0.216, -0.216], [-0.216, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
    const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: 0.025, bevelEnabled: false });
    plateGeo.rotateX(Math.PI / 2);
    put(statics, plateGeo, 0xFFFFFF, 0, 0.026, 0);
    for (const [x, z] of [[BASE_D, -BASE_D], [0, -2 * BASE_D], [-BASE_D, -BASE_D]]) box(0.38, 0.07, 0.38, 0xFFFFFF, x, 0.035, z, Math.PI / 4);
    box(0.61, 0.04, 0.15, 0xFFFFFF, 0, MOUND_H + 0.01, MOUND_Z + 0.3);

    // Outfield wall: padded panels, yellow top line, cap and back; foul poles.
    const WALL_A = 0x2C7A55, WALL_B = 0x2A7350, WALL_TOP = 0xFFC93C, WALL_BACK = 0x245F45;
    {
      const b = builder(), segs = 90, th = 0.45;
      for (let i = 0; i < segs; i++) {
        const a0 = lerp(-FAIR, FAIR, i / segs), a1 = lerp(-FAIR, FAIR, (i + 1) / segs);
        const r0 = wallR(a0), r1 = wallR(a1);
        const [x0, z0] = polar(r0, a0), [x1, z1] = polar(r1, a1);
        const [bx0, bz0] = polar(r0 + th, a0), [bx1, bz1] = polar(r1 + th, a1);
        const yb = WALL_H - 0.2;
        b.quad([x0, 0, z0], [x1, 0, z1], [x1, yb, z1], [x0, yb, z0], i % 2 ? WALL_A : WALL_B);
        b.quad([x0, yb, z0], [x1, yb, z1], [x1, WALL_H, z1], [x0, WALL_H, z0], WALL_TOP);
        b.quad([x0, WALL_H, z0], [x1, WALL_H, z1], [bx1, WALL_H, bz1], [bx0, WALL_H, bz0], WALL_TOP);
        b.quad([bx1, 0, bz1], [bx0, 0, bz0], [bx0, WALL_H, bz0], [bx1, WALL_H, bz1], WALL_BACK);
      }
      statics.push(b.geometry());
      for (const s of [-1, 1]) {
        const [x, z] = polar(wallR(FAIR) + 0.3, s * FAIR);
        put(statics, new THREE.CylinderGeometry(0.17, 0.2, 17, 10), 0xFFD23C, x, 8.5, z);
      }
    }

    // Foul lines past the dirt (thin chalk strips up to the poles)
    for (const s of [-1, 1]) {
      const len = wallR(FAIR) - 38;
      const g = new THREE.BoxGeometry(0.09, 0.012, len);
      world.paint(g, 0xFFFFFF);
      g.translate(0, 0.008, -(38 + len / 2));
      g.rotateY(-s * FAIR);
      statics.push(g);
    }

    // Scoreboard frame (the dark "batter's eye" is the empty centre-field bleacher section)
    const SB = { phi: H * 13 * DEG, r: wallR(13 * DEG) + 17, y: 16.5, w: 17, h: 8.5 };   // on the open side of the batting view
    {
      const [x, z] = polar(SB.r, SB.phi), ry = faceHome(x, z);
      const back = new THREE.BoxGeometry(SB.w + 1.2, SB.h + 1.2, 0.8);
      world.paint(back, 0x22314F);
      back.translate(0, SB.y, -0.5); back.rotateY(ry); back.translate(x, 0, z);
      statics.push(back);
      for (const s of [-1, 1]) {
        const leg = new THREE.BoxGeometry(0.7, SB.y - SB.h / 2, 0.7);
        world.paint(leg, 0x5B6B82);
        leg.translate(s * SB.w * 0.32, (SB.y - SB.h / 2) / 2, -0.6); leg.rotateY(ry); leg.translate(x, 0, z);
        statics.push(leg);
      }
    }

    // Bleachers: five outfield segments behind the wall (where the home runs land, so all of them are
    // full), a grandstand behind home, and two along the lines.
    const crowdRows = { outfield: [], lines: [], home: [] };
    function addStands(o, baseH, seats) {
      const grp = world.stands(null, o);
      grp.updateMatrixWorld(true);
      const mesh = grp.children[0];
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      statics.push(g);
      mesh.geometry.dispose();
      if (baseH > 0) {
        const base = new THREE.BoxGeometry(o.width + 0.5, baseH, o.rows * o.depth + 0.4);
        world.paint(base, 0xC9D1DC);
        base.translate(0, -baseH / 2, -(o.rows * o.depth) / 2);
        base.rotateY(o.facing);
        base.translate(o.x, o.y, o.z);
        statics.push(base);
      }
      if (seats) for (const r of grp.userData.rows) seats.push(r);
    }
    for (const c of [-36, -18, 0, 18, 36]) {
      const phi = c * DEG, rf = wallR(phi) + STAND_FRONT;
      const [x, z] = polar(rf, phi);
      addStands({ x, y: 2.7, z, width: 2 * rf * Math.tan(9.4 * DEG), rows: 6, rise: STAND_RISE, depth: 0.85, facing: faceHome(x, z), color: 0x2E86F0 }, 2.7, crowdRows.outfield);
    }
    addStands({ x: 0, y: 1.1, z: 17.5, width: 36, rows: 7, rise: 0.5, depth: 0.85, facing: Math.PI, color: 0x2E86F0 }, 1.1, crowdRows.home);
    for (const s of [-1, 1]) {
      const u = [s / Math.SQRT2, -1 / Math.SQRT2], nrm = [s / Math.SQRT2, 1 / Math.SQRT2];
      const x = u[0] * 34 + nrm[0] * 16, z = u[1] * 34 + nrm[1] * 16;
      addStands({ x, y: 1.0, z, width: 34, rows: 6, rise: 0.5, depth: 0.85, facing: Math.atan2(-nrm[0], -nrm[1]), color: 0x2E86F0 }, 1.0, crowdRows.lines);
      // low wall in front of the line stands
      const wall = new THREE.BoxGeometry(34, 1.0, 0.3);
      world.paint(wall, 0x2C7A55);
      wall.translate(0, 0.5, 0.4); wall.rotateY(Math.atan2(-nrm[0], -nrm[1])); wall.translate(x, 0, z);
      statics.push(wall);
    }
    box(36.4, 1.1, 0.3, 0x2C7A55, 0, 0.55, 17.1);                  // backstop wall

    // Light towers
    for (const [deg, r] of [[-52, 122], [52, 122], [-26, 146], [26, 146]]) {
      const [x, z] = polar(r, deg * DEG), ry = faceHome(x, z);
      put(statics, new THREE.CylinderGeometry(0.35, 0.6, 36, 8), 0x9AA6B8, x, 18, z);
      const frame = new THREE.BoxGeometry(8.4, 4.6, 0.5);
      world.paint(frame, 0x46546B);
      frame.translate(0, 37, 0); frame.rotateY(ry); frame.translate(x, 0, z);
      statics.push(frame);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const lamp = new THREE.BoxGeometry(1.6, 1.6, 0.2);
        world.paint(lamp, 0xFFF7D6);
        lamp.translate(-2.9 + i * 1.93, 36 + j * 2, 0.32); lamp.rotateY(ry); lamp.translate(x, 0, z);
        glows.push(lamp);
      }
    }

    // Picnic hill: blankets (with fans sitting on them) and a line of trees along the top of the berm
    const bermRows = [];
    {
      const b = builder(), prng = U.rng(ctx.seed + 31);
      const COLORS = [0xFF5A5F, 0xFFC93C, 0x1FA2FF, 0xFFFFFF, 0x8E5BE0, 0xFF8A2B, 0x3BC45B];
      const at = (phi, d) => { const R = wallR(phi), [x, z] = polar(R + d, phi); return [x, outfieldSurface(d) + 0.03, z]; };
      for (let i = 0; i < 52; i++) {
        const phi = prng.range(-43, 43) * DEG, d = prng.range(BERM_FROM + 3, BERM_TO - 5);
        const dp = 0.9 / (wallR(phi) + d), dd = 0.7;
        const col = COLORS[i % COLORS.length];
        b.quad(at(phi - dp, d - dd), at(phi + dp, d - dd), at(phi + dp, d + dd), at(phi - dp, d + dd), col);
        if (prng.chance(0.85)) {
          const [x, y, z] = at(phi, d);
          bermRows.push({ x, y: y - 0.32, z, length: 1.6, facing: faceHome(x, z) });
        }
      }
      statics.push(b.geometry());
      const trees = [];
      for (let i = 0; i < 26; i++) {
        const phi = lerp(-50, 50, (i + prng.next() * 0.6) / 26) * DEG, d = BERM_TO + prng.range(1, 7);
        const t = world.tree(prng.chance(0.7) ? 'round' : 'pine', prng.range(1.6, 2.3), prng);
        const g = t.children[0].geometry.clone();
        t.children[0].geometry.dispose();
        const [x, z] = polar(wallR(phi) + d, phi);
        g.rotateY(prng.next() * TAU);
        g.translate(x, outfieldSurface(BERM_TO) - (d - BERM_TO) * 1.6 + 0.2, z);
        trees.push(g);
      }
      statics.push(world.mergeGeometries(trees));
    }

    // The shadow map only covers the infield, where nothing of the venue stands: it receives, never casts.
    const venue = new THREE.Mesh(world.mergeGeometries(statics), world.mat(0xffffff, { vertexColors: true }));
    venue.receiveShadow = true;
    scene.add(venue);
    scene.add(new THREE.Mesh(world.mergeGeometries(glows), world.mat(0xffffff, { kind: 'basic', vertexColors: true })));

    // Distance markers painted on the wall
    for (const deg of [-44.6, -20, 0, 20, 44.6]) {
      const phi = deg * DEG, [x, z] = polar(wallR(phi) - 1.2, phi);   // billboards: clear of the curving wall
      const s = world.label3d(Math.round(wallR(phi)) + ' m', { color: '#FFFFFF', bg: null, size: 2.1 });
      s.position.set(x, 1.4, z);
      scene.add(s);
    }

    // Crowds. The distant ones (outfield bleachers, line stands, picnic hill) are only a few pixels tall, so
    // they wear a low-poly version of the crowd kit (~250 instead of ~740 triangles a fan). The grandstand
    // behind home is only ever seen in the celebration close-up and is hidden the rest of the time.
    const lowKit = (() => {
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5, ang = t * Math.PI;
        pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(ang) * 0.2 * (1 - 0.15 * t)), (1 - Math.cos(ang)) / 2 * 0.56));
      }
      const hair = new THREE.SphereGeometry(0.205, 9, 4, 0, TAU, 0, 1.35);
      hair.rotateX(-0.35);
      return [new THREE.LatheGeometry(pts, 7), new THREE.SphereGeometry(0.19, 9, 6), hair, new THREE.OctahedronGeometry(0.062, 0)];
    })();
    function lowPoly(handle) {
      const meshes = handle.group.children.filter(o => o.isInstancedMesh);   // body, head, hair, hands
      if (meshes.length === lowKit.length) meshes.forEach((m, i) => { m.geometry = lowKit[i]; });
      return handle;
    }
    // a thinner crowd when the device already runs at the low quality tier (crowds are half the triangles)
    const thin = engine.tier && engine.tier.shadows === false ? 0.65 : 1;
    const crowd = lowPoly(world.crowd(scene, { rows: crowdRows.outfield, spacing: 1.0, density: 0.36 * thin, scale: 1.15, rng: U.rng(ctx.seed + 5) }));
    const lineCrowd = lowPoly(world.crowd(scene, { rows: crowdRows.lines, spacing: 1.1, density: 0.17 * thin, scale: 1.1, rng: U.rng(ctx.seed + 7) }));
    const homeCrowd = world.crowd(scene, { rows: crowdRows.home, spacing: 1.0, density: 0.32, scale: 1.1, rng: U.rng(ctx.seed + 8) });
    homeCrowd.group.visible = false;
    const picnic = lowPoly(world.crowd(scene, { rows: bermRows, spacing: 0.7, density: 0.9 * thin, scale: 1.15, rng: U.rng(ctx.seed + 6) }));
    const crowds = [crowd, lineCrowd, homeCrowd];
    const cheerAll = (k, s) => { for (const c of crowds) c.cheer(k, s); };
    const moodAll = m => { for (const c of crowds) c.setMood(m); };

    // Scoreboard screen (canvas) ------------------------------------------------------------------
    const sbCanvas = document.createElement('canvas');
    sbCanvas.width = 512; sbCanvas.height = 256;
    const sbTex = new THREE.CanvasTexture(sbCanvas);
    sbTex.colorSpace = THREE.SRGBColorSpace;
    sbTex.anisotropy = 4;
    const sbMesh = new THREE.Mesh(new THREE.PlaneGeometry(SB.w, SB.h), new THREE.MeshBasicMaterial({ map: sbTex, fog: false }));
    {
      const [x, z] = polar(SB.r, SB.phi);
      sbMesh.position.set(x, SB.y, z);
      sbMesh.rotation.y = faceHome(x, z);
      sbMesh.translateZ(-0.05);
    }
    scene.add(sbMesh);
    const FONT = "'Fredoka', 'Nunito', 'Arial Rounded MT Bold', sans-serif";

    function drawScoreboard(flash) {
      const g = sbCanvas.getContext('2d'), W = 512, Hh = 256;
      g.fillStyle = '#14203A'; g.fillRect(0, 0, W, Hh);
      g.fillStyle = '#1C2C4E'; for (let y = 6; y < Hh; y += 8) g.fillRect(0, y, W, 3);
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = '#FFC93C';
      g.font = '700 34px ' + FONT;
      g.fillText('SUNNY PARK', W / 2, 32);
      if (flash) {
        g.fillStyle = flash.on ? '#FFE36E' : '#FF6B5B';
        g.font = '700 84px ' + FONT;
        g.fillText('HOME RUN!', W / 2, 122);
        g.fillStyle = '#FFFFFF';
        g.font = '700 48px ' + FONT;
        g.fillText(flash.dist + ' m', W / 2, 202);
      } else {
        const cols = [
          ['HR', String(state.hr)],
          MODE === 'derby' ? ['PITCH', Math.min(DERBY_PITCHES, state.used + 1) + '/' + DERBY_PITCHES] : ['OUTS', String(state.outs)],
          ['LONGEST', state.longest ? state.longest + 'm' : '–'],
        ];
        cols.forEach(([label, value], i) => {
          const cx = W * (i + 0.5) / 3;
          g.fillStyle = '#9FB4D8'; g.font = '700 26px ' + FONT;
          g.fillText(label, cx, 92);
          g.fillStyle = i === 0 ? '#FFE36E' : '#FFFFFF'; g.font = '700 ' + (value.length > 5 ? 44 : 64) + 'px ' + FONT;
          g.fillText(value, cx, 160);
        });
        g.fillStyle = '#9FB4D8'; g.font = '700 22px ' + FONT;
        const ws = breeze.speed, wTxt = Math.abs(ws) < 0.25 ? 'CALM' : Math.abs(ws).toFixed(1) + ' m/s ' + (ws > 0 ? 'OUT' : 'IN');
        g.fillText('PITCHING: ' + String(opp.profile.name).toUpperCase() + '   ·   WIND ' + wTxt, W / 2, 226);
      }
      sbTex.needsUpdate = true;
    }

    // =============================================================================================
    // Characters & equipment
    // =============================================================================================

    const roster = pals.CPU_ROSTER.filter(e => e.profile.id !== opp.profile.id);
    const pickRng = U.rng(ctx.seed + 77);
    const order = roster.map(e => ({ e, k: pickRng.next() })).sort((a, b) => a.k - b.k).map(o => o.e);
    const teamShirt = opp.profile.shirt;
    const asTeam = (p, extra) => pals.sanitize(Object.assign({}, p, { shirt: teamShirt, pants: 4 }, extra || {}));
    const teamColor = (pals.OPTIONS.shirts[teamShirt] != null ? pals.OPTIONS.shirts[teamShirt] : 0x2F5FD8);

    // Equipment geometry (shared by this game's pals; disposed in dispose())
    const capGeo = (() => {
      const dome = new THREE.SphereGeometry(0.262, 18, 9, 0, TAU, 0, Math.PI * 0.5);
      dome.scale(1, 0.84, 1.04);
      world.paint(dome, 0xFFFFFF);
      const brim = new THREE.CylinderGeometry(0.17, 0.17, 0.018, 18, 1, false, -Math.PI / 2, Math.PI);
      brim.scale(1, 1, 0.95);
      world.paint(brim, 0xD8D8D8);
      brim.rotateX(0.12);
      brim.translate(0, 0.01, 0.2);
      return world.mergeGeometries([dome, brim]);
    })();
    const helmetGeo = (() => {
      const dome = new THREE.SphereGeometry(0.285, 20, 10, 0, TAU, 0, Math.PI * 0.56);
      dome.scale(1, 0.92, 1.06);
      world.paint(dome, 0xFFFFFF);
      const brim = new THREE.CylinderGeometry(0.15, 0.15, 0.02, 18, 1, false, -Math.PI / 2, Math.PI);
      world.paint(brim, 0xD0D0D0);
      brim.rotateX(0.18);
      brim.translate(0, -0.005, 0.22);
      const flap = new THREE.SphereGeometry(0.1, 12, 8);
      flap.scale(0.5, 1, 1);
      world.paint(flap, 0xFFFFFF);
      flap.translate(0.255, -0.08, 0.0);
      return world.mergeGeometries([dome, brim, flap]);
    })();

    function wearCap(pal, color, helmet, flapSide) {
      const m = new THREE.Mesh(helmet ? helmetGeo : capGeo, new THREE.MeshPhongMaterial({ color, vertexColors: true, shininess: helmet ? 80 : 30, specular: 0x333333 }));
      m.castShadow = true;
      m.position.set(0, helmet ? 0.05 : 0.07, -0.012);
      m.rotation.x = -0.16;
      if (helmet && flapSide < 0) m.scale.x = -1;
      pal.parts.head.add(m);
      return m;
    }

    // catcher's helmet with a cage mask
    const maskGeo = (() => {
      const parts = [];
      const dome = new THREE.SphereGeometry(0.275, 18, 9, 0, TAU, 0, Math.PI * 0.55);
      dome.scale(1, 0.9, 1.04);
      world.paint(dome, 0xFFFFFF);
      parts.push(dome);
      for (const y of [-0.06, -0.15, -0.24]) {   // horizontal bars, curved round the face
        const bar = new THREE.TorusGeometry(0.235, 0.012, 5, 14, Math.PI * 0.62);
        bar.rotateX(Math.PI / 2); bar.rotateY(-Math.PI * 0.19);   // arc centred on the face (+Z)
        world.paint(bar, 0x2B2F3A);
        bar.translate(0, y, 0.03);
        parts.push(bar);
      }
      for (const x of [-0.07, 0.07]) {
        const bar = new THREE.BoxGeometry(0.018, 0.24, 0.018);
        world.paint(bar, 0x2B2F3A);
        bar.translate(x, -0.15, 0.255);
        parts.push(bar);
      }
      const chin = new THREE.BoxGeometry(0.2, 0.05, 0.05);
      world.paint(chin, 0x2B2F3A);
      chin.translate(0, -0.29, 0.2);
      parts.push(chin);
      return world.mergeGeometries(parts);
    })();
    function wearCatcherGear(pal, color) {
      const m = new THREE.Mesh(maskGeo, new THREE.MeshPhongMaterial({ color, vertexColors: true, shininess: 70, specular: 0x333333 }));
      m.position.set(0, 0.06, -0.01);
      pal.parts.head.add(m);
      return m;
    }

    const batGeo = (() => {
      const pts = [[0, 0], [0.026, 0], [0.028, 0.012], [0.015, 0.024], [0.0135, 0.06], [0.014, 0.3], [0.021, 0.48], [0.032, 0.64], [0.035, 0.8], [0.033, 0.848], [0.022, 0.866], [0, 0.868]]
        .map(([r, y]) => new THREE.Vector2(r * 1.15, y * 1.12));
      const g = new THREE.LatheGeometry(pts, 14);
      world.paint(g, (x, y, z, out) => out.set(y < 0.3 ? 0x3A2C26 : 0xE0A86A));
      return g;
    })();
    const batMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x3a3a3a });
    const ballGeo = new THREE.SphereGeometry(BALL_R, 18, 12);
    const ballTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#F8F6EF'; g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#E2343A'; g.lineWidth = 2.4; g.setLineDash([3, 2.4]);
      for (const ph of [0, Math.PI]) {
        g.beginPath();
        for (let x = 0; x <= 128; x += 2) {
          const y = 32 + Math.sin(x / 128 * TAU * 2 + ph) * 15;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const ballMat = new THREE.MeshPhongMaterial({ map: ballTex, shininess: 40, specular: 0x444444, emissive: 0x2a2a2a });

    function makePal(profile, o) {
      const pal = pals.create(profile, o);
      scene.add(pal.root);
      if (o && o.shadows === false) {
        const blob = world.blobShadow(0.42, 0.3);
        pal.root.add(blob);
      }
      return pal;
    }

    // Batter
    const batter = makePal(me);
    batter.root.position.copy(BATTER_POS);
    batter.setFacing(H * Math.PI / 2);
    wearCap(batter, 0x2E86F0, true, H);
    const bat = new THREE.Mesh(batGeo, batMat);
    bat.castShadow = true;
    batter.root.add(bat);
    const batTip = new THREE.Object3D();
    batTip.position.set(0, 0.9, 0);
    bat.add(batTip);

    // Pitcher
    const pitcher = makePal(asTeam(opp.profile, { shirt: opp.profile.shirt }));
    const PITCHER_POS = new V3(0, MOUND_H, MOUND_Z + 0.42);
    pitcher.root.position.copy(PITCHER_POS);
    pitcher.setFacing(0);
    wearCap(pitcher, teamColor, false);
    const handBall = new THREE.Mesh(ballGeo, ballMat);
    pitcher.attach(handBall, 'R', { position: new V3(0, 0.02, 0.07) });

    // Catcher (with mitt) and umpire
    // short, stocky and set back a little, so he stays under the batting view's sightline to the zone
    const catcher = makePal(asTeam(order[0].profile, { height: 0.04, build: 0.85, hairStyle: 8, glasses: 0 }));
    const CATCHER_POS = new V3(H * 0.06, -0.34, 1.62);
    catcher.root.position.copy(CATCHER_POS);
    catcher.root.scale.setScalar(0.9);
    catcher.setFacing(Math.PI);
    wearCatcherGear(catcher, new THREE.Color(teamColor).multiplyScalar(0.62).getHex());   // team colour, a shade darker
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshPhongMaterial({ color: 0x8A4B2A, shininess: 25 }));
    mitt.scale.set(1, 1.12, 0.6);
    catcher.attach(mitt, 'L', { position: new V3(0, 0.02, 0.05) });

    const umpire = makePal(pals.sanitize(Object.assign({}, order[1].profile, { shirt: 11, pants: 1 })));
    const UMP_POS = new V3(H * 0.62, 0, 2.3);
    umpire.root.position.copy(UMP_POS);
    umpire.setFacing(Math.PI);
    wearCap(umpire, 0x23262E, false);

    // Outfielders and middle infielders (distant: low detail, blob shadows) + the pitcher fields comebackers
    const spots = fielderSpots();
    const fielders = spots.map((s, i) => {
      if (s.id === 'p') return { spot: s, pal: pitcher, home: PITCHER_POS.clone(), pos: PITCHER_POS.clone(), isPitcher: true, face: 0 };
      const pal = makePal(asTeam(order[(2 + i) % order.length].profile), { shadows: false, detail: 'low' });
      wearCap(pal, teamColor, false);
      const home = new V3(s.x, 0, s.z);
      pal.root.position.copy(home);
      const face = faceHome(s.x, s.z);
      pal.setFacing(face);
      pal.play('idle_ready', { speed: 0.6 });
      return { spot: s, pal, home, pos: home.clone(), isPitcher: false, face };
    });
    const fieldPals = fielders.filter(f => !f.isPitcher);
    // Level of detail: a pal is ~16 draw calls, and the fielders are only a few pixels tall from the plate. Faces
    // (5 calls) and feet (2) of far-away pals are hidden until a camera gets close; the catcher faces away.
    const lods = fieldPals.map(f => ({ root: f.pal.root, face: f.pal.root.getObjectByName('face'), feet: ['footL', 'footR'].map(n => f.pal.root.getObjectByName(n)).filter(Boolean) }));
    const catcherFace = catcher.root.getObjectByName('face');
    function updateLod() {
      for (const L of lods) {
        const d = camera.position.distanceTo(L.root.position);
        if (L.face) L.face.visible = d < 26;
        for (const f of L.feet) f.visible = d < 55;
      }
      if (catcherFace) catcherFace.visible = cam.mode !== 'bat';
    }
    const everyone = [batter, pitcher, catcher, umpire].concat(fieldPals.map(f => f.pal));

    // The ball, its shadow, glow and trail
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    ball.visible = false;
    scene.add(ball);
    const ballShadow = world.blobShadow(0.16, 0.4);
    ballShadow.visible = false;
    scene.add(ballShadow);
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,240,0.35)'); gr.addColorStop(1, 'rgba(255,255,240,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.set(0.42, 0.42, 1);
    ball.add(glow);
    const rimGeo = new THREE.SphereGeometry(BALL_R * 1.2, 14, 10);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x1E2A40, side: THREE.BackSide, fog: false });
    ball.add(new THREE.Mesh(rimGeo, rimMat));
    const trail = world.trail(ball, { color: 0xFFFFFF, width: 0.09, length: 18, opacity: 0.5, maxJump: 6 });
    const hitTrail = world.trail(ball, { color: 0xFFFFFF, width: 0.32, length: 36, opacity: 0.55, maxJump: 14 });
    hitTrail.visible = false;
    const batTrail = world.trail(batTip, { color: 0xFFFFFF, width: 0.2, length: 12, opacity: 0.5, maxJump: 2 });
    batTrail.visible = false;
    function startBatTrail() {
      if (bat.parent !== batter.root) return;
      batTrail.visible = true;
      batTrail.mesh.material.uniforms.uOpacity.value = 0.18 + 0.5 * swing.speed;
    }
    const TRAIL_WHITE = new THREE.Color(0xFFFFFF), TRAIL_FIRE = new THREE.Color(0xFF9A2B);
    const _tc = new THREE.Color();
    function setPitchTrailColor(hex) {
      const c = _tc.set(hex).convertLinearToSRGB();
      trail.mesh.material.uniforms.uColor.value.set(c.r, c.g, c.b);
      trail.mesh.material.uniforms.uOpacity.value = hex === 0xFFFFFF ? 0.5 : 0.8;
    }
    function setTrailFire(on) {
      const u = hitTrail.mesh.material.uniforms;
      const c = (on ? TRAIL_FIRE : TRAIL_WHITE).clone().convertLinearToSRGB();
      u.uColor.value.set(c.r, c.g, c.b);
      u.uOpacity.value = on ? 0.85 : 0.55;
    }

    // Strike zone frame + crossing marker (batting view only)
    const zoneGroup = new THREE.Group();
    {
      const w = ZONE.x * 2 + BALL_R * 0.6, h = ZONE.y1 - ZONE.y0 + BALL_R * 0.6, t = 0.022;
      const parts = [];
      for (const [bw, bh, x, y] of [[w, t, 0, ZONE.y0 - BALL_R * 0.3], [w, t, 0, ZONE.y1 + BALL_R * 0.3], [t, h, -w / 2, (ZONE.y0 + ZONE.y1) / 2], [t, h, w / 2, (ZONE.y0 + ZONE.y1) / 2]]) {
        const g = new THREE.PlaneGeometry(bw, bh);
        g.translate(x, y, 0);
        parts.push(g);
      }
      const frame = new THREE.Mesh(world.mergeGeometries(parts), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
      zoneGroup.add(frame);
      zoneGroup.userData.frame = frame;
    }
    zoneGroup.position.set(0, 0, 0.0);
    scene.add(zoneGroup);
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.085, 24), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    marker.renderOrder = 7;
    scene.add(marker);

    // =============================================================================================
    // Poses: batter swing keyframes (right-handed, batter-local: +Z faces the plate, +X toward the
    // pitcher) and the pitcher's delivery. Lefties mirror X, azimuth and twist.
    // =============================================================================================

    const SWING_KEYS = {
      stance: { gx: -0.1, gy: 1.12, gz: 0.14, psi: -145, el: 52, twist: -0.25, crouch: 0.3 },
      load: { gx: -0.17, gy: 1.08, gz: 0.08, psi: -158, el: 46, twist: -0.42, crouch: 0.38 },
      contact: { gx: 0.1, gy: 0.92, gz: 0.36, psi: -2, el: -8, twist: 0.55, crouch: 0.42 },
      follow: { gx: 0.2, gy: 1.22, gz: -0.02, psi: 158, el: 34, twist: 1.05, crouch: 0.28 },
    };
    const followT = speed => lerp(0.32, 0.17, clamp(speed, 0, 1));   // a harder swipe whips through faster
    function mixKeys(a, b, k, out) {
      for (const key of ['gx', 'gy', 'gz', 'psi', 'el', 'twist', 'crouch']) out[key] = lerp(a[key], b[key], k);
      return out;
    }
    const _dir = new V3(), _gL = new V3(), _gR = new V3(), _up = new V3(0, 1, 0), _q = new THREE.Quaternion();
    const batRig = { lambda: 14, quat: new THREE.Quaternion(), init: false };

    /** Applies a batter-local swing pose (grip, bat azimuth/elevation, torso) to the pal and the bat. */
    function applyBatterPose(k, snap) {
      const psi = k.psi * DEG * H, el = k.el * DEG;
      _dir.set(Math.sin(psi) * Math.cos(el), Math.sin(el), Math.cos(psi) * Math.cos(el));
      _gL.set(k.gx * H, k.gy, k.gz);
      _gR.copy(_gL).addScaledVector(_dir, 0.11);
      batter.pose({ handL: _gL, handR: _gR, twist: k.twist * H, crouch: k.crouch, stance: 0.75 }, { lambda: snap ? Infinity : batRig.lambda });
      _q.setFromUnitVectors(_up, _dir);
      if (snap || !batRig.init) batRig.quat.copy(_q);
      else batRig.quat.slerp(_q, 1 - Math.exp(-batRig.lambda * lastDt));
      batRig.init = true;
    }
    function placeBat() {
      if (bat.parent !== batter.root) return;
      const hl = batter.parts.handL.position;
      bat.quaternion.copy(batRig.quat);
      _dir.set(0, 1, 0).applyQuaternion(batRig.quat);
      bat.position.copy(hl).addScaledVector(_dir, -0.07);
    }

    const PITCH_KEYS = [
      { t: 0.0, hl: [0.06, 1.02, 0.26], hr: [-0.06, 1.02, 0.26], twist: 0, lean: 0, crouch: 0.1 },
      { t: 0.34, hl: [0.05, 1.3, 0.12], hr: [-0.03, 1.3, 0.12], twist: -0.35, lean: -0.05, crouch: 0.0 },
      { t: 0.7, hl: [0.36, 1.18, 0.34], hr: [-0.5, 1.42, -0.3], twist: -0.75, lean: -0.1, crouch: 0.22 },
      { t: 0.86, hl: [0.25, 0.95, 0.05], hr: [-0.24, 1.6, 0.5], twist: 0.55, lean: 0.38, crouch: 0.45 },
      { t: 1.0, hl: [0.28, 0.9, -0.1], hr: [0.22, 0.62, 0.42], twist: 0.85, lean: 0.55, crouch: 0.5 },
    ];
    // Readable tells: overrides of PITCH_KEYS by key index (+ a fidget: both hands bobbing at the set).
    const PITCH_TELLS = {
      curve: { 1: { hl: [0.05, 1.5, 0.1], hr: [-0.03, 1.52, 0.1], lean: -0.24 }, 2: { hr: [-0.12, 2.08, -0.36], tilt: 0.26 }, 3: { hr: [-0.06, 2.12, 0.42], tilt: 0.3 } },
      slider: { 2: { hr: [-0.98, 1.0, -0.12], tilt: -0.3 }, 3: { hr: [-0.84, 1.08, 0.42], tilt: -0.38 } },
      change: { fidget: true },
      wobbler: { 1: { hl: [0.04, 1.52, 0.2], hr: [-0.02, 1.54, 0.2] }, fidget: true },
    };
    const KEYS_BY_TYPE = {};
    for (const type of Object.keys(PITCH_TELLS)) KEYS_BY_TYPE[type] = PITCH_KEYS.map((k, i) => Object.assign({ tilt: 0 }, k, PITCH_TELLS[type][i] || {}));
    const RELEASE_AT = 0.86;
    const _pl = new V3(), _pr = new V3();
    function applyPitcherPose(u) {
      const K = KEYS_BY_TYPE[pitch.type] || PITCH_KEYS;
      let i = 0;
      while (i < K.length - 2 && u > K[i + 1].t) i++;
      const a = K[i], b = K[i + 1];
      const k = smooth(0, 1, clamp((u - a.t) / (b.t - a.t), 0, 1));
      _pl.set(lerp(a.hl[0], b.hl[0], k), lerp(a.hl[1], b.hl[1], k), lerp(a.hl[2], b.hl[2], k));
      _pr.set(lerp(a.hr[0], b.hr[0], k), lerp(a.hr[1], b.hr[1], k), lerp(a.hr[2], b.hr[2], k));
      let dip = 0;
      if (PITCH_TELLS[pitch.type] && PITCH_TELLS[pitch.type].fidget && u < 0.4) {
        // the slow-stuff tell: three big glove pumps with a knee bounce (reads even when he is 50 px tall)
        const bob = Math.pow(Math.sin(u / 0.4 * Math.PI * 3), 2) * (1 - smooth(0.3, 0.4, u));
        _pl.y += 0.22 * bob; _pr.y += 0.22 * bob;
        _pl.x += 0.08 * bob; _pr.x -= 0.08 * bob;
        dip = 0.3 * bob;
      }
      pitcher.pose({
        handL: _pl, handR: _pr, twist: lerp(a.twist, b.twist, k), lean: lerp(a.lean, b.lean, k),
        crouch: lerp(a.crouch, b.crouch, k) + dip, tilt: lerp(a.tilt || 0, b.tilt || 0, k),
      }, { lambda: 40 });
    }

    function catcherReady() {
      catcher.play('idle_ready');
      catcher.pose({ crouch: 1, lean: 0.22, handL: new V3(0.08, 0.72, 0.36), handR: new V3(-0.2, 0.5, 0.18), stance: 1 }, { lambda: 10 });
    }
    function umpireReady() {
      umpire.play('idle_ready');
      umpire.pose({ crouch: 0.55, lean: 0.32, handL: new V3(0.18, 0.86, 0.22), handR: new V3(-0.18, 0.86, 0.22), stance: 0.8 }, { lambda: 8 });
    }

    // =============================================================================================
    // Camera rig: batting view (framed per aspect), ball-flight chase, celebration close-up
    // =============================================================================================

    delete camera.userData.fit;
    camera.near = 0.15;
    const cam = {
      mode: 'bat', pos: new V3(), look: new V3(), fov: 50,
      bat: { pos: new V3(), look: new V3(), fov: 50 },
      tPos: new V3(), tLook: new V3(), tFov: 50, lambda: 6,
      hero: null, flight: null,
    };
    function frameBat() {
      const a = engine.size.aspect || 1;
      const t = clamp((a - 0.5) / (1.8 - 0.5), 0, 1);
      // the sightline to the zone passes over the (small, set-back) catcher; in landscape the view tilts down
      // so the zone sits around 75 % of the height, clear of the bottom chip row, with the scoreboard still in
      cam.bat.pos.set(H * lerp(-0.42, -0.55, t), lerp(3.05, 3.0, t), lerp(4.5, 6.2, t));
      cam.bat.look.set(H * lerp(0.05, 0.1, t), lerp(0.4, -0.6, t), -14);
      cam.bat.fov = lerp(60, 40, t);
      const wide = a > 1.15;
      hudTop.classList.toggle('ss-hud-tr', wide);
      hudTop.classList.toggle('ss-hud-top', !wide);
    }
    function cutTo(mode) {
      cam.mode = mode;
      updateCamTargets(0);
      cam.pos.copy(cam.tPos); cam.look.copy(cam.tLook); cam.fov = cam.tFov;
      applyCamera();
    }

    /** Home-run landing shot: ~0.62 R out, off to the centre-field side, framing the wall crossing and the landing. */
    function setupLandingCam() {
      const { fl } = play, W = fl.hrPt, end = fl.standsT >= 0 ? fl.events[fl.events.length - 1] : W;
      const phi = sprayOf(W.x, W.z), R = wallR(phi);
      const side = Math.abs(phi) > 4 * DEG ? -Math.sign(phi) : -H;
      const r0 = 0.62 * R, px = Math.cos(phi), pz = Math.sin(phi);
      // high enough to see over the bleachers onto the picnic hill when it goes that far
      const pos = new V3(r0 * Math.sin(phi) + px * side * 15, clamp(end.y + 3, 5, 13), -r0 * Math.cos(phi) + pz * side * 15);
      const look = new V3(lerp(W.x, end.x, 0.6), Math.max(end.y + 4, 7), lerp(W.z, end.z, 0.6));
      const a = engine.size.aspect || 1;
      const pts = [
        { p: new V3(W.x, W.y + 2, W.z), top: 0.7 }, { p: new V3(end.x, end.y, end.z), top: 0.7 },
        { p: new V3(W.x, 0, W.z), top: 0.8 }, { p: new V3(end.x * 1.12, end.y + 12, end.z * 1.12), top: 0.9 },
      ];
      cam.landing = { pos, look, pts, fov: fitFov(pos, look, pts, a, 34, 72) };
      cutTo('landing');
    }
    const _cv = new V3(), _cw = new V3(), _cl = new V3(), _cb = new V3(), _cr = new V3(), _cu = new V3();
    function angleBetween(a, b) { return Math.acos(clamp(a.dot(b) / Math.max(1e-6, a.length() * b.length()), -1, 1)); }

    /** Vertical FOV (deg) from pos looking at look that keeps every point inside the frame. Each point is
     *  { p, top, side }: the fraction of the half-height / half-width it may use (top 0.64 keeps the ball
     *  below the top 18 % of the screen, clear of the HUD board). */
    function fitFov(pos, look, pts, a, minFov, maxFov) {
      _cv.subVectors(look, pos).normalize();
      _cr.crossVectors(_cv, _up).normalize();
      _cu.crossVectors(_cr, _cv);
      let tv = 0;
      for (const q of pts) {
        _cb.subVectors(q.p, pos);
        const f = Math.max(0.5, _cb.dot(_cv));
        const y = _cb.dot(_cu) / f, x = Math.abs(_cb.dot(_cr)) / f;
        tv = Math.max(tv, (y > 0 ? y / (q.top || 0.8) : -y / 0.85), x / (q.side || 0.85) / a);
      }
      return clamp(2 * Math.atan(tv) / DEG, minFov, maxFov);
    }

    function updateCamTargets(dt) {
      const a = engine.size.aspect || 1;
      if (cam.mode === 'bat') {
        const sway = Math.sin(engine.time * 0.6) * 0.03;
        cam.tPos.copy(cam.bat.pos); cam.tPos.x += sway;
        cam.tLook.copy(cam.bat.look);
        cam.tFov = cam.bat.fov;
        cam.lambda = 5;
      } else if (cam.mode === 'flight' && cam.flight && cam.flight.hr) {
        // Home run chase: follow at a distance and stay low, aiming between the ball and the top of the wall
        // it is about to clear, so ball, wall and stands share the frame (cut to the landing cam before it lands).
        const F = cam.flight, W = F.wall, b = ball.position;
        F.t = play ? play.t : F.t + dt;
        const dist = Math.max(8, Math.hypot(W.x, W.z)), ux = W.x / dist, uz = W.z / dist;
        const along = b.x * ux + b.z * uz;
        const back = clamp(along - 24, -6, dist * 0.3);   // stay well back: the wall and the ball both fit
        F.h = Math.max(F.h || 0, b.y * 0.3 + 2.6);
        const k = 1 - smooth(-6, 10, back);
        cam.tPos.set(ux * back + H * -0.35 * k, Math.min(F.h, 12), uz * back + 5 * k);
        _cl.set(W.x, WALL_H + 1, W.z);
        cam.tLook.copy(b).lerp(_cl, 0.5);
        cam.tFov = fitFov(cam.pos, cam.look, [{ p: b, top: 0.56, side: 0.8 }, { p: _cl, top: 0.8, side: 0.85 }], a, 30, a < 1 ? 82 : 74);
        cam.lambda = 5;
      } else if (cam.mode === 'landing' && cam.landing) {
        // Home run landing: a low shot from the outfield grass, side-on to the ball as it drops into the crowd.
        const Lc = cam.landing;
        cam.tPos.copy(Lc.pos);
        cam.tLook.copy(Lc.look).lerp(ball.position, ball.visible ? 0.25 : 0);
        cam.tFov = Lc.fov;
        cam.lambda = 2.5;
      } else if (cam.mode === 'flight' && cam.flight && cam.flight.foul) {
        // Foul: watch it go from just behind the plate; never chase it out of the ballpark.
        const b = ball.position;
        cam.tPos.copy(cam.bat.pos); cam.tPos.y += 1.2; cam.tPos.z += 1.5;
        _cl.copy(b);
        const r = Math.hypot(_cl.x, _cl.z);
        if (r > 40) { _cl.x *= 40 / r; _cl.z *= 40 / r; }
        _cl.y = Math.min(_cl.y, 14);
        cam.tLook.copy(_cl);
        cam.tFov = fitFov(cam.pos, cam.look, [{ p: b, top: 0.75 }], a, 40, 75);
        cam.lambda = 4;
      } else if (cam.mode === 'flight' && cam.flight) {
        // Chase: ride the line from home toward the landing spot ~20 m behind the ball, rising with it,
        // stopping short of the landing / catch / wall; look ahead of the ball toward where it comes down.
        const F = cam.flight, L = F.land, b = ball.position;
        F.t = play ? play.t : F.t + dt;
        const dist = Math.max(8, Math.hypot(L.x, L.z)), ux = L.x / dist, uz = L.z / dist;
        const along = b.x * ux + b.z * uz;
        const back = clamp(along - 20, -6, dist - (F.hr ? 15 : 26));
        F.h = Math.max(F.h || 0, b.y * 0.5 + 3.2);
        cam.tPos.set(ux * back + H * -0.35 * (1 - smooth(-6, 10, back)), Math.min(F.h, 22), uz * back + 5 * (1 - smooth(-6, 10, back)));
        const w = smooth(0.15, 0.85, F.t / Math.max(0.6, F.dur)) * 0.6;
        cam.tLook.set(lerp(b.x, L.x, w), lerp(b.y, L.y, w), lerp(b.z, L.z, w));
        // field of view: keep both the ball and the landing spot inside the frame
        _cv.subVectors(cam.tLook, cam.pos);
        _cw.subVectors(b, cam.pos);
        _cl.set(L.x, L.y, L.z).sub(cam.pos);
        const need = Math.max(angleBetween(_cv, _cw) * 1.3, angleBetween(_cv, _cl) * 1.15) + 8 * DEG;
        const vHalf = Math.atan(Math.tan(need) / Math.min(1, a));
        cam.tFov = clamp(2 * vHalf / DEG, 30, 66);
        cam.lambda = 3.4;
      } else if (cam.mode === 'hero' && cam.hero) {
        cam.tPos.copy(cam.hero.pos); cam.tLook.copy(cam.hero.look); cam.tFov = cam.hero.fov;
        cam.lambda = 4;
      }
    }

    function applyCamera() {
      const a = engine.size.aspect || 1;
      camera.position.copy(cam.pos);
      camera.lookAt(cam.look);
      if (Math.abs(camera.fov - cam.fov) > 1e-3 || Math.abs(camera.aspect - a) > 1e-4) {
        camera.fov = cam.fov; camera.aspect = a;
        camera.updateProjectionMatrix();
      }
    }

    function updateCamera(dt) {
      updateCamTargets(dt);
      const k = 1 - Math.exp(-cam.lambda * dt);
      cam.pos.lerp(cam.tPos, k);
      cam.look.lerp(cam.tLook, 1 - Math.exp(-(cam.lambda + 3) * dt));
      cam.fov = lerp(cam.fov, cam.tFov, k);
      // never through the wall or into the ground
      const r = Math.hypot(cam.pos.x, cam.pos.z), phi = sprayOf(cam.pos.x, cam.pos.z);
      const lim = (Math.abs(phi) <= FAIR ? wallR(phi) : 100) - 3;
      if (r > lim) { cam.pos.x *= lim / r; cam.pos.z *= lim / r; }
      cam.pos.y = Math.max(cam.pos.y, 0.6);
      applyCamera();
    }

    // =============================================================================================
    // HUD
    // =============================================================================================

    // Timing meter zones (percent of the bar): early … late, matching the contact windows
    const tmPct = e => clamp(50 + e / T_TIP * 50, 2, 98);
    const TM = {
      perfect: [tmPct(-T_PERFECT), tmPct(T_PERFECT)].map(v => v.toFixed(1)),
      good: [tmPct(-T_GOOD), tmPct(T_GOOD)].map(v => v.toFixed(1)),
      fair: [tmPct(-T_FAIR), tmPct(T_FAIR)].map(v => v.toFixed(1)),
    };
    ui.css('bb-hud', [
      '.bb-board{display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 12px 8px;border-radius:18px;color:var(--ink)}',
      '.bb-row{display:flex;align-items:center;gap:10px}',
      '.bb-hr{display:flex;align-items:baseline;gap:4px;font:700 28px/1 var(--font-display);color:var(--accent);transition:transform .2s}',
      '.bb-hr small{font:800 11px/1 var(--font-ui);letter-spacing:.08em;color:var(--ink-soft)}',
      '.bb-hr.bump{animation:bb-bump .5s cubic-bezier(.3,1.6,.5,1)}',
      '.bb-goal{padding:4px 8px 3px;border-radius:999px;background:var(--tint);color:var(--accent);font:800 12px/1 var(--font-ui);white-space:nowrap}',
      '.bb-goal.done{background:#3BC45B;color:#fff}',
      '.bb-pips{display:flex;gap:3px;align-items:center}',
      '.bb-pips i{display:block;width:15px;height:15px;transition:opacity .25s,transform .25s}',
      '.bb-pips i svg{display:block;width:100%;height:100%}',
      '.bb-pips i.used{opacity:.28}',
      '.bb-pips i.hr{opacity:1}',
      '.bb-pips i.hr circle{fill:#FFC93C;stroke:#E39B00}',
      '.bb-pips i.cur{transform:scale(1.22)}',
      '.bb-pips .lbl{font:800 11px/1 var(--font-ui);letter-spacing:.08em;color:var(--ink-soft);margin-right:3px}',
      '.bb-pips b{display:block;width:15px;height:15px;border-radius:50%;box-shadow:inset 0 0 0 2px #C9D3DE;background:#fff;position:relative}',
      '.bb-pips b.on{background:#FF5A5F;box-shadow:inset 0 0 0 2px #D8363B}',
      '.bb-pips b.on::after{content:"";position:absolute;inset:3px;background:linear-gradient(45deg,transparent 42%,#fff 42% 58%,transparent 58%),linear-gradient(-45deg,transparent 42%,#fff 42% 58%,transparent 58%)}',
      '.bb-dist{display:flex;gap:10px;font:800 12px/1 var(--font-ui);color:var(--ink-soft);white-space:nowrap}',
      '.bb-dist b{color:var(--ink)}',
      '.bb-wind i{display:inline-block;font-style:normal;color:var(--accent);margin-right:2px;transition:transform .4s}',
      '.bb-top{transition:opacity .35s}',
      '.bb-top.dim{opacity:.45}',
      '.bb-tap{font:800 12px/1 var(--font-ui);letter-spacing:.03em}',
      '.bb-bottom{gap:6px;flex-wrap:wrap;justify-content:center;width:max-content;max-width:calc(100vw - 24px)}',
      '.bb-tm{gap:7px;font:800 11px/1 var(--font-ui);letter-spacing:.04em;text-transform:uppercase}',
      '.bb-tm i{position:relative;display:block;width:104px;height:8px;border-radius:4px;background:linear-gradient(90deg,#FF5A5F 0 ' + TM.fair[0] + '%,#FFB020 ' + TM.fair[0] + '% ' + TM.good[0] + '%,#9BD64B ' + TM.good[0] + '% ' + TM.perfect[0] + '%,#2FBF55 ' + TM.perfect[0] + '% ' + TM.perfect[1] + '%,#9BD64B ' + TM.perfect[1] + '% ' + TM.good[1] + '%,#FFB020 ' + TM.good[1] + '% ' + TM.fair[1] + '%,#FF5A5F ' + TM.fair[1] + '%)}',
      '.bb-tm i b{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 0 0 2.5px #24324A,0 2px 4px rgba(0,0,0,.3);transition:left .25s cubic-bezier(.3,1.5,.5,1)}',
      '.bb-pw{display:flex;align-items:center;gap:5px;font-style:normal;margin-left:2px;padding-left:9px;border-left:1.5px solid rgba(36,50,74,.14)}',
      '.bb-pw s{position:relative;display:block;width:46px;height:8px;border-radius:4px;background:#DDE3EC;overflow:hidden;text-decoration:none}',
      '.bb-pw u{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:4px;background:#2FBF55;transition:width .3s cubic-bezier(.3,1.3,.5,1),background-color .3s}',
      '.bb-pw u.mid{background:#FFB020}',
      '.bb-pw u.low{background:#FF5A5F}',
      '@media (max-width:359px){.bb-tm{gap:5px}.bb-tm i{width:74px}.bb-pw s{width:38px}}',
      '.bb-fire{background:linear-gradient(180deg,#FFB020,#FF5A1F)!important;color:#fff!important;text-shadow:0 1px 0 rgba(150,40,0,.4)}',
      // narrow phones: the distance / wind stats wrap under each other so the board stays clear of the pause button
      '@media (max-width:409px){.bb-board{padding:6px 9px 7px;gap:4px}.bb-dist{flex-wrap:wrap;justify-content:center;gap:3px 9px;font-size:11px}}',
      '@media (max-width:359px){.bb-pips{gap:2px}.bb-pips i,.bb-pips b{width:13px;height:13px}.bb-hr{font-size:24px}}',
      '@keyframes bb-bump{0%{transform:scale(1)}40%{transform:scale(1.45)}100%{transform:scale(1)}}',
    ].join('\n'));

    const PIP_SVG = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="#fff" stroke="#C9D3DE" stroke-width="1.4"/>' +
      '<path d="M5.4 4.4c2.5 2.9 2.5 8.3 0 11.2M14.6 4.4c-2.5 2.9-2.5 8.3 0 11.2" stroke="#E8343A" stroke-width="1.3" fill="none" stroke-dasharray="1.6 1.3"/></svg>';
    const hudTop = ui.el('div', 'ss-hud-top bb-top');
    const board = ui.el('div', 'bb-board ss-panel ss-pop');
    board.innerHTML = '<div class="bb-row"><div class="bb-hr"><b>0</b><small>HR</small></div><div class="bb-goal">Goal ' + GOAL + '</div></div>' +
      '<div class="bb-pips"></div><div class="bb-dist"><span>Last <b class="bb-last">–</b></span><span>Best <b class="bb-best">–</b></span><span class="bb-wind">Wind <i>↑</i><b>–</b></span></div>';
    hudTop.appendChild(board);
    const hudBottom = ui.el('div', 'ss-hud-bottom bb-bottom');
    const pitchChip = ui.el('div', 'ss-chip dark ss-hidden');
    const fireChip = ui.el('div', 'ss-chip bb-fire ss-hidden');
    const noteChip = ui.el('div', 'ss-chip ss-hidden');
    const timingChip = ui.el('div', 'ss-chip bb-tm ss-hidden', '<span>Early</span><i><b></b></i><span>Late</span><em class="bb-pw"><span>Power</span><s><u></u></s></em>');
    const tapChip = ui.el('div', 'ss-chip dark bb-tap ss-hidden', 'Tap to skip ▸');
    hudBottom.append(noteChip, timingChip, pitchChip, fireChip, tapChip);
    ctx.hud.append(hudTop, hudBottom);
    const hudEls = {
      hr: board.querySelector('.bb-hr'), hrNum: board.querySelector('.bb-hr b'), goal: board.querySelector('.bb-goal'),
      pips: board.querySelector('.bb-pips'), last: board.querySelector('.bb-last'), best: board.querySelector('.bb-best'),
      windArrow: board.querySelector('.bb-wind i'), wind: board.querySelector('.bb-wind b'),
    };
    if (MODE === 'derby') {
      for (let i = 0; i < DERBY_PITCHES; i++) hudEls.pips.appendChild(ui.el('i', '', PIP_SVG));
    } else {
      hudEls.pips.appendChild(ui.el('span', 'lbl', 'OUTS'));
      for (let i = 0; i < 3; i++) hudEls.pips.appendChild(ui.el('b', ''));
    }

    function renderHud(bump) {
      hudEls.hrNum.textContent = String(state.hr);
      hudEls.goal.classList.toggle('done', state.hr >= GOAL);
      hudEls.goal.textContent = state.hr >= GOAL ? 'Goal ✓' : 'Goal ' + GOAL;
      if (bump) { hudEls.hr.classList.remove('bump'); void hudEls.hr.offsetWidth; hudEls.hr.classList.add('bump'); }
      if (MODE === 'derby') {
        const pips = hudEls.pips.children;
        for (let i = 0; i < pips.length; i++) {
          const r = state.log[i];
          pips[i].className = r ? (r === 'hr' ? 'hr' : 'used') : (i === state.used && state.phase !== 'done' ? 'cur' : '');
        }
      } else {
        const outs = hudEls.pips.querySelectorAll('b');
        outs.forEach((b, i) => b.classList.toggle('on', i < state.outs));
      }
      hudEls.last.textContent = state.lastDist ? state.lastDist + ' m' : '–';
      hudEls.best.textContent = state.longest ? state.longest + ' m' : '–';
      const ws = breeze.speed;
      hudEls.wind.textContent = Math.abs(ws) < 0.25 ? 'calm' : Math.abs(ws).toFixed(1) + ' m/s';
      hudEls.windArrow.style.visibility = Math.abs(ws) < 0.25 ? 'hidden' : '';
      // up = blowing out to centre (as seen from the plate), turned toward the field it blows to
      hudEls.windArrow.style.transform = 'rotate(' + ((breeze.dir + (ws < 0 ? Math.PI : 0)) / DEG).toFixed(0) + 'deg)';
      const fire = state.streak >= 3 ? 'ON FIRE ×' + state.streak : '';
      if (fire && fireChip.textContent !== fire) chip(fireChip, fire);
      else if (!fire) fireChip.classList.add('ss-hidden');
      drawScoreboard(null);
    }

    /** After every swing: where it landed between early and late, and how hard it was. */
    function showTiming(err, speed) {
      const dot = timingChip.querySelector('b');
      dot.style.transition = 'none';
      dot.style.left = '50%';
      timingChip.classList.remove('ss-hidden', 'ss-pop');
      void timingChip.offsetWidth;
      timingChip.classList.add('ss-pop');
      dot.style.transition = '';
      dot.style.left = tmPct(err) + '%';
      showPower(speed);
    }
    function showPower(speed) {
      const bar = timingChip.querySelector('.bb-pw u');
      bar.style.width = Math.round(8 + 92 * clamp(speed, 0, 1)) + '%';
      bar.className = speed < POWER_LOW ? 'low' : speed < POWER_OK ? 'mid' : '';
    }

    let noteTimer = 0;
    /** Short message in the bottom chip row (toasts would sit on top of the scoreboard). */
    function note(text, seconds) {
      chip(noteChip, text);
      noteTimer = seconds || 2.4;
    }
    function updateNote(dt) {
      if (noteTimer > 0) { noteTimer -= dt; if (noteTimer <= 0) noteChip.classList.add('ss-hidden'); }
    }

    function chip(el, text) {
      el.innerHTML = text;
      el.classList.remove('ss-hidden', 'ss-pop');
      void el.offsetWidth;
      el.classList.add('ss-pop');
    }

    const _pp = new V3();
    function popupAtBatter(text, color) {
      _pp.set(BATTER_POS.x + H * 0.2, 1.75, BATTER_POS.z);
      const s = engine.project(_pp, camera);
      if (!s.visible) return;
      ui.scorePopup(text, clamp(s.x, 70, engine.size.w - 70), s.y, { color });
    }

    let hint = null;
    function showSwingHint() {
      hideHint();
      const { w, h } = engine.size;
      if (h <= 520) { hint = ui.hint({ gesture: 'swipe-across', text: 'Swipe as the ball gets close!' }); return; }
      // beside the batter, on the open side of the plate; kept far enough from the edge for the text to fit
      // (a lefty's open side is the left: lower and narrower there, clear of the pitcher on the mound)
      hint = ui.hint({ gesture: 'swipe-across', text: 'Swipe as the ball gets close!', x: H > 0 ? clamp(w * 0.76, 100, w - 100) : clamp(w * 0.2, 90, w - 100), y: h * (H > 0 ? 0.4 : 0.47) });
      const tx = hint.el.querySelector('.ss-hint-text');
      if (tx) tx.style.maxWidth = H > 0 ? '190px' : '160px';
    }
    function hideHint() { if (hint) { hint.hide(); hint = null; } }

    // =============================================================================================
    // Game state
    // =============================================================================================

    const state = {
      phase: 'intro', pitchNo: 0, used: 0, hr: 0, outs: 0, streak: 0, bestStreak: 0,
      longest: 0, lastDist: 0, totalHrDist: 0, swings: 0, hits: 0, perfect: 0, log: [], lastResult: null,
      pitchTypes: [], recordToast: false, readyDelay: 0,
    };
    let pitch = null, pitchT = 0, swing = null, play = null, called = false, batterPosed = true;
    const wind = { active: false, t: 0, dur: 1, released: false };
    let forced = null, planned = null, autoplay = false, lastDt = 1 / 60, frameMs = 0;
    // The breeze (dir 0 = blowing out to centre): a steady wind for the game plus small gusts each pitch.
    const breezeBase = { speed: rng.range(-1, 1.6), dir: rng.range(-0.6, 0.6) };
    const breeze = { speed: breezeBase.speed, dir: breezeBase.dir };
    function gust() {
      breeze.speed = clamp(breezeBase.speed + gauss(rng) * 0.35, -1.5, 2);
      breeze.dir = breezeBase.dir + gauss(rng) * 0.12;
    }
    let flow = 0, skipFn = null, waitWarned = false;
    let ambience = null;

    function nextFlow() { flow += 1; skipFn = null; return flow; }
    function later(id, s, fn) { ctx.wait(s).then(() => { if (id === flow) fn(); }); }
    /** Waits s seconds (tap / Space skips) then runs fn once. */
    function hold(id, s, fn) {
      skipFn = () => { if (id !== flow) return; nextFlow(); fn(); };
      later(id, s, () => { skipFn = null; fn(); });
    }

    /** The CPU pitcher's plan: don't groove the same pitch three times; after a homer, pitch around the batter. */
    function pitcherMood() {
      const t = state.pitchTypes, n = t.length;
      return { avoid: n >= 2 && t[n - 1] === t[n - 2] ? t[n - 1] : null, wary: state.lastResult === 'HOME RUN!' };
    }

    function effectiveSkill() {
      return MODE === 'sudden' ? Math.min(1, SKILL + 0.05 * Math.floor(state.hr / 3)) : SKILL;
    }

    // =============================================================================================
    // Pitch flow: ready → windup → pitch → (swing) → call / ball in play → result → next
    // =============================================================================================

    function resetForPitch() {
      ball.visible = false; ballShadow.visible = false;
      trail.visible = true; trail.clear();
      hitTrail.visible = false;
      batTrail.visible = false;
      setTrailFire(state.streak >= 3);
      marker.material.opacity = 0;
      handBall.visible = true;
      swing = null; play = null; called = false;
      if (bat.parent !== batter.root) { batter.root.add(bat); }
      bat.userData.fly = null;
      batterPosed = true;
      batter.releasePose(0);
      batter.play('idle_ready', { speed: 0.5 });
      batter.setExpression('focus');
      applyBatterPose(SWING_KEYS.stance, true);
      pitcher.releasePose(0);
      pitcher.play('idle');
      pitcher.root.position.copy(PITCHER_POS);
      pitcher.setFacing(0);
      catcher.root.position.copy(CATCHER_POS); catcher.setFacing(Math.PI);
      catcherReady();
      umpireReady();
      for (const f of fielders) {
        f.pos.copy(f.home); f.state = 'idle'; f.target = null;
        if (f.isPitcher) continue;
        f.pal.root.position.copy(f.home); f.pal.setFacing(f.face);
        f.pal.play('idle_ready', { speed: 0.6 });
      }
      wind.active = false;
      for (const p of everyone) p.lookAt(null);
      moodAll('idle');
    }

    const _look = new V3();
    function nextPitch() {
      const id = nextFlow();
      state.phase = 'ready';
      state.pitchNo += 1;
      resetForPitch();
      cutTo('bat');
      pitchChip.classList.add('ss-hidden');
      timingChip.classList.add('ss-hidden');
      tapChip.classList.add('ss-hidden');
      const first = state.pitchNo === 1 && !forced;
      const type = forced && forced.type ? forced.type : first ? 'fastball' : null;
      const loc = forced && forced.loc ? forced.loc : first ? 'strike' : null;
      forced = null;
      pitch = makePitch(effectiveSkill(), rng, { type, loc, mood: pitcherMood(), easy: first });
      state.pitchTypes.push(pitch.type);
      wind.dur = 1.05 * (pitch.def.slowArm || 1);
      waitWarned = false;
      gust();
      renderHud();
      batter.lookAt(_look.set(PITCHER_POS.x, 1.6, PITCHER_POS.z));
      pitcher.lookAt(_look.set(0, 0.9, 0.6));
      if (state.lastResult === 'HOME RUN!') {
        // the pitcher stews over it while the scoreboard is still blinking
        pitcher.play(rng.chance(0.5) ? 'sad' : 'shrug');
        scoreboardFlash(state.lastDist, 1.2);
      }
      if (!autoplay && state.swings === 0) showSwingHint();   // stays up until the first swing
      else hideHint();
      // after a skip the result banner may still be up: it clears before the wind-up starts
      state.readyDelay = state.pitchNo === 1 ? 1.6 : Math.max(0.85, Math.min(bannerLeft() + 0.25, 1.7));
      later(id, state.readyDelay, () => {
        state.phase = 'windup';
        Object.assign(wind, { active: true, t: 0, released: false });
        moodAll('tense');
        noteTimer = 0; noteChip.classList.add('ss-hidden');   // nothing in front of the plate during the pitch
      });
    }

    function releasePitch() {
      state.phase = 'pitch';
      pitchT = 0;
      handBall.visible = false;
      ball.visible = true; ballShadow.visible = true;
      pitchPos(pitch, 0, ball.position);
      trail.clear();
      setPitchTrailColor(SKILL < 0.4 ? FAMILY_COLOR[pitch.def.family] : 0xFFFFFF);
      audio.sfx('pitch_whoosh', { intensity: clamp(pitch.vPlate / 32, 0.4, 1), vol: 0.8 });
      if (!planned && autoplay) planned = autoPlan();
    }

    const _bp = new V3();
    /** Delivery: keyframed pose; the ball leaves the hand at RELEASE_AT, then a follow-through. */
    function updatePitcher(dt) {
      if (!wind.active) return;
      wind.t += dt;
      const u = clamp(wind.t / wind.dur, 0, 1);
      applyPitcherPose(u);
      if (!wind.released && u >= RELEASE_AT) { wind.released = true; releasePitch(); }
      if (u >= 1) {
        wind.active = false;
        pitcher.releasePose(0.45);
        pitcher.play('idle_ready', { speed: 0.5 });
      }
    }

    // Swing ----------------------------------------------------------------------------------------

    /** tNow: pitch clock at the swipe; angle: swipe elevation (deg); speed 0..1. */
    function doSwing(tNow, angle, speed, src) {
      if (state.phase === 'ready' || state.phase === 'windup') {
        if (!waitWarned && src === 'input') { waitWarned = true; popupAtBatter('Wait for the pitch!', '#FFFFFF'); }
        return false;
      }
      if (swing || !pitch) return false;
      const lateCall = state.phase === 'call' && !pitch.decided;   // the ball is already in the mitt
      if (state.phase !== 'pitch' && !lateCall) return false;
      const err = Math.max(tNow + LEAD - pitch.tc, lateCall ? T_TIP * pitch.ease + 0.01 : -Infinity);
      const res = lateCall ? { kind: 'whiff', why: 'late', timing: 'way-late', err } : contactModel(pitch, { err, angle, speed }, H, rng);
      // bat elevation at contact follows the pitch height (so the bat meets the ball on screen)
      const elC = clamp(Math.asin(clamp((pitch.cy - SWING_KEYS.contact.gy) / 0.62, -1, 1)) / DEG, -42, 18);
      // contact when the bat arrives (a late bat meets the ball deeper in the zone)
      swing = { t0: tNow, tau: pitchT - tNow, err, angle, speed, res, contactT: Math.max(pitch.tc, tNow + LEAD * 0.7), done: false, elC, src };
      state.swings += 1;
      showTiming(err / pitch.ease, speed);   // the meter shows timing as the contact model judged it
      hideHint();
      audio.sfx(speed > 0.55 ? 'swing_heavy' : 'swing_light', { intensity: 0.3 + speed * 0.7, rate: 0.9 + speed * 0.2 });
      audio.sfx('voice_hup', { vol: 0.4 + speed * 0.4 });
      startBatTrail();
      if (lateCall) whiffReaction();
      return true;
    }

    const _sk = { gx: 0, gy: 0, gz: 0, psi: 0, el: 0, twist: 0, crouch: 0 };
    function updateBatterPose(dt) {
      if (!batterPosed) return;
      if (state.phase === 'ready' || state.phase === 'windup') {
        const loadK = state.phase === 'windup' ? smooth(0.45, 0.85, wind.t / wind.dur) : 0;
        mixKeys(SWING_KEYS.stance, SWING_KEYS.load, loadK, _sk);
        _sk.gy += Math.sin(engine.time * 2.4) * 0.012 * (1 - loadK);
        batRig.lambda = 12;
        applyBatterPose(_sk, false);
        return;
      }
      if (swing) {
        swing.tau += dt;
        const tau = swing.tau;
        const contact = Object.assign({}, SWING_KEYS.contact, { el: swing.elC });
        const ft = followT(swing.speed);
        if (tau < LEAD) mixKeys(SWING_KEYS.load, contact, easeIn(clamp(tau / LEAD, 0, 1)), _sk);
        else mixKeys(contact, SWING_KEYS.follow, easeOut(clamp((tau - LEAD) / ft, 0, 1)), _sk);
        applyBatterPose(_sk, true);
        if (batTrail.visible) {
          batTrail.mesh.material.uniforms.uOpacity.value = (0.18 + 0.5 * swing.speed) * (1 - smooth(LEAD + ft * 0.6, LEAD + ft + 0.08, tau));
          if (tau > LEAD + ft + 0.1) batTrail.visible = false;
        }
        return;
      }
      if (state.phase === 'pitch' || state.phase === 'call') {
        batRig.lambda = 14;
        applyBatterPose(SWING_KEYS.load, false);
      }
    }

    // Pitch in flight --------------------------------------------------------------------------------

    const _gl = new V3();
    function updatePitch(dt) {
      pitchT += dt;
      if (!swing && planned && !planned.take) {
        // doSwing back-dates the swing to its planned moment, so a long frame can't skip it
        const ts = pitch.tc - LEAD + planned.err;
        if (pitchT >= ts) {
          const p = planned;
          planned = null;
          if (doSwing(ts, p.angle, p.speed, 'auto') && p.raw) swing.raw = p.raw;
        }
      }
      if (!swing && planned && pitchT > pitch.tc + T_TIP * pitch.ease) planned = null;   // switched on too late for this one
      if (swing && swing.res.kind !== 'whiff' && !swing.done && pitchT >= swing.contactT) {
        swing.done = true;
        startContact(pitchT - swing.contactT);
        return;
      }
      const s = Math.min(pitchT, pitch.tm) / pitch.T;   // after reaching the mitt the ball stays in it
      pitchPos(pitch, s, ball.position);
      ball.rotation.x -= pitch.spin * dt;
      // catcher's glove drifts to where the pitch is heading
      _gl.set(pitch.cx, pitch.cy, MITT_Z);
      catcher.root.worldToLocal(_gl);
      _gl.y = Math.max(0.35, _gl.y);
      catcher.pose({ handL: _gl }, { lambda: 7 });
      batter.lookAt(ball.position);
      catcher.lookAt(ball.position);
      umpire.lookAt(ball.position);
      if (!pitch.crossed && s >= 1) { pitch.crossed = true; showPitchChip(); }
      if (!pitch.popped && pitchT >= pitch.tm) {
        pitch.popped = true;
        audio.sfx('mitt_pop', { intensity: clamp(pitch.vPlate / 32, 0.5, 1) });
      }
      // the call waits until even a late swipe could no longer get the bat there (err > T_TIP)
      const pending = swing && swing.res.kind !== 'whiff' && !swing.done;
      if (!pending && pitchT >= Math.max(pitch.tm, pitch.tc - LEAD + T_TIP * pitch.ease)) ballInMitt();
    }

    function showPitchChip() {
      if (pitch.chipShown) return;
      pitch.chipShown = true;
      const tint = SKILL < 0.4 && pitch.def.family !== 'fast' ? ' style="color:#' + FAMILY_COLOR[pitch.def.family].toString(16).padStart(6, '0') + '"' : '';
      chip(pitchChip, '<b' + tint + '>' + pitch.name + '</b>&nbsp;·&nbsp;' + pitch.kmh + ' km/h');
    }

    /** Swing-and-miss reactions (also for a swipe that comes in after the ball is already in the mitt). */
    function whiffReaction() {
      const why = swing.res.why;
      popupAtBatter(why === 'reach' ? 'Out of reach!' : why === 'early' ? 'Too early!' : 'Too late!', '#FFFFFF');
      batter.setExpression('wince', 1.2);
      pitcher.setExpression('proud', 1.6);
    }

    function ballInMitt() {
      if (called) return;
      called = true;
      state.phase = 'call';
      pitchPos(pitch, pitch.tm / pitch.T, ball.position);
      catcher.handWorld('L', ball.position);
      if (!pitch.popped) { pitch.popped = true; audio.sfx('mitt_pop', { intensity: clamp(pitch.vPlate / 32, 0.5, 1) }); }
      moodAll('idle');
      planned = null;
      showPitchChip();
      const id = nextFlow();
      if (swing) whiffReaction();
      showMarker(pitch.strike);
      later(id, swing ? 0.3 : 0.35, () => {
        pitch.decided = true;
        if (swing) {
          audio.sfx('ump_strike');
          umpPunch();
          applyResult({ kind: 'strike', label: 'STRIKE!', sub: 'Swing and a miss', dist: 0, swung: true });
        } else if (pitch.strike) {
          audio.sfx('ump_strike');
          umpPunch();
          batter.setExpression('sad', 1.2);
          applyResult({ kind: 'strike', label: 'STRIKE!', sub: 'Called strike', dist: 0, swung: false });
        } else {
          batter.setExpression('happy', 1.2);
          applyResult({ kind: 'ball', label: 'BALL', sub: MODE === 'derby' ? 'Good eye! Doesn\'t count' : 'Good eye!', dist: 0, swung: false });
        }
      });
    }

    function showMarker(strike) {
      marker.position.set(pitch.cx, pitch.cy, 0.02);
      marker.material.color.set(strike ? 0x3BC45B : 0xB8C2D0);
      marker.material.opacity = 0.95;
      marker.userData.t = 0;
    }

    function umpPunch() {
      umpire.pose({ handR: new V3(-0.42, 1.5, 0.12), crouch: 0.15, lean: 0.05 }, { lambda: 16 });
      ctx.wait(0.7).then(() => { if (state.phase !== 'ready') umpireReady(); });
    }

    // =============================================================================================
    // Ball in play
    // =============================================================================================

    function startContact(over) {
      // bat speed and swing plane are final now: the swipe kept refining them until contact
      const res = swing.res = contactModel(pitch, { err: swing.err, angle: swing.angle, speed: swing.speed }, H, rng);
      showPower(swing.speed);
      if (swing.raw && res.kind === 'hit') Object.assign(res, swing.raw);   // debug: exact batted ball
      state.phase = 'play';
      showPitchChip();
      pitchPos(pitch, Math.min(swing.contactT, pitch.tm) / pitch.T, _bp);
      const v = launchVelocity(res.ev, res.launch, res.spray);
      const fl = simFlight(_bp.x, _bp.y, _bp.z, v.x, v.y, v.z, res.kind === 'tip' ? 2.5 : 11, airFor(res, breeze));
      const fair = res.kind === 'hit' && Math.abs(res.spray) <= 45;
      const cat = fair ? findCatch(fl, spots) : null;
      const out = classify(res, fl, cat);
      play = { res, fl, cat, out, t: Math.max(0, over), ev: 0, resolved: false, endT: 0, attached: null, sparkT: 0 };
      trail.visible = false;
      hitTrail.visible = true;
      planned = null;
      // contact feedback
      const q = res.q || 0;
      if (res.kind === 'tip') {
        audio.sfx('bat_foul');
      } else {
        audio.sfx('bat_crack', { intensity: clamp(0.25 + q * 0.75 * clamp(res.ev / 50, 0, 1), 0.2, 1) });
        engine.shake(0.03 + 0.09 * q * clamp(res.ev / 50, 0, 1), 0.28);
        ui.haptic(res.timing === 'perfect' ? 30 : 15);
        world.burst(scene, _bp, { count: 10 + Math.round(q * 16), color: 0xFFFFFF, speed: 2.4, size: 0.04, life: 0.35 });
      }
      const tl = res.timing;
      const label = res.kind === 'tip' ? 'Just a tick!' : res.sweet ? 'SWEET SPOT!' : tl === 'perfect' ? 'PERFECT!' : tl === 'good' ? 'Nice timing' : tl === 'early' ? 'A bit early' : 'A bit late';
      popupAtBatter(label, tl === 'perfect' ? '#FFE36E' : '#FFFFFF');
      if (tl === 'perfect' && res.kind === 'hit') state.perfect += 1;
      // camera & slow motion
      planFielders();
      setEndTimes();
      if (res.kind !== 'tip') {
        cam.flight = { t: 0, land: flightFocus(), dur: play.resolveT, hr: out.kind === 'hr', foul: out.kind === 'foul', wall: fl.hrPt };
        cam.mode = 'flight';
      }
      if (out.kind === 'hr' && fl.proj >= BIG.slowmo) {
        engine.slowmo(0.28, 1.1, { ease: 'inQuad' });
        audio.duck(0.4, 2.5);
      } else if (q > 0.85 && res.kind === 'hit') {
        engine.slowmo(0.2, 0.25);
      }
      batter.lookAt(ball.position);
      moodAll('tense');
      const id = nextFlow();
      skipFn = () => { if (id !== flow) return; skipPlay(); };
      if (res.kind !== 'tip') ctx.wait(0.8).then(() => { if (state.phase === 'play' && skipFn && !autoplay) chip(tapChip, 'Tap to skip ▸'); });
    }

    const _ff = new V3();
    /** Point the flight camera frames: the catch, the home run's landing, or where a hit ends up. */
    function flightFocus() {
      const { fl, cat } = play;
      if (cat) return { x: cat.x, y: Math.max(1, cat.y), z: cat.z };
      if (fl.hr) {
        const end = fl.standsT >= 0 ? fl.events[fl.events.length - 1] : fl.hrPt;
        return { x: end.x, y: Math.max(3, end.y), z: end.z };
      }
      // hits & fouls: where the ball ends up (about when the play ends, or where a foul leaves the field)
      samplePath(fl, play.exitT >= 0 ? play.exitT : Math.min(play.endT, fl.endT), _ff);
      return { x: _ff.x, y: Math.max(0.5, _ff.y), z: _ff.z };
    }

    /** First time the ball (sampled path) satisfies test(x, y, z, r, phi), or −1. */
    function pathTime(fl, test) {
      const pts = fl.pts;
      for (let k = 0; k < pts.length / 3; k++) {
        const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
        if (test(x, y, z, Math.hypot(x, z), sprayOf(x, z))) return k / SAMPLE_HZ;
      }
      return -1;
    }

    function setEndTimes() {
      const { fl, cat, out, res } = play;
      let resolveT, endT;
      play.exitT = -1;
      play.cutT = -1;
      if (out.kind === 'foul') {
        // a foul is over once it leaves the field: into/over the line stands or back over the screen
        play.exitT = res.kind === 'tip' ? -1 : pathTime(fl, (x, y, z, r, phi) => (Math.abs(phi) > FAIR && r * Math.sin(Math.abs(phi) - FAIR) > 15) || z > 15);
        const exit = play.exitT >= 0 ? play.exitT : 99;
        resolveT = res.kind === 'tip' ? 0.35 : Math.min(fl.landT >= 0 ? fl.landT : 1.4, 1.4, exit);
        endT = res.kind === 'tip' ? 1.2 : Math.min(resolveT + 0.8, exit + 0.5, 2.2);
      } else if (cat) {
        resolveT = cat.t; endT = cat.t + 1.2;
      } else if (out.kind === 'hr') {
        resolveT = fl.hrT;
        endT = Math.min(fl.standsT >= 0 ? fl.standsT + 0.5 : fl.hrT + 1.6, fl.hrT + 2.0);
        play.cutT = Math.max(fl.hrT - 0.55, Math.min(fl.apexT, fl.hrT - 0.2));   // cut to the landing cam
      } else if (res.launch < 12 && (fl.land ? fl.land.r : fl.maxR) < 34) {
        // grounder: called once it gets through the infield (or when it's fielded / stops)
        const through = pathTime(fl, (x, y, z, r) => r >= 40);
        resolveT = through >= 0 ? through : Math.min(fl.stopT >= 0 ? fl.stopT : 1.6, 1.6);
        endT = Math.min(resolveT + 2.0, Math.max(resolveT + 1.2, fl.stopT >= 0 ? fl.stopT + 0.4 : resolveT + 2.0));
      } else {
        resolveT = fl.wallT >= 0 && (fl.landT < 0 || fl.wallT < fl.landT) ? fl.wallT : fl.landT >= 0 ? fl.landT : 1.5;
        endT = Math.min(6.0, resolveT + 2.6, Math.max(resolveT + 1.6, fl.stopT >= 0 ? fl.stopT + 0.5 : resolveT + 2.4));
      }
      play.resolveT = resolveT;
      play.endT = endT;
    }

    /** Ball-in-play playback speed: once the ball is well on its way, the long hang of a fly ball runs at up
     *  to 2× until just before the moment that matters (the cut to the landing shot, the catch, the landing);
     *  a homer's drop into the crowd runs at 1.35×, and a hit that is still rolling at 1.7×. */
    function playRate(p) {
      if (p.res.kind === 'tip' || p.out.kind === 'foul') return 1;
      const from = Math.max(0.8, Math.min(p.fl.apexT || 1.2, 1.2));
      const key = p.out.kind === 'hr' ? p.cutT : p.resolveT;
      let r = 1 + 1.0 * smooth(from, from + 0.3, p.t) * (1 - smooth(key - 0.55, key - 0.25, p.t));
      if (p.out.kind === 'hr') r = Math.max(r, 1 + 0.35 * smooth(p.fl.hrT + 0.05, p.fl.hrT + 0.3, p.t));
      else if (p.resolved) r = Math.max(r, 1 + 0.7 * smooth(p.resolveT + 0.5, p.resolveT + 0.8, p.t));
      return r;
    }

    // Fielders ---------------------------------------------------------------------------------------

    function planFielders() {
      const { fl, cat, out } = play;
      for (const f of fielders) { f.state = 'watch'; f.target = null; f.startT = f.spot.react; f.runSpeed = f.spot.speed; }
      if (out.kind === 'foul') return;
      if (cat) {
        const f = fielders[cat.fi];
        const pull = cat.robbed ? (Math.hypot(cat.x, cat.z) - 0.55) / Math.hypot(cat.x, cat.z) : 1;
        f.state = 'run'; f.target = new V3(cat.x * pull, 0, cat.z * pull);
        // arrive right on time (the model allowed for reach and a dive; the body should get there too)
        const d = Math.hypot(f.target.x - f.home.x, f.target.z - f.home.z);
        f.runSpeed = Math.max(f.spot.speed, d / Math.max(0.3, cat.t - f.spot.react - 0.08));
        return;
      }
      // chaser: whoever reaches the landing / resting spot first
      const P = fl.land ? fl.land : fl.hr ? fl.hrPt : { x: fl.pts[fl.pts.length - 3], z: fl.pts[fl.pts.length - 1] };
      let best = null, bestT = Infinity;
      for (const f of fielders) {
        if (f.isPitcher && Math.hypot(P.x, P.z) > 42) continue;
        const t = f.spot.react + Math.hypot(P.x - f.home.x, P.z - f.home.z) / f.spot.speed;
        if (t < bestT) { bestT = t; best = f; }
      }
      if (best) {
        best.state = out.kind === 'hr' ? 'toWall' : 'chase';
        const R = out.kind === 'hr' ? wallR(sprayOf(P.x, P.z)) - 1.2 : 0;
        best.target = out.kind === 'hr' ? new V3(R * Math.sin(sprayOf(P.x, P.z)), 0, -R * Math.cos(sprayOf(P.x, P.z))) : new V3(P.x, 0, P.z);
      }
    }

    const _fd = new V3(), _hw = new V3();
    function moveFielder(f, dt, speed) {
      if (!f.target) return true;
      _fd.subVectors(f.target, f.pos); _fd.y = 0;
      const d = _fd.length();
      if (d < 0.12) return true;
      const step = Math.min(d, speed * dt);
      f.pos.addScaledVector(_fd, step / d);
      if (f.isPitcher) f.pos.y = Math.hypot(f.pos.x, f.pos.z - MOUND_Z) < 2.6 ? MOUND_H * (1 - smooth(0.9, 2.74, Math.hypot(f.pos.x, f.pos.z - MOUND_Z))) : 0;
      f.pal.root.position.copy(f.pos);
      f.pal.setFacing(Math.atan2(_fd.x, _fd.z));
      f.pal.play('run');
      f.pal.setSpeed(speed);
      return d - step < 0.12;
    }

    function updateFielders(dt) {
      if (!play) return;
      const t = play.t;
      for (const f of fielders) {
        if (f.state === 'watch' || f.state === 'done') { if (ball.visible) f.pal.lookAt(ball.position); continue; }
        if (t < f.startT) { f.pal.lookAt(ball.position); continue; }
        if (f.state === 'run') {
          const arrived = moveFielder(f, dt, f.runSpeed);
          if (arrived) { f.state = 'wait'; f.pal.play('idle_ready'); }
        }
        if (f.state === 'wait') {
          f.pal.lookAt(ball.position);
          _fd.subVectors(ball.position, f.pos);
          f.pal.setFacing(Math.atan2(_fd.x, _fd.z));
        }
        if (f.state === 'toWall') {
          if (moveFielder(f, dt, f.spot.speed * 0.9)) { f.state = 'done'; f.pal.play('shrug'); }
          f.pal.lookAt(ball.position);
        }
        if (f.state === 'chase') {
          const onGround = play.fl.landT >= 0 && t >= play.fl.landT;
          if (onGround) f.target.set(ball.position.x, 0, ball.position.z);
          moveFielder(f, dt, f.spot.speed);
          if (onGround && !play.attached && f.pos.distanceTo(_fd.set(ball.position.x, 0, ball.position.z)) < 1.0) {
            play.attached = f;
            f.state = 'done';
            f.pal.play('idle_ready');
            play.endT = Math.min(play.endT, t + 0.9);
            if (!play.resolved) resolvePlay();
          }
        }
      }
    }

    // Live playback ----------------------------------------------------------------------------------

    function updatePlay(dt) {
      const p = play;
      p.t += dt;
      const fl = p.fl;
      // ball
      if (p.attached) {
        p.attached.pal.handWorld('R', ball.position);
      } else if (p.cat && p.t >= p.cat.t) {
        const f = fielders[p.cat.fi];
        p.attached = f;
        f.state = 'done';
        f.pal.handWorld('R', ball.position);
        f.pal.play(p.cat.ground ? 'idle_ready' : p.cat.leap || p.cat.robbed ? 'jump' : 'hop');
        f.pal.setExpression('joy', 1.8);
        audio.sfx('mitt_pop', { vol: 0.7 });
      } else {
        samplePath(fl, p.t, ball.position);
        ball.rotation.x -= 30 * dt;
      }
      // ball events (bounces, wall, stands)
      while (p.ev < fl.events.length && fl.events[p.ev].t <= p.t && !(p.cat && fl.events[p.ev].t > p.cat.t)) {
        const e = fl.events[p.ev++];
        if (e.type === 'bounce') {
          audio.sfx('ball_land_grass', { intensity: clamp(e.v / 18, 0.15, 1) });
          if (e.v > 4) world.burst(scene, _hw.set(e.x, 0.05, e.z), { count: 8, colors: [0xC9A27A, 0x8BC66B], speed: 1.6, size: 0.06, life: 0.5 });
        } else if (e.type === 'wall') {
          audio.sfx('thud', { intensity: clamp(e.v / 25, 0.3, 1) });
          engine.shake(0.03, 0.2);
        } else if (e.type === 'stands') {
          audio.sfx('bounce_soft', { vol: 0.6 });
          crowd.cheer(1, 2);
        } else if (e.type === 'seats') {
          audio.sfx('bounce_soft', { vol: 0.5 });
          crowd.cheer(0.3, 1);
        } else if (e.type === 'berm') {
          audio.sfx('ball_land_grass', { intensity: 0.6 });
          world.burst(scene, _hw.set(e.x, e.y + 0.05, e.z), { count: 10, colors: [0x8BC66B, 0x5FA84A], speed: 2, size: 0.12, life: 0.6 });
        }
      }
      // on-fire sparks
      if (state.streak >= 3 && !p.attached) {
        p.sparkT -= dt;
        if (p.sparkT <= 0 && p.t < (fl.landT >= 0 ? fl.landT : fl.endT)) {
          p.sparkT = 0.05;
          world.burst(scene, ball.position, { count: 3, colors: [0xFFC93C, 0xFF7A1F, 0xFF4A1F], speed: 0.8, size: 0.09, life: 0.45, gravity: 1.5 });
        }
      }
      if (p.cutT >= 0 && !p.cut && p.t >= p.cutT) { p.cut = true; setupLandingCam(); }
      if (!p.resolved && p.t >= p.resolveT) resolvePlay();
      if (p.t >= p.endT && p.resolved && !p.ended) endPlay();
    }

    function resolvePlay() {
      const p = play;
      if (!p || p.resolved) return;
      p.resolved = true;
      const o = p.out;
      const sub = o.kind === 'hr' ? (o.dist >= BIG.monster ? 'MONSTER SHOT! ' : '') + o.dist + ' m'
        : o.kind === 'hit' || o.kind === 'out' && o.dist > 30 ? o.dist + ' m' : '';
      applyResult({ kind: o.kind, label: o.label, sub, dist: o.dist, swung: true, tone: o.tone });
    }

    function endPlay() {
      const p = play;
      p.ended = true;
      const id = nextFlow();
      if (p.out.kind === 'hr') {
        heroShot(p.out.dist);
        hold(id, 1.35, () => afterResult());
      } else {
        hold(id, 0.3, () => afterResult());
      }
    }

    function skipPlay() {
      if (!play) return;
      nextFlow();
      shortBanners = true;   // the result shows briefly; the next wind-up must not start under it
      if (!play.resolved) resolvePlay();
      shortBanners = false;
      play.ended = true;
      engine.slowmo(1, 0);
      afterResult();
    }

    /** Celebration close-up: the batter (low in frame) with the home grandstand, the crowd and fireworks behind. */
    const heroFov = () => lerp(58, 34, clamp(((engine.size.aspect || 1) - 0.5) / 1.3, 0, 1));
    function heroShot(dist) {
      cam.hero = {
        pos: new V3(BATTER_POS.x + H * 2.8, 1.35, BATTER_POS.z - 5.2),
        look: new V3(BATTER_POS.x - H * 0.35, 1.75, BATTER_POS.z + 0.6),
        fov: heroFov(),
      };
      cutTo('hero');
      // new information only (the result banner already said how far, and whether it was a monster)
      const sub = state.streak >= 3 ? 'ON FIRE ×' + state.streak
        : state.hr === GOAL ? 'Goal reached!'
          : dist === state.longest && state.hr > 1 ? 'Longest of the day!'
            : state.streak === 2 ? 'Back-to-back!' : 'Home run #' + state.hr;
      showBanner(dist + ' m', { kind: 'great', sub, duration: 1.4 });
      const bt = ui.fx.querySelector('.ss-banner:last-of-type .ss-banner-text');
      if (bt) bt.style.textTransform = 'none';   // "152 m", not "152 M"
      world.fireworks(scene, new V3(-H * 3, 12, 27), { count: dist >= BIG.fanfare ? 3 : 2 });
      homeCrowd.cheer(1, 2);
      audio.sfx('firework', { intensity: 0.7, delay: 0.5 });
      batterPosed = false;
      batter.releasePose(0.2);
      batter.play('cheer');
      batter.setExpression('joy', 2);
      batter.lookAt(cam.hero.pos);
      flipBat();
      world.confetti(scene, new V3(BATTER_POS.x, 2.4, BATTER_POS.z), { count: 90, spread: 2.2, floor: 0.02 });
    }

    function flipBat() {
      if (bat.parent !== batter.root) return;
      scene.attach(bat);
      bat.userData.fly = { v: new V3(H * 1.4, 4.2, -1.2), spin: new V3(9, 2, 5) };
    }

    function updateBatFlip(dt) {
      const f = bat.userData.fly;
      if (!f) return;
      f.v.y -= GRAV * dt;
      bat.position.addScaledVector(f.v, dt);
      bat.rotation.x += f.spin.x * dt; bat.rotation.y += f.spin.y * dt; bat.rotation.z += f.spin.z * dt;
      if (bat.position.y <= 0.04 && f.v.y < 0) {
        bat.position.y = 0.04;
        f.v.set(0, 0, 0);
        bat.rotation.set(Math.PI / 2, bat.rotation.y, 0);
        bat.userData.fly = null;
        audio.sfx('wood_knock', { vol: 0.5 });
      }
    }

    // =============================================================================================
    // Results: scoring, feedback, next pitch, finish
    // =============================================================================================

    function applyResult(r) {
      state.lastResult = r.label;
      const counts = r.kind !== 'ball';
      let out = false;
      if (r.kind === 'hr') {
        state.hr += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
        state.totalHrDist += r.dist;
        state.longest = Math.max(state.longest, r.dist);
        state.lastDist = r.dist;
      } else if (r.kind !== 'ball') {
        state.streak = 0;
        if (r.kind === 'hit') state.hits += 1;
        state.lastDist = r.dist || 0;
        out = true;
      }
      if (MODE === 'derby' && counts) { state.log[state.used] = r.kind === 'hr' ? 'hr' : 'x'; state.used += 1; }
      if (MODE === 'sudden' && out) state.outs += 1;
      renderHud(r.kind === 'hr');
      feedback(r, out);
    }

    let bannerUntil = 0, shortBanners = false;
    /** ui.banner, remembering when it clears (a skipped play gets a short one: the next pitch must stay readable). */
    function showBanner(text, o) {
      const duration = shortBanners ? Math.min(o.duration, 0.9) : o.duration;
      bannerUntil = performance.now() + duration * 1000;
      return ui.banner(text, Object.assign({}, o, { duration }));
    }
    const bannerLeft = () => Math.max(0, (bannerUntil - performance.now()) / 1000);

    function feedback(r, out) {
      const outSub = MODE === 'sudden' && out ? (state.outs >= 3 ? 'Third out!' : 'Out ' + state.outs + ' of 3') : '';
      const sub = [r.sub, outSub].filter(Boolean).join(' · ');
      if (r.kind === 'hr') {
        const big = r.dist >= BIG.fanfare;
        showBanner('HOME RUN!', { kind: 'huge', sub, duration: 2.0 });
        audio.sfx('crowd_cheer', { intensity: big ? 1 : 0.8 });
        audio.sfx(big ? 'fanfare_big' : 'fanfare_small');
        audio.sfx('voice_yay', { delay: 0.2 });
        audio.duck(0.5, 2);
        cheerAll(big ? 1 : 0.8, 3);
        picnic.cheer(1, 3);
        moodAll('idle');
        const n = big ? 5 : 3, F = play ? flightFocus() : { x: 0, z: -120 };
        const fr = Math.hypot(F.x, F.z) || 1, fk = (fr + 14) / fr;
        world.fireworks(scene, new V3(F.x * fk, 14, F.z * fk), { count: n });
        world.fireworks(scene, new V3(0, 22, -wallR(0) - 16), { count: big ? 3 : 2 });
        audio.sfx('firework', { intensity: 0.8, delay: 1.0 });
        pitcher.play(rng.chance(0.5) ? 'sad' : 'shrug');
        catcher.setExpression('surprised', 1.5);
        scoreboardFlash(r.dist);
        // milestones
        if (state.streak === 3) setTrailFire(true);
        const prev = ctx.save.records(DEF.id).longest;
        if (prev && r.dist > prev.value && r.dist === state.longest && !state.recordToast) {
          state.recordToast = true;
          note('New longest home run!', 2.4);
        }
        if (MODE === 'sudden' && state.hr % 3 === 0) note('The pitcher brings the heat!', 2.4);
        if (r.dist >= BIG.blast && ctx.awardMedal('platinum')) medalsEarned.add('platinum');
      } else if (r.kind === 'hit' && MODE === 'sudden') {
        // Sudden Death: only a homer keeps you alive, so a hit is an out (no applause for it)
        showBanner(r.label, { kind: 'info', sub: ['No homer', outSub].filter(Boolean).join(' · '), duration: 1.5 });
        audio.sfx('crowd_ooh', { vol: 0.7 });
        if (r.tone === 'wall') crowd.gasp();
        moodAll('idle');
        batter.setExpression('wince', 1.5);
        pitcher.play('clap');
      } else if (r.kind === 'hit') {
        showBanner(r.label, { kind: 'good', sub, duration: 1.5 });
        audio.sfx('crowd_applause', { intensity: 0.55 });
        crowd.cheer(0.4, 1.5);
        moodAll('idle');
        if (r.tone === 'wall') { audio.sfx('crowd_gasp'); crowd.gasp(); }
        batter.setExpression('happy', 1.5);
      } else if (r.kind === 'out') {
        showBanner(r.label, { kind: r.tone === 'robbed' ? 'info' : 'bad', sub: r.tone === 'long' ? [sub, 'So close!'].filter(Boolean).join(' · ') : sub, duration: 1.5 });
        if (r.tone === 'robbed' || r.tone === 'long') { audio.sfx('crowd_gasp'); crowd.gasp(); } else audio.sfx('crowd_aww', { vol: 0.8 });
        moodAll('idle');
        batter.setExpression('sad', 1.6);
        pitcher.play('clap');
      } else if (r.kind === 'foul') {
        showBanner(r.label, { kind: 'bad', sub, duration: 1.2 });
        audio.sfx('crowd_ooh', { vol: 0.7 });
        moodAll('idle');
        batter.setExpression('wince', 1);
      } else if (r.kind === 'strike') {
        showBanner('STRIKE!', { kind: 'bad', sub, duration: 1.2 });
        if (MODE === 'sudden') audio.sfx('crowd_aww', { vol: 0.6 });
      } else {
        showBanner('BALL', { kind: 'info', sub, duration: 1.1 });
      }
      // Timed it but didn't put much into it: say what was missing (the power bar shows it too)
      if ((r.kind === 'hit' || r.kind === 'out') && swing && swing.src === 'input' && swing.speed < POWER_OK &&
        (swing.res.timing === 'perfect' || swing.res.timing === 'good')) {
        note('Great timing! Swipe faster for more power', 2.6);
      }
      // strike / ball calls continue on their own; balls in play wait for endPlay()
      if (r.kind === 'strike' || r.kind === 'ball') {
        const id = nextFlow();
        hold(id, r.kind === 'ball' ? 1.15 : 1.35, () => afterResult());
      }
    }

    let sbFlash = null;
    function scoreboardFlash(dist, seconds) {
      sbFlash = { t: 0, dist, n: 0, dur: seconds || 3.2 };
      drawScoreboard({ on: true, dist });
    }

    function gameOver() {
      return MODE === 'derby' ? state.used >= DERBY_PITCHES : state.outs >= 3;
    }

    function afterResult() {
      if (state.phase === 'done') return;
      if (gameOver()) { endGame(); return; }
      if (play && play.ended) engine.slowmo(1, 0);
      nextPitch();
    }

    function endGame() {
      const id = nextFlow();
      state.phase = 'done';
      resetForPitch();
      cutTo('bat');
      pitchChip.classList.add('ss-hidden');
      renderHud();
      const won = state.hr >= GOAL;
      const title = MODE === 'derby' ? 'DERBY OVER' : 'THREE OUTS';
      showBanner(won ? 'GOAL REACHED!' : title, { kind: won ? 'great' : 'info', sub: state.hr + (state.hr === 1 ? ' home run' : ' home runs'), duration: 1.8 });
      if (won) { audio.sfx('jingle_win'); cheerAll(0.9, 2.5); batter.play('dance'); }
      else { audio.sfx('crowd_applause', { intensity: 0.5 }); batter.play('wave'); }
      batterPosed = false;
      batter.releasePose(0.3);
      pitcher.play(won ? 'clap' : 'wave');
      later(id, 2.2, finishGame);
    }

    const medalsEarned = new Set();
    function finishGame() {
      const pid = me.isGuest ? null : me.id;
      const records = [];
      const rec = (key, value, label, fmt, text) => {
        if (!(value > 0)) return;
        const r = ctx.save.record(DEF.id, key, value, { label, fmt, profileId: pid });
        records.push({ label, value: text, isNew: r.isNew });
      };
      if (MODE === 'derby') rec('derby', state.hr, 'Derby Home Runs', '{v} HR', state.hr + ' HR');
      else rec('sudden', state.hr, 'Sudden Death Homers', '{v} HR', state.hr + ' HR');
      rec('longest', state.longest, 'Longest Home Run', 'meters', state.longest + ' m');
      rec('streak', state.bestStreak, 'Home Run Streak', '{v} in a row', state.bestStreak + ' in a row');
      if (MODE === 'derby') {
        for (const [id, need] of [['bronze', 3], ['silver', 6], ['gold', 9], ['platinum', 10]]) {
          if (state.hr >= need && ctx.awardMedal(id)) medalsEarned.add(id);
        }
      }
      const won = state.hr >= GOAL;
      const expected = GOAL - 0.5;
      const delta = Math.round(clamp((state.hr - expected) * (MODE === 'derby' ? 13 : 9) + (won ? 14 : -6) + SKILL * 12, -40, 80));
      const swingsInPlay = Math.max(1, state.swings);
      ctx.finish({
        outcome: won ? 'win' : 'done',
        title: won ? (state.hr >= GOAL + 3 ? 'Slugger!' : 'Goal Reached!') : state.hr > 0 ? 'Nice Swings!' : 'Keep Swinging!',
        headline: String(state.hr), headlineLabel: state.hr === 1 ? 'Home Run' : 'Home Runs',
        players: [
          { profileId: me.id, name: me.name, profile: me, score: state.hr + ' HR', place: won ? 1 : 2, isCpu: false, skillDelta: delta },
          { profileId: opp.profile.id, name: opp.profile.name, profile: opp.profile, score: 'Target ' + GOAL + ' HR', place: won ? 2 : 1, isCpu: true },
        ],
        stats: [
          { label: 'Longest Homer', value: state.longest ? state.longest + ' m' : '—' },
          { label: 'Total HR Distance', value: state.totalHrDist ? U.fmt.int(state.totalHrDist) + ' m' : '—' },
          { label: 'Best Streak', value: String(state.bestStreak) },
          { label: 'Other Hits', value: String(state.hits) },
          { label: 'Perfect Swings', value: state.perfect + ' / ' + state.swings },
          { label: 'HR per Swing', value: Math.round(state.hr / swingsInPlay * 100) + '%' },
        ],
        records,
        medals: Array.from(medalsEarned),
        celebrate: won,
      });
    }

    // =============================================================================================
    // Input: the swing fires on 'move' as soon as the gesture reads as a sideways swipe
    // =============================================================================================

    const gest = { active: false, fired: false, samples: [], peak: 0, crossT: 0, type: 'touch' };
    const KEY_SWING = { angle: 22, speed: 0.72 };   // Space / Enter: a level, medium swing (mostly line drives)
    // Swipe speed is measured against a fixed yardstick (a phone's short side, at most 480 px), so the same
    // physical flick has the same power in a big desktop window or on a tablet as on a phone.
    const speedRef = () => Math.min(Math.max(1, Math.min(engine.size.w, engine.size.h)), 480);
    const speedFrom = ns => clamp((ns - 1.2) / 4.3, 0, 1);   // yardsticks per second → bat speed (full power ≈ a brisk 5.5/s flick)
    // what the player saw lags the simulation (display, and touch digitiser): credit it back to the swing
    const inputLag = type => (type === 'touch' || type === 'pen' ? 0.025 : 0.012);
    const isSteep = (dx, dy) => Math.abs(dx) < Math.abs(dy) * 0.5;   // steeper than ~63°: not a swing (yet)

    function gestureSwing(dx, dy, nspeed, tMs, type) {
      if (isSteep(dx, dy)) {
        if (state.phase === 'pitch') popupAtBatter('Swipe across!', '#FFFFFF');
        return;
      }
      const angle = Math.atan2(-dy, Math.abs(dx)) / DEG;
      const off = clamp((tMs - frameMs) / 1000, -0.12, 0.05) * engine.timeScale;
      doSwing(pitchT + off - inputLag(type) * engine.timeScale, angle, speedFrom(nspeed), 'input');
    }

    /** The swing starts on detection; until contact, the rest of the swipe still sets bat speed and plane. */
    function refineSwing(dx, dy, nspeed) {
      if (!swing || swing.src !== 'input' || swing.done || called) return;
      if (!isSteep(dx, dy)) swing.angle = Math.atan2(-dy, Math.abs(dx)) / DEG;
      swing.speed = Math.max(swing.speed, speedFrom(nspeed));
    }

    /** Fastest travel over any ≥ 40 ms window of the recorded samples (yardsticks per second). */
    function windowSpeed(S) {
      let best = 0;
      for (let i = S.length - 1, j = S.length - 1; i > 0; i--) {
        while (j > 0 && S[i].t - S[j].t < 40) j--;
        const dt = (S[i].t - S[j].t) / 1000;
        if (dt >= 0.04) best = Math.max(best, Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) / dt);
      }
      return best / speedRef();
    }

    ctx.input.on('down', p => {
      gest.active = true; gest.fired = false; gest.peak = 0; gest.crossT = 0; gest.type = p.pointerType || 'touch';
      gest.samples = [{ t: p.t, x: p.x, y: p.y }];
    });
    ctx.input.on('move', p => {
      if (!gest.active) return;
      const S = gest.samples;
      S.push({ t: p.t, x: p.x, y: p.y });
      if (S.length > 48) S.shift();
      if (gest.fired) { refineSwing(p.dx, p.dy, windowSpeed(S)); return; }
      let ref = S[0];
      for (let i = S.length - 2; i >= 0; i--) { ref = S[i]; if (p.t - S[i].t >= 70) break; }
      const dtm = (p.t - ref.t) / 1000;
      const s = speedRef();
      const travel = Math.hypot(p.dx, p.dy) / s;
      if (dtm > 0.008) gest.peak = Math.max(gest.peak, Math.hypot(p.x - ref.x, p.y - ref.y) / dtm / s);
      else gest.peak = Math.max(gest.peak, travel / Math.max(0.016, p.duration));
      if ((travel >= 0.065 && gest.peak >= 0.9) || travel >= 0.16) {
        if (!gest.crossT) gest.crossT = p.t;
        // A thumb uppercut often starts steep and hooks across: keep reading it until the chord turns
        // (the swing is dated from when the motion first got going). Mostly vertical all the way = no swing.
        if (isSteep(p.dx, p.dy) && travel < 0.3) return;
        gest.fired = true;
        gestureSwing(p.dx, p.dy, Math.max(gest.peak, windowSpeed(S)), gest.crossT, gest.type);
      }
    });
    ctx.input.on('up', () => { gest.active = false; });
    ctx.input.on('swipe', sw => {
      const ns = Math.max(sw.peakSpeed, sw.speed) / speedRef();
      if (gest.fired) { refineSwing(sw.dx, sw.dy, ns); return; }
      gest.fired = true;
      gestureSwing(sw.dx, sw.dy, ns, gest.crossT || sw.end.t, (sw.start && sw.start.pointerType) || gest.type);
    });
    ctx.input.on('tap', () => { if (skipFn) skipFn(); });
    ctx.input.on('key', k => {
      if (!k.down || k.repeat) return;
      if (k.key === ' ' || k.key === 'Enter') {
        if ((state.phase === 'pitch' || state.phase === 'call') && !swing) doSwing(pitchT - inputLag('key') * engine.timeScale, KEY_SWING.angle, KEY_SWING.speed, 'key');
        else if (skipFn) skipFn();
      }
    });

    // =============================================================================================
    // Per-frame
    // =============================================================================================

    function updateBallVisual(dt) {
      if (ball.visible) {
        // keep the ball at least a few pixels wide however far away it flies
        const dCam = camera.position.distanceTo(ball.position);
        const px = 9;
        const sc = Math.max(1, px * dCam * Math.tan(camera.fov * DEG / 2) / (BALL_R * Math.max(320, engine.size.h)));
        ball.scale.setScalar(Math.min(sc, 7));
        ballShadow.position.set(ball.position.x, 0.012 + (Math.hypot(ball.position.x, ball.position.z - MOUND_Z) < 2.74 ? MOUND_H * 0.9 : 0), ball.position.z);
        const hgt = Math.max(0, ball.position.y);
        const s = 1 + hgt * 0.08;
        ballShadow.scale.set(s, 1, s);
        ballShadow.material.opacity = 0.42 / (1 + hgt * 0.25);
        ballShadow.visible = ball.position.y > -0.2;
        glow.visible = state.phase === 'pitch';
      }
      if (marker.material.opacity > 0) {
        marker.userData.t = (marker.userData.t || 0) + dt;
        if (marker.userData.t > 1.0) marker.material.opacity = Math.max(0, marker.material.opacity - dt * 3);
        marker.lookAt(camera.position);
      }
      // he would sit right on top of the plate from behind home: only shown once the camera is elsewhere
      umpire.root.visible = cam.mode === 'hero' || cam.mode === 'landing' || (cam.mode === 'flight' && cam.pos.distanceTo(cam.bat.pos) > 5);
      homeCrowd.group.visible = cam.mode === 'hero';
      const dim = cam.mode === 'flight' || cam.mode === 'landing';   // the board would sit on the rising ball
      if (dim !== hudTop.classList.contains('dim')) hudTop.classList.toggle('dim', dim);
      const zoneOn = cam.mode === 'bat' && (state.phase === 'ready' || state.phase === 'windup' || state.phase === 'pitch' || state.phase === 'call');
      const fm = zoneGroup.userData.frame.material;
      fm.opacity = lerp(fm.opacity, zoneOn ? 0.32 : 0, 1 - Math.exp(-8 * dt));
      zoneGroup.visible = fm.opacity > 0.01;
    }

    function updateScoreboard(dt) {
      if (!sbFlash) return;
      sbFlash.t += dt;
      const n = Math.floor(sbFlash.t / 0.3);
      if (n !== sbFlash.n) {
        sbFlash.n = n;
        if (sbFlash.t > sbFlash.dur) { sbFlash = null; drawScoreboard(null); return; }
        drawScoreboard({ on: n % 2 === 0, dist: sbFlash.dist });
      }
    }

    function update(dt) {
      lastDt = dt > 0 ? dt : lastDt;
      frameMs = performance.now();
      updatePitcher(dt);
      if (state.phase === 'pitch') updatePitch(dt);
      else if (state.phase === 'play' && play) { const pdt = dt * playRate(play); updatePlay(pdt); updateFielders(pdt); }
      updateBatterPose(dt);
      updateBatFlip(dt);
      for (const p of everyone) p.update(dt);
      placeBat();
      updateBallVisual(dt);
      updateScoreboard(dt);
      updateNote(dt);
      updateCamera(dt);
      updateLod();
    }

    // =============================================================================================
    // Autoplay & debug
    // =============================================================================================

    function autoPlan() {
      if (!pitch.strike && rng.chance(0.82)) return { take: true };
      return {
        err: clamp(gauss(rng) * 0.026, -0.09, 0.09),
        angle: clamp(28 + gauss(rng) * 7, -10, 55),
        speed: clamp(rng.range(0.72, 1.0), 0, 1),
      };
    }

    function debugState() {
      return {
        phase: state.phase, mode: MODE, goal: GOAL, pitchNo: state.pitchNo, used: state.used, hr: state.hr, outs: state.outs,
        streak: state.streak, bestStreak: state.bestStreak, longest: state.longest, lastDist: state.lastDist, swings: state.swings,
        lastResult: state.lastResult, autoplay, camera: cam.mode, readyDelay: state.readyDelay, bannerLeft: +bannerLeft().toFixed(2), skill: SKILL, batter: H > 0 ? 'right' : 'left',
        windup: wind.active ? { t: +wind.t.toFixed(3), dur: +wind.dur.toFixed(3) } : null,
        breeze: { speed: +breeze.speed.toFixed(2), dir: +(breeze.dir / DEG).toFixed(0) },
        pitch: pitch ? { type: pitch.type, kmh: pitch.kmh, T: +pitch.T.toFixed(3), strike: pitch.strike, cx: +pitch.cx.toFixed(2), cy: +pitch.cy.toFixed(2), t: +pitchT.toFixed(3), tc: +pitch.tc.toFixed(3) } : null,
        swing: swing ? { err: +swing.err.toFixed(3), angle: +swing.angle.toFixed(1), speed: +swing.speed.toFixed(2), timing: swing.res.timing, kind: swing.res.kind, ev: swing.res.ev ? +swing.res.ev.toFixed(1) : null, launch: swing.res.launch ? +swing.res.launch.toFixed(1) : null, spray: swing.res.spray ? +swing.res.spray.toFixed(1) : null } : null,
        play: play ? { t: +play.t.toFixed(2), out: play.out.label, dist: play.out.dist, resolveT: +play.resolveT.toFixed(2), endT: +play.endT.toFixed(2), cutT: +play.cutT.toFixed(2), caught: !!play.cat, rate: +playRate(play).toFixed(2) } : null,
        ball: ball.visible ? [+ball.position.x.toFixed(2), +ball.position.y.toFixed(2), +ball.position.z.toFixed(2)] : null,
      };
    }

    // =============================================================================================
    // Setup & lifecycle
    // =============================================================================================

    frameBat();
    resetForPitch();
    renderHud();
    cutTo('bat');
    if (document.fonts && document.fonts.load) {
      document.fonts.load("700 40px 'Fredoka'").then(() => { if (ctx.alive && !sbFlash) drawScoreboard(null); }, () => {});
    }

    return {
      start() {
        ambience = audio.loop('stadium_ambience', { vol: 0.45 });
        note(MODE === 'derby' ? '10 pitches · Goal: ' + GOAL + ' HR' : '3 outs · Goal: ' + GOAL + ' HR', 2.6);
        nextPitch();
      },
      update,
      onResize() {
        frameBat();
        if (cam.mode === 'bat') cutTo('bat');
        // fixed shots were framed for the old aspect: refit them (rotating mid-celebration)
        else if (cam.mode === 'hero' && cam.hero) { cam.hero.fov = heroFov(); cam.fov = cam.tFov = cam.hero.fov; applyCamera(); }
        else if (cam.mode === 'landing' && cam.landing) {
          const L = cam.landing;
          L.fov = fitFov(L.pos, L.look, L.pts, engine.size.aspect || 1, 34, 72);
          cam.fov = cam.tFov = L.fov; applyCamera();
        }
        if (hint) showSwingHint();   // re-anchored for the new size / orientation
      },
      dispose() {
        if (ambience) { ambience.stop(0.3); ambience = null; }
        hideHint();
        trail.dispose();
        hitTrail.dispose();
        batTrail.dispose();
        for (const c of crowds) c.dispose();
        picnic.dispose();
        for (const g of lowKit) g.dispose();
        for (const p of everyone) { engine.disposeObject(p.root); p.dispose(); }
        engine.disposeObject(bat);
        for (const g of [capGeo, helmetGeo, maskGeo, batGeo, ballGeo, rimGeo]) g.dispose();
        for (const m of [batMat, ballMat, rimMat]) m.dispose();
        ballTex.dispose();
        glowTex.dispose();
        env.dispose();
      },
      debugState,
      debug: {
        autoplay(on) {
          autoplay = on !== false;
          if (autoplay) {
            hideHint();
            if (state.phase === 'pitch' && !swing && !planned) planned = autoPlan();
          } else planned = null;
          return autoplay;
        },
        pitch(type, loc) {
          forced = { type: PITCH_TYPES[type] ? type : null, loc: loc || null };
          if (state.phase === 'ready') {   // not thrown yet: replace the current pitch
            pitch = makePitch(effectiveSkill(), rng, forced);
            state.pitchTypes[state.pitchTypes.length - 1] = pitch.type;
            wind.dur = 1.05 * (pitch.def.slowArm || 1);
            forced = null;
          }
          return pitch ? pitch.type : null;
        },
        /** Swing at the current/next pitch: { errMs, angleDeg, speed } (+ raw: { ev, launch, spray } to force the batted ball). */
        swing(o = {}) {
          planned = { err: (Number(o.errMs) || 0) / 1000, angle: o.angleDeg == null ? 28 : Number(o.angleDeg), speed: o.speed == null ? 0.9 : Number(o.speed), raw: o.raw || null };
          return planned;
        },
        /** Where a batted ball (exit velocity m/s, launch°, spray°) would go: label, distance, catch. */
        predict(ev, launch, spray) {
          const v = launchVelocity(ev, launch, spray);
          const fl = simFlight(0, 0.85, CONTACT_Z, v.x, v.y, v.z);
          const cat = Math.abs(spray) <= 45 ? findCatch(fl, spots) : null;
          const out = classify({ kind: 'hit', ev, launch, spray }, fl, cat);
          return { label: out.label, dist: out.dist, carry: Math.round(fl.proj), hrY: fl.hr ? +fl.hrY.toFixed(2) : null, hang: +(fl.landT >= 0 ? fl.landT : fl.hrT).toFixed(2), caughtBy: cat ? spots[cat.fi].id : null };
        },
        simulate: (n = 400, quality = 0.7, o = {}) => simulateModel(n, quality, o || {}, SKILL, H, U.rng),
        skip() { if (skipFn) skipFn(); },
        state: debugState,
        PITCH_TYPES: PITCH_IDS.slice(),
      },
    };
  }

  SS.registerSport(DEF);
})();
