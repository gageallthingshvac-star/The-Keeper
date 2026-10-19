// One battle: owns the world, the 3D scene for it, camera, input and the HUD.
// cfg: {mode: 'op'|'endless', op, design, difficulty, mods, quality, settings}
const Battle = (() => {
  const {S, DECK, FIELD} = Sim;
  const {clamp, wrapA, fwd, TAU} = Util;
  const $ = id => document.getElementById(id);
  const STEP = 1 / 60;

  // Engine telegraph notches (top to bottom) and rudder detents, as on a ship's bridge.
  const TELEGRAPH = [[1, 'FULL'], [0.75, '¾'], [0.5, '½'], [0.25, '¼'], [0, 'STOP'], [-0.2, '½ AST'], [-0.4, 'FULL AST']];
  const RUDDER = [[-1, 'Hard port'], [-0.5, 'Port'], [0, 'Midships'], [0.5, 'Starboard'], [1, 'Hard stbd']];
  const DOUBLE_TAP = 320; // ms
  const WEAPON_ORDER = ['superheavy', 'heavy', 'gun', 'battery', 'rail', 'rockets', 'missile', 'torp', 'hangar', 'aa', 'ciws'];

  class Battle {
    constructor(app, cfg) {
      this.app = app; this.cfg = cfg;
      this.renderer = app.renderer;
      this.quality = cfg.quality;
      this.diff = Data.DIFFICULTY[cfg.difficulty] || Data.DIFFICULTY.medium;
      this.weatherKey = cfg.mode === 'op' ? Data.OPS[cfg.op].weather : 'clear';
      this.env = new Gfx.Env(this.renderer, {quality: this.quality});
      this.env.setWeather(Data.WEATHER[this.weatherKey]);
      this.viz = new Viz(this.env, {quality: this.quality});
      this.camera = new THREE.PerspectiveCamera(50, 1, 1, 12000);
      this.world = new Sim.World({weather: this.weatherKey});
      this.addBuoys();
      this.craft = (cfg.settings.controls || 'craft') === 'craft';
      this.player = this.world.addShip(cfg.design, {team: 0, x: 0, y: 560, a: 0, name: 'Your ship', player: true, mods: cfg.mods, manual: this.craft});
      this.viz.addShip(this.player);
      this.wave = 0; this.waveT = 0; this.over = false; this.endT = 0; this.paused = false; this.t = 0;
      if (cfg.mode === 'op') this.spawn(Data.OPS[cfg.op].enemies);
      else this.nextWave();
      this.cam = {x: this.player.x, y: this.player.y, yaw: 0, pitch: 0.32, dist: 260, mode: 0, shake: 0,
                  aimYaw: this.player.a, range: 380, scope: false, fov: 50};
      this.input = {throttle: this.craft ? 0.5 : 0.6, rudder: 0, joy: null, look: null, keys: {}, lastTap: 0, lastSpace: 0};
      this.acc = 0; this.hudT = 0; this.lightningT = 6 + Math.random() * 8;
      this.overlay = $('overlay'); this.octx = this.overlay.getContext('2d');
      this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
      this.shipCv = $('hShip'); this.sctx = this.shipCv.getContext('2d');
      $('sHud').classList.toggle('craft', this.craft); $('sHud').classList.toggle('simple', !this.craft);
      this.bindInput();
      if (this.craft) this.bindCraftControls();
      this.buildWeaponBar();
      this.resize();
      $('hWaveRow').style.display = cfg.mode === 'endless' ? '' : 'none';
      $('bSmoke').style.display = this.player.hasSmoke ? '' : 'none';
      const title = cfg.mode === 'op' ? Data.OPS[cfg.op].name : 'Endless Patrol';
      this.flash(title.toUpperCase(), Data.WEATHER[this.weatherKey].name + ' · ' + this.diff.name);
      Sound.startAmbient(Data.WEATHER[this.weatherKey]);
      if (cfg.settings.music) Sound.startMusic(1);
      this.showHint();
    }

    // ---------------------------------------------------------- setup
    spawn(ids, opts) {
      const {ships} = AI.spawnFleet(this.world, ids, this.diff, opts);
      for (const s of ships) this.viz.addShip(s);
      return ships;
    }
    nextWave() {
      this.wave++;
      const ids = AI.endlessWave(this.wave, this.world.rng);
      const p = this.player, a = this.world.rng.range(0, TAU);
      const [fx, fy] = fwd(a), d = 950;
      const cx = clamp(p.x + fx * d, -FIELD * 0.8, FIELD * 0.8), cy = clamp(p.y + fy * d, -FIELD * 0.8, FIELD * 0.8);
      const ships = this.spawn(ids, {x: cx, y: cy, spread: 220});
      for (const s of ships) s.a = Util.headingTo(p.x - s.x, p.y - s.y);
      if (this.wave > 1 && this.wave % 4 === 1) {
        const keys = ['clear', 'dawn', 'overcast', 'dusk', 'storm', 'night'];
        this.weatherKey = keys[(this.wave / 4 | 0) % keys.length];
        this.world.weather = Data.WEATHER[this.weatherKey];
        this.env.setWeather(this.world.weather);
        Sound.startAmbient(this.world.weather);
      }
      this.flash(`WAVE ${this.wave}`, ids.length + ' contacts');
      if (this.wave > 1) Sound.play('alarm');
    }
    addBuoys() {
      const n = Math.round(FIELD * 8 / 110);
      this.buoys = new THREE.InstancedMesh(Gfx.GEO.buoy, Gfx.MAT.buoy, n);
      this.buoys.frustumCulled = false;
      this.buoyPos = [];
      for (let i = 0; i < n; i++) {
        const f = i / n * 4, side = Math.floor(f), u = (f - side) * 2 - 1;
        this.buoyPos.push([[u * FIELD, -FIELD], [FIELD, u * FIELD], [-u * FIELD, FIELD], [-FIELD, -u * FIELD]][side]);
      }
      this.env.scene.add(this.buoys);
      this._o = new THREE.Object3D();
    }

    // ---------------------------------------------------------- input
    bindInput() {
      const el = this.renderer.domElement, I = this.input;
      this.h = {
        key: e => {
          I.keys[e.code] = e.type === 'keydown';
          if (e.type !== 'keydown' || this.over) return;
          if (this.craft && this.craftKey(e)) return;
          if (e.code === 'Tab') { e.preventDefault(); this.cycleTarget(); }
          else if (e.code === 'KeyC') this.cycleCam();
          else if (e.code === 'KeyF' || e.code === 'KeyX') this.smoke();
          else if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
        },
        wheel: e => { e.preventDefault(); if (this.craft && !e.ctrlKey) { this.setRange(this.cam.range * (e.deltaY > 0 ? 1 / 1.08 : 1.08)); return; } this.cam.dist = clamp(this.cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 70, 900); },
        down: e => {
          if (this.paused || this.over) return;
          Sound.init();
          el.setPointerCapture(e.pointerId);
          if (this.craft) {
            if (I.look && e.pointerType !== 'mouse') { I.pinch = {id: e.pointerId, x: e.clientX, y: e.clientY, d0: Math.hypot(e.clientX - I.look.x, e.clientY - I.look.y), dist0: this.cam.dist}; I.look.moved = true; return; }
            I.look = {id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, button: e.button};
            return;
          }
          if (e.pointerType !== 'mouse' && e.clientX < this.W * 0.5 && !I.joy) { I.joy = {id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY}; return; }
          if (I.look && e.pointerType !== 'mouse') { // second finger on the look side: pinch to zoom
            I.pinch = {id: e.pointerId, x: e.clientX, y: e.clientY, d0: Math.hypot(e.clientX - I.look.x, e.clientY - I.look.y), dist0: this.cam.dist};
            I.look.moved = true; return;
          }
          I.look = {id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false};
        },
        move: e => {
          const j = I.joy;
          if (j && j.id === e.pointerId) {
            j.x = e.clientX; j.y = e.clientY;
            I.rudder = clamp((j.x - j.ox) / 60, -1, 1);
            I.throttle = clamp(-(j.y - j.oy) / 60, -0.4, 1);
            return;
          }
          const pn = I.pinch;
          if (pn && I.look && (pn.id === e.pointerId || I.look.id === e.pointerId)) {
            if (pn.id === e.pointerId) { pn.x = e.clientX; pn.y = e.clientY; } else { I.look.x = e.clientX; I.look.y = e.clientY; }
            const d = Math.hypot(pn.x - I.look.x, pn.y - I.look.y);
            if (pn.d0 > 20) this.cam.dist = clamp(pn.dist0 * pn.d0 / Math.max(20, d), 70, 900);
            return;
          }
          const l = I.look;
          if (l && l.id === e.pointerId) {
            const dx = e.clientX - l.x, dy = e.clientY - l.y; l.x = e.clientX; l.y = e.clientY;
            if (Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > 6) l.moved = true;
            if (l.moved) {
              if (this.craft) this.swingAim(dx, dy);
              else { this.cam.yaw -= dx * 0.006; this.cam.pitch = clamp(this.cam.pitch + dy * 0.004, 0.06, 1.35); }
            }
          }
        },
        up: e => {
          if (I.joy && I.joy.id === e.pointerId) { I.joy = null; I.rudder = 0; }
          if (I.pinch && (I.pinch.id === e.pointerId || (I.look && I.look.id === e.pointerId))) { I.pinch = null; if (I.look && I.look.id === e.pointerId) I.look = null; return; }
          const l = I.look;
          if (l && l.id === e.pointerId) {
            if (!l.moved) { if (this.craft) { if (l.button === 2) this.toggleScope(); else this.tapFire(); } else this.pickTarget(e.clientX, e.clientY); }
            I.look = null;
          }
        },
        ctx: e => e.preventDefault(),
      };
      window.addEventListener('keydown', this.h.key); window.addEventListener('keyup', this.h.key);
      el.addEventListener('wheel', this.h.wheel, {passive: false});
      el.addEventListener('pointerdown', this.h.down); el.addEventListener('pointermove', this.h.move);
      el.addEventListener('pointerup', this.h.up); el.addEventListener('pointercancel', this.h.up);
      el.addEventListener('contextmenu', this.h.ctx);
      $('bCam').onclick = () => this.cycleCam();
      $('bPause').onclick = () => this.togglePause();
      $('bTarget').onclick = () => this.cycleTarget();
      $('bSmoke').onclick = () => this.smoke();
      $('bZoomIn').onclick = () => { this.cam.dist = clamp(this.cam.dist / 1.2, 70, 900); };
      $('bZoomOut').onclick = () => { this.cam.dist = clamp(this.cam.dist * 1.2, 70, 900); };
    }
    unbind() {
      const el = this.renderer.domElement;
      window.removeEventListener('keydown', this.h.key); window.removeEventListener('keyup', this.h.key);
      el.removeEventListener('wheel', this.h.wheel); el.removeEventListener('pointerdown', this.h.down);
      el.removeEventListener('pointermove', this.h.move); el.removeEventListener('pointerup', this.h.up);
      el.removeEventListener('pointercancel', this.h.up); el.removeEventListener('contextmenu', this.h.ctx);
    }
    // ---------------------------------------------------------- Warship Craft controls
    // Rudder holds where you leave it; the telegraph has fixed notches; the camera is your aim.
    bindCraftControls() {
      const I = this.input;
      // telegraph
      const tg = $('telegraph'); tg.innerHTML = '';
      this.tgBtns = TELEGRAPH.map(([v, label]) => {
        const b = document.createElement('button'); b.className = 'notch' + (v < 0 ? ' astern' : v === 0 ? ' stop' : '');
        b.textContent = label; tg.appendChild(b); return [v, b];
      });
      // tap a notch, or drag along the lever to sweep through notches
      let tgDrag = null;
      const tgPick = e => {
        const r = tg.getBoundingClientRect(), i = clamp(Math.floor((e.clientY - r.top) / r.height * TELEGRAPH.length), 0, TELEGRAPH.length - 1);
        if (TELEGRAPH[i][0] !== I.throttle) this.setTelegraph(TELEGRAPH[i][0]);
      };
      tg.onpointerdown = e => { e.preventDefault(); Sound.init(); tgDrag = e.pointerId; tg.setPointerCapture(e.pointerId); tgPick(e); };
      tg.onpointermove = e => { if (tgDrag === e.pointerId) tgPick(e); };
      tg.onpointerup = tg.onpointercancel = e => { if (tgDrag === e.pointerId) tgDrag = null; };
      // rudder
      const rd = $('rudder'), track = rd.querySelector('.rtrack');
      let drag = null;
      const fromX = x => { const r = track.getBoundingClientRect(); return clamp(((x - r.left) / r.width) * 2 - 1, -1, 1); };
      rd.onpointerdown = e => {
        e.preventDefault(); rd.setPointerCapture(e.pointerId); Sound.init();
        const now = performance.now();
        if (now - (this.rudTap || 0) < DOUBLE_TAP) { this.setRudder(0, true); this.rudTap = 0; drag = null; return; }
        this.rudTap = now; drag = e.pointerId; this.setRudder(fromX(e.clientX));
      };
      rd.onpointermove = e => { if (drag === e.pointerId) this.setRudder(fromX(e.clientX)); };
      rd.onpointerup = rd.onpointercancel = e => {
        if (drag !== e.pointerId) return; drag = null;
        const near = RUDDER.reduce((a, d) => Math.abs(d[0] - I.rudder) < Math.abs(a[0] - I.rudder) ? d : a);
        if (Math.abs(near[0] - I.rudder) < 0.15) this.setRudder(near[0], true);
      };
      // weapons
      const fire = $('bFire');
      fire.onpointerdown = e => { e.preventDefault(); this.tapFire(); };
      $('bTorp').onpointerdown = e => { e.preventDefault(); this.command('torp'); };
      $('bSpecial').onpointerdown = e => { e.preventDefault(); this.command('special'); };
      $('bScope').onpointerdown = e => { e.preventDefault(); this.toggleScope(); };
      $('bSmoke2').onpointerdown = e => { e.preventDefault(); this.smoke(); };
      $('bTorp').style.display = this.player.weapons.some(b => b.t === 'torp') ? '' : 'none';
      $('bSpecial').style.display = this.player.weapons.some(b => ['missile', 'hangar', 'rockets'].includes(b.t)) ? '' : 'none';
      $('bSpecial').textContent = this.player.weapons.some(b => b.t === 'hangar') ? 'AIR' : this.player.weapons.some(b => b.t === 'missile') ? 'MSL' : 'RKT';
      $('bSmoke2').style.display = this.player.hasSmoke ? '' : 'none';
      this.cam.range = clamp((this.player.range || 300) * 0.7, 120, 900);
      this.setTelegraph(I.throttle, true); this.setRudder(0, true);
    }
    setTelegraph(v, quiet) {
      this.input.throttle = v;
      if (this.tgBtns) for (const [n, b] of this.tgBtns) b.classList.toggle('on', n === v);
      if (!quiet) { Sound.play('click'); this.app.haptic('light'); }
    }
    stepTelegraph(dir) {
      const i = TELEGRAPH.findIndex(([v]) => v === this.input.throttle);
      const j = clamp((i < 0 ? 4 : i) - dir, 0, TELEGRAPH.length - 1);
      this.setTelegraph(TELEGRAPH[j][0]);
    }
    setRudder(v, snap) {
      const I = this.input; I.rudder = clamp(v, -1, 1);
      const knob = $('rudKnob'); if (knob) knob.style.left = ((I.rudder + 1) / 2 * 100) + '%';
      const near = RUDDER.reduce((a, d) => Math.abs(d[0] - I.rudder) < Math.abs(a[0] - I.rudder) ? d : a);
      const lbl = $('rudLbl'); if (lbl) lbl.textContent = Math.abs(near[0] - I.rudder) < 0.08 ? near[1] : `${Math.round(Math.abs(I.rudder) * 35)}° ${I.rudder < 0 ? 'port' : 'stbd'}`;
      if (snap) this.app.haptic('light');
    }
    setRange(r) { this.cam.range = clamp(r, 60, Math.max(700, (this.player.range || 300) * 1.25)); }
    swingAim(dx, dy) {
      const k = this.cam.scope ? 0.0014 : 0.0048;
      this.cam.aimYaw = wrapA(this.cam.aimYaw + dx * k);
      this.setRange(this.cam.range * Math.exp(-dy * (this.cam.scope ? 0.0016 : 0.0045)));
    }
    toggleScope() { this.cam.scope = !this.cam.scope; Sound.play('click'); $('bScope').classList.toggle('on', this.cam.scope); }
    command(kind) { if (this.over || this.paused) return; this.player.cmd[kind] = 1; this.app.haptic('light'); }
    // Single tap fires the next ready mount; a second tap inside the double-tap window fires a full salvo.
    tapFire() {
      if (this.over || this.paused) return;
      Sound.init();
      const now = performance.now(), p = this.player;
      if (now - this.input.lastTap < DOUBLE_TAP) { p.cmd.salvo = 1; this.input.lastTap = 0; }
      else { p.cmd.fire = 1; this.input.lastTap = now; }
      if (!p.fc.canFire) Sound.play('deny');
    }
    craftKey(e) {
      const c = e.code;
      if (c === 'KeyW' || c === 'ArrowUp') { this.stepTelegraph(1); return true; }
      if (c === 'KeyS' || c === 'ArrowDown') { this.stepTelegraph(-1); return true; }
      if (c === 'KeyX') { this.setRudder(0, true); return true; }
      if (c === 'Space') { e.preventDefault(); this.tapFire(); return true; }
      if (c === 'KeyT') { this.command('torp'); return true; }
      if (c === 'KeyR') { this.command('special'); return true; }
      if (c === 'KeyZ' || c === 'KeyV') { this.toggleScope(); return true; }
      if (c === 'KeyQ') { this.cam.aimYaw = wrapA(this.cam.aimYaw - 0.15); return true; }
      if (c === 'KeyE') { this.cam.aimYaw = wrapA(this.cam.aimYaw + 0.15); return true; }
      return false;
    }
    cycleCam() { this.cam.mode = (this.cam.mode + 1) % 3; Sound.play('click'); }
    cycleTarget() {
      const foes = this.world.foes(0);
      if (!foes.length) return;
      foes.sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y));
      const i = foes.indexOf(this.player.target);
      this.player.target = foes[(i + 1) % foes.length];
      Sound.play('click');
    }
    smoke() { if (this.world.deploySmoke(this.player)) this.app.haptic('medium'); else Sound.play('deny'); }
    togglePause() { if (this.over) return; this.paused = !this.paused; this.app.ui.pause(this.paused); if (!this.paused) Sound.init(); }
    pickTarget(sx, sy) {
      let best = null, bd = 1e9;
      for (const s of this.world.ships) {
        if (s.team === 0 || s.sinking) continue;
        const p = this.project(s.x, (s.viz ? s.viz.bob : 0) + 8, s.y); if (p.behind) continue;
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < Math.max(50, this.pxRadius(s)) && d < bd) { bd = d; best = s; }
      }
      if (best) { this.player.target = this.player.target === best ? null : best; Sound.play('click'); this.app.haptic('light'); }
    }

    // ---------------------------------------------------------- frame
    resize() {
      this.W = window.innerWidth; this.H = window.innerHeight;
      this.renderer.setSize(this.W, this.H, false);
      this.camera.aspect = this.W / this.H; this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.overlay.width = this.W * dpr; this.overlay.height = this.H * dpr; this.dpr = dpr;
      const ms = this.mm.clientWidth || 120; this.mm.width = ms * dpr; this.mm.height = ms * dpr;
      const sw = this.shipCv.clientWidth || 60, sh = this.shipCv.clientHeight || 90;
      this.shipCv.width = sw * dpr; this.shipCv.height = sh * dpr;
      this.viz.setScale((this.H * this.renderer.getPixelRatio() / 2) / Math.tan(this.camera.fov * Math.PI / 360));
    }
    onPixelRatio() { this.viz.setScale((this.H * this.renderer.getPixelRatio() / 2) / Math.tan(this.camera.fov * Math.PI / 360)); }

    update(dt) {
      const p = this.player, I = this.input, w = this.world;
      if (!this.paused) {
        if (!this.over && !p.sinking) {
          const k = I.keys;
          if (this.craft) {
            // A/D move the rudder and it stays where you leave it (X centres)
            const dr = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
            if (dr) this.setRudder(I.rudder + dr * dt * 1.4);
          } else {
            if (k.KeyW || k.ArrowUp) I.throttle = clamp(I.throttle + dt * 0.8, -0.4, 1);
            if (k.KeyS || k.ArrowDown) I.throttle = clamp(I.throttle - dt * 0.8, -0.4, 1);
            if (!I.joy) I.rudder = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
          }
          p.throttle = I.throttle; p.rudder = I.rudder;
          if (p.target && (p.target.sinking || p.target.dead)) p.target = null;
        }
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < 4) { w.step(STEP); this.acc -= STEP; steps++; this.t += STEP; }
        if (steps === 4) this.acc = 0;
        for (const e of w.drain()) this.onEvent(e);
        this.checkEnd(dt);
        this.weatherFx(dt);
      }
      this.updateCamera(dt);
      const vt = this.paused ? this.vt || 0 : (this.vt = this.t);
      if (!this.paused) this.viz.update(w, dt, vt);
      this.env.update(this.paused ? 0 : dt, vt, this.camera);
      this.env.focusShadow(this.cam.x, this.cam.y);
      this.buoyPos.forEach(([x, z], i) => { this._o.position.set(x, Gfx.waveH(x, z, vt) - 1, z); this._o.rotation.set(Math.sin(vt + i) * 0.12, 0, Math.cos(vt * 0.8 + i) * 0.12); this._o.updateMatrix(); this.buoys.setMatrixAt(i, this._o.matrix); });
      this.buoys.instanceMatrix.needsUpdate = true;
      Sound.setEngine(p.sinking ? 0 : p.throttle, Math.abs(p.speed));
      this.drawOverlay();
      this.hudT -= dt;
      if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
    }
    render() { this.renderer.render(this.env.scene, this.camera); }

    weatherFx(dt) {
      const W = this.world.weather;
      if (!W.lightning) return;
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = 5 + Math.random() * 10;
        this.env.lightning();
        setTimeout(() => Sound.play('explode', {vol: 0.45}), 400 + Math.random() * 1600);
      }
    }

    // ---------------------------------------------------------- events
    onEvent(e) {
      this.viz.onEvent(e);
      const p = this.player, near = (x, y) => clamp(1 - Math.hypot(x - p.x, y - p.y) / 300, 0, 1);
      switch (e.type) {
        case 'fire': {
          const snd = {battery: 'gun', gun: 'gun', heavy: 'heavy', superheavy: 'heavy', torp: 'torp', missile: 'missile', rockets: 'rocket', ciws: null}[e.kind];
          if (snd) Sound.play(snd, {x: e.x, y: e.y, vol: e.ship === p ? 0.8 : 0.6});
          if (e.ship === p && (e.kind === 'heavy' || e.kind === 'superheavy')) this.shake(e.kind === 'superheavy' ? 0.45 : 0.25);
          break;
        }
        case 'salvo': if (e.ship === p) { this.flash('SALVO', `${e.guns} mount${e.guns > 1 ? 's' : ''}`); this.shake(0.6); this.app.haptic('heavy'); } break;
        case 'rocket': Sound.play('rocket', {x: e.x, y: e.y, vol: 0.5}); break;
        case 'rail': Sound.play('rail', {x: e.x0, y: e.y0}); if (e.ship === p) this.shake(0.35); break;
        case 'ciws': Sound.play('ciws', {x: e.x, y: e.y, vol: 0.5}); break;
        case 'flak': Sound.play('flak', {x: e.x, y: e.y, vol: 0.5}); break;
        case 'launch': Sound.play('plane', {x: e.x, y: e.y}); break;
        case 'dive': Sound.play('dive', {x: e.x, y: e.y}); break;
        case 'bombDrop': Sound.play('whistle', {x: e.x, y: e.y}); break;
        case 'torpDrop': Sound.play('splash', {x: e.x, y: e.y, vol: 0.6}); break;
        case 'planeDown': Sound.play('explode', {x: e.x, y: e.y, vol: 0.4}); if (e.team !== 0 && near(e.x, e.y) > 0) this.app.haptic('light'); break;
        case 'hit':
          Sound.play(e.size > 1 ? 'heavy' : 'hit', {x: e.x, y: e.y, vol: e.size > 1 ? 0.8 : 0.6});
          if (e.ship === p) { this.shake(0.15 + e.size * 0.25); this.app.haptic(e.size > 1 ? 'heavy' : 'light'); }
          else this.shake(near(e.x, e.y) * 0.3);
          break;
        case 'torpHit': Sound.play('explode', {x: e.x, y: e.y}); Sound.play('bigsplash', {x: e.x, y: e.y});
          if (e.ship === p) { this.shake(1); this.app.haptic('heavy'); } break;
        case 'splash': Sound.play(e.size > 1.5 ? 'bigsplash' : 'splash', {x: e.x, y: e.y, vol: 0.7}); break;
        case 'explosion': Sound.play('explode', {x: e.x, y: e.y, vol: e.secondary ? 0.7 : 0.5}); this.shake(near(e.x, e.y) * 0.5); break;
        case 'intercept': Sound.play('hit', {x: e.x, y: e.y, vol: 0.5}); break;
        case 'smoke': Sound.play('smoke', {x: e.x, y: e.y}); if (e.ship === p) this.flash('SMOKE SCREEN', ''); break;
        case 'sink':
          Sound.play('explode', {x: e.x, y: e.y}); Sound.play('sink', {x: e.x, y: e.y});
          if (e.ship === p) { this.flash('SHIP LOST', ''); this.app.haptic('heavy'); }
          else { this.flash(`${e.ship.name.toUpperCase()} SUNK`, e.killer === p ? '+ kill' : ''); if (e.killer === p) this.app.haptic('success'); }
          break;
        case 'abandon': if (e.ship.team !== 0) this.flash(`${e.ship.name.toUpperCase()} DISARMED`, 'crew abandoning ship'); break;
        case 'blockLost': if (e.ship === p && e.block.t === 'bridge') this.app.haptic('heavy'); break;
      }
    }
    shake(k) { if (this.cfg.settings.shake) this.cam.shake = Math.min(1.2, Math.max(this.cam.shake, k)); }

    checkEnd(dt) {
      if (this.over) return;
      const p = this.player, foes = this.world.ships.filter(s => s.team !== 0 && !s.sinking).length;
      if (p.sinking || p.dead) { this.endT += dt; if (this.endT > 3.5) this.finish(false); return; }
      if (foes > 0) return;
      if (this.cfg.mode === 'endless') {
        this.waveT += dt;
        if (this.waveT > 1.5 && !this.waveCleared) {
          this.waveCleared = true;
          this.world.repairShip(p, 0.35);
          this.flash(`WAVE ${this.wave} CLEARED`, 'repairs underway');
          Sound.play('star');
        }
        if (this.waveT > 7) { this.waveT = 0; this.waveCleared = false; this.nextWave(); }
        return;
      }
      this.endT += dt;
      if (this.endT > 3.5) this.finish(true);
    }
    finish(won) {
      this.over = true;
      const w = this.world, p = this.player;
      const r = {mode: this.cfg.mode, op: this.cfg.op, won, time: this.t, integrity: p.sinking ? 0 : p.integrity,
                 sunk: w.stats.sunk, sunkCost: w.stats.sunkCost, stats: Object.assign({}, w.stats), difficulty: this.cfg.difficulty,
                 wave: this.cfg.mode === 'endless' ? this.wave - (won ? 0 : 1) : 0};
      Sound.play(won || this.cfg.mode === 'endless' && r.wave > 0 ? 'victory' : 'defeat');
      this.app.onBattleEnd(r);
    }
    retreat() { // endless: bank the waves cleared so far
      if (this.over) return;
      this.over = true;
      const w = this.world;
      this.app.onBattleEnd({mode: this.cfg.mode, op: this.cfg.op, won: false, retreat: true, time: this.t, integrity: this.player.integrity,
        sunk: w.stats.sunk, sunkCost: w.stats.sunkCost, stats: Object.assign({}, w.stats), difficulty: this.cfg.difficulty, wave: this.wave - 1});
    }

    // ---------------------------------------------------------- camera
    // Third-person aiming camera: it sits behind the ship along the aim bearing and looks at the aim point,
    // so the centre of the screen is always exactly where the main battery will fire.
    updateCraftCamera(dt) {
      const p = this.player, c = this.camera, cam = this.cam;
      if (!p.dead) { cam.x += (p.x - cam.x) * Math.min(1, dt * 6); cam.y += (p.y - cam.y) * Math.min(1, dt * 6); }
      const [fx, fy] = fwd(cam.aimYaw), R = cam.range;
      const ax = cam.x + fx * R, ay = cam.y + fy * R;
      let px, py, ph;
      if (cam.scope) { px = cam.x - fx * 10; py = cam.y - fy * 10; ph = 34; }
      else {
        const back = cam.dist * 0.55 + 40;
        px = cam.x - fx * back; py = cam.y - fy * back; ph = 26 + back * 0.32 + R * 0.05;
      }
      if (cam.mode === 1) { ph = 520; px = cam.x - fx * 60; py = cam.y - fy * 60; }  // tactical view
      c.position.set(px, ph, py);
      const wh = Gfx.waveH(px, py, this.t); if (c.position.y < wh + 5) c.position.y = wh + 5;
      const fov = cam.scope ? 14 : 50;
      if (Math.abs(c.fov - fov) > 0.05) { c.fov += (fov - c.fov) * Math.min(1, dt * 10); c.updateProjectionMatrix(); this.onPixelRatio(); }
      c.lookAt(ax, 0, ay);
      if (!p.sinking && !p.dead) p.aim = {x: ax, y: ay};
      if (cam.shake > 0) {
        const k = cam.shake * cam.shake * (cam.scope ? 0.6 : 3);
        c.position.x += (Math.random() - .5) * k; c.position.y += (Math.random() - .5) * k; c.position.z += (Math.random() - .5) * k;
        cam.shake = Math.max(0, cam.shake - dt * 2.5);
      }
      Sound.setListener(cam.x, cam.y, cam.aimYaw, clamp(cam.dist / 300, 0.8, 2));
    }
    updateCamera(dt) {
      if (this.craft) return this.updateCraftCamera(dt);
      const p = this.player, c = this.camera, cam = this.cam;
      if (!p.dead) { cam.x += (p.x - cam.x) * Math.min(1, dt * 4); cam.y += (p.y - cam.y) * Math.min(1, dt * 4); }
      let pitch = cam.pitch, dist = cam.dist * (this.W < this.H ? 1.4 : 1);
      if (cam.mode === 1) { pitch = Math.max(pitch, 1.05); dist *= 1.8; }
      if (cam.mode === 2) { pitch = Math.min(pitch, 0.12); dist *= 0.6; }
      const heading = p.a + cam.yaw, [fx, fy] = fwd(heading), [px, py] = fwd(p.a);
      const tx = cam.x + px * 40, ty = cam.y + py * 40;
      c.position.set(tx - fx * Math.cos(pitch) * dist, Math.max(6, Math.sin(pitch) * dist + 12), ty - fy * Math.cos(pitch) * dist);
      const wh = Gfx.waveH(c.position.x, c.position.z, this.t);
      if (c.position.y < wh + 5) c.position.y = wh + 5;
      c.lookAt(tx, 10, ty);
      if (cam.shake > 0) {
        const k = cam.shake * cam.shake * 3;
        c.position.x += (Math.random() - .5) * k; c.position.y += (Math.random() - .5) * k; c.position.z += (Math.random() - .5) * k;
        cam.shake = Math.max(0, cam.shake - dt * 2.5);
      }
      Sound.setListener(cam.x, cam.y, heading, clamp(dist / 300, 0.8, 2));
    }
    project(x, h, y) {
      const v = this._pv || (this._pv = new THREE.Vector3());
      v.set(x, h, y).project(this.camera);
      return {x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H, behind: v.z > 1};
    }
    pxRadius(s) {
      const d = this.camera.position.distanceTo(this._pr || (this._pr = new THREE.Vector3()).set(s.x, 0, s.y));
      return s.rad * (this.H / 2) / Math.tan(this.camera.fov * Math.PI / 360) / Math.max(d, 1);
    }

    // ---------------------------------------------------------- HUD
    flash(title, sub) { this.app.ui.flash(title, sub); }
    showHint() {
      const h = $('hint');
      h.textContent = this.craft
        ? (Gfx.IS_TOUCH ? 'Swipe to aim (up/down sets range) · tap to fire, double-tap for a full salvo · rudder bottom-left, telegraph bottom-right'
                        : 'Drag to aim, wheel sets range · click or Space fires, double for a salvo · W/S telegraph · A/D rudder, X centres · T torpedo · R missile/air · Z scope')
        : (Gfx.IS_TOUCH ? 'Left side: steer & throttle · Right side: look · tap an enemy to focus fire'
                        : 'W/S throttle · A/D rudder · drag to look · Tab or click to target · F smoke · C camera');
      h.style.opacity = 1; clearTimeout(this.hintTimer); this.hintTimer = setTimeout(() => { h.style.opacity = 0; }, 7000);
    }
    buildWeaponBar() {
      const counts = {};
      for (const b of this.player.blocks) if (Data.PARTS[b.t].weapon) counts[b.t] = (counts[b.t] || 0) + 1;
      const el = $('weapons'); el.innerHTML = '';
      this.wslots = [];
      for (const t of WEAPON_ORDER) {
        if (!counts[t]) continue;
        const d = document.createElement('div'); d.className = 'wslot';
        d.innerHTML = `<canvas width="56" height="56"></canvas><i></i><b></b>`;
        const cv = d.querySelector('canvas'); App.drawPartIcon(cv.getContext('2d'), t, 28, 28, 40);
        el.appendChild(d);
        this.wslots.push({t, el: d, bar: d.querySelector('i'), num: d.querySelector('b'), total: counts[t]});
      }
    }
    updateHud() {
      const p = this.player, w = this.world;
      const integ = p.integrity;
      $('hInteg').textContent = Math.round(integ * 100) + '%';
      const ib = $('hIntegBar'); ib.style.width = integ * 100 + '%'; ib.style.background = integ > .5 ? 'var(--good)' : integ > .25 ? 'var(--brass)' : 'var(--bad)';
      const res = p.dead || p.sinking ? 0 : p.reserve;
      $('hBuoy').textContent = Math.round(res * 100) + '%';
      const bb = $('hBuoyBar'); bb.style.width = res * 100 + '%'; bb.style.background = res > .4 ? 'var(--good)' : res > .15 ? 'var(--brass)' : 'var(--bad)';
      $('hSpeed').textContent = (Math.abs(p.speed) * Design.KN).toFixed(1) + ' kn';
      const lst = p.listRoll * 180 / Math.PI;
      $('hList').textContent = Math.abs(lst) < 0.5 ? 'level' : `${Math.abs(lst).toFixed(0)}° ${lst > 0 ? 'port' : 'stbd'}`;
      $('hFoes').textContent = w.ships.filter(s => s.team !== 0 && !s.sinking).length;
      $('hTarget').textContent = p.target ? p.target.name : 'auto';
      $('hTime').textContent = Util.fmtTime(this.t);
      if (this.cfg.mode === 'endless') $('hWave').textContent = this.wave;
      const th = this.input.throttle, zero = 1 / 1.4, bar = $('thrBar');
      $('thrZero').style.top = zero * 100 + '%';
      if (th >= 0) { bar.style.top = (zero - th / 1.4) * 100 + '%'; bar.style.height = th / 1.4 * 100 + '%'; bar.style.background = 'var(--brass)'; }
      else { bar.style.top = zero * 100 + '%'; bar.style.height = -th / 1.4 * 100 + '%'; bar.style.background = 'var(--bad)'; }
      for (const sl of this.wslots) {
        let alive = 0, ready = 0;
        for (const b of p.blocks) {
          if (b.t !== sl.t || !b.alive) continue;
          alive++;
          const R = Data.PARTS[b.t].weapon.reload * p.prof.reload / p.mods.reload;
          ready = Math.max(ready, 1 - clamp(b.cd / R, 0, 1));
        }
        sl.num.textContent = alive;
        sl.bar.style.width = (alive ? ready * 100 : 0) + '%';
        sl.el.classList.toggle('dead', !alive);
      }
      if (this.craft) {
        const fc = p.fc;
        $('bTorp').textContent = `TORP ${fc.torpReady || 0}/${fc.torps || 0}`;
        $('bTorp').classList.toggle('ready', fc.torpReady > 0);
        $('bSpecial').classList.toggle('ready', fc.specialReady > 0);
        const s2 = $('bSmoke2'); s2.disabled = p.smokeCd > 0; s2.textContent = p.smokeCd > 0 ? Math.ceil(p.smokeCd) : 'SMK';
        $('tgSpeed').textContent = (Math.abs(p.speed) * Design.KN).toFixed(1) + ' kn';
      }
      const sb = $('bSmoke');
      if (p.hasSmoke) { sb.style.display = ''; sb.disabled = p.smokeCd > 0; sb.textContent = p.smokeCd > 0 ? `Smoke ${Math.ceil(p.smokeCd)}` : 'Smoke'; }
      else sb.style.display = 'none';
      this.drawShipStatus();
      this.drawMinimap();
    }
    drawShipStatus() {
      const p = this.player, c = this.sctx, W = this.shipCv.width / this.dpr, H = this.shipCv.height / this.dpr;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, H);
      const cell = Math.min((W - 4) / p.w, (H - 4) / p.h), ox = (W - cell * p.w) / 2, oy = (H - cell * p.h) / 2;
      const blink = (performance.now() / 250 | 0) % 2;
      for (const b of p.blocks) {
        const x = ox + b.c * cell, y = oy + b.r * cell;
        if (!b.alive) { c.fillStyle = 'rgba(255,90,74,.18)'; c.fillRect(x, y, cell - 0.5, cell - 0.5); continue; }
        const f = b.hp / b.max;
        c.fillStyle = b.fire > 0 && blink ? '#ff8a2a' : f > .66 ? '#7fb39a' : f > .33 ? '#e0b45a' : '#ff5a4a';
        if (b.t === 'bridge') c.fillStyle = b.fire > 0 && blink ? '#ff8a2a' : '#dce8f0';
        c.fillRect(x, y, cell - 0.5, cell - 0.5);
      }
    }
    drawMinimap() {
      const c = this.mctx, sz = this.mm.width / this.dpr, p = this.player;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, sz, sz);
      const sc = (sz - 8) / (FIELD * 2), X = x => (x + FIELD) * sc + 4;
      c.strokeStyle = 'rgba(255,90,74,.3)'; c.strokeRect(4, 4, sz - 8, sz - 8);
      for (const sm of this.world.smokes) { c.fillStyle = 'rgba(200,205,210,.25)'; c.beginPath(); c.arc(X(sm.x), X(sm.y), sm.r * sc, 0, TAU); c.fill(); }
      if (p.range && !p.dead) { c.strokeStyle = 'rgba(224,180,90,.25)'; c.beginPath(); c.arc(X(p.x), X(p.y), p.range * sc, 0, TAU); c.stroke(); }
      for (const s of this.world.ships) {
        c.fillStyle = s.team === 0 ? '#e0b45a' : s.sinking ? '#555' : p.target === s ? '#ffd27a' : '#ff5a4a';
        c.save(); c.translate(X(s.x), X(s.y)); c.rotate(s.a); const k = s.boss ? 1.6 : 1; c.fillRect(-2 * k, -4.5 * k, 4 * k, 9 * k); c.restore();
      }
      const [fx, fy] = fwd(p.a + this.cam.yaw);
      c.strokeStyle = 'rgba(220,232,240,.4)'; c.beginPath(); c.moveTo(X(this.cam.x), X(this.cam.y)); c.lineTo(X(this.cam.x) + fx * 16, X(this.cam.y) + fy * 16); c.stroke();
    }
    drawOverlay() {
      const c = this.octx, p = this.player, W = this.W, H = this.H;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, H);
      if (!p.dead && !this.over) {
        c.font = '600 11px -apple-system,system-ui,sans-serif'; c.textAlign = 'center';
        for (const s of this.world.ships) {
          if (s.team === 0 || s.sinking) continue;
          const pr = this.project(s.x, (s.viz ? s.viz.bob : 0) + 6, s.y);
          const focused = p.target === s, on = !pr.behind && pr.x > 0 && pr.x < W && pr.y > 0 && pr.y < H;
          if (on) {
            const r = clamp(this.pxRadius(s) * 0.8, 16, 170), cc = r * 0.35;
            c.strokeStyle = focused ? 'rgba(224,180,90,.95)' : 'rgba(255,90,74,.6)'; c.lineWidth = focused ? 2 : 1.2;
            c.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(pr.x + sx * r, pr.y + sy * (r - cc)); c.lineTo(pr.x + sx * r, pr.y + sy * r); c.lineTo(pr.x + sx * (r - cc), pr.y + sy * r); }
            c.stroke();
            const frac = s.integrity, bw = Math.max(36, r * 1.4);
            c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(pr.x - bw / 2, pr.y - r - 12, bw, 5);
            c.fillStyle = frac > .5 ? '#5fd38a' : frac > .25 ? '#e0b45a' : '#ff5a4a'; c.fillRect(pr.x - bw / 2, pr.y - r - 12, bw * frac, 5);
            if (focused || r >= 34 || s.boss) {
              c.fillStyle = 'rgba(230,240,246,.9)';
              c.fillText(`${s.name} · ${Math.round(Math.hypot(s.x - p.x, s.y - p.y))}`, pr.x, pr.y - r - 17);
            }
          } else {
            let ax = pr.x - W / 2, ay = pr.y - H / 2;
            if (pr.behind) { ax = -ax; ay = -ay; if (Math.abs(ay) < 1) ay = H; }
            const a = Math.atan2(ay, ax), k = Math.min((W / 2 - 28) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 28) / Math.abs(Math.sin(a) || 1e-6));
            c.save(); c.translate(W / 2 + Math.cos(a) * k, H / 2 + Math.sin(a) * k); c.rotate(a);
            c.fillStyle = focused ? '#e0b45a' : '#ff5a4a';
            c.beginPath(); c.moveTo(11, 0); c.lineTo(-7, -8); c.lineTo(-7, 8); c.closePath(); c.fill(); c.restore();
          }
        }
      }
      if (this.craft && !p.dead && !p.sinking && !this.over) this.drawReticle(c, W, H);
      const j = this.input.joy;
      if (j) {
        c.strokeStyle = 'rgba(220,232,240,.4)'; c.lineWidth = 2; c.beginPath(); c.arc(j.ox, j.oy, 60, 0, TAU); c.stroke();
        const dx = clamp(j.x - j.ox, -60, 60), dy = clamp(j.y - j.oy, -60, 60);
        c.fillStyle = 'rgba(224,180,90,.65)'; c.beginPath(); c.arc(j.ox + dx, j.oy + dy, 22, 0, TAU); c.fill();
      }
    }

    // Centre reticle: green when a main mount can fire, yellow when in range but none bear/are loaded, red out of range.
    drawReticle(c, W, H) {
      const p = this.player, fc = p.fc, cx = W / 2, cy = H / 2, cam = this.cam;
      const col = fc.canFire > 0 ? '#5fd38a' : fc.inRange ? '#e0b45a' : '#ff5a4a';
      const r = cam.scope ? 34 : 24;
      c.save();
      c.lineWidth = 2; c.strokeStyle = col; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 4;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(cx + dx * (r + 4), cy + dy * (r + 4)); c.lineTo(cx + dx * (r + 14), cy + dy * (r + 14)); c.stroke(); }
      c.fillStyle = col; c.beginPath(); c.arc(cx, cy, 2, 0, TAU); c.fill();
      if (fc.main && fc.reload > 0 && fc.canFire === 0) { // reload arc for the quickest mount
        c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.7)';
        c.beginPath(); c.arc(cx, cy, r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - fc.reload)); c.stroke();
      }
      // mount pips: green can fire, yellow loaded but not bearing, grey reloading
      const n = fc.mounts.length, pw = 9;
      fc.mounts.forEach((m, i) => { c.fillStyle = m === 2 ? '#5fd38a' : m === 1 ? '#e0b45a' : 'rgba(200,210,220,.35)'; c.fillRect(cx - n * pw / 2 + i * pw + 1, cy + r + 20, pw - 3, 5); });
      c.shadowBlur = 0;
      c.font = '600 12px ui-monospace,menlo,monospace'; c.textAlign = 'center'; c.fillStyle = col;
      c.fillText(`${Util.fmtNum(cam.range)} m${fc.inRange ? '' : ' · OUT OF RANGE'}`, cx, cy + r + 40);
      // lead pip (aim assist): where the enemy nearest the reticle will be when a shell arrives
      if (this.cfg.settings.aimAssist !== false && p.mainType) {
        const W2 = Data.PARTS[p.mainType].weapon;
        let best = null, bd = 220;
        for (const s of this.world.ships) {
          if (s.team === 0 || s.sinking) continue;
          const pr = this.project(s.x, 4, s.y); if (pr.behind) continue;
          const d = Math.hypot(pr.x - cx, pr.y - cy); if (d < bd) { bd = d; best = s; }
        }
        if (best && W2.speed) {
          const T = Math.hypot(best.x - p.x, best.y - p.y) / W2.speed;
          const lp = this.project(best.x + best.vx * T, 4, best.y + best.vy * T);
          if (!lp.behind) {
            c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(lp.x, lp.y - 8); c.lineTo(lp.x + 8, lp.y); c.lineTo(lp.x, lp.y + 8); c.lineTo(lp.x - 8, lp.y); c.closePath(); c.stroke();
          }
        }
      }
      if (cam.scope) { // telescope vignette
        const g = c.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.max(W, H) * 0.62);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      c.restore();
    }

    dispose() {
      this.unbind();
      clearTimeout(this.hintTimer);
      Sound.stopAmbient(); Sound.stopMusic();
      this.viz.clear(); this.viz.pools.dispose(); this.viz.particles.geo.dispose(); this.viz.glow.geo.dispose();
      this.env.scene.remove(this.buoys); this.buoys.dispose();
      this.env.dispose();
      // Sweep anything else this battle's scene created; the shared geometry library survives.
      const shared = new Set(Object.values(Gfx.GEO));
      this.env.scene.traverse(o => {
        if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
      this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
  }
  return Battle;
})();
