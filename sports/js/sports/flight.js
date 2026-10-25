/* Sunny Sports — sports/flight.js
 * FLIGHT over "Sunny Isle": a toy prop plane, a Pal in the open cockpit and a whole island to swoop over.
 *  · Venue: one ~1.5 km island built from an analytic heightfield (coast, beaches, hills, a mountain with
 *    a waterfall and river gorge, venue pads) baked into a single vertex-colored grid mesh, a cheap
 *    animated sea, instanced trees/houses/boats/birds, one merged mesh for every static landmark and one
 *    atlas-textured decal mesh for the courts, fields and signs. The four other sports' venues sit on it.
 *  · Control: touch-and-drag anywhere is a floating virtual stick (sideways banks and turns, up climbs,
 *    down dives; release auto-levels), BOOST / BRAKE are held buttons, keyboard and mouse work the same.
 *  · Flight model: arcade and forgiving. Coordinated turns from bank, a gentle energy trade on climbs and
 *    dives, no stalls, a soft ceiling, bounce-back bumps instead of crashes and spray skims on the water.
 *  · Modes: balloons (Balloon Pop, 2:00 a turn), rings (Ring Run time trial), tour (Island Tour, 5:00,
 *    built around the 40 "!" info markers). 1–4 players fly hot-seat turns.
 *  · "!" markers persist per profile (save.data.stats.flight[profileId].markers) and can be collected in
 *    every mode; Island Tour shows an info card for each one.
 *  · Debug: instance.debug = { autoplay, teleport, popAll, collectAll, resetMarkers, skip, … } and debugState().
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // =============================================================================================
  // 1. Registration data
  // =============================================================================================

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<path d="M47.5 22.5 50 30" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<ellipse cx="46" cy="14" rx="8.6" ry="10" fill="#FF5A5F"/>' +
    '<ellipse cx="43.2" cy="10.6" rx="2.4" ry="3.4" fill="#FF9A9D" transform="rotate(-20 43.2 10.6)"/>' +
    '<path d="M44.6 23.6h2.8l-1.4 2.2z" fill="#D9363C"/>' +
    '<path d="M9 40.5c0-3 3-5 7-5h22c6 0 11 2.6 11 6s-5 6-11 6H17c-4.6 0-8-3-8-7z" fill="#FF9F1C"/>' +
    '<path d="M9.5 38.6c4-1.4 9-1.8 13.4-1.4" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    '<path d="M8.6 39.5 4.5 29.5c-.4-1 .4-2 1.4-1.8l3.2.6 5.4 9.2z" fill="#FF9F1C"/>' +
    '<path d="M20 43.8 32.6 41l-6 15.6c-.5 1.2-2 1.6-3 .8l-2-1.6z" fill="#E07F00"/>' +
    '<path d="M21.6 38.6 30.4 36l-2.2-11.2c-.3-1.3-1.8-1.8-2.8-1l-2 1.6z" fill="#FFB547"/>' +
    '<circle cx="30" cy="35.6" r="4.4" fill="#FFD9B8"/>' +
    '<path d="M25.6 34.8c.4-3.4 2.4-5 4.6-5s4.2 1.6 4.4 5z" fill="#6B4A2E"/>' +
    '<path d="M27 37.2c1.4 1 3.2 1.2 4.6.4" stroke="#24324A" stroke-width="1" stroke-linecap="round" fill="none"/>' +
    '<path d="M26 39.4c-2 .4-5.2 1.6-7.4.4" stroke="#3FB8FF" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
    '<rect x="48.6" y="37.4" width="3.6" height="8.4" rx="1.4" fill="#24324A"/>' +
    '<ellipse cx="53.2" cy="41.6" rx="2.2" ry="9.6" fill="#24324A" opacity=".22"/>' +
    '<circle cx="50.6" cy="41.6" r="2.2" fill="#FFC93C"/>' +
    '<circle cx="19" cy="49.6" r="2.6" fill="#24324A"/><circle cx="36" cy="49.6" r="2.6" fill="#24324A"/>' +
    '</svg>';

  const DEF = {
    id: 'flight',
    name: 'Flight',
    tagline: 'Swoop, loop and pop!',
    accent: '#FF9F1C',
    tint: '#FFF1DC',
    icon: ICON,
    music: 'flight',
    players: { min: 1, max: 4 },
    opponent: false,
    modes: [
      { id: 'balloons', name: 'Balloon Pop', desc: 'Two minutes to pop balloons all over the island. Chain them for combos!' },
      { id: 'rings', name: 'Ring Run', desc: 'Thread the rings all around Sunny Isle against the clock.' },
      { id: 'tour', name: 'Island Tour', desc: 'Five minutes of free flight. Visit the "!" markers: a new one is worth 3, a revisit 1.' },
    ],
    howTo: {
      steps: [
        { gesture: 'drag-h', text: 'Touch and drag anywhere: sideways to bank and turn' },
        { gesture: 'drag-down-up', text: 'Drag up to climb, down to dive. Let go to level out' },
        { gesture: 'hold', text: 'Hold BOOST to zoom, BRAKE for tight turns' },
        { gesture: 'drag-h', text: 'Fly through balloons, rings and "!" markers' },
      ],
      tips: [
        'Bumps never end your flight: you bounce back and keep going.',
        'Pop balloons quickly one after another for a combo. Gold ones are +5 points and +5 seconds!',
        'BOOST runs out. It refills on its own, and faster with every balloon and ring.',
        'Every "!" you find is saved. Can you find all 40?',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Score 25 points in Balloon Pop' },
      { id: 'silver', name: 'Silver', desc: 'Finish Ring Run in under 2:40' },
      { id: 'gold', name: 'Gold', desc: 'Score 60 points in Balloon Pop' },
      { id: 'platinum', name: 'Platinum', desc: 'Find all 40 "!" markers' },
    ],
    create,
  };

  // =============================================================================================
  // 2. Constants & tuning
  // =============================================================================================

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  const FLY = {
    vBrake: 18, vCruise: 30, vBoost: 50, vMin: 16, vMax: 56,
    accel: 0.9,                 // 1/s toward the throttle speed
    gravityTrade: 5.2,          // m/s² of speed traded per unit sin(pitch)
    maxBank: 62 * DEG,
    maxClimb: 34 * DEG, maxDive: 42 * DEG,
    turnRate: 0.95,             // rad/s at full bank (cruise); a little more when slow
    bankLambda: 4.2, pitchLambda: 2.8, levelLambda: 1.8,
    rollLevelLambda: 5,         // roll-out on release: crisp, so a turn stops close to where you let go
    ceiling: 300, hardCeiling: 360,
    dead: 0.1,                  // stick dead zone (fraction of the stick radius)
    boostDrain: 0.2, boostRefill: 0.085, boostDelay: 0.7,
    stunTime: 1.5,
    radius: 2.4,                // collision radius of the plane (m)
    // the friendly breeze: past `edge` the island is pointed out, past `breeze` the wind turns the plane home
    edge: 1050, breeze: 1150, breezeFull: 1400, leash: 1450,
  };

  const MODE_RULES = {
    balloons: { time: 120 },
    rings: { time: null, missPenalty: 3, ringTimeout: 30, silver: 160 },
    tour: { time: 300, hintCooldown: 16, hintShow: 12, ptsNew: 3, ptsRevisit: 1 },
  };

  const MARKER_COUNT = 40;
  const MARKER_R = 9;           // fly within this of a "!" to collect it
  const BALLOON_R = 2.3;
  const POP_R = 5.6;            // plane centre to balloon centre
  const RING_R = 8.5;           // inner radius of a ring
  const COMBO_WINDOW = 3;

  // =============================================================================================
  // 3. Math helpers & noise
  // =============================================================================================

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function sstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function wrapA(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function hash2(i, j, seed) {
    let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, z, seed) {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, seed, oct = 4) {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let o = 0; o < oct; o++) { s += vnoise(x * f, z * f, seed + o * 17) * amp; n += amp; amp *= 0.5; f *= 2.03; }
    return s / n;
  }
  /** Distance from (x, z) to segment a→b, and the parameter t along it. */
  function segDist(x, z, ax, az, bx, bz, out) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const px = ax + dx * t - x, pz = az + dz * t - z;
    out.d = Math.sqrt(px * px + pz * pz); out.t = t;
    return out;
  }
  /** Distance to a polyline [[x, z], …] and the arc-length fraction along it. */
  function polyDist(x, z, pts, lens, total, out) {
    let best = Infinity, bt = 0;
    const s = { d: 0, t: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], s);
      if (s.d < best) { best = s.d; bt = (lens[i] + s.t * (lens[i + 1] - lens[i])) / total; }
    }
    out.d = best; out.t = bt;
    return out;
  }
  function polyLens(pts) {
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return lens;
  }
  /** Catmull-Rom through [[x, z], …] → a denser polyline. */
  function smoothPath(pts, per) {
    const out = [];
    const P = i => pts[clamp(i, 0, pts.length - 1)];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const v = [0, 1].map(c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
        out.push(v);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }

  // =============================================================================================
  // 4. Sunny Isle: coastline, landmarks, heightfield (pure; built once and shared by every game)
  // =============================================================================================

  // Coast radius by polar angle θ = atan2(z, x) (x east, z south). Features: [θ, width, Δradius].
  const COAST_FEATURES = [
    [-0.80, 0.105, 125],   // Lighthouse Point headland (north-east)
    [0.16, 0.085, -105],   // Sunny Harbor cove (east)
    [-2.66, 0.055, -95],   // Seashell Cove (north-west)
    [1.42, 0.30, 45],      // Palm Beach (south)
    [2.48, 0.09, 70],      // the sea-arch point (south-west)
    [-1.75, 0.16, 40],     // airstrip plain (north)
  ];
  function coastR(th) {
    let r = 600 + 52 * Math.sin(2 * th + 0.6) + 36 * Math.sin(3 * th + 1.9) + 19 * Math.sin(5 * th + 0.4) +
      9 * Math.sin(9 * th + 2.2) + 4 * Math.sin(15 * th + 1.1);
    for (const f of COAST_FEATURES) { const a = wrapA(th - f[0]) / f[1]; r += f[2] * Math.exp(-a * a); }
    return r;
  }
  /** A point on a ray from the island centre, `inset` metres inside the coast (negative = out to sea). */
  function polar(th, inset) { const r = coastR(th) - inset; return [Math.cos(th) * r, Math.sin(th) * r]; }

  const ISLE = (function buildIsle() {
    const L = {};
    L.mountain = { x: -150, z: -150, r: 330, h: 236 };
    L.pool = { x: -24, z: -18, r: 20 };
    L.fallsTop = { x: -44, z: -40 };
    L.river = smoothPath([[-24, -18], [22, 40], [92, 96], [146, 168], [176, 238], [214, 318], [262, 402], [306, 480], [336, 540]], 6);
    L.bridge = { x: 176, z: 238 };
    L.town = { x: 420, z: 40, r: 95 };
    L.harbor = (() => { const [x, z] = polar(0.16, -18); return { x, z, rot: 0.16 }; })();
    L.lighthouse = (() => { const [x, z] = polar(-0.80, 42); return { x, z }; })();
    L.windmills = [[-470, 60], [-455, 120], [-434, 180], [-405, 238], [-370, 292]].map(([x, z]) => ({ x, z }));
    L.plaza = { x: 20, z: 300, r: 40 };
    L.tennis = { x: -110, z: 385, rot: 0.25 };
    L.ballpark = { x: -295, z: 290, rot: 0.75 };
    L.bowling = { x: 140, z: 400, rot: -0.35 };
    L.beach = (() => { const [x, z] = polar(1.42, 28); return { x, z }; })();
    L.arch = (() => { const [x, z] = polar(2.48, -46); return { x, z, rot: 2.48 }; })();
    L.cove = (() => { const [x, z] = polar(-2.66, 10); return { x, z }; })();
    L.airstrip = { x: -30, z: -505, rot: 0.1, len: 260 };
    L.farm = { x: -400, z: -330 };
    L.golf = [
      { tee: [250, -170], green: [330, -300] },
      { tee: [360, -330], green: [230, -410] },
      { tee: [190, -360], green: [150, -250] },
    ];
    L.islets = [
      { x: -740, z: -290, r: 64, h: 26, name: 'turtle' },
      { x: 730, z: 350, r: 46, h: 18, name: 'gull' },
      { x: 150, z: -770, r: 56, h: 22, name: 'pelican' },
    ];
    L.shipwreck = (() => { const [x, z] = polar(3.05, -70); return { x, z }; })();
    L.treehouse = { x: -250, z: 140 };
    L.picnic = { x: 120, z: -60 };
    L.roads = [
      [[L.town.x - 60, L.town.z + 30], [330, 150], [240, 225], [L.bridge.x + 40, L.bridge.z + 6]],
      [[L.bridge.x - 40, L.bridge.z - 4], [110, 260], [L.plaza.x + 38, L.plaza.z - 6]],
      [[L.plaza.x - 36, L.plaza.z + 10], [-80, 330], [L.tennis.x + 30, L.tennis.z - 6]],
      [[L.tennis.x - 30, L.tennis.z + 10], [-235, 390], [L.ballpark.x + 60, L.ballpark.z - 40]],
      [[L.plaza.x + 20, L.plaza.z + 34], [80, 380], [L.bowling.x - 26, L.bowling.z - 6]],
      [[L.plaza.x, L.plaza.z + 40], [30, 420], [L.beach.x - 10, L.beach.z - 40]],
      [[L.town.x + 50, L.town.z + 20], [L.harbor.x - 70, L.harbor.z - 10]],
    ].map(p => smoothPath(p, 5));

    // pads: flattened ground (h: null → the natural height at the centre)
    const pads = [
      { x: L.plaza.x, z: L.plaza.z, hx: 44, hz: 44, rot: 0, blend: 40, round: true },
      { x: L.tennis.x, z: L.tennis.z, hx: 34, hz: 46, rot: L.tennis.rot, blend: 36 },
      { x: L.ballpark.x, z: L.ballpark.z, hx: 82, hz: 82, rot: 0, blend: 40, round: true },
      { x: L.bowling.x, z: L.bowling.z, hx: 34, hz: 24, rot: L.bowling.rot, blend: 30 },
      { x: L.town.x, z: L.town.z, hx: 95, hz: 95, rot: 0, blend: 60, round: true },
      { x: L.airstrip.x, z: L.airstrip.z, hx: L.airstrip.len / 2 + 20, hz: 26, rot: L.airstrip.rot, blend: 40 },
      { x: L.farm.x, z: L.farm.z, hx: 45, hz: 45, rot: 0, blend: 40, round: true },
      { x: L.bridge.x + 50, z: L.bridge.z + 8, hx: 16, hz: 13, rot: 0.16, blend: 34, h: 26 },
      { x: L.bridge.x - 50, z: L.bridge.z - 8, hx: 16, hz: 13, rot: 0.16, blend: 34, h: 26 },
    ];
    for (const g of L.golf) for (const p of [g.tee, g.green]) pads.push({ x: p[0], z: p[1], hx: 16, hz: 16, rot: 0, blend: 26, round: true });
    const riverLens = polyLens(L.river), riverTotal = riverLens[riverLens.length - 1];
    const tmp = { d: 0, t: 0 };
    const wm0 = L.windmills[0], wm1 = L.windmills[L.windmills.length - 1];

    /** Ground before rivers and pads: coast, beach, hills, mountain, ridge, rocks, islets. */
    function natural(x, z) {
      const r = Math.hypot(x, z), th = Math.atan2(z, x);
      const d = coastR(th) - r;
      let h;
      if (d < 0) h = Math.max(-38, -1.3 + d * 0.16 - Math.max(0, -d - 60) * 0.12);
      else {
        const beach = Math.min(d, 46) * 0.072;
        const k = sstep(26, 230, d);
        const hills = (fbm(x * 0.0055 + 3.1, z * 0.0055 - 1.7, 11) - 0.4) * 64 * sstep(70, 300, d);
        h = beach + k * 8.5 + Math.max(hills, -k * 5);
        h += (fbm(x * 0.03, z * 0.03, 5, 2) - 0.5) * 2.2 * sstep(20, 60, d);
      }
      // the highland the river gorge cuts through
      const dg = Math.hypot(x - 70, z - 70);
      if (dg < 230) h += 26 * sstep(230, 90, dg);
      // the mountain
      const dm = Math.hypot(x - L.mountain.x, z - L.mountain.z);
      const t = Math.max(0, 1 - dm / L.mountain.r);
      if (t > 0) {
        const ridged = 1 - Math.abs(fbm(x * 0.012, z * 0.012, 23, 3) * 2 - 1);
        h += L.mountain.h * Math.pow(t, 1.75) + ridged * 22 * t * t;
      }
      // windmill ridge
      segDist(x, z, wm0.x, wm0.z, wm1.x, wm1.z, tmp);
      if (tmp.d < 110) h += 30 * Math.pow(1 - tmp.d / 110, 2) * sstep(0, 0.12, tmp.t) * sstep(1, 0.88, tmp.t);
      // the lighthouse rock
      const dl = Math.hypot(x - L.lighthouse.x, z - L.lighthouse.z);
      if (dl < 70) h += 16 * Math.pow(1 - dl / 70, 0.8);
      // islets
      for (const s of L.islets) {
        const di = Math.hypot(x - s.x, z - s.z) / s.r;
        if (di < 1.6) h = Math.max(h, s.h * Math.pow(Math.max(0, 1 - di), 1.3) - 1.6 * di + (fbm(x * 0.05, z * 0.05, 31, 2) - 0.5) * 4);
      }
      return h;
    }

    function riverAt(x, z, out) {
      polyDist(x, z, L.river, riverLens, riverTotal, out);
      return out;
    }
    /** The river bed (and its water ~1.4 m above) along the river, t = 0 at the pool, 1 at the sea. */
    function riverBed(t) { return lerp(36, -3, Math.pow(t, 0.42)) - 4 * Math.sin(Math.PI * Math.min(1, t * 2.4)); }

    for (const p of pads) if (p.h == null) p.h = natural(p.x, p.z);
    L.pool.h = riverBed(0);

    function padMask(p, x, z) {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const lx = (x - p.x) * c + (z - p.z) * s, lz = -(x - p.x) * s + (z - p.z) * c;
      let d;
      if (p.round) d = Math.max(0, Math.hypot(lx / p.hx, lz / p.hz) - 1) * p.hx;
      else d = Math.hypot(Math.max(0, Math.abs(lx) - p.hx), Math.max(0, Math.abs(lz) - p.hz));
      return 1 - sstep(0, p.blend, d);
    }

    /** Final ground height (m). Sea level is y = 0. */
    function height(x, z) {
      let h = natural(x, z);
      for (const p of pads) {
        if (Math.abs(x - p.x) > p.hx + p.hz + p.blend || Math.abs(z - p.z) > p.hx + p.hz + p.blend) continue;
        const m = padMask(p, x, z);
        if (m > 0) h = lerp(h, p.h, m);
      }
      // river valley and gorge
      riverAt(x, z, tmp);
      if (tmp.d < 70) {
        const bed = riverBed(tmp.t);
        const gorge = tmp.t < 0.3;
        const w0 = lerp(7, 12, tmp.t), w1 = gorge ? 26 : lerp(40, 62, tmp.t);
        if (h > bed) h = bed + (h - bed) * sstep(w0, w1, tmp.d);
      }
      // the waterfall pool
      const dp = Math.hypot(x - L.pool.x, z - L.pool.z);
      if (dp < L.pool.r + 20) h = Math.min(h, lerp(L.pool.h - 4, h, sstep(L.pool.r - 6, L.pool.r + 20, dp)));
      // harbor basin
      const dh = Math.hypot(x - L.harbor.x, z - L.harbor.z);
      if (dh < 90) h = Math.min(h, lerp(-7, h, sstep(50, 90, dh)));
      return h;
    }

    return { L, pads, height, natural, riverAt, riverBed, riverLens, riverTotal, coastR, polar };
  })();

  // =============================================================================================
  // 5. Content: structure sizes, "!" markers, balloon clusters, the ring course, start points
  // =============================================================================================

  const H = (x, z) => ISLE.height(x, z);
  const water = h => Math.max(0, h);
  /** A point d metres along the waterfall's fall line (lip → pool and on down the canyon), w metres to its side. */
  function fallLine(d, w) {
    const L = ISLE.L, dx = L.pool.x - L.fallsTop.x, dz = L.pool.z - L.fallsTop.z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
    return [L.fallsTop.x + ux * d - uz * w, L.fallsTop.z + uz * d + ux * w];
  }

  /** Sizes shared by the geometry, the colliders and the content placed around them. */
  const STRUCT = (function () {
    const L = ISLE.L;
    const S = {};
    S.lighthouse = { ground: H(L.lighthouse.x, L.lighthouse.z), tower: 26, r0: 3.4, r1: 2.4 };
    S.lighthouse.top = S.lighthouse.ground + S.lighthouse.tower + 6;
    S.bridge = { deck: 26, half: 66, width: 10, rot: 0.16, archTop: 42 };
    S.bridge.water = ISLE.riverBed(ISLE.riverAt(L.bridge.x, L.bridge.z, {}).t) + 1.4;
    S.windmill = { tower: 15, hub: 15.6, blade: 9.5 };
    S.windmills = L.windmills.map((w, i) => {
      const g = H(w.x, w.z);
      const face = -Math.PI / 2 + (i - 2) * 0.08;   // rotors face west, into the sea breeze
      return { x: w.x, z: w.z, g, face, hx: w.x + Math.sin(face) * 2.8, hz: w.z + Math.cos(face) * 2.8, hy: g + S.windmill.hub };
    });
    S.bowling = { g: H(L.bowling.x, L.bowling.z), w: 46, d: 28, h: 10, pin: 9 };
    S.tennis = { g: H(L.tennis.x, L.tennis.z) };
    S.ballpark = { g: H(L.ballpark.x, L.ballpark.z), fence: 70, board: 14 };
    S.ballpark.home = [L.ballpark.x - Math.sin(L.ballpark.rot) * 34, L.ballpark.z - Math.cos(L.ballpark.rot) * 34];
    S.plaza = { g: H(L.plaza.x, L.plaza.z), fountain: 7.5, basin: 7 };
    S.town = { g: H(L.town.x, L.town.z) };
    S.clock = { x: L.town.x + 18, z: L.town.z - 22, h: 24 };
    S.peak = { x: L.mountain.x, z: L.mountain.z, y: H(L.mountain.x, L.mountain.z) };
    S.falls = { top: H(L.fallsTop.x, L.fallsTop.z) + 1, pool: L.pool.h + 1.4 };
    S.arch = { x: L.arch.x, z: L.arch.z, span: 24, clear: 19, rot: L.arch.rot };
    S.farm = { g: H(L.farm.x, L.farm.z) };
    S.airstrip = { g: H(L.airstrip.x, L.airstrip.z) };
    S.treehouse = { g: H(L.treehouse.x, L.treehouse.z), deck: 15 };
    S.picnic = { g: H(L.picnic.x, L.picnic.z) };
    S.harbor = { x: L.harbor.x, z: L.harbor.z };
    S.lifeguard = (() => { const [x, z] = ISLE.polar(1.30, 30); return { x, z, g: H(x, z) }; })();
    S.bay = (() => { const [x, z] = ISLE.polar(0.75, -120); return { x, z }; })();
    S.ceiling = 330;
    S.hardCeiling = 382;
    return S;
  })();

  // ---- the waterfall in fall-line coordinates: s along the fall line from the lip, w to its side ----------
  const FALLS = (function () {
    const L = ISLE.L, dx = L.pool.x - L.fallsTop.x, dz = L.pool.z - L.fallsTop.z, len = Math.hypot(dx, dz);
    return { x: L.fallsTop.x, z: L.fallsTop.z, ux: dx / len, uz: dz / len, len, top: STRUCT.falls.top + 0.6, bottom: STRUCT.falls.pool - 0.2, W: 16 };
  })();
  function fallsCoord(x, z, out) {
    const dx = x - FALLS.x, dz = z - FALLS.z;
    out.s = dx * FALLS.ux + dz * FALLS.uz; out.w = -dx * FALLS.uz + dz * FALLS.ux;
    return out;
  }
  /** Distance (m) from a point to the falling water sheet (the same curve as fallsGeometry); Infinity above or below it. */
  function fallsSheetDist(x, y, z, tmp) {
    if (y > FALLS.top + 2 || y < FALLS.bottom - 2) return Infinity;
    fallsCoord(x, z, tmp);
    const t = Math.sqrt(clamp((FALLS.top - y) / (FALLS.top - FALLS.bottom), 0, 1));
    const ss = FALLS.len * 0.55 * Math.sqrt(t), hw = FALLS.W * (1 + t * 0.35) / 2;
    return Math.hypot(tmp.s - ss, Math.max(0, Math.abs(tmp.w) - hw));
  }
  /** The spray cushion: in the falls basin (and the updraft just above the lip) a plane that touches the rock is
   *  bounced back out, never bumped. */
  function inFallsZone(x, y, z, tmp) {
    fallsCoord(x, z, tmp);
    return tmp.s > -24 && tmp.s < 46 && Math.abs(tmp.w) < 34 && y < FALLS.top + 22;
  }

  // ---- "!" info markers: 40 places, each with a name and a fun fact --------------------------------
  // Order is the save format (one character per marker): only ever append.
  const MARKERS = (function () {
    const L = ISLE.L, S = STRUCT;
    const g = (x, z, up) => [x, H(x, z) + up, z];
    const sea = (x, z, up) => [x, water(H(x, z)) + up, z];
    const lhDir = [Math.cos(-0.8), Math.sin(-0.8)];
    const riverPt = t => { const i = Math.round(t * (L.river.length - 1)); return L.river[i]; };
    const gz = riverPt(0.14), mouth = riverPt(0.97);
    const wm = S.windmills[2];
    // along the fall line from the lip toward the pool: the cliff drops away steeply and the water sheet arcs out,
    // leaving a gap between the cliff (about 4 m out at mid-height) and the sheet (about 13 m out); the spray
    // cushion (FALLS_ZONE) bounces a plane that flies on into the cliff back out through the sheet
    const fl = (d) => fallLine(d, 0);
    const fallsIn = fl(10.5), fallsLip = fl(3);
    const list = [
      ['lighthouse', 'Lighthouse Point', [L.lighthouse.x + lhDir[0] * 11, S.lighthouse.ground + 27, L.lighthouse.z + lhDir[1] * 11],
        'The lighthouse has 151 steps. Keeper Pip counts them out loud every evening, and the gulls have learned to count along.'],
      ['rocks', 'Lighthouse Rocks', sea(...ISLE.polar(-0.8, -14), 5),
        'These rocks are speckled with tide pools. At low tide you can spot sea stars holding very still, as if they are playing statues.'],
      ['harbor', 'Sunny Harbor', [S.harbor.x - 6, 11, S.harbor.z],
        'Every morning the fishing boats toot their horns in a little tune. Locals call it the island\'s alarm clock.'],
      ['breakwater', 'The Breakwater', sea(...ISLE.polar(0.255, -58), 9),
        'The big stones of the breakwater keep the harbor calm. On stormy days the waves crash on one side while the boats nap on the other.'],
      ['square', 'Town Square', g(L.town.x - 10, L.town.z + 6, 13),
        'The town square hosts a market every Saturday. The most popular stall sells mango jam in jars shaped like little suns.'],
      ['clock', 'Clock Tower', [S.clock.x, S.town.g + S.clock.h + 14, S.clock.z],
        'The clock tower runs exactly two minutes fast, on purpose, so that nobody on Sunny Isle is ever late for a picnic.'],
      ['ridge', 'Windmill Ridge', g((L.windmills[0].x + L.windmills[1].x) / 2 + 6, (L.windmills[0].z + L.windmills[1].z) / 2, 22),
        'The five windmills are named Breezy, Gusty, Whirly, Puff and Doris. Nobody remembers why the last one is called Doris.'],
      // in front of Whirly's rotor, clear of the tower, so the blades sweep past right beside you
      ['whirl', 'Windmill Whirl', [wm.hx + Math.sin(wm.face) * 9 + Math.cos(wm.face) * 3, wm.hy + 0.5, wm.hz + Math.cos(wm.face) * 9 - Math.sin(wm.face) * 3],
        'Each windmill blade is longer than a bus. When the sea breeze picks up, they grind enough flour for the whole island.'],
      ['bridge', 'Sunny Bridge', [L.bridge.x, S.bridge.archTop + 7, L.bridge.z],
        'The bridge is painted bright orange so boats, birds and pilots can all see it from far away. It gets a fresh coat every spring.'],
      ['underbridge', 'Under the Bridge', [L.bridge.x + 3, S.bridge.water + 7, L.bridge.z + 6],
        'Only the bravest pilots fly under the bridge. The fish in the river below are said to cheer every time someone makes it.'],
      ['fallstop', 'Top of the Falls', [fallsLip[0], S.falls.top + 10, fallsLip[1]],
        'Sunny Falls drops about fifty meters into the pool below. On clear afternoons the spray paints a rainbow across the valley.'],
      ['pool', 'Rainbow Pool', [L.pool.x + 10, S.falls.pool + 6, L.pool.z + 10],
        'The pool at the foot of the falls stays chilly all year. Swimmers call jumping in "the Sunny Isle wake-up".'],
      ['gorge', 'River Gorge', [gz[0], ISLE.riverBed(0.14) + 9, gz[1]],
        'Over thousands of years the river carved this gorge out of solid rock, one tiny pebble at a time. Now that is patience!'],
      ['mouth', 'River Mouth', [mouth[0], 5, mouth[1]],
        'Here the fresh river water meets the salty sea. Crabs gather at the mouth to argue about which side is better.'],
      ['summit', 'Mount Sunny Summit', [S.peak.x, S.peak.y + 12, S.peak.z],
        'Mount Sunny is the tallest point on the island. From the top you can see every beach, all three islets and a lot of sea.'],
      ['ledge', 'Eagle Ledge', g(L.mountain.x + 10, L.mountain.z - 112, 10),
        'A pair of sea eagles nests on this ledge. They have raised chicks here for twenty summers and still squabble over the view.'],
      ['lanes', 'Sunny Lanes', [L.bowling.x, S.bowling.g + S.bowling.h + S.bowling.pin + 7, L.bowling.z],
        'The giant pin on the roof of Sunny Lanes is nine meters tall. Rumor says it wobbles a little whenever someone bowls a strike.'],
      ['stadium', 'Sunny Stadium', [L.tennis.x, S.tennis.g + 16, L.tennis.z],
        'The tennis stadium is always full of cheering Pals. The loudest seats are right behind the umpire\'s chair.'],
      ['ballpark', 'Sunny Park', [S.ballpark.home[0], S.ballpark.g + 12, S.ballpark.home[1]],
        'In the ballpark, a home run that splashes into the sea is called a Sunny Splash. There have been exactly three.'],
      ['scoreboard', 'The Scoreboard', [L.ballpark.x + Math.sin(L.ballpark.rot) * 46, S.ballpark.g + S.ballpark.board + 7, L.ballpark.z + Math.cos(L.ballpark.rot) * 46],
        'The scoreboard bulbs are changed one at a time by a ladder-climbing Pal named Dot. She has never dropped a single one.'],
      ['green', 'The First Green', g(L.golf[0].green[0], L.golf[0].green[1], 9),
        'The first hole of the island course is a friendly par 4. The flag is bright red so golfers can spot it from the tee.'],
      ['bunker', 'The Sand Trap', g(L.golf[1].green[0] + 22, L.golf[1].green[1] - 6, 5),
        'Golfers call this bunker "the Beach That Bites". It has swallowed more golf balls than anywhere else on the island.'],
      ['fountain', 'Plaza Fountain', [L.plaza.x, S.plaza.g + S.plaza.fountain + 5, L.plaza.z],
        'Toss a coin into the fountain and make a wish. Once a year the coins are collected to buy new beach balls for everyone.'],
      ['gardens', 'Flower Gardens', g(L.plaza.x + 36, L.plaza.z - 30, 6),
        'The gardens grow more than thirty kinds of flowers. The bees here are so busy they keep a waiting list.'],
      ['beach', 'Palm Beach', g(L.beach.x, L.beach.z, 9),
        'Palm Beach has the softest sand on the island. Pals say it squeaks a happy little squeak when you walk on it barefoot.'],
      ['lifeguard', 'Lifeguard Tower', [S.lifeguard.x, S.lifeguard.g + 16, S.lifeguard.z],
        'The lifeguard tower has the best view of the waves. A red flag goes up when the sea is wild, a green one when it is perfect.'],
      ['cove', 'Seashell Cove', sea(L.cove.x, L.cove.z, 5),
        'Seashell Cove is tucked between steep rocks. Hold a shell to your ear here and you will hear the sea twice.'],
      ['arch', 'Sea Arch', [S.arch.x, S.arch.clear * 0.48, S.arch.z],
        'Waves carved the sea arch by pounding the rock for ages. Sailors pass through it for good luck, and now so have you!'],
      ['turtle', 'Turtle Islet', [L.islets[0].x, L.islets[0].h + 10, L.islets[0].z],
        'Sea turtles crawl onto this islet\'s beach to lay their eggs. It is a peaceful place, so please fly softly.'],
      ['gull', 'Gull Rock', [L.islets[1].x, L.islets[1].h + 10, L.islets[1].z],
        'Gull Rock is home to hundreds of seagulls. They argue all day about who owns the best rock, and nobody ever wins.'],
      ['pelican', 'Pelican Islet', [L.islets[2].x, L.islets[2].h + 10, L.islets[2].z],
        'Pelicans fish around this islet by diving beak-first into the waves. Their pouches hold more fish than their tummies do.'],
      ['clouds', 'Above the Clouds', [210, 262, -60],
        'Clouds look like pillows, but they are made of countless tiny droplets of water. Flying through one is a cool, misty hug.'],
      ['skyhigh', 'Sky High', [-40, 352, 40],
        'This is as high as a little prop plane should go. From up here the island looks like a green pancake on a big blue plate.'],
      ['shipwreck', 'Shipwreck Shoals', [L.shipwreck.x, 9, L.shipwreck.z],
        'The old ship Lucky Daisy ran aground here a hundred years ago. Today she is a cozy home for crowds of colorful fish.'],
      ['farm', 'Sunny Farm', g(L.farm.x, L.farm.z, 17),
        'Sunny Farm grows the island\'s pineapples, pumpkins and peas. The cows here are said to make the creamiest milk in the ocean.'],
      ['airstrip', 'Sunny Airstrip', g(L.airstrip.x + 40, L.airstrip.z + 4, 5),
        'Island planes take off and land on this grassy strip. The striped windsock shows pilots which way the wind is blowing.'],
      ['treehouse', 'Treetop Lookout', [L.treehouse.x, S.treehouse.g + 39, L.treehouse.z],
        'The treehouse in the old fig tree was built by kids, for kids. Grown-ups need the secret password to get in.'],
      ['picnic', 'Picnic Hill', g(L.picnic.x, L.picnic.z, 23),
        'Picnic Hill catches the breeze on hot days. The tree on top has shaded more sandwiches than anyone can count.'],
      ['bay', 'Sailboat Bay', [S.bay.x, 9, S.bay.z],
        'Sailboats race around the bay every Sunday. The winner gets a seashell trophy, and the loser buys everyone ice cream.'],
      ['behindfalls', 'Behind the Falls', [fallsIn[0], lerp(S.falls.top, S.falls.pool, 0.5), fallsIn[1]],
        'You found the secret space behind the waterfall! Explorers say its roar sounds just like the island laughing.'],
    ];
    // the falls basin and the gorge are a dead-end canyon: they are flown up the canyon, from downstream
    const upCanyon = Math.atan2(L.fallsTop.x - L.pool.x, L.fallsTop.z - L.pool.z);
    const canyon = new Set(['fallstop', 'pool', 'gorge', 'behindfalls']);
    return list.map(([id, name, p, fact], i) => ({ i, id, name, fact, x: p[0], y: p[1], z: p[2], approach: canyon.has(id) ? upCanyon : null }));
  })();

  // ---- Balloon Pop: 60 balloons in clusters (7 gold) -----------------------------------------------
  const BALLOONS = (function () {
    const L = ISLE.L, S = STRUCT;
    const out = [];
    const add = (x, y, z, gold) => out.push({ x, y, z, gold: !!gold });
    const line = (a, b, n, goldAt = -1) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); add(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), i === goldAt); } };
    const arc = (cx, cz, r, a0, a1, n, yf, goldAt = -1) => { for (let i = 0; i < n; i++) { const a = lerp(a0, a1, n === 1 ? 0.5 : i / (n - 1)); const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; add(x, yf(x, z, i), z, i === goldAt); } };
    // 1. low over the water along Palm Beach (6)
    const b0 = ISLE.polar(1.12, -26), b1 = ISLE.polar(1.70, -26);
    line([b0[0], 7, b0[1]], [b1[0], 7, b1[1]], 6);
    for (const b of out) b.y = Math.max(7, water(H(b.x, b.z)) + 6);
    // 2. a ring around the plaza fountain (5)
    arc(L.plaza.x, L.plaza.z, 26, 0, TAU * 4 / 5, 5, () => S.plaza.g + 16);
    // 3. an arc over the tennis stadium (5, one gold)
    arc(L.tennis.x, L.tennis.z, 30, -0.3, 1.7, 5, (x, z, i) => S.tennis.g + 22 + i * 3, 2);
    // 4. over the ballpark outfield, inside the light towers (5)
    arc(L.ballpark.x, L.ballpark.z, 30, L.ballpark.rot - 0.7 + Math.PI / 2, L.ballpark.rot + 0.7 + Math.PI / 2, 5, () => S.ballpark.g + 14);
    // 5. the bridge: three under it (middle one gold), two above the arch
    const bd = [Math.cos(S.bridge.rot), Math.sin(S.bridge.rot)];
    const rv = ISLE.riverAt(L.bridge.x, L.bridge.z, {});
    const up = L.river[Math.max(0, Math.round(rv.t * (L.river.length - 1)) - 3)], dn = L.river[Math.min(L.river.length - 1, Math.round(rv.t * (L.river.length - 1)) + 3)];
    add(up[0], S.bridge.water + 6, up[1]);
    add(L.bridge.x, S.bridge.water + 7, L.bridge.z, true);
    add(dn[0], S.bridge.water + 6, dn[1]);
    add(L.bridge.x + bd[0] * 30, S.bridge.archTop + 8, L.bridge.z + bd[1] * 30);
    add(L.bridge.x - bd[0] * 30, S.bridge.archTop + 8, L.bridge.z - bd[1] * 30);
    // 6. a spiral around the lighthouse (6, gold at the top)
    for (let i = 0; i < 6; i++) {
      const a = -0.8 + Math.PI * 0.6 + i * 1.05;
      add(L.lighthouse.x + Math.cos(a) * 22, S.lighthouse.ground + 6 + i * 5, L.lighthouse.z + Math.sin(a) * 22, i === 5);
    }
    // 7. low over the harbor (4)
    arc(S.harbor.x, S.harbor.z, 34, 0.16 + 1.9, 0.16 + 4.3, 4, () => 7);
    // 8. high over the mountain (5, one gold)
    arc(S.peak.x, S.peak.z, 70, -0.4, 2.0, 5, (x, z, i) => H(x, z) + 32 + i * 4, 4);
    // 9. bobbing up and down along the windmill ridge, on its lee side (clear of the towers and the rotors) (5)
    {
      const a0 = L.windmills[0], a1 = L.windmills[4], l = Math.hypot(a1.x - a0.x, a1.z - a0.z);
      const ex = (a1.z - a0.z) / l, ez = -(a1.x - a0.x) / l;    // perpendicular, pointing east (away from the rotors)
      for (let i = 0; i < 4; i++) {
        const a = L.windmills[i], b = L.windmills[i + 1];
        const mx = (a.x + b.x) / 2 + ex * 16, mz = (a.z + b.z) / 2 + ez * 16;
        add(mx, H(mx, mz) + 11 + (i % 2) * 6, mz);
      }
    }
    add(L.windmills[4].x + 30, H(L.windmills[4].x + 30, L.windmills[4].z + 40) + 16, L.windmills[4].z + 40);
    // 10. down the river gorge (5, one gold)
    for (let i = 0; i < 5; i++) {
      const t = 0.05 + i * 0.05, p = L.river[Math.round(t * (L.river.length - 1))];
      add(p[0], ISLE.riverBed(t) + 7 + (i === 2 ? 2 : 0), p[1], i === 2);
    }
    // 11. down the face of the waterfall (3, gold at the bottom)
    for (let i = 0; i < 3; i++) {
      const t = 0.15 + i * 0.36;
      add(lerp(L.fallsTop.x, L.pool.x, t) + 8, lerp(S.falls.top + 8, S.falls.pool + 6, t), lerp(L.fallsTop.z, L.pool.z, t) + 8, i === 2);
    }
    // 12. over the golf course flags (5)
    for (const gh of L.golf) add(gh.green[0], H(gh.green[0], gh.green[1]) + 12, gh.green[1]);
    add(lerp(L.golf[0].tee[0], L.golf[0].green[0], 0.5), H(lerp(L.golf[0].tee[0], L.golf[0].green[0], 0.5), lerp(L.golf[0].tee[1], L.golf[0].green[1], 0.5)) + 16, lerp(L.golf[0].tee[1], L.golf[0].green[1], 0.5));
    add(lerp(L.golf[1].tee[0], L.golf[1].green[0], 0.5), H(lerp(L.golf[1].tee[0], L.golf[1].green[0], 0.5), lerp(L.golf[1].tee[1], L.golf[1].green[1], 0.5)) + 16, lerp(L.golf[1].tee[1], L.golf[1].green[1], 0.5));
    // 13. a gold one hidden inside the sea arch
    add(S.arch.x, S.arch.clear * 0.45, S.arch.z, true);
    // 14. the welcome trail: straight ahead of the start, gently descending, so the first pops (and the first
    //     combo) come in the opening seconds
    {
      const st = startFor('balloons'), fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
      [60, 110, 160, 210, 260].forEach((d, i) => add(st.x + fx * d, lerp(44, 26, i / 4), st.z + fz * d));
    }
    return out;
  })();

  // ---- Ring Run: a scenic loop of rings around the island -------------------------------------------
  const RINGS = (function () {
    const L = ISLE.L, S = STRUCT;
    const g = (x, z, up) => [x, H(x, z) + up, z];
    const sea = (x, z, up) => [x, water(H(x, z)) + up, z];
    const rp = t => L.river[Math.round(clamp(t, 0, 1) * (L.river.length - 1))];
    const pts = [
      sea(...ISLE.polar(1.42, -150), 16),
      g(L.beach.x - 6, L.beach.z - 4, 13),
      g(lerp(L.beach.x, L.plaza.x, 0.5) - 10, lerp(L.beach.z, L.plaza.z, 0.5), 18),
      [L.plaza.x, S.plaza.g + 20, L.plaza.z],
      [L.tennis.x + 10, S.tennis.g + 22, L.tennis.z - 6],
      g(-205, 335, 22),
      [L.ballpark.x, S.ballpark.g + 24, L.ballpark.z],
      g(-345, 190, 22),
      g((L.windmills[1].x + L.windmills[2].x) / 2, (L.windmills[1].z + L.windmills[2].z) / 2, 13),
      sea(-575, -40, 11),
      g(-472, -195, 12),                                    // along the west coast
      g(L.farm.x + 30, L.farm.z - 20, 18),
      g(-255, -433, 14),                                    // over the northern plain
      g(L.airstrip.x - 110, L.airstrip.z - 11, 7),
      g(L.airstrip.x + 110, L.airstrip.z + 11, 7),
      g(L.golf[1].green[0] - 10, L.golf[1].green[1] + 10, 16),
      [L.lighthouse.x - 34, S.lighthouse.ground + 16, L.lighthouse.z + 20],
      sea(532, -303, 10),                                   // a low skim ring off the north-east cliffs
      sea(...ISLE.polar(-0.25, -50), 13),
      [S.harbor.x - 10, 12, S.harbor.z + 4],
      g(L.town.x - 20, L.town.z + 10, 30),                  // over the rooftops
      g(270, -10, 34),
      g(110, -90, 34),
      // over the mountain's shoulder, high over the falls, then down the waterfall valley: every leg ≤ 30°
      g(-32, -95, 14),
      [L.fallsTop.x + 4, S.falls.top + 27, L.fallsTop.z + 4],
      [fallLine(90, 0)[0], S.falls.pool + 22, fallLine(90, 0)[1]],
      [rp(0.2)[0], ISLE.riverBed(0.2) + 9, rp(0.2)[1]],
      [L.bridge.x, S.bridge.water + 7.6, L.bridge.z, 0.74],
      [rp(0.72)[0], 9, rp(0.72)[1]],
      sea(...ISLE.polar(0.98, -90), 14),
    ];
    const rings = pts.map((p, i) => ({ i, x: p[0], y: p[1], z: p[2], s: p[3] || 1, nx: 0, ny: 0, nz: 1 }));
    for (let i = 0; i < rings.length; i++) {
      const a = rings[Math.max(0, i - 1)], b = rings[Math.min(rings.length - 1, i + 1)];
      let dx = b.x - a.x, dy = (b.y - a.y) * 0.5, dz = b.z - a.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      rings[i].nx = dx / l; rings[i].ny = dy / l; rings[i].nz = dz / l;
    }
    return rings;
  })();

  /** Where each mode's flight begins: a point and a heading (yaw: 0 = +Z, π = toward −Z / north). */
  function startFor(mode) {
    if (mode === 'rings') {
      const r0 = RINGS[0];
      return { x: r0.x - r0.nx * 150, y: r0.y + 4, z: r0.z - r0.nz * 150, yaw: Math.atan2(r0.nx, r0.nz) };
    }
    const [x, z] = ISLE.polar(1.42, -260);
    return { x, y: 46, z, yaw: Math.atan2(ISLE.L.plaza.x - x, ISLE.L.plaza.z - z) };
  }

  // =============================================================================================
  // 6. Persistence: which "!" markers each profile has found
  // =============================================================================================

  // Saved Pals keep their markers in save.data.stats.flight[profileId].markers ('0'/'1' per marker,
  // in MARKERS order; deleting the Pal deletes them). Guests keep theirs for this session only.
  const sessionMarkers = new Map();
  function markerOwner(save, profile) {
    return profile && !profile.isGuest && profile.id && save.getProfile(profile.id) ? profile.id : null;
  }
  function loadMarkers(save, profile) {
    const pid = markerOwner(save, profile);
    let str = null;
    if (pid) {
      const bySport = save.data.stats && save.data.stats[DEF.id];
      str = bySport && bySport[pid] ? bySport[pid].markers : null;
    } else str = sessionMarkers.get(profile ? profile.id || profile.name : '_');
    const out = new Uint8Array(MARKER_COUNT);
    if (typeof str === 'string') for (let i = 0; i < MARKER_COUNT; i++) out[i] = str.charCodeAt(i) === 49 ? 1 : 0;
    return out;
  }
  function storeMarkers(save, profile, arr) {
    const str = Array.from(arr, v => (v ? '1' : '0')).join('');
    const pid = markerOwner(save, profile);
    if (!pid) { sessionMarkers.set(profile ? profile.id || profile.name : '_', str); return; }
    const stats = save.data.stats;
    const bySport = stats[DEF.id] || (stats[DEF.id] = {});
    const mine = bySport[pid] || (bySport[pid] = {});
    mine.markers = str;
    save.dirty();
  }
  const countOf = arr => arr.reduce((a, v) => a + v, 0);

  // =============================================================================================
  // 7. Canvas art: marker atlas, light beam, decal/sign atlas, water normals, minimap base
  // =============================================================================================

  const FONT = "'Fredoka', 'Nunito', 'Arial Rounded MT Bold', sans-serif";
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /** Two 256² tiles: the orange "!" speech bubble and the green check it flips to. */
  function drawMarkerAtlas(c) {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 256);
    for (let k = 0; k < 2; k++) {
      const ox = k * 256, cx = ox + 128, cy = 112;
      const glow = g.createRadialGradient(cx, cy, 30, cx, cy, 126);
      glow.addColorStop(0, k ? 'rgba(140,255,150,0.55)' : 'rgba(255,214,120,0.75)');
      glow.addColorStop(0.55, k ? 'rgba(120,230,140,0.18)' : 'rgba(255,190,80,0.3)');
      glow.addColorStop(1, 'rgba(255,190,80,0)');
      g.fillStyle = glow; g.fillRect(ox, 0, 256, 256);
      const body = k ? '#3BC45B' : '#FF9F1C', dark = k ? '#23913E' : '#D9700A';
      // tail + bubble, white rim
      const bubble = (r, col) => {
        g.fillStyle = col;
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(cx - r * 0.42, cy + r * 0.72); g.lineTo(cx + r * 0.08, cy + r * 1.42); g.lineTo(cx + r * 0.4, cy + r * 0.74); g.closePath(); g.fill();
      };
      bubble(84, '#FFFFFF');
      bubble(72, dark);
      g.save(); g.beginPath(); g.arc(cx, cy - 4, 70, 0, TAU); g.clip();
      bubble(72, body);
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath(); g.ellipse(cx - 30, cy - 40, 26, 14, -0.6, 0, TAU); g.fill();
      if (!k) {
        g.font = '700 132px ' + FONT;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = dark; g.fillText('!', cx + 3, cy + 12);
        g.fillStyle = '#FFFFFF'; g.fillText('!', cx, cy + 8);
      } else {
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = dark; g.lineWidth = 24;
        g.beginPath(); g.moveTo(cx - 34, cy + 6); g.lineTo(cx - 9, cy + 32); g.lineTo(cx + 38, cy - 22); g.stroke();
        g.strokeStyle = '#FFFFFF'; g.lineWidth = 20;
        g.beginPath(); g.moveTo(cx - 34, cy + 2); g.lineTo(cx - 9, cy + 28); g.lineTo(cx + 38, cy - 26); g.stroke();
      }
    }
  }

  function beamCanvas() {
    const c = makeCanvas(32, 256), g = c.getContext('2d');
    const img = g.createImageData(32, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 32; x++) {
      const u = (x + 0.5) / 32 - 0.5, v = (y + 0.5) / 256;
      const a = Math.exp(-u * u * 40) * sstep(0, 0.12, 1 - v) * sstep(0, 0.6, v) * (0.75 + 0.25 * Math.exp(-u * u * 400));
      const k = (y * 32 + x) * 4;
      img.data[k] = 255; img.data[k + 1] = 226; img.data[k + 2] = 160; img.data[k + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function blurDiscCanvas() {
    const c = makeCanvas(128), g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 8, 64, 64, 63);
    grd.addColorStop(0, 'rgba(60,64,78,0)'); grd.addColorStop(0.25, 'rgba(60,64,78,0.18)');
    grd.addColorStop(0.85, 'rgba(60,64,78,0.32)'); grd.addColorStop(0.97, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return c;
  }

  /** A tiling normal map of gentle crossed waves (for the sea's sparkle). */
  function waveNormalCanvas() {
    const S = 128, c = makeCanvas(S), g = c.getContext('2d');
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * TAU, v = y / S * TAU;
      hgt[y * S + x] = Math.sin(u * 3 + Math.sin(v * 2) * 1.3) * 0.5 + Math.sin(v * 4 + u * 2) * 0.35 + Math.sin((u - v) * 6) * 0.15 +
        (vnoiseWrap(x / 16, y / 16, 8, 3) - 0.5) * 0.8;
    }
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + (x + 1) % S] - hgt[y * S + (x + S - 1) % S];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const nx = -hx * 1.6, ny = -hy * 1.6, nz = 1, l = Math.hypot(nx, ny, nz);
      const k = (y * S + x) * 4;
      img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function vnoiseWrap(x, y, P, seed) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (a, b) => hash2(((a % P) + P) % P, ((b % P) + P) % P, seed);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** White streaks on transparent: the waterfall's falling water and the river's flow. */
  function streakCanvas() {
    const c = makeCanvas(64, 128), g = c.getContext('2d');
    g.fillStyle = 'rgba(205,238,255,1)'; g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 46; i++) {
      const x = hash2(i, 1, 4) * 64, y = hash2(i, 2, 4) * 128, l = 10 + hash2(i, 3, 4) * 40;
      g.fillStyle = 'rgba(255,255,255,' + (0.35 + hash2(i, 5, 4) * 0.55).toFixed(2) + ')';
      g.fillRect(x, y, 1.5 + hash2(i, 6, 4) * 3, l);
      if (y + l > 128) g.fillRect(x, y - 128, 1.5 + hash2(i, 6, 4) * 3, l);
    }
    return c;
  }

  // Decal & sign atlas (1024²). Regions in px: [x, y, w, h].
  const ATLAS = {
    ballpark: [0, 0, 512, 512], tennis: [512, 0, 256, 512], plaza: [768, 0, 256, 256],
    green: [768, 256, 128, 128], bunker: [896, 256, 128, 128], tee: [768, 384, 128, 64], blanket: [896, 384, 64, 64],
    runway: [0, 512, 512, 96], lanes: [0, 608, 512, 128], stadium: [512, 512, 512, 96], park: [512, 608, 512, 96],
    board: [512, 704, 320, 128], clock: [832, 704, 128, 128], flowers: [960, 384, 64, 64], welcome: [0, 736, 512, 112],
    towel: [960, 448, 64, 64],
  };
  function drawAtlas(c) {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 1024, 1024);
    const R = ATLAS;
    // ballpark: home plate at the bottom centre, a 90° fan of grass with the dirt infield
    {
      const [x0, y0] = R.ballpark, hx = x0 + 256, hy = y0 + 500, fr = 470;
      g.save(); g.beginPath(); g.moveTo(hx, hy); g.arc(hx, hy, fr, -Math.PI * 0.75, -Math.PI * 0.25); g.closePath(); g.clip();
      g.fillStyle = '#5DBB4F'; g.fillRect(x0, y0, 512, 512);
      for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,40,0,0.05)'; g.beginPath(); g.arc(hx, hy, fr - i * 34, 0, TAU); g.arc(hx, hy, Math.max(0, fr - i * 34 - 17), 0, TAU, true); g.fill(); }
      g.fillStyle = '#D9A066'; g.beginPath(); g.moveTo(hx, hy); g.arc(hx, hy, 230, -Math.PI * 0.75, -Math.PI * 0.25); g.closePath(); g.fill();
      g.fillStyle = '#5DBB4F'; g.beginPath(); g.moveTo(hx, hy - 30); g.lineTo(hx + 96, hy - 126); g.lineTo(hx, hy - 222); g.lineTo(hx - 96, hy - 126); g.closePath(); g.fill();
      g.fillStyle = '#D9A066'; g.beginPath(); g.arc(hx, hy - 120, 22, 0, TAU); g.fill();
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - fr * 0.707, hy - fr * 0.707); g.moveTo(hx, hy); g.lineTo(hx + fr * 0.707, hy - fr * 0.707); g.stroke();
      g.fillStyle = '#FFFFFF';
      for (const [bx, by] of [[hx + 104, hy - 126], [hx, hy - 232], [hx - 104, hy - 126]]) g.fillRect(bx - 7, by - 7, 14, 14);
      g.beginPath(); g.arc(hx, hy - 12, 16, 0, TAU); g.fillStyle = '#D9A066'; g.fill();
      g.fillStyle = '#FFFFFF'; g.fillRect(hx - 6, hy - 18, 12, 10);
      g.restore();
    }
    // tennis court (length along the region's height)
    {
      const [x0, y0, w, h] = R.tennis;
      g.fillStyle = '#3FA56A'; g.fillRect(x0, y0, w, h);
      const cw = 140, ch = 400, cx = x0 + (w - cw) / 2, cy = y0 + (h - ch) / 2;
      g.fillStyle = '#3B7DD8'; g.fillRect(cx - 14, cy - 18, cw + 28, ch + 36);
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 3;
      g.strokeRect(cx, cy, cw, ch);
      g.strokeRect(cx + 17, cy, cw - 34, ch);
      g.beginPath(); g.moveTo(cx + 17, cy + 107); g.lineTo(cx + cw - 17, cy + 107); g.moveTo(cx + 17, cy + ch - 107); g.lineTo(cx + cw - 17, cy + ch - 107);
      g.moveTo(cx + cw / 2, cy + 107); g.lineTo(cx + cw / 2, cy + ch - 107); g.stroke();
      g.fillStyle = 'rgba(30,40,60,0.85)'; g.fillRect(cx - 10, cy + ch / 2 - 2, cw + 20, 4);
    }
    // plaza paving: a round checker with a rim
    {
      const [x0, y0] = R.plaza, cx = x0 + 128, cy = y0 + 128;
      g.save(); g.beginPath(); g.arc(cx, cy, 127, 0, TAU); g.clip();
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { g.fillStyle = (i + j) % 2 ? '#F6EAD2' : '#EADBBE'; g.fillRect(x0 + i * 16, y0 + j * 16, 16, 16); }
      g.strokeStyle = '#D3C09C'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, 122, 0, TAU); g.stroke();
      g.strokeStyle = '#E2CFA8'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 60, 0, TAU); g.stroke();
      g.restore();
    }
    // golf green, bunker, tee
    {
      const [x0, y0] = R.green;
      g.save(); g.beginPath(); g.arc(x0 + 64, y0 + 64, 62, 0, TAU); g.clip();
      g.fillStyle = '#8EDB6E'; g.fillRect(x0, y0, 128, 128);
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,60,0,0.06)'; g.fillRect(x0 + i * 16, y0, 16, 128); }
      g.restore();
      const [bx, by] = R.bunker;
      g.fillStyle = '#F1DFA6'; g.beginPath(); g.ellipse(bx + 64, by + 64, 60, 44, 0.3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(200,170,100,0.35)'; g.beginPath(); g.ellipse(bx + 70, by + 70, 44, 28, 0.3, 0, TAU); g.fill();
      const [tx, ty] = R.tee;
      g.fillStyle = '#9BE27A'; rrect(g, tx + 4, ty + 4, 120, 56, 16); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.15)'; for (let i = 0; i < 6; i++) g.fillRect(tx + 10 + i * 20, ty + 6, 10, 52);
    }
    // picnic blanket, beach towel, flower bed
    {
      const [x0, y0] = R.blanket;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { g.fillStyle = (i + j) % 2 ? '#FF5A5F' : '#FFFFFF'; g.fillRect(x0 + i * 8, y0 + j * 8, 8, 8); }
      const [ux, uy] = R.towel;
      for (let i = 0; i < 8; i++) { g.fillStyle = ['#1FA2FF', '#FFFFFF', '#FFC93C', '#FFFFFF'][i % 4]; g.fillRect(ux, uy + i * 8, 64, 8); }
      const [fx, fy] = R.flowers;
      g.save(); g.beginPath(); g.arc(fx + 32, fy + 32, 31, 0, TAU); g.clip();
      g.fillStyle = '#4C9E45'; g.fillRect(fx, fy, 64, 64);
      const petals = ['#FF6FAE', '#FFC93C', '#FFFFFF', '#FF5A5F', '#9B6BFF'];
      for (let i = 0; i < 70; i++) { g.fillStyle = petals[i % 5]; g.beginPath(); g.arc(fx + hash2(i, 1, 9) * 64, fy + hash2(i, 2, 9) * 64, 2.6, 0, TAU); g.fill(); }
      g.restore();
    }
    // runway
    {
      const [x0, y0, w, h] = R.runway;
      g.fillStyle = '#6E7480'; g.fillRect(x0, y0, w, h);
      g.fillStyle = '#FFFFFF';
      g.fillRect(x0 + 6, y0 + 6, w - 12, 3); g.fillRect(x0 + 6, y0 + h - 9, w - 12, 3);
      for (let i = 0; i < 12; i++) g.fillRect(x0 + 60 + i * 34, y0 + h / 2 - 2, 18, 4);
      for (let i = 0; i < 6; i++) { g.fillRect(x0 + 12, y0 + 16 + i * 12, 30, 6); g.fillRect(x0 + w - 42, y0 + 16 + i * 12, 30, 6); }
    }
    // signs
    const sign = (r, text, bg, fg, rim, size) => {
      const [x0, y0, w, h] = r;
      g.fillStyle = rim; rrect(g, x0 + 2, y0 + 2, w - 4, h - 4, h * 0.22); g.fill();
      g.fillStyle = bg; rrect(g, x0 + 10, y0 + 10, w - 20, h - 20, h * 0.16); g.fill();
      g.font = '700 ' + size + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillText(text, x0 + w / 2 + 3, y0 + h / 2 + 7);
      g.fillStyle = fg; g.fillText(text, x0 + w / 2, y0 + h / 2 + 4);
    };
    sign(R.lanes, 'SUNNY LANES', '#FF5A5F', '#FFFFFF', '#FFC93C', 72);
    sign(R.stadium, 'SUNNY STADIUM', '#8E5BE0', '#FFFFFF', '#FFFFFF', 56);
    sign(R.park, 'SUNNY PARK', '#2E86F0', '#FFFFFF', '#FFFFFF', 60);
    sign(R.welcome, 'SUNNY ISLE', '#FF9F1C', '#FFFFFF', '#FFFFFF', 66);
    {
      const [x0, y0, w, h] = R.board;
      g.fillStyle = '#21402E'; rrect(g, x0, y0, w, h, 14); g.fill();
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 5; rrect(g, x0 + 6, y0 + 6, w - 12, h - 12, 10); g.stroke();
      g.font = '700 30px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#FFFFFF';
      g.fillText('HOME', x0 + 26, y0 + 44); g.fillText('GUEST', x0 + 26, y0 + 92);
      g.fillStyle = '#FFC93C'; g.textAlign = 'right';
      g.fillText('5', x0 + w - 30, y0 + 44); g.fillText('3', x0 + w - 30, y0 + 92);
    }
    {
      const [x0, y0] = R.clock, cx = x0 + 64, cy = y0 + 64;
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(cx, cy, 60, 0, TAU); g.fill();
      g.strokeStyle = '#24324A'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 56, 0, TAU); g.stroke();
      g.lineWidth = 4;
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44); g.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50); g.stroke(); }
      g.lineCap = 'round'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 2, cy - 30); g.moveTo(cx, cy); g.lineTo(cx + 34, cy + 8); g.stroke();
    }
  }

  // =============================================================================================
  // 8. Geometry: terrain, sea, river & falls, landmarks (merged), decals, trees, movers, plane
  // =============================================================================================

  const GRID = { ext: 860, cell: 8 };
  GRID.n = Math.round(GRID.ext * 2 / GRID.cell) + 1;

  const COL = {
    sand: 0xF3DFA5, wetSand: 0xDCC58F, shelf: 0xE6D6A0, deep: 0x2A7EA8, mid: 0x6FC3C9,
    grassA: 0x8ACD6B, grassB: 0x62B256, forest: 0x4C9848, rock: 0x9E9282, rockDark: 0x7F7569, peak: 0xDCD5C8,
    road: 0xDCC596, pave: 0xE0D3B8, fairway: 0x9ADC74, fieldA: 0xE8C85A, fieldB: 0x7FBF4A, fieldC: 0xB78A55, river: 0xC9B98A,
  };

  // The grid of heights is shared by the mesh and the runtime ground queries, built once per page.
  let gridCache = null;
  function buildGrid() {
    if (gridCache) return gridCache;
    const N = GRID.n, c = GRID.cell, e = GRID.ext;
    const hts = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hts[j * N + i] = ISLE.height(-e + i * c, -e + j * c);
    gridCache = { hts };
    return gridCache;
  }
  /** Ground height from the grid, matching the rendered triangles (split along i+j). */
  function groundAt(x, z) {
    const G = gridCache, N = GRID.n, c = GRID.cell, e = GRID.ext;
    const fx = clamp((x + e) / c, 0, N - 1.001), fz = clamp((z + e) / c, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = G.hts, k = j * N + i;
    const a = h[k], b = h[k + 1], cc = h[k + N], d = h[k + N + 1];
    return u + v <= 1 ? a + (b - a) * u + (cc - a) * v : d + (cc - d) * (1 - u) + (b - d) * (1 - v);
  }

  function terrainColor(x, z, h, ny, out, tmpC) {
    const L = ISLE.L;
    const r = Math.hypot(x, z), d = ISLE.coastR(Math.atan2(z, x)) - r;
    const n1 = fbm(x * 0.021, z * 0.021, 41, 3), n2 = vnoise(x * 0.11, z * 0.11, 43);
    if (h < -0.4) {
      out.set(COL.shelf).lerp(tmpC.set(COL.mid), sstep(-1, -9, h)).lerp(tmpC.set(COL.deep), sstep(-9, -30, h));
      return out;
    }
    if (h < 3.6 && d < 75 && d > -40) {
      out.set(COL.sand).lerp(tmpC.set(COL.wetSand), sstep(1.2, 0, h));
      out.offsetHSL(0, 0, (n2 - 0.5) * 0.04);
      return out;
    }
    out.set(COL.grassA).lerp(tmpC.set(COL.grassB), sstep(0.35, 0.65, n1));
    if (h > 60) out.lerp(tmpC.set(COL.forest), sstep(60, 110, h) * 0.6);
    // farm fields in strips
    const df = Math.hypot(x - L.farm.x - 60, z - L.farm.z + 10);
    if (df < 110) {
      const band = Math.floor((x * 0.8 + z * 0.6) / 22);
      const fc = [COL.fieldA, COL.fieldB, COL.fieldC][((band % 3) + 3) % 3];
      out.lerp(tmpC.set(fc), sstep(110, 80, df) * 0.85);
    }
    // golf fairways and the airstrip apron
    const tmp = { d: 0, t: 0 };
    for (const gh of L.golf) {
      segDist(x, z, gh.tee[0], gh.tee[1], gh.green[0], gh.green[1], tmp);
      if (tmp.d < 26) {
        const stripe = Math.floor(tmp.t * 14) % 2 ? 0.035 : -0.02;
        out.lerp(tmpC.set(COL.fairway).offsetHSL(0, 0, stripe), sstep(26, 18, tmp.d));
      }
    }
    // rock on steep slopes and high up, a pale peak
    const rockAmt = Math.max(sstep(0.82, 0.62, ny), sstep(120, 175, h + (n1 - 0.5) * 40));
    if (rockAmt > 0) out.lerp(tmpC.set(COL.rock).lerp(new THREE.Color(COL.rockDark), n2 * 0.6), rockAmt);
    if (h > 205) out.lerp(tmpC.set(COL.peak), sstep(205, 245, h + (n2 - 0.5) * 16));
    // river banks
    const rv = ISLE.riverAt(x, z, tmp);
    if (rv.d < 16 && h < ISLE.riverBed(rv.t) + 6) out.lerp(tmpC.set(COL.river), sstep(16, 9, rv.d) * 0.8);
    // town paving
    const dt = Math.hypot(x - L.town.x, z - L.town.z);
    if (dt < 105) out.lerp(tmpC.set(COL.pave), sstep(105, 70, dt) * 0.55);
    // roads
    let rd = 99;
    for (const road of L.roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const a = road[i], b = road[i + 1];
        if (Math.min(a[0], b[0]) - 12 > x || Math.max(a[0], b[0]) + 12 < x || Math.min(a[1], b[1]) - 12 > z || Math.max(a[1], b[1]) + 12 < z) continue;
        rd = Math.min(rd, segDist(x, z, a[0], a[1], b[0], b[1], tmp).d);
      }
    }
    if (rd < 9) out.lerp(tmpC.set(COL.road), sstep(9, 5, rd));
    out.offsetHSL(0, 0, (n2 - 0.5) * 0.035);
    return out;
  }

  /** The island as one indexed grid mesh with vertex colors (deep-sea quads are left out). */
  function terrainGeometry(THREE) {
    const G = buildGrid(), N = GRID.n, c = GRID.cell, e = GRID.ext, h = G.hts;
    const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const out = new THREE.Color(), tmpC = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -e + i * c, z = -e + j * c, y = h[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const hl = h[j * N + Math.max(0, i - 1)], hr = h[j * N + Math.min(N - 1, i + 1)];
      const hu = h[Math.max(0, j - 1) * N + i], hd = h[Math.min(N - 1, j + 1) * N + i];
      let nx = (hl - hr) / (2 * c), ny = 1, nz = (hu - hd) / (2 * c);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      terrainColor(x, z, y, ny, out, tmpC);
      col[k * 3] = out.r; col[k * 3 + 1] = out.g; col[k * 3 + 2] = out.b;
    }
    const idx = [];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, cc = a + N, d = cc + 1;
      if (Math.max(h[a], h[b], h[cc], h[d]) < -24) continue;
      idx.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  /** The sea: rings out to the horizon, see-through over the shallows (vertex alpha), opaque far out. */
  function seaGeometry(THREE) {
    const radii = [0, 120, 260, 400, 520, 620, 700, 780, 860, 1000, 1300, 1900, 3000, 5200];
    const seg = 96, pos = [], col = [], uv = [], idx = [];
    const shallow = new THREE.Color(0x4FD0D6), deep = new THREE.Color(0x1E8CC4), far = new THREE.Color(0x2A86C0), c = new THREE.Color();
    for (let ri = 0; ri < radii.length; ri++) {
      for (let s = 0; s <= seg; s++) {
        const a = s / seg * TAU, r = radii[ri];
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, 0, z); uv.push(x / 36, z / 36);
        const t = sstep(560, 860, r);
        c.copy(shallow).lerp(deep, t).lerp(far, sstep(1000, 3000, r));
        col.push(c.r, c.g, c.b, lerp(0.62, 1, t));
      }
    }
    for (let ri = 0; ri < radii.length - 1; ri++) for (let s = 0; s < seg; s++) {
      const a = ri * (seg + 1) + s, b = a + 1, cc = a + seg + 1, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);   // counter-clockwise seen from above: the front faces up
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /** White surf hugging the coast of the island and the islets (vertex alpha fades to sea). */
  function foamGeometry(THREE) {
    const pos = [], col = [], idx = [];
    const ring = (pts) => {
      const base = pos.length / 3, n = pts.length;
      for (const [x, z, nx, nz] of pts) {
        pos.push(x - nx * 3, 0.12, z - nz * 3, x + nx * 9, 0.12, z + nz * 9);
        col.push(1, 1, 1, 0.85, 1, 1, 1, 0);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2, b = base + ((i + 1) % n) * 2;
        idx.push(a, b, a + 1, b, b + 1, a + 1);   // front faces up
      }
    };
    // trace the 0 m contour on rays from each centre
    const trace = (cx, cz, rMax, count) => {
      const pts = [];
      for (let s = 0; s < count; s++) {
        const a = s / count * TAU, dx = Math.cos(a), dz = Math.sin(a);
        let r = rMax;
        for (let k = 0; k < 60 && r > 0; k++) { if (ISLE.height(cx + dx * r, cz + dz * r) > 0) break; r -= rMax / 60; }
        let lo = r, hi = r + rMax / 60;
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (ISLE.height(cx + dx * m, cz + dz * m) > 0) lo = m; else hi = m; }
        pts.push([cx + dx * lo, cz + dz * lo, dx, dz]);
      }
      return pts;
    };
    ring(trace(0, 0, 820, 420));
    for (const s of ISLE.L.islets) ring(trace(s.x, s.z, s.r * 1.4, 48));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    return g;
  }

  /** River ribbon (planar sea UVs so the ripples match) and the pool disc. */
  function riverGeometry(THREE) {
    const pts = ISLE.L.river, pos = [], uv = [], col = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const t = i / (pts.length - 1), y = Math.max(0.2, ISLE.riverBed(t) + 1.4), w = lerp(10, 15, t);
      for (const s of [-1, 1]) {
        const x = pts[i][0] - dz * w * s, z = pts[i][1] + dx * w * s;
        pos.push(x, y, z); uv.push(x / 36, z / 36); col.push(0.1, 0.56, 0.74, 0.86);
      }
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }   // front faces up
    }
    const base = pos.length / 3, P = ISLE.L.pool, py = ISLE.L.pool.h + 1.4;
    pos.push(P.x, py, P.z); uv.push(P.x / 36, P.z / 36); col.push(0.1, 0.58, 0.76, 0.88);
    for (let s = 0; s <= 24; s++) {
      const a = s / 24 * TAU, x = P.x + Math.cos(a) * (P.r + 6), z = P.z + Math.sin(a) * (P.r + 6);
      pos.push(x, py, z); uv.push(x / 36, z / 36); col.push(0.1, 0.58, 0.76, 0.88);
      if (s) idx.push(base, base + s + 1, base + s);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    return g;
  }

  /** The waterfall: a curved sheet from the lip to the pool (UVs scroll downward). */
  function fallsGeometry(THREE) {
    const L = ISLE.L, S = STRUCT;
    const ax = L.fallsTop.x, az = L.fallsTop.z, bx = L.pool.x, bz = L.pool.z;
    let dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz); dx /= len; dz /= len;
    const px = -dz, pz = dx, rows = 12, cols = 6, W = 16;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, drop = t * t;
      const cx = ax + dx * (len * 0.55 * Math.sqrt(t)), cz = az + dz * (len * 0.55 * Math.sqrt(t));
      const y = lerp(S.falls.top + 0.6, S.falls.pool - 0.2, drop);
      for (let i = 0; i <= cols; i++) {
        const s = i / cols - 0.5, w = W * (1 + t * 0.35);
        pos.push(cx + px * s * w + dx * Math.abs(s) * -3, y, cz + pz * s * w + dz * Math.abs(s) * -3);
        uv.push(i / cols * 2, t * 3);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---- landmark kit: every static structure merged into one vertex-colored mesh ----------------------
  // Colliders: { cyl: [x, z, r, y0, y1] } and { box: [x, z, hx, hz, rotY, y0, y1] } (rotY like Object3D.rotation.y)

  function landmarkKit(THREE, W) {
    const L = ISLE.L, S = STRUCT;
    const parts = [], colliders = [], crowdRows = { tennis: [], ballpark: [], beach: [] };
    const rng = SS.util.rng(77);
    const paint = (g, hex) => W.paint(g, hex);
    const put = (g, x, y, z, ry = 0, rx = 0, rz = 0) => { if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); parts.push(g); return g; };
    const box = (w, h, d, hex) => paint(new THREE.BoxGeometry(w, h, d), hex);
    const cyl = (rt, rb, h, seg, hex) => paint(new THREE.CylinderGeometry(rt, rb, h, seg), hex);
    const cone = (r, h, seg, hex) => paint(new THREE.ConeGeometry(r, h, seg), hex);
    const sph = (r, ws, hs, hex) => paint(new THREE.SphereGeometry(r, ws, hs), hex);
    const prism = (w, h, d, hex) => {   // a gable roof: ridge along x
      const sh = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
      g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2);
      return paint(g, hex);
    };
    const local = (cx, cz, ry, lx, lz) => [cx + lx * Math.cos(ry) + lz * Math.sin(ry), cz - lx * Math.sin(ry) + lz * Math.cos(ry)];
    const addBox = (x, z, hx, hz, ry, y0, y1) => colliders.push({ box: [x, z, hx, hz, ry, y0, y1] });
    const addCyl = (x, z, r, y0, y1) => colliders.push({ cyl: [x, z, r, y0, y1] });
    const rock = (r, hex) => {
      const g = new THREE.DodecahedronGeometry(r, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.8 + hash2(i, Math.round(r * 10), 3) * 0.35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
      g.computeVertexNormals();
      return paint(g, hex);
    };
    const house = (x, z, ry, w, d, h, wall, roof) => {
      const g = H(x, z);
      put(box(w, h + 2, d, wall), x, g + h / 2 - 1, z, ry);
      put(prism(w + 0.8, h * 0.45 + 1.2, d + 0.8, roof), x, g + h, z, ry);
      const [fx, fz] = local(x, z, ry, 0, d / 2 + 0.05);
      put(box(1.4, 2.4, 0.2, 0x7A4E2E), fx, g + 1.2, fz, ry);
      for (const s of [-1, 1]) { const [wx, wz] = local(x, z, ry, s * w * 0.3, d / 2 + 0.05); put(box(1.3, 1.3, 0.2, 0x7FC8F0), wx, g + h * 0.62, wz, ry); }
      addBox(x, z, w / 2 + 0.4, d / 2 + 0.4, ry, g - 2, g + h + h * 0.45 + 1.2);
    };
    const _rd = { d: 0, t: 0 };
    const onRoad = (x, z, r) => L.roads.some(rd => { for (let i = 0; i < rd.length - 1; i++) if (segDist(x, z, rd[i][0], rd[i][1], rd[i + 1][0], rd[i + 1][1], _rd).d < r) return true; return false; });
    const WALLS = [0xFFD7A8, 0xFFB9B9, 0xBFE3FF, 0xCDEFB9, 0xFFF1A8, 0xE4CDFF, 0xFFFFFF, 0xFFCFE6];
    const ROOFS = [0xE8634F, 0x3F7FD9, 0xF29A38, 0xD94C6B, 0x4FAE6E, 0x8D62D9];

    // Lighthouse on its rock, with the keeper's cottage
    {
      const { x, z } = L.lighthouse, g = S.lighthouse.ground, T = S.lighthouse;
      const tower = new THREE.CylinderGeometry(T.r1, T.r0, T.tower, 18, 8);
      W.paint(tower, (px, py, pz, out) => out.set(Math.floor((py + T.tower / 2) / (T.tower / 5)) % 2 ? 0xFFFFFF : 0xE8434B));
      put(tower, x, g + T.tower / 2, z);
      put(cyl(T.r0 + 0.6, T.r0 + 0.6, 0.6, 18, 0x2E3A4F), x, g + T.tower + 0.3, z);
      put(cyl(1.9, 1.9, 3, 12, 0xFFF3B0), x, g + T.tower + 2.1, z);
      put(cone(2.5, 2.4, 12, 0xE8434B), x, g + T.tower + 4.8, z);
      put(sph(0.5, 8, 6, 0xFFC93C), x, g + T.tower + 6.2, z);
      put(cyl(T.r0 + 1.4, T.r0 + 2.2, 1.6, 18, 0x9C9284), x, g + 0.2, z);
      const [hx, hz] = local(x, z, 0.8, -11, -2);
      house(hx, hz, 0.8 + Math.PI / 2, 8, 6, 4, 0xFFFFFF, 0xE8434B);
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU + rng.range(-0.2, 0.2), rr = rng.range(14, 34);
        const rx = x + Math.cos(a) * rr, rz = z + Math.sin(a) * rr;
        put(rock(rng.range(2.5, 5.5), i % 3 ? 0x9A8E7E : 0x857B6E), rx, Math.max(H(rx, rz), -1) + 0.5, rz, rng.next() * TAU);
      }
      addCyl(x, z, T.r0 + 0.8, g - 6, g + T.tower + 7);
    }

    // Windmills (rotors are separate, animated)
    for (const w of S.windmills) {
      const T = S.windmill;
      put(cyl(1.8, 2.8, T.tower + 4, 10, 0xF6F1E4), w.x, w.g + T.tower / 2 - 2, w.z);
      const cap = sph(2.4, 10, 6, 0xC0504D); cap.scale(1, 0.8, 1.3);
      put(cap, w.x, w.g + T.tower + 0.4, w.z, w.face);
      const [dx, dz] = [w.x + Math.sin(w.face + Math.PI) * 2.7, w.z + Math.cos(w.face + Math.PI) * 2.7];
      put(box(1.3, 2.2, 0.4, 0x7A4E2E), dx, w.g + 1.1, dz, w.face);
      addCyl(w.x, w.z, 2.9, w.g - 5, w.g + T.tower + 2.5);
    }

    // Sunny Bridge: orange deck, through-arches with hangers, piers
    {
      const B = S.bridge, { x, z } = L.bridge, ry = -B.rot;
      const deck = box(B.half * 2, 1.6, B.width, 0xFF8A3D);
      put(deck, x, B.deck - 0.8, z, ry);
      for (const s of [-1, 1]) {
        const [rx, rz] = local(x, z, ry, 0, s * (B.width / 2 - 0.2));
        put(box(B.half * 2, 0.9, 0.25, 0xFFFFFF), rx, B.deck + 0.45, rz, ry);
        const pts = [];
        for (let k = 0; k <= 16; k++) { const t = k / 16 * 2 - 1; pts.push(new THREE.Vector3(t * 44, (1 - t * t) * (B.archTop - B.deck), 0)); }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.75, 6, false);
        paint(tube, 0xFF7A2A);
        const [ax, az] = local(x, z, ry, 0, s * (B.width / 2 + 0.3));
        put(tube, ax, B.deck, az, ry);
        for (let k = -4; k <= 4; k++) {
          if (!k) continue;
          const t = k / 5, hh = (1 - t * t) * (B.archTop - B.deck);
          const [hx2, hz2] = local(x, z, ry, t * 44, s * (B.width / 2 + 0.3));
          put(cyl(0.12, 0.12, hh, 5, 0xFFFFFF), hx2, B.deck + hh / 2, hz2);
        }
      }
      for (const lx of [-34, 34]) for (const s of [-1, 1]) {
        const [px, pz] = local(x, z, ry, lx, s * 3.4);
        const g = H(px, pz) - 3;
        put(cyl(1.1, 1.3, B.deck - g, 10, 0xE9DEC8), px, (B.deck + g) / 2 - 0.8, pz);
        addCyl(px, pz, 1.6, g, B.deck);
      }
      addBox(x, z, B.half, B.width / 2 + 0.6, ry, B.deck - 2.2, B.deck + 1.4);
      for (const s of [-1, 1]) {
        const [ax, az] = local(x, z, ry, 0, s * (B.width / 2 + 0.3));
        addBox(ax, az, 30, 0.9, ry, B.deck, B.archTop - 3);
        addBox(ax, az, 18, 0.9, ry, B.archTop - 3, B.archTop + 1);
      }
    }

    // Sunny Lanes: the bowling hall with a giant pin and ball on the roof
    const facePlaza = (x, z) => Math.atan2(L.plaza.x - x, L.plaza.z - z);
    {
      const B = S.bowling, { x, z } = L.bowling, ry = facePlaza(x, z), g = B.g;
      put(box(B.w, B.h + 2, B.d, 0xFFE3E6), x, g + B.h / 2 - 1, z, ry);
      const [sx, sz] = local(x, z, ry, 0, B.d / 2 + 0.06);
      put(box(B.w + 0.2, 1.4, 0.3, 0xFF5A5F), sx, g + B.h - 1.6, sz, ry);
      put(box(B.w + 1.2, 0.8, B.d + 1.2, 0xE8505B), x, g + B.h + 0.4, z, ry);
      const [ex, ez] = local(x, z, ry, 0, B.d / 2 + 2);
      put(box(12, 0.5, 4, 0xFFC93C), ex, g + 4.2, ez, ry);
      put(box(6, 3.6, 0.3, 0x7FC8F0), sx, g + 1.8, sz, ry);
      const prof = [[0, 0], [0.026, 0], [0.042, 0.03], [0.058, 0.09], [0.06, 0.125], [0.053, 0.17], [0.036, 0.215], [0.03, 0.228],
        [0.025, 0.242], [0.0235, 0.25], [0.024, 0.262], [0.026, 0.272], [0.033, 0.31], [0.033, 0.345], [0.022, 0.372], [0, 0.38]];
      const k = B.pin / 0.38;
      const pin = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * k, y * k)), 16);
      W.paint(pin, (px, py, pz, out) => out.set((py > 0.226 * k && py < 0.243 * k) || (py > 0.25 * k && py < 0.266 * k) ? 0xE8343A : 0xFFFFFF));
      put(pin, x, g + B.h + 0.8, z);
      const [bx, bz] = local(x, z, ry, 8, -3);
      put(sph(2.4, 16, 12, 0x2F5FD8), bx, g + B.h + 3.2, bz);
      addBox(x, z, B.w / 2 + 0.6, B.d / 2 + 0.6, ry, g - 2, g + B.h + 0.8);
      addCyl(x, z, 2.4, g + B.h, g + B.h + B.pin + 0.8);
      addCyl(bx, bz, 2.6, g + B.h, g + B.h + 5.6);
    }

    // Tennis stadium: court (decal), two long stands + one end stand
    {
      const { x, z } = L.tennis, ry = -L.tennis.rot, g = S.tennis.g;
      const stand = (lx, lz, width, rows) => {
        const [sx, sz] = local(x, z, ry, lx, lz);
        const facing = Math.atan2(x - sx, z - sz);
        const st = W.stands(null, { x: sx, y: g, z: sz, width, rows, rise: 0.55, depth: 0.95, facing, color: 0x8E5BE0 });
        const m = st.children[0];
        st.updateMatrixWorld(true);
        const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
        parts.push(geo);
        m.geometry.dispose();
        crowdRows.tennis.push(...st.userData.rows.filter((r, i) => i % 2 === 0));
        const d = rows * 0.95;
        const [cx, cz] = local(sx, sz, facing, 0, -d / 2);
        addBox(cx, cz, width / 2 + 0.4, d / 2 + 0.4, facing, g - 1, g + rows * 0.55 + 1.4);
      };
      stand(15, 0, 34, 6);
      stand(-15, 0, 34, 6);
      stand(0, 24, 16, 5);
      // net posts and band
      for (const s of [-1, 1]) { const [px, pz] = local(x, z, ry, s * 6.4, 0); put(cyl(0.08, 0.08, 1.1, 6, 0x2F5D50), px, g + 0.55, pz); }
      put(box(12.8, 0.9, 0.04, 0x2E3A4F), x, g + 0.55, z, ry);
      put(box(12.8, 0.1, 0.06, 0xFFFFFF), x, g + 1.02, z, ry);
      const [ux, uz] = local(x, z, ry, -8, 0);
      put(box(1, 2.4, 1, 0x2F5D50), ux, g + 1.2, uz, ry);
    }

    // Ballpark: outfield fence, stands behind home, light towers, scoreboard
    {
      const P = S.ballpark, rot = L.ballpark.rot, g = P.g;
      const [hx, hz] = P.home;
      const dir = (a) => [Math.sin(rot + a), Math.cos(rot + a)];
      for (let k = 0; k < 18; k++) {
        const a0 = -Math.PI / 4 + k / 18 * Math.PI / 2, a1 = a0 + Math.PI / 36;
        const [d0x, d0z] = dir(a0), [d1x, d1z] = dir(a1);
        const x0 = hx + d0x * P.fence, z0 = hz + d0z * P.fence, x1 = hx + d1x * P.fence, z1 = hz + d1z * P.fence;
        const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
        put(box(len + 0.3, 3, 0.5, 0x2E7D4F), (x0 + x1) / 2, g + 1.3, (z0 + z1) / 2, ang);
        put(box(len + 0.3, 0.3, 0.6, 0xFFC93C), (x0 + x1) / 2, g + 2.95, (z0 + z1) / 2, ang);
      }
      const stand = (a, dist, width) => {
        const [dx, dz] = dir(a);
        const sx = hx - dx * dist, sz = hz - dz * dist;
        const facing = Math.atan2(hx - sx, hz - sz);
        const st = W.stands(null, { x: sx, y: g, z: sz, width, rows: 6, rise: 0.55, depth: 0.95, facing, color: 0x2E86F0 });
        const m = st.children[0];
        st.updateMatrixWorld(true);
        parts.push(m.geometry.clone().applyMatrix4(m.matrixWorld));
        m.geometry.dispose();
        crowdRows.ballpark.push(...st.userData.rows.filter((r, i) => i % 2 === 0));
        const [cx, cz] = local(sx, sz, facing, 0, -3);
        addBox(cx, cz, width / 2 + 0.4, 3.4, facing, g - 1, g + 4.8);
      };
      stand(0, 16, 30);
      stand(-0.95, 19, 26);
      stand(0.95, 19, 26);
      const [bx, bz] = [hx + Math.sin(rot) * (P.fence + 12), hz + Math.cos(rot) * (P.fence + 12)];
      put(box(22, 12, 1.4, 0x21402E), bx, g + P.board - 6, bz, rot);
      for (const s of [-1, 1]) { const [lx, lz] = local(bx, bz, rot, s * 7, -0.5); put(box(1.2, P.board - 6, 1.2, 0x5B6577), lx, g + (P.board - 6) / 2, lz, rot); }
      addBox(bx, bz, 11.4, 1.6, rot, g - 1, g + P.board + 0.2);
      for (const a of [-0.6, 0.6]) {
        const [dx, dz] = dir(a);
        const tx = hx + dx * (P.fence + 6), tz = hz + dz * (P.fence + 6);
        put(cyl(0.45, 0.65, 26, 8, 0xD9DEE6), tx, g + 13, tz);
        put(box(5, 2.6, 1.2, 0xF4F6FA), tx, g + 26.5, tz, rot + a + Math.PI);
        addCyl(tx, tz, 1.4, g - 1, g + 28);
      }
    }

    // Plaza: fountain, lamp posts, flower beds
    {
      const { x, z } = L.plaza, g = S.plaza.g, F = S.plaza;
      put(cyl(F.basin, F.basin + 0.4, 1.4, 32, 0xE9DEC8), x, g + 0.7, z);
      put(paint(new THREE.TorusGeometry(F.basin, 0.45, 8, 40), 0xF4ECDD), x, g + 1.4, z, 0, Math.PI / 2);
      put(cyl(0.9, 1.2, 4.6, 14, 0xE9DEC8), x, g + 2.3, z);
      put(paint(new THREE.SphereGeometry(2.6, 20, 8, 0, TAU, Math.PI / 2, Math.PI / 2), 0xF4ECDD), x, g + 5.6, z);
      put(cyl(0.4, 0.55, 1.8, 10, 0xE9DEC8), x, g + 6.3, z);
      put(sph(0.7, 14, 10, 0xFFC93C), x, g + 7.4, z);
      put(cyl(F.basin - 0.2, F.basin - 0.2, 0.1, 32, 0x56C3F0), x, g + 1.15, z);
      addCyl(x, z, F.basin + 0.8, g - 1, g + F.fountain);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + 0.3, lx = x + Math.cos(a) * 34, lz = z + Math.sin(a) * 34;
        put(cyl(0.18, 0.25, 6, 8, 0x2F5D50), lx, g + 3, lz);
        put(sph(0.55, 10, 8, 0xFFF4D6), lx, g + 6.2, lz);
      }
    }

    // Town: houses around the square, the clock tower, market stalls
    {
      const { x, z } = L.town, g0 = S.town.g;
      let n = 0;
      for (let ring = 0; ring < 3; ring++) {
        const rr = 34 + ring * 22, count = 9 + ring * 6;
        for (let k = 0; k < count; k++) {
          const a = k / count * TAU + ring * 0.37 + rng.range(-0.08, 0.08);
          const hx = x + Math.cos(a) * rr, hz = z + Math.sin(a) * rr;
          if (Math.hypot(hx - S.clock.x, hz - S.clock.z) < 12) continue;
          if (Math.hypot(hx - S.harbor.x, hz - S.harbor.z) < 70) continue;
          if (onRoad(hx, hz, 10)) continue;   // the streets stay open (the harbor road is Ring Run's climb into town)
          const ry = Math.atan2(x - hx, z - hz);
          house(hx, hz, ry, rng.range(7, 10), rng.range(6.5, 9), rng.range(5, 9), WALLS[n % WALLS.length], ROOFS[(n * 5 + ring) % ROOFS.length]);
          n++;
        }
      }
      const C = S.clock;
      put(box(5.4, C.h, 5.4, 0xFFF1DA), C.x, g0 + C.h / 2, C.z);
      put(box(6.4, 0.6, 6.4, 0xE0C9A6), C.x, g0 + C.h - 4.5, C.z);
      put(cone(4.6, 6, 4, 0x3F7FD9), C.x, g0 + C.h + 3, C.z, Math.PI / 4);
      addBox(C.x, C.z, 3.3, 3.3, 0, g0 - 2, g0 + C.h + 6);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU + 0.6, sx = x - 10 + Math.cos(a) * 12, sz = z + 6 + Math.sin(a) * 12;
        put(box(3.2, 2.2, 2.4, 0xFFFFFF), sx, H(sx, sz) + 1.1, sz, a);
        put(box(3.8, 0.3, 3, [0xFF5A5F, 0x1FA2FF, 0xFFC93C, 0x3BC45B][i]), sx, H(sx, sz) + 2.5, sz, a);
      }
    }

    // Harbor: piers, a warehouse, moored boats and the breakwater
    {
      const { x, z } = S.harbor, rot = L.harbor.rot;
      const inward = [-Math.cos(rot), -Math.sin(rot)];
      for (let k = -1; k <= 1; k++) {
        const side = [-inward[1], inward[0]];
        const bx = x + inward[0] * 34 + side[0] * k * 24, bz = z + inward[1] * 34 + side[1] * k * 24;
        const ry = Math.atan2(-inward[0], -inward[1]);
        const [px, pz] = local(bx, bz, ry, 0, 16);
        put(box(4, 0.6, 34, 0xB58552), px, 1.4, pz, ry);
        for (let p = 0; p < 6; p++) { const [qx, qz] = local(bx, bz, ry, 2.1 * (p % 2 ? 1 : -1), 2 + p * 6); put(cyl(0.25, 0.25, 4, 6, 0x7A5A3C), qx, -0.6, qz); }
        for (let b = 0; b < 2; b++) {
          const [mx, mz] = local(bx, bz, ry, 6 * (b ? 1 : -1), 12 + b * 12);
          const hull = box(3, 1.4, 7, [0xFFFFFF, 0x1FA2FF, 0xFF5A5F, 0xFFC93C, 0x3BC45B, 0xFFFFFF][(k + 1) * 2 + b]);
          put(hull, mx, 0.5, mz, ry);
          put(box(2, 1.4, 2.4, 0xFFFFFF), mx, 1.9, mz - 0.5, ry);
        }
      }
      // the warehouse stands off to the north side, clear of the climb from the harbor up to the town
      const [wx, wz] = [x + inward[0] * 80 - inward[1] * 30, z + inward[1] * 80 + inward[0] * 30];
      put(box(18, 8, 12, 0xC9D7E6), wx, H(wx, wz) + 3, wz, rot + Math.PI / 2);
      put(prism(18.6, 3, 12.6, 0x3F7FD9), wx, H(wx, wz) + 7, wz, rot + Math.PI / 2);
      addBox(wx, wz, 9.5, 6.5, rot + Math.PI / 2, H(wx, wz) - 2, H(wx, wz) + 10);
      for (let i = 0; i <= 14; i++) {
        const a = rot - 0.2 + i / 14 * 0.42, [bx, bz] = ISLE.polar(a, -50 - Math.sin(i / 14 * Math.PI) * 8);
        if (Math.abs(i - 7) < 2) continue;
        put(rock(rng.range(3, 4.4), 0x8E8578), bx, 0.6, bz, rng.next() * TAU);
        addCyl(bx, bz, 3.6, -8, 3.2);
      }
    }

    // Airstrip: runway (decal), hangar, windsock
    {
      const A = L.airstrip, g = S.airstrip.g, ry = -A.rot;
      const [hx, hz] = local(A.x, A.z, ry, -40, -34);
      const hangar = new THREE.CylinderGeometry(10, 10, 22, 16, 1, false, 0, Math.PI);
      hangar.rotateZ(Math.PI / 2); hangar.rotateY(Math.PI / 2);
      put(paint(hangar, 0xD94C4C), hx, g, hz, ry);
      const [ex, ez] = local(hx, hz, ry, 0, -11);
      put(box(20, 9, 0.4, 0xF4F6FA), ex, g + 4.5, ez, ry);
      addBox(hx, hz, 10.5, 11.5, ry, g - 2, g + 10.2);
      const [sx, sz] = local(A.x, A.z, ry, 60, -26);
      put(cyl(0.18, 0.22, 8, 6, 0xE9EEF4), sx, g + 4, sz);
      const sock = new THREE.CylinderGeometry(0.5, 0.9, 3.6, 8, 4, true);
      W.paint(sock, (px, py, pz, out) => out.set(Math.floor((py + 1.8) / 0.9) % 2 ? 0xFFFFFF : 0xFF8A2B));
      put(sock, sx + 1.8, g + 7.4, sz, 0, 0, Math.PI / 2 + 0.2);
    }

    // Sunny Farm: barn, silo, haystacks
    {
      const F = L.farm, g = S.farm.g;
      put(box(16, 9, 11, 0xC94A3D), F.x, g + 3.5, F.z, 0.4);
      put(prism(16.6, 4.5, 11.6, 0x5B4636), F.x, g + 8, F.z, 0.4);
      const [dx, dz] = local(F.x, F.z, 0.4, 0, 5.6);
      put(box(4, 5, 0.3, 0xFFFFFF), dx, g + 2.5, dz, 0.4);
      addBox(F.x, F.z, 8.4, 5.9, 0.4, g - 2, g + 12.5);
      const [sx, sz] = local(F.x, F.z, 0.4, 12, -2);
      put(cyl(3, 3, 14, 12, 0xD9DEE6), sx, g + 7, sz);
      put(paint(new THREE.SphereGeometry(3, 12, 6, 0, TAU, 0, Math.PI / 2), 0x8C99AA), sx, g + 14, sz);
      addCyl(sx, sz, 3.4, g - 1, g + 17);
      for (let i = 0; i < 5; i++) {
        const hx = F.x + 30 + i * 9, hz = F.z + 24 - i * 4;
        put(cyl(1.6, 1.6, 2.2, 10, 0xF0D27A), hx, H(hx, hz) + 1.1, hz, 0, Math.PI / 2);
      }
      house(F.x - 22, F.z + 16, 0.4, 9, 8, 5, 0xFFF1DA, 0xE8634F);
    }

    // Treetop Lookout: a giant fig tree with a deck and a little hut
    {
      const T = L.treehouse, g = S.treehouse.g, D = S.treehouse.deck;
      put(cyl(1.3, 2.4, 30, 10, 0x8B5E3C), T.x, g + 13, T.z);
      const blob = (r, x, y, z) => { const b = new THREE.IcosahedronGeometry(r, 1); W.paint(b, (px, py, pz, out) => out.set(0x3E8C3A).lerp(new THREE.Color(0x7CCB5E), clamp((py + r) / (2 * r), 0, 1) * 0.85)); put(b, x, y, z); };
      blob(8, T.x, g + 27, T.z); blob(6, T.x + 6, g + 23, T.z + 3); blob(6, T.x - 5, g + 24, T.z - 4); blob(5, T.x + 1, g + 31, T.z - 2);
      put(cyl(5, 5, 0.6, 14, 0xB58552), T.x, g + D, T.z);
      put(box(4, 3, 4, 0xFFC93C), T.x + 1.5, g + D + 1.8, T.z + 1);
      put(prism(4.6, 2, 4.6, 0xE8634F), T.x + 1.5, g + D + 3.3, T.z + 1);
      addCyl(T.x, T.z, 3, g - 2, g + D + 4);
      addCyl(T.x, T.z, 9, g + 19, g + 35);
    }

    // Picnic Hill: a big shady tree
    {
      const P = L.picnic, g = S.picnic.g;
      put(cyl(0.8, 1.2, 8, 8, 0x8B5E3C), P.x, g + 4, P.z);
      const b = new THREE.IcosahedronGeometry(6, 1);
      W.paint(b, (px, py, pz, out) => out.set(0x3E8C3A).lerp(new THREE.Color(0x86D063), clamp((py + 6) / 12, 0, 1)));
      put(b, P.x, g + 11, P.z);
      addCyl(P.x, P.z, 6, g - 1, g + 17);
    }

    // Lifeguard tower and beach umbrellas on Palm Beach
    {
      const LG = S.lifeguard;
      for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) put(cyl(0.15, 0.15, 5, 6, 0xFFFFFF), LG.x + lx, LG.g + 2.5, LG.z + lz);
      put(box(4, 0.4, 4, 0xFFFFFF), LG.x, LG.g + 5, LG.z);
      put(box(3.4, 2.6, 3.4, 0xFF5A5F), LG.x, LG.g + 6.5, LG.z);
      put(prism(4.2, 1.4, 4.2, 0xFFFFFF), LG.x, LG.g + 7.8, LG.z);
      put(cyl(0.08, 0.08, 3, 5, 0xFFFFFF), LG.x + 2, LG.g + 9.5, LG.z);
      put(box(0.05, 1, 1.4, 0x3BC45B), LG.x + 2, LG.g + 10.4, LG.z + 0.7);
      addCyl(LG.x, LG.z, 3, LG.g - 1, LG.g + 11);
      const UMB = [0xFF5A5F, 0x1FA2FF, 0xFFC93C, 0x3BC45B, 0xFF6FAE, 0x8E5BE0];
      for (let i = 0; i < 9; i++) {
        const [ux, uz] = ISLE.polar(1.16 + i * 0.06, 24 + (i % 2) * 8);
        const ug = H(ux, uz);
        put(cyl(0.06, 0.06, 2.6, 5, 0xFFFFFF), ux, ug + 1.3, uz);
        const um = new THREE.ConeGeometry(1.8, 0.8, 8);
        W.paint(um, (px, py, pz, out) => out.set(Math.floor((Math.atan2(pz, px) + Math.PI) / (TAU / 8)) % 2 ? UMB[i % UMB.length] : 0xFFFFFF));
        put(um, ux, ug + 2.8, uz);
        const [px, pz] = ISLE.polar(1.16 + i * 0.06, 21 + (i % 2) * 8);
        crowdRows.beach.push({ x: px, y: H(px, pz), z: pz, length: 1.2, facing: Math.atan2(-px, -pz) + Math.PI });
      }
    }

    // Shipwreck "Lucky Daisy"
    {
      const { x, z } = L.shipwreck;
      const hull = box(5, 3.4, 16, 0x7A5A3C);
      hull.rotateZ(0.32); hull.rotateX(-0.12);
      put(hull, x, -0.3, z, 0.9);
      const mast = cyl(0.25, 0.3, 11, 6, 0x6B4A2E);
      mast.rotateZ(0.38);
      put(mast, x - 1.4, 4.2, z, 0.9);
      const sail = new THREE.PlaneGeometry(4, 3.4);
      paint(sail, 0xF2EAD6);
      sail.rotateZ(0.38); sail.translate(-0.4, 5.5, 0.2);
      put(sail, x, 0, z, 0.9);
      addCyl(x, z, 4, -6, 5);
    }

    // The sea arch
    {
      const A = S.arch, ry = -A.rot + Math.PI / 2;
      const top = new THREE.TorusGeometry(15, 5.4, 8, 14, Math.PI);
      const p = top.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 1 + (hash2(i, 3, 7) - 0.5) * 0.12; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * (1 + (hash2(i, 5, 7) - 0.5) * 0.3)); }
      top.computeVertexNormals();
      W.paint(top, (px, py, pz, out) => out.set(0x9E9282).lerp(new THREE.Color(0x7F7569), clamp(hash2(Math.round(px), Math.round(py), 2), 0, 1) * 0.6));
      put(top, A.x, A.clear - 15 + 5, A.z, ry);
      for (const s of [-1, 1]) {
        const [lx, lz] = local(A.x, A.z, ry, s * 15, 0);
        put(rock(6.4, 0x8E8476).scale(1, 2.2, 1), lx, -2, lz, rng.next());
        addCyl(lx, lz, 6, -12, A.clear - 4);
      }
      addBox(A.x, A.z, 21, 5.6, ry, A.clear - 0.5, A.clear + 12);
    }

    // Rocks around Seashell Cove and on Gull Rock
    for (let i = 0; i < 10; i++) {
      const [rx, rz] = ISLE.polar(-2.66 + (i - 4.5) * 0.03, rng.range(-12, 6));
      put(rock(rng.range(3, 6), 0x9A8E7E), rx, Math.max(-1, H(rx, rz)) + 1, rz, rng.next() * TAU);
    }
    {
      const s = L.islets[1];
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rx = s.x + Math.cos(a) * 20, rz = s.z + Math.sin(a) * 20; put(rock(rng.range(3, 5), 0xA39886), rx, Math.max(-1, H(rx, rz)) + 1, rz, a); }
    }

    // Golf: flags on the greens
    for (const gh of L.golf) {
      const [gx, gz] = gh.green, g = H(gx, gz);
      put(cyl(0.12, 0.12, 7, 6, 0xFFFFFF), gx, g + 3.5, gz);
      const flag = new THREE.BufferGeometry();
      flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.6, 0, 2.6, -0.8, 0, 0, 0, 0, 2.6, -0.8, 0, 0, -1.6, 0], 3));
      flag.computeVertexNormals();
      put(paint(flag, 0xFF5A5F), gx, g + 7, gz, 0.6);
    }

    // "Sunny Isle" welcome sign posts near the beach road
    {
      const [wx, wz] = [L.beach.x - 4, L.beach.z - 56];
      for (const s of [-1, 1]) put(cyl(0.2, 0.2, 5, 6, 0xFFFFFF), wx + s * 5, H(wx, wz) + 2.5, wz);
    }

    const geo = W.mergeGeometries(parts);
    return { geo, colliders, crowdRows };
  }

  /** Every textured flat thing (courts, fields, paving, greens, runway, signs) as one atlas mesh. */
  function decalGeometry(THREE) {
    const L = ISLE.L, S = STRUCT;
    const parts = [];
    const quad = (region, w, h, x, y, z, ry, flat = true) => {
      const g = new THREE.PlaneGeometry(w, h);
      const [rx, ry0, rw, rh] = region, uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (rx + uv.getX(i) * rw) / 1024, 1 - (ry0 + (1 - uv.getY(i)) * rh) / 1024);
      if (flat) g.rotateX(-Math.PI / 2);
      g.rotateY(ry);
      g.translate(x, y, z);
      parts.push(g);
    };
    const A = ATLAS;
    // ballpark field: home at the bottom centre of the region
    {
      const P = S.ballpark, rot = L.ballpark.rot, size = P.fence * 512 / 470 * 1.0;
      const [hx, hz] = P.home;
      const cx = hx + Math.sin(rot) * (size / 2 - 12 * size / 512), cz = hz + Math.cos(rot) * (size / 2 - 12 * size / 512);
      quad(A.ballpark, size, size, cx, P.g + 0.18, cz, rot + Math.PI);
    }
    quad(A.tennis, 20, 40, L.tennis.x, S.tennis.g + 0.18, L.tennis.z, -L.tennis.rot);
    quad(A.plaza, 80, 80, L.plaza.x, S.plaza.g + 0.18, L.plaza.z, 0);
    for (const gh of L.golf) {
      quad(A.green, 30, 30, gh.green[0], H(gh.green[0], gh.green[1]) + 0.2, gh.green[1], 0);
      const ang = Math.atan2(gh.green[0] - gh.tee[0], gh.green[1] - gh.tee[1]);
      quad(A.tee, 14, 7, gh.tee[0], H(gh.tee[0], gh.tee[1]) + 0.2, gh.tee[1], ang + Math.PI / 2);
      const bx = gh.green[0] + 22, bz = gh.green[1] - 6;
      quad(A.bunker, 18, 14, bx, H(bx, bz) + 0.22, bz, 0.4);
    }
    quad(A.runway, L.airstrip.len, 22, L.airstrip.x, S.airstrip.g + 0.2, L.airstrip.z, -L.airstrip.rot);
    quad(A.blanket, 5, 5, L.picnic.x + 7, S.picnic.g + 0.25, L.picnic.z + 4, 0.3);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.2, fx = L.plaza.x + Math.cos(a) * 46, fz = L.plaza.z + Math.sin(a) * 46;
      quad(A.flowers, 8, 8, fx, H(fx, fz) + 0.25, fz, a);
    }
    for (let i = 0; i < 9; i++) {
      const [tx, tz] = ISLE.polar(1.16 + i * 0.06 + 0.015, 26 + (i % 2) * 8);
      quad(A.towel, 1.6, 3, tx, H(tx, tz) + 0.15, tz, i * 0.7);
    }
    // signs: SUNNY LANES over the bowling entrance, the stadium and park names, the scoreboard, clocks, welcome
    {
      const B = S.bowling, { x, z } = L.bowling, ry = Math.atan2(L.plaza.x - x, L.plaza.z - z);
      const fx = x + Math.sin(ry) * (B.d / 2 + 0.25), fz = z + Math.cos(ry) * (B.d / 2 + 0.25);
      quad(A.lanes, 24, 6, fx, B.g + B.h - 3.6, fz, ry, false);
    }
    {
      const { x, z } = L.tennis, ry = -L.tennis.rot;
      const fx = x + Math.sin(ry) * 30, fz = z + Math.cos(ry) * 30;
      quad(A.stadium, 16, 3, fx, S.tennis.g + 5.2, fz, ry, false);
    }
    {
      const P = S.ballpark, rot = L.ballpark.rot;
      const [hx, hz] = P.home;
      const bx = hx + Math.sin(rot) * (P.fence + 11.2), bz = hz + Math.cos(rot) * (P.fence + 11.2);
      quad(A.board, 20, 8, bx, P.g + P.board - 5, bz, rot + Math.PI, false);
      const sx = hx - Math.sin(rot) * 23.5, sz = hz - Math.cos(rot) * 23.5;
      quad(A.park, 18, 3.4, sx, P.g + 5.6, sz, rot + Math.PI, false);
    }
    {
      const C = S.clock, y = S.town.g + C.h - 2.4;
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; quad(A.clock, 3.6, 3.6, C.x + Math.sin(a) * 2.75, y, C.z + Math.cos(a) * 2.75, a, false); }
    }
    {
      const [wx, wz] = [L.beach.x - 4, L.beach.z - 56];
      quad(A.welcome, 12, 2.6, wx, H(wx, wz) + 4.2, wz, Math.PI, false);
      quad(A.welcome, 12, 2.6, wx, H(wx, wz) + 4.2, wz - 0.02, 0, false);
    }
    return SS.world.mergeGeometries(parts.map(g => { SS.world.paint(g, 0xFFFFFF); return g; }));
  }

  // ---- trees (instanced: palms, round trees, pines) -------------------------------------------------

  function palmGeometry(THREE, W) {
    const parts = [];
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const seg = new THREE.CylinderGeometry(0.22 - t * 0.06, 0.3 - t * 0.06, 1.6, 5, 1, true);
      W.paint(seg, i % 2 ? 0x9C7650 : 0x8A6642);
      seg.rotateZ(-0.06 * i);
      seg.translate(0.25 * i * i * 0.12, 0.8 + i * 1.5, 0);
      parts.push(seg);
    }
    const top = [0.25 * 16 * 0.12 + 0.1, 0.8 + 4 * 1.5 + 0.9];
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * TAU;
      const leaf = new THREE.BufferGeometry();
      const L = 3.4, Wd = 0.75;
      leaf.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, L * 0.5, 0.35, Wd, L * 0.5, 0.35, -Wd,
        L * 0.5, 0.35, Wd, L, -0.9, 0, L * 0.5, 0.35, -Wd,
      ], 3));
      leaf.computeVertexNormals();
      W.paint(leaf, (x, y, z, out) => out.set(0x3E9A3E).lerp(new THREE.Color(0x7CCB4E), x / L));
      leaf.rotateY(a);
      leaf.translate(top[0], top[1], 0);
      parts.push(leaf);
    }
    const nut = new THREE.IcosahedronGeometry(0.28, 0);
    W.paint(nut, 0x6B4A2E);
    nut.translate(top[0], top[1] - 0.3, 0.2);
    parts.push(nut);
    return W.mergeGeometries(parts);
  }

  function roundTreeGeometry(THREE, W) {
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5, 1, true);
    trunk.translate(0, 1.2, 0);
    W.paint(trunk, 0x8B5E3C);
    const c1 = new THREE.IcosahedronGeometry(1.9, 1);
    c1.translate(0, 3.6, 0);
    const c2 = new THREE.IcosahedronGeometry(1.3, 0);
    c2.translate(0.9, 3.0, 0.5);
    for (const c of [c1, c2]) W.paint(c, (x, y, z, out) => out.set(0x3B8A3A).lerp(new THREE.Color(0x86D063), clamp((y - 2) / 3.4, 0, 1)));
    return W.mergeGeometries([trunk, c1, c2]);
  }

  function pineGeometry(THREE, W) {
    const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 5, 1, true);
    trunk.translate(0, 0.8, 0);
    W.paint(trunk, 0x7A5034);
    const parts = [trunk];
    for (const [r, h, y] of [[1.7, 2.6, 2.3], [1.2, 2.2, 3.7]]) {
      const c = new THREE.ConeGeometry(r, h, 7, 1, true);
      c.translate(0, y, 0);
      W.paint(c, (x, yy, z, out) => out.set(0x2C6E3E).lerp(new THREE.Color(0x5BAA5E), clamp((yy - 1.2) / 3.5, 0, 1)));
      parts.push(c);
    }
    return W.mergeGeometries(parts);
  }

  /** Tree spots: palms on the beaches and islets, round trees in the lowlands, pines up the mountain. */
  function plantTrees(colliders) {
    const L = ISLE.L;
    const rng = SS.util.rng(4242);
    const out = { palm: [], round: [], pine: [] };
    const blocked = [];
    const block = (x, z, r) => blocked.push([x, z, r]);
    block(L.plaza.x, L.plaza.z, 70); block(L.tennis.x, L.tennis.z, 60); block(L.ballpark.x, L.ballpark.z, 110);
    block(L.bowling.x, L.bowling.z, 45); block(L.town.x, L.town.z, 115); block(L.farm.x + 40, L.farm.z, 120);
    block(L.airstrip.x, L.airstrip.z, 150); block(L.lighthouse.x, L.lighthouse.z, 55); block(L.harbor.x, L.harbor.z, 100);
    block(L.treehouse.x, L.treehouse.z, 18); block(L.picnic.x, L.picnic.z, 22); block(STRUCT.lifeguard.x, STRUCT.lifeguard.z, 12);
    block(L.bridge.x, L.bridge.z, 80); block(L.pool.x, L.pool.z, 40);
    for (const w of L.windmills) block(w.x, w.z, 14);
    for (const g of L.golf) { block(g.tee[0], g.tee[1], 26); block(g.green[0], g.green[1], 34); }
    const isBlocked = (x, z) => blocked.some(([bx, bz, r]) => (x - bx) * (x - bx) + (z - bz) * (z - bz) < r * r);
    const tmp = { d: 0, t: 0 };
    const nearRoad = (x, z) => L.roads.some(rd => { for (let i = 0; i < rd.length - 1; i++) if (segDist(x, z, rd[i][0], rd[i][1], rd[i + 1][0], rd[i + 1][1], tmp).d < 9) return true; return false; });
    const nearFairway = (x, z) => L.golf.some(g => segDist(x, z, g.tee[0], g.tee[1], g.green[0], g.green[1], tmp).d < 30);
    for (let k = 0; k < 9000 && (out.palm.length < 210 || out.round.length < 330 || out.pine.length < 280); k++) {
      const x = rng.range(-830, 830), z = rng.range(-830, 830);
      const h = ISLE.height(x, z);
      if (h < 0.8) continue;
      const d = ISLE.coastR(Math.atan2(z, x)) - Math.hypot(x, z);
      if (isBlocked(x, z) || nearRoad(x, z)) continue;
      const rv = ISLE.riverAt(x, z, tmp);
      if (rv.d < 14) continue;
      const slope = Math.abs(ISLE.height(x + 3, z) - h) + Math.abs(ISLE.height(x, z + 3) - h);
      const forest = fbm(x * 0.008, z * 0.008, 61, 3);
      const isletPalm = L.islets.some(s => Math.hypot(x - s.x, z - s.z) < s.r);
      if ((d > 8 && d < 70 && h < 9) || isletPalm) {
        if (out.palm.length < 210 && rng.chance(isletPalm ? 0.5 : 0.6)) out.palm.push([x, h, z, rng.range(0.85, 1.25), rng.next() * TAU]);
      } else if (h > 70 && h < 205 && slope < 9) {
        if (out.pine.length < 280 && rng.chance(0.35 + forest * 0.5)) out.pine.push([x, h, z, rng.range(1.4, 2.4), rng.next() * TAU]);
      } else if (d > 70 && h < 90 && slope < 6 && !nearFairway(x, z)) {
        if (out.round.length < 330 && forest > 0.47 && rng.chance(0.75)) out.round.push([x, h, z, rng.range(1.7, 2.9), rng.next() * TAU]);
      }
    }
    for (const t of out.round) colliders.push({ cyl: [t[0], t[2], 1.6 * t[3], t[1] - 1, t[1] + 4.6 * t[3]], soft: true });
    for (const t of out.pine) colliders.push({ cyl: [t[0], t[2], 1.2 * t[3], t[1] - 1, t[1] + 4.6 * t[3]], soft: true });
    return out;
  }

  // ---- movers: windmill rotors, sailboats, hot-air balloons, birds ----------------------------------

  function rotorGeometry(THREE, W) {
    const parts = [];
    const hub = new THREE.CylinderGeometry(0.6, 0.6, 0.8, 8);
    hub.rotateX(Math.PI / 2);
    W.paint(hub, 0x7A4E2E);
    parts.push(hub);
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU;
      const spar = new THREE.BoxGeometry(0.3, STRUCT.windmill.blade, 0.2);
      spar.translate(0, STRUCT.windmill.blade / 2 + 0.4, 0);
      W.paint(spar, 0x8B6A48);
      const sail = new THREE.BoxGeometry(1.7, STRUCT.windmill.blade - 2, 0.08);
      sail.translate(0.95, STRUCT.windmill.blade / 2 + 1.4, 0.05);
      W.paint(sail, 0xFFFAF0);
      for (const g of [spar, sail]) { g.rotateZ(a); parts.push(g); }
    }
    return W.mergeGeometries(parts);
  }

  function sailboatGeometry(THREE, W) {
    const hull = new THREE.CylinderGeometry(1.1, 0.6, 6, 8, 1);
    hull.rotateX(Math.PI / 2); hull.scale(1, 0.6, 1);
    const p = hull.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > 2) p.setX(i, p.getX(i) * 0.3);
    hull.computeVertexNormals();
    W.paint(hull, 0xFFFFFF);
    hull.translate(0, 0.3, 0);
    const mast = new THREE.CylinderGeometry(0.08, 0.1, 8, 5);
    mast.translate(0, 4.5, 0.3);
    W.paint(mast, 0xC9B79A);
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0.4, 0, 8.2, 0.4, 0, 1.2, -3.2, 0, 1.2, 0.4, 0, 1.2, -3.2, 0, 8.2, 0.4], 3));
    sail.computeVertexNormals();
    W.paint(sail, 0xFFFFFF);
    const jib = new THREE.BufferGeometry();
    jib.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0.6, 0, 7, 0.5, 0, 1.2, 2.8, 0, 1.2, 0.6, 0, 1.2, 2.8, 0, 7, 0.5], 3));
    jib.computeVertexNormals();
    W.paint(jib, 0xFFE9A8);
    return W.mergeGeometries([hull, mast, sail, jib]);
  }

  function hotAirGeometry(THREE, W) {
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, y = t * 16;
      const r = t < 0.18 ? lerp(1.4, 4.2, t / 0.18) : 6.4 * Math.sin(Math.min(1, (t - 0.05) / 0.98) * Math.PI * 0.62 + 0.55) * (t > 0.93 ? (1 - t) / 0.07 * 0.6 + 0.4 : 1);
      prof.push(new THREE.Vector2(Math.max(0.01, r), y));
    }
    const env = new THREE.LatheGeometry(prof, 16);
    const GORES = [0xFF5A5F, 0xFFC93C, 0x1FA2FF, 0xFFFFFF];
    W.paint(env, (x, y, z, out) => out.set(GORES[Math.floor((Math.atan2(z, x) + Math.PI) / TAU * 16) % 4]));
    env.translate(0, 4.6, 0);
    const basket = new THREE.BoxGeometry(1.6, 1.2, 1.6);
    W.paint(basket, 0x9C6B3C);
    const ropes = [];
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      const r = new THREE.CylinderGeometry(0.03, 0.03, 4.2, 3);
      r.translate(x * 1.6, 2.6, z * 1.6);
      W.paint(r, 0x5B4636);
      ropes.push(r);
    }
    return W.mergeGeometries([env, basket, ...ropes]);
  }

  function birdGeometry(THREE, W) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.35, -0.9, 0.25, -0.2, 0, 0, -0.25,
      0, 0, 0.35, 0, 0, -0.25, 0.9, 0.25, -0.2,
    ], 3));
    g.computeVertexNormals();
    W.paint(g, 0xF4F6FA);
    return g;
  }

  // ---- the plane ---------------------------------------------------------------------------------------
  // Built facing +Z (nose), up +Y; the pilot's right wing is −X.

  function planeGeometries(THREE, W) {
    const body = [], trim = [];
    const fus = new THREE.LatheGeometry([[0, -3.4], [0.2, -3.36], [0.36, -3.0], [0.5, -2.2], [0.64, -1.2], [0.74, 0], [0.76, 0.9], [0.72, 1.6], [0.64, 2.05], [0.52, 2.32], [0.3, 2.42]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
    fus.rotateX(Math.PI / 2);
    fus.scale(1, 0.94, 1);
    body.push(fus);
    for (const s of [-1, 1]) {
      const wing = new THREE.BoxGeometry(3.5, 0.2, 1.45, 4, 1, 1);
      const p = wing.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getX(i) + 1.75) / 3.5;
        p.setZ(i, p.getZ(i) * (1 - t * 0.25) - t * 0.12);
        p.setY(i, p.getY(i) * (1 - t * 0.3));
      }
      wing.computeVertexNormals();
      wing.translate(1.75 + 0.35, 0, 0);
      wing.rotateZ(4 * DEG);
      if (s < 0) wing.scale(-1, 1, 1);
      wing.translate(0, -0.28, 0.45);
      body.push(wing);
      const tip = new THREE.SphereGeometry(0.55, 8, 6);
      tip.scale(0.35, 0.24, 1);
      tip.translate(s * 3.82, -0.03, 0.3);
      trim.push(W.paint(tip, 0xFFFFFF));
    }
    const tail = new THREE.BoxGeometry(2.8, 0.14, 0.85);
    tail.translate(0, 0.12, -2.95);
    body.push(tail);
    const fin = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.1, 0), new THREE.Vector2(0.35, 1.25), new THREE.Vector2(0, 1.2)]), { depth: 0.12, bevelEnabled: false });
    fin.translate(0, 0, -0.06); fin.rotateY(Math.PI / 2); fin.translate(0, 0.35, -2.4);
    body.push(fin);
    // trim: cowling ring, spinner, stripe band, windscreen, gear
    const cowl = new THREE.TorusGeometry(0.62, 0.1, 8, 20);
    cowl.translate(0, 0, 2.3);
    trim.push(W.paint(cowl, 0xE9EEF4));
    const spin = new THREE.ConeGeometry(0.28, 0.6, 10);
    spin.rotateX(Math.PI / 2); spin.translate(0, 0, 2.7);
    trim.push(W.paint(spin, 0xFFC93C));
    const band = new THREE.CylinderGeometry(0.62, 0.66, 0.36, 14, 1, true);
    band.rotateX(Math.PI / 2); band.translate(0, 0, -1.25);
    trim.push(W.paint(band, 0xFFFFFF));
    const band2 = band.clone(); band2.translate(0, 0, -0.5);
    trim.push(W.paint(band2, 0xFFFFFF));
    const screen = new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI, 0, Math.PI / 2);
    screen.scale(0.9, 0.55, 0.5); screen.rotateY(-Math.PI / 2 + Math.PI / 2); screen.translate(0, 0.64, 0.48);
    trim.push(W.paint(screen, 0xBFE6FF));
    const rim = new THREE.TorusGeometry(0.46, 0.07, 6, 16);
    rim.rotateX(Math.PI / 2); rim.scale(1, 1, 1.4); rim.translate(0, 0.68, -0.32);
    trim.push(W.paint(rim, 0x3A2E2A));
    for (const s of [-1, 1]) {
      const strut = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5);
      strut.rotateZ(s * 0.35); strut.translate(s * 0.75, -0.9, 0.85);
      trim.push(W.paint(strut, 0x5B6577));
      const wheel = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 12);
      wheel.rotateZ(Math.PI / 2); wheel.translate(s * 0.92, -1.32, 0.85);
      trim.push(W.paint(wheel, 0x2A2F3A));
    }
    const tw = new THREE.SphereGeometry(0.13, 8, 6); tw.translate(0, -0.48, -3.05);
    trim.push(W.paint(tw, 0x2A2F3A));
    const prop = new THREE.BoxGeometry(0.2, 2.3, 0.05);
    W.paint(prop, 0x3A3F4E);
    const blur = new THREE.CircleGeometry(1.2, 28);
    return { body: W.mergeGeometries(body), trim: W.mergeGeometries(trim), prop, blur };
  }

  /** A short ribbon for the pilot's scarf (animated in place). */
  function scarfGeometry(THREE) {
    const g = new THREE.PlaneGeometry(0.2, 1.3, 1, 8);
    g.translate(0, -0.65, 0);
    g.rotateX(-Math.PI / 2 + 0.25);
    return g;
  }

  // ---- shared, built once per page: geometries, textures, materials, colliders, minimap ----------
  // Everything here is marked userData.shared so leaving a game never disposes it (Play Again is instant).

  let ASSETS = null;
  function assets(THREE, W) {
    if (ASSETS) return ASSETS;
    const shared = x => { x.userData.shared = true; return x; };
    const canvasTex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return shared(t); };
    buildGrid();
    const kit = landmarkKit(THREE, W);
    const A = { colliders: kit.colliders, crowdRows: kit.crowdRows };
    A.terrain = shared(terrainGeometry(THREE));
    A.sea = shared(seaGeometry(THREE));
    // an opaque deep-sea floor under the see-through water, where the terrain grid leaves out deep quads
    A.deep = shared(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2).translate(0, -26, 0));
    A.foam = shared(foamGeometry(THREE));
    A.river = shared(riverGeometry(THREE));
    A.falls = shared(fallsGeometry(THREE));
    A.statics = shared(kit.geo);
    A.decals = shared(decalGeometry(THREE));
    A.trees = plantTrees(A.colliders);
    A.palm = shared(palmGeometry(THREE, W));
    A.round = shared(roundTreeGeometry(THREE, W));
    A.pine = shared(pineGeometry(THREE, W));
    A.rotor = shared(rotorGeometry(THREE, W));
    A.sailboat = shared(sailboatGeometry(THREE, W));
    A.hotair = shared(hotAirGeometry(THREE, W));
    A.bird = shared(birdGeometry(THREE, W));
    const pg = planeGeometries(THREE, W);
    A.planeBody = shared(pg.body); A.planeTrim = shared(pg.trim); A.prop = shared(pg.prop); A.blur = shared(pg.blur);
    A.scarf = scarfGeometry;
    // balloons, strings, rings, guide arrow
    A.balloon = shared(new THREE.SphereGeometry(BALLOON_R, 14, 9).scale(1, 1.18, 1));
    A.knot = shared(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 4).translate(0, -BALLOON_R * 1.18 - 1.6, 0));
    A.ring = shared(new THREE.TorusGeometry(RING_R + 0.9, 0.9, 8, 36));
    A.halo = shared(new THREE.TorusGeometry(RING_R + 0.9, 0.35, 6, 40));
    {
      // a chunky 3D arrow pointing along +Z: reads from any angle
      const head = new THREE.ConeGeometry(1.25, 2.4, 14);
      head.rotateX(Math.PI / 2); head.translate(0, 0, 1.2);
      const shaft = new THREE.CylinderGeometry(0.5, 0.5, 2, 12);
      shaft.rotateX(Math.PI / 2); shaft.translate(0, 0, -0.9);
      A.arrow = shared(W.mergeGeometries([head, shaft]));
    }
    // clouds: one merged mesh, plus the volumes you can fly through
    {
      const rng = SS.util.rng(909);
      const parts = [];
      A.cloudVols = [];
      const spots = [[210, 222, -60, 6], [-420, 205, -120, 5.5], [380, 240, 260, 6.5], [-200, 255, 480, 5], [60, 190, -380, 4.5], [-600, 230, 280, 6],
        [600, 215, -280, 5.5], [-80, 268, 140, 5], [480, 250, -620, 6.5], [-520, 245, -560, 6], [180, 205, 640, 5.5], [-760, 210, -40, 5],
        [760, 230, 40, 6], [-260, 285, -380, 5.5], [320, 270, 520, -5], [-380, 228, 700, 6], [40, 300, -760, 6.5], [700, 285, 560, 5], [-700, 260, 520, 5.5], [-60, 214, 340, 4.6]];
      for (const [x, y, z, sc] of spots) {
        const s = Math.abs(sc);
        const cl = W.cloud(s, rng);
        const mesh = cl.children[0];
        const g = mesh.geometry.clone();
        mesh.geometry.dispose();
        g.rotateY(rng.next() * TAU);
        g.translate(x, y, z);
        parts.push(g);
        A.cloudVols.push({ x, y: y + s * 1.2, z, rx: s * 4.6, ry: s * 2.2, rz: s * 3.6 });
      }
      A.clouds = shared(W.mergeGeometries(parts));
      A.cloudMat = W.cloud(1, rng).children[0].material;
    }
    // collider grid (40 m cells); each footprint is grown by the plane's radius (+1 m) so a plane centred in the
    // neighbouring cell still tests it
    A.cells = new Map();
    const margin = FLY.radius + 1;
    A.colliders.forEach((c, i) => {
      let x0, x1, z0, z1;
      if (c.cyl) { const [x, z, r] = c.cyl; x0 = x - r - margin; x1 = x + r + margin; z0 = z - r - margin; z1 = z + r + margin; }
      else { const [x, z, hx, hz] = c.box; const R = Math.hypot(hx, hz) + margin; x0 = x - R; x1 = x + R; z0 = z - R; z1 = z + R; }
      for (let gx = Math.floor(x0 / 40); gx <= Math.floor(x1 / 40); gx++) for (let gz = Math.floor(z0 / 40); gz <= Math.floor(z1 / 40); gz++) {
        const k = gx * 1000 + gz;
        if (!A.cells.has(k)) A.cells.set(k, []);
        A.cells.get(k).push(i);
      }
    });
    // textures & materials
    const markerC = makeCanvas(512, 256); drawMarkerAtlas(markerC);
    A.markerTex = canvasTex(markerC);
    A.beamTex = canvasTex(beamCanvas());
    A.blurTex = canvasTex(blurDiscCanvas());
    A.normalTex = canvasTex(waveNormalCanvas(), false);
    A.normalTex.wrapS = A.normalTex.wrapT = THREE.RepeatWrapping;
    A.streakTex = canvasTex(streakCanvas());
    A.streakTex.wrapS = A.streakTex.wrapT = THREE.RepeatWrapping;
    const atlasC = makeCanvas(1024); drawAtlas(atlasC);
    A.atlasTex = canvasTex(atlasC);
    A.atlasTex.anisotropy = 4;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawAtlas(atlasC); A.atlasTex.needsUpdate = true; drawMarkerAtlas(markerC); A.markerTex.needsUpdate = true; });
    A.mats = {
      terrain: shared(new THREE.MeshLambertMaterial({ vertexColors: true })),
      deep: shared(new THREE.MeshLambertMaterial({ color: COL.deep })),
      sea: shared(new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, normalMap: A.normalTex, normalScale: new THREE.Vector2(0.35, 0.35), specular: 0xCFEFFF, shininess: 70, depthWrite: false })),
      foam: shared(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.7 })),
      falls: shared(new THREE.MeshLambertMaterial({ map: A.streakTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, emissive: 0x6F8FA8 })),
      statics: shared(new THREE.MeshLambertMaterial({ vertexColors: true })),
      decals: shared(new THREE.MeshLambertMaterial({ map: A.atlasTex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      trees: shared(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })),
      movers: shared(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })),
      balloon: shared(new THREE.MeshPhongMaterial({ color: 0xFFFFFF, shininess: 80, specular: 0x666666 })),
      string: shared(new THREE.MeshBasicMaterial({ color: 0xF4F6FA })),
      ring: shared(new THREE.MeshPhongMaterial({ color: 0xFFFFFF, shininess: 60, specular: 0x444444, emissive: 0x2A2A2A })),
      halo: shared(new THREE.MeshBasicMaterial({ color: 0xFFE27D, transparent: true, opacity: 0.5, depthWrite: false })),
      arrow: shared(new THREE.MeshPhongMaterial({ color: 0xFFC93C, emissive: 0x8A5A00, shininess: 50, transparent: true, opacity: 0.92 })),
      trim: shared(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x444444 })),
      prop: shared(new THREE.MeshPhongMaterial({ color: 0xFFFFFF, vertexColors: true, shininess: 30 })),
      blur: shared(new THREE.MeshBasicMaterial({ map: A.blurTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })),
    };
    A.mats.sea.map = null;
    // minimap base: the island painted from the height grid (sea, sand, grass, rock), 256² over ±900 m
    {
      const S = 256, c = makeCanvas(S), g = c.getContext('2d'), img = g.createImageData(S, S);
      const tc = A.terrain.attributes.color.array, N = GRID.n, col = new THREE.Color(), shallow = new THREE.Color(0.2, 0.75, 0.75);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const x = (i + 0.5) / S * 1800 - 900, z = (j + 0.5) / S * 1800 - 900;
        const gi = Math.round((x + GRID.ext) / GRID.cell), gj = Math.round((z + GRID.ext) / GRID.cell);
        const inside = gi >= 0 && gj >= 0 && gi < N && gj < N;
        const h = inside ? gridCache.hts[gj * N + gi] : -30;
        if (h < 0.2) col.setRGB(0.05, 0.3, 0.55).lerp(shallow, sstep(-8, 0, h));
        else { const k = (gj * N + gi) * 3; col.setRGB(tc[k], tc[k + 1], tc[k + 2]); }
        col.convertLinearToSRGB();
        const k = (j * S + i) * 4;
        img.data[k] = col.r * 255; img.data[k + 1] = col.g * 255; img.data[k + 2] = col.b * 255; img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      A.minimap = c;
    }
    ASSETS = A;
    return A;
  }

  // =============================================================================================
  // 9. HUD styles
  // =============================================================================================

  const HUD_CSS = `
.fl-off { opacity: 0 !important; pointer-events: none !important; }
.fl-top .ss-chip { font: 700 17px/1 var(--font-display); gap: 6px; }
.fl-top .ss-chip svg { width: 17px; height: 17px; flex: none; }
.fl-time { min-width: 74px; justify-content: center; }
.fl-time.warn { background: #FF5A5F; color: #fff; animation: fl-beat .5s ease-in-out infinite alternate; }
.fl-time.paused { opacity: .7; }
.fl-score b { font: inherit; min-width: 18px; text-align: center; }
.fl-score.bump { animation: fl-bump .35s cubic-bezier(.3,1.6,.5,1); }
.fl-combo { position: relative; overflow: hidden; background: #FFC93C !important; color: #6A4300 !important; }
.fl-combo i { position: absolute; left: 0; bottom: 0; height: 4px; width: 100%; background: rgba(106,67,0,.4); transform-origin: left; }
.fl-mk { position: absolute; top: calc(var(--sat) + 12px); right: calc(var(--sar) + 12px); background: #FF9F1C; color: #fff; box-shadow: var(--shadow-soft);
  font: 700 16px/1 var(--font-display); gap: 5px; padding: 6px 11px 6px 6px; }
.fl-mk span.ic { width: 22px; height: 22px; border-radius: 50%; background: #fff; color: #FF9F1C; display: flex; align-items: center; justify-content: center;
  font: 700 16px/1 var(--font-display); }
.fl-mk.pop { animation: fl-bump .45s cubic-bezier(.3,1.6,.5,1); }
.fl-left { position: absolute; top: calc(var(--sat) + 70px); left: calc(var(--sal) + 10px); display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.fl-player { gap: 7px; padding: 3px 12px 3px 3px; }
.fl-player .ss-portrait { width: 30px; height: 30px; }
.fl-map { position: absolute; left: calc(var(--sal) + 12px); bottom: calc(var(--sab) + 14px); width: 98px; height: 98px; border-radius: 50%;
  border: 3px solid #fff; box-shadow: 0 3px 12px rgba(22, 58, 108, .3); background: #2A86C0; overflow: hidden; }
.fl-map canvas { width: 100%; height: 100%; display: block; }
.fl-btn { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 3px; touch-action: none; }
.fl-btn button { border: 0; padding: 0; border-radius: 50%; cursor: pointer; touch-action: none; display: flex; align-items: center; justify-content: center;
  font: 700 14px/1 var(--font-display); letter-spacing: .02em; color: #fff; -webkit-user-select: none; user-select: none; }
.fl-btn small { font: 900 10px/1 var(--font-ui); letter-spacing: .1em; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.55); }
.fl-boost { right: calc(var(--sar) + 14px); bottom: calc(var(--sab) + 14px); }
.fl-boost .ring { width: 80px; height: 80px; border-radius: 50%; padding: 5px; box-sizing: border-box; box-shadow: 0 4px 14px rgba(22, 58, 108, .3);
  background: conic-gradient(#FFE27D calc(var(--boost, 1) * 1turn), rgba(255,255,255,.45) 0); }
.fl-boost button { width: 70px; height: 70px; background: linear-gradient(180deg, #FFB547, #FF8A00); box-shadow: inset 0 -4px 0 rgba(160, 70, 0, .35); }
.fl-boost button svg { width: 30px; height: 30px; }
.fl-boost.on button { background: linear-gradient(180deg, #FFD27D, #FFA21C); transform: scale(.94); }
.fl-boost.empty button { filter: saturate(.3) brightness(.9); }
.fl-brake { left: calc(var(--sal) + 124px); bottom: calc(var(--sab) + 20px); }
.fl-brake button { width: 60px; height: 60px; background: rgba(255,255,255,.96); color: var(--ink); box-shadow: 0 3px 0 #CEDBEA, 0 6px 16px rgba(22,58,108,.2); }
.fl-brake button svg { width: 26px; height: 26px; }
.fl-brake.on button { background: #DCE8F5; transform: translateY(2px); box-shadow: 0 1px 0 #CEDBEA; }
.fl-readout { position: absolute; right: calc(var(--sar) + 104px); bottom: calc(var(--sab) + 22px); display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.fl-readout .ss-chip { font: 800 12px/1 var(--font-ui); padding: 5px 9px; gap: 4px; }
.fl-readout .ss-chip b { font: 700 15px/1 var(--font-display); min-width: 24px; text-align: right; }
.fl-hint { right: calc(var(--sar) + 22px); bottom: calc(var(--sab) + 128px); }
.fl-hint button { width: 58px; height: 58px; position: relative; background: rgba(255,255,255,.97); color: #FF9F1C; box-shadow: 0 3px 0 #CEDBEA, 0 6px 16px rgba(22,58,108,.2);
  font: 700 28px/1 var(--font-display); }
.fl-hint button::after { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(rgba(36,50,74,.45) calc(var(--cd, 0) * 1turn), transparent 0); }
.fl-hint.ready button { animation: fl-beat .8s ease-in-out infinite alternate; }
.fl-stick { position: absolute; left: 0; top: 0; border-radius: 50%; border: 3px solid rgba(255,255,255,.75); background: rgba(20,32,56,.14);
  box-shadow: 0 0 0 2px rgba(20,32,56,.12); pointer-events: none; transition: opacity .15s; will-change: transform; }
.fl-stick i { position: absolute; left: 50%; top: 50%; width: 38px; height: 38px; margin: -19px 0 0 -19px; border-radius: 50%; background: #fff;
  box-shadow: 0 2px 8px rgba(20,32,56,.35); will-change: transform; }
.fl-lines { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.fl-lines svg { width: 100%; height: 100%; display: block; }
.fl-lines line { stroke: rgba(255,255,255,.75); stroke-width: 2.5; stroke-linecap: round; }
.fl-flash { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, rgba(255,255,255,.75), #fff 75%); opacity: 0; }
.fl-edge { position: absolute; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; pointer-events: none; transition: opacity .2s; }
.fl-edge svg { width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(20,32,56,.45)); }
.fl-card { position: absolute; left: 50%; top: calc(var(--sat) + 62px); transform: translateX(-50%); width: min(380px, calc(100% - 24px)); box-sizing: border-box;
  display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px 14px 12px; background: #fff; border-radius: 22px; box-shadow: var(--shadow);
  cursor: pointer; overflow: hidden; animation: fl-card-in .45s cubic-bezier(.3,1.4,.5,1) both; }
.fl-card.out { animation: fl-card-out .3s ease-in forwards; }
.fl-card .ic { flex: none; width: 46px; height: 46px; border-radius: 50%; background: #FF9F1C; color: #fff; display: flex; align-items: center; justify-content: center;
  font: 700 30px/1 var(--font-display); box-shadow: 0 0 0 4px #FFE3B8; }
.fl-card h4 { margin: 2px 0 4px; font: 700 19px/1.1 var(--font-display); color: var(--ink); display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.fl-card h4 small { font: 800 12px/1 var(--font-ui); color: #D9700A; background: #FFF1DC; padding: 3px 7px; border-radius: 99px; }
.fl-card p { margin: 0; font: 700 14px/1.38 var(--font-ui); color: var(--ink-soft); }
.fl-card .bar { position: absolute; left: 0; bottom: 0; height: 4px; width: 100%; background: #FF9F1C; transform-origin: left; }
.fl-turnwrap { position: absolute; left: 0; right: 0; top: 30%; display: flex; justify-content: center; transition: opacity .25s, transform .25s; }
.fl-turnwrap.out { opacity: 0; transform: translateY(-14px) scale(.95); }
.fl-turncard { display: flex; align-items: center; gap: 12px; max-width: calc(100% - 28px); padding: 10px 22px 10px 10px; background: #fff; border-radius: 44px;
  box-shadow: 0 10px 30px rgba(22, 40, 80, .3); }
.fl-turncard .ss-portrait { width: 64px; height: 64px; }
.fl-turncard h3 { margin: 0; font: 700 clamp(20px, 6.4vw, 28px)/1.05 var(--font-display); color: var(--ink); white-space: nowrap; }
.fl-turncard p { margin: 4px 0 0; font: 800 13px/1 var(--font-ui); color: var(--ink-soft); }
@keyframes fl-beat { from { transform: scale(1); } to { transform: scale(1.07); } }
@keyframes fl-bump { 0% { transform: scale(1); } 40% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes fl-card-in { from { opacity: 0; transform: translate(-50%, -16px) scale(.9); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes fl-card-out { to { opacity: 0; transform: translate(-50%, -12px) scale(.95); } }
@media (max-height: 520px) and (orientation: landscape) {
  .fl-left { top: calc(var(--sat) + 60px); }
  .fl-map { width: 82px; height: 82px; bottom: calc(var(--sab) + 10px); }
  .fl-brake { left: calc(var(--sal) + 106px); bottom: calc(var(--sab) + 12px); }
  .fl-boost { bottom: calc(var(--sab) + 10px); }
  .fl-boost .ring { width: 72px; height: 72px; }
  .fl-boost button { width: 62px; height: 62px; }
  .fl-readout { right: calc(var(--sar) + 96px); bottom: calc(var(--sab) + 14px); }
  .fl-hint { top: calc(var(--sat) + 10px); bottom: auto; right: calc(var(--sar) + 14px); }
  .fl-hint button { width: 50px; height: 50px; font-size: 24px; }
  .fl-mk.tour { right: calc(var(--sar) + 74px); }
  /* the info card sits low between BRAKE and the readout, out of the flight line ahead */
  .fl-card { top: auto; bottom: calc(var(--sab) + 10px); width: min(400px, calc(100% - 380px)); min-width: 280px; padding: 9px 12px 11px 10px; gap: 10px; }
  .fl-card .ic { width: 36px; height: 36px; font-size: 24px; }
  .fl-card h4 { font-size: 16px; margin-bottom: 2px; }
  .fl-card p { font-size: 12.5px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .fl-turnwrap { top: 26%; }
}
@media (max-width: 359px) {
  .fl-map { width: 78px; height: 78px; }
  .fl-brake { left: calc(var(--sal) + 96px); }
  .fl-brake button { width: 54px; height: 54px; }
  .fl-readout { right: calc(var(--sar) + 96px); }
  .fl-mk { top: calc(var(--sat) + 58px); right: calc(var(--sar) + 10px); }
  .fl-card { top: calc(var(--sat) + 100px); }
}
.fl-mks h3 .res-badge { color: #D9700A; }
.fl-mklist { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
.fl-mklist li { font: 800 12px/1.25 var(--font-ui); color: var(--ink); display: flex; gap: 5px; align-items: center; min-width: 0; }
.fl-mklist li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-mklist li::before { content: '!'; flex: none; width: 16px; height: 16px; border-radius: 50%; background: #FF9F1C; color: #fff; font: 700 11px/16px var(--font-display); text-align: center; }
.fl-mklist li.new span { color: #D9700A; }
.fl-mklist li.new::after { content: 'NEW'; flex: none; font: 900 9px/1 var(--font-ui); letter-spacing: .06em; color: #fff; background: #FF5A5F; padding: 2px 4px; border-radius: 99px; }
.fl-mkmore { margin: 6px 0 0; display: flex; gap: 5px; align-items: center; font: 800 12px/1.25 var(--font-ui); color: var(--ink-soft); }
.fl-mkmore b { flex: none; width: 16px; height: 16px; border-radius: 50%; background: #E3EAF3; color: #9AA6B8; font: 700 11px/16px var(--font-display); text-align: center; }
.fl-mkothers { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
.fl-mkothers li { display: flex; gap: 8px; align-items: baseline; padding: 5px 10px; border-radius: 12px; background: var(--panel-2); font: 800 13px/1.2 var(--font-ui); color: var(--ink); }
.fl-mkothers li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-mkothers li b { font: 700 15px/1 var(--font-display); color: #D9700A; }
.fl-mkothers li small { font: 800 11px/1 var(--font-ui); color: var(--ink-soft); }
`;

  const SVG = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 8.6V13l3 2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M9.5 2.6h5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    balloon: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9.5" rx="6.6" ry="7.8" fill="#FF5A5F"/><ellipse cx="9.6" cy="6.8" rx="1.8" ry="2.6" fill="#FFB0B2" transform="rotate(-20 9.6 6.8)"/><path d="M11 17.3h2l-1 1.8z" fill="#D9363C"/><path d="M12 19c-1 1.4 1 2.4 0 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>',
    ring: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="6.8" ry="9" fill="none" stroke="#FFB627" stroke-width="3.6"/></svg>',
    boost: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 6.5 12 12l-8 5.5z"/><path d="M12 6.5 20 12l-8 5.5z"/></svg>',
    brake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 16.5a8.5 8.5 0 0 1 17 0"/><path d="M12 16.5 6.6 11.4"/><circle cx="12" cy="16.5" r="1.6" fill="currentColor"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="#FFC93C" stroke="#E0A000" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    edge: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="#fff"/><path d="M14 27 22 11l8 16-8-4.4z" fill="currentColor"/></svg>',
  };

  // =============================================================================================
  // 10. The sport instance
  // =============================================================================================

  function create(ctx) {
    const { THREE, scene, camera, world: W, pals, ui, audio, engine, save, util: U } = ctx;
    const mode = MODE_RULES[ctx.mode] ? ctx.mode : 'balloons';
    const RULES = MODE_RULES[mode];
    const modeName = (DEF.modes.find(m => m.id === mode) || DEF.modes[0]).name;
    const players = ctx.players;
    const rng = ctx.rng;
    const hintsOn = !(save.settings && save.settings.hints === false);
    const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const A = assets(THREE, W);
    const S = STRUCT, L = ISLE.L;

    // ---- world -----------------------------------------------------------------------------------------
    const env = W.environment(scene, {
      sky: 'day', fog: true, fogNear: 520, fogFar: 2400, hills: false, clouds: 0, trees: false, ground: false,
      seed: 3, sunAzimuth: 0.7, sunElevation: 0.9, shadow: { center: V(0, 0, 0), size: 46 },
    });
    camera.near = 0.4;
    camera.far = 6000;
    A.mats.falls.opacity = 0.9;
    delete camera.userData.fit;

    const add = (geo, mat, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      if (o.receive) m.receiveShadow = true;
      if (o.order != null) m.renderOrder = o.order;
      if (o.noCull) m.frustumCulled = false;
      m.matrixAutoUpdate = !!o.dynamic;
      if (!o.dynamic) m.updateMatrix();
      scene.add(m);
      return m;
    };
    add(A.terrain, A.mats.terrain, { receive: true }).name = 'terrain';
    add(A.deep, A.mats.deep, {});
    add(A.sea, A.mats.sea, { order: 1, noCull: true });
    add(A.foam, A.mats.foam, { order: 2 });
    add(A.river, A.mats.sea, { order: 1 });
    add(A.falls, A.mats.falls, { order: 2 });
    add(A.statics, A.mats.statics, { receive: true }).name = 'landmarks';
    add(A.decals, A.mats.decals, { receive: true }).name = 'decals';
    add(A.clouds, A.cloudMat, {}).name = 'clouds';

    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(0, 0, 0, 'YXZ'), s4 = V(), p4 = V();
    function instanced(geo, mat, list, place) {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      im.count = list.length;
      list.forEach((item, i) => { place(item, p4, e4, s4); q4.setFromEuler(e4); m4.compose(p4, q4, s4); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
      return im;
    }
    const treePlace = (t, p, e, s) => { p.set(t[0], t[1] - 0.3, t[2]); e.set(0, t[4], 0); s.setScalar(t[3]); };
    instanced(A.palm, A.mats.trees, A.trees.palm, treePlace).name = 'palms';
    instanced(A.round, A.mats.trees, A.trees.round, treePlace).name = 'trees';
    instanced(A.pine, A.mats.trees, A.trees.pine, treePlace).name = 'pines';

    // windmill rotors
    const rotors = instanced(A.rotor, A.mats.movers, S.windmills, (w, p, e, s) => { p.set(w.hx, w.hy, w.hz); e.set(0, w.face, 0); s.setScalar(1); });
    rotors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rotorSpin = S.windmills.map((w, i) => i * 0.7);

    // sailboats (circling), hot-air balloons (drifting), bird flocks
    const BOAT_PATHS = [
      [ISLE.polar(0.75, -150), 70, 0.05], [ISLE.polar(0.6, -260), 110, -0.035], [ISLE.polar(2.1, -140), 80, 0.045],
      [ISLE.polar(2.9, -190), 90, -0.04], [ISLE.polar(-1.3, -160), 95, 0.04], [ISLE.polar(-0.25, -230), 120, -0.03],
    ].map(([c, r, w], i) => ({ cx: c[0], cz: c[1], r, w, a: i * 1.7 }));
    const boats = instanced(A.sailboat, A.mats.movers, BOAT_PATHS, (b, p, e, s) => { p.set(b.cx + b.r, 0, b.cz); e.set(0, 0, 0); s.setScalar(1.4); });
    boats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    boats.frustumCulled = false;
    const BOAT_TINTS = [0xFFFFFF, 0xFFE1E1, 0xDDF0FF, 0xFFF4C8, 0xE4FFE0, 0xF0E4FF];
    BOAT_TINTS.forEach((c, i) => boats.setColorAt(i, new THREE.Color(c)));
    const HOTAIR = [{ cx: 260, cz: -130, cy: 168, r: 130, w: 0.028, a: 0 }, { cx: -300, cz: 60, cy: 196, r: 150, w: -0.022, a: 2 }]
      .map(h => Object.assign(h, { px: h.cx + Math.cos(h.a) * h.r, py: h.cy, pz: h.cz + Math.sin(h.a) * h.r }));
    const hotair = instanced(A.hotair, A.mats.movers, HOTAIR, (h, p, e, s) => { p.set(h.cx, h.cy, h.cz); e.set(0, 0, 0); s.setScalar(1.4); });
    hotair.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    hotair.frustumCulled = false;
    hotair.setColorAt(0, new THREE.Color(0xFFFFFF)); hotair.setColorAt(1, new THREE.Color(0xD9F0FF));
    const FLOCKS = [
      { cx: L.lighthouse.x - 40, cz: L.lighthouse.z + 30, cy: 62 }, { cx: L.farm.x + 60, cz: L.farm.z + 20, cy: 58 }, { cx: S.bay.x, cz: S.bay.z, cy: 30 },
      { cx: L.plaza.x - 60, cz: L.plaza.z - 80, cy: 64 },
    ].map((f, k) => ({ ...f, a: k, scatter: 0, birds: Array.from({ length: 8 }, (v, i) => ({ ox: (hash2(i, k, 1) - 0.5) * 22, oy: (hash2(i, k, 2) - 0.5) * 8, oz: (hash2(i, k, 3) - 0.5) * 22, ph: hash2(i, k, 4) * TAU, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 })) }));
    const birdCount = FLOCKS.length * 8;
    const birds = new THREE.InstancedMesh(A.bird, A.mats.movers, birdCount);
    birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    birds.frustumCulled = false;
    scene.add(birds);

    // crowds: tennis, ballpark, beach
    const crowds = [
      { key: 'tennis', x: L.tennis.x, z: L.tennis.z, y: S.tennis.g, cheer: 0 },
      { key: 'ballpark', x: L.ballpark.x, z: L.ballpark.z, y: S.ballpark.g, cheer: 0 },
      { key: 'beach', x: L.beach.x, z: L.beach.z, y: H(L.beach.x, L.beach.z), cheer: 0, beach: true },
    ];
    for (const c of crowds) {
      c.handle = W.crowd(scene, { rows: A.crowdRows[c.key], spacing: c.beach ? 1 : 1.1, density: c.beach ? 1 : 0.5, seed: 5 + c.key.length, detail: 'low', scale: c.beach ? 1.15 : 1 });
      c.handle.update(0);
    }

    // ---- the plane & its pilots -------------------------------------------------------------------------
    const plane = new THREE.Group();
    plane.rotation.order = 'YXZ';
    scene.add(plane);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0xFF9F1C, shininess: 70, specular: 0x555555 });
    const planeBody = new THREE.Mesh(A.planeBody, bodyMat);
    const planeTrim = new THREE.Mesh(A.planeTrim, A.mats.trim);
    const prop = new THREE.Mesh(A.prop, A.mats.prop);
    prop.position.set(0, 0, 2.62);
    const blur = new THREE.Mesh(A.blur, A.mats.blur);
    blur.position.set(0, 0, 2.6);
    blur.renderOrder = 6;
    const scarfMat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF, side: THREE.DoubleSide });
    const scarfGeo = A.scarf(THREE);
    const scarfBase = scarfGeo.attributes.position.array.slice();
    const scarf = new THREE.Mesh(scarfGeo, scarfMat);
    scarf.position.set(0, 1.0, -0.55);
    scarf.frustumCulled = false;
    plane.add(planeBody, planeTrim, prop, blur, scarf);
    const castShadows = () => !!(engine.tier && engine.tier.shadows);
    for (const m of [planeBody, planeTrim]) m.castShadow = true;
    const wingL = new THREE.Object3D(), wingR = new THREE.Object3D();
    wingL.position.set(3.9, -0.05, 0.25); wingR.position.set(-3.9, -0.05, 0.25);
    plane.add(wingL, wingR);
    const trails = [wingL, wingR].map(o => W.trail(o, { color: 0xFFFFFF, width: 0.32, length: 30, opacity: 0.55, maxJump: 30 }));
    for (const t of trails) t.visible = false;
    let trailOn = false;
    const blob = W.blobShadow(4.2, 0.32);
    blob.renderOrder = 3;
    scene.add(blob);

    const pilots = players.map(pl => {
      const pal = pals.create(pl.profile, { shadows: true, detail: 'low' });
      pal.root.position.set(0, -0.04, -0.34);
      pal.parts.footL.visible = pal.parts.footR.visible = false;
      pal.root.visible = false;
      plane.add(pal.root);
      const shirt = new THREE.Color((pals.OPTIONS && pals.OPTIONS.shirts && pals.OPTIONS.shirts[pal.profile.shirt]) || 0xFF9F1C);
      const scarfC = shirt.clone().offsetHSL(0.5, 0, 0);
      const hsl = {}; scarfC.getHSL(hsl);
      scarfC.setHSL(hsl.h, Math.max(0.65, hsl.s), clamp(hsl.l, 0.5, 0.62));
      return { pal, shirt, scarf: scarfC, markers: loadMarkers(save, pl.profile) };
    });

    // ---- targets: balloons, rings, "!" markers -----------------------------------------------------------
    const BAL_COLORS = [0xFF5A5F, 0x1FA2FF, 0xFFC93C, 0x3BC45B, 0xFF6FAE, 0x9B6BFF, 0xFF8A2B, 0x22C3B6];
    const balloonMesh = new THREE.InstancedMesh(A.balloon, A.mats.balloon, BALLOONS.length);
    const stringMesh = new THREE.InstancedMesh(A.knot, A.mats.string, BALLOONS.length);
    for (const im of [balloonMesh, stringMesh]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; scene.add(im); }
    BALLOONS.forEach((b, i) => balloonMesh.setColorAt(i, new THREE.Color(b.gold ? 0xFFD23F : BAL_COLORS[i % BAL_COLORS.length])));
    balloonMesh.visible = stringMesh.visible = mode === 'balloons';
    const balState = BALLOONS.map((b, i) => ({ popped: false, ph: hash2(i, 7, 7) * TAU, pop: 0 }));

    const ringMesh = new THREE.InstancedMesh(A.ring, A.mats.ring, RINGS.length);
    ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ringMesh.frustumCulled = false;
    ringMesh.visible = mode === 'rings';
    scene.add(ringMesh);
    const halo = new THREE.Mesh(A.halo, A.mats.halo);
    halo.visible = false;
    halo.renderOrder = 5;
    scene.add(halo);
    const ringState = RINGS.map(() => ({ state: 'todo', t: 0 }));
    const ringQuat = RINGS.map(r => new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(r.nx, r.ny, r.nz)));
    const arrow = new THREE.Mesh(A.arrow, A.mats.arrow);
    arrow.visible = false;
    arrow.renderOrder = 7;
    scene.add(arrow);

    // markers: instanced camera-facing bubbles + light beams (custom shaders, per-instance fade)
    const markerGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    const mkTile = new THREE.InstancedBufferAttribute(new Float32Array(MARKER_COUNT), 1);
    const mkAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MARKER_COUNT), 1);
    const mkFlip = new THREE.InstancedBufferAttribute(new Float32Array(MARKER_COUNT).fill(1), 1);
    for (const a of [mkTile, mkAlpha, mkFlip]) a.setUsage(THREE.DynamicDrawUsage);
    markerGeo.setAttribute('aTile', mkTile); markerGeo.setAttribute('aAlpha', mkAlpha); markerGeo.setAttribute('aFlip', mkFlip);
    const markerMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: A.markerTex } },
      vertexShader: [
        'attribute float aTile; attribute float aAlpha; attribute float aFlip;',
        'varying vec2 vUv; varying float vAlpha;',
        'void main() {',
        '  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  float s = length(instanceMatrix[0].xyz);',
        '  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
        '  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);',
        '  vec3 p = c.xyz + right * position.x * s * aFlip + up * position.y * s;',
        '  vUv = vec2((uv.x + aTile) * 0.5, uv.y); vAlpha = aAlpha;',
        '  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);',
        '  if (aAlpha <= 0.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap; varying vec2 vUv; varying float vAlpha;',
        'void main() {',
        '  vec4 t = texture2D(uMap, vUv);',
        '  float a = t.a * vAlpha;',
        '  if (a < 0.02) discard;',
        '  gl_FragColor = vec4(t.rgb, a);',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
      transparent: true, depthWrite: false,
    });
    const markerMesh = new THREE.InstancedMesh(markerGeo, markerMat, MARKER_COUNT);
    markerMesh.frustumCulled = false;
    markerMesh.renderOrder = 8;
    scene.add(markerMesh);
    const beamGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
    const bmAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MARKER_COUNT), 1);
    bmAlpha.setUsage(THREE.DynamicDrawUsage);
    beamGeo.setAttribute('aAlpha', bmAlpha);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: A.beamTex } },
      vertexShader: [
        'attribute float aAlpha; varying vec2 vUv; varying float vAlpha;',
        'void main() {',
        '  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  float w = length(instanceMatrix[0].xyz), h = length(instanceMatrix[1].xyz);',
        '  vec3 camPos = cameraPosition;',
        '  vec3 toCam = normalize(vec3(camPos.x - c.x, 0.0, camPos.z - c.z));',
        '  vec3 right = vec3(toCam.z, 0.0, -toCam.x);',
        '  vec3 p = c.xyz + right * position.x * w + vec3(0.0, position.y * h, 0.0);',
        '  vUv = uv; vAlpha = aAlpha;',
        '  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);',
        '  if (aAlpha <= 0.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap; varying vec2 vUv; varying float vAlpha;',
        'void main() {',
        '  vec4 t = texture2D(uMap, vUv);',
        '  gl_FragColor = vec4(t.rgb, t.a * vAlpha);',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, MARKER_COUNT);
    beamMesh.frustumCulled = false;
    beamMesh.renderOrder = 4;
    scene.add(beamMesh);
    const mkState = MARKERS.map(m => ({ flip: 0, ground: Math.max(0, H(m.x, m.z)) }));
    // balloons and rings sharing a marker's spot: outside Island Tour the "!" steps back while they are live
    const mkNear = MARKERS.map(m => ({
      balloons: BALLOONS.map((b, j) => (Math.hypot(b.x - m.x, b.y - m.y, b.z - m.z) < 16 ? j : -1)).filter(j => j >= 0),
      rings: RINGS.map((r, j) => (Math.hypot(r.x - m.x, r.y - m.y, r.z - m.z) < 22 ? j : -1)).filter(j => j >= 0),
    }));
    MARKERS.forEach((m, i) => {
      m4.compose(p4.set(m.x, mkState[i].ground - 2, m.z), q4.identity(), s4.set(4.5, m.y - mkState[i].ground + 70, 1));
      beamMesh.setMatrixAt(i, m4);
    });

    // ---- per-game state ----------------------------------------------------------------------------------
    const P = {
      pos: V(), prev: V(), dir: V(0, 0, 1), yaw: 0, pitch: 0, roll: 0, speed: FLY.vCruise, boost: 1, boostIdle: 0, boosting: false, braking: false,
      stun: 0, wobble: 0, softCd: 0, skimCd: 0, bumpCd: 0, sprayCd: 0, agl: 50, overSea: true,
    };
    const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false, R: 60 };
    const keys = { left: false, right: false, up: false, down: false, boost: false, brake: false };
    const kx = { x: 0, y: 0 };
    let btnBoost = false, btnBrake = false;
    let phase = 'intro';
    let cur = 0;
    let autoplay = false, debugTouched = false;
    let turn = null;
    let turnDone = null, skipWaiter = null;
    let flowGen = 0;
    let started = false;
    let loops = null;
    let hintHandle = null, firstDrag = false;
    let cardQueue = [], card = null;
    let hint = { cd: 0, show: 0, target: -1 };
    let cinematic = null;
    let inCloud = -1, flash = 0;
    let crowdCd = 0, sprayT = 0, mistT = 0, sparkT = 0;
    const results = players.map(() => null);
    const foundThisFlight = players.map(() => []);     // markers found for the first time on this flight
    const revisited = players.map(() => []);           // Island Tour: known markers flown through again
    const visited = players.map(() => new Uint8Array(MARKER_COUNT));   // every marker flown through this flight
    const gameBest = { score: 0, time: Infinity };     // best finished turn so far this game (hot-seat banners)

    // =============================================================================================
    // HUD
    // =============================================================================================

    ui.css('flight-hud', HUD_CSS);
    const hud = buildHud();

    function buildHud() {
      const root = ctx.hud;
      const top = ui.el('div', 'ss-hud-top fl-top');
      const time = ui.el('div', 'ss-chip dark fl-time ss-pop', SVG.clock + '<b>0:00</b>');
      const score = ui.el('div', 'ss-chip fl-score ss-pop', (mode === 'rings' ? SVG.ring : mode === 'tour' ? SVG.star : SVG.balloon) + '<b>0</b>');
      const combo = ui.el('div', 'ss-chip fl-combo fl-off', '<b>x2</b><i></i>');
      top.append(time, score, combo);
      const mk = ui.el('div', 'ss-chip fl-mk' + (mode === 'tour' ? ' tour' : ''), '<span class="ic">!</span><b>0/40</b>');
      const left = ui.el('div', 'fl-left');
      const player = ui.el('div', 'ss-chip fl-player ss-pop' + (players.length > 1 ? '' : ' fl-off'));
      left.append(player);
      const map = ui.el('div', 'fl-map');
      const mapC = ui.el('canvas');
      mapC.width = mapC.height = 196;
      map.appendChild(mapC);
      const mkBtn = (cls, label, inner, on) => {
        const wrap = ui.el('div', 'fl-btn ss-block ' + cls);
        const btn = ui.el('button', '', inner);
        btn.type = 'button';
        btn.setAttribute('aria-label', label);
        let pid = null;
        const down = e => {
          e.preventDefault();
          if (pid != null) return;
          pid = e.pointerId;
          try { btn.setPointerCapture(e.pointerId); } catch (err) { /* capture is best effort */ }
          on(true);
        };
        const up = e => { if (e.pointerId !== pid) return; pid = null; on(false); };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', e => e.preventDefault());
        if (cls.indexOf('fl-boost') >= 0) { const ring = ui.el('div', 'ring'); ring.appendChild(btn); wrap.appendChild(ring); }
        else wrap.appendChild(btn);
        wrap.appendChild(ui.el('small', '', label.toUpperCase()));
        wrap.release = () => { if (pid != null) { pid = null; on(false); } };
        return wrap;
      };
      const boost = mkBtn('fl-boost', 'Boost', SVG.boost, v => { btnBoost = v; if (v) ui.haptic && ui.haptic(8); });
      const brake = mkBtn('fl-brake', 'Brake', SVG.brake, v => { btnBrake = v; });
      const hintB = ui.el('div', 'fl-btn fl-hint ss-block' + (mode === 'tour' ? '' : ' fl-off'));
      const hintBtn = ui.el('button', '', '!');
      hintBtn.type = 'button';
      hintBtn.setAttribute('aria-label', 'Show the way to the nearest "!"');
      hintBtn.addEventListener('click', () => useHint());
      hintB.append(hintBtn, ui.el('small', '', 'FIND'));
      const readout = ui.el('div', 'fl-readout', '<span class="ss-chip dark"><b class="spd">30</b>m/s</span><span class="ss-chip dark"><b class="alt">40</b>m</span>');
      const stickEl = ui.el('div', 'fl-stick fl-off', '<i></i>');
      const lines = ui.el('div', 'fl-lines');
      let svg = '<svg viewBox="-100 -100 200 200" preserveAspectRatio="none">';
      for (let i = 0; i < 26; i++) {
        const a = i / 26 * TAU + hash2(i, 1, 2) * 0.2, r0 = 62 + hash2(i, 2, 2) * 18, r1 = r0 + 16 + hash2(i, 3, 2) * 22;
        svg += '<line x1="' + (Math.cos(a) * r0).toFixed(1) + '" y1="' + (Math.sin(a) * r0).toFixed(1) + '" x2="' + (Math.cos(a) * r1).toFixed(1) + '" y2="' + (Math.sin(a) * r1).toFixed(1) + '"/>';
      }
      lines.innerHTML = svg + '</svg>';
      const flashEl = ui.el('div', 'fl-flash');
      const edge = ui.el('div', 'fl-edge fl-off', SVG.edge);
      root.append(lines, flashEl, edge, top, mk, left, map, brake, boost, hintB, readout, stickEl);
      return {
        top, time, timeB: time.querySelector('b'), score, scoreB: score.querySelector('b'), combo, comboB: combo.querySelector('b'), comboBar: combo.querySelector('i'),
        mk, mkB: mk.querySelector('b'), player, map, mapC, mapG: mapC.getContext('2d'), boost, brake, hintB, readout,
        spd: readout.querySelector('.spd'), alt: readout.querySelector('.alt'), stick: stickEl, knob: stickEl.querySelector('i'), lines, linesSvg: lines.firstChild,
        flash: flashEl, edge, last: {},
      };
    }

    const setText = (el, key, txt) => { if (hud.last[key] !== txt) { hud.last[key] = txt; el.textContent = txt; } };
    const fmtTime = (s, tenths) => {
      s = Math.max(0, s);
      const m = Math.floor(s / 60), r = s - m * 60;
      return m + ':' + (tenths ? (r < 10 ? '0' : '') + r.toFixed(1) : String(Math.floor(r)).padStart(2, '0'));
    };

    function refreshPlayerChip() {
      const prof = players[cur].profile;
      hud.player.innerHTML = '';
      hud.player.append(ui.portraitImg(prof, 30), ui.el('span', '', ui.esc(prof.name)));
    }
    function refreshMarkerChip(pop) {
      const n = countOf(pilots[cur].markers);
      setText(hud.mkB, 'mk', n + '/' + MARKER_COUNT);
      if (pop) { hud.mk.classList.remove('pop'); void hud.mk.offsetWidth; hud.mk.classList.add('pop'); }
    }
    function bumpScore() { hud.score.classList.remove('bump'); void hud.score.offsetWidth; hud.score.classList.add('bump'); }

    function refreshHud() {
      if (!turn) return;
      if (mode === 'balloons') {
        setText(hud.timeB, 't', fmtTime(Math.ceil(turn.left)));
        setText(hud.scoreB, 's', String(turn.score));
      } else if (mode === 'rings') {
        setText(hud.timeB, 't', fmtTime(turn.elapsed + turn.penalty, true));
        setText(hud.scoreB, 's', Math.min(turn.next, RINGS.length) + '/' + RINGS.length);
      } else {
        setText(hud.timeB, 't', fmtTime(Math.ceil(turn.left)));
        setText(hud.scoreB, 's', String(turn.score));
      }
      const warn = (mode !== 'rings') && phase === 'fly' && turn.left <= 10;
      hud.time.classList.toggle('warn', warn);
      hud.time.classList.toggle('paused', !!(card && mode === 'tour'));
      const showCombo = mode === 'balloons' && turn.chain >= 2 && turn.comboT > 0;
      hud.combo.classList.toggle('fl-off', !showCombo);
      if (showCombo) {
        const mult = multFor(turn.chain);
        setText(hud.comboB, 'c', mult > 1 ? 'COMBO x' + mult : 'CHAIN ' + turn.chain);
        hud.comboBar.style.transform = 'scaleX(' + (turn.comboT / COMBO_WINDOW).toFixed(3) + ')';
      }
    }

    function refreshReadout() {
      setText(hud.spd, 'spd', String(Math.round(P.speed)));
      setText(hud.alt, 'alt', String(Math.max(0, Math.round(P.pos.y))));
      const b = P.boost;
      if (hud.last.boost == null || Math.abs(hud.last.boost - b) > 0.01) { hud.last.boost = b; hud.boost.style.setProperty('--boost', b.toFixed(3)); }
      hud.boost.classList.toggle('on', P.boosting);
      hud.boost.classList.toggle('empty', b < 0.05);
      hud.brake.classList.toggle('on', P.braking);
      if (mode === 'tour') {
        const cd = hint.cd > 0 ? hint.cd / RULES.hintCooldown : 0;
        hud.hintB.style.setProperty('--cd', cd.toFixed(3));
        hud.hintB.classList.toggle('ready', hint.cd <= 0 && hint.show <= 0 && phase === 'fly');
        hud.hintB.classList.toggle('fl-off', markersLeft() === 0);
      }
    }

    // ---- minimap (heading up) ---------------------------------------------------------------------------
    let mapT = 0;
    function drawMap(dt) {
      mapT -= dt;
      if (mapT > 0) return;
      mapT = 1 / 12;
      const g = hud.mapG, Sz = 196, R = Sz / 2, view = 430, k = R / view;
      const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#2A86C0'; g.fillRect(0, 0, Sz, Sz);
      g.setTransform(-k * cy, -k * sy, k * sy, -k * cy, R, R);
      g.drawImage(A.minimap, -900 - P.pos.x, -900 - P.pos.z, 1800, 1800);
      g.setTransform(1, 0, 0, 1, 0, 0);
      const toMap = (x, z) => { const dx = x - P.pos.x, dz = z - P.pos.z; return [R + k * (-cy * dx + sy * dz), R - k * (sy * dx + cy * dz)]; };
      const dot = (x, z, r, fill, stroke) => {
        let [mx, my] = toMap(x, z);
        const ox = mx - R, oy = my - R, d = Math.hypot(ox, oy), lim = R - r - 3;
        if (d > lim) { mx = R + ox / d * lim; my = R + oy / d * lim; }
        g.beginPath(); g.arc(mx, my, r, 0, TAU); g.fillStyle = fill; g.fill();
        if (stroke) { g.lineWidth = 2.5; g.strokeStyle = stroke; g.stroke(); }
      };
      if (mode === 'balloons' && turn) {
        BALLOONS.forEach((b, i) => { if (!balState[i].popped) dot(b.x, b.z, b.gold ? 6 : 4.5, b.gold ? '#FFD23F' : '#FF5A8A', '#fff'); });
      }
      if (mode === 'rings' && turn) {
        for (let i = Math.min(RINGS.length - 1, turn.next + 2); i >= turn.next; i--) {
          const r = RINGS[i];
          dot(r.x, r.z, i === turn.next ? 8 : 5, i === turn.next ? '#FFB627' : 'rgba(255,255,255,.85)', i === turn.next ? '#fff' : null);
        }
      }
      const mk = mode === 'tour' ? visited[cur] : pilots[cur].markers;
      MARKERS.forEach((m, i) => {
        if (mk[i]) return;
        const near = Math.hypot(m.x - P.pos.x, m.z - P.pos.z) < 300 || (hint.show > 0 && hint.target === i);
        if (!near) return;
        dot(m.x, m.z, 7.5, '#FF9F1C', '#fff');
        const [mx, my] = toMap(m.x, m.z);
        if (Math.hypot(mx - R, my - R) < R - 10) { g.fillStyle = '#fff'; g.font = '700 11px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', mx, my + 0.5); }
      });
      // far out at sea: a green dot on the rim points home
      if (Math.hypot(P.pos.x, P.pos.z) > 820) dot(0, 40, 7, '#3BC45B', '#fff');
      // the plane
      g.save(); g.translate(R, R);
      g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 9); g.lineTo(0, 4); g.lineTo(-9, 9); g.closePath();
      g.lineWidth = 3; g.strokeStyle = '#24324A'; g.stroke(); g.fillStyle = '#fff'; g.fill();
      g.restore();
    }

    // ---- the stick ----------------------------------------------------------------------------------------
    const blockedTarget = t => t instanceof Element && !!t.closest('button, a, input, .ss-block, #ss-screens, #ss-overlay');
    function stickActive() { return (phase === 'fly' || phase === 'countdown') && !engine.paused && SS.input.enabled !== false && !autoplay; }
    function onPDown(e) {
      if (stick.id != null || !stickActive() || blockedTarget(e.target)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = ui.root.getBoundingClientRect();
      stick.id = e.pointerId; stick.active = true;
      stick.ox = stick.x0 = e.clientX - r.left; stick.oy = e.clientY - r.top;
      stick.cx = stick.ox; stick.cy = stick.oy;
      stick.R = clamp(Math.min(engine.size.w, engine.size.h) * 0.15, 46, 84);
      placeStick();
      hud.stick.classList.remove('fl-off');
      if (!firstDrag) { firstDrag = true; if (hintHandle) { hintHandle.hide(); hintHandle = null; } }
    }
    function onPMove(e) {
      if (e.pointerId !== stick.id) return;
      const r = ui.root.getBoundingClientRect();
      stick.cx = e.clientX - r.left; stick.cy = e.clientY - r.top;
      // a floating stick: dragging past the rim pulls the centre along
      const dx = stick.cx - stick.ox, dy = stick.cy - stick.oy, d = Math.hypot(dx, dy), lim = stick.R * 1.6;
      if (d > lim) { stick.ox += dx / d * (d - lim); stick.oy += dy / d * (d - lim); }
      placeStick();
    }
    function onPUp(e) { if (e.pointerId === stick.id) releaseStick(); }
    function releaseStick() {
      stick.id = null; stick.active = false;
      hud.stick.classList.add('fl-off');
    }
    function placeStick() {
      const R = stick.R;
      hud.stick.style.width = hud.stick.style.height = (R * 2) + 'px';
      hud.stick.style.transform = 'translate(' + Math.round(stick.ox - R) + 'px,' + Math.round(stick.oy - R) + 'px)';
      let dx = stick.cx - stick.ox, dy = stick.cy - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      hud.knob.style.transform = 'translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px)';
    }
    /** Stick deflection → (-1..1, -1..1): x right, y up; generous dead zone and an eased curve. */
    function stickValue(out) {
      if (!stick.active) { out.x = 0; out.y = 0; return out; }
      let dx = (stick.cx - stick.ox) / stick.R, dy = -(stick.cy - stick.oy) / stick.R;
      const d = Math.hypot(dx, dy);
      if (d > 1) { dx /= d; dy /= d; }
      const shape = v => { const a = Math.abs(v); return a < FLY.dead ? 0 : Math.sign(v) * Math.pow((a - FLY.dead) / (1 - FLY.dead), 1.35); };
      out.x = shape(dx); out.y = shape(dy);
      return out;
    }
    window.addEventListener('pointerdown', onPDown);
    window.addEventListener('pointermove', onPMove);
    window.addEventListener('pointerup', onPUp);
    window.addEventListener('pointercancel', onPUp);
    ctx.input.on('key', k => {
      const code = k.code || k.key;
      const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'boost', ShiftLeft: 'brake', ShiftRight: 'brake' };
      const name = map[code] || (k.key === ' ' ? 'boost' : k.key === 'Shift' ? 'brake' : null);
      if (name) keys[name] = !!k.down;
    });
    function releaseAll() {
      releaseStick();
      hud.boost.release(); hud.brake.release();
      btnBoost = btnBrake = false;
      for (const k in keys) keys[k] = false;
    }

    function useHint() {
      if (mode !== 'tour' || phase !== 'fly' || hint.cd > 0 || hint.show > 0) return;
      const i = nearestMarker(true);
      if (i < 0) { ui.toast('You have visited every "!" on this flight!', { icon: 'star', duration: 2.4 }); return; }
      hint.target = i; hint.show = RULES.hintShow; hint.cd = RULES.hintCooldown + RULES.hintShow;
      ui.sfx('ui_select');
      const d = Math.round(Math.hypot(MARKERS[i].x - P.pos.x, MARKERS[i].z - P.pos.z));
      ui.toast('Follow the arrow: ' + d + ' m to the ' + (pilots[cur].markers[i] ? 'nearest "!"' : 'nearest new "!"'), { duration: 2.4 });
    }

    // =============================================================================================
    // Flight model
    // =============================================================================================

    const _sv = { x: 0, y: 0 };
    const autoIn = { x: 0, y: 0, boost: false, brake: false };
    function controls(dt) {
      if (autoplay) return autoIn;
      stickValue(_sv);
      const kt = 1 - Math.exp(-6 * dt);
      kx.x += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0) - kx.x) * kt;
      kx.y += ((keys.up ? 1 : 0) - (keys.down ? 1 : 0) - kx.y) * kt;
      return { x: clamp(_sv.x + kx.x, -1, 1), y: clamp(_sv.y + kx.y, -1, 1), boost: btnBoost || keys.boost, brake: btnBrake || keys.brake };
    }

    const _fw = V(), _tmp = V(), _n = V();
    function stepFlight(dt, inp, onRails) {
      let sx = onRails ? 0 : inp.x, sy = onRails ? 0 : inp.y;
      if (P.stun > 0) { sx = 0; sy = 0.75; }
      // bank → coordinated turn
      const rollT = sx * FLY.maxBank;
      P.roll += (rollT - P.roll) * (1 - Math.exp(-(sx ? FLY.bankLambda : FLY.rollLevelLambda) * dt));
      let pitchT = sy >= 0 ? sy * FLY.maxClimb : sy * FLY.maxDive;
      // soft ceiling
      if (P.pos.y > S.ceiling) pitchT = Math.min(pitchT, lerp(FLY.maxClimb, -8 * DEG, sstep(S.ceiling, S.hardCeiling - 10, P.pos.y)));
      // ground cushion and a gentle terrain-follow assist (steep walls still bump)
      const g = groundAt(P.pos.x, P.pos.z), floor = Math.max(g, 0);
      P.agl = P.pos.y - floor;
      P.overSea = g < 0.5;
      if (pitchT < 0) pitchT *= sstep(2.4, 9, P.agl);
      const look = Math.max(18, P.speed * 0.9);
      const ax = P.pos.x + Math.sin(P.yaw) * look, az = P.pos.z + Math.cos(P.yaw) * look;
      const gAhead = Math.max(0, groundAt(ax, az));
      const need = Math.atan2(gAhead + 3.5 - P.pos.y, look);
      if (need > pitchT && need < 24 * DEG && P.stun <= 0) pitchT = lerp(pitchT, need, 0.85);
      const pl = (sy || P.stun > 0) ? FLY.pitchLambda : FLY.levelLambda;
      P.pitch += (pitchT - P.pitch) * (1 - Math.exp(-pl * dt));
      const v01 = clamp((P.speed - FLY.vBrake) / (FLY.vBoost - FLY.vBrake), 0, 1);
      const rate = FLY.turnRate * lerp(1.22, 0.88, v01);
      P.yaw = wrapA(P.yaw - rate * Math.sin(P.roll) / Math.sin(FLY.maxBank) * dt);
      // throttle & boost energy
      P.boosting = !onRails && !!inp.boost && P.boost > 0.02 && P.stun <= 0;
      P.braking = !onRails && !!inp.brake && !P.boosting;
      if (P.boosting) { P.boost = Math.max(0, P.boost - FLY.boostDrain * dt); P.boostIdle = 0; }
      else { P.boostIdle += dt; if (P.boostIdle > FLY.boostDelay) P.boost = Math.min(1, P.boost + FLY.boostRefill * dt); }
      const vT = P.stun > 0 ? FLY.vBrake + 4 : P.boosting ? FLY.vBoost : P.braking ? FLY.vBrake : FLY.vCruise;
      P.speed += (vT - P.speed) * (1 - Math.exp(-FLY.accel * dt)) - FLY.gravityTrade * Math.sin(P.pitch) * dt;
      P.speed = clamp(P.speed, FLY.vMin, FLY.vMax);
      const cp = Math.cos(P.pitch);
      P.dir.set(Math.sin(P.yaw) * cp, Math.sin(P.pitch), Math.cos(P.yaw) * cp);
      P.prev.copy(P.pos);
      P.pos.addScaledVector(P.dir, P.speed * dt);
      if (P.pos.y > S.hardCeiling) P.pos.y = S.hardCeiling;
      // the far edge: the breeze (see leash) turns the plane home; this only stops a plane that still pushes on
      const r = Math.hypot(P.pos.x, P.pos.z);
      if (r > FLY.leash) { P.pos.x *= FLY.leash / r; P.pos.z *= FLY.leash / r; }
      P.stun = Math.max(0, P.stun - dt);
      P.wobble *= Math.exp(-2.2 * dt);
      P.softCd = Math.max(0, P.softCd - dt); P.skimCd = Math.max(0, P.skimCd - dt); P.bumpCd = Math.max(0, P.bumpCd - dt);
      P.sprayCd = Math.max(0, P.sprayCd - dt);
      collide();
    }

    /** A friendly breeze far out at sea: past FLY.breeze it blends the stick toward home (never inside FLY.edge). */
    const _li = { x: 0, y: 0, boost: false, brake: false };
    function leash(inp) {
      const r = Math.hypot(P.pos.x, P.pos.z);
      if (phase !== 'fly' || r < FLY.breeze) return inp;
      const k = sstep(FLY.breeze, FLY.breezeFull, r);
      const want = clamp(-wrapA(Math.atan2(-P.pos.x, -P.pos.z) - P.yaw) * 2.4, -1, 1);
      _li.x = lerp(inp.x, want, k); _li.y = inp.y; _li.boost = inp.boost; _li.brake = inp.brake;
      return _li;
    }

    // ---- collisions -------------------------------------------------------------------------------------
    const _hit = { nx: 0, ny: 0, nz: 0, pen: 0 };
    function hitCollider(c, x, y, z, r, out) {
      if (c.cyl) {
        const [cx, cz, cr, y0, y1] = c.cyl;
        if (y < y0 - r || y > y1 + r) return false;
        const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
        if (d > cr + r) return false;
        if (y > y1 && y - y1 < cr + r - d) { out.nx = 0; out.ny = 1; out.nz = 0; out.pen = y1 + r - y; return true; }
        out.nx = dx / (d || 1); out.ny = 0; out.nz = dz / (d || 1); out.pen = cr + r - d;
        return true;
      }
      const [bx, bz, hx, hz, ry, y0, y1] = c.box;
      const cs = Math.cos(ry), sn = Math.sin(ry), dx = x - bx, dz = z - bz;
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      const qx = clamp(lx, -hx, hx), qy = clamp(y, y0, y1), qz = clamp(lz, -hz, hz);
      let ox = lx - qx, oy = y - qy, oz = lz - qz;
      let d = Math.hypot(ox, oy, oz);
      if (d > r) return false;
      if (d < 1e-4) {   // centre inside: push out along the shallowest face
        const px = hx - Math.abs(lx), py = Math.min(y1 - y, y - y0), pz = hz - Math.abs(lz);
        if (py <= px && py <= pz) { ox = 0; oy = y - y0 < y1 - y ? -1 : 1; oz = 0; d = 0; out.pen = py + r; }
        else if (px <= pz) { ox = Math.sign(lx) || 1; oy = 0; oz = 0; out.pen = px + r; }
        else { ox = 0; oy = 0; oz = Math.sign(lz) || 1; out.pen = pz + r; }
      } else { ox /= d; oy /= d; oz /= d; out.pen = r - d; }
      out.nx = ox * cs + oz * sn; out.ny = oy; out.nz = -ox * sn + oz * cs;
      return true;
    }

    function collide() {
      const x = P.pos.x, z = P.pos.z, r = FLY.radius;
      const g = groundAt(x, z);
      // the sea: a skim and a hop, never a crash
      if (g < 0.4 && P.pos.y < 2.9 && phase === 'fly') {
        if (P.skimCd <= 0) {
          P.skimCd = 0.9;
          audio.sfx('water_skim', { intensity: clamp(P.speed / 45, 0.3, 1) });
          W.burst(scene, V(x, 0.4, z), { count: 22, colors: [0xFFFFFF, 0xCDEFFF], speed: 7, size: 0.22, gravity: -14, life: 0.8 });
          if (turn) turn.skims++;
        }
        if (Math.random() < 0.6) W.burst(scene, _tmp.set(x - P.dir.x * 3, 0.3, z - P.dir.z * 3), { count: 3, color: 0xFFFFFF, speed: 4, size: 0.18, gravity: -12, life: 0.5 });
      }
      if (g < 0.4 && P.pos.y < 1.6) { P.pos.y = 1.6; P.pitch = Math.max(P.pitch, 7 * DEG); P.speed *= 0.985; }
      // ground (in the falls basin the spray cushions you instead)
      if (g >= 0.4 && P.pos.y - 1.2 < g) {
        const hx = groundAt(x + 2, z) - groundAt(x - 2, z), hz = groundAt(x, z + 2) - groundAt(x, z - 2);
        _n.set(-hx / 4, 1, -hz / 4).normalize();
        if (inFallsZone(x, P.pos.y, z, _fc)) sprayBounce(_n, g);
        else {
          bump(_n, 'ground');
          P.pos.y = Math.max(P.pos.y, g + 1.25);
        }
      }
      // through the waterfall: a splash, never a bump
      if (P.sprayCd <= 0 && phase === 'fly' && fallsSheetDist(x, P.pos.y, z, _fc) < 2.6) {
        P.sprayCd = 0.7;
        audio.sfx('water_skim', { intensity: 0.8 });
        W.burst(scene, P.pos, { count: 30, colors: [0xFFFFFF, 0xCDEFFF, 0xE6F6FF], speed: 8, size: 0.4, gravity: -6, life: 0.9 });
        P.wobble = Math.max(P.wobble, 0.35);
        if (turn) turn.splashes++;
      }
      // structures and trees
      const list = A.cells.get(Math.floor(x / 40) * 1000 + Math.floor(z / 40));
      if (list) {
        for (const ci of list) {
          const c = A.colliders[ci];
          if (!hitCollider(c, x, P.pos.y, z, c.soft ? r * 0.6 : r, _hit)) continue;
          if (c.soft) { softHit(); continue; }
          _n.set(_hit.nx, _hit.ny, _hit.nz);
          bump(_n, 'solid');
          P.pos.addScaledVector(_n, _hit.pen + 0.05);
        }
      }
      // hot-air balloons: a soft boing
      for (let i = 0; i < HOTAIR.length; i++) {
        const h = HOTAIR[i];
        const dx = x - h.px, dy = P.pos.y - (h.py + 17), dz = z - h.pz, d = Math.hypot(dx, dy * 0.8, dz);
        if (d < 13) {
          _n.set(dx, dy, dz).normalize();
          P.pos.addScaledVector(_n, 13 - d);
          if (P.softCd <= 0 && phase === 'fly') { P.softCd = 1; P.wobble = 0.6; audio.sfx('bounce_soft', { vol: 0.8 }); pilotFeel('surprised', 1); }
        }
      }
    }

    const _fc = { s: 0, w: 0 };
    /** The falls' spray cushion: back out of the rock, heading reflected off it, nose up; no stun, no OOPS. */
    function sprayBounce(n, g) {
      const fl = Math.hypot(n.x, n.z);
      if (fl > 0.35) {
        P.pos.x = P.prev.x; P.pos.z = P.prev.z; P.pos.y = Math.max(P.prev.y, P.pos.y);
        const nx = n.x / fl, nz = n.z / fl, fd = P.dir.x * nx + P.dir.z * nz;
        if (fd < 0) P.yaw = Math.atan2(P.dir.x - 2 * fd * nx, P.dir.z - 2 * fd * nz);
      }
      if (P.pos.y - 1.2 < groundAt(P.pos.x, P.pos.z)) P.pos.y = Math.max(P.pos.y, g + 1.25);
      P.pitch = Math.max(P.pitch, 8 * DEG);
      P.speed = Math.max(FLY.vMin, P.speed * 0.9);
      P.wobble = Math.max(P.wobble, 0.6);
      if (P.softCd > 0 || phase !== 'fly') return;
      P.softCd = 0.6;
      audio.sfx('water_skim', { intensity: 1 });
      audio.sfx('bounce_soft', { vol: 0.6 });
      W.burst(scene, P.pos, { count: 34, colors: [0xFFFFFF, 0xCDEFFF], speed: 9, size: 0.45, gravity: -5, life: 1 });
      pilotFeel('surprised', 0.8);
    }

    function softHit() {
      if (P.softCd > 0 || phase !== 'fly') return;
      P.softCd = 0.8;
      P.wobble = Math.max(P.wobble, 0.45);
      P.speed *= 0.93;
      audio.sfx('swish', { vol: 0.7 });
      W.burst(scene, P.pos, { count: 18, colors: [0x4FA64A, 0x7CCB5E, 0x3B8A3A], speed: 6, size: 0.2, gravity: -6, life: 1 });
    }

    function bump(n, kind) {
      if (P.bumpCd > 0) {
        // already recovering: just keep clear
        if (n.y < 0.9) { const fd = P.dir.x * n.x + P.dir.z * n.z; if (fd < 0) P.yaw = Math.atan2(P.dir.x - 2 * fd * n.x, P.dir.z - 2 * fd * n.z); }
        return;
      }
      P.bumpCd = FLY.stunTime + 0.4;
      P.stun = FLY.stunTime;
      P.speed = Math.max(FLY.vMin, P.speed * 0.55);
      // bounce the heading off the wall (flat part of the normal), nose up
      const fl = Math.hypot(n.x, n.z);
      if (fl > 0.25) {
        const nx = n.x / fl, nz = n.z / fl, fd = P.dir.x * nx + P.dir.z * nz;
        if (fd < 0) P.yaw = Math.atan2(P.dir.x - 2 * fd * nx, P.dir.z - 2 * fd * nz);
      }
      P.pitch = Math.max(P.pitch, 16 * DEG);
      P.wobble = 1;
      if (phase !== 'fly') return;
      audio.sfx('plane_bump', { intensity: 0.8 });
      engine.shake(0.4, 0.5);
      ui.haptic && ui.haptic(30);
      W.burst(scene, P.pos, { count: 26, colors: kind === 'ground' ? [0x8BC66A, 0xC9A97A, 0xFFFFFF] : [0xFFFFFF, 0xDDE3EA, 0xFFC93C], speed: 7, size: 0.26, gravity: -8, life: 0.9 });
      W.burst(scene, P.pos, { count: 8, color: 0xFFE27D, speed: 3, size: 0.4, gravity: 0, life: 0.6 });
      ui.banner('OOPS!', { kind: 'bad', duration: 0.9 });
      pilotFeel('surprised', 1.4);
      if (turn) { turn.bumps++; if (mode === 'balloons') { turn.chain = 0; turn.comboT = 0; } }
    }

    // =============================================================================================
    // Camera
    // =============================================================================================

    const cam = { pos: V(), look: V(), up: V(0, 1, 0), fov: 60, roll: 0, mode: 'chase', snap: true };
    const _cp = V(), _cl = V();

    function chaseGoal(out, look) {
      const aspect = engine.size.aspect;
      const v01 = clamp((P.speed - FLY.vBrake) / (FLY.vBoost - FLY.vBrake), 0, 1);
      // portrait sees less sideways: a taller view and a camera a little further back keep the plane readable
      const portrait = aspect < 0.9;
      const wide = clamp((aspect - 1.2) / 0.8, 0, 1);   // desktop / landscape: a narrower lens, a little closer
      const vfov = portrait ? lerp(66, 76, v01) : lerp(lerp(54, 46, wide), lerp(64, 56, wide), v01);
      const dist = (portrait ? 14.5 : lerp(13, 12, wide)) + v01 * 3.5;
      const height = (portrait ? 5.6 : lerp(4.2, 3.7, wide)) - Math.sin(P.pitch) * 3;
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
      out.set(P.pos.x - fx * dist, P.pos.y + height, P.pos.z - fz * dist);
      look.set(P.pos.x + fx * 16 + P.dir.x * 6, P.pos.y + (portrait ? 2.6 : 1.8) + P.dir.y * 10, P.pos.z + fz * 16 + P.dir.z * 6);
      return vfov;
    }

    function updateCamera(dt, rdt) {
      let vfov = 60;
      const k = rdt != null ? rdt : dt;
      if (cinematic) {
        cinematic.t += k;
        const c = cinematic;
        if (c.kind === 'orbit') {
          const a = c.a0 + c.t * 0.12;
          _cp.set(P.pos.x + Math.sin(a) * 26, P.pos.y + 7, P.pos.z + Math.cos(a) * 26);
          _cl.copy(P.pos);
          vfov = engine.size.aspect < 0.9 ? 64 : 50;
        } else if (c.kind === 'flyby') {
          _cp.copy(c.pos);
          _cl.copy(P.pos);
          vfov = engine.size.aspect < 0.9 ? 58 : 44;
        } else if (c.kind === 'swoop') {
          const t = sstep(0, c.dur, c.t);
          vfov = chaseGoal(_cp, _cl);
          const a = P.yaw + Math.PI * 0.5 * (1 - t);
          _tmp.set(P.pos.x - Math.sin(a) * lerp(30, 0, t), P.pos.y + lerp(8, 0, t), P.pos.z - Math.cos(a) * lerp(30, 0, t));
          _cp.lerp(_tmp, 1 - t);
          _cl.lerp(P.pos, 1 - t);
          if (c.t >= c.dur) cinematic = null;
        } else if (c.kind === 'pull') {
          vfov = chaseGoal(_cp, _cl);
          _cp.y += c.t * 6; _cp.x -= Math.sin(P.yaw) * c.t * 8; _cp.z -= Math.cos(P.yaw) * c.t * 8;
          _cl.copy(P.pos);
        }
      } else vfov = chaseGoal(_cp, _cl);
      const snap = cam.snap;
      cam.snap = false;
      const lag = cinematic && cinematic.kind === 'flyby' ? 30 : 3.6;
      if (snap) { cam.pos.copy(_cp); cam.look.copy(_cl); cam.fov = vfov; }
      else {
        cam.pos.lerp(_cp, 1 - Math.exp(-lag * k));
        cam.look.lerp(_cl, 1 - Math.exp(-7 * k));
        cam.fov += (vfov - cam.fov) * (1 - Math.exp(-3 * k));
      }
      keepCameraClear();
      camera.position.copy(cam.pos);
      const rollT = cinematic ? 0 : -P.roll * 0.24;
      cam.roll += (rollT - cam.roll) * (1 - Math.exp(-4 * k));
      camera.up.set(0, 1, 0);
      camera.lookAt(cam.look);
      camera.rotateZ(cam.roll);
      if (Math.abs(camera.fov - cam.fov) > 0.01 || camera.aspect !== engine.size.aspect) {
        camera.fov = cam.fov;
        camera.aspect = engine.size.aspect;
        camera.updateProjectionMatrix();
      }
    }

    // Never under the ground or the sea, never inside a building or a canopy, and nothing solid between the
    // camera and the plane: under a bridge deck the camera stays under it (closer), a hill crest lifts it.
    const _sp = V();
    function keepCameraClear() {
      const cp = cam.pos, pp = P.pos;
      let gy = Math.max(groundAt(cp.x, cp.z), 0) + 2.2;
      if (cp.y < gy) cp.y = gy;
      // terrain between: lift the camera until its line to the plane clears the ground (at most 25 m)
      let need = cp.y;
      for (let k = 1; k <= 5; k++) {
        const t = k / 6, x = pp.x + (cp.x - pp.x) * t, z = pp.z + (cp.z - pp.z) * t;
        const g = Math.max(groundAt(x, z), 0) + 1.2, ly = pp.y + (cp.y - pp.y) * t;
        if (ly < g && g > pp.y) need = Math.max(need, pp.y + (g - pp.y) / t);
      }
      cp.y = Math.min(need, cp.y + 25);
      // structures at the camera
      const near = A.cells.get(Math.floor(cp.x / 40) * 1000 + Math.floor(cp.z / 40));
      if (near) for (const ci of near) {
        const c = A.colliders[ci];
        if (!hitCollider(c, cp.x, cp.y, cp.z, 1.2, _hit)) continue;
        const y0 = c.cyl ? c.cyl[3] : c.box[5], top = c.cyl ? c.cyl[4] : c.box[6];
        if (!c.soft && pp.y < y0 - 0.5) cp.y = Math.min(cp.y, y0 - 1.5);           // overhead: stay under it
        else if (top - cp.y < 12 && pp.y > y0) cp.y = top + 1.4;                   // the plane is up there too: rise over it
        else cp.addScaledVector(_n.set(_hit.nx, _hit.ny, _hit.nz), _hit.pen);
      }
      gy = Math.max(groundAt(cp.x, cp.z), 0) + 1.6;
      if (cp.y < gy) cp.y = gy;
      // anything solid between the plane and the camera: pull the camera in in front of it
      let free = 1;
      for (let k = 1; k <= 6 && free === 1; k++) {
        const t = k / 6;
        _sp.lerpVectors(pp, cp, t);
        if (blockedAt(_sp)) {
          let lo = (k - 1) / 6, hi = t;
          for (let it = 0; it < 4; it++) { const m = (lo + hi) / 2; _sp.lerpVectors(pp, cp, m); if (blockedAt(_sp)) hi = m; else lo = m; }
          free = Math.max(0.28, lo - 0.04);
        }
      }
      if (free < 1) cp.lerpVectors(pp, cp, free);
      // the waterfall turns see-through while the camera or the plane is close to it (behind or inside the sheet)
      const fd = Math.min(fallsSheetDist(cp.x, cp.y, cp.z, _fc), fallsSheetDist(pp.x, pp.y, pp.z, _fc) * 1.6);
      const fo = 0.9 - 0.7 * sstep(22, 6, fd);
      if (Math.abs(A.mats.falls.opacity - fo) > 0.005) A.mats.falls.opacity = fo;
    }
    function blockedAt(p, r = 0.8) {
      const list = A.cells.get(Math.floor(p.x / 40) * 1000 + Math.floor(p.z / 40));
      if (!list) return false;
      for (const ci of list) { const c = A.colliders[ci]; if (!c.soft && hitCollider(c, p.x, p.y, p.z, r, _hit)) return true; }
      return false;
    }

    // =============================================================================================
    // Plane visuals & life on the island
    // =============================================================================================

    let propSpin = 0, scarfT = 0, lookT = 0;
    function updatePlaneVisual(dt, t) {
      plane.position.copy(P.pos);
      const wob = Math.sin(t * 17) * P.wobble * 0.5;
      plane.rotation.set(-P.pitch + Math.sin(t * 13) * P.wobble * 0.15, P.yaw, P.roll + wob);
      propSpin += dt * (34 + P.speed * 0.9);
      prop.rotation.z = propSpin;
      blur.material.opacity = 0.55 + 0.15 * Math.sin(t * 40);
      // scarf flutter
      scarfT += dt * (8 + P.speed * 0.35);
      const pos = scarfGeo.attributes.position, arr = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const bz = scarfBase[i * 3 + 2], u = clamp(-bz / 1.3, 0, 1);
        arr[i * 3] = scarfBase[i * 3] + Math.sin(scarfT + u * 5) * 0.16 * u;
        arr[i * 3 + 1] = scarfBase[i * 3 + 1] + Math.sin(scarfT * 1.3 + u * 4) * 0.12 * u;
        arr[i * 3 + 2] = bz;
      }
      pos.needsUpdate = true;
      const pal = pilots[cur].pal;
      if (lookT > 0) { lookT -= dt; if (lookT <= 0) pal.lookAt(null); }
      pal.update(dt);
      // trails at speed or in a hard bank
      const want = P.speed > 38 || Math.abs(P.roll) > 0.75;
      if (want !== trailOn) { trailOn = want; if (want) for (const tr of trails) tr.visible = true; }
      const op = trailOn ? clamp((P.speed - 30) / 20, 0.2, 0.7) : 0;
      for (const tr of trails) {
        const u = tr.mesh.material.uniforms.uOpacity;
        u.value += (op - u.value) * (1 - Math.exp(-4 * dt));
        if (!trailOn && u.value < 0.02 && tr.visible) tr.visible = false;
      }
      // contact shadow on low quality (real shadows otherwise)
      const shadows = castShadows();
      blob.visible = !shadows && P.agl < 90;
      if (blob.visible) {
        const g = Math.max(groundAt(P.pos.x, P.pos.z), 0);
        blob.position.set(P.pos.x, g + 0.2, P.pos.z);
        const s = 1 + P.agl * 0.02;
        blob.scale.set(s, 1, s);
        blob.material.opacity = 0.32 * (1 - P.agl / 90);
      }
      env.setShadowFocus(P.pos, 46);
    }

    let lifeT = 0;
    const _bp = V();
    function updateLife(dt, t) {
      lifeT += dt;
      // windmills
      S.windmills.forEach((w, i) => {
        rotorSpin[i] += dt * (0.9 + i * 0.07);
        e4.set(0, w.face, rotorSpin[i]); q4.setFromEuler(e4);
        m4.compose(p4.set(w.hx, w.hy, w.hz), q4, s4.set(1, 1, 1));
        rotors.setMatrixAt(i, m4);
      });
      rotors.instanceMatrix.needsUpdate = true;
      // boats
      BOAT_PATHS.forEach((b, i) => {
        b.a += b.w * dt;
        const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
        const head = Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
        e4.set(Math.sin(t * 1.3 + i) * 0.04, head, Math.sin(t * 0.9 + i * 2) * 0.08); q4.setFromEuler(e4);
        m4.compose(p4.set(x, 0.1 + Math.sin(t * 1.7 + i) * 0.15, z), q4, s4.setScalar(1.4));
        boats.setMatrixAt(i, m4);
      });
      boats.instanceMatrix.needsUpdate = true;
      // hot-air balloons
      HOTAIR.forEach((h, i) => {
        h.a += h.w * dt;
        h.px = h.cx + Math.cos(h.a) * h.r; h.pz = h.cz + Math.sin(h.a) * h.r; h.py = h.cy + Math.sin(t * 0.3 + i) * 6;
        e4.set(0, t * 0.05 + i, 0); q4.setFromEuler(e4);
        m4.compose(p4.set(h.px, h.py, h.pz), q4, s4.setScalar(1.4));
        hotair.setMatrixAt(i, m4);
      });
      hotair.instanceMatrix.needsUpdate = true;
      // birds: circle their spot, scatter from the plane, then regroup
      let bi = 0;
      FLOCKS.forEach((f, k) => {
        f.a += dt * 0.25;
        const fx = f.cx + Math.cos(f.a) * 34, fz = f.cz + Math.sin(f.a) * 34, fy = f.cy + Math.sin(t * 0.5 + k) * 4;
        const near = Math.hypot(P.pos.x - fx, P.pos.y - fy, P.pos.z - fz) < 42;
        if (near && f.scatter <= 0 && phase !== 'intro') {
          f.scatter = 7;
          audio.sfx('swish', { vol: 0.6, rate: 1.3 });
          for (const b of f.birds) { const d = Math.hypot(b.ox, b.oz) || 1; b.vx = b.ox / d * 16 + P.dir.x * 6; b.vy = 7 + Math.random() * 6; b.vz = b.oz / d * 16 + P.dir.z * 6; }
          if (turn) turn.flocks++;
        }
        f.scatter = Math.max(0, f.scatter - dt);
        for (const b of f.birds) {
          const hx = fx + b.ox, hy = fy + b.oy, hz = fz + b.oz;
          if (f.scatter > 0) {
            if (f.scatter > 6.9) { b.x = b.x || hx; b.y = b.y || hy; b.z = b.z || hz; }
            b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
            b.vx *= Math.exp(-0.5 * dt); b.vy *= Math.exp(-0.8 * dt); b.vz *= Math.exp(-0.5 * dt);
            if (f.scatter < 3.5) { const kk = 1 - Math.exp(-0.9 * dt); b.x += (hx - b.x) * kk; b.y += (hy - b.y) * kk; b.z += (hz - b.z) * kk; }
          } else { b.x = hx; b.y = hy; b.z = hz; }
          const flap = 0.35 + Math.abs(Math.sin(t * (f.scatter > 0 ? 16 : 8) + b.ph)) * 0.9;
          e4.set(0, f.scatter > 0 ? Math.atan2(b.vx, b.vz) : Math.atan2(-Math.sin(f.a), Math.cos(f.a)), 0);
          q4.setFromEuler(e4);
          m4.compose(p4.set(b.x, b.y, b.z), q4, s4.set(1.6, 1.6 * flap, 1.6));
          birds.setMatrixAt(bi++, m4);
        }
      });
      birds.instanceMatrix.needsUpdate = true;
      // crowds animate only when the plane is near; buzz them low for a cheer
      crowdCd = Math.max(0, crowdCd - dt);
      for (const c of crowds) {
        const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
        if (d < 520) c.handle.update(dt);
        c.cheer = Math.max(0, c.cheer - dt);
        if (phase === 'fly' && d < (c.beach ? 70 : 60) && P.pos.y - c.y < 40 && c.cheer <= 0) {
          c.cheer = 8;
          c.handle.cheer(1, 2.6);
          audio.sfx('crowd_cheer', { intensity: c.beach ? 0.5 : 0.75 });
          if (c.beach) audio.sfx('voice_yay', { vol: 0.8 });
          pilotFeel('joy', 1.2);
          if (turn) turn.cheers++;
        } else if (c.beach && lifeT % 5 < dt) c.handle.cheer(0.35, 1.6);
      }
      // fountain spray, waterfall mist, gold sparkles
      sprayT -= dt; mistT -= dt; sparkT -= dt;
      if (sprayT <= 0) {
        sprayT = 0.14;
        if (Math.hypot(P.pos.x - L.plaza.x, P.pos.z - L.plaza.z) < 320) W.burst(scene, _bp.set(L.plaza.x, S.plaza.g + 7.8, L.plaza.z), { count: 5, colors: [0xFFFFFF, 0xBFE8FF], speed: 5, size: 0.2, gravity: -9.8, life: 1 });
      }
      if (mistT <= 0) {
        mistT = 0.2;
        if (Math.hypot(P.pos.x - L.pool.x, P.pos.z - L.pool.z) < 420) W.burst(scene, _bp.set(L.pool.x - 4, S.falls.pool + 1, L.pool.z - 4), { count: 6, colors: [0xFFFFFF, 0xE6F6FF], speed: 6, size: 0.5, gravity: 1.5, life: 1.4 });
      }
      if (sparkT <= 0 && mode === 'balloons') {
        sparkT = 0.35;
        BALLOONS.forEach((b, i) => { if (b.gold && !balState[i].popped && Math.hypot(b.x - P.pos.x, b.z - P.pos.z) < 260) W.burst(scene, _bp.set(b.x, b.y + 0.5, b.z), { count: 3, color: 0xFFF2A8, speed: 2.5, size: 0.3, gravity: 0, life: 0.8 }); });
      }
      // sea, river and falls flow
      A.normalTex.offset.set((t * 0.008) % 1, (t * 0.013) % 1);
      A.streakTex.offset.set(0, (-t * 0.9) % 1);
      // clouds: fly through for a puff
      let inside = -1;
      for (let i = 0; i < A.cloudVols.length; i++) {
        const c = A.cloudVols[i], dx = (P.pos.x - c.x) / c.rx, dy = (P.pos.y - c.y) / c.ry, dz = (P.pos.z - c.z) / c.rz;
        if (dx * dx + dy * dy + dz * dz < 1) { inside = i; break; }
      }
      if (inside >= 0 && inCloud !== inside && phase === 'fly') {
        audio.sfx('whoosh', { intensity: 0.7 });
        W.burst(scene, P.pos, { count: 30, color: 0xFFFFFF, speed: 9, size: 0.9, gravity: 0, life: 1 });
        if (turn) turn.clouds++;
      }
      inCloud = inside;
      flash += ((inside >= 0 ? 0.78 : 0) - flash) * (1 - Math.exp(-(inside >= 0 ? 7 : 2.5) * dt));
      const fo = flash.toFixed(3);
      if (hud.last.flash !== fo) { hud.last.flash = fo; hud.flash.style.opacity = fo; }
    }

    // ---- speed lines & the off-screen guide ------------------------------------------------------------
    let linesT = 0;
    function updateLines(dt) {
      const want = phase === 'fly' || phase === 'end' ? clamp((P.speed - 36) / 14, 0, 1) * 0.85 : 0;
      linesT += dt;
      const o = (hud.lines._o || 0) + (want - (hud.lines._o || 0)) * (1 - Math.exp(-5 * dt));
      hud.lines._o = o;
      hud.lines.style.opacity = o.toFixed(3);
      if (o > 0.02 && linesT > 0.06) { linesT = 0; hud.linesSvg.style.transform = 'rotate(' + (Math.random() * 14 - 7).toFixed(1) + 'deg) scale(' + (1 + Math.random() * 0.06).toFixed(3) + ')'; }
    }

    const _gp = V();
    const HOME = { x: 0, y: 40, z: 0 };
    let lostAtSea = false;
    function updateGuide(dt, t) {
      let target = null, col = '#FFB627';
      if (mode === 'rings' && turn && turn.next < RINGS.length && (phase === 'fly' || phase === 'countdown')) target = RINGS[turn.next];
      if (mode === 'tour' && hint.show > 0 && hint.target >= 0) { target = MARKERS[hint.target]; col = '#FF9F1C'; }
      if (mode === 'balloons' && turn && turn.balGuide > 0 && turn.balTarget >= 0 && phase === 'fly') { target = BALLOONS[turn.balTarget]; col = '#FF5A8A'; }
      // lost at sea: point home (Ring Run's guide already points back to the course)
      const r = Math.hypot(P.pos.x, P.pos.z);
      if (phase === 'fly' && r > FLY.edge) {
        if (!lostAtSea) { lostAtSea = true; ui.toast('Sunny Isle is this way!', { icon: 'map', duration: 2.6 }); }
        if (mode !== 'rings' && !(mode === 'tour' && hint.show > 0)) { target = HOME; col = '#3BC45B'; }
      } else if (r < FLY.edge - 150) lostAtSea = false;
      hud.edge.classList.toggle('fl-off', !target);
      if (!target) { arrow.visible = false; return; }
      _gp.set(target.x, target.y, target.z);
      // the 3D arrow reads best side-on: shown once the target is well off the nose
      const off = Math.abs(wrapA(Math.atan2(_gp.x - P.pos.x, _gp.z - P.pos.z) - P.yaw));
      arrow.visible = phase === 'fly' && off > 0.5;
      // 3D arrow just above the plane, pointing at the target
      if (arrow.visible) {
        arrow.position.set(P.pos.x + P.dir.x * 5, P.pos.y + 3.6 + Math.sin(t * 4) * 0.15, P.pos.z + P.dir.z * 5);
        arrow.lookAt(_gp);
        const d = arrow.position.distanceTo(_gp);
        arrow.scale.setScalar(clamp(d / 60, 0.7, 1.15));
        A.mats.arrow.color.set(col);
      }
      const pr = engine.project(_gp, camera);
      const w = engine.size.w, h = engine.size.h;
      const onScreen = pr.visible && !pr.behind && pr.x > 30 && pr.x < w - 30 && pr.y > 60 && pr.y < h - 110;
      hud.edge.classList.toggle('fl-off', onScreen);
      if (onScreen) return;
      let ex = pr.x - w / 2, ey = pr.y - h / 2;
      if (pr.behind) { ex = -ex; ey = -ey; if (Math.abs(ey) < 1 && Math.abs(ex) < 1) ey = h; }
      const m = Math.max(Math.abs(ex) / (w / 2 - 34), Math.abs(ey) / (h / 2 - 90)) || 1;
      const x = w / 2 + ex / m, y = h / 2 + ey / m;
      hud.edge.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) rotate(' + (Math.atan2(ey, ex) / DEG + 90).toFixed(1) + 'deg)';
      hud.edge.style.color = col;
    }

    // =============================================================================================
    // Targets: balloons, rings, markers
    // =============================================================================================

    const multFor = chain => Math.min(5, 1 + Math.floor((chain - 1) / 3));

    function updateBalloons(dt, t) {
      if (mode !== 'balloons') return;
      const cp = camera.position;
      let ahead = false;
      for (let i = 0; i < BALLOONS.length; i++) {
        const b = BALLOONS[i], st = balState[i];
        let s = 1;
        if (st.popped) { st.pop += dt; s = st.pop < 0.05 ? 1.15 : 0; }
        const bob = Math.sin(t * 1.4 + st.ph) * 0.6;
        // far balloons are drawn bigger so clusters read from a distance (the pop radius stays the same)
        const far = clamp(Math.hypot(b.x - cp.x, b.y - cp.y, b.z - cp.z) / 160, 1, 2.2);
        e4.set(Math.sin(t * 0.9 + st.ph) * 0.08, 0, Math.cos(t * 1.1 + st.ph) * 0.08); q4.setFromEuler(e4);
        m4.compose(p4.set(b.x, b.y + bob, b.z), q4, s4.setScalar(s * far * (b.gold ? 1.15 : 1)));
        balloonMesh.setMatrixAt(i, m4);
        m4.compose(p4, q4, s4.setScalar(st.popped ? 0 : far * (b.gold ? 1.15 : 1)));
        stringMesh.setMatrixAt(i, m4);
        if (!st.popped && phase === 'fly') {
          const dx = P.pos.x - b.x, dy = P.pos.y - (b.y + bob), dz = P.pos.z - b.z;
          if (dx * dx + dy * dy + dz * dz < POP_R * POP_R) popBalloon(i);
          else if (!ahead && dx * dx + dz * dz < 450 * 450 && Math.abs(wrapA(Math.atan2(-dx, -dz) - P.yaw)) < 35 * DEG) ahead = true;
        }
      }
      balloonMesh.instanceMatrix.needsUpdate = true;
      stringMesh.instanceMatrix.needsUpdate = true;
      // nothing ahead for a while: the edge arrow points out the nearest balloons for a few seconds
      if (turn && phase === 'fly') {
        turn.noBalT = ahead ? 0 : turn.noBalT + dt;
        if (turn.noBalT > 6 && turn.balGuide <= 0) { turn.balGuide = 3; turn.balTarget = nearestBalloon(); turn.noBalT = 0; }
        if (turn.balGuide > 0) { turn.balGuide -= dt; if (turn.balTarget < 0 || balState[turn.balTarget].popped) turn.balGuide = 0; }
      }
      if (turn && turn.comboT > 0) { turn.comboT -= dt; if (turn.comboT <= 0) turn.chain = 0; }
    }

    function nearestBalloon() {
      let best = -1, bc = Infinity;
      BALLOONS.forEach((b, i) => {
        if (balState[i].popped) return;
        const dx = b.x - P.pos.x, dz = b.z - P.pos.z;
        const c = Math.hypot(dx, dz) + Math.abs(wrapA(Math.atan2(dx, dz) - P.yaw)) * 60;
        if (c < bc) { bc = c; best = i; }
      });
      return best;
    }
    function dropFirstHint() { if (hintHandle) { hintHandle.hide(); hintHandle = null; } }

    function popBalloon(i) {
      dropFirstHint();
      const b = BALLOONS[i], st = balState[i];
      st.popped = true; st.pop = 0;
      const T = turn;
      T.chain = T.comboT > 0 ? T.chain + 1 : 1;
      T.comboT = COMBO_WINDOW;
      T.bestChain = Math.max(T.bestChain, T.chain);
      const mult = multFor(T.chain);
      const base = b.gold ? 5 : 1, pts = base * mult;
      T.score += pts; T.popped++;
      if (b.gold) { T.golds++; T.left += 5; }
      P.boost = Math.min(1, P.boost + 0.12);
      const pos = _bp.set(b.x, b.y, b.z);
      const col = b.gold ? 0xFFD23F : BAL_COLORS[i % BAL_COLORS.length];
      audio.sfx('balloon_pop', { intensity: b.gold ? 1 : 0.55 + (i % 4) * 0.08 });
      W.burst(scene, pos, { count: b.gold ? 40 : 24, colors: [col, 0xFFFFFF], speed: b.gold ? 11 : 8, size: 0.3, gravity: -6, life: 0.9 });
      W.confetti(scene, pos, { count: b.gold ? 70 : 26, spread: b.gold ? 7 : 4, floor: Math.max(0, groundAt(b.x, b.z)) + 0.05 });
      const sp = engine.project(pos, camera);
      if (sp.visible && !sp.behind) ui.scorePopup('+' + pts, clamp(sp.x, 40, engine.size.w - 40), clamp(sp.y - 20, 70, engine.size.h - 120), { color: b.gold ? '#FFE37A' : '#FFFFFF' });
      bumpScore();
      pilotFeel('joy', 0.9);
      pilots[cur].pal.lookAt(pos);
      lookT = 1;
      if (b.gold) {
        ui.banner('GOLD!', { kind: 'great', sub: '+5 points · +5 seconds', duration: 1.3 });
        audio.sfx('coin', { vol: 0.9 });
      } else if (mult > 1 && (T.chain - 1) % 3 === 0) {
        ui.banner('COMBO x' + mult + '!', { kind: mult >= 4 ? 'huge' : 'great', duration: 1.1 });
        audio.sfx('star', { rate: 1 + mult * 0.06 });
      }
      const left = balState.filter(s => !s.popped).length;
      if (left === 1) {
        const lastI = balState.findIndex(s => !s.popped);
        turn.lastBalloon = lastI;
      }
      if (left === 0) allBalloons();
    }

    async function allBalloons() {
      const T = turn, gen = flowGen;
      const bonus = Math.ceil(T.left);
      T.allBonus = bonus;
      T.score += bonus;
      bumpScore();
      engine.slowmo(0.25, 1.4);
      audio.sfx('fanfare_big');
      audio.duck(0.5, 2);
      W.fireworks(scene, V(P.pos.x + P.dir.x * 40, P.pos.y, P.pos.z + P.dir.z * 40), { count: 4 });
      ui.banner('ALL BALLOONS!', { kind: 'huge', sub: 'Time bonus +' + bonus, duration: 2.4 });
      pilotPlay('cheer');
      await ctx.wait(0.6);
      if (gen !== flowGen || T !== turn) return;
      endTurn('all');
    }

    function updateRings(dt, t) {
      if (mode !== 'rings') return;
      const T = turn;
      for (let i = 0; i < RINGS.length; i++) {
        const r = RINGS[i], st = ringState[i];
        let s = 1;
        if (st.state === 'done' || st.state === 'missed') { st.t += dt; s = st.state === 'done' ? (st.t < 0.25 ? 1 + st.t * 1.6 : 0) : (st.t < 0.4 ? 1 : 0); }
        m4.compose(p4.set(r.x, r.y, r.z), ringQuat[i], s4.setScalar(s * (r.s || 1)));
        ringMesh.setMatrixAt(i, m4);
      }
      ringMesh.instanceMatrix.needsUpdate = true;
      if (!T) return;
      const n = T.next;
      halo.visible = n < RINGS.length && phase !== 'intro';
      if (halo.visible) {
        const r = RINGS[n];
        halo.position.set(r.x, r.y, r.z);
        halo.quaternion.copy(ringQuat[n]);
        const k = (1 + ((t * 1.2) % 1) * 0.35) * (r.s || 1);
        halo.scale.setScalar(k);
        halo.material.opacity = 0.65 * (1 - ((t * 1.2) % 1));
      }
      if (phase !== 'fly' || n >= RINGS.length) return;
      T.ringT += dt;
      const r = RINGS[n];
      // which side of the ring's plane are we on?
      const side = (P.pos.x - r.x) * r.nx + (P.pos.y - r.y) * r.ny + (P.pos.z - r.z) * r.nz;
      const crossed = T.lastSide != null && T.lastSide < 0 && side >= 0;
      T.lastSide = side;
      if (crossed) {
        const px = P.pos.x - r.x - r.nx * side, py = P.pos.y - r.y - r.ny * side, pz = P.pos.z - r.z - r.nz * side;
        const off = Math.hypot(px, py, pz), rr = RING_R * (r.s || 1);
        if (off < rr + 1.2) passRing(n);
        else if (off < rr * 3.2) missRing(n, 'MISSED!');
      }
      if (T.next === n) {
        // flew on past it, or took too long: the guide moves on
        const nx = RINGS[n + 1];
        if (nx && T.ringT > 4) {
          const dNext = Math.hypot(P.pos.x - nx.x, P.pos.y - nx.y, P.pos.z - nx.z), leg = Math.hypot(nx.x - r.x, nx.y - r.y, nx.z - r.z);
          if (dNext < leg * 0.45) missRing(n, 'MISSED!');
        }
        if (T.next === n && T.ringT > RULES.ringTimeout) missRing(n, 'SKIPPED');
      }
    }

    function nextRingSetup() {
      const T = turn;
      T.ringT = 0;
      if (T.next < RINGS.length) {
        const r = RINGS[T.next];
        T.lastSide = (P.pos.x - r.x) * r.nx + (P.pos.y - r.y) * r.ny + (P.pos.z - r.z) * r.nz;
        ringMesh.setColorAt(T.next, new THREE.Color(T.next === RINGS.length - 1 ? 0x3BC45B : 0xFFB627));
        if (T.next + 1 < RINGS.length) ringMesh.setColorAt(T.next + 1, new THREE.Color(0xBFE6FF));
        ringMesh.instanceColor.needsUpdate = true;
      }
    }

    function passRing(n) {
      dropFirstHint();
      const T = turn, r = RINGS[n];
      ringState[n].state = 'done'; ringState[n].t = 0;
      T.hit++; T.streak++; T.bestStreak = Math.max(T.bestStreak, T.streak);
      T.next++;
      P.boost = Math.min(1, P.boost + 0.22);
      audio.sfx('ring_pass', { rate: Math.pow(2, Math.min(T.streak - 1, 12) / 12) });
      W.burst(scene, _bp.set(r.x, r.y, r.z), { count: 34, colors: [0xFFE27D, 0xFFFFFF, 0xFFB627], speed: 9, size: 0.3, gravity: 0, life: 0.8 });
      bumpScore();
      if (T.streak > 0 && T.streak % 5 === 0) ui.banner(T.streak + ' IN A ROW!', { kind: 'good', duration: 1 });
      pilotFeel('happy', 0.8);
      if (T.next >= RINGS.length) finishRings();
      else nextRingSetup();
    }

    function missRing(n, txt) {
      const T = turn;
      ringState[n].state = 'missed'; ringState[n].t = 0;
      ringMesh.setColorAt(n, new THREE.Color(0xFF5A5F));
      ringMesh.instanceColor.needsUpdate = true;
      T.missed++; T.streak = 0; T.penalty += RULES.missPenalty;
      T.next++;
      audio.sfx('ui_error', { vol: 0.8 });
      ui.banner(txt, { kind: 'bad', sub: '+' + RULES.missPenalty + ' seconds', duration: 1 });
      pilotFeel('sad', 1);
      if (T.next >= RINGS.length) finishRings();
      else nextRingSetup();
    }

    function finishRings() {
      const T = turn;
      T.finalTime = T.elapsed + T.penalty;
      halo.visible = false;
      // a sweeping flyby shot: the camera waits ahead of the plane and watches it pass
      const side = Math.random() < 0.5 ? 1 : -1;
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
      cinematic = { kind: 'flyby', t: 0, pos: V(P.pos.x + fx * 70 + fz * 18 * side, P.pos.y + 3, P.pos.z + fz * 70 - fx * 18 * side) };
      const gy = Math.max(0, groundAt(cinematic.pos.x, cinematic.pos.z)) + 3;
      if (cinematic.pos.y < gy) cinematic.pos.y = gy;
      audio.sfx('flyby', { intensity: 0.9, pan: side });
      audio.sfx('crowd_cheer', { intensity: 0.6 });
      const prev = save.records(DEF.id).best_rings;
      const best = !debugTouched && T.finalTime < Math.min(prev ? prev.value : Infinity, gameBest.time);
      gameBest.time = Math.min(gameBest.time, T.finalTime);
      ui.banner('FINISH!', { kind: 'huge', sub: fmtTime(T.finalTime, true) + (best ? ' · NEW RECORD!' : ''), duration: 2.4 });
      if (best) audio.sfx('fanfare_record'); else audio.sfx('fanfare_small');
      pilotPlay('cheer');
      endTurn('finish');
    }

    // ---- "!" markers ---------------------------------------------------------------------------------------
    function refreshMarkerTiles() {
      const mk = pilots[cur].markers;
      for (let i = 0; i < MARKER_COUNT; i++) { mkTile.array[i] = mk[i] ? 1 : 0; mkState[i].flip = 0; }
      mkTile.needsUpdate = true;
    }

    const FLIP = 0.7;
    function targetFade(i) {
      const nb = mkNear[i];
      if (mode === 'balloons') { for (const j of nb.balloons) if (!balState[j].popped) return 0.15; }
      else if (mode === 'rings' && turn) { for (const j of nb.rings) if (j === turn.next || j === turn.next + 1) return 0.15; }
      return 1;
    }
    function updateMarkers(dt, t) {
      const mk = pilots[cur].markers, vis = visited[cur], tour = mode === 'tour';
      const cp = camera.position;
      for (let i = 0; i < MARKER_COUNT; i++) {
        const m = MARKERS[i], st = mkState[i];
        const d = Math.hypot(m.x - cp.x, m.y - cp.y, m.z - cp.z);
        const got = mk[i] === 1;
        const done = tour ? vis[i] === 1 : got;          // nothing left to fly through here this flight
        let a = sstep(640, 420, d) * sstep(9, 30, d);    // fades in from afar, and never fills the camera's view
        if (done) a *= 0.55 * sstep(700, 300, d);
        else if (got) a *= 0.8;                           // Island Tour: found before, worth a revisit
        if (!tour) a *= targetFade(i);
        let sc = done ? (tour ? 7 : 5) : (tour ? 10 : 6.5) + Math.sin(t * 3 + i) * 0.4;
        p4.set(m.x, m.y + Math.sin(t * 1.6 + i * 1.3) * 0.9, m.z);
        if (st.flip > 0) {
          // the bubble pops up just above and ahead of the plane, flips to a check and shrinks away
          st.flip = Math.max(0, st.flip - dt);
          const u = 1 - st.flip / FLIP;
          if (u > 0.5 && mkTile.array[i] !== 1) { mkTile.array[i] = 1; mkTile.needsUpdate = true; }
          mkFlip.array[i] = Math.abs(Math.cos(u * Math.PI)) * (1 + Math.sin(u * Math.PI) * 0.4);
          a = 1;
          p4.set(P.pos.x + P.dir.x * 5, P.pos.y + 4.2 + u * 2.5, P.pos.z + P.dir.z * 5);
          sc = u < 0.25 ? lerp(2.5, 5.5, U.ease.outBack(u / 0.25)) : lerp(5.5, 0, U.ease.inQuad((u - 0.25) / 0.75));
        } else mkFlip.array[i] = done ? 1 : 0.7 + 0.3 * Math.abs(Math.cos(t * 1.1 + i));
        mkAlpha.array[i] = a;
        bmAlpha.array[i] = done ? 0 : (got ? 0.2 : 0.5) * (tour ? 1 : 0.4) * sstep(1050, 650, d) * sstep(40, 140, d);
        m4.compose(p4, q4.identity(), s4.setScalar(Math.max(0.001, sc)));
        markerMesh.setMatrixAt(i, m4);
        if (!done && phase === 'fly' && st.flip <= 0) {
          const dx = P.pos.x - m.x, dy = P.pos.y - m.y, dz = P.pos.z - m.z;
          if (dx * dx + dy * dy + dz * dz < MARKER_R * MARKER_R) visitMarker(i);
        }
      }
      mkFlip.needsUpdate = true; mkAlpha.needsUpdate = true; bmAlpha.needsUpdate = true;
      markerMesh.instanceMatrix.needsUpdate = true;
    }

    /** Fly through a "!": a new one is saved (and worth 3 in Island Tour), a known one is worth 1 in Island Tour. */
    function visitMarker(i, quiet) {
      const pl = pilots[cur], m = MARKERS[i], vis = visited[cur];
      const isNew = !pl.markers[i];
      if (!isNew && (mode !== 'tour' || vis[i])) return;
      vis[i] = 1;
      if (isNew) {
        pl.markers[i] = 1;
        storeMarkers(save, players[cur].profile, pl.markers);
        foundThisFlight[cur].push(i);
      } else revisited[cur].push(i);
      mkState[i].flip = FLIP;
      mkTile.array[i] = 0; mkTile.needsUpdate = true;
      dropFirstHint();
      if (hint.target === i) { hint.show = 0; hint.target = -1; }
      const n = countOf(pl.markers);
      refreshMarkerChip(true);
      if (quiet) return;
      if (mode === 'tour' && turn) {
        const pts = isNew ? RULES.ptsNew : RULES.ptsRevisit;
        turn.score += pts;
        bumpScore();
        const sp = engine.project(_bp.set(P.pos.x, P.pos.y + 5, P.pos.z), camera);
        if (sp.visible && !sp.behind) ui.scorePopup('+' + pts, clamp(sp.x, 40, engine.size.w - 40), clamp(sp.y - 30, 70, engine.size.h - 120), { color: isNew ? '#FFD27D' : '#FFFFFF' });
      }
      W.burst(scene, _bp.set(P.pos.x + P.dir.x * 5, P.pos.y + 4.5, P.pos.z + P.dir.z * 5), { count: isNew ? 40 : 18, colors: [0xFF9F1C, 0xFFFFFF, 0xFFE27D], speed: isNew ? 10 : 6, size: 0.34, gravity: -2, life: 1 });
      if (!isNew) {
        audio.sfx('coin', { vol: 0.7 });
        ui.toast('! ' + m.name + ' again · +' + RULES.ptsRevisit, { duration: 1.6 });
      } else {
        audio.sfx('info_found');
        W.ring(scene, _bp.set(m.x, m.y - 3, m.z), { color: 0xFF9F1C, radius: 12, life: 0.8 });
        pilotFeel('joy', 1.4);
        if (mode === 'tour') cardQueue.push({ i, n });
        else ui.toast('! ' + m.name + ' (' + n + '/' + MARKER_COUNT + ')', { duration: 2.4 });
        if (n === MARKER_COUNT) allMarkers();
        else if (n % 10 === 0) ctx.wait(0.9).then(() => { ui.toast(n + ' of 40 "!" found! Keep exploring!', { icon: 'star', duration: 2.6 }); ui.sfx('coin'); });
      }
      if (mode === 'tour' && phase === 'fly' && countOf(vis) === MARKER_COUNT) {
        const T = turn;
        ctx.wait(n === MARKER_COUNT && isNew ? 3.2 : 0.6).then(() => {
          if (turn !== T || phase !== 'fly') return;
          ui.banner('EVERY "!" VISITED!', { kind: 'huge', sub: 'What a tour of Sunny Isle!', duration: 2.4 });
          audio.sfx('fanfare_big');
          ctx.wait(1.4).then(() => { if (turn === T) endTurn('allVisited'); });
        });
      }
    }

    function allMarkers() {
      audio.sfx('fanfare_big');
      audio.duck(0.5, 2.5);
      W.fireworks(scene, V(P.pos.x + P.dir.x * 50, P.pos.y + 5, P.pos.z + P.dir.z * 50), { count: 5 });
      W.confetti(scene, V(P.pos.x, P.pos.y + 4, P.pos.z), { count: 200, spread: 9 });
      ui.banner('ALL 40 FOUND!', { kind: 'huge', sub: 'You know every corner of Sunny Isle!', duration: 3 });
      ui.confetti && ui.confetti({ count: 120 });
      pilotPlay('cheer');
      // the medal belongs to the saved Pal who did it: the first player (ctx.awardMedal credits player 1)
      if (!debugTouched && cur === 0 && markerOwner(save, players[0].profile)) ctx.awardMedal('platinum');
    }

    /** The nearest marker still to fly through (Island Tour prefers ones never found); `costly` adds the turn needed. */
    function nearestMarker(costly) {
      const mk = pilots[cur].markers, vis = visited[cur], tour = mode === 'tour';
      let best = -1, bc = Infinity;
      for (let i = 0; i < MARKER_COUNT; i++) {
        if ((tour ? vis[i] : mk[i]) || (turn && turn.skipMk && turn.skipMk[i] > 0)) continue;
        const m = MARKERS[i];
        const dx = m.x - P.pos.x, dz = m.z - P.pos.z, d = Math.hypot(dx, dz, (m.y - P.pos.y) * 1.5);
        const ang = Math.abs(wrapA(Math.atan2(dx, dz) - P.yaw));
        const c = d + (costly ? ang * 160 : 0) + (tour && mk[i] ? 150 : 0);
        if (c < bc) { bc = c; best = i; }
      }
      return best;
    }
    const markersLeft = () => MARKER_COUNT - countOf(mode === 'tour' ? visited[cur] : pilots[cur].markers);

    // ---- info cards (Island Tour) -------------------------------------------------------------------------
    function updateCards(dt) {
      if (card) {
        card.t -= dt;
        card.bar.style.transform = 'scaleX(' + clamp(card.t / card.dur, 0, 1).toFixed(3) + ')';
        if (card.t <= 0) closeCard();
      } else if (cardQueue.length && phase === 'fly') openCard(cardQueue.shift());
    }
    function openCard({ i, n }) {
      const m = MARKERS[i];
      const el = ui.el('div', 'fl-card ss-block', '<div class="ic">!</div><div><h4>' + ui.esc(m.name) + '<small>' + n + '/' + MARKER_COUNT + '</small></h4><p>' + ui.esc(m.fact) + '</p></div><i class="bar"></i>');
      el.setAttribute('role', 'status');
      el.addEventListener('pointerdown', e => { e.preventDefault(); closeCard(); });
      ctx.hud.appendChild(el);
      const dur = autoplay ? 2.5 : clamp(4 + m.fact.length / 26, 6, 9);
      card = { el, i, t: dur, dur, bar: el.querySelector('.bar') };
    }
    function closeCard() {
      if (!card) return;
      const el = card.el;
      card = null;
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }

    // =============================================================================================
    // Pilot reactions
    // =============================================================================================

    function pilotFeel(expr, hold) { const pal = pilots[cur].pal; pal.setExpression(expr, hold); }
    function pilotPlay(anim) { const pal = pilots[cur].pal; pal.play(anim).then(() => { if (ctx.alive) pal.play('idle'); }); }

    function setPilot(p) {
      cur = p;
      pilots.forEach((pl, i) => { pl.pal.root.visible = i === p; });
      const pl = pilots[p];
      bodyMat.color.copy(pl.shirt);
      scarfMat.color.copy(pl.scarf);
      pl.pal.play('idle');
      pl.pal.setExpression('happy');
      refreshMarkerTiles();
      refreshMarkerChip(false);
      refreshPlayerChip();
    }

    // =============================================================================================
    // Game flow: turns, timers, results
    // =============================================================================================

    function resetCourse() {
      balState.forEach(s => { s.popped = false; s.pop = 0; });
      ringState.forEach((s, i) => { s.state = 'todo'; s.t = 0; ringMesh.setColorAt(i, new THREE.Color(0xF4FBFF)); });
      ringMesh.instanceColor.needsUpdate = true;
      hint = { cd: 0, show: 0, target: -1 };
      cardQueue = []; closeCard();
    }

    function placeAt(st, back) {
      P.yaw = st.yaw; P.pitch = 0; P.roll = 0; P.speed = FLY.vCruise; P.boost = 1; P.boostIdle = 0;
      P.stun = 0; P.wobble = 0; P.bumpCd = 0;
      P.pos.set(st.x - Math.sin(st.yaw) * back, st.y, st.z - Math.cos(st.yaw) * back);
      P.dir.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
      for (const tr of trails) tr.visible = false;
      trailOn = false;
    }

    function newTurn() {
      return {
        score: 0, popped: 0, golds: 0, chain: 0, comboT: 0, bestChain: 0, allBonus: 0, lastBalloon: -1, noBalT: 0, balGuide: 0, balTarget: -1,
        left: RULES.time || 0, elapsed: 0, penalty: 0, next: 0, hit: 0, missed: 0, streak: 0, bestStreak: 0, ringT: 0, lastSide: null, finalTime: null,
        topSpeed: 0, dist: 0, bumps: 0, skims: 0, splashes: 0, clouds: 0, cheers: 0, flocks: 0, skipMk: new Float32Array(MARKER_COUNT),
      };
    }

    function skippable(sec) {
      return new Promise(resolve => {
        let done = false;
        const fin = () => { if (done) return; done = true; skipWaiter = null; resolve(); };
        skipWaiter = fin;
        ctx.wait(sec).then(fin);
      });
    }

    async function turnCard(p) {
      const prof = players[p].profile;
      const wrap = ui.el('div', 'fl-turnwrap');
      const c = ui.el('div', 'fl-turncard ss-pop');
      c.append(ui.portraitImg(prof, 64));
      const who = prof.name.toLowerCase() === 'you' ? 'Your turn!' : ui.esc(prof.name) + "'s turn!";
      const sub = mode === 'balloons' ? 'Pop as many as you can in 2:00' : mode === 'rings' ? 'Fly all ' + RINGS.length + ' rings, fast!' : 'New "!" +3 · revisits +1 · 5:00';
      c.appendChild(ui.el('div', '', '<h3>' + who + '</h3><p>' + sub + '</p>'));
      wrap.appendChild(c);
      ctx.hud.appendChild(wrap);
      audio.sfx('ui_open');
      pilots[p].pal.play('wave');
      await skippable(autoplay ? 0.6 : 1.6);
      wrap.classList.add('out');
      ctx.wait(0.3).then(() => wrap.remove());
    }

    async function run(gen) {
      for (let p = 0; p < players.length; p++) {
        await playTurn(p, gen);
        if (!ctx.alive || gen !== flowGen) return;
      }
      finishGame();
    }

    async function playTurn(p, gen) {
      const live = () => ctx.alive && gen === flowGen;
      setPilot(p);
      resetCourse();
      turn = newTurn();
      const st = startFor(mode);
      const countdownTime = 2.75;
      placeAt(st, FLY.vCruise * countdownTime);
      cam.snap = true;
      cinematic = { kind: 'orbit', t: 0, a0: P.yaw + 2.2 };
      phase = 'turn';
      if (mode === 'rings') nextRingSetup();
      refreshHud();
      if (players.length > 1) { await turnCard(p); if (!live()) return; }
      phase = 'countdown';
      cinematic = { kind: 'swoop', t: 0, dur: countdownTime };
      audio.sfx('flyby', { intensity: 0.55, pan: -0.6 });
      if (p === 0 && !autoplay && hintsOn && !firstDrag && !hintHandle) {
        const sz = engine.size, text = 'Drag anywhere to steer. Up climbs, down dives!';
        hintHandle = sz.h <= 520 && sz.aspect > 1 ? ui.hint({ gesture: 'drag-h', text })
          : ui.hint({ gesture: 'drag-h', text, x: sz.w * 0.5, y: sz.h * (sz.aspect < 1 ? 0.7 : 0.82), textMaxWidth: mode === 'tour' ? 214 : 260 });
        ctx.wait(7).then(() => { if (hintHandle) { hintHandle.hide(); hintHandle = null; } });
      }
      await ui.countdown(3);
      if (!live()) return;
      phase = 'fly';
      cinematic = null;
      audio.sfx('boost', { vol: 0.6 });
      if (mode === 'tour' && countOf(pilots[p].markers) === MARKER_COUNT) ui.toast('Every "!" found! Revisit them for points.', { icon: 'star', duration: 3 });
      await new Promise(resolve => { turnDone = resolve; });
      if (!live()) return;
      await outro(p, gen);
    }

    function endTurn(why) {
      if (phase !== 'fly') return;
      phase = 'end';
      turn.why = why;
      releaseAll();
      halo.visible = false; arrow.visible = false;
      if (turnDone) { const r = turnDone; turnDone = null; r(); }
    }

    async function outro(p, gen) {
      const T = turn;
      const live = () => ctx.alive && gen === flowGen;
      if (T.why === 'time') {
        audio.sfx('whistle');
        ui.banner('TIME UP!', { kind: 'info', sub: T.score + ' points', duration: 1.8 });
        cinematic = { kind: 'pull', t: 0 };
      } else if (T.why === 'allVisited' || T.why === 'all') {
        cinematic = { kind: 'pull', t: 0 };
      }
      // a record banner only for the best score so far, counting earlier turns of this game too
      if (mode !== 'rings' && T.score > 0) {
        const prev = save.records(DEF.id)[mode === 'balloons' ? 'best_balloons' : 'best_tour'];
        if (!debugTouched && T.score > Math.max(prev ? prev.value : 0, gameBest.score)) {
          ctx.wait(T.why === 'time' ? 1.4 : 2.2).then(() => {
            if (turn !== T || phase !== 'end') return;
            ui.banner('NEW RECORD!', { kind: 'huge', sub: T.score + ' points', duration: 1.8 });
            audio.sfx('fanfare_record');
          });
        }
        gameBest.score = Math.max(gameBest.score, T.score);
      }
      results[p] = {
        score: T.score, popped: T.popped, golds: T.golds, bestChain: T.bestChain, allBonus: T.allBonus,
        time: mode === 'rings' ? (T.finalTime != null ? T.finalTime : T.elapsed + T.penalty) : null, hit: T.hit, missed: T.missed, bestStreak: T.bestStreak,
        topSpeed: T.topSpeed, dist: T.dist, bumps: T.bumps, cheers: T.cheers, found: foundThisFlight[p].length, revisits: revisited[p].length,
      };
      await skippable(autoplay ? 1.6 : 3.2);
      if (!live()) return;
      cinematic = null;
      if (card) closeCard();
    }

    function finishGame() {
      phase = 'done';
      releaseAll();
      cinematic = { kind: 'orbit', t: 0, a0: P.yaw + 2.2 };
      const n = players.length, solo = n === 1;
      const records = [];
      const pid = prof => (prof.isGuest ? null : prof.id);
      const rec = (key, value, label, fmt, prof, higher, shown) => {
        if (debugTouched || !(value > 0)) return;
        const r = save.record(DEF.id, key, value, { higherIsBetter: higher, profileId: pid(prof), label, fmt });
        records.push({ label: n > 1 ? label + ' · ' + prof.name : label, value: shown, isNew: !!(r && r.isNew) });
      };
      const medals = [];
      const award = id => { if (!debugTouched && ctx.awardMedal(id)) medals.push(id); };
      let order, title, headline, headlineLabel, stats = [], scoreText, good;
      const R = results.map(r => r || { score: 0, time: 999, found: 0, revisits: 0, popped: 0, golds: 0, bestChain: 0, hit: 0, missed: 0, bestStreak: 0, topSpeed: 0, dist: 0, bumps: 0, cheers: 0 });
      const lifetime = pilots.map(pl => countOf(pl.markers));
      if (mode === 'balloons') {
        const best = R.reduce((b, r, i) => (r.score > R[b].score ? i : b), 0);
        order = R.map(r => r.score);
        rec('best_balloons', R[best].score, 'Best Balloon Pop', '{v} pts', players[best].profile, true, R[best].score + ' pts');
        if (R.some(r => r.score >= 25)) award('bronze');
        if (R.some(r => r.score >= 60)) award('gold');
        scoreText = i => R[i].score + ' pts';
        headline = String(R[solo ? 0 : best].score); headlineLabel = 'Points';
        const r0 = R[0];
        good = R.some(r => r.score >= 25);
        title = solo ? (r0.score >= 60 ? 'Balloon Ace!' : r0.score >= 40 ? 'Great Flying!' : r0.score >= 25 ? 'Nice Popping!' : 'Good Flight!') : null;
        if (solo) stats = [
          { label: 'Balloons popped', value: r0.popped + '/' + BALLOONS.length },
          { label: 'Gold balloons', value: String(r0.golds) },
          { label: 'Best chain', value: String(r0.bestChain) },
        ];
        if (solo && r0.allBonus) stats.push({ label: 'Time bonus', value: '+' + r0.allBonus });
      } else if (mode === 'rings') {
        const best = R.reduce((b, r, i) => (r.time < R[b].time ? i : b), 0);
        order = R.map(r => -r.time);
        const tv = Math.round(R[best].time * 10) / 10;
        rec('best_rings', tv, 'Fastest Ring Run', 'time1', players[best].profile, false, fmtTime(tv, true));
        if (R.some(r => r.time < RULES.silver)) award('silver');
        scoreText = i => fmtTime(R[i].time, true);
        headline = fmtTime(R[solo ? 0 : best].time, true); headlineLabel = 'Ring Run time';
        const r0 = R[0];
        good = R.some(r => r.time < RULES.silver);
        title = solo ? (r0.time < RULES.silver * 0.85 ? 'Speed Ace!' : r0.time < RULES.silver ? 'Super Run!' : r0.missed === 0 ? 'Perfect Rings!' : 'Course Complete!') : null;
        if (solo) stats = [
          { label: 'Rings', value: r0.hit + '/' + RINGS.length },
          { label: 'Missed (+3 s)', value: String(r0.missed) },
          { label: 'Best streak', value: String(r0.bestStreak) },
          { label: 'Top speed', value: Math.round(r0.topSpeed) + ' m/s' },
        ];
      } else {
        // Island Tour: points for the markers visited this flight (new +3, revisit +1)
        const best = R.reduce((b, r, i) => (r.score > R[b].score ? i : b), 0);
        order = R.map(r => r.score);
        rec('best_tour', R[best].score, 'Best Island Tour', '{v} pts', players[best].profile, true, R[best].score + ' pts');
        scoreText = i => R[i].score + ' pts';
        headline = String(R[solo ? 0 : best].score); headlineLabel = 'Tour points';
        good = R.some(r => r.score > 0);
        const r0 = R[0];
        title = solo ? (lifetime[0] === MARKER_COUNT && r0.found > 0 ? 'Island Expert!' : r0.score >= 30 ? 'Island Explorer!' : r0.score > 0 ? 'Nice Discoveries!' : 'Lovely Flight!') : null;
        if (solo) stats = [
          { label: 'New "!"', value: String(r0.found) },
          { label: 'Revisited', value: String(r0.revisits) },
          { label: 'All-time "!"', value: lifetime[0] + '/' + MARKER_COUNT },
          { label: 'Distance flown', value: (r0.dist / 1000).toFixed(1) + ' km' },
        ];
      }
      // the lifetime "!" record and the platinum medal (any mode) belong to saved Pals only
      const owned = i => !!markerOwner(save, players[i].profile);
      let mBest = -1;
      lifetime.forEach((v, i) => { if (owned(i) && (mBest < 0 || v > lifetime[mBest])) mBest = i; });
      if (mBest >= 0 && lifetime[mBest] > 0) rec('markers', lifetime[mBest], '"!" Markers Found', '{v}/40', players[mBest].profile, true, lifetime[mBest] + '/40');
      if (lifetime[0] === MARKER_COUNT && owned(0)) award('platinum');
      const placeOf = i => 1 + order.filter(v => v > order[i]).length;
      if (!solo) {
        const top = order.indexOf(Math.max(...order));
        const tied = order.filter(v => v === order[top]).length > 1;
        const nm = players[top].profile.name;
        title = tied ? "It's a Tie!" : nm.toLowerCase() === 'you' ? 'You Win!' : nm + ' Wins!';
        const lead = (val, low) => {
          let bi = 0;
          for (let i = 1; i < n; i++) if (low ? val(i) < val(bi) : val(i) > val(bi)) bi = i;
          const t = players.filter((_, i) => val(i) === val(bi)).length > 1;
          return { v: val(bi), who: t ? 'Tied' : players[bi].profile.name };
        };
        if (mode === 'balloons') { const a = lead(i => R[i].bestChain); stats.push({ label: 'Best chain · ' + a.who, value: String(a.v) }); const g2 = lead(i => R[i].golds); stats.push({ label: 'Most golds · ' + g2.who, value: String(g2.v) }); }
        if (mode === 'rings') { const a = lead(i => R[i].bestStreak); stats.push({ label: 'Best streak · ' + a.who, value: String(a.v) }); const m2 = lead(i => R[i].missed, true); stats.push({ label: 'Fewest misses · ' + m2.who, value: String(m2.v) }); }
        if (mode === 'tour') { const a = lead(i => R[i].found); stats.push({ label: 'Most new "!" · ' + a.who, value: String(a.v) }); }
        const fb = lead(i => R[i].bumps, true); stats.push({ label: 'Fewest bumps · ' + fb.who, value: String(fb.v) });
      }
      // skill: score (or time / finds) against what this level should manage
      const deltaFor = i => {
        if (debugTouched) return 0;
        const lv01 = clamp(ctx.skillFor(players[i].profile) / 2500, 0, 1), r = R[i];
        if (mode === 'balloons') return Math.round(clamp(4 + (r.score - lerp(18, 85, lv01)) * 1.1, -40, 80));
        if (mode === 'rings') return Math.round(clamp(4 + (lerp(210, 125, lv01) - r.time) * 1.2, -40, 80));
        // points: a new "!" is 3, a revisit 1, so a pilot who knows the island already can still score
        return Math.round(clamp(2 + (r.score - lerp(10, 40, lv01)) * 1.6, -30, 60));
      };
      ctx.finish({
        outcome: good ? 'win' : 'done',
        title,
        headline, headlineLabel,
        players: players.map((pl, i) => ({ profileId: pl.profile.id, name: pl.profile.name, profile: pl.profile, score: scoreText(i), place: placeOf(i), isCpu: false, skillDelta: deltaFor(i) })),
        stats,
        records,
        medals,
        sections: mode === 'tour' ? [markerSummary(lifetime)] : [],
        celebrate: good || medals.length > 0 || records.some(r => r.isNew),
      });
    }

    /** Island Tour results: the first pilot's markers (found first, new ones highlighted, the rest summed up as
     *  "???"), then one line for each other pilot. A results section for main.js (result.sections). */
    function markerSummary(lifetime) {
      const whose = prof => (prof.name.toLowerCase() === 'you' ? 'Your markers' : prof.name + '’s markers');
      const fresh = new Set(foundThisFlight[0]), mk = pilots[0].markers;
      const got = MARKERS.filter((m, i) => mk[i]).sort((a, b) => (fresh.has(b.i) ? 1 : 0) - (fresh.has(a.i) ? 1 : 0));
      const hidden = MARKER_COUNT - got.length;
      let html = '<ul class="fl-mklist">' + got.map(m => '<li class="got' + (fresh.has(m.i) ? ' new' : '') + '"><span>' + ui.esc(m.name) + '</span></li>').join('') + '</ul>';
      if (hidden) html += '<p class="fl-mkmore"><b>?</b>' + (got.length ? '+ ' + hidden + ' still hidden' : 'All ' + hidden + ' still hidden. Go exploring!') + '</p>';
      if (players.length > 1) {
        html += '<ul class="fl-mkothers">' + players.slice(1).map((pl, k) => '<li><span>' + ui.esc(pl.profile.name) + '</span><b>' + lifetime[k + 1] + '/' + MARKER_COUNT + '</b><small>+' + foundThisFlight[k + 1].length + ' new</small></li>').join('') + '</ul>';
      }
      return { title: whose(players[0].profile), icon: 'map', badge: lifetime[0] + '/' + MARKER_COUNT, html, className: 'fl-mks' };
    }

    // =============================================================================================
    // Autoplay: steers toward the next balloon, ring or "!" with smooth, slightly varied inputs
    // =============================================================================================

    const auto = { target: -1, t: 0, retarget: 0, wob: 0, skipB: new Float32Array(BALLOONS.length) };
    function autoTarget(dt) {
      auto.retarget -= dt; auto.t += dt;
      if (mode === 'rings') {
        if (!turn || turn.next >= RINGS.length) return null;
        const r = RINGS[turn.next];
        const dist = Math.hypot(r.x - P.pos.x, r.y - P.pos.y, r.z - P.pos.z);
        const lead = clamp(dist * 0.45, 0, 45);
        return _gp.set(r.x - r.nx * lead, r.y - r.ny * lead, r.z - r.nz * lead);
      }
      if (turn) for (let i = 0; i < MARKER_COUNT; i++) if (turn.skipMk[i] > 0) turn.skipMk[i] -= dt;
      for (let i = 0; i < BALLOONS.length; i++) if (auto.skipB[i] > 0) auto.skipB[i] -= dt;
      if (mode === 'balloons') {
        if (auto.retarget <= 0 || auto.target < 0 || balState[auto.target].popped) {
          auto.retarget = 0.6;
          let best = -1, bc = Infinity;
          BALLOONS.forEach((b, i) => {
            if (balState[i].popped || auto.skipB[i] > 0) return;
            const dx = b.x - P.pos.x, dz = b.z - P.pos.z, d = Math.hypot(dx, dz, (b.y - P.pos.y) * 1.6);
            const ang = Math.abs(wrapA(Math.atan2(dx, dz) - P.yaw));
            // turning around costs about a turn circle; a balloon too close and off to the side is a loop away
            let c = d + ang * 75 + (d < 60 && ang > 0.9 ? 160 : 0) + (b.gold ? -70 : 0);
            // prefer clusters: other balloons near this one make it worth more
            for (let j = 0; j < BALLOONS.length; j++) {
              if (j === i || balState[j].popped) continue;
              const o = BALLOONS[j], dd = Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z);
              if (dd < 90) c -= (90 - dd) * 0.5;
            }
            if (i === auto.target) c -= 40;
            if (c < bc) { bc = c; best = i; }
          });
          if (best !== auto.target) { auto.target = best; auto.t = 0; }
        }
        if (auto.target < 0) return null;
        if (auto.t > 22) { auto.skipB[auto.target] = 30; auto.target = -1; return null; }
        const b = BALLOONS[auto.target];
        const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
        if (d < 25) return _gp.set(b.x, b.y, b.z);
        const a = approachFor('b' + auto.target, b, Math.atan2(b.x - P.pos.x, b.z - P.pos.z), null), lead = clamp(d * 0.4, 0, 35);
        return _gp.set(b.x - Math.sin(a) * lead, b.y, b.z - Math.cos(a) * lead);
      }
      // tour
      if (auto.retarget <= 0 || auto.target < 0 || pilots[cur].markers[auto.target]) {
        auto.retarget = 1;
        const i = nearestMarker(true);
        if (i !== auto.target) { auto.target = i; auto.t = 0; }
      }
      if (auto.target < 0) return null;
      if (auto.t > 30) { turn.skipMk[auto.target] = 40; auto.target = -1; return null; }
      // line up on a clear approach (like a ring), then fly straight through
      const m = MARKERS[auto.target], a = approachFor('m' + auto.target, m, Math.atan2(m.x - P.pos.x, m.z - P.pos.z), m.approach);
      const dist = Math.hypot(m.x - P.pos.x, m.z - P.pos.z), lead = clamp(dist * 0.45, 0, 50);
      return _gp.set(m.x - Math.sin(a) * lead, m.y, m.z - Math.cos(a) * lead);
    }
    /** The clear heading through point m (70 m in, 40 m out) closest to `bearing`; `fixed` when given; the bearing
     *  itself when no heading is clear. Cached by key. */
    const approachCache = new Map();
    function approachFor(key, m, bearing, fixed) {
      if (fixed != null) return fixed;
      if (!approachCache.has(key)) {
        const ok = [];
        const clearAt = (x, y, z) => {
          if (y - Math.max(0, groundAt(x, z)) < 3) return false;
          const list = A.cells.get(Math.floor(x / 40) * 1000 + Math.floor(z / 40)) || [];
          return !list.some(ci => !A.colliders[ci].soft && hitCollider(A.colliders[ci], x, y, z, FLY.radius, _hit));
        };
        // a leg is clear flown level, or (for slopes) coming down / climbing away at 20°
        const leg = (sx, sz, b0, b1, slope) => { for (let b = b0; b <= b1; b += 5) if (!clearAt(m.x + sx * b, m.y + b * slope, m.z + sz * b)) return false; return true; };
        const T20 = Math.tan(20 * DEG);
        for (let k = 0; k < 24; k++) {
          const a = k * Math.PI / 12, sx = Math.sin(a), sz = Math.cos(a);
          const into = leg(-sx, -sz, 5, 70, 0) || leg(-sx, -sz, 5, 70, T20), out = leg(sx, sz, 5, 40, 0) || leg(sx, sz, 5, 40, T20);
          if (into && out) ok.push(a);
        }
        approachCache.set(key, ok);
      }
      const ok = approachCache.get(key);
      let best = bearing, bd = Infinity;
      for (const a of ok) { const d = Math.abs(wrapA(a - bearing)); if (d < bd) { bd = d; best = a; } }
      return best;
    }

    function autoSteer(dt) {
      const tg = autoTarget(dt);
      auto.wob += dt;
      let wantYaw = P.yaw, wantY = Math.max(P.pos.y, 60), dist = 200;
      if (tg) {
        const dx = tg.x - P.pos.x, dz = tg.z - P.pos.z;
        dist = Math.hypot(dx, dz);
        wantYaw = Math.atan2(dx, dz);
        wantY = tg.y;
      } else if (Math.hypot(P.pos.x, P.pos.z) > 700) wantYaw = Math.atan2(-P.pos.x, -P.pos.z);
      // terrain look-ahead: never plan below the hills ahead
      let maxG = 0;
      for (const k of [0.6, 1.2, 2]) {
        const ax = P.pos.x + Math.sin(P.yaw) * P.speed * k, az = P.pos.z + Math.cos(P.yaw) * P.speed * k;
        maxG = Math.max(maxG, groundAt(ax, az));
      }
      const close = tg && dist < 90;
      const floorY = maxG + (close ? 6 : 16);
      if (wantY < floorY && !(close && tg.y < floorY)) wantY = floorY;
      const yawErr = wrapA(wantYaw - P.yaw);
      autoIn.x = clamp(-yawErr * 2.4 + Math.sin(auto.wob * 0.7) * 0.05, -1, 1);
      const wantPitch = clamp(Math.atan2(wantY - P.pos.y, Math.max(dist, 10)), -FLY.maxDive, FLY.maxClimb);
      autoIn.y = clamp((wantPitch - P.pitch) * 3.2 + wantPitch / FLY.maxClimb * 0.4, -1, 1);
      if (P.agl < 14 && maxG > P.pos.y - 10) autoIn.y = Math.max(autoIn.y, 0.7);
      autoIn.boost = Math.abs(yawErr) < 0.35 && dist > 80 && P.boost > 0.15 && P.agl > 8;
      autoIn.brake = Math.abs(yawErr) > 0.7 && dist < 160;
      // a bridge deck, a roof or a tower near the path ahead: stay under it, clear it, or go round it
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), R = FLY.radius + 0.4;
      const hitAhead = (d, up) => blockedAt(_sp.set(P.pos.x + fx * d, P.pos.y + up, P.pos.z + fz * d), R);
      if (hitAhead(8, 6) || hitAhead(18, 6)) autoIn.y = Math.min(autoIn.y, -0.35);
      else if (hitAhead(14, -5)) autoIn.y = Math.max(autoIn.y, 0.6);
      if (hitAhead(12, 0) || hitAhead(22, 0)) {
        if (!hitAhead(16, 8)) autoIn.y = 1;
        else {
          const side = k => blockedAt(_sp.set(P.pos.x + Math.sin(P.yaw + k) * 20, P.pos.y, P.pos.z + Math.cos(P.yaw + k) * 20), R);
          autoIn.x = side(0.7) ? 1 : -1;
          autoIn.brake = true;
        }
      }
      // a slope ahead steeper than the plane can climb: full climb and turn toward the lower side
      const ahead = groundAt(P.pos.x + Math.sin(P.yaw) * P.speed * 0.8, P.pos.z + Math.cos(P.yaw) * P.speed * 0.8);
      if (ahead > P.pos.y - 3 && !(tg && dist < 40)) {
        const side = k => groundAt(P.pos.x + Math.sin(P.yaw + k) * P.speed, P.pos.z + Math.cos(P.yaw + k) * P.speed);
        autoIn.y = 1;
        autoIn.x = side(0.8) < side(-0.8) ? -1 : 1;
        autoIn.boost = false;
      }
    }

    // =============================================================================================
    // Audio loops
    // =============================================================================================

    let audioT = 0;
    function startLoops() {
      if (loops) return;
      loops = {
        engine: audio.loop('plane_engine', { vol: 0.55, rate: 1 }),
        rush: audio.loop('air_rush', { vol: 0.2 }),
        ocean: audio.loop('ocean_ambience', { vol: 0.4 }),
        park: audio.loop('park_ambience', { vol: 0 }),
      };
    }
    function updateAudio(dt) {
      audioT -= dt;
      if (!loops || audioT > 0) return;
      audioT = 0.1;
      const v01 = clamp((P.speed - FLY.vBrake) / (FLY.vBoost - FLY.vBrake), 0, 1);
      const rate = P.boosting ? 1.3 : P.braking ? 0.86 : lerp(0.9, 1.18, v01);
      loops.engine.setRate(rate, 0.25);
      loops.engine.setVolume(phase === 'done' ? 0.2 : 0.5 + v01 * 0.12, 0.2);
      loops.rush.setVolume(0.08 + v01 * 0.42 + (P.boosting ? 0.1 : 0), 0.2);
      loops.rush.setRate(clamp(P.speed / FLY.vCruise, 0.6, 1.8), 0.2);
      const low = 1 - sstep(30, 220, P.agl);
      loops.ocean.setVolume((P.overSea ? 0.55 : 0.18) * (0.35 + 0.65 * low), 0.4);
      loops.park.setVolume(P.overSea ? 0 : 0.42 * low, 0.4);
    }

    // =============================================================================================
    // Frame loop
    // =============================================================================================

    let boostWas = false;
    function update(dt, t) {
      const inp = controls(dt);
      if (autoplay && (phase === 'fly')) autoSteer(dt);
      if (phase === 'intro') {
        // a gentle level circle while the how-to and the title card show
        const steps = Math.max(1, Math.ceil(dt / 0.05));
        for (let k = 0; k < steps; k++) stepFlight(dt / steps, { x: 0.35, y: 0, boost: false, brake: false }, false);
      } else if (phase === 'countdown') {
        const steps = Math.max(1, Math.ceil(dt / 0.05));
        for (let k = 0; k < steps; k++) stepFlight(dt / steps, inp, true);
      } else if (phase === 'fly' || phase === 'end' || phase === 'done') {
        const steps = Math.max(1, Math.ceil(P.speed * dt / 1.4));
        const free = phase === 'fly' ? leash(inp) : { x: 0.3, y: P.pos.y < 80 ? 0.45 : 0, boost: false, brake: false };
        for (let k = 0; k < steps; k++) stepFlight(dt / steps, free, false);
      }
      if (phase === 'fly' && turn) {
        const paused = mode === 'tour' && !!card;
        if (!paused) {
          if (mode === 'rings') turn.elapsed += dt;
          else turn.left -= dt;
        }
        turn.topSpeed = Math.max(turn.topSpeed, P.speed);
        turn.dist += P.speed * dt;
        if (mode !== 'rings') {
          const sec = Math.ceil(turn.left);
          if (sec <= 10 && sec >= 1 && sec !== turn.lastTick) { turn.lastTick = sec; ui.sfx('ui_tick', { vol: 0.6, rate: sec <= 3 ? 1.3 : 1 }); }
          if (mode === 'balloons' && turn.lastBalloon >= 0 && !turn.slowmoDone) {
            const b = BALLOONS[turn.lastBalloon];
            if (Math.hypot(b.x - P.pos.x, b.y - P.pos.y, b.z - P.pos.z) < 28) { turn.slowmoDone = true; engine.slowmo(0.35, 0.9); }
          }
          if (turn.left <= 0) endTurn('time');
        }
        if (P.boosting && !boostWas) {
          audio.sfx('boost', { vol: 0.8 });
          W.burst(scene, _bp.set(P.pos.x - P.dir.x * 4, P.pos.y, P.pos.z - P.dir.z * 4), { count: 16, colors: [0xFFFFFF, 0xDDE3EA], speed: 3, size: 0.6, gravity: 1, life: 0.9 });
        }
        boostWas = P.boosting;
        if (hint.show > 0) { hint.show -= dt; if (hint.show <= 0) hint.target = -1; }
        if (hint.cd > 0) hint.cd -= dt;
      }
      updatePlaneVisual(dt, t);
      updateBalloons(dt, t);
      updateRings(dt, t);
      updateMarkers(dt, t);
      updateLife(dt, t);
      updateCards(dt);
      updateCamera(dt);
      updateGuide(dt, t);
      updateLines(dt);
      updateAudio(dt);
      refreshHud();
      refreshReadout();
      drawMap(dt);
    }

    // first frame: the plane circling, camera orbiting
    setPilot(0);
    {
      const st = startFor(mode);
      placeAt(st, 120);
      cinematic = { kind: 'orbit', t: 0, a0: P.yaw + 2.2 };
      turn = newTurn();
      if (mode === 'rings') { nextRingSetup(); }
      refreshHud();
      updatePlaneVisual(0, 0);
      updateMarkers(0, 0);
      updateBalloons(0, 0);
      updateRings(0, 0);
      updateCamera(0);
      drawMap(1);
      refreshReadout();
      // compile every material now (hidden ones and the effects too), so the first pop or ring never hitches
      const hidden = [halo, arrow, balloonMesh, stringMesh, ringMesh, blob].filter(o => !o.visible);
      for (const o of hidden) o.visible = true;
      W.burst(scene, V(P.pos.x, -60, P.pos.z), { count: 1, size: 0.01, life: 0.01 });
      W.confetti(scene, V(P.pos.x, -60, P.pos.z), { count: 1, floor: -61 });
      W.ring(scene, V(P.pos.x, -60, P.pos.z), { radius: 0.1, life: 0.01 });
      try { engine.renderer.compile(scene, camera); } catch (err) { /* warm-up is best effort */ }
      for (const o of hidden) o.visible = false;
    }

    return {
      start() {
        if (started) return;
        started = true;
        startLoops();
        flowGen++;
        run(flowGen);
      },
      update,
      onPause() { releaseAll(); },
      onResize() { cam.snap = false; releaseStick(); },
      dispose() {
        flowGen++;
        window.removeEventListener('pointerdown', onPDown);
        window.removeEventListener('pointermove', onPMove);
        window.removeEventListener('pointerup', onPUp);
        window.removeEventListener('pointercancel', onPUp);
        if (loops) for (const k in loops) loops[k].stop(0.3);
        loops = null;
        if (hintHandle) { hintHandle.hide(); hintHandle = null; }
        for (const tr of trails) tr.dispose();
        for (const pl of pilots) pl.pal.dispose();
        turnDone = null; skipWaiter = null; card = null; cardQueue = [];
      },
      debugState() {
        return {
          phase, mode, autoplay, player: cur, debugTouched,
          time: turn ? +(mode === 'rings' ? turn.elapsed + turn.penalty : turn.left).toFixed(2) : null,
          score: turn ? (mode === 'rings' ? turn.next : turn.score) : null,
          position: { x: +P.pos.x.toFixed(1), y: +P.pos.y.toFixed(1), z: +P.pos.z.toFixed(1) },
          speed: +P.speed.toFixed(1), boost: +P.boost.toFixed(2), yawDeg: Math.round(P.yaw / DEG), pitchDeg: Math.round(P.pitch / DEG), rollDeg: Math.round(P.roll / DEG),
          agl: +P.agl.toFixed(1), stun: +P.stun.toFixed(2),
          target: mode === 'rings' ? (turn && turn.next < RINGS.length ? { ring: turn.next } : null) : auto.target >= 0 ? { [mode === 'balloons' ? 'balloon' : 'marker']: auto.target } : null,
          balloonsLeft: balState.filter(s => !s.popped).length, ringsHit: turn ? turn.hit : 0, ringsMissed: turn ? turn.missed : 0,
          markers: countOf(pilots[cur].markers), foundThisFlight: foundThisFlight[cur].length, revisited: revisited[cur].length, card: card ? MARKERS[card.i].id : null,
          results: results.slice(),
        };
      },
      debug: {
        /** Flies itself: toward the next balloon / ring / "!" with smooth steering, through every turn to the results. */
        autoplay(on) {
          autoplay = on !== false;
          releaseStick();
          auto.target = -1; auto.retarget = 0;
          if (autoplay) {
            debugTouched = true;   // an autoplayed game never sets records, medals or skill
            if (hintHandle) { hintHandle.hide(); hintHandle = null; }
            if (skipWaiter) skipWaiter();
          }
          return autoplay;
        },
        teleport(x, y, z, yawDeg) {
          debugTouched = true;
          P.pos.set(x, y, z);
          if (yawDeg != null) P.yaw = yawDeg * DEG;
          P.stun = 0; P.bumpCd = 0;
          for (const tr of trails) tr.visible = false;
          cam.snap = true;
          if (turn) turn.lastSide = null;
          return true;
        },
        popAll() {
          if (mode !== 'balloons' || phase !== 'fly') return false;
          debugTouched = true;
          balState.forEach((s, i) => { if (!s.popped) popBalloon(i); });
          return true;
        },
        collectAll() {
          debugTouched = true;
          for (let i = 0; i < MARKER_COUNT; i++) if (!pilots[cur].markers[i]) visitMarker(i, countOf(pilots[cur].markers) < MARKER_COUNT - 1);
          return countOf(pilots[cur].markers);
        },
        resetMarkers() {
          debugTouched = true;
          pilots[cur].markers.fill(0);
          visited[cur].fill(0);
          storeMarkers(save, players[cur].profile, pilots[cur].markers);
          refreshMarkerTiles(); refreshMarkerChip(false);
          return 0;
        },
        collect(i) { debugTouched = true; if (i >= 0 && i < MARKER_COUNT) visitMarker(i); return countOf(pilots[cur].markers); },
        /** Ends the current turn now (as if time ran out / the course ended). */
        skip() {
          if (skipWaiter) skipWaiter();
          if (phase === 'fly') { debugTouched = true; if (mode === 'rings') { turn.finalTime = turn.elapsed + turn.penalty; endTurn('finish'); } else endTurn('time'); }
          return true;
        },
        setTime(s) { if (!turn) return false; debugTouched = true; if (mode === 'rings') turn.elapsed = s; else turn.left = s; return true; },
        markers: () => MARKERS.map(m => ({ id: m.id, name: m.name, x: +m.x.toFixed(1), y: +m.y.toFixed(1), z: +m.z.toFixed(1) })),
        rings: () => RINGS.map(r => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), z: +r.z.toFixed(1) })),
        balloons: () => BALLOONS.map(b => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1), gold: b.gold })),
        /** What a plane centred at (x, y, z) would touch: height above the ground/sea and any collider. */
        probe(x, y, z, verbose) {
          const list = A.cells.get(Math.floor(x / 40) * 1000 + Math.floor(z / 40)) || [];
          const hits = list.filter(ci => hitCollider(A.colliders[ci], x, y, z, FLY.radius, _hit)).map(ci => (verbose ? A.colliders[ci] : A.colliders[ci].soft ? 'tree' : A.colliders[ci].cyl ? 'cyl' : 'box'));
          return { agl: +(y - Math.max(0, groundAt(x, z))).toFixed(1), hits };
        },
        /** Clear headings (deg) through each "!" (70 m in, 40 m out): every marker should have two ≥ 60° apart, or a set approach. */
        markerClearance() {
          return MARKERS.map(m => {
            approachFor('m' + m.i, m, 0, null);
            const hs = approachCache.get('m' + m.i).map(a => Math.round(a / DEG));
            const spread = hs.some(a => hs.some(b => Math.abs(wrapA((a - b) * DEG)) >= 60 * DEG - 1e-6));
            return { id: m.id, ok: spread || m.approach != null, headings: hs.join(' '), approach: m.approach != null ? Math.round(m.approach / DEG) : null };
          });
        },
        info() { return { draws: engine.renderer.info.render.calls, tris: engine.renderer.info.render.triangles, trees: A.trees.palm.length + A.trees.round.length + A.trees.pine.length, colliders: A.colliders.length }; },
      },
    };
  }


  SS.registerSport(DEF);
})();
