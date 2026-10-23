// Builds parity vectors for the Swift port by running the JS implementation
// that already has browser test coverage. Regenerate with:
//   node tools/gen-vectors.mjs
import fs from 'fs';

const html = fs.readFileSync(new URL('../../hydrobuddy.html', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

function block(startIndex) {
  let depth = 0, i = script.indexOf('{', startIndex);
  for (let j = i; j < script.length; j++) {
    if (script[j] === '{') depth++;
    else if (script[j] === '}') { depth--; if (depth === 0) return script.slice(startIndex, j + 1); }
  }
  throw new Error('unbalanced');
}
function fn(name) {
  const at = script.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('missing function ' + name);
  return block(at);
}
function arrayLiteral(name) {
  const at = script.indexOf('var ' + name + ' = [');
  let i = script.indexOf('[', at), depth = 0;
  for (let j = i; j < script.length; j++) {
    if (script[j] === '[') depth++;
    else if (script[j] === ']') { depth--; if (depth === 0) return script.slice(i, j + 1); }
  }
  throw new Error('unbalanced array ' + name);
}

const names = ['pad','dayKey','keyToDate','shiftDay','unitName','toUnits','fromUnits','fmt','stepMl',
  'smallSipMl','hhmmToMin','estimate','goalMl','entries','dayTotal','dayRaw','metGoal','currentStreak',
  'bestStreak','lastNDays','trackedStats','currentIntent','drinkById'];

const source = `
  var OZ = 29.5735;
  var DRINKS = ${arrayLiteral('DRINKS')};
  var S = {};
  var NOW_MIN = 0;
  function nowMin(){ return NOW_MIN; }
  ${names.map(fn).join('\n')}
  ${fn('pace')}
  return {
    setState: function(s){ S = s; },
    setNow: function(m){ NOW_MIN = m; },
    estimate: estimate, goalMl: goalMl, fmt: fmt, pace: pace, dayKey: dayKey, shiftDay: shiftDay,
    currentStreak: currentStreak, bestStreak: bestStreak, trackedStats: trackedStats,
    currentIntent: currentIntent, metGoal: metGoal, dayTotal: dayTotal
  };
`;
const js = new Function(source)();

const round6 = n => Math.round(n * 1e6) / 1e6;
const baseProfile = { weight:160, age:30, sex:'female', activity:20, climate:'temperate', special:'none',
                      wake:'07:00', sleep:'22:30' };

// --- deterministic pseudo-random inputs -------------------------------------
let seed = 20260922;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const choose = a => a[Math.floor(rnd() * a.length)];

const estimates = [];
for (let i = 0; i < 120; i++) {
  const units = choose(['oz','ml']);
  const profile = {
    weight: units === 'oz' ? Math.round(80 + rnd() * 280) : Math.round(35 + rnd() * 130),
    age: Math.round(13 + rnd() * 80),
    sex: choose(['female','male','other']),
    activity: Math.round(rnd() * 240 / 5) * 5,
    climate: choose(['cool','temperate','warm','hot']),
    special: choose(['none','pregnant','nursing']),
    wake: '07:00', sleep: '22:30'
  };
  js.setState({ units, profile, goalOverrideMl: null, log: {}, onboarded: true });
  const e = js.estimate();
  estimates.push({
    units, profile: { ...profile, wakeMinutes: 420, sleepMinutes: 1350 },
    expected: {
      base: round6(e.base), age: round6(e.ageAdj), sex: round6(e.sexAdj), activity: round6(e.actAdj),
      climate: round6(e.climAdj), lifeStage: round6(e.lifeAdj), food: round6(e.foodAdj), total: round6(e.total)
    }
  });
}

// --- formatting --------------------------------------------------------------
const formats = [];
for (let i = 0; i < 60; i++) {
  const ml = round6(rnd() * 4000);
  for (const units of ['oz','ml']) {
    js.setState({ units, profile: baseProfile, goalOverrideMl: null, log: {}, onboarded: true });
    formats.push({ millilitres: ml, units, expected: js.fmt(ml) });
  }
}

// --- pace --------------------------------------------------------------------
const paces = [];
for (let i = 0; i < 60; i++) {
  const wake = Math.round(rnd() * 10) * 30;
  const sleep = wake + 480 + Math.round(rnd() * 16) * 30;
  const profile = { ...baseProfile, wake: hhmm(wake), sleep: hhmm(sleep % 1440) };
  const goal = 1500 + Math.round(rnd() * 3000);
  const total = Math.round(rnd() * 4000);
  const now = Math.round(rnd() * 1439);
  js.setState({ units:'ml', profile, goalOverrideMl: goal, log: { [js.dayKey()]: [mlEntry(total)] }, onboarded: true });
  js.setNow(now);
  const p = js.pace();
  paces.push({
    wakeMinutes: wake, sleepMinutes: sleep % 1440, goal, total, nowMinutes: now,
    expected: { through: round6(p.through), expected: round6(p.expected), delta: round6(p.delta) }
  });
}

// --- streaks and intents -----------------------------------------------------
const streaks = [];
for (let i = 0; i < 40; i++) {
  const goal = 2000 + Math.round(rnd() * 1500);
  const days = [];
  const log = {};
  const today = js.dayKey();
  const span = 12;
  for (let d = span - 1; d >= 0; d--) {
    const roll = rnd();
    const amount = roll < 0.35 ? 0 : (roll < 0.6 ? Math.round(goal * 0.5) : Math.round(goal * 1.05));
    if (amount > 0) {
      log[js.shiftDay(today, -d)] = [mlEntry(amount)];
      days.push({ offset: -d, millilitres: amount });
    }
  }
  js.setState({ units:'ml', profile: baseProfile, goalOverrideMl: goal, log, onboarded: true });
  js.setNow(600);
  const stats = js.trackedStats(30);
  streaks.push({
    goal, days,
    expected: {
      currentStreak: js.currentStreak(),
      bestStreak: js.bestStreak(),
      loggedDays: stats.logged,
      metDays: stats.met,
      average: round6(stats.avg),
      intent: js.currentIntent()
    }
  });
}

function hhmm(m){ return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'); }
function mlEntry(ml){ return { id:'v', t: Date.now(), type:'water', ml: ml, eff: ml }; }

const out = {
  generatedFrom: 'hydrobuddy.html',
  generatedAt: new Date().toISOString(),
  estimates, formats, paces, streaks
};
fs.writeFileSync(new URL('../HydroBuddyTests/parity-vectors.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('estimates', estimates.length, 'formats', formats.length, 'paces', paces.length, 'streaks', streaks.length);
