// Headless checks for the game rules, AI tiers and progression.
//   node tests/sim.test.js           quick suite
//   node tests/sim.test.js --balance full balance table (slower)
const {load} = require('./harness');
const {Util, Data, Design, Sim, AI, Progress} = load();
const BALANCE = process.argv.includes('--balance');

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } };
const section = s => console.log('\n# ' + s);

// Reference player designs by tier (fit the dock they would have by then).
const REF = {
  starter: Data.STARTER,
  t1: ['...H...', '..HXH..', '..HHH..', '.HHBHH.', '.GHHHG.', '.HHHHH.', '.GHHHG.', '.HHHHH.', '.HEHEH.', '..HRH..'],
  t2: ['....H....', '...HXH...', '..HHHHH..', '.HHAXAHH.', '.GHHHHHG.', '.HHHBHHH.', '.THHDHHT.', '.GHAAAHG.', '.HHHHHHH.',
       '.THHXHHT.', '.HHHHHHH.', '.HEHEHEH.', '..HRHRH..'],
  t3: ['....H....', '...HXH...', '..HAXAH..', '.HHHHHHH.', '.CAHXHAC.', '.HHHHHHH.', '.GHHBHHG.', '.HAAAAAH.', '.GHMHMHG.',
       '.HHHDHHH.', '.THMHMHT.', '.HHHWHHH.', '.AHHXHHA.', '.CHHXHHC.', '.HHHHHHH.', '.HEHEHEH.', '.HEHEHEH.', '.HHRHRHH.'],
  t2b: ['....H....', '...HXH...', '..HCHCH..', '.HHAXAHH.', '.GHHHHHG.', '.HHHBHHH.', '.KHHDHHK.', '.GHAAAHG.', '.HHHWHHH.',
        '.THHXHHT.', '.HHHHHHH.', '.HEHEHEH.', '..HRHRH..'],
  t3b: ['....H....', '...HXH...', '..HAXAH..', '.HHHHHHH.', '.CAHXHAC.', '.HHHHHHH.', '.GHHBHHG.', '.HAAAAAH.', '.GHMHMHG.',
        '.HHHDHHH.', '.KHMHMHK.', '.HHHWHHH.', '.AHHXHHA.', '.CHHXHHC.', '.HHHHHHH.', '.THHHHHT.', '.HEHEHEH.', '.HEHEHEH.', '.HHRHRHH.'],
  t5: ['.....H.....', '....HXH....', '...HAXAH...', '..HHHLHHH..', '..CAHHHAC..', '.HHHAXAHHH.', '.GHHHHHHHG.', '.HAAABAAAH.',
       '.GHMHDHMHG.', '.HHHHLHHHH.', '.THMHWHMHT.', '.AHHHHHHHA.', '.GHMHHHMHG.', '.AHHHXHHHA.', '.CHHHXHHHC.', '.KHHHHHHHK.',
       '.HAHHLHHAH.', '.HHHHHHHHH.', '.HEHEHEHEH.', '.HEHEHEHEH.', '.HEHHSHHEH.', '..HHRHRHH..'],
  // Dock IV flagship (Yamato hull, modern refit) for the last Legends operations
  t6: ['......H......', '.....HLH.....', '....HHHHH....', '....HHZHH....', '...HHAAAHH...', '...HHHZHHH...', '..HHHAAAHHH..',
       '..HQHMHMHQH..', '..HHXABAXHH..', '.HQHHADAHHQH.', '.HHHAAEAAHHH.', '.HQXHHWHHXQH.', '.HHHAAEAAHHH.', '.HQHMHHHMHQH.',
       '.HHGHAEAHGHH.', '.HQKHHHHHKQH.', '.HHHAAEAAHHH.', '.HCHMHHHMHCH.', '..HHHAAAHHH..', '..HHHHZHHHH..', '..HHHAAAHHH..',
       '..HCHHHHHCH..', '...HHEHEHH...', '...HHWHWHH...', '....HRHRH....', '.....HHH.....'],
  t4: ['.....H.....', '....HXH....', '...HAXAH...', '..HHHLHHH..', '..CAHHHAC..', '.HHHAXAHHH.', '.GHHHHHHHG.', '.HAAABAAAH.',
       '.GHMHDHMHG.', '.HHHHHHHHH.', '.THMHWHMHT.', '.HHHHHHHHH.', '.GHMHHHMHG.', '.AHHHXHHHA.', '.CHHHXHHHC.', '.HHHHHHHHH.',
       '.HAHHLHHAH.', '.HHHHHHHHH.', '.HEHEHEHEH.', '.HEHEHEHEH.', '.HEHHSHHEH.', '..HHRHRHH..'],
};
const refFor = op => ['starter', 't1', 't1', 't2', 't2', 't2b', 't2b', 't3', 't3', 't3b', 't4', 't5', 't2b', 't4', 't5', 't6', 't6'][op];
// (historical ships are tested in their own section below)
// Upgrades a player would plausibly own by this operation.
const modsFor = op => { const lv = Math.floor(op / 4); const p = Progress.fresh(); for (const k of ['plating', 'gunnery', 'firecontrol', 'propulsion']) p.tracks[k] = lv; return Progress.mods(p); };

function battle(design, enemies, difficulty, seed, opts = {}) {
  const rng = Util.rng(seed);
  const world = new Sim.World({rng, weather: opts.weather || 'clear'});
  const player = world.addShip(design, {team: 0, x: 0, y: 560, a: 0, name: 'Player', player: true, mods: opts.mods});
  // the test captain uses Medium tactics with the player's (unmodified) gunnery
  player.brain = AI.autopilot(Data.DIFFICULTY.medium).brain(player);
  AI.spawnFleet(world, enemies, Data.DIFFICULTY[difficulty]);
  const dt = 1 / 30, limit = opts.limit || 300;
  while (world.t < limit) {
    world.step(dt); world.drain();
    if (player.sinking || player.dead) return {won: false, t: world.t, world, player};
    if (!world.ships.some(s => s.team === 1 && !s.sinking)) return {won: true, t: world.t, world, player};
  }
  return {won: false, t: world.t, timeout: true, world, player};
}

// ------------------------------------------------------------------ content
section('enemy designs are seaworthy');
for (const [id, e] of Object.entries(Data.ENEMIES)) {
  const a = Design.analyze(Design.fromRows(e.rows));
  const p = Design.problems(a, {});
  ok(p.length === 0, `${id}: ${p.join(' ')}`);
  const big = Data.DOCKS[Data.DOCKS.length - 1];
  ok(e.rows[0].length <= big.w && e.rows.length <= big.h, `${id}: fits ${big.w}x${big.h}`);
  ok(e.rows.every(r => r.length === e.rows[0].length), `${id}: rows same width`);
  console.log(`  ${id.padEnd(12)} cost ${String(a.cost).padStart(5)}  mass ${a.mass.toFixed(0).padStart(4)}/${a.buoy.toFixed(0).padStart(4)}  ` +
              `${(a.speed * Design.KN).toFixed(1).padStart(5)} kn  dps ${a.dps.toFixed(0).padStart(4)}  rng ${a.range.toFixed(0)}`);
}
section('reference designs');
for (const [k, rows] of Object.entries(REF)) {
  const a = Design.analyze(Design.fromRows(rows));
  ok(Design.problems(a, {}).length === 0, `${k}: ${Design.problems(a, {}).join(' ')}`);
  console.log(`  ${k.padEnd(8)} cost ${a.cost}  ${rows[0].length}x${rows.length}`);
}
section('operations');
const P0 = Progress.fresh();
Data.OPS.forEach((op, i) => {
  ok(op.enemies.every(e => Data.ENEMIES[e]), `op ${i} enemy ids`);
  ok(Data.WEATHER[op.weather], `op ${i} weather`);
  const ref = Design.analyze(Design.fromRows(REF[refFor(i)]));
  ok(ref.cost <= op.budget, `op ${i} (${op.name}) budget ${op.budget} fits reference ${refFor(i)} (${ref.cost})`);
});
const st = Design.analyze(P0.design);
ok(Design.problems(st, {budget: Progress.budget(P0, 0), unlocked: Progress.unlocked(P0)}).length === 0, 'starter launches op 1');
ok(P0.design.w === Data.DOCKS[0].w && P0.design.h === Data.DOCKS[0].h, 'starter sized to dock I');
for (const [k, rows] of Object.entries(REF)) {
  const r = Design.fromRows(rows);
  const dock = Data.DOCKS.findIndex(d => d.w >= r.w && d.h >= r.h);
  ok(dock >= 0, `${k} fits a dock`);
}

section('historical blueprints');
for (const id of Data.SHIPWRIGHT) {
  const F = Data.FAMOUS[id], a = Design.analyze(Design.fromRows(F.rows));
  const game = a.speed * Design.KN, target = Math.min(F.kn, 31);
  ok(Design.problems(a, {}).length === 0, `${id} launchable: ${Design.problems(a, {}).join(' ')}`);
  ok(Math.abs(game - target) <= 2.6, `${id} speed ${game.toFixed(1)} kn vs historical ${F.kn} kn`);
  ok(F.specs && F.specs.length && F.specs.arm && F.fate && F.cls && F.nation && F.year, `${id} has specs`);
  ok(Progress.blueprintPrice(id) >= 150, `${id} has a price`);
}
{
  const p = Progress.fresh(); p.credits = 10000;
  const id = 'goldenhind', price = Progress.blueprintPrice(id);
  ok(Progress.buyBlueprint(p, id) && p.credits === 10000 - price && !Progress.buyBlueprint(p, id), 'buy blueprint once');
  ok(!Progress.blueprintNeeds(p, 'goldenhind').dock && !Progress.blueprintNeeds(p, 'goldenhind').parts.length, 'Golden Hind buildable from the start');
  ok(Progress.blueprintNeeds(p, 'nimitz').dock && Progress.blueprintNeeds(p, 'nimitz').parts.includes('hangar'), 'Nimitz needs Dock V and hangars');
  ok(Progress.sanitize({v: 1, blueprints: ['yamato', 'nope']}).blueprints.join() === 'yamato', 'sanitize blueprints');
  // broadside guns fire only across the beam
  const w = new Sim.World({rng: Util.rng(4)});
  const gh = w.addShip(Design.fromRows(Data.FAMOUS.warrior.rows), {team: 0, x: 0, y: 0, a: 0, player: true});
  w.addShip(Design.fromRows(Data.ENEMIES.patrol.rows), {team: 1, x: 0, y: -150, a: 0});   // dead ahead
  let fired = 0; for (let i = 0; i < 90; i++) { w.step(1 / 30); for (const e of w.drain()) if (e.type === 'fire' && e.kind === 'battery') fired++; }
  ok(fired === 0, 'gun deck holds fire at a target dead ahead');
  gh.a = Math.PI / 2; // now the target is on the port beam
  for (let i = 0; i < 120; i++) { w.step(1 / 30); for (const e of w.drain()) if (e.type === 'fire' && e.kind === 'battery') fired++; }
  ok(fired > 0, `gun deck fires on the beam (${fired} shots)`);
}

section('transmission efficiency');
{
  const sym = Design.fromRows(['.HXH.', 'HHCHH', 'HHHHH', 'HEHEH'], 5, 4), lop = Design.fromRows(['.HXH.', 'HHCHH', 'HHHHH', 'HEHHH'], 5, 4);
  const centre = Design.fromRows(['.HXH.', 'HHCHH', 'HHHHH', 'HHEHH'], 5, 4);
  ok(Design.analyze(sym).trans === 1, 'mirrored engines: 100%');
  ok(Design.analyze(centre).trans === 1, 'centreline engine: 100%');
  ok(Math.abs(Design.analyze(lop).trans - 0.85) < 1e-9, 'one-sided engine: 85%');
  const w = new Sim.World({rng: Util.rng(3)}), s = w.addShip(sym, {team: 0, x: 0, y: 0, a: 0});
  ok(s.trans === 1, 'sim ship starts balanced');
  const e = s.blocks.find(b => b.t === 'engine'); e.alive = false; s.recompute();
  ok(Math.abs(s.trans - 0.85) < 1e-9 && s.thrust > 0, 'losing one of a mirrored pair drops to 85%');
}

section('manual fire control');
{
  const w = new Sim.World({rng: Util.rng(21)});
  const me = w.addShip(Design.fromRows(Data.FAMOUS.iowa.rows), {team: 0, x: 0, y: 0, a: 0, player: true, manual: true});
  const foe = w.addShip(Design.fromRows(Data.ENEMIES.cruiser.rows), {team: 1, x: 0, y: -320, a: Math.PI / 2});
  ok(me.mainType === 'heavy', `main battery is the heaviest gun (${me.mainType})`);
  let fired = 0, salvo = 0;
  const count = () => { for (const e of w.drain()) { if (e.type === 'fire' && e.ship === me && e.kind === 'heavy') fired++; if (e.type === 'salvo') salvo++; } };
  for (let i = 0; i < 120; i++) { w.step(1 / 30); count(); }
  ok(fired === 0, 'manual guns hold fire without a command');
  me.aim = {x: foe.x, y: foe.y};
  for (let i = 0; i < 150; i++) { w.step(1 / 30); count(); }
  ok(me.fc.main === 3 && me.fc.canFire > 0, `turrets come to bear on the aim point (${me.fc.canFire}/${me.fc.main} can fire)`);
  me.cmd.fire = 1; w.step(1 / 30); count();
  ok(fired === 1, `one tap fires one mount (${fired})`);
  me.cmd.salvo = 1; w.step(1 / 30); count();
  ok(fired >= 2 && salvo === 1, `double tap fires a salvo (${fired} total)`);
  for (let i = 0; i < 90; i++) { w.step(1 / 30); count(); }
  ok(w.stats.dmg > 0, 'aimed shells hit the target');
  me.aim = {x: 0, y: -2000};
  for (let i = 0; i < 60; i++) { w.step(1 / 30); count(); }
  ok(!me.fc.inRange && me.fc.canFire === 0, 'out-of-range aim cannot fire');
  // torpedoes and specials
  const w2 = new Sim.World({rng: Util.rng(22)});
  const dd = w2.addShip(Design.fromRows(Data.FAMOUS.fletcher.rows), {team: 0, x: 0, y: 0, a: 0, player: true, manual: true});
  w2.addShip(Design.fromRows(Data.ENEMIES.patrol.rows), {team: 1, x: 300, y: 0, a: 0});
  dd.aim = {x: 300, y: 0};
  for (let i = 0; i < 60; i++) w2.step(1 / 30);
  w2.drain(); dd.cmd.torp = 1; w2.step(1 / 30);
  ok(w2.torps.length > 0, `torpedo command launches tubes that bear (${w2.torps.length})`);
}

// ------------------------------------------------------------------ design rules
section('design rules');
{
  const d = Design.create(7, 9);
  ok(Design.place(d, 1, 2, 'hull', true) && d.cells[5 + 2 * 7] === 'hull', 'mirror places both sides');
  Design.place(d, 3, 4, 'bridge', true); Design.place(d, 3, 5, 'bridge', true);
  ok(d.cells.filter(x => x === 'bridge').length === 1, 'only one bridge');
  Design.place(d, 2, 5, 'hull', true);
  ok(d.cells[3 + 5 * 7] === 'bridge', 'mirror never overwrites the bridge');
  const h = new Design.History(); h.push(d); Design.place(d, 0, 0, 'armor', false);
  const u = h.undo(d); ok(u && u.cells[0] === null, 'undo restores'); const r = h.redo(u); ok(r && r.cells[0] === 'armor', 'redo reapplies');
  const big = Design.resize(Design.fromRows(Data.STARTER), 11, 23);
  ok(Design.analyze(big).n === Design.analyze(Design.fromRows(Data.STARTER)).n, 'resize keeps all blocks');
}

// ------------------------------------------------------------------ sim invariants
section('simulation');
{
  const res = battle(Design.fromRows(REF.t2), ['destroyer', 'cruiser'], 'medium', 7, {limit: 200});
  ok(res.t > 5, 'battle runs');
  const ev = new Set();
  const w = new Sim.World({rng: Util.rng(3)});
  const p = w.addShip(Design.fromRows(REF.t3), {team: 0, x: 0, y: 300, a: 0, player: true});
  AI.spawnFleet(w, ['frigate', 'corvette', 'railcruiser'], Data.DIFFICULTY.hard);
  p.brain = AI.autopilot(Data.DIFFICULTY.medium).brain(p);
  for (let i = 0; i < 30 * 60; i++) { w.step(1 / 30); for (const e of w.drain()) ev.add(e.type); }
  for (const t of ['fire', 'hit', 'splash', 'blockLost', 'rocket', 'rail', 'ciws']) ok(ev.has(t), `event "${t}" seen`);
  for (const s of w.ships) for (const b of s.blocks) ok(!(b.alive && b.hp <= 0), 'no zombie blocks') || 0;
  // smoke and repair
  const w2 = new Sim.World({rng: Util.rng(5)});
  const s2 = w2.addShip(Design.fromRows(['.HSH.', 'HHBHH', 'HHWHH', 'HGEGH', '.HRH.']), {team: 0, x: 0, y: 0, a: 0});
  ok(w2.deploySmoke(s2) && w2.smokes.length === 1 && !w2.deploySmoke(s2), 'smoke deploys once per cooldown');
  ok(w2.inSmoke(5, 5), 'inside smoke');
  const victim = s2.blocks.find(b => b.t === 'hull'); victim.hp = 5;
  for (let i = 0; i < 60; i++) w2.step(1 / 30);
  ok(victim.hp > 5, 'repair bay heals');
  // aircraft: launch, attack, return
  const w4 = new Sim.World({rng: Util.rng(11)});
  const cv = w4.addShip(Design.fromRows(Data.FAMOUS.enterprise.rows), {team: 0, x: 0, y: 500, a: 0, player: true});
  const tgt = w4.addShip(Design.fromRows(Data.ENEMIES.cruiser.rows), {team: 1, x: 0, y: -200, a: Math.PI});
  const seen4 = new Set(); let maxAir = 0;
  for (let i = 0; i < 30 * 50; i++) { w4.step(1 / 30); maxAir = Math.max(maxAir, w4.planes.length); for (const e of w4.drain()) seen4.add(e.type); }
  for (const t of ['launch', 'dive', 'bombDrop', 'land']) ok(seen4.has(t), `aircraft event "${t}"`);
  ok(maxAir > 1, `several planes airborne (${maxAir})`);
  ok(w4.stats.dmg > 0, 'bombs deal damage');
  // AA shoots planes down
  const w5 = new Sim.World({rng: Util.rng(12)});
  w5.addShip(Design.fromRows(Data.FAMOUS.akagi.rows), {team: 1, x: 0, y: -400, a: Math.PI});
  const flak = w5.addShip(Design.fromRows(['..QHQ..', '.QHHHQ.', 'QHHBHHQ', 'QHHGHHQ', '.QHEHQ.', '..HRH..']), {team: 0, x: 0, y: 400, a: 0, player: true});
  for (let i = 0; i < 30 * 60; i++) { w5.step(1 / 30); w5.drain(); }
  ok(w5.stats.planesDown > 0, `AA downs planes (${w5.stats.planesDown})`);
  // sinking by flooding
  const w3 = new Sim.World({rng: Util.rng(9)});
  const s3 = w3.addShip(Design.fromRows(REF.starter), {team: 0, x: 0, y: 0, a: 0});
  for (const b of s3.blocks) if (b.t === 'hull' && b.c < s3.cx) w3.damageBlock(s3, b, 999, null, true);
  w3.step(1 / 30);
  ok(s3.sinking || s3.listRoll !== 0, 'heavy damage lists or sinks the ship');
}

// ------------------------------------------------------------------ progression
section('progression');
{
  const p = Progress.fresh();
  ok(Progress.partStatus(p, 'heavy').state === 'locked', 'heavy locked before op 2');
  p.stars[0] = 1; p.credits = 1000;
  ok(Progress.partStatus(p, 'heavy').state === 'buy' && Progress.buyPart(p, 'heavy') && p.credits === 750, 'buy heavy');
  ok(!Progress.buyPart(p, 'heavy'), 'cannot buy twice');
  ok(Progress.buyTrack(p, 'plating') && p.tracks.plating === 1, 'buy track');
  p.credits = 600; ok(Progress.buyDock(p) && p.design.w === 9 && p.design.h === 19, 'dock upgrade resizes design');
  const rw = Progress.reward(Progress.fresh(), {op: 0, won: true, integrity: 0.9, time: 60, sunkCost: 400, difficulty: 'medium'});
  ok(rw.stars === 3 && rw.total > 0, `3-star reward ${rw.total}`);
  const easy = Progress.reward(Progress.fresh(), {op: 0, won: true, integrity: 0.9, time: 60, sunkCost: 400, difficulty: 'easy'}).total;
  const hard = Progress.reward(Progress.fresh(), {op: 0, won: true, integrity: 0.9, time: 60, sunkCost: 400, difficulty: 'hard'}).total;
  ok(easy < rw.total && rw.total < hard, 'difficulty scales rewards');
  const junk = Progress.sanitize({v: 1, credits: -5, parts: ['nope', 'rail'], dock: 9, stars: [3, 'x'], settings: {difficulty: 'insane'}});
  ok(junk.credits === 0 && junk.dock === Data.DOCKS.length - 1 && junk.stars[1] === 0 && junk.settings.difficulty === 'medium' && !junk.parts.includes('nope'), 'sanitize');
  ok(Progress.sanitize(null).credits === 0, 'fresh profile from nothing');
}
section('endless');
{
  const rng = Util.rng(1);
  for (const wv of [1, 3, 6, 10, 15, 25]) {
    const ids = AI.endlessWave(wv, rng);
    ok(ids.length >= 1 && ids.every(i => Data.ENEMIES[i]), `wave ${wv}: ${ids.join(',')}`);
  }
  const w = new Sim.World({rng: Util.rng(2)});
  const s = w.addShip(Design.fromRows(REF.t2), {team: 0, x: 0, y: 0, a: 0});
  for (const b of s.blocks.slice(0, 10)) if (b.t !== 'bridge') w.damageBlock(s, b, 999, null, true);
  w.step(1 / 30); const before = s.count; w.repairShip(s, 0.5);
  ok(s.count > before, `repairShip rebuilds (${before} -> ${s.count})`);
}

// ------------------------------------------------------------------ AI tiers
section('difficulty ordering (win rate of the test captain)');
{
  const ops = BALANCE ? Data.OPS.map((_, i) => i) : [1, 4, 8];
  const trials = BALANCE ? 6 : 3;
  const total = {easy: 0, medium: 0, hard: 0}, n = {easy: 0, medium: 0, hard: 0};
  for (const i of ops) {
    const op = Data.OPS[i], design = Design.fromRows(REF[refFor(i)]);
    const row = [];
    for (const diff of ['easy', 'medium', 'hard']) {
      let wins = 0, time = 0, timeouts = 0;
      for (let k = 0; k < trials; k++) {
        const r = battle(design, op.enemies, diff, 1000 + i * 31 + k, {weather: op.weather, mods: modsFor(i)});
        if (r.won) { wins++; time += r.t; } if (r.timeout) timeouts++;
      }
      total[diff] += wins; n[diff] += trials;
      row.push(`${diff} ${wins}/${trials}${wins ? ' ' + Math.round(time / wins) + 's' : ''}${timeouts ? ' (' + timeouts + ' t/o)' : ''}`);
    }
    console.log(`  op ${String(i + 1).padStart(2)} ${op.name.padEnd(16)} [${refFor(i)}]  ${row.join('  ')}`);
  }
  const rate = d => total[d] / n[d];
  console.log(`  overall: easy ${(rate('easy') * 100).toFixed(0)}%  medium ${(rate('medium') * 100).toFixed(0)}%  hard ${(rate('hard') * 100).toFixed(0)}%`);
  const tol = BALANCE ? 0.05 : 0.12; // small samples are noisy
  ok(rate('easy') >= rate('medium') - tol && rate('medium') >= rate('hard') - tol, 'easy >= medium >= hard (within sampling noise)');
  ok(rate('easy') > rate('hard'), 'easy strictly easier than hard');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
