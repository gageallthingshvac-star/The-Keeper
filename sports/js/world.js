/* Sunny Sports — world.js
 * The shared look of every venue: sky dome, lights and shadows, rolling hills, clouds and trees,
 * canvas-generated textures, cached materials, bleachers with an instanced crowd, and pooled
 * effects (confetti, sparkles, fireworks, rings, ribbon trails, blob shadows, 3D labels).
 * Effects, crowds and environments are advanced by SS.world.update(dt), which the engine calls
 * every frame; calling a handle's own update(dt) switches that handle to manual updates.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const THREE = SS.THREE || window.THREE;

  const TAU = Math.PI * 2;
  const FONT_STACK = "'Fredoka', 'Nunito', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif";

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const outCubic = t => 1 - Math.pow(1 - t, 3);

  function makeRng(rng, seed) {
    return rng || SS.util.rng(seed === undefined ? 1 : seed);
  }

  function markShared(x) { x.userData.shared = true; return x; }

  /** Hex number or CSS string → [r, g, b] in 0..1 sRGB (for shaders that output sRGB directly). */
  function srgb(c) {
    const col = new THREE.Color(c);
    col.convertLinearToSRGB();
    return new THREE.Vector3(col.r, col.g, col.b);
  }

  function hexCss(c) { return '#' + new THREE.Color(c).getHexString(); }

  /** Mixes two CSS/hex colors in sRGB → CSS string. */
  function mixCss(a, b, t) {
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    return '#' + ca.lerp(cb, t).getHexString();
  }

  /** Fills a geometry's vertex colors with one color, or with fn(x, y, z, outColor). */
  function paint(geo, colorOrFn) {
    const pos = geo.attributes.position, n = pos.count;
    const arr = new Float32Array(n * 3);
    const c = new THREE.Color();
    if (typeof colorOrFn === 'function') {
      for (let i = 0; i < n; i++) {
        colorOrFn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
        arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
      }
    } else {
      c.set(colorOrFn);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  /** Vertical two-color gradient painter (colors given as hex; y0..y1 in geometry space). */
  function gradient(geo, bottom, top, y0, y1) {
    const cb = new THREE.Color(bottom), ct = new THREE.Color(top);
    return paint(geo, (x, y, z, out) => out.copy(cb).lerp(ct, clamp((y - y0) / (y1 - y0 || 1), 0, 1)));
  }

  /**
   * Merges geometries (indexed or not) into one indexed geometry keeping position, normal,
   * color (white when missing) and uv (only when every part has one). Inputs are disposed.
   */
  function mergeGeometries(list) {
    let vCount = 0, iCount = 0;
    const withUv = list.every(g => g.attributes.uv);
    for (const g of list) {
      vCount += g.attributes.position.count;
      iCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3), uv = withUv ? new Float32Array(vCount * 2) : null;
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    let vo = 0, io = 0;
    for (const g of list) {
      const n = g.attributes.position.count;
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
      nor.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
      if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), vo * 3);
      else col.fill(1, vo * 3, (vo + n) * 3);
      if (uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
      if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[io++] = a[k] + vo; }
      else for (let k = 0; k < n; k++) idx[io++] = vo + k;
      vo += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  /** Root scene (or top-most ancestor) of an object. */
  function rootOf(obj) {
    let o = obj;
    while (o.parent) o = o.parent;
    return o;
  }

  function currentCamera() { return SS.engine && SS.engine.camera ? SS.engine.camera : null; }

  function qualityTier() {
    const e = SS.engine;
    const q = e && e.quality ? e.quality : 'high';
    return e && e.QUALITY_TIERS && e.QUALITY_TIERS[q] ? e.QUALITY_TIERS[q]
      : { shadows: q !== 'low', shadowMapSize: q === 'high' ? 2048 : 1024 };
  }

  // ---------------------------------------------------------------------------------------------
  // Update registry: auto-updated handles (environments, crowds, fx systems, trails)
  // ---------------------------------------------------------------------------------------------

  const live = new Set();

  /** Registers a handle with a _tick(dt). Its public update(dt) switches it to manual mode. */
  function track(handle, tick) {
    handle._tick = tick;
    handle.update = function (dt) { handle._manual = true; tick(dt || 0); };
    live.add(handle);
    return handle;
  }

  function untrack(handle) { handle._dead = true; live.delete(handle); }

  /** Marks a handle dead as soon as the engine (or anyone) disposes the given geometry. */
  function dieWith(handle, geometry) {
    geometry.addEventListener('dispose', () => untrack(handle));
  }

  function update(dt) {
    if (!(dt > 0)) return;
    for (const h of live) {
      if (h._dead) { live.delete(h); continue; }
      if (h._manual) continue;
      try { h._tick(dt); } catch (err) {
        console.error('[SS] world update failed:', err);
        untrack(h);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Canvas texture painting
  // ---------------------------------------------------------------------------------------------

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h || w;
    return c;
  }

  function ihash(i, j, seed) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Tileable value noise: lattice of `period` cells over the unit square. */
  function vnoise(x, y, period, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const m = (v) => ((v % period) + period) % period;
    const a = ihash(m(xi), m(yi), seed), b = ihash(m(xi + 1), m(yi), seed);
    const c = ihash(m(xi), m(yi + 1), seed), d = ihash(m(xi + 1), m(yi + 1), seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function fbm(u, v, period, octaves, seed) {
    let sum = 0, amp = 0.5, norm = 0, p = period;
    for (let o = 0; o < octaves; o++) {
      sum += vnoise(u * p, v * p, p, seed + o * 17) * amp;
      norm += amp; amp *= 0.5; p *= 2;
    }
    return sum / norm;
  }

  /** Paints a tileable two-color fbm field over the whole canvas (generated at low res, scaled up). */
  function noiseLayer(ctx, S, c0, c1, { period = 4, octaves = 4, seed = 1, res = 128, alpha = 1, contrast = 1.4 } = {}) {
    const small = makeCanvas(res);
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(res, res);
    const a = new THREE.Color(c0), b = new THREE.Color(c1);
    a.convertLinearToSRGB(); b.convertLinearToSRGB();
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        let n = fbm(x / res, y / res, period, octaves, seed);
        n = clamp((n - 0.5) * contrast + 0.5, 0, 1);
        const k = (y * res + x) * 4;
        img.data[k] = 255 * lerp(a.r, b.r, n);
        img.data[k + 1] = 255 * lerp(a.g, b.g, n);
        img.data[k + 2] = 255 * lerp(a.b, b.b, n);
        img.data[k + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    // Draw 3x3 so the bilinear upscale wraps seamlessly at the edges.
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) ctx.drawImage(small, ox * S, oy * S, S, S);
    ctx.restore();
  }

  /** Calls draw(dx, dy) for every wrap offset an element near the edge needs. */
  function wrapDraw(S, x, y, r, draw) {
    const xs = [0], ys = [0];
    if (x - r < 0) xs.push(S); if (x + r > S) xs.push(-S);
    if (y - r < 0) ys.push(S); if (y + r > S) ys.push(-S);
    for (const dx of xs) for (const dy of ys) draw(dx, dy);
  }

  function speckle(ctx, S, rng, count, colors, rMin, rMax, alpha) {
    ctx.save();
    for (let i = 0; i < count; i++) {
      const x = rng.next() * S, y = rng.next() * S, r = rng.range(rMin, rMax);
      ctx.globalAlpha = alpha * rng.range(0.5, 1);
      ctx.fillStyle = colors[i % colors.length];
      wrapDraw(S, x, y, r, (dx, dy) => { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, TAU); ctx.fill(); });
    }
    ctx.restore();
  }

  function blades(ctx, S, rng, count, colors, lenMin, lenMax, width, alpha, lean = 0.35) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    for (let i = 0; i < count; i++) {
      const x = rng.next() * S, y = rng.next() * S;
      const len = rng.range(lenMin, lenMax), ang = -Math.PI / 2 + rng.range(-lean, lean);
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      ctx.globalAlpha = alpha * rng.range(0.4, 1);
      ctx.strokeStyle = colors[i % colors.length];
      wrapDraw(S, x, y, len, (dx, dy) => {
        ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x2 + dx, y2 + dy); ctx.stroke();
      });
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Wood grain: wavy streaks running along Y inside the rect. */
  function grain(ctx, rng, x, y, w, h, color, count, alpha) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = color;
    for (let i = 0; i < count; i++) {
      const gx = x + rng.next() * w, amp = rng.range(0.5, 2.5), freq = rng.range(0.004, 0.02), ph = rng.next() * TAU;
      ctx.globalAlpha = alpha * rng.range(0.3, 1);
      ctx.lineWidth = rng.range(0.6, 1.8);
      ctx.beginPath();
      for (let yy = 0; yy <= h; yy += 8) {
        const px = gx + Math.sin(yy * freq * TAU + ph) * amp;
        if (yy === 0) ctx.moveTo(px, y + yy); else ctx.lineTo(px, y + yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  const PAINTERS = {
    grass(ctx, S, o, rng) {
      const base = o.color || '#5DB247';
      noiseLayer(ctx, S, mixCss(base, '#2F7A2A', 0.28), mixCss(base, '#B8F07A', 0.22), { period: 3, seed: 11 });
      blades(ctx, S, rng, 5200, [mixCss(base, '#D6FF9A', 0.35), mixCss(base, '#1F5E22', 0.35)], 3, 8, 1.4, 0.45);
      speckle(ctx, S, rng, 500, [mixCss(base, '#FFFFFF', 0.4)], 0.6, 1.3, 0.35);
    },
    grass_stripes(ctx, S, o, rng) {
      PAINTERS.grass(ctx, S, o, rng);
      ctx.save();
      const g1 = ctx.createLinearGradient(0, 0, S, 0);
      g1.addColorStop(0, 'rgba(255,255,230,0.10)'); g1.addColorStop(0.47, 'rgba(255,255,230,0.10)');
      g1.addColorStop(0.5, 'rgba(0,50,0,0.07)'); g1.addColorStop(0.97, 'rgba(0,50,0,0.07)');
      g1.addColorStop(1, 'rgba(255,255,230,0.10)');
      ctx.fillStyle = g1; ctx.fillRect(0, 0, S, S);
      ctx.restore();
    },
    fairway(ctx, S, o, rng) {
      const base = o.color || '#6CC24B';
      noiseLayer(ctx, S, mixCss(base, '#3E8A33', 0.2), mixCss(base, '#C4F58C', 0.18), { period: 3, seed: 21 });
      ctx.save();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,220,0.045)' : 'rgba(0,40,0,0.035)';
        ctx.fillRect(i * S / 4, 0, S / 4, S);
        ctx.fillStyle = i % 2 ? 'rgba(255,255,220,0.035)' : 'rgba(0,40,0,0.025)';
        ctx.fillRect(0, i * S / 4, S, S / 4);
      }
      ctx.restore();
      blades(ctx, S, rng, 3600, [mixCss(base, '#E2FFA8', 0.3), mixCss(base, '#2A6E25', 0.3)], 2, 5, 1.2, 0.35);
    },
    rough(ctx, S, o, rng) {
      const base = o.color || '#4C9638';
      noiseLayer(ctx, S, mixCss(base, '#1F5A1E', 0.4), mixCss(base, '#9FD86A', 0.25), { period: 4, seed: 31, contrast: 1.8 });
      blades(ctx, S, rng, 4200, [mixCss(base, '#C8F28A', 0.3), mixCss(base, '#173F15', 0.45), mixCss(base, '#7EC253', 0.3)], 6, 15, 1.8, 0.55, 0.5);
    },
    green(ctx, S, o, rng) {
      const base = o.color || '#7DD15A';
      noiseLayer(ctx, S, mixCss(base, '#4E9E3C', 0.2), mixCss(base, '#D8FFAA', 0.16), { period: 4, seed: 41 });
      ctx.save();
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,225,0.08)' : 'rgba(0,45,0,0.05)';
        ctx.fillRect(i * S / 8, 0, S / 8, S);
      }
      ctx.restore();
      speckle(ctx, S, rng, 7000, [mixCss(base, '#E8FFC0', 0.4), mixCss(base, '#2E6B26', 0.4)], 0.5, 0.9, 0.35);
    },
    sand(ctx, S, o, rng) {
      const base = o.color || '#EBD39A';
      noiseLayer(ctx, S, mixCss(base, '#C9A866', 0.3), mixCss(base, '#FFF4D6', 0.4), { period: 3, seed: 51 });
      ctx.save();
      ctx.strokeStyle = 'rgba(150,110,50,0.10)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const y0 = (i + 0.5) * S / 9, ph = rng.next() * TAU;
        ctx.beginPath();
        for (let x = 0; x <= S; x += 8) {
          const y = y0 + Math.sin(x / S * TAU * 2 + ph) * 6;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      speckle(ctx, S, rng, 9000, ['#A88650', '#FFF8E6', '#C7A469'], 0.5, 1.1, 0.5);
    },
    dirt(ctx, S, o, rng) {
      const base = o.color || '#C98A57';
      noiseLayer(ctx, S, mixCss(base, '#8E5A30', 0.35), mixCss(base, '#F0B987', 0.25), { period: 4, seed: 61, contrast: 1.6 });
      speckle(ctx, S, rng, 6000, [mixCss(base, '#6E4223', 0.5), mixCss(base, '#FFE0BC', 0.4)], 0.5, 1.2, 0.45);
      speckle(ctx, S, rng, 260, [mixCss(base, '#7A4B28', 0.45), mixCss(base, '#F6CFA4', 0.45)], 1.5, 3.5, 0.5);
    },
    clay(ctx, S, o, rng) {
      const base = o.color || '#D46A40';
      noiseLayer(ctx, S, mixCss(base, '#A84A27', 0.3), mixCss(base, '#F09A6E', 0.25), { period: 3, seed: 71 });
      ctx.save();
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,220,190,0.05)' : 'rgba(120,40,10,0.05)';
        ctx.fillRect(0, rng.next() * S, S, rng.range(2, 8));
      }
      ctx.restore();
      speckle(ctx, S, rng, 7000, [mixCss(base, '#FFE2CC', 0.4), mixCss(base, '#7A3215', 0.4)], 0.5, 1, 0.4);
    },
    hardcourt(ctx, S, o, rng) {
      const base = o.color || '#3C7CC8';
      noiseLayer(ctx, S, mixCss(base, '#1E4F8E', 0.12), mixCss(base, '#9CC8F2', 0.10), { period: 4, seed: 81 });
      speckle(ctx, S, rng, 12000, [mixCss(base, '#FFFFFF', 0.3), mixCss(base, '#0A2A55', 0.3)], 0.5, 0.8, 0.35);
    },
    wood_lane(ctx, S, o, rng) {
      const boards = o.boards || 16, bw = S / boards;
      const base = o.color || '#E6BE86';
      for (let i = 0; i < boards; i++) {
        const tone = rng.range(-0.08, 0.08);
        ctx.fillStyle = tone > 0 ? mixCss(base, '#FFE7C2', tone * 3) : mixCss(base, '#B07A43', -tone * 3);
        ctx.fillRect(i * bw, 0, bw, S);
        grain(ctx, rng, i * bw, 0, bw, S, mixCss(base, '#8A5426', 0.6), 7, 0.22);
        const lg = ctx.createLinearGradient(i * bw, 0, (i + 1) * bw, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0.10)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)');
        lg.addColorStop(1, 'rgba(90,50,20,0.10)');
        ctx.fillStyle = lg; ctx.fillRect(i * bw, 0, bw, S);
        ctx.fillStyle = 'rgba(95,55,25,0.45)';
        ctx.fillRect(i * bw, 0, 1.2, S);
      }
    },
    wood(ctx, S, o, rng) {
      const rows = 6, rh = S / rows;
      const base = o.color || '#C58A55';
      for (let r = 0; r < rows; r++) {
        let x = -rng.range(0, S * 0.6);
        while (x < S) {
          const len = rng.range(S * 0.45, S * 0.9);
          const tone = rng.range(-0.1, 0.1);
          ctx.fillStyle = tone > 0 ? mixCss(base, '#F2C796', tone * 3) : mixCss(base, '#7E4E26', -tone * 3);
          ctx.save();
          ctx.translate(0, r * rh);
          ctx.fillRect(x, 0, len, rh);
          ctx.rotate(-Math.PI / 2);
          grain(ctx, rng, -rh, x, rh, len, mixCss(base, '#5A3317', 0.6), 6, 0.25);
          ctx.restore();
          ctx.fillStyle = 'rgba(70,40,15,0.45)';
          ctx.fillRect(x, r * rh, 1.5, rh);
          if (x + len > S) { ctx.fillRect(x + len - S, r * rh, 1.5, rh); }
          x += len;
        }
        ctx.fillStyle = 'rgba(70,40,15,0.5)';
        ctx.fillRect(0, r * rh, S, 1.5);
      }
    },
    carpet(ctx, S, o, rng) {
      const base = o.color || '#2B3170';
      noiseLayer(ctx, S, mixCss(base, '#141844', 0.3), mixCss(base, '#4A55A8', 0.2), { period: 6, seed: 91 });
      const cols = o.colors || ['#22D3C5', '#FF6FAE', '#FFC93C', '#FF8A3D', '#8E7BFF'];
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < 46; i++) {
        const x = rng.next() * S, y = rng.next() * S, r = rng.range(8, 16), kind = i % 4;
        ctx.fillStyle = ctx.strokeStyle = cols[i % cols.length];
        ctx.lineWidth = 4;
        const rot = rng.next() * TAU;
        wrapDraw(S, x, y, r * 2.4, (dx, dy) => {
          ctx.save();
          ctx.translate(x + dx, y + dy); ctx.rotate(rot);
          ctx.beginPath();
          if (kind === 0) { ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.lineWidth = 4.5; ctx.stroke(); }
          else if (kind === 1) { ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.7); ctx.lineTo(-r * 0.9, r * 0.7); ctx.closePath(); ctx.fill(); }
          else if (kind === 2) {
            ctx.moveTo(-r * 1.6, 0);
            ctx.bezierCurveTo(-r * 0.8, -r, -r * 0.2, r, r * 0.6, 0);
            ctx.bezierCurveTo(r, -r * 0.6, r * 1.4, -r * 0.4, r * 1.8, 0);
            ctx.stroke();
          } else {
            for (let k = 0; k < 5; k++) {
              const a = k / 5 * TAU - Math.PI / 2, b = a + TAU / 10;
              ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
              ctx.lineTo(Math.cos(b) * r * 0.45, Math.sin(b) * r * 0.45);
            }
            ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        });
      }
      ctx.restore();
      speckle(ctx, S, rng, 4000, ['rgba(255,255,255,0.6)', 'rgba(0,0,0,0.6)'], 0.5, 1, 0.25);
    },
    checker(ctx, S, o) {
      const n = o.cells || 8, cs = S / n;
      const [a, b] = o.colors || ['#FFFFFF', '#E3E9F0'];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        ctx.fillStyle = (i + j) % 2 ? b : a;
        ctx.fillRect(i * cs, j * cs, cs, cs);
      }
    },
    noise(ctx, S, o, rng) {
      noiseLayer(ctx, S, '#6A6A6A', '#C4C4C4', { period: 4, seed: 101, contrast: 1.2 });
      speckle(ctx, S, rng, 8000, ['#FFFFFF', '#000000'], 0.5, 1, 0.12);
    },
    brick(ctx, S, o, rng) {
      const rows = 8, cols = 4, bh = S / rows, bw = S / cols, m = 5;
      const base = o.color || '#B9573D';
      ctx.fillStyle = o.mortar || '#D9D0C5';
      ctx.fillRect(0, 0, S, S);
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? bw / 2 : 0;
        for (let c = -1; c < cols; c++) {
          const x = c * bw + off + m / 2, y = r * bh + m / 2, w = bw - m, h = bh - m;
          const tone = (ihash(r, (c + cols) % cols, 5) - 0.5) * 0.24;   // same tone on both wrapped halves
          ctx.fillStyle = tone > 0 ? mixCss(base, '#E8916E', tone * 2.5) : mixCss(base, '#6E2A1A', -tone * 2.5);
          roundRect(ctx, x, y, w, h, 3); ctx.fill();
          ctx.fillStyle = 'rgba(60,20,10,0.18)';
          ctx.fillRect(x, y + h - 4, w, 4);
          ctx.fillStyle = 'rgba(255,230,210,0.12)';
          ctx.fillRect(x, y, w, 3);
        }
      }
      speckle(ctx, S, rng, 3000, ['#5A2414', '#F2C2A8'], 0.5, 1.1, 0.3);
    },
  };

  function drawBanner(canvas, o) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const bg = o.bg || '#1FA2FF', fg = o.color || '#FFFFFF';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const shine = ctx.createLinearGradient(0, 0, 0, H);
    shine.addColorStop(0, 'rgba(255,255,255,0.22)'); shine.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    shine.addColorStop(0.52, 'rgba(0,0,0,0.0)'); shine.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = shine; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, H * 0.06, W, H * 0.035);
    ctx.fillRect(0, H * 0.905, W, H * 0.035);
    const text = String(o.text == null ? 'SUNNY SPORTS' : o.text);
    let px = Math.floor(H * 0.56);
    ctx.font = '700 ' + px + 'px ' + FONT_STACK;
    const maxW = W * 0.9;
    const w = ctx.measureText(text).width;
    if (w > maxW) { px = Math.floor(px * maxW / w); ctx.font = '700 ' + px + 'px ' + FONT_STACK; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillText(text, W / 2 + px * 0.04, H / 2 + px * 0.07);
    ctx.fillStyle = fg;
    ctx.fillText(text, W / 2, H / 2 + px * 0.03);
  }

  // Redraw text canvases once the display font is ready (canvas text never waits for fonts).
  const fontWaiters = [];
  let fontState = 'idle';
  function whenFontReady(fn) {
    if (fontState === 'ready' || !document.fonts || !document.fonts.load) return;
    fontWaiters.push(fn);
    if (fontState === 'loading') return;
    fontState = 'loading';
    document.fonts.load("700 64px 'Fredoka'").then(() => {
      fontState = 'ready';
      if (!document.fonts.check("700 64px 'Fredoka'")) return;
      for (const f of fontWaiters.splice(0)) { try { f(); } catch (err) { console.error('[SS] text redraw failed:', err); } }
    }, () => { fontState = 'ready'; fontWaiters.length = 0; });
  }

  const texCache = new Map();
  const TEX_SIZES = { wood_lane: 512, carpet: 512, banner: 0, checker: 256, noise: 256, brick: 512 };

  /** Cached canvas texture. opts.repeat = [x, y] returns a cached repeating variant (shares the image). */
  function texture(name, opts = {}) {
    const { repeat, ...style } = opts;
    const key = name + JSON.stringify(style);
    let tex = texCache.get(key);
    if (!tex) {
      if (name === 'banner') {
        const canvas = makeCanvas(style.width || 1024, style.height || 256);
        drawBanner(canvas, style);
        tex = new THREE.CanvasTexture(canvas);
        whenFontReady(() => { drawBanner(canvas, style); tex.needsUpdate = true; });
      } else {
        const painter = PAINTERS[name];
        if (!painter) { console.warn('[SS] world.texture: unknown texture "' + name + '"'); return texture('noise'); }
        const S = style.size || TEX_SIZES[name] || 512;
        const canvas = makeCanvas(S);
        painter(canvas.getContext('2d'), S, style, SS.util.rng(SS.util.hash(key)));
        tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.name = name;
      markShared(tex);
      texCache.set(key, tex);
    }
    if (!repeat) return tex;
    const rk = key + '@' + repeat[0] + 'x' + repeat[1];
    let rt = texCache.get(rk);
    if (!rt) {
      rt = tex.clone();
      rt.repeat.set(repeat[0], repeat[1]);
      rt.needsUpdate = true;
      markShared(rt);
      texCache.set(rk, rt);
    }
    return rt;
  }

  // ---------------------------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------------------------

  const matCache = new Map();
  const MAT_CLASSES = {
    lambert: THREE.MeshLambertMaterial, phong: THREE.MeshPhongMaterial,
    basic: THREE.MeshBasicMaterial, standard: THREE.MeshStandardMaterial,
  };

  /** Cached shared material. Extra opts (extension): vertexColors, flatShading, fog, depthWrite. */
  function mat(color, o = {}) {
    const kind = MAT_CLASSES[o.kind] ? o.kind : 'lambert';
    const col = color == null ? 0xffffff : color;
    const key = [kind, hexCss(col), o.map ? o.map.uuid : '', o.emissive == null ? '' : hexCss(o.emissive),
      !!o.transparent, o.opacity == null ? 1 : o.opacity, o.side || 0, o.shininess == null ? '' : o.shininess,
      !!o.vertexColors, !!o.flatShading, o.fog === false ? 0 : 1, o.depthWrite === false ? 0 : 1].join('|');
    let m = matCache.get(key);
    if (m) return m;
    const params = { color: col };
    if (o.map) params.map = o.map;
    if (o.transparent) params.transparent = true;
    if (o.opacity != null) params.opacity = o.opacity;
    if (o.side != null) params.side = o.side;
    if (o.vertexColors) params.vertexColors = true;
    if (o.fog === false) params.fog = false;
    if (o.depthWrite === false) params.depthWrite = false;
    if (kind !== 'basic') {
      if (o.emissive != null) params.emissive = o.emissive;
      if (o.flatShading) params.flatShading = true;
    }
    if (kind === 'phong') {
      params.shininess = o.shininess == null ? 40 : o.shininess;
      params.specular = 0x2a2a2a;
    }
    if (kind === 'standard') { params.roughness = 0.6; params.metalness = 0; }
    m = new MAT_CLASSES[kind](params);
    markShared(m);
    matCache.set(key, m);
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // Sky presets & sky dome shader
  // ---------------------------------------------------------------------------------------------

  const SKIES = {
    day: {
      top: 0x3E9BF0, mid: 0x86C4F6, horizon: 0xCDEBFF, below: 0xB9DCEB, sunColor: 0xFFF3D6,
      sun: { color: 0xFFF6E5, intensity: 2.6, elevation: 0.95, azimuth: 0.55 },
      hemi: { sky: 0xFFFFFF, ground: 0xA8C890, intensity: 1.6 },
      hills: [0x7CC56B, 0x5FAE57], farHills: [0x86C48A, 0x6DB07A], haze: [0.22, 0.5],
      cloudTop: 0xFFFFFF, cloudBottom: 0xC9DCEF, cloudEmissive: 0x71869C,
    },
    golden: {
      top: 0x4A82E0, mid: 0xA9B4EA, horizon: 0xFFD6A0, below: 0xF2C99C, sunColor: 0xFFB873,
      sun: { color: 0xFFD49A, intensity: 2.7, elevation: 0.38, azimuth: 0.85 },
      hemi: { sky: 0xFFE5C4, ground: 0x9AA872, intensity: 1.45 },
      hills: [0x8CC266, 0x5F9E4A], farHills: [0x7FAE6E, 0x5F9460], haze: [0.12, 0.3],
      cloudTop: 0xFFF1DE, cloudBottom: 0xEDB29C, cloudEmissive: 0x8A6C64,
    },
  };

  const SKY_VERT = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = position;',
    '  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = p.xyww;',
    '  gl_Position.z = p.w * 0.99999;',
    '}',
  ].join('\n');

  const SKY_FRAG = [
    'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uBelow; uniform vec3 uSun; uniform vec3 uSunColor;',
    'varying vec3 vDir;',
    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  float h = d.y;',
    '  float g = pow(clamp(h, 0.0, 1.0), 0.6);',
    '  vec3 col = g < 0.3 ? mix(uHorizon, uMid, g / 0.3) : mix(uMid, uTop, (g - 0.3) / 0.7);',
    '  col = mix(col, uBelow, smoothstep(0.0, -0.08, h));',
    '  float s = max(dot(d, uSun), 0.0);',
    '  col += uSunColor * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.35 + pow(s, 400.0) * 0.6);',
    '  col = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.99935, 0.99965, s));',
    '  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
    '  gl_FragColor = vec4(col + (n - 0.5) / 255.0, 1.0);',
    '}',
  ].join('\n');

  function skyDome(preset, sunDir) {
    const geo = new THREE.SphereGeometry(100, 32, 16);
    const material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: srgb(preset.top) }, uMid: { value: srgb(preset.mid) }, uHorizon: { value: srgb(preset.horizon) },
        uBelow: { value: srgb(preset.below) }, uSunColor: { value: srgb(preset.sunColor) },
        uSun: { value: sunDir.clone() },
      },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.matrixAutoUpdate = false;
    mesh.onBeforeRender = function (renderer, scene, camera) {
      const e = camera.matrixWorld.elements;
      this.matrixWorld.makeTranslation(e[12], e[13], e[14]);
    };
    return mesh;
  }

  // ---------------------------------------------------------------------------------------------
  // Trees, bushes, clouds, hills
  // ---------------------------------------------------------------------------------------------

  function blob(r, detail, x, y, z, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return g;
  }

  const TREE_COLORS = {
    round: { trunk: 0x8B5E3C, low: 0x3B8A3A, high: 0x7CCB5E },
    pine: { trunk: 0x7A5034, low: 0x2C6E3E, high: 0x5BAA5E },
    bush: { low: 0x3E8C3A, high: 0x7BC95C },
  };

  /** Tree geometry (vertex colored, origin at the base). */
  function treeGeometry(kind, scale, rng) {
    const parts = [];
    const c = TREE_COLORS[kind] || TREE_COLORS.round;
    const hueShift = rng.range(-0.06, 0.06);
    const tint = (hex) => new THREE.Color(hex).offsetHSL(hueShift * 0.3, 0, hueShift);
    const low = tint(c.low), high = tint(c.high);
    const canopy = (g, y0, y1) => paint(g, (x, y, z, out) => out.copy(low).lerp(high, clamp((y - y0) / (y1 - y0), 0, 1) * 0.9 + 0.05));
    if (kind === 'pine') {
      const trunk = new THREE.CylinderGeometry(0.14, 0.2, 1.2, 7);
      trunk.translate(0, 0.6, 0);
      parts.push(paint(trunk, c.trunk));
      const tiers = [[1.25, 1.7, 1.25], [1.0, 1.5, 2.2], [0.72, 1.3, 3.05]];
      for (const [r, h, y] of tiers) {
        const cone = new THREE.ConeGeometry(r * rng.range(0.92, 1.08), h, 9, 1);
        cone.translate(0, y, 0);
        parts.push(canopy(cone, 0.6, 3.9));
      }
    } else if (kind === 'bush') {
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + rng.next();
        parts.push(canopy(blob(rng.range(0.38, 0.55), 1, Math.cos(a) * 0.35, 0.32, Math.sin(a) * 0.3, 1, 0.85, 1), 0, 0.9));
      }
      parts.push(canopy(blob(0.5, 1, 0, 0.5, 0, 1, 0.9, 1), 0, 0.9));
    } else {
      const trunk = new THREE.CylinderGeometry(0.15, 0.24, 1.7, 7);
      trunk.translate(0, 0.85, 0);
      parts.push(paint(trunk, c.trunk));
      parts.push(canopy(blob(1.15, 2, 0, 2.55, 0, 1, 0.95, 1), 1.4, 3.7));
      parts.push(canopy(blob(0.82, 2, 0.62, 2.15, 0.28), 1.4, 3.7));
      parts.push(canopy(blob(0.78, 2, -0.55, 2.2, -0.3), 1.4, 3.7));
      parts.push(canopy(blob(0.7, 2, 0.1, 3.15, -0.25), 1.4, 3.7));
    }
    const g = mergeGeometries(parts);
    g.scale(scale, scale, scale);
    return g;
  }

  function tree(kind = 'round', scale = 1, rng) {
    rng = makeRng(rng, 7);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(treeGeometry(kind, scale, rng), mat(0xffffff, { vertexColors: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    group.name = 'tree-' + kind;
    return group;
  }

  const _n = new THREE.Vector3();

  /** Puffy cloud geometry (vertex colored, flattened base), ~10 m wide at scale 1. */
  function cloudGeometry(scale, rng, preset) {
    const parts = [];
    const n = rng.int(4, 6);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const r = (1.6 + Math.sin(t * Math.PI) * 1.6) * rng.range(0.85, 1.15);
      parts.push(blob(r, 2, (t - 0.5) * 8 + rng.range(-0.4, 0.4), r * 0.35 + rng.range(-0.2, 0.3), rng.range(-1, 1)));
    }
    parts.push(blob(2.2, 2, rng.range(-1, 1), 1.6, rng.range(-0.6, 0.6)));
    const g = mergeGeometries(parts);
    const pos = g.attributes.position, nor = g.attributes.normal;
    // flatten the underside: squash vertices below the base and point their normals down
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0) {
        pos.setY(i, pos.getY(i) * 0.25);
        _n.set(nor.getX(i) * 0.4, -1, nor.getZ(i) * 0.4).normalize();
        nor.setXYZ(i, _n.x, _n.y, _n.z);
      }
    }
    gradient(g, preset.cloudBottom, preset.cloudTop, -0.2, 2.4);
    g.scale(scale, scale * 0.8, scale);
    return g;
  }

  function cloudMaterial(preset) {
    return mat(0xffffff, { vertexColors: true, fog: false, emissive: preset.cloudEmissive });
  }

  function cloud(scale = 1, rng) {
    rng = makeRng(rng, 3);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(cloudGeometry(scale, rng, SKIES.day), cloudMaterial(SKIES.day)));
    group.name = 'cloud';
    return group;
  }

  /** Ring of soft rolling hills (one mesh, vertex colored by height). */
  function hillsGeometry(radius, depth, minH, maxH, colors, haze, hazeColor, seed) {
    const rng = SS.util.rng(seed);
    const seg = 128, rows = 7;
    const ph = [rng.next() * TAU, rng.next() * TAU, rng.next() * TAU, rng.next() * TAU];
    const pos = [], idx = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const r = radius + t * depth;
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * TAU;
        const n = 0.5 + 0.22 * Math.sin(a * 3 + ph[0]) + 0.16 * Math.sin(a * 7 + ph[1]) +
          0.08 * Math.sin(a * 13 + ph[2]) + 0.05 * Math.sin(a * 23 + ph[3]);
        const profile = Math.pow(Math.sin(Math.min(t * 1.25, 1) * Math.PI * 0.5), 1.3);
        const h = j === 0 ? -3 : lerp(minH, maxH, n) * profile;
        pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
      }
    }
    const w = seg + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Aerial perspective is baked in (hills ignore scene fog so they stay visible at any fog range).
    const lo = new THREE.Color(colors[1]), hi = new THREE.Color(colors[0]), hz = new THREE.Color(hazeColor);
    paint(g, (x, y, z, out) => out.copy(lo).lerp(hi, clamp(y / (maxH * 0.8), 0, 1)).lerp(hz, haze + (1 - haze) * 0.25 * clamp(1 - y / maxH, 0, 1)));
    return g;
  }

  // ---------------------------------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------------------------------

  const DEFAULT_ENV = {
    sky: 'day', fog: true, fogNear: 60, fogFar: 260, hills: true, hillRadius: 180, clouds: 10,
    trees: { ring: 70, count: 40 }, shadow: null, ground: true, seed: 7,
  };

  function sunDirection(elevation, azimuth) {
    return new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)).normalize();
  }

  /**
   * Lights + sky + scenery. Extensions: opts.ground (big grass apron under the venue, outdoor),
   * opts.seed (scenery layout), opts.sunAzimuth/sunElevation (radians), handle.group and
   * handle.sunDir; setShadowFocus also accepts a size alone.
   */
  function environment(scene, opts = {}) {
    const o = Object.assign({}, DEFAULT_ENV, opts);
    const indoor = o.sky === 'indoor';
    const preset = SKIES[o.sky] || SKIES.day;
    const rng = SS.util.rng(o.seed);
    const group = new THREE.Group();
    group.name = 'environment';
    scene.add(group);

    // Lights ------------------------------------------------------------------------------------
    let hemi, sun, sunDir;
    if (indoor) {
      hemi = new THREE.HemisphereLight(0xFFF8EE, 0x9C8670, 1.9);
      sunDir = sunDirection(1.2, o.sunAzimuth == null ? 0.5 : o.sunAzimuth);
      sun = new THREE.DirectionalLight(0xFFF4E2, 1.7);
      sun.castShadow = false;
      scene.background = new THREE.Color(o.background || 0x2E2A3A);
      if (o.fog) scene.fog = new THREE.Fog(scene.background.getHex(), opts.fogNear || 30, opts.fogFar || 120);
    } else {
      hemi = new THREE.HemisphereLight(preset.hemi.sky, preset.hemi.ground, preset.hemi.intensity);
      sunDir = sunDirection(o.sunElevation == null ? preset.sun.elevation : o.sunElevation,
        o.sunAzimuth == null ? preset.sun.azimuth : o.sunAzimuth);
      sun = new THREE.DirectionalLight(preset.sun.color, preset.sun.intensity);
      sun.castShadow = true;
      scene.background = new THREE.Color(preset.horizon);
      if (o.fog) scene.fog = new THREE.Fog(preset.horizon, o.fogNear, o.fogFar);
    }
    hemi.name = 'hemi'; sun.name = 'sun';
    group.add(hemi, sun, sun.target);

    const shadowDist = 80;
    const focus = new THREE.Vector3();
    let focusSize = 30;
    const sh = sun.shadow;
    sh.bias = -0.0004;
    sh.normalBias = 0.025;
    const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _c = new THREE.Vector3();

    function applyShadowQuality() {
      const tier = qualityTier();
      const size = tier.shadowMapSize || 1024;
      if (sh.mapSize.x !== size) {
        sh.mapSize.set(size, size);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
      setShadowFocus(focus, focusSize);
    }

    /** Keeps the shadow camera tight around a point; snapped to texels so shadows don't shimmer. */
    function setShadowFocus(center, size) {
      if (typeof center === 'number') { size = center; center = focus; }
      if (center) focus.copy(center);
      if (size) focusSize = size;
      const half = focusSize / 2;
      const cam = sh.camera;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = 1; cam.far = shadowDist + focusSize * 1.5;
      cam.updateProjectionMatrix();
      // Snap the focus point to the shadow-map texel grid in light space.
      _right.crossVectors(THREE.Object3D.DEFAULT_UP, sunDir);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _right.normalize();
      _up.crossVectors(sunDir, _right).normalize();
      const texel = focusSize / (sh.mapSize.x || 1024);
      const r = Math.round(focus.dot(_right) / texel) * texel;
      const u = Math.round(focus.dot(_up) / texel) * texel;
      const f = focus.dot(sunDir);
      _c.copy(_right).multiplyScalar(r).addScaledVector(_up, u).addScaledVector(sunDir, f);
      sun.target.position.copy(_c);
      sun.position.copy(_c).addScaledVector(sunDir, shadowDist);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    }

    if (o.shadow && o.shadow.mapSize) sh.mapSize.set(o.shadow.mapSize, o.shadow.mapSize);
    else sh.mapSize.set(qualityTier().shadowMapSize || 1024, qualityTier().shadowMapSize || 1024);
    setShadowFocus(o.shadow && o.shadow.center ? o.shadow.center : focus, o.shadow && o.shadow.size ? o.shadow.size : 30);
    const offQuality = SS.engine && SS.engine.onQuality && !(o.shadow && o.shadow.mapSize)
      ? SS.engine.onQuality(applyShadowQuality) : null;

    // Sky, hills, ground, clouds, trees ---------------------------------------------------------
    let sky = null, cloudGroup = null;
    if (!indoor) {
      sky = skyDome(preset, sunDir);
      group.add(sky);

      if (o.ground) {
        const apron = new THREE.Mesh(new THREE.CircleGeometry(o.hillRadius + 40, 72),
          mat(0xffffff, { map: texture('grass', { repeat: [70, 70] }) }));
        apron.rotation.x = -Math.PI / 2;
        apron.position.y = -0.3;
        apron.receiveShadow = true;
        apron.name = 'ground-apron';
        group.add(apron);
      }

      if (o.hills) {
        const hillMat = mat(0xffffff, { vertexColors: true, fog: false });
        const near = new THREE.Mesh(hillsGeometry(o.hillRadius, 60, 7, 24, preset.hills, preset.haze[0], preset.horizon, o.seed), hillMat);
        const far = new THREE.Mesh(hillsGeometry(o.hillRadius * 1.3, 80, 16, 46, preset.farHills, preset.haze[1], preset.horizon, o.seed + 1), hillMat);
        far.rotation.y = 0.7;
        near.name = 'hills'; far.name = 'hills-far';
        group.add(near, far);
      }

      if (o.clouds > 0) {
        cloudGroup = new THREE.Group();
        cloudGroup.name = 'clouds';
        const cmat = cloudMaterial(preset);
        for (let i = 0; i < o.clouds; i++) {
          const a = (i / o.clouds) * TAU + rng.range(-0.25, 0.25);
          const r = rng.range(170, 330);
          const m = new THREE.Mesh(cloudGeometry(rng.range(2.6, 4.6), rng, preset), cmat);
          m.position.set(Math.cos(a) * r, rng.range(55, 105), Math.sin(a) * r);
          m.rotation.y = -a + Math.PI / 2 + rng.range(-0.3, 0.3);
          cloudGroup.add(m);
        }
        group.add(cloudGroup);
      }

      if (o.trees && o.trees.count > 0) {
        const parts = [];
        const ringR = o.trees.ring || 70;
        for (let i = 0; i < o.trees.count; i++) {
          const a = rng.next() * TAU;
          const r = ringR + rng.range(-8, 22);
          const roll = rng.next();
          const kind = roll < 0.55 ? 'round' : roll < 0.8 ? 'pine' : 'bush';
          const s = kind === 'bush' ? rng.range(1.6, 2.6) : rng.range(1.5, 2.6);
          const g = treeGeometry(kind, s, rng);
          g.rotateY(rng.next() * TAU);
          g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
          parts.push(g);
        }
        const trees = new THREE.Mesh(mergeGeometries(parts), mat(0xffffff, { vertexColors: true }));
        trees.name = 'tree-ring';
        group.add(trees);
      }
    }

    // Invisible marker: when the engine disposes the scene graph, stop updates & listeners.
    const marker = new THREE.Mesh(new THREE.BufferGeometry(), mat(0xffffff));
    marker.visible = false;
    group.add(marker);
    function release() {
      untrack(handle);
      if (offQuality) offQuality();
    }
    marker.geometry.addEventListener('dispose', release);

    const handle = {
      sun, hemi, sky, group, sunDir,
      setShadowFocus,
      dispose() {
        release();
        if (group.parent) group.parent.remove(group);
        if (SS.engine && SS.engine.disposeObject) SS.engine.disposeObject(group);
        if (scene.fog) scene.fog = null;
      },
    };
    track(handle, (dt) => {
      if (cloudGroup) cloudGroup.rotation.y += dt * 0.0035;
    });
    return handle;
  }

  // ---------------------------------------------------------------------------------------------
  // Bleachers
  // ---------------------------------------------------------------------------------------------

  /**
   * Stepped bleachers; origin = front-bottom center, rows rise away from `facing`.
   * Extension: group.userData.rows holds world-space seat rows ready for crowd({ rows }).
   */
  function stands(scene, o = {}) {
    const width = o.width || 16, rows = o.rows || 6, rise = o.rise || 0.42, depth = o.depth || 0.8;
    const facing = o.facing || 0;
    const seat = new THREE.Color(o.color == null ? 0x1FA2FF : o.color);
    const seatAlt = seat.clone().offsetHSL(0, 0, 0.08);
    const concrete = 0xE4E8EE, side = 0xC9D1DC, trim = 0xFFFFFF;
    const parts = [];
    for (let i = 0; i < rows; i++) {
      const h = rise * (i + 1);
      const step = new THREE.BoxGeometry(width, h, depth);
      step.translate(0, h / 2, -(i + 0.5) * depth);
      parts.push(paint(step, concrete));
      const bench = new THREE.BoxGeometry(width - 0.2, 0.09, depth * 0.42);
      bench.translate(0, h + 0.045, -(i + 0.5) * depth - depth * 0.22);
      parts.push(paint(bench, i % 2 ? seatAlt : seat));
      const lip = new THREE.BoxGeometry(width, 0.05, 0.06);
      lip.translate(0, h - 0.02, -i * depth + 0.03);
      parts.push(paint(lip, trim));
    }
    const backH = rise * rows + 1.3;
    const back = new THREE.BoxGeometry(width + 0.3, backH, 0.25);
    back.translate(0, backH / 2, -rows * depth - 0.125);
    parts.push(paint(back, seat.clone().offsetHSL(0, -0.1, -0.12)));
    for (const sx of [-1, 1]) {
      const wall = new THREE.BoxGeometry(0.25, backH, rows * depth + 0.25);
      wall.translate(sx * (width / 2 + 0.125), backH / 2, -rows * depth / 2 - 0.125);
      parts.push(paint(wall, side));
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat(0xffffff, { vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    const group = new THREE.Group();
    group.name = 'stands';
    group.add(mesh);
    group.position.set(o.x || 0, o.y || 0, o.z || 0);
    group.rotation.y = facing;
    group.updateMatrixWorld(true);
    const rowList = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < rows; i++) {
      p.set(0, rise * (i + 1), -(i + 0.5) * depth + depth * 0.05).applyMatrix4(group.matrixWorld);
      rowList.push({ x: p.x, y: p.y, z: p.z, length: width - 0.8, facing });
    }
    group.userData.rows = rowList;
    if (scene) scene.add(group);
    return group;
  }

  // ---------------------------------------------------------------------------------------------
  // Crowd (instanced: body, head with printed face, hair cap, hands)
  // ---------------------------------------------------------------------------------------------

  const CROWD_SHIRTS = [0xF0484E, 0xFF8A2B, 0xFFC93C, 0x8BD346, 0x2FAE55, 0x22C3B6, 0x3DB4F2, 0x2F5FD8,
    0xFF6FAE, 0x8E5BE0, 0xF4F4F0, 0x33363D];
  const CROWD_SKINS = [0xFFE0C7, 0xF6C9A3, 0xE5A97E, 0xC98A5E, 0x9C6644, 0x6E4630];
  const CROWD_HAIR = [0x2B211C, 0x5A3A22, 0x8B5A2B, 0xC98B3E, 0xE8C26A, 0xB5532A, 0x9AA0A8, 0x2B211C];

  let crowdKit = null;
  function crowdAssets() {
    if (crowdKit) return crowdKit;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, a = t * Math.PI;
      pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.2 * (1 - 0.15 * t)), (1 - Math.cos(a)) / 2 * 0.56));
    }
    const body = markShared(new THREE.LatheGeometry(pts, 10));
    const head = markShared(new THREE.SphereGeometry(0.19, 14, 10));
    const hair = new THREE.SphereGeometry(0.205, 14, 6, 0, TAU, 0, 1.35);
    hair.rotateX(-0.35);
    markShared(hair);
    const hand = markShared(new THREE.IcosahedronGeometry(0.062, 1));

    const fc = makeCanvas(128, 64);
    const c = fc.getContext('2d');
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#1C1614';
    for (const ex of [32 - 6.5, 32 + 6.5]) { c.beginPath(); c.ellipse(ex, 29, 2.1, 3.1, 0, 0, TAU); c.fill(); }
    c.strokeStyle = '#3A1E1A'; c.lineWidth = 1.6; c.lineCap = 'round';
    c.beginPath(); c.arc(32, 35, 4.6, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
    c.fillStyle = 'rgba(255,120,120,0.35)';
    for (const ex of [32 - 10, 32 + 10]) { c.beginPath(); c.ellipse(ex, 35, 2.6, 1.6, 0, 0, TAU); c.fill(); }
    const faceTex = markShared(new THREE.CanvasTexture(fc));
    faceTex.colorSpace = THREE.SRGBColorSpace;
    crowdKit = {
      body, head, hair, hand,
      bodyMat: markShared(new THREE.MeshLambertMaterial({ color: 0xffffff })),
      headMat: markShared(new THREE.MeshLambertMaterial({ color: 0xffffff, map: faceTex })),
      hairMat: markShared(new THREE.MeshLambertMaterial({ color: 0xffffff })),
    };
    return crowdKit;
  }

  function crowd(scene, o = {}) {
    const kit = crowdAssets();
    const rng = makeRng(o.rng, o.seed == null ? 5 : o.seed);
    const spacing = o.spacing || 0.75, density = o.density == null ? 0.85 : o.density, scale = o.scale || 1;
    const seats = [];
    for (const row of (o.rows || [])) {
      const n = Math.max(1, Math.floor(row.length / spacing));
      const f = row.facing || 0;
      const ax = Math.cos(f), az = -Math.sin(f);   // along-row axis (local +X rotated by facing)
      for (let i = 0; i < n; i++) {
        if (!rng.chance(density)) continue;
        const off = (i - (n - 1) / 2) * spacing + rng.range(-0.08, 0.08);
        seats.push({ x: row.x + ax * off, y: row.y, z: row.z + az * off, f: f + rng.range(-0.25, 0.25), along: off + (row.x * ax + row.z * az) });
      }
    }
    const N = seats.length;
    const group = new THREE.Group();
    group.name = 'crowd';
    const bodies = new THREE.InstancedMesh(kit.body, kit.bodyMat, Math.max(1, N));
    const heads = new THREE.InstancedMesh(kit.head, kit.headMat, Math.max(1, N));
    const hairs = new THREE.InstancedMesh(kit.hair, kit.hairMat, Math.max(1, N));
    const hands = new THREE.InstancedMesh(kit.hand, kit.bodyMat, Math.max(1, N * 2));
    // Unique geometry per crowd so the engine's disposal tells us when the crowd is gone.
    const marker = new THREE.BufferGeometry();
    const markerMesh = new THREE.Mesh(marker, kit.bodyMat);
    markerMesh.visible = false;
    for (const m of [bodies, heads, hairs, hands]) { m.frustumCulled = false; group.add(m); }
    group.add(markerMesh);
    bodies.count = heads.count = hairs.count = N; hands.count = N * 2;

    const col = new THREE.Color();
    const S = new Float32Array(N * 12);   // per spectator: phase, bob, jumpH, freq, cheerStart, cheerEnd, delay, hairOn, scale, excite, gasp, wave
    for (let i = 0; i < N; i++) {
      const k = i * 12;
      S[k] = rng.next() * TAU; S[k + 1] = rng.range(0.6, 1.4); S[k + 2] = rng.range(0.12, 0.3);
      S[k + 3] = rng.range(2.2, 3.2); S[k + 4] = -1; S[k + 5] = -1; S[k + 6] = 0;
      S[k + 7] = rng.chance(0.85) ? 1 : 0; S[k + 8] = scale * rng.range(0.9, 1.08);
      const skin = rng.pick(CROWD_SKINS);
      bodies.setColorAt(i, col.set(rng.pick(CROWD_SHIRTS)));
      heads.setColorAt(i, col.set(skin));
      hairs.setColorAt(i, col.set(rng.pick(CROWD_HAIR)));
      hands.setColorAt(i * 2, col.set(skin));
      hands.setColorAt(i * 2 + 1, col);
    }
    for (const m of [bodies, heads, hairs, hands]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

    let time = 0, mood = 'idle';
    let tense = 0, waveStart = -100;
    let minAlong = Infinity;
    for (const s of seats) minAlong = Math.min(minAlong, s.along);
    const cheerW = new Float32Array(N), gaspW = new Float32Array(N), gaspUntil = new Float32Array(N);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3(), sc = new THREE.Vector3(), off = new THREE.Vector3(), zero = new THREE.Quaternion();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

    function tick(dt) {
      time += dt;
      const kT = 1 - Math.exp(-4 * dt), kC = 1 - Math.exp(-9 * dt);
      tense += ((mood === 'tense' ? 1 : 0) - tense) * kT;
      for (let i = 0; i < N; i++) {
        const k = i * 12, s = seats[i], sz = S[k + 8];
        const cheering = time >= S[k + 4] && time < S[k + 5];
        cheerW[i] += ((cheering ? 1 : 0) - cheerW[i]) * kC;
        gaspW[i] += ((time < gaspUntil[i] ? 1 : 0) - gaspW[i]) * kC;
        const waveX = (time - waveStart) * 9 - (s.along - minAlong);
        const wv = waveX > -1.5 && waveX < 3 ? Math.sin(clamp((waveX + 1.5) / 4.5, 0, 1) * Math.PI) : 0;
        const cw = cheerW[i], gw = gaspW[i] * (1 - cw), tw = tense * (1 - cw) * (1 - gw);
        const ph = S[k];
        let y = Math.sin(time * S[k + 1] * 1.6 + ph) * 0.012 * (1 - tw * 0.6);
        if (cw > 0.01) y += cw * S[k + 2] * Math.abs(Math.sin((time - S[k + 4]) * S[k + 3] * Math.PI * 0.5 + ph));
        y += wv * 0.22;
        const lean = tw * 0.22 - gw * 0.22 + Math.sin(time * 0.8 + ph) * 0.03;
        e.set(lean, s.f, Math.sin(time * 1.1 + ph * 2) * 0.04 * (1 + cw * 2));
        q.setFromEuler(e);
        p.set(s.x, s.y + y, s.z);
        sc.set(sz, sz, sz);
        m4.compose(p, q, sc);
        bodies.setMatrixAt(i, m4);
        off.set(0, 0.72 * sz, 0.02 * sz).applyQuaternion(q).add(p);
        m4.compose(off, q, sc);
        heads.setMatrixAt(i, m4);
        hairs.setMatrixAt(i, S[k + 7] ? m4 : hidden);
        // Hands: rest at sides → up (cheer/wave) → face (gasp) → clasped (tense)
        const up = Math.max(cw, wv);
        const wave = Math.sin(time * 9 + ph) * 0.07 * up;
        const cosf = Math.cos(s.f), sinf = Math.sin(s.f);
        for (let h = 0; h < 2; h++) {
          const side = h ? -1 : 1;
          let hx = side * 0.27, hy = 0.26 + Math.sin(time * 1.3 + ph + h) * 0.01, hz = 0.06;
          hx = lerp(hx, side * 0.26 + wave, up); hy = lerp(hy, 1.1 + Math.sin(time * 7 + ph + h * 2) * 0.06, up); hz = lerp(hz, 0.02, up);
          hx = lerp(hx, side * 0.12, gw); hy = lerp(hy, 0.66, gw); hz = lerp(hz, 0.2, gw);
          hx = lerp(hx, side * 0.05, tw); hy = lerp(hy, 0.48, tw); hz = lerp(hz, 0.22, tw);
          off.set(s.x + (hx * cosf + hz * sinf) * sz, s.y + y * 0.9 + hy * sz, s.z + (-hx * sinf + hz * cosf) * sz);
          m4.compose(off, zero, sc);
          hands.setMatrixAt(i * 2 + h, m4);
        }
      }
      for (const m of [bodies, heads, hairs, hands]) m.instanceMatrix.needsUpdate = true;
    }

    const handle = {
      group,
      count: N,
      cheer(intensity = 1, seconds = 2) {
        const p01 = clamp(intensity, 0, 1);
        for (let i = 0; i < N; i++) {
          const k = i * 12;
          if (rng.next() > 0.35 + 0.65 * p01) continue;
          S[k + 4] = time + rng.range(0, 0.35);
          S[k + 5] = S[k + 4] + seconds * rng.range(0.7, 1.15);
          S[k + 2] = rng.range(0.1, 0.18 + 0.22 * p01);
        }
      },
      gasp() {
        for (let i = 0; i < N; i++) {
          gaspUntil[i] = time + rng.range(0.9, 1.6);
          S[i * 12 + 5] = Math.min(S[i * 12 + 5], time);   // a gasp interrupts any cheering
        }
      },
      wave() { waveStart = time; },
      setMood(m) { mood = m === 'tense' ? 'tense' : 'idle'; },
      dispose() {
        untrack(handle);
        if (group.parent) group.parent.remove(group);
        for (const m of [bodies, heads, hairs, hands]) m.dispose();
        marker.dispose();
      },
    };
    track(handle, tick);
    dieWith(handle, marker);
    tick(0);
    if (scene) scene.add(group);
    return handle;
  }

  // ---------------------------------------------------------------------------------------------
  // FX: one pooled system per scene (sparkle points, confetti, rings, firework shells)
  // ---------------------------------------------------------------------------------------------

  const CONFETTI_COLORS = [0xFF5A5F, 0xFFC93C, 0x3BC45B, 0x1FA2FF, 0xB46CFF, 0xFF8FC7, 0xFFFFFF, 0xFF8A3D];
  const FIREWORK_COLORS = [0xFF5A5F, 0xFFC93C, 0x1FA2FF, 0x3BC45B, 0xFF8FC7, 0xB46CFF];

  const POINT_VERT = [
    'attribute float aSize; attribute float aAlpha; attribute vec3 aColor;',
    'uniform float uScale;',
    'varying vec3 vColor; varying float vAlpha;',
    'void main() {',
    '  vColor = aColor; vAlpha = aAlpha;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(-mv.z, 0.05) : 0.0;',
    '  gl_Position = projectionMatrix * mv;',
    '}',
  ].join('\n');
  const POINT_FRAG = [
    'varying vec3 vColor; varying float vAlpha;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.18, d) * vAlpha;',
    '  if (a < 0.01) discard;',
    '  vec3 c = mix(vColor, vec3(1.0), smoothstep(0.22, 0.0, d) * 0.6);',
    '  gl_FragColor = vec4(c, a);',
    '}',
  ].join('\n');

  // Confetti: flat bright paper that flashes as it tumbles (brightness follows facing).
  const CONFETTI_VERT = [
    'varying vec3 vColor; varying float vShade;',
    'void main() {',
    '  vColor = instanceColor;',
    '  vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);',
    '  vShade = 0.62 + 0.38 * abs(n.z) + 0.25 * pow(abs(n.z), 24.0);',
    '  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');
  const CONFETTI_FRAG = [
    'varying vec3 vColor; varying float vShade;',
    'void main() {',
    '  gl_FragColor = vec4(min(vColor * vShade, vec3(1.0)), 1.0);',
    '  #include <colorspace_fragment>',
    '}',
  ].join('\n');

  const POINTS_MAX = 1600, CONFETTI_MAX = 700, RING_MAX = 10;
  const fxSystems = new Map();
  let ringGeo = null, confettiGeo = null;

  function fxFor(scene) {
    let fx = fxSystems.get(scene);
    if (fx && !fx.dead) return fx;
    fx = createFx(scene);
    fxSystems.set(scene, fx);
    return fx;
  }

  function createFx(scene) {
    const group = new THREE.Group();
    group.name = 'fx';
    scene.add(group);

    // Sparkle points --------------------------------------------------------------------------
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(POINTS_MAX * 3), pCol = new Float32Array(POINTS_MAX * 3);
    const pSize = new Float32Array(POINTS_MAX), pAlpha = new Float32Array(POINTS_MAX);
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const pMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    const _size = new THREE.Vector2();
    points.onBeforeRender = (renderer, sc, camera) => {
      renderer.getDrawingBufferSize(_size);
      pMat.uniforms.uScale.value = _size.y * camera.projectionMatrix.elements[5] * 0.5;
    };
    group.add(points);
    // CPU side: vx vy vz life maxLife gravity drag baseSize twinkle
    const pv = new Float32Array(POINTS_MAX * 9);
    let pNext = 0, pAlive = 0;

    function spawnPoint(x, y, z, vx, vy, vz, color, size, life, gravity, drag, twinkle) {
      const i = pNext; pNext = (pNext + 1) % POINTS_MAX;
      pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
      const c = typeof color === 'object' ? color : srgb(color);
      pCol[i * 3] = c.x; pCol[i * 3 + 1] = c.y; pCol[i * 3 + 2] = c.z;
      const k = i * 9;
      pv[k] = vx; pv[k + 1] = vy; pv[k + 2] = vz; pv[k + 3] = life; pv[k + 4] = life;
      pv[k + 5] = gravity; pv[k + 6] = drag; pv[k + 7] = size; pv[k + 8] = twinkle;
      pSize[i] = size; pAlpha[i] = 1;
      pAlive = POINTS_MAX;
    }

    // Confetti ----------------------------------------------------------------------------------
    if (!confettiGeo) {
      confettiGeo = markShared(new THREE.PlaneGeometry(0.075, 0.11));
    }
    const cMat = new THREE.ShaderMaterial({
      vertexShader: CONFETTI_VERT, fragmentShader: CONFETTI_FRAG, side: THREE.DoubleSide,
    });
    const confetti = new THREE.InstancedMesh(confettiGeo, cMat, CONFETTI_MAX);
    confetti.frustumCulled = false;
    confetti.count = CONFETTI_MAX;
    const cv = new Float32Array(CONFETTI_MAX * 14);   // px py pz vx vy vz ax ay az angle spin life max floor
    const cq = new THREE.Quaternion(), cEuler = new THREE.Euler(), cAxis = new THREE.Vector3(), cPos = new THREE.Vector3(), cScale = new THREE.Vector3();
    const hiddenM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CONFETTI_MAX; i++) { confetti.setMatrixAt(i, hiddenM); confetti.setColorAt(i, new THREE.Color(0xffffff)); }
    let cNext = 0, cActive = 0;
    group.add(confetti);
    const cm4 = new THREE.Matrix4(), ccol = new THREE.Color();

    // Rings ------------------------------------------------------------------------------------
    if (!ringGeo) {
      ringGeo = new THREE.RingGeometry(0.82, 1, 48);
      ringGeo.rotateX(-Math.PI / 2);
      markShared(ringGeo);
    }
    const rings = [];
    for (let i = 0; i < RING_MAX; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false }));
      m.visible = false;
      m.renderOrder = 4;
      m.userData.t = 0; m.userData.life = 1; m.userData.r = 1;
      group.add(m);
      rings.push(m);
    }
    let ringNext = 0;

    const shells = [];
    const _fw = new THREE.Vector3();

    function tick(dt) {
      // shells (fireworks)
      for (let s = shells.length - 1; s >= 0; s--) {
        const sh = shells[s];
        sh.delay -= dt;
        if (sh.delay > 0) continue;
        sh.t += dt;
        sh.prev.copy(sh.pos);
        sh.vel.y -= 9.8 * dt;
        sh.pos.addScaledVector(sh.vel, dt);
        // Spark trail spaced evenly along this frame's path (smooth even at low frame rates).
        const steps = Math.max(1, Math.round(sh.prev.distanceTo(sh.pos) / 0.12));
        for (let k = 1; k <= steps; k++) {
          _fw.lerpVectors(sh.prev, sh.pos, k / steps);
          spawnPoint(_fw.x, _fw.y, _fw.z, (Math.random() - 0.5) * 0.4, -0.5, (Math.random() - 0.5) * 0.4,
            0xFFE6A8, 0.16, 0.5, -1, 1, 0);
        }
        if (sh.t >= sh.fuse) {
          const n = 150;
          const c1 = srgb(sh.color), c2 = srgb(sh.color2);
          for (let i = 0; i < n; i++) {
            const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - u * u);
            const sp = 8.5 + Math.random() * 3;
            spawnPoint(sh.pos.x, sh.pos.y, sh.pos.z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp,
              i % 3 ? c1 : c2, 0.6, 1.4 + Math.random() * 0.7, -2.4, 1.6, 1);
          }
          for (let i = 0; i < 28; i++) {
            const a = i / 28 * TAU;
            spawnPoint(sh.pos.x, sh.pos.y, sh.pos.z, Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0, 0xFFFFFF, 0.5, 0.9, -1, 1.2, 1);
          }
          shells.splice(s, 1);
        }
      }

      // points
      if (pAlive > 0) {
        let alive = 0;
        for (let i = 0; i < POINTS_MAX; i++) {
          if (pAlpha[i] <= 0) continue;
          const k = i * 9;
          pv[k + 3] -= dt;
          if (pv[k + 3] <= 0) { pAlpha[i] = 0; continue; }
          alive++;
          const drag = Math.exp(-pv[k + 6] * dt);
          pv[k] *= drag; pv[k + 2] *= drag;
          pv[k + 1] = pv[k + 1] * drag + pv[k + 5] * dt;
          pPos[i * 3] += pv[k] * dt; pPos[i * 3 + 1] += pv[k + 1] * dt; pPos[i * 3 + 2] += pv[k + 2] * dt;
          const lt = pv[k + 3] / pv[k + 4];
          let a = Math.min(1, lt * 2.2);
          if (pv[k + 8] > 0) a *= 0.55 + 0.45 * Math.sin(pv[k + 3] * 38 + i);
          pAlpha[i] = Math.max(0.001, a);
          pSize[i] = pv[k + 7] * (0.4 + 0.6 * Math.min(1, lt * 1.6));
        }
        pAlive = alive;
        pGeo.attributes.position.needsUpdate = true;
        pGeo.attributes.aAlpha.needsUpdate = true;
        pGeo.attributes.aSize.needsUpdate = true;
        pGeo.attributes.aColor.needsUpdate = true;
        if (!alive) pAlpha.fill(0);
      }

      // confetti
      if (cActive > 0) {
        let alive = 0;
        for (let i = 0; i < CONFETTI_MAX; i++) {
          const k = i * 14;
          if (cv[k + 11] <= 0) continue;
          cv[k + 11] -= dt;
          if (cv[k + 11] <= 0) { confetti.setMatrixAt(i, hiddenM); continue; }
          alive++;
          const age = cv[k + 12] - cv[k + 11];
          const drag = Math.exp(-2.4 * dt);
          cv[k + 3] = cv[k + 3] * drag + Math.sin(age * 3.1 + i) * 1.4 * dt;
          cv[k + 5] = cv[k + 5] * drag + Math.cos(age * 2.7 + i * 1.7) * 1.4 * dt;
          cv[k + 4] = Math.max(cv[k + 4] * drag - 9.8 * dt, -1.25);
          const floor = cv[k + 13];
          if (cv[k + 1] <= floor) {
            cv[k + 1] = floor; cv[k + 3] = cv[k + 4] = cv[k + 5] = 0;
          } else {
            cv[k] += cv[k + 3] * dt; cv[k + 1] += cv[k + 4] * dt; cv[k + 2] += cv[k + 5] * dt;
            cv[k + 9] += cv[k + 10] * dt;
          }
          const s = Math.min(1, cv[k + 11] / 0.6);
          if (cv[k + 1] <= floor) cq.setFromEuler(cEuler.set(-Math.PI / 2, 0, cv[k + 9]));   // landed: lie flat
          else cq.setFromAxisAngle(cAxis.set(cv[k + 6], cv[k + 7], cv[k + 8]), cv[k + 9]);
          cPos.set(cv[k], cv[k + 1] + 0.004, cv[k + 2]);
          cScale.set(s, s, s);
          cm4.compose(cPos, cq, cScale);
          confetti.setMatrixAt(i, cm4);
        }
        cActive = alive;
        confetti.instanceMatrix.needsUpdate = true;
      }

      // rings
      for (const r of rings) {
        if (!r.visible) continue;
        r.userData.t += dt;
        const t = r.userData.t / r.userData.life;
        if (t >= 1) { r.visible = false; continue; }
        const s = r.userData.r * (0.2 + 0.8 * outCubic(t));
        r.scale.set(s, 1, s);
        r.material.opacity = Math.pow(1 - t, 1.5) * 0.9;
      }
    }

    const fx = {
      group,
      burst(pos, o = {}) {
        const count = o.count == null ? 20 : o.count, speed = o.speed == null ? 3 : o.speed;
        const size = o.size == null ? 0.06 : o.size, gravity = o.gravity == null ? -9.8 : o.gravity;
        const life = o.life == null ? 0.8 : o.life;
        const colors = o.colors || [o.color == null ? 0xffffff : o.color];
        const cols = colors.map(srgb);
        for (let i = 0; i < count; i++) {
          const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - u * u);
          const sp = speed * (0.45 + Math.random() * 0.55);
          spawnPoint(pos.x, pos.y, pos.z, Math.cos(a) * r * sp, Math.abs(u) * sp * 0.9 + sp * 0.25, Math.sin(a) * r * sp,
            cols[i % cols.length], size * 2.6 * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), gravity, 1.2, 0);
        }
      },
      confetti(pos, o = {}) {
        const count = Math.min(o.count == null ? 120 : o.count, CONFETTI_MAX);
        const spread = o.spread == null ? 3 : o.spread;
        const colors = o.colors || CONFETTI_COLORS;
        const floor = o.floor == null ? 0 : o.floor;
        for (let n = 0; n < count; n++) {
          const i = cNext; cNext = (cNext + 1) % CONFETTI_MAX;
          const k = i * 14;
          const a = Math.random() * TAU, r = Math.random() * spread * 0.35;
          cv[k] = pos.x + Math.cos(a) * r * 0.3; cv[k + 1] = pos.y + Math.random() * 0.3; cv[k + 2] = pos.z + Math.sin(a) * r * 0.3;
          const hs = spread * (0.6 + Math.random() * 0.9);
          cv[k + 3] = Math.cos(a) * hs * Math.random(); cv[k + 4] = 4 + Math.random() * 5; cv[k + 5] = Math.sin(a) * hs * Math.random();
          cAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
          cv[k + 6] = cAxis.x; cv[k + 7] = cAxis.y; cv[k + 8] = cAxis.z;
          cv[k + 9] = Math.random() * TAU; cv[k + 10] = (6 + Math.random() * 9) * (Math.random() < 0.5 ? -1 : 1);
          cv[k + 11] = cv[k + 12] = 3.8 + Math.random() * 2.2;
          cv[k + 13] = floor;
          confetti.setColorAt(i, ccol.set(colors[n % colors.length]));
        }
        confetti.instanceColor.needsUpdate = true;
        cActive = CONFETTI_MAX;
      },
      fireworks(pos, o = {}) {
        const count = o.count == null ? 3 : o.count;
        const colors = o.colors || FIREWORK_COLORS;
        for (let i = 0; i < count; i++) {
          shells.push({
            pos: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 6, pos.y, pos.z + (Math.random() - 0.5) * 3),
            vel: new THREE.Vector3((Math.random() - 0.5) * 2, 13 + Math.random() * 3, (Math.random() - 0.5) * 1.5),
            prev: new THREE.Vector3(), t: 0, fuse: 0.95 + Math.random() * 0.25, delay: i * 0.38 + Math.random() * 0.1,
            color: colors[i % colors.length], color2: colors[(i + 2) % colors.length],
          });
        }
      },
      ring(pos, o = {}) {
        const r = rings[ringNext]; ringNext = (ringNext + 1) % RING_MAX;
        r.position.set(pos.x, pos.y + 0.02, pos.z);
        r.material.color.set(o.color == null ? 0xffffff : o.color);
        r.userData.t = 0; r.userData.life = o.life || 0.6; r.userData.r = o.radius || 0.5;
        r.scale.set(0.01, 1, 0.01);
        r.visible = true;
      },
    };
    track(fx, tick);
    pGeo.addEventListener('dispose', () => { untrack(fx); fx.dead = true; fxSystems.delete(scene); });
    return fx;
  }

  function confetti(scene, position, o) { fxFor(scene).confetti(position, o); }
  function burst(scene, position, o) { fxFor(scene).burst(position, o); }
  function fireworks(scene, position, o) { fxFor(scene).fireworks(position, o); }
  function ring(scene, position, o) { fxFor(scene).ring(position, o); }

  // ---------------------------------------------------------------------------------------------
  // Ribbon trail
  // ---------------------------------------------------------------------------------------------

  const TRAIL_VERT = [
    'attribute float aAlpha; varying float vAlpha;',
    'void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  ].join('\n');
  const TRAIL_FRAG = [
    'uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;',
    'void main() { gl_FragColor = vec4(uColor, vAlpha * uOpacity); }',
  ].join('\n');

  function trail(object3d, o = {}) {
    const length = Math.max(2, o.length || 24), width = o.width || 0.08, maxJump = o.maxJump || 10;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(length * 2 * 3), alpha = new Float32Array(length * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const material = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      uniforms: { uColor: { value: srgb(o.color == null ? 0xffffff : o.color) }, uOpacity: { value: o.opacity == null ? 0.6 : o.opacity } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'trail';
    const hist = [];
    for (let i = 0; i < length; i++) hist.push(new THREE.Vector3());
    let filled = 0, visible = true;
    const cur = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3();

    function rebuild() {
      const cam = currentCamera();
      for (let i = 0; i < length; i++) {
        const k = i * 6;
        if (i >= filled) { alpha[i * 2] = alpha[i * 2 + 1] = 0; continue; }
        const p = hist[i];
        const a = hist[Math.max(0, i - 1)], b = hist[Math.min(filled - 1, i + 1)];
        tan.subVectors(a, b);
        if (tan.lengthSq() < 1e-10) tan.set(0, 0, 1);
        if (cam) view.setFromMatrixPosition(cam.matrixWorld).sub(p); else view.set(0, 1, 0);
        side.crossVectors(tan, view);
        if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
        const t = 1 - i / (length - 1);
        side.normalize().multiplyScalar(width * 0.5 * (0.25 + 0.75 * t));
        pos[k] = p.x + side.x; pos[k + 1] = p.y + side.y; pos[k + 2] = p.z + side.z;
        pos[k + 3] = p.x - side.x; pos[k + 4] = p.y - side.y; pos[k + 5] = p.z - side.z;
        alpha[i * 2] = alpha[i * 2 + 1] = t * t;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    }

    const handle = {
      mesh,
      get visible() { return visible; },
      set visible(v) { visible = !!v; mesh.visible = visible; if (!visible) handle.clear(); },
      clear() { filled = 0; alpha.fill(0); geo.attributes.aAlpha.needsUpdate = true; },
      dispose() {
        untrack(handle);
        if (mesh.parent) mesh.parent.remove(mesh);
        geo.dispose(); material.dispose();
      },
    };
    track(handle, () => {
      const root = rootOf(object3d);
      if (!root.isScene) return;
      if (mesh.parent !== root) root.add(mesh);
      if (!visible || !object3d.visible) return;
      object3d.getWorldPosition(cur);
      if (filled > 0 && cur.distanceToSquared(hist[0]) < 1e-8) { rebuild(); return; }
      if (filled > 0 && cur.distanceToSquared(hist[0]) > maxJump * maxJump) filled = 0;   // teleported: start fresh
      const last = hist.pop();
      last.copy(cur);
      hist.unshift(last);
      filled = Math.min(length, filled + 1);
      rebuild();
    });
    handle.update = function () { handle._manual = true; handle._tick(0); };
    dieWith(handle, geo);
    return handle;
  }

  // ---------------------------------------------------------------------------------------------
  // Blob shadow & 3D labels
  // ---------------------------------------------------------------------------------------------

  let blobTex = null;
  const blobGeos = new Map();

  function blobShadow(radius = 0.5, opacity = 0.35) {
    if (!blobTex) {
      const c = makeCanvas(128);
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      blobTex = markShared(new THREE.CanvasTexture(c));
    }
    let geo = blobGeos.get(radius);
    if (!geo) {
      geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
      geo.rotateX(-Math.PI / 2);
      markShared(geo);
      blobGeos.set(radius, geo);
    }
    const m = new THREE.MeshBasicMaterial({
      map: blobTex, color: 0x000000, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = 'blob-shadow';
    mesh.renderOrder = 2;
    mesh.position.y = 0.01;
    return mesh;
  }

  function drawLabel(canvas, text, o) {
    const ctx = canvas.getContext('2d');
    const px = 64, pad = o.bg === null || o.bg === 'none' ? 6 : 26;
    ctx.font = '700 ' + px + 'px ' + FONT_STACK;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = px + 34;
    canvas.width = Math.max(64, w); canvas.height = h;
    ctx.font = '700 ' + px + 'px ' + FONT_STACK;
    ctx.clearRect(0, 0, canvas.width, h);
    if (o.bg !== null && o.bg !== 'none') {
      ctx.fillStyle = o.bg || 'rgba(20,30,50,0.55)';
      roundRect(ctx, 2, 2, canvas.width - 4, h - 4, (h - 4) / 2);
      ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (o.bg === null || o.bg === 'none') {
      ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(20,30,50,0.55)';
      ctx.strokeText(text, canvas.width / 2, h / 2 + 3);
    }
    ctx.fillStyle = o.color || '#FFFFFF';
    ctx.fillText(text, canvas.width / 2, h / 2 + 3);
    return canvas.width / h;
  }

  /** Billboard text. Extension: sprite.userData.setText(text) redraws in place. size = height in m. */
  function label3d(text, o = {}) {
    const canvas = makeCanvas(256, 98);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 6;
    const size = o.size || 0.6;
    let current = String(text);
    function redraw() {
      const aspect = drawLabel(canvas, current, o);
      tex.dispose();
      tex.needsUpdate = true;
      sprite.scale.set(size * aspect, size, 1);
    }
    sprite.userData.setText = (t) => { const s = String(t); if (s === current) return; current = s; redraw(); };
    redraw();
    whenFontReady(redraw);
    sprite.name = 'label';
    return sprite;
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  SS.world = {
    environment, tree, cloud, texture, mat, crowd, stands,
    confetti, burst, fireworks, ring, trail, blobShadow, label3d,
    update,
    // Shared building blocks (used by pals.js; handy for sports too)
    mergeGeometries, paint, gradient,
    SKIES,
  };
})();
