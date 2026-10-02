/* Sunny Sports — sports/baseball.js
 * BASEBALL — a Home Run Derby at "Sunny Park": you bat against a CPU pitcher.
 *
 *   A sideways swipe swings IMMEDIATELY (on 'move', once travel + speed thresholds are crossed).
 *   Timing at the contact plane decides the quality: perfect → sweet spot (centre field), early →
 *   pulled, late → opposite field, way off → foul tip / whiff. The swipe's vertical angle sets the
 *   launch (up-and-across = fly ball, flat = line drive, down = grounder), pitch height nudges it,
 *   and swipe speed is bat speed (exit velocity). The ball then flies with drag + backspin lift,
 *   bounces and rolls, rattles off the wall or lands in the stands; outfielders run down and catch
 *   what they can reach.
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
        { gesture: 'swipe-right', text: 'Swipe across just as the ball reaches the plate' },
        { gesture: 'swipe-across', text: 'Angle it up to lift it. Flat = line drive' },
        { gesture: 'tap', text: 'Tap to skip the replay and get the next pitch' },
      ],
      tips: [
        'Early swings pull the ball, late swings go the other way. Perfect timing goes deep to centre.',
        'Faster swipes hit harder. Up-and-across at about 30° is home run territory.',
        'Let pitches outside the box go by: a Ball doesn\'t count. Change-ups are slow, so wait for them!',
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
  const MITT_Z = 0.86;
  // Swing timing (game seconds; err = swing + LEAD − ball at the contact plane; − early, + late)
  const LEAD = 0.05;                         // the bat needs this long from the swipe to reach the zone
  const T_PERFECT = 0.022, T_GOOD = 0.05, T_FAIR = 0.105, T_TIP = 0.135;
  const T_SWEET = 0.008;                     // dead centre: a little extra pop (the 150 m blasts live here)
  const REACH = 0.3;                         // how far outside the zone the bat can still get to a pitch

  // Ball flight
  const BALL_R = 0.07;                       // drawn ~1.9× life size so it reads on a phone
  const GRAV = 9.8, DRAG = 0.0058, LIFT = 0.0026;
  const SIM_HZ = 240, SAMPLE_HZ = 60;
  const EV_MAX_BAT = 32, EV_BASE = 21;       // exit velocity = (EV_BASE + EV_MAX_BAT · bat) · timing · reach + pitch-speed bonus

  const PITCH_TYPES = {
    fastball: { name: 'Fastball', tMul: 1.0, bx: 0.0, by: 0.1, pow: 2, hump: 0.1, wob: 0, spin: 42 },
    slider: { name: 'Slider', tMul: 1.09, bx: 0.36, by: -0.18, pow: 2.6, hump: 0.12, wob: 0, spin: 34 },
    curve: { name: 'Curveball', tMul: 1.24, bx: 0.2, by: -0.62, pow: 2, hump: 0.42, wob: 0, spin: 28 },
    change: { name: 'Change-up', tMul: 1.34, bx: -0.14, by: -0.26, pow: 2, hump: 0.2, wob: 0, spin: 22, slowArm: 1.1 },
    splitter: { name: 'Splitter', tMul: 1.06, bx: -0.04, by: -0.5, pow: 4, hump: 0.12, wob: 0, spin: 12 },
    wobbler: { name: 'Wobbler', tMul: 1.28, bx: 0, by: -0.14, pow: 2, hump: 0.16, wob: 0.15, spin: 1.5 },
  };
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
    if (strike) {
      const spread = lerp(0.55, 1, skill);
      cx = rng.range(-0.21, 0.21) * spread;
      cy = 0.76 + rng.range(-0.27, 0.27) * spread;
    } else {
      const side = rng.int(0, 3);
      if (side < 2) { cx = (side ? 1 : -1) * rng.range(0.36, 0.6); cy = rng.range(0.42, 1.12); }
      else if (side === 2) { cx = rng.range(-0.3, 0.3); cy = rng.range(1.2, 1.42); }
      else { cx = rng.range(-0.3, 0.3); cy = rng.range(0.14, 0.36); }
    }
    const p0 = { x: RELEASE.x, y: RELEASE.y, z: RELEASE.z };
    const dz = -p0.z;
    const P = {
      type, name: def.name, def, T, cx, cy,
      strike: Math.abs(cx) <= ZONE.x && cy >= ZONE.y0 && cy <= ZONE.y1,
      p0, aimX: cx - def.bx, aimY: cy - def.by,
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

  function contactModel(P, sw, H, rng) {
    const ae = Math.abs(sw.err);
    const timing = timingLabel(sw.err);
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
    const qt = ae <= T_PERFECT ? 1 : 1 - (ae - T_PERFECT) / (T_FAIR - T_PERFECT);
    const qc = 1 - (off / REACH) * 0.55;
    const bat = 0.45 + 0.55 * clamp(sw.speed, 0, 1);
    const sweet = ae <= T_SWEET && off === 0;
    const ev = (EV_BASE + EV_MAX_BAT * bat) * (0.62 + 0.38 * qt) * qc * (sweet ? 1.035 : 1) + (P.vPlate - 28) * 0.25;
    const n = 1 - qt;
    const angle = clamp(sw.angle, -50, 70);
    const launch = 10 + angle * 0.72 + (P.cy - 0.76) * 20 + gauss(rng) * (1.5 + 10 * n) + (off > 0 ? gauss(rng) * 9 * off / REACH : 0);
    const spray = H * sw.err * 400 + 25 * P.cx + gauss(rng) * (2.5 + 5 * n);
    return { kind: 'hit', timing, sweet, err: sw.err, q: qt * qc, ev, launch: clamp(launch, -35, 80), spray };
  }

  // ---------------------------------------------------------------------------------------------
  // Flight model (pure): drag + decaying backspin lift, bounces, roll, the outfield wall, the stands.
  // Samples are stored at SAMPLE_HZ so live playback, the fielders and simulate() share one path.
  // ---------------------------------------------------------------------------------------------

  function launchVelocity(ev, launchDeg, sprayDeg) {
    const la = launchDeg * DEG, sp = sprayDeg * DEG;
    return { x: ev * Math.cos(la) * Math.sin(sp), y: ev * Math.sin(la), z: -ev * Math.cos(la) * Math.cos(sp) };
  }

  function accel(vx, vy, vz, t, lift, out) {
    const v = Math.hypot(vx, vy, vz), h = Math.hypot(vx, vz);
    out.x = -DRAG * v * vx; out.y = -GRAV - DRAG * v * vy; out.z = -DRAG * v * vz;
    if (lift && h > 0.01 && v > 0.01) {
      const L = LIFT * Math.exp(-t / 6) * v;
      out.x += L * (-vy * vx / h); out.y += L * h; out.z += L * (-vy * vz / h);
    }
    return out;
  }

  /** Carry distance on an empty field (where the ball would come down at ground level). */
  function carryDistance(x, y, z, vx, vy, vz) {
    const dt = 1 / SIM_HZ, a = {};
    let t = 0;
    while (t < 14) {
      accel(vx, vy, vz, t, true, a);
      vx += a.x * dt; vy += a.y * dt; vz += a.z * dt;
      x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
      if (y <= 0 && vy < 0) break;
    }
    return Math.hypot(x, z);
  }

  function simFlight(x, y, z, vx, vy, vz, maxT = 11) {
    const out = {
      pts: [x, y, z], events: [], hr: false, hrT: -1, hrY: 0, hrPt: null, landT: -1, land: null,
      wallT: -1, standsT: -1, stopT: -1, overT: -1, endT: 0, maxR: 0,
      proj: carryDistance(x, y, z, vx, vy, vz),
    };
    const dt = 1 / SIM_HZ, per = SIM_HZ / SAMPLE_HZ, a = {};
    let t = 0, i = 0, rolling = false, bounced = false, done = false;
    while (!done && t < maxT) {
      if (rolling) {
        const h = Math.hypot(vx, vz), dec = 3.4 * dt;
        if (h <= dec) { vx = 0; vz = 0; } else { vx -= vx / h * dec; vz -= vz / h * dec; }
        vy = 0; y = BALL_R;
      } else {
        accel(vx, vy, vz, t, !bounced, a);
        vx += a.x * dt; vy += a.y * dt; vz += a.z * dt;
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

  function fielderSpots() {
    const list = OUTFIELD.map(o => ({ id: o.id, x: o.r * Math.sin(o.phi), z: -o.r * Math.cos(o.phi), react: 0.4, speed: 6.4, reach: 1.0, minR: 30, maxR: 140, of: true }));
    list.push({ id: 'p', x: 0, z: MOUND_Z, react: 0.5, speed: 5.0, reach: 0.9, minR: 6, maxR: 46, of: false });
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

  /** Full pure outcome of one swing on one pitch (used by simulate()). */
  function resolveSwing(P, sw, H, rng, fielders) {
    const res = contactModel(P, sw, H, rng);
    if (res.kind === 'whiff') return { res, out: { kind: 'strike', label: 'STRIKE!', dist: 0 } };
    const v = launchVelocity(res.ev, res.launch, res.spray);
    const fl = simFlight(P.cx, P.cy, CONTACT_Z, v.x, v.y, v.z, res.kind === 'tip' ? 2.5 : 11);
    const fair = Math.abs(res.spray) <= 45 && res.kind === 'hit';
    const cat = fair ? findCatch(fl, fielders) : null;
    return { res, fl, cat, out: classify(res, fl, cat) };
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
    const GOAL = MODE === 'derby' ? Math.round(clamp(2 + SKILL * 4, 2, 6)) : Math.round(clamp(2 + SKILL * 6, 2, 8));
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

    // Infield: one canvas texture (dirt skin, infield grass, mound circle, chalk, batter's boxes).
    const INF = { x0: -32, z0: -58, size: 64, S: 2048 };
    function paintInfield() {
      const S = INF.S, k = S / INF.size;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      const X = x => (x - INF.x0) * k, Z = z => (z - INF.z0) * k;
      const pattern = (tex, tile) => {
        const p = g.createPattern(tex.image, 'repeat');
        if (p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix().scale(tile * k / tex.image.width));
        return p;
      };
      const dirt = pattern(world.texture('dirt', { color: '#CC9062' }), 3.2);
      const turf = pattern(world.texture('grass', { color: '#62B84B' }), 4.5);
      const circle = (x, z, r) => { g.beginPath(); g.arc(X(x), Z(z), r * k, 0, TAU); };
      // dirt skin: arc around the mound, clipped to fair territory (+ a little apron past the lines)
      g.save();
      const m = 2.4 * Math.SQRT2;
      g.beginPath();
      g.moveTo(X(0), Z(m)); g.lineTo(X(70), Z(m - 70)); g.lineTo(X(-70), Z(m - 70)); g.closePath();
      g.clip();
      circle(0, MOUND_Z, 29); g.fillStyle = dirt; g.fill();
      g.restore();
      // infield grass (diamond inset from the base paths), with soft mowing stripes
      const ins = BASE_D - 1.6 * Math.SQRT2;
      g.beginPath();
      g.moveTo(X(0), Z(-BASE_D + ins)); g.lineTo(X(ins), Z(-BASE_D)); g.lineTo(X(0), Z(-BASE_D - ins)); g.lineTo(X(-ins), Z(-BASE_D)); g.closePath();
      g.fillStyle = turf; g.fill();
      g.save(); g.clip();
      g.translate(X(0), Z(-BASE_D)); g.rotate(Math.PI / 4);
      for (let i = -8; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,220,0.07)' : 'rgba(0,50,0,0.05)'; g.fillRect(i * 3.05 * k, -30 * k, 3.05 * k, 60 * k); }
      g.restore();
      g.lineWidth = 0.12 * k; g.strokeStyle = 'rgba(110,70,35,0.35)'; g.stroke();
      // home circle, mound, base cut-outs
      for (const [x, z, r] of [[0, -0.25, 4.0], [0, MOUND_Z, 2.74], [BASE_D, -BASE_D, 1.6], [-BASE_D, -BASE_D, 1.6], [0, -2 * BASE_D, 1.6]]) {
        circle(x, z, r); g.fillStyle = dirt; g.fill();
        g.lineWidth = 0.1 * k; g.strokeStyle = 'rgba(110,70,35,0.3)'; g.stroke();
      }
      // chalk: foul lines, batter's boxes, catcher's box
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.09 * k; g.lineCap = 'square';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(X(s * 0.22), Z(0.22)); g.lineTo(X(s * 60), Z(-59.78)); g.stroke();
        g.strokeRect(X(s > 0 ? 0.37 : -1.59), Z(-1.16), 1.22 * k, 1.83 * k);
      }
      g.beginPath();
      g.moveTo(X(-0.55), Z(0.67)); g.lineTo(X(-0.55), Z(3.0)); g.lineTo(X(0.55), Z(3.0)); g.lineTo(X(0.55), Z(0.67));
      g.stroke();
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    }
    const infieldGeo = new THREE.PlaneGeometry(INF.size, INF.size);
    infieldGeo.rotateX(-Math.PI / 2);
    const infield = new THREE.Mesh(infieldGeo, new THREE.MeshLambertMaterial({
      map: paintInfield(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    infield.position.set(INF.x0 + INF.size / 2, 0.01, INF.z0 + INF.size / 2);
    infield.receiveShadow = true;
    infield.renderOrder = -1;
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

    // Foul lines beyond the painted infield (thin chalk strips up to the poles)
    for (const s of [-1, 1]) {
      const len = wallR(FAIR) - 40;
      const g = new THREE.BoxGeometry(0.09, 0.012, len);
      world.paint(g, 0xFFFFFF);
      g.translate(0, 0.008, -(40 + len / 2));
      g.rotateY(-s * FAIR);
      statics.push(g);
    }

    // Scoreboard frame (the dark "batter's eye" is the empty centre-field bleacher section)
    const SB = { phi: 13 * DEG, r: wallR(13 * DEG) + 17, y: 16.5, w: 17, h: 8.5 };
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

    // Bleachers: five outfield segments behind the wall (the dark centre one stays empty as the batter's
    // eye), a grandstand behind home, and two along the lines.
    const crowdRows = [];
    function addStands(o, baseH, seated = true) {
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
      if (seated) for (const r of grp.userData.rows) crowdRows.push(r);
    }
    for (const c of [-36, -18, 0, 18, 36]) {
      const phi = c * DEG, rf = wallR(phi) + STAND_FRONT;
      const [x, z] = polar(rf, phi);
      addStands({ x, y: 2.7, z, width: 2 * rf * Math.tan(9.4 * DEG), rows: 6, rise: STAND_RISE, depth: 0.85, facing: faceHome(x, z), color: c ? 0x2E86F0 : 0x1E4D3A }, 2.7, c !== 0);
    }
    addStands({ x: 0, y: 1.1, z: 17.5, width: 36, rows: 7, rise: 0.5, depth: 0.85, facing: Math.PI, color: 0x2E86F0 }, 1.1);
    for (const s of [-1, 1]) {
      const u = [s / Math.SQRT2, -1 / Math.SQRT2], nrm = [s / Math.SQRT2, 1 / Math.SQRT2];
      const x = u[0] * 34 + nrm[0] * 16, z = u[1] * 34 + nrm[1] * 16;
      addStands({ x, y: 1.0, z, width: 34, rows: 6, rise: 0.5, depth: 0.85, facing: Math.atan2(-nrm[0], -nrm[1]), color: 0x2E86F0 }, 1.0);
      // low wall in front of the line stands
      const wall = new THREE.BoxGeometry(34, 1.0, 0.3);
      world.paint(wall, 0x2C7A55);
      wall.translate(0, 0.5, 0.4); wall.rotateY(Math.atan2(-nrm[0], -nrm[1])); wall.translate(x, 0, z);
      statics.push(wall);
    }
    box(36.4, 1.1, 0.3, 0x2C7A55, 0, 0.55, 17.1);                  // backstop wall
    for (const s of [-1, 1]) box(0.16, 7, 0.16, 0x8D99AB, s * 9, 3.5, 16.9);   // backstop net posts

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
      for (let i = 0; i < 34; i++) {
        const phi = prng.range(-43, 43) * DEG, d = prng.range(BERM_FROM + 3, BERM_TO - 5);
        const dp = 0.9 / (wallR(phi) + d), dd = 0.7;
        const col = COLORS[i % COLORS.length];
        b.quad(at(phi - dp, d - dd), at(phi + dp, d - dd), at(phi + dp, d + dd), at(phi - dp, d + dd), col);
        if (prng.chance(0.75)) {
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

    const venue = new THREE.Mesh(world.mergeGeometries(statics), world.mat(0xffffff, { vertexColors: true }));
    venue.castShadow = true;
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

    // Crowd
    const crowd = world.crowd(scene, { rows: crowdRows, spacing: 1.1, density: 0.3, scale: 1.15, rng: U.rng(ctx.seed + 5) });
    const picnic = world.crowd(scene, { rows: bermRows, spacing: 0.7, density: 0.9, scale: 1.15, rng: U.rng(ctx.seed + 6) });

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
        g.fillText('AT BAT: ' + String(me.name || 'YOU').toUpperCase() + '   ·   PITCHING: ' + String(opp.profile.name).toUpperCase(), W / 2, 226);
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

    // Pitcher
    const pitcher = makePal(asTeam(opp.profile, { shirt: opp.profile.shirt }));
    const PITCHER_POS = new V3(0, MOUND_H, MOUND_Z + 0.42);
    pitcher.root.position.copy(PITCHER_POS);
    pitcher.setFacing(0);
    wearCap(pitcher, teamColor, false);
    const handBall = new THREE.Mesh(ballGeo, ballMat);
    pitcher.attach(handBall, 'R', { position: new V3(0, 0.02, 0.07) });

    // Catcher (with mitt) and umpire
    const catcher = makePal(asTeam(order[0].profile, { height: 0.15, build: 0.85 }));   // short and stocky: stays under the zone
    const CATCHER_POS = new V3(0, -0.24, 1.28);
    catcher.root.position.copy(CATCHER_POS);
    catcher.setFacing(Math.PI);
    wearCap(catcher, teamColor, false);
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshPhongMaterial({ color: 0x8A4B2A, shininess: 25 }));
    mitt.scale.set(1, 1.12, 0.6);
    catcher.attach(mitt, 'L', { position: new V3(0, 0.02, 0.05) });

    const umpire = makePal(pals.sanitize(Object.assign({}, order[1].profile, { shirt: 11, pants: 1 })));
    const UMP_POS = new V3(H * 0.62, 0, 2.3);
    umpire.root.position.copy(UMP_POS);
    umpire.setFacing(Math.PI);
    wearCap(umpire, 0x23262E, false);

    // Outfielders (distant: low detail, blob shadows) + the pitcher fields pop-ups and comebackers
    const spots = fielderSpots();
    const fielders = spots.map((s, i) => {
      if (!s.of) return { spot: s, pal: pitcher, home: PITCHER_POS.clone(), pos: PITCHER_POS.clone(), isPitcher: true, face: 0 };
      const pal = makePal(asTeam(order[2 + i].profile), { shadows: false, detail: 'low' });
      wearCap(pal, teamColor, false);
      const home = new V3(s.x, 0, s.z);
      pal.root.position.copy(home);
      const face = faceHome(s.x, s.z);
      pal.setFacing(face);
      pal.play('idle_ready', { speed: 0.6 });
      return { spot: s, pal, home, pos: home.clone(), isPitcher: false, face };
    });
    const outfielders = fielders.filter(f => !f.isPitcher);
    const everyone = [batter, pitcher, catcher, umpire].concat(outfielders.map(f => f.pal));

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
    const trail = world.trail(ball, { color: 0xFFFFFF, width: 0.09, length: 18, opacity: 0.5, maxJump: 6 });
    const hitTrail = world.trail(ball, { color: 0xFFFFFF, width: 0.32, length: 36, opacity: 0.55, maxJump: 14 });
    hitTrail.visible = false;
    const TRAIL_WHITE = new THREE.Color(0xFFFFFF), TRAIL_FIRE = new THREE.Color(0xFF9A2B);
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
    const FOLLOW_T = 0.24;
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
    const RELEASE_AT = 0.86;
    const _pl = new V3(), _pr = new V3();
    function applyPitcherPose(u) {
      let i = 0;
      while (i < PITCH_KEYS.length - 2 && u > PITCH_KEYS[i + 1].t) i++;
      const a = PITCH_KEYS[i], b = PITCH_KEYS[i + 1];
      const k = smooth(0, 1, clamp((u - a.t) / (b.t - a.t), 0, 1));
      _pl.set(lerp(a.hl[0], b.hl[0], k), lerp(a.hl[1], b.hl[1], k), lerp(a.hl[2], b.hl[2], k));
      _pr.set(lerp(a.hr[0], b.hr[0], k), lerp(a.hr[1], b.hr[1], k), lerp(a.hr[2], b.hr[2], k));
      pitcher.pose({ handL: _pl, handR: _pr, twist: lerp(a.twist, b.twist, k), lean: lerp(a.lean, b.lean, k), crouch: lerp(a.crouch, b.crouch, k) }, { lambda: 40 });
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
      cam.bat.pos.set(H * lerp(-0.42, -0.55, t), lerp(3.05, 2.7, t), lerp(4.5, 6.2, t));
      cam.bat.look.set(H * lerp(0.05, 0.1, t), lerp(0.4, 0.75, t), -14);
      cam.bat.fov = lerp(60, 36, t);
      const wide = a > 1.15;
      hudTop.className = wide ? 'ss-hud-tr bb-top' : 'ss-hud-top bb-top';
    }
    function cutTo(mode) {
      cam.mode = mode;
      updateCamTargets(0);
      cam.pos.copy(cam.tPos); cam.look.copy(cam.tLook); cam.fov = cam.tFov;
      applyCamera();
    }
    const _cv = new V3(), _cw = new V3(), _cl = new V3();
    function angleBetween(a, b) { return Math.acos(clamp(a.dot(b) / Math.max(1e-6, a.length() * b.length()), -1, 1)); }

    function updateCamTargets(dt) {
      const a = engine.size.aspect || 1;
      if (cam.mode === 'bat') {
        const sway = Math.sin(engine.time * 0.6) * 0.03;
        cam.tPos.copy(cam.bat.pos); cam.tPos.x += sway;
        cam.tLook.copy(cam.bat.look);
        cam.tFov = cam.bat.fov;
        cam.lambda = 5;
      } else if (cam.mode === 'flight' && cam.flight) {
        // Chase: ride the line from home toward the landing spot ~20 m behind the ball, rising with it,
        // stopping short of the landing / catch / wall; look ahead of the ball toward where it comes down.
        const F = cam.flight, L = F.land, b = ball.position;
        F.t += dt;
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
      '.bb-bottom{gap:6px;flex-wrap:wrap;justify-content:center;width:max-content;max-width:calc(100vw - 24px)}',
      '.bb-tm{gap:7px;font:800 11px/1 var(--font-ui);letter-spacing:.04em;text-transform:uppercase}',
      '.bb-tm i{position:relative;display:block;width:104px;height:8px;border-radius:4px;background:linear-gradient(90deg,#FF5A5F 0 ' + TM.fair[0] + '%,#FFB020 ' + TM.fair[0] + '% ' + TM.good[0] + '%,#9BD64B ' + TM.good[0] + '% ' + TM.perfect[0] + '%,#2FBF55 ' + TM.perfect[0] + '% ' + TM.perfect[1] + '%,#9BD64B ' + TM.perfect[1] + '% ' + TM.good[1] + '%,#FFB020 ' + TM.good[1] + '% ' + TM.fair[1] + '%,#FF5A5F ' + TM.fair[1] + '%)}',
      '.bb-tm i b{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 0 0 2.5px #24324A,0 2px 4px rgba(0,0,0,.3);transition:left .25s cubic-bezier(.3,1.5,.5,1)}',
      '.bb-fire{background:linear-gradient(180deg,#FFB020,#FF5A1F)!important;color:#fff!important;text-shadow:0 1px 0 rgba(150,40,0,.4)}',
      '@media (max-width:359px){.bb-pips{gap:2px}.bb-pips i,.bb-pips b{width:13px;height:13px}.bb-hr{font-size:24px}}',
      '@keyframes bb-bump{0%{transform:scale(1)}40%{transform:scale(1.45)}100%{transform:scale(1)}}',
    ].join('\n'));

    const PIP_SVG = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="#fff" stroke="#C9D3DE" stroke-width="1.4"/>' +
      '<path d="M5.4 4.4c2.5 2.9 2.5 8.3 0 11.2M14.6 4.4c-2.5 2.9-2.5 8.3 0 11.2" stroke="#E8343A" stroke-width="1.3" fill="none" stroke-dasharray="1.6 1.3"/></svg>';
    const hudTop = ui.el('div', 'ss-hud-top bb-top');
    const board = ui.el('div', 'bb-board ss-panel ss-pop');
    board.innerHTML = '<div class="bb-row"><div class="bb-hr"><b>0</b><small>HR</small></div><div class="bb-goal">Goal ' + GOAL + '</div></div>' +
      '<div class="bb-pips"></div><div class="bb-dist"><span>Last <b class="bb-last">–</b></span><span>Best <b class="bb-best">–</b></span></div>';
    hudTop.appendChild(board);
    const hudBottom = ui.el('div', 'ss-hud-bottom bb-bottom');
    const pitchChip = ui.el('div', 'ss-chip dark ss-hidden');
    const fireChip = ui.el('div', 'ss-chip bb-fire ss-hidden');
    const noteChip = ui.el('div', 'ss-chip ss-hidden');
    const timingChip = ui.el('div', 'ss-chip bb-tm ss-hidden', '<span>Early</span><i><b></b></i><span>Late</span>');
    hudBottom.append(noteChip, timingChip, pitchChip, fireChip);
    ctx.hud.append(hudTop, hudBottom);
    const hudEls = {
      hr: board.querySelector('.bb-hr'), hrNum: board.querySelector('.bb-hr b'), goal: board.querySelector('.bb-goal'),
      pips: board.querySelector('.bb-pips'), last: board.querySelector('.bb-last'), best: board.querySelector('.bb-best'),
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
      const fire = state.streak >= 3 ? 'ON FIRE ×' + state.streak : '';
      if (fire && fireChip.textContent !== fire) chip(fireChip, fire);
      else if (!fire) fireChip.classList.add('ss-hidden');
      drawScoreboard(null);
    }

    /** After every swing: where it landed between early and late. */
    function showTiming(err) {
      const dot = timingChip.querySelector('b');
      dot.style.transition = 'none';
      dot.style.left = '50%';
      timingChip.classList.remove('ss-hidden', 'ss-pop');
      void timingChip.offsetWidth;
      timingChip.classList.add('ss-pop');
      dot.style.transition = '';
      dot.style.left = tmPct(err) + '%';
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
      if (h <= 520) { hint = ui.hint({ gesture: 'swipe-across', text: 'Swipe across as the ball arrives!' }); return; }
      hint = ui.hint({ gesture: 'swipe-across', text: 'Swipe across as the ball arrives!', x: w * (H > 0 ? 0.76 : 0.24), y: h * 0.4 });
    }
    function hideHint() { if (hint) { hint.hide(); hint = null; } }

    // =============================================================================================
    // Game state
    // =============================================================================================

    const state = {
      phase: 'intro', pitchNo: 0, used: 0, hr: 0, outs: 0, streak: 0, bestStreak: 0,
      longest: 0, lastDist: 0, totalHrDist: 0, swings: 0, hits: 0, perfect: 0, log: [], lastResult: null,
      pitchTypes: [], recordToast: false,
    };
    let pitch = null, pitchT = 0, swing = null, play = null, called = false, batterPosed = true;
    const wind = { active: false, t: 0, dur: 1, released: false };
    let forced = null, planned = null, autoplay = false, lastDt = 1 / 60, frameMs = 0;
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
      crowd.setMood('idle');
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
      const type = forced && forced.type ? forced.type : null;
      const loc = forced && forced.loc ? forced.loc : null;
      forced = null;
      pitch = makePitch(effectiveSkill(), rng, { type, loc, mood: pitcherMood() });
      state.pitchTypes.push(pitch.type);
      wind.dur = 1.05 * (pitch.def.slowArm || 1);
      waitWarned = false;
      renderHud();
      batter.lookAt(_look.set(PITCHER_POS.x, 1.6, PITCHER_POS.z));
      pitcher.lookAt(_look.set(0, 0.9, 0.6));
      if (state.pitchNo === 1 && !autoplay) showSwingHint();
      else if (state.pitchNo > 2) hideHint();
      later(id, state.pitchNo === 1 ? 1.1 : 0.85, () => {
        state.phase = 'windup';
        Object.assign(wind, { active: true, t: 0, released: false });
        crowd.setMood('tense');
      });
    }

    function releasePitch() {
      state.phase = 'pitch';
      pitchT = 0;
      handBall.visible = false;
      ball.visible = true; ballShadow.visible = true;
      pitchPos(pitch, 0, ball.position);
      trail.clear();
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
      if (state.phase !== 'pitch' || swing || called) return false;
      const err = tNow + LEAD - pitch.tc;
      const res = contactModel(pitch, { err, angle, speed }, H, rng);
      // bat elevation at contact follows the pitch height (so the bat meets the ball on screen)
      const elC = clamp(Math.asin(clamp((pitch.cy - SWING_KEYS.contact.gy) / 0.62, -1, 1)) / DEG, -42, 18);
      swing = { t0: tNow, tau: pitchT - tNow, err, angle, speed, res, contactT: Math.max(pitch.tc, tNow), done: false, elC, src };
      state.swings += 1;
      showTiming(err);
      hideHint();
      audio.sfx(speed > 0.45 ? 'swing_heavy' : 'swing_light', { intensity: 0.4 + speed * 0.6 });
      audio.sfx('voice_hup', { vol: 0.7 });
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
        if (tau < LEAD) mixKeys(SWING_KEYS.load, contact, easeIn(clamp(tau / LEAD, 0, 1)), _sk);
        else mixKeys(contact, SWING_KEYS.follow, easeOut(clamp((tau - LEAD) / FOLLOW_T, 0, 1)), _sk);
        applyBatterPose(_sk, true);
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
      if (!swing && planned && pitchT > pitch.tc + T_TIP) planned = null;   // switched on too late for this one
      if (!swing && planned) {
        const ts = pitch.tc - LEAD + planned.err;
        if (!planned.take && pitchT >= ts) {
          const p = planned;
          planned = null;
          if (doSwing(ts, p.angle, p.speed, 'auto') && p.raw) swing.raw = p.raw;
        }
      }
      if (swing && swing.res.kind !== 'whiff' && !swing.done && pitchT >= swing.contactT) {
        swing.done = true;
        startContact(pitchT - swing.contactT);
        return;
      }
      const s = pitchT / pitch.T;
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
      if (!pitch.crossed && s >= 1) {
        pitch.crossed = true;
        chip(pitchChip, '<b>' + pitch.name + '</b>&nbsp;·&nbsp;' + pitch.kmh + ' km/h');
      }
      if (pitchT >= pitch.tm) ballInMitt();
    }

    function ballInMitt() {
      if (called) return;
      called = true;
      state.phase = 'call';
      pitchPos(pitch, pitch.tm / pitch.T, ball.position);
      catcher.handWorld('L', ball.position);
      audio.sfx('mitt_pop', { intensity: clamp(pitch.vPlate / 32, 0.5, 1) });
      crowd.setMood('idle');
      planned = null;
      const id = nextFlow();
      if (swing) {
        // swing and a miss
        const why = swing.res.why;
        popupAtBatter(why === 'reach' ? 'Out of reach!' : why === 'early' ? 'Too early!' : 'Too late!', '#FFFFFF');
        batter.setExpression('wince', 1.2);
        pitcher.setExpression('proud', 1.6);
        showMarker(pitch.strike);
        later(id, 0.3, () => {
          audio.sfx('ump_strike');
          umpPunch();
          applyResult({ kind: 'strike', label: 'STRIKE!', sub: 'Swing and a miss', dist: 0, swung: true });
        });
        return;
      }
      showMarker(pitch.strike);
      later(id, 0.35, () => {
        if (pitch.strike) {
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
      if (swing.raw && res.kind === 'hit') Object.assign(res, swing.raw);   // debug: exact batted ball
      state.phase = 'play';
      pitchPos(pitch, swing.contactT / pitch.T, _bp);
      const v = launchVelocity(res.ev, res.launch, res.spray);
      const fl = simFlight(_bp.x, _bp.y, _bp.z, v.x, v.y, v.z, res.kind === 'tip' ? 2.5 : 11);
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
        cam.flight = { t: 0, land: flightFocus(), dur: play.resolveT, hr: out.kind === 'hr' };
        cam.mode = 'flight';
      }
      if (out.kind === 'hr' && fl.proj >= 135) {
        engine.slowmo(0.28, 1.3, { ease: 'inQuad' });
        audio.duck(0.4, 2.5);
      } else if (q > 0.85 && res.kind === 'hit') {
        engine.slowmo(0.2, 0.25);
      }
      batter.lookAt(ball.position);
      crowd.setMood('tense');
      const id = nextFlow();
      skipFn = () => { if (id !== flow) return; skipPlay(); };
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
      // hits & fouls: where the ball ends up (about when the play ends)
      samplePath(fl, Math.min(play.endT, fl.endT), _ff);
      return { x: _ff.x, y: Math.max(0.5, _ff.y), z: _ff.z };
    }

    function setEndTimes() {
      const { fl, cat, out } = play;
      let resolveT, endT;
      if (out.kind === 'foul') {
        resolveT = play.res.kind === 'tip' ? 0.35 : Math.min(fl.landT >= 0 ? fl.landT : 1.4, 1.4);
        endT = play.res.kind === 'tip' ? 1.2 : Math.min(resolveT + 1.0, 2.6);
      } else if (cat) {
        resolveT = cat.t; endT = cat.t + 1.3;
      } else if (out.kind === 'hr') {
        resolveT = fl.hrT;
        endT = Math.min(fl.standsT >= 0 ? fl.standsT + 0.9 : fl.hrT + 2.2, fl.hrT + 2.6);
      } else {
        resolveT = fl.wallT >= 0 && (fl.landT < 0 || fl.wallT < fl.landT) ? fl.wallT : fl.landT >= 0 ? fl.landT : 1.5;
        endT = Math.min(6.5, Math.max(resolveT + 1.8, fl.stopT >= 0 ? fl.stopT + 0.6 : resolveT + 2.5));
      }
      play.resolveT = resolveT;
      play.endT = endT;
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
        f.pal.play(p.cat.leap || p.cat.robbed ? 'jump' : 'hop');
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
      if (!p.resolved && p.t >= p.resolveT) resolvePlay();
      if (p.t >= p.endT && p.resolved && !p.ended) endPlay();
    }

    function resolvePlay() {
      const p = play;
      if (!p || p.resolved) return;
      p.resolved = true;
      const o = p.out;
      const sub = o.kind === 'hr' ? (o.dist >= 140 ? 'MONSTER SHOT! ' : '') + o.dist + ' m'
        : o.kind === 'hit' || o.kind === 'out' && o.dist > 30 ? o.dist + ' m' : '';
      applyResult({ kind: o.kind, label: o.label, sub, dist: o.dist, swung: true, tone: o.tone });
    }

    function endPlay() {
      const p = play;
      p.ended = true;
      const id = nextFlow();
      if (p.out.kind === 'hr') {
        heroShot();
        hold(id, 2.0, () => afterResult());
      } else {
        hold(id, 0.3, () => afterResult());
      }
    }

    function skipPlay() {
      if (!play) return;
      nextFlow();
      if (!play.resolved) resolvePlay();
      play.ended = true;
      engine.slowmo(1, 0);
      afterResult();
    }

    function heroShot() {
      const a = engine.size.aspect || 1;
      cam.hero = {
        pos: new V3(BATTER_POS.x + H * 2.3, 1.45, BATTER_POS.z - 4.9),
        look: new V3(BATTER_POS.x - H * 0.15, 1.0, BATTER_POS.z + 0.2),
        fov: lerp(50, 30, clamp((a - 0.5) / 1.3, 0, 1)),
      };
      cutTo('hero');
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
        if (r.kind === 'hit') { state.hits += 1; state.lastDist = r.dist; }
        out = true;
      }
      if (MODE === 'derby' && counts) { state.log[state.used] = r.kind === 'hr' ? 'hr' : 'x'; state.used += 1; }
      if (MODE === 'sudden' && out) state.outs += 1;
      renderHud(r.kind === 'hr');
      feedback(r, out);
    }

    function feedback(r, out) {
      const outSub = MODE === 'sudden' && out ? (state.outs >= 3 ? 'Third out!' : 'Out ' + state.outs + ' of 3') : '';
      const sub = [r.sub, outSub].filter(Boolean).join(' · ');
      if (r.kind === 'hr') {
        const big = r.dist >= 130;
        ui.banner('HOME RUN!', { kind: 'huge', sub, duration: 2.0 });
        audio.sfx('crowd_cheer', { intensity: big ? 1 : 0.8 });
        audio.sfx(big ? 'fanfare_big' : 'fanfare_small');
        audio.sfx('voice_yay', { delay: 0.2 });
        audio.duck(0.5, 2);
        crowd.cheer(big ? 1 : 0.8, 3);
        picnic.cheer(1, 3);
        crowd.setMood('idle');
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
        if (r.dist >= 150 && ctx.awardMedal('platinum')) medalsEarned.add('platinum');
      } else if (r.kind === 'hit') {
        ui.banner(r.label, { kind: 'good', sub, duration: 1.5 });
        audio.sfx('crowd_applause', { intensity: 0.55 });
        crowd.cheer(0.4, 1.5);
        crowd.setMood('idle');
        if (r.tone === 'wall') { audio.sfx('crowd_gasp'); crowd.gasp(); }
        batter.setExpression('happy', 1.5);
      } else if (r.kind === 'out') {
        ui.banner(r.label, { kind: r.tone === 'robbed' ? 'info' : 'bad', sub: r.tone === 'long' ? [sub, 'So close!'].filter(Boolean).join(' · ') : sub, duration: 1.5 });
        if (r.tone === 'robbed' || r.tone === 'long') { audio.sfx('crowd_gasp'); crowd.gasp(); } else audio.sfx('crowd_aww', { vol: 0.8 });
        crowd.setMood('idle');
        batter.setExpression('sad', 1.6);
        pitcher.play('clap');
      } else if (r.kind === 'foul') {
        ui.banner(r.label, { kind: 'bad', sub, duration: 1.2 });
        audio.sfx('crowd_ooh', { vol: 0.7 });
        crowd.setMood('idle');
        batter.setExpression('wince', 1);
      } else if (r.kind === 'strike') {
        ui.banner('STRIKE!', { kind: 'bad', sub, duration: 1.2 });
        if (MODE === 'sudden') audio.sfx('crowd_aww', { vol: 0.6 });
      } else {
        ui.banner('BALL', { kind: 'info', sub, duration: 1.1 });
      }
      // strike / ball calls continue on their own; balls in play wait for endPlay()
      if (r.kind === 'strike' || r.kind === 'ball') {
        const id = nextFlow();
        hold(id, r.kind === 'ball' ? 1.15 : 1.35, () => afterResult());
      }
    }

    let sbFlash = null;
    function scoreboardFlash(dist) {
      sbFlash = { t: 0, dist, n: 0 };
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
      ui.banner(won ? 'GOAL REACHED!' : title, { kind: won ? 'great' : 'info', sub: state.hr + (state.hr === 1 ? ' home run' : ' home runs'), duration: 1.8 });
      if (won) { audio.sfx('jingle_win'); crowd.cheer(0.9, 2.5); batter.play('dance'); }
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
          { profileId: opp.profile.id, name: opp.profile.name, profile: opp.profile, score: 'Goal ' + GOAL, place: won ? 2 : 1, isCpu: true },
        ],
        stats: [
          { label: 'Longest Homer', value: state.longest ? state.longest + ' m' : '—' },
          { label: 'Homer Distance', value: state.totalHrDist ? U.fmt.int(state.totalHrDist) + ' m' : '—' },
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

    const gest = { active: false, fired: false, samples: [], peak: 0 };
    const shortSide = () => Math.max(1, Math.min(engine.size.w, engine.size.h));
    const speedFrom = ns => clamp((ns - 1.0) / 3.6, 0, 1);   // short sides per second → bat speed (a real flick ≈ 5)

    function gestureSwing(dx, dy, nspeed, tMs) {
      if (Math.abs(dx) < Math.abs(dy) * 0.5) {
        if (state.phase === 'pitch') popupAtBatter('Swipe across!', '#FFFFFF');
        return;
      }
      const angle = Math.atan2(-dy, Math.abs(dx)) / DEG;
      const off = clamp((tMs - frameMs) / 1000, -0.05, 0.05) * engine.timeScale;
      doSwing(pitchT + off, angle, speedFrom(nspeed), 'input');
    }

    /** The swing starts on detection; until contact, the rest of the swipe still sets bat speed and plane. */
    function refineSwing(dx, dy, nspeed) {
      if (!swing || swing.src !== 'input' || swing.done || called) return;
      if (Math.abs(dx) >= Math.abs(dy) * 0.5) swing.angle = Math.atan2(-dy, Math.abs(dx)) / DEG;
      swing.speed = Math.max(swing.speed, speedFrom(nspeed));
    }

    /** Fastest travel over any ≥ 40 ms window of the recorded samples (short sides per second). */
    function windowSpeed(S) {
      let best = 0;
      for (let i = S.length - 1, j = S.length - 1; i > 0; i--) {
        while (j > 0 && S[i].t - S[j].t < 40) j--;
        const dt = (S[i].t - S[j].t) / 1000;
        if (dt >= 0.04) best = Math.max(best, Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) / dt);
      }
      return best / shortSide();
    }

    ctx.input.on('down', p => {
      gest.active = true; gest.fired = false; gest.peak = 0;
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
      const s = shortSide();
      const travel = Math.hypot(p.dx, p.dy) / s;
      if (dtm > 0.008) gest.peak = Math.max(gest.peak, Math.hypot(p.x - ref.x, p.y - ref.y) / dtm / s);
      else gest.peak = Math.max(gest.peak, travel / Math.max(0.016, p.duration));
      if ((travel >= 0.065 && gest.peak >= 0.9) || travel >= 0.16) {
        gest.fired = true;
        gestureSwing(p.dx, p.dy, gest.peak, p.t);
      }
    });
    ctx.input.on('up', () => { gest.active = false; });
    ctx.input.on('swipe', sw => {
      if (gest.fired) { refineSwing(sw.dx, sw.dy, Math.max(sw.npeakSpeed, sw.nspeed)); return; }
      gest.fired = true;
      gestureSwing(sw.dx, sw.dy, Math.max(sw.npeakSpeed, sw.nspeed), sw.end.t);
    });
    ctx.input.on('tap', () => { if (skipFn) skipFn(); });
    ctx.input.on('key', k => {
      if (!k.down || k.repeat) return;
      if (k.key === ' ' || k.key === 'Enter') {
        if (state.phase === 'pitch' && !swing) doSwing(pitchT, 28, 0.85, 'key');
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
        const px = state.phase === 'play' ? 9 : 6;
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
      umpire.root.visible = cam.mode === 'hero' || (cam.mode === 'flight' && cam.pos.distanceTo(cam.bat.pos) > 5);
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
        if (sbFlash.t > 3.2) { sbFlash = null; drawScoreboard(null); return; }
        drawScoreboard({ on: n % 2 === 0, dist: sbFlash.dist });
      }
    }

    function update(dt) {
      lastDt = dt > 0 ? dt : lastDt;
      frameMs = performance.now();
      updatePitcher(dt);
      if (state.phase === 'pitch') updatePitch(dt);
      else if (state.phase === 'play' && play) { updatePlay(dt); updateFielders(dt); }
      updateBatterPose(dt);
      updateBatFlip(dt);
      for (const p of everyone) p.update(dt);
      placeBat();
      updateBallVisual(dt);
      updateScoreboard(dt);
      updateNote(dt);
      updateCamera(dt);
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

    function qualityDist(q) {
      const map = { perfect: 1, great: 0.85, good: 0.7, mediocre: 0.45, ok: 0.45, bad: 0.2, awful: 0 };
      const v = typeof q === 'string' ? (map[q] != null ? map[q] : 0.5) : clamp(Number(q), 0, 1);
      return v;
    }

    /**
     * Monte Carlo of n swings at strikes from this pitcher with input quality q (0..1 or a name:
     * perfect/great/good/mediocre/bad). o: { skill, type, seed, errMs | errSdMs, angle, speed } overrides.
     */
    function simulate(n = 400, quality = 0.7, o = {}) {
      const q = qualityDist(quality);
      const r = U.rng(o.seed == null ? 1234 : o.seed);
      const sErr = lerp(0.1, 0.012, q), mAng = lerp(2, 30, q), sAng = lerp(26, 4, q);
      const counts = { hr: 0, hit: 0, out: 0, foul: 0, whiff: 0 };
      let hrDist = 0, maxDist = 0, perfect = 0;
      const labels = {};
      for (let i = 0; i < n; i++) {
        const P = makePitch(o.skill == null ? SKILL : o.skill, r, { type: o.type, loc: 'strike' });
        const sw = {
          err: o.errMs != null ? o.errMs / 1000 : gauss(r) * (o.errSdMs != null ? o.errSdMs / 1000 : sErr),
          angle: o.angle != null ? o.angle : mAng + gauss(r) * sAng,
          speed: o.speed != null ? o.speed : clamp(lerp(0.3, 0.95, q) + r.range(-0.15, 0.1), 0, 1),
        };
        const x = resolveSwing(P, sw, H, r, spots);
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

    function debugState() {
      return {
        phase: state.phase, mode: MODE, goal: GOAL, pitchNo: state.pitchNo, used: state.used, hr: state.hr, outs: state.outs,
        streak: state.streak, bestStreak: state.bestStreak, longest: state.longest, lastDist: state.lastDist, swings: state.swings,
        lastResult: state.lastResult, autoplay, camera: cam.mode, skill: SKILL, batter: H > 0 ? 'right' : 'left',
        pitch: pitch ? { type: pitch.type, kmh: pitch.kmh, T: +pitch.T.toFixed(3), strike: pitch.strike, cx: +pitch.cx.toFixed(2), cy: +pitch.cy.toFixed(2), t: +pitchT.toFixed(3), tc: +pitch.tc.toFixed(3) } : null,
        swing: swing ? { err: +swing.err.toFixed(3), angle: +swing.angle.toFixed(1), speed: +swing.speed.toFixed(2), timing: swing.res.timing, kind: swing.res.kind, ev: swing.res.ev ? +swing.res.ev.toFixed(1) : null, launch: swing.res.launch ? +swing.res.launch.toFixed(1) : null, spray: swing.res.spray ? +swing.res.spray.toFixed(1) : null } : null,
        play: play ? { t: +play.t.toFixed(2), out: play.out.label, dist: play.out.dist, resolveT: +play.resolveT.toFixed(2), endT: +play.endT.toFixed(2), caught: !!play.cat } : null,
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
      onResize() { frameBat(); if (cam.mode === 'bat') cutTo('bat'); },
      dispose() {
        if (ambience) { ambience.stop(0.3); ambience = null; }
        hideHint();
        trail.dispose();
        hitTrail.dispose();
        crowd.dispose();
        picnic.dispose();
        for (const p of everyone) { engine.disposeObject(p.root); p.dispose(); }
        engine.disposeObject(bat);
        for (const g of [capGeo, helmetGeo, batGeo, ballGeo]) g.dispose();
        for (const m of [batMat, ballMat]) m.dispose();
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
        simulate,
        skip() { if (skipFn) skipFn(); },
        state: debugState,
        PITCH_TYPES: PITCH_IDS.slice(),
      },
    };
  }

  SS.registerSport(DEF);
})();
