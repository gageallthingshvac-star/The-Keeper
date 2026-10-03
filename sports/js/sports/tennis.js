/* Sunny Sports — sports/tennis.js
 * TENNIS on "Sunny Court": singles against a CPU Pal.
 *
 *   Movement is automatic: your Pal runs to a predicted intercept point. A swipe swings IMMEDIATELY
 *   (on 'move', once travel + speed thresholds are crossed). Timing vs the ideal contact moment
 *   decides quality (perfect / good / frame / whiff); early pulls cross-court, late pushes down the
 *   line; swipe direction nudges aim, swipe speed is pace, up = topspin, down = slice, slow up = lob.
 *   Serve: tap to toss, swipe near the apex.
 *
 * Sections: registration · constants & helpers · ball physics · shot solver & shot models ·
 * intercept planner · venue · rackets & athletes · camera · HUD · match flow · input · autoplay &
 * debug · results.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // ---------------------------------------------------------------------------------------------
  // Registration data
  // ---------------------------------------------------------------------------------------------

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<g transform="rotate(-38 26 26)">' +
    '<rect x="23.2" y="40" width="5.6" height="20" rx="2.8" fill="#2F3B52"/>' +
    '<rect x="23.2" y="49" width="5.6" height="11" rx="2.8" fill="#FF5A5F"/>' +
    '<path d="M22 38.5 26 44 30 38.5" stroke="#8E5BE0" stroke-width="3.2" fill="none" stroke-linejoin="round"/>' +
    '<ellipse cx="26" cy="21" rx="14.5" ry="18.5" fill="#F3EEFF" stroke="#8E5BE0" stroke-width="4"/>' +
    '<g stroke="#B9A6E8" stroke-width="1.3">' +
    '<path d="M18 9v24M22 5.4v31.2M26 4v34M30 5.4v31.2M34 9v24"/>' +
    '<path d="M14.2 13h23.6M12.4 17h27.2M12 21h28M12.4 25h27.2M14.2 29h23.6"/></g></g>' +
    '<circle cx="47" cy="46" r="10.5" fill="#D7F04A"/>' +
    '<path d="M38.4 40.4C43 42 44.5 48 41.6 53.7M55.6 38.3C51 40 49.5 46 52.4 51.6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  const DEF = {
    id: 'tennis',
    name: 'Tennis',
    tagline: 'Time it. Smash it. Ace!',
    accent: '#8E5BE0',
    tint: '#F1EAFF',
    icon: ICON,
    music: 'tennis',
    players: { min: 1, max: 1 },
    opponent: true,
    modes: [
      { id: 'quick', name: 'Quick Match', desc: 'One game with deuce. Win it by two!' },
      { id: 'match', name: 'Match', desc: 'First to three games against your rival.' },
      { id: 'rally', name: 'Rally Challenge', desc: 'Keep the rally going as long as you can.' },
    ],
    howTo: {
      steps: [
        { gesture: 'swipe-up', text: 'Swipe up as the ball arrives to swing' },
        { gesture: 'swipe-up-curve', text: 'Angle the swipe to aim left or right' },
        { gesture: 'tap', text: 'Tap to toss, then swipe up to serve' },
      ],
      tips: [
        'Swipe toward where you want the ball to go.',
        'Swipe faster for a harder shot. Only perfect timing keeps a big hit in.',
        'Your Pal runs to the ball for you — just focus on timing.',
        'Swipe up for topspin, down for a slice. A long, slow push up lobs.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Win a Quick Match or a Match' },
      { id: 'silver', name: 'Silver', desc: 'Win a Match against a Pro' },
      { id: 'gold', name: 'Gold', desc: 'Reach a 30-hit rally in Rally Challenge' },
      { id: 'platinum', name: 'Platinum', desc: 'Win a Match against Odessa without losing a game' },
    ],
    create,
  };

  // ---------------------------------------------------------------------------------------------
  // Constants & small helpers
  // ---------------------------------------------------------------------------------------------

  // Court (meters). Net along x at z = 0; you play the near half (z > 0), the CPU the far half.
  const HALF_L = 11.885, HALF_W = 4.115, HALF_WD = 5.485, SERVICE_Z = 6.40;
  const NET_H = 0.914, POST_H = 1.07, POST_X = 6.40;
  const WALL_X = 9.4, WALL_Z = 18.6, WALL_H = 0.95;

  // Ball physics
  const BALL_R = 0.033;
  const GRAV = 9.81, DRAG = 0.014, MAGNUS = 0.2, STEP = 1 / 240;
  const CORD_BAND = 0.06, ROLL_DECEL = 2.4;

  // Timing windows (seconds of swing error vs the ideal contact moment)
  const T_PERFECT = 0.045, T_GOOD = 0.10, T_EARLY_MAX = 0.19, T_LATE_MAX = 0.17, T_IGNORE = 0.30;
  // The swing is judged at min(detection, motion onset + ONSET_LEAD), so slow and fast swipers are
  // judged alike; the racket meets the ball SWIPE_LEAD after an ideally-timed swing (the finger is
  // still moving then, which is when the swipe's pace is read).
  const SWIPE_LEAD = 0.06, ONSET_LEAD = 0.045, PACE_READ = 0.04;
  const REACH = 0.9;                    // m between where the racket can be and the planned contact point
  /**
   * Reach shrinks against pace (launch speed, m/s) — but mostly when the ball is also wide (the run to
   * it is long): a hard ball hit straight at someone comes back; a hard, well-placed drive gets past.
   */
  const reachVs = plan => REACH - 0.022 * Math.max(0, (plan.launch || 0) - 24) * (0.25 + 0.75 * smooth(1.2, 3.2, plan.run || 0));
  const LAUNCH_SLACK = 0.5;             // a ball met early/late leaves from at most this far off the sweet spot
  const RACKET_LEN = 0.47;              // grip → sweet spot

  // Swipe pace: peak finger speed in short sides per second (short side capped so desktop mice
  // aren't penalised) → 0..1. ~1 px/ms on a phone is a relaxed swing, ~3 px/ms a hard flick.
  const PACE_SIDE_MAX = 500, PACE_NS0 = 1.0, PACE_NS1 = 6.5;
  const HEAT_VH_MAX = 33;               // m/s: rally heat never pushes a shot past this pace
  const LOB_VY_MAX = 13;                // m/s: a lob peaks at most ~9 m up
  const LOB_PACE = 0.08, LOB_LEN = 0.15;   // lob: a push up slower than this pace that travels at least this far (short sides)
  // A swipe still in progress when the racket meets the ball keeps being read for this long (real ms)
  // after contact; the shot is then finalised from the whole gesture (see finalizeStroke).
  const FINAL_MS = 110;

  // Serve
  const TOSS_FROM = 1.3, TOSS_APEX = 2.45, TOSS_HIGH = 2.9;
  const RING_LEAD = 0.35;               // s: the serve timing ring closes onto the ball over this long
  const SERVE_PERFECT = 0.05, SERVE_GOOD = 0.14, SERVE_EDGE = 0.26;

  const NAMES = ['LOVE', '15', '30', '40'];
  const LONG_RALLY = 12;                 // shots: a point this long earns the NICE RALLY call
  const BOARD_PTS = ['0', '15', '30', '40'];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const sideOfZ = z => (z > 0 ? 0 : 1);            // 0 = you (near), 1 = CPU (far)
  const sideSign = idx => (idx === 0 ? 1 : -1);   // +1 near half, −1 far half

  function gauss(rng) {
    let u = 0;
    while (u === 0) u = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
  }

  function netHeightAt(x) {
    const k = Math.min(1, Math.abs(x) / POST_X);
    return NET_H + (POST_H - NET_H) * k * k;     // the cable sags toward the centre strap
  }

  /** Signed margin of a bounce inside the singles court (+ in, − out); the line is part of the court. */
  function courtMargin(x, z) {
    return Math.min(HALF_W + BALL_R - Math.abs(x), HALF_L + BALL_R - Math.abs(z));
  }

  /** Signed margin inside a service box. boxSign = side of the centre line (x sign), recvIdx = half. */
  function boxMargin(x, z, boxSign, recvIdx) {
    if (sideOfZ(z) !== recvIdx) return -9;
    return Math.min(SERVICE_Z + BALL_R - Math.abs(z), HALF_W + BALL_R - Math.abs(x), x * boxSign + BALL_R);
  }

  function timingTier(err) {
    const a = Math.abs(err);
    if (a <= T_PERFECT) return 'perfect';
    if (a <= T_GOOD) return 'good';
    if (err < 0 ? a <= T_EARLY_MAX : a <= T_LATE_MAX) return 'edge';
    return 'whiff';
  }

  function timingQuality(err) {
    const a = Math.abs(err);
    if (a <= T_PERFECT) return 1;
    if (a <= T_GOOD) return lerp(0.85, 0.6, (a - T_PERFECT) / (T_GOOD - T_PERFECT));
    return 0.35;
  }

  /** Distance an athlete starting from rest can cover in t seconds (accel-limited, capped speed). */
  function reachIn(t, vmax, accel) {
    if (t <= 0) return 0;
    const tA = vmax / accel;
    return t <= tA ? 0.5 * accel * t * t : vmax * (t - tA / 2);
  }

  // ---------------------------------------------------------------------------------------------
  // Ball physics (pure: shared by the live ball, the predictor and the shot solver)
  // ---------------------------------------------------------------------------------------------

  function newBall() {
    return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, rolling: false, bx: 0, bz: 0, vin: 0, clear: 0 };
  }

  function copyBall(dst, s) {
    dst.x = s.x; dst.y = s.y; dst.z = s.z; dst.vx = s.vx; dst.vy = s.vy; dst.vz = s.vz;
    dst.spin = s.spin; dst.rolling = s.rolling; dst.bx = s.bx; dst.bz = s.bz;
    return dst;
  }

  function wallBounce(b, emit) {
    if (b.y > WALL_H) return;
    if (Math.abs(b.x) > WALL_X - BALL_R) {
      b.x = Math.sign(b.x) * (WALL_X - BALL_R); b.vx = -b.vx * 0.3; b.vz *= 0.6;
      if (emit) emit('wall', b);
    }
    if (Math.abs(b.z) > WALL_Z - BALL_R) {
      b.z = Math.sign(b.z) * (WALL_Z - BALL_R); b.vz = -b.vz * 0.3; b.vx *= 0.6;
      if (emit) emit('wall', b);
    }
  }

  /**
   * One fixed physics step: gravity, quadratic drag, Magnus-like vertical spin force, net (clear /
   * net cord / net body), bounce with spin-dependent restitution & friction, rolling, low walls.
   * emit(type, ball): 'cross' 'cord-over' 'cord-back' 'net' 'bounce' 'wall'.
   */
  function stepBall(b, h, emit) {
    if (b.rolling) {
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.03) { const k = Math.max(0, sp - ROLL_DECEL * h) / sp; b.vx *= k; b.vz *= k; } else { b.vx = 0; b.vz = 0; }
      const pz = b.z;
      b.x += b.vx * h; b.z += b.vz * h; b.y = BALL_R;
      if ((pz > 0) !== (b.z > 0) && Math.abs(b.x) < POST_X) { b.z = pz > 0 ? BALL_R : -BALL_R; b.vz = -b.vz * 0.2; }
      wallBounce(b, emit);
      return;
    }
    const sp = Math.hypot(b.vx, b.vy, b.vz), hs = Math.hypot(b.vx, b.vz);
    b.vx -= DRAG * sp * b.vx * h;
    b.vz -= DRAG * sp * b.vz * h;
    b.vy += (-GRAV - DRAG * sp * b.vy - MAGNUS * b.spin * hs) * h;
    const px = b.x, py = b.y, pz = b.z;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

    if ((pz > 0) !== (b.z > 0) && Math.abs(px) < POST_X + 0.3) {
      const f = pz / (pz - b.z);
      const xc = px + (b.x - px) * f, yc = py + (b.y - py) * f;
      if (Math.abs(xc) < POST_X) {
        const nh = netHeightAt(xc), dir = b.vz > 0 ? 1 : -1;
        if (yc - BALL_R >= nh) {
          b.clear = yc - BALL_R - nh;
          if (emit) emit('cross', b);
        } else if (yc >= nh - CORD_BAND) {
          // Clips the tape: pops up; the higher the contact the likelier it dribbles over.
          const q = (yc - (nh - CORD_BAND)) / (CORD_BAND + BALL_R);
          const over = q > 0.5;
          b.y = nh + BALL_R + 0.01;
          b.vy = 1.0 + 1.8 * q;
          b.vx *= 0.25;
          b.vz = over ? dir * (0.7 + 2.4 * (q - 0.5)) : -dir * (0.5 + 1.0 * (0.5 - q));
          b.z = (over ? dir : -dir) * (BALL_R + 0.02);
          b.spin = 0;
          b.clear = 0;
          if (emit) emit(over ? 'cord-over' : 'cord-back', b);
        } else {
          b.z = -dir * (BALL_R + 0.02);
          b.y = Math.max(BALL_R, yc);
          b.vz = -dir * Math.abs(b.vz) * 0.06;
          b.vx *= 0.15; b.vy = Math.min(0, b.vy) * 0.2; b.spin = 0;
          if (emit) emit('net', b);
        }
      }
    }

    if (b.y < BALL_R && b.vy < 0) {
      const g = clamp((py - BALL_R) / Math.max(1e-6, py - b.y), 0, 1);
      b.bx = px + (b.x - px) * g; b.bz = pz + (b.z - pz) * g;
      b.y = BALL_R;
      const s = b.spin;
      let e, fr;
      if (s >= 0) { const k = Math.min(s, 1.3); e = 0.70 + 0.07 * k; fr = 0.68 + 0.12 * k; }   // topspin kicks up & on
      else { const k = Math.min(-s, 1); e = 0.70 - 0.22 * k; fr = 0.68 + 0.14 * k; }           // slice skids low
      b.vin = -b.vy;
      b.vy = -b.vy * e; b.vx *= fr; b.vz *= fr; b.spin *= 0.3;
      if (b.vy < 0.45) { b.vy = 0; b.rolling = true; }
      if (emit) emit('bounce', b);
    }
    wallBounce(b, emit);
  }

  /** Simulates ahead: samples every 2 steps [t, x, y, z, …] and the event list (bounce positions are exact). */
  function predict(src, maxT) {
    const b = copyBall(newBall(), src);
    const pts = [], events = [];
    let t = 0, n = 0, bounces = 0, endT = maxT;
    const emit = (type, bb) => {
      const isB = type === 'bounce';
      events.push({ type, t, x: isB ? bb.bx : bb.x, y: bb.y, z: isB ? bb.bz : bb.z, clear: bb.clear });
      if (isB && ++bounces >= 2) endT = Math.min(endT, t + 0.05);
    };
    while (t < endT) {
      t += STEP;
      stepBall(b, STEP, emit);
      if (++n % 2 === 0) pts.push(t, b.x, b.y, b.z);
    }
    return { pts, events };
  }

  // ---------------------------------------------------------------------------------------------
  // Shot solver & shot models
  // ---------------------------------------------------------------------------------------------

  const _fb = newBall();
  /** Pure flight (no net) until the first bounce; records the height when crossing the net plane. */
  function flight(from, vx, vy, vz, spin) {
    const b = _fb;
    b.x = from.x; b.y = from.y; b.z = from.z; b.vx = vx; b.vy = vy; b.vz = vz;
    let t = 0, netY = null, netX = 0, apex = b.y;
    while (t < 5) {
      t += STEP;
      const sp = Math.hypot(b.vx, b.vy, b.vz), hs = Math.hypot(b.vx, b.vz);
      b.vx -= DRAG * sp * b.vx * STEP;
      b.vz -= DRAG * sp * b.vz * STEP;
      b.vy += (-GRAV - DRAG * sp * b.vy - MAGNUS * spin * hs) * STEP;
      const px = b.x, py = b.y, pz = b.z;
      b.x += b.vx * STEP; b.y += b.vy * STEP; b.z += b.vz * STEP;
      if (netY === null && (pz > 0) !== (b.z > 0)) {
        const f = pz / (pz - b.z);
        netY = py + (b.y - py) * f; netX = px + (b.x - px) * f;
      }
      if (b.y > apex) apex = b.y;
      if (b.y < BALL_R && b.vy < 0) {
        const g = clamp((py - BALL_R) / Math.max(1e-6, py - b.y), 0, 1);
        return { t, x: px + (b.x - px) * g, z: pz + (b.z - pz) * g, netY, netX, apex };
      }
    }
    return { t, x: b.x, z: b.z, netY, netX, apex };
  }

  /**
   * Launch velocity that lands on (tx, tz) with horizontal speed vh and the given spin, lowering the
   * pace (up to 8 times) until the net is cleared by minClear, or raising it when the target is out of
   * range at that pace. Returns { vx, vy, vz, t, clear }.
   */
  function solveLaunch(from, tx, tz, vh, spin, minClear) {
    let best = null;
    const dx = tx - from.x, dz = tz - from.z, D = Math.hypot(dx, dz) || 1, ux = dx / D, uz = dz / D;
    for (let tries = 0; tries < 9; tries++) {
      const range = vy => { const r = flight(from, ux * vh, vy, uz * vh, spin); return (r.x - from.x) * ux + (r.z - from.z) * uz; };
      let lo = -16, hi = null;
      for (let vy = -14; vy <= 30; vy += 2) {
        if (range(vy) >= D) { hi = vy; break; }
        lo = vy;
      }
      if (hi === null && tries < 8) { vh *= 1.12; continue; }   // can't carry that far at this pace: hit harder
      let vy = lo;
      if (hi !== null) {
        let a = lo, c = hi;
        for (let i = 0; i < 16; i++) { const m = (a + c) / 2; if (range(m) >= D) c = m; else a = m; }
        vy = (a + c) / 2;
      }
      const r = flight(from, ux * vh, vy, uz * vh, spin);
      const crosses = (from.z > 0) !== (tz > 0);
      const clear = crosses && r.netY != null ? r.netY - BALL_R - netHeightAt(r.netX) : 9;
      best = { vx: ux * vh, vy, vz: uz * vh, t: r.t, clear, apex: r.apex };
      if (clear >= minClear) break;
      vh *= 0.9;
    }
    return best;
  }

  /**
   * Applies an intent's scatter (target + launch-angle noise) and solves the launch. `draws` (optional)
   * receives / supplies the three normal deviates, so a shot can be re-solved with the same luck.
   */
  function launchFromIntent(from, H, it, rng, draws) {
    const g = draws && draws.length === 3 ? draws : [gauss(rng), gauss(rng), gauss(rng)];
    if (draws && draws !== g) draws.push(...g);
    const tx = clamp(it.tx + g[0] * it.sx, -6.5, 6.5);
    const depth = clamp(it.depth + g[1] * it.sz, 0.8, 16);
    // a lob's pace follows its length, so one from deep behind the baseline doesn't go into orbit
    const vh = it.lob ? Math.max(it.vh, Math.hypot(tx - from.x, -H * depth - from.z) / 2.0) : it.vh;
    const sol = solveLaunch(from, tx, -H * depth, vh, it.spin, it.minClear);
    sol.vy += g[2] * it.svy;
    if (it.lob) sol.vy = Math.min(sol.vy, LOB_VY_MAX);
    sol.spin = it.spin;
    return sol;
  }

  /**
   * Your groundstroke / smash from a swing: input { pace 0..1, uy −1..1 (up = +), aimX −1..1 (world x) },
   * err = timing error (s), info { H, side (+1 = a right-hander's forehand side, −1 backhand; mirrored
   * for left-handers), kind 'fh'|'bh'|'oh', contactY, stretch 0..1 }.
   * Risk follows timing: a clean hit keeps its pace and angle, a scrappy one sprays.
   */
  function strokeIntent(input, err, info) {
    const tier = timingTier(err);
    let q = timingQuality(err) * (1 - 0.35 * info.stretch);
    const p = clamp(input.pace, 0, 1), uy = clamp(input.uy, -1, 1), aimX = clamp(input.aimX, -1, 1);
    const sgn = info.side * info.H;                            // world x side of the contact
    const tn = clamp(err / T_GOOD, -1.6, 1.6);                 // early → pulled cross-court, late → pushed down the line
    const smash = info.kind === 'oh';
    // A lob is a deliberate gesture: a slow, unhurried push straight up that keeps going (a short,
    // careful upward nudge stays a soft topspin rally ball).
    const lob = !smash && uy > 0.8 && p < LOB_PACE && (input.len == null || input.len >= LOB_LEN);
    let spin, vh, depth, tx;
    if (smash) {
      spin = 0.1; vh = 25 + 9 * p; depth = 8.4 + 1.2 * q;
      tx = sgn * tn * 1.4 + aimX * 2.4;
      q = Math.min(1, q + 0.1);
    } else if (lob) {
      spin = 0.45; vh = 10.5 + 3 * p; depth = 9.8;
      tx = sgn * tn * 2.0 + aimX * 1.5;
    } else {
      spin = uy > 0.3 ? 0.3 + 0.9 * clamp((uy - 0.3) / 0.6, 0, 1) : uy < -0.3 ? -0.35 - 0.45 * clamp((-uy - 0.3) / 0.6, 0, 1) : 0.12;
      if (p < LOB_PACE && uy > 0.55) spin = Math.max(spin, 0.4);
      // a clean power strike gets real extra pace; a mistimed one doesn't
      vh = (16 + 15 * p) * (0.6 + 0.4 * q) + (tier === 'perfect' ? 5 : 1.5) * smooth(0.65, 0.95, p);
      if (spin < 0) vh *= 0.92;
      if (info.contactY < 0.55) vh *= 0.85;
      // the slice is a low, short set-up ball, not a safe deep one
      // only a perfectly timed ball goes for the deep corners; a merely good one stays safer
      depth = Math.min(lerp(6.0, 9.9, q) + 0.6 * p, tier === 'perfect' ? 10.6 : 9.3) - (spin < 0 ? 1.5 : 0);
      tx = sgn * tn * 1.8 + aimX * (1.5 + 1.5 * q);
    }
    // Power is a gamble: the harder the swipe, the more it sprays — a little even when perfect, a lot
    // when merely good, and fast balls are harder to keep from sailing long.
    const risk = Math.max(0, p - 0.62) * (0.55 + 4 * (1 - q));
    const frame = tier === 'edge';
    let sx = (0.3 + 1.1 * (1 - q)) * (1 + 2.5 * risk);
    let sz = (0.45 + 1.5 * (1 - q)) * (1 + 2.4 * risk) + 0.03 * Math.max(0, vh - 28);
    let svy = 0.12 + 0.55 * (1 - q) + 1.0 * risk + (spin < 0 ? 0.3 : 0);   // a slice skims the tape
    if (frame) { vh *= 0.72; sx += 1.0; svy += 0.9; }
    sx *= 1 + 0.6 * info.stretch; sz *= 1 + 0.5 * info.stretch;
    const txCap = tier === 'perfect' ? 3.7 : 2.9 + 0.3 * q;
    return {
      tier, q, tx: clamp(tx, -txCap, txCap), depth, vh, spin, sx, sz, svy, frame, lob, smash, pace: p,
      minClear: lob ? 1.5 : spin < 0 ? 0.15 : 0.28 + 0.45 * (1 - p),
    };
  }

  /** CPU groundstroke: tactics from skill + situation, scatter from its sampled timing error. */
  function cpuIntent(skill, err, info, rng) {
    const tier = timingTier(err);
    const q = timingQuality(err) * (1 - 0.35 * info.stretch);
    if (info.feeder) {
      const spread = Math.min(3.3, 0.6 + 0.09 * info.streak);
      return {
        tier, q: 1, tx: clamp(info.playerX * 0.35 + rng.range(-spread, spread), -3.5, 3.5),
        depth: 8.0 + rng.range(-0.6, 0.8), vh: Math.min(27, 14.5 + 0.42 * info.streak), spin: 0.55,
        minClear: 0.45, sx: 0.12, sz: 0.25, svy: 0.05, frame: false, lob: false, smash: false, tactic: 'feed', pace: 0.4,
      };
    }
    // A low, slow slice sits up to be attacked rather than forcing a defensive reply.
    const sliceSitter = info.inSpin < -0.2 && info.contactY < 0.6 && (info.inSpeed || 99) < 22;
    const rushed = (info.inSpeed || 0) > 30 || (info.inLaunch || 0) > 27;   // a hard ball is blocked back rather than attacked
    const deep = info.contactZabs > 12.2;               // pushed behind its baseline: rally rather than go for it
    const sitter = info.stretch <= 0.45 && (info.inLaunch || 99) < 23;   // a slow ball sits up to be punished
    const defensive = info.stretch > 0.45 || (info.contactY < 0.45 && !sliceSitter);
    const playerNet = info.playerZabs < 8;
    const shortBall = info.contactZabs < 9.5 || sliceSitter;
    // pulled in by a short ball while you're still scrambling back: a lob over your head
    const lobChance = (defensive ? 0.3 + 0.2 * skill : 0) + (info.contactZabs < 10 && info.playerRecovering ? 0.12 + 0.12 * skill : 0);
    const px = info.playerX, openSide = Math.abs(px) > 0.8 ? -Math.sign(px) : (rng.chance(0.5) ? 1 : -1);
    let tactic, tx, depth, vh, spin;
    // A strong CPU meets a big drive with a counter: a deep, flat block that borrows the incoming pace.
    const counter = skill > 0.55 && (info.inLaunch || 0) > 27 && info.stretch < 0.6 && info.contactY > 0.5 &&
      rng.chance(clamp((skill - 0.5) * 1.5, 0, 0.72));
    // Rookies just block a serve back down the middle, so serves start rallies rather than end points.
    const block = info.serveReturn && skill < 0.45 && info.kind !== 'oh';
    if (block) {
      tactic = 'rally'; tx = rng.range(-1.0, 1.0); depth = 7.4 + 1.5 * skill; vh = 14 + 4 * skill; spin = 0.45;
    } else if (info.kind === 'oh') {
      tactic = 'smash'; tx = openSide * rng.range(1.8, 3.3); depth = 8.6; vh = 25 + 6 * skill; spin = 0.1;
    } else if (counter) {
      tactic = 'counter'; tx = openSide * rng.range(1.4, 2.6 + 0.4 * skill); depth = 9.4 + 0.4 * skill;
      vh = clamp(0.7 * info.inLaunch + 5 * skill, 20, 31); spin = 0.3;
    } else if ((playerNet && rng.chance(0.6)) || rng.chance(lobChance)) {
      tactic = 'lob'; tx = rng.range(-2.2, 2.2); depth = 9.7; vh = 10.5 + 2 * skill; spin = 0.4;
    } else if (skill > 0.4 && rng.chance(info.playerZabs > 12.9 ? 0.2 : info.contactZabs < 10 ? 0.1 : 0.03)) {
      tactic = 'drop'; tx = rng.range(-2.6, 2.6); depth = 4.3; vh = 11.5; spin = -0.6;
    } else if (rng.chance(clamp(0.1 + 0.42 * skill + (shortBall ? 0.25 : 0) - (defensive ? 0.3 : 0) - (rushed ? 0.25 : 0) - (deep ? 0.2 : 0) + Math.min(0.4, 0.05 * Math.max(0, (info.shots || 0) - 3)), 0, 0.9))) {
      tactic = 'attack'; depth = 8.8 + 0.9 * skill; vh = 20 + 9 * skill + (sitter ? 3 : 0); spin = 0.6;
      tx = openSide * (sitter ? rng.range(2.6, 3.0 + 0.4 * skill) : rng.range(2.2, 2.7 + 0.5 * skill));
    } else {
      tactic = 'rally';
      const cross = info.cpuX ? -Math.sign(info.cpuX) : (rng.chance(0.5) ? 1 : -1);
      tx = cross * rng.range(0.6, 1.6 + 1.4 * skill); depth = 7.6 + 2.0 * skill; vh = 15 + 7 * skill; spin = 0.5;
    }
    if (defensive && tactic !== 'counter') vh *= 0.85;
    const em = 1.25 - 0.55 * skill, attack = tactic === 'attack' || tactic === 'smash';
    const frame = tier === 'edge';
    // pace you can barely handle sprays a reply (a top player absorbs most of it)
    const rush = 1 + 2 * (1 - 0.6 * skill) * clamp(((info.inLaunch || 0) - 27) / 12, 0, 1.3);
    let sx = (0.3 + 1.3 * (1 - q)) * em * (attack ? 1.25 : block ? 0.7 : 1) * rush;
    let sz = (0.45 + 1.5 * (1 - q)) * em * rush;
    let svy = ((0.1 + 0.5 * (1 - q)) * em + (attack ? 0.15 : 0)) * rush;
    if (frame) { vh *= 0.72; sx += 1.0; svy += 0.9; }
    return {
      tier, q, tx: clamp(tx, -3.9, 3.9), depth, vh, spin, sx, sz, svy, frame, tactic, pace: clamp((vh - 15) / 13, 0, 1),
      lob: tactic === 'lob', smash: tactic === 'smash', minClear: tactic === 'lob' ? 1.5 : tactic === 'drop' ? 0.2 : tactic === 'counter' ? 0.3 : block ? 0.6 : 0.4,
    };
  }

  /**
   * Extra reaction time against a hard groundstroke (launch m/s): a weaker CPU reads pace worse than
   * your auto-run does; the best barely notice it.
   */
  const paceRead = (launch, who, skill) => Math.min(0.08, (who === 1 ? 0.03 * (1 - 0.85 * (skill || 0)) : 0.008) * Math.max(0, launch - 26));
  const PLAYER_VMAX = 6.2, PLAYER_ACCEL = 10, PLAYER_REACT = 0.08, SERVE_REACT = 0.6;
  /** Reaction to a serve (a fraction of the normal reaction): rookies stand ready for it, so serves get rallied. */
  const serveReact = skill => SERVE_REACT * lerp(0.55, 1, smooth(0, 0.35, skill));
  const cpuTimingSd = skill => 0.03 + 0.052 * Math.pow(1 - skill, 1.5);
  const cpuMotion = skill => ({ vmax: 4.3 + 1.7 * skill, accel: 9 + 5 * skill, react: 0.37 - 0.22 * skill });
  /** Timing scatter under pressure: fast incoming balls and late arrivals make everyone less precise. */
  // (serves are expected to be quick, so they only start to hurry the returner above 30 m/s)
  const pressure = plan => Math.max(0, plan.launch - (plan.serve ? 30 : 20));
  // ...and a hard ball you had to sprint for is the hardest of all; a big serve near the lines too
  const servePressure = plan => (plan.serve ? Math.min(0.1, Math.max(0, plan.launch - 33) * 0.009) + (plan.bounce && plan.bounce.margin < 0.35 ? 0.03 : 0) : 0);
  // (a top CPU soaks up raw pace; what hurries it is pace plus placement, and a perfectly struck ball)
  const cpuPressureSd = (skill, plan) => cpuTimingSd(skill) + (1 - 0.35 * skill) * (Math.min(0.07, pressure(plan) * 0.006) * (1 - 0.5 * skill) + (plan.deficit > -0.3 ? 0.03 : 0) +
    clamp((plan.run - 2.2) * 0.02, 0, 0.04) * (plan.speed > 20 ? 1 : 0.5) + servePressure(plan) * (1 - 0.45 * skill) * (plan.serve && skill < 0.3 ? 0.4 : 1) +
    (plan.perfectIn ? 0.018 : 0));
  const playerPressureSd = (sd, plan) => sd * (1 + 0.04 * pressure(plan)) + (plan.deficit > -0.4 ? 0.015 : 0);

  /**
   * Rally heat: from the 3rd shot the CPU hits a little harder each time, so long rallies build to a
   * finish (your own pace is always yours: it comes from your swipe).
   */
  function applyHeat(it, shots) {
    if (it.lob || it.tactic === 'drop' || it.tactic === 'feed') return it;
    it.vh = Math.min(it.vh * (1 + Math.min(0.5, Math.max(0, shots - 2) * 0.08)), Math.max(it.vh, HEAT_VH_MAX));
    return it;
  }

  /**
   * The CPU's timing error for a groundstroke: long rallies wear it down a little, and most near-misses
   * become scrappy frame shots rather than air swings.
   */
  function cpuStrokeErr(skill, plan, rng, feeder, shots) {
    let err = gauss(rng) * (feeder ? 0.012 : cpuPressureSd(skill, plan) + Math.min(0.04, 0.003 * Math.max(0, (shots || 0) - 7)));
    if (timingTier(err) === 'whiff' && Math.abs(err) < 2 * T_EARLY_MAX && rng.chance(0.7)) {
      err = Math.sign(err) * rng.range(T_GOOD + 0.005, (err < 0 ? T_EARLY_MAX : T_LATE_MAX) - 0.005);
    }
    return err;
  }

  /**
   * Autoplay / simulation swing input. style: 'mixed' (default: varied, sometimes going for the open
   * court), 'open' (always), 'safe' (middle of the court, medium pace), 'random' (uniform spread).
   */
  function botInput(r, o, oppX) {
    const style = o.style || 'mixed';
    let pace = r.range(0.3, 0.85), aimX = r.range(-0.7, 0.7);
    if (style === 'open' || (style === 'mixed' && r.chance(0.35))) { aimX = (oppX > 0 ? -1 : 1) * r.range(0.6, 1); pace = r.range(0.6, 1); }
    else if (style === 'safe') { aimX = r.range(-0.3, 0.3); pace = r.range(0.3, 0.6); }
    return {
      pace: o.pace != null ? o.pace : pace,
      uy: o.uy != null ? o.uy : r.chance(0.15) ? -0.6 : r.range(0.1, 0.9),
      aimX: o.aimX != null ? o.aimX : aimX,
    };
  }

  /** Serve from a swing: dtApex = contact time − toss apex time; info { H, boxSign, second }. */
  function serveIntent(input, dtApex, info) {
    const a = Math.abs(dtApex);
    const tier = a <= SERVE_PERFECT ? 'perfect' : a <= SERVE_GOOD ? 'good' : a <= SERVE_EDGE ? 'edge' : 'whiff';
    const q = tier === 'perfect' ? 1 : tier === 'good' ? lerp(0.85, 0.6, (a - SERVE_PERFECT) / (SERVE_GOOD - SERVE_PERFECT)) : tier === 'edge' ? 0.4 : 0.15;
    let p = clamp(input.pace, 0, 1);
    if (info.second) p *= 0.72;
    // A big serve is a gamble: power only pays off (and stays in) when the toss is met cleanly, and
    // even then a flat-out first serve misses now and then. Second serves are toned down, not safe.
    const power = Math.max(0, p - 0.6) * (0.9 + 2.2 * (1 - q)) * (info.second ? 0.5 : 1);
    const aim = clamp(input.aimX, -1, 1);   // world x direction of the swipe
    const center = info.boxSign * HALF_W / 2;
    const tx = clamp(center + aim * 1.6, info.boxSign > 0 ? 0.3 : -HALF_W + 0.3, info.boxSign > 0 ? HALF_W - 0.3 : -0.3);
    const depth = info.second ? SERVICE_Z - 0.95 : SERVICE_Z - 0.62;   // aim deep; a mistimed toss sprays
    const k = 1 + 2.2 * power, edge = tier === 'edge' || tier === 'whiff';
    return {
      tier, q, tx, depth,
      vh: tier === 'perfect' && !info.second ? 20 + 30 * p : (20 + 23 * p) * (0.7 + 0.3 * q),
      spin: info.second ? 0.9 : 0.25 + 0.25 * clamp(input.uy, 0, 1),
      sx: (0.2 + 0.9 * (1 - q)) * k + (edge ? 0.8 : 0),
      sz: (0.25 + 0.9 * (1 - q)) * k,
      svy: (0.08 + 0.4 * (1 - q)) * k + 0.5 * power + (edge ? 0.5 : 0) + (tier === 'whiff' ? 1.2 : 0),
      minClear: info.second ? 0.35 : 0.07, frame: tier === 'edge' || tier === 'whiff', pace: p,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Intercept planner (pure): where & when an athlete meets an incoming ball
  // ---------------------------------------------------------------------------------------------

  // Ideal ball position relative to the athlete for each stroke (lateral on the racket side, toward the net).
  const CONTACT = { fh: { lat: 0.93, fwd: 0.47 }, bh: { lat: -0.93, fwd: 0.47 }, oh: { lat: 0.2, fwd: 0.41, y: 2.31 } };

  /**
   * st: { idx (0 near / 1 far), x, z, vmax, accel, react, hand (1 right / −1 left, default 1) }, pred from
   * predict(), t0 = its start time.
   * opts: { serve: { boxSign } }. Returns a plan { ok, leave, t, kind, cx, cy, cz, sx, sz, deficit, bounce, speed }.
   */
  function planIntercept(st, pred, t0, opts) {
    const H = sideSign(st.idx), hand = st.hand || 1;
    let first = null, secondT = Infinity, blocked = false;
    for (const e of pred.events) {
      if ((e.type === 'net' || e.type === 'cord-back') && !first) blocked = true;
      if (e.type === 'bounce') { if (!first) first = e; else { secondT = e.t; break; } }
    }
    if (blocked || !first || sideOfZ(first.z) !== st.idx) return { ok: false, leave: true };
    const margin = opts && opts.serve ? boxMargin(first.x, first.z, opts.serve.boxSign, st.idx) : courtMargin(first.x, first.z);
    const bounce = { x: first.x, z: first.z, t: t0 + first.t, margin };
    if (margin < -0.25) return { ok: false, leave: true, bounce };

    let best = null, bestScore = -Infinity, fallback = null, fallbackDef = Infinity;
    const P = pred.pts;
    for (let i = 0; i < P.length; i += 4) {
      const t = P[i];
      if (t <= first.t + 0.03 || t >= secondT) continue;
      const x = P[i + 1], y = P[i + 2], z = P[i + 3];
      if (sideOfZ(z) !== st.idx || Math.abs(z) < 1.2) continue;
      let kind, score;
      if (y >= 1.85 && y <= 2.75) { kind = 'oh'; score = -3 * (y - 2.3) * (y - 2.3) - 0.6; }
      else if (y >= 0.18 && y <= 1.7) {
        kind = (x - st.x) * H * hand >= -0.25 ? 'fh' : 'bh';
        score = -4 * (y - 0.95) * (y - 0.95) - (y > 1.45 ? 1 : 0);
      } else continue;
      const c = CONTACT[kind];
      const sx = x - H * hand * c.lat, sz = clamp(z + H * c.fwd, H > 0 ? 1.2 : -17.5, H > 0 ? 17.5 : -1.2);
      const dist = Math.hypot(sx - st.x, sz - st.z);
      const reach = reachIn(t - st.react, st.vmax, st.accel) + 0.1;
      // stay near the baseline: don't creep into the court for loopy balls, don't drift into the stands
      score -= 0.1 * t + 0.3 * Math.max(0, 11.6 - Math.abs(sz)) + 0.6 * Math.max(0, Math.abs(sz) - 13.8);
      const cand = { t, x, y, z, kind, sx, sz, dist, reach };
      if (dist <= reach) {
        if (score > bestScore) { bestScore = score; best = cand; }
      } else if (dist - reach < fallbackDef) { fallbackDef = dist - reach; fallback = cand; }
    }
    const c = best || fallback;
    if (!c) return { ok: false, leave: true, bounce };
    // incoming speed near contact (for CPU pressure)
    let speed = 15;
    for (let i = 0; i + 4 < P.length; i += 4) {
      if (P[i] >= c.t) { const dt = P[i + 4] - P[i]; speed = Math.hypot(P[i + 5] - P[i + 1], P[i + 6] - P[i + 2], P[i + 7] - P[i + 3]) / dt; break; }
    }
    const launch = P.length >= 8 ? Math.hypot(P[5] - P[1], P[6] - P[2], P[7] - P[3]) / (P[4] - P[0]) : speed;
    return {
      ok: true, leave: false, t: t0 + c.t, kind: c.kind, cx: c.x, cy: c.y, cz: c.z, sx: c.sx, sz: c.sz,
      deficit: best ? c.dist - c.reach : fallbackDef, reachable: !!best, run: c.dist, bounce, speed, launch, serve: !!(opts && opts.serve), used: false,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Swing keyframes (pal-local: +z forward, +x = the Pal's left; right hand holds the racket)
  // ---------------------------------------------------------------------------------------------

  const KEYS = {
    fh: {
      prep: { r: [-0.60, 1.00, -0.35], l: [0.10, 0.92, 0.32], ax: [-0.30, 0.55, -0.78], tw: -0.80, lean: 0.12, cr: 0.55 },
      hit: { r: [-0.48, 0.95, 0.34], l: [0.20, 0.95, 0.20], ax: [-0.95, 0.10, 0.28], tw: -0.05, lean: 0.18, cr: 0.50 },
      fol: { r: [0.30, 1.30, 0.20], l: [0.30, 1.05, 0.05], ax: [0.40, 0.55, -0.73], tw: 0.70, lean: 0.10, cr: 0.35 },
    },
    bh: {
      prep: { r: [0.42, 0.95, -0.30], l: [0.36, 0.98, -0.24], ax: [0.35, 0.55, -0.76], tw: 0.85, lean: 0.12, cr: 0.55 },
      hit: { r: [0.48, 0.95, 0.34], l: [0.42, 0.98, 0.30], ax: [0.95, 0.10, 0.28], tw: 0.05, lean: 0.18, cr: 0.50 },
      fol: { r: [-0.25, 1.30, 0.18], l: [-0.18, 1.28, 0.14], ax: [-0.45, 0.55, -0.70], tw: -0.70, lean: 0.10, cr: 0.35 },
    },
    oh: {
      prep: { r: [-0.32, 1.30, -0.28], l: [0.12, 1.85, 0.28], ax: [0.05, -0.85, -0.50], tw: -0.45, lean: -0.12, cr: 0.25 },
      hit: { r: [-0.20, 1.86, 0.28], l: [0.15, 1.15, 0.25], ax: [0.0, 0.96, 0.28], tw: 0.0, lean: 0.05, cr: 0.05 },
      fol: { r: [0.32, 0.78, 0.30], l: [0.25, 0.85, 0.10], ax: [0.30, -0.75, 0.55], tw: 0.55, lean: 0.35, cr: 0.35 },
    },
  };
  const IDLE_AXIS = [0.35, 0.6, 0.72];

  // ---------------------------------------------------------------------------------------------
  // create(): the sport instance
  // ---------------------------------------------------------------------------------------------

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, engine, util: U } = ctx;
    const V3 = THREE.Vector3;
    const MODE = ctx.mode;
    const me = ctx.players[0].profile;
    const opp = ctx.opponent || { profile: pals.CPU_ROSTER[0].profile, skill: pals.CPU_ROSTER[0].skill, title: 'Rookie' };
    const SKILL = clamp(opp.skill, 0, 1);
    const rng = ctx.rng;
    const autoRng = U.rng((ctx.seed || 1) + 7919);
    const CPU_NAME = opp.profile.name;
    const GAMES_TO_WIN = MODE === 'match' ? 3 : 1;

    // =============================================================================================
    // Venue: "Sunny Court"
    // =============================================================================================

    world.environment(scene, {
      sky: 'day', trees: { ring: 62, count: 36 }, clouds: 12, seed: 23,
      shadow: { center: new V3(0, 0, 0), size: 34 },
    });

    function plane(w, l, x, y, z, color) {
      const g = new THREE.PlaneGeometry(w, l);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      return color == null ? g : world.paint(g, color);
    }

    // Surround (green) + playing area (blue)
    const surround = new THREE.Mesh(plane(WALL_X * 2, WALL_Z * 2, 0, 0, 0),
      world.mat(0xffffff, { map: world.texture('hardcourt', { color: '#3E9A63', repeat: [4, 8] }) }));
    surround.receiveShadow = true;
    scene.add(surround);
    const court = new THREE.Mesh(plane(HALF_WD * 2, HALF_L * 2, 0, 0.004, 0),
      world.mat(0xffffff, { map: world.texture('hardcourt', { repeat: [2, 4] }) }));
    court.receiveShadow = true;
    scene.add(court);

    // Lines (one merged mesh): baselines 10 cm, others 5 cm; the outer edge is the boundary.
    {
      const L = [], Y = 0.009, W = 0xFFFFFF;
      for (const s of [-1, 1]) {
        L.push(plane(HALF_WD * 2, 0.10, 0, Y, s * (HALF_L - 0.05), W));
        L.push(plane(0.05, HALF_L * 2, s * (HALF_WD - 0.025), Y, 0, W));
        L.push(plane(0.05, HALF_L * 2, s * (HALF_W - 0.025), Y, 0, W));
        L.push(plane(HALF_W * 2, 0.05, 0, Y, s * (SERVICE_Z - 0.025), W));
        L.push(plane(0.05, 0.12, 0, Y, s * (HALF_L - 0.16), W));
      }
      L.push(plane(0.05, SERVICE_Z * 2, 0, Y, 0, W));
      const lines = new THREE.Mesh(world.mergeGeometries(L), world.mat(0xffffff, { vertexColors: true }));
      lines.receiveShadow = true;
      scene.add(lines);
    }

    // Net: sagging mesh (own textured material) + tape, strap and posts (merged).
    {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g2 = c.getContext('2d');
      g2.strokeStyle = 'rgba(24,30,44,0.92)';
      g2.lineWidth = 3;
      for (let i = 0; i <= 64; i += 16) {
        g2.beginPath(); g2.moveTo(i, 0); g2.lineTo(i, 64); g2.stroke();
        g2.beginPath(); g2.moveTo(0, i); g2.lineTo(64, i); g2.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const seg = 40, pos = [], uv = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const x = -POST_X + (2 * POST_X * i) / seg, top = netHeightAt(x) - 0.035;
        pos.push(x, 0.03, 0, x, top, 0);
        uv.push(x / 0.4, 0.03 / 0.4, x / 0.4, top / 0.4);
        if (i < seg) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const netMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.15 });
      const net = new THREE.Mesh(geo, netMat);
      net.renderOrder = 1;
      scene.add(net);

      const parts = [];
      const N = 24;
      for (let i = 0; i < N; i++) {
        const x0 = -POST_X + (2 * POST_X * i) / N, x1 = -POST_X + (2 * POST_X * (i + 1)) / N;
        const y0 = netHeightAt(x0), y1 = netHeightAt(x1);
        const len = Math.hypot(x1 - x0, y1 - y0);
        const b = new THREE.BoxGeometry(len + 0.01, 0.07, 0.035);
        b.rotateZ(Math.atan2(y1 - y0, x1 - x0));
        b.translate((x0 + x1) / 2, (y0 + y1) / 2 - 0.03, 0);
        parts.push(world.paint(b, 0xFFFFFF));
      }
      const strap = new THREE.BoxGeometry(0.05, NET_H - 0.05, 0.03);
      strap.translate(0, (NET_H - 0.05) / 2, 0);
      parts.push(world.paint(strap, 0xFFFFFF));
      for (const s of [-1, 1]) {
        const post = new THREE.CylinderGeometry(0.045, 0.05, POST_H + 0.04, 10);
        post.translate(s * (POST_X + 0.04), (POST_H + 0.04) / 2, 0);
        parts.push(world.paint(post, 0x2F5D50));
        const cap = new THREE.SphereGeometry(0.055, 10, 6);
        cap.translate(s * (POST_X + 0.04), POST_H + 0.05, 0);
        parts.push(world.paint(cap, 0xFFFFFF));
      }
      const fittings = new THREE.Mesh(world.mergeGeometries(parts), world.mat(0xffffff, { vertexColors: true, kind: 'phong', shininess: 30 }));
      fittings.castShadow = true;
      scene.add(fittings);
    }

    // Low walls with sponsor banners (one mesh per sponsor), umpire chair.
    {
      const parts = [];
      const wall = (w, d, x, z) => { const b = new THREE.BoxGeometry(w, WALL_H, d); b.translate(x, WALL_H / 2, z); parts.push(world.paint(b, 0x2C5E86)); };
      for (const s of [-1, 1]) {
        wall(WALL_X * 2 + 0.4, 0.2, 0, s * (WALL_Z + 0.1));
        wall(0.2, WALL_Z * 2, s * (WALL_X + 0.1), 0);
      }
      // umpire chair: legs, platform, rail, ladder (x = −(POST_X + 1.1))
      const ux = -(POST_X + 1.15);
      const box = (w, h, d, x, y, z, col) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); parts.push(world.paint(b, col)); };
      for (const lx of [-0.3, 0.3]) for (const lz of [-0.3, 0.3]) box(0.07, 1.45, 0.07, ux + lx, 0.725, lz, 0xF4F4F0);
      box(0.78, 0.1, 0.78, ux, 1.47, 0, 0x2F5D50);
      box(0.06, 0.45, 0.78, ux + 0.37, 1.72, 0, 0xF4F4F0);
      box(0.78, 0.45, 0.06, ux, 1.72, 0.37, 0xF4F4F0);
      box(0.78, 0.45, 0.06, ux, 1.72, -0.37, 0xF4F4F0);
      box(0.6, 0.5, 0.04, ux - 0.39, 1.95, 0, 0x2F5D50);
      for (let i = 0; i < 4; i++) box(0.06, 0.04, 0.5, ux - 0.45, 0.3 + i * 0.34, 0, 0xF4F4F0);
      const walls = new THREE.Mesh(world.mergeGeometries(parts), world.mat(0xffffff, { vertexColors: true }));
      walls.receiveShadow = true;
      walls.castShadow = true;
      scene.add(walls);

      const SPONSORS = [
        { text: 'SUNNY SPORTS', color: '#FFFFFF', bg: '#8E5BE0' },
        { text: 'FIZZ POP', color: '#2F3B52', bg: '#FFC93C' },
        { text: 'ACE JUICE', color: '#FFFFFF', bg: '#FF5A5F' },
      ];
      const panels = SPONSORS.map(() => []);
      let k = 0;
      const banner = (cx, cz, rotY) => {
        const g = new THREE.PlaneGeometry(3.9, 0.72);
        g.rotateY(rotY);
        g.translate(cx, 0.48, cz);
        panels[k % SPONSORS.length].push(g);
        k++;
      };
      for (const x of [-6.6, -2.2, 2.2, 6.6]) banner(x, -WALL_Z + 0.005, 0);
      for (const s of [-1, 1]) for (const z of [-15.3, -10.6, -5.9, 5.9, 10.6, 15.3]) banner(s * (WALL_X - 0.005), z, -s * Math.PI / 2);
      SPONSORS.forEach((sp, i) => {
        if (!panels[i].length) return;
        const m = new THREE.Mesh(world.mergeGeometries(panels[i]),
          world.mat(0xffffff, { map: world.texture('banner', { text: sp.text, color: sp.color, bg: sp.bg, width: 512, height: 96 }) }));
        scene.add(m);
      });
    }

    // Stands + one crowd for all of them
    const standRows = [];
    {
      const far = world.stands(scene, { x: 0, z: -WALL_Z - 0.5, width: 24, rows: 5, rise: 0.45, depth: 0.85, facing: 0, color: 0x8E5BE0 });
      standRows.push(...far.userData.rows);
      for (const s of [-1, 1]) {
        const st = world.stands(scene, { x: s * (WALL_X + 0.5), z: -1.5, width: 30, rows: 4, rise: 0.45, depth: 0.85, facing: -s * Math.PI / 2, color: 0x1FA2FF });
        standRows.push(...st.userData.rows);
      }
    }
    // (a thinner crowd below 'high': it is most of the frame's triangles)
    const crowd = world.crowd(scene, { rows: standRows, density: engine.quality === 'high' ? 0.42 : 0.3, spacing: 0.8, seed: ctx.seed });

    // Bounce marks (pool) + landing hint ring
    const marks = [];
    {
      const g = new THREE.CircleGeometry(0.06, 18);
      g.rotateX(-Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xEAF4FF, transparent: true, opacity: 0, depthWrite: false }));
        m.position.y = 0.012;
        m.renderOrder = 2;
        m.visible = false;
        scene.add(m);
        marks.push({ mesh: m, life: 0 });
      }
    }
    let markIndex = 0;
    const landing = new THREE.Mesh((() => { const g = new THREE.RingGeometry(0.17, 0.24, 28); g.rotateX(-Math.PI / 2); return g; })(),
      new THREE.MeshBasicMaterial({ color: 0xFFF59A, transparent: true, opacity: 0, depthWrite: false }));
    landing.position.y = 0.014;
    landing.renderOrder = 2;
    landing.visible = false;
    scene.add(landing);
    let landingT = 0;

    // Ball (drawn larger than life so it reads on a phone), blob shadow, trail
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12),
      world.mat(0xD7F04A, { kind: 'phong', shininess: 40, emissive: 0x3A4400 }));
    ballMesh.visible = false;
    scene.add(ballMesh);
    const ballShadow = world.blobShadow(0.1, 0.45);
    ballShadow.visible = false;
    scene.add(ballShadow);
    const trail = world.trail(ballMesh, { color: 0xF4FFB0, width: 0.07, length: 16, opacity: 0.5 });
    trail.visible = false;
    // Serve timing aid: a ring shrinks onto your tossed ball and closes on it at the moment to swipe.
    // During the toss a dark rim keeps the ball readable against the crowd.
    const apexRing = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 1.25, BALL_R * 1.8, 28),
      new THREE.MeshBasicMaterial({ color: 0xFFF59A, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    apexRing.visible = false;
    apexRing.renderOrder = 4;
    ballMesh.add(apexRing);
    const tossRim = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.92, BALL_R * 1.28, 24),
      new THREE.MeshBasicMaterial({ color: 0x1D2A44, transparent: true, opacity: 0.7, depthWrite: false }));
    tossRim.visible = false;
    tossRim.renderOrder = 3;
    ballMesh.add(tossRim);

    // =============================================================================================
    // Rackets & athletes
    // =============================================================================================

    function buildRacket(color) {
      const parts = [];
      const ring = new THREE.TorusGeometry(0.128, 0.012, 6, 30);
      ring.scale(1, 1.28, 1);
      ring.translate(0, RACKET_LEN, 0);
      parts.push(world.paint(ring, color));
      for (const s of [-1, 1]) {
        const th = new THREE.CylinderGeometry(0.009, 0.009, 0.17, 6);
        th.rotateZ(s * 0.32);
        th.translate(s * 0.028, 0.27, 0);
        parts.push(world.paint(th, color));
      }
      const handle = new THREE.CylinderGeometry(0.017, 0.015, 0.26, 8);
      handle.translate(0, 0.07, 0);
      parts.push(world.paint(handle, 0x2F3B52));
      const g = new THREE.Group();
      const frame = new THREE.Mesh(world.mergeGeometries(parts), world.mat(0xffffff, { vertexColors: true, kind: 'phong', shininess: 50 }));
      frame.castShadow = true;
      const sg = new THREE.CircleGeometry(0.118, 22);
      sg.scale(1, 1.28, 1);
      sg.translate(0, RACKET_LEN, 0);
      const strings = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      g.add(frame, strings);
      return g;
    }

    const _m4 = new THREE.Matrix4(), _ax = new V3(), _ay = new V3(), _az = new V3(), _fwd = new V3(0, 0, 1);
    function orientRacket(r, axis) {
      _ay.copy(axis).normalize();
      _az.copy(_fwd).addScaledVector(_ay, -_fwd.dot(_ay));
      if (_az.lengthSq() < 1e-4) _az.set(1, 0, 0);
      _az.normalize();
      _ax.crossVectors(_ay, _az);
      _m4.makeBasis(_ax, _ay, _az);
      r.quaternion.setFromRotationMatrix(_m4);
    }

    const _tmpL = new V3(), _tmpA = new V3();

    function makeAthlete(profile, idx, o) {
      const pal = pals.create(profile);
      const H = sideSign(idx);
      const netYaw = H > 0 ? Math.PI : 0;
      pal.setFacing(netYaw);
      scene.add(pal.root);
      const blob = world.blobShadow(0.42, 0.28);
      blob.visible = false;
      scene.add(blob);
      const hand = o.hand || 1;
      const racket = buildRacket(pals.OPTIONS.shirts[profile.shirt] || 0x8E5BE0);
      pal.attach(racket, hand > 0 ? 'R' : 'L');
      const a = {
        pal, idx, H, hand, netYaw, yaw: netYaw, blob, racket,
        pos: pal.root.position, vx: 0, vz: 0, tx: 0, tz: 0,
        vmax: o.vmax, accel: o.accel, react: 0, reactTime: o.react || 0,
        plan: null, swing: null, prep: null, frozen: false, busy: false, loop: null,
        axis: new V3(IDLE_AXIS[0] * hand, IDLE_AXIS[1], IDLE_AXIS[2]).normalize(), poseOn: false,
      };
      a.place = (x, z, yaw) => {
        a.pos.set(x, 0, z); a.vx = a.vz = 0; a.tx = x; a.tz = z; a.faceYaw = null; a.hero = false;
        a.yaw = yaw == null ? netYaw : yaw; pal.setFacing(a.yaw);
      };
      a.setTarget = (x, z) => { a.tx = clamp(x, -WALL_X + 0.6, WALL_X - 0.6); a.tz = H > 0 ? clamp(z, 1.0, WALL_Z - 0.6) : clamp(z, -WALL_Z + 0.6, -1.0); };
      /** World position where the racket meets the ball for this stroke from where the athlete stands. */
      a.contactPoint = (kind, out) => {
        const c = CONTACT[kind];
        return out.set(a.pos.x + H * hand * c.lat, c.y || 0, a.pos.z - H * c.fwd);
      };
      a.startSwing = (kind, tc, contactY, shadow) => {
        a.swing = { kind, t: 0, tc: Math.max(0.03, tc), y: contactY == null ? 0.95 : contactY, shadow: !!shadow };
        a.prep = null;
      };
      a.prepare = (kind, y) => { if (!a.swing) a.prep = { kind, y: y == null ? 0.95 : y }; };
      a.playLoop = name => { if (a.loop !== name && !a.busy) { a.loop = name; pal.play(name); } };
      a.oneShot = (name, expr) => {
        a.busy = true;
        if (expr) pal.setExpression(expr, 2.2);
        const p = pal.play(name);
        p.then(() => { a.busy = false; a.loop = null; });
        return p;
      };
      return a;
    }

    const HAND = ctx.save.settings && ctx.save.settings.leftHanded ? -1 : 1;   // Settings → Left-handed mirrors your swings
    const player = makeAthlete(me, 0, { vmax: PLAYER_VMAX, accel: PLAYER_ACCEL, react: PLAYER_REACT, hand: HAND });
    const cpu = makeAthlete(opp.profile, 1, MODE === 'rally' ? { vmax: 7.6, accel: 18, react: 0.05 } : cpuMotion(SKILL));
    const ath = [player, cpu];

    // The umpire: white shirt and a white cap with a purple peak, so the chair reads from the far
    // end; turned a little toward the main camera.
    const umpire = pals.create(Object.assign(pals.randomProfile(U.rng(4242), 'Umpire'), { shirt: 10, hairStyle: 0, hairColor: 6, glasses: 1, facial: 0 }), { detail: 'low', shadows: false });
    umpire.root.position.set(-(POST_X + 1.15), 1.52, 0);
    umpire.setFacing(Math.PI / 2 - 0.44);
    scene.add(umpire.root);
    {
      const crown = new THREE.SphereGeometry(0.255, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      crown.scale(1, 0.72, 1);
      crown.translate(0, 0.06, 0);
      const peak = new THREE.CylinderGeometry(0.2, 0.2, 0.025, 16, 1, false, -Math.PI / 2, Math.PI);
      peak.translate(0, 0.07, 0.14);
      const cap = new THREE.Mesh(world.mergeGeometries([world.paint(crown, 0xFFFFFF), world.paint(peak, 0x8E5BE0)]),
        world.mat(0xffffff, { vertexColors: true, kind: 'phong', shininess: 40 }));
      umpire.parts.head.add(cap);
    }

    // Pose evaluation ------------------------------------------------------------------------------
    const _pr = new V3(), _pl = new V3();
    function keyPose(K, y, out) {
      out.r[0] = K.r[0]; out.r[1] = y == null ? K.r[1] : y; out.r[2] = K.r[2];
      out.l[0] = K.l[0]; out.l[1] = K.l[1]; out.l[2] = K.l[2];
      out.ax[0] = K.ax[0]; out.ax[1] = K.ax[1]; out.ax[2] = K.ax[2];
      out.tw = K.tw; out.lean = K.lean; out.cr = K.cr;
      return out;
    }
    /** Left-handers: the keyframes mirrored across the Pal's own centre line (r = racket hand). */
    function applyPose(a, P, lambda) {
      const m = a.hand;
      const racketHand = _pr.set(P.r[0] * m, P.r[1], P.r[2]), freeHand = _pl.set(P.l[0] * m, P.l[1], P.l[2]);
      a.pal.pose({
        handR: m > 0 ? racketHand : freeHand, handL: m > 0 ? freeHand : racketHand,
        twist: P.tw * m, lean: P.lean, crouch: P.cr, stance: 0.65,
      }, { lambda });
      _tmpA.set(P.ax[0] * m, P.ax[1], P.ax[2]).normalize();
    }
    const mkPose = () => ({ r: [0, 0, 0], l: [0, 0, 0], ax: [0, 0, 0], tw: 0, lean: 0, cr: 0 });
    const _pa = mkPose(), _pb = mkPose(), _pc = mkPose();
    function mixPose(a, b, k, out) {
      for (let i = 0; i < 3; i++) {
        out.r[i] = lerp(a.r[i], b.r[i], k); out.l[i] = lerp(a.l[i], b.l[i], k); out.ax[i] = lerp(a.ax[i], b.ax[i], k);
      }
      out.r[2] += Math.sin(k * Math.PI) * 0.12;   // swing arc bulges forward
      out.tw = lerp(a.tw, b.tw, k); out.lean = lerp(a.lean, b.lean, k); out.cr = lerp(a.cr, b.cr, k);
      return out;
    }
    function hitY(kind, y) {
      if (kind === 'oh') return null;
      return clamp(y - KEYS[kind].hit.ax[1] * RACKET_LEN, 0.35, 1.55);
    }

    function updateAthletePose(a, dt) {
      const pal = a.pal;
      let P = null, lambda = 12;
      if (a.swing) {
        const s = a.swing, K = KEYS[s.kind];
        s.t += dt;
        const hit = keyPose(K.hit, hitY(s.kind, s.y), _pb);
        if (s.t < s.tc) P = mixPose(keyPose(K.prep, null, _pa), hit, U.ease.inQuad(s.t / s.tc), _pc);
        else if (s.t < s.tc + 0.2) P = mixPose(hit, keyPose(K.fol, null, _pa), U.ease.outQuad((s.t - s.tc) / 0.2), _pc);
        else P = keyPose(K.fol, null, _pc);
        lambda = 45;
        if (s.t > s.tc + 0.45) { a.swing = null; P = null; }
      } else if (a.prep) {
        P = keyPose(KEYS[a.prep.kind].prep, null, _pc);
        lambda = 10;
      }
      if (P) {
        applyPose(a, P, lambda);
        a.poseOn = true;
      } else if (a.hero) {
        // close-up celebration: the racket hand stays low so the racket never covers the face
        pal.pose({ [a.hand > 0 ? 'handR' : 'handL']: _pr.set(-0.45 * a.hand, 0.8, 0.1) }, { lambda: a.heroSnap ? Infinity : 8 });
        if (a.heroSnap) { a.heroSnap = false; a.axis.set(IDLE_AXIS[0] * a.hand, IDLE_AXIS[1], IDLE_AXIS[2]).normalize(); }
        a.poseOn = true;
        _tmpA.set(IDLE_AXIS[0] * a.hand, IDLE_AXIS[1], IDLE_AXIS[2]).normalize();
      } else {
        if (a.poseOn) { pal.releasePose(0.25); a.poseOn = false; }
        _tmpA.set(IDLE_AXIS[0] * a.hand, IDLE_AXIS[1], IDLE_AXIS[2]).normalize();
      }
      U.dampVec3(a.axis, _tmpA, P ? 40 : 10, dt);
      orientRacket(a.racket, a.axis);
    }

    /** Steering toward the target (arrive), accel-limited. Runs on the physics clock. */
    function moveAthlete(a, dt) {
      if (a.frozen) { a.vx = U.damp(a.vx, 0, 10, dt); a.vz = U.damp(a.vz, 0, 10, dt); }
      else {
        const dx = a.tx - a.pos.x, dz = a.tz - a.pos.z, d = Math.hypot(dx, dz);
        const want = d < 0.02 ? 0 : Math.min(a.vmax, Math.sqrt(2 * a.accel * 0.8 * d));
        const wx = d > 1e-4 ? dx / d * want : 0, wz = d > 1e-4 ? dz / d * want : 0;
        let ddx = wx - a.vx, ddz = wz - a.vz;
        const dl = Math.hypot(ddx, ddz), lim = a.accel * dt;
        if (dl > lim) { ddx *= lim / dl; ddz *= lim / dl; }
        a.vx += ddx; a.vz += ddz;
      }
      a.pos.x += a.vx * dt; a.pos.z += a.vz * dt;
    }

    function updateAthlete(a, dt) {
      const sp = Math.hypot(a.vx, a.vz);
      // Facing: the net, leaning into lateral runs.
      let yawT = a.faceYaw != null ? a.faceYaw : a.netYaw;
      if (sp > 1.4 && !a.swing && !a.prep && a.faceYaw == null) {
        const motion = Math.atan2(a.vx, a.vz);
        yawT = a.netYaw + clamp(U.angleDiff(a.netYaw, motion), -1.1, 1.1) * U.smoothstep(1.4, 4, sp);
      }
      a.yaw += U.angleDiff(a.yaw, yawT) * (1 - Math.exp(-10 * dt));
      a.pal.setFacing(a.yaw);
      if (!a.busy) {
        if (sp > 0.5) { a.playLoop('run'); a.pal.setSpeed(Math.max(1.6, sp)); }
        else a.playLoop('idle_ready');
      }
      updateAthletePose(a, dt);
      a.pal.lookAt(a.hero ? camera.position : ball.live || ballMesh.visible ? ballMesh.position : null);
      a.blob.visible = !engine.tier || !engine.tier.shadows;
      if (a.blob.visible) a.blob.position.set(a.pos.x, 0.012, a.pos.z);
    }

    // =============================================================================================
    // Camera rig: solved framing per aspect + gentle lateral follow + short hero shots
    // =============================================================================================

    const camRig = {
      aspect: -1, dirty: true, pos: new V3(), pitch: 0, follow: 0, zf: 0, push: 0,
      shot: null, w: 0, lastReal: -1, memo: new Map(), baseFov: 40,
    };
    const _cp = new V3(), _ce = new THREE.Euler(), _cq = new THREE.Quaternion(), _cf = new V3(), _cl = new V3(), _cr = new V3();
    const COURT_PTS = [[-HALF_W, -HALF_L], [HALF_W, -HALF_L], [HALF_W, 0], [-HALF_W, 0]];   // the far half: hardest to read

    /** Points that must stay in frame: far baseline + the far Pal, the near court and a deep-standing near Pal. */
    function framePoints(aspect) {
      const P = [[-4.4, 0, -HALF_L], [4.4, 0, -HALF_L], [-2.2, 1.9, -HALF_L - 1.2], [2.2, 1.9, -HALF_L - 1.2]];
      if (aspect < 0.8) {
        // portrait: the alleys may crop at the near corners; a Pal receiving deep keeps head and feet in frame
        P.push([-2.8, 0, HALF_L], [2.8, 0, HALF_L], [-1.0, 0, HALF_L + 1.6], [1.0, 0, HALF_L + 1.6], [-1.0, 1.5, HALF_L + 1.6], [1.0, 1.5, HALF_L + 1.6]);
      } else if (aspect > 1.6) {
        // phone landscape: the near alleys may crop; your Pal at the baseline stays in head to toe
        // (the camera eases back when it plays from deeper), so the far half reads bigger
        P.push([-4.4, 0, HALF_L - 2.5], [4.4, 0, HALF_L - 2.5], [-1.6, 0, HALF_L + 0.9], [1.6, 0, HALF_L + 0.9], [-1.6, 1.5, HALF_L + 0.9], [1.6, 1.5, HALF_L + 0.9]);
      } else {
        // landscape: the near Pal may crop at the knees, so the far half can be framed bigger
        P.push([-4.7, 0, HALF_L], [4.7, 0, HALF_L], [-1.6, 0.5, HALF_L + 1.6], [1.6, 0.5, HALF_L + 1.6]);
      }
      return P;
    }

    /**
     * Solves a broadcast framing for the current aspect: searches pitch, height and distance (coarse,
     * then refined) for the camera that shows the far half of the court biggest while keeping both
     * baselines, both Pals and the near court inside the safe area (clear of the scoreboard and the
     * bottom chips). Memoised per aspect & HUD inset.
     */
    function frameCamera() {
      const aspect = engine.size.aspect || 1;
      camRig.aspect = aspect;
      camRig.dirty = false;
      const wide = aspect > 1.15;
      hudTop.className = wide ? 'ss-hud-tr' : 'ss-hud-top';
      hudBottom.className = (wide ? 'ss-hud-bl' : 'ss-hud-bottom') + ' tn-bottom';   // wide: chips out of your Pal's way
      skipChip.classList.toggle('low', wide);
      tbar.classList.toggle('dock', engine.size.h <= 520);
      const t = clamp((aspect - 0.5) / (1.6 - 0.5), 0, 1);
      // A longish lens: flatter perspective keeps the far half (where the CPU plays) and both Pals readable.
      const vFov = aspect > 1.6 ? 25 : lerp(44, 32, t);
      const prefPitch = lerp(32, 29, t);
      const H = Math.max(1, engine.size.h);
      const boardBottom = !wide && hudTop.isConnected ? hudTop.getBoundingClientRect().bottom : 40;
      // wide: the board sits top-right and the chips bottom-left, so the centre column runs edge to edge
      const yTop = wide ? 1 - 2 * 14 / H : Math.min(0.8, 1 - 2 * (boardBottom + 10) / H), yBot = -1 + 2 * (wide ? 10 : 58) / H, xLim = 0.94;
      camRig.baseFov = vFov;
      engine.fitCamera(camera, { vFov, minHFov: 10 });
      const key = aspect.toFixed(2) + '|' + Math.round(yTop * 100) + '|' + Math.round(yBot * 100);
      const memo = camRig.memo.get(key);
      if (memo) { camRig.pos.set(0, memo[0], memo[1]); camRig.pitch = memo[2]; return; }
      const tv = Math.tan(camera.fov * Math.PI / 360), th = tv * aspect;
      const pts = framePoints(aspect);
      const area = (h, z, sp, cp) => {
        let a2 = 0;
        for (let i = 0; i < 4; i++) {
          const P = COURT_PTS[i], Q = COURT_PTS[(i + 1) % 4];
          const pd0 = h * sp - (P[1] - z) * cp, qd0 = h * sp - (Q[1] - z) * cp;
          const px = P[0] / (pd0 * th) * aspect, py = (-h * cp - (P[1] - z) * sp) / (pd0 * tv);
          const qx = Q[0] / (qd0 * th) * aspect, qy = (-h * cp - (Q[1] - z) * sp) / (qd0 * tv);
          a2 += px * qy - qx * py;
        }
        return Math.abs(a2) / 2;
      };
      const fits = (h, z, sp, cp) => {
        for (const p of pts) {
          const dy = p[1] - h, dz = p[2] - z;
          const depth = -dy * sp - dz * cp;
          if (depth < 0.5) return false;
          const xs = p[0] / (depth * th), ys = (dy * cp - dz * sp) / (depth * tv);
          if (xs < -xLim || xs > xLim || ys > yTop || ys < yBot) return false;
        }
        return true;
      };
      let best = null, bestScore = Infinity;
      const pitchLo = prefPitch - 6, pitchHi = prefPitch + (aspect < 0.8 ? 14 : aspect > 1.6 ? 20 : 9);
      const search = (p0, p1, pStep, h0, h1, hStep, zStep) => {
        for (let pd = p0; pd <= p1 + 1e-6; pd += pStep) {
          const pitch = pd * Math.PI / 180, sp = Math.sin(pitch), cp = Math.cos(pitch);
          for (let h = Math.max(2, h0); h <= h1 + 1e-6; h += hStep) {
            for (let z = HALF_L; z <= HALF_L + 40; z += zStep) {
              if (!fits(h, z, sp, cp)) continue;
              const score = -area(h, z, sp, cp) * (1 - (aspect > 1.6 ? 0.008 : 0.025) * Math.abs(pd - prefPitch));
              if (score < bestScore) { bestScore = score; best = [h, z, pitch, pd]; }
              break;
            }
          }
        }
      };
      search(pitchLo, pitchHi, 3, 2, 28, 1, 1);
      if (best) {
        const [h, , , pd] = best;
        search(Math.max(pitchLo, pd - 3), Math.min(pitchHi, pd + 3), 0.75, h - 1.5, h + 1.5, 0.25, 0.2);
      }
      if (!best) best = [12, HALF_L + 22, prefPitch * Math.PI / 180];
      camRig.memo.set(key, best);
      camRig.pos.set(0, best[0], best[1]);
      camRig.pitch = best[2];
    }

    /**
     * Camera shots blend from the rally view on an arc around their subject (never a quaternion slerp,
     * so nothing whip-pans through the stands), timed in real seconds so slow-mo doesn't stretch them.
     */
    function startShot(kind, pos, look, seconds, blendIn, o) {
      pos.x = clamp(pos.x, -WALL_X + 0.5, WALL_X - 0.5);
      pos.z = clamp(pos.z, -WALL_Z + 0.5, WALL_Z - 0.5);
      const delay = (o && o.delay) || 0;
      camRig.shot = { kind, pos, look, until: seconds + delay, delay, rate: 1 / Math.max(0.05, blendIn), outRate: 1 / 0.45,
        fov: o && o.fov, subject: o && o.subject };
    }
    /**
     * Celebratory close-up: from beside and behind a Pal, so a side stand full of crowd is the
     * backdrop; the Pal turns to the camera. Distance fits a ~2.2 m tall, 1.8 m wide frame.
     */
    function heroShot(a, seconds, reframe) {
      const side = a.pos.x > 0 ? -1 : 1;
      const tv = Math.tan(camRig.baseFov * Math.PI / 360), th = tv * engine.size.aspect;
      const dist = clamp(Math.max(1.15 / tv, 0.95 / th), 3, 7);
      const dir = new V3(side * 0.86, 0, a.H * 0.5).normalize();
      const pos = new V3(a.pos.x + dir.x * dist, 1.3, a.pos.z + dir.z * dist);
      // the racket drops out of the follow-through first, so the close-up never lands on a covered face
      startShot('hero', pos, new V3(a.pos.x, 0.9, a.pos.z), seconds, 0.55, { delay: reframe ? 0 : 0.2, subject: a });
      a.faceYaw = Math.atan2(camRig.shot.pos.x - a.pos.x, camRig.shot.pos.z - a.pos.z);
      if (!reframe) { a.swing = null; a.prep = null; a.heroSnap = true; }
      a.hero = true;
    }
    /**
     * Over-the-shoulder push-in for your serve, looking at the far service box: the camera sits
     * behind the Pal on the racket side, offset just enough to put the Pal off-centre for this lens.
     */
    function serveShot(a) {
      // Distance: far enough that the frame spans the top of a high toss down to the Pal's knees;
      // aimed high enough that the toss sits against the sky. The shot has its own lens: wide
      // landscape's long rally lens would have to back off into the stands to fit the whole motion.
      const fov = Math.max(camRig.baseFov, 38);
      const CAM_Y = 2.1, half = fov * Math.PI / 360;
      let D = 5;
      while (D < 12 && Math.atan((TOSS_HIGH + 0.1 - CAM_Y) / D) - Math.atan((0.45 - CAM_Y) / D) > 1.6 * half) D += 0.25;
      const mid = Math.max(-0.07, (Math.atan((TOSS_HIGH + 0.1 - CAM_Y) / D) + Math.atan((0.45 - CAM_Y) / D)) / 2);
      const look = new V3(pt.boxSign * 1.6, 0, -a.H * 4.5);
      const th = Math.tan(half) * engine.size.aspect;
      const lat = Math.min(1.2, 0.45 * th * D) * a.H * a.hand;
      const dx = a.pos.x - look.x, dz = a.pos.z - look.z, dl = Math.hypot(dx, dz);
      look.y = CAM_Y + Math.tan(mid) * (dl + D);
      const pos = new V3(a.pos.x + dx / dl * D - dz / dl * lat, CAM_Y, a.pos.z + dz / dl * D + dx / dl * lat);
      startShot('serve', pos, look, 30, 0.25, { fov, subject: a });
    }
    /** After a resize / rotation: the active close shot is re-solved for the new screen. */
    function reframeShot() {
      const sh = camRig.shot;
      if (sh && sh.until > 0) {
        if (sh.kind === 'serve' && (phase === 'serveReady' || phase === 'toss') && score.server === 0) serveShot(player);
        else if (sh.kind === 'hero' && sh.subject) heroShot(sh.subject, sh.until, true);
      }
      if (hints.active && hints.args) showHint(...hints.args);
    }
    /** Ends the current shot of this kind after `delay` real seconds, blending back over outSeconds. */
    function endShot(kind, delay, outSeconds) {
      const sh = camRig.shot;
      if (!sh || (kind && sh.kind !== kind)) return;
      sh.until = Math.min(sh.until, delay || 0);
      if (outSeconds) sh.outRate = 1 / outSeconds;
    }
    function cutToBase() { camRig.shot = null; camRig.w = 0; }

    function updateCamera() {
      const now = engine.realTime;
      const rdt = camRig.lastReal < 0 ? 0 : clamp(now - camRig.lastReal, 0, 0.1);
      camRig.lastReal = now;
      if (camRig.dirty || Math.abs(engine.size.aspect - camRig.aspect) > 1e-3) { frameCamera(); reframeShot(); }
      camRig.follow = U.damp(camRig.follow, clamp(player.pos.x, -6, 6) * 0.38, 2.5, rdt);
      camRig.zf = U.damp(camRig.zf, Math.max(0, player.pos.z - (camRig.aspect > 1.6 ? 12.6 : 13.2)) * (camRig.aspect > 1.6 ? 1 : 0.7), 2.5, rdt);
      camRig.push = U.damp(camRig.push, 0, 1.5, rdt);
      _ce.set(-camRig.pitch, 0, 0);
      _cq.setFromEuler(_ce);
      _cf.set(0, 0, -1).applyQuaternion(_cq);
      _cp.copy(camRig.pos); _cp.x += camRig.follow; _cp.z += camRig.zf;
      _cp.addScaledVector(_cf, camRig.push * 2.2);              // big-moment push-in
      const sh = camRig.shot;
      if (sh) {
        sh.until -= rdt;
        if (sh.delay > 0) sh.delay -= rdt;
        else camRig.w = sh.until > 0 ? Math.min(1, camRig.w + rdt * sh.rate) : Math.max(0, camRig.w - rdt * sh.outRate);
        if (sh.until <= 0 && camRig.w <= 0) camRig.shot = null;
      } else camRig.w = 0;
      // a shot with its own lens eases the field of view along with the move
      const fov = camRig.shot && camRig.shot.fov ? lerp(camRig.baseFov, camRig.shot.fov, U.ease.inOutCubic(camRig.w)) : camRig.baseFov;
      if (Math.abs(camera.userData.fit.vFov - fov) > 0.01) engine.fitCamera(camera, { vFov: fov, minHFov: 10 });
      if (!camRig.shot || camRig.w <= 0) {
        camera.position.copy(_cp);
        camera.quaternion.copy(_cq);
        return;
      }
      const k = U.ease.inOutCubic(camRig.w), L = sh.look;
      // arc: azimuth, radius and height around the subject, interpolated
      const r0x = _cp.x - L.x, r0z = _cp.z - L.z, r1x = sh.pos.x - L.x, r1z = sh.pos.z - L.z;
      const az0 = Math.atan2(r0x, r0z), az = az0 + U.angleDiff(az0, Math.atan2(r1x, r1z)) * k;
      const rad = lerp(Math.hypot(r0x, r0z), Math.hypot(r1x, r1z), k), hgt = lerp(_cp.y, sh.pos.y, k);
      camera.position.set(L.x + Math.sin(az) * rad, hgt, L.z + Math.cos(az) * rad);
      // look target slides from straight ahead of the rally view onto the subject
      _cl.copy(_cp).addScaledVector(_cf, _cr.subVectors(L, _cp).length());
      _cl.lerp(L, k);
      camera.quaternion.copy(_cq);
      camera.lookAt(_cl);
    }

    // =============================================================================================
    // HUD
    // =============================================================================================

    ui.css('tn-hud', [
      '.tn-board{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto;align-items:center;gap:3px 6px;padding:6px 9px;border-radius:16px;color:var(--ink)}',
      '.tn-board .srv{width:10px;height:10px;border-radius:50%;background:#D7F04A;box-shadow:inset 0 0 0 2px #9BB21F;opacity:0;transition:opacity .2s}',
      '.tn-board .srv.on{opacity:1}',
      '.tn-board .pic{width:26px;height:26px;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 50% 32%,#fff,#D6EAFB 72%)}',
      '.tn-board .pic img,.tn-board .pic canvas{width:100%;height:100%;display:block}',
      '.tn-board .nm{max-width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 15px/1.1 var(--font-display)}',
      '.tn-board .gm{min-width:24px;text-align:center;padding:4px 0 3px;border-radius:8px;background:var(--tint);color:var(--accent);font:700 16px/1 var(--font-display)}',
      '.tn-board .pt{min-width:34px;text-align:center;padding:4px 3px 3px;border-radius:8px;background:var(--accent);color:#fff;font:700 16px/1 var(--font-display);transition:transform .2s}',
      '.tn-board .pt.bump{animation:tn-bump .45s cubic-bezier(.3,1.6,.5,1)}',
      '.tn-board.rally{grid-template-columns:auto auto auto;gap:4px 10px}',
      '.tn-board .lbl{font:800 11px/1 var(--font-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft)}',
      '.tn-board .big{font:700 24px/1 var(--font-display);color:var(--accent);text-align:center}',
      '.tn-balls{display:flex;gap:4px;justify-content:center}',
      '.tn-balls i{width:12px;height:12px;border-radius:50%;background:#D7F04A;box-shadow:inset 0 0 0 2px #9BB21F}',
      '.tn-balls i.off{background:#DDE3EA;box-shadow:inset 0 0 0 2px #C3CCD6}',
      '.tn-bottom{gap:8px}',
      '.tn-board.quick .gm{display:none}',
      '.tn-board.quick{grid-template-columns:auto auto minmax(0,1fr) auto}',
      '.tn-board .hd{font:800 9px/1 var(--font-ui);letter-spacing:.08em;color:var(--ink-soft);text-align:center;margin-bottom:-2px}',
      '.tn-call{align-self:center;margin-top:6px;padding:5px 14px;border-radius:999px;background:rgba(20,32,56,.78);color:#fff;font:700 15px/1.1 var(--font-display);letter-spacing:.04em;white-space:nowrap;transition:opacity .25s}',
      '.tn-call.off{opacity:0}',
      '.ss-hud-top .tn-call{margin-left:auto;margin-right:auto}',
      '.ss-hud-tr .tn-call{margin-left:auto}',
      '.tn-col{display:flex;flex-direction:column;align-items:stretch}',
      '.tn-skip{position:absolute;left:50%;bottom:calc(var(--sab) + 52px);transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:rgba(20,32,56,.45);color:#fff;font:800 12px/1.2 var(--font-ui);letter-spacing:.06em;text-transform:uppercase;opacity:0;transition:opacity .3s;pointer-events:none}',
      '.tn-skip.on{opacity:.85}',
      '.tn-skip.low{bottom:calc(var(--sab) + 14px)}',
      '.tn-tbar{position:absolute;left:0;top:0;width:132px;margin-left:-66px;pointer-events:none;opacity:0;transition:opacity .2s}',
      '.tn-tbar.on{opacity:1}',
      '.tn-tbar.dock{left:auto;top:auto;right:calc(var(--sar) + 16px);bottom:calc(var(--sab) + 14px);margin-left:0;transform:none!important}',
      '.tn-tbar .tr{position:relative;height:8px;border-radius:4px;box-shadow:0 1px 3px rgba(10,30,60,.35);background:linear-gradient(90deg,#FF8A3D 0 20.6%,#fff 20.6% 36.8%,#FFC93C 36.8% 63.2%,#fff 63.2% 79.4%,#FF8A3D 79.4%)}',
      '.tn-tbar .mk{position:absolute;top:-5px;width:5px;height:18px;margin-left:-2.5px;border-radius:3px;background:#2F3B52;box-shadow:0 0 0 1.5px #fff}',
      '.tn-tbar .lb{display:flex;justify-content:space-between;margin-top:3px;font:800 10px/1 var(--font-ui);letter-spacing:.06em;color:#fff;text-shadow:0 1px 2px rgba(10,30,60,.6)}',
      '.ss-hint.tn-hint .ss-hint-text{max-width:180px;font-size:15px}',
      '.tn-chip-hot{background:var(--accent)!important;color:#fff!important}',
      '@media (max-width: 359px){.tn-board:not(.rally) .pic,.tn-board .hp{display:none}.tn-board:not(.rally){grid-template-columns:auto minmax(0,1fr) auto auto}.tn-board.quick{grid-template-columns:auto minmax(0,1fr) auto}}',
      '.tn-pulse{animation:tn-bump .5s cubic-bezier(.3,1.6,.5,1)}',
      '@keyframes tn-bump{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}',
    ].join('\n'));

    const hudTop = ui.el('div', 'ss-hud-top');
    const topCol = ui.el('div', 'tn-col');
    const board = ui.el('div', 'tn-board ss-panel ss-pop' + (MODE === 'quick' ? ' quick' : ''));
    const callChip = ui.el('div', 'tn-call off');
    topCol.append(board, callChip);
    hudTop.appendChild(topCol);
    const hudBottom = ui.el('div', 'ss-hud-bottom tn-bottom');
    const infoChip = ui.el('div', 'ss-chip dark ss-hidden');
    const rallyChip = ui.el('div', 'ss-chip ss-hidden');
    hudBottom.append(infoChip, rallyChip);
    const skipChip = ui.el('div', 'tn-skip', 'Tap to continue');
    const tbar = ui.el('div', 'tn-tbar', '<div class="tr"><i class="mk"></i></div><div class="lb"><span>EARLY</span><span>LATE</span></div>');
    ctx.hud.append(hudTop, hudBottom, skipChip, tbar);
    const rows = [];

    function buildBoard() {
      board.innerHTML = '';
      if (MODE === 'rally') {
        board.classList.add('rally');
        const pic = ui.el('div', 'pic');
        pic.appendChild(ui.portraitImg(me, 52));
        const c1 = ui.el('div', '', '<div class="lbl">Streak</div><div class="big tn-streak">0</div>');
        const c2 = ui.el('div', '', '<div class="lbl">Best</div><div class="big tn-best">0</div>');
        const balls = ui.el('div', 'tn-balls');
        board.append(pic, c1, c2);
        const wrap = ui.el('div', '');
        wrap.style.gridColumn = '1 / -1';
        wrap.appendChild(balls);
        board.appendChild(wrap);
        rows.push({ streak: c1.querySelector('.tn-streak'), best: c2.querySelector('.tn-best'), balls });
        return;
      }
      if (MODE === 'match') {
        board.append(ui.el('i', ''), ui.el('i', 'hp'), ui.el('i', ''));
        board.append(ui.el('div', 'hd', 'G'), ui.el('div', 'hd', 'PTS'));
      }
      for (const [i, prof] of [[0, me], [1, opp.profile]]) {
        const srv = ui.el('i', 'srv');
        const pic = ui.el('div', 'pic');
        pic.appendChild(ui.portraitImg(prof, 52));
        const nm = ui.el('div', 'nm');
        nm.textContent = prof.name;
        const gm = ui.el('div', 'gm', '0');
        const pt = ui.el('div', 'pt', '0');
        board.append(srv, pic, nm);
        if (MODE !== 'quick') board.appendChild(gm);
        board.appendChild(pt);
        rows[i] = { srv, gm, pt };
      }
    }

    function renderBoard(bumpIdx) {
      if (MODE === 'rally') {
        const r = rows[0];
        r.streak.textContent = String(rallyState.streak);
        r.best.textContent = String(rallyState.best);
        r.balls.innerHTML = '';
        for (let i = 0; i < 3; i++) r.balls.appendChild(ui.el('i', i < rallyState.lives ? '' : 'off'));
        return;
      }
      const [a, b] = score.pts, gw = gameWinner();
      for (let i = 0; i < 2; i++) {
        const r = rows[i];
        r.srv.classList.toggle('on', score.server === i);
        r.gm.textContent = String(score.games[i]);
        let t;
        if (gw === i) t = 'GAME';
        else if (gw >= 0) t = '';
        else if (a >= 3 && b >= 3) t = score.pts[i] > score.pts[1 - i] ? 'AD' : '40';
        else t = BOARD_PTS[Math.min(3, score.pts[i])];
        r.pt.textContent = t;
        if (bumpIdx === i) { r.pt.classList.remove('bump'); void r.pt.offsetWidth; r.pt.classList.add('bump'); }
      }
    }

    // The info chip shows a standing label (match point, deuce…) that short flashes (serve speed) can cover.
    const info = { text: '', hot: false, timer: 0 };
    function showChip(text, hot) {
      infoChip.textContent = text || '';
      infoChip.classList.toggle('ss-hidden', !text);
      infoChip.classList.toggle('tn-chip-hot', !!hot);
      if (text) { infoChip.classList.remove('ss-pop'); void infoChip.offsetWidth; infoChip.classList.add('ss-pop'); }
    }
    function setInfo(text, hot) {
      info.text = text || ''; info.hot = !!hot;
      if (info.timer <= 0) showChip(info.text, info.hot);
    }
    function flashInfo(text, seconds) {
      info.timer = seconds;
      showChip(text, true);
    }
    function updateInfo(dt) {
      if (info.timer > 0) { info.timer -= dt; if (info.timer <= 0) showChip(info.text, info.hot); }
    }

    function setRallyChip(n) {
      const show = n >= 3;
      rallyChip.classList.toggle('ss-hidden', !show);
      if (show) {
        const text = 'Rally ' + n;
        if (rallyChip.textContent !== text) {
          rallyChip.textContent = text;
          rallyChip.classList.remove('ss-pop'); void rallyChip.offsetWidth; rallyChip.classList.add('ss-pop');
        }
      }
    }

    const _pp = new V3();
    /** Pop-up text clear above a Pal's head (never on the Pal or the ball at contact); `lift` stacks extra ones. */
    function popupAt(a, text, color, lift) {
      _pp.set(a.pos.x, a.pal.height + 0.05, a.pos.z);
      const s = engine.project(_pp, camera), { w } = engine.size;
      if (!s.visible) return;
      ui.scorePopup(text, clamp(s.x, 70, w - 70), Math.max(70, s.y - 44 - (lift || 0)), { color });
    }

    /** Mini timing bar under the Pal (±170 ms, perfect band in the middle) while timing aids are on. */
    let tbarT = 0;
    const timingAids = () => hintsAllowed() && !autoplay && (MODE === 'rally' ? stats.swings < 30 : score.games[0] + score.games[1] < 3);
    function showTimingBar(a, err) {
      if (!timingAids()) return;
      tbar.querySelector('.mk').style.left = clamp(50 + err / T_EARLY_MAX * 50, 2, 98) + '%';
      tbar.classList.add('on');
      tbarT = 1.2;
      placeTimingBar();
    }
    /** Keeps the bar under your Pal's feet (on screen even while the camera is pushed in). */
    function placeTimingBar() {
      if (tbar.classList.contains('dock')) return;           // short landscape: docked in the corner
      _pp.set(player.pos.x, 0, player.pos.z);
      const s = engine.project(_pp, camera), { w, h } = engine.size;
      if (s.behind) return;
      tbar.style.transform = 'translate(' + Math.round(clamp(s.x, 80, w - 80)) + 'px,' + Math.round(clamp(s.y + 12, h * 0.3, h - 96)) + 'px)';
    }
    function updateTimingBar(dt) {
      if (tbarT <= 0) return;
      if ((tbarT -= dt) <= 0) tbar.classList.remove('on');
      else placeTimingBar();
    }

    // Gesture hints: shown until you've got the hang of it (remembered across sessions), never when
    // Settings → Hints is off. The core hides them too; checking here also skips the placement work.
    const hints = { serve: 0, swing: 0, active: null, goodServes: 0, goodHits: 0 };
    const hintsAllowed = () => ctx.save.settings.hints !== false;
    const coaching = () => hintsAllowed() && !autoplay && !ctx.save.isSeen('tennis.hints.learned');
    function learned(kind) {
      if (kind === 'serve') hints.goodServes++; else hints.goodHits++;
      if (hints.goodServes >= 2 && hints.goodHits >= 4) ctx.save.seen('tennis.hints.learned');
    }
    /**
     * Gesture hint beside your Pal on the side away from the incoming ball (never between the net and
     * the Pal), kept fully on screen; short landscape uses the core's corner spot.
     */
    function showHint(gesture, text, awayX) {
      hideHint();
      if (!coaching()) return;
      hints.args = [gesture, text, awayX];
      const { w, h } = engine.size;
      if (h <= 520) { hints.active = ui.hint({ gesture, text }); hints.active.el.classList.add('tn-hint'); return; }
      _pp.set(player.pos.x, 0.9, player.pos.z);
      const s = engine.project(_pp, camera);
      const serving = phase === 'serveReady' || phase === 'toss';
      const side = awayX != null ? (awayX > player.pos.x ? -1 : 1) : (s.x < w / 2 ? 1 : -1);
      const hd = ui.hint({ gesture, text, x: s.x + side * w * 0.3, y: clamp(s.y - 30, h * 0.45, h - 150) });
      hd.el.classList.add('tn-hint');
      hints.active = hd;
      if (!hd.el.isConnected) return;
      const r = hd.el.getBoundingClientRect();
      let x, y;
      if (serving) {
        // the close serve view: in the free corner beside the Pal, above the bottom chip
        x = side > 0 ? w - 12 - r.width / 2 : 12 + r.width / 2;
        y = h - 64 - r.height / 2;
      } else {
        x = s.x + side * (r.width / 2 + 40);
        if (x - r.width / 2 < 12 || x + r.width / 2 > w - 12) x = s.x - side * (r.width / 2 + 40);   // no room: other side
        y = clamp(s.y - 30, h * 0.45, h - 64 - r.height / 2);
      }
      hd.el.style.left = clamp(x, 12 + r.width / 2, w - 12 - r.width / 2) + 'px';
      hd.el.style.top = y + 'px';
    }
    function hideHint() { if (hints.active) { hints.active.hide(); hints.active = null; } }

    // =============================================================================================
    // Match state
    // =============================================================================================

    const ball = newBall();
    ball.live = false;
    let simTime = 0, acc = 0;
    let phase = 'intro';                 // intro · serveReady · cpuServeWait · toss · feed · feedSwing · play · fault · pointOver · done
    let flow = 0, skipFn = null;
    const pending = [];                  // scheduled contacts / swings, processed on the physics clock
    const score = { pts: [0, 0], games: [0, 0], server: 0, serveNo: 1 };
    const pt = {
      phase: 'idle', hitter: -1, bounces: 0, shots: 0, netTouch: false,
      decided: false, decidedAt: -1, lastHitAt: 0, boxSign: 1, tossHit: 0, serveSwung: false, lastKind: '',
    };
    const stats = {
      won: [0, 0], aces: [0, 0], winners: [0, 0], errors: [0, 0], doubles: [0, 0],
      fastest: 0, longest: 0, firstIn: 0, firstTotal: 0, perfect: 0, swings: 0,
    };
    const rallyState = { streak: 0, best: 0, lives: 3 };
    let autoplay = false;
    const auto = { tossAt: -1, serveAt: -1, swingAt: -1, plan: null, opts: { sd: 0.035 } };
    let ambience = null;
    let lastShot = null;

    function nextFlow() { flow += 1; skipFn = null; return flow; }
    function later(id, s) { return ctx.wait(s).then(() => id === flow); }

    // Holds between points run on real time (slow-mo never stretches them; a sped-up debug clock
    // still shortens them), can be skipped with a tap, and say so after a moment.
    const holds = [];
    let holdShown = 0;
    function hold(id, s) {
      return new Promise(res => {
        const h = { left: s, age: 0, fin: null };
        h.fin = () => {
          if (!h.fin) return;
          h.fin = null;
          holds.splice(holds.indexOf(h), 1);
          if (skipFn === fin) skipFn = null;
          res(id === flow);
        };
        const fin = () => { if (h.fin) h.fin(); };
        h.skip = skipFn = fin;
        holds.push(h);
      });
    }
    const offHolds = engine.addRealtimeUpdate(rdt => {
      if (engine.paused || !ctx.alive) return;
      const k = Math.max(1, engine.timeScale);
      let show = false;
      for (const h of holds.slice()) {
        h.left -= rdt * k; h.age += rdt;
        if (h.left <= 0 && h.fin) h.fin();
        else if (h.age > 0.6 && skipFn === h.skip) show = true;
      }
      if (show !== (holdShown > 0)) { holdShown = show ? 1 : 0; skipChip.classList.toggle('on', show && !autoplay); }
    });

    const TRAIL_SOFT = new THREE.Color(0xF4FFB0).convertLinearToSRGB(), TRAIL_HOT = new THREE.Color(0xFFE14D).convertLinearToSRGB();
    /** Trail on fast shots; a hot yellow one on power strikes. A new shot starts a fresh trail (`keep`: same shot). */
    function setTrail(on, hot, keep) {
      trail.visible = on;
      if (!keep || !on) {
        trail.clear();
        // (world.trail keeps stale vertices past its filled length, and the fading tail segment would
        // reach back to them — a ghost streak to the last shot: collapse them onto the new start)
        const pa = trail.mesh && trail.mesh.geometry.attributes.position;
        if (pa) { for (let i = 0; i < pa.count; i++) pa.setXYZ(i, ball.x, ball.y, ball.z); pa.needsUpdate = true; }
      }
      if (!on) return;
      const u = trail.mesh && trail.mesh.material.uniforms;
      if (u && u.uColor) { const c = hot ? TRAIL_HOT : TRAIL_SOFT; u.uColor.value.set(c.r, c.g, c.b); }
      if (u && u.uOpacity) u.uOpacity.value = hot ? 0.75 : 0.5;
    }

    function hideBall() {
      ball.live = false;
      ballMesh.visible = false;
      ballShadow.visible = false;
      trail.visible = false;
      landing.visible = false;
    }

    function clearRallyState() {
      pending.length = 0;
      for (const a of ath) { a.plan = null; a.prep = null; a.react = 0; }
      auto.swingAt = -1; auto.serveAt = -1; auto.plan = null;
      finalShot = null;
    }

    function unfreeze() {
      for (const a of ath) { a.frozen = false; }
    }

    // ---- point setup ---------------------------------------------------------------------------

    function wouldWinGame(i) { return score.pts[i] >= 3 && score.pts[i] - score.pts[1 - i] >= 1; }

    function prePointInfo() {
      if (MODE === 'rally') { setInfo(''); return; }
      for (const i of [0, 1]) {
        if (wouldWinGame(i) && score.games[i] + 1 >= GAMES_TO_WIN) {
          setInfo('Match point' + (i === 1 ? ' · ' + CPU_NAME : ''), true);
          crowd.setMood('tense');
          return;
        }
      }
      crowd.setMood('idle');
      if (wouldWinGame(score.server)) setInfo('Game point' + (score.server === 1 ? ' · ' + CPU_NAME : ''));
      else if (wouldWinGame(1 - score.server)) setInfo('Break point' + (score.server === 0 ? ' · ' + CPU_NAME : ''), true);
      else if (score.pts[0] >= 3 && score.pts[0] === score.pts[1]) setInfo('Deuce');
      else setInfo('');
    }

    function setupPoint() {
      score.serveNo = 1;
      // Quick Match is one game, so the serve rotates tiebreak-style: you, then two each.
      if (MODE === 'quick') score.server = Math.floor((score.pts[0] + score.pts[1] + 1) / 2) % 2;
      setupServe();
    }

    function setupServe() {
      const id = nextFlow();
      hideHint();
      hideBall();
      clearRallyState();
      unfreeze();
      Object.assign(pt, { phase: 'idle', hitter: -1, bounces: 0, shots: 0, netTouch: false, decided: false, serveSwung: false, dramatic: false, dramaticAt: -9 });
      setRallyChip(0);
      cutToBase();
      if (MODE === 'rally') {
        phase = 'feed';
        player.place(0.6, HALF_L + 0.7);
        cpu.place(0, -(HALF_L + 0.4));
        renderBoard();
        later(id, 0.9).then(ok => { if (ok) cpuFeed(); });
        return;
      }
      const deuce = (score.pts[0] + score.pts[1]) % 2 === 0;
      const srv = ath[score.server], rcv = ath[1 - score.server];
      const sx = srv.H * (deuce ? 0.75 : -0.75), rx = rcv.H * (deuce ? 2.8 : -2.8);
      pt.boxSign = rcv.H * (deuce ? 1 : -1);
      srv.place(sx, srv.H * (HALF_L + 0.25));
      rcv.place(rx, rcv.H * (HALF_L + 1.5));
      renderBoard();
      prePointInfo();
      if (score.serveNo === 2) flashInfo('Second serve', 1.6);
      if (score.server === 0) {
        phase = 'serveReady';
        serveShot(player);
        if (hints.serve < 2) showHint('tap', 'Tap to toss, then swipe up as the ring closes!');
      } else {
        phase = 'cpuServeWait';
        later(id, 0.9 + rng.range(0, 0.5)).then(ok => { if (ok) doToss(1); });
      }
    }

    // ---- serving --------------------------------------------------------------------------------

    /** Time until a tossed ball is back down at hitting height (its apex for a normal toss). */
    function tossHitFrom(b) {
      const c = copyBall(newBall(), b);
      let t = 0;
      while ((c.vy > 0 || c.y > TOSS_APEX) && t < 2) { stepBall(c, STEP, null); t += STEP; }
      return t;
    }

    function doToss(who) {
      if (!(phase === 'serveReady' && who === 0) && !(phase === 'cpuServeWait' && who === 1)) return;
      phase = 'toss';
      const a = ath[who];
      a.yaw = a.netYaw; a.pal.setFacing(a.yaw);
      // Straight up over the hitting shoulder, so a toss hit at its apex meets the sweet spot. A
      // newcomer's first tosses go higher and are hit as they drop back: ~0.4 s longer to react.
      const high = who === 0 && coaching() && hints.serve < 2;
      Object.assign(ball, {
        x: a.pos.x + a.H * a.hand * CONTACT.oh.lat, y: TOSS_FROM, z: a.pos.z - a.H * CONTACT.oh.fwd,
        vx: 0, vz: 0, vy: Math.sqrt(2 * GRAV * ((high ? TOSS_HIGH : TOSS_APEX) - TOSS_FROM)), spin: 0, rolling: false,
      });
      ball.live = true;
      pt.tossHit = simTime + tossHitFrom(ball);
      pt.serveSwung = false;
      a.prepare('oh');
      audio.sfx('serve_toss', { pan: clamp(ball.x / 8, -0.8, 0.8), vol: who === 0 ? 1 : 0.7 });
      if (who === 1) {
        const sd = 0.09 - 0.065 * SKILL;
        const at = pt.tossHit + gauss(rng) * sd;
        pending.push({ who: 1, type: 'swing', kind: 'oh', at: at - 0.08, tc: 0.08 });
        pending.push({ who: 1, type: 'serve', at, judge: at, input: cpuServeInput() });
      } else {
        hints.serve++;
        if (hints.serve <= 3) showHint('swipe-up', 'Swipe up as the ring closes!');
      }
    }

    function cpuServeInput() {
      const first = score.serveNo === 1;
      return {
        pace: clamp((first ? 0.45 + 0.5 * SKILL : 0.5) + rng.range(-0.12, 0.12), 0, 1),
        uy: 0.6, aimX: rng.range(-1, 1),
      };
    }

    function serveSwipe(g) {
      if (phase !== 'toss' || pt.serveSwung || score.server !== 0) return;
      pt.serveSwung = true;
      hideHint();
      const tDet = detSim(g), at = tDet + SWIPE_LEAD;
      player.startSwing('oh', at - simTime);
      audio.sfx(g.quick ? 'swing_heavy' : 'swing_light', { vol: 0.8 });
      pending.push({ who: 0, type: 'serve', at, judge: judgeTime(g) + SWIPE_LEAD, gesture: g });
    }

    function resolveServe(c) {
      if (phase !== 'toss') return;
      const a = ath[c.who];
      if (ball.y < 1.15) {                       // swung at a ball that had already dropped: toss again
        audio.sfx('whoosh', { intensity: 0.4 });
        if (c.who === 0) { popupAt(a, 'TOO LATE', '#FF8A3D'); pt.serveSwung = false; return; }
        hideBall();
        phase = 'cpuServeWait';
        const id = flow;
        later(id, 0.6).then(ok => { if (ok) doToss(1); });
        return;
      }
      const input = c.gesture ? readGesture(c.gesture) : c.input;
      const dtApex = c.judge - pt.tossHit;
      const sInfo = { H: a.H, boxSign: pt.boxSign, second: score.serveNo === 2 };
      const it = serveIntent({ pace: input.pace, uy: input.uy, aimX: input.ux != null ? input.ux : input.aimX }, dtApex, sInfo);
      const from = { x: ball.x, y: ball.y, z: ball.z }, draws = [];
      const sol = launchFromIntent(from, a.H, it, rng, draws);
      Object.assign(ball, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin, rolling: false });
      finalShot = null;
      if (c.who === 0 && c.gesture && !c.gesture.fixed && c.gesture.upT == null) {
        const g = c.gesture, lag = clamp((simTime - detSim(g)) / Math.max(0.05, frameRatio), 0, 0.4) * 1000;
        finalShot = { serve: true, g, from, H: a.H, info: sInfo, err: dtApex, draws, it, at: simTime, until: g.detT + lag + FINAL_MS,
          fastest: stats.fastest, power: it.pace > 0.7 };
      }
      phase = 'play';
      Object.assign(pt, { phase: 'serve', hitter: c.who, bounces: 0, netTouch: false, lastHitAt: simTime, lastKind: 'serve', lastSpin: sol.spin });
      pt.shots = 1;
      const kmh = Math.round(Math.hypot(sol.vx, sol.vy, sol.vz) * 3.6);
      lastShot = { who: c.who, type: 'serve', tier: it.tier, kmh, dtApex: +dtApex.toFixed(3), pace: +it.pace.toFixed(2) };
      if (c.who === 0) {
        stats.fastest = Math.max(stats.fastest, kmh);
        if (score.serveNo === 1) stats.firstTotal++;
        popupAt(a, timingLabel(it.tier, dtApex), TIER_COLOR[it.tier]);
        if (it.tier === 'perfect') stats.perfect++;
        if (it.tier === 'perfect' || it.tier === 'good') learned('serve');
        ui.haptic(it.tier === 'perfect' ? 25 : 12);
        endShot('serve', 0.35, 0.45);
        showTimingBar(a, dtApex * (T_EARLY_MAX / SERVE_EDGE));
      }
      flashInfo(kmh + ' km/h', 1.8);
      audio.sfx(it.frame ? 'racket_frame' : 'racket_hit', { intensity: clamp(kmh / 190, 0.3, 1), pan: clamp(ball.x / 8, -0.8, 0.8), vol: c.who === 0 ? 1 : 0.75 });
      if (it.pace > 0.7) audio.sfx('voice_hup', { vol: c.who === 0 ? 0.9 : 0.6, rate: c.who === 0 ? 1 : 1.1 });
      if (kmh > 170) engine.shake(0.04, 0.2);
      setTrail(kmh > 120, kmh > 165);
      afterLaunch(c.who, { serve: { boxSign: pt.boxSign } });
    }

    // ---- strokes -----------------------------------------------------------------------------------

    function cpuFeed() {
      if (phase !== 'feed') return;
      const p = cpu.contactPoint('fh', _tmpL);
      Object.assign(ball, { x: p.x, y: 0.95, z: p.z, vx: 0, vy: 0, vz: 0, spin: 0, rolling: false });
      ballMesh.visible = true;
      cpu.startSwing('fh', 0.18, 0.95);
      pending.push({ who: 1, type: 'feed', at: simTime + 0.18 });
      phase = 'feedSwing';
    }

    function resolveFeed() {
      if (phase !== 'feedSwing') return;
      const it = cpuIntent(SKILL, 0, { feeder: true, streak: rallyState.streak, playerX: player.pos.x, stretch: 0 }, rng);
      it.vh = Math.min(it.vh, 20);
      const sol = launchFromIntent({ x: ball.x, y: ball.y, z: ball.z }, -1, it, rng);
      Object.assign(ball, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin, rolling: false });
      ball.live = true;
      phase = 'play';
      Object.assign(pt, { phase: 'rally', hitter: 1, bounces: 0, netTouch: false, lastHitAt: simTime, lastKind: 'feed', shots: 1, lastSpin: sol.spin });
      audio.sfx('racket_hit', { intensity: 0.5, pan: clamp(ball.x / 8, -0.8, 0.8), vol: 0.7 });
      afterLaunch(1, null);
    }

    /** Break point or match point (never in Rally Challenge). */
    function bigPoint() {
      if (MODE === 'rally') return false;
      for (const i of [0, 1]) if (wouldWinGame(i) && (score.games[i] + 1 >= GAMES_TO_WIN || i !== score.server)) return true;
      return false;
    }
    const reachFor = (who, plan) => (MODE === 'rally' ? REACH : reachVs(plan));

    /**
     * The reach test resolveStroke will make, run ahead of time: steps a copy of the athlete with the
     * same steering (reaction delay, then the plan's stand spot) to the planned contact moment.
     */
    function predictReach(a, plan, react) {
      const g = { pos: { x: a.pos.x, z: a.pos.z }, vx: a.vx, vz: a.vz, tx: a.tx, tz: a.tz, vmax: a.vmax, accel: a.accel, frozen: false };
      const DT = 1 / 120, T = plan.t - simTime;
      for (let t = 0; t < T; t += DT) {
        if (t >= react) { g.tx = plan.sx; g.tz = plan.sz; }
        moveAthlete(g, DT);
      }
      const c = CONTACT[plan.kind];
      return Math.hypot(g.pos.x + a.H * a.hand * c.lat - plan.cx, g.pos.z - a.H * c.fwd - plan.cz);
    }

    /** The decisive ball of a big point is in the air: slow it down and lean in. */
    function dramatic() {
      if (!bigPoint() || pt.dramatic) return;
      pt.dramatic = true;
      pt.dramaticAt = engine.realTime;
      engine.slowmo(0.3, 0.9);
      camRig.push = 1;
      audio.sfx('crowd_ooh', { vol: 0.5 });
    }

    /** Ball launched by `who`: predict, plan the receiver, recover the hitter. */
    function afterLaunch(who, opts, elapsed) {
      const pred = predict(ball, 4.2);
      const recv = 1 - who, ra = ath[recv], ha = ath[who];
      ha.plan = null;
      ha.setTarget(clamp(ball.x * 0.25, -1.4, 1.4), ha.H * (HALF_L + 0.8));
      // receivers anticipate the serve; a hard groundstroke takes a moment longer to read
      const react = Math.max(0, (opts && opts.serve ? ra.reactTime * (recv === 1 ? serveReact(SKILL) : SERVE_REACT)
        : ra.reactTime + (MODE === 'rally' ? 0 : paceRead(Math.hypot(ball.vx, ball.vy, ball.vz), recv, SKILL))) - (elapsed || 0));
      const plan = planIntercept({ idx: recv, x: ra.pos.x, z: ra.pos.z, vmax: ra.vmax, accel: ra.accel, react, hand: ra.hand }, pred, simTime, opts);
      plan.perfectIn = !!(opts && opts.perfect);     // a perfectly struck ball hurries the reply
      ra.plan = plan;
      ra.react = react;
      auto.swingAt = -1;
      if (recv === 1 && plan.ok) scheduleCpuStroke(plan);
      if (recv === 0) {
        if (plan.bounce && plan.bounce.margin > -0.05) {
          landing.position.set(plan.bounce.x, 0.014, plan.bounce.z);
          landing.visible = true;
          landingT = 0;
        } else landing.visible = false;
        hints.swingPending = plan.ok && hints.swing < 2 && MODE !== 'match';
      }
      // a ball that's clearly going out, or that the receiver truly can't reach, decides a big point
      const serveFault = opts && opts.serve && score.serveNo === 1;
      if (!serveFault && plan.bounce && bigPoint() && (plan.bounce.margin < -0.05 ||
        (plan.bounce.margin >= 0 && (!plan.ok || plan.deficit > REACH + 0.05 || predictReach(ra, plan, react) > reachFor(recv, plan) + 0.05)))) dramatic();
    }

    function scheduleCpuStroke(plan) {
      const err = cpuStrokeErr(SKILL, plan, rng, MODE === 'rally', pt.shots);
      if (timingTier(err) === 'whiff') {
        const at = plan.t + err;
        pending.push({ who: 1, type: 'swing', kind: plan.kind, at: at - 0.12, tc: 0.12, y: plan.cy });
        plan.cpuWhiff = true;
        if (plan.bounce && plan.bounce.margin >= 0) dramatic();
        return;
      }
      const at = Math.max(plan.t + err * 0.3, plan.bounce.t + 0.02);
      pending.push({ who: 1, type: 'swing', kind: plan.kind, at: at - 0.13, tc: 0.13, y: plan.cy });
      pending.push({ who: 1, type: 'stroke', at, err, plan });
    }

    /**
     * Sim time a swipe counts from: its detection, or (for an unhurried swipe that took a while to
     * read as a swing) ONSET_LEAD after the finger started moving — whichever is earlier.
     */
    function judgeTime(g) {
      if (g.simDet != null) return g.simDet;
      return simAt(g.detT) - clamp((g.detT - g.onsetT) / 1000 - ONSET_LEAD, 0, 0.12) * frameRatio;
    }

    const TIER_COLOR = { perfect: '#FFC93C', good: '#FFFFFF', edge: '#FF8A3D', whiff: '#FF8A3D' };
    function timingLabel(tier, err) {
      if (tier === 'perfect') return 'PERFECT!';
      if (tier === 'good') return err < 0 ? 'GOOD · EARLY' : 'GOOD · LATE';
      if (tier === 'edge') return err < 0 ? 'EARLY!' : 'LATE!';
      return 'MISHIT';
    }

    function strokeSwipe(g) {
      if (player.swing && !player.swing.shadow) return;
      const plan = player.plan;
      const incoming = plan && plan.ok && !plan.leave && pt.hitter === 1 && !pt.decided;
      if (!incoming || plan.used) {
        if (!pt.decided && pt.hitter !== 1) {        // shadow swing between balls: feedback only
          player.startSwing('fh', 0.08, 0.95, true);
          audio.sfx('swing_light', { vol: 0.5 });
        }
        return;
      }
      const err = judgeTime(g) + SWIPE_LEAD - plan.t;
      if (err < -T_IGNORE) {                         // far too soon: a harmless practice swing
        player.startSwing(plan.kind, 0.1, plan.cy, true);
        audio.sfx('swing_light', { vol: 0.5 });
        popupAt(player, 'Wait for it…', '#FFFFFF');
        return;
      }
      plan.used = true;
      plan.usedAt = simTime;
      hideHint();
      stats.swings++;
      const tier = timingTier(err);
      audio.sfx(g.quick ? 'swing_heavy' : 'swing_light', { vol: 0.8 });
      if (tier === 'whiff') {
        player.startSwing(plan.kind, 0.1, plan.cy);
        popupAt(player, err < 0 ? 'TOO EARLY' : 'TOO LATE', '#FF8A3D');
        showTimingBar(player, err);
        plan.whiffed = true;
        lastShot = { who: 0, type: 'whiff', err: +err.toFixed(3) };
        return;
      }
      const at = Math.max(detSim(g) + PACE_READ, plan.t + err * 0.3, plan.bounce.t + 0.02);
      // an early swing comes through at full speed and the ball meets it in the follow-through (jammed)
      player.startSwing(plan.kind, err < -T_PERFECT ? Math.min(at - simTime, 0.1) : at - simTime, plan.cy);
      pending.push({ who: 0, type: 'stroke', at, err, plan, gesture: g });
    }

    const _cpt = new V3();
    function resolveStroke(c) {
      const a = ath[c.who], plan = c.plan;
      if (pt.decided || !ball.live || pt.hitter === c.who) return;
      if (pt.bounces !== 1 || sideOfZ(ball.z) !== c.who) { missed(a, c.who === 0 ? 'TOO LATE' : null); return; }
      const kind = plan.kind;
      // Reach is judged where the ball was meant to be met, so timing (not geometry) decides early/late.
      a.contactPoint(kind, _cpt);
      const reach = Math.hypot(_cpt.x - plan.cx, _cpt.z - plan.cz);
      if (reach > reachFor(c.who, plan)) { missed(a, c.who === 0 ? 'Too far!' : null); return; }
      // An early ball leaves from near the racket head (the follow-through hides the nudge); a late
      // one has already gone past the racket, so it leaves from where it really is (no snapping back).
      const dx = ball.x - _cpt.x, dz = ball.z - _cpt.z, dd = Math.hypot(dx, dz);
      const late = c.err > T_PERFECT && (ball.z - plan.cz) * a.H > 0;
      const k = late ? 1 : dd > LAUNCH_SLACK ? LAUNCH_SLACK / dd : 1;
      const from = {
        x: _cpt.x + dx * k, z: _cpt.z + dz * k,
        y: kind === 'oh' ? clamp(ball.y, 1.6, 2.8) : clamp(ball.y, 0.25, 1.7),
      };
      const stretch = clamp((reach - 0.35) / 0.55, 0, 1);
      let it, info0 = null;
      if (c.who === 0) {
        info0 = { H: a.H, side: (kind === 'bh' ? -1 : 1) * a.hand, kind, contactY: from.y, stretch };
        it = strokeIntent(gestureInput(readGesture(c.gesture)), c.err, info0);
      } else {
        it = cpuIntent(SKILL, c.err, {
          feeder: MODE === 'rally', streak: rallyState.streak, kind, stretch, contactY: from.y,
          playerX: player.pos.x, playerZabs: Math.abs(player.pos.z), contactZabs: Math.abs(from.z), cpuX: from.x,
          playerRecovering: Math.hypot(player.tx - player.pos.x, player.tz - player.pos.z) > 1.2, shots: pt.shots,
          inSpin: pt.lastSpin, inSpeed: plan.speed, inLaunch: plan.launch, serveReturn: plan.serve,
        }, rng);
      }
      if (c.who === 1) applyHeat(it, pt.shots);
      if (pt.dramatic) {                  // the big-moment slow-mo was for a ball that came back after all
        pt.dramatic = false;
        if (engine.realTime - pt.dramaticAt < 0.9) engine.slowmo(0.7, 0.15);
      }
      const draws = [];
      const sol = launchFromIntent(from, a.H, it, rng, draws);
      Object.assign(ball, from, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin, rolling: false });
      Object.assign(pt, { phase: 'rally', hitter: c.who, bounces: 0, netTouch: false, lastHitAt: simTime, lastKind: kind, lastSpin: sol.spin });
      finalShot = null;
      if (c.who === 0 && c.gesture && !c.gesture.fixed && c.gesture.upT == null) {
        // The finger is still moving: keep reading it a moment longer, then finalise the shot.
        const g = c.gesture, lag = clamp((simTime - detSim(g)) / Math.max(0.05, frameRatio), 0, 0.4) * 1000;
        finalShot = { g, from: Object.assign({}, from), H: a.H, info: info0, err: c.err, draws, it, at: simTime, until: g.detT + lag + FINAL_MS };
      }
      pt.shots++;
      setRallyChip(MODE === 'rally' ? 0 : pt.shots);
      const kmh = Math.round(Math.hypot(sol.vx, sol.vy, sol.vz) * 3.6);
      lastShot = { who: c.who, type: kind, tier: it.tier, err: +c.err.toFixed(3), kmh, pace: +(it.pace || 0).toFixed(2), spin: +it.spin.toFixed(2), tactic: it.tactic || (it.lob ? 'lob' : null) };
      const pan = clamp(ball.x / 8, -0.8, 0.8), vol = c.who === 0 ? 1 : 0.75;
      audio.sfx(it.frame ? 'racket_frame' : 'racket_hit', { intensity: clamp(kmh / 120, 0.25, 1), pan, vol });
      const power = it.pace > 0.78 && !it.frame;
      if (finalShot) finalShot.power = power;
      if (c.who === 0) {
        popupAt(a, it.smash ? 'SMASH!' : timingLabel(it.tier, c.err), TIER_COLOR[it.tier]);
        showTimingBar(a, c.err);
        ui.haptic(it.tier === 'perfect' ? 25 : 12);
        if (it.tier === 'perfect' || it.tier === 'good') learned('swing');
        if (it.tier === 'perfect') {
          stats.perfect++;
          world.burst(scene, new V3(ball.x, ball.y, ball.z), { count: 12, colors: [0xFFF59A, 0xFFFFFF], speed: 2.2, size: 0.05, gravity: -3, life: 0.4 });
          if (power) engine.slowmo(0.08, 0.12);               // hit-stop on a clean power strike
        }
        if (power) { audio.sfx('voice_hup', { vol: 0.9 }); engine.shake(0.035, 0.18); }
      } else if (it.pace > 0.75) audio.sfx('voice_hup', { vol: 0.55, rate: 1.12 });
      if (it.smash) {
        engine.shake(0.08, 0.3);
        engine.slowmo(0.4, 0.45);
        audio.sfx('whoosh', { intensity: 1 });
        crowd.gasp();
      }
      const perfect = c.who === 0 && it.tier === 'perfect';
      setTrail(kmh > 85 || perfect, power || perfect || kmh > 125);
      landing.visible = false;
      afterLaunch(c.who, perfect ? { perfect: true } : null);
    }

    /**
     * Finalises your shot from the whole swipe (see FINAL_MS): if the finished gesture reads as a
     * different shot — harder, softer, a lob — the launch is re-solved with the same luck from the
     * same contact, the new flight is replayed up to now, and the drawn ball eases across to it.
     */
    let finalShot = null;
    const ballOffset = new V3();
    function finalizeStroke() {
      const f = finalShot;
      finalShot = null;
      if (!f || pt.decided || pt.hitter !== 0 || pt.bounces !== 0 || !ball.live || pt.lastHitAt !== f.at || ball.z < 1.2) return;
      const gi = gestureInput(readGesture(f.g, f.until)), old = f.it;
      const it = f.serve ? serveIntent(gi, f.err, f.info) : strokeIntent(gi, f.err, f.info);
      if (Math.abs(it.pace - old.pace) < 0.03 && it.lob === old.lob && Math.abs(it.spin - old.spin) < 0.08 && Math.abs(it.tx - old.tx) < 0.2) return;
      const sol = launchFromIntent(f.from, f.H, it, rng, f.draws);
      const b = Object.assign(newBall(), f.from, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin });
      for (let i = Math.round((simTime - f.at) / STEP); i > 0; i--) stepBall(b, STEP, null);
      if (b.z < 1 || b.y < 0.1 || b.rolling) return;                 // too late to change it
      ballOffset.set(ball.x - b.x, ball.y - b.y, ball.z - b.z);
      Object.assign(ball, { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spin: b.spin, rolling: false });
      pt.lastSpin = sol.spin;
      const kmh = Math.round(Math.hypot(sol.vx, sol.vy, sol.vz) * 3.6);
      // the receiver re-reads the new ball (its reaction clock keeps running from the real contact)
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].who === 1 && (pending[i].type === 'stroke' || pending[i].type === 'swing')) pending.splice(i, 1);
      if (f.serve) {
        lastShot = Object.assign({}, lastShot, { kmh, pace: +it.pace.toFixed(2), finalized: true });
        stats.fastest = Math.max(f.fastest, kmh);
        flashInfo(kmh + ' km/h', 1.8);
        if (it.pace > 0.7 && !f.power) audio.sfx('voice_hup', { vol: 0.9 });
        if (kmh > 170) engine.shake(0.04, 0.2);
        setTrail(kmh > 120, kmh > 165, true);
        afterLaunch(0, { serve: { boxSign: f.info.boxSign } }, simTime - f.at);
        return;
      }
      lastShot = Object.assign({}, lastShot, { kmh, pace: +it.pace.toFixed(2), spin: +it.spin.toFixed(2), tactic: it.lob ? 'lob' : null, finalized: true });
      const power = it.pace > 0.78 && !it.frame;
      if (power && !f.power) { audio.sfx('voice_hup', { vol: 0.9 }); engine.shake(0.035, 0.18); }
      if (it.lob && !old.lob) audio.sfx('whoosh', { intensity: 0.3 });
      setTrail(kmh > 85 || it.tier === 'perfect', power || it.tier === 'perfect' || kmh > 125, true);
      afterLaunch(0, it.tier === 'perfect' ? { perfect: true } : null, simTime - f.at);
    }

    function missed(a, label) {
      if (a.busy) return;
      a.oneShot('stumble', 'wince');
      if (label) popupAt(a, label, '#FF8A3D');
      audio.sfx('crowd_ooh', { vol: 0.5 });
    }

    /**
     * Calls the point the moment the receiver can no longer play the ball (air swing, out of reach,
     * or the ball has gone past), instead of waiting for its second bounce.
     */
    function checkDeadBall() {
      if (pt.decided || phase !== 'play' || pt.phase !== 'rally' || pt.bounces !== 1) return;
      const recv = 1 - pt.hitter, plan = ath[recv].plan;
      for (const c of pending) if (c.who === recv && c.type === 'stroke') return;
      if (plan && plan.ok && !plan.leave) {
        if (plan.used ? simTime < Math.min(plan.t, plan.usedAt + 0.25) : simTime < plan.t + T_LATE_MAX - SWIPE_LEAD + 0.02) return;
      }
      const serve = pt.shots <= 1 && pt.lastKind === 'serve';
      const swung = !!(plan && (plan.whiffed || (recv === 1 && plan.cpuWhiff)));
      pointOver(pt.hitter, serve ? 'ace' : swung ? 'whiff' : 'winner');
    }

    // ---- rules: ball events ---------------------------------------------------------------------

    function dust(x, z, strength) {
      world.burst(scene, new V3(x, 0.03, z), { count: 7, colors: [0xD8E8F8, 0xFFFFFF], speed: 0.9 + strength, size: 0.05, gravity: -2.5, life: 0.45 });
      const m = marks[markIndex++ % marks.length];
      m.mesh.position.set(x, 0.012, z);
      const ang = Math.atan2(ball.vx, ball.vz);
      m.mesh.rotation.y = ang;
      m.mesh.scale.set(1, 1, 1.8);
      m.life = 1;
      m.mesh.visible = true;
    }

    function onBallEvent(type, b) {
      if (type === 'bounce') {
        dust(b.bx, b.bz, clamp(b.vin / 8, 0, 1));
        audio.sfx('ball_bounce_court', { vol: clamp(0.3 + b.vin / 10, 0.3, 1), pan: clamp(b.bx / 8, -0.8, 0.8) });
        if (sideOfZ(b.bz) === 0) landing.visible = false;
      } else if (type === 'cross') {
        if (b.vz > 0 && hints.swingPending && !pt.decided) {     // swing hint once the ball is on its way to you
          hints.swingPending = false;
          hints.swing++;
          showHint('swipe-up', 'Swipe up as the ball reaches you!', landing.visible ? landing.position.x : null);
        }
      } else if (type === 'net' || type === 'cord-over' || type === 'cord-back') {
        audio.sfx('net_hit', { pan: clamp(b.x / 8, -0.8, 0.8) });
      } else if (type === 'wall') {
        audio.sfx('thud', { vol: 0.35 });
      }
      if (pt.decided || phase === 'toss') return;
      if (pt.phase !== 'serve' && pt.phase !== 'rally') return;

      if (type === 'cord-over' || type === 'cord-back') {
        pt.netTouch = true;
        crowd.gasp();
        audio.sfx('crowd_ooh', { vol: 0.6 });
        replanReceiver();
        return;
      }
      if (type === 'net') { replanReceiver(); return; }

      const recv = 1 - pt.hitter;
      if (type === 'wall') {
        if (pt.bounces === 0) {
          if (pt.phase === 'serve') fault('OUT');
          else pointOver(recv, 'out', { margin: -1 });
        }
        return;
      }
      if (type !== 'bounce') return;
      const side = sideOfZ(b.bz);
      if (pt.phase === 'serve') {
        if (side !== recv) { fault('NET'); return; }
        const m = boxMargin(b.bx, b.bz, pt.boxSign, recv);
        if (m >= 0) {
          if (pt.netTouch) { letServe(); return; }
          pt.phase = 'rally'; pt.bounces = 1;
          if (pt.hitter === 0 && score.serveNo === 1) stats.firstIn++;
          if (m < 0.12) closeCall(true);
        } else {
          if (m > -0.12) closeCall(false);
          fault('OUT');
        }
        return;
      }
      if (side === pt.hitter) { pointOver(recv, 'net'); return; }
      pt.bounces++;
      if (pt.bounces === 1) {
        const m = courtMargin(b.bx, b.bz);
        if (m < 0) {
          if (m > -0.12) closeCall(false);
          pointOver(recv, 'out', { margin: m });
          return;
        }
        if (m < 0.12) closeCall(true);
        if (MODE === 'rally' && pt.hitter === 0) {
          rallyState.streak++;
          rallyState.best = Math.max(rallyState.best, rallyState.streak);
          renderBoard();
          rallyMilestone();
        }
      } else {
        pointOver(pt.hitter, pt.shots <= 1 && pt.lastKind === 'serve' ? 'ace' : 'winner');
      }
    }

    function closeCall(inside) {
      audio.sfx('crowd_ooh', { vol: 0.7 });
      crowd.gasp();
      if (inside) flashInfo('Just in!', 1.0);
    }

    function replanReceiver() {
      const recv = 1 - pt.hitter;
      const ra = ath[recv];
      const pred = predict(ball, 3);
      const plan = planIntercept({ idx: recv, x: ra.pos.x, z: ra.pos.z, vmax: ra.vmax, accel: ra.accel, react: 0, hand: ra.hand }, pred, simTime,
        pt.phase === 'serve' ? { serve: { boxSign: pt.boxSign } } : null);
      // drop any scheduled CPU contact for the old trajectory
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].who === recv && (pending[i].type === 'stroke' || pending[i].type === 'swing')) pending.splice(i, 1);
      ra.plan = plan;
      if (recv === 1 && plan.ok) scheduleCpuStroke(plan);
      if (recv === 0) auto.swingAt = -1;
    }

    /**
     * Streak milestones while the ball is live: no centre banner over the court, just a pop above
     * your Pal, a pulse of the streak counter, the crowd and a sound. The big words come when the
     * streak ends (rallyPointOver).
     */
    function rallyMilestone() {
      const n = rallyState.streak;
      if (n % 5 !== 0) return;
      const big = n % 10 === 0;
      popupAt(player, big ? n + '!' : String(n), big ? '#FFC93C' : '#FFFFFF', 44);
      const st = rows[0] && rows[0].streak;
      if (st) { st.classList.remove('tn-pulse'); void st.offsetWidth; st.classList.add('tn-pulse'); }
      if (!big) { audio.sfx('crowd_applause', { intensity: 0.3 }); return; }
      if (n === 30) { audio.sfx('fanfare_big'); crowd.cheer(1, 2.2); ctx.awardMedal('gold'); }
      else if (n >= 20) { audio.sfx('fanfare_small'); crowd.cheer(0.8, 1.6); }
      else { audio.sfx('crowd_applause', { intensity: 0.6 }); crowd.cheer(0.5, 1.2); }
    }
    const rallyTitle = n => (n >= 30 ? 'AMAZING!' : n >= 20 ? 'SUPER RALLY!' : n >= 10 ? 'NICE RALLY!' : null);

    // ---- faults, lets, points --------------------------------------------------------------------

    function letServe() {
      pt.decided = true;
      if (pt.hitter === 0 && score.serveNo === 1) stats.firstTotal--;   // a let is replayed, it isn't a first serve missed
      const id = nextFlow();
      phase = 'fault';
      ui.banner('LET', { kind: 'info', sub: 'Serve again', duration: 1.0 });
      audio.sfx('line_call');
      hold(id, 1.4).then(ok => { if (ok) setupServe(); });
    }

    function fault(kind) {
      const server = pt.hitter;
      if (score.serveNo === 1) {
        pt.decided = true;
        const id = nextFlow();
        phase = 'fault';
        ui.banner('FAULT', { kind: server === 0 ? 'bad' : 'info', sub: kind === 'NET' ? 'Into the net' : 'Out of the box', duration: 1.1 });
        audio.sfx(kind === 'NET' ? 'crowd_aww' : 'line_call', { vol: 0.6 });
        score.serveNo = 2;
        if (server === 0) player.pal.setExpression('wince', 1.2);
        hold(id, 1.5).then(ok => { if (ok) setupServe(); });
      } else {
        stats.doubles[server]++;
        pointOver(1 - server, 'double', { force: true });
      }
    }

    const REASON_TEXT = { out: 'OUT!', net: 'NET!', double: 'DOUBLE FAULT', ace: 'ACE!', winner: 'WINNER!', smash: 'SMASH!', whiff: 'MISSED!' };

    function pointOver(winner, reason, info) {
      if (pt.decided && !(info && info.force)) return;
      pt.decided = true;
      const id = nextFlow();
      phase = 'pointOver';
      pending.length = 0;
      landing.visible = false;
      hideHint();
      const loser = 1 - winner, lp = ath[loser].plan;
      const lunged = (reason === 'winner' || reason === 'ace') && lp && lp.ok && lp.deficit > 0.3;   // ran for it, couldn't get there
      for (const a of ath) { a.plan = null; a.prep = null; }
      const shots = pt.shots;
      const smash = reason === 'winner' && pt.lastKind === 'oh' && pt.hitter === winner;
      if (reason === 'winner' && smash) reason = 'smash';
      stats.longest = Math.max(stats.longest, shots);
      if (reason === 'out' || reason === 'net' || reason === 'whiff') stats.errors[loser]++;
      if (reason === 'winner' || reason === 'smash') stats.winners[winner]++;
      if (reason === 'ace') stats.aces[winner]++;
      if (reason === 'out') audio.sfx('line_call');

      if (MODE === 'rally') { rallyPointOver(id, winner, reason); return; }

      stats.won[winner]++;
      score.pts[winner]++;
      const gw = gameWinner();
      const matchWon = gw >= 0 && score.games[gw] + 1 >= GAMES_TO_WIN;
      renderBoard(winner);
      setRallyChip(0);
      setInfo('');
      crowd.setMood('idle');

      // Reactions
      for (const a of ath) a.frozen = true;
      const wa = ath[winner], la = ath[loser];
      const big = reason === 'ace' || reason === 'smash' || shots >= LONG_RALLY || matchWon;
      wa.oneShot(big ? 'cheer' : winner === 0 ? 'hop' : 'clap', 'joy');
      if (lunged) la.oneShot('stumble', 'wince').then(() => { if (la.frozen) la.oneShot('shrug'); });
      else la.oneShot(reason === 'out' || reason === 'net' || reason === 'double' || reason === 'whiff' ? 'sad' : 'shrug', 'sad');
      if (winner === 0) {
        audio.sfx(big ? 'crowd_cheer' : 'crowd_applause', { intensity: big ? 0.9 : clamp(0.35 + shots * 0.05, 0.35, 0.9) });
        crowd.cheer(big ? 1 : 0.55, big ? 2.2 : 1.3);
      } else {
        audio.sfx(reason === 'ace' || reason === 'winner' || reason === 'smash' ? 'crowd_applause' : 'crowd_aww', { intensity: 0.5, vol: 0.7 });
        if (shots >= 6) crowd.cheer(0.4, 1);
      }
      const slowRunning = pt.dramatic && engine.realTime - pt.dramaticAt < 0.55;
      if (matchWon) {
        if (!slowRunning) engine.slowmo(0.35, 0.8);
        audio.duck(0.4, 2.5);
      } else if (reason === 'ace' && winner === 0 && !slowRunning) engine.slowmo(0.45, 0.6);
      if (matchWon) heroShot(wa, 3.2);
      else if (winner === 0 && (reason === 'smash' || shots >= LONG_RALLY || (reason === 'ace' && lastShot && lastShot.kmh >= 150))) heroShot(player, 1.8);

      // Banners: what happened → the umpire's call
      const yours = winner === 0;
      let text = REASON_TEXT[reason] || 'POINT';
      let kind = yours ? 'great' : 'bad';
      let sub = null;
      if (reason === 'ace') { kind = yours ? 'huge' : 'info'; sub = lastShot && lastShot.kmh ? lastShot.kmh + ' km/h' : null; if (yours) audio.sfx('fanfare_small'); }
      else if (reason === 'smash') { kind = yours ? 'huge' : 'info'; }
      else if (reason === 'winner') { kind = yours ? 'great' : 'info'; if (!yours) sub = CPU_NAME + ' scores'; }
      else if (reason === 'out' || reason === 'net') { kind = yours ? 'good' : 'bad'; }
      else if (reason === 'double') { kind = yours ? 'good' : 'bad'; }
      else if (reason === 'whiff') { text = yours ? 'NICE SHOT!' : 'MISSED!'; kind = yours ? 'great' : 'bad'; if (yours) sub = CPU_NAME + ' missed it'; }
      if (shots >= LONG_RALLY && (reason === 'out' || reason === 'net' || (reason === 'winner' && !yours))) {
        sub = (reason === 'winner' ? CPU_NAME + ' wins it' : text.replace('!', '')) + ' · ' + shots + ' shots';
        text = 'NICE RALLY!';
        kind = yours ? 'great' : 'good';
      } else if (shots >= LONG_RALLY && !sub) sub = 'Nice rally! ' + shots + ' shots';
      ui.banner(text, { kind, sub, duration: 1.15 });
      // The umpire's call: routine scores in the chip under the board, the big ones as a banner.
      const call = gw >= 0 ? null : callText();
      const bigCall = call && /DEUCE|ADVANTAGE/.test(call);
      if (call && !bigCall) showCall(call);

      (async () => {
        if (!(await hold(id, 1.3))) return;
        if (gw >= 0) {
          score.games[gw]++;
          if (score.games[gw] >= GAMES_TO_WIN) { renderBoard(); matchOver(gw); return; }   // the board keeps the winning score
          score.pts = [0, 0];
          renderBoard();
          score.server = 1 - score.server;
          ui.banner('GAME', { kind: gw === 0 ? 'great' : 'info', sub: gamesCall(), duration: 1.4 });
          audio.sfx(gw === 0 ? 'fanfare_small' : 'crowd_applause', { intensity: 0.5 });
          if (!(await hold(id, 1.7))) return;
          renderBoard();
          setupPoint();
          return;
        }
        if (bigCall) {
          ui.banner(call, { kind: 'info', duration: 1.0 });
          if (!(await hold(id, 1.1))) return;
        } else if (!(await hold(id, 0.4))) return;
        setupPoint();
      })();
    }

    let callT = 0;
    function showCall(text) {
      callChip.textContent = text;
      callChip.classList.remove('off', 'ss-pop'); void callChip.offsetWidth; callChip.classList.add('ss-pop');
      callT = 2.2;
    }
    function updateCall(dt) {
      // (drop the pop-in animation too: its fill mode would otherwise hold the chip visible)
      if (callT > 0 && (callT -= dt) <= 0) { callChip.classList.remove('ss-pop'); callChip.classList.add('off'); }
    }

    function gameWinner() {
      const [a, b] = score.pts;
      if (a >= 4 && a - b >= 2) return 0;
      if (b >= 4 && b - a >= 2) return 1;
      return -1;
    }

    function callText() {
      if (gameWinner() >= 0) return 'GAME';
      const [a, b] = score.pts;
      if (a >= 3 && b >= 3) {
        if (a === b) return 'DEUCE';
        return 'ADVANTAGE ' + (a > b ? 'YOU' : CPU_NAME.toUpperCase());
      }
      if (a === b) return NAMES[a] + ' ALL';
      const s = score.server;
      return NAMES[score.pts[s]] + '–' + NAMES[score.pts[1 - s]];
    }

    function gamesCall() {
      const [a, b] = score.games;
      if (a === b) return a + ' games all';
      return (a > b ? 'You lead ' : CPU_NAME + ' leads ') + Math.max(a, b) + '–' + Math.min(a, b);
    }

    function rallyPointOver(id, winner, reason) {
      for (const a of ath) a.frozen = true;
      if (winner === 0) {
        // The feeder couldn't return it: the streak lives on.
        ui.banner(reason === 'winner' || reason === 'smash' ? 'WINNER!' : 'NICE!', { kind: 'great', sub: 'Streak ' + rallyState.streak, duration: 1.0 });
        audio.sfx('crowd_applause', { intensity: 0.5 });
        crowd.cheer(0.5, 1.2);
        player.oneShot('hop', 'joy');
        hold(id, 1.3).then(ok => { if (ok) setupServe(); });
        return;
      }
      rallyState.lives--;
      const streak = rallyState.streak;
      rallyState.streak = 0;
      renderBoard();
      player.oneShot('sad', 'sad');
      cpu.oneShot('shrug');
      audio.sfx('crowd_aww', { intensity: 0.5, vol: 0.7 });
      const what = reason === 'out' ? 'OUT!' : reason === 'net' ? 'NET!' : 'MISSED!', title = rallyTitle(streak);
      ui.banner(title || what, { kind: title ? 'great' : 'bad', sub: (title ? what.replace('!', '') + ' · ' : '') + 'Streak: ' + streak + (rallyState.lives > 0 ? ' · ' + rallyState.lives + ' ball' + (rallyState.lives > 1 ? 's' : '') + ' left' : ''), duration: 1.3 });
      if (title) audio.sfx('crowd_applause', { intensity: 0.7 });
      hold(id, 1.7).then(ok => {
        if (!ok) return;
        if (rallyState.lives <= 0) finishRally();
        else setupServe();
      });
    }

    // ---- match end & results --------------------------------------------------------------------

    function matchOver(w) {
      const id = nextFlow();
      phase = 'done';
      info.timer = 0;
      setInfo('');
      const won = w === 0;
      if (won) {
        ui.banner(GAMES_TO_WIN > 1 ? 'MATCH!' : 'GAME & MATCH!', { kind: 'huge', sub: 'You win ' + score.games[0] + '–' + score.games[1], duration: 2.2 });
        audio.sfx('fanfare_big');
        audio.sfx('crowd_cheer', { intensity: 1 });
        crowd.cheer(1, 3);
        world.confetti(scene, new V3(player.pos.x, 2.5, player.pos.z - 1), { count: 140, spread: 3, floor: 0.02 });
        player.oneShot('dance', 'joy');
        cpu.oneShot('clap', 'happy');
      } else {
        ui.banner('GOOD GAME!', { kind: 'info', sub: CPU_NAME + ' wins ' + score.games[1] + '–' + score.games[0], duration: 2.2 });
        audio.sfx('crowd_applause', { intensity: 0.7 });
        cpu.oneShot('cheer', 'joy');
        player.oneShot('shrug', 'sad');
      }
      heroShot(ath[w], 3);
      hold(id, 2.8).then(ok => { if (ok) finishMatch(w); });
    }

    function skillDelta(won, quality) {
      const myNorm = clamp(ctx.skillFor(me) / 2300, 0, 1);
      const gap = SKILL - myNorm;
      const scale = MODE === 'quick' ? 0.7 : 1;
      if (won) return Math.round(clamp(clamp(30 + 60 * gap, 12, 80) * scale + quality * 4, 8, 80));
      return -Math.round(clamp(clamp(25 - 40 * gap, 6, 40) * scale - quality * 3, 4, 40));
    }

    function finishMatch(w) {
      const won = w === 0;
      const pid = me.isGuest ? null : me.id;
      const records = [];
      const rec = (key, value, label, fmt, shown) => {
        if (!(value > 0)) return;
        const r = ctx.save.record(DEF.id, key, value, { label, fmt, profileId: pid });
        records.push({ label, value: shown, isNew: r.isNew });
      };
      rec('rally', stats.longest, 'Longest Rally', '{v} shots', plural(stats.longest, 'shot'));
      rec('serve', stats.fastest, 'Fastest Serve', '{v} km/h', stats.fastest + ' km/h');
      const cur = ctx.save.stat(DEF.id, pid, 'winStreak', 0);
      const streak = ctx.save.stat(DEF.id, pid, 'winStreak', won ? 1 : -cur);
      if (won) rec('streak', streak, 'Win Streak', 'int', plural(streak, 'win') + ' in a row');
      const medals = [];
      if (won) {
        if (ctx.awardMedal('bronze')) medals.push('bronze');
        if (MODE === 'match' && SKILL >= 0.5 && ctx.awardMedal('silver')) medals.push('silver');
        if (MODE === 'match' && (opp.profile.id === 'cpu-odessa' || SKILL >= 0.98) && score.games[1] === 0 && ctx.awardMedal('platinum')) medals.push('platinum');
      }
      const pts = stats.won[0] + stats.won[1];
      // a one-game Quick Match is told in points, a Match in games
      const shown = GAMES_TO_WIN > 1 ? score.games : stats.won;
      ctx.finish({
        outcome: won ? 'win' : 'lose',
        title: won ? 'You Win!' : 'Good Game!',
        headline: shown[0] + ' – ' + shown[1],
        headlineLabel: GAMES_TO_WIN > 1 ? 'Games' : 'Points',
        players: [
          { profileId: me.id, name: me.name, profile: me, score: String(shown[0]), place: won ? 1 : 2, isCpu: false,
            skillDelta: skillDelta(won, (stats.won[0] - stats.won[1]) / Math.max(1, pts) * 5) },
          { profileId: opp.profile.id, name: opp.profile.name, profile: opp.profile, score: String(shown[1]), place: won ? 2 : 1, isCpu: true },
        ],
        stats: [
          { label: 'Points Won', value: stats.won[0] + ' / ' + pts },
          { label: 'Aces', value: String(stats.aces[0]) },
          { label: 'Winners', value: String(stats.winners[0]) },
          { label: '1st Serves In', value: stats.firstTotal ? Math.round(stats.firstIn / stats.firstTotal * 100) + '%' : '—' },
          { label: 'Top Serve km/h', value: stats.fastest ? String(stats.fastest) : '—' },
          { label: 'Longest Rally', value: plural(stats.longest, 'shot') },
        ],
        records,
        medals,
        celebrate: won,
      });
    }

    function finishRally() {
      const id = nextFlow();
      phase = 'done';
      const best = rallyState.best;
      const great = best >= 15;
      ui.banner(great ? 'GREAT RALLYING!' : 'ALL BALLS USED', { kind: great ? 'great' : 'info', sub: 'Best streak: ' + best, duration: 1.8 });
      if (great) { audio.sfx('fanfare_small'); crowd.cheer(0.8, 2); player.oneShot('cheer', 'joy'); }
      hold(id, 2.2).then(ok => {
        if (!ok) return;
        const pid = me.isGuest ? null : me.id;
        const records = [];
        if (best > 0) {
          const r = ctx.save.record(DEF.id, 'challenge', best, { label: 'Rally Challenge', fmt: '{v} hits', profileId: pid });
          records.push({ label: 'Rally Challenge', value: plural(best, 'hit'), isNew: r.isNew });
        }
        const myNorm = clamp(ctx.skillFor(me) / 2300, 0, 1);
        ctx.finish({
          outcome: 'done',
          title: best >= 30 ? 'Rally Legend!' : best >= 15 ? 'Great Rallying!' : 'Rally Over',
          headline: String(best), headlineLabel: 'Best Streak',
          players: [{ profileId: me.id, name: me.name, profile: me, score: plural(best, 'hit'), place: 1, isCpu: false,
            skillDelta: Math.round(clamp((best - 6 - myNorm * 20) * 2.5, -15, 50)) }],
          stats: [
            { label: 'Best Streak', value: plural(best, 'hit') },
            { label: 'Perfect Hits', value: String(stats.perfect) },
            { label: 'Swings', value: String(stats.swings) },
          ],
          records,
          medals: [],
          celebrate: best >= 15,
        });
      });
    }

    // =============================================================================================
    // Input: swing fires on 'move' as soon as the gesture reads as a swipe
    // =============================================================================================

    // A swipe fires the swing the moment it reads as one (on 'move'); the finger keeps being sampled
    // until the racket meets the ball, and the shot's pace comes from the fastest stretch of the
    // whole motion seen by then (a finger resting before the flick doesn't dilute it).
    const gest = { active: false, samples: [], onsetT: -1, live: null };
    const shortSide = () => Math.max(1, Math.min(engine.size.w, engine.size.h));
    // Input timestamps → sim time: extrapolated from the last frame at the game/real clock ratio
    // (time scale, slow-mo and the engine's dt cap all included).
    let frameT = 0, frameRatio = 1;
    function simAt(tMs) {
      const d = (tMs - frameT) / 1000;
      return simTime + (Math.abs(d) < 0.25 ? clamp(d, 0, 0.1) * frameRatio : 0);
    }

    const detSim = g => (g.simDet != null ? g.simDet : simAt(g.detT));
    const gestureInput = r => ({ pace: r.pace, uy: r.uy, aimX: r.ux, len: r.len, dur: r.dur });

    /** Pace / direction of a live gesture (or one already released); autoplay's are fixed. */
    function readGesture(g, until) {
      if (g.fixed) return { pace: g.fixed.pace, ux: g.fixed.aimX, uy: g.fixed.uy, ns: 0, len: null, dur: null };
      const side = Math.min(shortSide(), PACE_SIDE_MAX);
      let S = g.samples;
      if (until != null && S.length > 1 && S[S.length - 1].t > until) {
        S = S.filter(q => q.t <= until);
        if (S.length < 2) S = g.samples.slice(0, 2);
      }
      let i0 = 0;
      while (i0 < S.length - 1 && S[i0 + 1].t <= g.onsetT) i0++;              // the still sample the motion started from
      let peak = 0;
      for (let i = i0 + 1, j = i0; i < S.length; i++) {
        while (j + 1 < i && S[i].t - S[j + 1].t >= 32) j++;
        const dt = S[i].t - S[j].t;
        if (dt >= 32) peak = Math.max(peak, Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) / dt * 1000);
      }
      const first = S[i0], last = S[S.length - 1];
      if (!peak) peak = Math.hypot(last.x - first.x, last.y - first.y) / Math.max(16, last.t - first.t) * 1000;   // bunched samples
      if (g.swipePeak && (until == null || g.upT <= until)) peak = Math.max(peak, g.swipePeak);
      const dx = last.x - first.x, dy = last.y - first.y, len = Math.hypot(dx, dy) || 1;
      const ns = peak / side;
      return { pace: clamp((ns - PACE_NS0) / (PACE_NS1 - PACE_NS0), 0, 1), ux: dx / len, uy: -dy / len, ns,
        len: len / shortSide(), dur: (last.t - first.t) / 1000 };
    }

    ctx.input.on('down', p => {
      gest.active = true; gest.onsetT = -1; gest.live = null; gest.tossed = false;
      gest.samples = [{ t: p.t, x: p.x, y: p.y }];
    });
    ctx.input.on('move', p => {
      if (!gest.active) return;
      const S = gest.samples;
      S.push({ t: p.t, x: p.x, y: p.y });
      if (S.length > 240) S.splice(0, 60);
      if (gest.onsetT < 0 && Math.hypot(p.dx, p.dy) > 6) gest.onsetT = S[S.length - 2].t;
      if (gest.live) return;                                    // fired: keep sampling for pace
      // speed over the last ~60 ms (never across a pause before the move)
      let j = S.length - 2;
      while (j > 0 && p.t - S[j - 1].t <= 60) j--;
      const ref = S[j], dtm = (p.t - ref.t) / 1000, s = shortSide();
      const vNow = dtm > 0.004 ? Math.hypot(p.x - ref.x, p.y - ref.y) / dtm / s : 0;
      const travel = Math.hypot(p.dx, p.dy) / s;
      if ((travel >= 0.05 && vNow >= 0.8) || travel >= 0.14) {
        fire({ detT: p.t, onsetT: gest.onsetT < 0 ? p.t : gest.onsetT, samples: S, quick: vNow * s / Math.min(s, PACE_SIDE_MAX) > 3.5 });
      }
    });
    ctx.input.on('up', p => {
      if (!gest.active) return;
      gest.active = false;
      const S = gest.samples;
      if (!p.cancelled) S.push({ t: p.t, x: p.x, y: p.y });
      if (gest.live) gest.live.upT = p.t;
      // Waiting to serve: any short press tosses (a thumb's tap often drifts into a little swipe);
      // only a long, deliberate swipe gets the reminder.
      gest.tossed = false;
      if (phase === 'serveReady' && score.server === 0 && !p.cancelled) {
        const travel = Math.hypot(p.x - S[0].x, p.y - S[0].y) / shortSide();
        if (travel < 0.1 && p.t - S[0].t < 350) { gest.tossed = true; hideHint(); doToss(0); }
        else if (travel >= 0.1) popupAt(player, 'Tap to toss first!', '#FFFFFF');
      }
    });
    ctx.input.on('swipe', sw => {
      if (gest.tossed) return;
      if (gest.live) { gest.live.swipePeak = sw.peakSpeed; return; }
      // a flick too quick to be caught mid-move: judge it from its release
      const S = sw.path.map(q => ({ t: q.t, x: q.x, y: q.y }));
      fire({ detT: sw.end.t, onsetT: S[0].t, samples: S, swipePeak: sw.peakSpeed, quick: sw.npeakSpeed > 3.5, upT: sw.end.t });
    });
    function fire(g) {
      gest.live = g;
      onGesture(g);
    }
    ctx.input.on('tap', () => {
      if (phase === 'serveReady' && score.server === 0) { hideHint(); doToss(0); return; }
      if (skipFn && (phase === 'pointOver' || phase === 'fault' || phase === 'done')) skipFn();
    });
    ctx.input.on('key', k => {
      if (!k.down || k.repeat) return;
      if (k.key === ' ' || k.key === 'Enter') {
        if (phase === 'serveReady' && score.server === 0) { hideHint(); doToss(0); }
        else if (skipFn) skipFn();
      }
    });

    function onGesture(g) {
      if (phase === 'toss' && score.server === 0) { serveSwipe(g); return; }
      if (phase === 'serveReady') return;               // decided on release (see 'up')
      if (phase === 'play') strokeSwipe(g);
    }

    // =============================================================================================
    // Per-frame update
    // =============================================================================================

    function processPending() {
      for (let i = 0; i < pending.length; i++) {
        const c = pending[i];
        if (c.at > simTime) continue;
        pending.splice(i, 1);
        i--;
        if (c.type === 'swing') {
          const a = ath[c.who];
          if (!a.swing && !pt.decided) {
            a.startSwing(c.kind, c.tc, c.y);
            audio.sfx('swing_light', { vol: 0.35 });
          }
        } else if (c.type === 'serve') resolveServe(c);
        else if (c.type === 'stroke') resolveStroke(c);
        else if (c.type === 'feed') resolveFeed();
      }
    }

    function physics(dt) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 64) {
        acc -= STEP; n++;
        simTime += STEP;
        if (autoplay) autoStep();
        updateMovement(STEP);
        for (const a of ath) moveAthlete(a, STEP);
        processPending();
        if (ball.live) { stepBall(ball, STEP, onBallEvent); checkDeadBall(); }
      }
      if (n >= 64) acc = 0;
    }

    function updateFlow(dt) {
      // Toss dropped without a swing: catch it and toss again.
      if (phase === 'toss' && !pt.serveSwung && ball.vy < 0 && ball.y < 1.05 && score.server === 0 && !pending.some(c => c.type === 'serve')) {
        hideBall();
        player.prep = null;
        phase = 'serveReady';
        popupAt(player, 'Toss again', '#FFFFFF');
        if (!autoplay) showHint('tap', 'Tap to toss, then swipe up as the ring closes!');
      }
      // Soft-lock guards: a live ball nobody can play, or a point decided without moving the flow on.
      if ((pt.phase === 'serve' || pt.phase === 'rally') && !pt.decided && phase === 'play' && simTime - pt.lastHitAt > 9) {
        pointOver(pt.bounces >= 1 ? pt.hitter : 1 - pt.hitter, 'winner');
      }
      if (phase === 'play' && pt.decided) {
        if (pt.decidedAt < 0) pt.decidedAt = simTime;
        else if (simTime - pt.decidedAt > 3) setupPoint();
      } else pt.decidedAt = -1;
      if (pt.decided && ball.live && (phase === 'pointOver' || phase === 'done' || phase === 'fault') && Math.abs(ball.z) > WALL_Z + 6) hideBall();
      updateInfo(dt);
      updateTimingBar(dt);
      updateCall(dt);
    }

    function updateMovement(dt) {
      for (const a of ath) {
        if (a.frozen) continue;
        const plan = a.plan;
        if (plan && plan.ok && !plan.leave && !pt.decided) {
          if (a.react > 0) a.react -= dt;
          else a.setTarget(plan.sx, plan.sz);
          const toGo = plan.t - simTime;
          if (toGo < 0.55 && toGo > -0.2 && !a.swing) a.prepare(plan.kind, plan.cy);
          if (toGo < -0.25 && a.prep) a.prep = null;
          if (toGo < -0.15 && !a.swing && !plan.missedShown && pt.hitter !== a.idx && plan.deficit > 0.4) {
            plan.missedShown = true;
            missed(a, null);
          }
        } else if (plan && plan.leave && !pt.decided && plan.bounce) {
          a.prep = null;
        }
      }
    }

    /** Autoplay runs on the physics clock so its timing holds at any frame rate or time scale. */
    function autoStep() {
      if (phase === 'serveReady' && score.server === 0) {
        if (auto.tossAt < 0) auto.tossAt = simTime + 0.45;
        else if (simTime >= auto.tossAt) { auto.tossAt = -1; hideHint(); doToss(0); }
      } else auto.tossAt = -1;
      if (phase === 'toss' && score.server === 0 && !pt.serveSwung) {
        if (auto.serveAt < 0) auto.serveAt = pt.tossHit - SWIPE_LEAD + gauss(autoRng) * 0.05;
        else if (simTime >= auto.serveAt) {
          auto.serveAt = -1;
          serveSwipe({ simDet: simTime, quick: true, fixed: { pace: autoRng.range(0.45, 0.95), aimX: autoRng.range(-0.8, 0.8), uy: 0.9 } });
        }
      } else auto.serveAt = -1;
      const plan = player.plan;
      if (phase === 'play' && plan && plan.ok && !plan.leave && !plan.used && pt.hitter === 1) {
        if (auto.plan !== plan) {
          auto.plan = plan;
          const sd = playerPressureSd(auto.opts.sd + (MODE === 'rally' ? 0.0022 * rallyState.streak : 0), plan);
          auto.swingAt = plan.t - SWIPE_LEAD + (auto.opts.bias || 0) + gauss(autoRng) * sd;
        }
        if (simTime >= auto.swingAt) {
          const input = botInput(autoRng, auto.opts, cpu.pos.x);
          strokeSwipe({ simDet: simTime, quick: input.pace > 0.75, fixed: input });
        }
      }
    }

    const _bv = new V3();
    function updateBallVisual(dt) {
      if (ball.live || phase === 'feedSwing') {
        ballMesh.visible = true;
        ballOffset.multiplyScalar(Math.exp(-20 * dt));
        if (ballOffset.lengthSq() < 1e-6 || !ball.live) ballOffset.set(0, 0, 0);
        ballMesh.position.set(ball.x + ballOffset.x, Math.max(BALL_R, ball.y + ballOffset.y), ball.z + ballOffset.z);
        const dist = camera.position.distanceTo(ballMesh.position);
        const s = clamp(dist * 0.16, 1, 6);
        ballMesh.scale.setScalar(s);
        ballShadow.visible = ball.y < 12;
        ballShadow.position.set(ball.x, 0.011, ball.z);
        const hs = clamp(1 - ball.y / 6, 0.25, 1);
        ballShadow.scale.setScalar(s * 0.45 * (1.4 - 0.4 * hs));
        ballShadow.material.opacity = 0.5 * hs;
        if (trail.visible && Math.hypot(ball.vx, ball.vy, ball.vz) < 12) trail.visible = false;
        const myToss = phase === 'toss' && score.server === 0;
        tossRim.visible = myToss;
        if (myToss) tossRim.quaternion.copy(camera.quaternion);
        // the ring closes onto the ball when it's time to swipe, then lingers a moment and fades
        const toClose = pt.tossHit - SWIPE_LEAD - simTime;
        const ring = myToss && !pt.serveSwung && timingAids() && toClose < RING_LEAD && toClose > -0.12;
        apexRing.visible = ring;
        if (ring) {
          const k = clamp(toClose / RING_LEAD, 0, 1);
          apexRing.quaternion.copy(camera.quaternion);
          apexRing.scale.setScalar(1 + 2.2 * k);
          apexRing.material.opacity = toClose > 0 ? 0.95 * Math.min(1, (1 - k) * 4) : 0.95 * (1 + toClose / 0.12);
          apexRing.material.color.setHex(toClose > 0.05 ? 0xFFF59A : 0xFFFFFF);
        }
      } else if (phase === 'serveReady' || phase === 'cpuServeWait') {
        // ball held in the server's free hand
        const srv = ath[score.server];
        srv.pal.handWorld(srv.hand > 0 ? 'L' : 'R', _bv);
        ballMesh.visible = true;
        ballMesh.position.set(_bv.x, _bv.y + 0.07, _bv.z);
        ballMesh.scale.setScalar(clamp(camera.position.distanceTo(_bv) * 0.16, 1, 6));
        ballShadow.visible = false;
      } else {
        ballMesh.visible = false;
        ballShadow.visible = false;
      }
      for (const m of marks) {
        if (m.life <= 0) continue;
        m.life -= dt / 2.4;
        m.mesh.material.opacity = 0.75 * clamp(m.life * 2, 0, 1);
        if (m.life <= 0) m.mesh.visible = false;
      }
      if (landing.visible) {
        landingT += dt;
        landing.material.opacity = 0.42 * Math.min(1, landingT * 4) * (0.75 + 0.25 * Math.sin(landingT * 9));
        landing.scale.setScalar(1 + 0.08 * Math.sin(landingT * 9));
      }
    }

    // =============================================================================================
    // Autoplay / debug helpers
    // =============================================================================================

    function forcePoint(winner) {
      const w = winner === 'cpu' || winner === 1 ? 1 : 0;
      if (phase === 'done' || phase === 'intro') return false;
      pt.decided = false;
      pt.hitter = w;
      pointOver(w, 'winner', { force: true });
      return true;
    }

    function setScore(o) {
      o = o || {};
      if (Array.isArray(o.points)) score.pts = [clamp(o.points[0] | 0, 0, 20), clamp(o.points[1] | 0, 0, 20)];
      if (Array.isArray(o.games)) score.games = [clamp(o.games[0] | 0, 0, GAMES_TO_WIN - 1), clamp(o.games[1] | 0, 0, GAMES_TO_WIN - 1)];
      if (o.server != null) score.server = o.server === 'cpu' || o.server === 1 ? 1 : 0;
      if (o.streak != null) { rallyState.streak = o.streak | 0; rallyState.best = Math.max(rallyState.best, rallyState.streak); }
      if (o.lives != null) rallyState.lives = clamp(o.lives | 0, 1, 3);
      if (phase !== 'intro' && phase !== 'done') setupPoint();
      renderBoard();
      return debugState();
    }

    /** Input → outcome distribution for your shots (no rendering). */
    function simulate(o) {
      o = Object.assign({ style: 'random' }, o);
      const r = U.rng(o.seed || 99);
      const n = clamp(o.n || 200, 1, 2000);
      const out = { n, in: 0, out: 0, net: 0, tiers: {}, kmh: 0, depth: 0, wide: 0, apex: 0 };
      for (let i = 0; i < n; i++) {
        const err = o.err != null ? o.err : gauss(r) * (o.timingSd != null ? o.timingSd : 0.04);
        if (o.serve) {
          const from = { x: 0.75, y: 2.4, z: HALF_L + 0.25 - CONTACT.oh.fwd };
          const inp = botInput(r, o, 0);
          const it = serveIntent(inp, err, { H: 1, boxSign: -1, second: !!o.second });
          out.tiers[it.tier] = (out.tiers[it.tier] || 0) + 1;
          const sol = launchFromIntent(from, 1, it, r);
          const b = Object.assign(newBall(), from, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin });
          const pr = predict(b, 3);
          const first = pr.events.find(e => e.type === 'bounce' || e.type === 'net' || e.type === 'cord-back');
          if (!first || first.type !== 'bounce' || first.z > 0) out.net++;
          else if (boxMargin(first.x, first.z, -1, 1) >= 0) out.in++;
          else out.out++;
          out.kmh += Math.hypot(sol.vx, sol.vy, sol.vz) * 3.6;
          continue;
        }
        const tier = timingTier(err);
        out.tiers[tier] = (out.tiers[tier] || 0) + 1;
        if (tier === 'whiff') { out.whiff = (out.whiff || 0) + 1; continue; }
        const kind = o.kind || 'fh';
        const from = { x: o.x != null ? o.x : 1.4, y: o.y != null ? o.y : 0.95, z: o.z != null ? o.z : HALF_L - 0.2 };
        const it = strokeIntent(botInput(r, o, 0), err, { H: 1, side: kind === 'bh' ? -1 : 1, kind, contactY: from.y, stretch: o.stretch || 0 });
        const sol = launchFromIntent(from, 1, it, r);
        const b = Object.assign(newBall(), from, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin });
        const pr = predict(b, 3.5);
        for (let k = 2; k < pr.pts.length; k += 4) out.apex = Math.max(out.apex, pr.pts[k]);
        const first = pr.events.find(e => e.type === 'bounce' || e.type === 'net' || e.type === 'cord-back');
        if (!first || first.type !== 'bounce' || first.z > 0) out.net++;
        else if (courtMargin(first.x, first.z) >= 0) { out.in++; out.depth += -first.z; out.wide += Math.abs(first.x); }
        else out.out++;
        out.kmh += Math.hypot(sol.vx, sol.vy, sol.vz) * 3.6;
      }
      const hits = n - (out.whiff || 0);
      out.kmh = Math.round(out.kmh / Math.max(1, hits));
      out.depth = +(out.depth / Math.max(1, out.in)).toFixed(2);
      out.wide = +(out.wide / Math.max(1, out.in)).toFixed(2);
      out.inPct = Math.round(out.in / n * 100);
      out.apex = +out.apex.toFixed(1);
      return out;
    }

    /**
     * Offline points: an autoplayer (timing sd, input style) vs a CPU, using the live solver, physics,
     * planner, CPU model AND movement: both athletes run with the same steering as in play (reaction
     * delay, acceleration, recovery between shots) and the same reach rule at contact.
     * o: { skill, timingSd, bias, style, pace, aimX, uy, serve: 'you'|'cpu', seed }.
     */
    function simulateRally(n, o) {
      o = o || {};
      const r = U.rng(o.seed || 1234);
      const sd = o.timingSd != null ? o.timingSd : 0.035;
      const skill = o.skill != null ? clamp(o.skill, 0, 1) : SKILL;
      const serveBy = o.serve === 'you' ? 0 : o.serve === 'cpu' ? 1 : -1;
      const mk = (idx, m) => ({ idx, H: sideSign(idx), hand: 1, pos: { x: 0, z: 0 }, vx: 0, vz: 0, tx: 0, tz: 0, vmax: m.vmax, accel: m.accel, react: m.react, frozen: false });
      const A = [mk(0, { vmax: PLAYER_VMAX, accel: PLAYER_ACCEL, react: PLAYER_REACT }), mk(1, cpuMotion(skill))];
      const place = (a, x, z) => { a.pos.x = a.tx = x; a.pos.z = a.tz = z; a.vx = a.vz = 0; };
      const res = { points: 0, won: [0, 0], rallies: [], reasons: {}, kmh: 0, serves: 0, reachMiss: [0, 0], tiers: {}, tactics: {}, unreturned: 0, smashes: 0, cpuWinners: {} };
      const DT = 1 / 120;
      for (let k = 0; k < (n || 50); k++) {
        let who, it, from, serveNo = 0, boxSign = 0, shots = 0, reason = null, winner = -1;
        if (serveBy >= 0) {
          who = serveBy;
          const H = sideSign(who);
          place(A[who], H * 0.75, H * (HALF_L + 0.25));
          place(A[1 - who], -H * 2.8, -H * (HALF_L + 1.5));
          boxSign = -H;
          from = { x: A[who].pos.x + H * CONTACT.oh.lat, y: 2.4, z: A[who].pos.z - H * CONTACT.oh.fwd };
          serveNo = 1;
        } else {
          // the CPU plays a neutral rally ball to you from its baseline
          who = 1;
          place(A[0], 0.5, HALF_L + 0.7);
          place(A[1], r.range(-1.5, 1.5), -(HALF_L + 0.6));
          from = { x: A[1].pos.x - 0.93, y: 0.95, z: A[1].pos.z + 0.47 };
          it = cpuIntent(skill, gauss(r) * cpuTimingSd(skill), { kind: 'fh', stretch: 0, contactY: 0.95, playerX: A[0].pos.x, playerZabs: HALF_L + 0.7, contactZabs: HALF_L, cpuX: from.x }, r);
        }
        while (shots < 200) {
          const H = sideSign(who), recv = 1 - who, ha = A[who], ra = A[recv];
          const isServe = serveNo > 0 && shots === 0;
          if (isServe) {
            const input = who === 0 ? { pace: o.servePace != null ? o.servePace : r.range(0.45, 0.95), uy: 0.9, aimX: o.serveAim != null ? o.serveAim : r.range(-0.8, 0.8) }
              : { pace: clamp(0.45 + 0.5 * skill + r.range(-0.12, 0.12), 0, 1), uy: 0.6, aimX: r.range(-1, 1) };
            const err = who === 0 && o.serveErr != null ? o.serveErr : gauss(r) * (who === 0 ? 0.05 : 0.09 - 0.065 * skill);
            it = serveIntent(input, err, { H, boxSign, second: serveNo === 2 });
          }
          const sol = launchFromIntent(from, H, it, r);
          if (isServe) { res.kmh += Math.hypot(sol.vx, sol.vy, sol.vz) * 3.6; res.serves++; }
          const b = Object.assign(newBall(), from, { vx: sol.vx, vy: sol.vy, vz: sol.vz, spin: sol.spin });
          const pr = predict(b, 4.2);
          const first = pr.events.find(e => e.type === 'bounce' || e.type === 'net' || e.type === 'cord-back');
          const landed = first && first.type === 'bounce' && sideOfZ(first.z) === recv;
          const inside = landed && (isServe ? boxMargin(first.x, first.z, boxSign, recv) >= 0 : courtMargin(first.x, first.z) >= 0);
          if (!inside) {
            if (isServe && serveNo === 1) { serveNo = 2; continue; }
            reason = isServe ? 'double' : landed ? 'out' : 'net'; winner = recv; break;
          }
          shots++;
          ha.tx = clamp(from.x * 0.25, -1.4, 1.4); ha.tz = ha.H * (HALF_L + 0.8);   // the hitter recovers
          const react = isServe ? ra.react * (recv === 1 ? serveReact(skill) : SERVE_REACT) : ra.react + paceRead(Math.hypot(sol.vx, sol.vy, sol.vz), recv, skill);
          const plan = planIntercept({ idx: recv, x: ra.pos.x, z: ra.pos.z, vmax: ra.vmax, accel: ra.accel, react, hand: 1 }, pr, 0, isServe ? { serve: { boxSign } } : null);
          if (!plan.ok) { reason = isServe ? 'ace' : 'unreached'; winner = who; break; }
          plan.perfectIn = who === 0 && !isServe && it.tier === 'perfect';
          const err = recv === 0 ? (o.bias || 0) + gauss(r) * playerPressureSd(sd, plan) : cpuStrokeErr(skill, plan, r, false, shots);
          const tier = timingTier(err);
          res.tiers[recv + tier] = (res.tiers[recv + tier] || 0) + 1;
          if (tier === 'whiff') { reason = isServe ? 'ace' : 'whiff'; winner = who; break; }
          const at = Math.max(plan.t + (recv === 0 ? Math.max(0.3 * err, err - SWIPE_LEAD + PACE_READ) : 0.3 * err), plan.bounce.t + 0.02);
          for (let t = 0; t < at; t += DT) {
            if (t >= react) { ra.tx = plan.sx; ra.tz = plan.sz; }
            moveAthlete(ha, DT); moveAthlete(ra, DT);
          }
          const cx = ra.pos.x + ra.H * CONTACT[plan.kind].lat, cz = ra.pos.z - ra.H * CONTACT[plan.kind].fwd;
          const reach = Math.hypot(cx - plan.cx, cz - plan.cz);
          if (reach > reachVs(plan)) { res.reachMiss[recv]++; reason = isServe ? 'ace' : 'unreached'; winner = who; break; }
          from = { x: plan.cx, y: plan.cy, z: plan.cz };
          const stretch = clamp((reach - 0.35) / 0.55, 0, 1);
          if (recv === 0) it = strokeIntent(botInput(r, o, A[1].pos.x), err, { H: 1, side: plan.kind === 'bh' ? -1 : 1, kind: plan.kind, contactY: plan.cy, stretch });
          else {
            it = cpuIntent(skill, err, {
              kind: plan.kind, stretch, contactY: plan.cy, playerX: A[0].pos.x, playerZabs: Math.abs(A[0].pos.z), contactZabs: Math.abs(plan.cz), cpuX: plan.cx,
              playerRecovering: Math.hypot(A[0].tx - A[0].pos.x, A[0].tz - A[0].pos.z) > 1.2, shots,
              inSpin: it.spin, inSpeed: plan.speed, inLaunch: plan.launch, serveReturn: isServe,
            }, r);
            res.tactics[it.tactic] = (res.tactics[it.tactic] || 0) + 1;
          }
          if (recv === 1) applyHeat(it, shots);
          who = recv;
        }
        res.points++;
        res.won[winner]++;
        res.rallies.push(shots);
        if (serveBy >= 0 && shots === 1 && winner === serveBy) res.unreturned++;
        const key = (winner === 0 ? 'you:' : 'cpu:') + reason;
        res.reasons[key] = (res.reasons[key] || 0) + 1;
        if (winner === 1 && reason === 'unreached' && it) res.cpuWinners[it.tactic] = (res.cpuWinners[it.tactic] || 0) + 1;
      }
      const avg = res.rallies.reduce((sum, v) => sum + v, 0) / Math.max(1, res.rallies.length);
      return { points: res.points, youWon: res.won[0], cpuWon: res.won[1], winPct: Math.round(res.won[0] / Math.max(1, res.points) * 100),
        avgRally: +avg.toFixed(1), maxRally: Math.max(0, ...res.rallies), ge10: res.rallies.filter(v => v >= 10).length, ge15: res.rallies.filter(v => v >= 15).length, smashes: res.smashes, reasons: res.reasons, reachMiss: res.reachMiss, tiers: res.tiers, tactics: res.tactics, cpuWinners: res.cpuWinners,
        serveKmh: res.serves ? Math.round(res.kmh / res.serves) : null, unreturnedPct: Math.round(res.unreturned / Math.max(1, res.points) * 100) };
    }

    function debugState() {
      const p = player.plan;
      return {
        phase, mode: MODE, simTime: +simTime.toFixed(2),
        score: { points: score.pts.slice(), games: score.games.slice(), server: score.server === 0 ? 'you' : 'cpu', serveNo: score.serveNo, call: MODE === 'rally' ? null : callText() },
        rally: pt.shots, rule: pt.phase, hitter: pt.hitter, bounces: pt.bounces, decided: pt.decided,
        tossHitIn: phase === 'toss' ? +(pt.tossHit - simTime).toFixed(3) : null,
        streak: rallyState.streak, best: rallyState.best, lives: rallyState.lives,
        ball: { live: !!ball.live, x: +ball.x.toFixed(2), y: +ball.y.toFixed(2), z: +ball.z.toFixed(2),
          speed: +Math.hypot(ball.vx, ball.vy, ball.vz).toFixed(1), spin: +ball.spin.toFixed(2) },
        plan: p ? { ok: p.ok, leave: p.leave, kind: p.kind || null, in: p.t != null ? +(p.t - simTime).toFixed(2) : null, deficit: p.deficit != null ? +p.deficit.toFixed(2) : null } : null,
        players: { you: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)], cpu: [+cpu.pos.x.toFixed(2), +cpu.pos.z.toFixed(2)] },
        swing: player.swing ? { kind: player.swing.kind, t: +player.swing.t.toFixed(2), tc: +player.swing.tc.toFixed(2) } : null,
        lastShot, autoplay,
        camera: { shot: camRig.shot ? camRig.shot.kind : null, blend: +camRig.w.toFixed(2), pitch: +(camRig.pitch * 180 / Math.PI).toFixed(1), h: +camRig.pos.y.toFixed(2), z: +camRig.pos.z.toFixed(2), vFov: +camera.fov.toFixed(1) },
        stats: { won: stats.won.slice(), aces: stats.aces.slice(), winners: stats.winners.slice(), errors: stats.errors.slice(), fastest: stats.fastest, longest: stats.longest },
      };
    }

    // =============================================================================================
    // Setup & lifecycle
    // =============================================================================================

    buildBoard();
    renderBoard();
    frameCamera();
    updateCamera();
    player.place(0.6, HALF_L + 0.7);
    cpu.place(-0.6, -(HALF_L + 0.7));
    player.playLoop('idle_ready');
    cpu.playLoop('idle_ready');
    umpire.play('idle');

    let umpLook = 0;
    return {
      start() {
        ambience = audio.loop('stadium_ambience', { vol: 0.5 });
        setupPoint();
        flashInfo(MODE === 'match' ? 'First to 3 games' : MODE === 'quick' ? 'One game · win by two' : '3 balls · keep it going!', 2.4);
      },
      update(dt) {
        const now = performance.now();
        if (frameT) frameRatio = clamp(dt / Math.max(0.001, (now - frameT) / 1000), 0, 10);
        frameT = now;
        if (finalShot && (finalShot.g.upT != null || now >= finalShot.until)) finalizeStroke();
        physics(dt);
        updateFlow(dt);
        for (const a of ath) updateAthlete(a, dt);
        player.pal.update(dt);
        cpu.pal.update(dt);
        umpLook -= dt;
        if (umpLook <= 0) { umpLook = 0.15; umpire.lookAt(ballMesh.visible ? ballMesh.position : null); }
        umpire.update(dt);
        updateBallVisual(dt);
        updateCamera();
      },
      onResize() { camRig.dirty = true; },
      dispose() {
        offHolds();
        if (ambience) { ambience.stop(0.3); ambience = null; }
        hideHint();
        trail.dispose();
        crowd.dispose();
        for (const a of ath) { engine.disposeObject(a.racket); a.pal.dispose(); }
        umpire.dispose();
      },
      debugState,
      debug: {
        /** autoplay(on, { sd, bias, style, pace }) — style as in simulateRally. */
        autoplay(on, opts) {
          autoplay = on !== false;
          auto.opts = Object.assign({ sd: 0.035 }, opts);
          auto.plan = null;
          if (autoplay) hideHint();
          return autoplay;
        },
        forcePoint,
        setScore,
        simulate,
        simulateRally,
        skip() { if (skipFn) skipFn(); },
        state: debugState,
      },
    };
  }

  SS.registerSport(DEF);
})();
