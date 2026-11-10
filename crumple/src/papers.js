// The paper rack. Pure data: no three.js, importable in node.
//
// Every entry is a real stock. `stock` is how a paper merchant would label it.
// Physics fields:
//   radius       crumpled-ball radius (m)
//   dragK        quadratic drag coefficient / mass, in 1/m:  a = -dragK * |v_rel| * v_rel
//                (v_rel = ball velocity - wind velocity). Bigger = floatier, more wind-blown.
//   restitution  bounciness of the ball itself, 0..1 (multiplied with the surface's)
//   friction     tangential grip on contact, 0..1
// Feel/sound fields (0..1): bright = high-frequency crackle, weight = low thud, crisp = attack.
// `mult` is the score multiplier that compensates for how hard the stock is to sink.
// `unlock.sinks` is the career sink count that opens it in ranked play.

/**
 * @typedef {Object} Paper
 * @property {string} id
 * @property {string} name
 * @property {string} stock
 * @property {string} blurb
 * @property {number} radius
 * @property {number} dragK
 * @property {number} restitution
 * @property {number} friction
 * @property {number} color        base colour, 0xRRGGBB
 * @property {number} ink          print/line colour, 0xRRGGBB
 * @property {'plain'|'ruled'|'legal'|'news'|'construction'|'kraft'|'gloss'|'wax'|'tissue'|'blueprint'|'grid'|'receipt'} pattern
 * @property {number} roughness    PBR roughness for the ball material, 0..1
 * @property {number} sheen        0..1, glossy highlight strength
 * @property {{bright:number, weight:number, crisp:number}} sound
 * @property {number} mult
 * @property {{sinks:number}} unlock
 */

/** @type {Paper[]} */
export const PAPERS = [
  {
    id: 'copy',
    name: 'Copy Paper',
    stock: '20 lb bond · 75 gsm',
    blurb: 'The office standard. Honest flight, honest bounce.',
    radius: 0.036, dragK: 0.14, restitution: 0.42, friction: 0.55,
    color: 0xf4f4f0, ink: 0x9aa3ad, pattern: 'plain', roughness: 0.92, sheen: 0.0,
    sound: { bright: 0.6, weight: 0.4, crisp: 0.7 },
    mult: 1.0, unlock: { sinks: 0 },
  },
  {
    id: 'legal',
    name: 'Legal Pad',
    stock: '16 lb canary ruled · 60 gsm',
    blurb: 'A shade lighter than copy. Drifts a little, lands soft.',
    radius: 0.035, dragK: 0.16, restitution: 0.38, friction: 0.55,
    color: 0xf7e36b, ink: 0x4a78c2, pattern: 'legal', roughness: 0.93, sheen: 0.0,
    sound: { bright: 0.65, weight: 0.32, crisp: 0.7 },
    mult: 1.05, unlock: { sinks: 8 },
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    stock: '30 lb news · 45 gsm',
    blurb: 'Soft and floaty. The breeze has opinions about it.',
    radius: 0.04, dragK: 0.19, restitution: 0.3, friction: 0.65,
    color: 0xd9d4c6, ink: 0x2c2c2c, pattern: 'news', roughness: 0.98, sheen: 0.0,
    sound: { bright: 0.4, weight: 0.3, crisp: 0.35 },
    mult: 1.15, unlock: { sinks: 20 },
  },
  {
    id: 'construction',
    name: 'Construction Paper',
    stock: '76 lb sulphite · 120 gsm',
    blurb: 'Thick, toothy and dull. Dies where it lands.',
    radius: 0.04, dragK: 0.11, restitution: 0.3, friction: 0.75,
    color: 0xd9582b, ink: 0xb8451f, pattern: 'construction', roughness: 1.0, sheen: 0.0,
    sound: { bright: 0.3, weight: 0.6, crisp: 0.4 },
    mult: 1.0, unlock: { sinks: 35 },
  },
  {
    id: 'kraft',
    name: 'Kraft Paper',
    stock: '60 lb natural kraft · 98 gsm',
    blurb: 'Grocery-bag brown. A big, bulky ball with less room to spare.',
    radius: 0.05, dragK: 0.12, restitution: 0.4, friction: 0.6,
    color: 0xb58a5a, ink: 0x8c6a45, pattern: 'kraft', roughness: 0.95, sheen: 0.0,
    sound: { bright: 0.45, weight: 0.7, crisp: 0.55 },
    mult: 1.2, unlock: { sinks: 55 },
  },
  {
    id: 'cardstock',
    name: 'Cardstock',
    stock: '110 lb index · 199 gsm',
    blurb: 'Cuts through wind. Springs off every rim it touches.',
    radius: 0.038, dragK: 0.075, restitution: 0.56, friction: 0.45,
    color: 0xfdfcf7, ink: 0xc9ccd1, pattern: 'plain', roughness: 0.8, sheen: 0.1,
    sound: { bright: 0.5, weight: 0.8, crisp: 0.9 },
    mult: 1.1, unlock: { sinks: 80 },
  },
  {
    id: 'magazine',
    name: 'Magazine Page',
    stock: '80 lb gloss text · 118 gsm',
    blurb: 'Dense, slick and lively. Small target, big bounce.',
    radius: 0.033, dragK: 0.085, restitution: 0.5, friction: 0.3,
    color: 0xe9eef2, ink: 0xd0345b, pattern: 'gloss', roughness: 0.35, sheen: 0.6,
    sound: { bright: 0.85, weight: 0.55, crisp: 0.85 },
    mult: 1.15, unlock: { sinks: 110 },
  },
  {
    id: 'wax',
    name: 'Wax Paper',
    stock: '25 lb dry wax · 40 gsm',
    blurb: 'Light and slippery. Skates off surfaces instead of gripping.',
    radius: 0.034, dragK: 0.18, restitution: 0.28, friction: 0.12,
    color: 0xf2efe2, ink: 0xe2ddc9, pattern: 'wax', roughness: 0.4, sheen: 0.45,
    sound: { bright: 0.9, weight: 0.2, crisp: 0.6 },
    mult: 1.15, unlock: { sinks: 145 },
  },
  {
    id: 'tissue',
    name: 'Tissue Paper',
    stock: '10 lb gift tissue · 17 gsm',
    blurb: 'Barely there. Hangs in the air and goes where the wind says.',
    radius: 0.042, dragK: 0.26, restitution: 0.18, friction: 0.7,
    color: 0xf6c6d8, ink: 0xeeaec6, pattern: 'tissue', roughness: 1.0, sheen: 0.0,
    sound: { bright: 0.75, weight: 0.1, crisp: 0.25 },
    mult: 1.5, unlock: { sinks: 190 },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    stock: '20 lb bond, Arch D 24 × 36 in',
    blurb: 'A whole drawing set in one fist. Barely fits the bin.',
    radius: 0.064, dragK: 0.13, restitution: 0.44, friction: 0.55,
    color: 0x2f5fa8, ink: 0xdfeaff, pattern: 'blueprint', roughness: 0.9, sheen: 0.0,
    sound: { bright: 0.55, weight: 0.9, crisp: 0.65 },
    mult: 1.4, unlock: { sinks: 240 },
  },
];

export const PAPER_BY_ID = Object.fromEntries(PAPERS.map((p) => [p.id, p]));
export const DEFAULT_PAPER_ID = 'copy';
