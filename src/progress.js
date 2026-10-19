// The player's profile: credits, unlocks, upgrades, stars, settings and saved designs.
// Pure logic over a plain object so tests can run it without storage.
const Progress = (() => {
  const {OPS, PART_SHOP, FREE_PARTS, DOCKS, TRACKS, TRACK_PRICES, DIFFICULTY, STARTER} = Data;
  const VERSION = 1;

  function fresh() {
    return {
      v: VERSION, credits: 0, parts: FREE_PARTS.slice(), dock: 0,
      tracks: Object.fromEntries(Object.keys(TRACKS).map(k => [k, 0])),
      blueprints: [],
      stars: OPS.map(() => 0), hardClears: OPS.map(() => false),
      endlessBest: 0, totalSunk: 0, battles: 0,
      settings: {difficulty: 'medium', quality: 'auto', volume: 0.8, music: true, shake: true, controls: 'craft', aimAssist: true},
      design: Design.fromRows(STARTER, DOCKS[0].w, DOCKS[0].h),
      slots: [null, null, null],
      seen: {},
    };
  }

  // Merge a stored profile onto defaults so new fields appear after updates.
  function sanitize(p) {
    const f = fresh();
    if (!p || typeof p !== 'object' || p.v !== VERSION) return f;
    const out = Object.assign(f, p);
    out.tracks = Object.assign(fresh().tracks, p.tracks || {});
    out.settings = Object.assign(fresh().settings, p.settings || {});
    if (!DIFFICULTY[out.settings.difficulty]) out.settings.difficulty = 'medium';
    out.stars = OPS.map((_, i) => (p.stars && p.stars[i]) | 0);
    out.hardClears = OPS.map((_, i) => !!(p.hardClears && p.hardClears[i]));
    out.parts = Array.from(new Set([...FREE_PARTS, ...(p.parts || []).filter(x => Data.PARTS[x])]));
    out.dock = Util.clamp(p.dock | 0, 0, DOCKS.length - 1);
    if (!Design.valid(out.design)) out.design = f.design;
    out.slots = [0, 1, 2].map(i => (p.slots && Design.valid(p.slots[i])) ? p.slots[i] : null);
    out.blueprints = Array.from(new Set((p.blueprints || []).filter(id => Data.FAMOUS[id])));
    out.credits = Math.max(0, +p.credits || 0);
    return out;
  }
  const load = () => sanitize(Util.store.get('profile', null));
  const save = p => Util.store.set('profile', p);

  const unlocked = p => new Set(p.parts);
  const dock = p => DOCKS[p.dock];
  const opUnlocked = (p, i) => i === 0 || p.stars[i - 1] > 0;
  const reachedOp = p => { let i = 0; while (i < OPS.length - 1 && opUnlocked(p, i + 1)) i++; return i; };
  const budget = (p, opIndex) => Math.round(OPS[opIndex].budget * (1 + p.tracks.funding * TRACKS.funding.per));
  const endlessBudgetCap = p => budget(p, reachedOp(p));
  const totalStars = p => p.stars.reduce((a, b) => a + b, 0);

  function mods(p) {
    const t = p.tracks;
    return {
      hp: 1 + t.plating * TRACKS.plating.per,
      reload: 1 + t.gunnery * TRACKS.gunnery.per,
      thrust: 1 + t.propulsion * TRACKS.propulsion.per,
      spread: 1 - t.firecontrol * TRACKS.firecontrol.per,
      repair: 1 + t.damagectl * TRACKS.damagectl.per,
      fire: 1 + t.damagectl * TRACKS.damagectl.per,
    };
  }

  // ---- shop
  function partStatus(p, id) {
    if (p.parts.includes(id)) return {state: 'owned'};
    const s = PART_SHOP[id];
    if (!s) return {state: 'owned'};
    if (reachedOp(p) < s.op) return {state: 'locked', op: s.op, price: s.price};
    return {state: p.credits >= s.price ? 'buy' : 'poor', price: s.price};
  }
  function buyPart(p, id) {
    const st = partStatus(p, id);
    if (st.state !== 'buy') return false;
    p.credits -= st.price; p.parts.push(id); return true;
  }
  function trackPrice(p, k) { const lv = p.tracks[k]; return lv >= TRACK_PRICES.length ? null : TRACK_PRICES[lv]; }
  function buyTrack(p, k) {
    const price = trackPrice(p, k);
    if (price == null || p.credits < price) return false;
    p.credits -= price; p.tracks[k]++; return true;
  }
  function dockPrice(p) { const n = DOCKS[p.dock + 1]; return n ? n.price : null; }
  // ---- historical blueprints
  // Price scales with the ship's build cost; owning one lets you load it in the shipyard any time.
  function blueprintPrice(id) {
    const a = Design.analyze(Design.fromRows(Data.FAMOUS[id].rows));
    return Math.max(150, Math.round(a.cost * 0.55 / 50) * 50);
  }
  // What stops an owned blueprint from being built right now: dock size and missing parts.
  function blueprintNeeds(p, id) {
    const d = Design.fromRows(Data.FAMOUS[id].rows), a = Design.analyze(d), unl = unlocked(p);
    const dockIdx = DOCKS.findIndex(k => k.w >= d.w && k.h >= d.h);
    return {dock: dockIdx > p.dock ? DOCKS[dockIdx] : null, parts: Object.keys(a.cnt).filter(t => !unl.has(t)), design: d, a};
  }
  function buyBlueprint(p, id) {
    if (p.blueprints.includes(id)) return false;
    const price = blueprintPrice(id);
    if (p.credits < price) return false;
    p.credits -= price; p.blueprints.push(id); return true;
  }
  function buyDock(p) {
    const price = dockPrice(p);
    if (price == null || p.credits < price) return false;
    p.credits -= price; p.dock++;
    const d = DOCKS[p.dock];
    p.design = Design.resize(p.design, d.w, d.h);
    return true;
  }

  // ---- results
  // r: {op, won, integrity, time, sunkCost, difficulty}
  function starsFor(r) {
    if (!r.won) return 0;
    let s = 1;
    if (r.integrity >= 0.6) s++;
    if (r.time <= OPS[r.op].par) s++;
    return s;
  }
  function reward(p, r) {
    const diff = DIFFICULTY[r.difficulty] || DIFFICULTY.medium;
    const base = 120 + 60 * r.op;
    const stars = starsFor(r);
    const prev = p.stars[r.op];
    const lines = [];
    if (r.won) lines.push([prev > 0 ? 'Victory (repeat)' : 'Victory', prev > 0 ? base * 0.5 : base * 1.5]);
    else lines.push(['Salvage', base * 0.25]);
    if (stars > prev) lines.push([`New stars ×${stars - prev}`, (stars - prev) * base * 0.4]);
    if (r.sunkCost) lines.push(['Ships sunk', r.sunkCost * 0.12]);
    const sub = lines.reduce((a, l) => a + l[1], 0);
    const mult = diff.reward;
    const total = Math.round(sub * mult);
    return {stars, prev, lines: lines.map(([k, v]) => [k, Math.round(v)]), mult, total};
  }
  function applyResult(p, r) {
    const rw = reward(p, r);
    p.credits += rw.total;
    p.stars[r.op] = Math.max(p.stars[r.op], rw.stars);
    if (r.won && r.difficulty === 'hard') p.hardClears[r.op] = true;
    p.battles++; p.totalSunk += r.sunk || 0;
    return rw;
  }
  function endlessReward(p, r) {
    const diff = DIFFICULTY[r.difficulty] || DIFFICULTY.medium;
    const total = Math.round((r.wave * 45 + (r.sunkCost || 0) * 0.1) * diff.reward);
    return {total, best: r.wave > p.endlessBest};
  }
  function applyEndless(p, r) {
    const rw = endlessReward(p, r);
    p.credits += rw.total; p.endlessBest = Math.max(p.endlessBest, r.wave);
    p.battles++; p.totalSunk += r.sunk || 0;
    return rw;
  }

  return {blueprintPrice, blueprintNeeds, buyBlueprint,
          fresh, sanitize, load, save, unlocked, dock, opUnlocked, reachedOp, budget, endlessBudgetCap, totalStars,
          mods, partStatus, buyPart, trackPrice, buyTrack, dockPrice, buyDock, starsFor, reward, applyResult,
          endlessReward, applyEndless};
})();
