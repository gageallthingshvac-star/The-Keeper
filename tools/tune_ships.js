// Tunes each historical ship's machinery so its game speed matches history (capped at the game's 31 kn).
// Converts plain hull/deck/cabin cells to Machinery (V) from the middle of the ship outward, or back.
// Rewrites src/ships.js in place. Usage: node tools/tune_ships.js [--dry]
const fs = require('fs'), path = require('path');
const {load} = require('../tests/harness');
const {Data, Design} = load();
const FILE = path.join(__dirname, '..', 'src', 'ships.js');
let src = fs.readFileSync(FILE, 'utf8');
const dry = process.argv.includes('--dry');
const CAP = 31;
const kn = rows => { const a = Design.analyze(Design.fromRows(rows)); return {kn: a.speed * Design.KN, a}; };

for (const [id, F] of Object.entries(Data.FAMOUS)) {
  if (id === 'musashi') continue;                       // shares Yamato's rows
  const target = Math.min(F.kn, CAP), noV = F.era === 'sail' && id !== 'warrior';
  let rows = F.rows.map(r => r.split(''));
  const w = rows[0].length, h = rows.length, mid = (w - 1) / 2;
  // candidate cells: centreline first, then outward; middle of the ship first along its length
  const cells = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push([r, c]);
  cells.sort((p, q) => (Math.abs(p[1] - mid) - Math.abs(q[1] - mid)) * 100 + Math.abs(p[0] - h * 0.55) - Math.abs(q[0] - h * 0.55));
  const str = () => rows.map(r => r.join(''));
  let {kn: k} = kn(str()), guard = 0;
  // reset any previous tuning, then add machinery one block at a time and keep the closest result
  for (const r of rows) for (let c = 0; c < w; c++) if (r[c] === 'V') r[c] = 'H';
  k = kn(str()).kn;
  let best = {rows: str(), k};
  while (!noV && k < target && guard++ < 80) {
    const cell = cells.find(([r, c]) => 'HJU'.includes(rows[r][c]) && r > 0 && r < h - 1);
    if (!cell) break;
    rows[cell[0]][cell[1]] = 'V';
    k = kn(str()).kn;
    const needsEngine = Design.analyze(Design.fromRows(best.rows)).thrust === 0;
    if (needsEngine || Math.abs(k - target) < Math.abs(best.k - target)) best = {rows: str(), k};
  }
  rows = best.rows.map(r => r.split('')); k = best.k;
  const {a} = kn(str());
  const margin = (a.buoy - a.mass) / a.buoy;
  console.log(`${id.padEnd(15)} ${w}x${h}  target ${target.toFixed(1)}  game ${k.toFixed(1)} kn  float margin ${(margin * 100).toFixed(0)}%  cost ${a.cost}` +
              (Design.problems(a, {}).length ? '  PROBLEM: ' + Design.problems(a, {}).join(' ') : ''));
  // rewrite this ship's rows block
  const start = src.indexOf(`\n    ${id}: {`);
  const rs = src.indexOf('rows: [', start), re = src.indexOf(']}', rs);
  const body = 'rows: [\n' + str().map(r => `      '${r}',`).join('\n').replace(/,$/, '');
  src = src.slice(0, rs) + body + src.slice(re);
}
if (!dry) fs.writeFileSync(FILE, src);
