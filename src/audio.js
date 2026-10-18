// Procedural sound: every effect is synthesised, so the game stays one offline file.
// Positional effects are attenuated and panned relative to the camera.
const Sound = (() => {
  let ctx = null, master, comp, sfx, amb, mus, noise;
  let volume = 0.8, musicOn = true;
  const listener = {x: 0, y: 0, yaw: 0, zoom: 1};
  const recent = {};
  let ambient = null, engine = null, music = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
      master = ctx.createGain(); master.gain.value = volume;
      master.connect(comp); comp.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.connect(master);
      amb = ctx.createGain(); amb.gain.value = 0.9; amb.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? 1 : 0; mus.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { ctx = null; return false; }
  }
  const ready = () => ctx && ctx.state === 'running';

  function setVolume(v) { volume = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }
  function setMusic(on) { musicOn = on; if (mus) mus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.3); }
  function setListener(x, y, yaw, zoom) { listener.x = x; listener.y = y; listener.yaw = yaw; listener.zoom = zoom; }

  // ---- building blocks
  function noiseSrc(t, dur, type, freq, q, gain, endFreq) {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (q) f.Q.value = q;
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return g;
  }
  function tone(t, dur, type, f0, f1, gain, attack = 0.005) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    return g;
  }

  const RECIPES = {
    gun:     t => [noiseSrc(t, 0.16, 'lowpass', 1800, 0, 0.35, 500), tone(t, 0.14, 'sine', 110, 45, 0.35)],
    heavy:   t => [noiseSrc(t, 0.9, 'lowpass', 600, 0, 0.7, 120), tone(t, 0.6, 'sine', 70, 26, 0.8), noiseSrc(t, 0.08, 'highpass', 2500, 0, 0.2)],
    explode: t => [noiseSrc(t, 1.5, 'lowpass', 420, 0, 0.8, 60), tone(t, 1.0, 'sine', 55, 20, 0.9, 0.01)],
    hit:     t => [noiseSrc(t, 0.18, 'bandpass', 1100, 1.2, 0.45), tone(t, 0.12, 'square', 320, 180, 0.06)],
    splash:  t => [noiseSrc(t, 0.6, 'highpass', 1400, 0, 0.16, 500)],
    bigsplash: t => [noiseSrc(t, 1.1, 'bandpass', 700, 0.6, 0.3, 200), tone(t, 0.3, 'sine', 80, 40, 0.25)],
    missile: t => [noiseSrc(t, 1.1, 'bandpass', 700, 2, 0.22, 3200)],
    rocket:  t => [noiseSrc(t, 0.35, 'bandpass', 1200, 1.5, 0.14, 2600)],
    torp:    t => [tone(t, 0.25, 'sine', 140, 60, 0.3), noiseSrc(t, 0.6, 'lowpass', 500, 0, 0.18, 150)],
    rail:    t => [tone(t, 0.35, 'sawtooth', 2400, 120, 0.12), noiseSrc(t, 0.12, 'highpass', 3000, 0, 0.45), tone(t, 0.25, 'sine', 90, 30, 0.5)],
    ciws:    t => [noiseSrc(t, 0.05, 'highpass', 3500, 0, 0.12)],
    sink:    t => [tone(t, 3, 'sawtooth', 55, 30, 0.12, 0.3), noiseSrc(t, 3, 'lowpass', 300, 0, 0.25, 80)],
    smoke:   t => [noiseSrc(t, 1.2, 'bandpass', 900, 0.8, 0.18, 300)],
    plane:   t => [tone(t, 1.6, 'sawtooth', 88, 120, 0.07, 0.3), noiseSrc(t, 1.6, 'bandpass', 500, 1.2, 0.06)],
    dive:    t => [tone(t, 1.3, 'sine', 1400, 520, 0.09, 0.2), tone(t, 1.3, 'sawtooth', 120, 180, 0.05, 0.2)],
    whistle: t => [tone(t, 0.7, 'sine', 1800, 700, 0.06, 0.05)],
    flak:    t => [noiseSrc(t, 0.25, 'lowpass', 900, 0, 0.3, 200), tone(t, 0.12, 'sine', 140, 60, 0.18)],
    // UI and stingers are not positional
    click:   t => [tone(t, 0.05, 'sine', 900, 700, 0.12)],
    place:   t => [tone(t, 0.06, 'triangle', 420, 300, 0.14), noiseSrc(t, 0.05, 'bandpass', 1800, 2, 0.08)],
    erase:   t => [tone(t, 0.07, 'triangle', 300, 160, 0.12)],
    buy:     t => [tone(t, 0.12, 'sine', 660, 0, 0.15), tone(t + 0.1, 0.25, 'sine', 990, 0, 0.15)],
    deny:    t => [tone(t, 0.18, 'square', 160, 120, 0.06)],
    star:    t => [tone(t, 0.9, 'sine', 1046, 0, 0.18), tone(t, 0.9, 'sine', 1568, 0, 0.08)],
    coin:    t => [tone(t, 0.08, 'square', 1320, 0, 0.04)],
    victory: t => [523, 659, 784, 1046].flatMap((f, i) => [tone(t + i * 0.14, 1.4 - i * 0.2, 'triangle', f, 0, 0.16, 0.02)]),
    defeat:  t => [392, 349, 311, 233].flatMap((f, i) => [tone(t + i * 0.22, 1.2, 'triangle', f, 0, 0.14, 0.03)]),
    alarm:   t => [tone(t, 0.18, 'square', 700, 0, 0.05), tone(t + 0.22, 0.18, 'square', 700, 0, 0.05)],
  };
  const POSITIONAL = new Set(['gun', 'heavy', 'explode', 'hit', 'splash', 'bigsplash', 'missile', 'rocket', 'torp', 'rail', 'ciws', 'sink', 'smoke', 'plane', 'dive', 'whistle', 'flak']);
  const MIN_GAP = {ciws: 0.06, gun: 0.03, splash: 0.04, hit: 0.03, coin: 0.04, flak: 0.07, plane: 0.4, dive: 0.3};

  // play('gun', {x, y, vol})
  function play(name, o = {}) {
    if (!ready() || !RECIPES[name]) return;
    const t = ctx.currentTime;
    if (recent[name] && t - recent[name] < (MIN_GAP[name] || 0.015)) return;
    recent[name] = t;
    let gain = o.vol == null ? 1 : o.vol, pan = 0;
    if (POSITIONAL.has(name) && o.x != null) {
      const dx = o.x - listener.x, dy = o.y - listener.y, d = Math.hypot(dx, dy);
      gain *= Util.clamp(1 - d / (1100 * listener.zoom), 0, 1) ** 1.5;
      if (gain < 0.02) return;
      // project onto the camera's right vector
      pan = Util.clamp((dx * Math.cos(listener.yaw) + dy * Math.sin(listener.yaw)) / Math.max(200, d), -0.85, 0.85);
    }
    const out = ctx.createGain(); out.gain.value = gain;
    let node = out;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
    node.connect(sfx);
    for (const g of RECIPES[name](t)) g.connect(out);
  }

  // ---- beds: sea, wind, engine
  function startAmbient(weather) {
    if (!ready()) return;
    stopAmbient();
    const t = ctx.currentTime, nodes = [];
    const bed = (type, freq, q, gain, lfoRate, lfoDepth) => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate;
      const lg = ctx.createGain(); lg.gain.value = lfoDepth; lfo.connect(lg); lg.connect(g.gain);
      s.connect(f); f.connect(g); g.connect(amb);
      s.start(t, Math.random()); lfo.start(t);
      nodes.push(s, lfo);
      return g;
    };
    bed('lowpass', 420, 0.5, 0.16, 0.11, 0.07);
    bed('bandpass', 1100, 0.4, 0.035, 0.07, 0.02);
    if (weather && weather.rain) { bed('highpass', 2500, 0.3, 0.06, 0.2, 0.015); bed('bandpass', 600, 1.5, 0.05, 0.13, 0.04); }
    amb.gain.setValueAtTime(0, t); amb.gain.linearRampToValueAtTime(0.9, t + 2);
    ambient = nodes;
    // engine: two detuned saws through a low filter; gain follows throttle
    const eg = ctx.createGain(); eg.gain.value = 0;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 140;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 36;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 36.7;
    o1.connect(ef); o2.connect(ef); ef.connect(eg); eg.connect(amb); o1.start(t); o2.start(t);
    engine = {eg, ef, o1, o2};
  }
  function setEngine(throttle, speed) {
    if (!engine) return;
    const t = ctx.currentTime, k = Math.abs(throttle);
    engine.eg.gain.setTargetAtTime(0.035 + k * 0.07, t, 0.3);
    engine.o1.frequency.setTargetAtTime(32 + speed * 0.18, t, 0.5);
    engine.o2.frequency.setTargetAtTime(32.6 + speed * 0.18, t, 0.5);
    engine.ef.frequency.setTargetAtTime(110 + k * 120, t, 0.4);
  }
  function stopAmbient() {
    if (ambient) { for (const n of ambient) try { n.stop(); } catch (e) {} ambient = null; }
    if (engine) { try { engine.o1.stop(); engine.o2.stop(); } catch (e) {} engine = null; }
  }

  // ---- music: a slow, low pad that walks a minor progression
  const CHORDS = [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [130.8, 164.8, 196], [110, 130.8, 164.8]];
  function startMusic(intensity = 1) {
    if (!ready() || music) return;
    const voices = [], f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0; f.connect(g); g.connect(mus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 260;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    for (let i = 0; i < 3; i++) for (const det of [-6, 5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
      o.frequency.value = CHORDS[0][i]; o.connect(f); o.start(); voices.push({o, i});
    }
    g.gain.linearRampToValueAtTime(0.045 * intensity, ctx.currentTime + 4);
    let step = 0;
    const timer = setInterval(() => {
      if (!ctx) return;
      step = (step + 1) % CHORDS.length;
      for (const v of voices) v.o.frequency.setTargetAtTime(CHORDS[step][v.i], ctx.currentTime, 1.2);
    }, 8000);
    music = {voices, g, lfo, timer};
  }
  function stopMusic() {
    if (!music) return;
    const m = music; music = null;
    clearInterval(m.timer);
    m.g.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    setTimeout(() => { for (const v of m.voices) try { v.o.stop(); } catch (e) {} try { m.lfo.stop(); } catch (e) {} }, 3000);
  }

  return {init, ready, play, setVolume, setMusic, setListener, startAmbient, stopAmbient, setEngine, startMusic, stopMusic};
})();
