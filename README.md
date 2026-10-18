# The Keeper — games

| File | What it is |
|---|---|
| `irontide.html` | **Iron Tide** — build a warship block by block, then fight it through a 12-operation campaign or endless waves. Built from `src/`. |
| `index.html`, `game.html`, `pixel.html`, `the-keeper-v16.html` | Night Watch / The Keeper |
| `ios/` | Native iPhone/iPad wrapper for Iron Tide (see `ios/README.md`) |

## Iron Tide

Play: open `irontide.html` in a browser (it is fully offline — three.js is inlined).

### Layout
```
src/            game source, one module per concern
  util.js       math, seeded RNG, safe storage
  data.js       parts, enemy designs, operations, upgrades, difficulty, weather
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
tests/          headless Node tests for rules, AI and progression
```

### Build and test
```
python3 tools/build.py              # regenerate irontide.html
node tests/sim.test.js              # quick suite (~1 min)
node tests/sim.test.js --balance    # full 12-operation balance table per difficulty
```
