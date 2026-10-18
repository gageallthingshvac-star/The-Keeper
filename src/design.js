// Ship designs: a w×h grid of part ids (row 0 = bow). Rules, stats, validation, undo.
const Design = (() => {
  const {PARTS, KEY2PART} = Data;
  const KN = 0.25; // world units/s -> knots shown to the player

  const create = (w, h) => ({w, h, cells: new Array(w * h).fill(null)});
  const clone = d => ({w: d.w, h: d.h, cells: d.cells.slice()});
  const idx = (d, c, r) => c + r * d.w;
  const at = (d, c, r) => (c < 0 || r < 0 || c >= d.w || r >= d.h) ? null : d.cells[c + r * d.w];

  // Centre a list of row strings inside a w×h grid (defaults to the rows' own size).
  function fromRows(rows, w, h) {
    const rw = Math.max(...rows.map(r => r.length)), rh = rows.length;
    w = w || rw; h = h || rh;
    const d = create(w, h);
    const ox = Math.floor((w - rw) / 2), oy = Math.floor((h - rh) / 2);
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const t = KEY2PART[row[c]];
        if (t && c + ox >= 0 && c + ox < w && r + oy >= 0 && r + oy < h) d.cells[(c + ox) + (r + oy) * w] = t;
      }
    });
    return d;
  }

  // Move a design into a different grid size, keeping it centred on its bounding box.
  function resize(d, w, h) {
    const b = bounds(d);
    const out = create(w, h);
    if (!b) return out;
    const bw = b.c1 - b.c0 + 1, bh = b.r1 - b.r0 + 1;
    const ox = Math.floor((w - bw) / 2) - b.c0, oy = Math.floor((h - bh) / 2) - b.r0;
    for (let r = 0; r < d.h; r++) for (let c = 0; c < d.w; c++) {
      const t = d.cells[c + r * d.w];
      const nc = c + ox, nr = r + oy;
      if (t && nc >= 0 && nr >= 0 && nc < w && nr < h) out.cells[nc + nr * w] = t;
    }
    return out;
  }
  function bounds(d) {
    let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
    d.cells.forEach((t, i) => { if (!t) return; const c = i % d.w, r = (i / d.w) | 0;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); });
    return c1 < 0 ? null : {c0, c1, r0, r1};
  }

  function valid(d) {
    return d && Number.isInteger(d.w) && Number.isInteger(d.h) && d.w > 0 && d.h > 0 && d.w <= 15 && d.h <= 31 &&
      Array.isArray(d.cells) && d.cells.length === d.w * d.h && d.cells.every(v => v === null || PARTS[v]);
  }

  // Place (or erase with part=null). Mirror copies across the centreline; there is only ever one bridge.
  function place(d, c, r, part, mirror) {
    if (c < 0 || r < 0 || c >= d.w || r >= d.h) return false;
    const mc = d.w - 1 - c;
    const before = d.cells.join();
    if (part === 'bridge') { for (let i = 0; i < d.cells.length; i++) if (d.cells[i] === 'bridge') d.cells[i] = null; }
    const set = cc => {
      const i = idx(d, cc, r);
      if (d.cells[i] === 'bridge' && part !== 'bridge' && cc !== c) return; // mirror never overwrites the bridge
      d.cells[i] = part;
    };
    set(c);
    if (mirror && part !== 'bridge' && mc !== c) set(mc);
    return d.cells.join() !== before;
  }

  const calcSpeed = (mass, thrust) => thrust > 0 ? Math.min(125, 12 + 150 * thrust / Math.max(mass, 1)) : 0;
  const calcTurn = (mass, rudders) => Math.min(1.5, (0.18 + 0.32 * rudders) * Math.sqrt(40 / Math.max(mass, 10)));

  // Indices of cells connected (4-way) to the bridge.
  function connected(d) {
    const set = new Set();
    const bi = d.cells.indexOf('bridge');
    if (bi < 0) return set;
    const st = [bi]; set.add(bi);
    while (st.length) {
      const i = st.pop(), c = i % d.w, r = (i / d.w) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= d.w || nr >= d.h) continue;
        const j = nc + nr * d.w;
        if (d.cells[j] && !set.has(j)) { set.add(j); st.push(j); }
      }
    }
    return set;
  }

  // mods: optional upgrade multipliers (see Progress.mods)
  function analyze(d, mods = {}) {
    let cost = 0, mass = 0, buoy = 0, thrust = 0, rud = 0, dps = 0, range = 0, n = 0, bridges = 0, hp = 0;
    const cnt = {};
    const radars = Math.min(2, d.cells.filter(t => t === 'radar').length);
    const rangeMul = 1 + radars * PARTS.radar.util.range;
    for (const t of d.cells) {
      if (!t) continue;
      const P = PARTS[t]; n++;
      cost += P.cost; mass += P.mass; buoy += P.buoy; hp += P.hp * (mods.hp || 1);
      thrust += (P.thrust || 0) * (mods.thrust || 1); rud += P.turn || 0;
      cnt[t] = (cnt[t] || 0) + 1;
      if (t === 'bridge') bridges++;
      const W = P.weapon;
      if (W && W.dmg) {
        const shots = W.salvo || 1;
        dps += W.dmg * shots / (W.reload / (mods.reload || 1));
        range = Math.max(range, W.type === 'air' ? 0 : W.range * rangeMul);
      }
    }
    const conn = connected(d);
    return {cost, mass, buoy, thrust, rud, dps, range, n, hp, bridges, cnt, conn, loose: n - conn.size,
            speed: calcSpeed(mass, thrust), turn: calcTurn(mass, rud)};
  }

  // Reasons a design can't launch. opts: {budget, unlocked:Set}
  function problems(a, opts) {
    const p = [];
    if (a.n === 0) return ['Place some blocks.'];
    if (a.bridges === 0) p.push('Needs a Bridge.');
    if (a.bridges > 1) p.push('Only one Bridge allowed.');
    if (a.thrust === 0) p.push('Needs at least one Engine.');
    if (a.buoy < a.mass) p.push(`Too heavy — sinks (${a.mass.toFixed(1)} mass vs ${a.buoy.toFixed(1)} buoyancy).`);
    if (opts.budget != null && a.cost > opts.budget) p.push(`Over budget by ${a.cost - opts.budget}.`);
    if (a.loose > 0 && a.bridges === 1) p.push(`${a.loose} block${a.loose > 1 ? 's' : ''} not connected to the bridge.`);
    if (a.dps === 0) p.push('No weapons.');
    if (opts.unlocked) for (const t in a.cnt) if (!opts.unlocked.has(t)) p.push(`${PARTS[t].name} not unlocked.`);
    return p;
  }

  // Undo/redo over whole snapshots — designs are tiny, so this is simpler and safer than diffs.
  class History {
    constructor(limit = 80) { this.past = []; this.future = []; this.limit = limit; }
    push(d) { this.past.push(clone(d)); if (this.past.length > this.limit) this.past.shift(); this.future.length = 0; }
    undo(d) { if (!this.past.length) return null; this.future.push(clone(d)); return this.past.pop(); }
    redo(d) { if (!this.future.length) return null; this.past.push(clone(d)); return this.future.pop(); }
    clear() { this.past.length = 0; this.future.length = 0; }
  }

  return {KN, create, clone, at, fromRows, resize, bounds, valid, place, connected, analyze, problems,
          calcSpeed, calcTurn, History};
})();
