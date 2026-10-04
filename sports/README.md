# Sunny Sports

A phone-first 3D sports party game: bowling, tennis, home run derby and golf, played with one-finger
swipes. Make your own Pal, play solo or pass-and-play with friends, and chase records, medals and skill ranks.

## Play

Open `index.html` in any modern browser (works straight from the file system or any static host,
for example GitHub Pages at `/sports/`). Phone or desktop; mouse drags work like swipes.

| Sport | How to play | Modes |
|-------|-------------|-------|
| Bowling | Drag sideways to line up, swipe up to roll; curve the swipe to hook | 10 Frames · Spare Challenge · Power Pins (1–4 players) |
| Tennis | You run automatically; swipe to swing, timing aims; tap then swipe up to serve | Quick Match · Match · Rally Challenge (vs CPU) |
| Baseball | Swipe across as the pitch arrives; swipe angle sets launch | Home Run Derby · Sudden Death (vs CPU pitcher) |
| Golf | Pull down to set power, flick up to swing; straight flick = straight shot | Beginner 3 · Expert 3 · Full 9 (1–4 players) |

## Develop

- No build step to play: classic scripts, three.js r159 vendored in `lib/`, fonts in `fonts/`.
- Sound is real CC0 recordings (crowds, pins, bat, racket, golf, ambience) and real sampled instruments
  (VCSL), embedded as MP3 sample banks in `js/audio-bank*.js`; synthesis is the automatic fallback.
  `node tools/build-audio.mjs` regenerates the banks from `tools/audio-sources.json`; sources and
  credits are in `audio/CREDITS.md` (also shown in Settings → Sound credits).
- `DESIGN.md` is the engine contract (APIs for engine, input, audio, world, Pals, UI and sport modules).
- `tools/shoot.mjs` drives headless Chromium for screenshots and scripted swipes.
- `tools/gallery.html` and `tools/soundboard.html` preview characters, scenery, effects and every sound.
- `node tools/build.mjs --out dist/sunny-sports.html` bundles everything (including every sample bank, ~5.5 MB) into one self-contained HTML file
  (`--fragment` omits the document wrapper for hosts that add their own).
- Handy URL params: `?sport=golf&skip=1` jumps into a sport, `&mode=`, `&players=`, `&opp=`, `&quality=low|medium|high`,
  `&mute=1`, `&debug=1`, `&screen=menu|records|settings`, `&reset=1`.
