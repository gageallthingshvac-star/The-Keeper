// Rendering foundation: renderer, environment (sky, ocean, weather), generated textures,
// geometry library, instanced mesh pools and GPU particles. Knows nothing about game rules.
const Gfx = (() => {
  const {S, DECK} = Sim;
  const V3 = THREE.Vector3;
  const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  const QUALITY = {
    low:    {pr: 1,   shadows: false, oceanSeg: 110, particles: 2500, lights: 0, aa: false},
    medium: {pr: 1.5, shadows: false, oceanSeg: 170, particles: 4000, lights: 2, aa: true},
    high:   {pr: 2,   shadows: true,  oceanSeg: 230, particles: 6000, lights: 3, aa: true},
    // iPhone 14 and newer (A15+): shadows on with a lighter map; the governor trims resolution if it runs hot.
    phone:  {pr: 2,   shadows: true,  shadowMap: 1024, oceanSeg: 170, particles: 4500, lights: 2, aa: true},
  };
  const modernPhone = () => IS_TOUCH && Math.min(screen.width, screen.height) >= 390 && (window.devicePixelRatio || 1) >= 3;
  const resolveQuality = q => QUALITY[q] ? q : (IS_TOUCH ? (modernPhone() ? 'phone' : 'medium') : 'high');

  // ---------------------------------------------------------------- waves
  // Same function on the CPU (ships bob on it) and GPU (ocean surface). `amp` follows the weather.
  let waveAmp = 1;
  const waveH = (x, z, t) => waveAmp * (1.3 * Math.sin(0.011 * x + 0.9 * t) + 0.9 * Math.sin(0.015 * z - 0.7 * t + 1.3) +
    0.6 * Math.sin(0.019 * (x + z) + 1.3 * t) + 0.35 * Math.sin(0.031 * (x - 0.6 * z) - 1.7 * t));
  const WAVE_GLSL = `
    uniform float uWave;
    float waveH(vec2 p, float t){
      return uWave*(1.3*sin(0.011*p.x+0.9*t) + 0.9*sin(0.015*p.y-0.7*t+1.3) + 0.6*sin(0.019*(p.x+p.y)+1.3*t) + 0.35*sin(0.031*(p.x-0.6*p.y)-1.7*t));
    }
    vec2 waveD(vec2 p, float t){
      float a1=0.011*p.x+0.9*t, a2=0.015*p.y-0.7*t+1.3, a3=0.019*(p.x+p.y)+1.3*t, a4=0.031*(p.x-0.6*p.y)-1.7*t;
      return uWave*vec2(1.3*0.011*cos(a1) + 0.6*0.019*cos(a3) + 0.35*0.031*cos(a4),
                        0.9*0.015*cos(a2) + 0.6*0.019*cos(a3) - 0.35*0.031*0.6*cos(a4));
    }`;

  // ---------------------------------------------------------------- renderer
  function makeRenderer(canvas, quality) {
    const Q = QUALITY[quality];
    const r = new THREE.WebGLRenderer({canvas, antialias: Q.aa, powerPreference: 'high-performance'});
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = Q.shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    return r;
  }

  // Lowers/raises resolution to hold frame rate (iPhones throttle when warm).
  class Governor {
    constructor(renderer, maxPR) { this.r = renderer; this.max = Math.min(window.devicePixelRatio || 1, maxPR); this.min = Math.min(1, this.max); this.avg = 16; this.cool = 0; }
    tick(ms) {
      this.avg += (Math.min(ms, 100) - this.avg) * 0.05;
      if (--this.cool > 0) return;
      const pr = this.r.getPixelRatio();
      if (this.avg > 24 && pr > this.min) { this.r.setPixelRatio(Math.max(this.min, pr - 0.25)); this.cool = 90; return true; }
      if (this.avg < 13 && pr < this.max) { this.r.setPixelRatio(Math.min(this.max, pr + 0.25)); this.cool = 180; return true; }
      return false;
    }
  }

  // ---------------------------------------------------------------- textures
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  function speckle(g, w, h, n, a) {
    for (let i = 0; i < n; i++) { const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  }
  const TEX = {};
  function initTextures() {
    // deck plate: one plate per block, seams and rivets
    TEX.deck = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#d4d8dc'; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, 0.08);
      g.strokeStyle = 'rgba(40,46,52,.55)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
      g.strokeStyle = 'rgba(40,46,52,.25)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.fillStyle = 'rgba(30,34,38,.5)';
      for (const x of [10, w - 10]) for (const y of [10, h / 2 - 8, h / 2 + 8, h - 10]) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
    });
    TEX.deck.offset.set(0.5, 0.5);
    // hull side: weathered paint above, boot-top stripe, red antifouling below the waterline (v=0.625)
    TEX.side = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#d2d6da'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(60,40,30,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h * 0.3, 1 + Math.random() * 2, Math.random() * h * 0.35); }
      speckle(g, w, h, 300, 0.07);
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, w, 5);
      const wl = Math.round(h * (1 - 0.625));
      g.fillStyle = '#efe9dc'; g.fillRect(0, wl - 4, w, 5);
      g.fillStyle = '#7d2b22'; g.fillRect(0, wl + 1, w, h - wl);
      g.strokeStyle = 'rgba(20,24,28,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(1, 0); g.lineTo(1, h); g.stroke();
    });
    // armor deck: darker tread plate
    TEX.armor = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, w, h); speckle(g, w, h, 600, 0.1);
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2;
      for (let y = 8; y < h; y += 16) for (let x = (y / 16 % 2) * 8 + 4; x < w; x += 16) { g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.stroke(); }
      g.strokeStyle = 'rgba(20,24,28,.6)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    });
    TEX.armor.offset.set(0.5, 0.5);
    TEX.oceanN = oceanNormals(256);
    TEX.soft = canvasTex(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  // Tileable normal map from integer-frequency waves (so it repeats seamlessly). Mipmapped: no shimmer at range.
  function oceanNormals(N) {
    const waves = [];
    for (let i = 0; i < 28; i++) {
      const k = 1 + Math.floor(Math.random() * (i < 8 ? 4 : 12));
      const a = Math.random() * Math.PI * 2;
      waves.push({kx: Math.round(Math.cos(a) * k), ky: Math.round(Math.sin(a) * k) || 1, amp: 1 / (k * 1.2), ph: Math.random() * 6.283});
    }
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0;
      const u = x / N, v = y / N;
      for (const w of waves) { const p = 6.283 * (w.kx * u + w.ky * v) + w.ph, s = -Math.sin(p) * w.amp * 6.283; dx += s * w.kx; dy += s * w.ky; }
      const n = new V3(-dx * 0.012, 1, -dy * 0.012).normalize();
      const i = (y * N + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.z * 0.5 + 0.5) * 255; data[i + 2] = n.y * 255; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  }

  // ---------------------------------------------------------------- materials
  const MAT = {};
  function initMaterials() {
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({roughness: 0.7, metalness: 0.25}, o));
    MAT.deck = std({map: TEX.deck, roughness: 0.82, metalness: 0.15});
    MAT.side = std({map: TEX.side, roughness: 0.72, metalness: 0.25});
    MAT.armorDeck = std({map: TEX.armor, roughness: 0.5, metalness: 0.55});
    MAT.armorSide = std({map: TEX.side, color: '#b6bcc2', roughness: 0.55, metalness: 0.5});
    MAT.paint = std({roughness: 0.55, metalness: 0.35});          // tinted per team via instanceColor
    MAT.light = std({color: '#d7dce0', roughness: 0.6});
    MAT.glass = std({color: '#18252f', roughness: 0.15, metalness: 0.7});
    MAT.dark = std({color: '#2a3036', roughness: 0.5, metalness: 0.55});
    MAT.black = std({color: '#121416', roughness: 0.9});
    MAT.funnel = std({color: '#c2a36d', roughness: 0.6});
    MAT.red = std({color: '#c2473a', roughness: 0.5});
    MAT.yellow = std({color: '#d9a92e', roughness: 0.5});
    MAT.flight = std({color: '#6b5e4c', roughness: 0.85, metalness: 0.05});
    MAT.plane = std({color: '#c9d1d8', roughness: 0.55, metalness: 0.3});
    MAT.planeFly = MAT.plane; MAT.darkFly = MAT.dark; // same look, separate instance pools
    MAT.coil = std({color: '#4f8fb8', roughness: 0.3, metalness: 0.7, emissive: '#16405a', emissiveIntensity: 0.6});
    MAT.shell = new THREE.MeshBasicMaterial({color: '#ffd27a'});
    MAT.missile = std({color: '#e8e8e8', roughness: 0.4});
    MAT.torp = std({color: '#1c2228'});
    MAT.debris = std({color: '#444a52', roughness: 0.8});
    MAT.buoy = std({color: '#d9452f', roughness: 0.5});
    MAT.beam = new THREE.MeshBasicMaterial({color: '#9fe0ff', transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false});
  }

  // ---------------------------------------------------------------- geometry
  const GEO = {};
  // Hull outlines in block units (x right, y = toward the bow). Chamfered bows and rounded sterns.
  const OUTLINES = {
    full:   [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]],
    bow:    [[-.5, -.5], [.5, -.5], [.5, -.1], [.12, .5], [-.12, .5], [-.5, -.1]],
    bowL:   [[-.5, -.5], [.5, -.5], [.5, .5], [0, .5], [-.5, 0]],
    bowR:   [[-.5, -.5], [.5, -.5], [.5, 0], [0, .5], [-.5, .5]],
    stern:  [[-.42, -.5], [.42, -.5], [.5, -.25], [.5, .5], [-.5, .5], [-.5, -.25]],
    sternL: [[-.25, -.5], [.5, -.5], [.5, .5], [-.5, .5], [-.5, -.25]],
    sternR: [[-.5, -.5], [.25, -.5], [.5, -.25], [.5, .5], [-.5, .5]],
  };
  function prism(outline, height, top) {
    const sh = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, {depth: 1, bevelEnabled: false});
    g.rotateX(-Math.PI / 2);        // extrusion now runs up +Y; shape +y now points to -Z (the bow)
    g.scale(S, height, S);
    g.translate(0, top - height, 0);
    g.computeVertexNormals();
    return g;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg);
  function initGeometry() {
    for (const k in OUTLINES) { GEO['hull_' + k] = prism(OUTLINES[k], 8, DECK); GEO['armor_' + k] = prism(OUTLINES[k], 8.7, DECK + 0.7); }
    GEO.tower = box(7.6, 7, 7.6).translate(0, DECK + 3.5, 0);
    GEO.tower2 = box(6.4, 3.6, 6.8).translate(0, DECK + 8.8, 0);
    GEO.window = box(6.6, 1.2, 7.0).translate(0, DECK + 9.6, 0);
    GEO.wing = box(9.6, 0.6, 2.2).translate(0, DECK + 7.3, -2.2);
    GEO.mast = cyl(0.3, 0.45, 8, 6).translate(0, DECK + 14.6, 0);
    GEO.radarBar = box(5.2, 0.7, 0.5);
    GEO.funnel = cyl(2.3, 2.8, 9, 14).translate(0, DECK + 4.5, 0);
    GEO.funnelTop = cyl(2.36, 2.36, 1.6, 14).translate(0, DECK + 8.4, 0);
    GEO.rudderCap = cyl(1.3, 1.5, 1.2, 10).translate(0, DECK + 0.6, 1.5);
    GEO.gunBase = cyl(3.1, 3.6, 2.6, 16).translate(0, 1.3, 0);
    GEO.gunBarrel = cyl(0.38, 0.5, 8, 8).rotateX(Math.PI / 2).translate(0, 0, -4);
    GEO.heavyHouse = box(8.4, 3.8, 8.6).translate(0, 1.9, 0.6);
    GEO.heavyRoof = box(7.2, 0.8, 6.4).translate(0, 4.1, 1.2);
    GEO.heavyBarrel = cyl(0.55, 0.75, 13, 8).rotateX(Math.PI / 2).translate(0, 0, -6.5);
    GEO.torpBase = cyl(3, 3.2, 1.2, 12).translate(0, 0.6, 0);
    GEO.torpTube = cyl(0.8, 0.8, 9, 8).rotateX(Math.PI / 2).translate(0, 0, -1.5);
    GEO.ciwsBase = cyl(1.7, 2.2, 2, 10).translate(0, 1, 0);
    GEO.ciwsDome = new THREE.SphereGeometry(2, 14, 10).translate(0, 3.4, 0.4);
    GEO.ciwsBarrel = cyl(0.22, 0.22, 4.6, 6).rotateX(Math.PI / 2).translate(0, 0, -2.3);
    GEO.vls = box(8.4, 1.4, 8.4).translate(0, DECK + 0.7, 0);
    GEO.hatch = cyl(1.25, 1.25, 0.4, 12);
    GEO.railBase = box(6.5, 2.6, 7).translate(0, 1.3, 0.5);
    GEO.railRail = box(0.9, 1.1, 17).translate(0, 0, -8);
    GEO.railCoil = cyl(1.6, 1.6, 0.8, 12).rotateX(Math.PI / 2);
    GEO.rocketBase = cyl(2.6, 3, 1.4, 12).translate(0, 0.7, 0);
    GEO.rocketBox = box(6.4, 3.6, 6).translate(0, 0, -0.5);
    GEO.rocketFace = box(5.6, 2.8, 0.3).translate(0, 0, -3.6);
    GEO.superHouse = box(9.8, 4.6, 10.4).translate(0, 2.3, 0.8);
    GEO.superRoof = box(8.6, 0.9, 7.4).translate(0, 5.0, 1.6);
    GEO.superBarrel = cyl(0.7, 0.95, 17, 8).rotateX(Math.PI / 2).translate(0, 0, -8.5);
    GEO.aaBase = cyl(1.6, 2, 1.2, 10).translate(0, 0.6, 0);
    GEO.aaMount = box(2.6, 1.6, 2.2).translate(0, 1.6, 0);
    GEO.aaBarrel = cyl(0.2, 0.25, 4.2, 6).rotateX(Math.PI / 2).translate(0, 0, -2.1);
    GEO.flightDeck = box(S, 0.5, S).translate(0, DECK + 0.25, 0);
    GEO.deckStripe = box(0.8, 0.52, S).translate(0, DECK + 0.26, 0);
    // aircraft, built nose toward -z
    GEO.planeBody = cyl(0.55, 0.75, 7.2, 8).rotateX(Math.PI / 2);
    GEO.planeWing = box(11, 0.3, 2.1).translate(0, 0, -0.4);
    GEO.planeTail = box(4, 0.25, 1.2).translate(0, 0.2, 3.1);
    GEO.planeFin = box(0.25, 1.6, 1.3).translate(0, 0.9, 3.1);
    GEO.planeProp = box(3, 0.15, 0.2).translate(0, 0, -3.75);
    GEO.bomb = new THREE.SphereGeometry(0.9, 6, 4).scale(0.8, 0.8, 1.6);
    GEO.radarMast = cyl(0.5, 0.8, 7, 8).translate(0, DECK + 3.5, 0);
    GEO.radarDish = box(7.5, 2.4, 0.5);
    GEO.craneBase = box(3, 4, 3).translate(1.5, DECK + 2, 1.5);
    GEO.craneArm = box(1, 1, 9).translate(1.5, DECK + 4.4, -2);
    GEO.repairPad = box(6, 0.3, 6).translate(-1, DECK + 0.15, -1);
    GEO.canister = cyl(1.1, 1.1, 4.5, 10).rotateX(-0.6);
    GEO.shell = new THREE.SphereGeometry(1, 8, 6);
    GEO.rocket = cyl(0.35, 0.45, 3.4, 6).rotateX(Math.PI / 2);
    GEO.missile = cyl(0.55, 0.75, 7, 8).rotateX(Math.PI / 2);
    GEO.torp = cyl(0.7, 0.7, 7, 8).rotateX(Math.PI / 2);
    GEO.debris = box(4, 2.6, 3.4);
    GEO.buoy = cyl(1.4, 2.2, 7, 8).translate(0, 2.5, 0);
    GEO.beam = cyl(0.6, 0.6, 1, 6, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  }

  // ---------------------------------------------------------------- instance pools
  const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const _white = new THREE.Color(1, 1, 1);
  class Pool {
    constructor(parent, geo, mat, cap = 64, shadow = true) {
      this.parent = parent; this.geo = geo; this.mat = mat; this.shadow = shadow;
      this.free = []; this.n = 0; this.dirty = false; this.cdirty = false;
      this.make(cap);
    }
    make(cap) {
      const old = this.mesh;
      const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = this.shadow; m.receiveShadow = this.shadow; m.frustumCulled = false;
      for (let i = 0; i < cap; i++) { m.setMatrixAt(i, _zero); m.setColorAt(i, _white); }
      if (old) {
        m.instanceMatrix.array.set(old.instanceMatrix.array);
        m.instanceColor.array.set(old.instanceColor.array);
        m.count = old.count;
        this.parent.remove(old); old.dispose();
      } else m.count = 0;
      this.parent.add(m);
      this.mesh = m; this.cap = cap;
    }
    alloc() {
      const i = this.free.length ? this.free.pop() : this.n++;
      if (i >= this.cap) this.make(this.cap * 2);
      if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
      return i;
    }
    release(i) { this.mesh.setMatrixAt(i, _zero); this.free.push(i); this.dirty = true; }
    set(i, m) { this.mesh.setMatrixAt(i, m); this.dirty = true; }
    color(i, c) { this.mesh.setColorAt(i, c); this.cdirty = true; }
    flush() {
      if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
      if (this.cdirty) { this.mesh.instanceColor.needsUpdate = true; this.cdirty = false; }
    }
    clear() { for (let i = 0; i < this.n; i++) this.mesh.setMatrixAt(i, _zero); this.free.length = 0; this.n = 0; this.mesh.count = 0; this.dirty = true; }
    dispose() { this.parent.remove(this.mesh); this.mesh.dispose(); }
  }
  // A keyed set of pools, created on demand: pools.get('gunBase', 'paint')
  class PoolSet {
    constructor(parent, shadows) { this.parent = parent; this.shadows = shadows; this.map = new Map(); }
    get(geo, mat, shadow = true) {
      const k = geo + '|' + mat;
      let p = this.map.get(k);
      if (!p) { p = new Pool(this.parent, GEO[geo], MAT[mat] || mat, 32, shadow && this.shadows); this.map.set(k, p); }
      return p;
    }
    flush() { for (const p of this.map.values()) p.flush(); }
    clear() { for (const p of this.map.values()) p.clear(); }
    dispose() { for (const p of this.map.values()) p.dispose(); this.map.clear(); }
  }

  // ---------------------------------------------------------------- particles
  // One draw call for normal-blended particles and one for additive glow.
  class Particles {
    constructor(max, additive, fog) {
      this.max = max; this.list = [];
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      this.mat = new THREE.ShaderMaterial({
        uniforms: {uScale: {value: 500}, uFog: fog.color, uFogNear: fog.near, uFogFar: fog.far},
        vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC; varying float vD;
          void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
            gl_PointSize = min(aSize*uScale/max(-mv.z,1.0), 400.0); vC = aColor; vD = -mv.z; }`,
        fragmentShader: `varying vec4 vC; varying float vD; uniform vec3 uFog; uniform float uFogNear, uFogFar;
          void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if (r>0.5) discard;
            float a = vC.a*smoothstep(0.5,0.12,r);
            float f = smoothstep(uFogNear, uFogFar, vD);
            ${additive ? 'gl_FragColor = vec4(vC.rgb, a*(1.0-f));' : 'gl_FragColor = vec4(mix(vC.rgb, uFog, f), a);'}
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false; this.points.renderOrder = additive ? 3 : 2;
      this.geo = g;
    }
    setScale(s) { this.mat.uniforms.uScale.value = s; }
    add(p) { if (this.list.length < this.max) { p.max = p.life; this.list.push(p); } }
    update(dt, t) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const q = L[i]; q.life -= dt;
        if (q.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vh -= (q.grav || 0) * dt;
        const dr = q.drag || 0.97; q.vx *= dr; q.vy *= dr;
        if (q.surf) q.h = waveH(q.x, q.y, t) + 0.6;
        else if (q.grav && q.h < waveH(q.x, q.y, t) - 1) q.life = 0;
      }
    }
    upload() {
      const L = this.list, n = L.length;
      for (let i = 0; i < n; i++) {
        const q = L[i], f = q.life / q.max, c = q.c;
        this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.h; this.pos[i * 3 + 2] = q.y;
        this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2];
        this.col[i * 4 + 3] = (q.a || 1) * (q.fadeIn ? Math.min(1, (1 - f) * 5) * f : f);
        this.size[i] = q.size * (q.grow ? 1 + (1 - f) * q.grow : (q.shrink ? f : 1));
      }
      this.geo.setDrawRange(0, n);
      for (const k of ['position', 'aColor', 'aSize']) this.geo.attributes[k].needsUpdate = true;
    }
    clear() { this.list.length = 0; }
  }

  // ---------------------------------------------------------------- environment
  // Sky dome + ocean + lights + optional weather layers. Shared by the shipyard and the battle.
  class Env {
    constructor(renderer, opts = {}) {
      this.renderer = renderer;
      const Q = QUALITY[opts.quality || 'medium'];
      const sc = this.scene = new THREE.Scene();
      this.fog = {color: {value: new THREE.Color()}, near: {value: 700}, far: {value: 2600}};
      sc.fog = new THREE.Fog(0xffffff, 700, 2600);
      this.u = {
        uTime: {value: 0}, uWave: {value: 1}, uSun: {value: new V3(0.45, 0.55, 0.35).normalize()},
        uSunCol: {value: new THREE.Color()}, uFog: this.fog.color, uFogNear: this.fog.near, uFogFar: this.fog.far,
        uDeep: {value: new THREE.Color()}, uShallow: {value: new THREE.Color()}, uZenith: {value: new THREE.Color()},
        uNormal: {value: TEX.oceanN}, uFlash: {value: 0},
      };
      this.sky = this.makeSky(); sc.add(this.sky);
      this.hemi = new THREE.HemisphereLight('#d6e8f5', '#22394a', 1.25); sc.add(this.hemi);
      this.sun = new THREE.DirectionalLight('#fff1dc', 2.6);
      this.sun.castShadow = Q.shadows;
      if (Q.shadows) {
        this.sun.shadow.mapSize.set(Q.shadowMap || 2048, Q.shadowMap || 2048);
        const c = this.sun.shadow.camera; c.left = c.bottom = -opts.shadowSize || -260; c.right = c.top = opts.shadowSize || 260; c.near = 10; c.far = 2400;
        this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.6;
      }
      sc.add(this.sun); sc.add(this.sun.target);
      const size = opts.oceanSize || 5200, seg = opts.oceanSeg || Q.oceanSeg;
      this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2), this.oceanMaterial());
      this.ocean.frustumCulled = false; this.oceanStep = size / seg;
      sc.add(this.ocean);
      this.lights = [];
      for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight('#ffb060', 0, 220, 1.6); l.position.set(0, -500, 0); sc.add(l); this.lights.push({l, t: 0}); }
      this.weather = null;
    }
    oceanMaterial() {
      return new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: WAVE_GLSL + `
          uniform float uTime; varying vec3 vW;
          void main(){ vec4 w = modelMatrix*vec4(position,1.0); w.y = waveH(w.xz, uTime); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: WAVE_GLSL + `
          uniform float uTime, uFogNear, uFogFar, uFlash; uniform vec3 uSun, uSunCol, uFog, uDeep, uShallow, uZenith; uniform sampler2D uNormal;
          varying vec3 vW;
          void main(){
            float dist = length(cameraPosition - vW);
            vec2 d = waveD(vW.xz, uTime);
            vec3 n1 = texture2D(uNormal, vW.xz/96.0 + uTime*vec2(0.011, 0.007)).xyz*2.0-1.0;
            vec3 n2 = texture2D(uNormal, vW.xz/41.0 - uTime*vec2(0.017, -0.012)).xyz*2.0-1.0;
            float fade = 1.0 - smoothstep(250.0, 1500.0, dist);
            vec2 det = (n1.xy + n2.xy*0.7) * (0.55*fade + 0.12) * (0.6 + 0.4*uWave);
            vec3 n = normalize(vec3(-d.x - det.x*0.35, 1.0, -d.y - det.y*0.35));
            vec3 v = normalize(cameraPosition - vW);
            float fres = 0.02 + 0.98*pow(1.0 - max(dot(n, v), 0.0), 5.0);
            vec3 water = mix(uDeep, uShallow, clamp((vW.y + 2.5*uWave)/(6.0*uWave), 0.0, 1.0)*0.7 + 0.12*max(dot(n, uSun), 0.0));
            vec3 r = reflect(-v, n);
            vec3 sky = mix(uFog, uZenith, clamp(r.y*1.5, 0.0, 1.0));
            vec3 col = mix(water, sky, fres*0.85);
            float spec = pow(max(dot(r, uSun), 0.0), 220.0);
            col += uSunCol*spec*2.4 + uSunCol*pow(max(dot(r, uSun), 0.0), 18.0)*0.06;
            col = mix(col, vec3(0.78, 0.86, 0.9), smoothstep(2.0*uWave, 3.1*uWave, vW.y)*0.32);
            col += uFlash*vec3(0.35, 0.4, 0.5);
            col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
    }
    makeSky() {
      const m = new THREE.ShaderMaterial({
        uniforms: {uFog: this.fog.color, uZenith: this.u.uZenith, uSun: this.u.uSun, uSunCol: this.u.uSunCol, uFlash: this.u.uFlash, uMoon: {value: 0}},
        vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uFog, uZenith, uSun, uSunCol; uniform float uFlash, uMoon; varying vec3 vD;
          void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(uFog, uZenith, pow(h, 0.55));
            float s = max(dot(normalize(vD), uSun), 0.0);
            c += uSunCol*(pow(s, uMoon > 0.5 ? 2400.0 : 700.0)*(uMoon > 0.5 ? 2.5 : 4.0) + pow(s, 14.0)*(uMoon > 0.5 ? 0.04 : 0.16));
            c += uFlash*vec3(0.5, 0.55, 0.65);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), m);
      mesh.renderOrder = -1; mesh.frustumCulled = false;
      this.skyMat = m;
      return mesh;
    }
    setWeather(w) {
      this.weather = w;
      const sun = new V3(...w.sun).normalize();
      this.u.uSun.value.copy(sun);
      this.u.uSunCol.value.set(w.sunColor);
      this.fog.color.value.set(w.fog); this.scene.fog.color.set(w.fog);
      this.fog.near.value = this.scene.fog.near = w.fogNear; this.fog.far.value = this.scene.fog.far = w.fogFar;
      this.u.uDeep.value.set(w.deep); this.u.uShallow.value.set(w.shallow); this.u.uZenith.value.set(w.zenith);
      this.u.uWave.value = w.waves; waveAmp = w.waves;
      this.skyMat.uniforms.uMoon.value = w.stars ? 1 : 0;
      this.sun.color.set(w.sunColor); this.sun.intensity = w.sunI; this.hemi.intensity = w.hemiI;
      this.hemi.color.set(w.stars ? '#6a7fa8' : '#d6e8f5'); this.hemi.groundColor.set(w.stars ? '#0a1018' : '#22394a');
      this.renderer.toneMappingExposure = w.exposure;
      this.setStars(!!w.stars); this.setRain(!!w.rain);
    }
    setStars(on) {
      if (on && !this.stars) {
        const n = 1400, p = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const u = Math.random() * 2 * Math.PI, v = Math.acos(Math.random() * 0.95); p[i * 3] = Math.sin(v) * Math.cos(u) * 4500; p[i * 3 + 1] = Math.cos(v) * 4500; p[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 4500; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        this.stars = new THREE.Points(g, new THREE.PointsMaterial({color: '#dfe8ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85}));
        this.stars.frustumCulled = false; this.stars.renderOrder = -1;
        this.scene.add(this.stars);
      }
      if (this.stars) this.stars.visible = on;
    }
    setRain(on) {
      if (on && !this.rain) {
        const n = 1600, p = new Float32Array(n * 6);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
        this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({color: '#c8d4dc', transparent: true, opacity: 0.32, fog: false}));
        this.rain.frustumCulled = false;
        this.rainDrops = Array.from({length: n}, () => [Math.random() * 400 - 200, Math.random() * 160, Math.random() * 400 - 200]);
        this.scene.add(this.rain);
      }
      if (this.rain) this.rain.visible = on;
    }
    // Pulse one of the pooled explosion lights.
    flashLight(x, h, y, power) {
      if (!this.lights.length) return;
      let best = this.lights[0];
      for (const L of this.lights) if (L.t < best.t) best = L;
      best.l.position.set(x, h + 6, y); best.t = 1; best.power = power;
    }
    update(dt, t, camera) {
      this.u.uTime.value = t;
      const c = camera.position, st = this.oceanStep;
      this.ocean.position.set(Math.round(c.x / st) * st, 0, Math.round(c.z / st) * st);
      this.sky.position.copy(c);
      if (this.stars) this.stars.position.copy(c);
      for (const L of this.lights) { L.t = Math.max(0, L.t - dt * 3.2); L.l.intensity = L.t * L.t * (L.power || 1) * 900; }
      this.u.uFlash.value = Math.max(0, this.u.uFlash.value - dt * 3);
      if (this.rain && this.rain.visible) {
        const a = this.rain.geometry.attributes.position.array;
        this.rainDrops.forEach((d, i) => {
          d[1] -= dt * 190; d[0] -= dt * 30;
          if (d[1] < 0) { d[1] += 160; d[0] = Math.random() * 400 - 200; d[2] = Math.random() * 400 - 200; }
          const x = c.x + d[0], y = c.y - 60 + d[1], z = c.z + d[2];
          a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z; a[i * 6 + 3] = x + 1.5; a[i * 6 + 4] = y + 6; a[i * 6 + 5] = z;
        });
        this.rain.geometry.attributes.position.needsUpdate = true;
      }
    }
    lightning() { this.u.uFlash.value = 1; }
    // Free GPU memory owned by this environment (geometry and materials it created; shared library assets stay).
    dispose() {
      for (const o of [this.ocean, this.sky, this.stars, this.rain]) {
        if (!o) continue;
        this.scene.remove(o); o.geometry.dispose(); o.material.dispose();
      }
      for (const L of this.lights) this.scene.remove(L.l);
      this.scene.remove(this.sun, this.sun.target, this.hemi);
      if (this.sun.shadow && this.sun.shadow.map) this.sun.shadow.map.dispose();
    }
    focusShadow(x, z) {
      const s = this.u.uSun.value;
      this.sun.position.set(x + s.x * 700, s.y * 700, z + s.z * 700);
      this.sun.target.position.set(x, 0, z);
    }
  }

  let ready = false;
  function init() { if (ready) return; initTextures(); initMaterials(); initGeometry(); ready = true; }

  return {QUALITY, resolveQuality, IS_TOUCH, waveH, makeRenderer, Governor, TEX, MAT, GEO, OUTLINES, Pool, PoolSet, Particles, Env, init};
})();
