import fs from 'fs';
const html = fs.readFileSync('/home/user/The-Keeper/hydrobuddy.html','utf8');
function grab(name){
  const start = html.indexOf('var ' + name + ' = [');
  if(start < 0) throw new Error('missing ' + name);
  let i = html.indexOf('[', start), depth = 0, end = -1;
  for(let j=i;j<html.length;j++){
    const c = html[j];
    if(c === '[') depth++;
    else if(c === ']'){ depth--; if(depth === 0){ end = j; break; } }
  }
  return html.slice(i, end+1);
}
const DRINKS = eval(grab('DRINKS'));
const COACHES = eval(grab('COACHES'));
const CHAOS = eval(grab('CHAOS'));

const q = s => '"' + String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
const arr = a => '[' + a.map(q).join(', ') + ']';
const INTENTS = ['welcome','behind','ontrack','almost','done','over','comeback'];

let out = `// Generated from hydrobuddy.html by tools/gen-content.mjs — do not edit by hand.
// Regenerate with:  node tools/gen-content.mjs
// ${COACHES.length} coaches, ${CHAOS.length} chaos lines, ${DRINKS.length} drink types.

import Foundation

extension DrinkType {
    static let all: [DrinkType] = [
`;
for(const d of DRINKS){
  out += `        DrinkType(id: ${q(d.id)}, name: ${q(d.name)}, emoji: ${q(d.emoji)}, factor: ${d.factor.toFixed(2)}, isAlcohol: ${!!d.alcohol}),\n`;
}
out += `    ]
}

extension Coach {
    static let all: [Coach] = [
`;
for(const c of COACHES){
  out += `        Coach(
            id: ${q(c.id)},
            name: ${q(c.name)},
            species: ${q(c.species)},
            emoji: ${q(c.emoji)},
            accentHex: ${q(c.accent)},
            vibe: ${q(c.vibe)},
            blurb: ${q(c.blurb)},
            lines: [
`;
  for(const k of INTENTS){
    const lines = c.lines[k] || [];
    out += `                .${k}: [\n`;
    for(const l of lines) out += `                    ${q(l)},\n`;
    out += `                ],\n`;
  }
  out += `            ],
            feralSignatures: [
`;
  for(const l of (c.feral||[])) out += `                ${q(l)},\n`;
  out += `            ]
        ),
`;
}
out += `    ]
}

enum ChaosChorus {
    static let all: [String] = [
`;
for(const l of CHAOS) out += `        ${q(l)},\n`;
out += `    ]
}
`;
fs.mkdirSync('/home/user/The-Keeper/hydrobuddy-ios/HydroBuddy', {recursive:true});
fs.writeFileSync('/home/user/The-Keeper/hydrobuddy-ios/HydroBuddy/CoachContent.swift', out);
console.log('coaches', COACHES.length, 'drinks', DRINKS.length, 'chaos', CHAOS.length,
  'lines', COACHES.reduce((n,c)=>n+INTENTS.reduce((m,k)=>m+(c.lines[k]||[]).length,0)+(c.feral||[]).length,0),
  '| bytes', out.length);
