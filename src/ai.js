// Enemy captains. One Brain per ship, coordinated by a Fleet. Behaviour scales with the
// difficulty profile (Data.DIFFICULTY): Easy fights alone; Medium focuses fire and flanks;
// Hard also aims for vital blocks, combs torpedoes and falls back to repair.
const AI = (() => {
  const {clamp, wrapA, headingTo, fwd} = Util;
  const {FIELD} = Sim;

  class Fleet {
    constructor(profile, team) { this.p = profile; this.team = team; this.members = []; this.focus = null; this.focusT = 0; }
    brain(ship) { const b = new Brain(this.p, this); this.members.push(b); b.ship = ship; return b; }
    // Shared target: the weakest reachable enemy, re-evaluated every few seconds.
    updateFocus(world) {
      this.focusT -= 1;
      if (this.focus && !this.focus.sinking && !this.focus.dead && this.focusT > 0) return;
      const foes = world.foes(this.team);
      const live = this.members.filter(m => !m.ship.sinking && !m.ship.dead);
      if (!foes.length || !live.length) { this.focus = null; return; }
      let cx = 0, cy = 0; for (const m of live) { cx += m.ship.x; cy += m.ship.y; } cx /= live.length; cy /= live.length;
      let best = null, bs = 1e18;
      for (const f of foes) { const sc = Math.hypot(f.x - cx, f.y - cy) * (0.4 + f.integrity); if (sc < bs) { bs = sc; best = f; } }
      this.focus = best; this.focusT = 6;
    }
    centroid() {
      const live = this.members.filter(m => !m.ship.sinking && !m.ship.dead);
      let x = 0, y = 0; for (const m of live) { x += m.ship.x; y += m.ship.y; }
      return live.length ? [x / live.length, y / live.length, live] : [0, 0, live];
    }
  }

  class Brain {
    constructor(p, fleet) {
      this.p = p; this.fleet = fleet; this.t = 0; this.orbit = 0; this.orbitT = 0;
      this.mode = 'engage'; this.modeT = 0; this.dodgeT = 0; this.dodgeHeading = 0; this.goal = null;
    }
    update(world, s, dt) {
      this.t -= dt; this.dodgeT -= dt; this.modeT -= dt; this.orbitT -= dt;
      if (this.t <= 0) { this.t = this.p.react * world.rng.range(0.7, 1.3); this.think(world, s); }
      this.steer(world, s, dt);
    }
    hpFrac(s) { let h = 0, m = 0; for (const b of s.blocks) if (b.alive) { h += b.hp; m += b.max; } return m ? h / m : 0; }

    think(world, s) {
      const p = this.p, rng = world.rng;
      if (!this.orbit) this.orbit = rng() < 0.5 ? 1 : -1;
      const foes = world.foes(s.team);
      if (!foes.length) { s.target = null; this.goal = null; return; }

      // --- target
      if (p.focus) {
        this.fleet.updateFocus(world);
        const f = this.fleet.focus;
        s.target = f && Math.hypot(f.x - s.x, f.y - s.y) < Math.max(s.range * 1.6, 500) ? f : world.nearestFoe(s.team, s.x, s.y);
      } else s.target = world.nearestFoe(s.team, s.x, s.y);
      const t = s.target;
      if (!t) return;

      // --- mode changes
      if (p.retreat) {
        const hf = this.hpFrac(s);
        if (this.mode === 'engage' && s.hasRepair && hf < 0.5) { this.mode = 'retreat'; this.modeT = 20; }
        else if (this.mode === 'retreat' && (hf > 0.85 || this.modeT <= 0)) this.mode = 'engage';
        if (this.mode === 'engage' && !s.hasRepair && s.reserve < 0.3 && s.weapons.some(w => w.t === 'torp')) this.mode = 'ram';
      }
      if (p.smoke && s.hasSmoke && s.recentDmg > s.startHp * 0.06) world.deploySmoke(s);

      // --- torpedo awareness
      if (p.dodge > 0 && this.dodgeT <= 0) {
        for (const tp of world.torps) {
          if (tp.team === s.team) continue;
          const px = tp.x - s.x, py = tp.y - s.y; if (px * px + py * py > 360 * 360) continue;
          const vx = tp.vx - s.vx, vy = tp.vy - s.vy, vv = vx * vx + vy * vy || 1;
          const tca = -(px * vx + py * vy) / vv;
          if (tca < 0 || tca > 6) continue;
          const mx = px + vx * tca, my = py + vy * tca;
          if (Math.hypot(mx, my) > s.rad * 0.9) continue;
          if (rng() < p.dodge) {
            // comb the torpedo: turn parallel to its track, whichever way is closer
            const a1 = tp.a, a2 = tp.a + Math.PI;
            this.dodgeHeading = Math.abs(wrapA(a1 - s.a)) < Math.abs(wrapA(a2 - s.a)) ? a1 : a2;
            this.dodgeT = 2.5;
          } else this.dodgeT = 1.5; // noticed too late; don't re-roll every tick
          break;
        }
      }

      // --- positioning
      const hasTorp = s.weapons.some(w => w.t === 'torp');
      let want = s.hasAir ? 650 : (hasTorp ? 380 : s.range * 0.78) || 250;
      if (this.mode === 'ram') want = 160;
      if (this.orbitT <= 0) { this.orbitT = rng.range(5, 10); if (rng() < 0.35) this.orbit *= -1; }
      if (p.flank) {
        const [cx, cy, live] = this.fleet.centroid();
        const k = live.indexOf(this), n = live.length;
        const base = headingTo(cx - t.x, cy - t.y);
        const bearing = base + (n > 1 ? (k - (n - 1) / 2) * 0.75 : 0);
        const [bx, by] = fwd(bearing);
        this.goal = [t.x + bx * want, t.y + by * want, want];
      } else this.goal = null;
      this.want = want;
    }

    steer(world, s, dt) {
      const t = s.target;
      let desired = s.a, throttle = 0.9;
      if (!t) { s.throttle = 0.3; s.rudder = 0; return; }
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), toT = headingTo(dx, dy);
      const want = this.want || 250;
      if (s.hasAir && d < want * 0.8) throttle = 1;
      if (this.mode === 'retreat') {
        const [cx, cy] = this.fleet.centroid();
        desired = headingTo(s.x - t.x + (cx - s.x) * 0.3, s.y - t.y + (cy - s.y) * 0.3); throttle = 1;
      } else if (this.goal && d < want * 2.2) {
        const [gx, gy] = this.goal, gd = Math.hypot(gx - s.x, gy - s.y);
        if (gd > want * 0.3) desired = headingTo(gx - s.x, gy - s.y);
        else desired = toT + this.orbit * Math.PI / 2 * 0.85;   // on station: present the broadside
        if (d < want * 0.5) desired = toT + Math.PI - this.orbit * 0.4;
      } else {
        if (d > want * 1.15) desired = toT + this.orbit * 0.35;
        else if (d < want * 0.55) desired = toT + Math.PI - this.orbit * 0.4;
        else desired = toT + this.orbit * Math.PI / 2 * 0.85;
      }
      if (this.dodgeT > 0) desired = this.dodgeHeading;
      const edge = FIELD * 0.82;
      if (Math.abs(s.x) > edge || Math.abs(s.y) > edge) desired = headingTo(-s.x, -s.y);
      for (const o of world.ships) {
        if (o === s || o.team !== s.team || o.sinking) continue;
        if (Math.hypot(o.x - s.x, o.y - s.y) < (s.rad + o.rad) * 1.1) { desired = headingTo(s.x - o.x, s.y - o.y); break; }
      }
      s.rudder = clamp(wrapA(desired - s.a) * 2, -1, 1);
      s.throttle = this.mode === 'retreat' ? 1 : (s.integrity < 0.4 ? 0.7 : throttle);
    }
  }

  // Autopilot used by tests (and available as a "computer captain" for the player).
  function autopilot(profile) { return new Fleet(profile, 0); }

  const designCache = {};
  function enemyDesign(id) { return designCache[id] || (designCache[id] = Design.fromRows(Data.ENEMIES[id].rows)); }
  const enemyCost = id => Design.analyze(enemyDesign(id)).cost;

  // Spawn an enemy fleet in a loose line abreast across the north edge, facing south.
  function spawnFleet(world, ids, profile, opts = {}) {
    const fleet = new Fleet(profile, 1);
    const n = ids.length, y0 = opts.y != null ? opts.y : -560, spread = opts.spread || 250;
    const ships = ids.map((id, i) => {
      const off = i - (n - 1) / 2;
      const x = (opts.x || 0) + off * spread + world.rng.range(-30, 30);
      const y = y0 + Math.abs(off) * 60;
      const E = Data.ENEMIES[id];
      // Famous ships sail with veteran crews: tougher, faster-loading, better gunnery. Bosses more so.
      const mods = E.famous ? (E.boss ? {hp: 1.5, reload: 1.15, spread: 0.85} : {hp: 1.3, reload: 1.1, spread: 0.9}) : undefined;
      const s = world.addShip(enemyDesign(id), {team: 1, x, y, a: Math.PI, name: E.name, kind: id, profile, mods});
      s.cost = enemyCost(id);
      s.boss = !!E.boss; s.famous = !!E.famous;
      s.brain = fleet.brain(s);
      return s;
    });
    return {fleet, ships};
  }

  // Endless mode: spend a growing budget on the classes allowed at this wave.
  function endlessWave(wave, rng) {
    let budget = Data.endlessBudget(wave);
    const pool = Data.ENDLESS_POOL.filter(e => e.minWave <= wave).map(e => ({id: e.id, cost: enemyCost(e.id)}));
    const ids = [];
    // one anchor ship from the top of the pool, then fill with escorts
    const big = pool.filter(e => e.cost <= budget).sort((a, b) => b.cost - a.cost).slice(0, 2);
    if (big.length) { const e = rng.pick(big); ids.push(e.id); budget -= e.cost; }
    let guard = 0;
    while (ids.length < 6 && guard++ < 40) {
      const fit = pool.filter(e => e.cost <= budget);
      if (!fit.length) break;
      const e = rng.pick(fit); ids.push(e.id); budget -= e.cost;
    }
    if (!ids.length) ids.push('patrol');
    return ids;
  }

  return {Fleet, Brain, autopilot, enemyDesign, enemyCost, spawnFleet, endlessWave};
})();
