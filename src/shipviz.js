// Turns simulation state into instanced 3D: ships (block by block), projectiles, debris,
// beams and particle effects. One Viz per scene; the battle and the shipyard each own one.
const Viz = (() => {
  const {S, DECK} = Sim;
  const {PARTS} = Data;
  const {waveH} = Gfx;
  const V3 = THREE.Vector3, M4 = THREE.Matrix4;

  const TEAM = {
    0: {hull: new THREE.Color(0.80, 0.86, 0.93), paint: new THREE.Color('#a9b5bf')},
    1: {hull: new THREE.Color(0.88, 0.76, 0.73), paint: new THREE.Color('#a8968f')},
  };
  const BURNT = new THREE.Color(0.28, 0.2, 0.16);

  // Visual pieces per part. node: base | pivot (turret yaw) | barrel (yaw + elevation) | spin (radar)
  // tint: 'paint' takes the team turret colour.
  const BARREL = {gun: [0, 1.7, -1.4], heavy: [0, 2.2, -3.2], ciws: [0, 2.6, -1.2], rail: [0, 1.9, -0.6], rockets: [0, 2.6, 0.4]};
  const MUZZLE = {gun: 9.6, heavy: 16, ciws: 5, rail: 17, rockets: 4, torp: 6, missile: 0};
  const p = (geo, mat, node = 'base', o = {}) => Object.assign({geo, mat, node}, o);
  const PIECES = {
    bridge: [p('tower', 'light'), p('tower2', 'light'), p('window', 'glass'), p('wing', 'light'), p('mast', 'dark'),
             p('radarBar', 'dark', 'spin', {y: DECK + 17.5, rate: 1.8})],
    engine: [p('funnel', 'funnel'), p('funnelTop', 'black')],
    rudder: [p('rudderCap', 'dark')],
    gun: [p('gunBase', 'paint', 'pivot', {tint: true}), p('gunBarrel', 'dark', 'barrel')],
    heavy: [p('heavyHouse', 'paint', 'pivot', {tint: true}), p('heavyRoof', 'paint', 'pivot', {tint: true}),
            p('heavyBarrel', 'dark', 'barrel', {pos: [-1.7, 0, 0]}), p('heavyBarrel', 'dark', 'barrel', {pos: [1.7, 0, 0]})],
    torp: [p('torpBase', 'dark', 'pivot'), ...[-1.9, 0, 1.9].map(x => p('torpTube', 'paint', 'pivot', {pos: [x, 1.9, 0], tint: true}))],
    ciws: [p('ciwsBase', 'dark', 'pivot'), p('ciwsDome', 'light', 'pivot'), p('ciwsBarrel', 'dark', 'barrel')],
    missile: [p('vls', 'dark'), ...[[-2, -2], [2, -2], [-2, 2], [2, 2]].map(([x, z]) => p('hatch', 'red', 'base', {pos: [x, DECK + 1.55, z]}))],
    rail: [p('railBase', 'paint', 'pivot', {tint: true}), p('railRail', 'dark', 'barrel', {pos: [-1.3, 0, 0]}), p('railRail', 'dark', 'barrel', {pos: [1.3, 0, 0]}),
           p('railCoil', 'coil', 'barrel', {pos: [0, 0, -3]}), p('railCoil', 'coil', 'barrel', {pos: [0, 0, -8]}), p('railCoil', 'coil', 'barrel', {pos: [0, 0, -13]})],
    rockets: [p('rocketBase', 'dark', 'pivot'), p('rocketBox', 'paint', 'barrel', {tint: true}), p('rocketFace', 'black', 'barrel')],
    radar: [p('radarMast', 'dark'), p('radarDish', 'light', 'spin', {y: DECK + 7.5, rate: 2.4})],
    repair: [p('repairPad', 'yellow'), p('craneBase', 'yellow'), p('craneArm', 'yellow')],
    smoke: [p('canister', 'dark', 'base', {pos: [-1.8, DECK + 1.6, 0.6]}), p('canister', 'dark', 'base', {pos: [1.8, DECK + 1.6, 0.6]})],
  };
  for (const k in PIECES) for (const pc of PIECES[k]) pc.local = new M4().makeTranslation(...(pc.pos || [0, 0, 0]));

  function variant(s, b) {
    if (b.t === 'bridge') return 'full';
    const has = (dc, dr) => { const c = b.c + dc, r = b.r + dr; return c >= 0 && r >= 0 && c < s.w && r < s.h && !!s.map[c + r * s.w]; };
    const f = !has(0, -1), bk = !has(0, 1), l = !has(-1, 0), rt = !has(1, 0);
    if (f && l && rt) return 'bow';
    if (f && l) return 'bowL';
    if (f && rt) return 'bowR';
    if (bk && l && rt) return 'stern';
    if (bk && l) return 'sternL';
    if (bk && rt) return 'sternR';
    return 'full';
  }

  const C = {smoke: [0.32, 0.33, 0.35], dsmoke: [0.07, 0.07, 0.08], fsmoke: [0.55, 0.56, 0.58], white: [0.92, 0.96, 1.0],
             fire: [1.0, 0.45, 0.08], flash: [1.0, 0.85, 0.5], foam: [0.85, 0.93, 0.97], tracer: [1.0, 0.8, 0.35],
             screen: [0.72, 0.74, 0.76], rail: [0.55, 0.85, 1.0], repair: [0.45, 1.0, 0.6], dark: [0.12, 0.12, 0.13]};

  class Viz {
    constructor(env, opts = {}) {
      this.env = env;
      this.root = new THREE.Group(); env.scene.add(this.root);
      const Q = Gfx.QUALITY[opts.quality || 'medium'];
      this.pools = new Gfx.PoolSet(this.root, Q.shadows);
      MAT_ARRAYS();
      this.particles = new Gfx.Particles(Q.particles, false, env.fog); env.scene.add(this.particles.points);
      this.glow = new Gfx.Particles(Math.round(Q.particles / 2), true, env.fog); env.scene.add(this.glow.points);
      this.debris = [];
      this.beams = [];
      this.ships = new Map();
      this.t = 0;
      this.m = {ship: new M4(), base: new M4(), node: new M4(), tmp: new M4(), r: new M4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), v: new V3(), one: new V3(1, 1, 1), sc: new V3()};
      this.col = new THREE.Color();
    }
    setScale(px) { this.particles.setScale(px); this.glow.setScale(px); }
    P(o) { this.particles.add(o); }
    G(o) { this.glow.add(o); }

    // ---------------------------------------------------------- ships
    addShip(s) {
      const v = {s, blocks: new Map(), bob: 0, roll: 0, pitch: 0, sinkDir: Math.random() < 0.5 ? 1 : -1};
      v.variants = new Map(s.blocks.map(b => [b, variant(s, b)]));
      for (const b of s.blocks) if (b.alive) this.addBlock(v, b);
      this.ships.set(s, v);
      s.viz = v;
      return v;
    }
    addBlock(v, b) {
      const s = v.s, team = TEAM[s.team] || TEAM[1];
      const armor = b.t === 'armor';
      const body = this.pools.get((armor ? 'armor_' : 'hull_') + v.variants.get(b), armor ? 'armorMats' : 'hullMats');
      const list = [{pool: body, i: body.alloc(), node: 'base', local: null, hull: true}];
      for (const pc of PIECES[b.t] || []) {
        const pool = this.pools.get(pc.geo, pc.mat, true);
        const e = {pool, i: pool.alloc(), node: pc.node, local: pc.local, pc};
        list.push(e);
        if (pc.tint) pool.color(e.i, team.paint);
      }
      body.color(list[0].i, team.hull);
      b.vizLevel = 0;
      v.blocks.set(b, list);
    }
    removeBlock(v, b) {
      const list = v.blocks.get(b);
      if (!list) return;
      for (const e of list) e.pool.release(e.i);
      v.blocks.delete(b);
    }
    removeShip(s) {
      const v = this.ships.get(s); if (!v) return;
      for (const b of [...v.blocks.keys()]) this.removeBlock(v, b);
      this.ships.delete(s);
    }
    clearShips() { for (const s of [...this.ships.keys()]) this.removeShip(s); }

    // Height of a point on deck (for effects).
    deckH(s, lx, ly, extra = DECK) {
      const v = s.viz; if (!v) return extra;
      return v.bob + extra + lx * Math.sin(v.roll) - ly * Math.sin(v.pitch);
    }
    muzzle(s, b) {
      const W = PARTS[b.t].weapon, len = MUZZLE[b.t] || 0, bo = BARREL[b.t] || [0, 2, 0];
      const [wx, wy] = s.pos(b), [fx, fy] = Util.fwd(b.ang);
      const ce = Math.cos(b.elev || 0), se = Math.sin(b.elev || 0);
      return [wx + fx * len * ce, wy + fy * len * ce, this.deckH(s, b.lx, b.ly, DECK + bo[1]) + len * se];
    }

    poseShip(v, dt, t) {
      const s = v.s;
      const [fx, fy] = Util.fwd(s.a), rx = Math.cos(s.a), ry = Math.sin(s.a);
      const L = s.len * 0.45, W = Math.max(14, s.beam * 0.5);
      const hc = waveH(s.x, s.y, t);
      const hf = waveH(s.x + fx * L, s.y + fy * L, t), hb = waveH(s.x - fx * L, s.y - fy * L, t);
      const hr = waveH(s.x + rx * W, s.y + ry * W, t), hl = waveH(s.x - rx * W, s.y - ry * W, t);
      let pitchT = Math.atan2(hf - hb, 2 * L) * 0.8 + s.listPitch - s.speed * 0.0004;
      let rollT = Math.atan2(hr - hl, 2 * W) * 0.6 + s.listRoll - s.rudder * s.speed * 0.0012;
      let bob = (hc + (hf + hb) * 0.5) * 0.5 - (1 - s.reserve) * 3;
      if (s.sinking) {
        const k = s.sinkT, dir = s.listRoll ? Math.sign(s.listRoll) : v.sinkDir;
        bob -= k * k * 30; rollT += dir * k * 0.9; pitchT += (s.listPitch >= 0 ? 1 : -1) * k * 0.35;
      }
      const a = Math.min(1, dt * 3), b2 = Math.min(1, dt * 1.5);
      v.bob += (bob - v.bob) * a; v.roll += (rollT - v.roll) * b2; v.pitch += (pitchT - v.pitch) * b2;
    }

    syncShip(v, dt, t) {
      const s = v.s, m = this.m;
      this.poseShip(v, dt, t);
      m.e.set(v.pitch, -s.a, v.roll);
      m.q.setFromEuler(m.e);
      m.ship.compose(m.v.set(s.x, v.bob, s.y), m.q, m.one);
      for (const [b, list] of v.blocks) {
        if (!b.alive) { this.removeBlock(v, b); continue; }
        m.base.multiplyMatrices(m.ship, m.tmp.makeTranslation(b.lx, 0, b.ly));
        // colour: damage darkens, hits flash, repairs glow
        const lvl = Math.round((1 - b.hp / b.max) * 6) + (b.hitFx > 0 ? 10 : 0) + (b.repairFx > 0 ? 20 : 0);
        if (b.hitFx > 0) b.hitFx -= dt;
        if (b.repairFx > 0) b.repairFx -= dt;
        if (lvl !== b.vizLevel) {
          b.vizLevel = lvl;
          const team = TEAM[s.team] || TEAM[1];
          this.col.copy(team.hull).lerp(BURNT, Util.clamp(1 - b.hp / b.max, 0, 1) * 0.75);
          if (b.hitFx > 0) this.col.multiplyScalar(1.6);
          if (b.repairFx > 0) this.col.lerp(new THREE.Color(0.6, 1, 0.7), 0.3);
          list[0].pool.color(list[0].i, this.col);
        }
        for (const e of list) {
          let node = m.base;
          if (e.node === 'pivot' || e.node === 'barrel') {
            m.node.multiplyMatrices(m.base, m.tmp.makeTranslation(0, DECK, 0));
            m.node.multiply(m.r.makeRotationY(-Util.wrapA(b.ang - s.a)));
            if (e.node === 'barrel') {
              const bo = BARREL[b.t] || [0, 2, 0];
              m.node.multiply(m.tmp.makeTranslation(bo[0], bo[1], bo[2]));
              m.node.multiply(m.r.makeRotationX(b.elev || 0));
            }
            node = m.node;
          } else if (e.node === 'spin') {
            m.node.multiplyMatrices(m.base, m.tmp.makeTranslation(0, e.pc.y, 0));
            m.node.multiply(m.r.makeRotationY(t * e.pc.rate + s.id));
            node = m.node;
          }
          if (e.local) { m.tmp.multiplyMatrices(node, e.local); e.pool.set(e.i, m.tmp); }
          else e.pool.set(e.i, node);
        }
      }
    }

    // ---------------------------------------------------------- per-frame
    update(world, dt, t, opts = {}) {
      this.t = t;
      for (const v of this.ships.values()) {
        if (v.s.dead) { this.removeShip(v.s); continue; }
        this.syncShip(v, dt, t);
        if (opts.effects !== false) this.shipEffects(v, dt, t, world);
      }
      if (world && opts.projectiles !== false) this.projectiles(world, t);
      this.updateDebris(dt, t);
      this.updateBeams(dt);
      this.particles.update(dt, t); this.glow.update(dt, t);
      this.particles.upload(); this.glow.upload();
      this.pools.flush();
    }

    shipEffects(v, dt, t, world) {
      const s = v.s, rng = Math.random;
      if (s.sinking) {
        if (rng() < 0.6) { const b = s.randomBlock(); if (b) { const [x, y] = s.pos(b); this.P({x, y, h: 0, vx: (rng() - .5) * 12, vy: (rng() - .5) * 12, vh: 0, life: 2, size: 4 + rng() * 4, c: C.foam, a: 0.6, surf: true, grow: 1}); } }
        if (rng() < 0.3) { const b = s.randomBlock(); if (b) { const [x, y] = s.pos(b); this.P({x, y, h: Math.max(0, this.deckH(s, b.lx, b.ly)), vx: 0, vy: 0, vh: 6 + rng() * 6, life: 2 + rng() * 2, size: 8 + rng() * 6, c: C.dsmoke, a: 0.6, grow: 2}); } }
        return;
      }
      const [rx, ry] = [Math.cos(s.a), Math.sin(s.a)];
      if (Math.abs(s.speed) > 8) {
        const sp = Math.min(1, Math.abs(s.speed) / 90);
        if (rng() < sp) { const [wx, wy] = s.l2w((rng() - .5) * 12, s.sternLy + 2); this.P({x: wx, y: wy, h: 0, vx: (rng() - .5) * 8, vy: (rng() - .5) * 8, vh: 0, life: 2.5 + rng() * 1.5, size: 3 + rng() * 2, c: C.foam, a: 0.35, surf: true, grow: 1.3}); }
        if (rng() < sp * 0.8) for (const side of [-1, 1]) { const [wx, wy] = s.l2w(side * Math.min(8, s.beam * 0.3), s.bowLy + 4); this.P({x: wx, y: wy, h: 0, vx: rx * side * 14 * sp, vy: ry * side * 14 * sp, vh: 0, life: 2 + rng(), size: 2 + rng() * 1.5, c: C.foam, a: 0.4, surf: true, grow: 1.2}); }
      }
      for (const e of s.engines) if (rng() < 0.05 + 0.13 * Math.abs(s.throttle)) {
        const [x, y] = s.pos(e);
        this.P({x, y, h: this.deckH(s, e.lx, e.ly, DECK + 9.5), vx: -s.vx * 0.6 + (rng() - .5) * 6, vy: -s.vy * 0.6 + (rng() - .5) * 6, vh: 8 + rng() * 5, life: 2 + rng(), size: 4 + rng() * 2, c: C.fsmoke, a: 0.35, grow: 2.4});
      }
      // damage, fire, repair
      if (rng() < 0.4) {
        const b = s.randomBlock();
        if (b && (b.hp < b.max * 0.6 || b.fire > 0)) {
          const [x, y] = s.pos(b), h = this.deckH(s, b.lx, b.ly) + 1, bad = b.hp < b.max * 0.3 || b.fire > 0;
          this.P({x, y, h, vx: (rng() - .5) * 6 - s.vx * 0.3, vy: (rng() - .5) * 6 - s.vy * 0.3, vh: 8 + rng() * 6, life: 2 + rng() * 1.5, size: 5 + rng() * 3, c: bad ? C.dsmoke : C.smoke, a: 0.6, grow: 2});
        }
      }
      for (const b of s.blocks) {
        if (!b.alive) continue;
        if (b.fire > 0 && rng() < 0.5) {
          const [x, y] = s.pos(b), h = this.deckH(s, b.lx, b.ly) + 1;
          this.G({x: x + (rng() - .5) * 6, y: y + (rng() - .5) * 6, h, vx: -s.vx * 0.2, vy: -s.vy * 0.2, vh: 6 + rng() * 8, life: 0.3 + rng() * 0.4, size: 4 + rng() * 4, c: C.fire, a: 1, shrink: true});
          if (rng() < 0.3) this.P({x, y, h: h + 3, vx: -s.vx * 0.3, vy: -s.vy * 0.3, vh: 10 + rng() * 6, life: 2.5, size: 6, c: C.dsmoke, a: 0.6, grow: 2.2});
        }
        if (b.repairFx > 0 && rng() < 0.3) { const [x, y] = s.pos(b); this.G({x, y, h: this.deckH(s, b.lx, b.ly) + 2, vx: 0, vy: 0, vh: 6, life: 0.5, size: 2.5, c: C.repair, a: 1}); }
      }
    }

    projectiles(world, t) {
      const m = this.m;
      const stream = (pool, list, fn) => {
        let i = 0;
        for (const it of list) { fn(it, m.tmp); if (i >= pool.n) pool.alloc(); pool.set(i, m.tmp); i++; }
        for (let j = i; j < pool.n; j++) pool.set(j, Gfx_zero);
      };
      const shellPool = this.pools.get('shell', 'shell', false);
      stream(shellPool, world.shells, (sh, out) => {
        const f = Math.min(1, sh.t / sh.T), h = DECK + 2 - 2 * f + 4 * sh.apex * f * (1 - f);
        const x = sh.x0 + (sh.tx - sh.x0) * f, y = sh.y0 + (sh.ty - sh.y0) * f, sc = sh.heavy ? 1.6 : 1;
        out.makeScale(sc, sc, sc).setPosition(x, h, y);
        if (Math.random() < (sh.heavy ? 0.9 : 0.35)) this.G({x, y, h, vx: 0, vy: 0, vh: 0, life: 0.12, size: sh.heavy ? 4 : 2.5, c: C.tracer, a: 0.8});
      });
      const up = new V3(0, 0, -1), dir = new V3();
      stream(this.pools.get('rocket', 'missile', false), world.rockets, (r, out) => {
        dir.set(r.tx - r.x0, 0, r.ty - r.y0).normalize();
        out.makeRotationFromQuaternion(m.q.setFromUnitVectors(up, dir)).setPosition(r.x, r.h, r.y);
        if (Math.random() < 0.7) { this.P({x: r.x, y: r.y, h: r.h, vx: 0, vy: 0, vh: 1, life: 0.8, size: 2.5, c: C.fsmoke, a: 0.5, grow: 1.4}); this.G({x: r.x, y: r.y, h: r.h, vx: 0, vy: 0, vh: 0, life: 0.06, size: 3, c: C.fire, a: 1}); }
      });
      stream(this.pools.get('missile', 'missile', true), world.missiles, (ms, out) => {
        dir.set(ms.x - (ms.px ?? ms.x), ms.h - (ms.ph ?? ms.h - 1), ms.y - (ms.py ?? ms.y));
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
        out.makeRotationFromQuaternion(m.q.setFromUnitVectors(up, dir.normalize())).setPosition(ms.x, ms.h, ms.y);
        const [fx, fy] = Util.fwd(ms.a);
        this.P({x: ms.x - fx * 3, y: ms.y - fy * 3, h: ms.h, vx: (Math.random() - .5) * 6, vy: (Math.random() - .5) * 6, vh: Math.random() * 4, life: 0.8 + Math.random() * 0.7, size: 2.5 + Math.random() * 1.5, c: C.fsmoke, a: 0.6, grow: 1.5});
        this.G({x: ms.x - fx * 4, y: ms.y - fy * 4, h: ms.h, vx: 0, vy: 0, vh: 0, life: 0.08, size: 5, c: C.fire, a: 1});
      });
      stream(this.pools.get('torp', 'torp', false), world.torps, (tp, out) => {
        out.makeRotationY(-tp.a).setPosition(tp.x, waveH(tp.x, tp.y, t) - 1.6, tp.y);
        if (Math.random() < 0.7) this.P({x: tp.x, y: tp.y, h: 0, vx: 0, vy: 0, vh: 0, life: 3, size: 3.5, c: C.foam, a: 0.55, surf: true, grow: 1.5});
      });
      // smoke screens keep billowing while they last
      for (const c of world.smokes) {
        const left = 1 - c.t / c.life;
        if (Math.random() < 0.9 * left) {
          const a = Math.random() * Util.TAU, r = Math.random() * c.r * 0.8;
          this.P({x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, h: 2 + Math.random() * 10, vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 4, vh: 1 + Math.random() * 2, life: 3.5 + Math.random() * 2, size: 22 + Math.random() * 16, c: C.screen, a: 0.5, grow: 0.6, fadeIn: true});
        }
      }
    }

    // ---------------------------------------------------------- debris and beams
    spawnDebris(x, y, h, vx, vy, opts = {}) {
      const pool = this.pools.get('debris', opts.mat || 'debris');
      if (this.debris.length > 140) { const old = this.debris.shift(); old.pool.release(old.i); }
      const d = {pool, i: pool.alloc(), x, y, h, vx: vx + (Math.random() - .5) * 50 * (opts.k ?? 1), vy: vy + (Math.random() - .5) * 50 * (opts.k ?? 1),
                 vh: opts.vh ?? 20 + Math.random() * 25, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - .5) * 8,
                 s: opts.scale || 0.5 + Math.random() * 0.6, life: opts.life || 4, wet: false};
      this.debris.push(d);
    }
    updateDebris(dt, t) {
      const m = this.m;
      for (let i = this.debris.length - 1; i >= 0; i--) {
        const d = this.debris[i]; d.life -= dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.h += d.vh * dt; d.vx *= 0.98; d.vy *= 0.98;
        const wh = waveH(d.x, d.y, t);
        if (d.h > wh) d.vh -= 70 * dt;
        else { d.vh = Math.max(d.vh * 0.8 - 6 * dt, -4); if (!d.wet) { d.wet = true; this.splash(d.x, d.y, 0.5); } }
        d.rx += d.spin * dt; d.ry += d.spin * 0.5 * dt;
        if (d.life <= 0 || d.h < wh - 12) { d.pool.release(d.i); this.debris.splice(i, 1); continue; }
        m.e.set(d.rx, d.ry, 0); m.q.setFromEuler(m.e);
        m.tmp.compose(m.v.set(d.x, d.h, d.y), m.q, this.m.sc.set(d.s, d.s, d.s));
        d.pool.set(d.i, m.tmp);
      }
    }
    beam(x0, y0, h0, x1, y1, h1) {
      let b = this.beams.find(b => b.t <= 0);
      if (!b) {
        if (this.beams.length >= 6) b = this.beams[0];
        else { const mat = Gfx.MAT.beam.clone(); const mesh = new THREE.Mesh(Gfx.GEO.beam, mat); mesh.frustumCulled = false; this.root.add(mesh); b = {mesh, t: 0}; this.beams.push(b); }
      }
      const a = new V3(x0, h0, y0), c = new V3(x1, h1, y1), len = a.distanceTo(c);
      b.mesh.position.copy(a); b.mesh.lookAt(c); b.mesh.scale.set(1, 1, len);
      b.t = 0.35; b.mesh.visible = true;
    }
    updateBeams(dt) {
      for (const b of this.beams) {
        if (b.t <= 0) { b.mesh.visible = false; continue; }
        b.t -= dt; b.mesh.material.opacity = Math.max(0, b.t / 0.35);
        b.mesh.scale.x = b.mesh.scale.y = 0.5 + b.t * 3;
      }
    }

    // ---------------------------------------------------------- effect recipes
    explosion(x, y, h, k = 1) {
      this.G({x, y, h, vx: 0, vy: 0, vh: 0, life: 0.18, size: 26 * k, c: C.flash, a: 1});
      for (let i = 0; i < 10 * k; i++) { const a = Math.random() * Util.TAU, v = (10 + Math.random() * 40) * k;
        this.G({x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: (5 + Math.random() * 30) * k, life: 0.3 + Math.random() * 0.4, size: (5 + Math.random() * 5) * k, c: C.fire, a: 1, shrink: true, grav: 20}); }
      for (let i = 0; i < 7 * k; i++) { const a = Math.random() * Util.TAU, v = (4 + Math.random() * 14) * k;
        this.P({x, y, h: h + 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 6 + Math.random() * 10, life: 1.5 + Math.random() * 1.5, size: (7 + Math.random() * 6) * k, c: C.dsmoke, a: 0.75, grow: 1.6}); }
      for (let i = 0; i < 5 * k; i++) { const a = Math.random() * Util.TAU, v = (20 + Math.random() * 40) * k;
        this.P({x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 20 + Math.random() * 35, life: 0.8 + Math.random() * 0.6, size: 1.6, c: C.dark, a: 1, grav: 90}); }
      if (k >= 0.9) this.env.flashLight(x, h, y, Math.min(2, k));
    }
    splash(x, y, k = 1) {
      const h = waveH(x, y, this.t);
      for (let i = 0; i < 14 * k; i++) { const a = Math.random() * Util.TAU, v = (1 + Math.random() * 6) * k;
        this.P({x: x + (Math.random() - .5) * 2 * k, y: y + (Math.random() - .5) * 2 * k, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: (25 + Math.random() * 45) * Math.sqrt(k), life: 1 + Math.random() * 0.8, size: (2.5 + Math.random() * 2.5) * k, c: C.white, a: 0.9, grav: 75, drag: 0.99}); }
      for (let i = 0; i < 6; i++) { const a = Math.random() * Util.TAU, v = (8 + Math.random() * 12) * k;
        this.P({x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 0, life: 1.5 + Math.random(), size: (4 + Math.random() * 3) * k, c: C.foam, a: 0.5, surf: true, grow: 1.2}); }
    }
    muzzleFlash(x, y, h, ang, k = 1, sv = [0, 0]) {
      const [fx, fy] = Util.fwd(ang);
      this.G({x, y, h, vx: fx * 40, vy: fy * 40, vh: 0, life: 0.12, size: 8 * k, c: C.flash, a: 1});
      for (let i = 0; i < 2 + 3 * (k - 1); i++) this.P({x: x + fx * 3, y: y + fy * 3, h, vx: fx * (8 + Math.random() * 17) + sv[0] * 0.5, vy: fy * (8 + Math.random() * 17) + sv[1] * 0.5, vh: 1 + Math.random() * 4, life: 1 + Math.random(), size: (3 + Math.random() * 2) * k, c: C.fsmoke, a: 0.5, grow: 1.8});
    }

    // Translate one simulation event into visuals. Returns nothing; sound is the caller's job.
    onEvent(e) {
      const s = e.ship;
      switch (e.type) {
        case 'fire': {
          if (!s || !s.viz) break;
          const [x, y, h] = this.muzzle(s, e.block);
          if (e.kind === 'missile') {
            this.G({x, y, h, vx: 0, vy: 0, vh: 0, life: 0.25, size: 12, c: C.flash, a: 1});
            for (let i = 0; i < 6; i++) this.P({x, y, h, vx: (Math.random() - .5) * 30, vy: (Math.random() - .5) * 30, vh: Math.random() * 6, life: 1.5 + Math.random(), size: 5 + Math.random() * 3, c: C.fsmoke, a: 0.6, grow: 1.5});
          } else if (e.kind === 'torp') this.splash(x, y, 0.8);
          else if (e.kind !== 'rockets') {
            const big = e.kind === 'heavy';
            this.muzzleFlash(x, y, h, e.ang, big ? 2 : 1, [s.vx, s.vy]);
            if (big) this.env.flashLight(x, h, y, 0.8);
          }
          break;
        }
        case 'rocket': { if (s && s.viz) { const [x, y, h] = this.muzzle(s, e.block); this.G({x, y, h, vx: 0, vy: 0, vh: 0, life: 0.1, size: 7, c: C.flash, a: 1}); } break; }
        case 'hit': this.explosion(e.x, e.y, (s && s.viz ? s.viz.bob : 0) + DECK + 1, e.size || 0.6); break;
        case 'torpHit': this.explosion(e.x, e.y, s && s.viz ? s.viz.bob : 0, 1.5); this.splash(e.x, e.y, 3.2); break;
        case 'splash': this.splash(e.x, e.y, e.size || 1); break;
        case 'explosion': this.explosion(e.x, e.y, e.h != null ? e.h : (s && s.viz ? s.viz.bob : 0) + DECK + 2, e.size || 1); break;
        case 'blockLost': {
          const h = s && s.viz ? this.deckH(s, e.block.lx, e.block.ly) : DECK;
          this.explosion(e.x, e.y, h, 0.8);
          for (let i = 0; i < 2; i++) this.spawnDebris(e.x, e.y, h, s.vx * 0.5, s.vy * 0.5);
          if (s.viz) this.removeBlock(s.viz, e.block);
          break;
        }
        case 'detached': {
          const h = s && s.viz ? this.deckH(s, e.block.lx, e.block.ly) : DECK;
          this.spawnDebris(e.x, e.y, h, s.vx * 0.5, s.vy * 0.5, {mat: 'side', scale: 2.2, vh: 2, k: 0.25, life: 6});
          if (s.viz) this.removeBlock(s.viz, e.block);
          break;
        }
        case 'blockRestored': if (s && s.viz) this.addBlock(s.viz, e.block); break;
        case 'sink': this.explosion(e.x, e.y, (s && s.viz ? s.viz.bob : 0) + DECK + 4, 2.2); break;
        case 'rail': {
          const h0 = s && s.viz ? this.deckH(s, e.block.lx, e.block.ly, DECK + 2) : DECK + 2;
          this.beam(e.x0, e.y0, h0, e.x1, e.y1, DECK + 1);
          this.G({x: e.x0, y: e.y0, h: h0, vx: 0, vy: 0, vh: 0, life: 0.2, size: 14, c: C.rail, a: 1});
          for (let i = 0; i < 6; i++) { const f = Math.random(); this.G({x: e.x0 + (e.x1 - e.x0) * f, y: e.y0 + (e.y1 - e.y0) * f, h: h0 + (DECK + 1 - h0) * f, vx: (Math.random() - .5) * 10, vy: (Math.random() - .5) * 10, vh: Math.random() * 6, life: 0.4, size: 3, c: C.rail, a: 1}); }
          break;
        }
        case 'ciws': {
          const h0 = s && s.viz ? this.deckH(s, e.block.lx, e.block.ly, DECK + 2.6) : DECK + 2.6;
          for (let k = 0; k < 3; k++) { const f = 0.2 + Math.random() * 0.8; this.G({x: e.x + (e.tx - e.x) * f, y: e.y + (e.ty - e.y) * f, h: h0 + (e.th - h0) * f, vx: 0, vy: 0, vh: 0, life: 0.06, size: 2.2, c: C.tracer, a: 1}); }
          break;
        }
        case 'intercept': this.explosion(e.x, e.y, e.h, 0.5); break;
        case 'smoke': for (let i = 0; i < 20; i++) { const a = Math.random() * Util.TAU, r = Math.random() * e.r * 0.5; this.P({x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, h: 3 + Math.random() * 8, vx: Math.cos(a) * 12, vy: Math.sin(a) * 12, vh: 2, life: 4 + Math.random() * 2, size: 18 + Math.random() * 14, c: C.screen, a: 0.6, grow: 0.8, fadeIn: true}); } break;
      }
    }

    clear() {
      this.clearShips();
      for (const d of this.debris) d.pool.release(d.i);
      this.debris.length = 0;
      for (const b of this.beams) { b.t = 0; b.mesh.visible = false; }
      this.particles.clear(); this.glow.clear();
      this.pools.clear();
    }
  }

  const Gfx_zero = new M4().makeScale(0, 0, 0);
  let matsReady = false;
  function MAT_ARRAYS() {
    if (matsReady) return;
    Gfx.MAT.hullMats = [Gfx.MAT.deck, Gfx.MAT.side];
    Gfx.MAT.armorMats = [Gfx.MAT.armorDeck, Gfx.MAT.armorSide];
    matsReady = true;
  }

  return Viz;
})();
