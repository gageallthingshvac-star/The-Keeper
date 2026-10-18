// Math helpers, seeded RNG and safe persistent storage. No DOM, no THREE.
const Util = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  // Heading convention: 0 = toward -y ("north"), positive = clockwise when viewed from above.
  const headingTo = (dx, dy) => Math.atan2(dx, -dy);
  const fwd = a => [Math.sin(a), -Math.cos(a)];
  const turnToward = (a, target, step) => a + clamp(wrapA(target - a), -step, step);
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  // mulberry32: small, fast, seedable. The sim takes an RNG so tests are reproducible.
  function rng(seed = (Math.random() * 2 ** 32) >>> 0) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (a, b) => a + next() * (b - a);
    next.gauss = () => (next() + next() + next() - 1.5) / 1.5;
    next.pick = arr => arr[(next() * arr.length) | 0];
    next.chance = p => next() < p;
    return next;
  }

  // localStorage can be missing or throw (private mode, sandboxed frames): never let that break the game.
  const PREFIX = 'irontide2_';
  const store = {
    get(k, d) {
      try { const v = globalThis.localStorage && localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set(k, v) { try { globalThis.localStorage && localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { globalThis.localStorage && localStorage.removeItem(PREFIX + k); } catch (e) {} },
  };

  const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const fmtNum = n => Math.round(n).toLocaleString('en-US');

  return { TAU, clamp, lerp, wrapA, headingTo, fwd, turnToward, dist, rng, store, fmtTime, fmtNum };
})();
