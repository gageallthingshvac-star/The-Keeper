/* Sunny Sports — sports/golf.js
 * GOLF at "Sunny Links": nine hand-authored parkland holes on rolling heightfield terrain.
 *  · Course: each hole is a centre-line spline plus features placed by distance-along / offset-from
 *    that line (fairways, green, bunkers, water, trees, OB). Heights and surfaces are analytic fields;
 *    the rendered terrain is a variable-density grid with a baked per-pixel surface splat, and ball
 *    physics runs on exactly that grid so the ball always sits on what you see.
 *  · Physics: fixed-step flight (drag, Magnus lift and curve, wind), bounce and roll per surface,
 *    slopes, trees, water, OB and cup capture. A shot is simulated in full at impact, then played back,
 *    so the camera always knows where the ball will land.
 *  · Control: drag sideways to aim, pull down for power, flick up to swing. Flick angle → push/pull
 *    and curve, a bent flick shapes the shot, flick speed and length → strike quality. Putts use the
 *    same gesture on a meter in metres (fixed ranges, so a longer putt is a longer pull).
 *  · Aids by mode (MODE_RULES): the landing ring marks a full swing; in Beginner it follows the pull,
 *    the meter has a carry mark and the putt meter a slope-read pace mark. Full 9 marks the hole's
 *    distance on the putt meter; Expert gives the metres only and no wind ring. Roll, slope and wind
 *    stay a read, and every full swing has a small hidden spread, so nothing is a sure thing.
 *  · Modes: beginner (holes 1–3), expert (7–9), full9. 1–4 hot-seat players play each hole in turn.
 *  · Debug: instance.debug = { autoplay, skipTo, shot, simulate, skip, … } and debugState().
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // =============================================================================================
  // 1. Registration data
  // =============================================================================================

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="32" cy="51" rx="27" ry="9.5" fill="#5CC765"/>' +
    '<ellipse cx="32" cy="49.6" rx="23" ry="6.6" fill="#7AD67F"/>' +
    '<ellipse cx="40" cy="50" rx="5.2" ry="2.1" fill="#1F3A24"/>' +
    '<path d="M40 50V9" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M41.4 9.2 59 15.6 41.4 22Z" fill="#FF5A5F"/>' +
    '<path d="M41.4 9.2 59 15.6 41.4 13.6Z" fill="#FF8286"/>' +
    '<circle cx="19" cy="46" r="6.6" fill="#FFFFFF" stroke="#D9E1EC" stroke-width="1.4"/>' +
    '<g fill="#D3DBE6"><circle cx="17" cy="44.2" r="1"/><circle cx="20.6" cy="44" r="1"/><circle cx="18.8" cy="47.4" r="1"/><circle cx="22" cy="47" r="1"/><circle cx="15.6" cy="47.6" r="1"/></g>' +
    '</svg>';

  const DEF = {
    id: 'golf',
    name: 'Golf',
    tagline: 'Pull, flick, sink it!',
    accent: '#2FAE55',
    tint: '#E5F7E8',
    icon: ICON,
    music: 'golf',
    players: { min: 1, max: 4 },
    opponent: false,
    modes: [
      { id: 'beginner', name: 'Beginner 3', desc: 'Three friendly holes to warm up.' },
      { id: 'expert', name: 'Expert 3', desc: 'Three tricky holes with water, sand and wind to read.' },
      { id: 'full9', name: 'Full 9', desc: 'The whole parkland course. Can you beat par?' },
    ],
    howTo: {
      steps: [
        { gesture: 'drag-h', text: 'Drag sideways to aim your shot' },
        { gesture: 'drag-down-up', text: 'Pull down for power, then flick straight up' },
        { gesture: 'drag-down-up', text: 'On the green the meter reads metres: pull to the distance' },
        { gesture: 'swipe-up-curve', text: 'Bend your flick to curve the ball around trees' },
      ],
      tips: [
        'The ring marks a full swing. Pull less to hit it shorter.',
        'Tap the club to switch it. Tap the map to see the whole hole.',
        'On the green, arrows flow downhill. Read the slope!',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Finish Beginner 3 at even par or better' },
      { id: 'silver', name: 'Silver', desc: 'Finish Expert 3 at even par or better' },
      { id: 'gold', name: 'Gold', desc: 'Finish Full 9 under par' },
      { id: 'platinum', name: 'Platinum', desc: 'Make a hole in one' },
    ],
    create,
  };

  // =============================================================================================
  // 2. Constants: clubs, surfaces, physics
  // =============================================================================================

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const GRAV = 9.81;
  const BALL_R = 0.032;            // contact radius (a touch bigger than real so it reads on screen)
  const CUP_R = 0.075;             // a little generous (real: 0.054) so it reads on a phone
  const STEP = 1 / 120;            // physics step (s)
  const MAX_SIM_T = 32;
  const AERO = 0.0187;             // 0.5·ρ·A / m for a golf ball
  const CD = 0.235;                // drag coefficient
  const SPIN_R = 0.0214;           // real ball radius for the spin parameter
  const SPIN_DECAY = 0.05;         // per second
  const CAPTURE_V = 1.2;           // m/s: slower than this over the cup drops in
  const LIP_V = 2.2;               // m/s: up to this, a centred hit can lip out
  const PUTT_DECEL = 0.9;          // green rolling resistance (m/s²); the putt meter's metres assume it
  const MAX_OVER_PAR = 4;          // pick up at par + 4

  // carry: full-swing carry (m, flat, calm). launch: degrees. spin: backspin rad/s at vNom.
  const CLUBS = [
    { id: 'D', name: 'Driver', short: 'DR', carry: 204, launch: 13.5, spin: 330, vNom: 66, len: 0.78, sfx: 'golf_drive', teeOnly: true },
    { id: '3W', name: '3 Wood', short: '3W', carry: 184, launch: 13.5, spin: 380, vNom: 61, len: 0.74, sfx: 'golf_drive' },
    { id: '5I', name: '5 Iron', short: '5I', carry: 157, launch: 16.5, spin: 520, vNom: 53, len: 0.68, sfx: 'golf_iron' },
    { id: '7I', name: '7 Iron', short: '7I', carry: 135, launch: 20, spin: 660, vNom: 48, len: 0.66, sfx: 'golf_iron' },
    { id: '9I', name: '9 Iron', short: '9I', carry: 113, launch: 25, spin: 800, vNom: 43, len: 0.64, sfx: 'golf_iron' },
    { id: 'PW', name: 'Wedge', short: 'PW', carry: 92, launch: 30, spin: 900, vNom: 39, len: 0.62, sfx: 'golf_chip' },
    { id: 'SW', name: 'Sand Wedge', short: 'SW', carry: 66, launch: 38, spin: 980, vNom: 33, len: 0.6, sfx: 'golf_chip' },
    { id: 'P', name: 'Putter', short: 'PT', putter: true, len: 0.66, sfx: 'golf_putt' },
  ];
  const PUTTER = CLUBS.length - 1;

  // e: bounce restitution · keep: tangential speed kept on a bounce · bite: how much backspin checks
  // the ball · roll: rolling resistance (m/s²) · dist: shot distance factor from this lie ·
  // spread: extra random start-line error (deg) · spin: backspin factor from this lie
  const SURF = {
    tee: { name: 'Tee', e: 0.3, keep: 0.64, bite: 0.6, roll: 2.2, dist: 1, spread: 0, spin: 1 },
    fairway: { name: 'Fairway', e: 0.3, keep: 0.64, bite: 0.6, roll: 2.2, dist: 1, spread: 0, spin: 1 },
    fringe: { name: 'Fringe', e: 0.25, keep: 0.62, bite: 0.8, roll: 1.6, dist: 1, spread: 0, spin: 1 },
    green: { name: 'Green', e: 0.2, keep: 0.7, bite: 1, roll: PUTT_DECEL, dist: 1, spread: 0, spin: 1 },
    rough: { name: 'Rough', e: 0.15, keep: 0.42, bite: 0.3, roll: 5.5, dist: 0.86, spread: 1.6, spin: 0.55 },
    sand: { name: 'Bunker', e: 0.04, keep: 0.12, bite: 0.2, roll: 9, dist: 0.68, spread: 2.4, spin: 0.7 },
    ob: { name: 'Out of Bounds', e: 0.15, keep: 0.42, bite: 0.3, roll: 5.5, dist: 0.86, spread: 1.6, spin: 0.55 },
    water: { name: 'Water', e: 0, keep: 0, bite: 0, roll: 20, dist: 0.5, spread: 3, spin: 0.5 },
  };

  const SCORE_NAMES = { '-4': 'Condor', '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double Bogey', 3: 'Triple Bogey' };
  function scoreName(strokes, par) {
    if (strokes === 1) return 'Hole in One';
    const d = strokes - par;
    return SCORE_NAMES[d] || (d > 0 ? '+' + d : 'Wow');
  }
  function toParText(n) { return n === 0 ? 'E' : n > 0 ? '+' + n : '−' + Math.abs(n); }

  // =============================================================================================
  // 3. Math helpers: smoothing, noise, blobs, paths
  // =============================================================================================

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function sstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function gauss(rng) {
    const u = Math.max(1e-9, rng.next()), v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  function wrapA(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

  /** Smooth 2D value noise in [-1, 1] (quintic fade), seeded. */
  function hash2(i, j, seed) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }
  function vnoise(x, z, seed) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const fx = x - xi, fz = z - zi;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed), c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }
  function fbm(x, z, seed) {
    return vnoise(x / 70, z / 70, seed) * 0.62 + vnoise(x / 31, z / 31, seed + 7) * 0.28 + vnoise(x / 13, z / 13, seed + 13) * 0.1;
  }
  /** Deterministic pseudo-random in [0,1) from a position (used inside the physics). */
  function phash(x, z) { return (hash2(Math.floor(x * 97), Math.floor(z * 89), 5) + 1) / 2; }

  /** Elliptical blob with a wobbly outline. rho(x, z) = 0 at the centre, 1 on the outline. */
  function makeBlob(cx, cz, rx, rz, phi, seed, wob = 0.08) {
    const r = SS.util.rng(seed);
    const b = { x: cx, z: cz, rx, rz, cos: Math.cos(phi), sin: Math.sin(phi), phi,
      a1: wob * r.range(0.5, 1), p1: r.next() * TAU, a2: wob * r.range(0.3, 0.7), p2: r.next() * TAU, rmax: 0 };
    b.rmax = Math.max(rx, rz) * (1 + b.a1 + b.a2);
    return b;
  }
  function blobRho(b, x, z) {
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * b.cos + dz * b.sin, lz = -dx * b.sin + dz * b.cos;
    const e = Math.sqrt((lx / b.rx) * (lx / b.rx) + (lz / b.rz) * (lz / b.rz));
    if (e < 1e-6) return 0;
    const th = Math.atan2(lz, lx);
    return e / (1 + b.a1 * Math.sin(2 * th + b.p1) + b.a2 * Math.sin(3 * th + b.p2));
  }
  /** Outline point at local angle th (world x, z). */
  function blobEdge(b, th, scale = 1) {
    const c = Math.cos(th), s = Math.sin(th);
    const w = 1 + b.a1 * Math.sin(2 * th + b.p1) + b.a2 * Math.sin(3 * th + b.p2);
    const r = scale * w / Math.sqrt((c / b.rx) * (c / b.rx) + (s / b.rz) * (s / b.rz));
    return [b.x + r * (c * b.cos - s * b.sin), b.z + r * (c * b.sin + s * b.cos)];
  }
  function blobNear(b, x, z, pad) { const dx = x - b.x, dz = z - b.z, r = b.rmax * pad; return dx * dx + dz * dz < r * r; }

  /** Catmull-Rom through control points, resampled every `step` metres. Returns [{x, z, s}]. */
  function samplePath(ctrl, step) {
    const raw = [];
    const P = i => ctrl[clamp(i, 0, ctrl.length - 1)];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < 32; k++) {
        const t = k / 32, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    raw.push(ctrl[ctrl.length - 1]);
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const total = cum[cum.length - 1];
    const out = [];
    let k = 0;
    for (let s = 0; s < total - 0.05; s += step) {
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const t = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
      out.push({ x: lerp(raw[k][0], raw[k + 1][0], t), z: lerp(raw[k][1], raw[k + 1][1], t), s });
    }
    out.push({ x: raw[raw.length - 1][0], z: raw[raw.length - 1][1], s: total });
    return out;
  }

  // =============================================================================================
  // 4. The course: nine hand-authored holes
  // =============================================================================================
  // Coordinates: tee at (0, 0), play heads roughly toward −Z. Features are placed either by
  // { s (metres along the centre line), d (metres right of it) } or relative to the green
  // with g: [right, beyond] in the green's approach frame. rot (rad) turns a blob from that frame.

  const HOLES = [
    { name: 'Sunny Start', par: 4, path: [[0, 0], [0, -100], [-3, -200], [4, -284]],
      elev: [[0, 2], [60, 0.4], [200, 0], [284, 0.8]], hills: 2.2, wind: [0, 2.5], treeD: 46,
      fairways: [[36, 262, 40]],
      green: { rx: 15, rz: 13, rot: 0.2, rise: 0.4, slope: [0.004, 0.007], und: 0.03, pin: [3, 2] },
      bunkers: [{ s: 214, d: 23, rx: 8, rz: 4.5, rot: 0.3 }, { g: [-15, -4], rx: 6, rz: 3.5, rot: 1.1 }, { g: [14, 7], rx: 5, rz: 3, rot: -0.7 }],
      water: [], clusters: [{ s: 120, d: -40, r: 10, n: 5 }] },
    { name: 'Little Hop', par: 3, path: [[0, 0], [-6, -128]],
      elev: [[0, 7], [40, 3.5], [128, 0.5]], hills: 2.4, wind: [0, 3], treeD: 34,
      fairways: [[96, 118, 22]],
      green: { rx: 13, rz: 12, rot: -0.4, rise: 0.3, slope: [-0.004, 0.007], und: 0.03, pin: [-3, 1] },
      bunkers: [{ g: [9, -12.5], rx: 7, rz: 3.4, rot: 0.2 }, { g: [-14.5, 2], rx: 4.5, rz: 6, rot: 0.1 }, { g: [2, 14.5], rx: 6, rz: 2.8, rot: 0 }],
      water: [], clusters: [] },
    { name: 'Long Meadow', par: 5, path: [[0, 0], [0, -190], [14, -300], [45, -380], [70, -440]],
      elev: [[0, 1], [150, -1], [300, 1.5], [455, 0.5]], hills: 2.8, wind: [0, 3], treeD: 50,
      fairways: [[38, 432, 38]],
      green: { rx: 15, rz: 12, rot: 0.5, rise: 0.5, slope: [0.006, 0.004], und: 0.035, pin: [-3, -2] },
      bunkers: [{ s: 236, d: -22, rx: 9, rz: 4.5, rot: 0.2 }, { s: 330, d: -9, rx: 6, rz: 3, rot: 0.1 }, { s: 338, d: 10, rx: 5, rz: 3, rot: -0.2 },
        { g: [-16, -2], rx: 6, rz: 4, rot: 0.9 }, { g: [15, -6], rx: 5.5, rz: 3.5, rot: -0.6 }],
      water: [], clusters: [{ s: 285, d: 42, r: 14, n: 7 }] },
    { name: 'Woodland Bend', par: 4, path: [[0, 0], [0, -195], [-22, -258], [-68, -296], [-88, -306]],
      elev: [[0, 1], [195, 0], [344, 2.2]], hills: 2.6, wind: [1, 3.5], treeD: 36,
      fairways: [[34, 322, 32]],
      green: { rx: 13, rz: 12, rot: -0.3, rise: 0.8, slope: [0.009, 0.007], und: 0.045, pin: [2, 3] },
      bunkers: [{ s: 229, d: 22, rx: 8, rz: 5, rot: 0.3 }, { g: [-12, -7], rx: 5, rz: 3.2, rot: 0.6 }, { g: [13, 3], rx: 4.5, rz: 3.5, rot: -0.4 }],
      water: [], clusters: [{ s: 214, d: -36, r: 16, n: 11 }, { s: 262, d: -38, r: 13, n: 8 }] },
    { name: 'Lily Pond', par: 3, path: [[0, 0], [3, -152]],
      elev: [[0, 2.5], [152, 1.2]], hills: 2, wind: [1, 4], treeD: 36,
      fairways: [[40, 94, 26]],
      green: { rx: 14, rz: 12, rot: 0.3, rise: 0.8, slope: [0, 0.011], und: 0.04, pin: [4, -1] },
      bunkers: [{ g: [-6, 15], rx: 7, rz: 3, rot: 0.1 }, { g: [16, 2], rx: 3.5, rz: 6, rot: 0 }],
      water: [{ s: 118, d: -3, rx: 24, rz: 13, rot: 0.12 }], clusters: [] },
    { name: 'Hilltop', par: 4, path: [[0, 0], [-6, -170], [0, -270], [8, -346]],
      elev: [[0, 0], [120, 1], [250, 5], [346, 8]], hills: 2.8, wind: [1, 4], treeD: 44, ob: { right: 34 },
      fairways: [[35, 330, 34]],
      green: { rx: 14, rz: 13, rot: 0.1, rise: 1.2, slope: [0.004, 0.013], und: 0.045, pin: [-4, 4] },
      bunkers: [{ s: 205, d: -19, rx: 8, rz: 4, rot: 0.2 }, { s: 233, d: 19, rx: 7, rz: 4.5, rot: -0.3 },
        { g: [-14, -4], rx: 5, rz: 3.5, rot: 0.8 }, { g: [1, -17.5], rx: 9, rz: 3, rot: 0 }],
      water: [], clusters: [] },
    { name: 'Creek Crossing', par: 4, path: [[0, 0], [4, -180], [-4, -280], [2, -366]],
      elev: [[0, 1.5], [220, -0.5], [366, 1.5]], hills: 2.4, wind: [2.5, 5.5], treeD: 40, ob: { right: 30 },
      fairways: [[34, 214, 30], [250, 350, 28]],
      green: { rx: 12, rz: 11, rot: -0.2, rise: 0.6, slope: [-0.01, 0.01], und: 0.05, pin: [4, 3] },
      bunkers: [{ s: 190, d: 18, rx: 7, rz: 4, rot: 0.2 }, { g: [-13, -3], rx: 5, rz: 3.4, rot: 0.9 }, { g: [13, -2], rx: 4.5, rz: 3.6, rot: -0.8 }, { g: [4, 14], rx: 6, rz: 2.8, rot: 0 }],
      water: [{ s: 232, d: 0, rx: 75, rz: 6.5, rot: 0, wob: 0.03 }], clusters: [{ s: 110, d: -34, r: 10, n: 6 }] },
    { name: 'Island Green', par: 3, path: [[0, 0], [-5, -165]],
      elev: [[0, 4.5], [165, 0.6]], hills: 2, wind: [2, 4.5], treeD: 40,
      fairways: [],
      green: { rx: 11.5, rz: 10, rot: 0.2, rise: 1.0, slope: [0.01, -0.008], und: 0.045, pin: [3, 2], island: true },
      bunkers: [{ g: [-10, 8], rx: 4, rz: 2.5, rot: 0.6 }],
      water: [{ s: 158, d: -2, rx: 40, rz: 42, rot: 0.2 }], clusters: [] },
    { name: 'Grand Finale', par: 5, path: [[0, 0], [0, -190], [28, -290], [22, -390], [-8, -478]],
      elev: [[0, 2], [190, 0], [390, 0.5], [489, 1.8]], hills: 2.6, wind: [2, 5], treeD: 46, ob: { right: 34 },
      fairways: [[40, 232, 32], [252, 470, 28]],
      green: { rx: 12.5, rz: 11, rot: 0.3, rise: 0.7, slope: [0.011, 0.008], und: 0.05, pin: [-2, 3] },
      bunkers: [{ s: 222, d: 20, rx: 8, rz: 4.5, rot: 0.2 }, { s: 394, d: 7, rx: 7, rz: 3.2, rot: 0 }, { g: [14, -3], rx: 5, rz: 3.6, rot: -0.7 }, { g: [-2, 15], rx: 6, rz: 2.8, rot: 0 }],
      water: [{ s: 330, d: -40, rx: 24, rz: 68, rot: 0.05 }, { g: [-17, -14], rx: 11, rz: 8, rot: 0.4 }], clusters: [{ s: 300, d: 46, r: 15, n: 8 }] },
  ];

  const MODE_HOLES = { beginner: [0, 1, 2], expert: [6, 7, 8], full9: [0, 1, 2, 3, 4, 5, 6, 7, 8] };

  /**
   * How much help each mode gives. gimme: putts finishing this close are tapped in (m) · dead: flick
   * angles inside this are dead straight · liveRing: the landing ring follows the pull (else it marks a
   * full swing) · carryLive: the meter reads the carry of the pull so far (else 'Full N m') · carryMark: the meter marks the pin's carry · puttMark: 'pace' (slope-read pace),
   * 'flag' (the hole's distance) or null · windRing: the blue ring for where the wind takes it ·
   * expect: [rookie, legend] to-par per hole the skill rating expects.
   */
  const MODE_RULES = {
    beginner: { gimme: 0.35, dead: 2 * Math.PI / 180, liveRing: true, carryLive: true, carryMark: true, puttMark: 'pace', windRing: true, expect: [1.0, -1.2] },
    full9: { gimme: 0.35, dead: 1.5 * Math.PI / 180, liveRing: false, carryLive: true, carryMark: false, puttMark: 'flag', windRing: true, expect: [1.4, -0.4] },
    expert: { gimme: 0, dead: 1.5 * Math.PI / 180, liveRing: false, carryLive: false, carryMark: false, puttMark: null, windRing: false, expect: [2.5, -0.1] },
  };

  // =============================================================================================
  // 5. Hole model: fields, grids, surfaces, terrain mesh data
  // =============================================================================================

  const TEE_BACK = 8, TEE_FRONT = 4, TEE_HALF = 4.5;
  const FRINGE_W = 1.5;

  /**
   * Builds everything the physics and the renderer need for hole `index` (pure data, no THREE).
   */
  function buildHoleModel(index) {
    const def = HOLES[index];
    const seed = 101 + index * 37;
    const M = { index, def, par: def.par, name: def.name, seed };

    // ---- centre line, extended 320 m past both ends for projection ------------------------------
    const pts = samplePath(def.path, 2);
    const L = pts[pts.length - 1].s;
    M.L = L;
    const ext = [];
    const a0 = pts[0], a1 = pts[1], b0 = pts[pts.length - 2], b1 = pts[pts.length - 1];
    const t0 = norm2(a1.x - a0.x, a1.z - a0.z), t1 = norm2(b1.x - b0.x, b1.z - b0.z);
    for (let k = 160; k >= 1; k--) ext.push({ x: a0.x - t0[0] * k * 2, z: a0.z - t0[1] * k * 2, s: -k * 2 });
    for (const p of pts) ext.push(p);
    for (let k = 1; k <= 160; k++) ext.push({ x: b1.x + t1[0] * k * 2, z: b1.z + t1[1] * k * 2, s: L + k * 2 });
    M.pts = pts;
    M.line = ext;
    M.tee = { x: 0, z: 0, dir: t0 };
    M.endDir = t1;

    // ---- elevation along the hole ----------------------------------------------------------------
    const keys = def.elev;
    M.elevAt = s => {
      if (s <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) {
        if (s <= keys[i][0]) {
          const t = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
          return lerp(keys[i - 1][1], keys[i][1], t * t * (3 - 2 * t));
        }
      }
      return keys[keys.length - 1][1];
    };

    // ---- frames for placing features --------------------------------------------------------------
    M.frameAt = s => {
      const i = clamp(Math.round(s / 2), 0, pts.length - 2);
      const p = pts[i], q = pts[i + 1];
      const t = norm2(q.x - p.x, q.z - p.z);
      const f = clamp((s - p.s) / 2, -200, 200);
      return { x: p.x + t[0] * f * 2, z: p.z + t[1] * f * 2, tx: t[0], tz: t[1] };
    };
    const gc = pts[pts.length - 1];
    M.greenFrame = { x: gc.x, z: gc.z, tx: t1[0], tz: t1[1] };
    const place = (spec) => {
      if (spec.g) {
        const F = M.greenFrame;
        return { x: F.x - F.tz * spec.g[0] + F.tx * spec.g[1], z: F.z + F.tx * spec.g[0] + F.tz * spec.g[1], tx: F.tx, tz: F.tz };
      }
      const F = M.frameAt(spec.s);
      return { x: F.x - F.tz * spec.d, z: F.z + F.tx * spec.d, tx: F.tx, tz: F.tz };
    };
    const lateralAngle = F => Math.atan2(F.tx, -F.tz);

    // ---- features ---------------------------------------------------------------------------------
    const gd = def.green;
    M.green = makeBlob(gc.x, gc.z, gd.rx, gd.rz, lateralAngle(M.greenFrame) + (gd.rot || 0), seed + 1, 0.07);
    M.green.def = gd;
    M.fringeRho = 1 + FRINGE_W / ((gd.rx + gd.rz) / 2);
    M.greenH = M.elevAt(L) + (gd.rise || 0);
    const pinP = place({ g: gd.pin });
    M.pin = { x: pinP.x, z: pinP.z };
    M.bunkers = (def.bunkers || []).map((b, i) => {
      const F = place(b);
      const blob = makeBlob(F.x, F.z, b.rx, b.rz, lateralAngle(F) + (b.rot || 0), seed + 20 + i, 0.1);
      blob.depth = b.depth || (b.g ? 0.55 : 0.45);
      blob.greenside = !!b.g;
      return blob;
    });
    M.water = (def.water || []).map((w, i) => {
      const F = place(w);
      const blob = makeBlob(F.x, F.z, w.rx, w.rz, lateralAngle(F) + (w.rot || 0), seed + 40 + i, w.wob == null ? 0.09 : w.wob);
      return blob;
    });
    M.fairways = (def.fairways || []).map(f => ({ from: f[0], to: f[1], w: f[2] }));
    const wseed = SS.util.rng(seed + 3);
    M.wob = [wseed.next() * TAU, wseed.next() * TAU, wseed.next() * TAU, wseed.next() * TAU];
    buildFairwayTable(M);
    const ob = def.ob || {};
    M.ob = { left: ob.left || 75, right: ob.right || 75, back: -45, front: L + 55 };

    // ---- bounds (inner = physics + splat; the mesh skirt extends far beyond) -----------------------
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const pad = 100;
    M.bounds = { x0: Math.floor(x0 - pad), x1: Math.ceil(x1 + pad), z0: Math.floor(z0 - pad), z1: Math.ceil(z1 + pad) };
    M.center = { x: (M.bounds.x0 + M.bounds.x1) / 2, z: (M.bounds.z0 + M.bounds.z1) / 2 };

    // ---- projection grid (s, d) every 2 m --------------------------------------------------------
    buildProjection(M);
    M.holeLen = Math.round(M.project(M.pin.x, M.pin.z, { s: 0, d: 0 }).s + 1);   // tee ball to pin along the hole

    // ---- water levels (from the base terrain at the blob centre) ----------------------------------
    for (const w of M.water) {
      const p = M.project(w.x, w.z);
      w.level = M.elevAt(p.s) - 0.35;
    }
    M.meanH = M.elevAt(L * 0.5);

    // ---- terrain grid (variable density: fine around the green and bunkers) ------------------------
    buildTerrain(M);
    return M;
  }

  function norm2(x, z) { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }

  function buildProjection(M) {
    const B = M.bounds, line = M.line;
    const step = 2;
    const nx = Math.floor((B.x1 - B.x0) / step) + 1, nz = Math.floor((B.z1 - B.z0) / step) + 1;
    const S = new Float32Array(nx * nz), D = new Float32Array(nx * nz);
    // segment data
    const n = line.length - 1;
    const sx = new Float32Array(n), sz = new Float32Array(n), dx = new Float32Array(n), dz = new Float32Array(n), len = new Float32Array(n), s0 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sx[i] = line[i].x; sz[i] = line[i].z;
      dx[i] = line[i + 1].x - line[i].x; dz[i] = line[i + 1].z - line[i].z;
      len[i] = Math.hypot(dx[i], dz[i]) || 1e-6; s0[i] = line[i].s;
    }
    // segments in chunks of 16 with bounding boxes, so far chunks are skipped cheaply
    const CH = 16, nc = Math.ceil(n / CH);
    const cb = new Float32Array(nc * 4);
    for (let c = 0; c < nc; c++) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = c * CH; k < Math.min(n, (c + 1) * CH); k++) {
        for (const [px, pz] of [[sx[k], sz[k]], [sx[k] + dx[k], sz[k] + dz[k]]]) { a0 = Math.min(a0, px); a1 = Math.max(a1, px); b0 = Math.min(b0, pz); b1 = Math.max(b1, pz); }
      }
      cb[c * 4] = a0; cb[c * 4 + 1] = a1; cb[c * 4 + 2] = b0; cb[c * 4 + 3] = b1;
    }
    let lastK = 0;
    for (let j = 0; j < nz; j++) {
      const z = B.z0 + j * step;
      for (let i = 0; i < nx; i++) {
        const x = B.x0 + i * step;
        let best = Infinity, bs = 0, bd = 0;
        // warm start around the previous point's nearest segment, then cull whole chunks
        const order = [Math.floor(lastK / CH)];
        for (let c = 0; c < nc; c++) if (c !== order[0]) order.push(c);
        for (const c of order) {
          const ex = Math.max(cb[c * 4] - x, 0, x - cb[c * 4 + 1]), ez = Math.max(cb[c * 4 + 2] - z, 0, z - cb[c * 4 + 3]);
          if (ex * ex + ez * ez >= best) continue;
          for (let k = c * CH, ke = Math.min(n, (c + 1) * CH); k < ke; k++) {
            const px = x - sx[k], pz = z - sz[k];
            const l = len[k];
            let t = (px * dx[k] + pz * dz[k]) / (l * l);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = px - dx[k] * t, qz = pz - dz[k] * t;
            const d2 = qx * qx + qz * qz;
            if (d2 < best) {
              best = d2;
              lastK = k;
              bs = s0[k] + t * l;
              bd = (px * -dz[k] + pz * dx[k]) / l;   // + = right of travel
            }
          }
        }
        S[j * nx + i] = bs;
        D[j * nx + i] = bd;
      }
    }
    M.proj = { nx, nz, step, S, D };
    const out = { s: 0, d: 0 };
    M.project = (x, z, o = out) => {
      const fx = clamp((x - B.x0) / step, 0, nx - 1.001), fz = clamp((z - B.z0) / step, 0, nz - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const k = j * nx + i;
      o.s = (S[k] * (1 - u) + S[k + 1] * u) * (1 - v) + (S[k + nx] * (1 - u) + S[k + nx + 1] * u) * v;
      o.d = (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + nx] * (1 - u) + D[k + nx + 1] * u) * v;
      return o;
    };
  }

  /** Fairway half-width at s on one side (side = −1 left, +1 right); 0 when no fairway. Tabulated. */
  function fairwayHalf(M, s, side) {
    const T = M.fwTable;
    const f = (s - T.s0) * 2;
    if (f <= 0 || f >= T.n - 1) return 0;
    const i = f | 0, u = f - i, a = side < 0 ? T.L : T.R;
    return a[i] + (a[i + 1] - a[i]) * u;
  }

  function fairwayHalfExact(M, s, side) {
    let best = 0;
    for (const f of M.fairways) {
      if (s <= f.from || s >= f.to) continue;
      const half = f.w / 2;
      const e = Math.min(s - f.from, f.to - s);
      const k = Math.min(1, e / (half * 0.95));
      const wob = side < 0
        ? 1.7 * Math.sin(s * 0.043 + M.wob[0]) + 0.9 * Math.sin(s * 0.11 + M.wob[1])
        : 1.7 * Math.sin(s * 0.047 + M.wob[2]) + 0.9 * Math.sin(s * 0.12 + M.wob[3]);
      const w = (half + wob) * Math.sqrt(k * (2 - k));
      if (w > best) best = w;
    }
    return best;
  }

  function buildFairwayTable(M) {
    const s0 = -10, n = Math.ceil((M.L + 20) * 2) + 2;
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = fairwayHalfExact(M, s0 + i / 2, -1); R[i] = fairwayHalfExact(M, s0 + i / 2, 1); }
    M.fwTable = { s0, n, L, R };
  }

  /** Position in the tee's frame: a = metres along the hole, d = metres right (reused result object). */
  const _tl = { a: 0, d: 0 };
  function teeLocal(M, x, z) {
    const t = M.tee.dir;
    const px = x - M.tee.x, pz = z - M.tee.z;
    _tl.a = px * t[0] + pz * t[1];
    _tl.d = px * -t[1] + pz * t[0];
    return _tl;
  }

  /** Analytic terrain height (smooth). p = projection {s, d} of (x, z). */
  function fieldHeight(M, x, z, p) {
    const def = M.def;
    const s = p.s, d = p.d, ad = Math.abs(d);
    let h = M.elevAt(s);
    const fw = Math.max(fairwayHalf(M, s, d < 0 ? -1 : 1), s > -20 && s < M.L + 10 ? 12 : 0);
    const amp = def.hills * (0.32 + 0.68 * sstep(fw, fw + 32, ad));
    h += amp * fbm(x, z, M.seed);
    // soft mounds framing the corridor
    h += 0.9 * sstep(fw + 3, fw + 10, ad) * (1 - sstep(fw + 14, fw + 30, ad));
    // water: flatten the banks, then a bowl
    for (const w of M.water) {
      if (!blobNear(w, x, z, 1.8)) continue;
      const r = blobRho(w, x, z);
      h = lerp(h, w.level + 0.28, 1 - sstep(1.12, 1.7, r));
      h -= 1.6 * (1 - sstep(0.5, 1, r));
    }
    // green platform (tilted plane + gentle undulation)
    const G = M.green;
    if (blobNear(G, x, z, 1.7)) {
      const r = blobRho(G, x, z);
      const wG = 1 - sstep(1.08, G.def.island ? 1.5 : 1.6, r);
      if (wG > 0) {
        const F = M.greenFrame;
        const lx = (x - G.x) * -F.tz + (z - G.z) * F.tx, lz = (x - G.x) * F.tx + (z - G.z) * F.tz;
        const gd = G.def;
        const und = gd.und * Math.sin(lx * 0.22 + M.wob[0]) * Math.sin(lz * 0.19 + M.wob[1]);
        const hg = M.greenH + gd.slope[0] * lx + gd.slope[1] * lz + und;
        h = lerp(h, hg, wG);
      }
    }
    // bunkers: bowls with a flat floor
    for (const b of M.bunkers) {
      if (!blobNear(b, x, z, 1.2)) continue;
      const r = blobRho(b, x, z);
      h -= b.depth * (1 - sstep(0.42, 1.04, r));
    }
    // tee box: a raised flat platform
    const tl = teeLocal(M, x, z);
    const outside = Math.max(Math.abs(tl.d) - TEE_HALF, tl.a > 0 ? tl.a - TEE_FRONT : -tl.a - TEE_BACK);
    if (outside < 6) h = lerp(h, M.elevAt(0) + 0.45, 1 - sstep(0.4, 5, Math.max(0, outside)));
    // far skirt: fade toward a calm mean beyond the inner bounds
    const B = M.bounds;
    const out = Math.max(B.x0 - x, x - B.x1, B.z0 - z, z - B.z1, 0);
    if (out > 0) h = lerp(h, M.meanH + 1.5, sstep(0, 160, out));
    return h;
  }

  /** Grid line positions: `base` spacing, finer inside the given ranges, growing far outside. */
  function axisLines(lo, hi, fine, base, farLo, farHi) {
    const out = [];
    let v = farLo;
    while (v < lo) { out.push(v); v += Math.max(base, Math.min(60, (lo - v) * 0.22)); }
    v = lo;
    while (v <= hi) {
      out.push(v);
      let st = base;
      for (const r of fine) if (v >= r[0] - base && v <= r[1]) st = Math.min(st, r[2]);
      v += st;
    }
    while (v < farHi) { out.push(v); v += Math.max(base, Math.min(60, (v - hi) * 0.22)); }
    out.push(farHi);
    return Float64Array.from(out);
  }

  function buildTerrain(M) {
    const B = M.bounds;
    const fineX = [], fineZ = [];
    const addFine = (b, pad, st) => {
      fineX.push([b.x - b.rmax - pad, b.x + b.rmax + pad, st]);
      fineZ.push([b.z - b.rmax - pad, b.z + b.rmax + pad, st]);
    };
    addFine(M.green, 9, 0.8);
    for (const b of M.bunkers) addFine(b, 3, 1.6);
    for (const w of M.water) addFine(w, 6, 2.2);
    const far = 620;
    const xs = axisLines(B.x0, B.x1, fineX, 3.5, M.center.x - far, M.center.x + far);
    const zs = axisLines(B.z0, B.z1, fineZ, 3.5, M.center.z - far, M.center.z + far);
    const nx = xs.length, nz = zs.length;
    const H = new Float32Array(nx * nz);
    const p = { s: 0, d: 0 };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = xs[i], z = zs[j];
        projectFar(M, x, z, p);
        H[j * nx + i] = fieldHeight(M, x, z, p);
      }
    }
    // cell lookup tables (0.25 m buckets inside the inner bounds)
    const look = (arr, lo, hi) => {
      const n = Math.ceil((hi - lo) / 0.25) + 1;
      const t = new Int32Array(n);
      let k = 0;
      for (let q = 0; q < n; q++) {
        const v = lo + q * 0.25;
        while (k < arr.length - 2 && arr[k + 1] <= v) k++;
        t[q] = k;
      }
      return t;
    };
    M.terrain = { xs, zs, nx, nz, H, lx: look(xs, B.x0, B.x1), lz: look(zs, B.z0, B.z1) };
  }

  /** Projection that also works outside the inner bounds (extrapolates the nearest edge). */
  function projectFar(M, x, z, o) {
    const B = M.bounds;
    const cx = clamp(x, B.x0, B.x1), cz = clamp(z, B.z0, B.z1);
    M.project(cx, cz, o);
    return o;
  }

  function cellIndex(arr, table, lo, v) {
    let k = table[clamp(Math.floor((v - lo) / 0.25), 0, table.length - 1)];
    while (k < arr.length - 2 && arr[k + 1] <= v) k++;
    while (k > 0 && arr[k] > v) k--;
    return k;
  }

  /** Ground height on the rendered triangles + gradient (gx = ∂h/∂x, gz = ∂h/∂z). */
  function groundAt(M, x, z, out) {
    const T = M.terrain, B = M.bounds;
    const xs = T.xs, zs = T.zs, nx = T.nx, H = T.H;
    const i = cellIndex(xs, T.lx, B.x0, clamp(x, xs[0], xs[xs.length - 1] - 1e-3));
    const j = cellIndex(zs, T.lz, B.z0, clamp(z, zs[0], zs[zs.length - 1] - 1e-3));
    const dx = xs[i + 1] - xs[i], dz = zs[j + 1] - zs[j];
    const u = clamp((x - xs[i]) / dx, 0, 1), v = clamp((z - zs[j]) / dz, 0, 1);
    const k = j * nx + i;
    const ha = H[k], hb = H[k + 1], hc = H[k + nx], hd = H[k + nx + 1];
    if (u + v <= 1) {
      out.h = ha + u * (hb - ha) + v * (hc - ha);
      out.gx = (hb - ha) / dx; out.gz = (hc - ha) / dz;
    } else {
      out.h = hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
      out.gx = (hd - hc) / dx; out.gz = (hd - hb) / dz;
    }
    return out;
  }

  const _g = { h: 0, gx: 0, gz: 0 };
  function heightAt(M, x, z) { return groundAt(M, x, z, _g).h; }

  const _pp = { s: 0, d: 0 };
  /** Surface id at (x, z): 'water' 'sand' 'green' 'fringe' 'tee' 'fairway' 'ob' 'rough'. */
  function surfaceAt(M, x, z) {
    const B = M.bounds;
    if (x < B.x0 + 2 || x > B.x1 - 2 || z < B.z0 + 2 || z > B.z1 - 2) return 'ob';
    for (const w of M.water) {
      if (blobNear(w, x, z, 1) && blobRho(w, x, z) < 0.97 && heightAt(M, x, z) < w.level + 0.02) return 'water';
    }
    for (const b of M.bunkers) if (blobNear(b, x, z, 1) && blobRho(b, x, z) < 1) return 'sand';
    if (blobNear(M.green, x, z, M.fringeRho)) {
      const r = blobRho(M.green, x, z);
      if (r < 1) return 'green';
      if (r < M.fringeRho) return 'fringe';
    }
    const tl = teeLocal(M, x, z);
    if (Math.abs(tl.d) < TEE_HALF && tl.a < TEE_FRONT && tl.a > -TEE_BACK) return 'tee';
    const p = M.project(x, z, _pp);
    if (Math.abs(p.d) < fairwayHalf(M, p.s, p.d < 0 ? -1 : 1)) return 'fairway';
    if (p.d < -M.ob.left || p.d > M.ob.right || p.s < M.ob.back || p.s > M.ob.front) return 'ob';
    return 'rough';
  }

  /** Trees: lines along both sides, backdrop woods, authored clusters. Colliders + render data. */
  function plantTrees(M) {
    const def = M.def, rng = SS.util.rng(M.seed + 9);
    const list = [];
    const p = { s: 0, d: 0 };
    const ok = (x, z, clear) => {
      const sf = surfaceAt(M, x, z);
      if (sf !== 'rough' && sf !== 'ob') return false;
      if (blobRho(M.green, x, z) < 1.9) return false;
      for (const b of M.bunkers) if (blobRho(b, x, z) < 1.5) return false;
      for (const w of M.water) if (blobRho(w, x, z) < 1.25) return false;
      M.project(x, z, p);
      const fw = Math.max(fairwayHalf(M, p.s, -1), fairwayHalf(M, p.s, 1));
      if (Math.abs(p.d) < Math.max(fw + clear, p.s > -15 && p.s < M.L ? 16 : 0)) return false;
      const tl = teeLocal(M, x, z);
      if (Math.abs(tl.d) < 12 && tl.a > -16 && tl.a < 30) return false;
      for (const q of list) if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < 30) return false;
      return true;
    };
    const add = (x, z, kind, s, back) => {
      if (!ok(x, z, kind === 'bush' ? 6 : 10)) return;
      list.push({ x, z, kind, s, rot: rng.next() * TAU, back: !!back });
    };
    const kindFor = () => { const r = rng.next(); return r < 0.5 ? 'round' : r < 0.85 ? 'pine' : 'bush'; };
    const sizeFor = k => (k === 'bush' ? rng.range(1.5, 2.4) : rng.range(2.1, 3.1));
    const at = (s, d) => {
      const F = M.frameAt(s);
      return [F.x - F.tz * d, F.z + F.tx * d];
    };
    // tree lines
    for (const side of [-1, 1]) {
      const obD = side < 0 ? M.ob.left : M.ob.right;
      const lineD = Math.min(def.treeD, obD - 4);
      for (let s = -25; s < M.L + 40; s += rng.range(9, 15)) {
        const d = side * (lineD + rng.range(-5, 6));
        const [x, z] = at(s, d);
        const k = kindFor();
        add(x, z, k, sizeFor(k));
      }
      // backdrop woods beyond the line / OB
      for (let row = 0; row < 3; row++) {
        const base = Math.max(lineD, obD) + 12 + row * 13;
        for (let s = -40; s < M.L + 60; s += rng.range(11, 17)) {
          const [x, z] = at(s, side * (base + rng.range(-4, 4)));
          const k = rng.next() < 0.55 ? 'pine' : 'round';
          add(x, z, k, sizeFor(k), true);
        }
      }
    }
    // behind the green and behind the tee
    for (let d = -60; d <= 60; d += rng.range(9, 14)) {
      for (const sOff of [M.L + 34, M.L + 48]) { const [x, z] = at(sOff, d + rng.range(-3, 3)); const k = kindFor(); add(x, z, k, sizeFor(k), true); }
      const [x, z] = at(-32 + rng.range(-3, 3), d); const k = kindFor(); add(x, z, k, sizeFor(k), true);
    }
    // authored clusters
    for (const c of (def.clusters || [])) {
      for (let i = 0; i < c.n * 3 && i < 60; i++) {
        const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * c.r;
        const [x, z] = at(c.s + Math.cos(a) * r, c.d + Math.sin(a) * r);
        const k = rng.next() < 0.7 ? 'round' : 'pine';
        add(x, z, k, sizeFor(k));
      }
    }
    // colliders
    for (const t of list) {
      t.y = heightAt(M, t.x, t.z);
      if (t.kind === 'round') { t.trunkR = 0.2 * t.s; t.trunkH = 1.6 * t.s; t.cy = t.y + 2.55 * t.s; t.cr = 1.3 * t.s; }
      else if (t.kind === 'pine') { t.trunkR = 0.18 * t.s; t.trunkH = 1.1 * t.s; t.cy = t.y + 2.0 * t.s; t.cr = 1.15 * t.s; }
      else { t.trunkR = 0; t.trunkH = 0; t.cy = t.y + 0.45 * t.s; t.cr = 0.7 * t.s; }
    }
    // spatial hash (16 m cells)
    const hash = new Map();
    for (const t of list) {
      const key = Math.floor(t.x / 16) + ',' + Math.floor(t.z / 16);
      if (!hash.has(key)) hash.set(key, []);
      hash.get(key).push(t);
    }
    M.trees = list;
    M.treeHash = hash;
  }

  function treesNear(M, x, z, out) {
    out.length = 0;
    const ci = Math.floor(x / 16), cj = Math.floor(z / 16);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = M.treeHash.get((ci + a) + ',' + (cj + b));
      if (l) for (const t of l) out.push(t);
    }
    return out;
  }

  // =============================================================================================
  // 6. Ball physics: one shot from launch to rest (deterministic, fixed step)
  // =============================================================================================

  const NO_WIND = { x: 0, z: 0 };

  /** Flight forces for one step on a state {x,y,z,vx,vy,vz,wb,ws} (wb backspin, ws slice spin). */
  function aeroStep(st, wx, wz) {
    const rx = st.vx - wx, ry = st.vy, rz = st.vz - wz;
    const sp = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
    let ax = -AERO * CD * sp * rx, ay = -GRAV - AERO * CD * sp * ry, az = -AERO * CD * sp * rz;
    const om = Math.sqrt(st.wb * st.wb + st.ws * st.ws);
    if (om > 1) {
      const hs = Math.sqrt(rx * rx + rz * rz) || 1e-6;
      const rgx = -rz / hs, rgz = rx / hs;                 // right of travel
      // spin vector Ω = wb·right − ws·up; lift along Ω × v
      const cx = st.wb * (-rgz * ry) - st.ws * rz;
      const cy = st.wb * (rgz * rx - rgx * rz);
      const cz = st.wb * (rgx * ry) + st.ws * rx;
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1e-6;
      const CL = Math.min(0.32, 1.25 * om * SPIN_R / sp);
      const k = AERO * CL * sp * sp / cl;
      ax += cx * k; ay += cy * k; az += cz * k;
    }
    st.vx += ax * STEP; st.vy += ay * STEP; st.vz += az * STEP;
    st.x += st.vx * STEP; st.y += st.vy * STEP; st.z += st.vz * STEP;
    const dec = Math.exp(-SPIN_DECAY * STEP);
    st.wb *= dec; st.ws *= dec;
  }

  /** Water surface level at (x, z) when that spot is under water, else −Infinity. */
  function waterLevelAt(M, x, z) {
    for (const w of M.water) {
      if (blobNear(w, x, z, 1) && blobRho(w, x, z) < 0.97 && heightAt(M, x, z) < w.level + 0.02) return w.level;
    }
    return -Infinity;
  }

  /**
   * Simulates a shot. L = { x, y, z, vx, vy, vz, back, side, roll }. opts: wind {x, z}, record,
   * noTrees, noCup (the ball rolls over the hole), stopAtLand.
   * Returns { outcome: 'rest'|'holed'|'water'|'ob', n (steps), path (Float32Array x,y,z per step),
   *   events [{ n, type, … }], rest {x, y, z}, surf, land {x, z, n, surf} | null, apex, carry, total,
   *   close {d, n} (nearest the ball came to the cup while on the ground) }.
   */
  function simulateShot(M, L, opts = {}) {
    const wind = opts.wind || NO_WIND;
    const record = !!opts.record;
    const maxN = Math.ceil(MAX_SIM_T / STEP);
    const path = record ? new Float32Array((maxN + 2) * 3) : null;
    const events = [];
    const st = { x: L.x, y: L.y, z: L.z, vx: L.vx, vy: L.vy, vz: L.vz, wb: L.back || 0, ws: L.side || 0 };
    let mode = L.roll ? 'roll' : 'air';
    let outcome = 'rest', land = null, apex = st.y, bounces = 0, lipped = false, inCup = false;
    let canopy = null;
    const noCup = !!opts.noCup;
    let closeD = Infinity, closeN = 0;
    const g = { h: 0, gx: 0, gz: 0 };
    const near = [];
    const B = M.bounds, pin = M.pin;
    if (record) { path[0] = st.x; path[1] = st.y; path[2] = st.z; }
    let n = 0;
    for (n = 1; n <= maxN; n++) {
      if (mode === 'air') {
        aeroStep(st, wind.x, wind.z);
        if (st.y > apex) apex = st.y;
        if (st.x < B.x0 + 1 || st.x > B.x1 - 1 || st.z < B.z0 + 1 || st.z > B.z1 - 1) {
          outcome = 'ob'; events.push({ n, type: 'ob', x: st.x, z: st.z }); break;
        }
        // trees: canopies slow and scatter, trunks bounce
        if (!opts.noTrees && M.trees.length) {
          treesNear(M, st.x, st.z, near);
          let inside = null;
          for (const t of near) {
            const dx = st.x - t.x, dz = st.z - t.z;
            if (t.trunkR > 0 && st.y < t.y + t.trunkH) {
              const d = Math.sqrt(dx * dx + dz * dz);
              if (d < t.trunkR + BALL_R) {
                const nx = dx / (d || 1), nz = dz / (d || 1);
                const vn = st.vx * nx + st.vz * nz;
                if (vn < 0) {
                  st.vx = (st.vx - 1.5 * vn * nx) * 0.6; st.vz = (st.vz - 1.5 * vn * nz) * 0.6;
                  st.x = t.x + nx * (t.trunkR + BALL_R); st.z = t.z + nz * (t.trunkR + BALL_R);
                  events.push({ n, type: 'trunk', x: st.x, y: st.y, z: st.z });
                }
              }
            }
            const dy = st.y - t.cy;
            if (dx * dx + dy * dy + dz * dz < t.cr * t.cr) inside = t;
          }
          if (inside && inside !== canopy) {
            const r1 = phash(st.x, st.z), r2 = phash(st.z, st.x);
            const keep = 0.25 + 0.3 * r1, turn = (r2 - 0.5) * 1.6;
            const c = Math.cos(turn), s = Math.sin(turn);
            const vx = st.vx * c - st.vz * s, vz = st.vx * s + st.vz * c;
            st.vx = vx * keep; st.vz = vz * keep; st.vy = Math.min(st.vy, 0) * 0.5 - 1;
            st.wb *= 0.3; st.ws *= 0.3;
            events.push({ n, type: 'tree', x: st.x, y: st.y, z: st.z });
          }
          if (inside) { const k = Math.exp(-3 * STEP); st.vx *= k; st.vz *= k; }
          canopy = inside;
        }
        groundAt(M, st.x, st.z, g);
        const wl = M.water.length ? waterLevelAt(M, st.x, st.z) : -Infinity;
        if (st.y - BALL_R <= Math.max(g.h, wl)) {
          if (wl > g.h) {
            st.y = wl;
            outcome = 'water'; events.push({ n, type: 'splash', x: st.x, y: wl, z: st.z }); break;
          }
          const dc = Math.hypot(st.x - pin.x, st.z - pin.z);
          if (dc < closeD) { closeD = dc; closeN = n; }
          if (!noCup && dc < CUP_R && Math.hypot(st.vx, st.vz) < 9) {
            st.x = pin.x; st.z = pin.z; st.y = g.h - 0.05;
            outcome = 'holed'; events.push({ n, type: 'cup', dunk: true, speed: Math.hypot(st.vx, st.vz) }); break;
          }
          const nl = Math.sqrt(1 + g.gx * g.gx + g.gz * g.gz);
          const nx = -g.gx / nl, ny = 1 / nl, nz = -g.gz / nl;
          const vn = st.vx * nx + st.vy * ny + st.vz * nz;
          st.y = g.h + BALL_R;
          if (vn < 0) {
            const sf = surfaceAt(M, st.x, st.z);
            const S = SURF[sf];
            const spd = Math.sqrt(st.vx * st.vx + st.vy * st.vy + st.vz * st.vz) || 1;
            const e = S.e * clamp(-vn / 5, 0.3, 1);
            const tx = st.vx - vn * nx, ty = st.vy - vn * ny, tz = st.vz - vn * nz;
            const steep = -vn / spd;
            let keep = S.keep - S.bite * Math.min(1, st.wb / 500) * 0.45;
            keep = clamp(keep * (1 - 0.55 * steep * steep), 0.05, 0.95);
            st.vx = tx * keep - e * vn * nx; st.vy = ty * keep - e * vn * ny; st.vz = tz * keep - e * vn * nz;
            st.wb *= 0.4; st.ws *= 0.25;
            bounces++;
            events.push({ n, type: bounces === 1 ? 'land' : 'bounce', surf: sf, x: st.x, y: st.y, z: st.z, speed: -vn });
            if (!land) land = { x: st.x, z: st.z, n, surf: sf };
            if (opts.stopAtLand) break;
            if (-vn * e < 0.9 || sf === 'sand') {
              mode = 'roll';
              if (sf === 'sand') { st.vx *= 0.3; st.vz *= 0.3; }
            }
          }
        }
      } else {
        groundAt(M, st.x, st.z, g);
        const sf = surfaceAt(M, st.x, st.z);
        if (sf === 'water') {
          const wl = waterLevelAt(M, st.x, st.z);
          st.y = isFinite(wl) ? wl : g.h;
          outcome = 'water'; events.push({ n, type: 'splash', x: st.x, y: st.y, z: st.z, rolled: true }); break;
        }
        const S = SURF[sf];
        const g2 = g.gx * g.gx + g.gz * g.gz;
        let ax = -GRAV * g.gx / (1 + g2), az = -GRAV * g.gz / (1 + g2);
        const slopeA = Math.sqrt(ax * ax + az * az);
        const sp = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
        if (sp < 0.04 && slopeA < S.roll * 1.15) { st.vx = st.vz = 0; st.y = g.h + BALL_R; break; }
        // leftover backspin bites for a moment after landing (wedges check up, drivers run out)
        const brake = S.roll + S.bite * st.wb * 0.02;
        st.wb *= Math.exp(-2.5 * STEP);
        if (sp > 1e-6) { ax -= brake * st.vx / sp; az -= brake * st.vz / sp; }
        const nvx = st.vx + ax * STEP, nvz = st.vz + az * STEP;
        if (nvx * st.vx + nvz * st.vz < 0 && slopeA < S.roll) { st.vx = st.vz = 0; st.y = g.h + BALL_R; break; }
        st.vx = nvx; st.vz = nvz;
        st.x += st.vx * STEP; st.z += st.vz * STEP;
        if (st.x < B.x0 + 1 || st.x > B.x1 - 1 || st.z < B.z0 + 1 || st.z > B.z1 - 1) {
          outcome = 'ob'; events.push({ n, type: 'ob', x: st.x, z: st.z }); break;
        }
        // the cup
        const cx = pin.x - st.x, cz = pin.z - st.z;
        const dc = Math.sqrt(cx * cx + cz * cz);
        if (dc < closeD) { closeD = dc; closeN = n; }
        if (dc < CUP_R && !noCup) {
          const spd = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
          let holed = spd < CAPTURE_V;
          if (!holed && !inCup) {
            const perp = Math.abs(cx * st.vz - cz * st.vx) / (spd || 1);
            if (perp < CUP_R * 0.42 && spd < LIP_V * 1.12) holed = true;
            else if (perp < CUP_R * 0.85 && spd < LIP_V && !lipped) {
              lipped = true;
              const side = (cx * st.vz - cz * st.vx) > 0 ? 1 : -1;
              const turn = side * (0.6 + 0.6 * phash(st.x, st.z));
              const c = Math.cos(turn), s = Math.sin(turn);
              const vx = (st.vx * c - st.vz * s) * 0.55, vz = (st.vx * s + st.vz * c) * 0.55;
              st.vx = vx; st.vz = vz;
              events.push({ n, type: 'lip', x: st.x, z: st.z, speed: spd });
            }
          }
          inCup = true;
          if (holed) {
            groundAt(M, pin.x, pin.z, g);
            st.x = pin.x; st.z = pin.z; st.y = g.h - 0.05;
            outcome = 'holed'; events.push({ n, type: 'cup', speed: spd });
            if (record) { path[n * 3] = st.x; path[n * 3 + 1] = st.y; path[n * 3 + 2] = st.z; }
            break;
          }
        } else inCup = false;
        // trunks
        if (M.trees.length) {
          treesNear(M, st.x, st.z, near);
          for (const t of near) {
            if (!(t.trunkR > 0)) continue;
            const dx = st.x - t.x, dz = st.z - t.z, d = Math.sqrt(dx * dx + dz * dz);
            if (d < t.trunkR + BALL_R) {
              const nx = dx / (d || 1), nz = dz / (d || 1), vn = st.vx * nx + st.vz * nz;
              if (vn < 0) { st.vx = (st.vx - 1.5 * vn * nx) * 0.6; st.vz = (st.vz - 1.5 * vn * nz) * 0.6; events.push({ n, type: 'trunk', x: st.x, y: st.y, z: st.z }); }
            }
          }
        }
        groundAt(M, st.x, st.z, g);
        st.y = g.h + BALL_R;
      }
      if (record) { path[n * 3] = st.x; path[n * 3 + 1] = st.y; path[n * 3 + 2] = st.z; }
    }
    n = Math.min(n, maxN);
    if (record) { path[n * 3] = st.x; path[n * 3 + 1] = st.y; path[n * 3 + 2] = st.z; }
    let surf = outcome === 'water' ? 'water' : outcome === 'holed' ? 'cup' : surfaceAt(M, st.x, st.z);
    if (outcome === 'rest' && surf === 'ob') { outcome = 'ob'; events.push({ n, type: 'ob', x: st.x, z: st.z }); }
    if (outcome === 'ob') surf = 'ob';
    const carry = land ? Math.hypot(land.x - L.x, land.z - L.z) : 0;
    return {
      outcome, n, path, events, land, apex, carry, surf,
      rest: { x: st.x, y: st.y, z: st.z },
      close: { d: closeD, n: closeN },
      total: Math.hypot(st.x - L.x, st.z - L.z),
    };
  }

  // =============================================================================================
  // 7. Shot model: clubs calibrated to carries, gesture → launch
  // =============================================================================================

  const ROLL_EST = { D: 15, '3W': 12, '5I': 9, '7I': 5, '9I': 3, PW: 2, SW: 1.5 };
  const CURVE_TILT = 28 * DEG;     // spin-axis tilt of a fully bent flick
  const CURVE_AIM = 0.92;          // share of the curve's sideways drift that the start line takes back
  const calCache = {};

  function clubSpin(club, v) { return club.spin * clamp(v / club.vNom, 0.35, 1.2); }

  /** How a lie changes the strike: launch angle (deg) and backspin factor. */
  function lieStrike(club, surf) {
    const S = SURF[surf] || SURF.fairway;
    let launch = club.launch;
    if (surf === 'rough') launch += 1.5;
    if (surf === 'sand' && club.id !== 'SW') launch *= 0.85;
    return { key: launch.toFixed(2) + '/' + S.spin, launch, spinF: S.spin };
  }

  /** Flat, calm flight at launch speed v: { carry, side } (m; side = sideways drift, + right). */
  function flatFlight(club, v, launchDeg, spinF, tilt) {
    const la = launchDeg * DEG;
    const wb = clubSpin(club, v) * spinF;
    const st = { x: 0, y: 0, z: 0, vx: 0, vy: v * Math.sin(la), vz: -v * Math.cos(la), wb, ws: wb * Math.tan(tilt) };
    for (let i = 0; i < 4000; i++) {
      const px = st.x, py = st.y, pz = st.z;
      aeroStep(st, 0, 0);
      if (st.y < 0 && st.vy < 0) {
        const t = py / (py - st.y);
        return { carry: -(pz + (st.z - pz) * t), side: px + (st.x - px) * t };
      }
    }
    return { carry: -st.z, side: st.x };
  }

  /**
   * carry(v) for a club struck from a lie, inverted by interpolation, so a full swing from any lie
   * carries exactly club.carry × lieDist (what the HUD promises). Also the curve's drift angle.
   */
  function calibration(ci, surf) {
    const club = CLUBS[ci];
    const ls = lieStrike(club, surf || 'fairway');
    const id = ci + ':' + ls.key;
    if (calCache[id]) return calCache[id];
    const vs = [], cs = [];
    for (let v = 2; v <= 110; v += 1) { vs.push(v); cs.push(flatFlight(club, v, ls.launch, ls.spinF, 0).carry); }
    const cal = { vs, cs, launch: ls.launch, spinF: ls.spinF };
    cal.vFor = c => {
      if (c <= cs[0]) return vs[0] * c / Math.max(1e-3, cs[0]);
      for (let i = 1; i < cs.length; i++) if (cs[i] >= c) return lerp(vs[i - 1], vs[i], (c - cs[i - 1]) / ((cs[i] - cs[i - 1]) || 1));
      return vs[vs.length - 1];
    };
    cal.vFull = cal.vFor(club.carry);
    const bent = flatFlight(club, cal.vFull, ls.launch, ls.spinF, CURVE_TILT);
    cal.curveAng = Math.atan2(bent.side, Math.max(1, bent.carry));
    calCache[id] = cal;
    return cal;
  }

  /** Heading ψ → unit ground direction (ψ = 0 is −Z, positive turns right). */
  function headingDir(psi) { return [Math.sin(psi), -Math.cos(psi)]; }
  function headingTo(ax, az, bx, bz) { return Math.atan2(bx - ax, -(bz - az)); }

  /**
   * Meter range (m) for a putt of distance d: fixed ranges, so within a range a longer putt is a longer
   * pull (pace is a skill, not the same gesture every time). tick/label: the meter's marks (m).
   */
  const PUTT_RANGES = [[1.5, 3, 0.5, 1], [4.5, 6, 1, 2], [10, 12, 1, 4], [20, 24, 2, 8], [Infinity, 40, 5, 10]];
  function puttRange(d) { for (const r of PUTT_RANGES) if (d <= r[0]) return r; return PUTT_RANGES[PUTT_RANGES.length - 1]; }
  function puttScale(d) { return puttRange(d)[1]; }

  /** Lie-adjusted distance factor for a club. */
  function lieDist(club, surf, dPin) {
    if (surf === 'sand' && club.id === 'SW') return dPin < 45 ? 0.9 : 0.8;
    return SURF[surf] ? SURF[surf].dist : 1;
  }

  /** Strike quality from flick crispness (0..1): a lazy flick tops the ball. */
  function strikeQuality(tempo) { return sstep(0.05, 0.8, tempo); }

  const FLICK_DEAD = 1.5 * DEG;    // flick angles inside this are dead straight (MODE_RULES overrides)
  const PUTT_LINE = 0.28;          // share of a putt's flick angle error that becomes its start line
  const PUTT_DEAD = 0.5 * DEG;     // a putt's own (small) dead zone: the stroke is short and gentle
  const START_LINE = 0.5;          // share of the flick's angle error that becomes the start line
  const STRIKE_VAR = 0.012;        // hidden carry spread of a full swing (σ, capped at ±3%)
  const LINE_VAR = 0.5 * DEG;      // hidden start-line spread of a full 7-iron (σ; scales with the club's length)

  /**
   * Gesture → launch. inp = { club, aim (heading rad), power (0..1.1), flick (rad, + right),
   * curve (−1..1 shot shape from a bent flick, + curves right), tempo (0..1 flick crispness),
   * dead (flick dead zone, rad) }. rng adds the random parts (overswing and lie scatter); pass null
   * for the no-luck version (landing ring, planner). A bent flick starts the ball out to the bulge
   * side and curves it back, so it finishes near the aim line.
   * info: err (total angle error), lieErr / overErr (the lie's and an overswing's share of it, so the
   * report can say who did what besides the finger).
   */
  function launchFor(M, ball, inp, rng) {
    const club = CLUBS[inp.club];
    const flick = inp.flick || 0, curve = club.putter ? 0 : clamp(inp.curve || 0, -1, 1);
    const dPin = Math.hypot(M.pin.x - ball.x, M.pin.z - ball.z);
    const dead = club.putter ? PUTT_DEAD : inp.dead == null ? FLICK_DEAD : inp.dead;
    const eff = Math.sign(flick) * Math.max(0, Math.abs(flick) - dead);
    const info = { club: club.id, power: inp.power, topped: false, err: 0, lieErr: 0, overErr: 0, tilt: 0, strike: 1, curve };
    if (club.putter) {
      const scale = inp.scale || puttScale(dPin);
      const dist = clamp(inp.power, 0, 1) * scale;
      const v = Math.sqrt(2 * PUTT_DECEL * dist);
      const psi = inp.aim + eff * PUTT_LINE;
      const [dx, dz] = headingDir(psi);
      info.dist = dist; info.err = eff * PUTT_LINE;
      return { L: { x: ball.x, y: ball.y, z: ball.z, vx: dx * v, vy: 0, vz: dz * v, back: 0, side: 0, roll: true }, info };
    }
    const S = SURF[ball.surf] || SURF.fairway;
    const p = clamp(inp.power, 0.02, 1.1);
    const over = Math.max(0, (p - 1) / 0.1);
    const pEff = p <= 1 ? p : 1 + (p - 1) * 0.6;
    const q = strikeQuality(inp.tempo == null ? 1 : clamp(inp.tempo, 0, 1));
    const cal = calibration(inp.club, ball.surf);
    // no two swings are quite the same: a small hidden spread on carry
    const vary = rng ? 1 + clamp(gauss(rng) * STRIKE_VAR, -0.03, 0.03) : 1;
    const v = cal.vFor(club.carry * pEff * lieDist(club, ball.surf, dPin) * lerp(0.6, 1, q) * vary);
    const launch = cal.launch * lerp(0.45, 1, q);
    let err = eff;
    if (rng) {
      info.overErr = gauss(rng) * over * 3.5 * DEG;
      info.lieErr = gauss(rng) * S.spread * DEG;
      err += info.overErr + info.lieErr + clamp(gauss(rng), -2.5, 2.5) * LINE_VAR * club.carry / 135 * Math.min(1, p);
    }
    const psi = inp.aim + err * START_LINE - curve * cal.curveAng * CURVE_AIM;
    const tilt = clamp(err * 0.75 + curve * CURVE_TILT, -35 * DEG, 35 * DEG);
    const wb = clubSpin(club, v) * cal.spinF * lerp(0.35, 1, q);
    const [dx, dz] = headingDir(psi);
    const la = launch * DEG;
    info.topped = q < 0.3; info.strike = q; info.err = err; info.tilt = tilt; info.over = over; info.speed = v;
    return {
      L: { x: ball.x, y: ball.y, z: ball.z, vx: dx * v * Math.cos(la), vy: v * Math.sin(la), vz: dz * v * Math.cos(la), back: wb, side: wb * Math.tan(tilt), roll: false },
      info,
    };
  }

  /** Clubs playable from a lie (driver from the tee only). */
  function clubsFor(surf) {
    const out = [];
    for (let i = 0; i < CLUBS.length; i++) {
      const c = CLUBS[i];
      if (c.teeOnly && surf !== 'tee') continue;
      if (surf === 'sand' && (c.id === '3W')) continue;
      out.push(i);
    }
    return out;
  }

  /** Full-swing total distance estimate (carry + roll) from a lie. */
  function clubReach(ci, surf, dPin) {
    const c = CLUBS[ci];
    if (c.putter) return 0;
    return c.carry * lieDist(c, surf, dPin) + ROLL_EST[c.id];
  }

  /** Where a calm, tree-free shot comes to rest, measured along its aim from the ball (m). */
  function restAlong(M, ball, inp) {
    const { L } = launchFor(M, ball, inp, null);
    const res = simulateShot(M, L, { noTrees: true, noCup: true });
    const [dx, dz] = headingDir(inp.aim);
    return (res.rest.x - ball.x) * dx + (res.rest.z - ball.z) * dz;
  }

  /**
   * The power that rests the ball `target` metres along `aim` (calm, no trees, slope and roll included):
   * a binary search over simulated shots. Above 1 when even a full swing comes up short.
   */
  function powerFor(M, ball, ci, aim, target, scale) {
    const club = CLUBS[ci];
    const inp = { club: ci, aim, power: 1, flick: 0, curve: 0, tempo: 1, scale };
    const at = pw => { inp.power = pw; return restAlong(M, ball, inp); };
    const full = at(1);
    if (full < target) return 1 + (target - full) / Math.max(1, club.putter ? scale : club.carry);
    let lo = 0.02, hi = 1;
    for (let k = 0; k < 11; k++) { const m = (lo + hi) / 2; if (at(m) < target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  /**
   * Where a straight, tree-free shot first comes down (calm unless `wind` is given):
   * { x, y, z, dist (from the ball), along (metres along the aim) }.
   */
  function landPoint(M, ball, inp, wind) {
    const { L } = launchFor(M, ball, inp, null);
    const res = simulateShot(M, L, { stopAtLand: true, noTrees: true, wind });
    const e = res.events.length ? res.events[res.events.length - 1] : null;
    const x = e ? e.x : res.rest.x, z = e ? e.z : res.rest.z;
    const [dx, dz] = headingDir(inp.aim);
    return { x, z, y: Math.max(heightAt(M, x, z), waterLevelAt(M, x, z)), dist: Math.hypot(x - ball.x, z - ball.z), along: (x - ball.x) * dx + (z - ball.z) * dz };
  }

  /** The power whose calm carry comes down `target` metres along `aim` (the Beginner meter's pin mark). */
  function carryPowerFor(M, ball, ci, aim, target) {
    const inp = { club: ci, aim, power: 1, flick: 0, curve: 0, tempo: 1 };
    const at = pw => { inp.power = pw; return landPoint(M, ball, inp).along; };
    const full = at(1);
    if (full < target) return 1 + (target - full) / Math.max(1, CLUBS[ci].carry);
    let lo = 0.02, hi = 1;
    for (let k = 0; k < 11; k++) { const m = (lo + hi) / 2; if (at(m) < target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  /** Putting pace target: die the ball this far past the cup. */
  const PUTT_PAST = 0.35;

  function suggestClub(M, ball) {
    const d = Math.hypot(M.pin.x - ball.x, M.pin.z - ball.z);
    if (ball.surf === 'green') return PUTTER;
    if (ball.surf === 'fringe' && d < 14) return PUTTER;
    const list = clubsFor(ball.surf).filter(i => !CLUBS[i].putter);
    const aim = headingTo(ball.x, ball.z, M.pin.x, M.pin.z);
    // the shortest club whose simulated full swing (slope, roll and elevation included) gets there
    for (let k = list.length - 1; k >= 0; k--) {
      const ci = list[k];
      if (clubReach(ci, ball.surf, d) < d * 0.8) continue;
      if (restAlong(M, ball, { club: ci, aim, power: 1, flick: 0, curve: 0, tempo: 1 }) >= d - 2) return ci;
    }
    return list[0];
  }

  /**
   * Water relief, back on the line: from where the ball went in, walk straight away from the pin until
   * dry playable ground (not the green or fringe), then 2.5 m more. When that runs out of the hole
   * (or out of bounds), walk back toward where the shot came from, never nearer the hole than the
   * entry and never onto the green. Last resort: replay from where the shot was played.
   */
  const DROP_BAD = { water: 1, ob: 1, sand: 1, green: 1, fringe: 1 };
  function dropPoint(M, entry, from) {
    const pin = M.pin;
    const dE = Math.hypot(entry.x - pin.x, entry.z - pin.z);
    const ok = (x, z) => !DROP_BAD[surfaceAt(M, x, z)];
    const moved = c => (c ? Math.hypot(c.x - entry.x, c.z - entry.z) : Infinity);
    // 1. back on the line pin → entry
    let A = null;
    const [ux, uz] = dE > 0.5 ? norm2(entry.x - pin.x, entry.z - pin.z) : norm2(from.x - pin.x, from.z - pin.z);
    for (let k = 1; k <= 240; k++) {
      const x = entry.x + ux * k * 0.5, z = entry.z + uz * k * 0.5;
      const sf = surfaceAt(M, x, z);
      if (sf === 'ob') break;
      if (!DROP_BAD[sf]) {
        const x2 = x + ux * 2.5, z2 = z + uz * 2.5;
        A = ok(x2, z2) ? { x: x2, z: z2 } : { x, z };
        break;
      }
    }
    if (A && moved(A) <= 35) return A;
    // 2. toward where the shot came from, not nearer the hole (also used when the line runs long,
    //    e.g. down the length of a creek)
    let B = null;
    const dx = from.x - entry.x, dz = from.z - entry.z;
    const len = Math.hypot(dx, dz) || 1;
    for (let k = 1; k * 0.5 <= len; k++) {
      const t = k * 0.5 / len;
      const x = entry.x + dx * t, z = entry.z + dz * t;
      if (Math.hypot(x - pin.x, z - pin.z) < dE - 0.01 || !ok(x, z)) continue;
      const t2 = Math.min(1, t + 2.5 / len);
      const x2 = entry.x + dx * t2, z2 = entry.z + dz * t2;
      B = ok(x2, z2) && Math.hypot(x2 - pin.x, z2 - pin.z) >= dE ? { x: x2, z: z2 } : { x, z };
      break;
    }
    const best = moved(B) < moved(A) ? B : A;
    return best || { x: from.x, z: from.z };
  }

  // =============================================================================================
  // 8. Planner (autoplay + CPU-quality simulation)
  // =============================================================================================

  /** Rough expected strokes to hole out from a resting spot. */
  function expectStrokes(M, x, z, surf) {
    const d = Math.hypot(M.pin.x - x, M.pin.z - z);
    if (surf === 'cup') return 0;
    if (surf === 'green') return d < 0.6 ? 1 : 1 + 1.1 * (1 - Math.exp(-d / 7));
    let e = 1.95 + 0.36 * Math.log(1 + d / 10);
    if (surf === 'fringe') e -= 0.15;
    else if (surf === 'rough') e += 0.3;
    else if (surf === 'sand') e += d < 40 ? 0.35 : 0.5;
    return e;
  }

  function costOf(M, ball, res) {
    if (res.outcome === 'holed') return 0;
    if (res.outcome === 'water') {
      const drop = dropPoint(M, res.rest, ball);
      return 1 + expectStrokes(M, drop.x, drop.z, surfaceAt(M, drop.x, drop.z)) + 0.15;
    }
    if (res.outcome === 'ob') return 1 + expectStrokes(M, ball.x, ball.z, ball.surf) + 0.2;
    return expectStrokes(M, res.rest.x, res.rest.z, res.surf) + (res.events.some(e => e.type === 'tree') ? 0.05 : 0);
  }

  /**
   * Picks a good shot from `ball` (no execution noise). Generator: yields between batches of
   * simulations so callers can spread the work over frames. Returns { club, aim, power, flick, curve, tempo }.
   */
  function* planGen(M, ball, wind) {
    const dPin = Math.hypot(M.pin.x - ball.x, M.pin.z - ball.z);
    const toPin = headingTo(ball.x, ball.z, M.pin.x, M.pin.z);
    let best = null, bestCost = Infinity, sims = 0;
    const tryShot = (inp) => {
      const { L } = launchFor(M, ball, inp, null);
      const res = simulateShot(M, L, { wind });
      const c = costOf(M, ball, res);
      sims++;
      if (c < bestCost) { bestCost = c; best = inp; }
      return res;
    };
    const putting = ball.surf === 'green' || (ball.surf === 'fringe' && dPin < 14);
    if (putting) {
      const scale = puttScale(dPin);
      for (let a = -12; a <= 12; a += 1.5) {
        for (const f of [0.95, 1.08, 1.22, 1.4]) {
          tryShot({ club: PUTTER, aim: toPin + a * DEG, power: clamp(dPin * f / scale, 0.02, 1), flick: 0, scale });
        }
        yield sims;
      }
      const b = best;
      for (let a = -1.2; a <= 1.2; a += 0.4) {
        for (const f of [0.94, 0.98, 1.02, 1.06]) tryShot({ club: PUTTER, aim: b.aim + a * DEG, power: clamp(b.power * f, 0.02, 1), flick: 0, scale });
        yield sims;
      }
      return Object.assign({ curve: 0, tempo: 1 }, best);
    }
    const list = clubsFor(ball.surf).filter(i => !CLUBS[i].putter);
    // headings: straight at the pin and at the centre line at each club's reach
    for (const ci of list) {
      const reach = clubReach(ci, ball.surf, dPin);
      const last = ci === list[list.length - 1];
      if (!last && (reach < Math.min(dPin, 60) * 0.55 || reach > dPin * 1.9 + 40)) continue;
      const heads = [toPin];
      if (dPin > reach * 1.05) {
        const pr = M.project(ball.x, ball.z, { s: 0, d: 0 });
        const F = M.frameAt(Math.min(M.L, pr.s + reach * 0.95));
        heads.push(headingTo(ball.x, ball.z, F.x, F.z));
      }
      const club = CLUBS[ci];
      const carryNeed = Math.max(5, dPin - ROLL_EST[club.id]);
      const pNeed = clamp(carryNeed / (club.carry * lieDist(club, ball.surf, dPin)), 0.1, 1);
      const powers = pNeed >= 0.99 ? [1, 0.9] : [pNeed * 0.9, pNeed, Math.min(1, pNeed * 1.1)];
      for (const h of heads) {
        for (const off of [-6, -3, 0, 3, 6]) {
          for (const p of powers) tryShot({ club: ci, aim: h + off * DEG, power: p, flick: 0, curve: 0, tempo: 1 });
        }
        yield sims;
      }
    }
    // refine around the best
    const b = best;
    for (const off of [-1.5, 1.5]) for (const pf of [0.96, 1, 1.04]) tryShot(Object.assign({}, b, { aim: b.aim + off * DEG, power: clamp(b.power * pf, 0.05, 1) }));
    return Object.assign({}, best);
  }

  function planNow(M, ball, wind) {
    const it = planGen(M, ball, wind);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  /** Adds human error to a planned shot. quality 0..1 (1 = steady hands). */
  function humanize(inp, quality, rng) {
    const q = clamp(quality, 0, 1);
    const out = Object.assign({}, inp);
    const putt = CLUBS[inp.club].putter;
    out.flick = (inp.flick || 0) + gauss(rng) * lerp(9, 1.6, q) * DEG;
    out.power = clamp(inp.power * (1 + gauss(rng) * lerp(putt ? 0.16 : 0.09, putt ? 0.035 : 0.02, q)), 0.02, 1.1);
    out.curve = (inp.curve || 0) + gauss(rng) * lerp(0.14, 0.03, q);
    out.tempo = putt ? 1 : clamp(lerp(0.55, 0.9, q) + rng.next() * 0.25, 0, 1);
    return out;
  }

  /**
   * Plays one hole headless with the planner at `quality` under a mode's rules (gimme, dead zone).
   * Returns { strokes, putts, fir, gir, pickedUp }.
   */
  function playHoleHeadless(M, wind, quality, rng, rules) {
    const R = rules || MODE_RULES.full9;
    let ball = { x: M.tee.x + M.tee.dir[0] * -2, z: M.tee.z + M.tee.dir[1] * -2, surf: 'tee' };
    ball.y = heightAt(M, ball.x, ball.z) + BALL_R + 0.03;
    let strokes = 0, putts = 0, fir = null, gir = false;
    const cap = M.par + MAX_OVER_PAR;
    while (strokes < cap) {
      const plan = planNow(M, ball, wind);
      const inp = humanize(plan, quality, rng);
      inp.dead = R.dead;
      const { L } = launchFor(M, ball, inp, rng);
      const res = simulateShot(M, L, { wind });
      strokes++;
      if (CLUBS[inp.club].putter && ball.surf === 'green') putts++;
      if (strokes === 1 && M.par > 3) fir = res.surf === 'fairway';
      if (res.outcome === 'holed') return { strokes, putts, fir, gir: gir || strokes <= M.par - 2 };
      if (res.outcome === 'water') {
        strokes++;
        const d = dropPoint(M, res.rest, ball);
        ball = { x: d.x, z: d.z, surf: surfaceAt(M, d.x, d.z) };
      } else if (res.outcome === 'ob') {
        strokes++;
      } else {
        ball = { x: res.rest.x, z: res.rest.z, surf: res.surf };
        if ((res.surf === 'green') && strokes <= M.par - 2) gir = true;
        if ((res.surf === 'green' || res.surf === 'fringe') && Math.hypot(M.pin.x - ball.x, M.pin.z - ball.z) < R.gimme) {
          strokes++; putts++;
          return { strokes: Math.min(strokes, cap), putts, fir, gir };
        }
      }
      ball.y = heightAt(M, ball.x, ball.z) + BALL_R;
    }
    return { strokes: cap, putts, fir, gir, pickedUp: true };
  }

  function windFor(M, rng) {
    const w = M.def.wind;
    const speed = rng.range(w[0], w[1]);
    const dir = rng.next() * TAU;
    return { x: Math.sin(dir) * speed, z: -Math.cos(dir) * speed, speed, dir };
  }

  // =============================================================================================
  // 9. Visual builders (terrain splat, meshes, props)
  // =============================================================================================

  const FONT = "'Fredoka', 'Nunito', 'Arial Rounded MT Bold', sans-serif";

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Value noise that tiles every P cells. */
  function tileNoise(x, y, P, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const m = v => ((v % P) + P) % P;
    const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
    const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  /** Grass detail (R: fine grain, G: soft blotches), mean 0.5 in both, tiles seamlessly. */
  function detailCanvas() {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
    const img = g.createImageData(S, S), D = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fine = tileNoise(x / 2, y / 6, 128, 3) * 0.45 + tileNoise(x, y, 256, 4) * 0.35 + tileNoise(x / 6, y / 6, 43, 5) * 0.2;
        const coarse = tileNoise(x / 32, y / 32, 8, 6) * 0.7 + tileNoise(x / 12, y / 12, 21, 7) * 0.3;
        const i = (y * S + x) * 4;
        D[i] = 128 + fine * 120; D[i + 1] = 128 + coarse * 150; D[i + 2] = 128; D[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function rippleCanvas() {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
    const img = g.createImageData(S, S), D = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = tileNoise(x / 16, y / 16, 16, 11) * 0.6 + tileNoise(x / 8, y / 5, 32, 12) * 0.4;
        const band = Math.pow(1 - Math.abs(Math.sin((y / S * 6 + n * 0.9) * Math.PI)), 6);
        const i = (y * S + x) * 4;
        D[i] = 70 + band * 150 + n * 12; D[i + 1] = 170 + band * 80 + n * 10; D[i + 2] = 226 + band * 29; D[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  const COL = {
    rough: [74, 146, 54], cut: [92, 168, 62], fairway: [112, 198, 78], fairway2: [99, 183, 70],
    tee: [118, 204, 82], tee2: [106, 192, 75], fringe: [104, 190, 72], green: [130, 214, 94], green2: [118, 202, 86],
    sand: [236, 213, 155], sandLip: [214, 188, 132], shade: [58, 118, 44], bed: [58, 112, 92], mud: [96, 128, 62], bank: [100, 168, 70],
  };

  /** Bakes the hole's surfaces into a canvas covering the inner bounds (anti-aliased per pixel). */
  function paintSplat(M) {
    const job = splatJob(M);
    while (!job.step(Infinity));
    return job.canvas;
  }

  /**
   * The splat painted a few rows at a time: step(ms) paints for about that long and says whether it
   * is done, so the next hole can be painted between frames while the scorecard is up.
   */
  function splatJob(M) {
    const B = M.bounds, W = B.x1 - B.x0, Hm = B.z1 - B.z0;
    const px = clamp(Math.max(W, Hm) / 1400, 0.3, 0.5);
    const cw = Math.ceil(W / px), ch = Math.ceil(Hm / px);
    const c = makeCanvas(cw, ch), g = c.getContext('2d');
    const img = g.createImageData(cw, ch), D = img.data;
    const p = { s: 0, d: 0 };
    const aa = dist => clamp(dist / px + 0.5, 0, 1);
    const G = M.green, F = M.greenFrame;
    const gR = Math.sqrt(G.rx * G.rz);
    const blobs = M.bunkers.map(b => ({ b, R: Math.sqrt(b.rx * b.rz) }));
    const waters = M.water.map(w => ({ w }));
    // tiled noise lookup (0.625 m texels, repeats every 80 m) instead of evaluating noise per pixel
    const NT = new Float32Array(128 * 128);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) NT[j * 128 + i] = tileNoise(i / 16, j / 16, 8, 77) * 0.6 + tileNoise(i / 5.33, j / 5.33, 24, 78) * 0.4;
    let r = 0, gg = 0, bb = 0;
    const mix = (col, a, k = 1) => { if (a <= 0) return; r += (col[0] * k - r) * a; gg += (col[1] * k - gg) * a; bb += (col[2] * k - bb) * a; };
    let row = 0;
    const paintRow = j => {
      const z = B.z0 + (j + 0.5) * px;
      for (let i = 0; i < cw; i++) {
        const x = B.x0 + (i + 0.5) * px;
        M.project(x, z, p);
        const n = NT[(((z * 1.6) | 0) & 127) * 128 + (((x * 1.6) | 0) & 127)];
        r = COL.rough[0] + n * 10; gg = COL.rough[1] + n * 15; bb = COL.rough[2] + n * 7;
        const ad = Math.abs(p.d);
        const hw = fairwayHalf(M, p.s, p.d < 0 ? -1 : 1);
        if (hw > 0) {
          mix(COL.cut, aa(hw + 2.4 - ad), 1 + n * 0.04);
          const stripe = (Math.floor((p.s + 1000) / 9) & 1) ? COL.fairway : COL.fairway2;
          mix(stripe, aa(hw - ad), 1 + n * 0.03);
        }
        // out of bounds: a darker band beyond a mown edge line
        const obOver = ad - (p.d < 0 ? M.ob.left : M.ob.right);
        if (obOver > 0) { r *= 0.84; gg *= 0.87; bb *= 0.84; }
        if (obOver > -0.6 && obOver < 0.6) mix(COL.fairway, aa(0.45 - Math.abs(obOver)) * 0.85);
        const tl = teeLocal(M, x, z);
        const out = Math.max(Math.abs(tl.d) - TEE_HALF, tl.a > 0 ? tl.a - TEE_FRONT : -tl.a - TEE_BACK);
        if (out < 3) {
          mix(COL.cut, aa(1.2 - out));
          mix((Math.floor((tl.d + 50) / 1.5) & 1) ? COL.tee : COL.tee2, aa(-out));
        }
        for (const o of waters) {
          if (!blobNear(o.w, x, z, 1.25) || blobRho(o.w, x, z) > 1.12) continue;
          // by height above the water, so the colours follow the real waterline: a soft grassy bank,
          // a thin wet line right at the water, the lake bed under it
          const dh = heightAt(M, x, z) - o.w.level;
          mix(COL.bank, (1 - sstep(0.06, 0.32, dh)) * 0.45);
          mix(COL.mud, (1 - sstep(0, 0.05, dh)) * 0.7);
          mix(COL.bed, clamp(0.5 - dh / 0.03, 0, 1));
        }
        if (blobNear(G, x, z, M.fringeRho + 0.1)) {
          const rho = blobRho(G, x, z);
          mix(COL.fringe, aa((M.fringeRho - rho) * gR));
          const lx = (x - G.x) * -F.tz + (z - G.z) * F.tx, lz = (x - G.x) * F.tx + (z - G.z) * F.tz;
          const stripe = (Math.floor((lx + lz * 0.35 + 100) / 2.6) & 1) ? COL.green : COL.green2;
          mix(stripe, aa((1 - rho) * gR), 1 + n * 0.02);
        }
        for (const o of blobs) {
          if (!blobNear(o.b, x, z, 1.25)) continue;
          const rho = blobRho(o.b, x, z);
          mix(COL.shade, aa((1.13 - rho) * o.R) * 0.35);
          mix(COL.sandLip, aa((1 - rho) * o.R));
          mix(COL.sand, aa((0.9 - rho) * o.R), 1 + n * 0.04);
        }
        const k = (j * cw + i) * 4;
        D[k] = r; D[k + 1] = gg; D[k + 2] = bb; D[k + 3] = 255;
      }
    };
    return {
      canvas: c,
      step(ms) {
        const t0 = performance.now();
        while (row < ch) {
          paintRow(row++);
          if ((row & 7) === 0 && performance.now() - t0 > ms) break;
        }
        if (row < ch) return false;
        if (row === ch) { g.putImageData(img, 0, 0); row++; }
        return true;
      },
    };
  }

  /** Terrain mesh on the model's tensor grid (UVs map the splat over the inner bounds). */
  function terrainGeometry(THREE, M) {
    const T = M.terrain, B = M.bounds;
    const nx = T.nx, nz = T.nz, W = B.x1 - B.x0, Hm = B.z1 - B.z0;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = T.xs[i]; pos[k * 3 + 1] = T.H[k]; pos[k * 3 + 2] = T.zs[j];
        uv[k * 2] = (T.xs[i] - B.x0) / W; uv[k * 2 + 1] = (T.zs[j] - B.z0) / Hm;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  /** Lambert material with a world-space detail texture multiplied over the map. */
  function terrainMaterial(THREE, map, detail) {
    const m = new THREE.MeshLambertMaterial({ map });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGfWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGfWorld = (modelMatrix * vec4(position, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec2 vGfWorld;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' +
          'float gfA = texture2D(uDetail, vGfWorld * 0.42).r;\n' +
          'float gfB = texture2D(uDetail, vGfWorld * 0.045).g;\n' +
          'diffuseColor.rgb *= (0.7 + gfA * 0.6) * (0.86 + gfB * 0.28);');
    };
    m.customProgramCacheKey = () => 'golf-terrain';
    return m;
  }

  /** Flat polar mesh filling a blob outline at height y (merged list). */
  function blobDisc(THREE, b, y, rings, segs, uvScale) {
    const pos = [], uv = [], idx = [];
    pos.push(b.x, y, b.z); uv.push(b.x / uvScale, b.z / uvScale);
    for (let k = 1; k <= rings; k++) {
      for (let i = 0; i < segs; i++) {
        const [x, z] = blobEdge(b, i / segs * TAU, k / rings);
        pos.push(x, y, z); uv.push(x / uvScale, z / uvScale);
      }
    }
    for (let i = 0; i < segs; i++) idx.push(0, 1 + (i + 1) % segs, 1 + i);
    for (let k = 1; k < rings; k++) {
      const o0 = 1 + (k - 1) * segs, o1 = 1 + k * segs;
      for (let i = 0; i < segs; i++) {
        const a = o0 + i, bq = o0 + (i + 1) % segs, c = o1 + i, d = o1 + (i + 1) % segs;
        idx.push(a, bq, c, bq, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const TREE_COLORS = {
    round: { trunk: 0x8B5E3C, low: 0x3B8A3A, high: 0x7CCB5E },
    pine: { trunk: 0x7A5034, low: 0x2C6E3E, high: 0x5BAA5E },
    bush: { low: 0x3E8C3A, high: 0x7BC95C },
  };

  /** Low-poly tree geometry for instancing (origin at the base, scale 1). */
  function treeGeometry(THREE, world, kind) {
    const rng = SS.util.rng(kind.length * 31 + 7);
    const c = TREE_COLORS[kind];
    const low = new THREE.Color(c.low), high = new THREE.Color(c.high);
    const canopy = (g, y0, y1) => world.paint(g, (x, y, z, out) => out.copy(low).lerp(high, clamp((y - y0) / (y1 - y0), 0, 1) * 0.9 + 0.05));
    const blob = (r, x, y, z, sx = 1, sy = 1, sz = 1) => { const g = new THREE.IcosahedronGeometry(r, 1); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
    const parts = [];
    if (kind === 'pine') {
      const trunk = new THREE.CylinderGeometry(0.14, 0.2, 1.2, 6);
      trunk.translate(0, 0.6, 0);
      parts.push(world.paint(trunk, c.trunk));
      for (const [r, h, y] of [[1.25, 1.7, 1.25], [1.0, 1.5, 2.2], [0.72, 1.3, 3.05]]) {
        const cone = new THREE.ConeGeometry(r, h, 8, 1);
        cone.translate(0, y, 0);
        parts.push(canopy(cone, 0.6, 3.9));
      }
    } else if (kind === 'bush') {
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU + rng.next();
        parts.push(canopy(blob(rng.range(0.4, 0.55), Math.cos(a) * 0.35, 0.32, Math.sin(a) * 0.3, 1, 0.85, 1), 0, 0.9));
      }
      parts.push(canopy(blob(0.5, 0, 0.5, 0, 1, 0.9, 1), 0, 0.9));
    } else {
      const trunk = new THREE.CylinderGeometry(0.15, 0.24, 1.7, 6);
      trunk.translate(0, 0.85, 0);
      parts.push(world.paint(trunk, c.trunk));
      parts.push(canopy(blob(1.15, 0, 2.55, 0, 1, 0.95, 1), 1.4, 3.7));
      const small = (r, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 0); g.translate(x, y, z); return g; };
      parts.push(canopy(small(0.86, 0.62, 2.15, 0.28), 1.4, 3.7));
      parts.push(canopy(small(0.82, -0.55, 2.2, -0.3), 1.4, 3.7));
      parts.push(canopy(small(0.74, 0.1, 3.15, -0.25), 1.4, 3.7));
    }
    return world.mergeGeometries(parts);
  }

  /** Flag cloth texture with the hole number. */
  function flagCanvas(n) {
    const c = makeCanvas(128, 88), g = c.getContext('2d');
    g.fillStyle = '#FF5A5F'; g.fillRect(0, 0, 128, 88);
    g.fillStyle = '#FF8286'; g.fillRect(0, 0, 128, 14);
    g.fillStyle = '#FFFFFF';
    g.font = '700 54px ' + FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 64, 50);
    return c;
  }

  /** Landing target: a ring on a short stem, drawn as a billboard. */
  function targetCanvas() {
    const c = makeCanvas(128, 192), g = c.getContext('2d');
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(20, 50, 30, 0.45)'; g.lineWidth = 12;
    g.beginPath(); g.moveTo(64, 120); g.lineTo(64, 186); g.stroke();
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(64, 120); g.lineTo(64, 186); g.stroke();
    g.beginPath(); g.arc(64, 62, 48, 0, TAU); g.fillStyle = 'rgba(20, 50, 30, 0.35)'; g.fill();
    g.lineWidth = 12; g.strokeStyle = '#FFFFFF'; g.stroke();
    g.beginPath(); g.arc(64, 62, 18, 0, TAU); g.fillStyle = '#FFC93C'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#FFFFFF'; g.stroke();
    return c;
  }

  /** A round marker sprite texture (ball / pin markers on the map). */
  function markerCanvas(fill, ring) {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 26, 0, TAU); g.fillStyle = ring; g.fill();
    g.beginPath(); g.arc(32, 32, 18, 0, TAU); g.fillStyle = fill; g.fill();
    return c;
  }

  /** A soft dark halo that keeps a white ball readable against clouds and bright sky. */
  function haloCanvas() {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 9, 32, 32, 30);
    gr.addColorStop(0, 'rgba(20, 40, 80, 0)');
    gr.addColorStop(0.18, 'rgba(20, 40, 80, 0.55)');
    gr.addColorStop(0.45, 'rgba(20, 40, 80, 0.18)');
    gr.addColorStop(1, 'rgba(20, 40, 80, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  // =============================================================================================
  // 10. HUD styles
  // =============================================================================================

  const HUD_CSS = `
.gf-off { opacity: 0 !important; pointer-events: none !important; }
.gf-left { position: absolute; top: calc(var(--sat) + 70px); left: calc(var(--sal) + 10px); display: flex; flex-direction: column;
  align-items: flex-start; gap: 6px; transition: opacity .25s; }
.gf-player { gap: 7px; padding: 3px 12px 3px 3px; }
.gf-player .ss-portrait { width: 30px; height: 30px; }
.gf-player b { font: 700 15px/1 var(--font-display); color: var(--accent); }
.gf-player b.over { color: #E0464B; }
.gf-dist { font: 700 19px/1 var(--font-display); padding: 6px 12px; gap: 5px; }
.gf-dist small { font: 800 11px/1 var(--font-ui); opacity: .8; }
.gf-dist em { font: 800 11px/1 var(--font-ui); font-style: normal; padding: 2px 5px; border-radius: 6px; background: rgba(255,255,255,.18); }
.gf-lie { font-size: 12px; padding: 5px 10px 5px 7px; }
.gf-lie i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; flex: none; }
.gf-hole { gap: 8px; padding: 4px 12px 4px 4px; }
.gf-hole span.n { min-width: 30px; height: 30px; border-radius: 15px; background: var(--accent); color: #fff; display: flex;
  align-items: center; justify-content: center; font: 700 17px/1 var(--font-display); }
.gf-hole b { font: 700 15px/1 var(--font-display); }
.gf-stroke { font: 700 15px/1 var(--font-display); }
.gf-stroke.hot { background: #FFE9A8; }
.gf-wind { position: absolute; top: calc(var(--sat) + 10px); right: calc(var(--sar) + 10px); display: flex; flex-direction: column;
  align-items: center; gap: 3px; transition: opacity .25s; }
.gf-dial { width: 54px; height: 54px; border-radius: 50%; background: rgba(20, 32, 56, .6); border: 3px solid #fff;
  box-shadow: var(--shadow-soft); position: relative; }
.gf-dial svg { position: absolute; inset: 5px; width: calc(100% - 10px); height: calc(100% - 10px); transition: transform .35s ease-out; }
.gf-dial.calm svg { opacity: .35; }
.gf-wind .ss-chip { font-size: 12px; padding: 4px 8px; }
.gf-map { position: absolute; top: calc(var(--sat) + 100px); right: calc(var(--sar) + 12px); transition: opacity .25s; }
.gf-map.on { background: var(--accent) !important; color: #fff !important; }
.gf-mini { position: absolute; top: calc(var(--sat) + 100px); right: calc(var(--sar) + 10px); width: 66px; height: 118px; border-radius: 14px;
  border: 3px solid #fff; background: #4A9236; box-shadow: 0 3px 10px rgba(22, 58, 108, .3); cursor: pointer; touch-action: manipulation;
  transition: opacity .25s; }
@media (min-width: 900px) and (min-height: 600px) { .gf-mini { width: 84px; height: 150px; } }
.gf-bottom { position: absolute; bottom: calc(var(--sab) + 16px); left: 50%; transform: translateX(-50%); display: flex;
  flex-direction: column; align-items: center; gap: 8px; transition: opacity .25s; }
.gf-club { display: flex; align-items: center; gap: 10px; min-width: 156px; height: 56px; padding: 6px 18px 6px 7px; border: 0;
  border-radius: 30px; background: rgba(255,255,255,.97); color: var(--ink); box-shadow: 0 3px 0 #CEDBEA, 0 6px 16px rgba(22,58,108,.2);
  font: 700 18px/1 var(--font-display); cursor: pointer; touch-action: manipulation; }
.gf-club:active { transform: translateY(2px); box-shadow: 0 1px 0 #CEDBEA, 0 2px 8px rgba(22,58,108,.2); }
.gf-club .ic { width: 42px; height: 42px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center;
  justify-content: center; font: 700 15px/1 var(--font-display); flex: none; }
.gf-club .nm { white-space: nowrap; }
.gf-club .tx { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.gf-club small { font: 800 12px/1 var(--font-ui); color: var(--ink-soft); }
.gf-club .sw { margin-left: auto; opacity: .45; display: flex; }
.gf-club .sw.l { margin-left: -2px; margin-right: -4px; order: -1; }
.gf-club .sw .ss-icon { width: 16px; height: 16px; }
.gf-cue { font: 900 12px/1 var(--font-ui); letter-spacing: .08em; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.6);
  white-space: nowrap; display: flex; align-items: center; gap: 6px; transition: opacity .25s; }
.gf-cue svg { width: 18px; height: 18px; }
.gf-aim { position: absolute; bottom: calc(var(--sab) + 20px); display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: opacity .25s; }
.gf-aim.l { left: calc(var(--sal) + 12px); }
.gf-aim.r { right: calc(var(--sar) + 12px); }
.gf-aim .ss-btn.round { width: 54px; height: 54px; }
.gf-aim small { font: 900 10px/1 var(--font-ui); letter-spacing: .1em; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.55); }
.gf-gauge { position: absolute; left: 0; top: 0; width: 26px; pointer-events: none; }
.gf-gauge .trk { position: relative; width: 20px; border-radius: 10px; background: rgba(20, 32, 56, .5); border: 3px solid #fff;
  box-shadow: var(--shadow-soft); overflow: hidden; }
.gf-gauge .fill { position: absolute; left: 0; right: 0; top: 0; height: 0; background: linear-gradient(180deg, #FFF4C4, #FFC93C); }
.gf-gauge .over { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(255, 90, 95, .55); }
.gf-gauge .full { position: absolute; left: -3px; right: -3px; height: 3px; background: #fff; }
.gf-gauge .pin { position: absolute; left: -4px; right: -4px; height: 4px; margin-top: -2px; background: #3BC45B; box-shadow: 0 0 0 1.5px #fff; }
.gf-gauge .pin.flag { background: #FF5A5F; }
.gf-gauge .pin.flag::after { content: ''; position: absolute; right: -9px; top: -8px; border-left: 10px solid #FF5A5F; border-top: 5px solid transparent;
  border-bottom: 5px solid transparent; filter: drop-shadow(0 0 1px #fff); }
.gf-gauge.lbl-r .pin.flag::after { right: auto; left: -9px; border-left: 0; border-right: 10px solid #FF5A5F; }
.gf-gauge .tk { position: absolute; top: 3px; left: 0; right: 0; }
.gf-gauge .tk i { position: absolute; right: 100%; width: 6px; height: 2px; margin-top: -1px; background: rgba(255,255,255,.75); }
.gf-gauge .tk i.b { width: 9px; background: #fff; }
.gf-gauge .tk span { position: absolute; right: 12px; top: -7px; font: 800 11px/1 var(--font-ui); color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
.gf-gauge.lbl-r .tk i { right: auto; left: 100%; }
.gf-gauge.lbl-r .tk span { right: auto; left: 12px; }
.gf-gauge .val { position: absolute; bottom: calc(100% + 7px); left: 50%; transform: translateX(-50%); font: 700 20px/1 var(--font-display);
  color: #fff; text-shadow: 0 2px 0 rgba(20,50,100,.45), 0 0 8px rgba(20,50,100,.5); white-space: nowrap; text-align: center; }
.gf-gauge .val small { display: block; margin-top: 3px; font: 800 12px/1 var(--font-ui); }
.gf-gauge.edge-r .val { left: auto; right: -4px; transform: none; text-align: right; }
.gf-gauge.edge-l .val { left: -4px; transform: none; text-align: left; }
.gf-gauge .val small:empty { display: none; }
.gf-gauge .val.hit { color: #FFE37A; }
.gf-gauge.overswing .fill { background: linear-gradient(180deg, #FFF4C4, #FFC93C 85%, #FF5A5F); }
.gf-gauge.flick .trk { border-color: #FFC93C; }
.gf-report { position: absolute; left: 50%; bottom: calc(var(--sab) + 96px); transform: translateX(-50%); font-size: 13px;
  transition: opacity .3s; }
.gf-report b { color: #FFC93C; }
.gf-tag { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 13px;
  font: 700 14px/1 var(--font-display); white-space: nowrap; pointer-events: none; transition: opacity .2s; will-change: transform; }
.gf-tag.pin { background: rgba(24, 70, 40, .86); color: #fff; box-shadow: 0 2px 8px rgba(10, 30, 20, .3); }
.gf-tag.pin svg { width: 13px; height: 13px; }
.gf-tag.land { background: rgba(255, 255, 255, .95); color: var(--ink); font-size: 13px; box-shadow: 0 2px 8px rgba(20, 40, 80, .25); }
.gf-tag.land i { width: 9px; height: 9px; border-radius: 50%; background: #FFC93C; box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(20,50,30,.35); }
.gf-tag.block { background: #FF5A5F; color: #fff; font-size: 12px; }
.gf-tag.wind { padding: 4px; border-radius: 50%; background: #3FA9F5; color: #fff; box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(20, 40, 80, .3); }
.gf-tag.wind svg { width: 14px; height: 14px; }
.gf-tuck { opacity: 0 !important; }
.gf-streak { position: absolute; inset: 0; pointer-events: none; }
.gf-streak svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.gf-streak line { stroke: rgba(255, 255, 255, .5); stroke-width: 3; stroke-dasharray: 2 9; stroke-linecap: round; opacity: 0; transition: opacity .2s; }
.gf-streak line.on { opacity: 1; }
.gf-streak polyline { fill: none; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transition: opacity .45s;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .45)); }
.gf-streak text { font: 800 15px/1 var(--font-ui); fill: #fff; paint-order: stroke; stroke: rgba(20, 32, 56, .6); stroke-width: 3px; opacity: 0;
  transition: opacity .45s; }
.gf-streak .on { opacity: 1; transition: none; }
.gf-dist.live { background: rgba(20, 32, 56, .72); }
.gf-turnwrap { position: absolute; left: 0; right: 0; top: 30%; display: flex; justify-content: center; transition: opacity .25s, transform .25s; }
.gf-turnwrap.out { opacity: 0; transform: translateY(-14px) scale(.95); }
.gf-turncard { display: flex; align-items: center; gap: 12px; max-width: calc(100% - 28px); padding: 10px 22px 10px 10px;
  background: #fff; border-radius: 44px; box-shadow: 0 10px 30px rgba(22, 40, 80, .3); }
.gf-turncard .ss-portrait { width: 64px; height: 64px; }
.gf-turncard h3 { margin: 0; font: 700 clamp(20px, 6.4vw, 28px)/1.05 var(--font-display); color: var(--ink); white-space: nowrap; }
.gf-turncard p { margin: 4px 0 0; font: 800 13px/1 var(--font-ui); color: var(--ink-soft); }
.gf-scwrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 12px;
  background: rgba(16, 36, 24, .28); transition: opacity .25s; }
.gf-scwrap.out { opacity: 0; }
.gf-sc { width: min(560px, 100%); max-height: calc(100% - 20px); overflow: auto; padding: 16px 14px 14px; display: flex;
  flex-direction: column; align-items: center; gap: 12px; }
.gf-sc h3 { margin: 0; font: 700 24px/1.1 var(--font-display); color: var(--ink); text-align: center; }
.gf-sc h3 small { display: block; font: 800 13px/1.3 var(--font-ui); color: var(--ink-soft); margin-top: 3px; }
.gf-scroll { max-width: 100%; overflow-x: auto; }
.gf-sc table { font-size: 13px; }
.gf-sc td, .gf-sc th { padding: 5px 4px; min-width: 22px; }
.gf-sc td.nm { text-align: left; white-space: nowrap; padding-left: 6px; }
.gf-sc td.nm img { width: 22px; height: 22px; vertical-align: middle; margin-right: 4px; display: inline-block; }
.gf-sc tr.par td { color: var(--ink-soft); font-weight: 700; }
.gf-sc td.tot { font: 700 14px/1 var(--font-display); }
.gf-sc td i { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; font-style: normal; }
.gf-sc td i.b { border-radius: 50%; box-shadow: 0 0 0 2px #3BC45B; color: #1F8E3D; }
.gf-sc td i.e { border-radius: 50%; box-shadow: 0 0 0 2px #FFC93C, 0 0 0 4px #fff, 0 0 0 6px #FFC93C; color: #B07D00; }
.gf-sc td i.o { border-radius: 4px; box-shadow: 0 0 0 2px #9AA6B8; }
.gf-sc td i.oo { border-radius: 4px; box-shadow: 0 0 0 2px #FF8A8D, 0 0 0 4px #fff, 0 0 0 6px #FF8A8D; }
.gf-sc td.cur { background: var(--tint); }
.gf-sc th.cur { background: #FFC93C; color: #5A3A10; }
.gf-sc .ss-btn { min-width: 180px; }
.gf-skip { position: absolute; bottom: calc(var(--sab) + 18px); left: 50%; transform: translateX(-50%); font-size: 12px; opacity: .9; }
@media (max-height: 520px) and (orientation: landscape) {
  .gf-left { top: calc(var(--sat) + 62px); }
  .gf-map { top: calc(var(--sat) + 96px); }
  .gf-mini { top: calc(var(--sat) + 96px); width: 56px; height: 98px; }
  .gf-bottom.putt .gf-cue { display: none; }
  .gf-bottom { bottom: calc(var(--sab) + 10px); }
  .gf-club { height: 50px; min-width: 140px; }
  .gf-club .ic { width: 38px; height: 38px; }
  .gf-aim { bottom: calc(var(--sab) + 12px); }
  .gf-report { bottom: calc(var(--sab) + 98px); }
  .gf-turnwrap { top: 34%; }
  .gf-sc { padding: 10px; gap: 8px; }
  .gf-sc h3 { font-size: 20px; }
}
@media (max-width: 360px) { .gf-sc td, .gf-sc th { padding: 4px 2px; min-width: 18px; } .gf-sc td.nm span { display: none; } }
`;

  // =============================================================================================
  // 11. The sport instance
  // =============================================================================================

  const FLICK_V = 0.65;         // short sides / s of upward finger speed that starts a flick
  const ALPHA_TOP = 2.05;       // full backswing arm angle (rad)
  const ALPHA_PUTT = 0.5;

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, engine, save, util: U } = ctx;
    const mode = MODE_HOLES[ctx.mode] ? ctx.mode : 'beginner';
    const RULES = MODE_RULES[mode];
    const modeName = (DEF.modes.find(m => m.id === mode) || DEF.modes[0]).name;
    const holeList = MODE_HOLES[mode];
    const players = ctx.players;
    const rng = ctx.rng;
    const hand = save.settings && save.settings.leftHanded ? -1 : 1;
    const hintsOn = !(save.settings && save.settings.hints === false);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const DOWN_V = V(0, -1, 0);
    const shortSide = () => Math.min(engine.size.w, engine.size.h);

    // ---- world & instance-lifetime resources ---------------------------------------------------
    const env = world.environment(scene, {
      sky: 'day', fog: true, fogNear: 240, fogFar: 1150, hills: true, hillRadius: 560, clouds: 14,
      trees: false, ground: false, seed: 11, shadow: { center: V(0, 0, 0), size: 40 },
    });
    const envMovers = env.group.children.filter(o => o.name === 'hills' || o.name === 'hills-far' || o.name === 'clouds');
    const clouds = envMovers.find(o => o.name === 'clouds') || null;
    const near0 = camera.near, far0 = camera.far;
    camera.near = 0.08;
    camera.far = 2600;
    delete camera.userData.fit;

    const owned = [];
    const keep = x => { x.userData.shared = true; owned.push(x); return x; };
    const detailTex = keep(new THREE.CanvasTexture(detailCanvas()));
    detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.anisotropy = 4;
    const rippleTex = keep(new THREE.CanvasTexture(rippleCanvas()));
    rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
    rippleTex.colorSpace = THREE.SRGBColorSpace;
    const treeGeos = { round: keep(treeGeometry(THREE, world, 'round')), pine: keep(treeGeometry(THREE, world, 'pine')), bush: keep(treeGeometry(THREE, world, 'bush')) };
    const treeMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const waterMat = keep(new THREE.MeshPhongMaterial({ color: 0xFFFFFF, map: rippleTex, specular: 0x9FD4FF, shininess: 90, transparent: true, opacity: 0.9 }));
    const propMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const markTex = keep(new THREE.CanvasTexture(markerCanvas('#FFC93C', '#FFFFFF')));
    markTex.colorSpace = THREE.SRGBColorSpace;

    // ---- ball, trail, markers ----------------------------------------------------------------------
    const ballGeo = keep(new THREE.SphereGeometry(0.036, 18, 12));
    const ball = new THREE.Mesh(ballGeo, world.mat(0xFFFFFF, { kind: 'phong', shininess: 70 }));
    ball.castShadow = true;
    scene.add(ball);
    const ballShadow = world.blobShadow(0.08, 0.45);
    scene.add(ballShadow);
    const peg = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.01, 0.005, 0.07, 6)), world.mat(0xFFD34D));
    scene.add(peg);
    // a slim ribbon, updated by hand so the stretch right in front of the chase camera can be faded out
    // (seen from just behind, it would otherwise read as a white stripe painted down the fairway)
    const trail = world.trail(ball, { color: 0xFFFFFF, width: 0.07, length: 36, opacity: 0.5, maxJump: 40 });
    trail.visible = false;
    trail.update();
    function updateTrail() {
      if (!trail.visible) return;
      trail.update();
      const g = trail.mesh.geometry, pos = g.attributes.position.array, al = g.attributes.aAlpha.array;
      const c = camera.position;
      for (let i = 0; i < al.length; i++) {
        if (!al[i]) continue;
        const d = Math.hypot(pos[i * 3] - c.x, pos[i * 3 + 1] - c.y, pos[i * 3 + 2] - c.z);
        al[i] *= sstep(3, 8, d);
      }
      g.attributes.aAlpha.needsUpdate = true;
    }
    const haloTex = keep(new THREE.CanvasTexture(haloCanvas()));
    haloTex.colorSpace = THREE.SRGBColorSpace;
    const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: haloTex, depthWrite: false, fog: false, transparent: true })));
    halo.visible = false;
    scene.add(halo);
    const ballMark = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: markTex, depthTest: false, depthWrite: false, fog: false })));
    ballMark.renderOrder = 8;
    ballMark.visible = false;
    scene.add(ballMark);
    // and the cup, which is invisible from overhead
    const pinTex = keep(new THREE.CanvasTexture(markerCanvas('#FF5A5F', '#FFFFFF')));
    pinTex.colorSpace = THREE.SRGBColorSpace;
    const pinMark = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: pinTex, depthTest: false, depthWrite: false, fog: false })));
    pinMark.renderOrder = 8;
    pinMark.visible = false;
    scene.add(pinMark);

    const DOTS = 72;
    const dotGeo = keep(new THREE.CircleGeometry(1, 12));
    dotGeo.rotateX(-Math.PI / 2);
    const dotMat = keep(new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    const dots = new THREE.InstancedMesh(dotGeo, dotMat, DOTS);
    dots.frustumCulled = false;
    dots.renderOrder = 4;
    for (let i = 0; i < DOTS; i++) dots.setColorAt(i, new THREE.Color(0xFFFFFF));
    scene.add(dots);
    const ringGeo = keep(new THREE.RingGeometry(0.8, 1, 48));
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = keep(new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
    const ringPulseMat = keep(new THREE.MeshBasicMaterial({ color: 0xFFC93C, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const ringPulse = new THREE.Mesh(ringGeo, ringPulseMat);
    ring.renderOrder = ringPulse.renderOrder = 5;
    // where the wind takes the shot (Beginner / Full 9), and the predicted landing spot in flight
    const ghostRing = new THREE.Mesh(ringGeo, keep(new THREE.MeshBasicMaterial({ color: 0x5CC2FF, transparent: true, opacity: 0.9, depthWrite: false, fog: false })));
    ghostRing.renderOrder = 5;
    ghostRing.visible = false;
    const flyMarkMat = keep(new THREE.MeshBasicMaterial({ color: 0xFFC93C, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    const flyGeo = keep(new THREE.RingGeometry(0.62, 1, 40));
    flyGeo.rotateX(-Math.PI / 2);
    const flyMark = new THREE.Mesh(flyGeo, flyMarkMat);
    flyMark.renderOrder = 5;
    flyMark.visible = false;
    scene.add(ring, ringPulse, ghostRing, flyMark);
    const targetTex = keep(new THREE.CanvasTexture(targetCanvas()));
    targetTex.colorSpace = THREE.SRGBColorSpace;
    const target = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: targetTex, depthWrite: false, fog: false, transparent: true })));
    target.renderOrder = 6;
    target.center.set(0.5, 0);
    scene.add(target);

    // ---- golfers -----------------------------------------------------------------------------------
    function buildClub() {
      const group = new THREE.Group();
      const shaftMat = world.mat(0xC9D2DC, { kind: 'phong', shininess: 80 });
      const shaft = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.009, 0.007, 1, 6)), shaftMat);
      const grip = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.019, 0.016, 0.17, 8)), world.mat(0x2B3446, { kind: 'phong' }));
      grip.position.y = -0.06;
      const heads = {
        wood: new THREE.Mesh(keep(new THREE.SphereGeometry(0.06, 12, 8)), world.mat(0x2F5FD8, { kind: 'phong', shininess: 90 })),
        iron: new THREE.Mesh(keep(new THREE.BoxGeometry(0.03, 0.055, 0.1)), world.mat(0xDDE3EA, { kind: 'phong', shininess: 90 })),
        putter: new THREE.Mesh(keep(new THREE.BoxGeometry(0.035, 0.03, 0.12)), world.mat(0xB8C2CE, { kind: 'phong', shininess: 90 })),
      };
      heads.wood.scale.set(1, 0.7, 1.25);
      group.add(shaft, grip, heads.wood, heads.iron, heads.putter);
      group.traverse(o => { if (o.isMesh) o.castShadow = true; });
      return {
        group,
        set(ci) {
          const c = CLUBS[ci];
          const kind = c.putter ? 'putter' : c.id === 'D' || c.id === '3W' ? 'wood' : 'iron';
          shaft.scale.y = c.len;
          shaft.position.y = -c.len / 2;
          for (const k of Object.keys(heads)) {
            heads[k].visible = k === kind;
            heads[k].position.set(0, -c.len, k === 'putter' ? 0.03 : 0.02);
          }
        },
      };
    }

    const golfers = players.map(pl => {
      const pal = pals.create(pl.profile);
      pal.root.visible = false;
      scene.add(pal.root);
      const shadow = world.blobShadow(0.42, 0.26);
      shadow.visible = false;
      scene.add(shadow);
      const club = buildClub();
      pal.root.add(club.group);
      return { pal, shadow, club, alpha: 0, shown: 0, lambda: 20, reacting: false, dTarget: V(0, -0.94, 0.34).normalize(), dShown: V(0, -0.94, 0.34).normalize(), geom: null, posing: false };
    });

    // ---- per-game state --------------------------------------------------------------------------
    const cards = players.map(() => holeList.map(() => null));
    const stats = players.map(() => ({ fir: 0, firN: 0, gir: 0, putts: 0, drive: 0, longPutt: 0, birdies: 0, eagles: 0, pars: 0, hio: 0, pens: 0 }));
    let M = null, vis = null, hi = 0;
    let wind = { x: 0, z: 0, speed: 0, dir: 0 };
    let cur = null;                // current turn: { p, strokes, putts, ball, club, aim, holed, pickedUp, firstShot, onGreenIn }
    let phase = 'intro';
    let autoplay = false;
    let flowGen = 0;
    let shotWaiter = null, skipWaiter = null;
    let play = null;               // shot playback
    let swing = null;              // scripted swing (downswing → finish)
    let pull = 0;                  // live backswing amount from the gesture (0..1.1)
    let mapOn = false;
    let aimDir = 0, aimHeld = 0;
    let hintHandle = null, firstSwingDone = false, swingsDone = 0;
    let lastShot = null, lastOutcome = null;
    let ringDirty = true, ringInfo = null;
    let keyCharge = null;
    let ambience = null, windLoop = null;
    let started = false, startHi = 0;
    let debugTouched = false;      // skipTo / placeBall used: the round can't earn medals or records
    const totalPar = holeList.reduce((a, h) => a + HOLES[h].par, 0);

    // =============================================================================================
    // HUD
    // =============================================================================================

    ui.css('golf-hud', HUD_CSS);
    const hud = buildHud();

    function buildHud() {
      const root = ctx.hud;
      const top = ui.el('div', 'ss-hud-top');
      const holeChip = ui.el('div', 'ss-chip gf-hole ss-pop', '<span class="n">1</span><b>Par 4</b>');
      const strokeChip = ui.el('div', 'ss-chip gf-stroke ss-pop', 'Stroke 1');
      top.append(holeChip, strokeChip);
      const left = ui.el('div', 'gf-left');
      const playerChip = ui.el('div', 'ss-chip gf-player ss-pop');
      const distChip = ui.el('div', 'ss-chip dark gf-dist');
      const lieChip = ui.el('div', 'ss-chip dark gf-lie');
      left.append(playerChip, distChip, lieChip);
      const windBox = ui.el('div', 'gf-wind');
      const dial = ui.el('div', 'gf-dial',
        '<svg viewBox="0 0 40 40"><path d="M20 3 L30 18 L23.5 16.5 L23.5 36 L16.5 36 L16.5 16.5 L10 18 Z" fill="#fff" stroke="rgba(20,32,56,.35)" stroke-width="1.2" stroke-linejoin="round"/></svg>');
      const windChip = ui.el('div', 'ss-chip dark', '0 m/s');
      windBox.append(dial, windChip);
      const mapBtn = ui.button('Map', () => toggleMap(), { kind: 'round', icon: 'map', className: 'light small gf-map ss-block gf-off', sfx: 'ui_toggle' });
      mapBtn.setAttribute('aria-label', 'Map');
      // the hole at a glance (tee at the bottom, green at the top); a tap opens the big map
      const mini = ui.el('canvas', 'gf-mini ss-block gf-off');
      mini.setAttribute('aria-label', 'Hole map');
      mini.addEventListener('click', () => { if (phase === 'aim' && !autoplay && !pulling()) { ui.sfx('ui_toggle'); toggleMap(); } });
      const bottom = ui.el('div', 'gf-bottom');
      const cue = ui.el('div', 'gf-cue', ui.icon('down') + '<span>PULL DOWN · FLICK UP</span>' + ui.icon('up'));
      const clubBtn = ui.el('button', 'gf-club ss-block', '<span class="sw l">' + ui.icon('left') + '</span><span class="ic">7I</span><span class="tx"><span class="nm">7 Iron</span><small>135 m</small></span><span class="sw">' + ui.icon('right') + '</span>');
      clubBtn.type = 'button';
      clubBtn.setAttribute('aria-label', 'Change club (left side: previous, right side: next)');
      clubBtn.addEventListener('click', e => {
        if (phase !== 'aim' || autoplay || pulling()) return;
        const r = clubBtn.getBoundingClientRect();
        cycleClub(e.clientX && e.clientX - r.left < r.width * 0.4 ? -1 : 1);
        ui.sfx('ui_tick');
      });
      bottom.append(cue, clubBtn);
      const mkAim = (side, icon, dir) => {
        const wrap = ui.el('div', 'gf-aim ' + side);
        const b = ui.button(dir < 0 ? 'Aim left' : 'Aim right', null, { kind: 'round', icon, className: 'light ss-block', sfx: null });
        const start = e => { if (phase !== 'aim' || autoplay || pulling()) return; e.preventDefault(); aimDir = dir; aimHeld = 0; nudgeAim(dir * (isPutt() ? 0.1 : 0.25) * DEG); ui.sfx('ui_tick'); };
        const stop = () => { aimDir = 0; };
        b.addEventListener('pointerdown', start);
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointerleave', stop);
        b.addEventListener('pointercancel', stop);
        wrap.append(b, ui.el('small', '', 'AIM'));
        return wrap;
      };
      const aimL = mkAim('l', 'rotate-left', -1), aimR = mkAim('r', 'rotate-right', 1);
      const gauge = ui.el('div', 'gf-gauge gf-off', '<div class="trk"><i class="over"></i><i class="fill"></i><i class="full"></i></div><div class="tk"></div><i class="pin"></i><div class="val"><span></span><small></small></div>');
      const report = ui.el('div', 'ss-chip dark gf-report gf-off');
      // the finger's path: a 'straight up' guide while pulling, then the flick itself for a moment
      const streak = ui.el('div', 'gf-streak', '<svg><line class="g"/><polyline/><text></text></svg>');
      const pinTag = ui.el('div', 'gf-tag pin gf-off', ui.icon('flag') + '<span></span>');
      const landTag = ui.el('div', 'gf-tag land gf-off', '<i></i><span></span>');
      const blockTag = ui.el('div', 'gf-tag block gf-off', 'Blocked');
      const windTag = ui.el('div', 'gf-tag wind gf-off', ui.icon('wind'));
      root.append(pinTag, landTag, blockTag, windTag, top, left, windBox, mapBtn, mini, aimL, aimR, bottom, streak, gauge, report);
      return {
        top, holeChip, strokeChip, left, playerChip, distChip, lieChip, windBox, dial, windChip, mapBtn, mini, bottom, cue, clubBtn, aimL, aimR,
        gauge, gTrk: gauge.querySelector('.trk'), gFill: gauge.querySelector('.fill'), gOver: gauge.querySelector('.over'),
        gFull: gauge.querySelector('.full'), gPin: gauge.querySelector('.pin'), gVal: gauge.querySelector('.val'),
        gPct: gauge.querySelector('.val span'), gCarry: gauge.querySelector('.val small'), gTicks: gauge.querySelector('.tk'), report, playerFor: -1,
        pinTag, pinTxt: pinTag.querySelector('span'), landTag, landTxt: landTag.querySelector('span'), blockTag, windTag,
        streak, sGuide: streak.querySelector('line'), sPath: streak.querySelector('polyline'), sText: streak.querySelector('text'),
      };
    }

    const SURF_DOT = { tee: '#7DD15A', fairway: '#6CC24B', fringe: '#8FD86B', green: '#9BE07A', rough: '#3E7F2E', sand: '#EBD39A', water: '#3DA5E0', ob: '#FFFFFF' };

    function toParFor(p) {
      let d = 0;
      cards[p].forEach((s, k) => { if (s != null) d += s - HOLES[holeList[k]].par; });
      return d;
    }

    /** A distance the way the HUD and the banners say it: cm under 1 m, one decimal under 10 m. */
    function fmtDist(d) { return d < 1 ? Math.max(1, Math.round(d * 100)) + ' cm' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' m'; }

    function refreshHud() {
      if (!M) return;
      hud.holeChip.innerHTML = '<span class="n">' + (holeList[hi] + 1) + '</span><b>Par ' + M.par + '</b>';
      const p = cur ? cur.p : 0;
      const prof = players[p].profile;
      if (hud.playerFor !== p) {
        hud.playerFor = p;
        hud.playerChip.innerHTML = '';
        hud.playerChip.append(ui.portraitImg(prof, 30), ui.el('span', '', ui.esc(prof.name)), ui.el('b'));
      }
      const tp = toParFor(p);
      const b = hud.playerChip.querySelector('b');
      b.textContent = toParText(tp);
      b.classList.toggle('over', tp > 0);
      if (!cur) return;
      // the stroke about to be played while lining up; the one just played while it's in the air
      const done = cur.holed || cur.pickedUp;
      const n = done || phase === 'shot' || phase === 'react' || phase === 'holed' || phase === 'card' ? cur.strokes : cur.strokes + 1;
      hud.strokeChip.textContent = cur.holed ? (cur.strokes === 1 ? 'Hole in One!' : scoreName(cur.strokes, M.par) + ' (' + cur.strokes + ')') : cur.pickedUp ? 'Picked up' : 'Stroke ' + Math.max(1, n);
      hud.strokeChip.classList.toggle('hot', !done && n >= M.par + MAX_OVER_PAR);
      if (done) {
        // the result, not a readout for a ball that's gone
        hud.distChip.classList.add('live');
        hud.distChip.innerHTML = cur.holed ? 'IN THE HOLE' : 'PICKED UP';
        hud.lieChip.classList.add('gf-off');
        return;
      }
      const bl = cur.ball;
      const d = Math.hypot(M.pin.x - bl.x, M.pin.z - bl.z);
      const dh = groundPin() - (bl.y - BALL_R);
      const onGreen = bl.surf === 'green' || bl.surf === 'fringe';
      let elev = '';
      if (onGreen && Math.abs(dh) >= 0.02) elev = '<em>' + (dh > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(dh) * 100) + ' cm</em>';
      else if (!onGreen && Math.abs(dh) >= 1.5) elev = '<em>' + (dh > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(dh)) + ' m</em>';
      hud.distChip.classList.remove('live');
      hud.distChip.innerHTML = fmtDist(d) + ' <small>TO PIN</small>' + elev;
      hud.lieChip.classList.remove('gf-off');
      const sf = bl.surf;
      hud.lieChip.innerHTML = '<i style="background:' + (SURF_DOT[sf] || '#fff') + '"></i>' + (SURF[sf] ? SURF[sf].name : 'Tee');
      const c = CLUBS[cur.club];
      hud.bottom.classList.toggle('putt', !!c.putter);
      hud.clubBtn.querySelector('.ic').textContent = c.short;
      hud.clubBtn.querySelector('.nm').textContent = c.name;
      refreshClubCarry();
    }

    /** The club chip's number: a full swing's carry, the same one the landing ring shows. */
    function refreshClubCarry() {
      if (!cur || !M) return;
      const c = CLUBS[cur.club], d = distToPin();
      const carry = ringInfo && ringInfo.dist != null && !ringDirty ? ringInfo.dist : c.carry * lieDist(c, cur.ball.surf, d);
      const txt = c.putter ? 'Meter ' + puttScale(d) + ' m' : 'Carry ' + Math.round(carry) + ' m';
      const el = hud.clubBtn.querySelector('small');
      if (el.textContent !== txt) el.textContent = txt;
    }

    function refreshWind() {
      hud.windChip.textContent = wind.speed < 0.5 ? 'Calm' : wind.speed.toFixed(1) + ' m/s';
      hud.dial.classList.toggle('calm', wind.speed < 0.5);
    }

    /** Wind arrow relative to the camera's view (up on screen = blowing away from you). */
    function updateWindDial() {
      let camHead;
      if (cam.mode === 'map') camHead = Math.atan2(cam.up.x, -cam.up.z);
      else camHead = Math.atan2(cam.look.x - cam.pos.x, -(cam.look.z - cam.pos.z));
      const rel = wrapA(wind.dir - camHead);
      const deg = Math.round(rel / DEG);
      if (hud.windDeg !== deg) { hud.windDeg = deg; hud.dial.firstElementChild.style.transform = 'rotate(' + deg + 'deg)'; }
    }

    let uiAimOn = null;
    function setAimUi(on) {
      const v = !!on && !autoplay;
      if (uiAimOn === v) return;
      uiAimOn = v;
      for (const el of [hud.aimL, hud.aimR, hud.bottom]) el.classList.toggle('gf-off', !v);
      refreshMapUi();
      hud.cue.classList.toggle('gf-off', !v || !!hintHandle || swingsDone >= 3);
    }

    function showGauge(on) { hud.gauge.classList.toggle('gf-off', !on); if (!on) showGuide(null); }

    /**
     * The meter hangs from the press point in a column beside the finger: at the screen edge on the
     * finger's side when that is free, else stepped inward, always clear of the HUD (wind dial, map
     * and aim buttons, chips) so nothing it reads sits under it.
     */
    function placeGauge() {
      refreshMapUi();
      const s = press, w = engine.size.w;
      const cs = getComputedStyle(ui.root);
      const sal = parseFloat(cs.getPropertyValue('--sal')) || 0, sar = parseFloat(cs.getPropertyValue('--sar')) || 0;
      const side = s.sx > w / 2 ? 1 : -1;
      const scale = s.scale;
      const top = s.sy - 46, bottom = s.sy + scale * (isPutt() ? 1 : 1.1) + 6;
      const boxes = [];
      for (const el of [hud.windBox, hud.mapBtn, hud.mini, hud.aimL, hud.aimR, hud.left, hud.top, hud.bottom]) {
        if (el.classList.contains('gf-off')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0) boxes.push(r);
      }
      const clear = x => boxes.every(r => x + 32 < r.left || x - 32 > r.right || bottom < r.top || top > r.bottom);
      const edge = side > 0 ? w - sar - 36 : sal + 36;
      let cx = null;
      for (const c of [edge, edge - side * 66, edge - side * 132, s.sx - side * 66, s.sx + side * 66]) {
        if (Math.abs(c - s.sx) >= 46 && c >= sal + 30 && c <= w - sar - 30 && clear(c)) { cx = c; break; }
      }
      if (cx == null) cx = Math.abs(s.sx - edge) >= 46 ? edge : s.sx - side * 58;
      hud.gauge.style.transform = 'translate(' + Math.round(cx - 13) + 'px,' + Math.round(s.sy - 3) + 'px)';
      hud.gTrk.style.height = Math.round(scale * (isPutt() ? 1 : 1.1)) + 'px';
      hud.gFull.style.top = Math.round(scale - 1.5) + 'px';
      hud.gFull.style.display = isPutt() ? 'none' : '';
      hud.gOver.style.height = isPutt() ? '0' : Math.round(scale * 0.1) + 'px';
      const pp = pinPower();
      hud.gPin.style.display = pp > 0 && pp <= 1.1 ? '' : 'none';
      hud.gPin.style.top = Math.round(pp * scale + 3) + 'px';
      hud.gPin.classList.toggle('flag', isPutt() && RULES.puttMark === 'flag');
      // putts: a ruler in metres beside the track, labels on the side toward the screen centre
      hud.gauge.classList.toggle('lbl-r', cx < w / 2);
      // near an edge, the readout above the meter lines up with it on the inside
      hud.gauge.classList.toggle('edge-r', cx > w - sar - 60);
      hud.gauge.classList.toggle('edge-l', cx < sal + 60);
      let html = '';
      if (isPutt()) {
        const [, range, step, lab] = puttRange(distToPin());
        for (let m = step; m <= range + 1e-6; m += step) {
          const y = Math.round(m / range * scale);
          const big = Math.abs(m / lab - Math.round(m / lab)) < 1e-6;
          html += '<i class="' + (big ? 'b' : '') + '" style="top:' + y + 'px">' + (big ? '<span>' + m + '</span>' : '') + '</i>';
        }
      }
      if (hud.gTicks.dataset.k !== html) { hud.gTicks.innerHTML = html; hud.gTicks.dataset.k = html; }
    }

    function drawGauge(power) {
      const s = press;
      hud.gFill.style.height = Math.round(power * s.scale) + 'px';
      hud.gauge.classList.toggle('overswing', power > 1);
      hud.gauge.classList.toggle('flick', !!s.flick);
      const txt = isPutt() ? (power * puttScale(distToPin())).toFixed(1) + ' m' : Math.round(power * 100) + '%';
      if (hud.gPct.textContent !== txt) hud.gPct.textContent = txt;
      const pp = pinPower();
      // the value lights up on a mark that IS the answer (the hole's distance on a putt is not)
      const answer = !isPutt() || RULES.puttMark === 'pace';
      hud.gVal.classList.toggle('hit', pp > 0 && answer && Math.abs(power - pp) < (isPutt() ? 0.025 : 0.02));
    }

    /**
     * The right power from here (cached per ball and club). Putts: the pace that, struck straight at
     * the cup, dies PUTT_PAST beyond it (simulated, so slope is in it — the read is the line). Full
     * shots: the power whose calm CARRY reaches the pin (roll, slope and wind stay a judgement).
     */
    let tick = { key: '', power: -1 };
    function idealPower() {
      if (!cur || !M) return -1;
      const putt = CLUBS[cur.club].putter;
      const b = cur.ball, key = cur.club + ':' + b.x.toFixed(2) + ':' + b.z.toFixed(2) + ':' + M.index;
      if (tick.key !== key) {
        const d = distToPin();
        const aim = headingTo(b.x, b.z, M.pin.x, M.pin.z);
        tick = { key, power: putt ? powerFor(M, b, cur.club, aim, d + PUTT_PAST, puttScale(d)) : carryPowerFor(M, b, cur.club, aim, d) };
      }
      return tick.power;
    }

    /**
     * The mark on the meter, by mode: Beginner marks the right pace on putts and the pin's carry on
     * full shots; Full 9 marks the hole's distance on putts (slope is your read); Expert has no mark.
     * −1 when there is none.
     */
    function pinPower() {
      if (!cur || !M) return -1;
      if (!CLUBS[cur.club].putter) return RULES.carryMark ? idealPower() : -1;
      if (RULES.puttMark === 'pace') return idealPower();
      if (RULES.puttMark === 'flag') return distToPin() / puttScale(distToPin());
      return -1;
    }

    // =============================================================================================
    // Mini-map: the whole hole at a glance (the baked terrain splat, turned so the hole runs up)
    // =============================================================================================

    const miniMap = { base: null, baseKey: '', key: '', T: null };
    let lastRing = null;

    /**
     * Map vs mini-map: the mini-map while aiming a full shot (tucked away mid-swing, so the meter can
     * take that column), the round button for the big map and on the green.
     */
    function refreshMapUi() {
      const on = uiAimOn && !!cur;
      const miniOn = on && !mapOn && !isPutt() && !pulling();
      if (hud.mini.classList.contains('gf-off') === miniOn) hud.mini.classList.toggle('gf-off', !miniOn);
      const btnOn = on && (mapOn || isPutt());
      if (hud.mapBtn.classList.contains('gf-off') === btnOn) hud.mapBtn.classList.toggle('gf-off', !btnOn);
    }

    /** The static layer for this hole and canvas size, and the world → canvas transform. */
    function miniBase(w, h, dpr) {
      const key = M.index + ':' + w + 'x' + h + '@' + dpr;
      if (miniMap.base && miniMap.baseKey === key) return miniMap.base;
      // hole frame: hx/hz up the screen (tee → pin), rx/rz to the right
      const [hx, hz] = norm2(M.pin.x - M.tee.x, M.pin.z - M.tee.z), rx = -hz, rz = hx;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of M.pts) { const u = q.x * hx + q.z * hz, v = q.x * rx + q.z * rz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      u0 -= 14; u1 += 32; v0 -= 24; v1 += 24;
      const sc = Math.min(w / (v1 - v0), h / (u1 - u0));
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      // screen = (w/2 + (v − vc)·sc, h/2 − (u − uc)·sc)
      const T = { hx, hz, rx, rz, sc, ox: w / 2 - vc * sc, oy: h / 2 + uc * sc };
      T.at = (x, z) => [T.ox + (x * rx + z * rz) * sc, T.oy - (x * hx + z * hz) * sc];
      const c = makeCanvas(Math.round(w * dpr), Math.round(h * dpr)), g = c.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = 'rgb(74, 146, 54)';
      g.fillRect(0, 0, w, h);
      // the splat: pixel (X, Y) is world (B.x0 + X·px, B.z0 + Y·px)
      const B = M.bounds, sp = vis.splatCanvas, px = (B.x1 - B.x0) / sp.width;
      g.save();
      g.transform(rx * sc * px, -hx * sc * px, rz * sc * px, -hz * sc * px,
        T.ox + (B.x0 * rx + B.z0 * rz) * sc, T.oy - (B.x0 * hx + B.z0 * hz) * sc);
      g.imageSmoothingQuality = 'high';
      g.drawImage(sp, 0, 0);
      g.restore();
      // water on top (the splat only has the lake bed), then the trees as dots
      const blobPath = (bl, k, col) => {
        g.fillStyle = col;
        g.beginPath();
        for (let i = 0; i <= 40; i++) { const [x, z] = blobEdge(bl, i / 40 * TAU, k); const [a, b2] = T.at(x, z); if (i) g.lineTo(a, b2); else g.moveTo(a, b2); }
        g.fill();
      };
      for (const wb of M.water) blobPath(wb, 0.97, '#4FB4EE');
      // the green (and an island's bank) back over the water, crisp
      if (M.green.def.island) blobPath(M.green, 1.42, 'rgb(74, 146, 54)');
      blobPath(M.green, M.fringeRho, 'rgb(104, 190, 72)');
      blobPath(M.green, 1, 'rgb(150, 224, 110)');
      for (const bk of M.bunkers) if (bk.greenside) blobPath(bk, 1, 'rgb(236, 213, 155)');
      g.fillStyle = 'rgba(32, 92, 40, 0.9)';
      for (const t of M.trees) {
        const [a, b2] = T.at(t.x, t.z);
        if (a < -4 || a > w + 4 || b2 < -4 || b2 > h + 4) continue;
        g.beginPath(); g.arc(a, b2, Math.max(1.1, t.cr * sc * 0.85), 0, TAU); g.fill();
      }
      miniMap.base = c; miniMap.baseKey = key; miniMap.T = T;
      return c;
    }

    function drawMini() {
      const el = hud.mini;
      if (!M || !vis || !cur || el.classList.contains('gf-off')) return;
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const R = lastRing, b = cur.ball;
      const key = [w, h, dpr, M.index, b.x.toFixed(1), b.z.toFixed(1), R ? R.x.toFixed(1) + ',' + R.z.toFixed(1) : '-'].join('|');
      if (key === miniMap.key) return;
      miniMap.key = key;
      const base = miniBase(w, h, dpr), T = miniMap.T;
      if (el.width !== base.width || el.height !== base.height) { el.width = base.width; el.height = base.height; }
      const g = el.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(base, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [bx, by] = T.at(b.x, b.z);
      // pin
      const [px, py] = T.at(M.pin.x, M.pin.z);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 11); g.stroke();
      g.fillStyle = '#FF5A5F';
      g.beginPath(); g.moveTo(px, py - 11); g.lineTo(px + 8, py - 8.5); g.lineTo(px, py - 6); g.closePath(); g.fill();
      // the aim line to the landing ring
      if (R) {
        const [rx2, ry2] = T.at(R.x, R.z);
        g.setLineDash([2.5, 3]);
        g.strokeStyle = 'rgba(255, 255, 255, 0.95)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(rx2, ry2); g.stroke();
        g.setLineDash([]);
        g.lineWidth = 2.2; g.strokeStyle = '#FFC93C';
        g.beginPath(); g.arc(rx2, ry2, 4.2, 0, TAU); g.stroke();
      }
      // the ball
      g.fillStyle = '#fff'; g.strokeStyle = 'rgba(20, 40, 30, 0.8)'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(bx, by, 3, 0, TAU); g.fill(); g.stroke();
    }

    function report(text, seconds) {
      hud.report.innerHTML = text;
      hud.report.classList.remove('gf-off');
      clearTimeout(hud.reportT);
      hud.reportT = setTimeout(() => hud.report.classList.add('gf-off'), (seconds || 2.4) * 1000);
    }

    // =============================================================================================
    // Hole building
    // =============================================================================================

    function disposeHole() {
      if (!vis) return;
      if (vis.crowd) vis.crowd.dispose();
      scene.remove(vis.group);
      engine.disposeObject(vis.group);
      vis = null;
    }

    /**
     * The next hole's model, trees and terrain splat, built in small steps between frames (while the
     * scorecard is up) so the curtain between holes never sits frozen on a long build.
     */
    let prep = null;
    const yieldFrame = () => new Promise(r => setTimeout(r, 0));
    function prepareHole(courseIndex) {
      if (prep && prep.index === courseIndex) return prep.promise;
      const job = prep = { index: courseIndex, M: null, canvas: null };
      const live = () => job === prep && ctx.alive;
      job.promise = (async () => {
        await yieldFrame();
        if (!live()) return;
        const m = buildHoleModel(courseIndex);
        await yieldFrame();
        if (!live()) return;
        plantTrees(m);
        const sj = splatJob(m);
        do { await yieldFrame(); if (!live()) return; } while (!sj.step(8));
        job.M = m;
        job.canvas = sj.canvas;
      })().catch(err => { console.warn('[golf] hole prep failed', err); if (prep === job) prep = null; });
      return job.promise;
    }

    function buildHole(courseIndex) {
      disposeHole();
      const ready = prep && prep.index === courseIndex && prep.canvas ? prep : null;
      prep = null;
      if (ready) M = ready.M;
      else { M = buildHoleModel(courseIndex); plantTrees(M); }
      wind = windFor(M, SS.util.rng(ctx.seed * 13 + courseIndex * 7 + 1));
      const group = new THREE.Group();
      group.name = 'hole-' + (courseIndex + 1);
      // terrain
      const splatCanvas = ready ? ready.canvas : paintSplat(M);
      const splat = new THREE.CanvasTexture(splatCanvas);
      splat.colorSpace = THREE.SRGBColorSpace;
      splat.flipY = false;
      splat.anisotropy = 8;
      splat.generateMipmaps = true;
      const terrain = new THREE.Mesh(terrainGeometry(THREE, M), terrainMaterial(THREE, splat, detailTex));
      terrain.receiveShadow = true;
      terrain.name = 'terrain';
      group.add(terrain);
      // water
      if (M.water.length) {
        const geos = M.water.map(w => blobDisc(THREE, w, w.level, 8, 64, 9));
        const water = new THREE.Mesh(world.mergeGeometries(geos), waterMat);
        water.receiveShadow = true;
        water.name = 'water';
        group.add(water);
      }
      // trees (instanced per kind)
      // trees: instanced per kind; the backdrop woods cast no shadow (keeps the shadow pass light)
      const groups = {};
      for (const t of M.trees) (groups[t.kind + (t.back ? '-back' : '')] = groups[t.kind + (t.back ? '-back' : '')] || []).push(t);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
      const trng = SS.util.rng(M.seed + 77);
      for (const key of Object.keys(groups)) {
        const list = groups[key];
        const im = new THREE.InstancedMesh(treeGeos[list[0].kind], treeMat, list.length);
        list.forEach((t, i) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rot);
          sc.set(t.s, t.s * trng.range(0.92, 1.1), t.s);
          pp.set(t.x, t.y - 0.15, t.z);
          im.setMatrixAt(i, m4.compose(pp, q, sc));
          const k = trng.range(0.88, 1.08);
          im.setColorAt(i, col.setRGB(k * trng.range(0.95, 1.05), k, k * trng.range(0.92, 1.02)));
        });
        im.castShadow = !list[0].back;
        im.computeBoundingSphere();
        group.add(im);
      }
      // props: tee markers, OB stakes, yardage posts, cup
      group.add(buildProps());
      // flag
      const flag = buildFlag(courseIndex + 1);
      group.add(flag.group, flag.mark);
      // green slope arrows
      const slope = buildSlopeArrows();
      group.add(slope.mesh);
      // map view: the green highlighted so it pops from the fairway
      const mapGreen = new THREE.Mesh(blobDisc(THREE, M.green, M.greenH + 1, 3, 48, 10),
        new THREE.MeshBasicMaterial({ color: 0xD9FFC4, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, fog: false }));
      mapGreen.renderOrder = 2;
      mapGreen.visible = false;
      group.add(mapGreen);
      scene.add(group);
      // gallery behind the green
      const crowd = buildGallery();
      vis = { group, flag, slope, crowd, mapGreen, splatCanvas };
      miniMap.key = '';
      miniMap.base = null;
      // scenery follows the hole
      for (const o of envMovers) o.position.set(M.center.x, 0, M.center.z);
      if (windLoop) windLoop.setVolume(clamp(wind.speed / 6, 0, 1) * 0.35, 0.8);
      refreshWind();
    }

    function groundPin() { return heightAt(M, M.pin.x, M.pin.z); }

    function buildProps() {
      const parts = [];
      const add = (g, color, x, y, z, ry = 0) => { world.paint(g, color); if (ry) g.rotateY(ry); g.translate(x, y, z); parts.push(g); };
      // tee markers
      const t = M.tee.dir;
      for (const sd of [-1, 1]) {
        const x = M.tee.x + t[0] * 1.5 - t[1] * 3.2 * sd, z = M.tee.z + t[1] * 1.5 + t[0] * 3.2 * sd;
        add(new THREE.SphereGeometry(0.16, 12, 8), 0x2F8CFF, x, heightAt(M, x, z) + 0.12, z);
      }
      // OB stakes
      const stake = side => {
        for (let s = -20; s < M.L + 50; s += 14) {
          const F = M.frameAt(s);
          const d = side < 0 ? -M.ob.left : M.ob.right;
          const x = F.x - F.tz * d, z = F.z + F.tx * d;
          if (surfaceAt(M, x, z) === 'water') continue;
          const y = heightAt(M, x, z);
          add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), 0xFFFFFF, x, y + 0.5, z);
          add(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 6), 0x2B3446, x, y + 1.02, z);
        }
      };
      stake(-1);
      stake(1);
      // yardage posts (from the green centre): red 100, white 150, blue 200
      for (const [dist, color] of [[100, 0xFF5A5F], [150, 0xFFFFFF], [200, 0x2F8CFF]]) {
        const s = M.L - dist;
        if (s < 40) continue;
        const hw = fairwayHalf(M, s, -1);
        const F = M.frameAt(s);
        const d = -(Math.max(hw, 10) + 1.5);
        const x = F.x - F.tz * d, z = F.z + F.tx * d;
        const y = heightAt(M, x, z);
        add(new THREE.CylinderGeometry(0.07, 0.08, 0.7, 8), color, x, y + 0.35, z);
        add(new THREE.SphereGeometry(0.09, 8, 6), color, x, y + 0.72, z);
      }
      // cup: dark hole with a white liner, laid on the green's tangent plane
      const g = groundAt(M, M.pin.x, M.pin.z, { h: 0, gx: 0, gz: 0 });
      const cup = new THREE.CircleGeometry(CUP_R * 0.84, 24);
      world.paint(cup, 0x14261A);
      const liner = new THREE.RingGeometry(CUP_R * 0.84, CUP_R, 24);
      world.paint(liner, 0xF4F7FA);
      const disc = world.mergeGeometries([cup, liner]);
      disc.rotateX(-Math.PI / 2);
      const pos = disc.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getX(i) * g.gx + pos.getZ(i) * g.gz);
      disc.translate(M.pin.x, g.h + 0.012, M.pin.z);
      parts.push(disc);
      const mesh = new THREE.Mesh(world.mergeGeometries(parts), propMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'props';
      return mesh;
    }

    function buildFlag(n) {
      const group = new THREE.Group();
      const h = groundPin();
      group.position.set(M.pin.x, h, M.pin.z);
      const poleGeo = new THREE.CylinderGeometry(0.022, 0.022, 2.4, 8, 6);
      world.paint(poleGeo, (x, y, z, out) => out.set(Math.floor((y + 1.2) / 0.3) % 2 ? 0xFFFFFF : 0xFFC93C));
      poleGeo.translate(0, 1.2, 0);
      const pole = new THREE.Mesh(poleGeo, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 50 }));
      pole.castShadow = true;
      const tex = new THREE.CanvasTexture(flagCanvas(n));
      tex.colorSpace = THREE.SRGBColorSpace;
      const clothGeo = new THREE.PlaneGeometry(0.9, 0.6, 10, 3);
      clothGeo.translate(0.45, 2.08, 0);
      const cloth = new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({ map: tex }));
      cloth.castShadow = true;
      // the back face gets its own mirrored texture so the number reads from both sides
      const texB = tex.clone();
      texB.wrapS = THREE.RepeatWrapping;
      texB.repeat.x = -1;
      texB.offset.x = 1;
      texB.needsUpdate = true;
      const clothB = new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({ map: texB, side: THREE.BackSide }));
      group.add(pole, cloth, clothB);
      const base = Float32Array.from(clothGeo.attributes.position.array);
      const markGeo = new THREE.RingGeometry(0.3, 0.36, 40);
      markGeo.rotateX(-Math.PI / 2);
      const mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false }));
      mark.position.set(M.pin.x, h + 0.03, M.pin.z);
      mark.renderOrder = 4;
      return { group, pole, cloth, base, lift: 0, mark };
    }

    function updateFlag(dt, t) {
      if (!vis) return;
      const f = vis.flag;
      // flutter downwind; lifted out of the cup when the player is putting
      const yaw = Math.atan2(-wind.z, wind.x || 1e-4);
      f.group.rotation.y = U.damp(f.group.rotation.y, yaw, 2, dt);
      // the flag stays in for long putts (a target you can see) and comes out for short ones
      const want = cur && isPutt() && distToPin() < 4 && phase !== 'holed' && phase !== 'card' ? 1 : 0;
      f.lift = U.damp(f.lift, want, 7, dt);
      f.group.visible = f.lift < 0.6;
      f.mark.material.opacity = f.lift * (0.7 + 0.25 * Math.sin(t * 4));
      f.mark.visible = f.lift > 0.02;
      if (f.mark.visible) f.mark.scale.setScalar(clamp(camera.position.distanceTo(f.mark.position) * 0.03, 0.3, 1.2) / 0.33);
      f.group.position.y = groundPin() + f.lift * 1.5;
      const pos = f.cloth.geometry.attributes.position;
      const amp = 0.04 + Math.min(1, wind.speed / 6) * 0.08, w = 5 + wind.speed * 1.2;
      for (let i = 0; i < pos.count; i++) {
        const bx = f.base[i * 3], by = f.base[i * 3 + 1];
        const k = bx / 0.9;
        pos.setXYZ(i, bx, by - k * k * 0.05 * (1 - Math.min(1, wind.speed / 5)), Math.sin(bx * 7 - t * w) * amp * k);
      }
      pos.needsUpdate = true;
    }

    /** Slope grid: little arrows over the green that flow downhill; faster and warmer where it's steeper. */
    function buildSlopeArrows() {
      const pts = [];
      const G = M.green;
      const g = { h: 0, gx: 0, gz: 0 };
      const step = 0.75;
      for (let x = G.x - G.rmax - 2; x <= G.x + G.rmax + 2; x += step) {
        for (let z = G.z - G.rmax - 2; z <= G.z + G.rmax + 2; z += step) {
          if (blobRho(G, x, z) > M.fringeRho) continue;
          if (Math.hypot(x - M.pin.x, z - M.pin.z) < 0.4) continue;
          groundAt(M, x, z, g);
          const sl = Math.hypot(g.gx, g.gz);
          pts.push({ x, z, h: g.h, gx: g.gx, gz: g.gz, sl, ph: phash(x, z), yaw: Math.atan2(-g.gx, -g.gz) });
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.17, -0.09, 0, -0.07, 0, 0, -0.01, 0, 0, 0.17, 0, 0, -0.01, 0.09, 0, -0.07], 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length));
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      const c = new THREE.Color(), white = new THREE.Color(0xFFFFFF), yellow = new THREE.Color(0xFFD84A), coral = new THREE.Color(0xFF6A5A);
      pts.forEach((p, i) => {
        const k = clamp(p.sl / 0.02, 0, 1);
        if (k < 0.5) c.copy(white).lerp(yellow, k * 2); else c.copy(yellow).lerp(coral, (k - 0.5) * 2);
        mesh.setColorAt(i, c);
      });
      mesh.count = pts.length;
      mesh.visible = false;
      return { mesh, mat, pts, on: 0, step };
    }

    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
    function updateSlope(dt, t) {
      if (!vis) return;
      const S = vis.slope;
      const want = (phase === 'aim' || phase === 'turn' || phase === 'setup') && cur && isPutt() ? 1 : 0;
      S.on = U.damp(S.on, want, 5, dt);
      S.mat.opacity = 0.95 * S.on;
      S.mesh.visible = S.on > 0.02;
      if (!S.mesh.visible) return;
      S.pts.forEach((p, i) => {
        const flat = p.sl < 0.0025;
        const f = flat ? 0.5 : (t * clamp(p.sl * 45, 0.18, 1.3) + p.ph) % 1;
        const dx = -p.gx / (p.sl || 1), dz = -p.gz / (p.sl || 1);
        const off = flat ? 0 : (f - 0.5) * S.step;
        _p.set(p.x + dx * off, p.h - p.sl * off + 0.035, p.z + dz * off);
        _e.set(0, p.yaw, 0);
        _q.setFromEuler(_e);
        const sc = (flat ? 0.45 : Math.min(1, f * 7, (1 - f) * 7)) * (mapOn ? 2.4 : 1);
        _s.set(sc, sc, sc);
        S.mesh.setMatrixAt(i, _m4.compose(_p, _q, _s));
      });
      S.mesh.instanceMatrix.needsUpdate = true;
    }

    function buildGallery() {
      const G = M.green, F = M.greenFrame;
      const tries = [[0, G.rmax + 11], [G.rmax + 10, 4], [-(G.rmax + 10), 4], [G.rmax + 9, -8], [-(G.rmax + 9), -8]];
      const rows = [];
      for (const [lat, along] of tries) {
        const x = G.x - F.tz * lat + F.tx * along, z = G.z + F.tx * lat + F.tz * along;
        const sf = surfaceAt(M, x, z);
        if (sf === 'water' || sf === 'sand' || sf === 'ob') continue;
        let bad = false;
        for (const b of M.bunkers) if (blobRho(b, x, z) < 1.8) bad = true;
        for (const w of M.water) if (blobRho(w, x, z) < 1.3) bad = true;
        if (bad) continue;
        const facing = Math.atan2(G.x - x, G.z - z);
        const y = heightAt(M, x, z);
        rows.push({ x, y, z, length: 9, facing });
        const bx = x + Math.sin(facing) * -1.1, bz = z + Math.cos(facing) * -1.1;
        rows.push({ x: bx, y: heightAt(M, bx, bz) + 0.05, z: bz, length: 8, facing });
        break;
      }
      if (!rows.length) return null;
      return world.crowd(scene, { rows, spacing: 0.9, density: 0.75, seed: M.seed });
    }

    // =============================================================================================
    // Camera
    // =============================================================================================

    const cam = { mode: 'free', lambda: 4, pos: V(0, 9, 14), look: V(0, 0, -40), up: V(0, 1, 0), fov: 50,
      goalPos: V(0, 9, 14), goalLook: V(0, 0, -40), goalFov: 50, cup: null, lift: { key: '', h: 0 } };
    const _gp = V(), _gl = V(), _gu = V(0, 1, 0);
    const camTrees = [];

    /** True when a tree canopy (or trunk) sits on the segment a → b. */
    function canopyOn(ax, ay, az, bx, by, bz) {
      const len = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(2, Math.ceil(len / 1.5));
      for (let i = 1; i < n; i++) {
        const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        for (const tr of treesNear(M, x, z, camTrees)) {
          const dx = x - tr.x, dz = z - tr.z, dy = y - tr.cy;
          if (dx * dx + dy * dy + dz * dz < tr.cr * tr.cr * 1.1) return true;
          if (tr.trunkR > 0 && y < tr.y + tr.trunkH && dx * dx + dz * dz < (tr.trunkR + 0.3) * (tr.trunkR + 0.3)) return true;
        }
      }
      return false;
    }

    /** Extra caddie-camera height that clears canopies between the camera and the ball (cached). */
    function aimLift(b, dx, dz, B, H) {
      const key = b.x.toFixed(1) + ':' + b.z.toFixed(1) + ':' + Math.round(Math.atan2(dx, dz) / DEG) + ':' + Math.round(B) + ':' + Math.round(H);
      if (cam.lift.key === key) return cam.lift.h;
      let add = 0;
      while (add < 18 && canopyOn(b.x - dx * B, b.y + H + add, b.z - dz * B, b.x, b.y + 0.3, b.z)) add += 1.5;
      cam.lift = { key, h: add };
      return add;
    }

    /** Is point Q within (h, v) radians of the view from `from` toward `look`? */
    function inView(from, look, Q, h, v) {
      const lx = look.x - from.x, ly = look.y - from.y, lz = look.z - from.z;
      const qx = Q.x - from.x, qy = Q.y - from.y, qz = Q.z - from.z;
      const la = Math.atan2(lx, lz), qa = Math.atan2(qx, qz);
      const le = Math.atan2(ly, Math.hypot(lx, lz)), qe = Math.atan2(qy, Math.hypot(qx, qz));
      return Math.abs(wrapA(qa - la)) < h && Math.abs(qe - le) < v;
    }

    function fovFor(vFov, minH) {
      const a = engine.size.aspect;
      let v = vFov * DEG;
      if (2 * Math.atan(Math.tan(v / 2) * a) < minH * DEG) v = 2 * Math.atan(Math.tan(minH * DEG / 2) / a);
      return v / DEG;
    }

    function camGoal(dt) {
      const portrait = engine.size.aspect < 0.8;
      let fov = 50;
      _gu.set(0, 1, 0);
      const b = cur ? cur.ball : null;
      if (cam.mode === 'aim' && b) {
        const [dx, dz] = headingDir(cur.aim);
        if (isPutt()) {
          // up and to the side away from the golfer, so the line to the cup is clear of them
          const back = portrait ? 4.4 : 4.2, up = portrait ? 3.2 : 3.0, side = (portrait ? 0.3 : 1) * hand;
          fov = fovFor(46, portrait ? 44 : 58);
          _gp.set(b.x - dx * back - dz * side, b.y + up, b.z - dz * back + dx * side);
          const D = clamp(distToPin(), 0.5, 40);
          const angBall = Math.atan2(up, back), angCup = Math.atan2(_gp.y - groundPin(), back + D);
          // the ball well clear of the bottom HUD row (higher still on short, wide screens)
          const pitch = Math.max(angCup - 0.04, angBall - fov * DEG * (engine.size.aspect > 1.6 ? 0.28 : 0.36));
          _gl.set(_gp.x + dx * Math.cos(pitch) * 10, _gp.y - Math.sin(pitch) * 10, _gp.z + dz * Math.cos(pitch) * 10);
        } else {
          // caddie view: the ball low on screen and the landing ring well up it, from high enough
          // that the ground around the landing spot has some depth to it
          fov = fovFor(50, portrait ? 44 : 60);
          const vf = fov * DEG;
          const full = ringInfo && ringInfo.dist != null;
          const D = clamp(full ? ringInfo.dist : 60, 20, 240);
          const drop = full ? b.y - ringInfo.y : 0;
          const B = (portrait ? 8 : 7) + D * 0.03;
          const sep = vf * lerp(0.36, portrait ? 0.56 : 0.55, clamp((D - 30) / 150, 0, 1));
          const gap = H => Math.atan(H / B) - Math.atan((H + drop) / (B + D)) - sep;
          let lo = 1.5, hi = Math.max(2, Math.sqrt(B * (B + D)));
          if (gap(hi) < 0) lo = hi;
          for (let k = 0; k < 22 && hi - lo > 0.05; k++) { const m = (lo + hi) / 2; if (gap(m) > 0) hi = m; else lo = m; }
          let H = clamp(lo, 3, 48);
          H += aimLift(b, dx, dz, B, H);                         // rise over canopies in the way
          _gp.set(b.x - dx * B, b.y + H, b.z - dz * B);
          // the swing view: while pulling back, swoop in down the line behind the golfer and the ball (a
          // touch off it, away from the golfer, on wide screens) so the backswing that follows the
          // finger fills a good share of the screen. The ball stays put on screen all the way in.
          const e = sstep(0, 1, clamp(gest.pull, 0, 1));
          let frac = portrait ? 0.36 : 0.33;
          if (e > 0.001) {
            const gp = golfers[cur.p].pal.root.position;
            const mx = (b.x + gp.x) / 2, mz = (b.z + gp.z) / 2;
            const Bc = portrait ? 4.4 : 4.1, Hc = portrait ? 2.6 : 2.1, lat = (portrait ? 0 : 0.5) * hand;
            _gp.x = lerp(_gp.x, mx - dx * Bc - dz * lat, e);
            _gp.y = lerp(_gp.y, b.y + Hc, e);
            _gp.z = lerp(_gp.z, mz - dz * Bc + dx * lat, e);
            frac = lerp(frac, portrait ? 0.36 : 0.34, e);
          }
          const hb = Math.max(0.5, (b.x - _gp.x) * dx + (b.z - _gp.z) * dz);
          const pitch = Math.atan((_gp.y - b.y) / hb) - vf * frac;
          _gl.set(_gp.x + dx * Math.cos(pitch) * 30, _gp.y - Math.sin(pitch) * 30, _gp.z + dz * Math.cos(pitch) * 30);
        }
      } else if (cam.mode === 'map' && b) {
        const [hx, hz] = norm2(M.pin.x - M.tee.x, M.pin.z - M.tee.z);
        const land = engine.size.aspect > 1;
        // extents in the hole frame (u along the hole, v across): the hole, or on a putt the green
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        const acc = (x, z) => { const u = x * hx + z * hz, v = -x * hz + z * hx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); };
        if (isPutt()) {
          const r = M.green.rmax * 1.4;
          acc(M.green.x - r, M.green.z - r); acc(M.green.x + r, M.green.z + r); acc(M.green.x - r, M.green.z + r); acc(M.green.x + r, M.green.z - r);
          acc(b.x, b.z);
          u0 -= 3; u1 += 3; v0 -= 3; v1 += 3;
        } else {
          for (const p of M.pts) acc(p.x, p.z);
          acc(b.x, b.z);
          u0 -= 30; u1 += 30; v0 -= 35; v1 += 35;
        }
        // leave room for the HUD rows at the top and bottom of the screen
        const padK = isPutt() ? 0.25 : 1;
        if (land) { const su = u1 - u0; v0 -= 25 * padK; v1 += 25 * padK; u0 -= su * 0.05; u1 += su * 0.12; } else { u0 -= (u1 - u0) * 0.12; u1 += (u1 - u0) * 0.16; }
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
        const cx = uc * hx - vc * hz, cz = uc * hz + vc * hx;
        const vf = 46 * DEG;
        const hf = 2 * Math.atan(Math.tan(vf / 2) * engine.size.aspect);
        const spanUp = land ? v1 - v0 : u1 - u0, spanSide = land ? u1 - u0 : v1 - v0;
        const h = Math.max(spanUp / 2 / Math.tan(vf / 2), spanSide / 2 / Math.tan(hf / 2)) * 1.06;
        const baseH = isPutt() ? M.greenH : M.meanH;
        _gp.set(cx, baseH + h, cz);
        _gl.set(cx, baseH, cz);
        if (land) _gu.set(hz, 0, -hx); else _gu.set(hx, 0, hz);
        fov = 46;
      } else if (cam.mode === 'react' && cur) {
        // face to face with the golfer for their reaction
        const G = golfers[cur.p], pr = G.pal.root.position, yaw = G.pal.root.rotation.y;
        const dist = portrait ? 3.6 : 3.0;
        _gp.set(pr.x + Math.sin(yaw) * dist, pr.y + 1.25, pr.z + Math.cos(yaw) * dist);
        _gl.set(pr.x, pr.y + 0.85, pr.z);
        fov = fovFor(44, portrait ? 40 : 54);
      } else if (cam.mode === 'puttroll' && play) {
        // stay near the putting view: pan with the ball, drift along a little for long putts
        const P = ball.position, F = play.from, C0 = play.camFrom;
        _gp.set(C0.x + (P.x - F.x) * 0.55, C0.y, C0.z + (P.z - F.z) * 0.55);
        _gl.set(lerp(P.x, M.pin.x, 0.3), P.y, lerp(P.z, M.pin.z, 0.3));
        fov = fovFor(46, portrait ? 44 : 58);
      } else if ((cam.mode === 'follow' || cam.mode === 'land' || cam.mode === 'roll') && play) {
        const P = ball.position;
        const [dx, dz] = play.dir;
        if (cam.mode === 'follow') {
          // chase the ball a steady distance behind it (so it stays a ball, not a speck), rising with
          // it, and lean the view toward where it will come down so the landing area rises into frame
          // (a little off to the side away from the golfer, so the arc of the flight reads)
          const F = play.from, L = play.landPt;
          const along = Math.max(0, (P.x - F.x) * dx + (P.z - F.z) * dz);
          const lag = play.short ? lerp(6, 11, clamp(along / 40, 0, 1)) : lerp(10, 20, clamp(along / 60, 0, 1));
          const base = Math.max(along * 0.5 - (play.short ? 6 : 10), along - lag);
          const off = (play.short ? 1.8 : 3) * hand;
          const cx = F.x + dx * base - dz * off, cz = F.z + dz * base + dx * off;
          const hgt = Math.max(0, P.y - heightAt(M, P.x, P.z));
          _gp.set(cx, Math.max(heightAt(M, cx, cz), P.y - hgt) + (play.short ? 3 : 4.5) + hgt * 0.6, cz);
          const k = play.short ? 0.12 : 0.32 * clamp(along / 50, 0, 1);
          _gl.set(lerp(P.x, L.x, k), lerp(P.y, L.y, k), lerp(P.z, L.z, k));
          fov = fovFor(50, portrait ? 42 : 58);
        } else if (cam.mode === 'land') {
          // beyond and beside the landing spot, looking back: the ring stays low in frame while the
          // ball drops in from above, then the view follows it as it bounces and runs toward us
          const L = play.landPt, sd = play.side * (portrait ? 3 : 6);
          _gp.set(L.x + dx * 12 - dz * sd, L.y + (play.high ? 12 : 5), L.z + dz * 12 + dx * sd);
          const gy = heightAt(M, P.x, P.z);
          fov = fovFor(46, portrait ? 40 : 56);
          if (!play.landed) {
            // lean toward the landing spot, but never so far that the ball (a pushed or pulled shot
            // comes in from the side) slips out of frame: it stays inside ~60% of the half-view
            const vh = fov * DEG / 2, hh = Math.atan(Math.tan(vh) * engine.size.aspect);
            const by = lerp(gy, P.y, 0.4);
            for (const k of [0.55, 0.4, 0.25, 0.1, 0]) {
              _gl.set(lerp(P.x, L.x, k), lerp(by, L.y, k), lerp(P.z, L.z, k));
              if (k === 0 || inView(_gp, _gl, P, hh * 0.6, vh * 0.6)) break;
            }
          } else _gl.set(P.x, lerp(gy, P.y, 0.5), P.z);
        } else {
          // rolling out: close behind the ball, along the way it is running
          const [rx, rz] = play.rollDir;
          _gp.set(P.x - rx * 5, heightAt(M, P.x, P.z) + 2.2, P.z - rz * 5);
          _gl.set(P.x + rx * 3, P.y, P.z + rz * 3);
          fov = fovFor(46, portrait ? 44 : 58);
        }
      } else if (cam.mode === 'cup' && cam.cup) {
        // swing round the celebrating golfer on an arc (never through them or the flagstick)
        const O = cam.cup;
        O.aT += O.dir * 0.12 * dt;
        O.a = U.damp(O.a, O.aT, 1.9, dt);
        fov = fovFor(46, portrait ? 42 : 58);
        // far enough back that both the golfer and the cup fit across a narrow (portrait) frame
        const hf = Math.atan(Math.tan(fov * DEG / 2) * engine.size.aspect);
        const rFit = O.half ? O.half / Math.tan(hf * 0.75) + O.half * 0.3 : 0;
        // fireworks: on a wide (short) frame back off further so the tilt up can keep the golfer in
        const rGoal = Math.max(portrait ? 5.6 : 5, rFit, O.half && O.lookUp && !portrait ? 9 : 0);
        O.r = U.damp(O.r, rGoal, 1.5, dt);
        O.y = U.damp(O.y, 2.3 + (rGoal - 5) * 0.12, 1.5, dt);
        _gp.set(O.cx + Math.sin(O.a) * O.r, O.gy + O.y, O.cz + Math.cos(O.a) * O.r);
        let up = O.lookUp || 0;
        if (O.half && up) {
          // tilt no further than keeps the golfer's feet above the bottom edge
          const dg = Math.max(1, O.r - O.half * 0.4);
          const maxPitch = fov * DEG / 2 - Math.atan(O.y / dg) - 4 * DEG;
          up = clamp(Math.min(up, O.y - 0.8 + O.r * Math.tan(maxPitch)), 0, up);
        }
        O.lift = U.damp(O.lift || 0, up, 2.2, dt);
        _gl.set(O.cx, O.gy + 0.8 + O.lift, O.cz);
      } else if (cam.mode === 'follow' || cam.mode === 'land' || cam.mode === 'roll' || cam.mode === 'puttroll' || cam.mode === 'aim' || cam.mode === 'map') {
        _gp.copy(cam.pos);                // the shot is over: hold the last view until the next move
        _gl.copy(cam.look);
        fov = cam.fov;
      } else {
        _gp.copy(cam.goalPos);
        _gl.copy(cam.goalLook);
        fov = cam.goalFov;
      }
      return fov;
    }

    function updateCamera(dt) {
      const fov = camGoal(dt);
      if (!(isFinite(cam.pos.x) && isFinite(cam.pos.y) && isFinite(cam.pos.z) && isFinite(cam.look.x))) { cam.pos.copy(_gp); cam.look.copy(_gl); }
      // the swing swoop keeps up with the finger
      const lam = cam.mode === 'aim' && gest.pull > 0.01 && !isPutt() ? Math.max(cam.lambda, 6) : cam.lambda;
      U.dampVec3(cam.pos, _gp, lam, dt);
      U.dampVec3(cam.look, _gl, lam * (cam.mode === 'land' ? 2.8 : 1.35), dt);   // the landing view keeps up with a dropping ball
      U.dampVec3(cam.up, _gu, lam, dt);
      cam.fov = U.damp(cam.fov, fov, lam, dt);
      if (M && cam.mode !== 'map') {
        // never inside the ground, the water or a tree canopy
        const floor = Math.max(heightAt(M, cam.pos.x, cam.pos.z), waterLevelAt(M, cam.pos.x, cam.pos.z));
        const gy = floor + (cam.mode === 'aim' && isPutt() ? 0.6 : cam.mode === 'roll' || cam.mode === 'cup' ? 0.5 : 1.1);
        if (cam.pos.y < gy) cam.pos.y = gy;
        for (const tr of treesNear(M, cam.pos.x, cam.pos.z, camTrees)) {
          // keep clear of a capsule around the whole tree (trunk to crown), pushing sideways
          const top = tr.cy + tr.cr * 0.8;
          if (cam.pos.y > top + 1.3) continue;
          const dx = cam.pos.x - tr.x, dz = cam.pos.z - tr.z;
          const d = Math.sqrt(dx * dx + dz * dz), R = tr.cr * 1.15 + 1.3;
          if (d < R) {
            const k = R / (d || 1);
            cam.pos.x = tr.x + (d ? dx * k : R); cam.pos.z = tr.z + dz * k;
          }
        }
        // and never inside the golfer
        if (cur && cam.mode !== 'react') {
          const pr = golfers[cur.p].pal.root.position;
          const dx = cam.pos.x - pr.x, dz = cam.pos.z - pr.z, d = Math.hypot(dx, dz);
          if (d < 1.3 && cam.pos.y < pr.y + 2.2) { const k = 1.3 / (d || 1); cam.pos.x = pr.x + (d ? dx * k : 1.3); cam.pos.z = pr.z + dz * k; }
        }
      }
      camera.position.copy(cam.pos);
      camera.up.copy(cam.up).normalize();
      camera.lookAt(cam.look);
      // high over the map the near plane moves out, or shorelines z-fight with the water
      const near = cam.mode === 'map' && M ? clamp((cam.pos.y - Math.max(0, heightAt(M, cam.pos.x, cam.pos.z))) * 0.01, 0.08, 4) : 0.08;
      if (Math.abs(camera.fov - cam.fov) > 1e-3 || camera.aspect !== engine.size.aspect || Math.abs(camera.near - near) > 0.02) {
        camera.fov = cam.fov;
        camera.aspect = engine.size.aspect;
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      const fogFar = cam.mode === 'map' ? 2400 : 1150;
      if (scene.fog && scene.fog.far !== fogFar) { scene.fog.far = U.damp(scene.fog.far, fogFar, 6, dt); if (Math.abs(scene.fog.far - fogFar) < 1) scene.fog.far = fogFar; }
    }

    function setCam(mode, lambda, snap) {
      cam.mode = mode;
      cam.lambda = lambda;
      if (snap) {
        cam.fov = camGoal(0);
        cam.pos.copy(_gp); cam.look.copy(_gl); cam.up.copy(_gu);
      }
    }

    // =============================================================================================
    // Golfer: address geometry, swing poses, club
    // =============================================================================================

    function addressGeom(ci) {
      const c = CLUBS[ci];
      const putt = !!c.putter;
      const handY = putt ? 0.56 : 0.62, handZ = putt ? 0.25 : 0.3;
      const phi = Math.acos(clamp((handY - 0.04) / c.len, 0.2, 1));
      const C = V(0, putt ? 0.98 : 1.02, putt ? 0.08 : 0.15);
      const dh = V(0, handY - C.y, handZ - C.z);
      const ra = dh.length();
      dh.multiplyScalar(1 / ra);
      return { putt, handY, handZ, phi, ra, dh, C, ballZ: handZ + c.len * Math.sin(phi), stance: putt ? 0.3 : c.id === 'D' ? 0.85 : 0.6 };
    }

    const _grip = V(), _D = V(), _down = V(), _side = V(), _tr = V();
    function golferPose(G, alpha, lambda) {
      const A = G.geom;
      _side.set(-hand, 0, 0);
      _grip.copy(A.C).addScaledVector(A.dh, A.ra * Math.cos(alpha)).addScaledVector(_side, A.ra * Math.sin(alpha));
      const beta = A.putt ? alpha : alpha * (alpha > 0 ? 1.75 : 1.5);
      _down.set(0, -Math.cos(A.phi), Math.sin(A.phi));
      _D.copy(_down).multiplyScalar(Math.cos(beta)).addScaledVector(_side, Math.sin(beta)).normalize();
      _tr.copy(_grip).addScaledVector(_D, 0.075);
      const lead = _grip.clone(), trail = _tr.clone();
      const twist = clamp(-alpha * (alpha > 0 ? 0.5 : 0.62) * hand, -1.25, 1.25);
      G.pal.pose({
        handL: hand > 0 ? lead : trail, handR: hand > 0 ? trail : lead,
        twist, lean: A.putt ? 0.42 : 0.3, crouch: A.putt ? 0.3 : 0.2, stance: A.stance, tilt: 0,
      }, { lambda });
      G.dTarget.copy(_D);
      G.lambda = lambda;
      G.posing = true;
    }

    function syncClub(G, dt) {
      const leadHand = hand > 0 ? G.pal.parts.handL : G.pal.parts.handR;
      G.club.group.position.copy(leadHand.position);
      if (!G.posing) G.dTarget.set(0.12 * hand, -0.93, 0.35).normalize();
      if (G.lambda === Infinity) G.dShown.copy(G.dTarget);
      else U.dampVec3(G.dShown, G.dTarget, G.posing ? G.lambda : 8, dt).normalize();
      G.club.group.quaternion.setFromUnitVectors(DOWN_V, G.dShown);
    }

    function showGolfer(p) {
      golfers.forEach((G, i) => { G.pal.root.visible = i === p; G.shadow.visible = i === p; });
    }

    function placeGolfer() {
      if (!cur) return;
      const G = golfers[cur.p], b = cur.ball, A = G.geom;
      const yaw = (hand > 0 ? Math.PI / 2 : -Math.PI / 2) - cur.aim;
      const lx = CLUBS[cur.club].id === 'D' ? 0.07 * hand : 0;
      const rx = b.x - (Math.cos(yaw) * lx + Math.sin(yaw) * A.ballZ);
      const rz = b.z - (-Math.sin(yaw) * lx + Math.cos(yaw) * A.ballZ);
      const ry = heightAt(M, rx, rz);
      G.pal.root.position.set(rx, ry, rz);
      G.pal.setFacing(yaw);
      G.shadow.position.set(rx, ry + 0.02, rz);
    }

    function setClub(ci) {
      if (!cur) return;
      const G = golfers[cur.p];
      const wasPutt = isPutt();
      cur.club = ci;
      G.geom = addressGeom(ci);
      G.club.set(ci);
      if (wasPutt !== isPutt()) {
        const a = defaultAim(cur.ball, ci);
        cur.aim = a != null ? a : headingTo(cur.ball.x, cur.ball.z, M.pin.x, M.pin.z);
      }
      placeGolfer();
      golferPose(G, 0, 30);
      ringDirty = true;
      refreshHud();
    }

    function cycleClub(dir) {
      const list = clubsFor(cur.ball.surf);
      const k = list.indexOf(cur.club);
      setClub(list[(k + dir + list.length) % list.length]);
    }

    function updateSwing(dt) {
      const s = swing;
      if (!s) return;
      s.t += dt;
      let a, t = s.t;
      if (t < s.back) a = lerp(s.start, s.from, U.ease.inOutQuad(t / s.back));
      else if ((t -= s.back) < s.down) { const k = t / s.down; a = s.from * (1 - k * k * (1.6 - 0.6 * k)); }
      else {
        if (!s.hit) { s.hit = true; s.impact(); }
        t -= s.down;
        a = t < s.thru ? s.finish * U.ease.outCubic(t / s.thru) : s.finish;
        if (t > s.thru + s.hold) {
          swing = null;
          s.G.pal.releasePose(0.45);
          s.G.posing = false;
          return;
        }
      }
      s.G.shown = a;
      golferPose(s.G, a, Infinity);
    }

    function runSwing(G, inp) {
      const putt = CLUBS[inp.club].putter;
      const top = (putt ? ALPHA_PUTT : ALPHA_TOP) * clamp(inp.power, 0.12, 1.1);
      return new Promise(resolve => {
        swing = {
          G, t: 0, start: G.shown, from: top, back: G.shown < top * 0.85 ? (putt ? 0.35 : 0.5) : 0,
          down: putt ? 0.24 : 0.15 + 0.05 * (1 - clamp(inp.power, 0, 1)),
          thru: putt ? 0.32 : 0.34, hold: putt ? 0.7 : 1.2,
          finish: putt ? -ALPHA_PUTT * clamp(inp.power + 0.25, 0.4, 1) : -2.25 * (0.5 + 0.5 * Math.min(1, inp.power)),
          impact: resolve, hit: false,
        };
      });
    }

    // =============================================================================================
    // Aim, ring, dots
    // =============================================================================================

    function isPutt() { return !!(cur && CLUBS[cur.club].putter); }
    function distToPin() { return cur ? Math.hypot(M.pin.x - cur.ball.x, M.pin.z - cur.ball.z) : 0; }
    function pulling() { return press.mode === 'swing' || !!keyCharge; }

    /** First tree a full, straight swing on heading psi meets before it lands (or null). */
    function treeOnLine(b, ci, psi) {
      const { L } = launchFor(M, b, { club: ci, aim: psi, power: 1, flick: 0, curve: 0, tempo: 1 }, null);
      const res = simulateShot(M, L, { stopAtLand: true });
      return res.events.find(e => e.type === 'tree' || e.type === 'trunk') || null;
    }

    /** At the pin when it is in reach, else down the centre line; steered off any trees in the way. */
    function defaultAim(b, ci) {
      const toPin = headingTo(b.x, b.z, M.pin.x, M.pin.z);
      const c = CLUBS[ci];
      if (c.putter) return toPin;
      const d = Math.hypot(M.pin.x - b.x, M.pin.z - b.z);
      const reach = clubReach(ci, b.surf, d);
      const pr = M.project(b.x, b.z, { s: 0, d: 0 });
      const F = M.frameAt(Math.min(M.L, pr.s + Math.min(reach, d) * 0.92));
      const centre = headingTo(b.x, b.z, F.x, F.z);
      const base = d <= reach * 1.08 ? toPin : centre;
      if (!treeOnLine(b, ci, base)) return base;
      const sgn = Math.sign(wrapA(centre - base)) || (pr.d > 0 ? -1 : 1);
      for (let a = 2; a <= 30; a += 2) {
        for (const sd of [sgn, -sgn]) {
          const h = base + sd * a * DEG;
          if (!treeOnLine(b, ci, h)) return h;
        }
      }
      return null;
    }

    /** Suggested club and aim: the club that reaches, or a shorter one when trees block every line. */
    function suggestShot(b) {
      const ci = suggestClub(M, b);
      if (CLUBS[ci].putter) return { club: ci, aim: defaultAim(b, ci) };
      const list = clubsFor(b.surf).filter(i => !CLUBS[i].putter);
      for (let k = list.indexOf(ci); k >= 0 && k < list.length && k <= list.indexOf(ci) + 3; k++) {
        const aim = defaultAim(b, list[k]);
        if (aim != null) return { club: list[k], aim };
      }
      return { club: ci, aim: headingTo(b.x, b.z, M.pin.x, M.pin.z) };
    }

    function setAim(psi) {
      if (!cur) return;
      cur.aim = wrapA(psi);
      placeGolfer();
      ringDirty = true;
    }
    function nudgeAim(d) { setAim(cur.aim + d); }

    /**
     * Where a straight swing at `power` lands in calm air, plus (with the wind ring on) where the
     * wind takes it: { x, y, z, dist, along, ghost }.
     */
    function ringAt(power) {
      const inp = { club: cur.club, aim: cur.aim, power, flick: 0, curve: 0, tempo: 1 };
      const R = landPoint(M, cur.ball, inp);
      R.ghost = null;
      if (RULES.windRing && wind.speed >= 0.5) {
        const G = landPoint(M, cur.ball, inp, wind);
        if (Math.hypot(G.x - R.x, G.z - R.z) >= 1.5) R.ghost = G;
      }
      return R;
    }

    /** The ring while pulling: it follows the power (half-percent steps, cached per ball, club and aim). */
    const liveRing = { key: '', cache: new Map() };
    function liveRingFor(power) {
      const key = cur.club + ':' + cur.aim + ':' + cur.ball.x + ':' + cur.ball.z;
      if (liveRing.key !== key) { liveRing.key = key; liveRing.cache.clear(); }
      const q = Math.round(power * 200);
      let R = liveRing.cache.get(q);
      if (!R) { R = ringAt(q / 200); liveRing.cache.set(q, R); }
      return R;
    }

    /** Landing ring (full swing, calm, ignoring trees), the first tree on that line, and the putt preview. */
    function computeRing() {
      ringInfo = null;
      if (!cur) return;
      const b = cur.ball;
      if (isPutt()) {
        // honest preview: the real roll for the first stretch of the putt at the meter's pace
        const d = distToPin(), scale = puttScale(d), pp = idealPower();
        const { L } = launchFor(M, b, { club: cur.club, aim: cur.aim, power: clamp(pp > 0 ? pp : d / scale, 0.02, 1), flick: 0, scale }, null);
        const res = simulateShot(M, L, { record: true, noCup: true });
        const pts = [], show = Math.max(0.9, d * (d < 3 ? 0.5 : 0.38) * (RULES.puttMark ? 1 : 0.7));
        let run = 0, next = 0.25;
        for (let i = 1; i <= res.n && run < show; i++) {
          const a = res.path, x0 = a[i * 3 - 3], z0 = a[i * 3 - 1], x1 = a[i * 3], z1 = a[i * 3 + 2];
          run += Math.hypot(x1 - x0, z1 - z0);
          if (run >= next) { pts.push([x1, a[i * 3 + 1], z1]); next += 0.3; }
        }
        ringInfo = { putt: true, pts };
        return;
      }
      ringInfo = ringAt(1);
      ringInfo.block = null;
      const hit = treeOnLine(b, cur.club, cur.aim);
      if (hit) ringInfo.block = { x: hit.x, y: hit.y, z: hit.z, dist: Math.hypot(hit.x - b.x, hit.z - b.z) };
    }

    /** Places a screen-space tag above a world point; returns its box (or null when off screen). */
    const _tv = V();
    let tagTop = 0;
    const tagAvoid = [];     // HUD columns the tags keep clear of (read once per frame)
    const tagHits = (r, sx, sy, w, h) => !(sx + w / 2 < r.left - 4 || sx - w / 2 > r.right + 4 || sy < r.top - 4 || sy - h > r.bottom + 4);
    function placeTag(el, x, y, z, dx, dy) {
      const p = engine.project(_tv.set(x, y, z), camera);
      if (!p.visible) { el.classList.add('gf-off'); return null; }
      el.classList.remove('gf-off');
      const w = el.offsetWidth, h = el.offsetHeight, W = engine.size.w;
      let sx = clamp(p.x + (dx || 0), w / 2 + 6, W - w / 2 - 6), sy = Math.max(p.y + (dy || 0), tagTop + h);
      // step off a side column (player / distance / lie chips, wind dial, map): down below it or
      // sideways past it, whichever is the smaller move
      for (const r of tagAvoid) {
        if (!tagHits(r, sx, sy, w, h)) continue;
        const leftCol = r.left + r.right < W;
        const down = r.bottom + 6 + h - sy;
        const side = leftCol ? r.right + 6 + w / 2 - sx : sx - (r.left - 6 - w / 2);
        const sideOk = leftCol ? r.right + 6 + w <= W - 6 : r.left - 6 - w >= 6;
        if (sideOk && side < down) sx = leftCol ? r.right + 6 + w / 2 : r.left - 6 - w / 2;
        else sy += down;
      }
      el.style.transform = 'translate(' + Math.round(sx - w / 2) + 'px,' + Math.round(sy - h) + 'px)';
      return { x: sx, y: sy, w, h };
    }

    const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = V(), _ds = V(), _dc = new THREE.Color();
    const DOT_WHITE = new THREE.Color(0xFFFFFF), DOT_FAINT = new THREE.Color(0xD6EBDD), DOT_BLOCK = new THREE.Color(0xFF5A5F), DOT_WIND = new THREE.Color(0x5CC2FF);
    function updateAimVisuals(dt, t) {
      const show = (phase === 'aim' || phase === 'turn') && !!cur;
      const camP = camera.position;
      const tagsOn = (show || phase === 'setup') && !!cur && !isPutt() && cam.mode !== 'react';
      dots.visible = show;
      if (show && ringDirty) { computeRing(); ringDirty = false; refreshClubCarry(); }
      const full = show && !isPutt() && !!ringInfo && !ringInfo.putt;
      ring.visible = ringPulse.visible = target.visible = full;
      // Beginner: while pulling, the ring (and the wind ring) slide out with the power. Otherwise the
      // ring stays on a full swing and the meter says what that is: the partial swing is your call.
      const pullNow = full && gest.pull > 0.02 && (press.mode === 'swing' || !!keyCharge || autoplay);
      const live = pullNow && RULES.liveRing;
      const R = full ? (live ? liveRingFor(clamp(gest.pull, 0.02, 1.1)) : ringInfo) : null;
      lastRing = R;
      // Full 9 reads the carry off the meter too, but the ring stays put and the pin isn't marked
      const carryTxt = !pullNow ? '' : RULES.carryLive ? 'Carry ' + Math.round((live ? R : liveRingFor(clamp(gest.pull, 0.02, 1.1))).along) + ' m' : 'Full ' + Math.round(ringInfo.dist) + ' m';
      if (hud.gCarry.textContent !== carryTxt) hud.gCarry.textContent = carryTxt;
      const ghost = R && R.ghost;
      ghostRing.visible = !!ghost;
      // world → screen scale for constant-size marks
      const pxW = 2 * Math.tan(camera.fov * DEG / 2) / engine.size.h;
      if (show || phase === 'setup') {
        tagTop = hud.top.getBoundingClientRect().bottom + 6;
        tagAvoid.length = 0;
        for (const el of [hud.left, hud.windBox, hud.mini, hud.mapBtn, hud.gauge]) {
          if (el.classList.contains('gf-off') || el.classList.contains('gf-tuck')) continue;
          const r = (el === hud.gauge ? hud.gVal : el).getBoundingClientRect();
          if (r.width > 0) tagAvoid.push(r);
        }
      }
      let landBox = null;
      if (show) {
        const b = cur.ball;
        const [dx, dz] = headingDir(cur.aim);
        let n = 0;
        const put = (x, y, z, rpx, col) => {
          const cd = Math.hypot(x - camP.x, y - camP.y, z - camP.z);
          const sc = cd * pxW * rpx;
          _dp.set(x, y, z); _ds.set(sc, 1, sc);
          dots.setMatrixAt(n, _dm.compose(_dp, _dq, _ds));
          dots.setColorAt(n, col);
          n++;
        };
        if (isPutt()) {
          const P = ringInfo && ringInfo.putt ? ringInfo.pts : [];
          for (const q of P) if (n < DOTS) put(q[0], heightAt(M, q[0], q[2]) + 0.02, q[2], 4.2, DOT_WHITE);
          // the straight aim line on to the cup's distance (no break shown)
          const d = distToPin();
          for (let s = (P.length + 1) * 0.3 + 0.3; s < d && n < DOTS; s += 0.45) {
            const x = b.x + dx * s, z = b.z + dz * s;
            put(x, heightAt(M, x, z) + 0.02, z, 2.6, DOT_FAINT);
          }
          dotMat.opacity = 0.9;
        } else {
          const len = R ? R.dist : 60;
          const blk = ringInfo && ringInfo.block ? ringInfo.block.dist : Infinity;
          for (let i = 0; i < 28; i++) {
            const s = len * (i + 1) / 29;
            const x = b.x + dx * s, z = b.z + dz * s;
            put(x, heightAt(M, x, z) + 0.12, z, mapOn ? 3 : 6, s > blk ? DOT_BLOCK : DOT_WHITE);
          }
          // the wind's drift: a short blue trail from the ring to where the wind takes the ball
          if (ghost) {
            for (let i = 1; i <= 5; i++) {
              const x = lerp(R.x, ghost.x, i / 6), z = lerp(R.z, ghost.z, i / 6);
              put(x, Math.max(heightAt(M, x, z), lerp(R.y, ghost.y, i / 6)) + 0.14, z, mapOn ? 3 : 5, DOT_WIND);
            }
          }
          dotMat.opacity = 0.85;
        }
        dots.count = n;
        dots.instanceMatrix.needsUpdate = true;
        if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
        if (full) {
          const cd = camP.distanceTo(_dp.set(R.x, R.y, R.z));
          const r = Math.max(clamp(cd * (mapOn ? 0.014 : 0.032), 1.2, 40), cd * pxW * (mapOn ? 18 : 0));
          ring.position.set(R.x, R.y + 0.25, R.z);
          ring.scale.setScalar(r);
          const f = (t * 0.8) % 1;
          ringPulse.position.copy(ring.position);
          ringPulse.scale.setScalar(r * (0.35 + 0.65 * f));
          ringPulseMat.opacity = 0.85 * (1 - f);
          const ts = clamp(cd * 0.08, 0.8, 60) * (mapOn ? 0.6 : 1);
          target.position.set(R.x, R.y + 0.1, R.z);
          target.scale.set(ts * 0.667, ts, 1);
          const lt = Math.round(R.dist) + ' m';
          if (hud.landTxt.textContent !== lt) hud.landTxt.textContent = lt;
          landBox = mapOn ? placeTag(hud.landTag, R.x, R.y, R.z, 0, -r / (cd * pxW) - 4)
            : placeTag(hud.landTag, R.x, R.y + 0.1 + ts * 0.98, R.z, 0, -4);
          if (ghost) {
            ghostRing.position.set(ghost.x, ghost.y + 0.22, ghost.z);
            ghostRing.scale.setScalar(r * 0.85);
            // the wind icon sits beside the blue ring, on the side it drifted to
            const gx = engine.project(_tv.set(ghost.x, ghost.y, ghost.z), camera).x, rx = engine.project(_dp.set(R.x, R.y, R.z), camera).x;
            placeTag(hud.windTag, ghost.x, ghost.y + 0.2, ghost.z, (gx >= rx - 1 ? 1 : -1) * (r * 0.85 / (cd * pxW) + 16), 11);
          }
        }
      }
      if (!full) hud.landTag.classList.add('gf-off');
      if (!ghost) hud.windTag.classList.add('gf-off');
      const blk = full && ringInfo.block && !mapOn;
      if (blk) placeTag(hud.blockTag, ringInfo.block.x, ringInfo.block.y + 0.6, ringInfo.block.z, 0, -6);
      else hud.blockTag.classList.add('gf-off');
      // pin distance on the flagstick, pushed clear of the landing tag
      if (tagsOn) {
        hud.pinTxt.textContent = Math.round(distToPin()) + ' m';
        const top = groundPin() + 2.45;
        // on the map the tag sits beside the green, not on it
        const gPx = mapOn ? M.green.rmax / (Math.max(1, camP.distanceTo(_tv.set(M.pin.x, top, M.pin.z))) * pxW) : 0;
        let box = mapOn ? placeTag(hud.pinTag, M.pin.x, top, M.pin.z, hud.pinTag.offsetWidth / 2 + gPx + 8, 12) : placeTag(hud.pinTag, M.pin.x, top, M.pin.z, 0, -4);
        if (box && landBox && Math.abs(box.x - landBox.x) < (box.w + landBox.w) / 2 + 4 && Math.abs(box.y - landBox.y) < Math.max(box.h, landBox.h) + 4) {
          // stack it above the landing tag, or beside it when there's no room under the top HUD
          const up = landBox.y - landBox.h - 6;
          let x = box.x, y = up;
          const blocked = (x2, y2) => y2 - box.h < tagTop || tagAvoid.some(r => tagHits(r, x2, y2, box.w, box.h));
          if (blocked(x, y)) {
            y = landBox.y;
            x = landBox.x + (landBox.w + box.w) / 2 + 6;
            if (x + box.w / 2 > engine.size.w - 6 || blocked(x, y)) x = landBox.x - (landBox.w + box.w) / 2 - 6;
            if (x - box.w / 2 < 6 || blocked(x, y)) { x = landBox.x; y = landBox.y + box.h + 6; }
          }
          hud.pinTag.style.transform = 'translate(' + Math.round(x - box.w / 2) + 'px,' + Math.round(y - box.h) + 'px)';
        }
      } else hud.pinTag.classList.add('gf-off');
    }

    // =============================================================================================
    // Input: drag to aim · pull down + flick up to swing
    // =============================================================================================

    const press = { mode: null, sx: 0, sy: 0, scale: 200, aim0: 0, samples: [], bottom: null, flick: null, power: 0 };
    const gest = { pull: 0 };

    /**
     * Pixels of pull for 100% power: the same wherever the press starts, so it can be learned. Short
     * landscape screens get a longer share of their height so power stays as fine as in portrait.
     */
    function pullScale() {
      const sz = engine.size;
      return clamp(sz.h * (sz.aspect > 1 && sz.h <= 520 ? 0.44 : 0.3), 110, 260);
    }

    /** The shortest upward flick that swings (shorter lifts cancel: a thumb drifting as it lets go). */
    function minFlick() { return clamp(0.13 * shortSide(), 40, 90); }

    /**
     * Ease-off rules: a finger raised more than EASE_MIN px (less is just a thumb settling, ~3%) that
     * sits still (within STILL_PX) for EASE_HOLD ms sets a new, shallower bottom.
     */
    const EASE_HOLD = 120, EASE_MIN = 8, STILL_PX = 3;
    /** A flick that stops without the finger lifting still swings if it was at least this fast (short sides / s). */
    const STALL_V = 1.25;

    /** Median spacing (ms) of the latest samples: 16 on a 60 Hz screen, 1 on a gaming mouse. */
    function sampleGap(samples) {
      const k = samples.length;
      if (k < 3) return 16;
      const ds = [];
      for (let i = Math.max(1, k - 6); i < k; i++) ds.push(samples[i].t - samples[i - 1].t);
      ds.sort((a, b) => a - b);
      return Math.max(1, ds[ds.length >> 1]);
    }

    /**
     * Upward finger speed over the latest `ms` of real time: { v (px/s), rise (px) }. It is measured
     * per unit of time, never per sample, so a 1000 Hz mouse and a 60 Hz phone read the same gesture
     * the same way. The window stretches with sparse input (one sample per frame at 25 fps), and a
     * long silent gap (a finger held still sends no events) counts as standing still, not as a slow
     * glide.
     */
    function riseRate(samples, ms) {
      const k = samples.length, last = samples[k - 1];
      const gap = sampleGap(samples);
      const win = Math.max(ms, Math.min(150, 2.5 * gap));
      const ts = last.t - win;
      let i = k - 1;
      while (i > 0 && samples[i].t > ts) i--;
      if (i === k - 1) return { v: 0, rise: 0 };
      const a = samples[i];
      let y0 = a.y, t0 = a.t;
      if (a.t < ts) {
        // the finger's height at the window start: still at a.y until it set off toward the next sample
        const b = samples[i + 1], go = Math.max(a.t, b.t - 1.5 * gap);
        y0 = ts <= go ? a.y : a.y + (b.y - a.y) * (ts - go) / Math.max(1e-6, b.t - go);
        t0 = ts;
      }
      const rise = y0 - last.y;
      return { v: rise / (Math.max(8, last.t - t0) / 1000), rise };
    }

    /**
     * The flick from the bottom of the pull: it starts where the finger last sat at the bottom
     * (within a pixel and a half, so touch jitter doesn't stretch its timing).
     */
    function flickFrom(b, peak) {
      const S = press.samples;
      let i = S.length - 1;
      while (i > 0 && S[i].y < b.y - 1.5 && S[i].t > b.t) i--;
      return { x: b.x, y: b.y, t: Math.max(b.t, S[i].t), i, peak: peak || 0 };
    }

    /**
     * Easing off the pull: once the raised finger has sat still for EASE_HOLD ms it becomes the new
     * bottom (and the meter drops to it). A finger that keeps rising is a flick that started slowly,
     * so it never costs any of the pull. `now` is on the samples' clock.
     */
    function easeCheck(now) {
      const s = press, S = s.samples, last = S[S.length - 1];
      const from = s.flick || s.bottom;
      if (!last || from.y - last.y <= EASE_MIN || !stillSince(now - EASE_HOLD, from.t)) return false;
      s.flick = null;
      s.bottom = { x: last.x, y: last.y, t: last.t };
      return true;
    }

    /** Has the finger stayed within STILL_PX of where it is now since time `from` (and since `after`)? */
    function stillSince(from, after) {
      const S = press.samples, last = S[S.length - 1];
      let i = S.length - 1;
      while (i > 0 && S[i].t > from) {
        if (Math.abs(S[i].y - last.y) > STILL_PX) return false;
        i--;
      }
      return S[i].t <= from && S[i].t >= after && Math.abs(S[i].y - last.y) <= STILL_PX;
    }

    /** The pull's power from its bottom, drawn on the meter. */
    function setPower() {
      const s = press, maxP = isPutt() ? 1 : 1.1;
      s.power = clamp((s.bottom.y - s.sy) / s.scale, 0, maxP);
      s.maxPower = Math.max(s.maxPower || 0, s.power);
      gest.pull = s.power;
      drawGauge(s.power);
      showGuide(s.power > 0.06 ? s.bottom : null);
      powerTicks(s.power);
    }

    function beginSwing(p) {
      press.mode = 'swing';
      press.bottom = { x: p.x, y: p.y, t: p.t };
      press.flick = null;
      press.power = 0;
      press.maxPower = 0;
      press.step = 0;
      press.roomWarned = false;
      if (hintHandle) { hintHandle.hide(); hintHandle = null; }
      hud.cue.classList.add('gf-off');
      placeGauge();
      drawGauge(0);
      showGauge(true);
      ui.sfx('ui_tick');
    }

    /** Power feedback you can feel: a rising tick every 10%, a buzz at exactly full. */
    function powerTicks(power) {
      const step = Math.floor(power * 10 + 1e-6);
      if (step > press.step) {
        ui.sfx('ui_tick', { rate: 0.8 + 0.08 * Math.min(step, 10), vol: step >= 10 ? 0.8 : 0.45 });
        if (step === 10 && ui.haptic) ui.haptic(12);
      }
      press.step = step;
    }

    function swingMove(p) {
      const s = press;
      if (!s.flick) {
        if (p.y >= s.bottom.y) s.bottom = { x: p.x, y: p.y, t: p.t };
        else {
          const up = s.bottom.y - p.y;
          const r = riseRate(s.samples, 50);
          if (up > 6 && r.rise > 3 && r.v / shortSide() > FLICK_V) {
            // the flick starts at the bottom of the pull, however slowly it got going
            s.flick = flickFrom(s.bottom, r.v);
          } else easeCheck(p.t);
        }
        if (!s.flick) setPower();
        if (!s.roomWarned && p.y > engine.size.h - 14 && s.power < 0.97) {
          s.roomWarned = true;
          report('Out of room? Start your pull <b>higher</b>', 2);
        }
      } else {
        const travel = s.flick.y - p.y;
        s.flick.peak = Math.max(s.flick.peak, riseRate(s.samples, 50).v);
        if (travel < -4) { s.flick = null; s.bottom = { x: p.x, y: p.y, t: p.t }; setPower(); }
        else if (travel >= Math.max(240, 0.85 * shortSide())) fireFlick(p);
        // a gentle lift that stops and sits there was easing off the pull, not a swing
        else if (s.flick.peak / shortSide() < STALL_V && easeCheck(p.t)) setPower();
      }
    }

    /** The 'straight up' guide from the bottom of the pull (null hides it). */
    function showGuide(at) {
      const g = hud.sGuide;
      if (!at) { g.classList.remove('on'); return; }
      const len = 0.42 * shortSide();
      g.setAttribute('x1', at.x); g.setAttribute('y1', at.y - 14);
      g.setAttribute('x2', at.x); g.setAttribute('y2', at.y - len);
      g.classList.add('on');
    }

    /** The flick as the finger drew it, coloured by how far off straight up it went. */
    let streakT = 0;
    function showStreak(pts, deg) {
      const a = Math.abs(deg);
      const col = a < 2 ? '#FFFFFF' : a <= 6 ? '#FFC93C' : '#FF5A5F';
      const P = hud.sPath, T = hud.sText;
      P.setAttribute('points', pts.map(q => Math.round(q.x) + ',' + Math.round(q.y)).join(' '));
      P.style.stroke = col;
      const end = pts[pts.length - 1];
      T.textContent = a < 0.5 ? 'Straight!' : (deg < 0 ? '← ' : '') + Math.round(a) + '°' + (deg > 0 ? ' →' : '');
      T.setAttribute('x', Math.round(clamp(end.x, 40, engine.size.w - 40)));
      T.setAttribute('y', Math.round(Math.max(end.y - 12, 90)));
      T.setAttribute('text-anchor', 'middle');
      T.style.fill = col;
      P.classList.add('on'); T.classList.add('on');
      clearTimeout(streakT);
      streakT = setTimeout(() => { P.classList.remove('on'); T.classList.remove('on'); }, 600);
    }

    function cancelSwing(msg) {
      press.mode = null;
      gest.pull = 0;
      showGauge(false);
      if (phase === 'aim' && msg) {
        hud.cue.classList.remove('gf-off');
        report(msg, 1.6);
      }
    }

    /**
     * Reads the flick from the bottom of the pull to its end. Start line = the chord's angle;
     * shape = the signed bulge of the path off that chord (a bow to the right curves the ball left
     * after starting it right, like the finger did); speed = strike quality.
     */
    function fireFlick(endP) {
      const s = press, f = s.flick;
      press.mode = null;
      showGauge(false);
      const dx = endP.x - f.x, dy = endP.y - f.y;
      if (-dy < minFlick() || s.power < 0.03) { cancelSwing(s.power < 0.03 ? 'Pull down further for power' : 'Flick up <b>further</b> to swing!'); return; }
      const dt = Math.max(0.012, (endP.t - f.t) / 1000);
      const pts = s.samples.slice(f.i);
      pts.push({ x: endP.x, y: endP.y, t: endP.t });
      // peak speed over a ≥ 30 ms window (a slow lift-off at the end doesn't spoil a crisp flick)
      let peak = 0;
      for (let i = 1; i < pts.length; i++) {
        let j = i - 1;
        while (j > 0 && pts[i].t - pts[j].t < 30) j--;
        const ddt = (pts[i].t - pts[j].t) / 1000;
        if (ddt > 0.025) peak = Math.max(peak, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / ddt);
      }
      const nspeed = Math.max(Math.hypot(dx, dy) / dt, peak * 0.85) / shortSide();
      // crispness: speed over the flick (≤ ~350 ms for a thumb's length is crisp, ~600 ms tops it),
      // and a short poke can't be a full strike however fast it is
      const tempo = sstep(0.6, 2.3, nspeed) * lerp(0.3, 1, sstep(0.1, 0.3, -dy / shortSide()));
      const angle = Math.atan2(dx, -dy);
      const chord = Math.hypot(dx, dy) || 1;
      const ux = dx / chord, uy = dy / chord;
      let bulge = 0;
      for (const q of pts) {
        const dev = (q.x - f.x) * -uy + (q.y - f.y) * ux;
        if (Math.abs(dev) > Math.abs(bulge)) bulge = dev;
      }
      bulge /= chord;
      const curve = chord < 70 || isPutt() ? 0 : -Math.sign(bulge) * clamp((Math.abs(bulge) - 0.04) / 0.12, 0, 1);
      showGuide(null);
      showStreak(pts, angle / DEG);
      commitShot({ club: cur.club, aim: cur.aim, power: s.power, flick: angle, curve, tempo, scale: isPutt() ? puttScale(distToPin()) : undefined });
    }

    /**
     * Full-rate touch samples: browsers deliver one pointermove per frame and fold the rest into
     * getCoalescedEvents(). This capture listener runs just before the engine's own, so the 'move'
     * handler below can replay every sample in between (a flick takes only a few frames).
     */
    const rawMoves = [];
    function onRawMove(e) {
      rawMoves.length = 0;
      rawMoves.ref = null;
      if (!press.mode || press.mode === 'void' || !e.isPrimary || typeof e.getCoalescedEvents !== 'function') return;
      const list = e.getCoalescedEvents();
      if (!list || list.length < 2) return;
      for (const c of list) rawMoves.push({ cx: c.clientX, cy: c.clientY, t: c.timeStamp });
      rawMoves.ref = { cx: e.clientX, cy: e.clientY };
    }
    window.addEventListener('pointermove', onRawMove, true);

    function addSample(q) {
      const S = press.samples, last = S[S.length - 1];
      if (last && (q.t < last.t || (q.t === last.t && q.x === last.x && q.y === last.y))) return false;
      S.push(q);
      press.arrived = performance.now();
      // keep ~1.5 s of history at any sample rate (a 1000 Hz mouse sends 1000 a second)
      let drop = 0;
      while (S.length - drop > 24 && (q.t - S[drop].t > 1500 || S.length - drop > 4000)) drop++;
      if (drop) {
        S.splice(0, drop);
        if (press.flick) press.flick.i = Math.max(0, press.flick.i - drop);
      }
      return true;
    }

    ctx.input.on('down', p => {
      if (phase !== 'aim' || autoplay || !cur || keyCharge) return;
      press.mode = 'pending';
      press.sx = p.x; press.sy = p.y;
      press.aim0 = cur.aim;
      press.samples = [{ x: p.x, y: p.y, t: p.t }];
      press.scale = pullScale();
    });
    ctx.input.on('move', p => {
      if (!press.mode || press.mode === 'void') return;
      if (phase !== 'aim' || !cur) { press.mode = null; return; }
      // the samples folded into this event (same clock as p.t), then the event itself
      const fresh = [];
      if (rawMoves.ref) {
        const ox = p.x - rawMoves.ref.cx, oy = p.y - rawMoves.ref.cy;
        for (const c of rawMoves) if (c.t > 0 && c.t < p.t) fresh.push({ x: c.cx + ox, y: c.cy + oy, t: c.t });
        rawMoves.length = 0;
        rawMoves.ref = null;
      }
      fresh.push({ x: p.x, y: p.y, t: p.t });
      if (press.mode === 'swing') {
        for (const q of fresh) if (addSample(q) && press.mode === 'swing') swingMove(q);
        return;
      }
      for (const q of fresh) addSample(q);
      if (press.mode === 'pending') {
        const ax = Math.abs(p.dx), ay = Math.abs(p.dy);
        if (ax > 12 && ax > ay * 1.2) press.mode = 'drag';
        else if (p.dy > 10 && p.dy > ax * 0.8) beginSwing(p);
        else if (p.dy < -26 && ay > ax) { press.mode = 'void'; report('Pull <b>down</b> first, then flick up', 1.8); }
      }
      if (press.mode === 'drag') setAim(press.aim0 + p.ndx * (isPutt() ? 9 : 24) * DEG);
      else if (press.mode === 'swing') swingMove(p);
    });
    ctx.input.on('up', p => {
      const m = press.mode;
      if (m !== 'swing') { press.mode = null; return; }
      if (p.cancelled || phase !== 'aim') { cancelSwing(null); return; }
      if (addSample({ x: p.x, y: p.y, t: p.t })) swingMove(p);
      const s = press;
      if (s.mode !== 'swing') return;
      if (!s.flick) {
        // no flick seen while moving (too few samples): read the release itself, bottom → lift
        const rise = s.bottom.y - p.y, dt = Math.max(8, p.t - s.bottom.t) / 1000;
        if (rise >= minFlick() && (rise / dt / shortSide() > FLICK_V || riseRate(s.samples, 50).v / shortSide() > FLICK_V)) {
          s.flick = flickFrom(s.bottom, 0);
        }
      }
      if (s.flick && s.flick.y - p.y >= minFlick()) { fireFlick(p); return; }
      // never leave a real pull unexplained
      const rose = s.bottom.y - p.y;
      let msg = null;
      if ((s.maxPower || 0) >= 0.03) {
        if (s.power < 0.03) msg = 'Eased all the way off — pull down again';
        else if (rose >= minFlick()) msg = 'Flick up <b>faster</b> to swing!';
        else if (s.flick) msg = 'Flick up <b>further</b> to swing!';
        else if (rose > 12) msg = 'Flick up <b>faster</b> to swing!';
        else msg = 'Flick <b>up</b> to swing!';
      }
      cancelSwing(msg);
    });
    ctx.input.on('tap', () => {
      if (skipWaiter && (phase === 'react' || phase === 'turn' || phase === 'intro' || phase === 'holed' || phase === 'setup')) { skipWaiter(); return; }
      if (play && phase === 'shot' && play.t > 0.6 && !play.putt && !play.slowDone) { play.boost = 3.5; showSpeedChip(false); }
    });
    ctx.input.on('key', k => {
      if (k.key === 'Escape') return;
      if (k.down && (k.key === ' ' || k.key === 'Enter') && !k.repeat && skipWaiter && phase !== 'aim') { skipWaiter(); return; }
      if (phase !== 'aim' || autoplay || !cur || press.mode) {
        if (!k.down) aimDir = 0;
        return;
      }
      if (k.key === 'ArrowLeft' || k.key === 'ArrowRight') { aimDir = k.down ? (k.key === 'ArrowLeft' ? -1 : 1) : 0; if (k.down && !k.repeat) aimHeld = 0; }
      else if (k.down && !k.repeat && !keyCharge && (k.key === 'ArrowUp' || k.key === 'ArrowDown')) { cycleClub(k.key === 'ArrowUp' ? -1 : 1); ui.sfx('ui_tick'); }
      else if (k.down && !k.repeat && !keyCharge && (k.key === 'm' || k.key === 'M')) toggleMap();
      else if (k.key === ' ') {
        if (k.down && !keyCharge) {
          keyCharge = { t: 0 };
          press.sx = engine.size.w * 0.75; press.sy = engine.size.h * 0.35; press.scale = pullScale(); press.flick = null; press.step = 0;
          gest.pull = 0; press.power = 0;
          placeGauge(); drawGauge(0); showGauge(true);
        } else if (!k.down && keyCharge) {
          const power = gest.pull;
          keyCharge = null;
          showGauge(false);
          if (power < 0.03) { gest.pull = 0; report('Hold <b>Space</b> to build power', 1.6); return; }
          // no finger to keep straight: a key swing strays like a fair human flick (σ 3.2°, mostly
          // outside the dead zone), so keyboard and touch players compete on the same terms
          commitShot({ club: cur.club, aim: cur.aim, power, flick: clamp(gauss(rng), -2.5, 2.5) * (isPutt() ? 2.5 : 3.2) * DEG, curve: 0, tempo: 1, scale: isPutt() ? puttScale(distToPin()) : undefined });
        }
      }
    });

    /** Drops any swing in progress (pause, blur): nothing fires on its own afterwards. */
    function dropSwing() {
      aimDir = 0;
      if (keyCharge || press.mode) {
        keyCharge = null;
        press.mode = null;
        press.power = 0;
        gest.pull = 0;
        showGauge(false);
      }
    }

    let lastAimFrame = 0;
    function updateAimInput(dt) {
      if (phase !== 'aim' || !cur) { aimDir = 0; return; }
      if (aimDir) {
        aimHeld += dt;
        const rate = (isPutt() ? 1.2 + 4 * Math.min(1, aimHeld / 0.9) : 3 + 14 * Math.min(1, aimHeld / 0.9)) * DEG;
        nudgeAim(aimDir * rate * dt);
        if (Math.floor(aimHeld / 0.12) !== Math.floor((aimHeld - dt) / 0.12)) ui.sfx('ui_tick', { vol: 0.5 });
      }
      // a finger held still sends no moves: a raised one that sits there has eased off the pull (the
      // wait matches the moving case, stretched on a slow device where moves only arrive once a frame)
      const nowMs = performance.now(), frameMs = Math.min(250, nowMs - (lastAimFrame || nowMs));
      lastAimFrame = nowMs;
      const silent = nowMs - (press.arrived || 0), holdMs = Math.max(EASE_HOLD, 1.6 * frameMs);
      if (press.mode === 'swing' && !press.flick && press.bottom && silent > holdMs) {
        const S = press.samples, last = S[S.length - 1];
        if (last && press.bottom.y - last.y > EASE_MIN && last.t >= press.bottom.t) {
          press.bottom = { x: last.x, y: last.y, t: last.t };
          setPower();
        }
      }
      // a flick that stops without lifting the finger still swings (pointer moves stop arriving)
      if (press.mode === 'swing' && press.flick && performance.now() - (press.arrived || 0) > 150) {
        const last = press.samples[press.samples.length - 1], f = press.flick;
        if (f.peak / shortSide() >= STALL_V) { if (last && f.y - last.y >= Math.max(60, 0.18 * shortSide())) fireFlick(last); }
        // too gentle to be a swing: the finger eased off the pull and is sitting there
        else if (silent > holdMs && last && f.y - last.y > EASE_MIN) {
          press.flick = null;
          press.bottom = { x: last.x, y: last.y, t: last.t };
          setPower();
        }
      }
      if (keyCharge) {
        keyCharge.t += dt;
        const max = isPutt() ? 1 : 1.1;
        gest.pull = Math.min(max, keyCharge.t / 1.25);
        press.power = gest.pull;
        drawGauge(gest.pull);
        powerTicks(gest.pull);
      }
    }

    function toggleMap() {
      if (phase !== 'aim' || !cur || pulling()) return;
      mapOn = !mapOn;
      hud.mapBtn.classList.toggle('on', mapOn);
      setCam(mapOn ? 'map' : 'aim', mapOn ? 3.2 : 5);
      ballMark.visible = mapOn;
      if (vis) vis.mapGreen.visible = mapOn && !isPutt();
      // the first-swing hint would sit over the map
      if (hintHandle) hintHandle.el.style.visibility = mapOn ? 'hidden' : '';
      refreshMapUi();
    }
    function closeMap() {
      if (!mapOn) return;
      mapOn = false;
      hud.mapBtn.classList.remove('on');
      ballMark.visible = false;
      if (vis) vis.mapGreen.visible = false;
      if (hintHandle) hintHandle.el.style.visibility = '';
      refreshMapUi();
    }

    function commitShot(inp) {
      if (phase !== 'aim' || !shotWaiter) return false;
      inp.dead = RULES.dead;
      const w = shotWaiter;
      shotWaiter = null;
      press.mode = null;
      keyCharge = null;
      aimDir = 0;
      firstSwingDone = true;
      swingsDone++;
      if (hintHandle) { hintHandle.hide(); hintHandle = null; }
      showGauge(false);
      setAimUi(false);
      w(inp);
      return true;
    }

    // =============================================================================================
    // Flow: holes → players → shots
    // =============================================================================================

    /** Waits `seconds` (game time) unless skipped by a tap; resolves true when skipped. */
    function skippable(seconds) {
      return new Promise(resolve => {
        let done = false;
        const finish = skipped => { if (!done) { done = true; if (skipWaiter === tap) skipWaiter = null; resolve(!!skipped); } };
        const tap = () => finish(true);
        skipWaiter = tap;
        ctx.wait(seconds).then(() => finish(false));
      });
    }

    async function run(fromHi) {
      const gen = ++flowGen;
      const live = () => ctx.alive && gen === flowGen;
      // a local counter: a stale flow (after debug.skipTo) that wakes up must never move the live `hi`
      for (let k = fromHi; k < holeList.length; k++) {
        if (!live()) return;
        hi = k;
        if (!M || M.index !== holeList[hi]) {
          phase = 'intro';
          setAimUi(false);
          await ui.transition(async () => {
            if (live()) await prepareHole(holeList[hi]);
            if (live()) buildHole(holeList[hi]);
          });
          if (!live()) return;
        }
        await holeIntro(gen);
        for (let p = 0; p < players.length; p++) {
          if (!live()) return;
          if (cards[p][hi] != null) continue;
          await playHole(p, gen);
        }
        if (!live()) return;
        await showScorecard(gen);
      }
      if (live()) finishGame();
    }

    function teeBall() {
      const t = M.tee.dir;
      const x = M.tee.x - t[0] * 1, z = M.tee.z - t[1] * 1;
      return { x, z, y: heightAt(M, x, z) + BALL_R + 0.035, surf: 'tee' };
    }

    // ---- hole intro: title card + flyover ------------------------------------------------------
    let fly = null, introsSeen = false;

    async function holeIntro(gen) {
      phase = 'intro';
      cur = null;
      setAimUi(false);
      hud.left.classList.add('gf-off');
      showGolfer(-1);
      const tb = teeBall();
      ball.position.set(tb.x, tb.y, tb.z);
      ball.visible = true;
      refreshHud();
      hud.strokeChip.textContent = M.holeLen + ' m';
      const n = holeList[hi] + 1;
      ui.titleCard('HOLE ' + n, 'Par ' + M.par + ' · ' + M.holeLen + ' m · ' + M.name, { accent: DEF.accent });
      // the card takes the tap that would skip the flyover (it's .ss-block): one tap skips both
      const tc = ui.fx.lastElementChild;
      if (tc && tc.classList.contains('ss-titlecard')) tc.addEventListener('pointerdown', () => { if (phase === 'intro' && skipWaiter && gen === flowGen) skipWaiter(); });
      audio.sfx('flag_flap', { vol: 0.5 });
      const T = M.tee.dir, Fg = M.greenFrame;
      const sMid = Math.min(M.L * 0.55, 230), F = M.frameAt(sMid);
      const gy = groundPin();
      const at = (x, y, z) => V(x, y, z);
      const keys = [
        [at(-T[0] * 16, M.elevAt(0) + 9, -T[1] * 16), at(T[0] * 60, M.elevAt(40), T[1] * 60)],
        [at(F.x - F.tx * 30 - F.tz * 22, M.elevAt(sMid) + 34, F.z - F.tz * 30 + F.tx * 22), at(F.x + F.tx * 60, M.elevAt(sMid + 60), F.z + F.tz * 60)],
        [at(Fg.x - Fg.tx * 30 - Fg.tz * 12, gy + 13, Fg.z - Fg.tz * 30 + Fg.tx * 12), at(M.pin.x, gy, M.pin.z)],
        // the green, framed from just short of it and a little to the side
        [at(M.pin.x - Fg.tx * 22 + Fg.tz * 7, gy + 6, M.pin.z - Fg.tz * 22 - Fg.tx * 7), at(M.pin.x - Fg.tx * 2, gy + 0.8, M.pin.z - Fg.tz * 2)],
        [at(-T[0] * 9, M.elevAt(0) + 4.5, -T[1] * 9), at(T[0] * 50, M.elevAt(50) + 2, T[1] * 50)],
      ];
      // brisk, and briskest on the first hole of a session (you want to play)
      const dur = autoplay ? 1.4 : hi === startHi && !introsSeen ? 3 : 3 + M.L / 220;
      introsSeen = true;
      fly = { t: 0, dur, keys };
      setCam('free', 10, true);
      if (!autoplay) ctx.wait(0.4).then(() => { if (fly && gen === flowGen) showSkip(true); });
      await skippable(dur + 0.2);
      fly = null;
      showSkip(false);
      if (gen !== flowGen) return;
      hud.left.classList.remove('gf-off');
    }

    let skipChip = null;
    function showSkip(on, text) {
      if (on && !skipChip) { skipChip = ui.el('div', 'ss-chip dark gf-skip', text || 'Tap to skip'); ctx.hud.appendChild(skipChip); }
      else if (!on && skipChip) { skipChip.remove(); skipChip = null; }
    }
    /** Fast-forward is a tap away during long flights; say so once per game until it has been used. */
    let speedUsed = 0;
    function showSpeedChip(on) {
      if (on && speedUsed < 2 && hintsOn) showSkip(true, 'Tap to speed up');
      else if (!on && skipChip && skipChip.textContent === 'Tap to speed up') { if (play && play.boost) speedUsed++; showSkip(false); }
    }

    function catmull(p0, p1, p2, p3, t, out) {
      const t2 = t * t, t3 = t2 * t;
      for (const k of ['x', 'y', 'z']) {
        out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      }
      return out;
    }

    function updateFly(dt) {
      if (!fly) return;
      fly.t += dt;
      const u = U.ease.inOutQuad(clamp(fly.t / fly.dur, 0, 1)) * (fly.keys.length - 1);
      const i = Math.min(fly.keys.length - 2, Math.floor(u)), f = u - i;
      const K = fly.keys, P = j => K[clamp(j, 0, K.length - 1)];
      catmull(P(i - 1)[0], P(i)[0], P(i + 1)[0], P(i + 2)[0], f, cam.goalPos);
      catmull(P(i - 1)[1], P(i)[1], P(i + 1)[1], P(i + 2)[1], f, cam.goalLook);
      const gy = heightAt(M, cam.goalPos.x, cam.goalPos.z) + 3;
      if (cam.goalPos.y < gy) cam.goalPos.y = gy;
      cam.goalFov = fovFor(50, engine.size.aspect < 0.8 ? 50 : 62);
    }

    // ---- a player's hole ------------------------------------------------------------------------
    async function playHole(p, gen) {
      const live = () => ctx.alive && gen === flowGen;
      cur = { p, strokes: 0, putts: 0, ball: teeBall(), club: 0, aim: 0, holed: false, pickedUp: false, gir: false };
      const G = golfers[p];
      G.geom = addressGeom(0);
      showGolfer(p);
      hud.playerFor = -1;
      if (players.length > 1) {
        prepareShot(true, true);
        phase = 'turn';
        await turnCard(p);
        if (!live()) return;
      }
      let first = true;
      while (live() && !cur.holed && !cur.pickedUp) {
        await prepareShot(first, false);
        first = false;
        if (!live()) return;
        const inp = await waitForShot();
        if (!live()) return;
        const shot = await executeShot(inp, gen);
        if (!live() || !shot) return;
        await react(shot, gen);
      }
      if (!live()) return;
      cards[p][hi] = Math.min(cur.strokes, M.par + MAX_OVER_PAR);
      const st = stats[p], sc = cards[p][hi];
      if (sc - M.par === -1) st.birdies++;
      else if (sc - M.par <= -2) st.eagles++;
      else if (sc === M.par) st.pars++;
      st.putts += cur.putts;
      if (cur.gir) st.gir++;
      refreshHud();
    }

    async function prepareShot(first, quiet) {
      phase = 'setup';
      const gen = flowGen;
      if (swing) { swing = null; golfers[cur.p].posing = false; }
      const b = cur.ball;
      if (b.surf !== 'tee') b.surf = surfaceAt(M, b.x, b.z);
      b.y = heightAt(M, b.x, b.z) + BALL_R + (b.surf === 'tee' ? 0.035 : 0);
      ball.position.set(b.x, b.y, b.z);
      ball.scale.setScalar(1);
      ball.visible = true;
      trail.visible = false;
      flyMark.visible = false;
      peg.visible = b.surf === 'tee';
      peg.position.set(b.x, b.y - BALL_R - 0.02, b.z);
      const G = golfers[cur.p];
      G.reacting = false;
      const pick = suggestShot(b);
      cur.club = pick.club;
      G.geom = addressGeom(pick.club);
      G.club.set(pick.club);
      cur.aim = pick.aim;
      placeGolfer();
      G.shown = 0;
      gest.pull = 0;
      closeMap();
      ringDirty = true;
      env.setShadowFocus(V(b.x, b.y, b.z), 30);
      refreshHud();
      G.pal.play('idle');
      G.pal.setExpression('focus');
      golferPose(G, 0, Infinity);
      G.pal.lookAt(null);
      // a long way from the new lie (after a reaction back where the shot was played): cut, don't fly
      setCam('aim', first ? 2.6 : 3.2, false);
      if (cam.pos.distanceTo(_bp.set(b.x, b.y, b.z)) > 70) setCam('aim', 3.2, true);
      if (quiet) return;
      await ctx.wait(autoplay ? 0.3 : 0.35);
      if (gen !== flowGen) return;
    }

    function waitForShot() {
      phase = 'aim';
      setAimUi(true);
      refreshHud();
      if (!firstSwingDone && !autoplay && hintsOn && !hintHandle) {
        const sz = engine.size;
        const short = sz.h <= 520 && sz.aspect > 1;
        hintHandle = ui.hint({ gesture: 'drag-down-up', text: 'Pull down, then flick up!', x: sz.w * (short ? 0.66 : 0.7), y: sz.h * (short ? 0.42 : 0.6) });
        hud.cue.classList.add('gf-off');
      }
      return new Promise(resolve => {
        shotWaiter = resolve;
        if (autoplay) autoShot();
      });
    }

    async function turnCard(p) {
      const prof = players[p].profile;
      const wrap = ui.el('div', 'gf-turnwrap');
      const card = ui.el('div', 'gf-turncard ss-pop');
      card.append(ui.portraitImg(prof, 64));
      const who = prof.name.toLowerCase() === 'you' ? 'Your turn!' : ui.esc(prof.name) + "'s turn!";
      card.appendChild(ui.el('div', '', '<h3>' + who + '</h3><p>Hole ' + (holeList[hi] + 1) + ' · Par ' + M.par + ' · ' + toParText(toParFor(p)) + '</p>'));
      wrap.appendChild(card);
      ctx.hud.appendChild(wrap);
      audio.sfx('ui_open');
      golfers[p].pal.play('wave');
      await skippable(autoplay ? 0.5 : 1.5);
      wrap.classList.add('out');
      ctx.wait(0.3).then(() => wrap.remove());
    }

    // ---- executing a shot -----------------------------------------------------------------------
    async function executeShot(inp, gen) {
      phase = 'shot';
      closeMap();
      if (cam.mode === 'map') setCam('aim', 4);
      const G = golfers[cur.p];
      const club = CLUBS[inp.club];
      if (inp.club !== cur.club) { cur.club = inp.club; G.geom = addressGeom(inp.club); G.club.set(inp.club); }
      cur.aim = inp.aim;
      placeGolfer();
      const from = Object.assign({}, cur.ball);
      const tickP = idealPower();
      const { L, info } = launchFor(M, cur.ball, inp, rng);
      const res = simulateShot(M, L, { wind, record: true });
      res.windNote = club.putter ? '' : windNote(L, res, inp.aim);
      lastShot = {
        club: club.id, power: +inp.power.toFixed(3), flickDeg: +((inp.flick || 0) / DEG).toFixed(1), curve: +(inp.curve || 0).toFixed(2),
        tempo: +(inp.tempo == null ? 1 : inp.tempo).toFixed(2), aimDeg: +(wrapA(inp.aim - headingTo(from.x, from.z, M.pin.x, M.pin.z)) / DEG).toFixed(1),
      };
      await runSwing(G, inp);
      if (gen !== flowGen || !ctx.alive) return null;
      cur.strokes++;
      if (club.putter && from.surf === 'green') cur.putts++;
      refreshHud();
      impactFx(G, club, inp, info, from, tickP);
      await playback(res, inp, from);
      if (gen !== flowGen || !ctx.alive) return null;
      return { res, inp, info, from };
    }

    /**
     * What the wind did to a shot, so its scale can be learned: the same launch flown in calm air
     * (no trees) against where this one came down. '' when it moved the ball less than 1.5 m.
     */
    function windNote(L, res, aim) {
      if (wind.speed < 0.5) return '';
      const end = r => r.land || r.events.find(e => e.type === 'splash' || e.type === 'ob') || null;
      const a = end(res);
      if (!a || res.events.some(e => (e.type === 'tree' || e.type === 'trunk') && e.n <= a.n)) return '';
      const calm = simulateShot(M, L, { stopAtLand: true, noTrees: true });
      const b = end(calm);
      if (!b) return '';
      const [ax, az] = headingDir(aim);
      const ddx = a.x - b.x, ddz = a.z - b.z;
      const along = ddx * ax + ddz * az, side = ddx * -az + ddz * ax;
      const parts = [];
      if (Math.abs(side) >= 1.5) parts.push(Math.round(Math.abs(side)) + ' m ' + (side > 0 ? 'right' : 'left'));
      if (Math.abs(along) >= 1.5) parts.push(Math.round(Math.abs(along)) + ' m ' + (along > 0 ? 'long' : 'short'));
      return parts.length ? 'Wind <b>' + parts.join(', ') + '</b>' : '';
    }

    /**
     * The strike: sound, dust, a PERFECT / GREAT call for a clean swing (PURE for a putt), and the
     * report that teaches the gesture: the finger's own angle, plus what the lie or an overswing added.
     */
    function impactFx(G, club, inp, info, from, idealP) {
      const p = clamp(inp.power, 0, 1.1);
      const fd = Math.abs(inp.flick || 0) / DEG, bend = Math.abs(inp.curve || 0);
      // power that's right: a full swing, or right on the carry / pace that reaches the pin
      const onMark = idealP > 0 && idealP <= 1.1 && Math.abs(p - idealP) < (club.putter ? 0.04 : 0.02);
      let tier = null;
      if (club.putter) tier = fd <= 2.5 && onMark ? 'pure' : null;
      else if (fd <= 2.5 && bend < 0.15 && info.strike > 0.9 && (Math.abs(p - 1) < 0.03 || onMark)) tier = 'perfect';
      else if (fd <= 4 && bend < 0.3 && info.strike > 0.8) tier = 'great';
      const sp = engine.project(ball.position, camera);
      if (tier === 'perfect' || tier === 'pure') {
        ui.scorePopup(club.putter ? 'PURE!' : 'PERFECT!', sp.x, sp.y - 30, { color: '#FFE37A' });
        world.burst(scene, V(from.x, from.y + 0.1, from.z), { count: 26, colors: [0xFFFFFF, 0xFFE37A, 0xFFC93C], speed: 3, size: 0.06, gravity: -2, life: 0.7 });
        if (!club.putter) { engine.slowmo(0.08, 0.08); engine.shake(0.06, 0.3); audio.sfx('crowd_ooh', { vol: 0.6 }); }
        if (ui.haptic) ui.haptic(25);
      } else if (tier === 'great') {
        ui.scorePopup('GREAT!', sp.x, sp.y - 26, { color: '#FFFFFF' });
        world.burst(scene, V(from.x, from.y + 0.1, from.z), { count: 12, colors: [0xFFFFFF, 0xFFE37A], speed: 2.2, size: 0.05, gravity: -2, life: 0.5 });
        audio.sfx('crowd_ooh', { vol: 0.35 });
      }
      const perfect = tier === 'perfect';
      if (club.putter) audio.sfx('golf_putt', { intensity: clamp(p, 0.2, 1) });
      else {
        if (perfect) audio.sfx('golf_drive', { intensity: 1, rate: 1.08 });
        else audio.sfx(club.sfx, { intensity: info.topped ? 0.3 : clamp(p, 0.3, 1) });
        audio.sfx('whoosh', { intensity: clamp(p, 0.3, 1), vol: 0.5 });
        if (p > 0.85) audio.sfx('voice_hup', { vol: 0.7 });
        if (club.id === 'D' && p > 0.7 && !perfect) engine.shake(0.035, 0.25);
        const at = V(from.x, from.y, from.z);
        if (from.surf === 'sand') world.burst(scene, at, { count: 34, color: 0xEBD39A, speed: 3.2, size: 0.09, life: 0.9 });
        else if (from.surf !== 'tee' && from.surf !== 'green') world.burst(scene, at, { count: 14, colors: [0x5DA845, 0x7CC456, 0x8B6A3E], speed: 2.4, size: 0.06, life: 0.7 });
        trail.clear();
        trail.visible = true;
      }
      peg.visible = false;
      if (ui.haptic && !perfect) ui.haptic(club.putter ? 8 : 16);
      // the finger's flick angle (inside the dead zone it's straight), so the gesture can be learned
      const fdSigned = (inp.flick || 0) / DEG, deadDeg = (club.putter ? PUTT_DEAD : RULES.dead) / DEG;
      const rightWord = hand > 0 ? ['Pushed', 'Pulled'] : ['Pulled', 'Pushed'];
      const side = v => (v > 0 ? 'right' : 'left');
      const dir = Math.abs(fdSigned) <= deadDeg ? 'Straight'
        : (fdSigned > 0 ? rightWord[0] : rightWord[1]) + ' ' + Math.max(1, Math.round(Math.abs(fdSigned))) + '° ' + side(fdSigned);
      // and who else had a say in the start line
      let extra = '';
      const lie = info.lieErr * START_LINE / DEG, over = info.overErr * START_LINE / DEG;
      if (Math.abs(lie) >= 1) extra += ' · ' + (from.surf === 'sand' ? 'Sand' : 'Rough') + ' kicked it ' + Math.round(Math.abs(lie)) + '° ' + side(lie);
      if (Math.abs(over) >= 1) extra += ' · Overswing wobble';
      const tilt = info.tilt / DEG;
      let shape = '';
      if (!club.putter && Math.abs(tilt) > 7) shape = ' · ' + (tilt > 0 ? (tilt > 16 ? 'Slice' : 'Fade') : (tilt < -16 ? 'Hook' : 'Draw'));
      if (club.putter) report('Putt <b>' + (info.dist || 0).toFixed(1) + ' m</b> · ' + dir, 2.4);
      else {
        const strike = info.topped ? 'Topped!' : info.over > 0.05 ? 'Overswing' : info.strike < 0.8 ? 'Soft flick' : perfect ? 'Flush' : 'Crisp';
        report('<b>' + Math.round(p * 100) + '%</b> · ' + dir + shape + ' · ' + strike + extra, 2.6);
      }
      G.pal.lookAt(ball.position);
    }

    function playback(res, inp, from) {
      return new Promise(resolve => {
        const putt = !!CLUBS[inp.club].putter;
        const land = res.land || (res.events.find(e => e.type === 'splash' || e.type === 'tree') || null);
        const landPt = land ? V(land.x, land.y != null ? land.y : heightAt(M, land.x, land.z), land.z) : V(res.rest.x, res.rest.y, res.rest.z);
        const dir = norm2(res.rest.x - from.x + (land ? land.x - from.x : 0), res.rest.z - from.z + (land ? land.z - from.z : 0));
        // the landing camera sits beyond the spot and off to one side: the side that isn't over water
        const sideL = surfaceAt(M, landPt.x + dir[0] * 12 + dir[1] * 6, landPt.z + dir[1] * 12 - dir[0] * 6);
        play = {
          res, inp, from, putt, t: 0, ev: 0, warp: 1, boost: 0, resolve, landPt, dir, rollDir: dir.slice(),
          landN: land ? land.n : null, short: (res.land ? res.carry : res.total) < 55, side: sideL === 'water' ? 1 : -1, slowDone: false,
          tree: false, lipped: false, camFrom: cam.pos.clone(), speedChip: false, landed: false,
          high: treesNear(M, landPt.x, landPt.z, []).filter(t => Math.hypot(t.x - landPt.x, t.z - landPt.z) < 20).length >= 3,
        };
        // a big moment is coming: holed, a near miss or a lip-out (slow-mo doesn't give the result away)
        const tense = res.outcome === 'holed' || res.close.d < 0.6 || res.events.some(e => e.type === 'lip');
        play.tenseN = tense && (putt ? res.total > 2.5 : true) ? (res.outcome === 'holed' ? res.n : res.close.n) : null;
        setCam(putt ? 'puttroll' : 'follow', putt ? 2.6 : 4.6, false);
        // the predicted landing spot, so the eye knows where to look while the ball is up
        flyMark.visible = !putt && !!land && !play.short;
        if (flyMark.visible) { flyMark.position.set(landPt.x, landPt.y + 0.2, landPt.z); flyMarkMat.opacity = 0.9; }
        hud.lieChip.classList.add('gf-off');
        hud.distChip.classList.add('live');
      });
    }

    /**
     * Playback pace (sim seconds per game second). Long shots are time-warped so there's less watching:
     * real time off the club face and for the landing, a brisk 1.7× through the middle of the flight,
     * 2× for the run-out. A tap hurries the rest along; a tense finish plays at 1× under slow-mo.
     */
    function playPace(P, f) {
      if (P.putt || P.slowDone) return 1;
      if (P.landN == null || f < P.landN) {
        const toLand = P.landN == null ? Infinity : (P.landN - f) * STEP;
        return P.t < 0.5 || toLand < 1.3 ? 1 : 1.7;
      }
      return (f - P.landN) * STEP < 0.5 ? 1 : 2;
    }

    function updatePlay(dt) {
      const P = play;
      const n = P.res.n;
      const A = P.res.path;
      P.warp = U.damp(P.warp, playPace(P, P.t / STEP), 5, dt);
      P.t += dt * Math.max(P.warp, P.boost);
      let f = Math.min(P.t / STEP, n);
      const i0 = Math.min(n - 1, Math.floor(f)), u = f - i0;
      ball.position.set(lerp(A[i0 * 3], A[i0 * 3 + 3], u), lerp(A[i0 * 3 + 1], A[i0 * 3 + 4], u), lerp(A[i0 * 3 + 2], A[i0 * 3 + 5], u));
      while (P.ev < P.res.events.length && P.res.events[P.ev].n <= f) onEvent(P.res.events[P.ev++]);
      if (!P.putt && P.landN != null && f >= P.landN) {
        P.landed = true;
        // the way it is running (for the roll camera), and a slow creep to rest isn't worth watching
        const j = Math.max(0, i0 - 30);
        const mx = ball.position.x - A[j * 3], mz = ball.position.z - A[j * 3 + 2], ml = Math.hypot(mx, mz);
        if (ml > 0.05) { P.rollDir[0] = lerp(P.rollDir[0], mx / ml, 0.2); P.rollDir[1] = lerp(P.rollDir[1], mz / ml, 0.2); const k = Math.hypot(P.rollDir[0], P.rollDir[1]) || 1; P.rollDir[0] /= k; P.rollDir[1] /= k; }
        const R = P.res.rest;
        if (P.res.outcome === 'rest' && !P.slowDone && ml / ((i0 - j) * STEP || 1) < 0.25 && Math.hypot(R.x - ball.position.x, R.z - ball.position.z) < 1) P.boost = 6;
      }
      // cut (not fly) to the landing camera: flying there would pass right by the ball
      if (!P.putt && cam.mode === 'follow' && P.landN != null && !P.short && (P.landN - f) * STEP < 1.6) setCam('land', 2.3, true);
      // once it runs on past the landing spot (or at the camera), cut in behind it
      if (cam.mode === 'land' && P.landed) {
        const L = P.landPt, [dx, dz] = P.dir;
        const past = (ball.position.x - L.x) * dx + (ball.position.z - L.z) * dz;
        if (past > 7 || Math.hypot(ball.position.x - cam.pos.x, ball.position.z - cam.pos.z) < 6) setCam('roll', 3, true);
      }
      if (!P.slowDone && P.tenseN != null && (P.tenseN - f) * STEP < (P.putt ? 0.9 : 1.2)) {
        P.slowDone = true;
        P.boost = 0;
        P.warp = 1;
        showSpeedChip(false);
        engine.slowmo(P.res.outcome === 'holed' && !P.putt ? 0.22 : 0.35, 1.2);
        audio.sfx('crowd_gasp', { vol: 0.6 });
        if (vis && vis.crowd) vis.crowd.setMood('tense');
      }
      {
        // live flight readout, then the distance left once it lands (a putt: the distance left as it rolls)
        const txt = P.landed || P.putt
          ? fmtDist(Math.hypot(M.pin.x - ball.position.x, M.pin.z - ball.position.z)) + ' <small>TO PIN</small>'
          : Math.round(Math.hypot(ball.position.x - P.from.x, ball.position.z - P.from.z)) + ' m <small>' + (f < 2 ? 'GO!' : 'IN THE AIR') + '</small>';
        if (hud.distChip.innerHTML !== txt) hud.distChip.innerHTML = txt;
      }
      if (!P.putt) {
        if (!P.speedChip && P.t > 1 && !P.boost && (n - f) * STEP > 2.4 && !P.slowDone && !autoplay) { P.speedChip = true; showSpeedChip(true); }
      }
      if (flyMark.visible) {
        const age = P.landed ? (f - P.landN) * STEP : 0;
        const r = clamp(camera.position.distanceTo(flyMark.position) * 0.04, 1, 30);
        flyMark.scale.setScalar(r * (1 + age * 1.5 + (P.landed ? 0 : 0.08 * Math.sin(P.t * 9))));
        flyMarkMat.opacity = 0.9 * clamp(1 - age * 2, 0, 1);
        if (age > 0.5) flyMark.visible = false;
      }
      if (f >= n) {
        play = null;
        flyMark.visible = false;
        showSpeedChip(false);
        trail.visible = false;
        if (P.res.outcome === 'holed' || P.res.outcome === 'water') ball.visible = false;
        P.resolve();
      }
    }

    function onEvent(e) {
      const P = play;
      switch (e.type) {
        case 'land':
        case 'bounce': {
          const big = e.type === 'land';
          const vol = big ? 0.9 : 0.4 * clamp(e.speed / 6, 0.2, 1);
          audio.sfx(e.surf === 'sand' ? 'golf_land_sand' : 'golf_land_grass', { vol });
          if (big) {
            const at = V(e.x, e.y - BALL_R + 0.06, e.z);
            world.ring(scene, at, { color: 0xFFFFFF, radius: 0.9, life: 0.7 });
            if (e.surf === 'sand') world.burst(scene, at, { count: 26, color: 0xEBD39A, speed: 2.6, size: 0.08, life: 0.8 });
            else world.burst(scene, at, { count: 10, colors: [0x6CC24B, 0x9BE07A], speed: 1.8, size: 0.05, life: 0.5 });
            if (!P.putt && (P.res.carry > 40 || P.res.windNote)) report('Carry <b>' + Math.round(P.res.carry) + ' m</b>' + (P.res.windNote ? ' · ' + P.res.windNote : ''), 2.6);
          }
          break;
        }
        case 'tree':
          P.tree = true;
          audio.sfx('golf_tree');
          world.burst(scene, V(e.x, e.y, e.z), { count: 30, colors: [0x4FA64A, 0x7CCB5E, 0x3B8A3A], speed: 3, size: 0.12, gravity: -4, life: 1.3 });
          break;
        case 'trunk':
          audio.sfx('wood_knock', { vol: 0.8 });
          break;
        case 'splash':
          audio.sfx('golf_water');
          audio.sfx('splash', { vol: 0.5 });
          world.burst(scene, V(e.x, e.y + 0.05, e.z), { count: 44, colors: [0xBFE6FF, 0xFFFFFF, 0x7CC8F2], speed: 4.2, size: 0.1, life: 1 });
          world.ring(scene, V(e.x, e.y + 0.03, e.z), { color: 0xD8F0FF, radius: 1.6, life: 1 });
          ball.visible = false;
          if (!P.putt && P.res.windNote) report(P.res.windNote, 2.6);
          break;
        case 'lip':
          P.lipped = true;
          audio.sfx('golf_cup', { vol: 0.35, rate: 1.4 });
          break;
        case 'cup':
          audio.sfx('golf_cup');
          break;
        default:
          break;
      }
    }

    // ---- reacting to the result ----------------------------------------------------------------
    /**
     * Banner + sound for the result. After a full shot that's worth a reaction, the camera holds on the
     * ball under the banner for a beat, then cuts back to the golfer reacting; putts react in view.
     * Routine results move straight on.
     */
    async function react(shot, gen) {
      phase = 'react';
      const { res, inp, from } = shot;
      const G = golfers[cur.p], pal = G.pal, st = stats[cur.p];
      const club = CLUBS[inp.club];
      const d0 = Math.hypot(M.pin.x - from.x, M.pin.z - from.z);
      lastOutcome = { outcome: res.outcome, surf: res.surf, carry: +res.carry.toFixed(1), total: +res.total.toFixed(1), events: res.events.map(e => e.type) };
      if (cur.strokes === 1 && M.par > 3) { st.firN++; if (res.surf === 'fairway') st.fir++; }
      if (res.outcome === 'holed') return celebrate(shot, gen, d0);
      const crowd = vis && vis.crowd;
      if (crowd) crowd.setMood('idle');
      let wait = 0.7, reaction = null;
      const feel = (anim, expr) => {
        if (club.putter) { pal.play(anim); if (expr) pal.setExpression(expr, 1.6); wait = Math.max(wait, 1); }
        else reaction = { anim, expr };
      };
      if (res.outcome === 'water') {
        cur.strokes++;
        st.pens++;
        const drop = dropPoint(M, res.rest, from);
        cur.ball = { x: drop.x, z: drop.z, y: 0, surf: surfaceAt(M, drop.x, drop.z) };
        ui.banner('SPLASH!', { kind: 'bad', sub: 'Penalty stroke · Drop', duration: 1.6 });
        audio.sfx('crowd_aww', { intensity: 0.6 });
        feel('sad', 'sad');
        wait = 1.3;
      } else if (res.outcome === 'ob') {
        cur.strokes++;
        st.pens++;
        cur.ball = Object.assign({}, from);
        ui.banner('OUT OF BOUNDS', { kind: 'bad', sub: 'Past the white stakes · Replay', duration: 1.6 });
        audio.sfx('crowd_gasp', { vol: 0.7 });
        feel('shrug', 'surprised');
        wait = 1.3;
      } else {
        cur.ball = { x: res.rest.x, z: res.rest.z, y: res.rest.y, surf: res.surf };
        const d = Math.hypot(M.pin.x - res.rest.x, M.pin.z - res.rest.z);
        const near = d < 30;
        const teeShot = from.surf === 'tee' && M.par > 3;
        if (club.id === 'D' && from.surf === 'tee' && res.surf !== 'ob') st.drive = Math.max(st.drive, res.total);
        if (res.surf === 'green' && !cur.gir && cur.strokes <= M.par - 2) cur.gir = true;
        const gimme = (res.surf === 'green' || res.surf === 'fringe') && d < RULES.gimme && cur.strokes < M.par + MAX_OVER_PAR;
        if (club.putter) {
          const left = fmtDist(d) + ' left';
          if (lastOutcome.events.indexOf('lip') >= 0) { ui.banner('LIPPED OUT!', { kind: 'bad', sub: gimme ? 'Tap it in' : left, duration: 1.3 }); audio.sfx('crowd_aww', { intensity: 0.8 }); feel('sad', 'wince'); }
          else if (gimme) { ui.banner('SO CLOSE!', { kind: 'info', sub: 'Tap it in', duration: 1.1 }); audio.sfx('crowd_aww', { intensity: 0.5 }); feel('shrug', 'wince'); }
          else report(left, 1.8);
          wait = Math.max(wait, 0.9);
        } else if (lastOutcome.events.indexOf('tree') >= 0 && (res.surf === 'rough' || res.surf === 'sand')) {
          ui.banner('TIMBER!', { kind: 'bad', sub: 'Into the trees · ' + (res.surf === 'sand' ? 'In the sand' : 'In the rough'), duration: 1.4 });
          audio.sfx('crowd_gasp', { vol: 0.5 });
          feel('shrug', 'surprised');
        } else if (lastOutcome.events.indexOf('tree') >= 0 && res.surf !== 'green') {
          // clipped a branch but dropped somewhere playable
          ui.banner('OFF THE BRANCHES!', { kind: 'info', sub: (SURF[res.surf] ? SURF[res.surf].name : 'Safe') + ' · ' + fmtDist(d) + ' to the pin', duration: 1.4 });
          audio.sfx('crowd_ooh', { vol: 0.5 });
          feel('shrug', 'surprised');
        } else if (res.surf === 'green') {
          if (d < 1.6) { ui.banner('STIFFED IT!', { kind: 'great', sub: fmtDist(d) + ' to the pin', duration: 1.6 }); audio.sfx('crowd_cheer', { intensity: 0.7 }); if (crowd) crowd.cheer(0.8, 2); feel('cheer', 'joy'); }
          else if (d < 6) { ui.banner('ON THE GREEN!', { kind: 'good', sub: fmtDist(d) + ' to the pin', duration: 1.4 }); audio.sfx('crowd_applause', { intensity: 0.5 }); if (crowd) crowd.cheer(0.4, 1.5); feel('clap', 'happy'); }
          else { ui.banner('ON THE GREEN', { kind: 'info', sub: fmtDist(d) + ' to the pin', duration: 1.2 }); feel('clap', 'happy'); }
        } else if (res.surf === 'fairway') {
          if (teeShot && res.total > 232) { ui.banner('MONSTER DRIVE!', { kind: 'great', sub: Math.round(res.total) + ' m', duration: 1.6 }); audio.sfx('crowd_ooh', { vol: 0.7 }); feel('cheer', 'proud'); }
          else if (teeShot) { ui.banner('FAIRWAY!', { kind: 'good', sub: Math.round(res.total) + ' m drive', duration: 1.3 }); feel('clap', 'happy'); }
          else ui.banner('FAIRWAY', { kind: 'info', sub: fmtDist(d) + ' to the pin', duration: 1.1 });
        } else if (res.surf === 'fringe') {
          ui.banner('JUST OFF THE GREEN', { kind: 'info', sub: fmtDist(d) + ' to the pin', duration: 1.2 });
        } else if (res.surf === 'sand') {
          ui.banner('BUNKER!', { kind: 'bad', sub: near ? 'Splash out with the sand wedge' : 'Sand shots fly shorter', duration: 1.5 });
          if (near) audio.sfx('crowd_aww', { intensity: 0.4 });
          feel('shrug', 'wince');
        } else if (res.surf === 'rough') {
          ui.banner('ROUGH', { kind: 'info', sub: fmtDist(d) + ' to the pin', duration: 1.1 });
          if (teeShot) feel('shrug', 'wince');
        } else {
          ui.banner('TEE', { kind: 'info', sub: fmtDist(d) + ' to the pin', duration: 1 });
        }
        if (gimme) {
          await skippable(autoplay ? 0.3 : 0.75);
          if (gen !== flowGen) return;
          return tapIn(gen, d);
        }
      }
      if (!cur.holed && cur.strokes >= M.par + MAX_OVER_PAR) {
        cur.pickedUp = true;
        reaction = null;
        await ctx.wait(autoplay ? 0.3 : 1.0);
        if (gen !== flowGen) return;
        ui.banner('PICKED UP', { kind: 'info', sub: 'Max score is par + ' + MAX_OVER_PAR, duration: 1.6 });
        audio.sfx('jingle_lose', { vol: 0.5 });
        refreshHud();
        wait = 1.6;
      }
      if (reaction && !autoplay) {
        // a beat on the ball under the banner, then the golfer's reaction back where they swung
        const skipped = await skippable(0.55);
        if (gen !== flowGen) return;
        if (skipped) return;
        G.reacting = true;
        G.posing = false;
        pal.releasePose(0);
        pal.lookAt(null);
        if (reaction.expr) pal.setExpression(reaction.expr, 1.4);
        pal.play(reaction.anim);
        setCam('react', 8, true);
        wait = 0.85;
      }
      await skippable(autoplay ? 0.5 : wait);
    }

    /** A gimme: the golfer taps the ball in (one more stroke) and the hole is done. */
    async function tapIn(gen, d) {
      const G = golfers[cur.p];
      cur.club = PUTTER;
      G.geom = addressGeom(PUTTER);
      G.club.set(PUTTER);
      cur.aim = headingTo(cur.ball.x, cur.ball.z, M.pin.x, M.pin.z);
      G.pal.play('idle');
      placeGolfer();
      golferPose(G, 0, Infinity);
      ball.position.set(cur.ball.x, heightAt(M, cur.ball.x, cur.ball.z) + BALL_R, cur.ball.z);
      ball.visible = true;
      report('<b>Gimme!</b> Tapped in', 1.6);
      audio.sfx('golf_putt', { intensity: 0.2 });
      await U.tween(ball.position, { x: M.pin.x, z: M.pin.z, y: groundPin() - 0.03 }, autoplay ? 0.15 : 0.32, { ease: 'inQuad' });
      if (gen !== flowGen) return;
      audio.sfx('golf_cup');
      ball.visible = false;
      cur.strokes++;
      if (cur.ball.surf === 'green') cur.putts++;
      refreshHud();
      return celebrate({ res: { total: d, outcome: 'holed' }, inp: { club: PUTTER }, gimme: true }, gen, d);
    }

    /** Sets up the celebration orbit, starting from wherever the camera is now. */
    function cupCam() {
      const pr = golfers[cur.p].pal.root.position;
      const rg = Math.hypot(pr.x - M.pin.x, pr.z - M.pin.z);
      // centre: between the golfer and the cup when they're close, else the cup (the golfer gets a cut later)
      const C = rg < 6 ? { x: (pr.x + M.pin.x) / 2, z: (pr.z + M.pin.z) / 2 } : { x: M.pin.x, z: M.pin.z };
      const gy = heightAt(M, C.x, C.z);
      const a0 = Math.atan2(cam.pos.x - C.x, cam.pos.z - C.z), r0 = Math.hypot(cam.pos.x - C.x, cam.pos.z - C.z);
      // finish clear of the flagstick: well off the line from the centre to whichever of cup/golfer is farther
      const ap = rg < 6 ? Math.atan2(M.pin.x - C.x, M.pin.z - C.z) : Math.atan2(pr.x - C.x, pr.z - C.z);
      const cands = [ap + Math.PI * 0.6, ap - Math.PI * 0.6];
      const aT = Math.abs(wrapA(cands[0] - a0)) < Math.abs(wrapA(cands[1] - a0)) ? cands[0] : cands[1];
      const far = r0 > 16;
      const O = { cx: C.x, cz: C.z, gy, a: far ? aT : a0, aT: a0 + wrapA(aT - a0), r: far ? 6 : r0, y: far ? 2.6 : cam.pos.y - gy, dir: Math.sign(wrapA(aT - a0)) || 1, cut: rg >= 6, half: rg < 6 ? rg / 2 : 0 };
      cam.cup = O;
      setCam('cup', 14, far);
    }

    async function celebrate(shot, gen, d0) {
      phase = 'holed';
      const { res, inp } = shot;
      const G = golfers[cur.p], pal = G.pal, st = stats[cur.p];
      const club = CLUBS[inp.club];
      cur.holed = true;
      const strokes = cur.strokes, diff = strokes - M.par;
      if (strokes <= M.par - 2) cur.gir = true;
      refreshHud();
      // the player chip counts this hole now (the card itself is written once the hole is over)
      const tpNow = toParFor(cur.p) + diff, pb = hud.playerChip.querySelector('b');
      if (pb) { pb.textContent = toParText(tpNow); pb.classList.toggle('over', tpNow > 0); }
      const name = scoreName(strokes, M.par);
      const crowd = vis && vis.crowd;
      if (crowd) crowd.setMood('idle');
      const pinAt = V(M.pin.x, groundPin() + 0.2, M.pin.z);
      if (club.putter && !shot.gimme) st.longPutt = Math.max(st.longPutt, res.total);
      if (swing) { swing = null; }
      G.posing = false;
      pal.releasePose(0.3);
      cupCam();
      pal.lookAt(null);
      // fireworks go up beyond the cup as the camera sees it, and the camera tilts up to catch them
      const O = cam.cup;
      const sky = (dist, n) => {
        const a = O.aT;
        const x = O.cx - Math.sin(a) * dist, z = O.cz - Math.cos(a) * dist;
        world.fireworks(scene, V(x, heightAt(M, x, z) + 1, z), { count: n });
        O.lookUp = 3;
      };
      let sub = shot.gimme ? 'Tap-in' : club.putter ? (d0 >= 8 ? 'What a putt! ' + d0.toFixed(1) + ' m' : d0.toFixed(1) + ' m putt') : strokes > 1 ? 'Holed from ' + Math.round(d0) + ' m!' : Math.round(d0) + ' m · ' + CLUBS[inp.club].name;
      let wait = 2.2, anim = 'clap';
      if (strokes === 1) {
        st.hio++;
        ui.banner('HOLE IN ONE!', { kind: 'huge', sub, duration: 3 });
        audio.sfx('jingle_perfect');
        audio.sfx('crowd_cheer', { intensity: 1 });
        audio.duck(0.3, 3);
        sky(30, 5);
        world.confetti(scene, V(M.pin.x, groundPin() + 4, M.pin.z), { count: 160, spread: 4 });
        if (crowd) crowd.cheer(1, 4);
        anim = 'dance'; pal.setExpression('joy', 4);
        if (cur.p === 0 && !debugTouched) ctx.awardMedal('platinum');
        wait = 4;
      } else if (diff <= -2) {
        ui.banner(name.toUpperCase() + '!', { kind: 'huge', sub, duration: 2.6 });
        audio.sfx('fanfare_big');
        audio.sfx('crowd_cheer', { intensity: 1 });
        sky(28, 3);
        world.confetti(scene, pinAt, { count: 120, spread: 3 });
        if (crowd) crowd.cheer(1, 3.5);
        anim = 'jump'; pal.setExpression('joy', 3);
        wait = 3.2;
      } else if (diff === -1) {
        ui.banner('BIRDIE!', { kind: 'great', sub, duration: 2 });
        audio.sfx('fanfare_small');
        audio.sfx('crowd_cheer', { intensity: 0.8 });
        world.confetti(scene, pinAt, { count: 70, spread: 2 });
        if (crowd) crowd.cheer(0.8, 2.5);
        anim = 'cheer'; pal.setExpression('joy', 2.5);
        wait = 2.6;
      } else if (diff === 0) {
        ui.banner('PAR', { kind: 'good', sub, duration: 1.7 });
        audio.sfx('crowd_applause', { intensity: 0.6 });
        if (crowd) crowd.cheer(0.4, 1.5);
        anim = 'clap'; pal.setExpression('happy', 2);
        wait = 1.9;
      } else {
        ui.banner(name.toUpperCase(), { kind: 'info', sub, duration: 1.6 });
        audio.sfx('crowd_applause', { intensity: 0.25 });
        anim = diff >= 2 ? 'shrug' : 'clap'; pal.setExpression(diff >= 2 ? 'sad' : 'neutral', 2);
        wait = 1.8;
      }
      pal.play(anim);
      if (O.lookUp) ctx.wait(1.9).then(() => { if (cam.cup === O) O.lookUp = 0; });
      if (club.putter && !shot.gimme && d0 >= 8 && diff > -1) audio.sfx('crowd_cheer', { intensity: 0.7 });
      // holed from afar: the cup first, then cut to the golfer celebrating
      if (cam.cup.cut && !autoplay) {
        ctx.wait(O.lookUp ? 2.5 : Math.min(1.5, wait * 0.45)).then(() => {
          if (gen === flowGen && phase === 'holed') { setCam('react', 8, true); pal.play(anim); }
        });
      }
      await skippable(autoplay ? 0.8 : wait);
    }

    // ---- scorecard between holes ------------------------------------------------------------------
    function scoreCell(s, par) {
      if (s == null) return '';
      const d = s - par;
      const cls = d <= -2 ? 'e' : d === -1 ? 'b' : d === 1 ? 'o' : d >= 2 ? 'oo' : '';
      return '<i class="' + cls + '">' + s + '</i>';
    }

    function scorecardTable(curHole) {
      const head = holeList.map((h, k) => '<th class="' + (k === curHole ? 'cur' : '') + '">' + (h + 1) + '</th>').join('');
      const parRow = holeList.map((h, k) => '<td class="' + (k === curHole ? 'cur' : '') + '">' + HOLES[h].par + '</td>').join('');
      let rows = '';
      players.forEach((pl, p) => {
        let tot = 0, any = false;
        const cells = holeList.map((h, k) => {
          const s = cards[p][k];
          if (s != null) { tot += s; any = true; }
          return '<td class="' + (k === curHole ? 'cur' : '') + '">' + scoreCell(s, HOLES[h].par) + '</td>';
        }).join('');
        const tp = toParFor(p);
        const img = ui.portraitImg(pl.profile, 22).outerHTML;
        rows += '<tr><td class="nm">' + img + '<span>' + ui.esc(pl.profile.name) + '</span></td>' + cells + '<td class="tot">' + (any ? tot : '–') + '</td><td class="tot">' + (any ? toParText(tp) : '') + '</td></tr>';
      });
      return '<table class="ss-scorecard"><tr><th>Hole</th>' + head + '<th>Tot</th><th>±</th></tr><tr class="par"><td class="nm">Par</td>' + parRow +
        '<td class="tot">' + totalPar + '</td><td></td></tr>' + rows + '</table>';
    }

    async function showScorecard(gen) {
      phase = 'card';
      setAimUi(false);
      // a skipped celebration must not leave its banner or the shot report over the card
      hud.report.classList.add('gf-off');
      ui.fx.querySelectorAll('.ss-banner').forEach(n => n.remove());
      const last = hi === holeList.length - 1;
      if (!last) prepareHole(holeList[hi + 1]);
      const wrap = ui.el('div', 'gf-scwrap ss-block');
      const panel = ui.el('div', 'gf-sc ss-panel ss-pop');
      const title = last ? 'Final Scorecard' : 'Hole ' + (holeList[hi] + 1) + ' done!';
      const lead = players.length > 1 ? leaderLine() : toParText(toParFor(0)) + ' after ' + (hi + 1) + (hi ? ' holes' : ' hole');
      panel.innerHTML = '<h3>' + title + '<small>' + ui.esc(lead) + '</small></h3><div class="gf-scroll">' + scorecardTable(hi) + '</div>';
      let done = null;
      const btn = ui.button(last ? 'See Results' : 'Next Hole', () => { if (done) done(); }, { kind: 'primary', icon: last ? 'trophy' : 'flag', className: 'accent' });
      panel.appendChild(btn);
      wrap.appendChild(panel);
      ctx.hud.appendChild(wrap);
      audio.sfx('ui_open');
      let stopPoll = null;
      await new Promise(resolve => {
        const fin = () => { done = null; if (skipWaiter === fin) skipWaiter = null; if (stopPoll) stopPoll(); resolve(); };
        done = fin;
        skipWaiter = fin;
        // autoplay moves on by itself; a card left behind by debug.skipTo just stops polling
        stopPoll = ctx.every(0.5, () => { if (gen !== flowGen) stopPoll(); else if (autoplay && done) done(); });
      });
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 260);
      if (gen === flowGen) audio.sfx('ui_close');
    }

    function leaderLine() {
      const order = players.map((p, i) => ({ i, tp: toParFor(i) })).sort((a, b) => a.tp - b.tp);
      const best = order[0];
      const tied = order.filter(o => o.tp === best.tp).length;
      const nm = players[best.i].profile.name;
      return tied > 1 ? 'All square at ' + toParText(best.tp) : (nm.toLowerCase() === 'you' ? 'You lead' : nm + ' leads') + ' at ' + toParText(best.tp);
    }

    // =============================================================================================
    // Autoplay
    // =============================================================================================

    async function autoShot() {
      const turn = cur, strokes = cur.strokes;
      const ok = () => autoplay && cur === turn && phase === 'aim' && cur.strokes === strokes && ctx.alive;
      const it = planGen(M, cur.ball, wind);
      let r = it.next();
      while (!r.done) {
        await ctx.wait(0);
        if (!ok()) return;
        r = it.next();
      }
      const plan = humanize(r.value, 0.85, rng);
      if (plan.club !== cur.club) setClub(plan.club);
      const target = cur.aim + wrapA(plan.aim - cur.aim);
      await U.tween(cur, { aim: target }, 0.35, { ease: 'inOutQuad', onUpdate: () => { placeGolfer(); ringDirty = true; } });
      if (!ok()) return;
      plan.aim = cur.aim;
      await U.tween(gest, { pull: plan.power }, CLUBS[plan.club].putter ? 0.35 : 0.5, { ease: 'outQuad' });
      await ctx.wait(0.12);
      if (ok()) commitShot(plan);
    }

    // =============================================================================================
    // Results
    // =============================================================================================

    function finishGame() {
      phase = 'done';
      setAimUi(false);
      const totals = players.map((p, i) => cards[i].reduce((a, s) => a + (s || 0), 0));
      const tps = players.map((p, i) => toParFor(i));
      const order = players.map((p, i) => i).sort((a, b) => totals[a] - totals[b]);
      const placeOf = i => 1 + totals.filter(t => t < totals[i]).length;
      const best = order[0];
      const records = [];
      const pid = prof => (prof.isGuest ? null : prof.id);
      // hot-seat: the results line names whose record it is (the stored label stays plain)
      const rec = (key, value, label, fmt, prof, higher, shown, who) => {
        const r = debugTouched ? null : save.record(DEF.id, key, value, { higherIsBetter: higher, profileId: pid(prof), label, fmt });
        records.push({ label: players.length > 1 ? label + ' · ' + (who || prof.name) : label, value: shown, isNew: !!(r && r.isNew) });
      };
      const bestNames = players.filter((p, i) => totals[i] === totals[best]).map(p => p.profile.name).join(' & ');
      rec('best_' + mode, totals[best], 'Best ' + modeName, '{v} strokes', players[best].profile, false, totals[best] + ' (' + toParText(tps[best]) + ')', bestNames);
      const driveI = stats.reduce((b, s, i) => (s.drive > stats[b].drive ? i : b), 0);
      if (stats[driveI].drive > 0) rec('drive', Math.round(stats[driveI].drive), 'Longest Drive', 'meters', players[driveI].profile, true, Math.round(stats[driveI].drive) + ' m');
      const puttI = stats.reduce((b, s, i) => (s.longPutt > stats[b].longPutt ? i : b), 0);
      if (stats[puttI].longPutt > 0) {
        const v = Math.round(stats[puttI].longPutt * 10) / 10;
        rec('putt', v, 'Longest Putt Holed', 'meters', players[puttI].profile, true, U.fmt.meters(v));
      }
      // medals: the first player's round
      const medals = [];
      const award = id => { if (!debugTouched && ctx.awardMedal(id)) medals.push(id); };
      const tp0 = tps[0];
      if (mode === 'beginner' && tp0 <= 0) award('bronze');
      if (mode === 'expert' && tp0 <= 0) award('silver');
      if (mode === 'full9' && tp0 < 0) award('gold');
      // skill: strokes better than this mode expects at the player's level (from debug.simulate: a
      // rookie plays like quality ≈ 0.35, a legend like ≈ 1); a stroke is worth more in a 3-hole round
      const deltaFor = i => {
        const lvl = ctx.skillFor(players[i].profile);
        const expected = lerp(RULES.expect[0], RULES.expect[1], clamp(lvl / 2500, 0, 1)) * holeList.length;
        const per = holeList.length === 9 ? 4 : 7;
        return Math.round(clamp(4 + (expected - tps[i]) * per, -40, 80));
      };
      const s0 = stats[0];
      const solo = players.length === 1;
      let statsOut;
      if (solo) {
        statsOut = [
          { label: 'Birdies or better', value: String(s0.birdies + s0.eagles) },
          { label: 'Pars', value: String(s0.pars) },
          { label: 'Putts', value: String(s0.putts) },
        ];
        if (s0.firN) statsOut.push({ label: 'Fairways', value: s0.fir + '/' + s0.firN });
        statsOut.push({ label: 'Greens in Reg.', value: s0.gir + '/' + holeList.length });
        if (s0.drive > 0) statsOut.push({ label: 'Longest Drive', value: Math.round(s0.drive) + ' m' });
        if (s0.pens) statsOut.push({ label: 'Penalty Strokes', value: String(s0.pens) });
      } else {
        // hot-seat: three group bests (who did it, and the number), not a tile per player per stat
        statsOut = [];
        const leader = (val, low) => {
          let bi = 0;
          for (let i = 1; i < players.length; i++) if (low ? val(i) < val(bi) : val(i) > val(bi)) bi = i;
          const tied = players.filter((_, i) => val(i) === val(bi)).length > 1;
          return { v: val(bi), who: tied ? 'Tied' : players[bi].profile.name };
        };
        const bird = leader(i => stats[i].birdies + stats[i].eagles);
        if (bird.v > 0) statsOut.push({ label: 'Most birdies+ · ' + bird.who, value: String(bird.v) });
        else { const pr = leader(i => stats[i].pars); statsOut.push({ label: 'Most pars · ' + pr.who, value: String(pr.v) }); }
        const pt = leader(i => stats[i].putts, true);
        statsOut.push({ label: 'Fewest putts · ' + pt.who, value: String(pt.v) });
        const dr = leader(i => Math.round(stats[i].drive));
        if (dr.v > 0) statsOut.push({ label: 'Longest drive · ' + dr.who, value: dr.v + ' m' });
        else { const pn = leader(i => stats[i].pens, true); statsOut.push({ label: 'Fewest penalties · ' + pn.who, value: String(pn.v) }); }
      }
      const hio = stats.some(s => s.hio > 0);
      let title;
      if (!solo) {
        const tied = totals.filter(t => t === totals[best]).length > 1;
        const nm = players[best].profile.name;
        title = tied ? "It's a Tie!" : nm.toLowerCase() === 'you' ? 'You Win!' : nm + ' Wins!';
      } else if (hio) title = 'Hole in One Hero!';
      else title = tp0 < 0 ? 'Under Par!' : tp0 === 0 ? 'Right on Par!' : tp0 <= holeList.length / 3 ? 'Nice Round!' : 'Good Effort!';
      const goodLine = mode === 'beginner' ? 0 : mode === 'expert' ? 1 : 2;
      const good = tp0 <= goodLine || hio;
      ctx.finish({
        outcome: solo ? (good ? 'win' : 'done') : 'done',
        title,
        headline: String(totals[solo ? 0 : best]),
        headlineLabel: 'Strokes · ' + (tps[solo ? 0 : best] === 0 ? 'even par' : Math.abs(tps[solo ? 0 : best]) + (tps[solo ? 0 : best] < 0 ? ' under par' : ' over par')),
        players: players.map((p, i) => ({
          profileId: p.profile.id, name: p.profile.name, profile: p.profile, score: totals[i] + ' (' + toParText(tps[i]) + ')',
          place: placeOf(i), isCpu: false, skillDelta: debugTouched ? 0 : deltaFor(i),
        })),
        stats: statsOut,
        records,
        medals,
        celebrate: good || medals.length > 0 || records.some(r => r.isNew),
      });
    }

    // =============================================================================================
    // Frame loop
    // =============================================================================================

    const _bp = V();
    function updateGolfers(dt) {
      for (let i = 0; i < golfers.length; i++) {
        const G = golfers[i];
        if (!G.pal.root.visible) continue;
        if (cur && i === cur.p && !swing && !G.reacting && (phase === 'aim' || phase === 'setup' || phase === 'turn')) {
          const top = isPutt() ? ALPHA_PUTT : ALPHA_TOP;
          const target = gest.pull * top;
          G.shown = U.damp(G.shown, target, 22, dt);
          golferPose(G, G.shown, 26);
        }
        if (phase === 'holed' && cam.mode === 'cup' && cur && i === cur.p) {
          // celebrate toward the camera
          const pr = G.pal.root.position, want = Math.atan2(cam.pos.x - pr.x, cam.pos.z - pr.z);
          G.pal.setFacing(G.pal.root.rotation.y + wrapA(want - G.pal.root.rotation.y) * (1 - Math.exp(-5 * dt)));
        }
        G.pal.update(dt);
        syncClub(G, dt);
        if (phase === 'aim' && cur && i === cur.p) G.pal.lookAt(_bp.set(cur.ball.x, cur.ball.y, cur.ball.z));
        else if (G.reacting) G.pal.lookAt(camera.position);
        else if ((phase === 'shot' || phase === 'react') && ball.visible) G.pal.lookAt(ball.position);
      }
    }

    function updateBallVisual() {
      const camP = camera.position;
      const cd = camP.distanceTo(ball.position);
      // a shot in play is drawn bigger and haloed until it rests, so it reads as a ball, not a speck
      const flying = !!play && !play.putt && ball.visible;
      const sc = flying ? clamp(cd / 5, 1, play.landed ? 12 : 18) : clamp(cd / 9, 1, 12);
      ball.scale.setScalar(sc);
      halo.visible = flying;
      if (flying) { halo.position.copy(ball.position); halo.scale.setScalar(0.036 * sc * 4.2); }
      ballShadow.visible = ball.visible && !!M;
      if (ballShadow.visible) {
        const g = heightAt(M, ball.position.x, ball.position.z);
        const h = Math.max(0, ball.position.y - g);
        ballShadow.position.set(ball.position.x, g + 0.015, ball.position.z);
        const s = clamp(1 + h * 0.05, 1, 3) * clamp(cd / 9, 1, 10);
        ballShadow.scale.set(s, 1, s);
        ballShadow.material.opacity = 0.45 * clamp(1 - h / 25, 0.15, 1);
      }
      if (ballMark.visible) {
        ballMark.position.set(ball.position.x, ball.position.y + 2, ball.position.z);
        ballMark.scale.setScalar(clamp(cd * 0.03, isPutt() ? 0.4 : 1, 30));
      }
      pinMark.visible = ballMark.visible && isPutt();
      if (pinMark.visible) {
        pinMark.position.set(M.pin.x, groundPin() + 2, M.pin.z);
        pinMark.scale.setScalar(clamp(camP.distanceTo(pinMark.position) * 0.022, 0.3, 30));
      }
    }

    function update(dt, t) {
      if (play) updatePlay(dt);
      if (swing) updateSwing(dt);
      updateAimInput(dt);
      updateGolfers(dt);
      updateBallVisual();
      updateFly(dt);
      updateCamera(dt);
      updateTrail();
      updateAimVisuals(dt, t);
      updateSlope(dt, t);
      updateFlag(dt, t);
      updateWindDial();
      refreshMapUi();
      drawMini();
      // low clouds would blot the overhead map; a core toast (medal) tucks the left column away
      if (clouds) clouds.visible = cam.mode !== 'map';
      hud.left.classList.toggle('gf-tuck', !!ui.fx.querySelector('.ss-toast:not(.is-out)'));
      rippleTex.offset.set((t * 0.012) % 1, (t * 0.02) % 1);
      if (play && !play.putt) env.setShadowFocus(ball.position, 40);
    }

    // first frame: hole 1 built, camera on the tee
    buildHole(holeList[0]);
    {
      const tb = teeBall();
      ball.position.set(tb.x, tb.y, tb.z);
      peg.position.set(tb.x, tb.y - BALL_R - 0.02, tb.z);
      const T = M.tee.dir;
      cam.goalPos.set(-T[0] * 16, M.elevAt(0) + 9, -T[1] * 16);
      cam.goalLook.set(T[0] * 60, M.elevAt(40), T[1] * 60);
      setCam('free', 10, true);
      hud.left.classList.add('gf-off');
      setAimUi(false);
      refreshHud();
      hud.strokeChip.textContent = M.holeLen + ' m';
      updateCamera(0);
    }

    return {
      start() {
        if (started) return;
        started = true;
        ambience = audio.loop('park_ambience', { vol: 0.5 });
        windLoop = audio.loop('wind', { vol: clamp(wind.speed / 6, 0, 1) * 0.35 });
        run(startHi);
      },
      update,
      onPause() { dropSwing(); },
      /** A rotation mid-pull would leave the meter at the old size and place: drop the press. */
      onResize() { dropSwing(); },
      dispose() {
        flowGen++;
        window.removeEventListener('pointermove', onRawMove, true);
        if (ambience) ambience.stop(0.3);
        if (windLoop) windLoop.stop(0.3);
        ambience = windLoop = null;
        if (hintHandle) hintHandle.hide();
        clearTimeout(hud.reportT);
        clearTimeout(streakT);
        U.killTweens(gest);
        if (cur) U.killTweens(cur);
        trail.dispose();
        for (const G of golfers) G.pal.dispose();
        disposeHole();
        for (const o of owned) o.dispose();
        camera.near = near0; camera.far = far0; camera.updateProjectionMatrix();
        shotWaiter = null; skipWaiter = null; play = null; swing = null;
      },
      debugState() {
        const b = cur ? cur.ball : null;
        return {
          phase, mode, autoplay,
          hole: M ? M.index + 1 : null, holeIndex: hi, holeName: M ? M.name : null, par: M ? M.par : null,
          player: cur ? cur.p : null, stroke: cur ? cur.strokes + 1 : null,
          lie: b ? b.surf : null,
          ball: b ? { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2) } : null,
          toPin: cur ? +distToPin().toFixed(2) : null,
          club: cur ? CLUBS[cur.club].id : null,
          aimDeg: cur ? +(wrapA(cur.aim - headingTo(cur.ball.x, cur.ball.z, M.pin.x, M.pin.z)) / DEG).toFixed(1) : null,
          wind: { speed: +wind.speed.toFixed(1), dirDeg: Math.round(wind.dir / DEG) },
          ring: ringInfo && ringInfo.dist != null ? { dist: +ringInfo.dist.toFixed(1), blocked: !!ringInfo.block, wind: ringInfo.ghost ? { x: +ringInfo.ghost.x.toFixed(1), z: +ringInfo.ghost.z.toFixed(1) } : null } : null,
          debugTouched,
          pinPower: cur ? +pinPower().toFixed(3) : null,
          scores: cards.map(c => c.slice()), toPar: players.map((p, i) => toParFor(i)),
          camera: cam.mode, map: mapOn, playing: !!play, lastShot, lastOutcome,
        };
      },
      debug: {
        /** Plays every shot (planned, with human-like error) and every menu until the round ends. */
        autoplay(on) {
          autoplay = on !== false;
          if (autoplay) {
            if (hintHandle) { hintHandle.hide(); hintHandle = null; }
            press.mode = null; keyCharge = null; showGauge(false);
            uiAimOn = null;
            setAimUi(phase === 'aim');
            if (phase === 'aim' && shotWaiter) autoShot();
            if (skipWaiter) skipWaiter();
          } else { uiAimOn = null; setAimUi(phase === 'aim'); }
          return autoplay;
        },
        /** Jumps to hole i (0-based index into this mode's holes); earlier holes count as par. */
        skipTo(i) {
          const k = clamp(i | 0, 0, holeList.length - 1);
          if (k > 0 || started) debugTouched = true;
          players.forEach((p, pi) => holeList.forEach((h, j) => { cards[pi][j] = j < k ? HOLES[h].par : null; }));
          if (!started) { startHi = k; return true; }
          shotWaiter = null; skipWaiter = null; play = null; swing = null; fly = null;
          press.mode = null; keyCharge = null; showGauge(false); closeMap(); showSkip(false);
          trail.visible = false; trail.clear(); flyMark.visible = false;
          if (cur) U.killTweens(cur);
          engine.slowmo(1, 0);
          ctx.hud.querySelectorAll('.gf-scwrap, .gf-turnwrap').forEach(n => n.remove());
          run(k);
          return true;
        },
        /** Hits now: { club (id or index), aimDeg (vs the pin), power (0..1.1), accuracy (flick error deg, + right), curve, tempo }. */
        shot(o = {}) {
          if (phase !== 'aim' || !cur) return false;
          let ci = cur.club;
          if (o.club != null) { const k = typeof o.club === 'number' ? o.club : CLUBS.findIndex(c => c.id === o.club || c.name === o.club); if (k >= 0) ci = k; }
          if (ci !== cur.club) setClub(ci);
          if (o.aimDeg != null) setAim(headingTo(cur.ball.x, cur.ball.z, M.pin.x, M.pin.z) + o.aimDeg * DEG);
          const pp = pinPower();
          const power = o.power != null ? o.power : CLUBS[ci].putter ? (pp > 0 && pp <= 1 ? pp : distToPin() / puttScale(distToPin())) : 1;
          return commitShot({ club: ci, aim: cur.aim, power: clamp(power, 0.02, 1.1), flick: (o.accuracy || 0) * DEG, curve: o.curve || 0, tempo: o.tempo == null ? 1 : o.tempo, scale: CLUBS[ci].putter ? puttScale(distToPin()) : undefined });
        },
        /** Moves the current ball (aim phase): { toPin: m } on the line to the pin, or { x, z }. */
        placeBall(o = {}) {
          if (phase !== 'aim' || !cur) return false;
          let x = o.x, z = o.z;
          if (o.toPin != null) {
            const h = headingTo(M.pin.x, M.pin.z, M.tee.x, M.tee.z) + (o.angleDeg || 0) * DEG;
            const [dx, dz] = headingDir(h);
            x = M.pin.x + dx * o.toPin; z = M.pin.z + dz * o.toPin;
          }
          if (x == null || z == null) return false;
          debugTouched = true;
          cur.ball = { x, z, y: 0, surf: surfaceAt(M, x, z) };
          const w = shotWaiter;
          shotWaiter = null;
          prepareShot(false, true);
          phase = 'aim';
          shotWaiter = w;
          refreshHud();
          setCam('aim', 6, true);
          return true;
        },
        /** Skips the current flyover / celebration / turn card / scorecard. */
        skip() {
          if (skipWaiter) skipWaiter();
          ui.fx.querySelectorAll('.ss-titlecard').forEach(n => n.remove());
          return true;
        },
        /**
         * Headless tuning stats: plays n holes per quality with the planner + human error, and measures
         * how flick error maps to dispersion. opts: { quality, hole (course hole 1–9) }.
         */
        simulate(n = 6, opts = {}) {
          const qualities = opts.quality != null ? [opts.quality] : [1, 0.85, 0.6, 0.35];
          const holes = opts.hole != null ? [clamp(opts.hole - 1, 0, 8)] : holeList;
          const srng = SS.util.rng(ctx.seed + 991);
          const models = holes.map(h => { if (M && M.index === h) return M; const m = buildHoleModel(h); plantTrees(m); return m; });
          const out = { holes: holes.map(h => h + 1), par: holes.reduce((a, h) => a + HOLES[h].par, 0), byQuality: {} };
          for (const q of qualities) {
            let strokes = 0, putts = 0, gir = 0, fir = 0, firN = 0, holesPlayed = 0;
            const dist = {};
            models.forEach(m => {
              for (let k = 0; k < n; k++) {
                const w = windFor(m, srng);
                const r = playHoleHeadless(m, w, q, srng, RULES);
                strokes += r.strokes; putts += r.putts; gir += r.gir ? 1 : 0; holesPlayed++;
                if (r.fir != null) { firN++; fir += r.fir ? 1 : 0; }
                const nm = scoreName(r.strokes, m.par);
                dist[nm] = (dist[nm] || 0) + 1;
              }
            });
            out.byQuality[q] = {
              avgToParPerRound: +((strokes - n * out.par) / n).toFixed(2), puttsPerHole: +(putts / holesPlayed).toFixed(2),
              fairways: firN ? Math.round(fir / firN * 100) + '%' : '-', greensInReg: Math.round(gir / holesPlayed * 100) + '%', scores: dist,
            };
          }
          // input → outcome: an approach from about 140 m (the nearest fairway spot on the line back
          // from the pin, else rough) with the club the game suggests, by flick error σ (deg)
          const m0 = models[0];
          const spot = { x: 0, z: 0, surf: 'fairway', d: 140 };
          for (const want of ['fairway', 'rough']) {
            let found = false;
            for (let k = 0; k < 80 && !found; k++) {
              const dd = 140 + (k % 2 ? 1 : -1) * Math.ceil(k / 2);
              const x = m0.pin.x - m0.endDir[0] * dd, z = m0.pin.z - m0.endDir[1] * dd;
              if (surfaceAt(m0, x, z) === want) { Object.assign(spot, { x, z, surf: want, d: dd }); found = true; }
            }
            if (found) break;
          }
          spot.y = heightAt(m0, spot.x, spot.z) + BALL_R;
          const aClub = suggestClub(m0, spot);
          const disp = { from: spot.d + ' m ' + spot.surf, club: CLUBS[aClub].id };
          for (const sigma of [0, 3, 6, 10, 15]) {
            let miss = 0, onGreen = 0;
            for (let k = 0; k < 40; k++) {
              const b = { x: spot.x, z: spot.z, surf: spot.surf };
              b.y = heightAt(m0, b.x, b.z) + BALL_R;
              const { L } = launchFor(m0, b, { club: aClub, aim: headingTo(b.x, b.z, m0.pin.x, m0.pin.z), power: 0.97, flick: gauss(srng) * sigma * DEG, curve: 0, tempo: 1, dead: RULES.dead }, srng);
              const r = simulateShot(m0, L, {});
              miss += Math.hypot(r.rest.x - m0.pin.x, r.rest.z - m0.pin.z);
              if (r.surf === 'green' || r.outcome === 'holed') onGreen++;
            }
            disp['flickSigma' + sigma] = { avgMissM: +(miss / 40).toFixed(1), greenPct: Math.round(onGreen / 40 * 100) };
          }
          out.approach = disp;
          return out;
        },
      },
    };
  }


  SS.registerSport(DEF);
})();
