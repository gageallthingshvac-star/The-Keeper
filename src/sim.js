// The battle simulation. Pure logic in a 2D plane (x, y) — no DOM, no THREE.
// Rendering and audio react to `world.events`, which the caller drains every frame.
const Sim = (() => {
  const {PARTS} = Data;
  const {TAU, clamp, wrapA, headingTo, fwd, turnToward} = Util;

  const S = 10;          // world units per block
  const DECK = 3;        // deck height above the waterline (for projectile heights)
  const FIELD = 1500;    // half-size of the playable square
  const SHELL_ARC = 42;  // visual apex of a shell = SHELL_ARC * T² + 2
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const PLAYER_PROFILE = {acc: 1, reload: 1, lead: 1, smartAim: false};

  // ---------------------------------------------------------------- ship
  class Ship {
    constructor(world, design, o) {
      this.world = world;
      this.id = world.nextId++;
      this.team = o.team; this.name = o.name || 'Ship'; this.kind = o.kind || 'custom';
      this.x = o.x; this.y = o.y; this.a = o.a || 0;
      this.vx = 0; this.vy = 0; this.speed = 0; this.throttle = 0; this.rudder = 0;
      this.mods = Object.assign({hp: 1, reload: 1, thrust: 1, spread: 1, repair: 1, fire: 1}, o.mods || {});
      this.prof = o.profile || PLAYER_PROFILE;
      this.brain = o.brain || null;
      this.target = null;
      this.w = design.w; this.h = design.h;
      this.blocks = []; this.map = new Array(design.w * design.h).fill(null);
      let sc = 0, sr = 0;
      design.cells.forEach((t, i) => {
        if (!t) return;
        const c = i % design.w, r = (i / design.w) | 0, P = PARTS[t];
        const hp = P.hp * this.mods.hp;
        const b = {t, c, r, i, hp, max: hp, alive: true, fire: 0, ship: this,
                   ang: this.a, elev: 0, cd: world.rng.range(0.3, 1.5), aimB: null, aimShip: null, salvo: 0, salvoT: 0};
        this.blocks.push(b); this.map[i] = b; sc += c; sr += r;
      });
      const n = this.blocks.length;
      this.cx = sc / n; this.cy = sr / n;
      let rad = 0, minR = 1e9, maxR = -1e9, minC = 1e9, maxC = -1e9;
      for (const b of this.blocks) {
        b.lx = (b.c - this.cx) * S; b.ly = (b.r - this.cy) * S;
        rad = Math.max(rad, Math.hypot(b.lx, b.ly));
        minR = Math.min(minR, b.r); maxR = Math.max(maxR, b.r); minC = Math.min(minC, b.c); maxC = Math.max(maxC, b.c);
      }
      this.rad = rad + S * 0.8; this.len = (maxR - minR + 1) * S; this.beam = (maxC - minC + 1) * S;
      this.sternLy = (maxR - this.cy + 0.5) * S; this.bowLy = (minR - this.cy - 0.5) * S;
      this.startCount = n;
      this.sinking = false; this.sinkT = 0; this.dead = false; this.dirty = false;
      this.abandonT = 0; this.ramCd = 0; this.smokeCd = 0; this.recentDmg = 0; this.lastHitBy = null; this.repairT = 0;
      this.dmgDealt = 0; this.kills = 0;
      this.recompute(true);
      this.m0 = this.moments();
      this.startMargin = Math.max(1, this.buoy - this.mass);
      this.startHp = this.blocks.reduce((s, b) => s + b.max, 0);
    }
    recompute(first) {
      let m = 0, bu = 0, th = 0, ru = 0, n = 0, range = 0, radars = 0;
      this.weapons = []; this.utils = []; this.engines = []; this.bridge = null;
      for (const b of this.blocks) {
        if (!b.alive) continue;
        const P = PARTS[b.t];
        m += P.mass; bu += P.buoy; th += (P.thrust || 0) * this.mods.thrust; ru += P.turn || 0; n++;
        if (P.weapon) this.weapons.push(b);
        if (P.util) { this.utils.push(b); if (P.util.type === 'radar') radars++; }
        if (b.t === 'engine') this.engines.push(b);
        if (b.t === 'bridge') this.bridge = b;
      }
      radars = Math.min(radars, PARTS.radar.util.max);
      this.rangeMul = 1 + radars * PARTS.radar.util.range;
      this.spreadMul = (1 - radars * PARTS.radar.util.spread) * this.mods.spread;
      for (const b of this.weapons) { const W = PARTS[b.t].weapon; if (W.dmg && W.type !== 'air') range = Math.max(range, W.range * this.rangeMul); }
      this.mass = m; this.buoy = bu; this.thrust = th; this.rudders = ru; this.count = n; this.range = range;
      this.maxSpeed = Design.calcSpeed(m, th); this.turnRate = Design.calcTurn(m, ru);
      this.armed = this.weapons.some(b => PARTS[b.t].weapon.dmg);
      this.hasAir = this.weapons.some(b => b.t === 'hangar');
      this.hasSmoke = this.utils.some(b => b.t === 'smoke');
      this.hasRepair = this.utils.some(b => b.t === 'repair');
      if (!first && bu > 0) {
        const mm = this.moments();
        this.listRoll = clamp(-(mm.mx - this.m0.mx) / bu * 0.05, -0.4, 0.4);
        this.listPitch = clamp(-(mm.my - this.m0.my) / bu * 0.03, -0.25, 0.25);
      } else { this.listRoll = 0; this.listPitch = 0; }
    }
    moments() {
      let mx = 0, my = 0;
      for (const b of this.blocks) { if (!b.alive) continue; const P = PARTS[b.t], f = P.buoy - P.mass; mx += f * b.lx; my += f * b.ly; }
      return {mx, my};
    }
    get integrity() { return this.dead ? 0 : this.count / this.startCount; }
    get reserve() { return clamp((this.buoy - this.mass) / this.startMargin, 0, 1); }
    l2w(lx, ly) { const c = Math.cos(this.a), s = Math.sin(this.a); return [this.x + lx * c - ly * s, this.y + lx * s + ly * c]; }
    w2l(x, y) { const dx = x - this.x, dy = y - this.y, c = Math.cos(this.a), s = Math.sin(this.a); return [dx * c + dy * s, -dx * s + dy * c]; }
    pos(b) { return this.l2w(b.lx, b.ly); }
    blockAt(x, y) {
      const [lx, ly] = this.w2l(x, y);
      const c = Math.round(lx / S + this.cx), r = Math.round(ly / S + this.cy);
      if (c < 0 || r < 0 || c >= this.w || r >= this.h) return null;
      const b = this.map[c + r * this.w];
      return b && b.alive ? b : null;
    }
    live() { return this.blocks.filter(b => b.alive); }
    randomBlock() { const L = this.live(); return L.length ? this.world.rng.pick(L) : null; }
    // Smart aim: bridge, engines and weapons are worth more.
    valuableBlock() {
      const L = this.live(); if (!L.length) return null;
      let total = 0; const w = L.map(b => { const v = b.t === 'bridge' ? 6 : b.t === 'engine' ? 3 : PARTS[b.t].weapon ? 2.5 : 1; total += v; return v; });
      let x = this.world.rng() * total;
      for (let i = 0; i < L.length; i++) { x -= w[i]; if (x <= 0) return L[i]; }
      return L[L.length - 1];
    }
  }

  // ---------------------------------------------------------------- world
  class World {
    constructor(o = {}) {
      this.rng = o.rng || Util.rng();
      this.weather = Data.WEATHER[o.weather || 'clear'];
      this.t = 0; this.nextId = 1;
      this.ships = []; this.shells = []; this.missiles = []; this.rockets = []; this.torps = []; this.planes = []; this.bombs = [];
      this.smokes = []; this.booms = []; this.events = [];
      this.stats = {shots: 0, hits: 0, dmg: 0, taken: 0, sunk: 0, sunkCost: 0, planesDown: 0};
      this.player = null;
    }
    emit(type, d) { d.type = type; this.events.push(d); }
    drain() { const e = this.events; this.events = []; return e; }

    addShip(design, o) {
      const s = new Ship(this, design, o);
      this.ships.push(s);
      if (o.player) this.player = s;
      return s;
    }
    foes(team) { return this.ships.filter(s => s.team !== team && !s.sinking && !s.dead); }
    nearestFoe(team, x, y, maxD = 1e9) {
      let best = null, bd = maxD;
      for (const o of this.ships) {
        if (o.team === team || o.sinking || o.dead) continue;
        const d = Math.hypot(o.x - x, o.y - y) - o.rad * 0.5;
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    inSmoke(x, y) { for (const c of this.smokes) if (Math.hypot(c.x - x, c.y - y) < c.r) return true; return false; }

    // ---------------------------------------------------------- step
    step(dt) {
      this.t += dt;
      for (const s of this.ships) {
        if (s.brain && !s.sinking) s.brain.update(this, s, dt);
        this.physics(s, dt);
        if (!s.sinking) { this.weapons(s, dt); this.utilities(s, dt); }
        this.fires(s, dt);
        s.recentDmg *= Math.exp(-dt * 0.5);
        // An enemy with nothing left to shoot with is abandoned by its crew.
        if (!s.sinking && s !== this.player && !s.armed) {
          if (s.abandonT === 0) this.emit('abandon', {ship: s});
          s.abandonT += dt;
          if (s.abandonT > 8) this.sink(s);
        }
        if (s.sinking) { s.sinkT += dt / 5; if (s.sinkT >= 1) s.dead = true; }
      }
      this.collisions();
      this.stepShells(dt); this.stepRockets(dt); this.stepMissiles(dt); this.stepTorps(dt); this.stepPlanes(dt); this.stepBombs(dt);
      for (let i = this.booms.length - 1; i >= 0; i--) {
        const b = this.booms[i]; b.delay -= dt;
        if (b.delay > 0) continue;
        this.booms.splice(i, 1);
        if (b.s.dead) continue;
        this.emit('explosion', {x: b.x, y: b.y, size: 1.4, ship: b.s, secondary: true});
        this.damageRadius(b.s, b.x, b.y, b.r, b.dmg, b.attacker, true);
      }
      for (const s of this.ships) if (s.dirty) this.settle(s);
      for (let i = this.smokes.length - 1; i >= 0; i--) { const c = this.smokes[i]; c.t += dt; if (c.t > c.life) this.smokes.splice(i, 1); }
      this.ships = this.ships.filter(s => !s.dead);
    }

    physics(s, dt) {
      const target = s.sinking ? 0 : s.throttle * s.maxSpeed;
      const acc = Math.max(8, s.maxSpeed * 0.35);
      if (s.speed < target) s.speed = Math.min(target, s.speed + acc * dt);
      else s.speed = Math.max(target, s.speed - acc * 1.3 * dt);
      const turnEff = 0.3 + 0.7 * Math.min(1, Math.abs(s.speed) / Math.max(30, s.maxSpeed * 0.6));
      if (!s.sinking) s.a = wrapA(s.a + s.rudder * s.turnRate * turnEff * dt * (s.speed < 0 ? -1 : 1));
      // Velocity chases the heading: ships carry a little momentum through turns.
      const [fx, fy] = fwd(s.a), grip = Math.min(1, dt * 2.2);
      s.vx += (fx * s.speed - s.vx) * grip; s.vy += (fy * s.speed - s.vy) * grip;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (Math.abs(s.x) > FIELD) { s.x = Math.sign(s.x) * FIELD; s.vx *= 0.5; s.speed *= 0.97; }
      if (Math.abs(s.y) > FIELD) { s.y = Math.sign(s.y) * FIELD; s.vy *= 0.5; s.speed *= 0.97; }
      if (s.ramCd > 0) s.ramCd -= dt;
    }

    // ---------------------------------------------------------- weapons
    pickTarget(s, wx, wy, range) {
      const t = s.target;
      if (t && !t.sinking && !t.dead && Math.hypot(t.x - wx, t.y - wy) - t.rad * 0.5 < range) return t;
      return this.nearestFoe(s.team, wx, wy, range);
    }
    spreadFor(s, target, wx, wy) {
      let m = s.prof.acc * s.spreadMul * this.weather.spread;
      if (this.inSmoke(target.x, target.y)) m *= 2.2;
      if (this.inSmoke(wx, wy)) m *= 1.3;
      return m;
    }
    weapons(s, dt) {
      const rng = this.rng;
      for (const w of s.weapons) {
        if (!w.alive) continue;
        const W = PARTS[w.t].weapon;
        w.cd -= dt;
        const [wx, wy] = s.pos(w);

        if (W.type === 'ciws' || W.type === 'aa') { this.pointDefense(s, w, W, wx, wy, dt); continue; }
        if (W.type === 'air') { this.hangar(s, w, W, wx, wy); continue; }
        // a rocket salvo in progress keeps firing at its locked point
        if (w.salvo > 0) {
          w.salvoT -= dt;
          if (w.salvoT <= 0) { w.salvo--; w.salvoT = 0.09; this.launchRocket(s, w, W, wx, wy); }
          continue;
        }
        const range = W.range * s.rangeMul;
        const t = this.pickTarget(s, wx, wy, range);
        if (!t) { w.ang = turnToward(w.ang, s.a, 1.5 * dt); w.elev *= 0.97; continue; }
        if (!w.aimB || !w.aimB.alive || w.aimShip !== t) { w.aimB = s.prof.smartAim ? t.valuableBlock() : t.randomBlock(); w.aimShip = t; }
        if (!w.aimB) continue;
        let [tx, ty] = t.pos(w.aimB);
        const d0 = Math.hypot(tx - wx, ty - wy);
        if (W.speed && W.type !== 'missile') { const lead = d0 / W.speed * s.prof.lead; tx += t.vx * lead; ty += t.vy * lead; }
        const desired = headingTo(tx - wx, ty - wy);
        if (W.type !== 'missile') w.ang = turnToward(w.ang, desired, (w.t === 'superheavy' ? 1.0 : w.t === 'heavy' || w.t === 'rail' ? 1.4 : 3.5) * dt);
        const d = Math.hypot(tx - wx, ty - wy);
        if (W.type === 'shell' || W.type === 'rockets') {
          const T = d / W.speed, apex = SHELL_ARC * T * T + 2;
          w.elev += (Math.atan2(4 * apex, Math.max(1, d)) - w.elev) * Math.min(1, dt * 4);
        } else if (W.type === 'rail') w.elev *= 0.9;
        const aligned = W.type === 'missile' || Math.abs(wrapA(desired - w.ang)) < 0.1;
        if (w.cd > 0 || !aligned) continue;

        w.cd = W.reload * rng.range(0.9, 1.15) * s.prof.reload / s.mods.reload;
        if (s === this.player) this.stats.shots++;
        const sp = d * (W.spread || 0) * this.spreadFor(s, t, wx, wy);
        const ex = rng.gauss() * sp, ey = rng.gauss() * sp;
        switch (W.type) {
          case 'shell': {
            const [fx, fy] = fwd(w.ang);
            const mx = wx + fx * 8, my = wy + fy * 8, T = d / W.speed;
            this.shells.push({x0: mx, y0: my, tx: tx + ex, ty: ty + ey, t: 0, T, apex: SHELL_ARC * T * T + 2,
              dmg: W.dmg, splash: W.splash, team: s.team, owner: s, heavy: w.t === 'heavy' || w.t === 'superheavy'});
            this.emit('fire', {kind: w.t, ship: s, block: w, x: mx, y: my, ang: w.ang});
            break;
          }
          case 'torp': {
            w.ang = desired + rng.gauss() * 0.05 * s.prof.acc;
            const [fx, fy] = fwd(w.ang);
            this.torps.push({x: wx + fx * 6, y: wy + fy * 6, vx: fx * W.speed, vy: fy * W.speed, a: w.ang,
              life: range / W.speed, dmg: W.dmg, splash: W.splash, team: s.team, owner: s});
            this.emit('fire', {kind: 'torp', ship: s, block: w, x: wx + fx * 8, y: wy + fy * 8, ang: w.ang});
            break;
          }
          case 'missile': {
            this.missiles.push({x: wx, y: wy, h: DECK + 1.6, a: desired, speed: 25, max: W.speed, age: 0,
              life: range / W.speed * 1.8, dmg: W.dmg, splash: W.splash, team: s.team, owner: s, tgt: t, b: w.aimB, hp: 3});
            this.emit('fire', {kind: 'missile', ship: s, block: w, x: wx, y: wy, ang: desired});
            break;
          }
          case 'rockets': {
            if (s === this.player) this.stats.shots--; // each rocket counts as its own shot
            w.salvo = W.salvo; w.salvoT = 0; w.lockX = tx; w.lockY = ty; w.lockD = d; w.lockT = t;
            this.emit('fire', {kind: 'rockets', ship: s, block: w, x: wx, y: wy, ang: w.ang});
            break;
          }
          case 'rail': this.fireRail(s, w, W, wx, wy, tx + ex, ty + ey, range); break;
        }
        w.aimB = null; // next shot picks a fresh block
      }
    }
    launchRocket(s, w, W, wx, wy) {
      const rng = this.rng, d = w.lockD;
      const sp = d * W.spread * this.spreadFor(s, w.lockT || s, wx, wy);
      const tx = w.lockX + rng.gauss() * sp, ty = w.lockY + rng.gauss() * sp;
      const T = Math.hypot(tx - wx, ty - wy) / W.speed;
      if (s === this.player) this.stats.shots++;
      this.rockets.push({x0: wx, y0: wy, tx, ty, t: 0, T, apex: 14 + d * 0.06, x: wx, y: wy, h: DECK + 2,
        dmg: W.dmg, splash: W.splash, team: s.team, owner: s, hp: 1});
      this.emit('rocket', {ship: s, block: w, x: wx, y: wy});
    }
    fireRail(s, w, W, wx, wy, tx, ty, range) {
      const a = headingTo(tx - wx, ty - wy), [fx, fy] = fwd(a);
      let dmg = W.dmg, pierced = 0, ex = wx + fx * range, ey = wy + fy * range;
      const hitBlocks = new Set();
      for (let d = 10; d < range && pierced < W.pierce; d += S * 0.4) {
        const x = wx + fx * d, y = wy + fy * d;
        for (const o of this.ships) {
          if (o.team === s.team || o.sinking || o.dead) continue;
          const b = o.blockAt(x, y);
          if (b && !hitBlocks.has(b)) {
            hitBlocks.add(b);
            this.damageBlock(o, b, dmg, s, true);
            this.emit('hit', {x, y, size: 0.7, ship: o});
            dmg *= W.falloff; pierced++;
            if (s === this.player && pierced === 1) this.stats.hits++;
            if (pierced >= W.pierce) { ex = x; ey = y; }
          }
        }
      }
      if (!pierced) this.emit('splash', {x: tx, y: ty, size: 1.2});
      this.emit('rail', {ship: s, block: w, x0: wx + fx * 10, y0: wy + fy * 10, x1: ex, y1: ey});
    }
    // CIWS prefers missiles and rockets; AA guns prefer aircraft. Both will take what they can get.
    pointDefense(s, w, W, wx, wy, dt) {
      const aa = W.type === 'aa';
      let best = null, bd = W.range, bestPlane = false;
      const consider = (m, plane) => {
        if (m.team === s.team || m.hp <= 0) return;
        const d = Math.hypot(m.x - wx, m.y - wy);
        if (d >= W.range) return;
        // a preferred target type wins over a closer non-preferred one
        const pref = aa ? plane : !plane;
        const bestPref = best ? (aa ? bestPlane : !bestPlane) : false;
        if (!best || (pref && !bestPref) || (pref === bestPref && d < bd)) { best = m; bd = d; bestPlane = plane; }
      };
      for (const m of this.missiles) consider(m, false);
      for (const m of this.rockets) consider(m, false);
      for (const m of this.planes) consider(m, true);
      if (!best) { w.ang = turnToward(w.ang, s.a, 2 * dt); w.elev *= 0.95; return; }
      w.ang = turnToward(w.ang, headingTo(best.x - wx, best.y - wy), (aa ? 6 : 10) * dt);
      w.elev = Math.atan2(best.h - DECK - 2.6, Math.max(bd, 1));
      if (w.cd > 0) return;
      w.cd = W.reload * this.rng.range(0.85, 1.15);
      const chance = aa ? (bestPlane ? 0.45 : 0.15) : (bestPlane ? 0.3 : 0.4);
      const hit = this.rng() < chance;
      if (aa) this.emit('flak', {ship: s, block: w, x: best.x + this.rng.gauss() * 8, y: best.y + this.rng.gauss() * 8, h: best.h + this.rng.gauss() * 5, hit});
      else this.emit('ciws', {ship: s, block: w, x: wx, y: wy, tx: best.x, ty: best.y, th: best.h});
      if (!hit) return;
      best.hp--;
      if (best.hp > 0) return;
      if (bestPlane) this.planeDown(best, s);
      else this.emit('intercept', {x: best.x, y: best.y, h: best.h});
    }

    // ---------------------------------------------------------- aircraft
    // A hangar keeps W.maxAir planes in the air; each flies out, dive-bombs and comes home to rearm.
    hangar(s, w, W, wx, wy) {
      w.air = w.air || 0;
      if (w.cd > 0 || w.air >= W.maxAir) return;
      const t = this.pickTarget(s, wx, wy, W.range * s.rangeMul);
      if (!t) return;
      w.air++;
      w.sorties = (w.sorties || 0) + 1;
      w.cd = W.reload * this.rng.range(0.9, 1.1) * s.prof.reload / s.mods.reload;
      const p = {x: wx, y: wy, h: DECK + 3, a: s.a, speed: 40, hp: 3, team: s.team, owner: s, hangar: w, W,
                 tgt: t, b: s.prof.smartAim ? t.valuableBlock() : t.randomBlock(), state: 'out', fuel: 45, age: 0,
                 kind: (w.sorties + w.i) % 2 ? 'torpedo' : 'bomb'};
      this.planes.push(p);
      if (s === this.player) this.stats.shots++;
      this.emit('launch', {ship: s, block: w, x: wx, y: wy, plane: p});
    }
    stepPlanes(dt) {
      for (let i = this.planes.length - 1; i >= 0; i--) {
        const p = this.planes[i];
        p.age += dt; p.fuel -= dt;
        p.px = p.x; p.py = p.y; p.ph = p.h;
        if (p.hp <= 0) { this.planes.splice(i, 1); continue; }
        const homeOk = p.owner && !p.owner.sinking && !p.owner.dead && p.hangar.alive;
        if (p.fuel <= 0) { this.planeDown(p, null); this.planes.splice(i, 1); continue; }
        let tx, ty, th, spd = 150;
        if (p.state === 'out' || p.state === 'dive') {
          if (!p.tgt || p.tgt.sinking || p.tgt.dead) { p.tgt = this.nearestFoe(p.team, p.x, p.y, 1200); p.b = null; if (!p.tgt) { p.state = 'home'; continue; } }
          if (!p.b || !p.b.alive) p.b = p.tgt.randomBlock();
          if (!p.b) { p.state = 'home'; continue; }
          [tx, ty] = p.tgt.pos(p.b);
          const d = Math.hypot(tx - p.x, ty - p.y);
          if (p.kind === 'torpedo') {
            // torpedo bombers come in low and release well short of the target
            th = d < 420 ? 9 : 50; spd = d < 420 ? 165 : 150;
            if (d < 200 && Math.abs(wrapA(headingTo(tx - p.x, ty - p.y) - p.a)) < 0.35) { this.dropTorpedo(p); p.state = 'home'; }
            else if (d < 90) p.state = 'out';
          } else if (p.state === 'out') { th = 55; if (d < 170) { p.state = 'dive'; this.emit('dive', {x: p.x, y: p.y, plane: p}); } }
          if (p.state === 'dive') {
            th = 14; spd = 175;
            if (d < 30) { this.dropBomb(p, tx, ty); p.state = 'home'; }
          }
        } else {
          if (!homeOk) { // carrier gone: keep fighting until the tanks run dry
            p.tgt = this.nearestFoe(p.team, p.x, p.y, 1200);
            if (p.tgt && p.fuel > 8 && !p.dropped) { p.state = 'out'; continue; }
            tx = p.x + Math.sin(p.a) * 100; ty = p.y - Math.cos(p.a) * 100; th = 30;
          } else {
            [tx, ty] = p.owner.pos(p.hangar); th = 40;
            const d = Math.hypot(tx - p.x, ty - p.y);
            if (d < 120) th = DECK + 4 + d * 0.3;
            if (d < 18) { // landed: rearm for the next sortie
              p.hangar.air = Math.max(0, (p.hangar.air || 1) - 1);
              this.planes.splice(i, 1);
              this.emit('land', {ship: p.owner, x: tx, y: ty});
              continue;
            }
          }
        }
        p.speed = Math.min(spd, p.speed + 120 * dt);
        p.a = turnToward(p.a, headingTo(tx - p.x, ty - p.y), (p.state === 'dive' ? 2.2 : 1.6) * dt);
        p.h += clamp(th - p.h, -45 * dt, 25 * dt);
        const [fx, fy] = fwd(p.a);
        p.x += fx * p.speed * dt; p.y += fy * p.speed * dt;
        p.x = clamp(p.x, -FIELD * 1.2, FIELD * 1.2); p.y = clamp(p.y, -FIELD * 1.2, FIELD * 1.2);
      }
    }
    dropBomb(p, tx, ty) {
      const sp = p.W.spread * p.owner.prof.acc * this.weather.spread * (this.inSmoke(tx, ty) ? 2.2 : 1);
      this.bombs.push({x: p.x, y: p.y, h: p.h, x1: tx + this.rng.gauss() * sp, y1: ty + this.rng.gauss() * sp, t: 0, T: 0.7,
                       dmg: p.W.dmg, splash: p.W.splash, team: p.team, owner: p.owner});
      p.dropped = true;
      this.emit('bombDrop', {x: p.x, y: p.y, h: p.h});
    }
    dropTorpedo(p) {
      const t = p.tgt, [tx, ty] = t.pos(p.b), spd = Data.PARTS.torp.weapon.speed;
      const lead = Math.hypot(tx - p.x, ty - p.y) / spd;
      const a = headingTo(tx + t.vx * lead * p.owner.prof.lead - p.x, ty + t.vy * lead * p.owner.prof.lead - p.y) + this.rng.gauss() * 0.06 * p.owner.prof.acc;
      const [fx, fy] = fwd(a);
      this.torps.push({x: p.x, y: p.y, vx: fx * spd, vy: fy * spd, a, life: 420 / spd, dmg: p.W.torpDmg, splash: 10, team: p.team, owner: p.owner});
      p.dropped = true;
      this.emit('torpDrop', {x: p.x, y: p.y, h: p.h});
    }
    stepBombs(dt) {
      for (let i = this.bombs.length - 1; i >= 0; i--) {
        const b = this.bombs[i]; b.t += dt;
        const f = Math.min(1, b.t / b.T);
        b.cx = b.x + (b.x1 - b.x) * f; b.cy = b.y + (b.y1 - b.y) * f; b.ch = b.h * (1 - f * f);
        if (f < 1) continue;
        this.bombs.splice(i, 1);
        this.impact(b.x1, b.y1, b.dmg, b.splash, b.team, b.owner, 'bomb');
      }
    }
    planeDown(p, by) {
      p.hp = 0;
      if (p.hangar && p.hangar.air) p.hangar.air--;
      if (by === this.player || (by && by.team === 0 && p.team !== 0)) this.stats.planesDown++;
      this.emit('planeDown', {x: p.x, y: p.y, h: p.h, vx: Math.sin(p.a) * p.speed, vy: -Math.cos(p.a) * p.speed, team: p.team});
    }

    // ---------------------------------------------------------- utilities
    utilities(s, dt) {
      if (s.smokeCd > 0) s.smokeCd -= dt;
      if (!s.hasRepair) return;
      s.repairT -= dt;
      if (s.repairT > 0) return;
      s.repairT = 0.5;
      for (const u of s.utils) {
        if (!u.alive || u.t !== 'repair') continue;
        const U = PARTS.repair.util, R = U.radius;
        let worst = null, wf = 1;
        for (const b of s.blocks) {
          if (!b.alive) continue;
          const dc = b.c - u.c, dr = b.r - u.r;
          if (dc * dc + dr * dr > R * R) continue;
          if (b.fire > 0 && this.rng() < 0.35 * s.mods.repair) b.fire = 0;
          const f = b.hp / b.max;
          if (f < wf) { wf = f; worst = b; }
        }
        if (worst) { worst.hp = Math.min(worst.max, worst.hp + U.rate * 0.5 * s.mods.repair); worst.repairFx = 0.6; }
      }
    }
    deploySmoke(s) {
      if (!s.hasSmoke || s.smokeCd > 0 || s.sinking) return false;
      const U = PARTS.smoke.util;
      s.smokeCd = U.cooldown;
      this.smokes.push({x: s.x, y: s.y, r: U.radius, t: 0, life: U.duration, owner: s});
      this.emit('smoke', {ship: s, x: s.x, y: s.y, r: U.radius, life: U.duration});
      return true;
    }

    // ---------------------------------------------------------- fire
    ignite(s, b, chance) {
      if (!b.alive || b.fire > 0) return;
      if (this.rng() < chance * (b.t === 'armor' ? 0.35 : 1)) b.fire = this.rng.range(6, 10) / s.mods.fire;
    }
    fires(s, dt) {
      if (s.sinking) return;
      for (const b of s.blocks) {
        if (!b.alive || b.fire <= 0) continue;
        b.fire -= dt;
        this.damageBlock(s, b, 3 * dt, s.lastHitBy, false, true);
        if (this.rng() < 0.05 * dt) {
          const [dc, dr] = this.rng.pick(DIRS), n = s.map[(b.c + dc) + (b.r + dr) * s.w];
          if (b.c + dc >= 0 && b.c + dc < s.w && n) this.ignite(s, n, 1);
        }
      }
    }

    // ---------------------------------------------------------- projectiles
    stepShells(dt) {
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const sh = this.shells[i]; sh.t += dt;
        if (sh.t < sh.T) continue;
        this.shells.splice(i, 1);
        this.impact(sh.tx, sh.ty, sh.dmg, sh.splash, sh.team, sh.owner, sh.heavy ? 'heavy' : 'shell');
      }
    }
    stepRockets(dt) {
      for (let i = this.rockets.length - 1; i >= 0; i--) {
        const r = this.rockets[i]; r.t += dt;
        const f = Math.min(1, r.t / r.T);
        r.x = r.x0 + (r.tx - r.x0) * f; r.y = r.y0 + (r.ty - r.y0) * f; r.h = DECK + 2 + 4 * r.apex * f * (1 - f);
        if (r.hp <= 0) { this.rockets.splice(i, 1); continue; }
        if (f < 1) continue;
        this.rockets.splice(i, 1);
        this.impact(r.tx, r.ty, r.dmg, r.splash, r.team, r.owner, 'rocket');
      }
    }
    stepMissiles(dt) {
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const m = this.missiles[i]; m.life -= dt; m.age += dt;
        if (m.hp <= 0 || m.life <= 0) { this.missiles.splice(i, 1); if (m.life <= 0) this.emit('explosion', {x: m.x, y: m.y, h: m.h, size: 0.5}); continue; }
        if (!m.tgt || m.tgt.sinking || m.tgt.dead) { m.tgt = this.nearestFoe(m.team, m.x, m.y); m.b = null; }
        if (m.tgt && (!m.b || !m.b.alive)) m.b = m.tgt.randomBlock();
        m.px = m.x; m.py = m.y; m.ph = m.h;
        if (m.age < 0.55) { m.h += 75 * dt; m.speed = 25; }
        else {
          m.speed = Math.min(m.max, m.speed + 300 * dt);
          if (m.tgt && m.b) {
            let [tx, ty] = m.tgt.pos(m.b);
            if (this.inSmoke(m.tgt.x, m.tgt.y)) { tx += Math.sin(m.age * 3 + i) * 40; ty += Math.cos(m.age * 2.3 + i) * 40; }
            const d = Math.hypot(tx - m.x, ty - m.y);
            m.a = turnToward(m.a, headingTo(tx - m.x, ty - m.y), 3.4 * dt);
            const want = d < 160 ? DECK + 1 : 28;
            m.h += clamp(want - m.h, -90 * dt, 60 * dt);
          }
        }
        const [fx, fy] = fwd(m.a);
        m.x += fx * m.speed * dt; m.y += fy * m.speed * dt;
        if (m.age > 0.55 && m.h < 14) {
          let hit = false;
          for (const s of this.ships) {
            if (s.team === m.team || s.dead || s.sinking) continue;
            if (s.blockAt(m.x, m.y)) { this.impactShip(s, m.x, m.y, m.dmg, m.splash, m.owner, 'missile'); hit = true; break; }
          }
          if (hit) { this.missiles.splice(i, 1); continue; }
        }
        if (m.h < 0) { this.missiles.splice(i, 1); this.emit('splash', {x: m.x, y: m.y, size: 1.4}); }
      }
    }
    stepTorps(dt) {
      for (let i = this.torps.length - 1; i >= 0; i--) {
        const tp = this.torps[i]; tp.life -= dt;
        if (tp.life <= 0) { this.torps.splice(i, 1); continue; }
        let hit = false;
        for (let k = 0; k < 2 && !hit; k++) {
          tp.x += tp.vx * dt / 2; tp.y += tp.vy * dt / 2;
          for (const s of this.ships) {
            if (s.team === tp.team || s.dead || s.sinking) continue;
            if (s.blockAt(tp.x, tp.y)) { this.impactShip(s, tp.x, tp.y, tp.dmg, tp.splash, tp.owner, 'torp'); hit = true; break; }
          }
        }
        if (hit) this.torps.splice(i, 1);
      }
    }

    // ---------------------------------------------------------- damage
    impactShip(s, x, y, dmg, splash, attacker, kind) {
      const b = s.blockAt(x, y);
      if (b) { this.damageBlock(s, b, dmg, attacker, true); this.ignite(s, b, kind === 'torp' ? 0.2 : 0.3); }
      if (splash) this.damageRadius(s, x, y, splash, dmg * 0.35, attacker, kind !== 'shell');
      if (attacker === this.player) this.stats.hits++;
      this.emit(kind === 'torp' ? 'torpHit' : 'hit', {x, y, size: kind === 'torp' ? 1.5 : 1.3, ship: s, kind});
    }
    impact(x, y, dmg, splash, team, owner, kind) {
      let hit = null;
      for (const s of this.ships) {
        if (s.team === team || s.dead || s.sinking) continue;
        if (Math.hypot(s.x - x, s.y - y) > s.rad + (splash || 0) + S) continue;
        const b = s.blockAt(x, y);
        if (b) { this.damageBlock(s, b, dmg, owner, true); hit = s; if (kind !== 'shell') this.ignite(s, b, kind === 'heavy' || kind === 'bomb' ? 0.25 : 0.12); }
        if (splash && this.damageRadius(s, x, y, splash, dmg * 0.3, owner, kind !== 'shell')) hit = hit || s;
      }
      if (hit) {
        if (owner === this.player) this.stats.hits++;
        this.emit('hit', {x, y, size: kind === 'heavy' || kind === 'bomb' ? 1.2 : kind === 'rocket' ? 0.8 : 0.55, ship: hit, kind});
      } else this.emit('splash', {x, y, size: kind === 'heavy' || kind === 'bomb' ? 2.2 : kind === 'rocket' ? 1.2 : 1});
    }
    damageRadius(s, x, y, r, dmg, attacker, incendiary) {
      const [lx, ly] = s.w2l(x, y); let hit = false;
      for (const b of s.blocks) {
        if (!b.alive) continue;
        const d = Math.hypot(b.lx - lx, b.ly - ly);
        if (d < r + S * 0.5) {
          this.damageBlock(s, b, dmg * (1 - 0.5 * Math.min(1, d / r)), attacker, true);
          if (incendiary) this.ignite(s, b, 0.06);
          hit = true;
        }
      }
      return hit;
    }
    damageBlock(s, b, dmg, attacker, direct, quiet) {
      if (!b.alive || s.dead || s.sinking) return 0;
      const applied = Math.min(b.hp, dmg);
      b.hp -= dmg;
      if (direct) { s.recentDmg += applied; s.lastHitBy = attacker || s.lastHitBy; b.hitFx = 0.25; }
      if (attacker && attacker !== s) attacker.dmgDealt += applied;
      if (attacker === this.player && s !== this.player) this.stats.dmg += applied;
      if (s === this.player && attacker && attacker !== s) this.stats.taken += applied;
      if (b.hp <= 0) this.destroyBlock(s, b, attacker);
      return applied;
    }
    destroyBlock(s, b, attacker) {
      b.alive = false; b.fire = 0; s.dirty = true;
      if (attacker) s.lastHitBy = attacker;
      const [x, y] = s.pos(b);
      this.emit('blockLost', {ship: s, block: b, x, y});
      const P = PARTS[b.t];
      if (P.boom && !s.sinking) this.booms.push({s, x, y, r: P.boom * 0.6, dmg: P.boom * 0.9, attacker, delay: this.rng.range(0.05, 0.25)});
      if (b.t === 'bridge') this.sink(s);
    }
    // After damage: drop pieces cut off from the bridge, re-derive stats, sink if out of buoyancy.
    settle(s) {
      s.dirty = false;
      if (!s.sinking && s.bridge && s.bridge.alive) {
        const seen = new Set([s.bridge]), st = [s.bridge];
        while (st.length) {
          const b = st.pop();
          for (const [dc, dr] of DIRS) {
            const nc = b.c + dc, nr = b.r + dr;
            if (nc < 0 || nr < 0 || nc >= s.w || nr >= s.h) continue;
            const n = s.map[nc + nr * s.w];
            if (n && n.alive && !seen.has(n)) { seen.add(n); st.push(n); }
          }
        }
        for (const b of s.blocks) if (b.alive && !seen.has(b)) {
          b.alive = false; b.fire = 0;
          const [x, y] = s.pos(b);
          this.emit('detached', {ship: s, block: b, x, y});
        }
      }
      s.recompute();
      if (!s.sinking && (s.buoy < s.mass || s.count === 0)) this.sink(s);
    }
    sink(s) {
      if (s.sinking) return;
      s.sinking = true; s.sinkT = 0; s.throttle = 0;
      const killer = s.lastHitBy;
      if (killer && killer.team !== s.team) killer.kills++;
      if (s.team !== 0) { this.stats.sunk++; this.stats.sunkCost += s.cost || 0; }
      this.emit('sink', {ship: s, x: s.x, y: s.y, killer});
    }

    collisions() {
      const sh = this.ships;
      for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) {
        const a = sh[i], b = sh[j];
        if (a.dead || b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d > a.rad + b.rad) continue;
        let ba = null, bb = null;
        for (const bl of a.blocks) {
          if (!bl.alive) continue;
          const [x, y] = a.pos(bl), o = b.blockAt(x, y);
          if (o) { ba = bl; bb = o; break; }
        }
        if (!ba) continue;
        const nx = dx / (d || 1), ny = dy / (d || 1), ma = a.mass, mb = b.mass, push = 2.5;
        a.x -= nx * push * mb / (ma + mb); a.y -= ny * push * mb / (ma + mb);
        b.x += nx * push * ma / (ma + mb); b.y += ny * push * ma / (ma + mb);
        if (a.ramCd <= 0 && b.ramCd <= 0) {
          const rel = Math.hypot(a.vx - b.vx, a.vy - b.vy), dmg = rel * 0.35;
          if (dmg > 3) {
            this.damageBlock(a, ba, dmg * mb / (ma + mb) * 2, b, true);
            this.damageBlock(b, bb, dmg * ma / (ma + mb) * 2, a, true);
            const [x, y] = a.pos(ba);
            this.emit('hit', {x, y, size: 0.6, ship: a, kind: 'ram'});
          }
          a.ramCd = b.ramCd = 0.5;
          a.speed *= 0.6; b.speed *= 0.6;
        }
      }
    }

    // Endless mode: patch the player's ship between waves.
    repairShip(s, frac) {
      for (const b of s.blocks) if (b.alive) { b.hp = b.max; b.fire = 0; }
      const lost = s.blocks.filter(b => !b.alive);
      let n = Math.ceil(lost.length * frac);
      // rebuild blocks that touch the existing hull, nearest the bridge first
      for (let pass = 0; pass < 6 && n > 0; pass++) {
        for (const b of lost) {
          if (b.alive || n <= 0) continue;
          const touches = DIRS.some(([dc, dr]) => { const o = s.map[(b.c + dc) + (b.r + dr) * s.w]; return b.c + dc >= 0 && b.c + dc < s.w && o && o.alive; });
          if (!touches) continue;
          b.alive = true; b.hp = b.max; b.fire = 0; n--;
          this.emit('blockRestored', {ship: s, block: b});
        }
      }
      s.recompute();
    }
  }

  return {S, DECK, FIELD, SHELL_ARC, World, Ship, PLAYER_PROFILE};
})();
