/* Sunny Sports — util.js
 * The SS namespace, math helpers, easing, seeded randomness, tweens, event emitters,
 * formatting and the sport registry. Loaded first after three.js; depends on nothing else.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  SS.THREE = window.THREE;
  SS.VERSION = '1.0.0';

  // ---------------------------------------------------------------------------------------------
  // Scalar math
  // ---------------------------------------------------------------------------------------------

  const TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }

  function remap(v, a0, a1, b0, b1, doClamp = true) {
    let t = invLerp(a0, a1, v);
    if (doClamp) t = clamp(t, 0, 1);
    return lerp(b0, b1, t);
  }

  /** Frame-rate independent exponential smoothing toward target. */
  function damp(current, target, lambda, dt) {
    return lerp(current, target, 1 - Math.exp(-lambda * dt));
  }

  /** In-place damp of a THREE.Vector3 (or any {x,y,z}) toward target. Returns vec. */
  function dampVec3(vec, target, lambda, dt) {
    const k = 1 - Math.exp(-lambda * dt);
    vec.x += (target.x - vec.x) * k;
    vec.y += (target.y - vec.y) * k;
    vec.z += (target.z - vec.z) * k;
    return vec;
  }

  function smoothstep(e0, e1, x) {
    const t = clamp(invLerp(e0, e1, x), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

  /** Wraps an angle into (-PI, PI]. */
  function wrapAngle(a) {
    a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a === -Math.PI ? Math.PI : a;
  }

  /** Shortest signed rotation that takes angle a to angle b, in (-PI, PI]. */
  function angleDiff(a, b) { return wrapAngle(b - a); }

  // ---------------------------------------------------------------------------------------------
  // Easing (t in 0..1)
  // ---------------------------------------------------------------------------------------------

  const ease = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => t * (2 - t),
    inOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    outCubic: t => { const u = t - 1; return u * u * u + 1; },
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; },
    outElastic: t => {
      if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
    },
    outBounce: t => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
      if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
      t -= 2.625 / d1;
      return n1 * t * t + 0.984375;
    },
  };

  /** Accepts an easing function or the name of one in `ease`; falls back to linear. */
  function resolveEase(e, fallback) {
    if (typeof e === 'function') return e;
    if (typeof e === 'string' && ease[e]) return ease[e];
    return fallback || ease.linear;
  }

  // ---------------------------------------------------------------------------------------------
  // Hashing, ids, seeded random
  // ---------------------------------------------------------------------------------------------

  /** FNV-1a 32-bit hash of a string → unsigned int. */
  function hash(str) {
    str = String(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  let uidCounter = 0;
  function uid() {
    uidCounter = (uidCounter + 1) % 1296;
    return Date.now().toString(36) + uidCounter.toString(36).padStart(2, '0') +
      Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  }

  /** Mulberry32 PRNG. Seed may be a number or a string; omitted → random seed. */
  function rng(seed) {
    if (seed === undefined || seed === null || seed === '') seed = Math.floor(Math.random() * 4294967296);
    else if (typeof seed !== 'number' || !isFinite(seed)) seed = hash(seed);
    seed = seed >>> 0;
    let state = seed;
    function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      seed,
      next,
      range: (a, b) => a + (b - a) * next(),
      int: (a, b) => Math.floor(a + (b - a + 1) * next()),
      pick: arr => (arr && arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
      chance: p => next() < p,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Event emitter (handler errors are reported but never break other handlers)
  // ---------------------------------------------------------------------------------------------

  function emitter() {
    let map = new Map();
    const api = {
      on(evt, fn) {
        if (typeof fn !== 'function') return () => {};
        if (!map.has(evt)) map.set(evt, []);
        map.get(evt).push(fn);
        return () => api.off(evt, fn);
      },
      once(evt, fn) {
        const off = api.on(evt, function onceWrapper(...args) { off(); fn(...args); });
        return off;
      },
      off(evt, fn) {
        const list = map.get(evt);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) map.delete(evt);
      },
      emit(evt, ...args) {
        const list = map.get(evt);
        if (!list) return;
        for (const fn of list.slice()) {
          try { fn(...args); } catch (err) { console.error('[SS] "' + evt + '" handler failed:', err); }
        }
      },
      clear() { map = new Map(); },
    };
    return api;
  }

  // ---------------------------------------------------------------------------------------------
  // Tweens. Advanced by tick(dt, rdt) from the engine loop: game-time tweens use dt (0 while
  // paused, scaled by slow-mo); realtime tweens use rdt. A newer tween on the same property
  // takes it over from an older one. Returned promises always resolve (on completion or cancel).
  // ---------------------------------------------------------------------------------------------

  const tweens = [];

  function resolvePath(target, path) {
    const parts = path.split('.');
    let obj = target;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj == null ? undefined : obj[parts[i]];
    }
    return obj == null ? null : { obj, key: parts[parts.length - 1] };
  }

  function startTween(tw) {
    tw.started = true;
    tw.channels = [];
    for (const path of Object.keys(tw.props)) {
      const ref = resolvePath(tw.target, path);
      const to = Number(tw.props[path]);
      if (!ref || typeof ref.obj[ref.key] !== 'number' || !isFinite(to)) continue;
      for (const other of tweens) {
        if (other === tw || !other.started || other.done || !other.channels.length) continue;
        other.channels = other.channels.filter(c => !(c.obj === ref.obj && c.key === ref.key));
        if (!other.channels.length) finishTween(other, false);
      }
      tw.channels.push({ obj: ref.obj, key: ref.key, from: ref.obj[ref.key], to });
    }
  }

  function applyTween(tw, k) {
    for (const c of tw.channels) c.obj[c.key] = c.from + (c.to - c.from) * k;
    if (tw.onUpdate) tw.onUpdate(k, tw.target);
  }

  function finishTween(tw, jumpToEnd) {
    if (tw.done) return;
    tw.done = true;
    if (jumpToEnd) {
      if (!tw.started) startTween(tw);
      for (const c of tw.channels) c.obj[c.key] = c.to;
    }
    tw.resolve();
  }

  function tween(target, props, duration, opts = {}) {
    let tw;
    const promise = new Promise(resolve => {
      tw = {
        target, props: props || {}, resolve,
        duration: Math.max(0, Number(duration) || 0),
        delay: Math.max(0, Number(opts.delay) || 0),
        ease: resolveEase(opts.ease, ease.outQuad),
        onUpdate: typeof opts.onUpdate === 'function' ? opts.onUpdate : null,
        realtime: !!opts.realtime,
        elapsed: 0, started: false, done: false, channels: [],
      };
    });
    /** Extension: stop early. complete=true jumps to the end values first. */
    promise.cancel = (complete = false) => finishTween(tw, complete);
    if (target == null) { finishTween(tw, false); return promise; }
    if (tw.duration === 0 && tw.delay === 0) {
      startTween(tw);
      try { applyTween(tw, 1); } catch (err) { console.error('[SS] tween onUpdate failed:', err); }
      finishTween(tw, false);
      return promise;
    }
    tweens.push(tw);
    return promise;
  }

  /** Extension: cancel every tween animating `target` (promises resolve, values stay where they are). */
  function killTweens(target) {
    for (const tw of tweens) if (tw.target === target) finishTween(tw, false);
  }

  function tick(dt, rdt) {
    for (let i = 0; i < tweens.length; i++) {
      const tw = tweens[i];
      if (tw.done) continue;
      const step = tw.realtime ? rdt : dt;
      if (!(step > 0)) continue;
      try {
        if (tw.delay > 0) {
          tw.delay -= step;
          if (tw.delay > 0) continue;
          tw.elapsed = -tw.delay;
          tw.delay = 0;
        } else {
          tw.elapsed += step;
        }
        if (!tw.started) startTween(tw);
        const t = tw.duration > 0 ? Math.min(1, tw.elapsed / tw.duration) : 1;
        applyTween(tw, t >= 1 ? 1 : tw.ease(t));
        if (t >= 1) finishTween(tw, false);
      } catch (err) {
        console.error('[SS] tween failed:', err);
        finishTween(tw, false);
      }
    }
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].done) tweens.splice(i, 1);
  }

  // ---------------------------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------------------------

  const fmt = {
    /** 1234.4 → "1,234" */
    int(n) {
      const v = Math.round(Number(n) || 0);
      const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return v < 0 ? '-' + s : s;
    },
    /** 123.4 → "123 m"; below 10 m one decimal is kept ("3.4 m"). */
    meters(m) {
      const v = Number(m) || 0;
      return (Math.abs(v) < 10 ? (Math.round(v * 10) / 10).toFixed(1) : fmt.int(v)) + ' m';
    },
    /** 65 → "1:05"; an hour or more → "1:01:05". */
    time(s) {
      const total = Math.max(0, Math.floor(Number(s) || 0));
      const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
      const ss = String(sec).padStart(2, '0');
      return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  SS.util = {
    clamp, lerp, invLerp, remap, damp, dampVec3, smoothstep, sign, wrapAngle, angleDiff,
    ease, rng, tween, killTweens, emitter, uid, fmt, hash, tick,
  };

  // ---------------------------------------------------------------------------------------------
  // Sport registry (menu order = registration order = script order)
  // ---------------------------------------------------------------------------------------------

  SS.sports = SS.sports || {};
  SS.sportOrder = SS.sportOrder || [];

  SS.registerSport = function registerSport(def) {
    if (!def || typeof def.id !== 'string' || !def.id) {
      console.error('[SS] registerSport: a definition with a string id is required');
      return null;
    }
    SS.sports[def.id] = def;
    if (SS.sportOrder.indexOf(def.id) < 0) SS.sportOrder.push(def.id);
    return def;
  };
})();
