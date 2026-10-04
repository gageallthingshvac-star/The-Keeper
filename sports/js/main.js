/* Sunny Sports — main.js
 * The product shell: boot, the 3D plaza behind every menu, the screens (title, Pal creator,
 * main menu, setup sheet, Pals, records, settings), launching sports with the §6.8 ctx,
 * pause, results and the URL parameters of §6.3.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const THREE = SS.THREE || window.THREE;
  const U = SS.util;
  const ui = SS.ui;
  const save = SS.save;
  const params = (SS.debug && SS.debug.params) || {};

  // ---------------------------------------------------------------------------------------------
  // Constants & helpers
  // ---------------------------------------------------------------------------------------------

  const MAX_PALS = 8;
  const DEFAULT_ACCENT = '#1FA2FF';
  const DEFAULT_TINT = '#E6F5FF';
  const MEDAL_TIERS = ['bronze', 'silver', 'gold', 'platinum'];
  const DEG = Math.PI / 180;
  const esc = ui.esc;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const AUDIO_STUB = {
    unlock() {}, sfx() {}, music() {}, duck() {}, setVolumes() {}, suspend() {}, resumeAll() {},
    loop() { return { setVolume() {}, setRate() {}, stop() {} }; },
  };
  const audio = () => SS.audio || AUDIO_STUB;
  const sfx = (name, o) => audio().sfx(name, o);
  const music = (id, o) => audio().music(id, o);

  const GENERIC_ICON = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#FFC93C"/>' +
    '<path d="M14 26q18 10 36 0M14 38q18-10 36 0" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';

  function sportList() { return SS.sportOrder.map(id => SS.sports[id]).filter(Boolean); }
  function humanPals() { return save.profiles().filter(p => !p.isGuest); }
  function sportIcon(sport) { return (sport && sport.icon) || GENERIC_ICON; }
  function modeOf(sport, id) { return (sport.modes || []).find(m => m.id === id) || (sport.modes || [])[0] || { id: 'play', name: 'Play' }; }

  function setAccent(accent, tint) {
    const s = document.documentElement.style;
    s.setProperty('--accent', accent || DEFAULT_ACCENT);
    s.setProperty('--tint', tint || DEFAULT_TINT);
  }

  function medalTier(sport, medalId) {
    if (MEDAL_TIERS.indexOf(medalId) >= 0) return medalId;
    const i = (sport.medals || []).findIndex(m => m.id === medalId);
    return MEDAL_TIERS[U.clamp(i, 0, 3)];
  }

  /** Progress (0..1) of a level within its rank band. */
  function rankProgress(level) {
    const r = save.rankFor(level);
    const top = r.next ? r.next.min : save.LEVEL_MAX;
    return U.clamp((level - r.min) / Math.max(1, top - r.min), 0, 1);
  }

  function rankChip(level, extra) {
    const r = save.rankFor(level);
    return '<span class="rank-chip r-' + r.id + (extra ? ' ' + extra : '') + '">' + ui.icon(r.index >= 3 ? 'crown' : 'star') +
      '<span>' + esc(r.name) + '</span></span>';
  }

  function formatValue(value, fmt) {
    if (typeof fmt === 'string') {
      if (U.fmt[fmt]) return U.fmt[fmt](value);
      if (fmt.indexOf('{v}') >= 0) return fmt.replace('{v}', U.fmt.int(value));
    }
    return Number.isInteger(value) ? U.fmt.int(value) : (Math.round(value * 10) / 10).toString();
  }

  function shortDate(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (err) { return ''; }
  }

  /** <img> markup of a pal portrait (cached data URL), for innerHTML templates. */
  function portraitHTML(profile, size, cls) {
    const img = ui.portraitImg(profile, size);
    return '<img class="ss-portrait' + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size + '" alt="" draggable="false" src="' + img.src + '">';
  }

  function guestProfile(index) {
    const p = SS.pals.randomProfile(U.rng('guest-' + index), 'Guest ' + (index + 1));
    p.id = 'guest-' + index;
    p.isGuest = true;
    return p;
  }

  /** Identity-free key of a profile's look (same look → same key). */
  function profileKeyOf(p) {
    return JSON.stringify(SS.pals.sanitize(Object.assign({}, p, { id: 'x', name: 'x', created: 1 })));
  }

  /** Makes sure there is an active, saved Pal (used by URL shortcuts). */
  function ensureProfile() {
    if (save.activeProfile() && !save.activeProfile().isGuest) return save.activeProfile();
    const existing = humanPals()[0];
    if (existing) { save.setActiveProfile(existing.id); return existing; }
    const p = save.upsertProfile(SS.pals.defaultProfile('You'));
    save.setActiveProfile(p.id);
    return p;
  }

  /** Remembered setup choices per sport (kept inside settings so a data reset clears them). */
  function lastSetup(sportId) {
    const all = save.settings.lastSetup;
    return all && typeof all === 'object' && all[sportId] ? all[sportId] : {};
  }

  function rememberSetup(sportId, data) {
    const all = save.settings.lastSetup && typeof save.settings.lastSetup === 'object' ? save.settings.lastSetup : {};
    all[sportId] = data;
    save.settings.lastSetup = all;
    save.dirty();
  }

  // ---------------------------------------------------------------------------------------------
  // Plaza: the living park behind every menu (props, strolling Pals, camera rig)
  // ---------------------------------------------------------------------------------------------

  const plaza = (function () {
    const HERO_POS = new THREE.Vector3(0, 0.22, 2.7);
    const FOUNTAIN = new THREE.Vector3(0, 0, -3.4);
    let scene = null, camera = null, env = null;
    let built = false, active = false;
    let hero = null, heroKey = '', heroSpin = 0, heroSpinVel = 0;
    let heroIdleTimer = 4;
    const actors = [];
    let flag = null, sprayTimer = 0;
    let preset = null, snap = true, yaw = 0.4;
    const cur = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, offX: 0, offY: 0 };
    const goal = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, offX: 0, offY: 0 };
    const _v = new THREE.Vector3();

    // ---- geometry helpers ------------------------------------------------------------------------

    /** Colors every triangle by its centroid: fn(x, y, z) -> hex. Returns a non-indexed geometry. */
    function faceColors(geo, fn) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      const pos = g.attributes.position, n = pos.count;
      const col = new Float32Array(n * 3), c = new THREE.Color();
      for (let i = 0; i < n; i += 3) {
        const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
        const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
        const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        c.set(fn(cx, cy, cz));
        for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }

    const W = () => SS.world;
    const colored = (geo, hex) => W().paint(geo, hex);
    function at(geo, x, y, z, ry = 0, rx = 0, rz = 0) {
      if (rx) geo.rotateX(rx);
      if (rz) geo.rotateZ(rz);
      if (ry) geo.rotateY(ry);
      geo.translate(x, y, z);
      return geo;
    }

    function pinGeometry() {
      const prof = [[0, 0], [0.026, 0], [0.042, 0.03], [0.058, 0.09], [0.06, 0.125], [0.053, 0.17], [0.036, 0.215],
        [0.03, 0.228], [0.025, 0.242], [0.0235, 0.25], [0.024, 0.262], [0.026, 0.272], [0.033, 0.31], [0.033, 0.345], [0.022, 0.372], [0, 0.38]];
      const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
      return faceColors(g, (x, y) => ((y > 0.226 && y < 0.243) || (y > 0.25 && y < 0.266) ? 0xE8343A : 0xFFFFFF));
    }

    function batGeometry() {
      const prof = [[0, 0], [0.018, 0], [0.019, 0.02], [0.013, 0.04], [0.013, 0.32], [0.024, 0.52], [0.034, 0.74], [0.036, 0.82], [0.03, 0.85], [0, 0.86]];
      const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12);
      return faceColors(g, (x, y) => (y < 0.22 ? 0x3A2A22 : 0xD9A86C));
    }

    // ---- static props (merged by material) ---------------------------------------------------------

    function buildProps() {
      const lam = [], phong = [], rng = U.rng(11);
      const S = 1.3;   // sport props are a touch over life size so they read from the menu camera

      // Hero podium
      lam.push(colored(at(new THREE.CylinderGeometry(0.78, 0.84, 0.2, 40), HERO_POS.x, 0.1, HERO_POS.z), 0xFFFFFF));
      lam.push(colored(at(new THREE.TorusGeometry(0.79, 0.035, 8, 48), HERO_POS.x, 0.2, HERO_POS.z, 0, Math.PI / 2), 0x1FA2FF));
      lam.push(colored(at(new THREE.CylinderGeometry(0.86, 0.9, 0.04, 40), HERO_POS.x, 0.02, HERO_POS.z), 0xD8E7F5));

      // Fountain
      const F = FOUNTAIN;
      lam.push(colored(at(new THREE.CylinderGeometry(1.9, 2.0, 0.5, 40, 1, true), F.x, 0.25, F.z), 0xE9DEC8));
      lam.push(colored(at(new THREE.TorusGeometry(1.95, 0.12, 8, 48), F.x, 0.5, F.z, 0, Math.PI / 2), 0xF4ECDD));
      lam.push(colored(at(new THREE.CylinderGeometry(0.22, 0.3, 1.2, 16), F.x, 0.6, F.z), 0xE9DEC8));
      lam.push(colored(at(new THREE.SphereGeometry(0.62, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), F.x, 1.32, F.z), 0xF4ECDD));
      lam.push(colored(at(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 12), F.x, 1.5, F.z), 0xE9DEC8));
      phong.push(colored(at(new THREE.SphereGeometry(0.16, 16, 10), F.x, 1.82, F.z), 0xFFC93C));

      // Bowling corner: little lane, pins in a triangle, a ball
      const BX = -6.3, BZ = -3.2;
      lam.push(colored(at(new THREE.BoxGeometry(1.25, 0.05, 4.6), BX, 0.025, BZ), 0xE2B57A));
      lam.push(colored(at(new THREE.BoxGeometry(0.16, 0.08, 4.6), BX - 0.7, 0.04, BZ), 0x8E99A8));
      lam.push(colored(at(new THREE.BoxGeometry(0.16, 0.08, 4.6), BX + 0.7, 0.04, BZ), 0x8E99A8));
      for (let row = 0; row < 4; row++) {
        for (let i = 0; i <= row; i++) {
          const pin = pinGeometry();
          pin.scale(S, S, S);
          phong.push(at(pin, BX + (i - row / 2) * 0.3 * S, 0.05, BZ - 1.2 - row * 0.26 * S));
        }
      }
      phong.push(colored(at(new THREE.SphereGeometry(0.11 * S, 20, 14), BX + 0.2, 0.05 + 0.11 * S, BZ + 1.9), 0x2F5FD8));

      // Tennis corner: net with posts, a few balls
      const TX = 6.4, TZ = -3.0;
      for (const dz of [-1.7, 1.7]) {
        lam.push(colored(at(new THREE.CylinderGeometry(0.05, 0.05, 1.12, 10), TX, 0.56, TZ + dz), 0x2F5D50));
      }
      lam.push(colored(at(new THREE.BoxGeometry(0.05, 0.08, 3.4), TX, 1.0, TZ), 0xFFFFFF));
      for (let i = 0; i < 5; i++) {
        phong.push(colored(at(new THREE.SphereGeometry(0.05, 12, 8), TX - 0.7 - rng.range(0, 1.4), 0.05, TZ + rng.range(-1.6, 1.8)), 0xD7F04A));
      }

      // Golf corner: putting green, flag, ball
      const GX = -5.2, GZ = -13.5;
      phong.push(colored(at(new THREE.SphereGeometry(0.035 * S, 12, 8), GX + 0.9, 0.06, GZ + 0.8), 0xFFFFFF));
      lam.push(colored(at(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16), GX - 0.3, 0.035, GZ - 0.2), 0x1A1F1A));

      // Baseball corner: dirt circle, home plate, bat, balls
      const HX = 5.6, HZ = -13.2;
      const plate = new THREE.Shape([[0, 0.3], [0.3, 0.1], [0.3, -0.2], [-0.3, -0.2], [-0.3, 0.1]].map(([x, y]) => new THREE.Vector2(x * S, y * S)));
      lam.push(colored(at(new THREE.ExtrudeGeometry(plate, { depth: 0.03, bevelEnabled: false }), HX, 0.06, HZ, 0, -Math.PI / 2), 0xFFFFFF));
      const bat = batGeometry();
      bat.scale(S, S, S);
      phong.push(at(bat, HX + 1.1, 0.06, HZ + 0.6, 0.6, 0, Math.PI / 2));
      for (let i = 0; i < 3; i++) {
        const ball = faceColors(new THREE.SphereGeometry(0.05 * S, 14, 10), (x, y, z) => (Math.abs(Math.sin(x * 50) * 0.02 - z) < 0.008 ? 0xE8343A : 0xFFFFFF));
        phong.push(at(ball, HX - 0.8 + i * 0.22, 0.06 + 0.05 * S, HZ + 0.9 + rng.range(-0.1, 0.1)));
      }

      // Benches facing the fountain
      for (const [x, z] of [[-4.6, 4.4], [4.6, 4.4], [-2.8, -8.5], [2.8, -8.5]]) {
        const ry = Math.atan2(F.x - x, F.z - z);
        const parts = [
          colored(new THREE.BoxGeometry(1.6, 0.08, 0.5), 0xC98B52),
          colored(new THREE.BoxGeometry(1.6, 0.36, 0.07), 0xC98B52),
          colored(new THREE.BoxGeometry(0.08, 0.45, 0.45), 0x3E4B5E),
          colored(new THREE.BoxGeometry(0.08, 0.45, 0.45), 0x3E4B5E),
        ];
        parts[0].translate(0, 0.45, 0);
        parts[1].translate(0, 0.72, -0.24);
        parts[2].translate(-0.68, 0.22, 0);
        parts[3].translate(0.68, 0.22, 0);
        for (const p of parts) lam.push(at(p, x, 0, z, ry));
      }

      // Lamp posts with festive bunting
      const lamps = [[-8.2, 1.6], [-5.6, -8.6], [5.6, -8.6], [8.2, 1.6]];
      for (const [x, z] of lamps) {
        lam.push(colored(at(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 10), x, 1.7, z), 0x2F5D50));
        lam.push(colored(at(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 12), x, 0.06, z), 0x2F5D50));
        phong.push(colored(at(new THREE.SphereGeometry(0.22, 16, 12), x, 3.5, z), 0xFFF4D6));
      }
      const flagColors = [0xFF5A5F, 0xFFC93C, 0x3BC45B, 0x1FA2FF, 0x9B6BFF, 0xFF8A2B];
      let fi = 0;
      for (let i = 0; i < lamps.length - 1; i++) {
        const [x0, z0] = lamps[i], [x1, z1] = lamps[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(6, Math.round(len / 0.55));
        const ry = Math.atan2(x1 - x0, z1 - z0);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const y = 3.3 - Math.sin(t * Math.PI) * 0.75;
          const tri = new THREE.BufferGeometry();
          tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.17, 0, 0, 0.17, 0, -0.36, 0], 3));
          tri.computeVertexNormals();
          lam.push(at(colored(tri, flagColors[fi++ % flagColors.length]), x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, ry + Math.PI / 2));
        }
      }

      // Flower beds along the plaza edge
      const petals = [0xFF6FAE, 0xFFC93C, 0xFFFFFF, 0xFF5A5F, 0x9B6BFF];
      for (const a of [-2.35, -1.95, -1.15, -0.75, 0.75, 1.15, 1.95, 2.35]) {
        const cx = Math.sin(a) * 9.6, cz = Math.cos(a) * 9.6;
        lam.push(colored(at(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cx, 0, cz), 0x4C9E45));
        for (let k = 0; k < 9; k++) {
          const r = rng.range(0, 0.55), b = rng.range(0, Math.PI * 2);
          phong.push(colored(at(new THREE.SphereGeometry(0.075, 8, 6), cx + Math.cos(b) * r, 0.62 * Math.sqrt(1 - (r / 0.7) * (r / 0.7)) + 0.03, cz + Math.sin(b) * r), rng.pick(petals)));
        }
      }

      const lamMesh = new THREE.Mesh(W().mergeGeometries(lam), W().mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
      const phongMesh = new THREE.Mesh(W().mergeGeometries(phong), W().mat(0xffffff, { kind: 'phong', vertexColors: true, shininess: 60 }));
      for (const m of [lamMesh, phongMesh]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

      // Textured surfaces
      const disc = (r, tex, x, z, y) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), W().mat(0xffffff, { map: tex }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, y, z);
        m.receiveShadow = true;
        scene.add(m);
        return m;
      };
      disc(240, W().texture('grass', { repeat: [60, 60] }), 0, 0, -0.03);
      disc(26, W().texture('grass_stripes', { repeat: [5, 5] }), 0, 0, -0.01);
      disc(8.8, W().texture('checker', { colors: ['#F6EAD2', '#EADBBE'], cells: 8, repeat: [7, 7] }), 0, 0, 0.004);
      const rim = new THREE.Mesh(new THREE.RingGeometry(8.8, 9.25, 64), W().mat(0xD3C09C));
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.006;
      rim.receiveShadow = true;
      scene.add(rim);
      disc(2.5, W().texture('green', { repeat: [1.2, 1.2] }), GX, GZ, 0.01);
      disc(2.3, W().texture('dirt', { repeat: [1.2, 1.2] }), HX, HZ, 0.01);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1.88, 40), W().mat(0x56C3F0, { kind: 'phong', shininess: 90 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(F.x, 0.42, F.z);
      scene.add(water);

      // Tennis net (canvas mesh texture)
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(40,48,60,0.9)';
      g.lineWidth = 2;
      for (let x = 0; x <= 128; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
      for (let y = 0; y <= 64; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
      const netTex = new THREE.CanvasTexture(c);
      netTex.colorSpace = THREE.SRGBColorSpace;
      netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
      netTex.repeat.set(4, 1);
      const net = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.82), new THREE.MeshLambertMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.3 }));
      net.rotation.y = Math.PI / 2;
      net.position.set(TX, 0.55, TZ);
      scene.add(net);

      // Golf flag (sways)
      flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 8), W().mat(0xFFFFFF, { kind: 'phong' }));
      pole.position.y = 1.05;
      pole.castShadow = true;
      const clothGeo = new THREE.BufferGeometry();
      clothGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.05, 0, 0, 1.6, 0, 0.62, 1.82, 0], 3));
      clothGeo.computeVertexNormals();
      const cloth = new THREE.Mesh(clothGeo, W().mat(0xFF5A5F, { side: THREE.DoubleSide }));
      cloth.castShadow = true;
      flag.add(pole, cloth);
      flag.position.set(GX - 0.3, 0, GZ - 0.2);
      scene.add(flag);

      // Nearby trees framing the back of the plaza (merged: one draw call)
      const trng = U.rng(5);
      const treeParts = [];
      let treeMat = null;
      for (const [x, z, kind, s] of [[-12, -6, 'round', 1.8], [-14.5, -13, 'pine', 2.0], [-9.5, -19, 'round', 2.2], [-1.5, -21, 'pine', 2.3],
        [9.5, -19.5, 'round', 2.0], [14, -12, 'pine', 1.9], [12.5, -4.5, 'round', 1.7], [-13.5, 3.5, 'bush', 1.6], [13.5, 4, 'bush', 1.5]]) {
        const t = W().tree(kind, s, trng);
        t.position.set(x, 0, z);
        t.updateMatrixWorld(true);
        t.traverse(o => {
          if (!o.isMesh) return;
          treeParts.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
          treeMat = o.material;
          o.geometry.dispose();
        });
      }
      const trees = new THREE.Mesh(W().mergeGeometries(treeParts), treeMat);
      trees.castShadow = true;
      trees.receiveShadow = true;
      scene.add(trees);
    }

    // ---- strolling & playing Pals ------------------------------------------------------------------

    function addActor(rosterIndex, kind, o) {
      const entry = SS.pals.CPU_ROSTER[rosterIndex % SS.pals.CPU_ROSTER.length];
      // Far background Pals are low detail with a cheap blob instead of a real shadow.
      const pal = SS.pals.create(entry.profile, { detail: o.low ? 'low' : 'high', shadows: !o.low });
      if (o.low) pal.root.add(W().blobShadow(0.36, 0.3));
      scene.add(pal.root);
      const a = Object.assign({ pal, kind, t: 0, timer: 2 + Math.random() * 4 }, o);
      if (kind === 'station') {
        pal.root.position.copy(a.pos);
        pal.setFacing(a.face);
        if (a.base) pal.play(a.base);
      } else {
        pal.play(kind === 'jog' ? 'run' : 'walk');
        pal.setSpeed(a.speed);
        placeOnPath(a);
      }
      actors.push(a);
      return a;
    }

    function buildActors() {
      addActor(3, 'station', { pos: new THREE.Vector3(-5.2, 0, 0.6), face: 0.5, reactions: ['cheer', 'clap', 'hop'] });
      addActor(8, 'station', { pos: new THREE.Vector3(5.1, 0, -1.4), face: -0.9, base: 'idle_ready', reactions: ['hop', 'cheer', 'jump'] });
      addActor(6, 'station', { pos: new THREE.Vector3(-3.8, 0, -12.2), face: 0.2, low: true, reactions: ['clap', 'bow', 'wave'] });
      addActor(10, 'station', { pos: new THREE.Vector3(4.2, 0, -11.6), face: -0.3, low: true, reactions: ['dance', 'cheer', 'jump'] });
      addActor(0, 'pace', { center: FOUNTAIN, rx: 3.3, rz: 3.1, speed: 1.1, angle: 3.6, from: 3.5, to: 5.95, dir: 1, rest: 0 });
      addActor(4, 'jog', { center: new THREE.Vector3(0, 0, -12), rx: 13, rz: 5, speed: 3.3, angle: 3.5, dir: -1, low: true });
    }

    function placeOnPath(a) {
      const x = a.center.x + Math.cos(a.angle) * a.rx, z = a.center.z + Math.sin(a.angle) * a.rz;
      const tx = -Math.sin(a.angle) * a.rx * a.dir, tz = Math.cos(a.angle) * a.rz * a.dir;
      a.pal.root.position.set(x, 0, z);
      if (!(a.rest > 0)) a.pal.setFacing(Math.atan2(tx, tz));
    }

    function updateActors(dt) {
      for (const a of actors) {
        const pal = a.pal;
        if (a.kind === 'station') {
          a.timer -= dt;
          if (a.timer <= 0) {
            a.timer = 4 + Math.random() * 5;
            pal.play(a.reactions[Math.floor(Math.random() * a.reactions.length)]);
          }
        } else if (a.rest > 0) {
          a.rest -= dt;
          if (a.rest <= 0) { pal.play('walk'); placeOnPath(a); }
        } else {
          const perim = Math.PI * (a.rx + a.rz);
          a.angle += a.dir * a.speed * dt / perim * Math.PI * 2;
          if (a.kind === 'pace' && (a.angle > a.to || a.angle < a.from)) {
            a.angle = U.clamp(a.angle, a.from, a.to);
            a.dir = -a.dir;
            a.rest = 2.2 + Math.random() * 2;
            pal.play(Math.random() < 0.5 ? 'wave' : 'idle');
          }
          placeOnPath(a);
        }
        pal.update(dt);
      }
    }

    // ---- hero ------------------------------------------------------------------------------------------

    /** Shows `profile` on the podium (rebuilt only when its look changed). react: 'hop' | 'wave' | null. */
    function setHero(profile, react) {
      if (!built) return;
      const key = profile ? profileKeyOf(profile) : '';
      if (key !== heroKey) {
        heroKey = key;
        if (hero) { hero.dispose(); hero = null; }
        if (profile) {
          hero = SS.pals.create(profile);
          hero.root.position.copy(HERO_POS);
          hero.setFacing(heroSpin);
          scene.add(hero.root);
        }
      }
      if (hero && react) heroReact(react);
    }

    function heroReact(kind) {
      if (!hero) return;
      heroIdleTimer = 6 + Math.random() * 4;
      if (kind === 'hop') { hero.play('hop'); hero.setExpression('happy', 1.1); }
      else if (kind === 'wave') { hero.play('wave'); hero.setExpression('joy', 1.6); }
      else if (kind === 'cheer') { hero.play('cheer'); }
      else hero.play(kind);
    }

    function spinHero(delta) { heroSpinVel = 0; heroSpin += delta; }
    function flingHero(vel) { heroSpinVel = vel; }

    function updateHero(dt) {
      if (!hero) return;
      heroSpin += heroSpinVel * dt;
      heroSpinVel *= Math.exp(-dt * 3);
      if (Math.abs(heroSpinVel) < 0.02 && !(preset && preset.keepSpin)) heroSpin = U.damp(heroSpin, Math.round(heroSpin / (Math.PI * 2)) * Math.PI * 2, 1.6, dt);
      hero.setFacing(heroSpin);
      hero.lookAt(camera.position);
      heroIdleTimer -= dt;
      if (heroIdleTimer <= 0) {
        heroIdleTimer = 7 + Math.random() * 6;
        hero.play(Math.random() < 0.6 ? 'hop' : 'wave');
      }
      hero.update(dt);
    }

    /** Screen position of the hero's head top (css px) for speech bubbles. */
    function heroHeadScreen() {
      if (!hero || !SS.engine) return null;
      _v.copy(HERO_POS);
      _v.y += hero.height + 0.12;
      return SS.engine.project(_v, camera);
    }

    // ---- camera rig ------------------------------------------------------------------------------------

    /**
     * preset: { kind: 'orbit'|'hero', rect: () => DOMRect-like, fov, fill,
     *           orbit: { center, radius, pitch, spin }  |  hero: { fillW, dir } }
     */
    function frame(p) {
      preset = p;
      if (p && p.kind === 'orbit' && p.yaw != null) yaw = p.yaw;
    }

    function computeGoal(dt) {
      const size = SS.engine.size;
      const w = size.w, h = size.h;
      let r = preset.rect ? preset.rect() : null;
      if (!r || r.width < 20 || r.height < 20) r = { left: 0, top: 0, width: w, height: h };
      const fov = preset.fov || 40;
      const t = Math.tan(fov * DEG / 2);
      if (preset.kind === 'orbit') {
        yaw += dt * (preset.spin == null ? 0.05 : preset.spin);
        const span = Math.min(r.width, r.height * 1.25) * (preset.fill || 1);
        const d = preset.radius * h / (t * span);
        const pitch = preset.pitch || 0.4;
        goal.look.copy(preset.center);
        goal.pos.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d).add(preset.center);
      } else {
        const H = (hero ? hero.height : 1.45) + 0.3;
        const ppm = Math.min(r.height * (preset.fill || 0.8) / H, r.width * (preset.fillW || 0.7) / 1.0);
        const d = h / (2 * t * ppm);
        goal.look.set(HERO_POS.x, HERO_POS.y + H / 2 - 0.2 + (preset.lift || 0), HERO_POS.z);
        const dir = preset.dir || _v.set(0.1, 0.16, 1).normalize();
        goal.pos.copy(goal.look).addScaledVector(dir, d);
      }
      goal.fov = fov;
      goal.offX = w / 2 - (r.left + r.width / 2);
      goal.offY = h / 2 - (r.top + r.height / 2);
    }

    function updateCamera(dt) {
      if (!preset) return;
      computeGoal(dt);
      if (snap) {
        cur.pos.copy(goal.pos); cur.look.copy(goal.look);
        cur.fov = goal.fov; cur.offX = goal.offX; cur.offY = goal.offY;
        snap = false;
      } else {
        const k = preset.lambda || 3.2;
        U.dampVec3(cur.pos, goal.pos, k, dt);
        U.dampVec3(cur.look, goal.look, k, dt);
        cur.fov = U.damp(cur.fov, goal.fov, k, dt);
        cur.offX = U.damp(cur.offX, goal.offX, k * 1.4, dt);
        cur.offY = U.damp(cur.offY, goal.offY, k * 1.4, dt);
      }
      const size = SS.engine.size;
      camera.aspect = size.w / size.h;
      camera.fov = cur.fov;
      camera.setViewOffset(size.w, size.h, cur.offX, cur.offY, size.w, size.h);
      camera.updateProjectionMatrix();
      camera.position.copy(cur.pos);
      camera.lookAt(cur.look);
    }

    // ---- lifecycle -------------------------------------------------------------------------------------

    function update(dt) {
      if (!active) return;
      updateActors(dt);
      updateHero(dt);
      if (flag) flag.rotation.y = Math.sin(SS.engine.time * 1.7) * 0.35 + 0.3;
      sprayTimer -= dt;
      if (sprayTimer <= 0) {
        sprayTimer = 0.14;
        W().burst(scene, _v.set(FOUNTAIN.x, 1.95, FOUNTAIN.z), { count: 3, color: 0xCFF0FF, speed: 1.5, size: 0.07, gravity: -5.5, life: 0.75 });
      }
      updateCamera(dt);
    }

    function build() {
      if (built) return;
      scene = new THREE.Scene();
      scene.name = 'plaza';
      camera = new THREE.PerspectiveCamera(40, SS.engine.size.aspect, 0.1, 700);
      env = W().environment(scene, {
        sky: 'day', ground: false, fogNear: 60, fogFar: 260, clouds: 12, hillRadius: 170,
        trees: { ring: 30, count: 46 }, shadow: { center: new THREE.Vector3(0, 0, -3), size: 30 }, seed: 21,
      });
      buildProps();
      buildActors();
      built = true;
      SS.engine.addUpdate(update, 50);
    }

    /** Compiles the plaza's shaders up front (under the loading screen) so the first menu frame doesn't hitch. */
    function warm() {
      if (!built || !SS.engine.renderer) return;
      SS.engine.renderer.compile(scene, camera);
    }

    function setActive(on) {
      if (!built) return;
      if (on && !active) {
        snap = true;
        SS.engine.setView(scene, camera);
      }
      active = !!on;
      if (on) env.setShadowFocus(new THREE.Vector3(0, 0, -3), 30);
    }

    return {
      build, warm, setActive, setHero, heroReact, spinHero, flingHero, frame, heroHeadScreen,
      get active() { return active; },
      get hero() { return hero; },
      get scene() { return scene; },
    };
  })();

  // ---------------------------------------------------------------------------------------------
  // Screen manager (menus live in #ss-screens; the plaza camera follows each screen's preset)
  // ---------------------------------------------------------------------------------------------

  let current = null;            // { id, el, back(), leave() }
  const SCREENS = {};

  function rectOf(selector) {
    return () => {
      const node = current && current.el.querySelector(selector);
      return node ? node.getBoundingClientRect() : null;
    };
  }

  const CAMERAS = {
    title: () => ({ kind: 'orbit', center: new THREE.Vector3(0, 0.6, -3), radius: 10, pitch: 0.3, spin: 0.045, fov: 42, fill: 1.3, rect: rectOf('.title-stage') }),
    wide: () => ({ kind: 'orbit', center: new THREE.Vector3(0, 0.8, -3), radius: 9.5, pitch: 0.52, spin: 0.03, fov: 42, fill: 1.1 }),
    hero: sel => ({ kind: 'hero', fov: 30, fill: 0.86, fillW: 0.8, rect: rectOf(sel) }),
  };

  function showScreen(id, opts = {}) {
    const make = SCREENS[id];
    if (!make) return;
    if (current) {
      const old = current;
      if (old.leave) old.leave();
      old.el.classList.add('is-leaving');
      old.el.style.pointerEvents = 'none';
      setTimeout(() => old.el.remove(), 260);
    }
    // DOM confetti belongs to the plaza screens; it must not rain over the text of a panel screen
    if (id !== 'menu' && id !== 'title') {
      for (const c of ui.fx.querySelectorAll('.ss-confetti')) {
        c.style.transition = 'opacity .25s';
        c.style.opacity = '0';
        setTimeout(() => c.remove(), 260);
      }
    }
    const s = make(opts);
    s.id = id;
    current = s;
    ui.screens.appendChild(s.el);
    SS.debug.screen = id;
    setAccent();
    plaza.setActive(true);
    if (s.camera) plaza.frame(s.camera);
    if (s.music !== undefined) music(s.music);
    return s;
  }

  function clearScreens() {
    if (current && current.leave) current.leave();
    current = null;
    ui.screens.innerHTML = '';
  }

  function goBack() {
    if (resultsEl) { exitToMenu(false); return; }
    if (game) { onGameBack(); return; }
    if (current && current.back) current.back();
  }

  ui.events.on('back', goBack);

  // Android/browser back button → in-app back (the title screen lets the browser leave).
  function armHistory() { try { history.pushState({ ss: 1 }, ''); } catch (err) { /* file:// in some browsers */ } }
  window.addEventListener('popstate', () => {
    if (ui.closeTop()) { armHistory(); return; }
    if (!game && current && current.id === 'title') return;
    goBack();
    armHistory();
  });

  /** Top bar with a back button and a title. */
  function topBar(title, onBack, right) {
    const bar = ui.el('header', 'scr-top');
    if (onBack) bar.appendChild(ui.button('Back', onBack, { kind: 'round', icon: 'back', sfx: 'ui_back', className: 'light' }));
    bar.appendChild(ui.el('h1', 'scr-heading', esc(title)));
    if (right) bar.appendChild(right);
    return bar;
  }

  // ---------------------------------------------------------------------------------------------
  // Title screen
  // ---------------------------------------------------------------------------------------------

  SCREENS.title = function () {
    const el = ui.el('div', 'ss-screen scr-start');
    el.innerHTML =
      '<div class="title-logo">' +
      '<div class="logo-sun" aria-hidden="true"><i></i></div>' +
      '<h1 class="logo-word" aria-label="Sunny Sports"><span class="w1">' + ui.letters('Sunny') + '</span>' +
      '<span class="w2">' + ui.letters('Sports', 6) + '</span></h1></div>' +
      '<div class="title-stage"></div>' +
      '<div class="title-bottom"><button type="button" class="title-tap">Tap to start</button>' +
      '<div class="title-ver">v' + esc(SS.VERSION || '1.0.0') + '</div></div>';
    let started = false;
    function start() {
      if (started) return;
      started = true;
      sfx('ui_open');
      sfx('pop', { delay: 0.08 });
      ui.haptic(12);
      el.classList.add('is-starting');
      if (!humanPals().length) showScreen('editor', { mode: 'first' });
      else showScreen('menu', { greet: true });
    }
    el.addEventListener('click', start);
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } };
    window.addEventListener('keydown', onKey);
    plaza.setHero(save.activeProfile() || SS.pals.CPU_ROSTER[9].profile);
    return {
      el, music: 'title', camera: CAMERAS.title(),
      leave() { window.removeEventListener('keydown', onKey); },
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Main menu
  // ---------------------------------------------------------------------------------------------

  function speechBubble(text, seconds) {
    const b = ui.el('div', 'hero-bubble', '<span>' + esc(text) + '</span>');
    ui.screens.appendChild(b);
    const off = SS.engine.addRealtimeUpdate(() => {
      const p = plaza.heroHeadScreen();
      if (!p) return;
      // Never let the bubble ride up under the screen's top bar.
      const bar = current && current.el.querySelector('.menu-top, .scr-top');
      const minY = (bar ? bar.getBoundingClientRect().bottom : 0) + b.offsetHeight + 6;
      b.style.transform = 'translate3d(' + Math.round(p.x) + 'px,' + Math.round(Math.max(p.y, minY)) + 'px,0) translate(-50%,-100%)';
    });
    const t = setTimeout(remove, seconds * 1000);
    function remove() {
      clearTimeout(t);
      b.classList.add('is-out');
      setTimeout(() => { off(); b.remove(); }, 260);
    }
    return remove;
  }

  function sportCard(sport, profile, i) {
    const b = ui.el('button', 'sport-card');
    b.type = 'button';
    b.style.setProperty('--accent', sport.accent || DEFAULT_ACCENT);
    b.style.setProperty('--tint', sport.tint || DEFAULT_TINT);
    b.style.setProperty('--i', i);
    const earned = save.medals(sport.id);
    const pips = (sport.medals || []).slice(0, 4).map(m =>
      '<i class="pip m-' + medalTier(sport, m.id) + (earned.has(m.id) ? ' on' : '') + '" title="' + esc(m.name) + '"></i>').join('');
    const level = profile ? save.skill(profile.id, sport.id).level : 0;
    b.innerHTML = '<span class="sc-icon">' + sportIcon(sport) + '</span>' +
      '<span class="sc-text"><span class="sc-name">' + esc(sport.name) + '</span>' +
      '<span class="sc-tag">' + esc(sport.tagline || '') + '</span></span>' +
      '<span class="sc-foot"><span class="sc-medals">' + pips + '</span>' + rankChip(level, 'small') + '</span>';
    b.setAttribute('aria-label', sport.name);
    b.addEventListener('click', () => {
      sfx('ui_select');
      ui.haptic(10);
      openSetup(sport);
    });
    return b;
  }

  SCREENS.menu = function (opts) {
    const profile = save.activeProfile();
    const el = ui.el('div', 'ss-screen scr-menu');
    const top = ui.el('header', 'menu-top');
    const chip = ui.el('button', 'pal-chip');
    chip.type = 'button';
    chip.setAttribute('aria-label', 'Your Pals');
    chip.innerHTML = (profile ? portraitHTML(profile, 44) : '') + '<span class="pc-text"><b>' + esc(profile ? profile.name : 'Pal') +
      '</b><small>' + ui.icon('users') + 'Switch Pal</small></span>';
    chip.addEventListener('click', () => { sfx('ui_select'); showScreen('pals'); });
    top.appendChild(chip);
    const links = ui.el('nav', 'menu-links');
    links.appendChild(ui.button('Records', () => showScreen('records'), { kind: 'secondary', icon: 'trophy', className: 'link' }));
    links.appendChild(ui.button('Pals', () => showScreen('pals'), { kind: 'secondary', icon: 'users', className: 'link' }));
    top.appendChild(links);
    top.appendChild(ui.button('Settings', () => showScreen('settings'), { kind: 'round', icon: 'gear', className: 'light' }));
    el.appendChild(top);
    el.appendChild(ui.el('div', 'menu-stage'));
    const cards = ui.el('div', 'menu-cards');
    const sports = sportList();
    if (sports.length) sports.forEach((s, i) => cards.appendChild(sportCard(s, profile, i)));
    else cards.appendChild(ui.el('div', 'menu-empty ss-panel', '<b>Sports are warming up!</b><span>Check back in a moment.</span>'));
    cards.classList.add('n' + Math.min(4, Math.max(1, sports.length)));
    el.appendChild(cards);

    plaza.setHero(profile, opts && opts.greet ? 'wave' : null);
    let removeBubble = null;
    const bubbleTimer = setTimeout(() => {
      if (current && current.el === el && profile) {
        const lines = ['Let\'s play!', 'Pick a sport!', 'Hi, ' + profile.name + '!', 'Ready?'];
        removeBubble = speechBubble(opts && opts.greet ? 'Hi, ' + profile.name + '!' : lines[Math.floor(Math.random() * lines.length)], 2.6);
      }
    }, opts && opts.greet ? 650 : 900);
    return {
      el, music: 'menu', camera: CAMERAS.hero('.menu-stage'),
      back() { sfx('ui_back'); showScreen('title'); },
      leave() { clearTimeout(bubbleTimer); if (removeBubble) removeBubble(); },
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Setup sheet: mode → players / opponent → Start
  // ---------------------------------------------------------------------------------------------

  function stars(skill) {
    const n = U.clamp(Math.round(skill * 4) + 1, 1, 5);
    let s = '';
    for (let i = 0; i < 5; i++) s += '<i class="' + (i < n ? 'on' : '') + '">' + ui.icon('star') + '</i>';
    return '<span class="stars" aria-label="' + n + ' of 5 stars">' + s + '</span>';
  }

  async function pickPal(title, exclude, allowGuest, guestIndex) {
    const options = humanPals().filter(p => exclude.indexOf(p.id) < 0).map(p => ({
      id: p.id, label: p.name, icon: portraitHTML(p, 44),
    }));
    if (allowGuest) options.push({ id: '__guest', label: 'Guest', desc: 'Play without saving', icon: 'user' });
    if (humanPals().length < MAX_PALS) options.push({ id: '__new', label: 'New Pal', desc: 'Make one in the Pal Creator', icon: 'plus' });
    const id = await ui.choose(title, options);
    if (!id) return null;
    if (id === '__guest') return guestProfile(guestIndex);
    if (id === '__new') return '__new';
    return save.getProfile(id);
  }

  function openSetup(sport) {
    const me = save.activeProfile();
    if (!me) { showScreen('editor', { mode: 'first' }); return; }
    const last = lastSetup(sport.id);
    const modes = sport.modes && sport.modes.length ? sport.modes : [{ id: 'play', name: 'Play', desc: '' }];
    const maxP = Math.max(1, (sport.players && sport.players.max) || 1);
    const minP = Math.max(1, Math.min(maxP, (sport.players && sport.players.min) || 1));
    const state = {
      mode: modes.some(m => m.id === last.mode) ? last.mode : modes[0].id,
      players: [me],
      opp: null,
    };
    if (maxP > 1 && Array.isArray(last.players)) {
      for (const id of last.players.slice(1, maxP)) {
        const p = save.getProfile(id);
        if (p && !p.isGuest && p.id !== me.id) state.players.push(p);
      }
    }
    while (state.players.length < minP) state.players.push(guestProfile(state.players.length));
    const myLevel = save.skill(me.id, sport.id).level;
    const recommended = sport.opponent ? SS.pals.CPU_ROSTER.indexOf(SS.pals.rosterFor(myLevel)) : -1;
    if (sport.opponent) state.opp = Number.isInteger(last.opp) && SS.pals.CPU_ROSTER[last.opp] ? last.opp : recommended;

    const m = ui.modal({ className: 'ss-sheet setup', dismissValue: null });
    m.el.style.setProperty('--accent', sport.accent || DEFAULT_ACCENT);
    m.el.style.setProperty('--tint', sport.tint || DEFAULT_TINT);
    const head = ui.el('div', 'sheet-head');
    head.innerHTML = '<span class="sheet-icon">' + sportIcon(sport) + '</span><div class="sheet-title"><h2>' + esc(sport.name) +
      '</h2><p>' + esc(sport.tagline || '') + '</p></div>';
    head.appendChild(ui.button('Close', () => m.close(null), { kind: 'round', icon: 'close', sfx: 'ui_close', className: 'light small' }));
    const body = ui.el('div', 'sheet-body ss-scroll');
    const foot = ui.el('div', 'sheet-foot');
    const startBtn = ui.button('Start', () => m.close('start'), { kind: 'primary', icon: 'play', className: 'accent big', sfx: 'jingle_start' });
    foot.appendChild(startBtn);
    m.panel.append(head, body, foot);

    function section(title, extra) {
      const s = ui.el('section', 'sheet-sec');
      s.innerHTML = '<h3>' + esc(title) + (extra ? '<small>' + esc(extra) + '</small>' : '') + '</h3>';
      body.appendChild(s);
      return s;
    }

    function render() {
      const scroll = body.scrollTop;
      body.innerHTML = '';
      // Modes
      const ms = section('Mode');
      const list = ui.el('div', 'mode-list n' + Math.min(3, modes.length));
      modes.forEach(mode => {
        const b = ui.el('button', 'mode-opt' + (mode.id === state.mode ? ' on' : ''));
        b.type = 'button';
        b.innerHTML = '<span class="radio"></span><span class="mode-text"><b>' + esc(mode.name) + '</b>' +
          (mode.desc ? '<small>' + esc(mode.desc) + '</small>' : '') + '</span>';
        b.addEventListener('click', () => { if (state.mode !== mode.id) { state.mode = mode.id; sfx('ui_tick'); render(); } });
        list.appendChild(b);
      });
      ms.appendChild(list);

      // Players (hot-seat)
      if (maxP > 1) {
        const ps = section('Players', state.players.length + ' / ' + maxP + ' · pass the phone');
        const slots = ui.el('div', 'player-slots');
        state.players.forEach((p, i) => {
          const slot = ui.el('div', 'player-slot');
          const pick = ui.el('button', 'slot-main');
          pick.type = 'button';
          pick.innerHTML = '<span class="slot-num">P' + (i + 1) + '</span>' + portraitHTML(p, 44) +
            '<span class="slot-name"><b>' + esc(p.name) + '</b><small>' + (p.isGuest ? 'Guest' : esc(save.rankFor(save.skill(p.id, sport.id).level).name)) + '</small></span>' +
            '<span class="slot-swap">' + ui.icon('rotate-right') + '</span>';
          pick.addEventListener('click', async () => {
            sfx('ui_select');
            const exclude = state.players.filter((q, j) => j !== i && !q.isGuest).map(q => q.id);
            const chosen = await pickPal('Player ' + (i + 1), exclude, i > 0, i);
            if (chosen === '__new') { m.close(null); showScreen('editor', { mode: 'new', returnTo: 'menu' }); return; }
            if (chosen) { state.players[i] = chosen; render(); }
          });
          slot.appendChild(pick);
          if (i > 0 && state.players.length > minP) {
            slot.appendChild(ui.button('Remove player', () => { state.players.splice(i, 1); render(); }, { kind: 'round', icon: 'close', sfx: 'ui_back', className: 'light small' }));
          }
          slots.appendChild(slot);
        });
        if (state.players.length < maxP) {
          const add = ui.button('Add Player', () => {
            const used = state.players.map(q => q.id);
            const free = humanPals().find(p => used.indexOf(p.id) < 0);
            state.players.push(free || guestProfile(state.players.length));
            render();
          }, { kind: 'ghost', icon: 'plus', className: 'add-player', sfx: 'pop' });
          slots.appendChild(add);
        }
        ps.appendChild(slots);
      }

      // CPU opponent
      if (sport.opponent) {
        const os = section('Opponent', 'Who do you want to play?');
        const row = ui.el('div', 'opp-row ss-scroll-x');
        SS.pals.CPU_ROSTER.forEach((entry, i) => {
          const b = ui.el('button', 'opp-card' + (i === state.opp ? ' on' : ''));
          b.type = 'button';
          b.innerHTML = (i === recommended ? '<span class="opp-rec">Recommended</span>' : '') + portraitHTML(entry.profile, 72) +
            '<b>' + esc(entry.profile.name) + '</b><small>' + esc(entry.title) + '</small>' + stars(entry.skill);
          b.title = entry.tag || '';
          b.addEventListener('click', () => { state.opp = i; sfx('ui_tick'); render(); });
          row.appendChild(b);
        });
        os.appendChild(row);
        const sel = SS.pals.CPU_ROSTER[state.opp];
        if (sel && sel.tag) os.appendChild(ui.el('p', 'opp-tag', '“' + esc(sel.tag) + '” — ' + esc(sel.profile.name)));
        requestAnimationFrame(() => {
          const on = row.querySelector('.on');
          if (on && !row.dataset.scrolled) {
            const rr = row.getBoundingClientRect(), orr = on.getBoundingClientRect();
            row.scrollLeft += orr.left - rr.left - (rr.width - orr.width) / 2;
            row.dataset.scrolled = '1';
          }
        });
      }
      body.scrollTop = scroll;
    }
    render();

    m.result.then(result => {
      if (result !== 'start') return;
      rememberSetup(sport.id, { mode: state.mode, players: state.players.map(p => p.id), opp: state.opp });
      launch({ sportId: sport.id, mode: state.mode, players: state.players, oppIndex: state.opp, seed: null });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Pal Creator (first run, new Pal, edit Pal)
  // ---------------------------------------------------------------------------------------------

  const O = () => SS.pals.OPTIONS;
  const hex = n => '#' + Number(n).toString(16).padStart(6, '0');

  function editorTabs() {
    const o = O();
    const names = list => list.map(x => x.name);
    return [
      { id: 'face', name: 'Face', groups: [
        { key: 'skin', label: 'Skin', type: 'swatch', colors: o.skins },
        { key: 'eyes', label: 'Eyes', type: 'preview', names: names(o.eyes), zoom: 'eyes' },
        { key: 'eyeColor', label: 'Eye Color', type: 'swatch', colors: o.eyeColors },
        { key: 'brows', label: 'Brows', type: 'preview', names: names(o.brows), zoom: 'eyes' },
        { key: 'nose', label: 'Nose', type: 'preview', names: names(o.noses), zoom: 'face' },
        { key: 'mouth', label: 'Mouth', type: 'preview', names: names(o.mouths), zoom: 'face' },
        { key: 'cheeks', label: 'Blush', type: 'preview', names: ['Off', 'On'], values: [false, true], zoom: 'face' },
      ] },
      { id: 'hair', name: 'Hair', groups: [
        { key: 'hairStyle', label: 'Style', type: 'preview', names: names(o.hairStyles) },
        { key: 'hairColor', label: 'Color', type: 'swatch', colors: o.hairColors },
      ] },
      { id: 'extras', name: 'Extras', groups: [
        { key: 'glasses', label: 'Glasses', type: 'preview', names: names(o.glasses), zoom: 'eyes' },
        { key: 'facial', label: 'Facial Hair', type: 'preview', names: names(o.facial), zoom: 'face' },
      ] },
      { id: 'body', name: 'Body', groups: [
        { key: 'height', label: 'Height', type: 'slider', ends: ['Short', 'Tall'] },
        { key: 'build', label: 'Build', type: 'slider', ends: ['Slim', 'Sturdy'] },
        { key: 'shirt', label: 'Favorite Color', type: 'swatch', colors: o.shirts, names: o.shirtNames },
        { key: 'pants', label: 'Pants', type: 'swatch', colors: o.pants },
      ] },
    ];
  }

  SCREENS.editor = function (opts = {}) {
    const mode = opts.mode || 'new';                      // 'first' | 'new' | 'edit'
    const returnTo = opts.returnTo || (mode === 'first' ? 'menu' : 'pals');
    let profile;
    if (mode === 'edit' && opts.profile) profile = SS.pals.sanitize(opts.profile);
    else { profile = SS.pals.randomProfile(U.rng(), ''); profile.name = ''; }
    const original = JSON.stringify(profile);
    const tabs = editorTabs();
    let tab = tabs[0].id;
    let saving = false;

    const el = ui.el('div', 'ss-screen scr-editor');
    const title = mode === 'first' ? "Let's make your Pal!" : mode === 'edit' ? 'Edit Pal' : 'New Pal';
    el.appendChild(topBar(title, mode === 'first' ? null : () => leave()));
    const stage = ui.el('div', 'ed-stage');
    stage.innerHTML = '<div class="ed-spin-hint">' + ui.icon('rotate-left') + '<span>Drag to spin</span>' + ui.icon('rotate-right') + '</div>';
    el.appendChild(stage);
    const panel = ui.el('div', 'ed-panel ss-panel');
    el.appendChild(panel);

    // Name + randomize
    const nameRow = ui.el('div', 'ed-name');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 10;
    input.placeholder = 'Your name';
    input.value = profile.name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Pal name');
    input.addEventListener('input', () => { profile.name = input.value; input.classList.remove('is-error'); sfx('type'); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    nameRow.appendChild(input);
    nameRow.appendChild(ui.button('Randomize', () => {
      const keep = profile.name;
      profile = Object.assign(SS.pals.randomProfile(U.rng(), keep || 'Pal'), { id: profile.id, name: keep, created: profile.created });
      changed('hop');
      renderBody();
    }, { kind: 'secondary', icon: 'dice', className: 'dice', sfx: 'pop' }));
    panel.appendChild(nameRow);

    const tabBar = ui.el('div', 'ed-tabs', '');
    tabBar.setAttribute('role', 'tablist');
    panel.appendChild(tabBar);
    const body = ui.el('div', 'ed-body ss-scroll');
    panel.appendChild(body);
    const actions = ui.el('div', 'ed-actions');
    const saveBtn = ui.button(mode === 'edit' ? 'Save Changes' : 'Save Pal', () => commit(), { kind: 'primary', icon: 'check', className: 'big', sfx: null });
    actions.appendChild(saveBtn);
    el.appendChild(actions);

    function renderTabs() {
      tabBar.innerHTML = '';
      for (const t of tabs) {
        const b = ui.el('button', 'ed-tab' + (t.id === tab ? ' on' : ''), esc(t.name));
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', t.id === tab ? 'true' : 'false');
        b.addEventListener('click', () => { if (tab !== t.id) { tab = t.id; sfx('ui_tick'); renderTabs(); renderBody(); body.scrollTop = 0; } });
        tabBar.appendChild(b);
      }
    }

    // Option previews render progressively (a few per frame) so the UI never stalls.
    let previewQueue = [];
    let pumping = false;
    function pump() {
      const t0 = performance.now();
      while (previewQueue.length && performance.now() - t0 < 10) {
        const job = previewQueue.shift();
        if (!job.img.isConnected) continue;
        job.img.src = SS.pals.portraitURL(job.variant, 96);
        job.img.dataset.sig = job.sig;
        job.img.classList.add('ready');
      }
      if (previewQueue.length) requestAnimationFrame(pump); else pumping = false;
    }
    function queuePreviews() {
      previewQueue = [];
      for (const img of body.querySelectorAll('img[data-key]')) {
        const v = JSON.parse(img.dataset.value);
        const variant = Object.assign({}, profile, { [img.dataset.key]: v });
        // Eye and brow thumbnails show the bare face: shades would hide every choice.
        if (img.dataset.key === 'eyes' || img.dataset.key === 'brows') variant.glasses = 0;
        const sig = profileKeyOf(variant);
        if (img.dataset.sig === sig) continue;
        previewQueue.push({ img, variant, sig });
      }
      if (previewQueue.length && !pumping) { pumping = true; requestAnimationFrame(pump); }
    }

    function renderBody() {
      body.innerHTML = '';
      const t = tabs.find(x => x.id === tab);
      for (const g of t.groups) {
        const sec = ui.el('section', 'ed-group');
        const cur = profile[g.key];
        const curName = g.names && g.type === 'swatch' ? g.names[cur] : null;
        sec.innerHTML = '<h3>' + esc(g.label) + (curName ? '<small>' + esc(curName) + '</small>' : '') + '</h3>';
        if (g.type === 'swatch') {
          const grid = ui.el('div', 'swatches');
          g.colors.forEach((c, i) => {
            const b = ui.el('button', 'swatch' + (i === cur ? ' on' : ''));
            b.type = 'button';
            b.style.setProperty('--c', hex(c));
            b.setAttribute('aria-label', g.label + ' ' + (g.names ? g.names[i] : i + 1));
            b.addEventListener('click', () => set(g.key, i));
            grid.appendChild(b);
          });
          sec.appendChild(grid);
        } else if (g.type === 'preview') {
          const grid = ui.el('div', 'previews' + (g.zoom ? ' zoom-' + g.zoom : ''));
          const values = g.values || g.names.map((n, i) => i);
          values.forEach((v, i) => {
            const b = ui.el('button', 'preview' + (v === cur ? ' on' : ''));
            b.type = 'button';
            b.innerHTML = '<span class="pv-img"><img alt="" draggable="false" data-key="' + g.key + '" data-value=\'' + JSON.stringify(v) + '\'></span><small>' + esc(g.names[i]) + '</small>';
            b.addEventListener('click', () => set(g.key, v));
            grid.appendChild(b);
          });
          sec.appendChild(grid);
        } else if (g.type === 'slider') {
          const wrap = ui.el('div', 'ed-slider');
          wrap.innerHTML = '<span>' + esc(g.ends[0]) + '</span><input type="range" min="0" max="100" step="1" value="' +
            Math.round(cur * 100) + '" aria-label="' + esc(g.label) + '"><span>' + esc(g.ends[1]) + '</span>';
          const range = wrap.querySelector('input');
          range.style.setProperty('--p', range.value + '%');
          let lastBuild = 0, pending = 0;
          range.addEventListener('input', () => {
            profile[g.key] = Number(range.value) / 100;
            range.style.setProperty('--p', range.value + '%');
            clearTimeout(pending);
            const now = performance.now();
            if (now - lastBuild > 90) { lastBuild = now; plaza.setHero(profile); } else pending = setTimeout(() => plaza.setHero(profile), 100);
          });
          range.addEventListener('change', () => { sfx('ui_tick'); changed('hop'); });
          sec.appendChild(wrap);
        }
        body.appendChild(sec);
      }
      queuePreviews();
    }

    function set(key, value) {
      if (profile[key] === value) return;
      profile[key] = value;
      sfx('ui_tick', { rate: 0.9 + Math.random() * 0.25 });
      ui.haptic(6);
      changed('hop');
      renderBody();
    }

    function changed(react) { plaza.setHero(profile, react); }

    // Drag to spin the preview Pal
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, t: performance.now(), v: 0 };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable */ }
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, now = performance.now();
      const dt = Math.max(1, now - drag.t) / 1000;
      drag.v = U.lerp(drag.v, (dx * 0.012) / dt, 0.5);
      drag.x = e.clientX; drag.t = now;
      plaza.spinHero(dx * 0.012);
    });
    const endDrag = () => {
      if (!drag) return;
      plaza.flingHero(U.clamp(drag.v, -12, 12));
      drag = null;
      stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    async function commit() {
      if (saving) return;
      const name = input.value.trim();
      if (!name) {
        input.classList.remove('is-error');
        void input.offsetWidth;
        input.classList.add('is-error');
        sfx('ui_error');
        ui.haptic(30);
        ui.toast('Give your Pal a name first!', { icon: 'edit' });
        return;
      }
      saving = true;
      el.classList.add('is-saving');
      sfx('levelup');
      profile.name = name;
      const saved = save.upsertProfile(SS.pals.sanitize(profile));
      if (mode !== 'edit' || !save.activeProfile()) save.setActiveProfile(saved.id);
      plaza.setHero(saved, 'wave');
      if (plaza.hero) plaza.hero.setExpression('joy', 2.2);
      ui.confetti({ count: 70 });
      const line = mode === 'edit' ? 'Looking good, ' + name + '!' : 'Nice to meet you, ' + name + '!';
      ui.banner(line, { kind: 'good', duration: 1.7 });
      await sleep(1900);
      if (current && current.el === el) showScreen(returnTo, { greet: returnTo === 'menu' });
    }

    async function leave() {
      if (saving) return;
      if (JSON.stringify(profile) !== original) {
        const ok = await ui.confirm('Leave without saving?', 'Your changes to this Pal will be lost.', { yes: 'Leave', no: 'Keep editing' });
        if (!ok) return;
      }
      showScreen(returnTo);
    }

    renderTabs();
    renderBody();
    plaza.setHero(profile, 'hop');
    let removeBubble = null;
    // The bubble waits for the camera to settle on the pal inside the stage (it flies in from the last screen;
    // on a slow device that takes a while) and is skipped if the pal never gets there.
    let bubbleTries = 0, bubbleTimer = 0, lastHead = null;
    const tryBubble = () => {
      if (!current || current.el !== el) return;
      const p = plaza.heroHeadScreen();
      const r = stage.getBoundingClientRect();
      const inside = p && !p.behind && p.x > r.left + 10 && p.x < r.right - 10 && p.y > r.top - 10 && p.y < r.bottom - 30;
      const settled = inside && lastHead && Math.abs(p.x - lastHead.x) < 8 && Math.abs(p.y - lastHead.y) < 8;
      lastHead = p;
      if (settled) { removeBubble = speechBubble(mode === 'edit' ? 'New look?' : 'Make me yours!', 2.8); return; }
      if (++bubbleTries < 40) bubbleTimer = setTimeout(tryBubble, 120);
    };
    bubbleTimer = setTimeout(tryBubble, 800);
    return {
      el, music: 'editor', camera: Object.assign(CAMERAS.hero('.ed-stage'), { fill: 0.84, keepSpin: true }),
      back() { if (mode !== 'first') leave(); },
      leave() { previewQueue = []; clearTimeout(bubbleTimer); if (removeBubble) removeBubble(); },
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Pals screen
  // ---------------------------------------------------------------------------------------------

  SCREENS.pals = function () {
    const el = ui.el('div', 'ss-screen scr-pals');
    const count = ui.el('span', 'count-chip');
    el.appendChild(topBar('Your Pals', () => { sfx('ui_back'); showScreen('menu'); }, count));
    el.appendChild(ui.el('div', 'pals-stage'));
    const panel = ui.el('div', 'pals-panel ss-panel');
    const grid = ui.el('div', 'pals-grid ss-scroll');
    panel.appendChild(grid);
    el.appendChild(panel);

    function bestRank(p) {
      let best = 0;
      for (const s of sportList()) best = Math.max(best, save.skill(p.id, s.id).level);
      return best;
    }

    function render() {
      const list = humanPals();
      const active = save.activeProfile();
      count.textContent = list.length + ' / ' + MAX_PALS;
      grid.innerHTML = '';
      list.forEach((p, i) => {
        const card = ui.el('div', 'pal-card' + (active && active.id === p.id ? ' on' : ''));
        card.style.setProperty('--i', i);
        const main = ui.el('button', 'pal-main');
        main.type = 'button';
        main.innerHTML = portraitHTML(p, 76) + '<b>' + esc(p.name) + '</b>' + rankChip(bestRank(p), 'small') +
          (active && active.id === p.id ? '<span class="playing">' + ui.icon('check') + 'Playing</span>' : '');
        main.setAttribute('aria-label', 'Play as ' + p.name);
        main.addEventListener('click', () => {
          if (active && active.id === p.id) { plaza.heroReact('hop'); sfx('pop'); return; }
          save.setActiveProfile(p.id);
          sfx('ui_select');
          plaza.setHero(p, 'wave');
          render();
        });
        const tools = ui.el('div', 'pal-tools');
        tools.appendChild(ui.button('Edit ' + p.name, () => showScreen('editor', { mode: 'edit', profile: p, returnTo: 'pals' }), { kind: 'round', icon: 'edit', className: 'light small' }));
        tools.appendChild(ui.button('Delete ' + p.name, async () => {
          const ok = await ui.confirm('Say goodbye to ' + p.name + '?', 'Their skill levels and stats will be deleted. Records stay in the book.', { yes: 'Delete', no: 'Keep', danger: true });
          if (!ok) return;
          save.deleteProfile(p.id);
          sfx('ui_back');
          if (!humanPals().length) { showScreen('editor', { mode: 'first' }); return; }
          plaza.setHero(save.activeProfile());
          render();
        }, { kind: 'round', icon: 'trash', className: 'light small danger' }));
        card.append(main, tools);
        grid.appendChild(card);
      });
      if (list.length < MAX_PALS) {
        const add = ui.el('button', 'pal-card add');
        add.type = 'button';
        add.innerHTML = '<span class="add-icon">' + ui.icon('plus') + '</span><b>New Pal</b>';
        add.addEventListener('click', () => { sfx('ui_select'); showScreen('editor', { mode: 'new', returnTo: 'pals' }); });
        grid.appendChild(add);
      }
    }
    render();
    plaza.setHero(save.activeProfile());
    return {
      el, music: 'menu', camera: CAMERAS.hero('.pals-stage'),
      back() { sfx('ui_back'); showScreen('menu'); },
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Records screen
  // ---------------------------------------------------------------------------------------------

  function sparkline(history) {
    const h = (history || []).slice(-20);
    if (h.length < 2) return '<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"><path d="M2 26H98" class="base"/></svg>';
    const min = Math.min(...h), max = Math.max(...h);
    const span = Math.max(40, max - min);
    const pts = h.map((v, i) => [2 + (i / (h.length - 1)) * 96, 27 - ((v - min) / span) * 23]);
    const d = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
    const last = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"><path d="' + d + 'L98 30L2 30Z" class="area"/><path d="' + d + '" class="line"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6"/></svg>';
  }

  SCREENS.records = function (opts = {}) {
    const el = ui.el('div', 'ss-screen scr-records');
    el.appendChild(topBar('Records', () => { sfx('ui_back'); showScreen('menu'); }));
    const panel = ui.el('div', 'rec-panel ss-panel');
    el.appendChild(panel);
    const sports = sportList();
    let sel = sports.find(s => s.id === (opts.sport || lastSportId)) || sports[0];

    const tabs = ui.el('div', 'rec-tabs ss-scroll-x');
    const content = ui.el('div', 'rec-content ss-scroll');
    panel.append(tabs, content);

    function renderTabs() {
      tabs.innerHTML = '';
      for (const s of sports) {
        const b = ui.el('button', 'rec-tab' + (s === sel ? ' on' : ''));
        b.type = 'button';
        b.style.setProperty('--accent', s.accent || DEFAULT_ACCENT);
        b.innerHTML = '<span class="ti">' + sportIcon(s) + '</span><span>' + esc(s.name) + '</span>';
        b.addEventListener('click', () => { if (sel !== s) { sel = s; sfx('ui_tick'); renderTabs(); renderContent(); } });
        tabs.appendChild(b);
        if (s === sel) requestAnimationFrame(() => { if (b.isConnected) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      }
    }

    function renderContent() {
      content.scrollTop = 0;
      if (!sel) {
        content.innerHTML = '<div class="empty">' + ui.icon('trophy') + '<b>No sports yet</b><span>Records will show up here.</span></div>';
        return;
      }
      panel.style.setProperty('--accent', sel.accent || DEFAULT_ACCENT);
      panel.style.setProperty('--tint', sel.tint || DEFAULT_TINT);
      let html = '';
      // Records
      const recs = save.records(sel.id);
      const keys = Object.keys(recs);
      html += '<section class="rec-sec"><h3>' + ui.icon('trophy') + 'Best Ever</h3>';
      if (keys.length) {
        html += '<ul class="rec-list">' + keys.map(k => {
          const r = recs[k];
          return '<li><span class="rl-label">' + esc(r.label || k) + '</span><b class="rl-value">' + esc(formatValue(r.value, r.fmt)) + '</b>' +
            '<small class="rl-by">' + esc(r.name || 'Guest') + (r.date ? ' · ' + esc(shortDate(r.date)) : '') + '</small></li>';
        }).join('') + '</ul>';
      } else html += '<p class="muted">No records yet. Go set some!</p>';
      html += '</section>';

      // Skill per Pal
      html += '<section class="rec-sec"><h3>' + ui.icon('chart') + 'Skill</h3><ul class="skill-list">';
      const pals = humanPals();
      for (const p of pals) {
        const s = save.skill(p.id, sel.id);
        const games = save.stats(sel.id, p.id).games || s.games || 0;
        html += '<li>' + portraitHTML(p, 40) + '<span class="sk-name"><b>' + esc(p.name) + '</b><small>' + games + (games === 1 ? ' game' : ' games') + '</small></span>' +
          sparkline(s.history) + '<span class="sk-level">' + rankChip(s.level, 'small') + '<b>' + U.fmt.int(s.level) + '</b></span></li>';
      }
      if (!pals.length) html += '<li class="muted">No Pals yet.</li>';
      html += '</ul></section>';

      // Medals
      const medals = sel.medals || [];
      html += '<section class="rec-sec"><h3>' + ui.icon('medal') + 'Medals</h3><div class="medal-grid">';
      for (const md of medals) {
        const info = save.medalInfo ? save.medalInfo(sel.id, md.id) : null;
        const tier = medalTier(sel, md.id);
        html += '<div class="medal-tile ' + (info ? 'on' : 'off') + '"><span class="medal-disc m-' + tier + '">' + (info ? ui.icon('star') : ui.icon('lock')) + '</span>' +
          '<span class="md-text"><b>' + esc(md.name) + '</b><small>' + esc(md.desc || '') + '</small>' +
          (info ? '<em>' + esc(info.name || 'Earned') + ' · ' + esc(shortDate(info.date)) + '</em>' : '') + '</span></div>';
      }
      if (!medals.length) html += '<p class="muted">This sport has no medals.</p>';
      html += '</div></section>';
      content.innerHTML = html;
    }

    renderTabs();
    renderContent();
    return {
      el, music: 'menu', camera: CAMERAS.wide(),
      back() { sfx('ui_back'); showScreen('menu'); },
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Settings screen
  // ---------------------------------------------------------------------------------------------

  SCREENS.settings = function () {
    const el = ui.el('div', 'ss-screen scr-settings');
    el.appendChild(topBar('Settings', () => { sfx('ui_back'); showScreen('menu'); }));
    const panel = ui.el('div', 'set-panel ss-panel');
    const body = ui.el('div', 'set-body ss-scroll');
    panel.appendChild(body);
    el.appendChild(panel);
    const st = save.settings;

    function group(title, iconName) {
      const g = ui.el('section', 'set-group');
      g.innerHTML = '<h3>' + ui.icon(iconName) + esc(title) + '</h3>';
      body.appendChild(g);
      return g;
    }

    function slider(parent, label, key, sample) {
      const row = ui.el('label', 'set-row slider');
      row.innerHTML = '<span class="set-label">' + esc(label) + '</span><input type="range" min="0" max="100" step="1" value="' +
        Math.round(st[key] * 100) + '"><b class="set-val">' + Math.round(st[key] * 100) + '</b>';
      const input = row.querySelector('input'), val = row.querySelector('.set-val');
      const paint = () => input.style.setProperty('--p', input.value + '%');
      paint();
      let lastSample = 0;
      input.addEventListener('input', () => {
        save.setSetting(key, Number(input.value) / 100);
        val.textContent = input.value;
        paint();
        const now = performance.now();
        if (sample && now - lastSample > 140) { lastSample = now; sfx(sample); }
      });
      parent.appendChild(row);
    }

    function toggle(parent, label, desc, key) {
      const row = ui.el('div', 'set-row toggle');
      row.innerHTML = '<span class="set-label">' + esc(label) + (desc ? '<small>' + esc(desc) + '</small>' : '') + '</span>';
      const b = ui.el('button', 'switch' + (st[key] ? ' on' : ''), '<i></i>');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', st[key] ? 'true' : 'false');
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => {
        save.setSetting(key, !st[key]);
        b.classList.toggle('on', !!st[key]);
        b.setAttribute('aria-checked', st[key] ? 'true' : 'false');
        sfx('ui_toggle');
        if (key === 'haptics' && st[key]) ui.haptic(25);
      });
      row.appendChild(b);
      // the whole row is the hit target, as phones lead people to expect
      row.addEventListener('click', e => { if (e.target !== b && !b.contains(e.target)) b.click(); });
      parent.appendChild(row);
    }

    const sound = group('Sound', 'sound');
    slider(sound, 'Music', 'music', null);
    slider(sound, 'Effects', 'sfx', 'ui_tick');
    const creditsRow = ui.el('div', 'set-row');
    creditsRow.innerHTML = '<span class="set-label">Sound credits<small>Real recordings, free for everyone (CC0).</small></span>';
    creditsRow.appendChild(ui.button('View', showSoundCredits, { kind: 'secondary', icon: 'info', className: 'small', sfx: null }));
    sound.appendChild(creditsRow);

    const play = group('Play', 'star');
    toggle(play, 'Vibration', 'Little buzzes on taps and big moments', 'haptics');
    toggle(play, 'Gesture hints', 'Show the hand that demonstrates moves', 'hints');
    toggle(play, 'Left-handed', 'Mirror swings and controls', 'leftHanded');

    const gfx = group('Graphics', 'sparkle');
    const seg = ui.el('div', 'segmented');
    const note = ui.el('p', 'set-note');
    const tiers = [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
    function paintSeg() {
      for (const b of seg.children) b.classList.toggle('on', b.dataset.q === st.quality);
      const resolved = SS.engine.quality;
      note.textContent = st.quality === 'auto'
        ? 'Auto picks the best look your device can keep smooth. Now: ' + resolved[0].toUpperCase() + resolved.slice(1) + '.'
        : st.quality === 'low' ? 'Low turns off shadows for the smoothest play.' : st.quality === 'medium' ? 'Medium: soft shadows, lighter on battery.' : 'High: sharpest picture and crisp shadows.';
    }
    for (const [q, name] of tiers) {
      const b = ui.el('button', 'seg', esc(name));
      b.type = 'button';
      b.dataset.q = q;
      b.addEventListener('click', () => { save.setSetting('quality', q); sfx('ui_tick'); paintSeg(); });
      seg.appendChild(b);
    }
    gfx.append(seg, note);
    paintSeg();
    const offQuality = SS.engine.onQuality(paintSeg);

    const data = group('Data', 'info');
    const resetRow = ui.el('div', 'set-row');
    resetRow.innerHTML = '<span class="set-label">Reset all data<small>Erases every Pal, record, medal and setting.</small></span>';
    resetRow.appendChild(ui.button('Reset', async () => {
      const a = await ui.confirm('Reset all data?', 'Every Pal, record, medal and setting will be erased.', { yes: 'Continue', no: 'Cancel', danger: true });
      if (!a) return;
      const b = await ui.confirm('Are you really sure?', "This can't be undone.", { yes: 'Erase everything', no: 'Keep my data', danger: true });
      if (!b) return;
      await ui.transition(() => {
        save.reset();
        audio().setVolumes({ music: save.settings.music, sfx: save.settings.sfx });
        SS.engine.setQuality(save.settings.quality);
        plaza.setHero(null);
        showScreen('title');
      });
      ui.toast('All clear! Fresh start.', { icon: 'sparkle' });
    }, { kind: 'secondary', icon: 'trash', className: 'danger small' }));
    data.appendChild(resetRow);

    const about = ui.el('div', 'set-about');
    about.innerHTML = '<div class="about-logo">Sunny Sports</div><div class="about-ver">Version ' + esc(SS.VERSION || '1.0.0') +
      (save.persistent ? '' : ' · progress saved for this visit only') + '</div>' +
      '<p>Made with three.js. Fonts: Fredoka and Nunito (SIL Open Font License). Sounds and instruments are real public-domain recordings (see Sound credits).</p>' +
      '<p class="thanks">Thanks for playing!</p>';
    body.appendChild(about);

    return {
      el, music: 'menu', camera: CAMERAS.wide(),
      back() { sfx('ui_back'); showScreen('menu'); },
      leave() { offQuality(); },
    };
  };

  /** Settings → Sound credits: every source recording (audio/CREDITS.md, via SS.audio.credits) in a scrollable modal. */
  function showSoundCredits() {
    const m = ui.modal({ className: 'ss-credits' });
    m.panel.innerHTML = '<div class="ss-modal-head"><h2>Sound credits</h2><p class="ss-modal-sub">The game\'s sound effects, crowds and instruments are real recordings ' +
      'released to the public domain (CC0&nbsp;1.0). Thank you to everyone who shared them!</p></div>';
    const list = ui.el('div', 'credits-list ss-scroll');
    for (const g of (SS.audio && SS.audio.credits) || []) {
      list.insertAdjacentHTML('beforeend', '<h3>' + esc(g.title) + '</h3><ul>' + g.rows.map(([work, author, link]) =>
        '<li><b>' + esc(work) + '</b>' + esc(author) + (link ? ' · <a href="' + esc(link) + '" target="_blank" rel="noopener">' +
          esc(link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>' : '') + '</li>').join('') + '</ul>');
    }
    m.panel.appendChild(list);
    const foot = ui.el('div', 'ss-modal-foot');
    foot.appendChild(ui.button('Close', () => m.close(null), { kind: 'primary', sfx: 'ui_back' }));
    m.panel.appendChild(foot);
  }

  // ---------------------------------------------------------------------------------------------
  // Playing a sport: ctx (§6.8), lifecycle, pause
  // ---------------------------------------------------------------------------------------------

  let game = null;
  let lastSportId = null;

  /** cfg: { sportId, mode, players: [profile], oppIndex, seed } → game (instance created) or null. */
  async function buildGame(cfg) {
    const sport = SS.sports[cfg.sportId];
    if (!sport || typeof sport.create !== 'function') return null;
    lastSportId = sport.id;
    const seed = cfg.seed == null ? Math.floor(Math.random() * 1e9) : cfg.seed;
    const scene = new THREE.Scene();
    scene.name = 'sport:' + sport.id;
    const camera = new THREE.PerspectiveCamera(50, SS.engine.size.aspect, 0.1, 2000);
    camera.userData.fit = { vFov: 50, minHFov: 60 };
    SS.engine.fitCamera(camera);
    const mode = modeOf(sport, cfg.mode).id;
    const players = cfg.players.map((profile, index) => ({ profile, index, isCpu: false }));
    const oppEntry = sport.opponent ? SS.pals.CPU_ROSTER[U.clamp(cfg.oppIndex == null ? 0 : cfg.oppIndex, 0, SS.pals.CPU_ROSTER.length - 1)] : null;
    const opponent = oppEntry ? { profile: oppEntry.profile, skill: oppEntry.skill, title: oppEntry.title } : null;

    const g = {
      cfg: Object.assign({}, cfg, { mode, seed }), sport, scene, camera, instance: null,
      alive: true, started: false, finished: false, pausable: true,
      cleanups: [], timers: new Set(), medals: new Set(),
    };
    const scope = SS.input.scope();
    const primary = players[0].profile;
    const ctx = {
      THREE, scene, camera, sport, mode, players, opponent,
      rng: U.rng(seed), seed,
      input: scope, hud: ui.hud,
      ui, audio: audio(), world: SS.world, pals: SS.pals, engine: SS.engine, save, util: U,
      get alive() { return g.alive; },
      wait(seconds) {
        return new Promise(resolve => {
          if (!g.alive) return;
          const cancel = SS.engine.after(seconds, () => { g.timers.delete(cancel); if (g.alive) resolve(); });
          g.timers.add(cancel);
        });
      },
      every(seconds, fn) {
        let stopped = false, cancelTimer = null;
        const tick = () => {
          if (stopped || !g.alive) return;
          try { fn(); } catch (err) { console.error('[SS] ctx.every callback failed:', err); }
          schedule();
        };
        const schedule = () => { if (!stopped && g.alive) cancelTimer = SS.engine.after(Math.max(0.001, seconds), tick); };
        const cancel = () => { stopped = true; if (cancelTimer) cancelTimer(); g.timers.delete(cancel); };
        g.timers.add(cancel);
        schedule();
        return cancel;
      },
      onUpdate(fn) {
        const off = SS.engine.addUpdate(fn);
        g.cleanups.push(off);
        return off;
      },
      finish(result) { finishGame(g, result); },
      awardMedal(medalId) {
        const pid = primary && !primary.isGuest ? primary.id : null;
        const fresh = save.awardMedal(sport.id, medalId, pid);
        if (fresh) g.medals.add(medalId);
        return fresh;
      },
      skillFor(profile) { return profile && !profile.isGuest ? save.skill(profile.id, sport.id).level : 0; },
      setPausable(v) { g.pausable = !!v; refreshPauseButton(); },
      restart() { restartGame(); },
      quit() { quitGame(false); },
    };
    g.ctx = ctx;
    game = g;
    ui.root.classList.add('is-playing');
    SS.debug.ctx = ctx;
    SS.debug.sport = null;
    setAccent(sport.accent, sport.tint);

    let instance;
    try {
      instance = await sport.create(ctx);
    } catch (err) {
      console.error('[SS] ' + sport.id + '.create failed:', err);
      teardown(g);
      return null;
    }
    if (!g.alive) return null;
    if (!instance) { teardown(g); return null; }
    g.instance = instance;
    SS.debug.sport = instance;
    g.cleanups.push(SS.engine.addUpdate((dt, t) => { if (g.alive) instance.update(dt, t); }, 0));
    if (typeof instance.onResize === 'function') g.cleanups.push(SS.engine.onResize(size => { if (g.alive) instance.onResize(size); }));
    if (typeof instance.onPause === 'function') g.cleanups.push(SS.engine.events.on('pause', () => { if (g.alive) instance.onPause(); }));
    if (typeof instance.onResume === 'function') g.cleanups.push(SS.engine.events.on('resume', () => { if (g.alive) instance.onResume(); }));
    SS.engine.setView(scene, camera);
    return g;
  }

  function startPlay(g) {
    if (!g || !g.alive || g.started) return;
    g.started = true;
    refreshPauseButton();
    try { g.instance.start(); } catch (err) { console.error('[SS] ' + g.sport.id + '.start failed:', err); }
  }

  /** opts.intro (default true): how-to on first visit + title card. */
  async function launch(cfg, opts = {}) {
    const intro = opts.intro !== false;
    while (ui.modalOpen()) ui.closeTop();
    markLeaving();
    const g = await ui.transition(async () => {
      if (game) teardown(game);
      closeResults();
      clearScreens();
      ui.clearFx();
      plaza.setActive(false);
      return buildGame(cfg);
    });
    if (!g) {
      ui.toast("Oops! That game couldn't start.", { icon: 'info' });
      showScreen('menu');
      return;
    }
    SS.debug.screen = 'play';
    music(g.sport.music || g.sport.id);
    if (intro) {
      if (g.sport.howTo && !save.seen('howto_' + g.sport.id)) {
        await ui.howTo(g.sport);
        if (!g.alive) return;
      }
      await ui.titleCard(g.sport.name, modeOf(g.sport, g.cfg.mode).name, { accent: g.sport.accent });
    }
    startPlay(g);
  }

  function teardown(g) {
    if (!g || !g.alive) return;
    g.alive = false;
    closePause(false);
    try { if (g.instance && typeof g.instance.dispose === 'function') g.instance.dispose(); } catch (err) {
      console.error('[SS] ' + g.sport.id + '.dispose failed:', err);
    }
    g.ctx.input.off();
    for (const off of g.cleanups) off();
    for (const cancel of Array.from(g.timers)) cancel();
    g.timers.clear();
    ui.hud.innerHTML = '';
    ui.clearFx();
    SS.engine.disposeObject(g.scene);
    g.scene.clear();
    SS.engine.slowmo(1, 0);
    SS.input.enabled = true;
    if (SS.engine.paused) SS.engine.resume();
    if (game === g) game = null;
    ui.root.classList.toggle('is-playing', !!game);
    SS.debug.sport = null;
    SS.debug.ctx = null;
    refreshPauseButton();
  }

  /** Leaves the sport and lands on the menu (optionally reopening the setup sheet). */
  /** Marks the live game as being left: from now on nothing may pause it (the curtain is closing). */
  function markLeaving() {
    if (!game) return;
    game.leaving = true;
    refreshPauseButton();
  }

  async function exitToMenu(reopenSetup) {
    const sport = game && game.sport;
    markLeaving();
    await ui.transition(() => {
      if (game) teardown(game);
      closeResults();
      showScreen('menu');
    });
    if (reopenSetup && sport) openSetup(sport);
  }

  async function quitGame(ask) {
    if (!game) return;
    if (ask) {
      // the confirm takes the pause card's place rather than stacking on top of it
      const covered = pauseEl;
      if (covered) covered.classList.add('is-covered');
      const ok = await ui.confirm('Quit this game?', "This game won't count.", { yes: 'Quit', no: 'Keep playing' });
      if (!ok) { if (covered) covered.classList.remove('is-covered'); return; }
    }
    exitToMenu(false);
  }

  async function restartGame() {
    if (!game) return;
    const cfg = Object.assign({}, game.cfg, { seed: params.seed != null ? game.cfg.seed : null });
    markLeaving();
    const g = await ui.transition(async () => {
      teardown(game);
      closeResults();
      return buildGame(cfg);
    });
    if (!g) { showScreen('menu'); return; }
    SS.debug.screen = 'play';
    music(g.sport.music || g.sport.id);
    startPlay(g);
  }

  // ---- pause ------------------------------------------------------------------------------------------

  let pauseEl = null;

  function refreshPauseButton() {
    ui.setPauseVisible(!!(game && game.started && !game.finished && !game.leaving && game.pausable && !pauseEl));
  }

  function openPause() {
    const g = game;
    if (!g || !g.started || g.finished || g.leaving || !g.pausable || pauseEl) return;
    SS.engine.pause();
    const mode = modeOf(g.sport, g.cfg.mode);
    pauseEl = ui.el('div', 'ss-pause');
    pauseEl.style.setProperty('--accent', g.sport.accent || DEFAULT_ACCENT);
    const panel = ui.el('div', 'pause-panel ss-panel');
    panel.innerHTML = '<div class="pause-head"><span class="pause-icon">' + sportIcon(g.sport) + '</span><div><h2>Paused</h2><p>' +
      esc(g.sport.name) + ' · ' + esc(mode.name) + '</p></div></div>';
    const btns = ui.el('div', 'pause-btns');
    btns.appendChild(ui.button('Resume', () => closePause(true), { kind: 'primary', icon: 'play', className: 'accent big', sfx: 'ui_close' }));
    if (g.sport.howTo) btns.appendChild(ui.button('How to Play', () => ui.howTo(g.sport), { kind: 'secondary', icon: 'info' }));
    btns.appendChild(ui.button('Restart', () => restartGame(), { kind: 'secondary', icon: 'retry' }));
    btns.appendChild(ui.button('Quit', () => quitGame(true), { kind: 'secondary', icon: 'home' }));
    panel.appendChild(btns);
    pauseEl.appendChild(panel);
    ui.overlay.appendChild(pauseEl);
    ui.fx.classList.add('is-muted');
    refreshPauseButton();
  }

  function closePause(resume) {
    if (!pauseEl) return;
    const node = pauseEl;
    pauseEl = null;
    ui.fx.classList.remove('is-muted');
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 200);
    if (resume) SS.engine.resume();
    refreshPauseButton();
  }

  function onGameBack() {
    if (pauseEl) { sfx('ui_close'); closePause(true); return; }
    openPause();
  }

  ui.events.on('pause', openPause);
  SS.engine.events.on('hidden', () => { if (game && game.started && !game.finished && game.pausable) openPause(); });

  // ---------------------------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------------------------

  let resultsEl = null;

  function closeResults() {
    if (!resultsEl) return;
    resultsEl.remove();
    resultsEl = null;
    SS.debug.screen = game ? 'play' : current ? current.id : null;
  }

  /** Persists skill changes and stats; returns what the results screen animates. */
  function applyResult(g, result) {
    const sport = g.sport;
    const rows = Array.isArray(result.players) && result.players.length ? result.players
      : g.ctx.players.map(p => ({ profileId: p.profile.id, name: p.profile.name, profile: p.profile, place: 1, isCpu: false }));
    const humanCount = rows.filter(r => !r.isCpu).length;
    const skills = [];
    for (const r of rows) {
      if (r.isCpu) continue;
      const prof = r.profile || (g.ctx.players.find(p => p.profile.id === r.profileId) || {}).profile;
      if (!prof || prof.isGuest || !save.getProfile(prof.id)) continue;
      const change = save.addSkill(prof.id, sport.id, Number(r.skillDelta) || 0);
      skills.push(Object.assign({ profile: prof, delta: change.after - change.before }, change));
      save.stat(sport.id, prof.id, 'games', 1);
      const won = result.outcome === 'win' || (rows.length > 1 && r.place === 1 && (humanCount > 1 || result.outcome !== 'lose'));
      if (won) save.stat(sport.id, prof.id, 'wins', 1);
    }
    const medals = new Set(Array.isArray(result.medals) ? result.medals : []);
    for (const m of g.medals) medals.add(m);
    return { rows, skills, medals: Array.from(medals) };
  }

  function finishGame(g, result) {
    if (!g || !g.alive || g.finished) return;
    g.finished = true;
    closePause(true);
    refreshPauseButton();
    result = result || {};
    const applied = applyResult(g, result);
    setTimeout(() => { if (g.alive) showResults(g.sport, result, applied, g); }, 550);
  }

  function placeLabel(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  function skillRow(s, big) {
    const row = ui.el('div', 'skill-row' + (big ? ' big' : ''));
    row.innerHTML = portraitHTML(s.profile, big ? 48 : 36) +
      '<div class="sr-main"><div class="sr-top"><b>' + esc(s.profile.name) + '</b>' + rankChip(s.before, 'small sr-rank') +
      '<span class="sr-delta ' + (s.delta >= 0 ? 'up' : 'down') + '">' + (s.delta >= 0 ? '+' : '−') + Math.abs(s.delta) + '</span></div>' +
      '<div class="sr-bar"><i class="sr-fill"></i></div><div class="sr-foot"><span class="sr-level">' + U.fmt.int(s.before) + '</span>' +
      '<small>' + (s.rankBefore.next ? 'Next: ' + esc(s.rankBefore.next.name) + ' at ' + U.fmt.int(s.rankBefore.next.min) : 'Top rank!') + '</small></div></div>';
    row.querySelector('.sr-fill').style.width = (rankProgress(s.before) * 100) + '%';
    return row;
  }

  /** Animates one skill bar before → after (with a rank-up moment). Realtime; skippable. */
  async function animateSkill(row, s, fast) {
    const fill = row.querySelector('.sr-fill');
    const levelEl = row.querySelector('.sr-level');
    const rankEl = row.querySelector('.sr-rank');
    const dur = fast() ? 0 : 900;
    const t0 = performance.now();
    let lastRank = s.rankBefore.id, tick = 0;
    await new Promise(resolve => {
      function step() {
        const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
        const e = U.ease.outCubic(fast() ? 1 : k);
        const lv = Math.round(U.lerp(s.before, s.after, e));
        levelEl.textContent = U.fmt.int(lv);
        fill.style.width = (rankProgress(lv) * 100) + '%';
        const r = save.rankFor(lv);
        if (r.id !== lastRank) {
          lastRank = r.id;
          rankEl.outerHTML = rankChip(lv, 'small sr-rank pop');
          if (r.index > s.rankBefore.index) {
            row.classList.add('rank-up');
            sfx('levelup');
            ui.haptic(30);
            ui.banner('RANK UP!', { kind: 'great', sub: s.profile.name + ' is now ' + r.name + '!', duration: 1.6 });
          }
        }
        if (++tick % 4 === 0 && k < 1) sfx('ui_tick', { vol: 0.35, rate: 1 + k * 0.5 });
        if (k < 1 && !fast()) requestAnimationFrame(step);
        else {
          levelEl.textContent = U.fmt.int(s.after);
          fill.style.width = (rankProgress(s.after) * 100) + '%';
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
    const r2 = row.querySelector('.sr-rank');
    if (r2 && save.rankFor(s.after).id !== s.rankBefore.id && !r2.classList.contains('pop')) r2.outerHTML = rankChip(s.after, 'small sr-rank pop');
  }

  function showResults(sport, result, applied, g) {
    closeResults();
    ui.clearFx();
    const accent = sport.accent || DEFAULT_ACCENT;
    const el = ui.el('div', 'ss-results');
    el.style.setProperty('--accent', accent);
    el.style.setProperty('--tint', sport.tint || DEFAULT_TINT);
    const outcome = result.outcome || 'done';
    const modeName = modeOf(sport, g ? g.cfg.mode : null).name;
    const panel = ui.el('div', 'res-panel ss-panel outcome-' + outcome);
    const headline = result.headline != null ? String(result.headline) : '';
    panel.innerHTML =
      '<div class="res-head"><div class="res-rays"></div><span class="res-icon">' + sportIcon(sport) + '</span>' +
      '<div class="res-mode">' + esc(sport.name) + ' · ' + esc(modeName) + '</div>' +
      '<h2 class="res-title">' + ui.letters(result.title || (outcome === 'win' ? 'You Win!' : outcome === 'lose' ? 'Good Game!' : 'Nice Game!')) + '</h2>' +
      (headline ? '<div class="res-headline"><b>' + esc(headline) + '</b>' + (result.headlineLabel ? '<small>' + esc(result.headlineLabel) + '</small>' : '') + '</div>' : '') +
      '</div>';
    const body = ui.el('div', 'res-body ss-scroll');
    const colA = ui.el('div', 'res-col');
    const colB = ui.el('div', 'res-col');
    body.append(colA, colB);
    panel.appendChild(body);

    // Players
    const rows = applied.rows.slice().sort((a, b) => (a.place || 99) - (b.place || 99));
    if (rows.length) {
      const sec = ui.el('section', 'res-sec res-players');
      sec.innerHTML = '<h3>' + ui.icon(rows.length > 1 ? 'users' : 'user') + (rows.length > 1 ? 'Standings' : 'Player') + '</h3>';
      const list = ui.el('ol', 'res-player-list');
      rows.forEach((r, i) => {
        const prof = r.profile || (r.isCpu && g && g.ctx.opponent ? g.ctx.opponent.profile : null);
        const li = ui.el('li', 'rp' + (r.place === 1 && rows.length > 1 ? ' first' : '') + (r.isCpu ? ' cpu' : ''));
        li.style.setProperty('--i', i);
        li.innerHTML = (rows.length > 1 ? '<span class="rp-place p' + (r.place || i + 1) + '">' + (r.place === 1 ? ui.icon('crown') : '') + placeLabel(r.place || i + 1) + '</span>' : '') +
          (prof ? portraitHTML(prof, 44) : '<span class="ss-portrait blank"></span>') +
          '<span class="rp-name"><b>' + esc(r.name || (prof && prof.name) || 'Player') + '</b>' + (r.isCpu ? '<small>CPU</small>' : '') + '</span>' +
          '<span class="rp-score">' + esc(r.score != null ? r.score : '') + '</span>';
        list.appendChild(li);
      });
      sec.appendChild(list);
      colA.appendChild(sec);
    }

    // Stats
    if (Array.isArray(result.stats) && result.stats.length) {
      const sec = ui.el('section', 'res-sec');
      sec.innerHTML = '<h3>' + ui.icon('chart') + 'Stats</h3>';
      const grid = ui.el('div', 'stat-grid');
      result.stats.forEach((s, i) => {
        const len = String(s.value).length;
        const cell = ui.el('div', 'stat' + (len > 8 ? ' longer' : len > 5 ? ' long' : ''), '<b>' + esc(s.value) + '</b><small>' + esc(s.label) + '</small>');
        cell.style.setProperty('--i', i);
        grid.appendChild(cell);
      });
      sec.appendChild(grid);
      colA.appendChild(sec);
    }

    // Skill
    let skillRows = [];
    if (applied.skills.length) {
      const sec = ui.el('section', 'res-sec');
      sec.innerHTML = '<h3>' + ui.icon('star') + 'Skill</h3>';
      skillRows = applied.skills.map(s => { const r = skillRow(s, applied.skills.length === 1); sec.appendChild(r); return r; });
      colB.appendChild(sec);
    }

    // Records
    const records = Array.isArray(result.records) ? result.records : [];
    let recordEls = [];
    if (records.length) {
      const sec = ui.el('section', 'res-sec');
      sec.innerHTML = '<h3>' + ui.icon('trophy') + 'Records</h3>';
      const list = ui.el('ul', 'res-records');
      recordEls = records.map(r => {
        const li = ui.el('li', r.isNew ? 'is-new' : '', '<span>' + esc(r.label) + '</span><b>' + esc(r.value) + '</b>' + (r.isNew ? '<em class="new-badge">NEW!</em>' : ''));
        list.appendChild(li);
        return li;
      });
      sec.appendChild(list);
      colB.appendChild(sec);
    }

    // Medals
    const medalEls = [];
    if (applied.medals.length) {
      const sec = ui.el('section', 'res-sec');
      sec.innerHTML = '<h3>' + ui.icon('medal') + 'Medals Earned</h3>';
      const grid = ui.el('div', 'res-medals');
      for (const id of applied.medals) {
        const md = (sport.medals || []).find(m => m.id === id) || { id, name: id, desc: '' };
        const tile = ui.el('div', 'res-medal', '<span class="medal-disc m-' + medalTier(sport, id) + '">' + ui.icon('star') + '<i class="shine"></i></span>' +
          '<span class="md-text"><b>' + esc(md.name) + '</b><small>' + esc(md.desc || '') + '</small></span>');
        grid.appendChild(tile);
        medalEls.push(tile);
      }
      sec.appendChild(grid);
      colB.appendChild(sec);
    }
    if (!colB.children.length) body.classList.add('single');

    // Actions
    const actions = ui.el('div', 'res-actions');
    // Without a live game (sample results) the buttons start fresh from this sport.
    const playable = !!SS.sports[sport.id];
    function playAgain() {
      if (g) restartGame(); else launch(quickConfig(sport), { intro: false });
    }
    function changeMode() {
      if (g) { exitToMenu(true); return; }
      closeResults();
      openSetup(sport);
    }
    const again = ui.button('Play Again', playAgain, { kind: 'primary', icon: 'retry', className: 'accent big' });
    const change = ui.button('Change Mode', changeMode, { kind: 'secondary', icon: 'map' });
    const menuBtn = ui.button('Menu', () => exitToMenu(false), { kind: 'secondary', icon: 'home', sfx: 'ui_back' });
    if (!playable) { again.disabled = true; change.disabled = true; }
    actions.append(again, change, menuBtn);
    panel.appendChild(actions);
    el.appendChild(panel);
    ui.overlay.appendChild(el);
    resultsEl = el;
    SS.debug.screen = 'results';

    // Choreography (tap anywhere to fast-forward)
    let skip = false;
    const fast = () => skip;
    el.addEventListener('pointerdown', () => { skip = true; el.classList.add('is-fast'); }, { once: true });
    const beat = ms => (skip ? Promise.resolve() : sleep(ms));
    music('results');
    if (result.celebrate) {
      sfx('fanfare_big');
      audio().duck(0.8, 3);
      ui.confetti({ count: 160 });
    } else if (outcome === 'lose') {
      sfx('jingle_lose');
      audio().duck(0.6, 2);
    } else {
      sfx('fanfare_small');
      audio().duck(0.6, 2);
    }
    (async () => {
      await beat(700);
      for (let i = 0; i < skillRows.length; i++) {
        if (resultsEl !== el) return;
        await animateSkill(skillRows[i], applied.skills[i], fast);
        await beat(200);
      }
      for (const li of recordEls) {
        if (resultsEl !== el) return;
        if (li.classList.contains('is-new')) { li.classList.add('stamp'); sfx('fanfare_record'); await beat(500); }
      }
      for (const tile of medalEls) {
        if (resultsEl !== el) return;
        tile.classList.add('shine-on');
        sfx('star');
        ui.haptic(20);
        await beat(450);
      }
    })();
  }

  /** Sample data for ?screen=results. */
  function sampleResults() {
    const sport = sportList()[0] || {
      id: 'sample', name: 'Bowling', tagline: 'Curve it into the pocket!', accent: '#FF5A5F', tint: '#FFE6E6', icon: GENERIC_ICON,
      modes: [{ id: 'game', name: '10 Frames' }],
      medals: [{ id: 'bronze', name: 'Bronze', desc: 'Score 100' }, { id: 'silver', name: 'Silver', desc: 'Score 150' },
        { id: 'gold', name: 'Gold', desc: 'Score 200' }, { id: 'platinum', name: 'Platinum', desc: 'Roll a perfect 300' }],
    };
    const me = ensureProfile();
    const rival = SS.pals.CPU_ROSTER[6];
    const before = save.skill(me.id, sport.id).level;
    const after = Math.min(save.LEVEL_MAX, before + 64);
    const delta = after - before;
    const change = { profile: me, before, after, delta, rankBefore: save.rankFor(before), rankAfter: save.rankFor(after) };
    const result = {
      outcome: 'win', title: 'You Win!', headline: '187', headlineLabel: 'Final Score', celebrate: true,
      stats: [{ label: 'Strikes', value: '5' }, { label: 'Spares', value: '3' }, { label: 'Best Frame', value: '30' }, { label: 'Gutters', value: '0' }],
      records: [{ label: 'High Score', value: '187', isNew: true }, { label: 'Most Strikes', value: '6', isNew: false }],
      medals: (sport.medals || []).slice(0, 2).map(m => m.id),
    };
    const rows = [
      { profileId: me.id, name: me.name, profile: me, score: '187', place: 1, isCpu: false, skillDelta: delta },
      { profileId: rival.profile.id, name: rival.profile.name, profile: rival.profile, score: '164', place: 2, isCpu: true },
    ];
    showResults(sport, result, { rows, skills: [change], medals: result.medals }, null);
  }

  // ---------------------------------------------------------------------------------------------
  // Save events
  // ---------------------------------------------------------------------------------------------

  save.events.on('medal', (sportId, medalId) => {
    const sport = SS.sports[sportId];
    if (!sport || !game || game.finished) return;
    const md = (sport.medals || []).find(m => m.id === medalId);
    ui.toast('Medal earned: ' + (md ? md.name : medalId) + '!', { icon: 'medal', duration: 2.4 });
    sfx('coin');
  });

  // ---------------------------------------------------------------------------------------------
  // Boot & URL parameters
  // ---------------------------------------------------------------------------------------------

  function quickConfig(sport) {
    const me = ensureProfile();
    const maxP = Math.max(1, (sport.players && sport.players.max) || 1);
    const want = U.clamp(Math.round(Number(params.players) || (sport.players && sport.players.min) || 1), 1, maxP);
    const players = [me];
    for (let i = 1; i < want; i++) players.push(guestProfile(i));
    let opp = null;
    if (sport.opponent) {
      opp = params.opp != null && SS.pals.CPU_ROSTER[Number(params.opp)] ? Number(params.opp)
        : SS.pals.CPU_ROSTER.indexOf(SS.pals.rosterFor(save.skill(me.id, sport.id).level));
    }
    return { sportId: sport.id, mode: modeOf(sport, params.mode).id, players, oppIndex: opp, seed: params.seed != null ? Number(params.seed) : null };
  }

  function route() {
    const sport = params.sport ? SS.sports[params.sport] : null;
    if (sport) { launch(quickConfig(sport), { intro: !params.skip }); return; }
    const scr = params.screen;
    if (scr === 'editor') { showScreen('editor', { mode: humanPals().length ? 'new' : 'first' }); return; }
    if (scr === 'menu' || scr === 'records' || scr === 'settings' || scr === 'pals') { ensureProfile(); showScreen(scr); return; }
    if (scr === 'results') { ensureProfile(); showScreen('menu'); sampleResults(); return; }
    showScreen('title');
  }

  function hideLoading() {
    const node = document.getElementById('ss-loading');
    if (!node) return;
    node.classList.add('is-hidden');
    setTimeout(() => { node.hidden = true; }, 600);
  }

  function fontsReady(maxMs) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const loads = ['700 20px Fredoka', '600 20px Fredoka', '800 16px Nunito', '900 16px Nunito'].map(f => document.fonts.load(f).catch(() => null));
    return Promise.race([Promise.all(loads), sleep(maxMs)]);
  }

  async function boot() {
    if (params.reset) save.reset();
    setAccent();
    const ok = SS.engine.init(document.getElementById('ss-canvas'));
    if (!ok) { hideLoading(); return; }
    audio().setVolumes({ music: save.settings.music, sfx: save.settings.sfx });
    await fontsReady(1500);
    try {
      plaza.build();
    } catch (err) {
      console.error('[SS] plaza failed to build:', err);
    }
    route();
    plaza.warm();
    armHistory();
    requestAnimationFrame(() => requestAnimationFrame(hideLoading));
  }

  SS.app = {
    showScreen, launch, openSetup, openPause, sampleResults,
    get game() { return game; },
    get screen() { return current ? current.id : null; },
    plaza,
  };

  boot();
})();
