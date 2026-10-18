// Loads the DOM-free game modules into one Node VM context so the simulation,
// AI, design rules and progression can be exercised headlessly.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const PURE = ['util', 'data', 'ships', 'design', 'sim', 'ai', 'progress'];

function load() {
  const ctx = { console, Math, Date, JSON, performance: { now: () => Date.now() } };
  vm.createContext(ctx);
  const code = "'use strict';\n" + PURE.map(m => fs.readFileSync(path.join(SRC, m + '.js'), 'utf8')).join('\n') +
    '\n;({Util, Data, Design, Sim, AI, Progress})';
  return vm.runInContext(code, ctx, { filename: 'game-pure.js' });
}
module.exports = { load };
