# The Keeper — games

| File | What it is |
|---|---|
| `irontide.html` | **Iron Tide** — build a warship block by block, then fight it through a 12-operation campaign or endless waves. Built from `src/`. |
| `index.html`, `game.html`, `pixel.html`, `the-keeper-v16.html` | Night Watch / The Keeper |
| `ios/` | Native iPhone/iPad wrapper for Iron Tide (see `ios/README.md`) |

## Iron Tide

Play: open `irontide.html` in a browser (it is fully offline — three.js is inlined).

### Controls (Warship Craft style, default; Settings → Controls → Simple for joystick + auto-fire)

- **Engine telegraph** (bottom-right): FULL / ¾ / ½ / ¼ / STOP / ½ AST / FULL AST. Tap or drag; it holds. Keys W/S.
- **Rudder** (bottom-left): drag; it holds its angle. Double-tap or X centres it. Keys A/D.
- **Aim**: swipe the sea (desktop: drag) to train the main battery; up/down or the wheel sets range.
  Reticle is green when a mount can fire, yellow when in range but not loaded or bearing, red when out of range.
- **Fire**: tap fires one mount; double-tap fires a full salvo. TORP, MSL/RKT/AIR, SMK and SCOPE (telescope zoom) buttons.
  Keys: Space, T, R, Z. Secondaries, AA and CIWS fire on their own.
- **Shipyard**: Mirror, Erase, Move (tap a part, tap where it goes), Hulls (bare historical hull outlines).
  Transmission efficiency: engines not mirrored across the centreline lose up to 15% thrust.

### Layout
```
src/            game source, one module per concern
  util.js       math, seeded RNG, safe storage
  data.js       parts, enemy designs, operations, upgrades, difficulty, weather
  ships.js      historical ships (Shipwright blueprints, Legends enemies) with specs
  design.js     ship-design rules, stats, undo history
  sim.js        battle simulation (no DOM/WebGL; emits events)
  ai.js         enemy captains (Easy/Medium/Hard), fleet spawning, endless waves
  progress.js   credits, unlocks, upgrades, stars, saves
  audio.js      procedural sound and music
  gfx.js        renderer, ocean/sky/weather, textures, instancing, particles
  shipviz.js    simulation -> instanced 3D, effects
  yard.js       3D dry dock (menus + shipyard)
  battle.js     battle controller: camera, input, HUD
  ui.js         screens and the shipyard editor
  main.js       boot and main loop
  index.html, style.css
vendor/         three.js r158
tools/build.py  bundles everything into irontide.html
tools/tune_ships.js  tunes historical ships' machinery to their real speeds
tests/          headless Node tests for rules, AI and progression
```

### Build and test
```
python3 tools/build.py              # regenerate irontide.html
node tests/sim.test.js              # quick suite (~1 min)
node tests/sim.test.js --balance    # full 12-operation balance table per difficulty
```
