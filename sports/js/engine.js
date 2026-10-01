/* Sunny Sports — engine.js
 * Renderer, quality tiers, resize, main loop (game time vs real time, pause, slow-mo, timers),
 * camera helpers (fit, shake, project), disposal, context-loss handling, unified pointer +
 * keyboard input (SS.input) and test hooks (SS.debug).
 * Every call into later modules (SS.audio, SS.world, SS.ui) is guarded so a missing or
 * failing module can never take the engine down.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const THREE = SS.THREE || window.THREE;
  const U = SS.util;

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  /** Calls SS[mod][fn](...args) if it exists; errors are reported, never thrown. */
  function callModule(mod, fn, ...args) {
    const m = SS[mod];
    if (!m || typeof m[fn] !== 'function') return undefined;
    try { return m[fn](...args); } catch (err) { console.error('[SS] ' + mod + '.' + fn + ' failed:', err); }
    return undefined;
  }

  /** Runs a per-frame callback; a failing callback is reported once and keeps being called. */
  function safeRun(entry, a, b) {
    try { entry.fn(a, b); } catch (err) {
      if (!entry.failed) { entry.failed = true; console.error('[SS] frame callback failed:', err); }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // URL parameters → SS.debug.params (numbers and booleans coerced)
  // ---------------------------------------------------------------------------------------------

  function parseParams() {
    const out = {};
    let search;
    try { search = new URLSearchParams(window.location.search); } catch (err) { return out; }
    search.forEach((raw, key) => {
      let v = raw;
      if (raw === '' || raw === 'true') v = true;
      else if (raw === 'false') v = false;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) v = Number(raw);
      out[key] = v;
    });
    return out;
  }
  const params = parseParams();
  const DEBUG = !!params.debug;

  // ---------------------------------------------------------------------------------------------
  // Engine state
  // ---------------------------------------------------------------------------------------------

  const QUALITY_TIERS = {
    low: { shadows: false, shadowMapSize: 512, dpr: 1, maxPixels: 1.6e6 },
    medium: { shadows: true, shadowMapSize: 1024, dpr: 1.5, maxPixels: 2.6e6 },
    high: { shadows: true, shadowMapSize: 2048, dpr: 2, maxPixels: 4.6e6 },
  };
  const QUALITY_ORDER = ['low', 'medium', 'high'];
  const AUTO_TARGET_FPS = 42;
  const AUTO_WARMUP = 1.2;       // seconds ignored after a scene/quality change (shader compiles)
  const AUTO_WINDOW = 3.0;       // seconds of rendering measured per decision
  const AUTO_MIN_DRAWCALLS = 8;  // a scene this busy counts as "non-trivial"
  const AUTO_MAX_STEPS = 2;
  const MAX_GAME_DT = 1 / 20;
  const MAX_REAL_DT = 0.1;

  const events = U.emitter();
  const size = { w: window.innerWidth || 1, h: window.innerHeight || 1, aspect: 1, dpr: 1 };
  size.aspect = size.w / size.h;

  let initialized = false;
  let canvas = null;
  let renderer = null;
  let canvasRect = { left: 0, top: 0 };
  let contextLost = false;

  let quality = 'medium';
  let qualitySetting = 'auto';
  let shadowEpoch = 0;
  const auto = { active: false, steps: 0, phase: 'warmup', elapsed: 0, frames: 0 };

  let paused = false;
  let hidden = false;
  let autoPaused = false;
  let audioRunning = true;
  let gameTime = 0;
  let realTime = 0;
  let userTimeScale = 1;
  let slowFactor = 1;
  let slow = null;
  let fps = 60;
  let lastNow = 0;
  let rafId = 0;
  let needsResize = true;

  let updates = [];
  let realtimeUpdates = [];
  let updateOrder = 0;
  let timers = [];

  const shakeState = { amp: 0, dur: 0, t: 0, phase: [0, 0, 0] };

  const defaultScene = new THREE.Scene();
  defaultScene.background = new THREE.Color(0xCDEBFF);
  const defaultCamera = new THREE.PerspectiveCamera(50, size.aspect, 0.1, 1000);

  // ---------------------------------------------------------------------------------------------
  // Quality
  // ---------------------------------------------------------------------------------------------

  function isPhone() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const mobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    return coarse || mobileUA;
  }

  function restartAutoMeasure() {
    auto.phase = 'warmup';
    auto.elapsed = 0;
    auto.frames = 0;
  }

  function applyQuality(q) {
    const changed = q !== quality;
    quality = q;
    SS.engine.quality = q;
    SS.engine.tier = QUALITY_TIERS[q];
    if (!renderer) return;
    if (renderer.shadowMap.enabled !== QUALITY_TIERS[q].shadows) {
      renderer.shadowMap.enabled = QUALITY_TIERS[q].shadows;
      shadowEpoch += 1;
    }
    needsResize = true;
    applyResize();
    if (changed) events.emit('quality', q);
  }

  /** q: 'auto' | 'low' | 'medium' | 'high'. 'auto' starts at a device-based tier and steps down if slow. */
  function setQuality(q) {
    if (q === 'auto') {
      qualitySetting = 'auto';
      auto.active = true;
      auto.steps = 0;
      restartAutoMeasure();
      applyQuality(isPhone() ? 'medium' : 'high');
      return;
    }
    if (!QUALITY_TIERS[q]) return;
    qualitySetting = q;
    auto.active = false;
    applyQuality(q);
  }

  function measureAutoQuality(rdt) {
    if (!auto.active || hidden || contextLost) return;
    if (renderer.info.render.calls < AUTO_MIN_DRAWCALLS) { restartAutoMeasure(); return; }
    auto.elapsed += Math.min(rdt, 0.5);
    if (auto.phase === 'warmup') {
      if (auto.elapsed >= AUTO_WARMUP) { auto.phase = 'measure'; auto.elapsed = 0; auto.frames = 0; }
      return;
    }
    auto.frames += 1;
    if (auto.elapsed < AUTO_WINDOW) return;
    const measured = auto.frames / auto.elapsed;
    const idx = QUALITY_ORDER.indexOf(quality);
    if (measured < AUTO_TARGET_FPS && idx > 0 && auto.steps < AUTO_MAX_STEPS) {
      auto.steps += 1;
      debugLog('auto quality: ' + measured.toFixed(1) + ' fps → ' + QUALITY_ORDER[idx - 1]);
      applyQuality(QUALITY_ORDER[idx - 1]);
      if (auto.steps >= AUTO_MAX_STEPS || idx - 1 === 0) auto.active = false;
      else restartAutoMeasure();
    } else {
      debugLog('auto quality settled: ' + quality + ' @ ' + measured.toFixed(1) + ' fps');
      auto.active = false;
    }
  }

  /** Recompiles a scene's materials once after the shadow setting changed (three does not detect it). */
  function syncSceneShadows(scene) {
    if (scene.userData.ssShadowEpoch === shadowEpoch) return;
    scene.userData.ssShadowEpoch = shadowEpoch;
    scene.traverse(o => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) { for (const x of m) x.needsUpdate = true; } else m.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Resize (ResizeObserver + visualViewport + window events, applied at the start of a frame)
  // ---------------------------------------------------------------------------------------------

  function requestResize() { needsResize = true; }

  function targetDpr(w, h) {
    const tier = QUALITY_TIERS[quality];
    const device = window.devicePixelRatio || 1;
    let dpr = Math.min(device, tier.dpr);
    const budget = Math.sqrt(tier.maxPixels / Math.max(1, w * h));
    if (dpr > 1) dpr = Math.max(1, Math.min(dpr, budget));
    return Math.round(dpr * 100) / 100;
  }

  function applyResize() {
    if (!needsResize || !canvas) return;
    needsResize = false;
    const r = canvas.getBoundingClientRect();
    canvasRect = { left: r.left, top: r.top };
    const w = Math.max(1, Math.round(r.width || window.innerWidth));
    const h = Math.max(1, Math.round(r.height || window.innerHeight));
    const dpr = targetDpr(w, h);
    const bufferOk = canvas.width === Math.floor(w * dpr) && canvas.height === Math.floor(h * dpr);
    if (bufferOk && w === size.w && h === size.h && dpr === size.dpr) return;
    size.w = w; size.h = h; size.aspect = w / h; size.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    syncCameraAspect(SS.engine.camera);
    events.emit('resize', size);
  }

  function watchResize() {
    if (window.ResizeObserver) new ResizeObserver(requestResize).observe(canvas);
    window.addEventListener('resize', requestResize);
    window.addEventListener('orientationchange', () => { requestResize(); setTimeout(requestResize, 350); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', requestResize);
  }

  // ---------------------------------------------------------------------------------------------
  // Camera helpers: fit, auto-refit, shake, project
  // ---------------------------------------------------------------------------------------------

  const DEG = Math.PI / 180;

  /** Sets fov/aspect so the vertical FOV is vFov unless that would make the horizontal FOV < minHFov. */
  function fitCamera(camera, opts) {
    if (!camera) return;
    const fit = Object.assign({ vFov: 50, minHFov: 60 }, camera.userData.fit || {}, opts || {});
    if (opts && camera.userData.fit) camera.userData.fit = { vFov: fit.vFov, minHFov: fit.minHFov };
    if (!camera.isPerspectiveCamera) return;
    const aspect = size.aspect;
    let v = fit.vFov * DEG;
    const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
    if (h < fit.minHFov * DEG) v = 2 * Math.atan(Math.tan(fit.minHFov * DEG / 2) / aspect);
    camera.aspect = aspect;
    camera.fov = v / DEG;
    camera.updateProjectionMatrix();
    camera.userData.ssFitKey = aspect + '|' + fit.vFov + '|' + fit.minHFov;
  }

  /** Keeps a camera matched to the viewport: refits cameras with userData.fit, else fixes aspect. */
  function syncCameraAspect(camera) {
    if (!camera || !camera.isPerspectiveCamera) return;
    const fit = camera.userData.fit;
    if (fit) {
      if (camera.userData.ssFitKey !== size.aspect + '|' + fit.vFov + '|' + fit.minHFov) fitCamera(camera);
    } else if (camera.aspect !== size.aspect) {
      camera.aspect = size.aspect;
      camera.updateProjectionMatrix();
    }
  }

  function shake(amount = 0.12, duration = 0.35) {
    const s = shakeState;
    const remaining = s.dur > 0 ? s.amp * Math.pow(Math.max(0, 1 - s.t / s.dur), 2) : 0;
    if (amount < remaining) return;
    s.amp = amount;
    s.dur = Math.max(0.05, duration);
    s.t = 0;
    s.phase = [Math.random() * 100, Math.random() * 100, Math.random() * 100];
  }

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const _shakeOffset = new THREE.Vector3();
  const _shakeRoll = new THREE.Quaternion();
  const _savedPos = new THREE.Vector3();
  const _savedQuat = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);

  function currentShake() {
    const s = shakeState;
    if (s.dur <= 0 || s.t >= s.dur || paused) return 0;
    const k = 1 - s.t / s.dur;
    return s.amp * k * k * (reducedMotion ? 0.35 : 1);
  }

  function renderFrame() {
    const scene = SS.engine.scene, camera = SS.engine.camera;
    if (!renderer || contextLost || !scene || !camera) return;
    syncCameraAspect(camera);
    syncSceneShadows(scene);
    const a = currentShake();
    if (a > 0) {
      const s = shakeState, t = s.t;
      _savedPos.copy(camera.position);
      _savedQuat.copy(camera.quaternion);
      _shakeOffset.set(
        a * (Math.sin(t * 47 + s.phase[0]) * 0.7 + Math.sin(t * 89 + s.phase[1]) * 0.3),
        a * 0.8 * (Math.sin(t * 53 + s.phase[1]) * 0.7 + Math.sin(t * 97 + s.phase[2]) * 0.3),
        0).applyQuaternion(camera.quaternion);
      camera.position.add(_shakeOffset);
      camera.quaternion.multiply(_shakeRoll.setFromAxisAngle(_zAxis, a * 0.12 * Math.sin(t * 41 + s.phase[2])));
      renderer.render(scene, camera);
      camera.position.copy(_savedPos);
      camera.quaternion.copy(_savedQuat);
    } else {
      renderer.render(scene, camera);
    }
  }

  const _projView = new THREE.Vector3();
  const _projNdc = new THREE.Vector3();

  /** World → css px. Extension fields: behind (point is behind the camera), z (NDC depth). */
  function project(vec3, camera) {
    camera = camera || SS.engine.camera;
    camera.updateWorldMatrix(true, false);
    _projView.copy(vec3).applyMatrix4(camera.matrixWorldInverse);
    const behind = camera.isPerspectiveCamera ? _projView.z >= 0 : false;
    _projNdc.copy(_projView).applyMatrix4(camera.projectionMatrix);
    return {
      x: (_projNdc.x + 1) / 2 * size.w,
      y: (1 - _projNdc.y) / 2 * size.h,
      visible: !behind && Math.abs(_projNdc.x) <= 1 && Math.abs(_projNdc.y) <= 1 && _projNdc.z <= 1,
      behind,
      z: _projNdc.z,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------------------------

  function disposeObject(obj) {
    if (!obj) return;
    const done = new Set();
    const isShared = x => !!(x.userData && x.userData.shared === true);

    function disposeTexture(t) {
      if (!t || !t.isTexture || done.has(t)) return;
      done.add(t);
      if (!isShared(t)) t.dispose();
    }
    function disposeMaterial(m) {
      if (!m || done.has(m)) return;
      done.add(m);
      if (isShared(m)) return;
      for (const key of Object.keys(m)) { const v = m[key]; if (v && v.isTexture) disposeTexture(v); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) disposeTexture(u.value);
      m.dispose();
    }

    obj.traverse(o => {
      const g = o.geometry;
      if (g && !o.isSprite && !done.has(g)) { done.add(g); if (!isShared(g)) g.dispose(); }
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(disposeMaterial); else disposeMaterial(o.material);
      }
      if ((o.isInstancedMesh || o.isLight) && typeof o.dispose === 'function') o.dispose();
    });
    if (obj.isScene) {
      if (obj.background && obj.background.isTexture) disposeTexture(obj.background);
      if (obj.environment) disposeTexture(obj.environment);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Time: updates, timers, slow-mo, pause
  // ---------------------------------------------------------------------------------------------

  /** fn(dt, time) each unpaused frame. Lower priority values run first (camera follow: use e.g. 100). */
  function addUpdate(fn, priority = 0) {
    const entry = { fn, priority: Number(priority) || 0, order: updateOrder++, removed: false };
    updates = updates.concat(entry).sort((a, b) => a.priority - b.priority || a.order - b.order);
    return () => {
      if (entry.removed) return;
      entry.removed = true;
      updates = updates.filter(e => e !== entry);
    };
  }

  /** fn(rdt, realTime) every frame, also while paused. */
  function addRealtimeUpdate(fn) {
    const entry = { fn, removed: false };
    realtimeUpdates = realtimeUpdates.concat(entry);
    return () => {
      if (entry.removed) return;
      entry.removed = true;
      realtimeUpdates = realtimeUpdates.filter(e => e !== entry);
    };
  }

  /** Game-time timer: pauses with the game and follows time scale. Returns cancel(). */
  function after(seconds, fn) {
    const timer = { due: gameTime + Math.max(0, Number(seconds) || 0), fn, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  }

  function runTimers() {
    if (!timers.length) return;
    const due = [];
    timers = timers.filter(tm => {
      if (tm.cancelled) return false;
      if (tm.due <= gameTime) { due.push(tm); return false; }
      return true;
    });
    due.sort((a, b) => a.due - b.due);
    for (const tm of due) {
      if (tm.cancelled) continue;
      try { tm.fn(); } catch (err) { console.error('[SS] engine.after callback failed:', err); }
    }
  }

  /** Temporary slow motion: drops to `scale` and eases back to 1 over realSeconds (real time, not while paused). */
  function slowmo(scale, realSeconds, opts = {}) {
    if (slow) slow.resolve();
    const from = U.clamp(Number(scale), 0.02, 4);
    const dur = Math.max(0, Number(realSeconds) || 0);
    return new Promise(resolve => {
      if (dur === 0 || from === 1) { slow = null; slowFactor = 1; resolve(); return; }
      slow = { from, dur, t: 0, ease: typeof opts.ease === 'function' ? opts.ease : (U.ease[opts.ease] || U.ease.inQuad), resolve };
      slowFactor = from;
    });
  }

  function advanceSlowmo(rdt) {
    if (!slow) return;
    slow.t += rdt;
    const k = Math.min(1, slow.t / slow.dur);
    slowFactor = U.lerp(slow.from, 1, slow.ease(k));
    if (k >= 1) { slowFactor = 1; const s = slow; slow = null; s.resolve(); }
  }

  function syncAudio() {
    const want = !paused && !hidden;
    if (want === audioRunning) return;
    audioRunning = want;
    callModule('audio', want ? 'resumeAll' : 'suspend');
  }

  function pause() {
    if (paused) { autoPaused = false; return; }   // an explicit pause claims an automatic one
    paused = true;
    cancelPress();
    syncAudio();
    events.emit('pause');
  }

  function resume() {
    autoPaused = false;
    if (!paused) return;
    paused = false;
    lastNow = 0;
    syncAudio();
    events.emit('resume');
  }

  // ---------------------------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------------------------

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const rawDt = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    const rdt = U.clamp(rawDt, 0, MAX_REAL_DT);
    if (rawDt > 0) fps += (1 / rawDt - fps) * (1 - Math.exp(-rawDt * 3));
    SS.engine.fps = fps;
    realTime += rdt;

    applyResize();

    let dt = 0;
    if (!paused) {
      advanceSlowmo(rdt);
      dt = Math.min(rdt, MAX_GAME_DT) * userTimeScale * slowFactor;
      gameTime += dt;
      runTimers();
      for (const e of updates) if (!e.removed) safeRun(e, dt, gameTime);
      if (shakeState.dur > 0) {
        shakeState.t += rdt;
        if (shakeState.t >= shakeState.dur) shakeState.dur = 0;
      }
    }
    SS.engine.time = gameTime;
    SS.engine.realTime = realTime;

    try { U.tick(dt, rdt); } catch (err) { console.error('[SS] tween tick failed:', err); }
    callModule('world', 'update', dt);
    for (const e of realtimeUpdates) if (!e.removed) safeRun(e, rdt, realTime);

    renderFrame();
    if (renderer && !contextLost) measureAutoQuality(rdt);
    updateDebugOverlay(rdt);
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle: tab hidden / blur → auto-pause + 'hidden'; WebGL context loss
  // ---------------------------------------------------------------------------------------------

  function onHide() {
    if (hidden) return;
    hidden = true;
    if (!paused) { pause(); autoPaused = true; }
    syncAudio();
    events.emit('hidden');
  }

  function onShow() {
    if (!hidden || document.hidden) return;
    hidden = false;
    lastNow = 0;
    events.emit('visible');
    if (autoPaused) resume(); else syncAudio();
  }

  function watchLifecycle() {
    document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('blur', onHide);
    window.addEventListener('focus', onShow);
  }

  let noticeEl = null;

  function showNotice(title, text, withReload) {
    if (!document.getElementById('ss-engine-notice-style')) {
      const st = document.createElement('style');
      st.id = 'ss-engine-notice-style';
      st.textContent =
        '#ss-engine-notice{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;' +
        'padding:24px;background:linear-gradient(#3E9BF0,#CDEBFF);font-family:Fredoka,Nunito,system-ui,sans-serif;color:#24324a;}' +
        '#ss-engine-notice .card{max-width:340px;width:100%;background:#fff;border-radius:24px;padding:28px 24px;text-align:center;' +
        'box-shadow:0 12px 40px rgba(20,60,120,.25);}' +
        '#ss-engine-notice h2{margin:0 0 8px;font-size:26px;font-weight:700;}' +
        '#ss-engine-notice p{margin:0 0 20px;font:700 16px/1.4 Nunito,system-ui,sans-serif;color:#5a6a85;}' +
        '#ss-engine-notice button{min-height:52px;padding:0 32px;border:0;border-radius:26px;background:#1FA2FF;color:#fff;' +
        'font:700 20px Fredoka,system-ui,sans-serif;box-shadow:0 5px 0 #0b7fd1;cursor:pointer;}';
      document.head.appendChild(st);
    }
    hideNotice();
    noticeEl = document.createElement('div');
    noticeEl.id = 'ss-engine-notice';
    noticeEl.className = 'ss-block';
    noticeEl.setAttribute('role', 'alertdialog');
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    card.append(h, p);
    if (withReload) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Reload';
      b.addEventListener('click', () => window.location.reload());
      card.appendChild(b);
    }
    noticeEl.appendChild(card);
    document.body.appendChild(noticeEl);
  }

  function hideNotice() {
    if (noticeEl) { noticeEl.remove(); noticeEl = null; }
  }

  function watchContext() {
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      contextLost = true;
      if (!paused) { pause(); autoPaused = true; }
      events.emit('contextlost');
      showNotice('Taking a breather…', 'The graphics hiccuped. Hang tight, or reload to jump back in.', true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      shadowEpoch += 1;
      hideNotice();
      events.emit('contextrestored');
      if (autoPaused && !hidden) resume();
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Init & view
  // ---------------------------------------------------------------------------------------------

  function setView(scene, camera) {
    if (scene) SS.engine.scene = scene;
    if (camera) SS.engine.camera = camera;
    syncCameraAspect(SS.engine.camera);
    if (auto.active) restartAutoMeasure();
  }

  /** Creates the renderer and starts the loop. Returns false (and shows a friendly message) without WebGL. */
  function init(canvasEl) {
    if (initialized) return true;
    canvas = canvasEl || document.getElementById('ss-canvas');
    if (!canvas) { console.error('[SS] engine.init: no canvas'); return false; }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance',
      });
    } catch (err) {
      showNotice('No 3D here', 'Sunny Sports needs WebGL. Try a newer browser or turn on hardware acceleration.', false);
      return false;
    }
    initialized = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xCDEBFF, 1);
    SS.engine.renderer = renderer;

    const saved = SS.save && SS.save.settings ? SS.save.settings.quality : 'auto';
    const requested = QUALITY_TIERS[params.quality] ? params.quality : saved;
    setQuality(QUALITY_TIERS[requested] || requested === 'auto' ? requested : 'auto');
    if (SS.save && SS.save.events) {
      SS.save.events.on('setting', (key, value) => { if (key === 'quality') setQuality(value); });
    }

    needsResize = true;
    applyResize();
    watchResize();
    watchLifecycle();
    watchContext();
    if (DEBUG) createDebugOverlay();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // SS.engine
  // ---------------------------------------------------------------------------------------------

  SS.engine = {
    init,
    renderer: null,
    scene: defaultScene,
    camera: defaultCamera,
    setView,
    quality,
    tier: QUALITY_TIERS[quality],
    setQuality,
    onQuality: fn => events.on('quality', fn),
    time: 0,
    realTime: 0,
    slowmo,
    pause, resume,
    addUpdate, addRealtimeUpdate, after,
    shake,
    size,
    onResize: fn => events.on('resize', fn),
    fitCamera,
    project,
    disposeObject,
    fps: 60,
    events,
    QUALITY_TIERS,
  };
  Object.defineProperties(SS.engine, {
    timeScale: {
      get: () => userTimeScale * slowFactor,
      set: v => { userTimeScale = U.clamp(Number(v) || 0, 0, 10); },
      enumerable: true,
    },
    paused: { get: () => paused, enumerable: true },
    hidden: { get: () => hidden, enumerable: true },
    qualitySetting: { get: () => qualitySetting, enumerable: true },
  });

  // ---------------------------------------------------------------------------------------------
  // Input: unified pointer + keyboard
  // ---------------------------------------------------------------------------------------------

  const TAP_MAX_MS = 250;
  const MOVE_THRESHOLD = 12;
  const RELEASE_WINDOW_MS = 90;
  const PEAK_WINDOW_MS = 40;
  const RELEASE_GAP_MS = 50;

  const inputEvents = U.emitter();
  let inputEnabled = true;
  let press = null;
  let audioUnlocked = false;

  function shortSide() { return Math.max(1, Math.min(size.w, size.h)); }

  function unlockAudio() {
    if (audioUnlocked) return;
    callModule('audio', 'unlock');
    const ctx = SS.audio && SS.audio.ctx;
    if (ctx && ctx.state === 'running') audioUnlocked = true;
  }

  function isTextTarget(t) {
    return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  }

  /** True when a pointer that starts on `t` belongs to the DOM UI rather than the game. */
  function isBlockedTarget(t) {
    if (!(t instanceof Element)) return false;
    if (t.closest('button, input, select, textarea, a[href], label, [contenteditable="true"], [contenteditable=""], .ss-block')) return true;
    for (const id of ['ss-screens', 'ss-overlay']) {
      const layer = document.getElementById(id);
      if (layer && layer !== t && layer.contains(t)) return true;
    }
    return false;
  }

  function pointerPayload(x, y, t) {
    const dx = x - press.sx, dy = y - press.sy, s = shortSide();
    return {
      id: press.id, pointerType: press.pointerType,
      x, y, nx: (x / size.w) * 2 - 1, ny: 1 - (y / size.h) * 2, t,
      sx: press.sx, sy: press.sy, dx, dy, ndx: dx / s, ndy: dy / s,
      duration: (t - press.st) / 1000,
    };
  }

  function addSample(x, y, t) {
    const path = press.path;
    const last = path[path.length - 1];
    if (last && t < last.t) t = last.t;
    if (last && last.x === x && last.y === y && last.t === t) return;
    path.push({ x, y, t });
    press.maxDist = Math.max(press.maxDist, Math.hypot(x - press.sx, y - press.sy));
  }

  function localXY(e) { return [e.clientX - canvasRect.left, e.clientY - canvasRect.top]; }
  function eventTime(e) { return e && e.timeStamp > 0 ? e.timeStamp : performance.now(); }

  function buildSwipe(startP, endP) {
    const path = press.path, s = shortSide();
    const end = path[path.length - 1];
    const dx = end.x - press.sx, dy = end.y - press.sy;
    const dist = Math.hypot(dx, dy);

    // Release velocity over the last ~90 ms of travel. A lift-off shortly after the last movement
    // keeps the motion's velocity; a pause before lifting (hold still, then release) reads as slow.
    let last = 0;
    for (let i = 1; i < path.length; i++) if (path[i].x !== path[i - 1].x || path[i].y !== path[i - 1].y) last = i;
    const head = end.t - path[last].t <= RELEASE_GAP_MS ? path[last] : end;
    let ref = path[0];
    for (let i = last; i >= 0; i--) {
      ref = path[i];
      if (head.t - path[i].t >= RELEASE_WINDOW_MS) break;
    }
    const span = (head.t - ref.t) / 1000;
    const vx = span > 0.001 ? (head.x - ref.x) / span : 0;
    const vy = span > 0.001 ? (head.y - ref.y) / span : 0;
    const speed = Math.hypot(vx, vy);

    // Peak speed: fastest travel over any window of at least PEAK_WINDOW_MS (smooths sample jitter).
    let peak = speed;
    for (let i = 1, j = 0; i < path.length; i++) {
      while (j + 1 < i && path[i].t - path[j + 1].t >= PEAK_WINDOW_MS) j++;
      const dt = path[i].t - path[j].t;
      if (dt >= PEAK_WINDOW_MS) peak = Math.max(peak, Math.hypot(path[i].x - path[j].x, path[i].y - path[j].y) / (dt / 1000));
    }

    // path length, signed lateral deviation (+ = right of travel, screen y down), straightness
    let length = 0, lateral = 0;
    const ux = dist > 0 ? dx / dist : 0, uy = dist > 0 ? dy / dist : 0;
    const rx = -uy, ry = ux;   // right-hand normal of the travel direction in screen space
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (i > 0) length += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y);
      const dev = (p.x - press.sx) * rx + (p.y - press.sy) * ry;
      if (Math.abs(dev) > Math.abs(lateral)) lateral = dev;
    }

    return {
      start: startP, end: endP, dx, dy, dist,
      duration: (end.t - press.st) / 1000,
      vx, vy, speed,
      nvx: vx / s, nvy: vy / s, nspeed: speed / s,
      peakSpeed: peak, npeakSpeed: peak / s,
      angle: Math.atan2(-dy, dx),
      lateral: lateral / s,
      straightness: length > 0 ? U.clamp(dist / length, 0, 1) : 1,
      path: path.slice(),
    };
  }

  function onPointerDown(e) {
    if (!inputEnabled || paused || press || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isBlockedTarget(e.target)) return;
    const [x, y] = localXY(e);
    const t = eventTime(e);
    press = {
      id: e.pointerId, pointerType: e.pointerType || 'mouse', sx: x, sy: y, st: t,
      path: [], maxDist: 0, startP: null, captureEl: null,
    };
    addSample(x, y, t);
    if (e.target instanceof Element && e.target.setPointerCapture) {
      try { e.target.setPointerCapture(e.pointerId); press.captureEl = e.target; } catch (err) { press.captureEl = null; }
    }
    if (e.cancelable) e.preventDefault();
    const p = pointerPayload(x, y, t);
    press.startP = p;
    SS.input.pointer = p;
    SS.input.isDown = true;
    inputEvents.emit('down', p);
  }

  function onPointerMove(e) {
    if (!press || e.pointerId !== press.id) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const samples = list && list.length ? list : [e];
    for (const c of samples) { const [x, y] = localXY(c); addSample(x, y, eventTime(c)); }
    const last = press.path[press.path.length - 1];
    const p = pointerPayload(last.x, last.y, last.t);
    SS.input.pointer = p;
    inputEvents.emit('move', p);
  }

  function endPress() {
    const pr = press;
    press = null;
    SS.input.isDown = false;
    SS.input.pointer = null;
    if (pr.captureEl && pr.captureEl.hasPointerCapture && pr.captureEl.hasPointerCapture(pr.id)) {
      try { pr.captureEl.releasePointerCapture(pr.id); } catch (err) { /* already released */ }
    }
    return pr;
  }

  function onPointerUp(e) {
    if (!press || e.pointerId !== press.id) return;
    const [x, y] = localXY(e);
    addSample(x, y, eventTime(e));
    const last = press.path[press.path.length - 1];
    const p = pointerPayload(last.x, last.y, last.t);
    const swipe = press.maxDist >= MOVE_THRESHOLD ? buildSwipe(press.startP, p) : null;
    const isTap = !swipe && p.duration * 1000 <= TAP_MAX_MS;
    endPress();
    inputEvents.emit('up', p);
    if (swipe) inputEvents.emit('swipe', swipe);
    else if (isTap) inputEvents.emit('tap', p);
  }

  /** Ends the current press without tap/swipe; listeners get 'up' with cancelled: true. */
  function cancelPress() {
    if (!press) return;
    const last = press.path[press.path.length - 1];
    const p = pointerPayload(last.x, last.y, last.t);
    p.cancelled = true;
    endPress();
    inputEvents.emit('up', p);
  }

  function onPointerCancel(e) {
    if (press && e.pointerId === press.id) cancelPress();
  }

  function onKey(e, down) {
    if (isTextTarget(e.target)) return;
    if ((!inputEnabled || paused) && e.key !== 'Escape') return;
    if (e.key === ' ' || e.key.indexOf('Arrow') === 0) {
      if (!(e.target instanceof Element && e.target.closest('button, a[href]')) && e.cancelable) e.preventDefault();
    }
    inputEvents.emit('key', { key: e.key, code: e.code, down, repeat: !!e.repeat });
  }

  /** Blocks browser gestures that fight a game: pinch/double-tap zoom, callouts, selection. */
  function preventBrowserGestures() {
    const notText = e => !isTextTarget(e.target);
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('gesturechange', e => e.preventDefault());
    document.addEventListener('dblclick', e => { if (notText(e)) e.preventDefault(); });
    document.addEventListener('contextmenu', e => { if (notText(e)) e.preventDefault(); });
    document.addEventListener('selectstart', e => { if (notText(e)) e.preventDefault(); });
    document.addEventListener('touchmove', e => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });
  }

  function attachInput() {
    // Audio unlock listens in the capture phase so UI handlers that stop propagation still unlock.
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('pointerup', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', e => onKey(e, true));
    window.addEventListener('keyup', e => onKey(e, false));
    window.addEventListener('blur', cancelPress);
    preventBrowserGestures();
  }

  SS.input = {
    on: (evt, fn) => inputEvents.on(evt, fn),
    /** A listener group; off() removes every listener added through it. */
    scope() {
      let offs = [];
      return {
        on(evt, fn) {
          const off = inputEvents.on(evt, fn);
          offs.push(off);
          return () => { off(); offs = offs.filter(o => o !== off); };
        },
        off() { for (const off of offs) off(); offs = []; },
      };
    },
    isDown: false,
    pointer: null,
    cancel: cancelPress,
  };
  Object.defineProperty(SS.input, 'enabled', {
    get: () => inputEnabled,
    set: v => { inputEnabled = !!v; if (!inputEnabled) cancelPress(); },
    enumerable: true,
  });
  attachInput();

  // ---------------------------------------------------------------------------------------------
  // Debug hooks & overlay (?debug=1)
  // ---------------------------------------------------------------------------------------------

  function debugLog(...args) { if (DEBUG) console.log('[SS]', ...args); }

  let debugEl = null;
  let debugAccum = 0;

  function createDebugOverlay() {
    debugEl = document.createElement('div');
    debugEl.id = 'ss-debug';
    debugEl.style.cssText =
      'position:fixed;right:calc(env(safe-area-inset-right) + 6px);bottom:calc(env(safe-area-inset-bottom) + 6px);' +
      'z-index:3000;pointer-events:none;padding:3px 8px;border-radius:10px;background:rgba(20,30,50,.62);color:#fff;' +
      'font:700 11px/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:pre;';
    document.body.appendChild(debugEl);
  }

  function updateDebugOverlay(rdt) {
    if (!debugEl) return;
    debugAccum += rdt;
    if (debugAccum < 0.25) return;
    debugAccum = 0;
    const info = renderer ? renderer.info.render : { calls: 0, triangles: 0 };
    debugEl.textContent = Math.round(fps) + ' fps · ' + quality + (auto.active ? '*' : '') +
      ' · ' + info.calls + ' dc · ' + (info.triangles / 1000).toFixed(1) + 'k tri' +
      (paused ? ' · paused' : '') + (SS.engine.timeScale !== 1 ? ' · x' + SS.engine.timeScale.toFixed(2) : '');
  }

  SS.debug = {
    params,
    sport: null,      // set by main.js: current sport instance
    ctx: null,        // set by main.js: current sport ctx
    screen: null,     // set by main.js: current screen id
    state() {
      const ctx = SS.debug.ctx;
      const out = {
        screen: SS.debug.screen,
        sport: ctx && ctx.sport ? ctx.sport.id : null,
        mode: ctx ? ctx.mode : null,
        paused,
        fps: Math.round(fps),
        quality,
        time: Math.round(gameTime * 100) / 100,
        timeScale: SS.engine.timeScale,
      };
      const inst = SS.debug.sport;
      if (inst && typeof inst.debugState === 'function') {
        try { Object.assign(out, inst.debugState()); } catch (err) { out.debugStateError = String(err); }
      }
      return out;
    },
    timeScale(x) { SS.engine.timeScale = x; return SS.engine.timeScale; },
    log: debugLog,
  };
})();
