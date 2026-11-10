// The venues. Pure data: no three.js, importable in node.
// The 3D scene for each venue lives in ./scene-<id>.js and must match these numbers:
// physics collides with exactly what is described here.
//
// Frame: bin centre on the floor at the origin, player at +Z throwing toward -Z, +X right.
//
//   bin.rimRadius / baseRadius / height   open-top tapered can (m)
//   bin.restitution / friction            how lively and grippy the can is
//   bin.material                          drives the impact sound and the 3D model
//   floor.restitution / friction / material
//   backWallZ      z of the wall behind the bin (negative). Bank shots come off it.
//   sideWallX      half-width of the room; walls at x = ±sideWallX (null = open air)
//   ceilingY       ceiling height (null = open air)
//   gravity        m/s²
//   windScale      multiplies the wind the difficulty curve asks for
//   gustiness      0..1 multiplies gust depth; open-air venues gust more
//   wind.source    the in-world thing that makes the air move (drives props + ambience)
//   audio.reverb   seconds = RT60-ish tail, tone 0..1 dark→bright, wet 0..1
//   mult           score multiplier compensating for how hard the venue plays
//   unlock.points  career points that open it in ranked play

/**
 * @typedef {Object} Venue
 * @property {string} id
 * @property {string} name
 * @property {string} tagline
 * @property {{material:'wire'|'plastic'|'galvanized'|'drum'|'can'|'alloy', rimRadius:number, baseRadius:number, height:number, restitution:number, friction:number, label:string}} bin
 * @property {{material:'wood'|'vinyl'|'concrete'|'steelplate'|'gravel'|'composite', restitution:number, friction:number}} floor
 * @property {number} backWallZ
 * @property {{restitution:number, friction:number, material:string}} wall
 * @property {number|null} sideWallX
 * @property {number|null} ceilingY
 * @property {number} gravity
 * @property {number} windScale
 * @property {number} gustiness
 * @property {{source:'window'|'ceilingfan'|'boxfan'|'diffuser'|'openair'|'vent', label:string}} wind
 * @property {{reverb:{seconds:number, tone:number, wet:number}, ambience:'study'|'classroom'|'shop'|'mech'|'rooftop'|'hab'}} audio
 * @property {number} mult
 * @property {{points:number}} unlock
 */

/** @type {Venue[]} */
export const VENUES = [
  {
    id: 'study',
    name: 'The Study',
    tagline: 'Home office, late. A draft from the cracked window.',
    bin: { material: 'wire', label: 'Wire-mesh wastebasket', rimRadius: 0.15, baseRadius: 0.115, height: 0.36, restitution: 0.35, friction: 0.5 },
    floor: { material: 'wood', restitution: 0.5, friction: 0.55 },
    backWallZ: -0.5,
    wall: { material: 'plaster', restitution: 0.45, friction: 0.5 },
    sideWallX: 2.6, ceilingY: 3.8, gravity: 9.81,
    windScale: 0.85, gustiness: 0.5,
    wind: { source: 'window', label: 'Window draft' },
    audio: { reverb: { seconds: 0.45, tone: 0.35, wet: 0.16 }, ambience: 'study' },
    mult: 1.0, unlock: { points: 0 },
  },
  {
    id: 'classroom',
    name: 'Room 204',
    tagline: 'After the bell. Ceiling fans still turning.',
    bin: { material: 'plastic', label: 'Classroom bin', rimRadius: 0.165, baseRadius: 0.125, height: 0.4, restitution: 0.3, friction: 0.45 },
    floor: { material: 'vinyl', restitution: 0.55, friction: 0.45 },
    backWallZ: -0.55,
    wall: { material: 'chalkboard', restitution: 0.5, friction: 0.45 },
    sideWallX: 3.4, ceilingY: 3.8, gravity: 9.81,
    windScale: 1.0, gustiness: 0.4,
    wind: { source: 'ceilingfan', label: 'Ceiling fans' },
    audio: { reverb: { seconds: 0.9, tone: 0.55, wet: 0.24 }, ambience: 'classroom' },
    mult: 1.0, unlock: { points: 4000 },
  },
  {
    id: 'shop',
    name: 'The Shop',
    tagline: 'Garage workshop. Box fan on high, pail by the bench.',
    bin: { material: 'galvanized', label: 'Galvanized pail', rimRadius: 0.15, baseRadius: 0.11, height: 0.3, restitution: 0.5, friction: 0.35 },
    floor: { material: 'concrete', restitution: 0.6, friction: 0.6 },
    backWallZ: -0.6,
    wall: { material: 'pegboard', restitution: 0.4, friction: 0.55 },
    sideWallX: 3.0, ceilingY: 3.8, gravity: 9.81,
    windScale: 1.2, gustiness: 0.35,
    wind: { source: 'boxfan', label: 'Box fan' },
    audio: { reverb: { seconds: 1.2, tone: 0.6, wet: 0.28 }, ambience: 'shop' },
    mult: 1.15, unlock: { points: 15000 },
  },
  {
    id: 'mech',
    name: 'Mech Room',
    tagline: 'Air handler running. The supply diffuser never quits.',
    bin: { material: 'drum', label: '30-gallon steel drum', rimRadius: 0.23, baseRadius: 0.23, height: 0.74, restitution: 0.45, friction: 0.4 },
    floor: { material: 'steelplate', restitution: 0.6, friction: 0.5 },
    backWallZ: -0.7,
    wall: { material: 'block', restitution: 0.5, friction: 0.55 },
    sideWallX: 3.0, ceilingY: 4.2, gravity: 9.81,
    windScale: 1.55, gustiness: 0.25,
    wind: { source: 'diffuser', label: 'Supply diffuser' },
    audio: { reverb: { seconds: 1.8, tone: 0.5, wet: 0.34 }, ambience: 'mech' },
    mult: 1.1, unlock: { points: 40000 },
  },
  {
    id: 'rooftop',
    name: 'Rooftop',
    tagline: 'Dusk over the city. Real wind, and it gusts.',
    bin: { material: 'can', label: 'Steel trash can', rimRadius: 0.19, baseRadius: 0.16, height: 0.56, restitution: 0.45, friction: 0.4 },
    floor: { material: 'gravel', restitution: 0.3, friction: 0.8 },
    backWallZ: -0.65,
    wall: { material: 'parapet', restitution: 0.4, friction: 0.6 },
    sideWallX: null, ceilingY: null, gravity: 9.81,
    windScale: 1.75, gustiness: 1.0,
    wind: { source: 'openair', label: 'Open air' },
    audio: { reverb: { seconds: 0.25, tone: 0.5, wet: 0.06 }, ambience: 'rooftop' },
    mult: 1.3, unlock: { points: 80000 },
  },
  {
    id: 'hab',
    name: 'Hab 7',
    tagline: 'Mars surface habitat. 0.38 g. Everything hangs.',
    bin: { material: 'alloy', label: 'Recycler intake', rimRadius: 0.16, baseRadius: 0.14, height: 0.34, restitution: 0.4, friction: 0.35 },
    floor: { material: 'composite', restitution: 0.55, friction: 0.5 },
    backWallZ: -0.55,
    wall: { material: 'panel', restitution: 0.5, friction: 0.45 },
    sideWallX: 2.4, ceilingY: 3.6, gravity: 3.72,
    windScale: 0.9, gustiness: 0.3,
    wind: { source: 'vent', label: 'Scrubber vent' },
    audio: { reverb: { seconds: 0.7, tone: 0.7, wet: 0.3 }, ambience: 'hab' },
    mult: 1.25, unlock: { points: 140000 },
  },
];

export const VENUE_BY_ID = Object.fromEntries(VENUES.map((v) => [v.id, v]));
export const DEFAULT_VENUE_ID = 'study';
