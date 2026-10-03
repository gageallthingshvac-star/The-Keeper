/* Sunny Sports — pals.js
 * The Pals: round, glossy, friendly characters built from primitives. Profiles & options,
 * cached part geometry, a procedural animation system (crossfades + a pose layer that sports
 * drive for swings), expressions with automatic blinking, head-and-shoulders portraits and the
 * CPU roster.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const THREE = SS.THREE || window.THREE;

  const TAU = Math.PI * 2;
  const HEAD_R = 0.24;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bump = (t, dur, a, b) => smoothstep(0, a, t) * (1 - smoothstep(dur - b, dur, t));
  const outBack = t => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };

  // ---------------------------------------------------------------------------------------------
  // Options & profiles
  // ---------------------------------------------------------------------------------------------

  const OPTIONS = {
    skins: [0xFFE0C7, 0xF6C9A3, 0xE5A97E, 0xC98A5E, 0x9C6644, 0x6E4630],
    hairColors: [0x2B211C, 0x5A3A22, 0x8B5A2B, 0xC98B3E, 0xE8C26A, 0xB5532A, 0x9AA0A8, 0xF2F0EA, 0x3C6BE0, 0xE2588F],
    shirts: [0xF0484E, 0xFF8A2B, 0xFFC93C, 0x8BD346, 0x2FAE55, 0x3DB4F2, 0x2F5FD8, 0xFF6FAE, 0x8E5BE0, 0x8A5A3B, 0xF4F4F0, 0x33363D],
    shirtNames: ['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Sky', 'Blue', 'Pink', 'Purple', 'Brown', 'White', 'Black'],
    pants: [0x34405E, 0x2F3036, 0x6A7280, 0xB09466, 0xF2F2EE, 0x3C6E47, 0x7A3E3E, 0x2E5E9E],
    eyeColors: [0x1C1816, 0x3B2316, 0x1F3350, 0x1E4030, 0x4A3520, 0x3A2448],
    hairStyles: [{ name: 'Crop' }, { name: 'Side Part' }, { name: 'Spiky' }, { name: 'Bob' }, { name: 'Long' },
      { name: 'Ponytail' }, { name: 'Bun' }, { name: 'Curly' }, { name: 'Buzz' }, { name: 'Pigtails' }],
    eyes: [{ name: 'Round' }, { name: 'Tall' }, { name: 'Small' }, { name: 'Wide' }, { name: 'Sleepy' }, { name: 'Sparkle' }],
    brows: [{ name: 'Classic' }, { name: 'Bold' }, { name: 'Thin' }, { name: 'Arched' }, { name: 'Flat' }],
    noses: [{ name: 'Button' }, { name: 'Round' }, { name: 'Long' }, { name: 'Wide' }],
    mouths: [{ name: 'Smile' }, { name: 'Beam' }, { name: 'Calm' }, { name: 'Smirk' }, { name: 'Kitty' }],
    glasses: [{ name: 'None' }, { name: 'Round' }, { name: 'Square' }, { name: 'Shades' }],
    facial: [{ name: 'None' }, { name: 'Mustache' }, { name: 'Beard' }, { name: 'Goatee' }],
  };

  const INT_FIELDS = {
    skin: OPTIONS.skins.length, hairStyle: OPTIONS.hairStyles.length, hairColor: OPTIONS.hairColors.length,
    eyes: OPTIONS.eyes.length, eyeColor: OPTIONS.eyeColors.length, brows: OPTIONS.brows.length,
    nose: OPTIONS.noses.length, mouth: OPTIONS.mouths.length, glasses: OPTIONS.glasses.length,
    facial: OPTIONS.facial.length, shirt: OPTIONS.shirts.length, pants: OPTIONS.pants.length,
  };
  const VISUAL_FIELDS = Object.keys(INT_FIELDS).concat(['height', 'build', 'cheeks']);

  function defaultProfile(name = 'You') {
    return sanitize({
      name, skin: 1, hairStyle: 1, hairColor: 1, eyes: 0, eyeColor: 1, brows: 0, nose: 0, mouth: 0,
      glasses: 0, facial: 0, shirt: 5, pants: 0, height: 0.5, build: 0.5, cheeks: true,
    });
  }

  function randomProfile(rng, name) {
    rng = rng || SS.util.rng();
    const hairStyle = rng.int(0, 9);
    const longish = hairStyle === 3 || hairStyle === 4 || hairStyle === 5 || hairStyle === 9;
    const funHair = rng.chance(0.08);
    return sanitize({
      name: name || 'Pal',
      skin: rng.int(0, 5), hairStyle,
      hairColor: funHair ? rng.int(8, 9) : rng.pick([0, 0, 1, 1, 2, 3, 4, 5, 6]),
      eyes: rng.int(0, 5), eyeColor: rng.int(0, 5), brows: rng.int(0, 4), nose: rng.int(0, 3), mouth: rng.int(0, 4),
      glasses: rng.chance(0.25) ? rng.int(1, 3) : 0,
      facial: !longish && rng.chance(0.22) ? rng.int(1, 3) : 0,
      shirt: rng.int(0, 11), pants: rng.int(0, 7),
      height: rng.range(0.15, 0.85), build: rng.range(0.15, 0.85), cheeks: rng.chance(0.6),
    });
  }

  /** Returns a complete, valid profile (a new object); unknown fields are dropped. */
  function sanitize(p) {
    p = p || {};
    const out = {
      id: typeof p.id === 'string' && p.id ? p.id : SS.util.uid(),
      name: (String(p.name == null ? 'Pal' : p.name).trim().slice(0, 10)) || 'Pal',
    };
    for (const k of Object.keys(INT_FIELDS)) {
      const v = Math.round(Number(p[k]));
      out[k] = isFinite(v) ? clamp(v, 0, INT_FIELDS[k] - 1) : 0;
    }
    out.height = isFinite(Number(p.height)) && p.height !== null ? clamp(Number(p.height), 0, 1) : 0.5;
    out.build = isFinite(Number(p.build)) && p.build !== null ? clamp(Number(p.build), 0, 1) : 0.5;
    out.cheeks = p.cheeks === undefined ? true : !!p.cheeks;
    out.created = isFinite(Number(p.created)) && p.created ? Number(p.created) : Date.now();
    out.isGuest = !!p.isGuest;
    return out;
  }

  function visualKey(p) {
    return VISUAL_FIELDS.map(k => (typeof p[k] === 'number' ? Math.round(p[k] * 100) / 100 : p[k] ? 1 : 0)).join(',');
  }

  // ---------------------------------------------------------------------------------------------
  // Geometry helpers (head-local surface mapping, 2D strokes projected as face decals)
  // ---------------------------------------------------------------------------------------------

  const W = () => SS.world;
  const geoCache = new Map();

  function cached(key, build) {
    let g = geoCache.get(key);
    if (!g) { g = build(); g.userData.shared = true; geoCache.set(key, g); }
    return g;
  }

  /** Point on a sphere of radius r around the head center (yaw: +X side, pitch: up). */
  function sph(yaw, pitch, r, out = new THREE.Vector3()) {
    const c = Math.cos(pitch);
    return out.set(r * Math.sin(yaw) * c, r * Math.sin(pitch), r * Math.cos(yaw) * c);
  }

  function color(hex) { return new THREE.Color(hex); }
  function shade(hex, l, s = 0) { return new THREE.Color(hex).offsetHSL(0, s, l); }

  function ellipsoid(rx, ry, rz, x, y, z, ws = 16, hs = 12) {
    const g = new THREE.SphereGeometry(1, ws, hs);
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    return g;
  }

  /** Flat ribbon along a 2D polyline with round joins/caps (non-indexed, z = layer offset). */
  function stroke(pts, w, z = 0) {
    const out = [], hw = w / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const l = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / l * hw, ny = (x1 - x0) / l * hw;
      out.push(x0 + nx, y0 + ny, z, x0 - nx, y0 - ny, z, x1 + nx, y1 + ny, z,
        x1 + nx, y1 + ny, z, x0 - nx, y0 - ny, z, x1 - nx, y1 - ny, z);
    }
    for (const [x, y] of pts) {
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * TAU, b = (k + 1) / 10 * TAU;
        out.push(x, y, z, x + Math.cos(a) * hw, y + Math.sin(a) * hw, z, x + Math.cos(b) * hw, y + Math.sin(b) * hw, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return g;
  }

  function curve(n, fn) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
  }

  /** Filled 2D shape (list of [x,y]) → non-indexed, subdivided geometry at layer z. */
  function fill(pts, z = 0, levels = 2) {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    let g = new THREE.ShapeGeometry(shape, 8).toNonIndexed();
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    for (let i = 0; i < levels; i++) g = subdivide(g);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, z);
    return g;
  }

  function ellipsePts(cx, cy, rx, ry, n = 28) {
    return curve(n - 1, t => [cx + Math.cos(t * TAU * (n - 1) / n) * rx, cy + Math.sin(t * TAU * (n - 1) / n) * ry]);
  }

  function subdivide(g) {
    const a = g.attributes.position.array, out = [];
    const mid = (i, j) => [(a[i] + a[j]) / 2, (a[i + 1] + a[j + 1]) / 2, (a[i + 2] + a[j + 2]) / 2];
    for (let t = 0; t < a.length; t += 9) {
      const A = [a[t], a[t + 1], a[t + 2]], B = [a[t + 3], a[t + 4], a[t + 5]], C = [a[t + 6], a[t + 7], a[t + 8]];
      const AB = mid(t, t + 3), BC = mid(t + 3, t + 6), CA = mid(t + 6, t);
      out.push(...A, ...AB, ...CA, ...AB, ...B, ...BC, ...CA, ...BC, ...C, ...AB, ...BC, ...CA);
    }
    g.dispose();
    const n = new THREE.BufferGeometry();
    n.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return n;
  }

  /** Wraps a 2D decal (meters, z = layer) onto the head sphere around (yaw0, pitch0). */
  function decal(g, yaw0, pitch0, off, hex) {
    const pos = g.attributes.position, v = new THREE.Vector3();
    const nor = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), w = pos.getY(i), layer = pos.getZ(i);
      sph(yaw0 + u / HEAD_R, pitch0 + w / HEAD_R, HEAD_R + off + layer, v);
      pos.setXYZ(i, v.x, v.y, v.z);
      v.normalize();
      nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return hex == null ? g : W().paint(g, hex);
  }

  function orient(g, dir) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.applyQuaternion(q);
    return g;
  }

  // ---------------------------------------------------------------------------------------------
  // Face layout & palettes
  // ---------------------------------------------------------------------------------------------

  const FACE = { eyePitch: -0.02, browPitch: 0.26, nosePitch: -0.16, mouthPitch: -0.34, cheekYaw: 0.5, cheekPitch: -0.21 };
  const INK = 0x24110E, MOUTH_IN = 0x5A1320, TONGUE = 0xFF8A9A, TEETH = 0xFFFFFF;
  const SOLE = 0x56607A, SHOE = 0xF8F8F6, FRAME = 0x2A2C34, LENS = 0x1E2A36;

  const EYE_STYLES = [
    { rx: 0.034, ry: 0.047, yaw: 0.3 },
    { rx: 0.03, ry: 0.056, yaw: 0.29 },
    { rx: 0.027, ry: 0.035, yaw: 0.3 },
    { rx: 0.037, ry: 0.043, yaw: 0.355 },
    { rx: 0.035, ry: 0.047, yaw: 0.3, open: 0.6 },
    { rx: 0.038, ry: 0.053, yaw: 0.3, sparkle: true },
  ];

  // ---------------------------------------------------------------------------------------------
  // Part builders (all vertex colored; cached & shared where profile-independent)
  // ---------------------------------------------------------------------------------------------

  function headGeometry(p, low) {
    return cached('head|' + p.skin + '|' + p.nose + '|' + low, () => {
      const skin = OPTIONS.skins[p.skin];
      const parts = [];
      parts.push(W().paint(new THREE.SphereGeometry(HEAD_R, low ? 20 : 40, low ? 14 : 28), skin));
      for (const s of [-1, 1]) {
        parts.push(W().paint(ellipsoid(0.03, 0.052, 0.04, s * HEAD_R * 0.97, -0.02, -0.01, 10, 8), shade(skin, -0.03)));
      }
      const noseCol = shade(skin, -0.05, 0.05);
      const n = sph(0, FACE.nosePitch, HEAD_R - 0.008);
      const noses = [
        [0.028, 0.024, 0.024, 0],
        [0.04, 0.034, 0.03, 0],
        [0.026, 0.044, 0.034, -0.012],
        [0.046, 0.026, 0.026, 0],
      ];
      const [rx, ry, rz, dy] = noses[p.nose];
      parts.push(W().paint(ellipsoid(rx, ry, rz, n.x, n.y + dy, n.z, 14, 10), noseCol));
      return W().mergeGeometries(parts);
    });
  }

  function hairCap(theta, tilt, scale, seg) {
    const g = new THREE.SphereGeometry(HEAD_R * scale, seg, Math.round(seg / 2), 0, TAU, 0, theta);
    g.rotateX(-tilt);
    return g;
  }

  function hairParts(style, low) {
    const seg = low ? 18 : 32;
    const parts = [], ties = [];
    const cap = (theta, tilt, scale) => parts.push(hairCap(theta, tilt, scale, seg));
    switch (style) {
      case 0: { // Crop with a soft brushed-up quiff
        cap(1.42, 0.42, 1.065);
        const q = ellipsoid(0.13, 0.055, 0.085, 0, 0, 0, 20, 12);
        q.rotateX(-0.75);
        const p = sph(0.05, 0.86, HEAD_R * 1.03);
        q.translate(p.x, p.y, p.z);
        parts.push(q);
        break;
      }
      case 1: { // Side part with a swoop
        cap(1.5, 0.4, 1.07);
        const g = ellipsoid(0.17, 0.07, 0.13, 0, 0, 0, 20, 12);
        g.rotateZ(-0.32); g.rotateY(0.25);
        const p = sph(-0.22, 0.72, HEAD_R * 0.98);
        g.translate(p.x, p.y, p.z);
        parts.push(g);
        break;
      }
      case 2: { // Spiky
        cap(1.38, 0.45, 1.05);
        const spikes = [[0, 1.45, 1.1], [-0.6, 1.2, 1], [0.6, 1.2, 1], [-1.3, 1.0, 0.95], [1.3, 1.0, 0.95],
          [-2.2, 0.95, 0.9], [2.2, 0.95, 0.9], [Math.PI, 1.0, 0.95], [-0.3, 0.85, 0.9], [0.3, 0.85, 0.9]];
        for (const [yaw, pitch, s] of spikes) {
          const dir = sph(yaw, pitch, 1);
          dir.y += 0.6; dir.z -= 0.25;
          const cone = new THREE.ConeGeometry(0.055 * s, 0.15 * s, 7, 1);
          cone.translate(0, 0.06 * s, 0);
          orient(cone, dir);
          const p = sph(yaw, pitch, HEAD_R * 0.98);
          cone.translate(p.x, p.y, p.z);
          parts.push(cone);
        }
        break;
      }
      case 3: case 4: { // Bob / Long
        const longHair = style === 4;
        cap(1.25, 0.22, 1.1);
        const shell = new THREE.SphereGeometry(HEAD_R * 1.1, seg, Math.round(seg / 2), Math.PI / 2 + 0.95, TAU - 1.9, 0.45, longHair ? 1.75 : 1.55);
        parts.push(shell);
        // soft flicked rim at the bottom of the shell
        const rimTheta = longHair ? 2.2 : 2.0;
        const rim = new THREE.TorusGeometry(HEAD_R * 1.1 * Math.sin(rimTheta), 0.022, 8, seg, TAU - 1.9);
        rim.rotateX(Math.PI / 2);
        rim.rotateY(-(Math.PI / 2 + 0.95));
        rim.translate(0, HEAD_R * 1.1 * Math.cos(rimTheta), 0);
        parts.push(rim);
        if (longHair) parts.push(ellipsoid(0.22, 0.27, 0.1, 0, -0.24, -0.15, 20, 14));
        break;
      }
      case 5: { // Ponytail
        cap(1.5, 0.42, 1.065);
        const tie = new THREE.TorusGeometry(0.034, 0.014, 8, 16);
        tie.translate(0, 0.03, -HEAD_R * 1.06);
        ties.push(tie);
        const tail = ellipsoid(0.07, 0.17, 0.075, 0, 0, 0, 16, 12);
        tail.rotateX(0.35);
        tail.translate(0, -0.11, -HEAD_R * 1.18);
        parts.push(tail);
        break;
      }
      case 6: { // Bun
        cap(1.5, 0.42, 1.06);
        parts.push(ellipsoid(0.095, 0.085, 0.095, 0, HEAD_R * 1.03, -0.07, 18, 12));
        const tie = new THREE.TorusGeometry(0.07, 0.013, 8, 20);
        tie.rotateX(Math.PI / 2 - 0.3);
        tie.translate(0, HEAD_R * 0.98, -0.06);
        ties.push(tie);
        break;
      }
      case 7: { // Curly: a soft mass of overlapping curls
        cap(1.5, 0.38, 1.1);
        const n = low ? 34 : 70;
        for (let i = 0; i < n; i++) {
          const y = 1 - (i + 0.5) / n * 1.3;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const a = i * 2.39996;
          const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
          if (d.y < -0.25) continue;
          if (d.z > 0.5 && d.y < 0.62) continue;
          const s = 0.062 + ((i * 37) % 7) / 7 * 0.014;
          parts.push(ellipsoid(s, s, s, d.x * HEAD_R * 1.1, d.y * HEAD_R * 1.08 + 0.025, d.z * HEAD_R * 1.1 - 0.012, low ? 8 : 12, low ? 6 : 9));
        }
        break;
      }
      case 8: // Buzz
        cap(1.55, 0.38, 1.018);
        break;
      case 9: { // Pigtails
        cap(1.5, 0.42, 1.06);
        for (const s of [-1, 1]) {
          const bunch = ellipsoid(0.072, 0.15, 0.075, 0, 0, 0, 16, 12);
          bunch.rotateZ(s * 0.45);
          bunch.translate(s * 0.3, -0.07, -0.05);
          parts.push(bunch);
          const tie = new THREE.TorusGeometry(0.034, 0.013, 8, 16);
          tie.rotateY(Math.PI / 2);
          tie.rotateZ(s * 0.45);
          tie.translate(s * 0.255, 0.02, -0.05);
          ties.push(tie);
        }
        break;
      }
    }
    return { parts, ties };
  }

  function facialParts(kind) {
    const parts = [];
    if (kind === 1 || kind === 3) { // Mustache (the goatee gets a slimmer one)
      const k = kind === 3 ? 0.8 : 1;
      for (const s of [-1, 1]) {
        const p = sph(s * 0.12, -0.255, HEAD_R + 0.004);
        const m = ellipsoid(0.045 * k, 0.019 * k, 0.022, 0, 0, 0, 14, 8);
        m.rotateZ(s * 0.28);
        m.rotateY(s * 0.12);
        m.translate(p.x, p.y, p.z);
        parts.push(m);
      }
    } else if (kind === 2) { // Beard: a soft jaw-line shell that leaves the mouth clear
      const g = new THREE.SphereGeometry(HEAD_R * 1.035, 32, 12, 0, TAU, Math.PI - 1.3, 1.3);
      g.rotateX(0.31);
      parts.push(g);
    }
    if (kind === 3) { // Goatee: a chin patch hugging the surface
      const p = sph(0, -0.68, HEAD_R - 0.01);
      const g = ellipsoid(0.04, 0.042, 0.02, 0, 0, 0, 14, 10);
      g.rotateX(0.68);
      g.translate(p.x, p.y, p.z);
      parts.push(g);
    }
    return parts;
  }

  function glassesParts(kind, eyeYaw) {
    const parts = [];
    if (!kind) return parts;
    const e = sph(eyeYaw, FACE.eyePitch, HEAD_R);
    const z = 0.262, y = e.y + 0.004;
    const lensW = kind === 1 ? 0.056 : 0.06;
    for (const s of [-1, 1]) {
      const cx = s * 0.078;
      if (kind === 1) {
        const ring = new THREE.TorusGeometry(lensW, 0.0075, 8, 28);
        ring.translate(cx, y, z);
        parts.push(W().paint(ring, FRAME));
      } else {
        const outer = new THREE.Shape();
        const w = 0.064, h = kind === 3 ? 0.044 : 0.047, r = 0.022;
        outer.moveTo(-w + r, -h); outer.lineTo(w - r, -h); outer.quadraticCurveTo(w, -h, w, -h + r);
        outer.lineTo(w, h - r); outer.quadraticCurveTo(w, h, w - r, h); outer.lineTo(-w + r, h);
        outer.quadraticCurveTo(-w, h, -w, h - r); outer.lineTo(-w, -h + r); outer.quadraticCurveTo(-w, -h, -w + r, -h);
        if (kind === 2) {
          const hole = new THREE.Path();
          const iw = w - 0.009, ih = h - 0.009, ir = r - 0.008;
          hole.moveTo(-iw + ir, -ih); hole.quadraticCurveTo(-iw, -ih, -iw, -ih + ir); hole.lineTo(-iw, ih - ir);
          hole.quadraticCurveTo(-iw, ih, -iw + ir, ih); hole.lineTo(iw - ir, ih); hole.quadraticCurveTo(iw, ih, iw, ih - ir);
          hole.lineTo(iw, -ih + ir); hole.quadraticCurveTo(iw, -ih, iw - ir, -ih); hole.lineTo(-iw + ir, -ih);
          outer.holes.push(hole);
        }
        const g = new THREE.ExtrudeGeometry(outer, { depth: 0.01, bevelEnabled: false, curveSegments: 6 });
        g.deleteAttribute('uv');
        g.translate(cx, y, z - 0.005);
        parts.push(W().paint(g, kind === 3 ? LENS : FRAME));
      }
      // temple arm back to the ear
      const from = new THREE.Vector3(s * (0.078 + lensW + 0.004), y + 0.01, z - 0.004);
      const to = new THREE.Vector3(s * HEAD_R * 1.0, y + 0.02, -0.02);
      const len = from.distanceTo(to);
      const arm = new THREE.CylinderGeometry(0.0055, 0.0055, len, 6);
      orient(arm, to.clone().sub(from));
      arm.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      parts.push(W().paint(arm, FRAME));
    }
    const bridge = new THREE.CylinderGeometry(0.0065, 0.0065, 0.156 - 2 * lensW + 0.012, 6);
    bridge.rotateZ(Math.PI / 2);
    bridge.translate(0, y + 0.012, z + 0.002);
    parts.push(W().paint(bridge, FRAME));
    return parts;
  }

  /** Hair + facial hair + glasses + hair ties, one mesh (double-sided material). */
  function hairGeometry(p, low) {
    const key = ['hair', p.hairStyle, p.hairColor, p.facial, p.glasses, p.shirt, p.eyes, p.skin, low].join('|');
    return cached(key, () => {
      const hc = OPTIONS.hairColors[p.hairColor];
      const top = shade(hc, 0.06), bottom = shade(hc, -0.06);
      const { parts, ties } = hairParts(p.hairStyle, low);
      const out = [];
      const tint = p.hairStyle === 8 ? color(hc).lerp(color(OPTIONS.skins[p.skin]), 0.3) : null;
      for (const g of parts) {
        if (tint) W().paint(g, tint);
        else W().paint(g, (x, y, z, c) => c.copy(bottom).lerp(top, clamp((y + 0.1) / 0.4, 0, 1)));
        out.push(g);
      }
      for (const g of ties) out.push(W().paint(g, shade(OPTIONS.shirts[p.shirt], -0.04)));
      for (const g of facialParts(p.facial)) out.push(W().paint(g, shade(hc, -0.03)));
      for (const g of glassesParts(p.glasses, EYE_STYLES[p.eyes].yaw)) out.push(g);
      return out.length ? W().mergeGeometries(out) : null;
    });
  }

  function eyeGeometry(p, low) {
    return cached('eye|' + p.eyes + '|' + p.eyeColor + '|' + low, () => {
      const st = EYE_STYLES[p.eyes];
      const parts = [W().paint(ellipsoid(st.rx, st.ry, 0.016, 0, 0, 0, low ? 10 : 18, low ? 8 : 14), OPTIONS.eyeColors[p.eyeColor])];
      const gr = Math.min(st.rx, st.ry) * 0.36;
      parts.push(W().paint(ellipsoid(gr, gr, gr * 0.6, st.rx * 0.32, st.ry * 0.38, 0.014, 10, 8), 0xFFFFFF));
      if (st.sparkle) parts.push(W().paint(ellipsoid(gr * 0.5, gr * 0.5, gr * 0.3, -st.rx * 0.3, -st.ry * 0.36, 0.014, 8, 6), 0xFFFFFF));
      return W().mergeGeometries(parts);
    });
  }

  function browGeometry(p) {
    return cached('brow|' + p.brows + '|' + p.hairColor, () => {
      let hc = color(OPTIONS.hairColors[p.hairColor]);
      const hsl = {}; hc.getHSL(hsl);
      if (hsl.l > 0.35) hc = hc.offsetHSL(0, 0, -Math.min(0.32, hsl.l - 0.3));
      let g;
      if (p.brows === 3) {
        g = new THREE.TorusGeometry(0.055, 0.0105, 6, 14, 1.15);
        g.rotateZ(Math.PI / 2 - 0.575);
        g.translate(0, -0.05, 0);
      } else {
        const dims = [[0.0115, 0.05], [0.017, 0.054], [0.0075, 0.056], null, [0.0135, 0.066]][p.brows];
        g = new THREE.CapsuleGeometry(dims[0], dims[1], 4, 10);
        g.rotateZ(Math.PI / 2);
        if (p.brows === 4) g.scale(1, 0.85, 1);
      }
      g.scale(1, 1, 0.55);
      g.deleteAttribute('uv');
      return W().paint(g, hc);
    });
  }

  // Mouth shapes, in face-plane meters around the mouth anchor (y up).
  function smileCurve(w, depth, lift = 0) { return curve(16, t => { const x = (t - 0.5) * 2 * w; return [x, depth * (x / w) * (x / w) - depth * 0.5 + lift]; }); }

  function openMouth(scale, tongue) {
    const w = 0.058 * scale, h = 0.05 * scale, top = 0.012 * scale, lift = 0.009 * scale;
    const topY = x => top + lift * (x / w) * (x / w);
    const outline = [];
    for (let i = 0; i <= 20; i++) { const a = Math.PI + i / 20 * Math.PI; outline.push([Math.cos(a) * w, top + Math.sin(a) * h]); }
    for (let i = 19; i >= 1; i--) { const x = (i / 20 - 0.5) * 2 * w; outline.push([x, topY(x)]); }
    const parts = [W().paint(fill(outline, 0), MOUTH_IN)];
    if (tongue) parts.push(W().paint(fill(ellipsePts(0.004 * scale, -0.026 * scale, 0.028 * scale, 0.014 * scale), 0.0008), TONGUE));
    const tw = w * 0.72, th = 0.011 * scale;
    const teeth = [];
    for (let i = 0; i <= 10; i++) { const x = -tw + i / 10 * 2 * tw; teeth.push([x, topY(x) - th]); }
    for (let i = 10; i >= 0; i--) { const x = -tw + i / 10 * 2 * tw; teeth.push([x, topY(x) + 0.001]); }
    parts.push(W().paint(fill(teeth, 0.0008, 1), TEETH));
    const ring = outline.slice(); ring.push(outline[0]);
    parts.push(W().paint(stroke(ring, 0.0065 * Math.max(0.8, scale), 0.0014), INK));
    return parts;
  }

  const MOUTHS = {
    smile: () => [W().paint(stroke(smileCurve(0.044, 0.027), 0.015), INK)],
    calm: () => [W().paint(stroke(smileCurve(0.032, 0.017), 0.014), INK)],
    beam: () => openMouth(0.72, false),
    grin: () => openMouth(1, true),
    frown: () => [W().paint(stroke(smileCurve(0.037, -0.021, -0.004), 0.015), INK)],
    flat: () => [W().paint(stroke(smileCurve(0.028, 0.004), 0.014), INK)],
    smirk: () => [W().paint(stroke(curve(14, t => { const x = -0.034 + t * 0.078; return [x, 0.024 * Math.pow(t, 2.2) - 0.008]; }), 0.014), INK)],
    kitty: () => [W().paint(stroke(curve(24, t => {
      const x = -0.034 + t * 0.068, c = x < 0 ? -0.017 : 0.017;
      return [x, -Math.sqrt(Math.max(0, 0.017 * 0.017 - (x - c) * (x - c))) * 0.9 + 0.006];
    }), 0.013), INK)],
    o: () => {
      const ring = ellipsePts(0, -0.004, 0.026, 0.034);
      return [W().paint(fill(ring, 0), MOUTH_IN),
        W().paint(fill(ellipsePts(0, -0.022, 0.016, 0.009), 0.0008, 1), TONGUE),
        W().paint(stroke(ring.concat([ring[0]]), 0.0065, 0.0014), INK)];
    },
    grit: () => {
      const w = 0.046, h = 0.017, r = 0.012;
      const rr = [];
      const corners = [[w - r, h - r, 0], [-w + r, h - r, Math.PI / 2], [-w + r, -h + r, Math.PI], [w - r, -h + r, Math.PI * 1.5]];
      for (const [cx, cy, a0] of corners) for (let i = 0; i <= 5; i++) { const a = a0 + i / 5 * Math.PI / 2; rr.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      return [W().paint(fill(rr, 0), TEETH),
        W().paint(stroke([[-w + 0.004, 0], [w - 0.004, 0]], 0.004, 0.0008), INK),
        W().paint(stroke(rr.concat([rr[0]]), 0.0065, 0.0014), INK)];
    },
  };
  const PROFILE_MOUTHS = ['smile', 'beam', 'calm', 'smirk', 'kitty'];

  const MOUTH_PIVOT = sph(0, FACE.mouthPitch, HEAD_R);

  /** Mouth decal, relative to MOUTH_PIVOT so expression changes can pop it around its center. */
  function mouthGeometry(name) {
    return cached('mouth|' + name, () => {
      const g = W().mergeGeometries(MOUTHS[name]().map(part => decal(part, 0, FACE.mouthPitch, 0.0022, null)));
      g.translate(-MOUTH_PIVOT.x, -MOUTH_PIVOT.y, -MOUTH_PIVOT.z);
      return g;
    });
  }

  function eyeAltGeometry(kind, side) {
    return cached('eyealt|' + kind + '|' + side, () => {
      let pts;
      if (kind === 'arc') pts = curve(14, t => { const x = (t - 0.5) * 0.064; return [x, -0.026 * (x / 0.032) * (x / 0.032) + 0.012]; });
      else pts = [[-0.022 * side, 0.02], [0.02 * side, 0.0], [-0.022 * side, -0.02]];
      const g = stroke(pts, kind === 'arc' ? 0.015 : 0.014);
      const pos = g.attributes.position, nor = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) nor[i * 3 + 2] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      return W().paint(g, INK);
    });
  }

  function blushGeometry() {
    return cached('blush', () => {
      const parts = [];
      for (const s of [-1, 1]) {
        const g = new THREE.PlaneGeometry(0.085, 0.05, 6, 4);
        g.deleteAttribute('normal');
        decal(g, s * FACE.cheekYaw, FACE.cheekPitch, 0.0015, 0xffffff);
        g.deleteAttribute('color');
        parts.push(g);
      }
      return W().mergeGeometries(parts);
    });
  }

  function handGeometry(p, low) {
    const r = Math.round((0.072 + p.build * 0.012) * 1000) / 1000;
    return cached('hand|' + p.skin + '|' + r + '|' + low, () =>
      W().paint(new THREE.SphereGeometry(r, low ? 12 : 20, low ? 9 : 16), OPTIONS.skins[p.skin]));
  }

  function shoeGeometry(low) {
    return cached('shoe|' + low, () => {
      const g = ellipsoid(0.088, 0.062, 0.135, 0, -0.008, 0.036, low ? 12 : 22, low ? 8 : 16);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.058) pos.setY(i, -0.058);
      g.computeVertexNormals();
      return W().paint(g, (x, y, z, c) => c.set(y < -0.046 ? SOLE : SHOE));
    });
  }

  function torsoGeometry(p, d, low) {
    const shirt = OPTIONS.shirts[p.shirt], pants = OPTIONS.pants[p.pants];
    const n = low ? 14 : 26, split = 0.24;
    const profile = t => {
      const a = t * Math.PI;
      const r = d.torsoR * Math.pow(Math.sin(a), 0.82) * (1.04 - 0.16 * t);
      return new THREE.Vector2(Math.max(0.0005, r), d.torsoBottom + (1 - Math.cos(a)) / 2 * d.torsoH);
    };
    const lower = [], upper = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (t <= split) lower.push(profile(t));
      if (t >= split) upper.push(profile(t));
    }
    lower.push(profile(split));
    upper.unshift(profile(split));
    const seg = low ? 14 : 28;
    const parts = [
      W().paint(new THREE.LatheGeometry(lower, seg), pants),
      W().paint(new THREE.LatheGeometry(upper, seg), shirt),
    ];
    // collar ring
    const ct = 0.9, cp = profile(ct);
    const collar = new THREE.TorusGeometry(cp.x * 0.98, 0.016, 8, seg);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, cp.y, 0);
    parts.push(W().paint(collar, shade(shirt, shirt === 0xF4F4F0 ? -0.12 : 0.1)));
    // waistband
    const wp = profile(split);
    const band = new THREE.TorusGeometry(wp.x * 1.005, 0.012, 6, seg);
    band.rotateX(Math.PI / 2);
    band.translate(0, wp.y, 0);
    parts.push(W().paint(band, shade(pants, -0.05)));
    for (const g of parts) if (g.attributes.uv) g.deleteAttribute('uv');
    return W().mergeGeometries(parts);
  }

  function legGeometry(p, d, low) {
    const g = new THREE.CapsuleGeometry(d.legR, Math.max(0.05, d.legLen - d.legR), 4, low ? 8 : 12);
    g.translate(0, -d.legLen / 2, 0);
    g.deleteAttribute('uv');
    return W().paint(g, OPTIONS.pants[p.pants]);
  }

  // ---------------------------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------------------------

  let mats = null;
  function palMaterials() {
    if (mats) return mats;
    const shared = m => { m.userData.shared = true; return m; };
    let blushTex;
    {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      blushTex = shared(new THREE.CanvasTexture(c));
    }
    mats = {
      body: shared(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 42, specular: 0x262626 })),
      hair: shared(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 22, specular: 0x1c1c1c, side: THREE.DoubleSide })),
      eye: shared(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x777777 })),
      flat: shared(new THREE.MeshBasicMaterial({ vertexColors: true })),
      blush: shared(new THREE.MeshBasicMaterial({
        color: 0xFF7C8E, map: blushTex, transparent: true, opacity: 0.55, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      })),
    };
    return mats;
  }

  // ---------------------------------------------------------------------------------------------
  // Animation library. Each fn writes a full pose into o (pre-filled with the rest pose).
  // Hands are relative to the standing body (the rig adds body motion); feet are ground-space.
  // Left = +X (pals face +Z).
  // ---------------------------------------------------------------------------------------------

  const Y = 0, CROUCH = 1, LEAN = 2, TILT = 3, TWIST = 4, SQUASH = 5, HP = 6, HY = 7, HR = 8,
    HLX = 9, HLY = 10, HLZ = 11, HRX = 12, HRY = 13, HRZ = 14,
    FLX = 15, FLY = 16, FLZ = 17, FLP = 18, FRX = 19, FRY = 20, FRZ = 21, FRP = 22, BX = 23, BZ = 24;
  const NCH = 25;
  const BODY_CHANNELS = [CROUCH, LEAN, TILT, TWIST];

  function restPose(o, d) {
    o.fill(0);
    o[SQUASH] = 1;
    o[HLX] = d.handX; o[HLY] = d.handY; o[HLZ] = d.handZ;
    o[HRX] = -d.handX; o[HRY] = d.handY; o[HRZ] = d.handZ;
    o[FLX] = d.footX; o[FLY] = d.ankle; o[FLZ] = 0.01;
    o[FRX] = -d.footX; o[FRY] = d.ankle; o[FRZ] = 0.01;
  }

  function hands(o, lx, ly, lz, rx, ry, rz) {
    o[HLX] = lx; o[HLY] = ly; o[HLZ] = lz; o[HRX] = rx; o[HRY] = ry; o[HRZ] = rz;
  }

  function blendHands(o, k, lx, ly, lz, rx, ry, rz) {
    o[HLX] = lerp(o[HLX], lx, k); o[HLY] = lerp(o[HLY], ly, k); o[HLZ] = lerp(o[HLZ], lz, k);
    o[HRX] = lerp(o[HRX], rx, k); o[HRY] = lerp(o[HRY], ry, k); o[HRZ] = lerp(o[HRZ], rz, k);
  }

  /** One jump cycle (p 0..1): anticipation squat, airtime parabola, landing squash. */
  function jumpCycle(o, p, height, d) {
    if (p < 0.2) {
      const q = Math.sin(p / 0.2 * Math.PI);
      o[CROUCH] = 0.55 * q; o[SQUASH] = 1 - 0.07 * q;
    } else if (p < 0.8) {
      const q = (p - 0.2) / 0.6;
      const y = height * 4 * q * (1 - q);
      o[Y] = y;
      o[SQUASH] = 1 + 0.07 * Math.pow(Math.abs(2 * q - 1), 2);
      o[FLY] = d.ankle + y * 0.92; o[FRY] = d.ankle + y * 0.92;
      o[FLZ] -= 0.03 * Math.sin(q * Math.PI); o[FRZ] -= 0.03 * Math.sin(q * Math.PI);
      o[FLP] = o[FRP] = 0.35 * Math.sin(q * Math.PI);
    } else {
      const q = Math.sin((p - 0.8) / 0.2 * Math.PI);
      o[CROUCH] = 0.4 * q; o[SQUASH] = 1 - 0.09 * q;
    }
    return o[Y];
  }

  const ANIMS = {
    idle: {
      loop: true,
      fn(o, t, d) {
        const b = Math.sin(t * TAU / 3.4);
        o[SQUASH] = 1 + 0.014 * b; o[Y] = 0.003 * b;
        o[TILT] = 0.02 * Math.sin(t * 0.6); o[BX] = 0.01 * Math.sin(t * 0.45);
        o[HR] = 0.035 * Math.sin(t * 0.7 + 1);
        o[HY] = 0.14 * Math.sin(t * 0.31) * Math.sin(t * 0.13 + 0.5);
        o[HP] = -0.02 + 0.02 * Math.sin(t * 0.5);
        const hb = 0.014 * Math.sin(t * TAU / 3.4 - 0.7);
        o[HLY] += hb; o[HRY] += hb; o[HLX] += 0.006 * b; o[HRX] -= 0.006 * b;
      },
    },
    idle_ready: {
      loop: true,
      fn(o, t, d) {
        const b = Math.abs(Math.sin(t * Math.PI * 2.3));
        o[CROUCH] = 0.55 + 0.06 * b; o[LEAN] = 0.2; o[Y] = 0.008 * b;
        o[FLX] = d.footX + 0.1; o[FRX] = -d.footX - 0.1; o[FLZ] = 0.05; o[FRZ] = -0.02;
        hands(o, d.handX - 0.07, d.handY + 0.06 - 0.01 * b, 0.3, -d.handX + 0.07, d.handY + 0.06 - 0.01 * b, 0.3);
        o[HP] = -0.14; o[HR] = 0.02 * Math.sin(t * 1.3);
      },
    },
    walk: {
      loop: true, stride: 1.05,
      fn(o, t, d, P) {
        const a = clamp(P.speedFor('walk') / 1.3, 0, 1.3);
        const ph = P.phase * TAU, s = Math.sin(ph), c = Math.cos(ph);
        const stride = 0.17 * d.k * a;
        o[FLZ] = 0.01 + stride * s; o[FRZ] = 0.01 - stride * s;
        o[FLY] = d.ankle + 0.07 * a * Math.max(0, c); o[FRY] = d.ankle + 0.07 * a * Math.max(0, -c);
        o[FLP] = -0.25 * a * Math.max(0, c); o[FRP] = -0.25 * a * Math.max(0, -c);
        o[Y] = 0.022 * a * Math.abs(c) - 0.012 * a;
        o[TWIST] = 0.1 * a * s; o[TILT] = 0.035 * a * s; o[LEAN] = 0.06 * a;
        o[HLZ] = d.handZ - 0.15 * a * s; o[HRZ] = d.handZ + 0.15 * a * s;
        o[HLY] += 0.02 * a * Math.max(0, -s); o[HRY] += 0.02 * a * Math.max(0, s);
        o[HLX] -= 0.02 * a; o[HRX] += 0.02 * a;
        o[HP] = -0.02 * a * Math.abs(c);
      },
    },
    run: {
      loop: true, stride: 1.75,
      fn(o, t, d, P) {
        const a = clamp(P.speedFor('run') / 4, 0.35, 1.4);
        const ph = P.phase * TAU, s = Math.sin(ph), c = Math.cos(ph);
        const stride = 0.27 * d.k * a;
        o[FLZ] = 0.02 + stride * s; o[FRZ] = 0.02 - stride * s;
        o[FLY] = d.ankle + 0.17 * a * Math.max(0, c); o[FRY] = d.ankle + 0.17 * a * Math.max(0, -c);
        o[FLP] = -0.4 * a * Math.max(0, c) + 0.3 * a * Math.max(0, -c);
        o[FRP] = -0.4 * a * Math.max(0, -c) + 0.3 * a * Math.max(0, c);
        o[Y] = 0.05 * a * Math.abs(c) + 0.01;
        o[CROUCH] = 0.18 * (1 - Math.abs(c));
        o[SQUASH] = 1 + 0.035 * (Math.abs(c) - 0.5);
        o[LEAN] = 0.26 * a; o[TWIST] = 0.16 * a * s; o[TILT] = 0.03 * a * s;
        hands(o, d.handX - 0.06, d.handY + 0.1 + 0.06 * Math.max(0, -s), d.handZ + 0.04 - 0.24 * a * s,
          -d.handX + 0.06, d.handY + 0.1 + 0.06 * Math.max(0, s), d.handZ + 0.04 + 0.24 * a * s);
        o[HP] = -0.16 * a;
      },
    },
    cheer: {
      dur: 1.8, expr: 'joy',
      fn(o, t, d) {
        const e = bump(t, 1.8, 0.15, 0.3);
        jumpCycle(o, (t % 0.9) / 0.9, 0.26 * e, d);
        const pump = Math.sin(t * 7.5);
        blendHands(o, e, d.handX - 0.04 + 0.025 * pump, d.headY + 0.26 + 0.05 * pump, 0.06,
          -d.handX + 0.04 - 0.025 * pump, d.headY + 0.26 - 0.05 * pump, 0.06);
        o[HP] = -0.16 * e; o[HR] = 0.08 * Math.sin(t * 5) * e;
      },
    },
    jump: {
      dur: 1.05, expr: 'joy',
      fn(o, t, d) {
        const p = clamp(t / 1.05, 0, 1);
        const y = jumpCycle(o, p, 0.42, d);
        const air = y / 0.42;
        const pre = p < 0.2 ? Math.sin(p / 0.2 * Math.PI) : 0;
        blendHands(o, pre, d.handX + 0.04, d.handY - 0.1, -0.12, -d.handX - 0.04, d.handY - 0.1, -0.12);
        blendHands(o, Math.min(1, air * 1.6), d.handX - 0.02, d.headY + 0.3, 0.04, -d.handX + 0.02, d.headY + 0.3, 0.04);
        o[HP] = -0.2 * air;
      },
    },
    clap: {
      dur: 1.5, expr: 'happy',
      fn(o, t, d) {
        const e = bump(t, 1.5, 0.15, 0.25);
        const sep = 0.074 + 0.085 * (0.5 + 0.5 * Math.cos(TAU * 3.2 * t));
        blendHands(o, e, sep, d.handY + 0.17, 0.25, -sep, d.handY + 0.17, 0.25);
        o[Y] = 0.012 * Math.abs(Math.sin(Math.PI * 3.2 * t)) * e;
        o[HP] = -0.06 * e; o[HR] = 0.06 * Math.sin(t * 4) * e;
      },
    },
    wave: {
      dur: 1.9, expr: 'happy',
      fn(o, t, d) {
        const e = bump(t, 1.9, 0.25, 0.3);
        const w = Math.sin(t * TAU * 2.1);
        o[HRX] = lerp(o[HRX], -d.handX - 0.06 + 0.07 * w, e);
        o[HRY] = lerp(o[HRY], d.headY + 0.08 + 0.015 * Math.abs(w), e);
        o[HRZ] = lerp(o[HRZ], 0.1, e);
        o[TILT] = 0.06 * e; o[HR] = -0.12 * e; o[HP] = -0.04 * e;
        o[HLY] += 0.01 * Math.sin(t * 3);
      },
    },
    sad: {
      dur: 2.4, expr: 'sad',
      fn(o, t, d) {
        const e = bump(t, 2.4, 0.4, 0.45);
        o[LEAN] = 0.2 * e; o[HP] = 0.42 * e; o[Y] = -0.02 * e; o[SQUASH] = 1 - 0.04 * e; o[CROUCH] = 0.1 * e;
        o[TILT] = 0.04 * Math.sin(t * 1.3) * e; o[HY] = 0.1 * Math.sin(t * 2.2) * e * smoothstep(0.5, 1, t);
        blendHands(o, e, 0.1, d.handY - 0.06, 0.17, -0.1, d.handY - 0.06, 0.17);
      },
    },
    shrug: {
      dur: 1.4,
      fn(o, t, d) {
        const e = bump(t, 1.4, 0.25, 0.4);
        blendHands(o, e, d.handX + 0.12, d.handY + 0.13, 0.18, -d.handX - 0.12, d.handY + 0.13, 0.18);
        o[Y] = 0.03 * e; o[SQUASH] = 1 + 0.03 * e; o[HR] = 0.17 * e; o[HP] = -0.05 * e;
      },
    },
    dance: {
      loop: true, expr: 'happy',
      fn(o, t, d) {
        const b = Math.PI * 2 * t;            // two beats per second
        const s = Math.sin(b), up = 0.5 + 0.5 * Math.sin(Math.PI * t);
        o[Y] = 0.035 * Math.abs(s); o[CROUCH] = 0.25 * (1 - Math.abs(s));
        o[BX] = 0.05 * Math.sin(b / 2); o[TILT] = 0.12 * Math.sin(b / 2); o[TWIST] = 0.22 * Math.sin(b / 4);
        hands(o,
          d.handX + 0.08 * up, lerp(d.handY + 0.02, d.headY + 0.3, up), lerp(0.16, 0.06, up),
          -d.handX - 0.08 * (1 - up), lerp(d.handY + 0.02, d.headY + 0.3, 1 - up), lerp(0.16, 0.06, 1 - up));
        o[FLY] = d.ankle + 0.05 * Math.max(0, Math.sin(b / 2)); o[FRY] = d.ankle + 0.05 * Math.max(0, -Math.sin(b / 2));
        o[HR] = 0.12 * Math.sin(b / 2); o[HP] = -0.05 * Math.abs(s);
      },
    },
    bow: {
      dur: 1.9, expr: 'proud',
      fn(o, t, d) {
        const e = smoothstep(0.1, 0.55, t) * (1 - smoothstep(1.25, 1.85, t));
        o[LEAN] = 0.72 * e; o[HP] = 0.22 * e; o[BZ] = -0.05 * e; o[CROUCH] = 0.12 * e;
        blendHands(o, e, 0.13, d.handY - 0.1, 0.16 + 0.1 * e, -0.13, d.handY - 0.1, 0.16 + 0.1 * e);
      },
    },
    hop: {
      dur: 1.3, expr: 'joy',
      fn(o, t, d) {
        const e = bump(t, 1.3, 0.12, 0.2);
        jumpCycle(o, (t % 0.43) / 0.43, 0.13 * e, d);
        blendHands(o, e, d.handX - 0.06, d.handY + 0.3 + 0.03 * Math.sin(t * 15), 0.17,
          -d.handX + 0.06, d.handY + 0.3 + 0.03 * Math.sin(t * 15 + 1), 0.17);
        o[HR] = 0.1 * Math.sin(t * 7) * e;
      },
    },
    stumble: {
      dur: 1.5, expr: 'wince',
      fn(o, t, d) {
        const lurch = smoothstep(0, 0.25, t) * (1 - smoothstep(0.5, 1.2, t));
        const wob = smoothstep(0.15, 0.4, t) * (1 - smoothstep(0.9, 1.45, t));
        o[LEAN] = 0.42 * lurch - 0.12 * wob * Math.sin(t * 12);
        o[TILT] = 0.2 * wob * Math.sin(t * 9);
        o[BZ] = 0.08 * lurch;
        const step = smoothstep(0.08, 0.35, t) * (1 - smoothstep(0.95, 1.45, t));
        o[FRZ] = 0.01 + 0.26 * step;
        o[FRY] = d.ankle + 0.1 * Math.sin(Math.PI * clamp((t - 0.08) / 0.27, 0, 1));
        const a = t * 15;
        blendHands(o, wob, d.handX + 0.1, d.handY + 0.28 + 0.12 * Math.sin(a), 0.12 + 0.13 * Math.cos(a),
          -d.handX - 0.1, d.handY + 0.28 + 0.12 * Math.sin(a + Math.PI), 0.12 + 0.13 * Math.cos(a + Math.PI));
        o[HP] = -0.2 * lurch;
      },
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------------------------------

  const EXPRESSIONS = {
    neutral: { raise: 0, tilt: 0, sx: 1, sy: 1, eyes: 'open', mouth: null },
    happy: { raise: 0.01, tilt: -0.06, sx: 1, sy: 0.9, eyes: 'open', mouth: 'beam' },
    joy: { raise: 0.02, tilt: 0, sx: 1, sy: 1, eyes: 'arc', mouth: 'grin', blush: true },
    sad: { raise: 0.004, tilt: 0.38, sx: 0.95, sy: 0.85, eyes: 'open', mouth: 'frown' },
    surprised: { raise: 0.028, tilt: 0.08, sx: 1.18, sy: 1.25, eyes: 'open', mouth: 'o' },
    focus: { raise: -0.01, tilt: -0.3, sx: 1, sy: 0.7, eyes: 'open', mouth: 'flat' },
    wince: { raise: -0.008, tilt: -0.28, sx: 1, sy: 1, eyes: 'squeeze', mouth: 'grit' },
    proud: { raise: 0.014, tilt: -0.08, sx: 1, sy: 0.55, eyes: 'open', mouth: 'smirk', headUp: -0.1, blush: true },
  };

  // ---------------------------------------------------------------------------------------------
  // Pal
  // ---------------------------------------------------------------------------------------------

  function dimensions(p) {
    const k = lerp(0.88, 1.12, p.height);
    const w = lerp(0.84, 1.2, p.build);
    const d = { k, w };
    d.hipY = 0.45 * k;
    d.torsoBottom = -0.07 * k;
    d.torsoTop = 0.98 * k - d.hipY;
    d.torsoH = d.torsoTop - d.torsoBottom;
    d.torsoR = 0.222 * w;
    d.neckY = d.hipY + d.torsoTop - 0.03;
    d.headOffset = HEAD_R + 0.015;
    d.headY = d.neckY + d.headOffset;
    d.handX = d.torsoR + 0.1;
    d.handY = 0.72 * k;
    d.handZ = 0.06;
    d.footX = 0.095 * Math.sqrt(w);
    d.hipX = 0.085 * Math.sqrt(w);
    d.ankle = 0.06;
    d.legR = 0.076 * (0.92 + 0.16 * p.build);
    d.legLen = d.hipY - d.ankle;
    return d;
  }

  const DOWN = new THREE.Vector3(0, -1, 0);
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  class Pal {
    constructor(profile, opts = {}) {
      const p = this.profile = sanitize(profile);
      const low = opts.detail === 'low';
      const shadows = opts.shadows !== false;
      const M = palMaterials();
      const d = this.dims = dimensions(p);

      const root = this.root = new THREE.Group();
      root.name = 'pal:' + p.name;
      const mesh = (geo, mat, cast = shadows) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = cast; m.receiveShadow = false;
        return m;
      };

      // Body (hips pivot) → torso + neck → head
      const body = new THREE.Group();
      body.rotation.order = 'YXZ';
      body.position.y = d.hipY;
      this._torsoGeo = torsoGeometry(p, d, low);
      body.add(mesh(this._torsoGeo, M.body));
      const neck = new THREE.Group();
      neck.rotation.order = 'YXZ';
      neck.position.y = d.neckY - d.hipY;
      body.add(neck);
      const head = new THREE.Group();
      head.position.y = d.headOffset;
      neck.add(head);
      head.add(mesh(headGeometry(p, low), M.body));
      const hairGeo = hairGeometry(p, low);
      if (hairGeo) head.add(mesh(hairGeo, M.hair));
      root.add(body);

      // Face
      const face = new THREE.Group();
      face.name = 'face';
      head.add(face);
      const st = EYE_STYLES[p.eyes];
      this._eyeStyle = st;
      const eyeGeo = eyeGeometry(p, low);
      this._eyes = [];
      for (const side of [1, -1]) {
        const group = new THREE.Group();
        group.rotation.order = 'YXZ';
        const open = mesh(eyeGeo, M.eye, false);
        group.add(open);
        const arc = mesh(eyeAltGeometry('arc', side), M.flat, false);
        const squeeze = mesh(eyeAltGeometry('squeeze', side), M.flat, false);
        arc.position.z = squeeze.position.z = 0.004;
        arc.visible = squeeze.visible = false;
        group.add(arc, squeeze);
        face.add(group);
        this._eyes.push({ side, group, open, arc, squeeze });
      }
      if (p.glasses === 3) for (const e of this._eyes) e.group.visible = false;
      const browGeo = browGeometry(p);
      this._brows = [];
      for (const side of [1, -1]) {
        const g = new THREE.Group();
        g.rotation.order = 'YXZ';
        const m = mesh(browGeo, M.body, false);
        g.add(m);
        face.add(g);
        this._brows.push({ side, group: g });
      }
      this._mouths = {};
      this._mouthGroup = new THREE.Group();
      this._mouthGroup.position.copy(MOUTH_PIVOT);
      face.add(this._mouthGroup);
      for (const name of Object.keys(MOUTHS)) {
        const m = mesh(mouthGeometry(name), M.flat, false);
        m.visible = false;
        this._mouthGroup.add(m);
        this._mouths[name] = m;
      }
      this._blush = null;
      if (!low) {
        this._blush = mesh(blushGeometry(), M.blush, false);
        this._blush.renderOrder = 1;
        face.add(this._blush);
      }

      // Legs, feet, hands (children of root; posed by the rig)
      this._legGeo = legGeometry(p, d, low);
      const shoe = shoeGeometry(low);
      this._legs = [];
      const footL = new THREE.Group(), footR = new THREE.Group();
      footL.name = 'footL'; footR.name = 'footR';
      for (const [side, foot] of [[1, footL], [-1, footR]]) {
        const leg = new THREE.Group();
        leg.name = side > 0 ? 'legL' : 'legR';
        leg.add(mesh(this._legGeo, M.body));
        foot.add(mesh(shoe, M.body));
        foot.rotation.order = 'YXZ';
        root.add(leg, foot);
        this._legs.push({ side, leg, foot });
      }
      const handGeo = handGeometry(p, low);
      const handL = new THREE.Group(), handR = new THREE.Group();
      handL.add(mesh(handGeo, M.body)); handR.add(mesh(handGeo, M.body));
      handL.name = 'handL'; handR.name = 'handR';
      root.add(handL, handR);

      this.parts = { body, head, handL, handR, footL, footR, face, neck };
      this.headCenter = new THREE.Vector3(0, d.headY, 0);
      let hairTop = d.headY + HEAD_R;
      if (hairGeo) { hairGeo.computeBoundingBox(); hairTop = Math.max(hairTop, d.headY + hairGeo.boundingBox.max.y); }
      this.height = hairTop;

      // Animation state
      this._a = new Float32Array(NCH); this._b = new Float32Array(NCH); this._final = new Float32Array(NCH);
      restPose(this._final, d);
      this._cur = null; this._prev = null; this._fade = 1; this._fadeDur = 0.15;
      this._base = 'idle';
      this.phase = 0;
      this.speed = null;

      // Pose layer
      this._pose = { active: false, w: 0, wTarget: 0, lambda: 18, releaseRate: 0,
        target: new Float32Array(NCH), cur: new Float32Array(NCH), mask: new Uint8Array(NCH), stance: 0, stanceT: 0, hasStance: false };

      // Face state
      this._expr = 'neutral'; this._exprHold = 0; this._exprAuto = false;
      this._face = { raise: 0, tilt: 0, sx: 1, sy: 1, headUp: 0 };
      this._blink = { next: 1 + Math.random() * 2.5, t: -1, double: false };
      this._saccade = { next: 1 + Math.random() * 2, yaw: 0, pitch: 0, cy: 0, cp: 0 };
      this._mouthPop = 1;
      this._look = { target: null, yaw: 0, pitch: 0 };
      this._attached = new Set();

      this.play('idle', { fade: 0 });
      this._applyExpression(true);
      this.update(0);
    }

    // --- animation ---------------------------------------------------------------------------

    play(name, opts = {}) {
      const def = ANIMS[name];
      if (!def) { console.warn('[SS] pal.play: unknown animation "' + name + '"'); return Promise.resolve(); }
      const loop = opts.loop == null ? !!def.loop : !!opts.loop;
      const speed = opts.speed == null ? 1 : opts.speed;
      if (this._cur && this._cur.name === name && loop && this._cur.loop) {
        this._cur.speed = speed;
        return this._cur.promise;
      }
      const prevCur = this._cur;
      if (prevCur && prevCur.resolve) prevCur.resolve();
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      this._prev = prevCur;
      this._fadeDur = opts.fade == null ? 0.15 : Math.max(0, opts.fade);
      this._fade = this._fadeDur > 0 && prevCur ? 0 : 1;
      this._cur = { name, def, t: 0, loop, speed, promise, resolve };
      if (loop) this._base = name;
      // Emotional animations bring their face along unless the game set one on purpose.
      if (def.expr && (this._expr === 'neutral' || this._exprAuto)) {
        this.setExpression(def.expr, loop ? 0 : def.dur / speed);
        this._exprAuto = true;
      } else if (!def.expr && this._exprAuto) {
        this.setExpression('neutral');
      }
      return promise;
    }

    setSpeed(mps) { this.speed = Math.max(0, Number(mps) || 0); }

    speedFor(anim) { return this.speed == null ? (anim === 'run' ? 4 : 1.3) : this.speed; }

    _evaluate(state, out) {
      restPose(out, this.dims);
      const def = state.def;
      const t = def.dur && state.loop ? state.t % def.dur : state.t;
      def.fn(out, t, this.dims, this);
    }

    // --- pose layer -----------------------------------------------------------------------------

    pose(p, opts = {}) {
      const L = this._pose;
      const blend = opts.blend == null ? 1 : clamp(opts.blend, 0, 1);
      const lambda = opts.lambda == null ? 18 : opts.lambda;
      const set = (i, v) => {
        if (!L.mask[i] || L.w <= 0.001) L.cur[i] = this._final[i];
        L.mask[i] = 1; L.target[i] = v;
      };
      if (p.handL) { set(HLX, p.handL.x); set(HLY, p.handL.y); set(HLZ, p.handL.z); }
      if (p.handR) { set(HRX, p.handR.x); set(HRY, p.handR.y); set(HRZ, p.handR.z); }
      if (p.twist != null) set(TWIST, p.twist);
      if (p.lean != null) set(LEAN, p.lean);
      if (p.tilt != null) set(TILT, p.tilt);
      if (p.crouch != null) set(CROUCH, clamp(p.crouch, 0, 1));
      if (p.stance != null) {
        if (!L.hasStance || L.w <= 0.001) L.stance = 0;
        L.hasStance = true; L.stanceT = clamp(p.stance, 0, 1);
      }
      if (lambda === Infinity || lambda >= 1000) {
        for (let i = 0; i < NCH; i++) if (L.mask[i]) L.cur[i] = L.target[i];
        L.stance = L.stanceT;
      }
      L.active = true; L.wTarget = blend; L.lambda = lambda; L.releaseRate = 0;
      if (lambda === Infinity || lambda >= 1000) L.w = blend;
    }

    releasePose(fadeSeconds = 0.2) {
      const L = this._pose;
      if (!L.active) return;
      if (fadeSeconds <= 0) { this._clearPose(); return; }
      L.releaseRate = 1 / fadeSeconds;
    }

    _clearPose() {
      const L = this._pose;
      L.active = false; L.w = 0; L.wTarget = 0; L.mask.fill(0); L.hasStance = false; L.releaseRate = 0;
    }

    // --- face -----------------------------------------------------------------------------------

    setExpression(name, holdSeconds = 0) {
      if (!EXPRESSIONS[name]) { console.warn('[SS] pal.setExpression: unknown expression "' + name + '"'); return; }
      this._exprAuto = false;
      this._exprHold = holdSeconds > 0 ? holdSeconds : 0;
      if (name === this._expr) return;
      this._expr = name;
      this._applyExpression(false);
    }

    _applyExpression(instant) {
      const e = EXPRESSIONS[this._expr];
      const mouth = e.mouth || PROFILE_MOUTHS[this.profile.mouth];
      for (const k of Object.keys(this._mouths)) this._mouths[k].visible = k === mouth;
      for (const eye of this._eyes) {
        eye.open.visible = e.eyes === 'open';
        eye.arc.visible = e.eyes === 'arc';
        eye.squeeze.visible = e.eyes === 'squeeze';
      }
      if (this._blush) this._blush.visible = this.profile.cheeks || !!e.blush;
      if (!instant) this._mouthPop = 0;
      if (instant) Object.assign(this._face, { raise: e.raise, tilt: e.tilt, sx: e.sx, sy: e.sy, headUp: e.headUp || 0 });
    }

    lookAt(target) {
      if (!target) { this._look.target = null; return; }
      if (!this._look.target) this._look.target = new THREE.Vector3();
      this._look.target.copy(target);
    }

    // --- equipment & helpers -----------------------------------------------------------------------

    handWorld(side, out = new THREE.Vector3()) {
      const h = side === 'L' ? this.parts.handL : this.parts.handR;
      h.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(h.matrixWorld);
    }

    attach(obj, side, o = {}) {
      const h = side === 'L' ? this.parts.handL : this.parts.handR;
      h.add(obj);
      if (o.position) obj.position.copy(o.position);
      if (o.rotation) obj.rotation.copy(o.rotation);
      this._attached.add(obj);
      return obj;
    }

    detach(obj) {
      if (obj.parent) obj.parent.remove(obj);
      this._attached.delete(obj);
    }

    setFacing(yaw) { this.root.rotation.y = yaw; }
    setVisible(v) { this.root.visible = !!v; }

    dispose() {
      if (this._cur && this._cur.resolve) this._cur.resolve();
      if (this.root.parent) this.root.parent.remove(this.root);
      // Equipment still attached goes with the pal: it left the scene with the root, so scene disposal
      // would never reach it. Objects marked userData.shared are only detached (their owner keeps them);
      // inside an attached object, shared geometry/materials/textures are skipped by disposeObject().
      // Disposing is idempotent, so a sport that already disposed its equipment is fine.
      for (const obj of this._attached) {
        if (obj.parent) obj.parent.remove(obj);
        if (!(obj.userData && obj.userData.shared === true) && SS.engine && SS.engine.disposeObject) SS.engine.disposeObject(obj);
      }
      this._attached.clear();
      this._torsoGeo.dispose();
      this._legGeo.dispose();
    }

    // --- per-frame -----------------------------------------------------------------------------------

    update(dt) {
      dt = Math.max(0, Math.min(dt || 0, 0.1));
      const d = this.dims;

      // Locomotion phase shared by walk & run so they crossfade in step.
      const cur = this._cur;
      const strideAnim = cur && cur.def.stride ? cur : this._prev && this._prev.def.stride ? this._prev : null;
      if (strideAnim) this.phase += dt * this.speedFor(strideAnim.name) / (strideAnim.def.stride * d.k);

      // Animations + crossfade
      cur.t += dt * cur.speed;
      this._evaluate(cur, this._a);
      const A = this._a;
      if (this._fade < 1 && this._prev) {
        this._fade = Math.min(1, this._fade + (this._fadeDur > 0 ? dt / this._fadeDur : 1));
        this._prev.t += dt * this._prev.speed;
        this._evaluate(this._prev, this._b);
        const k = smoothstep(0, 1, this._fade);
        for (let i = 0; i < NCH; i++) A[i] = lerp(this._b[i], A[i], k);
      } else this._prev = null;
      if (!cur.loop && cur.t >= cur.def.dur) {
        const done = cur.resolve;
        cur.resolve = null;
        this.play(this._base === cur.name ? 'idle' : this._base, { fade: 0.25 });
        if (done) done();
      }

      // Pose layer
      const L = this._pose, F = this._final;
      F.set(A);
      if (L.active) {
        if (L.releaseRate > 0) {
          L.w -= L.releaseRate * dt;
          if (L.w <= 0) this._clearPose();
        } else {
          L.w = L.lambda === Infinity ? L.wTarget : lerp(L.w, L.wTarget, 1 - Math.exp(-L.lambda * dt));
        }
      }
      if (L.active) {
        const k = L.lambda === Infinity ? 1 : 1 - Math.exp(-L.lambda * dt);
        for (let i = 0; i < NCH; i++) if (L.mask[i]) L.cur[i] = lerp(L.cur[i], L.target[i], k);
        L.stance = lerp(L.stance, L.stanceT, k);
      }
      const w = L.active ? L.w : 0;
      if (w > 0) for (const i of BODY_CHANNELS) if (L.mask[i]) F[i] = lerp(F[i], L.cur[i], w);

      // Body
      const crouch = clamp(F[CROUCH], 0, 1);
      const bodyY = d.hipY + F[Y] - crouch * 0.3 * d.hipY;
      const drop = bodyY - d.hipY;
      F[HLY] += drop; F[HRY] += drop;
      F[HLX] += F[BX]; F[HRX] += F[BX]; F[HLZ] += F[BZ]; F[HRZ] += F[BZ];
      if (w > 0) for (let i = HLX; i <= HRZ; i++) if (L.mask[i]) F[i] = lerp(F[i], L.cur[i], w);
      if (w > 0 && L.hasStance) {
        const sx = d.footX + L.stance * 0.22 * d.k;
        F[FLX] = lerp(F[FLX], sx, w); F[FRX] = lerp(F[FRX], -sx, w);
        F[FLZ] = lerp(F[FLZ], 0.06 * L.stance, w); F[FRZ] = lerp(F[FRZ], -0.04 * L.stance, w);
      }
      const { body, neck, handL, handR } = this.parts;
      body.position.set(F[BX], bodyY, F[BZ]);
      body.rotation.set(F[LEAN], F[TWIST], F[TILT]);
      const sq = F[SQUASH], inv = 1 / Math.sqrt(sq);
      body.scale.set(inv, sq, inv);
      handL.position.set(F[HLX], F[HLY], F[HLZ]);
      handR.position.set(F[HRX], F[HRY], F[HRZ]);

      // Legs aim from the hip joints to the ankles
      body.updateMatrix();
      for (const L2 of this._legs) {
        const fx = L2.side > 0 ? F[FLX] : F[FRX], fy = L2.side > 0 ? F[FLY] : F[FRY];
        const fz = L2.side > 0 ? F[FLZ] : F[FRZ], fp = L2.side > 0 ? F[FLP] : F[FRP];
        L2.foot.position.set(fx, fy, fz);
        L2.foot.rotation.set(fp, F[TWIST] * 0.3, 0);
        const hip = _v.set(L2.side * d.hipX, 0.02, 0).applyMatrix4(body.matrix);
        L2.leg.position.copy(hip);
        const dir = _v2.set(fx, fy + 0.02, fz).sub(hip);
        const len = dir.length() || 1;
        L2.leg.quaternion.setFromUnitVectors(DOWN, dir.multiplyScalar(1 / len));
        L2.leg.scale.set(1, clamp(len / d.legLen, 0.5, 1.3), 1);
      }

      // Head: animation + look-at + expression tilt
      this._updateLook(dt, F);
      const face = this._face;
      neck.rotation.set(F[HP] + this._look.pitch + face.headUp, F[HY] + this._look.yaw, F[HR]);
      this.headCenter.set(0, d.headOffset, 0).applyEuler(neck.rotation).add(_v.set(0, d.neckY - d.hipY, 0));
      this.headCenter.multiply(body.scale).applyEuler(body.rotation).add(body.position);

      this._updateFace(dt);
    }

    _updateLook(dt, F) {
      const look = this._look;
      let yaw = 0, pitch = 0;
      if (look.target) {
        this.root.updateWorldMatrix(true, false);
        const local = this.root.worldToLocal(_v.copy(look.target));
        const dx = local.x - this.headCenter.x, dy = local.y - this.headCenter.y, dz = local.z - this.headCenter.z;
        yaw = clamp(Math.atan2(dx, dz) - F[TWIST], -1.15, 1.15);
        pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)) - F[LEAN] * 0.5, -0.55, 0.55);
      }
      const k = 1 - Math.exp(-9 * dt);
      look.yaw = lerp(look.yaw, yaw, k);
      look.pitch = lerp(look.pitch, pitch, k);
    }

    _updateFace(dt) {
      // expression hold
      if (this._exprHold > 0) {
        this._exprHold -= dt;
        if (this._exprHold <= 0) {
          this._exprHold = 0; this._exprAuto = false;
          this._expr = 'neutral'; this._applyExpression(false);
        }
      }
      const e = EXPRESSIONS[this._expr], f = this._face, k = 1 - Math.exp(-16 * dt);
      f.raise = lerp(f.raise, e.raise, k); f.tilt = lerp(f.tilt, e.tilt, k);
      f.sx = lerp(f.sx, e.sx, k); f.sy = lerp(f.sy, e.sy, k); f.headUp = lerp(f.headUp, e.headUp || 0, k);

      // blinking
      const b = this._blink;
      let closed = 0;
      if (b.t >= 0) {
        b.t += dt;
        const T = 0.14;
        closed = b.t < T ? Math.sin(b.t / T * Math.PI) : 0;
        if (b.t >= T) {
          if (b.double) { b.double = false; b.t = -0.08; } else b.t = -1;
        }
      } else if (b.t < -0.5) {
        b.next -= dt;
        if (b.next <= 0) { b.t = 0; b.double = Math.random() < 0.18; b.next = 1.8 + Math.random() * 3.2; }
      } else {
        b.t += dt;
        if (b.t >= 0) b.t = 0;
      }

      // tiny eye darts make them feel alive
      const s = this._saccade;
      s.next -= dt;
      if (s.next <= 0) {
        s.next = 0.8 + Math.random() * 2.6;
        s.yaw = (Math.random() - 0.5) * 0.06; s.pitch = (Math.random() - 0.5) * 0.03;
      }
      const ks = 1 - Math.exp(-30 * dt);
      s.cy = lerp(s.cy, s.yaw + clamp(this._look.yaw * 0.05, -0.04, 0.04), ks);
      s.cp = lerp(s.cp, s.pitch, ks);

      const st = this._eyeStyle;
      const openY = (st.open || 1) * f.sy * (1 - 0.92 * closed);
      for (const eye of this._eyes) {
        const yaw = eye.side * st.yaw + s.cy, pitch = FACE.eyePitch + s.cp;
        sph(yaw, pitch, HEAD_R - 0.004, eye.group.position);
        eye.group.rotation.set(-pitch, yaw, 0);
        eye.open.scale.set(f.sx, openY, 1);
      }
      for (const br of this._brows) {
        const pitch = FACE.browPitch + f.raise / HEAD_R + (st.ry - 0.047) * 0.9 / HEAD_R;
        const yaw = br.side * (st.yaw + 0.02);
        sph(yaw, pitch, HEAD_R + 0.003, br.group.position);
        br.group.rotation.set(-pitch, yaw, -br.side * f.tilt);
      }
      if (this._mouthPop < 1) {
        this._mouthPop = Math.min(1, this._mouthPop + dt / 0.2);
        const sc = 0.6 + 0.4 * outBack(this._mouthPop);
        this._mouthGroup.scale.set(sc, sc, sc);
      }
    }
  }

  function create(profile, opts) { return new Pal(profile, opts); }

  // ---------------------------------------------------------------------------------------------
  // Portraits (head & shoulders, 3/4 view, transparent background, cached).
  // Rendered by one small, lazily created renderer with an alpha channel and copied with drawImage:
  // the engine canvas is opaque, and synchronous readPixels stalls the GPU (Chrome warns about it).
  // ---------------------------------------------------------------------------------------------

  const portraitCache = new Map();
  const portraitUrls = new Map();
  const PORTRAIT_CACHE_MAX = 160;
  let pKit = null;

  function portraitKit() {
    if (pKit) return pKit;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xC9D3DE, 1.7));
    const key = new THREE.DirectionalLight(0xFFF5E8, 2.3);
    key.position.set(-1.2, 2.2, 2.4);
    const rim = new THREE.DirectionalLight(0xD6ECFF, 1.6);
    rim.position.set(2, 1.5, -2);
    scene.add(key, rim);
    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    pKit = { scene, camera, renderer };
    return pKit;
  }

  function renderPortrait(profile, size) {
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const { scene, camera, renderer } = portraitKit();
    const S = Math.min(1024, size * 2);   // 2x supersampling, then a smooth downscale
    const canvas = renderer.domElement;
    if (canvas.width !== S || canvas.height !== S) renderer.setSize(S, S, false);

    const pal = create(profile, { shadows: false, detail: 'high' });
    pal.parts.handL.visible = pal.parts.handR.visible = false;
    pal.root.rotation.y = 0.38;
    pal.update(0);
    scene.add(pal.root);
    const half = 0.37, aim = pal.headCenter.y - 0.025;
    const dist = half / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0.05, aim + 0.12, dist);
    camera.lookAt(0, aim, 0);
    try {
      renderer.render(scene, camera);
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, S, S, 0, 0, size, size);
    } finally {
      scene.remove(pal.root);
      pal.dispose();
    }
    return out;
  }

  function portraitKey(profile, size) {
    return SS.util.hash(visualKey(sanitize(profile))) + '@' + size;
  }

  function portrait(profile, size = 128) {
    size = Math.max(16, Math.round(size));
    const key = portraitKey(profile, size);
    let c = portraitCache.get(key);
    if (c) return c;
    try {
      c = renderPortrait(sanitize(profile), size);
    } catch (err) {
      console.error('[SS] portrait failed:', err);
      c = document.createElement('canvas');
      c.width = c.height = size;
      return c;
    }
    portraitCache.set(key, c);
    if (portraitCache.size > PORTRAIT_CACHE_MAX) {
      const oldest = portraitCache.keys().next().value;
      portraitCache.delete(oldest);
      portraitUrls.delete(oldest);
    }
    return c;
  }

  function portraitURL(profile, size = 128) {
    const key = portraitKey(profile, Math.max(16, Math.round(size)));
    let url = portraitUrls.get(key);
    if (!url) { url = portrait(profile, size).toDataURL('image/png'); portraitUrls.set(key, url); }
    return url;
  }

  // ---------------------------------------------------------------------------------------------
  // CPU roster (ordered by skill)
  // ---------------------------------------------------------------------------------------------

  function cpu(id, name, skill, tag, look) {
    const profile = sanitize(Object.assign({ id: 'cpu-' + id, name, created: 0, cheeks: true }, look));
    const title = skill < 0.25 ? 'Rookie' : skill < 0.5 ? 'Amateur' : skill < 0.75 ? 'Pro' : skill < 0.92 ? 'Star' : 'Legend';
    return { profile, skill, title, tag };
  }

  const CPU_ROSTER = [
    cpu('pip', 'Pip', 0.04, 'Just happy to be here', { skin: 0, hairStyle: 9, hairColor: 5, eyes: 5, eyeColor: 3, brows: 2, nose: 0, mouth: 4, shirt: 2, pants: 4, height: 0.1, build: 0.35 }),
    cpu('mochi', 'Mochi', 0.1, 'Snack break pro', { skin: 1, hairStyle: 6, hairColor: 0, eyes: 4, eyeColor: 0, brows: 0, nose: 1, mouth: 2, shirt: 7, pants: 2, height: 0.25, build: 0.75 }),
    cpu('tansy', 'Tansy', 0.17, 'Practices every Sunday', { skin: 2, hairStyle: 5, hairColor: 3, eyes: 0, eyeColor: 1, brows: 3, nose: 0, mouth: 0, glasses: 1, shirt: 3, pants: 0, height: 0.45, build: 0.4 }),
    cpu('kobi', 'Kobi', 0.24, 'Big swing, bigger grin', { skin: 4, hairStyle: 2, hairColor: 0, eyes: 3, eyeColor: 1, brows: 1, nose: 3, mouth: 1, shirt: 1, pants: 1, height: 0.55, build: 0.55 }),
    cpu('wren', 'Wren', 0.32, 'Quiet, then suddenly great', { skin: 0, hairStyle: 3, hairColor: 2, eyes: 1, eyeColor: 2, brows: 0, nose: 0, mouth: 2, shirt: 4, pants: 3, height: 0.4, build: 0.3 }),
    cpu('ozzie', 'Ozzie', 0.4, 'Wears lucky socks', { skin: 3, hairStyle: 0, hairColor: 1, eyes: 0, eyeColor: 1, brows: 4, nose: 2, mouth: 3, facial: 1, shirt: 9, pants: 0, height: 0.7, build: 0.7 }),
    cpu('juniper', 'Juniper', 0.48, 'Reads the wind', { skin: 1, hairStyle: 4, hairColor: 4, eyes: 5, eyeColor: 3, brows: 3, nose: 0, mouth: 0, shirt: 8, pants: 5, height: 0.6, build: 0.4 }),
    cpu('rocco', 'Rocco', 0.56, 'Never skips leg day', { skin: 2, hairStyle: 8, hairColor: 0, eyes: 2, eyeColor: 0, brows: 1, nose: 3, mouth: 1, facial: 2, shirt: 0, pants: 1, height: 0.75, build: 0.9 }),
    cpu('noor', 'Noor', 0.64, 'Calm under pressure', { skin: 3, hairStyle: 1, hairColor: 0, eyes: 1, eyeColor: 4, brows: 0, nose: 1, mouth: 2, glasses: 2, shirt: 5, pants: 0, height: 0.55, build: 0.45 }),
    cpu('fennel', 'Fennel', 0.72, 'Spin doctor', { skin: 0, hairStyle: 7, hairColor: 5, eyes: 0, eyeColor: 2, brows: 2, nose: 0, mouth: 4, shirt: 3, pants: 6, height: 0.3, build: 0.5 }),
    cpu('ziggy', 'Ziggy', 0.8, 'Shades on, game on', { skin: 5, hairStyle: 2, hairColor: 8, eyes: 0, eyeColor: 0, brows: 1, nose: 1, mouth: 3, glasses: 3, shirt: 11, pants: 7, height: 0.65, build: 0.6 }),
    cpu('marisol', 'Marisol', 0.87, 'Undefeated at the picnic', { skin: 2, hairStyle: 5, hairColor: 1, eyes: 5, eyeColor: 1, brows: 3, nose: 0, mouth: 1, shirt: 0, pants: 4, height: 0.5, build: 0.45 }),
    cpu('dax', 'Dax', 0.93, 'Trophy shelf is full', { skin: 4, hairStyle: 1, hairColor: 6, eyes: 2, eyeColor: 1, brows: 4, nose: 2, mouth: 3, facial: 3, shirt: 6, pants: 1, height: 0.8, build: 0.65 }),
    cpu('odessa', 'Odessa', 0.98, 'The one to beat', { skin: 5, hairStyle: 7, hairColor: 0, eyes: 1, eyeColor: 5, brows: 0, nose: 1, mouth: 0, glasses: 1, shirt: 8, pants: 0, height: 0.7, build: 0.5 }),
  ];

  /** Picks an opponent a little above the given skill level (0..2500). */
  function rosterFor(level) {
    const target = clamp((Number(level) || 0) / 2300 + 0.05, 0, 1);
    let best = CPU_ROSTER[0], bestD = Infinity;
    for (const e of CPU_ROSTER) {
      const dd = Math.abs(e.skill - target);
      if (dd < bestD) { bestD = dd; best = e; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  SS.pals = {
    OPTIONS, CPU_ROSTER, ANIMATIONS: Object.keys(ANIMS), EXPRESSIONS: Object.keys(EXPRESSIONS),
    defaultProfile, randomProfile, sanitize, rosterFor,
    create, portrait, portraitURL,
  };
})();
