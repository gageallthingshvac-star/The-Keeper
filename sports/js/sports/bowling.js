/* Sunny Sports — sports/bowling.js
 * BOWLING at "Sunny Lanes": the flagship sport.
 *   · Venue: a bright indoor alley — glossy maple lane with real markings, gutters, kickbacks, pin deck,
 *     pit & curtain, a masking unit with the sun logo, ball return, neighbouring lanes with ambient pals,
 *     overhead score monitor, carpeted seating area with spectators, wall mural and ceiling light strips.
 *   · Controls: drag sideways to slide along the approach, hold the round buttons to turn the aim
 *     arrow, swipe up to bowl (swipe speed → ball speed, swipe drift → line, swipe bend → hook).
 *   · Physics: an oiled-lane ball model (skid → hook → roll) and a compact deterministic rigid-body
 *     pin simulation (compound-sphere pins, sequential impulses, sleeping) at a fixed 240 Hz.
 *   · Modes: 10 Frames (1–4 hot-seat, exact ten-pin scoring), Spare Challenge (10 preset leaves, 10 points
 *     a pick-up plus 5 for each back-to-back one) and Power Pins (a bigger rack every round on a flared deck).
 *   · Debug: instance.debug = { autoplay, throw, setLeave, simulate, ... } and debugState().
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // =============================================================================================
  // 1. Registration
  // =============================================================================================

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="34" cy="58" rx="24" ry="3.5" fill="#000" opacity=".12"/>' +
    '<g transform="translate(47 2) scale(.92)">' +
    '<path d="M0 6C5.4 6 6.8 11 5.9 15.5 5.3 18.7 3.6 20 3.6 22.4 3.6 26 9.6 30 9.6 40.5 9.6 49 7 54 5.4 56H-5.4C-7 54-9.6 49-9.6 40.5-9.6 30-3.6 26-3.6 22.4-3.6 20-5.3 18.7-5.9 15.5-6.8 11-5.4 6 0 6Z" fill="#FFFFFF" stroke="#DCE3EE" stroke-width="1.6"/>' +
    '<path d="M-4.4 19.6h8.8M-4 24h8" stroke="#E8343A" stroke-width="2.6" stroke-linecap="round"/></g>' +
    '<g transform="translate(36 8) scale(.8)">' +
    '<path d="M0 6C5.4 6 6.8 11 5.9 15.5 5.3 18.7 3.6 20 3.6 22.4 3.6 26 9.6 30 9.6 40.5 9.6 49 7 54 5.4 56H-5.4C-7 54-9.6 49-9.6 40.5-9.6 30-3.6 26-3.6 22.4-3.6 20-5.3 18.7-5.9 15.5-6.8 11-5.4 6 0 6Z" fill="#FFFFFF" stroke="#DCE3EE" stroke-width="1.8"/>' +
    '<path d="M-4.4 19.6h8.8M-4 24h8" stroke="#E8343A" stroke-width="2.8" stroke-linecap="round"/></g>' +
    '<circle cx="24" cy="39" r="18" fill="#3C6BE0"/>' +
    '<path d="M10.5 30.5A16 16 0 0 1 33 23" stroke="#7FA5FF" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<circle cx="21" cy="33" r="3" fill="#1D2F6B"/><circle cx="29" cy="32" r="3" fill="#1D2F6B"/><circle cx="25" cy="41" r="3.4" fill="#1D2F6B"/>' +
    '</svg>';

  const DEF = {
    id: 'bowling',
    name: 'Bowling',
    tagline: 'Hook it for a strike!',
    accent: '#FF5A5F',
    tint: '#FFE8E6',
    icon: ICON,
    music: 'bowling',
    players: { min: 1, max: 4 },
    opponent: false,
    modes: [
      { id: 'game', name: '10 Frames', desc: 'A full game. Can you roll a 200?' },
      { id: 'spare', name: 'Spare Challenge', desc: 'Ten tricky leaves, one ball each. Pick them all up!' },
      { id: 'hundred', name: 'Power Pins', desc: 'Ten rolls, and the rack grows every time. Up to 91 pins!' },
    ],
    howTo: {
      steps: [
        { gesture: 'drag-h', text: 'Drag sideways to move along the approach' },
        { gesture: 'hold', text: 'Hold the turn buttons to aim the arrow' },
        { gesture: 'swipe-up', text: 'Swipe up to bowl. A faster swipe rolls a faster ball' },
        { gesture: 'swipe-up-curve', text: 'Bend your swipe to hook the ball into the pocket' },
      ],
      tips: [
        'Strikes love the pocket, right beside the head pin.',
        'Hooks curve late: start wide and let it bend back in.',
        'A slower ball hooks more, a faster one hooks less.',
        'Tap the aim buttons to zoom in on the pins.',
        'Spare Challenge: back-to-back pick-ups score bonus points.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Score 120 in 10 Frames' },
      { id: 'silver', name: 'Silver', desc: 'Score 170 in 10 Frames, or 350 in Power Pins' },
      { id: 'gold', name: 'Gold', desc: 'Score 220 in 10 Frames' },
      { id: 'platinum', name: 'Platinum', desc: 'Score 250, or pick up 8 leaves in Spare Challenge' },
    ],
    create,
  };

  // =============================================================================================
  // 2. Lane geometry, racks & rules data
  // =============================================================================================

  const LANE_HALF = 0.527;                 // 41.5" lane
  const GUTTER_W = 0.235;
  const GUTTER_Y = -0.052;                 // gutter channel floor (simplified flat)
  const PIT_Y = -0.42;
  const HEAD_Z = -18.29;                   // foul line (z = 0) → head pin
  const PIN_DX = 0.3048;                   // 12" pin spacing
  const ROW_DZ = PIN_DX * Math.sqrt(3) / 2;
  const RELEASE_Z = 0.22;                  // the ball touches down just before the foul line
  const BALL_R = 0.108;
  const BOARD = 1.054 / 39;
  const DEG = Math.PI / 180;

  /** Pin spots of a triangular rack with `rows` rows, numbered 1.. from the head pin, left → right. */
  function rackSpots(rows) {
    const out = [];
    let n = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= r; c++) out.push({ n: n++, row: r, x: (c - r / 2) * PIN_DX, z: HEAD_Z - r * ROW_DZ });
    }
    return out;
  }
  const SPOTS10 = rackSpots(4);

  /** Mode-dependent lane shape. Power Pins flares the back of the lane into a wide deck. */
  function makeLayout(mode) {
    const wide = mode === 'hundred';
    const rows = wide ? 13 : 4;
    const pitZ = HEAD_Z - (rows - 1) * ROW_DZ - 0.076;
    const deckHalf = wide ? 2.05 : LANE_HALF;
    const flare0 = -10.4, flare1 = -16.1;
    const halfAt = !wide ? () => LANE_HALF : (z) => {
      if (z > flare0) return LANE_HALF;
      if (z < flare1) return deckHalf;
      const t = (flare0 - z) / (flare0 - flare1);
      return LANE_HALF + (deckHalf - LANE_HALF) * t * t * (3 - 2 * t);
    };
    return {
      mode, wide, rows, pitZ, deckHalf, flare0, flare1, halfAt,
      pitBack: pitZ - 0.86,
      maskZ: HEAD_Z + 0.42,
      ceilY: wide ? 1.6 : 0.93,             // underside of the masking unit
      wallAt: z => halfAt(Math.max(z, pitZ)) + GUTTER_W,
    };
  }

  // =============================================================================================
  // 3. Physics: oiled-lane ball model + compact rigid-body pins (sequential impulses)
  // =============================================================================================

  const H = 1 / 240;                       // fixed physics step
  const GRAV = 9.81;
  const ITERS = 8;
  const BALL_M = 9.0;
  const BALL_IINV = 1 / (0.4 * BALL_M * BALL_R * BALL_R);
  const PIN_M = 1.53;
  const PIN_YC = 0.148;                    // centre of mass above the base
  const PIN_IP_INV = 1 / 0.012;            // about a horizontal axis through the CoM
  const PIN_IA_INV = 1 / 0.0013;           // about the pin's own axis
  const PIN_RIM = 0.026;                   // base contact ring (a pin stands up to ~10° of tilt)
  const PIN_SPH = [[0.062, 0.05], [0.132, 0.0605], [0.216, 0.046], [0.322, 0.033]].map(([y, r]) => ({ dy: y - PIN_YC, r }));
  const RIM_N = 8;
  const RIM_C = [], RIM_S = [];
  for (let k = 0; k < RIM_N; k++) { RIM_C.push(Math.cos(k / RIM_N * Math.PI * 2) * PIN_RIM); RIM_S.push(Math.sin(k / RIM_N * Math.PI * 2) * PIN_RIM); }
  const DOWN_COS = Math.cos(35 * DEG);
  const OIL_END = 12.2, DRY_START = 13.9;
  const MU = { oil: 0.025, dry: 0.24, deck: 0.2, pinFloor: 0.2, pinPin: 0.2, ballPin: 0.1, wall: 0.3 };
  const REST = { pinFloor: 0.22, pinPin: 0.4, ballPin: 0.6, wall: 0.6, back: 0.1, ceil: 0.2 };
  const MAX_V = 14, MAX_W = 90;
  const STEP_DEEP = 0.035;                 // a contact point this far below a floor is beside a step
  const SPIN_MAX = 24;                     // rad/s of side rotation at spin = 1 (at 8.5 m/s)
  const SPIN_LIMIT = 2.0;                  // an over-bent swipe over-hooks (spin 1 is a big, makeable hook)
  const SPIN_SPEED_EXP = 1.5;              // side spin grows with speed, but less than the hook needs: a fast ball skids further and hooks less
  // Entry-angle "drive": a ball that comes into the pocket at an angle carries through the rack (heavier
  // effective mass) while a flat, straight ball deflects off the head pin and leaves the 5, 8 or 10.
  // Full rack: effective mass = BALL_M × (BASE + K × smoothstep(LO, HI, angle)) — so a straight ball
  // (≤ ~1.3° from the corner) rarely carries and a real hook (3.5°+) carries most of the time.
  // Leaves keep the gentler curve the spare shots were tuned with: BALL_M × (0.5 + 1.5 × min(1, angle/3°)).
  const DRIVE_BASE = 0.3, DRIVE_K = 1.0, DRIVE_LO = 1.0, DRIVE_HI = 4.0;
  const PIN_JIT = 0.003;                   // pin-spotting tolerance (m, s.d.) — every rack sits a little differently
  const ROLL_FRAC = 0.5;                  // share of natural forward roll at release

  function laneMu(z) {
    const d = -z;
    if (d < OIL_END) return MU.oil;
    if (d < DRY_START) return MU.oil + (MU.dry - MU.oil) * (d - OIL_END) / (DRY_START - OIL_END);
    return d > -HEAD_Z - 0.35 ? MU.deck : MU.dry;
  }

  function makeBody(kind) {
    return {
      kind, n: 0, im: kind === 'ball' ? 1 / BALL_M : 1 / PIN_M,
      active: true, awake: false, lifted: false, sleepT: 0, touched: false, minUp: 1, spot: null,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
      qx: 0, qy: 0, qz: 0, qw: 1,
      m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1,
    };
  }

  function syncAxes(b) {
    const x = b.qx, y = b.qy, z = b.qz, w = b.qw;
    b.m00 = 1 - 2 * (y * y + z * z); b.m01 = 2 * (x * y - z * w); b.m02 = 2 * (x * z + y * w);
    b.m10 = 2 * (x * y + z * w); b.m11 = 1 - 2 * (x * x + z * z); b.m12 = 2 * (y * z - x * w);
    b.m20 = 2 * (x * z - y * w); b.m21 = 2 * (y * z + x * w); b.m22 = 1 - 2 * (x * x + y * y);
  }

  function placePin(b, x, z, yaw) {
    b.x = x; b.y = PIN_YC; b.z = z;
    b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    const h = (yaw || 0) / 2;
    b.qx = 0; b.qy = Math.sin(h); b.qz = 0; b.qw = Math.cos(h);
    b.active = true; b.awake = false; b.lifted = false; b.sleepT = 0; b.touched = false; b.minUp = 1;
    syncAxes(b);
  }

  const _iv = [0, 0, 0];
  /** World inverse inertia × (x, y, z) into _iv. Sleeping pins behave as static. */
  function invInertia(b, x, y, z) {
    if (b.kind === 'ball') { _iv[0] = x * BALL_IINV; _iv[1] = y * BALL_IINV; _iv[2] = z * BALL_IINV; return; }
    const ax = b.m01, ay = b.m11, az = b.m21;
    const d = (x * ax + y * ay + z * az) * (PIN_IA_INV - PIN_IP_INV);
    _iv[0] = x * PIN_IP_INV + d * ax; _iv[1] = y * PIN_IP_INV + d * ay; _iv[2] = z * PIN_IP_INV + d * az;
  }

  /** Effective inverse mass of body b at offset r along direction d. */
  function kAlong(b, rx, ry, rz, dx, dy, dz) {
    if (!b || !b.dyn) return 0;
    const cx = ry * dz - rz * dy, cy = rz * dx - rx * dz, cz = rx * dy - ry * dx;
    invInertia(b, cx, cy, cz);
    return b.im + cx * _iv[0] + cy * _iv[1] + cz * _iv[2];
  }

  function applyImpulse(b, px, py, pz, rx, ry, rz) {
    if (!b || !b.dyn) return;
    b.vx += px * b.im; b.vy += py * b.im; b.vz += pz * b.im;
    invInertia(b, ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px);
    b.wx += _iv[0]; b.wy += _iv[1]; b.wz += _iv[2];
  }

  function makeContact() {
    return {
      a: null, b: null, nx: 0, ny: 0, nz: 0, rax: 0, ray: 0, raz: 0, rbx: 0, rby: 0, rbz: 0,
      t1x: 0, t1y: 0, t1z: 0, t2x: 0, t2y: 0, t2z: 0, kn: 0, kt1: 0, kt2: 0,
      jn: 0, jt1: 0, jt2: 0, mu: 0, target: 0, vbx: 0, vbz: 0, kind: 0, vn0: 0,
    };
  }

  const CK_FLOOR = 1, CK_PIN = 2, CK_BALL = 3, CK_WALL = 4;

  /**
   * The pin deck world. Bodies: one ball + pins. Fixed-step, deterministic, never allocates in step().
   * Ball modes: 'held' 'lane' 'gutter' 'pit' 'gone'.
   */
  function PinWorld(layout) {
    this.L = layout;
    this.pins = [];
    this.ball = makeBody('ball');
    this.ball.mode = 'held';
    this.ball.active = false;
    this.pool = [];
    this.nc = 0;
    this.t = 0;
    this.acc = 0;
    this.sweep = null;     // { z, vz } kinematic deadwood sweep bar
    this.resetEvents();
  }

  PinWorld.prototype.resetEvents = function () {
    this.ev = {
      hit: null,           // first ball → pin contact { t, x, z, angle, speed }
      gutterAt: null, pitAt: null, launchedAt: null,
      clatter: 0, wallHits: 0,          // strongest pin-pin / pin-wall impact speed since last read
    };
  };

  /** Sets the rack: spots = [{n, x, z}], standing = optional Set of pin numbers to place. */
  PinWorld.prototype.setRack = function (spots, standing, jit) {
    this.pins.length = 0;
    for (const s of spots) {
      const b = makeBody('pin');
      b.n = s.n; b.spot = s;
      if (jit) placePin(b, s.x + jitter(jit), s.z + jitter(jit), jit.next() * Math.PI * 2);
      else placePin(b, s.x, s.z, (s.n * 1.37) % (Math.PI * 2));
      if (standing && !standing.has(s.n)) b.active = false;
      this.pins.push(b);
    }
  };

  /** Pin-spotting error: a clipped gaussian of PIN_JIT. */
  function jitter(rng) {
    const u = Math.max(1e-9, rng.next()), v = rng.next();
    return Math.max(-2, Math.min(2, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))) * PIN_JIT;
  }

  /** Launches the ball: x0 at the release line, angle (rad, + = toward +x), speed m/s, spin -1..1 (+ hooks left). */
  PinWorld.prototype.launch = function (o) {
    const b = this.ball;
    const sa = Math.sin(o.angle), ca = Math.cos(o.angle);
    b.active = true; b.dyn = true; b.mode = 'lane'; b.im = 1 / BALL_M;
    b.x = o.x; b.y = BALL_R; b.z = RELEASE_Z;
    b.vx = o.speed * sa; b.vy = 0; b.vz = -o.speed * ca;
    // natural roll is (vz, 0, -vx) / r; side rotation spins about the travel direction
    const s = (o.spin || 0) * SPIN_MAX * Math.pow(o.speed / 8.5, SPIN_SPEED_EXP);
    b.wx = ROLL_FRAC * b.vz / BALL_R - s * sa;
    b.wy = 0;
    b.wz = -ROLL_FRAC * b.vx / BALL_R + s * ca;
    b.qx = 0; b.qy = 0; b.qz = 0; b.qw = 1;
    b.pitT = 0;
    let up = 0;
    for (const p of this.pins) if (p.active) up++;
    this.fullRack = up === 10 && this.pins.length === 10;
    this.resetEvents();
    this.ev.launchedAt = this.t;
  };

  PinWorld.prototype.floorAt = function (x, z) {
    const L = this.L;
    if (z < L.pitZ) return PIT_Y;
    return Math.abs(x) <= L.halfAt(z) ? 0 : GUTTER_Y;
  };

  PinWorld.prototype.contact = function (a, b, nx, ny, nz, px, py, pz, pen, mu, e, kind) {
    let c = this.pool[this.nc];
    if (!c) { c = makeContact(); this.pool.push(c); }
    this.nc++;
    c.a = a; c.b = b; c.nx = nx; c.ny = ny; c.nz = nz; c.kind = kind;
    c.rax = px - a.x; c.ray = py - a.y; c.raz = pz - a.z;
    if (b) { c.rbx = px - b.x; c.rby = py - b.y; c.rbz = pz - b.z; } else { c.rbx = c.rby = c.rbz = 0; }
    c.vbx = 0; c.vbz = 0;
    if (Math.abs(nx) < 0.57) { // t1 = n × X
      const l = Math.hypot(nz, ny) || 1; c.t1x = 0; c.t1y = nz / l; c.t1z = -ny / l;
    } else { // t1 = n × Y
      const l = Math.hypot(nz, nx) || 1; c.t1x = -nz / l; c.t1y = 0; c.t1z = nx / l;
    }
    c.t2x = ny * c.t1z - nz * c.t1y; c.t2y = nz * c.t1x - nx * c.t1z; c.t2z = nx * c.t1y - ny * c.t1x;
    c.kn = 1 / Math.max(1e-9, kAlong(a, c.rax, c.ray, c.raz, nx, ny, nz) + kAlong(b, c.rbx, c.rby, c.rbz, nx, ny, nz));
    c.kt1 = 1 / Math.max(1e-9, kAlong(a, c.rax, c.ray, c.raz, c.t1x, c.t1y, c.t1z) + kAlong(b, c.rbx, c.rby, c.rbz, c.t1x, c.t1y, c.t1z));
    c.kt2 = 1 / Math.max(1e-9, kAlong(a, c.rax, c.ray, c.raz, c.t2x, c.t2y, c.t2z) + kAlong(b, c.rbx, c.rby, c.rbz, c.t2x, c.t2y, c.t2z));
    c.jn = c.jt1 = c.jt2 = 0;
    c.mu = mu;
    const vn = this.relN(c);
    c.vn0 = vn;
    const bounce = vn < -0.35 ? -e * vn : 0;
    const bias = Math.min(0.6, 0.22 * Math.max(0, pen - 0.0006) / H);
    c.target = Math.max(bounce, bias);
    return c;
  };

  /** Relative velocity of A w.r.t. B at the contact, along the normal. */
  PinWorld.prototype.relN = function (c) {
    const a = c.a, b = c.b;
    let vx = a.vx + a.wy * c.raz - a.wz * c.ray;
    let vy = a.vy + a.wz * c.rax - a.wx * c.raz;
    let vz = a.vz + a.wx * c.ray - a.wy * c.rax;
    if (b && b.dyn) {
      vx -= b.vx + b.wy * c.rbz - b.wz * c.rby;
      vy -= b.vy + b.wz * c.rbx - b.wx * c.rbz;
      vz -= b.vz + b.wx * c.rby - b.wy * c.rbx;
    } else { vx -= c.vbx; vz -= c.vbz; }
    return vx * c.nx + vy * c.ny + vz * c.nz;
  };

  PinWorld.prototype.solveContact = function (c) {
    const a = c.a, b = c.b;
    let vx = a.vx + a.wy * c.raz - a.wz * c.ray;
    let vy = a.vy + a.wz * c.rax - a.wx * c.raz;
    let vz = a.vz + a.wx * c.ray - a.wy * c.rax;
    const bd = b && b.dyn;
    if (bd) {
      vx -= b.vx + b.wy * c.rbz - b.wz * c.rby;
      vy -= b.vy + b.wz * c.rbx - b.wx * c.rbz;
      vz -= b.vz + b.wx * c.rby - b.wy * c.rbx;
    } else { vx -= c.vbx; vz -= c.vbz; }
    // normal
    const vn = vx * c.nx + vy * c.ny + vz * c.nz;
    let j = (c.target - vn) * c.kn;
    const jn = Math.max(0, c.jn + j);
    j = jn - c.jn; c.jn = jn;
    if (j !== 0) {
      const px = j * c.nx, py = j * c.ny, pz = j * c.nz;
      applyImpulse(a, px, py, pz, c.rax, c.ray, c.raz);
      if (bd) applyImpulse(b, -px, -py, -pz, c.rbx, c.rby, c.rbz);
    }
    if (c.mu <= 0 || c.jn <= 0) return;
    // friction (re-evaluate relative velocity after the normal impulse)
    vx = a.vx + a.wy * c.raz - a.wz * c.ray;
    vy = a.vy + a.wz * c.rax - a.wx * c.raz;
    vz = a.vz + a.wx * c.ray - a.wy * c.rax;
    if (bd) {
      vx -= b.vx + b.wy * c.rbz - b.wz * c.rby;
      vy -= b.vy + b.wz * c.rbx - b.wx * c.rbz;
      vz -= b.vz + b.wx * c.rby - b.wy * c.rbx;
    } else { vx -= c.vbx; vz -= c.vbz; }
    const lim = c.mu * c.jn;
    let jt = -(vx * c.t1x + vy * c.t1y + vz * c.t1z) * c.kt1;
    let acc = Math.max(-lim, Math.min(lim, c.jt1 + jt));
    jt = acc - c.jt1; c.jt1 = acc;
    let px = jt * c.t1x, py = jt * c.t1y, pz = jt * c.t1z;
    jt = -(vx * c.t2x + vy * c.t2y + vz * c.t2z) * c.kt2;
    acc = Math.max(-lim, Math.min(lim, c.jt2 + jt));
    jt = acc - c.jt2; c.jt2 = acc;
    px += jt * c.t2x; py += jt * c.t2y; pz += jt * c.t2z;
    applyImpulse(a, px, py, pz, c.rax, c.ray, c.raz);
    if (bd) applyImpulse(b, -px, -py, -pz, c.rbx, c.rby, c.rbz);
  };

  /** Wakes a sleeping pin (it becomes dynamic from the next contact pass). */
  function wake(p) { if (!p.awake) { p.awake = true; p.dyn = true; p.sleepT = 0; p.touched = true; } }

  PinWorld.prototype.pinStatics = function (p) {
    const L = this.L;
    // spheres: floor, walls, back cushion, masking-unit ceiling, sweep bar
    for (let k = 0; k < 4; k++) {
      const s = PIN_SPH[k];
      const cx = p.x + p.m01 * s.dy, cy = p.y + p.m11 * s.dy, cz = p.z + p.m21 * s.dy, r = s.r;
      const fy = this.floorAt(cx, cz);
      const pen = fy - (cy - r);
      // deeper than a step means we are beside it, not on it: the step faces below take over
      if (pen > -0.002 && pen < STEP_DEEP) this.contact(p, null, 0, 1, 0, cx, cy - r, cz, pen, MU.pinFloor, REST.pinFloor, CK_FLOOR);
      if (cz < L.pitZ) {
        if (cy - r < -0.01 && cz + r > L.pitZ) this.contact(p, null, 0, 0, -1, cx, cy, cz + r, cz + r - L.pitZ, MU.wall, REST.back, CK_WALL);
      } else if (cy - r < -0.006) {
        const hw = L.halfAt(cz), ax = Math.abs(cx);
        if (ax > hw && ax - r < hw) { const sx = cx > 0 ? 1 : -1; this.contact(p, null, sx, 0, 0, cx - sx * r, cy, cz, hw - (ax - r), MU.wall, REST.wall, CK_WALL); }
      }
      const wx = L.wallAt(cz);
      if (cx + r > wx) this.contact(p, null, -1, 0, 0, cx + r, cy, cz, cx + r - wx, MU.wall, REST.wall, CK_WALL);
      else if (cx - r < -wx) this.contact(p, null, 1, 0, 0, cx - r, cy, cz, -wx - (cx - r), MU.wall, REST.wall, CK_WALL);
      if (cz - r < L.pitBack) this.contact(p, null, 0, 0, 1, cx, cy, cz - r, L.pitBack - (cz - r), 0.6, REST.back, CK_WALL);
      if (cz < L.maskZ && cy + r > L.ceilY) this.contact(p, null, 0, -1, 0, cx, cy + r, cz, cy + r - L.ceilY, 0.3, REST.ceil, CK_WALL);
      if (this.sweep && cz + r > this.sweep.z && cy - r < 0.25) {
        const c = this.contact(p, null, 0, 0, -1, cx, cy, cz + r, cz + r - this.sweep.z, 0.4, 0, CK_WALL);
        c.vbz = this.sweep.vz;
        c.target = Math.max(c.target, -this.sweep.vz);
      }
    }
    // base rim
    const bx = p.x - p.m01 * PIN_YC, by = p.y - p.m11 * PIN_YC, bz = p.z - p.m21 * PIN_YC;
    if (by > 0.05 && by > this.floorAt(bx, bz) + 0.05) return;
    for (let k = 0; k < RIM_N; k++) {
      const lx = RIM_C[k], lz = RIM_S[k];
      const px = bx + p.m00 * lx + p.m02 * lz, py = by + p.m10 * lx + p.m12 * lz, pz = bz + p.m20 * lx + p.m22 * lz;
      const fy = this.floorAt(px, pz);
      const pen = fy - py;
      if (pen > -0.0015 && pen < STEP_DEEP) this.contact(p, null, 0, 1, 0, px, py, pz, pen, MU.pinFloor, REST.pinFloor, CK_FLOOR);
    }
  };

  PinWorld.prototype.pinPair = function (p, q) {
    const dx0 = p.x - q.x, dz0 = p.z - q.z, dy0 = p.y - q.y;
    if (dx0 * dx0 + dz0 * dz0 + dy0 * dy0 > 0.25) return;
    for (let i = 0; i < 4; i++) {
      const si = PIN_SPH[i];
      const ax = p.x + p.m01 * si.dy, ay = p.y + p.m11 * si.dy, az = p.z + p.m21 * si.dy;
      for (let j = 0; j < 4; j++) {
        const sj = PIN_SPH[j];
        const bx = q.x + q.m01 * sj.dy, by = q.y + q.m11 * sj.dy, bz = q.z + q.m21 * sj.dy;
        const dx = ax - bx, dy = ay - by, dz = az - bz, rr = si.r + sj.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
        if (!q.awake) {
          // an awake pin bumping a sleeping one wakes it when it actually pushes
          const appr = -(p.vx * nx + p.vy * ny + p.vz * nz);
          if (appr > 0.03 || rr - d > 0.003) wake(q);
        }
        const px = bx + nx * sj.r, py = by + ny * sj.r, pz = bz + nz * sj.r;
        this.contact(p, q, nx, ny, nz, px, py, pz, rr - d, MU.pinPin, REST.pinPin, CK_PIN);
      }
    }
  };

  PinWorld.prototype.ballPin = function (ball, p) {
    const dx0 = ball.x - p.x, dz0 = ball.z - p.z;
    if (dx0 * dx0 + dz0 * dz0 > 0.16) return;
    for (let i = 0; i < 4; i++) {
      const s = PIN_SPH[i];
      const cx = p.x + p.m01 * s.dy, cy = p.y + p.m11 * s.dy, cz = p.z + p.m21 * s.dy;
      const dx = ball.x - cx, dy = ball.y - cy, dz = ball.z - cz, rr = BALL_R + s.r;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
      wake(p);
      if (!this.ev.hit) {
        const sp = Math.hypot(ball.vx, ball.vz);
        const angle = Math.atan2(ball.vx, -ball.vz);
        this.ev.hit = { t: this.t, x: ball.x, z: ball.z, pin: p.n, speed: sp, angle };
        // entry angle toward the pin's side (into the pocket) drives through; a flat ball deflects
        const into = Math.max(0, -Math.sign(ball.x - p.x) * angle) / DEG;
        let k;
        if (this.fullRack) { const u = Math.max(0, Math.min(1, (into - DRIVE_LO) / (DRIVE_HI - DRIVE_LO))); k = DRIVE_BASE + DRIVE_K * u * u * (3 - 2 * u); }
        else k = 0.5 + 1.5 * Math.min(1, into / 3);
        this.ev.hit.drive = k;
        ball.im = 1 / (BALL_M * k);
      }
      this.contact(ball, p, nx, ny, nz, cx + nx * s.r, cy + ny * s.r, cz + nz * s.r, rr - d, MU.ballPin, REST.ballPin, CK_BALL);
    }
  };

  /** Ball forces before contacts: oil/dry friction (skid → hook → roll), gutters, pit. */
  PinWorld.prototype.ballForces = function (b) {
    const L = this.L;
    if (b.mode === 'lane') {
      if (b.z < L.pitZ) { b.mode = 'pit'; this.ev.pitAt = this.t; }
      else if (Math.abs(b.x) > L.halfAt(b.z)) { b.mode = 'gutter'; this.ev.gutterAt = this.t; b.gutterSide = b.x > 0 ? 1 : -1; }
    } else if (b.mode === 'gutter' && b.z < L.pitZ) { b.mode = 'pit'; this.ev.pitAt = this.t; }
    if (b.mode === 'lane') {
      const mu = laneMu(b.z);
      const ux = b.vx + BALL_R * b.wz, uz = b.vz - BALL_R * b.wx;
      const u = Math.hypot(ux, uz);
      if (u > 1e-7) {
        const J = Math.min(mu * BALL_M * GRAV * H, BALL_M * u / 3.5);
        const fx = -J * ux / u, fz = -J * uz / u;
        b.vx += fx / BALL_M; b.vz += fz / BALL_M;
        b.wx += -BALL_R * fz * BALL_IINV; b.wz += BALL_R * fx * BALL_IINV;
      }
      // a little rolling resistance
      const v = Math.hypot(b.vx, b.vz);
      if (v > 0.05) { const k = Math.max(0, 1 - 0.06 * H / v); b.vx *= k; b.vz *= k; b.wx *= k; b.wz *= k; }
    } else if (b.mode === 'gutter') {
      const gx = b.gutterSide * (L.halfAt(b.z) + GUTTER_W / 2);
      b.vx += ((gx - b.x) * 40 - b.vx * 9) * H;
      if (b.vz < -0.5) b.vz += 0.25 * H;
      b.wx = b.vz / BALL_R; b.wz = -b.vx / BALL_R;
    } else if (b.mode === 'pit') {
      b.vy -= GRAV * H;
      b.pitT += H;
    }
  };

  PinWorld.prototype.ballConstraints = function (b) {
    const L = this.L;
    if (b.mode === 'lane') { b.y = BALL_R; b.vy = 0; }
    else if (b.mode === 'gutter') {
      const gy = GUTTER_Y + BALL_R * 0.78;
      b.y += (gy - b.y) * Math.min(1, 14 * H);
      b.vy = 0;
    } else if (b.mode === 'pit') {
      if (b.y < PIT_Y + BALL_R) { b.y = PIT_Y + BALL_R; if (b.vy < 0) b.vy = -b.vy * 0.2; b.vx *= 0.96; b.vz *= 0.96; }
      if (b.z - BALL_R < L.pitBack) { b.z = L.pitBack + BALL_R; if (b.vz < 0) b.vz = -b.vz * 0.12; }
      const wx = L.wallAt(b.z) - BALL_R;
      if (Math.abs(b.x) > wx) { b.x = Math.sign(b.x) * wx; b.vx *= -0.2; }
      if (b.pitT > 1.4) { b.mode = 'gone'; b.active = false; b.dyn = false; }
    }
  };

  function integrate(b, h) {
    const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    if (v2 > MAX_V * MAX_V) { const k = MAX_V / Math.sqrt(v2); b.vx *= k; b.vy *= k; b.vz *= k; }
    const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
    if (w2 > MAX_W * MAX_W) { const k = MAX_W / Math.sqrt(w2); b.wx *= k; b.wy *= k; b.wz *= k; }
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    const { wx, wy, wz } = b;
    let { qx, qy, qz, qw } = b;
    const hh = 0.5 * h;
    const nx = qx + hh * (wx * qw + wy * qz - wz * qy);
    const ny = qy + hh * (wy * qw + wz * qx - wx * qz);
    const nz = qz + hh * (wz * qw + wx * qy - wy * qx);
    const nw = qw + hh * (-wx * qx - wy * qy - wz * qz);
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    b.qx = nx * l; b.qy = ny * l; b.qz = nz * l; b.qw = nw * l;
    syncAxes(b);
  }

  PinWorld.prototype.stepOnce = function () {
    const pins = this.pins, ball = this.ball, h = H;
    this.t += h;
    if (this.sweep) this.sweep.z += this.sweep.vz * h;
    // 1. forces
    for (const p of pins) {
      p.dyn = p.active && p.awake && !p.lifted;
      if (!p.dyn) continue;
      p.vy -= GRAV * h;
      // gentle air drag; much stronger once a pin is nearly at rest so wobbles and rolls settle
      // the pit cushion soaks up energy fast
      const calm = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz < 0.09 && p.wx * p.wx + p.wy * p.wy + p.wz * p.wz < 9;
      const pit = p.y < PIT_Y + 0.2;
      const lk = 1 - (pit ? 4 : calm ? 2.5 : 0.15) * h, ak = 1 - (pit ? 6 : calm ? 4 : 0.9) * h;
      p.vx *= lk; p.vy *= lk; p.vz *= lk; p.wx *= ak; p.wy *= ak; p.wz *= ak;
    }
    const ballLive = ball.active && ball.mode !== 'held' && ball.mode !== 'gone';
    ball.dyn = ballLive;
    if (ballLive) this.ballForces(ball);
    // 2. contacts
    this.nc = 0;
    const n = pins.length;
    for (let i = 0; i < n; i++) {
      const p = pins[i];
      if (!p.active || p.lifted) continue;
      if (p.dyn) this.pinStatics(p);
      for (let j = i + 1; j < n; j++) {
        const q = pins[j];
        if (!q.active || q.lifted || (!p.awake && !q.awake)) continue;
        if (p.awake) this.pinPair(p, q); else this.pinPair(q, p);
      }
      if (ballLive && ball.mode === 'lane') this.ballPin(ball, p);   // a gutter ball never reaches the deck
    }
    // refresh dyn flags for pins woken during contact generation (they join next step's solve as dynamic)
    // 3. solve
    const nc = this.nc, pool = this.pool;
    for (let it = 0; it < ITERS; it++) for (let k = 0; k < nc; k++) this.solveContact(pool[k]);
    // 4. events
    for (let k = 0; k < nc; k++) {
      const c = pool[k];
      const sp = -c.vn0;
      if (sp < 0.5) continue;
      if (c.kind === CK_PIN) this.ev.clatter = Math.max(this.ev.clatter, sp);
      else if (c.kind === CK_WALL && sp > 0.8) this.ev.wallHits = Math.max(this.ev.wallHits, sp);
    }
    // 5. integrate + sleep
    for (const p of pins) {
      if (!p.dyn) continue;
      integrate(p, h);
      if (p.m11 < p.minUp) p.minUp = p.m11;
      if (!(p.x === p.x && p.y === p.y && p.z === p.z && p.qw === p.qw)) { this.bury(p); continue; }
      const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz, w2 = p.wx * p.wx + p.wy * p.wy + p.wz * p.wz;
      if (v2 < 0.0025 && w2 < 0.5) {
        p.sleepT += h;
        if (p.sleepT > 0.3) { p.awake = false; p.dyn = false; p.vx = p.vy = p.vz = p.wx = p.wy = p.wz = 0; }
      } else p.sleepT = 0;
      if (p.y < PIT_Y - 1) this.bury(p);
    }
    if (ballLive) {
      integrate(ball, h);
      this.ballConstraints(ball);
    }
  };

  /** Removes a pin that left the world (or went numerically bad). */
  PinWorld.prototype.bury = function (p) {
    p.active = false; p.awake = false; p.dyn = false;
    p.x = p.spot.x; p.y = PIT_Y + 0.06; p.z = this.L.pitZ - 0.4;
    p.vx = p.vy = p.vz = p.wx = p.wy = p.wz = 0;
  };

  /** Advances by dt seconds (fixed substeps; a hitch is capped at 16 steps, but a long frame under a
   *  debug time-scale still simulates all of its game time). */
  PinWorld.prototype.advance = function (dt) {
    this.acc = Math.min(this.acc + dt, Math.max(H * 16, dt + H));
    while (this.acc >= H) { this.acc -= H; this.stepOnce(); }
  };

  PinWorld.prototype.isStanding = function (p) {
    if (!p.active) return false;
    if (p.lifted) return true;
    if (p.m11 < DOWN_COS) return false;
    const bx = p.x - p.m01 * PIN_YC, bz = p.z - p.m21 * PIN_YC, by = p.y - p.m11 * PIN_YC;
    if (bz < this.L.pitZ || Math.abs(bx) > this.L.halfAt(bz) || by < -0.03) return false;
    return true;
  };

  PinWorld.prototype.standing = function () {
    const out = [];
    for (const p of this.pins) if (this.isStanding(p)) out.push(p.n);
    return out;
  };

  /** Awake pins that can still change the count: on the deck and either upright-ish or moving with purpose. */
  PinWorld.prototype.liveCount = function () {
    let k = 0;
    for (const p of this.pins) {
      if (!p.active || !p.awake || p.lifted || p.y < -0.15) continue;
      const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz, w2 = p.wx * p.wx + p.wy * p.wy + p.wz * p.wz;
      if (p.m11 > 0.5 || v2 > 0.06 || w2 > 6) k++;
    }
    return k;
  };

  /** Nothing can change the count any more: standing pins are upright and still (a slow teeter can
   *  still go over), no deadwood is sliding around the deck (a messenger pin could still take one out)
   *  and none is creeping right beside a standing pin. */
  PinWorld.prototype.quiet = function () {
    const L = this.L, b = this.ball;
    if (b.mode === 'lane' && b.z > L.pitZ && b.z < HEAD_Z + 0.6 && b.vx * b.vx + b.vz * b.vz > 0.25) return false;
    for (const p of this.pins) {
      if (!p.active || p.lifted || !p.awake) continue;
      const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz, w2 = p.wx * p.wx + p.wy * p.wy + p.wz * p.wz;
      if (this.isStanding(p)) { if (p.m11 < 0.996 || w2 > 0.02 || v2 > 0.0004) return false; continue; }
      if (p.y < -0.1 || p.z < L.pitZ) continue;
      if (v2 > 0.36) return false;
      if (v2 < 0.0004 && w2 < 0.04) continue;
      for (const q of this.pins) {
        if (q !== p && this.isStanding(q) && (p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z) < 0.2) return false;
      }
    }
    return true;
  };

  /** True once the ball is done and nothing that matters moves. */
  PinWorld.prototype.settled = function () {
    const b = this.ball;
    const resting = b.mode === 'lane' && b.z < HEAD_Z + 0.3 && b.vx * b.vx + b.vz * b.vz < 0.04;   // stopped among the pins
    return (b.mode === 'gone' || b.mode === 'held' || resting || (b.mode === 'pit' && b.pitT > 0.5)) && this.liveCount() === 0;
  };

  // =============================================================================================
  // 4. Rules: ten-pin scoring, splits, Spare Challenge leaves, Power Pins racks
  // =============================================================================================

  /** Frames for a list of rolls: [{ marks: [..], total: number|null }], totals only once known. */
  function scoreFrames(rolls) {
    const frames = [];
    let i = 0, running = 0, known = true;
    const at = k => (k < rolls.length ? rolls[k] : null);
    for (let f = 0; f < 10; f++) {
      const fr = { marks: [], total: null };
      frames.push(fr);
      if (i >= rolls.length) continue;
      if (f < 9) {
        const a = rolls[i];
        let value = null;
        if (a === 10) {
          fr.marks.push('X');
          if (at(i + 2) !== null) value = 10 + rolls[i + 1] + rolls[i + 2];
          i += 1;
        } else {
          fr.marks.push(a === 0 ? '-' : String(a));
          const b = at(i + 1);
          if (b !== null) {
            fr.marks.push(a + b === 10 ? '/' : b === 0 ? '-' : String(b));
            if (a + b < 10) value = a + b;
            else if (at(i + 2) !== null) value = 10 + rolls[i + 2];
          }
          i += 2;
        }
        if (known && value !== null) { running += value; fr.total = running; } else known = false;
      } else {
        const r = rolls.slice(i, i + 3);
        const mark = (v, prev, fresh) => (v === 10 && fresh ? 'X' : !fresh && prev + v === 10 ? '/' : v === 0 ? '-' : String(v));
        let fresh = true, prev = 0;
        for (const v of r) {
          fr.marks.push(mark(v, prev, fresh));
          if (fresh) { fresh = v === 10; prev = v === 10 ? 0 : v; } else { fresh = true; prev = 0; }
        }
        const done = r.length === 3 || (r.length === 2 && r[0] !== 10 && r[0] + r[1] < 10);
        if (known && done) { running += r.reduce((s, v) => s + v, 0); fr.total = running; }
      }
    }
    return frames;
  }

  /** What the next ball is for a list of rolls: { frame 0..9, ball 0..2, fresh (full rack), done }. */
  function frameState(rolls) {
    let i = 0;
    for (let f = 0; f < 9; f++) {
      if (i >= rolls.length) return { frame: f, ball: 0, fresh: true, done: false };
      if (rolls[i] === 10) { i += 1; continue; }
      if (i + 1 >= rolls.length) return { frame: f, ball: 1, fresh: false, done: false };
      i += 2;
    }
    const r = rolls.slice(i);
    if (r.length === 0) return { frame: 9, ball: 0, fresh: true, done: false };
    if (r.length === 1) return { frame: 9, ball: 1, fresh: r[0] === 10, done: false };
    if (r.length === 2) {
      if (r[0] !== 10 && r[0] + r[1] < 10) return { frame: 9, ball: 2, fresh: false, done: true };
      return { frame: 9, ball: 2, fresh: (r[0] === 10 && r[1] === 10) || (r[0] !== 10 && r[0] + r[1] === 10), done: false };
    }
    return { frame: 9, ball: 3, fresh: false, done: true };
  }

  /** Latest known running total. */
  function knownTotal(rolls) {
    let t = 0;
    for (const f of scoreFrames(rolls)) if (f.total !== null) t = f.total;
    return t;
  }

  /** Pins next to each other (same row / diagonal) or hidden right behind each other (sleepers). */
  const ADJ10 = (() => {
    const adj = {};
    for (const a of SPOTS10) {
      adj[a.n] = [];
      for (const b of SPOTS10) {
        if (a === b) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 0.31 || (Math.abs(a.x - b.x) < 0.01 && d < 0.54)) adj[a.n].push(b.n);
      }
    }
    return adj;
  })();

  /** A split: head pin down and the standing pins fall into separate groups. */
  function isSplit(standing) {
    if (standing.length < 2 || standing.indexOf(1) >= 0) return false;
    const left = new Set(standing);
    const stack = [standing[0]];
    left.delete(standing[0]);
    while (stack.length) {
      const n = stack.pop();
      for (const m of ADJ10[n]) if (left.has(m)) { left.delete(m); stack.push(m); }
    }
    return left.size > 0;
  }

  // Ten leaves of rising difficulty (measured conversion windows at the front pin: ~30 cm down to ~4.5 cm).
  // The brief's 4-6 / 7-10 / 6-7-10 / 4-7-10 have no makeable line in this pin model, so the last three are
  // the hardest leaves that still can be picked up: the washout and two splits that need a sliding pin.
  const LEAVES = [
    { pins: [6, 10], name: '6-10' },
    { pins: [10], name: 'Ten Pin' },
    { pins: [7], name: 'Seven Pin' },
    { pins: [3, 6, 10], name: '3-6-10' },
    { pins: [2, 4, 5, 8], name: 'The Bucket' },
    { pins: [2, 7], name: '2-7 Baby Split' },
    { pins: [3, 10], name: '3-10 Baby Split' },
    { pins: [1, 2, 10], name: 'The Washout' },
    { pins: [5, 7], name: '5-7 Split' },
    { pins: [2, 10], name: '2-10 Split' },
  ];
  const SPARE_PTS = 10, SPARE_RUN_BONUS = 5;     // per pick-up, plus a bonus for each back-to-back pick-up

  const POWER_ROUNDS = 10;
  const POWER_CLEAR_BONUS = 25;
  const POWER_SILVER = 350;                      // Power Pins score that also earns the silver medal
  const powerRows = round => 4 + round;          // 10, 15, 21 … 91 pins
  const STRIKE_WORDS = ['STRIKE!', 'DOUBLE!', 'TURKEY!'];

  // =============================================================================================
  // 5. Shot planning (autoplay, simulate) and the human-input model
  // =============================================================================================

  const POCKET_X = 0.07;                   // ball centre at the head pin for a right-hander's 1-3 pocket
  const POCKET_TOL = 0.03, POCKET_ANGLE = 2.4;   // the guide turns green on this line (m, entry angle in deg)

  /** Ball-only trace to zStop → { x, angle } (x = ±9 when the ball found the gutter first). */
  function traceShot(L, shot, zStop) {
    const w = new PinWorld(L);
    w.launch(shot);
    while (w.ball.mode === 'lane' && w.ball.z > zStop && w.t < 8) w.stepOnce();
    const b = w.ball;
    return { x: b.mode === 'lane' ? b.x : (b.x > 0 ? 9 : -9), angle: Math.atan2(b.vx, -b.vz) };
  }

  const GUIDE_Z0 = -5.25, GUIDE_STEP = 0.42, GUIDE_MAX = 34, GHOST_MAX = 46;

  /**
   * The path of a ball bowled with `shot`, sampled every GUIDE_STEP from zFrom until it reaches zStop:
   * fills out = [x0, z0, x1, z1, …] and returns { x, angle, gutter } where it got to.
   */
  function tracePath(L, shot, zFrom, zStop, out) {
    const w = new PinWorld(L), b = w.ball;
    w.launch(shot);
    out.length = 0;
    let next = zFrom;
    while (b.mode === 'lane' && b.z > zStop && w.t < 8) {
      w.stepOnce();
      if (b.mode === 'lane' && b.z <= next) { out.push(b.x, b.z); next -= GUIDE_STEP; }
    }
    return { x: b.x, z: Math.max(b.z, zStop), angle: Math.atan2(b.vx, -b.vz), gutter: b.mode !== 'lane' };
  }

  /** Where the rolling ball will cross the head pin's line (null if it finds the gutter first). */
  function predictHeadX(world) {
    const w = new PinWorld(world.L), b = w.ball, s = world.ball;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz', 'qx', 'qy', 'qz', 'qw', 'mode', 'active', 'dyn', 'im']) b[k] = s[k];
    b.pitT = 0;
    while (b.mode === 'lane' && b.z > HEAD_Z && w.t < 3) w.stepOnce();
    return b.mode === 'lane' ? b.x : null;
  }

  /** Release angle that brings the ball to targetX at zTarget (the path is monotonic in the angle). */
  function aimAngle(L, x0, speed, spin, targetX, zTarget) {
    let lo = -8 * DEG, hi = 8 * DEG;
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      if (traceShot(L, { x: x0, angle: m, speed, spin }, zTarget).x < targetX) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /** A pocket shot in a given style ({ speed, spin 0..1 }) for hand = 1 (right) or -1 (left). */
  function strikeShot(L, style, hand) {
    const spin = style.spin * hand;
    const x = hand * (0.1 + 0.3 * Math.min(1, style.spin));
    return { x, angle: aimAngle(L, x, style.speed, spin, hand * POCKET_X, HEAD_Z), speed: style.speed, spin };
  }

  /** Candidate spare lines: a firm, nearly straight ball crossing the lane through each target. */
  function spareCandidates(L, pins, hand) {
    let minX = Infinity, maxX = -Infinity, frontZ = -Infinity;
    for (const p of pins) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); frontZ = Math.max(frontZ, p.z); }
    const out = [];
    const lim = L.halfAt(frontZ) - 0.06;
    for (let tx = Math.max(-lim, minX - 0.16); tx <= Math.min(lim, maxX + 0.16) + 1e-9; tx += 0.024) {
      const side = Math.abs(tx) < 0.08 ? hand : Math.sign(tx);
      const x = -side * 0.26, spin = 0.12 * hand, speed = 8.8;
      out.push({ x, angle: aimAngle(L, x, speed, spin, tx, frontZ + 0.2), speed, spin });
    }
    return out;
  }

  /** Full simulation of one ball against a rack → { knocked, standing, gutter, hit }. */
  function simulateShot(L, spots, standingSet, shot, tMax = 7, jit = null) {
    const w = new PinWorld(L);
    w.setRack(spots, standingSet, jit);
    const before = w.pins.filter(p => p.active).length;
    w.launch(shot);
    while (!w.settled() && w.t < tMax) w.stepOnce();
    const standing = w.standing();
    return { knocked: before - standing.length, standing, gutter: w.ev.gutterAt !== null, hit: w.ev.hit };
  }

  /** The default profile is called "You": "Your turn!", "You Win!". */
  function isYou(name) { return String(name).trim().toLowerCase() === 'you'; }

  function gauss(rng) {
    const u = Math.max(1e-9, rng.next()), v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A human-ish execution of a planned shot: quality 1 = robot, 0 = wild. */
  function humanize(shot, quality, rng) {
    const k = 1 - Math.max(0, Math.min(1, quality));
    return {
      x: Math.max(-0.5, Math.min(0.5, shot.x + gauss(rng) * 0.05 * k)),
      angle: shot.angle + gauss(rng) * 1.2 * DEG * k,
      speed: Math.max(SPEED_MIN, Math.min(SPEED_MAX, shot.speed + gauss(rng) * 0.9 * k)),
      spin: Math.max(-SPIN_LIMIT, Math.min(SPIN_LIMIT, shot.spin + gauss(rng) * 0.3 * k)),
    };
  }

  // =============================================================================================
  // 6. Swipe → shot mapping
  // =============================================================================================

  const SPEED_MIN = 5.5, SPEED_MAX = 10.5;
  const AIM_MAX = 3.5 * DEG;               // beyond this every line is a gutter ball
  const AIM_TAP = 0.05 * DEG;              // one tap of an aim button: ~1.6 cm at the pins (the pocket is ~5 cm)
  const X_MAX = 0.46;                      // release positions on the approach (ball centre)
  const BEND_DEAD = 0.015, BEND_KNEE = 0.05, BEND_FULL = 0.30, SPIN_GAIN0 = 1.6, SPIN_CAP = 1.05; // swipe bow (short sides) → spin: a tiny dead zone, then
  // a soft knee (a natural thumb arc only nudges the ball), then SPIN_GAIN0 / BEND_FULL spin per short side,
  // easing into SPIN_CAP (a ~0.3 bow is a near-full hook)
  // swipe tilt (deg) → line offset: a gentle pull for small tilts (a sloppy swipe strays a little), a stronger
  // one past DRIFT_KNEE for a deliberate angled swipe, at most DRIFT_MAX
  // (measured from the bowler's own habitual tilt, see tiltBias)
  const DRIFT_GAIN = 0.015, DRIFT_KNEE = 15, DRIFT_GAIN2 = 0.025, DRIFT_MAX = 1.0;
  const DRIFT_SHOWN = 0.08 * DEG;          // a pull this big is pointed out to the player (pull marker)
  const DRIFT_TOLD = 0.3 * DEG;            // ...and this big is also named in the shot readout

  /** Release speed (short sides / s; real flicks are about 2–10) → ball speed over the whole range. */
  function swipeSpeed(nspeed) {
    const k = Math.max(0, Math.min(1, (nspeed - 1.0) / 5.5));
    return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.pow(k, 0.85);
  }

  /** An upward swipe → { speed, spin, drift, tilt } (null when it isn't a bowl). `bias` (deg) is the
   *  bowler's habitual tilt, which doesn't pull the line. */
  function readSwipe(s, shortSide, bias = 0) {
    const up = -s.dy / shortSide;
    const dirDeg = Math.atan2(s.dx, -s.dy) / DEG;
    if (up < 0.14 || Math.abs(dirDeg) > 55) return null;
    // a tilted swipe pulls the line a little (0.1° moves the ball ~3 cm at the pins): a straight ball
    // needs a straight swipe
    const ad = Math.abs(dirDeg - bias);
    const drift = Math.sign(dirDeg - bias) * Math.min(DRIFT_MAX, ad * DRIFT_GAIN + Math.max(0, ad - DRIFT_KNEE) * DRIFT_GAIN2) * DEG;
    // hook: the swipe's bow plus a late turn of the finger (both say "curve back to the left" when +).
    // Only a tremor stays dead straight; past that the hook grows linearly with the bend (a third of the
    // screen is a big hook) and keeps growing, so a wild bend over-hooks.
    const ex = Math.max(0, Math.abs(s.lateral) - BEND_DEAD);
    const bow = Math.sign(s.lateral) * (ex < BEND_KNEE ? ex * ex / (2 * BEND_KNEE) : ex - BEND_KNEE / 2) / BEND_FULL;
    let turn = 0;
    const path = s.path || [];
    if (path.length > 4) {
      let len = 0;
      for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      let acc = 0, k = 0;
      for (let i = 1; i < path.length && acc < len * 0.7; i++) { acc += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); k = i; }
      const end = path[path.length - 1], mid = path[Math.min(k, path.length - 2)];
      const head = Math.atan2(end.x - mid.x, -(end.y - mid.y)), chord = Math.atan2(s.dx, -s.dy);
      let d = head - chord;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turn = Math.sign(d) * Math.max(0, Math.abs(d) - 0.2);
    }
    // the hook saturates: a small bend is fine control, a big confident curve is a repeatable full hook
    const spin = SPIN_CAP * Math.tanh((bow - turn * 0.4) * SPIN_GAIN0 / SPIN_CAP);
    // release speed; a short hold before lifting the finger shouldn't kill a good flick
    return { speed: swipeSpeed(Math.max(s.nspeed, (s.npeakSpeed || 0) * 0.75)), spin, drift, tilt: dirDeg };
  }

  /**
   * A swipe payload (as SS.input builds it) from raw samples [{x, y, t (ms)}], for strokes the engine
   * doesn't deliver whole: one that starts on an aim button, the bowl part of a slide-then-bowl press.
   */
  function strokeFromPath(path, short) {
    const p0 = path[0], end = path[path.length - 1];
    const dx = end.x - p0.x, dy = end.y - p0.y, dist = Math.hypot(dx, dy);
    // release velocity over the last ~90 ms of travel (a lift-off within 50 ms of the last move keeps it)
    let last = 0;
    for (let i = 1; i < path.length; i++) if (path[i].x !== path[i - 1].x || path[i].y !== path[i - 1].y) last = i;
    const head = end.t - path[last].t <= 50 ? path[last] : end;
    let ref = path[0];
    for (let i = last; i >= 0; i--) { ref = path[i]; if (head.t - path[i].t >= 90) break; }
    const span = (head.t - ref.t) / 1000;
    const speed = span > 0.001 ? Math.hypot(head.x - ref.x, head.y - ref.y) / span : 0;
    let peak = speed;
    for (let i = 1, j = 0; i < path.length; i++) {
      while (j + 1 < i && path[i].t - path[j + 1].t >= 40) j++;
      const dt = path[i].t - path[j].t;
      if (dt >= 40) peak = Math.max(peak, Math.hypot(path[i].x - path[j].x, path[i].y - path[j].y) / (dt / 1000));
    }
    // signed deviation from the chord, + = to the right of the direction of travel
    const ux = dist > 0 ? dx / dist : 0, uy = dist > 0 ? dy / dist : 0;
    let lateral = 0;
    for (const q of path) {
      const dev = -(q.x - p0.x) * uy + (q.y - p0.y) * ux;
      if (Math.abs(dev) > Math.abs(lateral)) lateral = dev;
    }
    return { start: { x: p0.x, y: p0.y }, dx, dy, dist, nspeed: speed / short, npeakSpeed: peak / short, lateral: lateral / short, path };
  }

  /** Index of the sample where a press's final upward stroke began (0 when it was upward throughout). */
  function strokeTurn(path) {
    let i = path.length - 1;
    while (i > 0) {
      const ddx = path[i].x - path[i - 1].x, ddy = path[i].y - path[i - 1].y;
      if (Math.hypot(ddx, ddy) > 1.5 && -ddy < Math.abs(ddx)) break;
      i--;
    }
    return i;
  }

  /** Picks the most forgiving line: the middle of the longest run of best-scoring candidates. */
  function bestCandidate(cands, scores) {
    let best = -1;
    for (const s of scores) best = Math.max(best, s);
    let runStart = -1, bestRun = null;
    for (let i = 0; i <= scores.length; i++) {
      if (i < scores.length && scores[i] === best) { if (runStart < 0) runStart = i; continue; }
      if (runStart >= 0) {
        if (!bestRun || i - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, i];
        runStart = -1;
      }
    }
    return cands[Math.floor((bestRun[0] + bestRun[1] - 1) / 2)];
  }

  /**
   * Headless outcome statistics for n frames of a bowler of the given quality (0..1): pocket-seeking
   * first balls in varied styles, planned spare balls, all executed with human-like noise.
   */
  function simulateFrames(n, quality, seed, hand = 1) {
    const L = makeLayout('game');
    const rng = SS.util ? SS.util.rng(seed) : null;
    const spareCache = new Map();
    const st = { frames: 0, strikes: 0, spareChances: 0, spares: 0, gutters: 0, balls: 0, pins1: 0, splits: 0, pocket: 0, pocketStrikes: 0, leaves: {} };
    for (let f = 0; f < n; f++) {
      const style = { speed: 7.6 + rng.next() * 1.6, spin: 0.45 + rng.next() * 0.5 };
      const r1 = simulateShot(L, SPOTS10, null, humanize(strikeShot(L, style, hand), quality, rng), 7, rng);
      st.frames++; st.balls++; st.pins1 += r1.knocked;
      if (r1.gutter && !r1.hit) st.gutters++;
      if (r1.hit && r1.hit.pin <= 3) {
        const pocketHit = Math.abs(Math.abs(r1.hit.angle) / DEG - 4.5) < 1.8 && r1.hit.x * hand > 0.02 && r1.hit.x * hand < 0.13;
        if (pocketHit) { st.pocket++; if (!r1.standing.length) st.pocketStrikes++; }
      }
      if (!r1.standing.length) { st.strikes++; continue; }
      const key = r1.standing.join('-');
      st.leaves[key] = (st.leaves[key] || 0) + 1;
      if (isSplit(r1.standing)) st.splits++;
      const set = new Set(r1.standing);
      let plan = spareCache.get(key);
      if (!plan) {
        const cands = spareCandidates(L, SPOTS10.filter(s => set.has(s.n)), hand);
        plan = bestCandidate(cands, cands.map(c => simulateShot(L, SPOTS10, set, c).knocked));
        spareCache.set(key, plan);
      }
      const r2 = simulateShot(L, SPOTS10, set, humanize(plan, quality, rng), 7, rng);
      st.spareChances++; st.balls++;
      if (r2.gutter && !r2.hit) st.gutters++;
      if (!r2.standing.length) st.spares++;
    }
    const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : 0);
    const topLeaves = Object.entries(st.leaves).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' ×' + v);
    return {
      frames: st.frames, quality,
      strikePct: pct(st.strikes, st.frames),
      sparePct: pct(st.spares, st.spareChances),
      gutterPct: pct(st.gutters, st.balls),
      avgPins: Math.round(100 * st.pins1 / st.frames) / 100,
      splitPct: pct(st.splits, st.frames),
      pocketPct: pct(st.pocket, st.frames),
      pocketStrikePct: pct(st.pocketStrikes, st.pocket),
      topLeaves,
    };
  }

  // =============================================================================================
  // 7. Art: canvas textures, the alley, pins and balls
  // =============================================================================================

  const FONT = "'Fredoka', 'Nunito', system-ui, sans-serif";
  const LANE_PITCH = 1.7;                  // centre-to-centre of standard lanes
  const AIM_Z = 1.45;                      // where the bowler stands while aiming
  const CUT_Z = -14.8;                     // the follow cam hands over to the pin cam here (after the break)
  const NB_Z = 2.4, NB_LINE = 0.45, NB_WALK = 1.5;   // neighbours wait by the seats, bowl from the line
  // (they bowl on the two lanes away from the bowling hand: the setup camera sits on the hand side, so from
  // there they never cross the aim view, even in a wide landscape frame)
  const CEIL_Y = 3.8;
  const MONITOR = { x: 0, y: 3.22, z: -1.1, w: 1.04, h: 0.585 };
  const HOOD = { x: 0.85, z: 2.1 };        // ball return (on the side away from the bowling hand)
  const RACK_SPOT = { y: 0.5, z: 3.05 };
  const KICK_COLORS = [0xFFC93C, 0x22C3B5, 0xFF6FAE, 0x8E7BFF, 0xFF8A3D];
  const SEAT_COLORS = [0xFF5A5F, 0x1FA2FF, 0xFFC93C, 0x3BC45B, 0x8E7BFF];

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function canvasTexture(THREE, c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function drawSun(g, x, y, r, rays) {
    g.save();
    g.translate(x, y);
    g.fillStyle = '#FFB020';
    for (let i = 0; i < rays; i++) {
      g.rotate(Math.PI * 2 / rays);
      g.beginPath();
      g.moveTo(-r * 0.2, -r * 1.05); g.lineTo(0, -r * 1.55); g.lineTo(r * 0.2, -r * 1.05);
      g.closePath(); g.fill();
    }
    g.fillStyle = '#FFC93C';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFE58A';
    g.beginPath(); g.arc(-r * 0.25, -r * 0.3, r * 0.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5A3A10';
    g.beginPath(); g.ellipse(-r * 0.33, -r * 0.1, r * 0.09, r * 0.14, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(r * 0.33, -r * 0.1, r * 0.09, r * 0.14, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5A3A10'; g.lineWidth = r * 0.09; g.lineCap = 'round';
    g.beginPath(); g.arc(0, r * 0.12, r * 0.42, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    g.fillStyle = 'rgba(255,110,110,.55)';
    g.beginPath(); g.ellipse(-r * 0.58, r * 0.2, r * 0.14, r * 0.09, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(r * 0.58, r * 0.2, r * 0.14, r * 0.09, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /** The masking-unit panel: sun logo + SUNNY LANES. */
  function logoCanvas() {
    const c = makeCanvas(1024, 512), g = c.getContext('2d');
    g.scale(2, 2);
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3C47A8'); grd.addColorStop(1, '#262C72');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(256, 300, 90 + i * 40, Math.PI, 2 * Math.PI); g.lineWidth = 14; g.strokeStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(255,201,60,.08)'; g.stroke(); }
    drawSun(g, 256, 96, 52, 14);
    g.font = '700 46px ' + FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#1A1F55'; g.lineJoin = 'round';
    g.strokeText('SUNNY LANES', 256, 206);
    g.fillStyle = '#FFFFFF'; g.fillText('SUNNY LANES', 256, 206);
    g.fillStyle = '#FFC93C'; g.fillRect(0, 248, 512, 8);
    return c;
  }

  /** Long, cheerful wall mural: hills, a big sun, smiling pins and confetti. */
  function muralCanvas(rng) {
    const W = 1024, Hh = 256, c = makeCanvas(W, Hh), g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, Hh);
    sky.addColorStop(0, '#5BB8F5'); sky.addColorStop(0.7, '#BDE6FF'); sky.addColorStop(1, '#E8F7FF');
    g.fillStyle = sky; g.fillRect(0, 0, W, Hh);
    // stripes of a rainbow arc
    const rb = ['#FF5A5F', '#FF8A3D', '#FFC93C', '#3BC45B', '#1FA2FF', '#8E7BFF'];
    rb.forEach((col, i) => { g.strokeStyle = col; g.lineWidth = 10; g.beginPath(); g.arc(700, 260, 170 - i * 10, Math.PI, 2 * Math.PI); g.stroke(); });
    drawSun(g, 180, 70, 34, 12);
    for (let i = 0; i < 6; i++) {
      const x = rng.range(0, W), y = rng.range(20, 90), s = rng.range(18, 30);
      g.fillStyle = '#FFFFFF';
      for (const [dx, dy, r] of [[0, 0, 1], [0.9, 0.15, 0.8], [-0.9, 0.2, 0.75], [0.4, -0.4, 0.75]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); g.fill(); }
    }
    const hill = (col, base, amp, ph) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, Hh);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x / W * Math.PI * 4 + ph)));
      g.lineTo(W, Hh); g.closePath(); g.fill();
    };
    hill('#86C48A', 200, 50, 0.3); hill('#7CC56B', 222, 40, 2.1); hill('#5FAE57', 246, 26, 4.0);
    // smiling pins
    for (let i = 0; i < 5; i++) {
      const x = 90 + i * 210, y = 236, s = 1.15;
      g.save(); g.translate(x, y); g.scale(s, s); g.rotate((i % 2 ? 1 : -1) * 0.12);
      g.fillStyle = '#FFFFFF'; g.strokeStyle = '#2B3170'; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, -92); g.bezierCurveTo(16, -92, 18, -70, 11, -58); g.bezierCurveTo(8, -50, 26, -34, 26, -10);
      g.bezierCurveTo(26, 6, 20, 14, 14, 18); g.lineTo(-14, 18); g.bezierCurveTo(-20, 14, -26, 6, -26, -10);
      g.bezierCurveTo(-26, -34, -8, -50, -11, -58); g.bezierCurveTo(-18, -70, -16, -92, 0, -92); g.closePath();
      g.fill(); g.stroke();
      g.fillStyle = '#E8343A'; g.fillRect(-9, -60, 18, 4); g.fillRect(-9, -53, 18, 4);
      g.fillStyle = '#2B3170';
      g.beginPath(); g.ellipse(-6, -77, 2.2, 3, 0, 0, Math.PI * 2); g.ellipse(6, -77, 2.2, 3, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.lineWidth = 2; g.arc(0, -73, 5, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
      g.restore();
    }
    const cols = ['#FF5A5F', '#FFC93C', '#22C3B5', '#FF6FAE', '#8E7BFF'];
    for (let i = 0; i < 70; i++) {
      g.fillStyle = cols[i % cols.length];
      g.save(); g.translate(rng.range(0, W), rng.range(0, 150)); g.rotate(rng.range(0, 3));
      if (i % 3) g.fillRect(-4, -2, 8, 4); else { g.beginPath(); g.arc(0, 0, 3.4, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    return c;
  }

  /** Aim arrow: bright chevrons fading out along the lane. */
  function arrowCanvas() {
    const c = makeCanvas(64, 512), g = c.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const y = 470 - i * 54, a = 1 - i / 10;
      g.fillStyle = 'rgba(255,214,70,' + a.toFixed(2) + ')';
      g.beginPath(); g.moveTo(32, y - 30); g.lineTo(60, y); g.lineTo(47, y + 6); g.lineTo(32, y - 10); g.lineTo(17, y + 6); g.lineTo(4, y); g.closePath(); g.fill();
    }
    return c;
  }

  /** A marbled bowling-ball skin in the player's colour, with finger holes. */
  function ballCanvas(hex, seed) {
    const c = makeCanvas(256, 128), g = c.getContext('2d');
    const base = '#' + ('000000' + hex.toString(16)).slice(-6);
    g.fillStyle = base; g.fillRect(0, 0, 256, 128);
    const rng = SS.util.rng(seed);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = i % 3 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)';
      g.lineWidth = rng.range(3, 9);
      g.beginPath();
      const y = rng.range(10, 118);
      g.moveTo(-10, y);
      g.bezierCurveTo(70, y + rng.range(-40, 40), 160, y + rng.range(-40, 40), 266, y + rng.range(-20, 20));
      g.stroke();
    }
    g.fillStyle = '#141826';
    for (const [x, y, r] of [[64, 50, 6.5], [57, 74, 5.2], [71, 74, 5.2]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (const [x, y, r] of [[64, 50, 6.5], [57, 74, 5.2], [71, 74, 5.2]]) { g.beginPath(); g.arc(x - 1.2, y - 1.6, r * 0.5, 0, Math.PI * 2); g.fill(); }
    return c;
  }

  /** Real-ish pin profile (radius, height) with two red neck stripes painted by vertex colour. */
  function pinGeometry(THREE, world, segs) {
    const prof = [[0, 0], [0.0258, 0], [0.031, 0.006], [0.0359, 0.019], [0.0496, 0.0381], [0.0573, 0.0572], [0.0601, 0.0857],
      [0.0605, 0.114], [0.0590, 0.135], [0.0568, 0.149], [0.0498, 0.184], [0.0385, 0.219], [0.0335, 0.2315], [0.0333, 0.2325],
      [0.0297, 0.2425], [0.0295, 0.2435], [0.0268, 0.2495], [0.0266, 0.2505], [0.0244, 0.2605], [0.0243, 0.2615], [0.0235, 0.276],
      [0.0267, 0.298], [0.0318, 0.321], [0.0324, 0.343], [0.028, 0.365], [0.018, 0.377], [0.008, 0.3805], [0, 0.381]];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), segs);
    const red = new THREE.Color(0xE8343A), white = new THREE.Color(0xFFFFFF);
    world.paint(g, (x, y, z, out) => out.copy((y > 0.232 && y < 0.243) || (y > 0.250 && y < 0.261) ? red : white));
    return g;
  }

  /** The static alley, merged into a handful of meshes (one per material). Returns { roomHalf }. */
  function buildAlley(ctx, L, laneXs, opts) {
    const { THREE, world, scene } = ctx;
    const paint = world.paint;
    const rng = SS.util.rng(4242);
    const solid = [], glow = [], wood = [], carpet = [], decal = [], logos = [], maskParts = [];
    const box = (w, h, d, x, y, z, col, list = solid) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(paint(g, col)); return g; };
    const roomHalf = opts.roomHalf;
    const backZ = Math.min(L.pitBack, HEAD_Z - 3 * ROW_DZ - 0.95) - 0.6;
    const zFront = 10.5;
    const MY = L.ceilY;

    /** Horizontal strip between xl(z) and xr(z) at height y (normal up), uv in metres. */
    function strip(xl, xr, y, z0, z1, segs, list, uvScale, uvOff) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= segs; i++) {
        const z = z0 + (z1 - z0) * i / segs;
        const a = xl(z), b = xr(z);
        pos.push(a, y, z, b, y, z);
        if (uvScale) uv.push((a - uvOff) * uvScale[0] + 0.5, z * uvScale[1], (b - uvOff) * uvScale[0] + 0.5, z * uvScale[1]);
        if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (uvScale) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      list.push(g);
      return g;
    }

    /** Vertical face along x(z) from y0 to y1, facing `side` (+1 → +x). */
    function wallStrip(xf, y0, y1, z0, z1, segs, side, col) {
      const pos = [], idx = [];
      for (let i = 0; i <= segs; i++) {
        const z = z0 + (z1 - z0) * i / segs, x = xf(z);
        pos.push(x, y0, z, x, y1, z);
        if (i < segs) {
          const k = i * 2;
          if ((side > 0) === (z1 < z0)) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      solid.push(paint(g, col));
    }

    /** Half-pipe gutter following the lane edge. */
    function gutter(halfAt, cx, side, z0, z1, segs) {
      const K = 8, rx = GUTTER_W / 2, depth = 0.058;
      const pos = [], idx = [];
      for (let i = 0; i <= segs; i++) {
        const z = z0 + (z1 - z0) * i / segs, c = cx + side * (halfAt(z) + rx);
        for (let k = 0; k <= K; k++) { const a = Math.PI * k / K; pos.push(c - rx * Math.cos(a), -depth * Math.sin(a) - 0.002, z); }
        if (i < segs) for (let k = 0; k < K; k++) {
          const p = i * (K + 1) + k, q = p + K + 1;
          idx.push(p, p + 1, q, p + 1, q + 1, q);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      solid.push(paint(g, 0xB9C3D3));
    }

    const disc = (r, x, z, col, y = 0.0018) => { const g = new THREE.CircleGeometry(r, 14); g.rotateX(-Math.PI / 2); g.translate(x, y, z); decal.push(paint(g, col)); };

    // ---- lanes (centre lane follows the layout; neighbours are standard) ------------------------
    laneXs.forEach((cx, li) => {
      const main = li === opts.mainIndex;
      const halfAt = main ? L.halfAt : () => LANE_HALF;
      const pitZ = main ? L.pitZ : HEAD_Z - 3 * ROW_DZ - 0.076;
      const pitBack = main ? L.pitBack : pitZ - 0.86;
      const wide = main && L.wide;
      const segs = wide ? 48 : 1;
      const wallAt = z => halfAt(Math.max(z, pitZ)) + GUTTER_W;
      // lane + deck (wood), approach (wood)
      strip(z => cx - halfAt(z), z => cx + halfAt(z), 0, 0, pitZ, segs, wood, [1 / 1.054, 0.22], cx);
      strip(() => cx - 0.938, () => cx + 0.938, 0, zFront - 5.7, 0, 1, wood, [1 / 1.054, 0.22], cx);
      // gutters + their outer lips
      for (const side of [-1, 1]) {
        gutter(halfAt, cx, side, 0, pitZ, segs);
        wallStrip(z => cx + side * halfAt(z), -0.06, 0, 0, pitZ, segs, side, 0x9AA6B8);
      }
      // kickbacks (side boards beside the pin deck)
      const kz0 = HEAD_Z + 0.75, kcol = KICK_COLORS[(li + 1) % KICK_COLORS.length];
      for (const side of [-1, 1]) {
        const x = cx + side * (wallAt(kz0 - 1) + 0.03);
        box(0.06, MY - PIT_Y, kz0 - pitBack, x, (MY + PIT_Y) / 2, (kz0 + pitBack) / 2, kcol);
      }
      // pit: floor, deck edge, cushion & curtain with folds
      const pw = wallAt(pitZ - 0.1) * 2;
      box(pw, 0.04, pitZ - pitBack, cx, PIT_Y - 0.02, (pitZ + pitBack) / 2, 0x151724);
      box(pw, -PIT_Y, 0.03, cx, PIT_Y / 2, pitZ - 0.015, 0x3A2A1C);
      const cur = new THREE.PlaneGeometry(pw, MY - PIT_Y, 24, 1);
      const cp = cur.attributes.position;
      for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 26) * 0.025);
      cur.computeVertexNormals();
      cur.translate(cx, (MY + PIT_Y) / 2, pitBack - 0.02);
      solid.push(paint(cur, (x, y, z, out) => out.setHex(0x1F2350).offsetHSL(0, 0, Math.sin((x - cx) * 26) * 0.035)));
      // capping to the right of this lane (to the next lane's gutter, which may flare), plus the far-left edge
      const nextX = laneXs[li + 1];
      const nextMain = li + 1 === opts.mainIndex;
      const capR = nextX == null ? () => cx + 0.938 + 0.2 : nextMain ? z => nextX - L.wallAt(z) : () => nextX - 0.762;
      const capSegs = nextMain && L.wide ? 48 : segs;
      paint(strip(z => cx + wallAt(z), capR, 0.035, 0, L.maskZ, capSegs, solid), 0x2E56A6);
      wallStrip(z => cx + wallAt(z), -0.06, 0.035, 0, L.maskZ, segs, -1, 0x24478C);
      if (nextX != null) wallStrip(capR, -0.06, 0.035, 0, L.maskZ, capSegs, 1, 0x24478C);
      if (li === 0) {
        paint(strip(() => cx - 0.938 - 0.2, z => cx - wallAt(z), 0.035, 0, L.maskZ, segs, solid), 0x2E56A6);
        wallStrip(z => cx - wallAt(z), -0.06, 0.035, 0, L.maskZ, segs, 1, 0x24478C);
      }
      // markings: foul line, dots, arrows, pin spots
      decal.push(paint(new THREE.PlaneGeometry(1.054, 0.022).rotateX(-Math.PI / 2).translate(cx, 0.0018, 0), 0x1C2340));
      for (const b of [3, 5, 8, 11, 14]) {
        for (const s of [-1, 1]) {
          const x = cx + s * (19.5 - b + 0.5) * BOARD;
          disc(0.011, x, -2.13, 0x3A2A1C);
          for (const z of [0.6, 3.66]) disc(0.013, x, z, 0x3A2A1C);
        }
      }
      for (let i = 0; i < 7; i++) {
        const b = 5 + i * 5, x = cx + (b - 20) * BOARD, z = -(4.88 - Math.abs(i - 3) * 0.3);
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([x, 0.0018, z - 0.17, x - 0.022, 0.0018, z + 0.07, x + 0.022, 0.0018, z + 0.07], 3));
        tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        decal.push(paint(tri, 0xE8343A));
      }
      const spots = main ? rackSpots(L.rows) : SPOTS10;
      for (const s of spots) disc(0.028, cx + s.x, s.z, 0xB98A57, 0.0012);
      logos.push(cx);
    });

    // ---- masking unit, walls, ceiling, light strips -----------------------------------------
    box(roomHalf * 2, 1.4, L.maskZ - backZ, 0, MY + 0.7, (L.maskZ + backZ) / 2, 0x272C66, maskParts);
    box(roomHalf * 2, 0.06, 0.08, 0, MY + 0.02, L.maskZ + 0.02, 0xFFC93C, maskParts);
    box(roomHalf * 2, 0.06, 0.08, 0, MY + 1.38, L.maskZ + 0.02, 0xFFC93C, maskParts);
    box(roomHalf * 2, CEIL_Y - MY - 1.4, 0.1, 0, (CEIL_Y + MY + 1.4) / 2, L.maskZ - 0.3, 0x2F3478, maskParts);
    box(roomHalf * 2, 0.08, zFront - backZ, 0, CEIL_Y + 0.04, (zFront + backZ) / 2, 0x262A57);
    box(roomHalf * 2, CEIL_Y, 0.1, 0, CEIL_Y / 2, zFront + 0.05, 0x3B3F86);
    for (let i = 0; i <= laneXs.length; i++) {
      const x = i === 0 ? laneXs[0] - LANE_PITCH / 2 : i === laneXs.length ? laneXs[i - 1] + LANE_PITCH / 2 : (laneXs[i - 1] + laneXs[i]) / 2;
      box(0.16, 0.05, zFront - 1 - (L.maskZ + 0.6), x, CEIL_Y - 0.03, (zFront - 1 + L.maskZ + 0.6) / 2, 0xFFF6DD, glow);
      box(0.3, 0.03, zFront - 1 - (L.maskZ + 0.6), x, CEIL_Y - 0.01, (zFront - 1 + L.maskZ + 0.6) / 2, 0x3A3F8E);
    }
    for (let i = 0; i < 16; i++) {      // party bulbs along the masking unit
      const x = -roomHalf + 0.4 + i * (roomHalf * 2 - 0.8) / 15;
      const g = new THREE.SphereGeometry(0.045, 8, 6); g.translate(x, MY + 1.52, L.maskZ + 0.04);
      maskParts.push(paint(g, KICK_COLORS[i % KICK_COLORS.length]));
    }
    // floors beside the outer lanes and the seating area
    const outerL = laneXs[0] - 0.938 - 0.2, outerR = laneXs[laneXs.length - 1] + 0.938 + 0.2;
    strip(() => -roomHalf, () => outerL, -0.005, zFront, L.maskZ, 1, carpet, [0.5, 0.5], 0);
    strip(() => outerR, () => roomHalf, -0.005, zFront, L.maskZ, 1, carpet, [0.5, 0.5], 0);
    strip(() => -roomHalf, () => roomHalf, -0.004, zFront, zFront - 5.7, 1, carpet, [0.5, 0.5], 0);
    // seating: a cushioned U-bench and a score console per lane, a bar ledge at the back
    laneXs.forEach((cx, li) => {
      const col = SEAT_COLORS[li % SEAT_COLORS.length];
      box(1.5, 0.42, 0.55, cx, 0.21, 7.2, col);
      box(1.5, 0.5, 0.14, cx, 0.55, 7.47, col);
      box(0.5, 0.42, 0.55, cx - 0.82, 0.21, 6.7, col);
      box(0.5, 0.42, 0.55, cx + 0.82, 0.21, 6.7, col);
      box(0.6, 0.7, 0.38, cx + 0.85, 0.35, 5.4, 0x2E56A6);
      box(0.62, 0.05, 0.42, cx + 0.85, 0.72, 5.4, 0xFFC93C);
    });
    box(roomHalf * 2, 0.34, 1.6, 0, 0.17, 9.7, 0x2F3478);
    box(roomHalf * 2, 0.55, 0.16, 0, 0.275, 8.55, 0x24478C);
    box(roomHalf * 2, 0.05, 0.28, 0, 0.575, 8.55, 0xFFC93C);
    // ball return hood + rack rails beside the bowler (one per lane pair)
    laneXs.forEach((cx, li) => {
      if (li % 2 === 1 && li !== opts.mainIndex) return;
      const hx = cx + (li === opts.mainIndex ? opts.hoodX : HOOD.x);
      const hood = new THREE.CylinderGeometry(0.21, 0.21, 0.8, 16, 1, false, -Math.PI / 2, Math.PI);
      hood.rotateX(-Math.PI / 2);
      hood.translate(hx, 0.24, HOOD.z);
      solid.push(paint(hood, 0xFF5A5F));
      box(0.42, 0.24, 0.8, hx, 0.12, HOOD.z, 0xE8484D);
      const mouth = new THREE.CircleGeometry(0.13, 16); mouth.translate(hx, 0.24, HOOD.z + 0.402);
      solid.push(paint(mouth, 0x1A1D33));
      for (const s of [-1, 1]) box(0.03, 0.03, RACK_SPOT.z - HOOD.z, hx + s * 0.07, RACK_SPOT.y - 0.12, (RACK_SPOT.z + HOOD.z) / 2 + 0.2, 0xC9D2E0);
      box(0.2, 0.12, 0.05, hx, RACK_SPOT.y - 0.08, RACK_SPOT.z + 0.15, 0xC9D2E0);
      box(0.14, RACK_SPOT.y - 0.14, 0.14, hx, (RACK_SPOT.y - 0.14) / 2, RACK_SPOT.z + 0.15, 0x24478C);
      box(0.12, RACK_SPOT.y - 0.14, 0.1, hx, (RACK_SPOT.y - 0.14) / 2, HOOD.z + 0.5, 0x24478C);
    });
    // overhead score monitors (screens are separate textured meshes)
    laneXs.forEach(cx => {
      box(MONITOR.w + 0.1, MONITOR.h + 0.1, 0.08, cx + MONITOR.x, MONITOR.y, MONITOR.z - 0.05, 0x1B1F3B);
      box(0.06, CEIL_Y - MONITOR.y - 0.4, 0.06, cx + MONITOR.x, (CEIL_Y + MONITOR.y + 0.4) / 2, MONITOR.z - 0.08, 0x9AA6B8);
    });

    // ---- meshes --------------------------------------------------------------------------------
    const add = (name, geo, material, o = {}) => {
      const m = new THREE.Mesh(geo, material);
      m.name = name;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      if (o.receive) m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    const woodTex = world.texture('wood_lane', { boards: 39 });
    add('lanes', world.mergeGeometries(wood), world.mat(0xFFFFFF, { kind: 'phong', map: woodTex, shininess: 70 }), { receive: true });
    add('alley', world.mergeGeometries(solid), world.mat(0xFFFFFF, { vertexColors: true }), { receive: true });
    const decalMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    add('markings', world.mergeGeometries(decal), decalMat);
    add('carpet', world.mergeGeometries(carpet), world.mat(0xFFFFFF, { map: world.texture('carpet') }));
    add('lights', world.mergeGeometries(glow), world.mat(0xFFFFFF, { kind: 'basic', vertexColors: true }));
    add('mask', world.mergeGeometries(maskParts), world.mat(0xFFFFFF, { vertexColors: true }));
    // masking logos (one shared canvas)
    const logoTex = canvasTexture(THREE, logoCanvas());
    add('logos', world.mergeGeometries(logos.map(cx => new THREE.PlaneGeometry(1.5, 0.75).translate(cx, MY + 0.69, L.maskZ + 0.012))),
      new THREE.MeshBasicMaterial({ map: logoTex }));
    // mural walls (sides and back)
    const muralTex = canvasTexture(THREE, muralCanvas(rng), true);
    const murals = [];
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(zFront - L.maskZ, CEIL_Y);
      g.rotateY(-s * Math.PI / 2); g.translate(s * roomHalf, CEIL_Y / 2, (zFront + L.maskZ) / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (zFront - L.maskZ) / 9);
      murals.push(g);
    }
    const back = new THREE.PlaneGeometry(roomHalf * 2, CEIL_Y);
    back.rotateY(Math.PI); back.translate(0, CEIL_Y / 2, zFront);
    const buv = back.attributes.uv; for (let i = 0; i < buv.count; i++) buv.setX(i, buv.getX(i) * roomHalf * 2 / 9);
    murals.push(back);
    add('mural', world.mergeGeometries(murals), new THREE.MeshLambertMaterial({ map: muralTex }));
    return { roomHalf };
  }

  // =============================================================================================
  // 8. HUD styles
  // =============================================================================================

  const HUD_CSS = `
.bw-card { position: absolute; top: calc(var(--sat) + 66px); left: 0; right: 0; margin: 0 auto;
  width: calc(100% - 20px - var(--sal) - var(--sar)); max-width: 560px; display: grid;
  grid-template-columns: repeat(9, 1fr) 1.45fr; background: #fff; border-radius: 12px; overflow: hidden;
  box-shadow: 0 4px 14px rgba(22, 40, 80, .22); font: 800 12px/1 var(--font-ui); color: var(--ink); }
.bw-card.ss-hidden { display: none; }
.bw-f { border-left: 1px solid #E3E8F0; min-width: 0; }
.bw-f:first-child { border-left: 0; }
.bw-f .n { background: var(--accent); color: #fff; font: 600 10px/1 var(--font-display); text-align: center; padding: 3px 0 2px; }
.bw-f .m { display: flex; justify-content: flex-end; height: 15px; }
.bw-f .m span { flex: 0 0 42%; max-width: 15px; text-align: center; line-height: 15px; border-left: 1px solid #EDF1F6;
  border-bottom: 1px solid #EDF1F6; font-weight: 900; }
.bw-f .m span.x, .bw-f .m span.s { color: var(--accent); }
.bw-f.ten .m span { flex-basis: 30%; }
.bw-f .t { text-align: center; height: 17px; line-height: 17px; font: 700 13px/17px var(--font-display); }
.bw-f.cur { background: var(--tint); }
.bw-f.cur .n { background: #FFC93C; color: #5A3A10; }
.bw-strip { position: absolute; top: calc(var(--sat) + 66px); left: 0; right: 0; margin: 0 auto; width: max-content;
  max-width: calc(100% - 20px); display: flex; gap: 4px; padding: 5px 6px; background: #fff; border-radius: 12px;
  box-shadow: 0 4px 14px rgba(22, 40, 80, .22); font: 800 11px/1 var(--font-ui); color: var(--ink); }
.bw-strip span { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #EEF2F7; color: #8592A6; flex: none; }
.bw-strip span.ok { background: #3BC45B; color: #fff; }
.bw-strip span.no { background: #FFD9DA; color: #D9363C; }
.bw-strip span.cur { background: #FFC93C; color: #5A3A10; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #FFC93C; }
.bw-strip span.big { width: auto; min-width: 24px; padding: 0 5px; border-radius: 12px; }
.bw-strip span.done { background: linear-gradient(to top, #3C6BE0 calc(var(--f) * 100%), #A9BDF2 0); color: #fff; }
.bw-strip span.todo { background: transparent; color: #A3ADBD; box-shadow: inset 0 0 0 1.5px #E3E8F0; font-weight: 700; }
.bw-chip-name { gap: 6px; padding: 3px 12px 3px 3px; }
.bw-chip-name .ss-portrait { width: 30px; height: 30px; }
.bw-chip-name span { max-width: clamp(48px, 50vw - 102px, 140px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-total { font: 700 18px/1 var(--font-display); padding: 6px 12px; min-width: 44px; justify-content: center; }
.bw-side { position: absolute; top: calc(var(--sat) + 124px); display: flex; flex-direction: column; gap: 6px; }
.bw-side.l { left: calc(var(--sal) + 10px); align-items: flex-start; }
.bw-side.r { right: calc(var(--sar) + 10px); align-items: flex-end; }
.bw-pins { position: relative; width: 66px; height: 58px; background: rgba(20, 32, 56, .62); border-radius: 12px; }
.bw-pins i { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%;
  background: rgba(255, 255, 255, .18); transition: background .25s, transform .25s; }
.bw-pins i.up { background: #fff; box-shadow: inset 0 -3px 0 #E8343A; }
.bw-pins i.hit { transform: scale(.6); }
.bw-pins.big { transform: scale(1.45); transform-origin: 0 0; }
.bw-mini { display: flex; align-items: center; gap: 5px; padding: 2px 9px 2px 2px; font-size: 12px; opacity: .78; }
.bw-mini .ss-portrait { width: 22px; height: 22px; }
.bw-mini.cur { opacity: 1; box-shadow: 0 0 0 2px #FFC93C, var(--shadow-soft); }
.bw-mini b { font: 700 14px/1 var(--font-display); }
.bw-mini em { font: 900 12px/1 var(--font-ui); font-style: normal; color: var(--accent); margin-left: -2px; }
.bw-mini em:empty { display: none; }
.bw-mini span { max-width: 22vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-aim { position: absolute; bottom: calc(var(--sab) + 22px); display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: opacity .2s, transform .2s; }
.bw-aim.l { left: calc(var(--sal) + 14px); }
.bw-aim.r { right: calc(var(--sar) + 14px); }
.bw-aim .ss-btn.round { width: 58px; height: 58px; touch-action: none; }   /* a stroke that starts here may bowl */
.bw-aim .ss-btn.round .ss-icon { width: 28px; height: 28px; }
.bw-aim small { font: 900 10px/1 var(--font-ui); letter-spacing: .1em; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.5); }
.bw-off { opacity: 0; pointer-events: none !important; transform: translateY(12px); }
.bw-swipe { position: absolute; bottom: calc(var(--sab) + 40px); left: 50%; transform: translateX(-50%);
  font: 900 13px/1 var(--font-ui); letter-spacing: .06em; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.55);
  white-space: nowrap; transition: opacity .25s; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bw-swipe svg { width: 22px; height: 22px; animation: bw-bob 1.2s ease-in-out infinite; }
.bw-swipe.bw-flash span { animation: bw-flash .45s ease-in-out 3; }
@keyframes bw-flash { 0%, 100% { color: #fff; transform: scale(1); } 50% { color: #FFC93C; transform: scale(1.12); } }
@keyframes bw-bob { 0%, 100% { transform: translateY(4px); } 50% { transform: translateY(-4px); } }
.bw-speed { position: absolute; top: calc(var(--sat) + 126px); left: 50%; transform: translateX(-50%); transition: opacity .3s;
  white-space: nowrap; }
.bw-tip { position: absolute; bottom: calc(var(--sab) + 104px); left: 50%; transform: translateX(-50%); transition: opacity .3s;
  white-space: nowrap; font-size: 12px; gap: 5px; padding: 5px 12px 5px 8px; }
.bw-tip .ss-icon { width: 18px; height: 18px; color: #F2A900; }
.bw-turnwrap { position: absolute; left: 0; right: 0; top: 30%; display: flex; justify-content: center; transition: opacity .25s, transform .25s; }
.bw-turnwrap.out { opacity: 0; transform: translateY(-14px) scale(.95); }
.bw-turncard { display: flex; align-items: center; gap: 12px; max-width: calc(100% - 28px); padding: 10px 22px 10px 10px;
  background: #fff; border-radius: 44px; box-shadow: 0 10px 30px rgba(22, 40, 80, .3); }
.bw-turncard .ss-portrait { width: 64px; height: 64px; }
.bw-turncard > div { min-width: 0; }
.bw-turncard h3 { margin: 0; font: 700 clamp(20px, 6.4vw, 28px)/1.05 var(--font-display); color: var(--ink); white-space: nowrap; display: flex; }
.bw-turncard h3 .nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.bw-turncard p { margin: 4px 0 0; font: 800 13px/1 var(--font-ui); color: var(--ink-soft); }
.bw-info { font-size: 12px; padding: 5px 10px; }
.bw-target { position: absolute; left: 0; top: 0; width: 18px; height: 16px; margin: -16px 0 0 -9px; pointer-events: none;
  will-change: transform; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
.bw-target svg { display: block; width: 100%; height: 100%; }
.bw-target.pocket path { fill: #5BE07A; }
@media (max-height: 520px) and (orientation: landscape) {
  .bw-card, .bw-strip { top: calc(var(--sat) + 58px); max-width: 470px; width: calc(100% - 200px); }
  .bw-strip { width: max-content; }
  .bw-side { top: calc(var(--sat) + 74px); }
  .bw-side.l { left: calc(var(--sal) + 12px); top: calc(var(--sat) + 76px); }
  .bw-turnwrap { top: 36%; }
  .bw-speed { top: calc(var(--sat) + 112px); }
  .bw-aim { bottom: calc(var(--sab) + 14px); }
}
@media (max-width: 340px) { .bw-f .m span { font-size: 10px; } .bw-f .t { font-size: 11px; } }
@media (orientation: portrait) {
  /* the readouts sit between the Frame / pin column and the players column: wrap rather than run under them */
  .bw-speed { max-width: calc(100% - 2 * (var(--sal) + 108px)); white-space: normal; text-align: center; line-height: 1.25; font-size: 12.5px; }
}
@media (max-width: 380px) and (orientation: portrait) {
  .bw-mini span { display: none; }
  .bw-mini { padding-right: 8px; }
  .bw-speed { top: calc(var(--sat) + 176px); max-width: calc(100% - 2 * (var(--sal) + 82px)); }
}
`;

  // =============================================================================================
  // 9. The sport instance
  // =============================================================================================

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, engine, save, util: U } = ctx;
    const mode = ctx.mode;
    const L = makeLayout(mode);
    const players = ctx.players;
    const rng = ctx.rng;
    const hand = save.settings && save.settings.leftHanded ? -1 : 1;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    // ---- world ------------------------------------------------------------------------------
    const env = world.environment(scene, {
      sky: 'indoor', background: 0x1E2148, fog: true, fogNear: 34, fogFar: 80,
      shadow: { center: V(0, 0, HEAD_Z - (L.wide ? 1.6 : 0.6)), size: L.wide ? 7.5 : 4.2 },
    });
    env.sun.castShadow = true;
    env.hemi.intensity = 2.1;
    const outer = L.wide ? L.deckHalf + GUTTER_W + 0.176 + 0.762 : LANE_PITCH;
    const laneXs = [-(outer + LANE_PITCH), -outer, 0, outer, outer + LANE_PITCH];
    const hoodX = -HOOD.x * hand;
    const alley = buildAlley(ctx, L, laneXs, { mainIndex: 2, roomHalf: outer + LANE_PITCH + 0.938 + 1.1, hoodX });

    camera.near = 0.05;
    camera.far = 90;
    delete camera.userData.fit;

    // ---- pins (main rack + neighbours, instanced) ----------------------------------------------
    const W = new PinWorld(L);
    const rackRng = U.rng((ctx.seed || 0) + 313);     // pin-spotting jitter: every rack differs, deterministic per seed
    const maxSpots = rackSpots(L.rows);
    const pinGeo = pinGeometry(THREE, world, L.wide ? 12 : 16);
    const pinGeoLow = pinGeometry(THREE, world, 8);
    const pinMat = world.mat(0xFFFFFF, { kind: 'phong', vertexColors: true, shininess: 70 });
    const pinMesh = new THREE.InstancedMesh(pinGeo, pinMat, maxSpots.length);
    pinMesh.castShadow = true;
    pinMesh.frustumCulled = false;
    scene.add(pinMesh);
    const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
    const PIN_BASE = new THREE.Matrix4().makeTranslation(0, -PIN_YC, 0);
    let liftY = 0;                       // render offset of pins held by the setting table

    function syncPins() {
      pinMesh.count = W.pins.length;          // only the current rack is drawn (and shadowed)
      for (let i = 0; i < W.pins.length; i++) {
        const b = W.pins[i];
        if (!b.active) { pinMesh.setMatrixAt(i, ZERO_M); continue; }
        _p.set(b.x, b.y + (b.lifted ? liftY : 0), b.z);
        _q.set(b.qx, b.qy, b.qz, b.qw);
        _m.compose(_p, _q, _one).multiply(PIN_BASE);
        pinMesh.setMatrixAt(i, _m);
      }
      pinMesh.instanceMatrix.needsUpdate = true;
    }

    // ---- balls --------------------------------------------------------------------------------
    const ballGeo = new THREE.SphereGeometry(BALL_R, 28, 18);
    const ballCols = players.map(p => (pals.OPTIONS.shirts[p.profile.shirt] != null ? pals.OPTIONS.shirts[p.profile.shirt] : 0x3C6BE0));
    const ballMats = ballCols.map((col, i) => new THREE.MeshPhongMaterial({ map: canvasTexture(THREE, ballCanvas(col, 31 + i)), shininess: 95, specular: 0x777777 }));
    const ball = new THREE.Mesh(ballGeo, ballMats[0]);
    ball.castShadow = true;
    scene.add(ball);
    const ballShadow = world.blobShadow(0.17, 0.42);
    scene.add(ballShadow);
    const trail = world.trail(ball, { color: 0xFFE27A, width: 0.075, length: 40, opacity: 0.6, maxJump: 1.5 });
    trail.visible = false;
    const ballVis = { mode: 'rack', blend: 0, from: V(0, 0, 0) };   // 'rack' | 'carry' | 'hand' | 'free' | 'hidden'
    ball.position.set(hoodX, RACK_SPOT.y, RACK_SPOT.z);

    // ---- pinsetter: sweep bar + setting table ------------------------------------------------
    const deckW = L.wallAt(HEAD_Z - 0.3) * 2;
    const sweepBar = new THREE.Mesh(new THREE.BoxGeometry(deckW + 0.04, 0.17, 0.05), world.mat(0xE9EDF4, { kind: 'phong' }));
    const sweepStripe = new THREE.Mesh(new THREE.BoxGeometry(deckW + 0.05, 0.05, 0.055), world.mat(0xFF5A5F));
    sweepStripe.position.y = 0.02;
    sweepBar.add(sweepStripe);
    const tableDepth = (L.rows - 1) * ROW_DZ + 0.42;
    const table = new THREE.Mesh(new THREE.BoxGeometry(L.deckHalf * 2 + 0.12, 0.07, tableDepth), world.mat(0x3D4366, { kind: 'phong' }));
    const BAR_UP = L.ceilY + 0.32, TABLE_UP = L.ceilY + 0.42, BAR_FRONT = HEAD_Z + 0.32;
    sweepBar.position.set(0, BAR_UP, BAR_FRONT);
    table.position.set(0, TABLE_UP, HEAD_Z - tableDepth / 2 + 0.2);
    scene.add(sweepBar, table);

    // ---- aim arrow + release marker -------------------------------------------------------------
    const arrowTex = canvasTexture(THREE, arrowCanvas());
    const arrowGeo = new THREE.PlaneGeometry(0.16, 5.2);
    arrowGeo.rotateX(-Math.PI / 2);
    arrowGeo.translate(0, 0, -2.6);
    const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, depthWrite: false, opacity: 0 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.renderOrder = 3;
    const markGeo = new THREE.RingGeometry(0.05, 0.075, 24);
    markGeo.rotateX(-Math.PI / 2);
    const marker = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0xFFD646, transparent: true, depthWrite: false, opacity: 0 }));
    marker.renderOrder = 3;
    scene.add(arrow, marker);
    // the guide: dots carrying the aim on to the pins along the path a ball bowled like this bowler's last
    // one would take (so a hook shows its curve), with a ring where it meets the front pins. The ghost:
    // fainter dots where the last ball really went.
    const dotGeo = new THREE.CircleGeometry(1, 10);
    dotGeo.rotateX(-Math.PI / 2);
    const mkDots = (n, color) => {
      const m = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, opacity: 0 }), n);
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.count = 0;
      m.visible = false;
      scene.add(m);
      return m;
    };
    const guide = mkDots(GUIDE_MAX, 0xFFD646);
    const guideMat = guide.material;
    const ghost = mkDots(GHOST_MAX, 0xFFFFFF);
    const ringGeo = new THREE.RingGeometry(0.075, 0.1, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const guideRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xFFD646, transparent: true, depthWrite: false, opacity: 0 }));
    guideRing.renderOrder = 3;
    scene.add(guideRing);
    const PATH_COLOR = new THREE.Color(0xFFFFFF), POCKET_COLOR = new THREE.Color(0x4CE06E);

    // ---- overhead monitors ----------------------------------------------------------------------
    const monCanvas = makeCanvas(512, 288);
    const monTex = canvasTexture(THREE, monCanvas);
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(MONITOR.w, MONITOR.h), new THREE.MeshBasicMaterial({ map: monTex }));
    monitor.position.set(MONITOR.x, MONITOR.y, MONITOR.z - 0.004);
    scene.add(monitor);
    const ambRng = U.rng((ctx.seed || 0) + 991);      // ambience never disturbs the game's own rng stream
    const sideCanvas = neighbourScreen(ambRng);
    const sideScreens = new THREE.Mesh(
      world.mergeGeometries(laneXs.filter((x, i) => i !== 2).map(x => new THREE.PlaneGeometry(MONITOR.w, MONITOR.h).translate(x + MONITOR.x, MONITOR.y, MONITOR.z - 0.004))),
      new THREE.MeshBasicMaterial({ map: canvasTexture(THREE, sideCanvas) }));
    scene.add(sideScreens);

    // ---- people: bowlers, spectators, neighbours -------------------------------------------
    const bowlers = players.map(p => {
      const pal = pals.create(p.profile, { shadows: false });
      pal.setFacing(Math.PI);
      pal.root.visible = false;
      const shadow = world.blobShadow(0.36, 0.3);
      scene.add(pal.root, shadow);
      return { pal, shadow };
    });
    const roomHalf = alley.roomHalf;
    const crowd = world.crowd(scene, {
      rows: [{ x: 0, y: 0.34, z: 9.45, length: roomHalf * 2 - 1.2, facing: Math.PI }, { x: 0, y: 0, z: 8.05, length: roomHalf * 2 - 2.4, facing: Math.PI }],
      spacing: 0.72, density: 0.72, seed: ctx.seed,
    });
    const ambient = buildNeighbours();

    // ---- audio --------------------------------------------------------------------------------
    let ambience = null, rollLoop = null;

    // ---- state ----------------------------------------------------------------------------------
    const stats = players.map(() => ({
      strikes: 0, spares: 0, gutters: 0, splits: 0, pickups: 0, first: 0, firstN: 0, streak: 0, bestStreak: 0,
      topSpeed: 0, conversions: 0, sparePts: 0, pins: 0, clears: 0,
    }));
    const rolls = players.map(() => []);
    const leaveLog = players.map(() => []);      // spare mode: true/false per leave
    const powerLog = players.map(() => []);      // power mode: pins per round
    // everyone starts on a forgiving straight line a little right of centre, angled into the pocket:
    // a fair first ball (mostly 7–9 pins); hooking it in is the next thing to learn
    const AIM0 = { x: 0.12 * hand, angle: aimAngle(L, 0.12 * hand, 8, 0, 0.05 * hand, HEAD_Z) };
    const aims = players.map(() => ({ x: AIM0.x, angle: AIM0.angle }));
    let phase = 'intro';
    let turn = null;                               // { p, frame | leave | round, ball, fresh }
    let autoplay = false;
    let skipWaiter = null;
    let shotWaiter = null;
    let standingBefore = [];
    let splitLeft = false;
    let lastShot = null, lastOutcome = null, lateChanged = false;
    const pull = { t: 0, x: 0, angle: 0 };          // the arrow's "you pulled it" flash after a release
    let hintHandle = null, firstThrowDone = false, curveHinted = false, throwsDone = 0, tipPending = null;
    const tipsShown = new Set();
    let hurry = false;                             // the player tapped through: the pinsetter speeds up
    let turnDir = 0, turnHeld = 0;
    let throwAnim = null;
    let rollInfo = null;                           // per-ball bookkeeping while the ball runs
    let returnFor = 0;                             // whose ball comes back up the return
    let arrowGlow = 0;
    let aimPeek = 0, aimInfoT = 0;                 // zoomed peek at the pins while turning; aim readout timer
    let leavePeek = false;                         // open the next aim view with a peek at the leave
    let started = false;

    // ---- HUD ------------------------------------------------------------------------------------
    ui.css('bowling-hud', HUD_CSS);
    const hud = buildHud();

    // ---- camera ---------------------------------------------------------------------------------
    const cam = { shot: 'setup', pos: V(0, 2.2, AIM_Z + 3.4), look: V(0, 0, -10), fov: 55, lambda: 4, followX: 0 };

    function fovFor(vFov, minH) {
      const a = engine.size.aspect;
      let v = vFov * DEG;
      if (2 * Math.atan(Math.tan(v / 2) * a) < minH * DEG) v = 2 * Math.atan(Math.tan(minH * DEG / 2) / a);
      return v / DEG;
    }

    const _gp = V(0, 0, 0), _gl = V(0, 0, 0);
    function cameraGoal() {
      const portrait = engine.size.aspect < 0.85;
      const pal = turn ? bowlers[turn.p].pal : null;
      let fov;
      if (cam.shot === 'setup') {
        // high and to the ball side of the bowler, so the arrow and the whole lane read past their head
        const x = turn ? aims[turn.p].x : 0;
        if (portrait) { _gp.set(x + 0.4 * hand, 2.7, AIM_Z + 2.6); _gl.set(x * 0.3 + 0.08 * hand, 0, -9); fov = fovFor(46, 31); }
        else {
          // over the bowling shoulder, low and close: the bowler from the waist up with the ball, the release
          // ring and the arrow in frame below the lane (very wide screens get a slightly tighter frame)
          _gp.set(x + 0.8 * hand, 1.62, AIM_Z + 2.1); _gl.set(x * 0.4 + 0.1 * hand, 0.1, -9);
          fov = fovFor(42 * 2 / Math.max(2, engine.size.aspect), 30);
        }
        if (aimPeek > 0 && turn) {
          // peek: same spot, zoomed in on the pins and the target
          const t = aimTarget();
          _gl.set(t.x * 0.6, portrait ? 0.16 : 0.3, t.z - 0.35);
          fov = portrait ? fovFor(5.5, 4.4) : fovFor(4.2, 5);
        }
      } else if (cam.shot === 'follow') {
        const b = W.ball;
        const z = Math.max(b.z, HEAD_Z + 4.2);
        // stay high while passing over the bowler, then drop in low behind the ball. Sideways it barely
        // follows, and stops following past mid-lane, so the hook reads as a curve on screen.
        if (b.z > -8) cam.followX = b.x;
        const fx = cam.followX;
        const over = U.smoothstep(-3.2, 0.9, z + 2.5);
        _gp.set(fx * 0.25 + 0.35 * hand * over, 0.78 + 1.55 * over, z + 2.5);
        _gl.set(fx * 0.3 + (b.x - fx) * 0.25, portrait ? -0.12 : 0.05, Math.max(z - 6.5, HEAD_Z - 0.5));
        fov = fovFor(46, 36);
      } else if (cam.shot === 'pins') {
        if (L.wide) {
          // frame the current rack: low and close for 4 rows, higher and further back for 13
          const rows = turn ? powerRows(turn.round) : 4, k = (rows - 4) / 9;
          // (portrait stays low and lets the outer pins fly out of frame rather than shrink the rack)
          if (portrait) { _gp.set(0, 0.95 + 0.1 * k, HEAD_Z + 1.9 + 0.5 * k); _gl.set(0, 0, HEAD_Z - 0.8 - 0.6 * k); fov = fovFor(40, 34 + 10 * k); }
          else { _gp.set(0, 0.9 + 0.7 * k, HEAD_Z + 1.8 + 0.8 * k); _gl.set(0, 0, HEAD_Z - 1.0 - 1.6 * k); fov = fovFor(40, 44 + 20 * k); }
        }
        else if (portrait) { _gp.set(hand * 0.22, 1.1, HEAD_Z + 2.95); _gl.set(0, 0.08, HEAD_Z - 0.5); fov = fovFor(40, 31); }
        else { _gp.set(hand * 0.32, 1.05, HEAD_Z + 2.6); _gl.set(0, 0.12, HEAD_Z - 0.45); fov = fovFor(31, 40); }
      } else if (cam.shot === 'react' && pal) {
        const r = pal.root.position;
        // from down the lane, looking back at the bowler with the cheering seating area behind
        if (portrait) { _gp.set(r.x - 0.25 * hand, 1.2, r.z - 2.9); _gl.set(r.x, 0.86, r.z); fov = fovFor(40, 40); }
        else { _gp.set(r.x - 0.35 * hand, 1.3, r.z - 2.6); _gl.set(r.x - 0.12 * hand, 1.2, r.z); fov = fovFor(42, 30); }
      } else { _gp.copy(cam.pos); _gl.copy(cam.look); fov = cam.fov; }
      return fov;
    }

    function setShot(name, lambda, snap) {
      cam.shot = name;
      cam.lambda = lambda;
      if (snap) { cam.fov = cameraGoal(); cam.pos.copy(_gp); cam.look.copy(_gl); }
    }

    function updateCamera(dt) {
      const fov = cameraGoal();
      const lam = cam.shot === 'setup' && (aimPeek > 0 || cam.fov < 20) ? 7 : cam.lambda;   // a snappy peek
      U.dampVec3(cam.pos, _gp, lam, dt);
      U.dampVec3(cam.look, _gl, lam * 1.3, dt);
      cam.fov = U.damp(cam.fov, fov, lam, dt);
      camera.position.copy(cam.pos);
      camera.lookAt(cam.look);
      if (Math.abs(camera.fov - cam.fov) > 1e-3 || camera.aspect !== engine.size.aspect) {
        camera.fov = cam.fov;
        camera.aspect = engine.size.aspect;
        camera.updateProjectionMatrix();
      }
    }

    // =============================================================================================
    // HUD
    // =============================================================================================

    function buildHud() {
      const root = ctx.hud;
      const top = ui.el('div', 'ss-hud-top');
      const nameChip = ui.el('div', 'ss-chip bw-chip-name ss-pop');
      const infoChip = ui.el('div', 'ss-chip dark bw-info');
      const totalChip = ui.el('div', 'ss-chip bw-total ss-pop');
      top.append(nameChip, totalChip);
      const card = ui.el('div', 'bw-card');
      const frames = [];
      for (let f = 0; f < 10; f++) {
        const cell = ui.el('div', 'bw-f' + (f === 9 ? ' ten' : ''));
        cell.innerHTML = '<div class="n">' + (f + 1) + '</div><div class="m"></div><div class="t"></div>';
        card.appendChild(cell);
        frames.push({ cell, m: cell.children[1], t: cell.children[2] });
      }
      const strip = ui.el('div', 'bw-strip ss-hidden');
      const sideL = ui.el('div', 'bw-side l');
      const sideR = ui.el('div', 'bw-side r');
      const pinBox = ui.el('div', 'bw-pins');
      const pinDots = SPOTS10.map(s => {
        const d = ui.el('i');
        d.style.left = (33 + s.x / PIN_DX * 13) + 'px';
        d.style.top = (50 - (s.z - HEAD_Z) / -ROW_DZ * 13.5) + 'px';
        pinBox.appendChild(d);
        return d;
      });
      sideL.append(infoChip, pinBox);
      if (L.wide) pinBox.classList.add('ss-hidden');
      const minis = players.length > 1 ? players.map(p => {
        const chip = ui.el('div', 'ss-chip bw-mini');
        chip.append(ui.portraitImg(p.profile, 22));
        const nm = ui.el('span', '', ui.esc(p.profile.name));
        const sc = ui.el('b', '', '0');
        const pend = ui.el('em');
        chip.append(nm, sc, pend);
        sideR.appendChild(chip);
        return { chip, sc, pend };
      }) : [];
      // aim buttons
      // A press on an aim button turns the aim; if it turns into a stroke up the screen instead (a thumb
      // that started its bowl swipe on the button), the turn is undone and the stroke bowls.
      let btn = null;
      const local = e => {
        const r = engine.renderer.domElement.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp || performance.now() };
      };
      const mkAim = (side, icon, dir) => {
        const wrap = ui.el('div', 'bw-aim ' + side + ' bw-off');
        const b = ui.button(dir < 0 ? 'Aim left' : 'Aim right', null, { kind: 'round', icon, className: 'light ss-block', sfx: null });
        const start = e => {
          if (phase !== 'aim' || autoplay || btn) return;
          e.preventDefault();
          try { b.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
          btn = { id: e.pointerId, angle0: aims[turn.p].angle, path: [local(e)], stroke: false };
          turnDir = dir; turnHeld = 0; nudgeAim(dir * AIM_TAP); ui.sfx('ui_tick');
        };
        const move = e => {
          if (!btn || e.pointerId !== btn.id || phase !== 'aim') return;
          btn.path.push(local(e));
          const p0 = btn.path[0], q = btn.path[btn.path.length - 1];
          const dx = q.x - p0.x, dy = q.y - p0.y, short = Math.min(engine.size.w, engine.size.h);
          if (!btn.stroke && Math.hypot(dx, dy) > 24 && -dy > Math.abs(dx)) {
            btn.stroke = true;
            turnDir = 0;
            aims[turn.p].angle = btn.angle0;
            aimPeek = 0;
            hud.aimInfo.classList.add('bw-off');
          }
          if (btn.stroke) poseWindup(bowlers[turn.p].pal, U.clamp(-dy / short / 0.25, 0, 1), 26);
        };
        const stop = e => {
          turnDir = 0;
          const bp = btn;
          if (!bp || e.pointerId !== bp.id) return;
          btn = null;
          if (!bp.stroke || phase !== 'aim') return;
          if (e.type === 'pointerup') { bp.path.push(local(e)); bowlStroke(strokeFromPath(bp.path, Math.min(engine.size.w, engine.size.h))); }
          if (phase === 'aim') poseHold(bowlers[turn.p].pal, false);
        };
        b.addEventListener('pointerdown', start);
        b.addEventListener('pointermove', move);
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointerleave', stop);
        b.addEventListener('pointercancel', stop);
        wrap.append(b, ui.el('small', '', 'AIM'));
        root.appendChild(wrap);
        return wrap;
      };
      const aimL = mkAim('l', 'rotate-left', -1);
      const aimR = mkAim('r', 'rotate-right', 1);
      const swipe = ui.el('div', 'bw-swipe bw-off', ui.icon('up') + '<span>SWIPE UP TO BOWL</span>');
      const speed = ui.el('div', 'ss-chip dark bw-speed bw-off');
      const tip = ui.el('div', 'ss-chip bw-tip bw-off');
      const aimInfo = ui.el('div', 'ss-chip dark bw-speed bw-off');
      const target = ui.el('div', 'bw-target', '<svg viewBox="0 0 20 18"><path d="M2 2h16L10 16Z" fill="#FFD646" stroke="#3A2A10" stroke-width="2.2" stroke-linejoin="round"/></svg>');
      target.style.opacity = '0';
      root.append(target, top, card, strip, sideL, sideR, swipe, speed, tip, aimInfo);
      return { top, nameChip, infoChip, totalChip, card, frames, strip, pinBox, pinDots, minis, aimL, aimR, swipe, speed, tip, aimInfo, target, nameFor: -1 };
    }

    /** Briefly shows the "swipe up" label (a stroke that was not a bowl). */
    let flashUntil = 0;
    function flashSwipe() {
      flashUntil = engine.time + 1.8;
      hud.swipe.classList.remove('bw-off');
      hud.swipe.classList.add('bw-flash');
      ctx.wait(1.8).then(() => { hud.swipe.classList.remove('bw-flash'); setAimUi(phase === 'aim'); });
    }

    function setAimUi(on) {
      hud.aimL.classList.toggle('bw-off', !on || autoplay);
      hud.aimR.classList.toggle('bw-off', !on || autoplay);
      // the first-throw hint shows the gesture; without hints a quiet label does
      const flash = on && engine.time < flashUntil;
      hud.swipe.classList.toggle('bw-off', !flash && (!on || firstThrowDone || autoplay || !!hintHandle));
      if (!on) hud.swipe.classList.remove('bw-flash');
    }

    function showSpeed(mps, spin, drift) {
      const a = Math.abs(spin);
      const curve = a < 0.12 ? 'straight' : (a > 0.65 ? 'big hook ' : 'hook ') + (spin > 0 ? 'left' : 'right');
      const pulled = Math.abs(drift) > DRIFT_TOLD ? ' · pulled ' + (drift < 0 ? 'left ' : 'right ') + (Math.abs(drift) / DEG).toFixed(1) + '°' : '';
      hud.speed.textContent = Math.round(mps * 3.6) + ' km/h · ' + curve + pulled;
      hud.speed.classList.remove('bw-off');
      ctx.wait(2.6).then(() => hud.speed.classList.add('bw-off'));
    }

    function playerTotal(i) {
      if (mode === 'game') return knownTotal(rolls[i]);
      if (mode === 'spare') return stats[i].sparePts;
      return stats[i].pins;
    }

    function refreshHud() {
      const p = turn ? turn.p : 0;
      const prof = players[p].profile;
      if (hud.nameFor !== p) {
        hud.nameFor = p;
        hud.nameChip.innerHTML = '';
        hud.nameChip.append(ui.portraitImg(prof, 30), ui.el('span', '', ui.esc(prof.name)));
      }
      if (mode === 'game') {
        // the frame on show is the one being bowled until the next turn starts (a STRIKE banner keeps
        // its frame highlighted)
        const st = frameState(rolls[p]);
        const cf = turn && turn.p === p ? turn.frame : st.frame;
        const done = st.done && phase === 'done';
        hud.infoChip.textContent = done ? 'Done' : 'Frame ' + (cf + 1);
        hud.totalChip.textContent = String(knownTotal(rolls[p]));
        const fr = scoreFrames(rolls[p]);
        fr.forEach((f, i) => {
          const h = hud.frames[i];
          const marks = f.marks.map(m => '<span class="' + (m === 'X' ? 'x' : m === '/' ? 's' : '') + '">' + m + '</span>');
          if (i < 9 && f.marks[0] === 'X') marks.unshift('<span></span>');
          h.m.innerHTML = marks.join('');
          h.t.textContent = f.total === null ? '' : String(f.total);
          h.cell.classList.toggle('cur', !done && cf === i);
        });
      } else if (mode === 'spare') {
        const k = turn ? turn.leave : 0;
        hud.infoChip.textContent = LEAVES[Math.min(k, 9)].name;
        hud.totalChip.textContent = stats[p].sparePts + ' pts';
        hud.card.classList.add('ss-hidden');
        hud.strip.classList.remove('ss-hidden');
        hud.strip.innerHTML = LEAVES.map((lv, i) => {
          const r = leaveLog[p][i];
          const cls = r === true ? 'ok' : r === false ? 'no' : i === k ? 'cur' : '';
          return '<span class="' + cls + '">' + (r === true ? '✓' : r === false ? '✕' : i + 1) + '</span>';
        }).join('');
      } else {
        const r = turn ? turn.round : 0;
        hud.infoChip.textContent = 'Round ' + (Math.min(r, 9) + 1) + '/10';
        hud.totalChip.textContent = String(stats[p].pins);
        hud.card.classList.add('ss-hidden');
        hud.strip.classList.remove('ss-hidden');
        hud.strip.innerHTML = Array.from({ length: POWER_ROUNDS }, (x, i) => {
          const v = powerLog[p][i];
          const n = rackSpots(powerRows(i)).length;
          // played rounds: pins knocked, filled in proportion to the rack; rounds to come: faded rack sizes
          if (v != null) return '<span class="big ' + (v === n ? 'ok' : 'done') + '" style="--f:' + (v / n).toFixed(2) + '">' + v + '</span>';
          return '<span class="big ' + (i === r ? 'cur' : 'todo') + '">' + n + '</span>';
        }).join('');
      }
      hud.minis.forEach((m, i) => {
        m.sc.textContent = String(playerTotal(i));
        // strikes and spares still waiting for their bonus balls
        const pend = mode === 'game' ? scoreFrames(rolls[i]).filter(f => f.total === null && /[X/]/.test(f.marks.join(''))).map(f => (f.marks.indexOf('X') >= 0 ? 'X' : '/')).join('') : '';
        m.pend.textContent = pend ? '+' + pend : '';
        m.chip.classList.toggle('cur', i === p);
      });
      refreshPins();
      drawMonitor();
    }

    function refreshPins(hitFlash, upcoming) {
      if (L.wide) return;
      const up = upcoming || new Set(W.standing());
      hud.pinBox.classList.toggle('big', up.size > 0 && up.size <= 4);   // a small leave reads bigger
      hud.pinDots.forEach((d, i) => {
        const n = SPOTS10[i].n;
        d.classList.toggle('up', up.has(n));
        d.classList.toggle('hit', !!hitFlash && !up.has(n) && standingBefore.indexOf(n) >= 0);
      });
    }

    function drawMonitor() {
      const g = monCanvas.getContext('2d');
      const p = turn ? turn.p : 0, prof = players[p].profile;
      const bg = g.createLinearGradient(0, 0, 0, 288);
      bg.addColorStop(0, '#24307A'); bg.addColorStop(1, '#131A4A');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 288);
      g.textBaseline = 'middle';
      g.fillStyle = '#FFC93C'; g.font = '700 24px ' + FONT; g.textAlign = 'left';
      g.fillText('SUNNY LANES', 20, 30);
      g.textAlign = 'right'; g.fillStyle = '#9FB2FF'; g.font = '700 20px ' + FONT;
      g.fillText(DEF.modes.find(m => m.id === mode).name.toUpperCase(), 492, 30);
      g.textAlign = 'left'; g.fillStyle = '#FFFFFF'; g.font = '700 38px ' + FONT;
      g.fillText(prof.name, 20, 80);
      g.textAlign = 'right'; g.fillStyle = '#FFC93C'; g.font = '700 56px ' + FONT;
      g.fillText(mode === 'spare' ? stats[p].sparePts + ' pts' : String(playerTotal(p)), 492, 84);
      if (mode === 'game') {
        const fr = scoreFrames(rolls[p]);
        const cw = 47, x0 = 20, y0 = 130;
        fr.forEach((f, i) => {
          const w = i === 9 ? cw + 14 : cw, x = x0 + i * cw;
          g.fillStyle = i === (turn ? turn.frame : 0) ? '#3A4BB0' : '#1E276A';
          g.fillRect(x + 1, y0, w - 2, 110);
          g.fillStyle = '#9FB2FF'; g.font = '700 16px ' + FONT; g.textAlign = 'center';
          g.fillText(String(i + 1), x + w / 2, y0 + 14);
          g.font = '700 22px ' + FONT;
          f.marks.forEach((m, j) => {
            g.fillStyle = m === 'X' || m === '/' ? '#FF7A7E' : '#FFFFFF';
            const cx = i === 9 ? x + 11 + j * 19 : f.marks.length === 1 ? x + w - 12 : x + 12 + j * 22;
            g.fillText(m, cx, y0 + 46);
          });
          g.fillStyle = '#FFFFFF'; g.font = '700 24px ' + FONT;
          if (f.total !== null) g.fillText(String(f.total), x + w / 2, y0 + 86);
        });
      } else if (mode === 'spare') {
        const lv = LEAVES[Math.min(turn ? turn.leave : 0, 9)];
        g.textAlign = 'center'; g.fillStyle = '#FFFFFF'; g.font = '700 40px ' + FONT;
        g.fillText(lv.name.toUpperCase(), 256, 160);
        g.fillStyle = '#9FB2FF'; g.font = '700 24px ' + FONT;
        g.fillText('Leave ' + (Math.min(turn ? turn.leave : 0, 9) + 1) + ' of 10 · pins ' + lv.pins.join('-'), 256, 212);
      } else {
        const r = Math.min(turn ? turn.round : 0, 9);
        g.textAlign = 'center'; g.fillStyle = '#FFFFFF'; g.font = '700 40px ' + FONT;
        g.fillText('ROUND ' + (r + 1) + ' OF 10', 256, 160);
        g.fillStyle = '#9FB2FF'; g.font = '700 26px ' + FONT;
        g.fillText(rackSpots(powerRows(r)).length + ' pins in the rack!', 256, 212);
      }
      monTex.needsUpdate = true;
    }

    async function showTurnCard(p) {
      const prof = players[p].profile;
      const wrap = ui.el('div', 'bw-turnwrap');
      const card = ui.el('div', 'bw-turncard ss-pop');
      const sub = mode === 'game' ? 'Frame ' + (turn.frame + 1) : mode === 'spare' ? LEAVES[turn.leave].name : 'Round ' + (turn.round + 1);
      card.append(ui.portraitImg(prof, 64));
      const who = isYou(prof.name) ? '<span>Your</span>' : '<span class="nm">' + ui.esc(prof.name) + "</span><span>'s</span>";
      card.appendChild(ui.el('div', '', '<h3>' + who + '<span>&nbsp;turn!</span></h3><p>' + ui.esc(sub) + '</p>'));
      wrap.appendChild(card);
      ctx.hud.appendChild(wrap);
      audio.sfx('ui_open');
      await skippable(autoplay ? 0.5 : 1.3);
      wrap.classList.add('out');
      ctx.wait(0.3).then(() => wrap.remove());
    }

    // =============================================================================================
    // Neighbouring lanes: pins, a ball, and two pals who bowl now and then
    // =============================================================================================

    function neighbourScreen(r) {
      const c = makeCanvas(256, 144), g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 0, 144);
      bg.addColorStop(0, '#24307A'); bg.addColorStop(1, '#131A4A');
      g.fillStyle = bg; g.fillRect(0, 0, 256, 144);
      drawSun(g, 128, 58, 24, 12);
      g.fillStyle = '#FFFFFF'; g.font = '700 22px ' + FONT; g.textAlign = 'center';
      g.fillText('SUNNY LANES', 128, 116);
      g.fillStyle = '#FFC93C'; g.font = '700 14px ' + FONT;
      g.fillText('High score today: ' + (180 + Math.floor(r.next() * 90)), 128, 134);
      return c;
    }

    function buildNeighbours() {
      const lanes = [0, 1, 3, 4].map(i => laneXs[i]);
      const mesh = new THREE.InstancedMesh(pinGeoLow, pinMat, lanes.length * 10);
      mesh.frustumCulled = false;
      const state = [];
      lanes.forEach((cx, li) => SPOTS10.forEach((s, k) => state.push({ i: li * 10 + k, x: cx + s.x, z: s.z, tilt: 0, dir: 0, fall: 0, yaw: k * 1.37 })));
      const writeAll = () => {
        for (const s of state) {
          _p.set(s.x + Math.sin(s.dir) * s.fall * 0.12, 0, s.z - Math.cos(s.dir) * s.fall * 0.12);
          _q.setFromEuler(_eu.set(-Math.cos(s.dir) * s.tilt, s.yaw, Math.sin(s.dir) * s.tilt, 'YXZ'));
          _m.compose(_p, _q, _one);
          mesh.setMatrixAt(s.i, _m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      };
      writeAll();
      scene.add(mesh);
      const roster = pals.CPU_ROSTER.slice();
      const i0 = ambRng.int(0, roster.length - 1);
      let i1 = ambRng.int(0, roster.length - 2);
      if (i1 >= i0) i1++;
      const who = [roster[i0], roster[i1]];
      const ballM = new THREE.MeshPhongMaterial({ color: 0x8E5BE0, shininess: 80 });
      const bowlersN = (hand > 0 ? [0, 1] : [3, 2]).map((laneIdx, j) => {
        const cx = lanes[laneIdx];
        const pal = pals.create(who[j].profile, { shadows: false, detail: 'low' });
        pal.setFacing(Math.PI);
        const px = cx + Math.sign(cx) * 0.4;     // on the far side of their lane, away from our camera
        pal.root.position.set(px, 0, NB_Z);
        const sh = world.blobShadow(0.34, 0.28);
        sh.position.set(px, 0.006, NB_Z);
        const b = new THREE.Mesh(ballGeo, j ? ballM : world.mat(0x2FAE55, { kind: 'phong', shininess: 80 }));
        b.visible = false;
        scene.add(pal.root, sh, b);
        return { pal, shadow: sh, ball: b, cx, lane: laneIdx, t: -1, next: 6 + ambRng.range(0, 6) + j * 5, x: 0, v: 0, z: 0, hit: false };
      });
      return { mesh, state, writeAll, bowlers: bowlersN };
    }

    function updateNeighbours(dt) {
      let dirty = false;
      for (const nb of ambient.bowlers) {
        nb.pal.update(dt);
        if (nb.t < 0) {
          nb.next -= dt;
          if (nb.next <= 0 && phase !== 'intro') {
            nb.t = 0; nb.hit = false; nb.thrown = false; nb.back = false;
            nb.pal.play('walk'); nb.pal.setSpeed(1.3);
          }
          continue;
        }
        nb.t += dt;
        const root = nb.pal.root;
        // walk up from the seats, bowl, watch, walk back
        if (nb.t < NB_WALK) root.position.z = U.lerp(NB_Z, NB_LINE, nb.t / NB_WALK);
        else if (nb.t > 5.2) root.position.z = U.lerp(NB_LINE, NB_Z, Math.min(1, (nb.t - 5.2) / NB_WALK));
        nb.shadow.position.z = root.position.z;
        if (nb.t > 5.2 && !nb.back) { nb.back = true; nb.pal.setFacing(0); nb.pal.play('walk'); nb.pal.setSpeed(1.3); }
        if (nb.t >= NB_WALK && !nb.thrown) {
          nb.thrown = true;
          nb.pal.play('idle');
          nb.ball.visible = true;
          nb.x = nb.cx + ambRng.range(-0.15, 0.2); nb.z = RELEASE_Z; nb.v = ambRng.range(6.5, 8.5);
          nb.drift = ambRng.range(-0.012, 0.004);
        }
        if (nb.ball.visible) {
          nb.z -= nb.v * dt;
          nb.x += nb.drift * nb.v * dt;
          nb.ball.position.set(nb.x, BALL_R, nb.z);
          nb.ball.rotation.x -= nb.v * dt / BALL_R;
          if (!nb.hit && nb.z < HEAD_Z + 0.15) {
            nb.hit = true;
            const off = nb.x - nb.cx;
            const pinsDown = Math.abs(off) < 0.12 ? ambRng.int(7, 10) : ambRng.int(3, 8);
            const lanePins = ambient.state.filter(s => Math.floor(s.i / 10) === nb.lane);
            lanePins.slice().sort((a, b) => Math.abs(a.x - nb.x) - Math.abs(b.x - nb.x)).slice(0, pinsDown).forEach((s, k) => {
              s.dir = Math.atan2(s.x - nb.x, -1) + ambRng.range(-0.6, 0.6);
              U.tween(s, { tilt: 1.5, fall: ambRng.range(0.4, 1.4) }, 0.45, { delay: k * 0.03, ease: 'outQuad' });
            });
            const pan = U.clamp(nb.cx / 5, -0.8, 0.8);
            audio.sfx('pins_hit', { intensity: pinsDown / 10, vol: 0.22, pan });
            if (pinsDown === 10) nb.pal.play('cheer'); else nb.pal.play(pinsDown > 7 ? 'clap' : 'shrug');
          }
          if (nb.z < HEAD_Z - 1.2) nb.ball.visible = false;
        }
        if (nb.t > 5.2 + NB_WALK) {
          for (const s of ambient.state) if (Math.floor(s.i / 10) === nb.lane) { U.killTweens(s); s.tilt = 0; s.fall = 0; }
          nb.pal.setFacing(Math.PI);
          nb.pal.play('idle');
          nb.t = -1; nb.next = 10 + ambRng.range(0, 10);
        }
        dirty = true;
      }
      if (dirty) ambient.writeAll();
    }

    // =============================================================================================
    // Racks & the pinsetter
    // =============================================================================================

    function rackFor(t) {
      if (mode === 'spare') return { spots: SPOTS10, standing: new Set(LEAVES[t.leave].pins) };
      if (mode === 'hundred') return { spots: rackSpots(powerRows(t.round)), standing: null };
      return { spots: SPOTS10, standing: null };
    }

    function placeRack(rack) {
      W.setRack(rack.spots, rack.standing, rackRng);
      liftY = 0;
      syncPins();
    }

    /** Resolves like p while the game runs; never after exit (like ctx.wait), so async flows just stop. */
    function live(p) {
      return p.then(v => (ctx.alive ? v : new Promise(() => {})));
    }

    function tweenP(target, props, dur, ease) {
      return live(U.tween(target, props, Math.max(0.01, dur), { ease: ease || 'inOutQuad' }));
    }

    /** Pinsetter tempo: brisk by default, faster when the player taps through (or autoplay runs). */
    const setterK = () => (autoplay ? 0.6 : hurry ? 0.5 : 0.65);

    /** Starts the pinsetter after a short beat (cut short by a tap). */
    async function pinsetterAfter(delay, kind, rack, onCount) {
      for (let t = 0; t < delay && !hurry && !autoplay; t += 0.05) await ctx.wait(0.05);
      await runPinsetter(kind, rack, onCount);
    }

    /**
     * Sweep & reset. kind 'respot': standing pins lifted, deadwood swept, pins re-set where they stood.
     * kind 'rack': everything swept and a new rack lowered. Runs on game time (pauses with the game).
     */
    async function runPinsetter(kind, rack, onCount) {
      audio.sfx('sweep', { vol: 0.55 });
      await tweenP(sweepBar.position, { y: 0.09 }, 0.3 * setterK(), 'outQuad');
      if (onCount) onCount();
      if (kind === 'respot') {
        const keep = W.pins.filter(p => W.isStanding(p));
        await tweenP(table.position, { y: 0.42 }, 0.32 * setterK());
        for (const p of keep) {
          placePin(p, p.x - p.m01 * PIN_YC, p.z - p.m21 * PIN_YC, Math.atan2(p.m02, p.m00));
          p.lifted = true;
        }
        liftY = 0;
        await tweenLift(0.5, 0.3 * setterK());
        await sweepDeadwood(0.5 * setterK());
        await tweenP(sweepBar.position, { z: BAR_FRONT }, 0.3 * setterK());
        await tweenLift(0, 0.3 * setterK());
        for (const p of keep) p.lifted = false;
      } else {
        await sweepDeadwood(0.5 * setterK());
        await tweenP(sweepBar.position, { z: BAR_FRONT }, 0.28 * setterK());
        W.setRack(rack.spots, rack.standing, rackRng);
        for (const p of W.pins) if (p.active) p.lifted = true;
        liftY = TABLE_UP - 0.42;
        table.position.y = TABLE_UP;
        await tweenLift(0, 0.42 * setterK(), 'outQuad');
        audio.sfx('wood_knock', { vol: 0.35, rate: 0.8 });
        for (const p of W.pins) p.lifted = false;
      }
      await Promise.all([tweenP(table.position, { y: TABLE_UP }, 0.32 * setterK()), tweenP(sweepBar.position, { y: BAR_UP }, 0.3 * setterK())]);
      if (phase !== 'react') refreshPins();
    }

    function tweenLift(to, dur, ease) {
      const o = { v: liftY };
      return live(U.tween(o, { v: to }, Math.max(0.01, dur), { ease: ease || 'inOutQuad', onUpdate: () => { liftY = o.v; table.position.y = 0.42 + liftY; } }));
    }

    async function sweepDeadwood(dur) {
      const z1 = L.pitZ - 0.25;
      W.sweep = { z: BAR_FRONT - 0.03, vz: (z1 - BAR_FRONT) / dur };
      for (const p of W.pins) if (p.active && !p.lifted && !p.awake) { p.awake = true; p.dyn = true; p.sleepT = 0; }
      await ctx.wait(dur);
      W.sweep = null;
      sweepBar.position.z = z1;
      for (const p of W.pins) if (!p.lifted) W.bury(p);
      if (W.ball.mode !== 'held') { W.ball.mode = 'gone'; W.ball.active = false; W.ball.dyn = false; }
    }

    // =============================================================================================
    // Turn order
    // =============================================================================================

    function makeTurn(p) {
      if (mode === 'game') {
        const st = frameState(rolls[p]);
        return { p, frame: st.frame, ball: st.ball, fresh: st.fresh };
      }
      if (mode === 'spare') return { p, leave: leaveLog[p].length, ball: 0, fresh: true };
      return { p, round: powerLog[p].length, ball: 0, fresh: true };
    }

    function sameTurn(a, b) {
      if (!a || !b) return a === b;
      return a.p === b.p && a.frame === b.frame && a.ball === b.ball && a.fresh === b.fresh;
    }

    /** The turn after `t` (null when everyone is done). Rotates players each frame / leave / round. */
    function nextTurn(t) {
      if (mode === 'game') {
        const st = frameState(rolls[t.p]);
        if (!st.done && st.frame === t.frame) return makeTurn(t.p);
        for (let k = 1; k <= players.length; k++) {
          const q = (t.p + k) % players.length;
          if (!frameState(rolls[q]).done) return makeTurn(q);
        }
        return null;
      }
      // everyone takes the same leave / round, in player order
      const count = i => (mode === 'spare' ? leaveLog[i].length : powerLog[i].length);
      const limit = mode === 'spare' ? LEAVES.length : POWER_ROUNDS;
      let q = 0;
      for (let i = 1; i < players.length; i++) if (count(i) < count(q)) q = i;
      return count(q) < limit ? makeTurn(q) : null;
    }

    // =============================================================================================
    // Flow
    // =============================================================================================

    function skippable(seconds) {
      return new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; skipWaiter = null; resolve(); } };
        skipWaiter = finish;
        ctx.wait(seconds).then(finish);
      });
    }

    async function run() {
      let prevP = -1;
      let reset = Promise.resolve();
      while (ctx.alive && turn) {
        await prepareTurn(turn, prevP, reset);
        prevP = turn.p;
        const shot = await waitForShot();
        await bowl(shot);
        const out = assess(turn);
        let next = nextTurn(turn);
        returnFor = next ? next.p : turn.p;
        const resetKind = !next ? null : mode === 'game' && next.p === turn.p && !next.fresh ? 'respot' : 'rack';
        hurry = false;
        // pins still count until the sweep: the pinsetter takes the final count just before it clears the
        // deck (without one, the count is final after the reaction)
        let counted = null;
        const countGate = new Promise(r => { counted = r; });
        const finalCount = () => { lateRecount(); lastOutcome.final = true; counted(); };
        lateChanged = false;
        reset = resetKind ? pinsetterAfter(0.3, resetKind, rackFor(next), finalCount) : Promise.resolve();
        await react(out, !next, resetKind === 'respot');
        if (!resetKind) finalCount();
        await live(countGate);
        if (lateChanged && mode === 'game') {
          // a late strike or spare changes what comes next: a fresh rack instead of a re-spot, or a bonus ball
          const fixed = nextTurn(turn);
          if (!sameTurn(fixed, next)) {
            next = fixed;
            returnFor = next ? next.p : turn.p;
            if (next) { const n2 = next; reset = reset.then(() => runPinsetter('rack', rackFor(n2))); }
          }
        }
        turn = next;
        if (turn) refreshHud();
      }
      if (ctx.alive) finishGame();
    }

    /** Puts bowler t.p on the approach (the others leave) and resets their pose. */
    function standUp(t, show) {
      const b = bowlers[t.p], a = aims[t.p];
      if (show) bowlers.forEach((o, i) => { o.pal.root.visible = i === t.p; o.shadow.visible = i === t.p; });
      U.killTweens(b.pal.root.position);
      b.pal.root.position.set(a.x - 0.2 * hand, 0, AIM_Z);
      b.pal.setFacing(Math.PI);
      b.pal.releasePose(0);
      b.pal.play('idle');
      b.pal.lookAt(null);
      b.pal.setExpression('neutral');
    }

    async function prepareTurn(t, prevP, reset) {
      phase = 'turn';
      const b = bowlers[t.p];
      const a = aims[t.p];
      const switching = prevP !== t.p;
      // the physics ball is back with the bowler (a 'gone' ball would hide the one we pick up)
      W.ball.mode = 'held'; W.ball.active = false; W.ball.dyn = false;
      if (ballVis.mode !== 'rack' && ballVis.mode !== 'hand' && ballVis.mode !== 'carry') { ball.visible = false; ballVis.mode = 'hidden'; }
      if (ballVis.mode === 'hidden') ballReturn();
      // a ball that came back before the next bowler was known shows their colour from the turn change on
      ball.material = ballMats[t.p];
      if (switching) { hud.nameFor = -1; refreshHud(); }
      // the HUD rack shows what this bowler faces, even while the pinsetter is still lowering it
      if (t.fresh || mode === 'spare') { const rk = rackFor(t); refreshPins(false, rk.standing || new Set(rk.spots.map(sp => sp.n))); }
      if (mode === 'spare' || !t.fresh) {
        // "here's your leave": hold on the pins while the pinsetter finishes, then swing back to the bowler
        if (cam.shot !== 'pins') setShot('pins', 4, true);
        standUp(t, switching);
        await reset;
        refreshPins();
        if (switching && players.length > 1) await showTurnCard(t.p);
        else {
          if (players.length === 1) introBanner(t);
          await skippable(autoplay ? 0.3 : 0.45);
        }
        // a player's leave stays big on screen: the aim view opens zoomed in on it, then pulls back
        if (autoplay) setShot('setup', 3.4); else leavePeek = true;
      } else if (switching) {
        standUp(t, true);
        setShot('setup', 3.2, true);
        if (players.length > 1) await showTurnCard(t.p);
        else introBanner(t);
      } else {
        // same bowler, new rack: walk back to the spot
        const pal = b.pal;
        pal.releasePose(0.2);
        pal.play('walk');
        pal.setSpeed(1.6);
        pal.setFacing(0);
        setShot('setup', 3.2, true);
        introBanner(t);
        await tweenP(pal.root.position, { x: a.x - 0.2 * hand, z: AIM_Z }, 0.55);
        pal.setFacing(Math.PI);
        pal.play('idle');
      }
      await reset;
      refreshPins();
      await ballToHand(b.pal);
    }

    function introBanner(t) {
      if (mode === 'spare') ui.banner(LEAVES[t.leave].name.toUpperCase(), { kind: 'info', sub: 'Leave ' + (t.leave + 1) + ' of 10', duration: 1.2 });
      else if (mode === 'hundred') ui.banner(rackSpots(powerRows(t.round)).length + ' PINS', { kind: 'info', sub: 'Round ' + (t.round + 1) + ' of 10', duration: 1.2 });
    }

    function ballReturn() {
      ballVis.mode = 'rack';
      ball.material = ballMats[returnFor];
      ball.visible = true;
      ball.position.set(hoodX, 0.24, HOOD.z + 0.3);
      U.killTweens(ball.position);
      audio.sfx('ball_return', { vol: 0.6 });
      U.tween(ball.position, { z: RACK_SPOT.z, y: RACK_SPOT.y }, autoplay ? 0.4 : 0.9, { ease: 'outQuad' });
    }

    async function ballToHand(pal) {
      ballVis.mode = 'carry';            // tweened from the rack to the hand; the physics ball isn't involved
      ball.visible = true;
      const target = heldBallPos(pal, V(0, 0, 0));
      U.killTweens(ball.position);
      await live(U.tween(ball.position, { x: target.x, y: target.y, z: target.z }, autoplay ? 0.15 : 0.3, { ease: 'outQuad' }));
      ballVis.mode = 'hand';
      ball.visible = true;
      poseHold(pal, false);
    }

    const _hv = new THREE.Vector3(), HELD_OFF = new THREE.Vector3(0, -0.07, 0.07);
    function heldBallPos(pal, out) {
      const hnd = hand > 0 ? pal.parts.handR : pal.parts.handL;
      _hv.copy(hnd.position).add(HELD_OFF);
      pal.root.updateMatrixWorld();
      return out.copy(_hv).applyMatrix4(pal.root.matrixWorld);
    }

    /** Hand poses are written for a right-hander and mirrored for lefties. */
    function poseHands(pal, ballHand, other, extra, lambda) {
      const bh = V(ballHand[0] * hand, ballHand[1], ballHand[2]), oh = V(other[0] * hand, other[1], other[2]);
      pal.pose(Object.assign(hand > 0 ? { handR: bh, handL: oh } : { handL: bh, handR: oh }, extra), { lambda });
    }

    // ready crouch (finger down) and the top of the backswing; a swipe in progress blends between them
    const POSE_READY = { bh: [-0.12, 0.8, 0.27], oh: [0.07, 0.83, 0.3], crouch: 0.38, lean: 0.24, stance: 0.35 };
    const POSE_BACK = { bh: [-0.24, 0.66, -0.36], oh: [0.34, 0.86, 0.2], crouch: 0.45, lean: 0.32, stance: 0.6 };

    function poseWindup(pal, k, lambda) {
      const l = (a, b) => a + (b - a) * k;
      const lv = (a, b) => [l(a[0], b[0]), l(a[1], b[1]), l(a[2], b[2])];
      const R = POSE_READY, B = POSE_BACK;
      poseHands(pal, lv(R.bh, B.bh), lv(R.oh, B.oh), { crouch: l(R.crouch, B.crouch), lean: l(R.lean, B.lean), stance: l(R.stance, B.stance) }, lambda);
    }

    function poseHold(pal, ready) {
      if (ready) poseWindup(pal, 0, 14);
      else poseHands(pal, [-0.27, 0.6, 0.14], [0.3, 0.7, 0.08], { crouch: 0.06, lean: 0.04 }, 10);
    }

    function waitForShot() {
      phase = 'aim';
      const hints = !autoplay && !hintHandle && !(save.settings && save.settings.hints === false);
      // the hook hint only makes sense on a full rack (a spare wants a straight ball)
      const freshRack = mode === 'hundred' || (mode === 'game' && turn.fresh);
      if (hints && (!firstThrowDone || (!curveHinted && freshRack && (throwsDone >= 3 || stats[turn.p].strikes > 0)))) {
        // first the plain swipe; a few balls in, the curve that makes the ball hook
        const curve = firstThrowDone;
        curveHinted = curveHinted || curve;
        const sz = engine.size;
        const text = curve ? 'Bend your swipe to hook!' : sz.w < 360 ? 'Swipe up!' : 'Swipe up to bowl!';
        const gesture = curve ? 'swipe-up-curve' : 'swipe-up';
        // over open lane in the lower half: clear of the pins and the target (which the peek zooms in on)
        // and of the ball in the bowler's hand
        const at = sz.aspect < 0.85 ? { x: sz.w * (hand > 0 ? 0.66 : 0.34), y: sz.h * 0.56 }
          : { x: sz.w * (hand > 0 ? 0.62 : 0.38), y: sz.h * 0.62 };
        hintHandle = ui.hint(Object.assign({ gesture, text }, at));
        // the core glyph curves for a right-hander's hook; a lefty hooks the other way
        const svg = hintHandle.el && hintHandle.el.querySelector('svg');
        if (curve && hand < 0 && svg) svg.style.transform = 'scaleX(-1)';
      }
      if (tipPending && freshRack && !hintHandle) showTip();
      setAimUi(true);
      arrowGlow = 1;
      if (leavePeek) { leavePeek = false; if (!autoplay) aimPeek = 1.4; setShot('setup', 3.4); }
      return new Promise(resolve => {
        shotWaiter = resolve;
        if (autoplay) autoShot();
      });
    }

    /** Commits a shot from any source (swipe, key, autoplay, debug). */
    function commitShot(shot) {
      if (phase !== 'aim' || !shotWaiter) return false;
      const w = shotWaiter;
      shotWaiter = null;
      phase = 'release';
      setAimUi(false);
      turnDir = 0;
      if (hintHandle) { hintHandle.hide(); hintHandle = null; }
      hud.tip.classList.add('bw-off');
      firstThrowDone = true;
      throwsDone++;
      rememberStyle(shot);
      if (shot.swiped && Math.abs(shot.spin) > 0.3) curveHinted = true;   // they found the hook themselves
      if (shot.drift && Math.abs(shot.drift) > DRIFT_SHOWN) Object.assign(pull, { t: 0.9, x: shot.x, angle: shot.angle });
      rollPath.length = 0;
      rollNext = RELEASE_Z - 0.2;
      w(shot);
      return true;
    }

    async function bowl(shot) {
      const pal = bowlers[turn.p].pal;
      lastShot = { x: shot.x, angleDeg: shot.angle / DEG, speed: shot.speed, spin: shot.spin };
      standingBefore = W.standing();
      // a swipe already played the backswing under the finger: go straight into the forward swing
      throwAnim = { t: shot.swiped ? 0.11 : 0, t0: shot.swiped ? 0.11 : 0, shot, launched: false, pal, z0: pal.root.position.z };
      audio.sfx('swish', { vol: 0.4, rate: 0.8 });
      while (!throwAnim.launched) await ctx.wait(0.02);
      phase = 'roll';
      rollInfo = { hitSeen: false, gutterSeen: false, predicted: false, slowmo: false, t: 0, settleT: 0, lastClack: 0, sig: '', sigT: 0, skip: false };
      cam.followX = W.ball.x;
      setShot('follow', 5.5);
      crowd.setMood('tense');
      audio.duck(0.7, 3);
      const s = stats[turn.p];
      s.topSpeed = Math.max(s.topSpeed, shot.speed);
      showSpeed(shot.speed, shot.spin, shot.drift || 0);
      // ride along until the count can't change any more (or a generous timeout)
      while (ctx.alive) {
        await ctx.wait(0.05);
        const r = rollInfo, bm = W.ball.mode;
        // the follow cam keeps a gutter ball in view; it hands over to the pin cam just before impact
        if (cam.shot === 'follow' && (W.ball.z < CUT_Z || bm === 'pit' || bm === 'gone')) {
          setShot('pins', 5);
          hud.speed.classList.add('bw-off');     // the pin cam's masking unit sits right under the chip
        }
        if (W.ev.gutterAt !== null && !W.ev.hit) {
          // nothing more can happen to the pins: call it (a tap calls it at once)
          if (r.skip || W.t - W.ev.gutterAt > 0.6) break;
          continue;
        }
        if (W.ev.hit || bm === 'gone' || bm === 'pit') r.settleT += 0.05;
        if (W.ev.hit) {
          const up = W.standing();
          const sig = up.join(',');
          if (sig !== r.sig) { r.sig = sig; r.sigT = 0; } else r.sigT += 0.05;
          if (up.length === 0 && r.sigT >= 0.3) break;             // everything is down
          if (r.sigT >= 0.4 && W.quiet()) break;                   // the leave is final
        }
        if (W.settled() && r.settleT > 0.6 && W.quiet()) break;
        if (r.settleT > (L.wide ? 6 : 4.8)) break;
        if (r.t > 12) break;
      }
      if (rollLoop) { rollLoop.stop(0.3); rollLoop = null; }
    }

    // =============================================================================================
    // Assessment & scoring
    // =============================================================================================

    function assess(t) {
      phase = 'assess';
      const after = W.standing();
      const knocked = standingBefore.length - after.length;
      const s = stats[t.p];
      const gutter = W.ev.gutterAt !== null && knocked === 0;
      const wobbled = W.pins.some(p => p.minUp < 0.99 && W.isStanding(p));   // a standing pin really rocked (> 8°)
      const out = { knocked, after, gutter, wobbled, kind: 'count', streak: 0, sub: null, pins: knocked };
      if (gutter) s.gutters++;
      const fresh = standingBefore.length === W.pins.length && t.fresh;
      const pickingSplit = splitLeft, streak0 = s.streak;
      if (mode === 'game') {
        rolls[t.p].push(knocked);
        if (fresh) { s.first += knocked; s.firstN++; }
        if (fresh && knocked === 10) {
          s.strikes++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
          out.kind = 'strike'; out.streak = s.streak;
        } else {
          if (!fresh && after.length === 0) {
            s.spares++;
            out.kind = splitLeft ? 'pickup' : 'spare';
            if (splitLeft) s.pickups++;
          } else if (fresh && isSplit(after)) {
            s.splits++;
            out.kind = 'split'; out.sub = after.join('-');
          }
          s.streak = 0;
        }
        splitLeft = out.kind === 'split';
        const total = knownTotal(rolls[t.p]);
        if (frameState(rolls[t.p]).done && total === 300) out.kind = 'perfect';
      } else if (mode === 'spare') {
        const ok = after.length === 0;
        const run = ok && leaveLog[t.p][leaveLog[t.p].length - 1] === true;
        leaveLog[t.p].push(ok);
        if (ok) {
          s.conversions++; s.spares++;
          out.pts = SPARE_PTS + (run ? SPARE_RUN_BONUS : 0);
          out.run = run;
          s.sparePts += out.pts;
        }
        out.kind = ok ? (isSplit(LEAVES[t.leave].pins) ? 'pickup' : 'spare') : after.length === 1 && knocked > 0 ? 'close' : knocked > 0 ? 'partial' : out.kind;
        if (ok && s.conversions === 10) out.kind = 'perfectSpares';
      } else {
        const rackN = W.pins.length;
        const clear = after.length === 0;
        const pts = knocked + (clear ? POWER_CLEAR_BONUS : 0);
        powerLog[t.p].push(knocked);
        s.pins += pts;
        if (clear) s.clears++;
        out.kind = clear ? 'clear' : 'power';
        out.pins = knocked;
        out.rack = rackN;
      }
      if (gutter) out.kind = 'gutter';
      ghostPts[t.p] = rollPath.slice();
      lastOutcome = { kind: out.kind, knocked, standing: after.slice(), p: t.p, fresh, pickingSplit, streak0 };
      refreshHud();
      refreshPins(true);
      return out;
    }

    /**
     * Pins that go down after the count still count until the sweep (a slow teeter, creeping deadwood):
     * fixes the last ball's score, celebrates a late strike / spare, and flags it (lateChanged) so the turn
     * order can be recomputed. Rare: the count waits for a quiet deck.
     */
    function lateRecount() {
      const lo = lastOutcome;
      if (!lo || lo.final) return;
      const now = W.standing();
      if (now.length >= lo.standing.length) return;
      const extra = lo.standing.length - now.length;
      const s = stats[lo.p];
      const clear = now.length === 0;
      lo.standing = now; lo.knocked += extra; lateChanged = true;
      const sub = extra === 1 ? 'A late pin fell!' : extra + ' late pins fell!';
      if (mode === 'game') {
        const r = rolls[lo.p];
        r[r.length - 1] += extra;
        if (lo.fresh && s.firstN) s.first += extra;
        if (lo.fresh) {
          // the leave may have become (or stopped being) a split
          const split = !clear && isSplit(now);
          if (split !== (lo.kind === 'split')) { s.splits += split ? 1 : -1; lo.kind = split ? 'split' : 'count'; }
          splitLeft = split;
        }
        if (clear && lo.fresh) {
          s.strikes++; s.streak = lo.streak0 + 1; s.bestStreak = Math.max(s.bestStreak, s.streak);
          lo.kind = 'strike';
          if (frameState(r).done && knownTotal(r) === 300) ui.banner('PERFECT GAME!', { kind: 'huge', sub: '300!', duration: 2.4 });
          else ui.banner(s.streak >= 4 ? s.streak + '-BAGGER!' : STRIKE_WORDS[s.streak - 1], { kind: 'huge', sub, duration: 1.6 });
          audio.sfx('fanfare_small');
          audio.sfx('crowd_cheer', { intensity: 0.9 });
          crowd.cheer(1, 2);
        } else if (clear) {
          s.spares++;
          if (lo.pickingSplit) s.pickups++;
          lo.kind = lo.pickingSplit ? 'pickup' : 'spare';
          ui.banner(lo.pickingSplit ? 'NICE PICK-UP!' : 'SPARE!', { kind: 'great', sub, duration: 1.4 });
          audio.sfx('star');
          audio.sfx('crowd_applause', { intensity: 0.7 });
        } else ui.banner(lo.knocked + ' PINS', { kind: 'info', sub, duration: 1.1 });
      } else if (mode === 'spare') {
        if (clear) {
          const log = leaveLog[lo.p];
          const run = log.length > 1 && log[log.length - 2] === true;
          log[log.length - 1] = true;
          const pts = SPARE_PTS + (run ? SPARE_RUN_BONUS : 0);
          s.conversions++; s.spares++; s.sparePts += pts;
          lo.kind = 'spare';
          ui.banner('PICKED UP!', { kind: 'great', sub: sub + ' +' + pts, duration: 1.4 });
          audio.sfx('star');
          audio.sfx('crowd_applause', { intensity: 0.7 });
        }
      } else {
        const log = powerLog[lo.p];
        log[log.length - 1] += extra;
        s.pins += extra + (clear ? POWER_CLEAR_BONUS : 0);
        if (clear) { s.clears++; lo.kind = 'clear'; }
        ui.banner(clear ? 'CLEARED!' : lo.knocked + ' PINS!', { kind: clear ? 'huge' : 'good', sub: clear ? sub + ' +' + POWER_CLEAR_BONUS : sub, duration: 1.4 });
        if (clear) audio.sfx('fanfare_small');
      }
      refreshHud();
    }

    // =============================================================================================
    // Celebrations
    // =============================================================================================

    async function react(out, last, respot) {
      phase = 'react';
      crowd.setMood('idle');
      const pal = bowlers[turn.p].pal;
      const deck = V(0, 0.6, HEAD_Z - 0.5);
      let anim = 'shrug', expr = 'neutral', big = false;
      switch (out.kind) {
        case 'strike': {
          big = true;
          const n = out.streak;
          const word = n >= 4 ? n + '-BAGGER!' : STRIKE_WORDS[n - 1];
          ui.banner(word, { kind: 'huge', sub: n === 1 ? null : n + ' strikes in a row', duration: 1.9 });
          audio.sfx(n >= 3 ? 'fanfare_big' : 'fanfare_small');
          audio.sfx('crowd_cheer', { intensity: Math.min(1, 0.7 + n * 0.1) });
          audio.sfx('voice_yay', { delay: 0.25 });
          audio.duck(0.45, 2);
          crowd.cheer(1, 2.6);
          world.confetti(scene, deck, { count: 110 + n * 20, spread: 1.6 });
          engine.shake(0.05, 0.4);
          anim = n >= 3 ? 'jump' : 'cheer'; expr = 'joy';
          break;
        }
        case 'perfect':
          big = true;
          ui.banner('PERFECT GAME!', { kind: 'huge', sub: '300!', duration: 3 });
          audio.sfx('jingle_perfect');
          audio.sfx('crowd_cheer', { intensity: 1 });
          audio.duck(0.4, 3.5);
          crowd.cheer(1, 4);
          world.confetti(scene, deck, { count: 200, spread: 2 });
          ui.confetti({ count: 140 });
          anim = 'jump'; expr = 'joy';
          break;
        case 'spare':
          ui.banner('SPARE!', { kind: 'great', sub: spareSub(out), duration: 1.5 });
          audio.sfx('star');
          audio.sfx('crowd_applause', { intensity: 0.7 });
          crowd.cheer(0.6, 1.6);
          anim = 'clap'; expr = 'happy';
          break;
        case 'pickup':
          big = true;
          ui.banner('NICE PICK-UP!', { kind: 'great', sub: mode === 'spare' ? spareSub(out) : 'Split converted', duration: 1.8 });
          audio.sfx('fanfare_small');
          audio.sfx('crowd_cheer', { intensity: 0.85 });
          crowd.cheer(0.9, 2.2);
          world.confetti(scene, deck, { count: 70, spread: 1.4 });
          anim = 'jump'; expr = 'joy';
          break;
        case 'perfectSpares':
          big = true;
          ui.banner('CLEAN SWEEP!', { kind: 'huge', sub: 'All 10 leaves!', duration: 2.4 });
          audio.sfx('jingle_perfect');
          audio.sfx('crowd_cheer', { intensity: 1 });
          crowd.cheer(1, 3);
          world.confetti(scene, deck, { count: 160, spread: 1.8 });
          anim = 'jump'; expr = 'joy';
          break;
        case 'split':
          ui.banner('SPLIT!', { kind: 'info', sub: out.sub, duration: 1.5 });
          audio.sfx('crowd_gasp');
          crowd.gasp();
          anim = 'shrug'; expr = 'surprised';
          break;
        case 'gutter':
          ui.banner('GUTTER BALL', { kind: 'bad', duration: 1.4 });
          audio.sfx('crowd_aww');
          audio.sfx('voice_aw', { delay: 0.2 });
          anim = 'sad'; expr = 'sad';
          break;
        case 'clear':
          big = true;
          ui.banner('CLEARED!', { kind: 'huge', sub: out.pins + ' pins +' + POWER_CLEAR_BONUS + ' bonus', duration: 2 });
          audio.sfx('fanfare_big');
          audio.sfx('crowd_cheer', { intensity: 1 });
          crowd.cheer(1, 2.6);
          world.confetti(scene, V(0, 0.8, HEAD_Z - 1.4), { count: 180, spread: 2.4 });
          anim = 'jump'; expr = 'joy';
          break;
        case 'power': {
          const frac = out.pins / out.rack;
          ui.banner(out.pins + (out.pins === 1 ? ' PIN!' : ' PINS!'), { kind: frac > 0.6 ? 'great' : 'good', sub: 'of ' + out.rack, duration: 1.5 });
          audio.sfx(frac > 0.6 ? 'crowd_cheer' : 'crowd_applause', { intensity: 0.4 + frac * 0.6 });
          if (frac > 0.6) crowd.cheer(frac, 2);
          anim = frac > 0.6 ? 'cheer' : frac > 0.3 ? 'clap' : 'shrug'; expr = frac > 0.3 ? 'happy' : 'neutral';
          break;
        }
        case 'close':
          ui.banner('SO CLOSE!', { kind: 'info', sub: out.knocked + ' of ' + standingBefore.length + ' pins', duration: 1.4 });
          audio.sfx('crowd_ooh');
          anim = 'shrug'; expr = 'wince';
          break;
        case 'partial':
          ui.banner(out.knocked + ' OF ' + standingBefore.length, { kind: 'info', sub: 'Not quite!', duration: 1.3 });
          anim = 'shrug'; expr = 'neutral';
          break;
        default: {
          const n = out.knocked;
          const teeter = out.wobbled && n >= 6;
          ui.banner(n === 0 ? 'MISS' : n === 1 ? '1 PIN' : n + ' PINS', { kind: n >= 7 ? 'good' : 'info', sub: teeter ? 'It wobbled… and stayed up!' : null, duration: 1.3 });
          if (n === 9 || teeter) audio.sfx('crowd_ooh');
          else if (n >= 7) audio.sfx('crowd_applause', { intensity: 0.35 });
          anim = n >= 7 ? 'clap' : n >= 3 ? 'shrug' : 'sad';
          expr = n >= 7 ? 'happy' : n >= 3 ? 'neutral' : 'wince';
        }
      }
      if (big) hapticBuzz(30);
      if (out.kind !== 'strike' && out.kind !== 'perfect') maybeTip();
      await skippable(autoplay ? 0.5 : big ? 1.0 : 0.8);
      // a plain count on a first ball: stay on the pins and watch the pinsetter set up the spare
      if (respot && out.kind === 'count') return;
      // reaction shot: the bowler celebrates toward us, the crowd behind
      pal.releasePose(0.25);
      pal.lookAt(null);
      setShot('react', 5, true);
      pal.setExpression(expr, 2.4);
      pal.play(anim);
      if (out.kind === 'strike' || out.kind === 'perfect' || out.kind === 'pickup' || out.kind === 'clear') {
        // short-lived sparkles (not confetti): nothing may still be drifting past the next aim view
        world.burst(scene, V(pal.root.position.x, 1.5, pal.root.position.z - 0.3), { count: 46, colors: [0xFF5A5F, 0xFFC93C, 0x22C3B5, 0xFF6FAE, 0x8E7BFF], speed: 3.2, size: 0.05, life: 1.1, gravity: -5 });
      }
      await skippable(autoplay ? 0.6 : last ? 2.2 : big ? 1.9 : 1.4);
    }

    function bigMoment() {
      if (rollInfo.slowmo) return;
      rollInfo.slowmo = true;
      engine.slowmo(0.32, 1.25);
      engine.shake(0.035, 0.3);
    }

    function hapticBuzz(ms) { if (ui.haptic) ui.haptic(ms); }

    function spareSub(out) {
      if (mode !== 'spare') return null;
      return out.run ? '+' + out.pts + ' · back-to-back!' : '+' + out.pts;
    }

    /** Pointers for a first ball that missed the pocket, each at most once a game, shown when the bowler
     *  next lines up a full rack: a straight ball that met the head pin square should slide over; a hook
     *  that crossed to the far side needs a start further over AND a turn the same way. */
    function maybeTip() {
      const h = W.ev.hit;
      if (autoplay || mode !== 'game' || standingBefore.length < 10 || !lastShot) return;
      const hooked = lastShot.spin * hand > 0.3;
      let key = null;
      if (hooked && (h ? h.pin <= 3 && h.x * hand < -0.01 : W.ev.gutterAt !== null && W.ball.gutterSide === -hand)) key = 'crossed';
      else if (!hooked && h && h.pin === 1 && h.x * hand <= 0.03) key = 'square';
      if (!key || tipsShown.has(key)) return;
      tipsShown.add(key);
      tipPending = key;
    }

    function showTip() {
      const side = hand > 0 ? 'right' : 'left';
      const text = tipPending === 'crossed' ? 'Big hook! Move ' + side + ' and turn ' + side : 'Drag a little ' + side + ' to hit the pocket';
      tipPending = null;
      hud.tip.innerHTML = ui.icon('bulb') + '<span>' + text + '</span>';
      hud.tip.classList.remove('bw-off');
      ctx.wait(5).then(() => hud.tip.classList.add('bw-off'));
    }

    // =============================================================================================
    // The throw: release animation, ball launch, rolling feedback
    // =============================================================================================

    function updateThrow(dt) {
      const a = throwAnim;
      if (!a) return;
      a.t += dt;
      const pal = a.pal, t = a.t;
      // backswing (already shown under the finger for a swipe) → forward swing → release → follow-through
      if (t < 0.11) poseWindup(pal, 1, 30);
      else if (t < 0.2) poseHands(pal, [-0.2, 0.16, 0.42], [0.46, 0.74, 0.08], { crouch: 0.78, lean: 0.62, stance: 1 }, 34);
      else poseHands(pal, [-0.17, 0.98, 0.5], [0.46, 0.8, -0.02], { crouch: 0.66, lean: 0.5, stance: 1 }, 9);
      const k = U.ease.outCubic(Math.min(1, (t - a.t0) / 0.28));
      pal.root.position.z = U.lerp(a.z0, 0.62, k);
      if (!a.launched && t >= 0.15) {
        a.launched = true;
        W.launch(a.shot);
        ballVis.mode = 'free';
        ball.visible = true;
        ballVis.blend = 1;
        ballVis.from.copy(ball.position);
        trail.clear();
        trail.visible = true;
        audio.sfx('bowl_release', { intensity: U.clamp((a.shot.speed - 5) / 5, 0.3, 1) });
        hapticBuzz(12);
        if (a.shot.speed > 9) audio.sfx('voice_hup', { vol: 0.6 });
        if (rollLoop) rollLoop.stop(0.05);
        rollLoop = audio.loop('ball_roll', { vol: 0.75, rate: a.shot.speed / 8 });
      }
      if (t > 1.1) {
        throwAnim = null;
        pal.releasePose(0.5);
        pal.play('idle');
      }
    }

    function updateBallVisual(dt) {
      const b = W.ball;
      if (ballVis.mode === 'hand' && turn) {
        heldBallPos(bowlers[turn.p].pal, ball.position);
      } else if (ballVis.mode === 'free' && (b.mode !== 'held')) {
        if (b.mode === 'gone') {
          ball.visible = false;
          ballVis.mode = 'hidden';
          ctx.wait(1.1).then(() => { if (ballVis.mode === 'hidden') ballReturn(); });
        }
        else {
          _p.set(b.x, b.y, b.z);
          if (ballVis.blend > 0) {
            ballVis.blend = Math.max(0, ballVis.blend - dt / 0.09);
            _p.lerp(ballVis.from, ballVis.blend);
          }
          ball.position.copy(_p);
          ball.quaternion.set(b.qx, b.qy, b.qz, b.qw);
        }
      }
      if (trail.visible && (b.mode !== 'lane' || ballVis.mode !== 'free')) trail.visible = false;
      ballShadow.visible = ball.visible && ball.position.y < 0.5 && ball.position.z > L.pitZ;
      if (ballShadow.visible) ballShadow.position.set(ball.position.x, (W.ball.mode === 'gutter' ? GUTTER_Y : 0) + 0.004, ball.position.z);
    }

    /** Sounds, slow-mo and sparkles driven by physics events. */
    function rollFeedback(dt) {
      const r = rollInfo;
      if (!r) return;
      r.t += dt;
      const b = W.ball;
      if (rollLoop) {
        const v = Math.hypot(b.vx, b.vz);
        rollLoop.setRate(U.clamp(v / 8, 0.3, 1.4));
        rollLoop.setVolume(b.mode === 'gutter' ? 0.5 : b.mode === 'lane' ? 0.75 : 0);
        if (b.mode === 'pit' || b.mode === 'gone') { rollLoop.stop(0.25); rollLoop = null; audio.sfx('thud', { vol: 0.35, rate: 0.7 }); }
      }
      if (!r.gutterSeen && W.ev.gutterAt !== null) {
        r.gutterSeen = true;
        // a ball that already met the pins just drops off the deck: no gutter-ball sound in the pin action
        if (!W.ev.hit) { audio.sfx('gutter_drop'); audio.sfx('crowd_aww', { intensity: 0.4, vol: 0.6 }); }
      }
      // late in the lane, a ball on its way into the pocket draws an "ooh" from the seats
      if (!r.predicted && b.mode === 'lane' && b.z < -12.5 && !L.wide && standingBefore.length >= 9) {
        r.predicted = true;
        const px = predictHeadX(W);
        if (px !== null && Math.abs(px - hand * POCKET_X) < 0.035) audio.sfx('crowd_ooh', { vol: 0.45 });
      }
      const h = W.ev.hit;
      if (h && !r.hitSeen) {
        r.hitSeen = true;
        const pocket = (h.pin === 1 || h.pin === 3 || h.pin === 2) && h.speed > 5.8;
        audio.sfx('pins_hit', { intensity: U.clamp(h.speed / 9, 0.3, 1) * (pocket ? 1 : 0.7) });
        world.burst(scene, V(h.x, 0.18, h.z - 0.1), { count: 14, color: 0xFFFFFF, speed: 2.2, size: 0.05, life: 0.5 });
        // slow-mo is for strikes: a pocket hit with real entry angle right away, or (below) a rack that is
        // all on the move a beat after impact. Power Pins saves it for the big racks.
        const into = -h.angle * hand / DEG;
        const strikey = W.fullRack && !L.wide && h.speed > 5.8 && Math.abs(h.x * hand - POCKET_X) < 0.035 && into >= 2.8;
        const bigRack = L.wide && W.pins.length >= 36 && Math.abs(h.x) < 0.14 && h.speed > 5.8;
        if (strikey || bigRack) bigMoment();
      }
      if (h && !r.slowmo && W.fullRack && !L.wide && W.t - h.t >= 0.25 && W.t - h.t < 0.45 && W.pins.every(p => p.touched)) bigMoment();
      r.lastClack += dt;
      if (W.ev.clatter > 0.9 && r.lastClack > 0.07) {
        audio.sfx('pin_clatter', { intensity: U.clamp(W.ev.clatter / 4.5, 0.15, 1), vol: 0.8 });
        r.lastClack = 0;
      } else if (W.ev.wallHits > 1.2 && r.lastClack > 0.1) {
        audio.sfx('wood_knock', { vol: U.clamp(W.ev.wallHits / 6, 0.15, 0.5), rate: 1.3 });
        r.lastClack = 0;
      }
      W.ev.clatter = 0; W.ev.wallHits = 0;
    }

    // =============================================================================================
    // Aiming & input
    // =============================================================================================

    function nudgeAim(d) {
      const a = aims[turn.p];
      a.angle = U.clamp(a.angle + d, -AIM_MAX, AIM_MAX);
      arrowGlow = 1;
      // turning the aim peeks down the lane (zoomed in on the pins) so every tap visibly moves the target
      if (!autoplay) { aimPeek = 1.1; aimInfo(); }
    }

    function moveTo(x) {
      const a = aims[turn.p];
      a.x = U.clamp(x, -X_MAX, X_MAX);
      arrowGlow = 1;
      if (!autoplay && phase === 'aim') aimInfo();
    }

    /** "Board 15 · aim 0.3° left" — boards are counted from the bowling-hand side, like the lane's arrows. */
    function aimInfo() {
      const a = aims[turn.p];
      const board = U.clamp(Math.round((LANE_HALF - a.x * hand) / BOARD + 0.5), 1, 39);
      const deg = Math.round(Math.abs(a.angle) / DEG * 10) / 10;
      const pocket = updatePrediction().pocket && guideWanted();
      hud.aimInfo.textContent = 'Board ' + board + ' · ' + (deg < 0.05 ? 'aim straight' : 'aim ' + deg.toFixed(1) + '° ' + (a.angle < 0 ? 'left' : 'right')) + (pocket ? ' · pocket line!' : '');
      hud.aimInfo.classList.remove('bw-off');
      aimInfoT = 1.6;
    }

    // ---- the guide: where this aim sends a ball bowled like the bowler's last one -------------------
    // Each bowler's style (speed + hook) is remembered separately for full racks and for leaves; until
    // they have bowled, a firm straight ball.
    const styles = players.map(() => ({ fresh: { speed: 8.4, spin: 0 }, leave: null }));
    const pathPts = [];
    const pred = { key: '', x: 0, z: HEAD_Z, pocket: false };
    const _ds = new THREE.Vector3(), _dq = new THREE.Quaternion();

    const fullRackTurn = () => turn && turn.fresh && mode !== 'spare';
    function currentStyle() {
      const st = styles[turn.p];
      return fullRackTurn() ? st.fresh : st.leave || st.fresh;
    }

    function rememberStyle(shot) {
      const st = styles[turn.p], o = { speed: shot.speed, spin: shot.spin };
      if (fullRackTurn()) st.fresh = o; else st.leave = o;
    }

    function frontPinZ() {
      let front = HEAD_Z;
      for (const p of W.pins) if (W.isStanding(p)) front = Math.max(front, p.z);
      return front;
    }

    /** Recomputes the predicted path when the aim, the style or the rack changed; places the dots. */
    function updatePrediction() {
      const a = aims[turn.p], sty = currentStyle(), front = frontPinZ();
      const key = a.x.toFixed(4) + ',' + a.angle.toFixed(6) + ',' + sty.speed.toFixed(2) + ',' + sty.spin.toFixed(3) + ',' + front.toFixed(3) + ',' + turn.p;
      if (key === pred.key) return pred;
      pred.key = key;
      const r = tracePath(L, { x: a.x, angle: a.angle, speed: sty.speed, spin: sty.spin }, GUIDE_Z0, front, pathPts);
      pred.x = r.x; pred.z = r.z;
      // on a full rack: the pocket beside the head pin, coming in at an angle (the line that carries)
      pred.pocket = !r.gutter && fullRackTurn() && !L.wide && Math.abs(r.x - hand * POCKET_X) < POCKET_TOL && -r.angle * hand / DEG > POCKET_ANGLE;
      const n = Math.min(GUIDE_MAX, pathPts.length / 2);
      _dq.identity();
      for (let i = 0; i < n; i++) {
        _p.set(pathPts[2 * i], 0.003, pathPts[2 * i + 1]);
        const r = dotSize(_p.z);
        guide.setMatrixAt(i, _m.compose(_p, _dq, _ds.set(r, 1, r * 2.4)));
      }
      guide.count = n;
      guide.instanceMatrix.needsUpdate = true;
      guideRing.position.set(r.x, 0.003, pred.z);
      return pred;
    }

    /** Dots grow down the lane so they read at any distance (and stretch along it: the lane is seen
     *  at a grazing angle). */
    const dotSize = z => 0.026 + 0.0024 * Math.max(0, -z);

    /** Where the guide meets the front standing pin's row. */
    const _tgt = new THREE.Vector3();
    function aimTarget() {
      const pr = updatePrediction();
      return _tgt.set(pr.x, 0, pr.z);
    }

    /** Spare balls always get the guide; full racks while hints are on (or during the zoomed peek). */
    function guideWanted() {
      const hintsOn = !(save.settings && save.settings.hints === false);
      return mode === 'spare' || !turn.fresh || hintsOn || aimPeek > 0;
    }

    // ---- the ghost: dots where the bowler's last ball really went -------------------------------
    const ghostPts = players.map(() => []);
    const rollPath = [];
    let rollNext = 0, ghostShown = '';

    function recordPath() {
      const b = W.ball;
      if (phase !== 'roll' || b.mode !== 'lane' || W.ev.hit || rollPath.length >= GHOST_MAX * 2) return;
      if (b.z <= rollNext) { rollPath.push(b.x, b.z); rollNext = b.z - GUIDE_STEP; }
    }

    function showGhost(p) {
      const pts = ghostPts[p], key = p + ':' + pts.length + ':' + pts[1];
      if (key === ghostShown) return;
      ghostShown = key;
      const n = pts.length / 2;
      _dq.identity();
      for (let i = 0; i < n; i++) {
        _p.set(pts[2 * i], 0.0025, pts[2 * i + 1]);
        const r = dotSize(_p.z) * 0.8;
        ghost.setMatrixAt(i, _m.compose(_p, _dq, _ds.set(r, 1, r * 1.6)));
      }
      ghost.material.color.setHex(ballCols[p]);
      ghost.count = n;
      ghost.instanceMatrix.needsUpdate = true;
    }

    /** The floating target chevron over the pins (DOM, so it stays crisp and readable at any distance). */
    function updateTargetMarker() {
      const op = turn && guide.visible ? guideMat.opacity / 0.85 : 0;
      const el = hud.target;
      if (op < 0.02) { if (el.style.opacity !== '0') el.style.opacity = '0'; return; }
      const t = aimTarget();
      t.y = 0.45;
      const pr = engine.project(t);
      if (!pr.visible) { el.style.opacity = '0'; return; }
      el.style.opacity = String(Math.min(1, op).toFixed(2));
      el.style.transform = 'translate3d(' + pr.x.toFixed(1) + 'px,' + pr.y.toFixed(1) + 'px,0)';
      el.classList.toggle('pocket', pred.pocket);
    }

    function updateAim(dt) {
      if (!turn) return;
      const a = aims[turn.p];
      if (phase === 'aim' && turnDir) {
        turnHeld += dt;
        const rate = (0.8 + 3.2 * Math.min(1, turnHeld / 1.0)) * DEG;
        nudgeAim(turnDir * rate * dt);
        if (Math.floor(turnHeld / 0.12) !== Math.floor((turnHeld - dt) / 0.12)) ui.sfx('ui_tick');
      }
      const show = phase === 'aim' || phase === 'turn';
      if (phase === 'aim' && turnDir) aimPeek = Math.max(aimPeek, 1.1);
      if (phase !== 'aim') aimPeek = 0;
      aimPeek = Math.max(0, aimPeek - dt);
      if (aimInfoT > 0 && (aimInfoT -= dt) <= 0 || (phase !== 'aim' && aimInfoT > 0)) { aimInfoT = 0; hud.aimInfo.classList.add('bw-off'); }
      // the gesture hint steps aside while the peek shows the pins
      if (hintHandle && hintHandle.el) hintHandle.el.style.visibility = aimPeek > 0 ? 'hidden' : '';
      arrowGlow = Math.max(0, arrowGlow - dt * 0.6);
      // right after a release that a tilted swipe pulled off line, the arrow swings to the line the ball
      // really took and flashes orange, so the pull is never a mystery
      pull.t = Math.max(0, pull.t - dt);
      const pulling = pull.t > 0;
      if (pulling) arrowMat.opacity = 0.95 * Math.min(1, pull.t / 0.25) * (0.75 + 0.25 * Math.cos(pull.t * 18));
      else arrowMat.opacity = U.damp(arrowMat.opacity, show ? 0.6 + 0.35 * Math.min(1, arrowGlow) : 0, 10, dt);
      arrowMat.color.setHex(pulling ? 0xFF8A3D : 0xFFFFFF);
      marker.material.opacity = U.damp(marker.material.opacity, show ? 0.9 : 0, 10, dt);
      arrow.visible = arrowMat.opacity > 0.01;
      marker.visible = marker.material.opacity > 0.01;
      arrow.position.set(pulling ? pull.x : a.x, 0.004, RELEASE_Z);
      arrow.rotation.y = -(pulling ? pull.angle : a.angle);
      marker.position.set(a.x, 0.004, RELEASE_Z);
      // the guide carries the aim on to the front standing pin, the ghost shows the last ball
      const guideOn = show && guideWanted();
      guideMat.opacity = U.damp(guideMat.opacity, guideOn ? Math.max(Math.min(arrowMat.opacity, 0.9), aimPeek > 0 ? 0.9 : 0) * 0.85 : 0, 10, dt);
      guideRing.material.opacity = guideMat.opacity;
      guide.visible = guideRing.visible = guideMat.opacity > 0.01;
      if (guide.visible) {
        const col = updatePrediction().pocket ? POCKET_COLOR : PATH_COLOR;
        guideMat.color.copy(col);
        guideRing.material.color.copy(col);
      }
      const ghostOn = show && ghostPts[turn.p].length > 0;
      ghost.material.opacity = U.damp(ghost.material.opacity, ghostOn ? 0.55 : 0, 8, dt);
      ghost.visible = ghost.material.opacity > 0.01;
      if (ghost.visible && show) showGhost(turn.p);
      // the bowler follows the release spot while aiming
      if (phase === 'aim' && turn) {
        const pal = bowlers[turn.p].pal;
        const tx = a.x - 0.2 * hand;
        const dx = tx - pal.root.position.x;
        pal.root.position.x = U.damp(pal.root.position.x, tx, 14, dt);
        pal.root.rotation.y = Math.PI + U.clamp(-dx * 2, -0.4, 0.4);
      }
    }

    // ---- touch: slide, turn, bowl ---------------------------------------------------------------
    // A thumb swipe tilts the same way every time: the line only follows the tilt beyond the bowler's own
    // habit (most of the median of their last few swipes), so only deliberate steering pulls the ball.
    const tilts = players.map(() => []);
    function tiltBias(hist) {
      if (!hist.length) return 0;
      const m = hist.slice().sort((x, y) => x - y)[hist.length >> 1];
      return U.clamp(m, -20, 20) * 0.75 * Math.min(1, hist.length / 2);
    }

    /** A bowl stroke from the canvas, an aim button or the bowl part of a slide-then-bowl press. */
    function bowlStroke(s) {
      if (phase !== 'aim' || autoplay) return;
      const short = Math.min(engine.size.w, engine.size.h);
      const a = aims[turn.p];
      const hist = tilts[turn.p];
      const read = readSwipe(s, short, tiltBias(hist));
      if (!read || s.start.y < engine.size.h * 0.18) {
        if (-s.dy > 0.04 * short) flashSwipe();      // an upward stroke that didn't count: say how
        return;
      }
      hist.push(read.tilt);
      if (hist.length > 5) hist.shift();
      commitShot({ x: a.x, angle: U.clamp(a.angle + read.drift, -AIM_MAX - 3 * DEG, AIM_MAX + 3 * DEG), speed: read.speed, spin: read.spin, drift: read.drift, swiped: true });
    }

    const press = { mode: null, startX: 0, lowY: 0, rising: false };
    ctx.input.on('down', p => {
      if (phase !== 'aim' || autoplay) return;
      press.mode = 'pending';
      press.startX = aims[turn.p].x;
      press.lowY = p.y;
      press.rising = false;
      if (p.y > engine.size.h * 0.2) poseHold(bowlers[turn.p].pal, true);
    });
    ctx.input.on('move', p => {
      if (phase !== 'aim' || !press.mode) return;
      const short = Math.min(engine.size.w, engine.size.h);
      if (press.mode === 'pending' && Math.hypot(p.dx, p.dy) >= 20) {
        // a big hook swipe can start out well sideways: anything heading up at more than ~30° is a swipe,
        // only a clearly sideways move is a drag
        const ax = Math.abs(p.dx), ay = Math.abs(p.dy);
        if (p.dy < 0 && ax < ay * 1.8) press.mode = 'swipe';
        else if (ax > ay) press.mode = 'drag';
      }
      if (press.mode === 'drag') {
        // slide along the approach; once the finger heads up the slide is done and the backswing begins
        if (!press.rising && press.lowY - p.y > 0.05 * short) press.rising = true;
        if (press.rising) poseWindup(bowlers[turn.p].pal, U.clamp((press.lowY - p.y) / short / 0.25, 0, 1), 26);
        else { press.lowY = Math.max(press.lowY, p.y); moveTo(press.startX + p.ndx * 1.15); }
      }
      // the swipe up is the backswing; lifting the finger lets the ball go
      else if (press.mode === 'swipe') poseWindup(bowlers[turn.p].pal, U.clamp(-p.ndy / 0.25, 0, 1), 26);
    });
    ctx.input.on('up', () => {
      const m = press.mode;
      press.mode = null;
      if (phase !== 'aim') return;
      press.last = m;
      // a swipe event (if any) arrives right after 'up'; relax the pose only when no throw came of it
      Promise.resolve().then(() => { if (phase === 'aim') poseHold(bowlers[turn.p].pal, false); });
    });
    ctx.input.on('swipe', s => {
      if (phase !== 'aim' || autoplay) return;
      if (press.last === 'drag') {
        const short = Math.min(engine.size.w, engine.size.h);
        const k = strokeTurn(s.path || []);
        const p0 = s.path[0], pk = s.path[k];
        if (k > 0 && (pk.t - p0.t > 220 || Math.abs(pk.x - p0.x) > 0.12 * short)) {
          // a real slide, then a bowl: keep the new spot and read the stroke from where it turned up
          const sub = strokeFromPath(s.path.slice(k), short);
          if (-sub.dy < 0.07 * short) return;
          moveTo(press.startX + (pk.x - p0.x) / short * 1.15);
          bowlStroke(sub);
          return;
        }
        // a press that began sideways but ended as a long upward stroke was a curvy swipe after all
        if (-s.dy < 0.2 * short || Math.abs(s.dy) < Math.abs(s.dx)) return;
        moveTo(press.startX);
      }
      bowlStroke(s);
    });
    /** Tap / Space: skip the current beat; after a gutter ball, call the result at once. */
    function skipBeat() {
      if (phase === 'roll' && rollInfo && W.ev.gutterAt !== null && !W.ev.hit) { rollInfo.skip = true; return true; }
      if (!skipWaiter || (phase !== 'react' && phase !== 'turn')) return false;
      hurry = true;
      skipWaiter();
      return true;
    }
    ctx.input.on('tap', skipBeat);
    ctx.input.on('key', k => {
      if (!k.down || !turn) return;
      if ((k.key === ' ' || k.key === 'Enter') && phase !== 'aim' && skipBeat()) return;
      if (phase !== 'aim' || autoplay) return;
      if (k.key === 'ArrowLeft') moveTo(aims[turn.p].x - BOARD / 2);
      else if (k.key === 'ArrowRight') moveTo(aims[turn.p].x + BOARD / 2);
      else if (k.key === 'a' || k.key === 'A') nudgeAim(-2 * AIM_TAP);
      else if (k.key === 'd' || k.key === 'D') nudgeAim(2 * AIM_TAP);
      else if ((k.key === ' ' || k.key === 'Enter') && !k.repeat) {
        const a = aims[turn.p];
        commitShot({ x: a.x, angle: a.angle, speed: 8.4, spin: 0 });   // keyboard fallback: a firm straight ball
      }
    });

    // =============================================================================================
    // Autoplay: planned shots with human-like noise
    // =============================================================================================

    async function autoShot() {
      const t = turn;
      const up = W.pins.filter(p => W.isStanding(p));
      let plan;
      if (up.length === W.pins.length && (mode !== 'spare')) {
        plan = strikeShot(L, { speed: 7.8 + rng.next() * 1.4, spin: 0.5 + rng.next() * 0.45 }, hand);
      } else {
        const spots = up.map(p => ({ n: p.n, x: p.x, z: p.z }));
        const set = new Set(spots.map(s => s.n));
        const cands = spareCandidates(L, spots, hand);
        const scores = [];
        for (let i = 0; i < cands.length; i++) {
          scores.push(simulateShot(L, spots, set, cands[i], 5).knocked);
          if (i % 4 === 3) { await ctx.wait(0); if (!autoplay || turn !== t || phase !== 'aim') return; }
        }
        plan = bestCandidate(cands, scores);
      }
      const shot = humanize(plan, 0.9, rng);
      // show the line being picked, then bowl
      const a = aims[t.p];
      await live(U.tween(a, { x: shot.x, angle: shot.angle }, 0.45, { ease: 'inOutQuad' }));
      arrowGlow = 1;
      await ctx.wait(0.2);
      if (!autoplay || turn !== t || phase !== 'aim') return;
      poseHold(bowlers[t.p].pal, true);
      await ctx.wait(0.15);
      if (autoplay && turn === t && phase === 'aim') commitShot(shot);
    }

    // =============================================================================================
    // Results, records, medals, skill
    // =============================================================================================

    function finishGame() {
      phase = 'done';
      setAimUi(false);
      const scores = players.map((p, i) => playerTotal(i));
      const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || (stats[b.i].pins - stats[a.i].pins));
      const placeOf = i => 1 + order.filter(o => o.s > scores[i]).length;
      const fmtScore = i => (mode === 'spare' ? scores[i] + ' pts' : String(scores[i]));
      const conv = stats.map(st => st.conversions);
      // records
      const records = [];
      const best = order[0];
      const bestProf = players[best.i].profile;
      const pid = bestProf.isGuest ? null : bestProf.id;
      const rec = (key, value, label, fmt, who) => {
        const r = save.record(DEF.id, key, value, { profileId: who ? (who.isGuest ? null : who.id) : pid, label, fmt });
        // hot-seat: the results line names whose record it is (the stored label stays plain)
        const shownLabel = players.length > 1 ? label + ' · ' + (who || bestProf).name : label;
        records.push({ label: shownLabel, value: fmt === 'int' ? String(value) : fmt.replace('{v}', value), isNew: !!(r && r.isNew) });
      };
      if (mode === 'game') {
        rec('high', best.s, 'High Score', 'int');
        const mostStrikes = Math.max(...stats.map(s => s.strikes));
        if (mostStrikes > 0) {
          const who = players[stats.findIndex(s => s.strikes === mostStrikes)].profile;
          rec('strikes', mostStrikes, 'Most Strikes', '{v} strikes', who);
        }
      } else if (mode === 'spare') {
        const most = Math.max(...conv);
        rec('spare', most, 'Spare Challenge', '{v}/10', players[conv.indexOf(most)].profile);
        rec('sparePts', best.s, 'Spare Points', '{v} pts');
      }
      else rec('power', best.s, 'Power Pins', '{v} pts');
      // medals (first player)
      const medals = [];
      const award = id => { if (ctx.awardMedal(id)) medals.push(id); };
      const s0 = scores[0];
      if (mode === 'game') {
        if (s0 >= 120) award('bronze');
        if (s0 >= 170) award('silver');
        if (s0 >= 220) award('gold');
        if (s0 >= 250) award('platinum');
      } else if (mode === 'spare' && conv[0] >= 8) award('platinum');
      else if (mode === 'hundred' && s0 >= POWER_SILVER) award('silver');
      // skill
      const deltaFor = i => {
        const lvl = ctx.skillFor(players[i].profile);
        const k = lvl / 2500;
        let d;
        if (mode === 'game') d = (scores[i] - (70 + 160 * k)) * 0.45 + 8;
        else if (mode === 'spare') d = (conv[i] - (2 + 5 * k)) * 12 + 6;
        else d = (scores[i] - (220 + 180 * k)) * 0.2 + 6;
        return Math.round(U.clamp(d, -40, 80));
      };
      const st0 = stats[0];
      const statsOut = [];
      const topSpeed = { label: 'Top Speed', value: Math.round(st0.topSpeed * 3.6) + ' km/h' };
      if (players.length > 1) {
        // hot-seat: one compact line per bowler, so nobody's numbers read as the winner's
        players.forEach((p, i) => {
          const st = stats[i], nm = p.profile.name;
          if (mode === 'game') statsOut.push({ label: nm + ' · strikes · spares', value: st.strikes + ' · ' + st.spares });
          else if (mode === 'spare') statsOut.push({ label: nm + ' · picked up', value: st.conversions + '/10' });
          else statsOut.push({ label: nm + ' · best round', value: String(Math.max(0, ...powerLog[i])) });
        });
        const fastest = stats.reduce((b, st, i) => (st.topSpeed > stats[b].topSpeed ? i : b), 0);
        statsOut.push({ label: 'Top Speed · ' + players[fastest].profile.name, value: Math.round(stats[fastest].topSpeed * 3.6) + ' km/h' });
      } else if (mode === 'game') {
        statsOut.push({ label: 'Strikes', value: String(st0.strikes) }, { label: 'Spares', value: String(st0.spares) },
          { label: 'Best Streak', value: String(st0.bestStreak) },
          { label: 'First-Ball Avg', value: st0.firstN ? (st0.first / st0.firstN).toFixed(1) : '0' },
          st0.splits ? { label: 'Splits Converted', value: st0.pickups + '/' + st0.splits } : { label: 'Gutter Balls', value: String(st0.gutters) },
          topSpeed);
      } else if (mode === 'spare') {
        statsOut.push({ label: 'Leaves Converted', value: st0.conversions + '/10' },
          { label: 'Back-to-Back Bonus', value: String(st0.sparePts - SPARE_PTS * st0.conversions) },
          { label: 'Splits Picked Up', value: String(leaveLog[0].filter((ok, i) => ok && isSplit(LEAVES[i].pins)).length) }, topSpeed);
      } else {
        statsOut.push({ label: 'Pins Knocked', value: String(powerLog[0].reduce((a, b) => a + b, 0)) },
          st0.clears ? { label: 'Clear Bonus', value: '+' + st0.clears * POWER_CLEAR_BONUS } : { label: 'Best Round', value: String(Math.max(0, ...powerLog[0])) },
          topSpeed);
      }
      const solo = players.length === 1;
      let title;
      const tied = scores.filter(v => v === best.s).length > 1;
      const winner = players[best.i].profile.name;
      if (!solo) title = tied ? "It's a Tie!" : isYou(winner) ? 'You Win!' : winner + ' Wins!';
      else if (mode === 'game') title = s0 >= 300 ? 'Perfect Game!' : s0 >= 220 ? 'Bowling Legend!' : s0 >= 170 ? 'Great Game!' : s0 >= 120 ? 'Nice Game!' : 'Good Effort!';
      else if (mode === 'spare') title = conv[0] >= 10 ? 'Clean Sweep!' : conv[0] >= 8 ? 'Spare Master!' : conv[0] >= 5 ? 'Nice Pick-ups!' : 'Keep Practising!';
      else title = s0 >= POWER_SILVER ? 'Pin Crusher!' : s0 >= 220 ? 'Power Bowler!' : 'Nice Rolling!';
      const good = mode === 'game' ? s0 >= 120 : mode === 'spare' ? conv[0] >= 5 : s0 >= 220;
      ctx.finish({
        outcome: solo ? (good ? 'win' : 'done') : tied ? 'draw' : 'done',
        title,
        headline: fmtScore(solo ? 0 : best.i),
        headlineLabel: mode === 'game' ? 'Final Score' : 'Points',
        players: players.map((p, i) => ({
          profileId: p.profile.id, name: p.profile.name, profile: p.profile, score: fmtScore(i),
          place: placeOf(i), isCpu: false, skillDelta: deltaFor(i),
        })),
        stats: statsOut,
        records,
        medals,
        celebrate: good || medals.length > 0 || records.some(r => r.isNew),
      });
    }

    // =============================================================================================
    // Frame loop & lifecycle
    // =============================================================================================

    function update(dt) {
      W.advance(dt);
      recordPath();
      updateThrow(dt);
      rollFeedback(dt);
      syncPins();
      updateBallVisual(dt);
      updateAim(dt);
      for (let i = 0; i < bowlers.length; i++) {
        const o = bowlers[i];
        if (!o.pal.root.visible) continue;
        o.pal.update(dt);
        o.shadow.position.set(o.pal.root.position.x, 0.006, o.pal.root.position.z);
        if (phase === 'roll' && turn && i === turn.p && W.ball.mode !== 'gone') o.pal.lookAt(ball.position);
      }
      updateNeighbours(dt);
      updateCamera(dt);
      updateTargetMarker();
    }

    // first frame: rack in place, camera behind the bowler
    turn = makeTurn(0);
    placeRack(rackFor(turn));
    bowlers[0].pal.root.visible = true;
    bowlers[0].pal.root.position.set(aims[0].x - 0.2 * hand, 0, AIM_Z);
    ball.material = ballMats[0];
    refreshHud();
    setShot('setup', 3.2, true);
    updateCamera(0);

    return {
      start() {
        if (started) return;
        started = true;
        ambience = audio.loop('alley_ambience', { vol: 0.5 });
        run();
      },
      update,
      dispose() {
        if (rollLoop) rollLoop.stop(0.1);
        if (ambience) ambience.stop(0.3);
        rollLoop = ambience = null;
        if (hintHandle) hintHandle.hide();
        for (const o of [ball.position, sweepBar.position, table.position, ...aims, ...ambient.state, ...bowlers.map(b => b.pal.root.position)]) U.killTweens(o);
        for (const o of bowlers) o.pal.dispose();
        for (const m of ballMats) { m.map.dispose(); m.dispose(); }
        for (const nb of ambient.bowlers) nb.pal.dispose();
        shotWaiter = null; skipWaiter = null;
      },
      debugState() {
        const st = turn && mode === 'game' ? frameState(rolls[turn.p]) : null;
        return {
          phase, mode, autoplay, hand,
          player: turn ? turn.p : null,
          frame: st ? st.frame + 1 : null, ball: turn ? turn.ball : null,
          leave: mode === 'spare' && turn ? turn.leave + 1 : null,
          round: mode === 'hundred' && turn ? turn.round + 1 : null,
          scores: players.map((p, i) => playerTotal(i)),
          rolls: mode === 'game' ? rolls.map(r => r.slice()) : undefined,
          standing: W.standing(),
          awake: W.pins.filter(p => p.awake).length,
          ballMode: W.ball.mode,
          ballVisible: ball.visible, ballVis: ballVis.mode,
          // is any part of an ambient neighbour on screen (tests: they must stay out of the aim view)
          neighboursInView: ambient.bowlers.some(nb => [0.1, 0.6, 1.1].some(y => [-0.3, 0.3].some(dx => {
            const r = nb.pal.root.position;
            return engine.project(V(r.x + dx, y, r.z)).visible;
          }))),
          aim: turn ? { x: +aims[turn.p].x.toFixed(3), angleDeg: +(aims[turn.p].angle / DEG).toFixed(2) } : null,
          camera: cam.shot,
          guide: { dots: guide.count, x: +pred.x.toFixed(3), pocket: pred.pocket, opacity: +guideMat.opacity.toFixed(2), ghost: ghost.count, ghostOpacity: +ghost.material.opacity.toFixed(2) },
          lastShot, lastOutcome,
        };
      },
      debug: {
        /** Plays every shot (good, slightly varied input) until the game finishes. */
        autoplay(on) {
          autoplay = on !== false;
          if (autoplay) {
            if (hintHandle) { hintHandle.hide(); hintHandle = null; }
            if (phase === 'aim' && shotWaiter) autoShot();
            if (skipWaiter) skipWaiter();
          } else if (turn) {
            // hand the shot being lined up back to the player
            U.killTweens(aims[turn.p]);
            setAimUi(phase === 'aim');
          }
          return autoplay;
        },
        /** Bowls now: { x (m), angleDeg, speed (m/s), spin (-1.5..1.5, + hooks left) }. */
        throw(o = {}) {
          if (!turn || phase !== 'aim') return false;
          const a = aims[turn.p];
          if (o.x != null) moveTo(o.x);
          if (o.angleDeg != null) a.angle = U.clamp(o.angleDeg * DEG, -AIM_MAX, AIM_MAX);
          return commitShot({
            x: a.x, angle: a.angle,
            speed: U.clamp(o.speed == null ? 8.5 : o.speed, SPEED_MIN, SPEED_MAX),
            spin: U.clamp(o.spin == null ? 0 : o.spin, -SPIN_LIMIT, SPIN_LIMIT),
          });
        },
        /** Replaces the rack with these standing pins (10-pin numbering; Power Pins numbering in that mode). */
        setLeave(list) {
          if (phase !== 'aim' || !turn || !Array.isArray(list)) return false;
          const pins = list.map(Number).filter(n => n >= 1 && n <= (mode === 'hundred' ? rackSpots(powerRows(turn.round)).length : 10));
          if (mode === 'game') {
            const st = frameState(rolls[turn.p]);
            if (st.fresh && pins.length < 10) {
              // as if a first ball had left exactly these pins
              rolls[turn.p].push(10 - pins.length);
              stats[turn.p].streak = 0;
              turn = makeTurn(turn.p);
            } else if (!st.fresh) {
              rolls[turn.p][rolls[turn.p].length - 1] = 10 - pins.length;
            }
            splitLeft = isSplit(pins);
          }
          W.setRack(mode === 'hundred' ? rackSpots(powerRows(turn.round)) : SPOTS10, new Set(pins), rackRng);
          syncPins();
          refreshHud();
          return true;
        },
        /** Headless stats for n frames at quality 0..1 (no rendering). */
        simulate(n = 100, quality = 0.8) { return simulateFrames(Math.max(1, Math.min(2000, n | 0)), quality, ctx.seed + 17, hand); },
        /** Tips these standing pins over (tests the late-pin recount); returns how many it pushed. */
        topple(list) {
          let k = 0;
          for (const p of W.pins) {
            if (!W.isStanding(p) || (Array.isArray(list) && list.indexOf(p.n) < 0)) continue;
            wake(p); p.dyn = true; p.wx += 7; k++;
          }
          return k;
        },
        /** Skips the current celebration / turn card. */
        skip() { return skipBeat(); },
        /** Jumps to frame / leave / round n (1-based) for everyone, counting the skipped ones as zeros. */
        skipTo(n) {
          if (phase !== 'aim' || !turn) return false;
          const k = U.clamp((n | 0) - 1, 0, 9);
          players.forEach((p, i) => {
            if (mode === 'game') { rolls[i].length = 0; for (let f = 0; f < k; f++) rolls[i].push(0, 0); }
            else if (mode === 'spare') { leaveLog[i].length = 0; for (let f = 0; f < k; f++) leaveLog[i].push(false); }
            else { powerLog[i].length = 0; for (let f = 0; f < k; f++) powerLog[i].push(0); }
          });
          turn = makeTurn(turn.p);
          placeRack(rackFor(turn));
          refreshHud();
          return true;
        },
      },
    };
  }

  SS.registerSport(DEF);
})();
