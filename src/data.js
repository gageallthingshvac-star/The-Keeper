// All tunable game content: parts, enemy designs, operations, upgrades,
// difficulty profiles and weather. Pure data plus tiny lookups.
const Data = (() => {
  // ---- parts -------------------------------------------------------------
  // mass/buoy decide whether a design floats; hp is per block.
  // weapon.type: shell | torp | missile | ciws | rail | rockets
  // util: radar | repair | smoke (passive or self-triggered abilities)
  const PARTS = {
    hull:    {name: 'Hull',      key: 'H', cost: 4,   mass: 1,   buoy: 3,   hp: 30,
              desc: 'Cheap structure. Floats well, breaks easily.'},
    armor:   {name: 'Armor',     key: 'A', cost: 14,  mass: 3,   buoy: 3.4, hp: 95,
              desc: 'Heavy plate. Soaks shells, barely floats its own weight.'},
    bridge:  {name: 'Bridge',    key: 'B', cost: 40,  mass: 2,   buoy: 2,   hp: 180, unique: true,
              desc: 'Command. Exactly one. Lose it and the ship is lost.'},
    engine:  {name: 'Engine',    key: 'E', cost: 35,  mass: 3,   buoy: 1,   hp: 35,  thrust: 10, boom: 18,
              desc: 'Thrust. Speed = thrust ÷ mass. Explodes when destroyed.'},
    rudder:  {name: 'Rudder',    key: 'R', cost: 15,  mass: 1,   buoy: 1.5, hp: 25,  turn: 1,
              desc: 'Turning. More rudders turn tighter; heavy ships turn slowly.'},
    gun:     {name: 'Cannon',    key: 'G', cost: 35,  mass: 2,   buoy: 0.5, hp: 35,
              weapon: {type: 'shell', range: 300, reload: 1.0, dmg: 14, splash: 0, speed: 520, spread: 0.035},
              desc: 'Fast-firing turret. Short range.'},
    heavy:   {name: 'Heavy Gun', key: 'X', cost: 110, mass: 6,   buoy: 0.5, hp: 70,  boom: 30,
              weapon: {type: 'shell', range: 440, reload: 2.8, dmg: 58, splash: 13, speed: 460, spread: 0.03},
              desc: 'Twin heavy turret. Long range, splash damage. Very heavy.'},
    torp:    {name: 'Torpedo',   key: 'T', cost: 85,  mass: 2,   buoy: 0.5, hp: 25,  boom: 22,
              weapon: {type: 'torp', range: 520, reload: 8, dmg: 110, splash: 10, speed: 125},
              desc: 'Slow underwater warhead. Huge damage. Cannot be shot down.'},
    ciws:    {name: 'CIWS',      key: 'C', cost: 70,  mass: 1.5, buoy: 0.5, hp: 25,
              weapon: {type: 'ciws', range: 160, reload: 0.08},
              desc: 'Point defense. Shreds incoming missiles and rockets.'},
    missile: {name: 'Missile',   key: 'M', cost: 140, mass: 3,   buoy: 0.5, hp: 30,  boom: 35,
              weapon: {type: 'missile', range: 650, reload: 4.5, dmg: 72, splash: 12, speed: 250},
              desc: 'Vertical launcher. Homing, long range. CIWS can kill it.'},
    rockets: {name: 'Rockets',   key: 'K', cost: 120, mass: 3,   buoy: 0.5, hp: 30,  boom: 30,
              weapon: {type: 'rockets', range: 380, reload: 7, dmg: 15, splash: 8, speed: 300, spread: 0.09, salvo: 8},
              desc: 'Eight-rocket salvo. Saturates an area and overwhelms point defense.'},
    rail:    {name: 'Railgun',   key: 'L', cost: 240, mass: 5,   buoy: 0.5, hp: 60,  boom: 25,
              weapon: {type: 'rail', range: 720, reload: 5.5, dmg: 95, pierce: 4, falloff: 0.75, spread: 0.012},
              desc: 'Hypersonic slug. Longest range, punches through a line of blocks.'},
    radar:   {name: 'Radar',     key: 'D', cost: 60,  mass: 1,   buoy: 0.8, hp: 25,
              util: {type: 'radar', range: 0.15, spread: 0.2, max: 2},
              desc: '+15% weapon range and tighter spread. Up to two stack.'},
    repair:  {name: 'Repair Bay',key: 'W', cost: 90,  mass: 2,   buoy: 1,   hp: 40,
              util: {type: 'repair', rate: 5, radius: 3.5},
              desc: 'Patches nearby damaged blocks and puts out fires.'},
    smoke:   {name: 'Smoke',     key: 'S', cost: 50,  mass: 1,   buoy: 1,   hp: 25,
              util: {type: 'smoke', radius: 75, duration: 10, cooldown: 30},
              desc: 'Lays a smoke screen under heavy fire. Enemy aim suffers inside it.'},
  };
  const PART_ORDER = ['hull', 'armor', 'bridge', 'engine', 'rudder', 'gun', 'heavy', 'torp',
                      'rockets', 'ciws', 'missile', 'rail', 'radar', 'repair', 'smoke'];
  const KEY2PART = {};
  for (const k in PARTS) { PARTS[k].id = k; KEY2PART[PARTS[k].key] = k; }
  const TURRETS = new Set(['gun', 'heavy', 'torp', 'ciws', 'rail', 'rockets']);
  // Unlocked from the start; everything else is bought in the Armory.
  const FREE_PARTS = ['hull', 'armor', 'bridge', 'engine', 'rudder', 'gun'];
  // price in credits, op = operation index (0-based) that must be reached first
  const PART_SHOP = {
    heavy: {price: 250, op: 1}, radar: {price: 250, op: 2}, torp: {price: 400, op: 2},
    smoke: {price: 300, op: 3}, ciws: {price: 450, op: 3}, rockets: {price: 600, op: 3},
    repair: {price: 550, op: 4}, missile: {price: 800, op: 5}, rail: {price: 1400, op: 8},
  };

  // ---- enemy designs (row 0 = bow) ---------------------------------------
  const ENEMIES = {
    patrol: {name: 'Patrol Boat', rows: [
      '.H.',
      'HGH',
      'HBH',
      'HHH',
      'HEH',
      '.R.']},
    torpboat: {name: 'Torpedo Boat', rows: [
      '.H.',
      'HTH',
      'HBH',
      'HEH',
      '.R.']},
    gunboat: {name: 'Gunboat', rows: [
      '..H..',
      '.HGH.',
      '.HHH.',
      'HHBHH',
      'HGHGH',
      'HHHHH',
      '.EHE.',
      '..R..']},
    corvette: {name: 'Rocket Corvette', rows: [
      '..H..',
      '.HKH.',
      '.HHH.',
      '.HBH.',
      'HGHGH',
      'HHHHH',
      '.EHE.',
      '..R..']},
    destroyer: {name: 'Destroyer', rows: [
      '...H...',
      '..HGH..',
      '..HHH..',
      '.HHBHH.',
      '.HHHHH.',
      '.THHHT.',
      '.HHGHH.',
      '.HHSHH.',
      '.HEHEH.',
      '..HRH..']},
    frigate: {name: 'Missile Frigate', rows: [
      '...H...',
      '..HCH..',
      '..HMH..',
      '.HHHHH.',
      '.HHBHH.',
      '.GHHHG.',
      '.HHMHH.',
      '.HHDHH.',
      '.HEHEH.',
      '..HRH..']},
    cruiser: {name: 'Cruiser', rows: [
      '...H...',
      '..HHH..',
      '..HXH..',
      '.HHHHH.',
      '.HABAH.',
      '.GHHHG.',
      '.HHDHH.',
      '.GHHHG.',
      '.HHXHH.',
      '.HHHHH.',
      '.HEHEH.',
      '..ERE..']},
    monitor: {name: 'Monitor', rows: [
      '....H....',
      '...HAH...',
      '..HAXAH..',
      '.HHHHHHH.',
      '.AHHBHHA.',
      '.HHHWHHH.',
      '.AHXHXHA.',
      '.HHHHHHH.',
      '.HHHHHHH.',
      '.HEHHHEH.',
      '..HERRH..']},
    railcruiser: {name: 'Rail Cruiser', rows: [
      '....H....',
      '...HLH...',
      '..HHHHH..',
      '..HHBHH..',
      '.HGHDHGH.',
      '.HHHHHHH.',
      '.HCHLHCH.',
      '.HHHHHHH.',
      '.HHHWHHH.',
      '.HHEHEHH.',
      '...HRH...']},
    battleship: {name: 'Battleship', rows: [
      '....H....',
      '...HHH...',
      '...HXH...',
      '..HHHHH..',
      '..HAXAH..',
      '.HHHHHHH.',
      '.AGHBHGA.',
      '.HHAAAHH.',
      '.CHHDHHC.',
      '.GHHMHHG.',
      '.HHHWHHH.',
      '.AHHXHHA.',
      '.HHHHHHH.',
      '.HEHEHEH.',
      '.HHEHEHH.',
      '..HRHRH..']},
    dreadnought: {name: 'Dreadnought', boss: true, rows: [
      '.....H.....',
      '....HHH....',
      '....HXH....',
      '...HHHHH...',
      '...HAXAH...',
      '..HHHHHHH..',
      '..CHHLHHC..',
      '.HHHHHHHHH.',
      '.AGHABAHGA.',
      '.HHHADAHHH.',
      '.KHHHHHHHK.',
      '.HHMHWHMHH.',
      '.GHHHHHHHG.',
      '.HHMHHHMHH.',
      '.AHHHXHHHA.',
      '.HHHHXHHHH.',
      '.CHHHHHHHC.',
      '.HSHHHHHSH.',
      '.HEHEHEHEH.',
      '.HHEHEHEHH.',
      '..HHRHRHH..']},
  };

  // ---- player starter ----------------------------------------------------
  const STARTER = [
    '...H...',
    '..HGH..',
    '..HHH..',
    '.HHBHH.',
    '.HHHHH.',
    '.GHHHG.',
    '.HHHHH.',
    '.HEHEH.',
    '..HRH..'];

  // ---- weather -----------------------------------------------------------
  // Colours are sRGB hex. spread multiplies everyone's gunnery spread.
  const WEATHER = {
    clear:    {name: 'Clear',    sun: [0.45, 0.55, 0.35], sunColor: '#fff1dc', sunI: 2.6, hemiI: 1.25,
               zenith: '#4a7aa3', fog: '#a9bfcc', fogNear: 700, fogFar: 2600, deep: '#06212f', shallow: '#0f4559',
               waves: 1.0, spread: 1.0, exposure: 1.0},
    dawn:     {name: 'Dawn',     sun: [-0.7, 0.18, -0.55], sunColor: '#ffc79a', sunI: 2.2, hemiI: 1.0,
               zenith: '#5a6f9a', fog: '#d6b6a6', fogNear: 650, fogFar: 2400, deep: '#0a1d2c', shallow: '#244a5a',
               waves: 0.8, spread: 1.05, exposure: 1.05},
    dusk:     {name: 'Dusk',     sun: [0.75, 0.12, -0.5], sunColor: '#ff9a55', sunI: 2.3, hemiI: 0.85,
               zenith: '#34416e', fog: '#c08f74', fogNear: 600, fogFar: 2300, deep: '#0a1622', shallow: '#2b3c48',
               waves: 1.0, spread: 1.1, exposure: 1.05},
    overcast: {name: 'Overcast', sun: [0.3, 0.8, 0.2], sunColor: '#d8dde2', sunI: 1.1, hemiI: 1.6,
               zenith: '#7d8b96', fog: '#9aa6ae', fogNear: 500, fogFar: 2000, deep: '#0b1e28', shallow: '#2a4550',
               waves: 1.3, spread: 1.1, exposure: 1.0},
    storm:    {name: 'Storm',    sun: [0.2, 0.7, 0.4], sunColor: '#aeb8c2', sunI: 0.9, hemiI: 1.1,
               zenith: '#3c464f', fog: '#5d6971', fogNear: 280, fogFar: 1500, deep: '#071219', shallow: '#1d3038',
               waves: 1.9, spread: 1.3, exposure: 0.95, rain: true, lightning: true},
    night:    {name: 'Night',    sun: [-0.4, 0.5, 0.6], sunColor: '#9fb6e6', sunI: 0.8, hemiI: 0.35,
               zenith: '#050a14', fog: '#121b28', fogNear: 400, fogFar: 1900, deep: '#020810', shallow: '#0b1c2a',
               waves: 0.9, spread: 1.2, exposure: 1.2, stars: true},
  };

  // ---- campaign ----------------------------------------------------------
  // par: seconds for the third star. budget: build points for the player's ship.
  const OPS = [
    {name: 'Coastal Patrol',  budget: 600,  weather: 'clear',    par: 90,  enemies: ['patrol', 'patrol'],
     brief: 'Two patrol boats are harassing fishing lanes. Sink them.'},
    {name: 'Gunboat Run',     budget: 850,  weather: 'dawn',     par: 110, enemies: ['gunboat', 'patrol', 'gunboat'],
     brief: 'A gunboat squadron is running the strait at first light.'},
    {name: 'Torpedo Alley',   budget: 1100, weather: 'overcast', par: 120, enemies: ['torpboat', 'destroyer', 'torpboat', 'torpboat'],
     brief: 'Fast torpedo boats screen a destroyer. Watch the water.'},
    {name: 'Rocket Reef',     budget: 1350, weather: 'dusk',     par: 120, enemies: ['corvette', 'destroyer', 'corvette'],
     brief: 'Rocket corvettes saturate anything that comes close.'},
    {name: 'Cruiser Hunt',    budget: 1650, weather: 'clear',    par: 140, enemies: ['destroyer', 'cruiser', 'destroyer'],
     brief: 'A cruiser and its escorts. Its heavy guns outrange yours.'},
    {name: 'Missile Storm',   budget: 2000, weather: 'storm',    par: 150, enemies: ['frigate', 'corvette', 'destroyer', 'frigate'],
     brief: 'Missile frigates in a gale. Their missiles home; your shells do not.'},
    {name: 'Iron Wall',       budget: 2300, weather: 'overcast', par: 160, enemies: ['patrol', 'monitor', 'gunboat'],
     brief: 'An armored monitor anchors the line. Find the soft spots.'},
    {name: 'The Dreadnought', budget: 2700, weather: 'dawn',     par: 170, enemies: ['torpboat', 'battleship', 'torpboat'],
     brief: 'A battleship with a torpedo-boat screen. Big guns, slow turns.'},
    {name: 'Rail Line',       budget: 3100, weather: 'clear',    par: 170, enemies: ['destroyer', 'railcruiser', 'frigate'],
     brief: 'Rail cruisers hit from beyond the horizon. Close the distance.'},
    {name: 'Night Fleet',     budget: 3500, weather: 'night',    par: 190, enemies: ['frigate', 'cruiser', 'battleship', 'destroyer'],
     brief: 'A mixed fleet under a new moon. Muzzle flashes give them away.'},
    {name: 'Grand Fleet',     budget: 4000, weather: 'storm',    par: 210, enemies: ['railcruiser', 'battleship', 'frigate', 'battleship'],
     brief: 'The enemy main body, in foul weather.'},
    {name: 'Iron Tide',       budget: 4800, weather: 'dusk',     par: 240, enemies: ['frigate', 'battleship', 'dreadnought', 'frigate'],
     brief: 'Their flagship. Break it and the war is over.'},
  ];

  // ---- endless mode --------------------------------------------------------
  // minWave: earliest wave a class can appear.
  const ENDLESS_POOL = [
    {id: 'patrol', minWave: 1}, {id: 'torpboat', minWave: 2}, {id: 'gunboat', minWave: 2},
    {id: 'corvette', minWave: 4}, {id: 'destroyer', minWave: 4}, {id: 'frigate', minWave: 6},
    {id: 'cruiser', minWave: 6}, {id: 'monitor', minWave: 8}, {id: 'railcruiser', minWave: 10},
    {id: 'battleship', minWave: 10}, {id: 'dreadnought', minWave: 15},
  ];
  const endlessBudget = wave => 260 + wave * 230;

  // ---- progression -------------------------------------------------------
  const DOCKS = [
    {name: 'Dock I',   w: 7,  h: 15, price: 0},
    {name: 'Dock II',  w: 9,  h: 19, price: 600},
    {name: 'Dock III', w: 11, h: 23, price: 1800},
  ];
  const TRACK_PRICES = [200, 400, 700, 1100, 1600];
  const TRACKS = {
    plating:    {name: 'Hull Plating',      per: 0.08, desc: '+8% block HP per level'},
    gunnery:    {name: 'Gunnery',           per: 0.06, desc: '+6% fire rate per level'},
    propulsion: {name: 'Propulsion',        per: 0.06, desc: '+6% engine thrust per level'},
    firecontrol:{name: 'Fire Control',      per: 0.06, desc: '−6% shell spread per level'},
    damagectl:  {name: 'Damage Control',    per: 0.15, desc: 'Fires burn out 15% faster, +15% repair per level'},
    funding:    {name: 'Admiralty Funding', per: 0.06, desc: '+6% build budget per level'},
  };

  // ---- difficulty --------------------------------------------------------
  // acc/reload multiply enemy spread and reload time. lead = share of target motion the AI leads.
  // react = seconds between AI decisions. reward = credit multiplier.
  const DIFFICULTY = {
    easy:   {name: 'Easy',   acc: 1.8, reload: 1.35, lead: 0.55, react: 1.4, focus: false, flank: false,
             dodge: 0,   retreat: false, smartAim: false, smoke: false, reward: 0.7,
             desc: 'Enemies aim poorly, fire slowly and fight alone.'},
    medium: {name: 'Medium', acc: 1.3, reload: 1.12, lead: 0.9,  react: 0.7, focus: true,  flank: true,
             dodge: 0.45, retreat: false, smartAim: false, smoke: true, reward: 1.0,
             desc: 'Enemies focus fire, spread out to flank you and sometimes dodge torpedoes.'},
    hard:   {name: 'Hard',   acc: 1.0, reload: 1.0,  lead: 1.0,  react: 0.3, focus: true,  flank: true,
             dodge: 0.9, retreat: true,  smartAim: true,  smoke: true, reward: 1.5,
             desc: 'Enemies aim for your bridge and engines, comb torpedoes, and fall back to repair.'},
  };

  return {PARTS, PART_ORDER, KEY2PART, TURRETS, FREE_PARTS, PART_SHOP, ENEMIES, STARTER, WEATHER, OPS,
          ENDLESS_POOL, endlessBudget, DOCKS, TRACKS, TRACK_PRICES, DIFFICULTY};
})();
