/* Sunny Sports — audio.js
 * Every sound in the game, 100 % synthesized with WebAudio: no files, no network.
 *
 *   Mixer      one per AudioContext (live or offline): bus graph, master compressor + soft-clip
 *              ceiling, generated-impulse reverb send, cached noise / procedural sample buffers.
 *   Primitives tone, FM, filtered noise, formant voices, procedural knock/clap samples.
 *   SFX        the named one-shots of DESIGN §6.4. Each recipe is fn(M, t, o, out) -> end time.
 *   Loops      ambience beds with randomly scheduled events; live handles change volume/rate.
 *   Music      a lookahead step sequencer playing original multi-section tracks.
 *   Runtime    lazy context creation on unlock, iOS-safe resume, volumes, duck, pause/hide.
 *   Analysis   SS.audio._analyze renders any sound through an OfflineAudioContext.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // ---------------------------------------------------------------------------------------------
  // Constants & small helpers
  // ---------------------------------------------------------------------------------------------

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const LOOKAHEAD = 0.12;        // seconds of audio scheduled ahead of the clock
  const TICK_MS = 25;            // scheduler interval
  const MAX_VOICES = 48;         // concurrent one-shot sfx (each may own many nodes)
  const MUSIC_LEVEL = 0.45;      // music bus trim: music always sits under the sfx
  const REPEAT_WINDOW = 0.035;   // identical sfx inside this window count toward its repeat cap
  const ANALYZE_RATE = 44100;

  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const volCurve = v => Math.pow(clamp(Number(v) || 0, 0, 1), 1.6);   // slider → gain (perceptual)

  const warned = new Set();
  function warnOnce(kind, name) {
    const key = kind + ':' + name;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[audio] unknown ${kind} "${name}"`);
  }

  // ---------------------------------------------------------------------------------------------
  // Generated buffers (noise, reverb impulse, procedural samples)
  // ---------------------------------------------------------------------------------------------

  /** Peak-normalizes a Float32Array in place. */
  function normalize(d, peak) {
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
    return d;
  }

  /** Two seconds of loopable noise. 'smooth' is slow cosine-interpolated random (a cheap LFO). */
  function makeNoise(ctx, kind) {
    const sr = ctx.sampleRate, n = sr * 2;
    const buf = ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    if (kind === 'smooth') {
      const pts = Math.floor(n / 64), vals = [];
      for (let i = 0; i < pts; i++) vals.push(Math.random() * 2 - 1);
      for (let i = 0; i < n; i++) {
        const p = i / 64, k = Math.floor(p) % pts, f = p - Math.floor(p);
        const w = (1 - Math.cos(Math.PI * f)) / 2;
        out[i] = vals[k] * (1 - w) + vals[(k + 1) % pts] * w;
      }
      return buf;
    }
    const fade = 2048, gen = new Float32Array(n + fade);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < gen.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        gen[i] = b0 + b1 + b2 + w * 0.1848;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        gen[i] = last;
      } else gen[i] = w;
    }
    // Cross-fade the tail into the head so the buffer loops without a click.
    for (let i = 0; i < n; i++) out[i] = gen[i];
    for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = gen[i] * k + gen[n + i] * (1 - k); }
    normalize(out, 0.95);
    return buf;
  }

  /** Stereo room impulse: diffuse noise tail that darkens as it decays, plus a few early reflections. */
  function makeImpulse(ctx, seconds) {
    const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const k = 0.8 - 0.65 * (i / n);
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t * 6.9 / seconds) * Math.min(1, t / 0.006);
      }
      for (let r = 0; r < 7; r++) {
        const i = Math.floor(sr * (0.009 + r * 0.011 + Math.random() * 0.005));
        if (i < n) d[i] += (Math.random() < 0.5 ? -0.6 : 0.6) * Math.exp(-r * 0.35);
      }
    }
    return buf;
  }

  /** RBJ band-pass (0 dB peak) applied in place — used when rendering procedural samples. */
  function bandpassInPlace(d, sr, f, q) {
    const w0 = 2 * Math.PI * f / sr, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
    }
    return d;
  }

  // Resonant "knock" bodies: partial ratios, gains and decay times (seconds).
  const KNOCKS = {
    pin:  { f: [640, 760, 880, 1010], ratios: [1, 1.58, 2.39, 3.67], gains: [1, 0.55, 0.3, 0.16], decays: [0.12, 0.075, 0.05, 0.03], click: 0.5 },
    wood: { f: [470, 560], ratios: [1, 2.71, 5.2], gains: [1, 0.45, 0.2], decays: [0.07, 0.035, 0.018], click: 0.7 },
    cup:  { f: [980], ratios: [1, 2.32, 4.1, 6.2], gains: [1, 0.6, 0.35, 0.2], decays: [0.16, 0.1, 0.06, 0.04], click: 0.3 },
  };

  function genKnock(sr, spec, f0) {
    const n = Math.floor(sr * 0.32), d = new Float32Array(n);
    spec.ratios.forEach((r, p) => {
      const w = 2 * Math.PI * f0 * r * (1 + rand(-0.01, 0.01)) / sr, ph = Math.random() * 6.28;
      const k = Math.exp(-1 / (spec.decays[p] * sr));
      let a = spec.gains[p];
      for (let i = 0; i < n; i++) { d[i] += a * Math.sin(w * i + ph); a *= k; }
    });
    const clickLen = Math.floor(sr * 0.003), fadeFrom = Math.floor(n * 0.7);
    for (let i = 0; i < clickLen; i++) d[i] += spec.click * (Math.random() * 2 - 1) * (1 - i / clickLen);
    for (let i = fadeFrom; i < n; i++) d[i] *= (n - i) / (n - fadeFrom);
    return normalize(d, 0.9);
  }

  /** One hand clap: three micro-bursts then a short band-passed tail. */
  function genClap(sr) {
    const n = Math.floor(sr * 0.07), d = new Float32Array(n);
    const bursts = [0, rand(0.004, 0.007), rand(0.009, 0.014)], weights = [0.55, 0.8, 1];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let e = 0;
      bursts.forEach((b, k) => { if (t >= b) e += weights[k] * Math.exp(-(t - b) / (k === 2 ? 0.012 : 0.0018)); });
      d[i] = (Math.random() * 2 - 1) * e;
    }
    bandpassInPlace(d, sr, rand(1000, 1900), rand(0.9, 1.5));
    return normalize(d, 0.9);
  }

  /** Stereo applause bed: `clappers` people each clapping at their own steady tempo. */
  function genApplause(ctx, claps, clappers, seconds) {
    const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let c = 0; c < clappers; c++) {
      const period = rand(0.17, 0.28), amp = rand(0.35, 1), pan = rand(-0.85, 0.85);
      const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
      for (let t = rand(0, period); t < seconds - 0.08; t += period * rand(0.92, 1.08)) {
        const v = pick(claps), i0 = Math.floor(t * sr), a = amp * rand(0.7, 1);
        for (let j = 0; j < v.length && i0 + j < n; j++) { L[i0 + j] += v[j] * a * gl; R[i0 + j] += v[j] * a * gr; }
      }
    }
    const k = 0.9 / Math.max(normalizePeak(L), normalizePeak(R), 1e-6);
    for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
    return buf;
  }
  function normalizePeak(d) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; }

  /** Soft-knee ceiling: linear to 0.65, then tanh into a hard maximum of 0.97 (input is pre-halved). */
  function softClipCurve() {
    const n = 4097, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1) * 2 - 1) * 2, a = Math.abs(u);
      c[i] = a < 0.65 ? u : Math.sign(u) * (0.65 + 0.32 * Math.tanh((a - 0.65) / 0.32));
    }
    return c;
  }

  // Additive spectra for PeriodicWave instruments (index = harmonic number).
  const SPECTRA = {
    organ: [0, 1, 0.75, 0.3, 0.38, 0.06, 0.14, 0, 0.1],
    softsq: [0, 1, 0, 0.21, 0, 0.1, 0, 0.06, 0, 0.035],
    bass: [0, 1, 0.5, 0.22, 0.12, 0.05],
  };

  // ---------------------------------------------------------------------------------------------
  // Mixer: one per AudioContext. Owns the bus graph and the generated buffers.
  // ---------------------------------------------------------------------------------------------
  //
  //   voices ─► sfxIn ─► sfxVol ──────────────────────────────┐
  //   voices ─► sfxSend ─► sfxSendVol ─► reverb ─► verbOut ────┤
  //   loops ─► loopGate ─► sfxIn (+ wet send)                  ├─► master ─► compressor ─► ceiling ─► out
  //   music ─► musicIn ─► duck ─► pause ─► muffle ─► musicVol ─┘   (musicVol also feeds the reverb)

  class Mixer {
    /** `isLive`: build the impulse and sample caches in later small tasks (keeps the unlocking tap snappy). */
    constructor(ctx, vols, isLive = false) {
      this.ctx = ctx;
      this.sr = ctx.sampleRate;
      this.cache = new Map();

      this.master = this.gain(1);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5;
      comp.attack.value = 0.004; comp.release.value = 0.22;
      const preClip = this.gain(0.5);
      const ceiling = ctx.createWaveShaper();
      ceiling.curve = softClipCurve();
      this.master.connect(comp); comp.connect(preClip); preClip.connect(ceiling); ceiling.connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      if (isLive) this.prewarm(); else this.loadImpulse();
      const verbOut = this.gain(0.42);
      this.reverb.connect(verbOut); verbOut.connect(this.master);

      this.sfxIn = this.gain(1); this.sfxVol = this.gain(1);
      this.sfxIn.connect(this.sfxVol); this.sfxVol.connect(this.master);
      this.sfxSend = this.gain(1); this.sfxSendVol = this.gain(1);
      this.sfxSend.connect(this.sfxSendVol); this.sfxSendVol.connect(this.reverb);

      this.loopGate = this.gain(1);
      this.loopGate.connect(this.sfxIn);
      const loopWet = this.gain(0.2);
      this.loopGate.connect(loopWet); loopWet.connect(this.sfxSend);

      this.musicIn = this.gain(1);
      this.musicDuck = this.gain(1);
      this.musicPause = this.gain(1);
      this.musicMuffle = this.filter('lowpass', 20000, 0.5);
      this.musicVol = this.gain(1);
      const musicWet = this.gain(0.22);
      this.musicIn.connect(this.musicDuck); this.musicDuck.connect(this.musicPause);
      this.musicPause.connect(this.musicMuffle); this.musicMuffle.connect(this.musicVol);
      this.musicVol.connect(this.master); this.musicVol.connect(musicWet); musicWet.connect(this.reverb);

      this.setVolumes(vols.music, vols.sfx, 0);
    }

    get now() { return this.ctx.currentTime; }

    loadImpulse() { this.reverb.buffer = makeImpulse(this.ctx, 1.9); }

    /** Generates every lazily built buffer in short separate tasks, so no gameplay sound pays for it. */
    prewarm() {
      const jobs = [
        () => this.loadImpulse(),
        ...['white', 'pink', 'brown', 'smooth'].map(k => () => this.noiseBuf(k)),
        ...Object.keys(KNOCKS).map(kind => () => KNOCKS[kind].f.forEach((f, i) => this.knockBuf(kind, i))),
        () => { for (let i = 0; i < 8; i++) this.clapBuf(i); },
        () => this.applauseBuf(false),
        () => this.applauseBuf(true),
      ];
      const next = () => {
        const job = jobs.shift();
        if (!job) return;
        job();
        setTimeout(next, 16);
      };
      setTimeout(next, 30);
    }

    gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

    filter(type, f, q) {
      const b = this.ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f;
      if (q != null) b.Q.value = q;
      return b;
    }

    osc(type, f) {
      const o = this.ctx.createOscillator();
      if (SPECTRA[type]) o.setPeriodicWave(this.wave(type)); else o.type = type;
      o.frequency.value = f;
      return o;
    }

    /** Stereo panner when supported; otherwise a pass-through gain. */
    panner(p) {
      if (!this.ctx.createStereoPanner) return this.gain(1);
      const s = this.ctx.createStereoPanner();
      s.pan.value = clamp(p, -1, 1);
      return s;
    }

    cached(key, make) {
      if (!this.cache.has(key)) this.cache.set(key, make());
      return this.cache.get(key);
    }

    wave(name) {
      return this.cached('wave:' + name, () => {
        const imag = new Float32Array(SPECTRA[name]);
        return this.ctx.createPeriodicWave(new Float32Array(imag.length), imag);
      });
    }

    noiseBuf(kind) { return this.cached('noise:' + kind, () => makeNoise(this.ctx, kind)); }

    /** Looping noise source started at a random offset. dur null = runs until stopped. */
    noiseSrc(kind, t, dur, rate = 1) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf(kind);
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(t, Math.random() * (s.buffer.duration - 0.1));
      if (dur != null) s.stop(t + dur);
      return s;
    }

    /** Smooth random control signal in -1..1, changing about `hz` times per second. */
    lfoNoise(t, hz, dur) { return this.noiseSrc('smooth', t, dur, hz * 64 / this.sr); }

    knockBuf(kind, i) {
      const spec = KNOCKS[kind], k = i % spec.f.length;
      return this.cached(`knock:${kind}:${k}`, () => {
        const b = this.ctx.createBuffer(1, Math.floor(this.sr * 0.32), this.sr);
        b.getChannelData(0).set(genKnock(this.sr, spec, spec.f[k]));
        return b;
      });
    }

    claps() { return this.cached('claps', () => Array.from({ length: 8 }, () => genClap(this.sr))); }

    clapBuf(i) {
      return this.cached('clap:' + (i % 8), () => {
        const d = this.claps()[i % 8];
        const b = this.ctx.createBuffer(1, d.length, this.sr);
        b.getChannelData(0).set(d);
        return b;
      });
    }

    applauseBuf(dense) {
      return this.cached('applause:' + dense, () => genApplause(this.ctx, this.claps(), dense ? 26 : 8, 5));
    }

    setVolumes(music, sfx, ramp) {
      const t = this.now, tc = Math.max(0.001, ramp / 3);
      const m = volCurve(music) * MUSIC_LEVEL, s = volCurve(sfx);
      for (const [p, v] of [[this.musicVol.gain, m], [this.sfxVol.gain, s], [this.sfxSendVol.gain, s]]) {
        if (ramp > 0) { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, tc); } else p.value = v;
      }
    }
  }

  /** Smoothly moves an AudioParam to v (safe to call every frame). */
  function glideParam(param, v, t, ramp) {
    param.cancelScheduledValues(t);
    param.setTargetAtTime(v, t, Math.max(0.004, ramp / 3));
  }

  // ---------------------------------------------------------------------------------------------
  // Synthesis primitives. All take the Mixer, a destination node and an options object, schedule
  // their nodes at o.t and return the time the sound ends.
  // ---------------------------------------------------------------------------------------------

  /** Linear attack to `peak`, exponential decay over `d`. */
  function perc(param, t, a, peak, d) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
    param.setValueAtTime(0, t + a + d);
    return t + a + d;
  }

  /** Attack, decay to sustain `s`·peak, hold until t+dur, release over r. */
  function adsr(param, t, a, peak, d, s, dur, r) {
    const tA = t + a, tD = Math.min(tA + d, t + Math.max(dur, a)), tR = Math.max(tD, t + dur);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, tA);
    param.linearRampToValueAtTime(peak * s, tD);
    param.setValueAtTime(peak * s, tR);
    param.linearRampToValueAtTime(0, tR + r);
    return tR + r;
  }

  /** Oscillator with optional pitch glide (o.to over o.glide) and optional low-pass (o.lp). */
  function tone(M, dest, o) {
    const t = o.t, a = o.a ?? 0.004, d = o.d ?? 0.2;
    const osc = M.osc(o.type || 'sine', o.f);
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? a + d));
    const g = M.gain(0);
    const end = perc(g.gain, t, a, o.v ?? 0.5, d);
    if (o.lp) { const f = M.filter('lowpass', o.lp, 0.7); osc.connect(f); f.connect(g); } else osc.connect(g);
    g.connect(dest);
    osc.start(t); osc.stop(end + 0.02);
    return end;
  }

  /** Two-operator FM: sine carrier f, modulator f·ratio with index decaying from o.index to o.indexEnd. */
  function fm(M, dest, o) {
    const t = o.t, a = o.a ?? 0.002, d = o.d ?? 0.5, f = o.f;
    const car = M.osc('sine', f), mod = M.osc('sine', f * o.ratio);
    const mg = M.gain(0);
    mg.gain.setValueAtTime(o.index * f, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, (o.indexEnd ?? 0) * f), t + (o.idur ?? d));
    if (o.to) {
      car.frequency.setValueAtTime(f, t); car.frequency.exponentialRampToValueAtTime(o.to, t + a + d);
      mod.frequency.setValueAtTime(f * o.ratio, t); mod.frequency.exponentialRampToValueAtTime(o.to * o.ratio, t + a + d);
    }
    mod.connect(mg); mg.connect(car.frequency);
    const g = M.gain(0);
    const end = perc(g.gain, t, a, o.v ?? 0.4, d);
    car.connect(g); g.connect(dest);
    car.start(t); mod.start(t); car.stop(end + 0.02); mod.stop(end + 0.02);
    return end;
  }

  /** Filtered noise burst. o.type (filter) with o.f → o.to sweep; o.kind = white | pink | brown. */
  function noise(M, dest, o) {
    const t = o.t, a = o.a ?? 0.002, d = o.d ?? 0.1;
    const src = M.noiseSrc(o.kind || 'white', t, a + d + 0.03, o.rate || 1);
    const g = M.gain(0);
    const end = perc(g.gain, t, a, o.v ?? 0.4, d);
    if (o.type) {
      const f = M.filter(o.type, o.f, o.q ?? 1);
      if (o.to) {
        f.frequency.setValueAtTime(o.f, t);
        f.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? a + d));
      }
      src.connect(f); f.connect(g);
    } else src.connect(g);
    g.connect(dest);
    return end;
  }

  /** Noise with a rise-then-fall filter sweep and swell: the shape of every whoosh. */
  function sweep(M, dest, o) {
    const t = o.t, dur = o.dur, peakAt = t + dur * (o.peak ?? 0.55);
    const src = M.noiseSrc(o.kind || 'white', t, dur + 0.03);
    const f = M.filter('bandpass', o.f0, o.q ?? 1.3);
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(o.f1, peakAt);
    f.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = M.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.v, peakAt);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    return t + dur;
  }

  /** Amplitude flutter (cloth, leaves, net): returns a gain node whose level wobbles at `rate`. */
  function flutter(M, dest, t, dur, rate, depth) {
    const am = M.gain(1 - depth);
    const lfo = M.osc('triangle', rate), lg = M.gain(depth);
    lfo.connect(lg); lg.connect(am.gain); am.connect(dest);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    return am;
  }

  /** Plays a procedural knock sample (pins, wood blocks, plastic cup). */
  function knock(M, dest, t, kind, o = {}) {
    const s = M.ctx.createBufferSource();
    s.buffer = M.knockBuf(kind, o.variant ?? irand(0, 7));
    s.playbackRate.value = o.rate ?? 1;
    const g = M.gain(o.v ?? 0.5);
    s.connect(g);
    if (o.pan) { const p = M.panner(o.pan); g.connect(p); p.connect(dest); } else g.connect(dest);
    s.start(t);
    return t + s.buffer.duration / (o.rate ?? 1);
  }

  function clap(M, dest, t, v, pan) {
    const s = M.ctx.createBufferSource();
    s.buffer = M.clapBuf(irand(0, 7));
    s.playbackRate.value = rand(0.92, 1.1);
    const g = M.gain(v), p = M.panner(pan);
    s.connect(g); g.connect(p); p.connect(dest);
    s.start(t);
    return t + 0.08;
  }

  /** A handful of high glints (stars, confetti, fireworks). */
  function sparkle(M, dest, t, n, span, v) {
    let end = t;
    for (let i = 0; i < n; i++) {
      const at = t + Math.pow(Math.random(), 1.4) * span;
      end = Math.max(end, tone(M, dest, { t: at, f: rand(2600, 6200), a: 0.002, d: rand(0.08, 0.22), v: v * rand(0.5, 1) }));
    }
    return end;
  }

  // ---- Formant voices (crowd, cheers, umpire) -------------------------------------------------

  const VOWELS = {
    ah: [800, 1200, 2600], eh: [550, 1800, 2600], ee: [300, 2300, 3000], oo: [330, 850, 2400],
    oh: [500, 900, 2500], aw: [680, 1050, 2600], uh: [600, 1150, 2500], ay: [600, 1900, 2600],
  };
  const FORMANT_Q = [6, 9, 13], FORMANT_GAIN = [1, 0.55, 0.3];

  /**
   * Sawtooth glottal source through 2–3 formant band-passes.
   * o: t, dur, f0, pitch [[relT, ratio]], vowels [[relT, vowel]], v, vib [rate, depth],
   *    nf (formants), a, r, breath (noise mix 0..1), syll {n, rate} (syllable pulses, e.g. laughter)
   */
  function vocal(M, dest, o) {
    const t = o.t, dur = o.dur, end = t + dur;
    const src = M.osc('sawtooth', o.f0), soft = M.filter('lowpass', 3600, 0.5);
    src.connect(soft);
    const pts = o.pitch || [[0, 1]];
    src.frequency.setValueAtTime(o.f0 * pts[0][1], t);
    for (let i = 1; i < pts.length; i++) src.frequency.linearRampToValueAtTime(o.f0 * pts[i][1], t + pts[i][0] * dur);
    if (o.vib) {
      const lfo = M.osc('sine', o.vib[0]), lg = M.gain(o.vib[1] * o.f0);
      lfo.connect(lg); lg.connect(src.frequency);
      lfo.start(t); lfo.stop(end + 0.05);
    }
    const env = M.gain(0);
    const vw = o.vowels || [[0, 'ah']];
    const nf = o.nf || 3;
    let breath = null;
    if (o.breath) { breath = M.gain(o.breath * 1.6); M.noiseSrc('white', t, dur + 0.05).connect(breath); }
    for (let k = 0; k < nf; k++) {
      const bp = M.filter('bandpass', VOWELS[vw[0][1]][k], FORMANT_Q[k]);
      bp.frequency.setValueAtTime(VOWELS[vw[0][1]][k], t);
      for (let i = 1; i < vw.length; i++) bp.frequency.linearRampToValueAtTime(VOWELS[vw[i][1]][k], t + vw[i][0] * dur);
      const g = M.gain(FORMANT_GAIN[k] * 2.4);
      soft.connect(bp);
      if (breath) breath.connect(bp);
      bp.connect(g); g.connect(env);
    }
    const v = o.v ?? 0.5, a = o.a ?? 0.04, r = Math.min(o.r ?? 0.1, dur * 0.8);
    const p = env.gain;
    p.setValueAtTime(0, t);
    if (o.syll) {
      const step = 1 / o.syll.rate;
      for (let k = 0; k < o.syll.n; k++) {
        const ts = t + k * step, ak = v * (1 - 0.55 * k / o.syll.n);
        p.setValueAtTime(0.0001, ts);
        p.linearRampToValueAtTime(ak, ts + 0.025);
        p.linearRampToValueAtTime(ak * 0.12, ts + step * 0.75);
      }
      p.linearRampToValueAtTime(0, end);
    } else {
      p.linearRampToValueAtTime(v, t + a);
      p.setValueAtTime(v, Math.max(t + a, end - r));
      p.linearRampToValueAtTime(0, end);
    }
    env.connect(dest);
    src.start(t); src.stop(end + 0.05);
    return end;
  }

  /** Random crowd member: [f0, vibrato depth]. */
  function crowdPitch() {
    const r = Math.random();
    return r < 0.4 ? rand(130, 210) : r < 0.8 ? rand(230, 360) : rand(340, 470);
  }

  /** Murmur bed: pink noise through vowel-ish bands, each swelling at its own slow random rate. */
  function crowdBed(M, dest, t, dur, bands, hz = 3) {
    const srcs = [];
    for (const [f, q, v] of bands) {
      const n = M.noiseSrc('pink', t, dur);
      const bp = M.filter('bandpass', f * rand(0.92, 1.08), q);
      const g = M.gain(v * 0.6);
      const mod = M.lfoNoise(t, hz * rand(0.7, 1.4), dur), md = M.gain(v * 0.4);
      mod.connect(md); md.connect(g.gain);
      n.connect(bp); bp.connect(g); g.connect(dest);
      srcs.push(n, mod);
    }
    return srcs;
  }

  /** Envelope wrapper: a gain that swells in over `a`, holds, and releases by t+dur. */
  function swellGain(M, dest, t, a, v, dur, r) {
    const g = M.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, t + Math.max(a, dur - r));
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(dest);
    return g;
  }

  // ---------------------------------------------------------------------------------------------
  // Instruments (shared by music and the fanfares). fn(M, dest, t, freq, dur, vel) -> end time
  // ---------------------------------------------------------------------------------------------

  const INST = {
    marimba(M, dest, t, f, dur, v) {
      return fm(M, dest, { t, f, ratio: 4, index: 1.3, indexEnd: 0.02, idur: 0.06, a: 0.002, d: 0.45 + 80 / f, v: v * 0.55 });
    },
    bell(M, dest, t, f, dur, v) {
      return fm(M, dest, { t, f, ratio: 3.5, index: 1.4, indexEnd: 0.05, idur: 0.7, a: 0.002, d: 1.3, v: v * 0.32 });
    },
    vibes(M, dest, t, f, dur, v) {
      return fm(M, dest, { t, f, ratio: 4, index: 0.7, indexEnd: 0.01, idur: 0.15, a: 0.003, d: 1.1 + 120 / f, v: v * 0.45 });
    },
    epiano(M, dest, t, f, dur, v) {
      return fm(M, dest, { t, f, ratio: 1, index: 1.5, indexEnd: 0.12, idur: 0.6, a: 0.003, d: 0.9 + 80 / f, v: v * 0.3 });
    },
    pluck(M, dest, t, f, dur, v, decay = 0.45) {
      const o = M.osc('sawtooth', f), lp = M.filter('lowpass', f * 7, 1.6), g = M.gain(0);
      lp.frequency.setValueAtTime(Math.min(9000, f * 7), t);
      lp.frequency.exponentialRampToValueAtTime(f * 1.3, t + decay * 0.6);
      const end = perc(g.gain, t, 0.002, v * 0.3, decay);
      o.connect(lp); lp.connect(g); g.connect(dest);
      o.start(t); o.stop(end + 0.02);
      return end;
    },
    pizz(M, dest, t, f, dur, v) { return INST.pluck(M, dest, t, f, dur, v * 1.1, 0.18); },
    square(M, dest, t, f, dur, v) {
      const o = M.osc('softsq', f), g = M.gain(0);
      const end = adsr(g.gain, t, 0.012, v * 0.26, 0.12, 0.72, dur * 0.92, 0.09);
      if (dur > 0.24) vibrato(M, o, t + 0.14, end, 5.6, 14);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(end + 0.02);
      return end;
    },
    flute(M, dest, t, f, dur, v) {
      const o = M.osc('sine', f), o2 = M.osc('triangle', f * 2), g = M.gain(0), g2 = M.gain(0.12);
      const end = adsr(g.gain, t, 0.045, v * 0.42, 0.12, 0.82, dur * 0.95, 0.12);
      vibrato(M, o, t + 0.18, end, 5, 12);
      o2.connect(g2); g2.connect(g); o.connect(g); g.connect(dest);
      noise(M, dest, { t, a: 0.02, d: 0.09, v: v * 0.05, type: 'bandpass', f: f * 2, q: 2 });
      o.start(t); o2.start(t); o.stop(end + 0.02); o2.stop(end + 0.02);
      return end;
    },
    organ(M, dest, t, f, dur, v) {
      const o = M.osc('organ', f), g = M.gain(0);
      const end = adsr(g.gain, t, 0.006, v * 0.22, 0.06, 0.88, dur * 0.9, 0.05);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(end + 0.02);
      return end;
    },
    pad(M, dest, t, f, dur, v) {
      const o = M.osc('softsq', f), o2 = M.osc('sine', f), lp = M.filter('lowpass', Math.min(2400, f * 3), 0.5), g = M.gain(0);
      o.detune.value = 6; o2.detune.value = -6;
      const end = adsr(g.gain, t, 0.3, v * 0.14, 0.3, 0.8, dur, 0.5);
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
      o.start(t); o2.start(t); o.stop(end + 0.02); o2.stop(end + 0.02);
      return end;
    },
    bass(M, dest, t, f, dur, v) {
      const o = M.osc('bass', f), g = M.gain(0);
      const end = adsr(g.gain, t, 0.005, v * 0.5, 0.18, 0.55, dur * 0.9, 0.06);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(end + 0.02);
      return end;
    },
    brass(M, dest, t, f, dur, v) {
      const lp = M.filter('lowpass', f, 2), g = M.gain(0);
      lp.frequency.setValueAtTime(f * 1.2, t);
      lp.frequency.linearRampToValueAtTime(Math.min(8000, f * 5), t + 0.05);
      lp.frequency.setTargetAtTime(Math.min(6000, f * 3), t + 0.05, 0.15);
      const end = adsr(g.gain, t, 0.025, v * 0.2, 0.12, 0.75, dur, 0.12);
      for (const det of [-7, 7]) {
        const o = M.osc('sawtooth', f);
        o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(end + 0.02);
      }
      lp.connect(g); g.connect(dest);
      return end;
    },
  };

  /** Delayed-onset vibrato on an oscillator (depth in cents). */
  function vibrato(M, osc, from, to, rate, cents) {
    if (to - from < 0.05) return;
    const lfo = M.osc('sine', rate * rand(0.95, 1.05)), lg = M.gain(0);
    lg.gain.setValueAtTime(0, from);
    lg.gain.linearRampToValueAtTime(cents, Math.min(to, from + 0.25));
    lfo.connect(lg); lg.connect(osc.detune);
    lfo.start(from); lfo.stop(to + 0.02);
  }

  const DRUM = {
    kick(M, dest, t, v) {
      tone(M, dest, { t, f: 150, to: 46, glide: 0.11, a: 0.002, d: 0.26, v: v * 0.8 });
      return tone(M, dest, { t, f: 1200, to: 400, a: 0.001, d: 0.012, v: v * 0.12 });
    },
    snare(M, dest, t, v) {
      tone(M, dest, { t, type: 'triangle', f: 190, to: 160, a: 0.001, d: 0.07, v: v * 0.3 });
      return noise(M, dest, { t, a: 0.001, d: 0.13, v: v * 0.32, type: 'bandpass', f: 2200, q: 0.7 });
    },
    clap(M, dest, t, v) { return clap(M, dest, t, v * 0.5, 0); },
    rim(M, dest, t, v) {
      tone(M, dest, { t, f: 1750, a: 0.001, d: 0.03, v: v * 0.18 });
      return noise(M, dest, { t, a: 0.001, d: 0.012, v: v * 0.2, type: 'highpass', f: 3000 });
    },
    hat(M, dest, t, v) { return noise(M, dest, { t, a: 0.001, d: 0.035, v: v * 0.16, type: 'highpass', f: 7500 }); },
    ride(M, dest, t, v) {
      fm(M, dest, { t, f: 3100, ratio: 1.47, index: 2, indexEnd: 0.5, a: 0.001, d: 0.3, v: v * 0.035 });
      return noise(M, dest, { t, a: 0.001, d: 0.14, v: v * 0.1, type: 'highpass', f: 5500 });
    },
    shaker(M, dest, t, v) { return noise(M, dest, { t, a: 0.012, d: 0.05, v: v * 0.1, type: 'bandpass', f: 5500, q: 1.2 }); },
    brush(M, dest, t, v) { return noise(M, dest, { t, a: 0.02, d: 0.13, v: v * 0.18, type: 'bandpass', f: 3200, q: 0.6 }); },
    block(M, dest, t, v) { return fm(M, dest, { t, f: 1180, ratio: 2.4, index: 0.8, a: 0.001, d: 0.05, v: v * 0.22 }); },
  };

  // ---- Note lines (shared by music and fanfares) ----------------------------------------------

  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function noteMidi(tok) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(tok);
    if (!m) throw new Error(`audio: bad note "${tok}"`);
    return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  const lineTokens = str => str.replace(/\|/g, ' ').trim().split(/\s+/);

  /** "C5 - E5 . G5" → [{ step, tok, len }]: '-' extends the previous token, '.' is a rest. */
  function lineEvents(str, stepsPerToken) {
    const toks = lineTokens(str), out = [];
    let cur = null;
    toks.forEach((tk, i) => {
      if (tk === '-') { if (cur) cur.len += stepsPerToken; return; }
      cur = null;
      if (tk === '.') return;
      cur = { step: i * stepsPerToken, tok: tk, len: stepsPerToken };
      out.push(cur);
    });
    return { events: out, steps: toks.length * stepsPerToken };
  }

  /** Plays a 16th-note melody line on an instrument; returns the end time. */
  function phrase(M, dest, t, bpm, str, inst, v, transpose = 0) {
    const st = 60 / bpm / 4;
    let end = t;
    for (const e of lineEvents(str, 1).events) {
      end = Math.max(end, INST[inst](M, dest, t + e.step * st, mtof(noteMidi(e.tok) + transpose), e.len * st, v));
    }
    return end;
  }

  /** A sustained chord on an instrument. */
  function chord(M, dest, t, notes, dur, inst, v) {
    let end = t;
    for (const n of notes) end = Math.max(end, INST[inst](M, dest, t, mtof(noteMidi(n)), dur, v));
    return end;
  }

  function cymbal(M, dest, t, v, d = 1.4) {
    return noise(M, dest, { t, a: 0.003, d, v, type: 'highpass', f: 5200, q: 0.5 });
  }

  function timpani(M, dest, t, f, v) {
    tone(M, dest, { t, f, to: f * 0.96, a: 0.004, d: 0.7, v });
    return noise(M, dest, { t, kind: 'brown', a: 0.002, d: 0.12, v: v * 0.6, type: 'lowpass', f: 400 });
  }

  // ---------------------------------------------------------------------------------------------
  // SFX library. Recipe: fn(M, t, o, out) -> end time. o = { intensity, rate } (vol/pan are applied
  // by the caller's output node). `wet` = reverb send, `max` = repeats allowed per 35 ms window.
  // ---------------------------------------------------------------------------------------------

  const SFX = {};
  function def(name, wet, fn, max = 3) { SFX[name] = { wet, fn, max }; }

  // ---- UI --------------------------------------------------------------------------------------

  def('ui_tap', 0.06, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, f: 520 * R, to: 820 * R, glide: 0.045, a: 0.003, d: 0.09, v: 0.6 });
    return tone(M, out, { t, type: 'triangle', f: 1040 * R, to: 1640 * R, glide: 0.045, a: 0.003, d: 0.05, v: 0.1 });
  });

  def('ui_select', 0.08, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, f: 660 * R, to: 720 * R, a: 0.003, d: 0.08, v: 0.38 });
    tone(M, out, { t: t + 0.06, f: 990 * R, to: 1060 * R, a: 0.003, d: 0.15, v: 0.38 });
    return tone(M, out, { t: t + 0.06, type: 'triangle', f: 1980 * R, a: 0.003, d: 0.07, v: 0.06 });
  });

  def('ui_back', 0.08, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, f: 740 * R, to: 700 * R, a: 0.003, d: 0.08, v: 0.36 });
    return tone(M, out, { t: t + 0.06, f: 494 * R, to: 470 * R, a: 0.003, d: 0.14, v: 0.36 });
  });

  def('ui_open', 0.12, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, f: 380 * R, to: 980 * R, glide: 0.16, a: 0.01, d: 0.2, v: 0.32 });
    tone(M, out, { t, f: 760 * R, to: 1960 * R, glide: 0.16, a: 0.01, d: 0.12, v: 0.06 });
    return noise(M, out, { t, a: 0.06, d: 0.14, v: 0.06, type: 'bandpass', f: 900, to: 3200, q: 1.2 });
  });

  def('ui_close', 0.12, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, f: 900 * R, to: 360 * R, glide: 0.16, a: 0.01, d: 0.18, v: 0.32 });
    return noise(M, out, { t, a: 0.05, d: 0.12, v: 0.05, type: 'bandpass', f: 3000, to: 900, q: 1.2 });
  });

  def('ui_error', 0.06, (M, t, o, out) => {
    const R = o.rate;
    for (const [dt, f] of [[0, 300], [0.13, 225]]) {
      tone(M, out, { t: t + dt, type: 'triangle', f: f * R, to: f * 0.94 * R, a: 0.004, d: 0.13, v: 0.38 });
      tone(M, out, { t: t + dt, f: f * 0.5 * R, a: 0.004, d: 0.13, v: 0.22 });
    }
    return t + 0.28;
  });

  def('ui_tick', 0.02, (M, t, o, out) => {
    tone(M, out, { t, f: 2100 * o.rate, a: 0.001, d: 0.025, v: 0.22 });
    return noise(M, out, { t, a: 0.001, d: 0.01, v: 0.07, type: 'highpass', f: 6000 });
  }, 4);

  def('ui_toggle', 0.06, (M, t, o, out) => {
    const on = o.intensity >= 0.5, R = o.rate;
    tone(M, out, { t, f: (on ? 700 : 1100) * R, to: (on ? 1100 : 700) * R, glide: 0.06, a: 0.003, d: 0.07, v: 0.34 });
    return tone(M, out, { t: t + 0.03, f: (on ? 1500 : 1000) * R, a: 0.001, d: 0.035, v: 0.12 });
  });

  def('pop', 0.08, (M, t, o, out) => {
    tone(M, out, { t, f: 260 * o.rate, to: 1400 * o.rate, glide: 0.035, a: 0.002, d: 0.07, v: 0.5 });
    return noise(M, out, { t, a: 0.001, d: 0.02, v: 0.1, type: 'bandpass', f: 2000 });
  }, 4);

  def('swish', 0.1, (M, t, o, out) =>
    sweep(M, out, { t, dur: 0.26, f0: 700 * o.rate, f1: 3800 * o.rate, f2: 2400 * o.rate, v: 0.32, peak: 0.4, q: 1.2 }));

  def('star', 0.3, (M, t, o, out) => {
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => INST.bell(M, out, t + i * 0.06, mtof(noteMidi(n)) * o.rate, 0.3, 0.75));
    return sparkle(M, out, t + 0.12, 5, 0.4, 0.05) + 1.2;
  });

  def('coin', 0.15, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, type: 'square', f: 988 * R, a: 0.002, d: 0.07, v: 0.14, lp: 4000 });
    tone(M, out, { t, f: 988 * R, a: 0.002, d: 0.07, v: 0.2 });
    tone(M, out, { t: t + 0.07, type: 'square', f: 1319 * R, a: 0.002, d: 0.38, v: 0.13, lp: 4000 });
    return tone(M, out, { t: t + 0.07, f: 1319 * R, a: 0.002, d: 0.42, v: 0.22 });
  });

  def('levelup', 0.25, (M, t, o, out) => {
    ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => {
      const f = mtof(noteMidi(n)) * o.rate;
      tone(M, out, { t: t + i * 0.055, type: 'square', f, a: 0.003, d: 0.14, v: 0.1, lp: 3500 });
      tone(M, out, { t: t + i * 0.055, f, a: 0.003, d: 0.14, v: 0.16 });
    });
    const t2 = t + 6 * 0.055;
    ['C6', 'E6', 'G6'].forEach(n => INST.bell(M, out, t2, mtof(noteMidi(n)) * o.rate, 0.6, 0.6));
    return sparkle(M, out, t2, 6, 0.45, 0.045) + 1.0;
  });

  def('count_beep', 0.08, (M, t, o, out) => {
    tone(M, out, { t, f: 880 * o.rate, a: 0.005, d: 0.18, v: 0.42 });
    return tone(M, out, { t, type: 'triangle', f: 1760 * o.rate, a: 0.005, d: 0.08, v: 0.07 });
  });

  def('count_go', 0.15, (M, t, o, out) => {
    for (const f of [784, 1046, 1318]) tone(M, out, { t, f: f * o.rate, a: 0.006, d: 0.55, v: 0.24 });
    tone(M, out, { t, type: 'square', f: 1318 * o.rate, a: 0.006, d: 0.3, v: 0.07, lp: 2600 });
    sweep(M, out, { t, dur: 0.3, f0: 900, f1: 4000, f2: 3000, v: 0.12, peak: 0.3 });
    return t + 0.6;
  });

  def('type', 0.02, (M, t, o, out) => {
    tone(M, out, { t, f: rand(1700, 2300) * o.rate, a: 0.001, d: 0.02, v: 0.18 });
    return noise(M, out, { t, a: 0.001, d: 0.008, v: 0.06, type: 'highpass', f: 5000 });
  }, 4);

  // ---- Generic -----------------------------------------------------------------------------------

  def('whoosh', 0.08, (M, t, o, out) => {
    const I = o.intensity, R = o.rate;
    return sweep(M, out, { t, dur: 0.18 + 0.26 * I, f0: 380 * R, f1: (1500 + 1100 * I) * R, f2: 650 * R, v: 0.2 + 0.32 * I, q: 1.4 });
  });

  def('swing_light', 0.06, (M, t, o, out) =>
    sweep(M, out, { t, dur: 0.24, f0: 600 * o.rate, f1: 3000 * o.rate, f2: 1000 * o.rate, v: 0.3, q: 1.5 }));

  def('swing_heavy', 0.08, (M, t, o, out) => {
    tone(M, out, { t, f: 110 * o.rate, to: 70 * o.rate, a: 0.12, d: 0.25, v: 0.14 });
    return sweep(M, out, { t, dur: 0.42, f0: 280 * o.rate, f1: 1700 * o.rate, f2: 450 * o.rate, v: 0.55, q: 1.2 });
  });

  def('thud', 0.06, (M, t, o, out) => {
    tone(M, out, { t, f: 120 * o.rate, to: 50 * o.rate, a: 0.003, d: 0.24, v: 0.75 });
    return noise(M, out, { t, kind: 'brown', a: 0.002, d: 0.07, v: 0.35, type: 'lowpass', f: 700 });
  });

  def('bounce_soft', 0.06, (M, t, o, out) => {
    const R = o.rate;
    tone(M, out, { t, f: 240 * R, to: 150 * R, a: 0.002, d: 0.12, v: 0.5 });
    tone(M, out, { t, f: 480 * R, to: 300 * R, a: 0.002, d: 0.05, v: 0.12 });
    return noise(M, out, { t, a: 0.001, d: 0.02, v: 0.14, type: 'lowpass', f: 1500 });
  }, 4);

  def('splash', 0.15, (M, t, o, out) => {
    tone(M, out, { t, f: 300 * o.rate, to: 900 * o.rate, glide: 0.05, a: 0.002, d: 0.08, v: 0.28 });
    noise(M, out, { t, a: 0.004, d: 0.22, v: 0.32, type: 'bandpass', f: 1500, q: 0.8 });
    let end = noise(M, out, { t, a: 0.01, d: 0.55, v: 0.38, type: 'lowpass', f: 3200, to: 700 });
    for (let i = 0; i < 9; i++) {
      const f = rand(900, 2400);
      end = Math.max(end, tone(M, out, { t: t + rand(0.05, 0.6), f, to: f * 1.8, glide: 0.03, a: 0.002, d: 0.04, v: rand(0.04, 0.1) }));
    }
    return end;
  });

  def('wood_knock', 0.12, (M, t, o, out) => knock(M, out, t, 'wood', { v: 0.75, rate: o.rate * rand(0.97, 1.03) }), 4);

  def('camera_flash', 0.1, (M, t, o, out) => {
    noise(M, out, { t, a: 0.001, d: 0.02, v: 0.6, type: 'bandpass', f: 3000, q: 0.7 });
    noise(M, out, { t: t + 0.06, a: 0.001, d: 0.025, v: 0.32, type: 'bandpass', f: 2400, q: 0.7 });
    fm(M, out, { t: t + 0.01, f: 2600 * o.rate, ratio: 1.5, index: 1, d: 0.25, v: 0.07 });
    return tone(M, out, { t: t + 0.08, f: 3000, to: 7000, glide: 0.5, a: 0.05, d: 0.45, v: 0.025 });
  });

  def('firework', 0.3, (M, t, o, out) => {
    const I = o.intensity;
    tone(M, out, { t, f: 700, to: 2000, glide: 0.55, a: 0.03, d: 0.55, v: 0.1 });
    noise(M, out, { t, a: 0.05, d: 0.5, v: 0.05, type: 'bandpass', f: 1500, to: 4000, q: 2 });
    const tb = t + 0.6;
    noise(M, out, { t: tb, kind: 'brown', a: 0.004, d: 0.5 + 0.8 * I, v: 0.3 + 0.45 * I, type: 'lowpass', f: 1400, to: 180 });
    tone(M, out, { t: tb, f: 85, to: 38, a: 0.003, d: 0.6, v: 0.25 + 0.4 * I });
    let end = tb + 1.3;
    const n = Math.round(8 + 22 * I);
    for (let i = 0; i < n; i++) {
      end = Math.max(end, noise(M, out, { t: tb + 0.1 + rand(0, 0.9), a: 0.001, d: 0.015, v: rand(0.04, 0.14), type: 'highpass', f: 3000 }));
    }
    return end;
  });

  def('confetti', 0.2, (M, t, o, out) => {
    noise(M, out, { t, a: 0.001, d: 0.05, v: 0.45, type: 'bandpass', f: 1800, q: 0.7 });
    tone(M, out, { t, f: 180, to: 70, a: 0.002, d: 0.1, v: 0.38 });
    const rustle = flutter(M, out, t, 0.9, 13, 0.6);
    noise(M, rustle, { t: t + 0.03, a: 0.06, d: 0.8, v: 0.08, type: 'highpass', f: 3000 });
    return sparkle(M, out, t + 0.05, 8, 0.7, 0.04);
  });

  // ---- Crowd & people ----------------------------------------------------------------------------

  /** Applause from the cached dense/sparse beds, cross-mixed by intensity. */
  function applause(M, out, t, I, len) {
    for (const dense of [true, false]) {
      const s = M.ctx.createBufferSource();
      s.buffer = M.applauseBuf(dense);
      const g = swellGain(M, out, t, 0.12, (dense ? I : 1 - I * 0.7) * 0.75, len, len * 0.45);
      s.connect(g);
      s.start(t, rand(0, 5 - len - 0.05));
      s.stop(t + len + 0.02);
    }
    return t + len;
  }

  def('crowd_cheer', 0.2, (M, t, o, out) => {
    const I = o.intensity, dur = 1.3 + 2.4 * I;
    const bed = swellGain(M, out, t, 0.15, 0.25 + 0.3 * I, dur, dur * 0.5);
    crowdBed(M, bed, t, dur + 0.05, [[500, 1.4, 0.5], [1150, 1.6, 0.45], [2400, 2, 0.25]], 5);
    const n = Math.round(5 + 13 * I);
    for (let i = 0; i < n; i++) {
      const st = t + rand(0, dur * 0.3), vd = dur * rand(0.4, 0.75);
      const word = pick([['ee', 'ah', 'ay'], ['oo', 'oo', 'oo'], ['eh', 'ay', 'ee'], ['ah', 'ah', 'ah']]);
      vocal(M, out, {
        t: st, dur: vd, f0: crowdPitch() * o.rate, nf: 2,
        pitch: [[0, 0.85], [0.15, rand(1.08, 1.22)], [0.6, rand(1, 1.1)], [1, 0.78]],
        vowels: [[0, word[0]], [0.2, word[1]], [1, word[2]]],
        vib: [rand(5, 7), 0.02], a: 0.07, r: vd * 0.45, v: rand(0.03, 0.06) * (0.7 + 0.5 * I),
      });
    }
    if (I > 0.55) {
      for (let i = 0; i < 2; i++) {
        const ws = t + rand(0.2, dur * 0.5), wf = rand(1800, 2500);
        tone(M, out, { t: ws, f: wf, to: wf * 1.45, glide: 0.18, a: 0.03, d: 0.3, v: 0.06 });
      }
    }
    applause(M, out, t + 0.1, I * 0.8, Math.min(4.8, dur));
    return t + dur + 0.1;
  }, 1);

  def('crowd_aww', 0.2, (M, t, o, out) => {
    const dur = 1.5;
    const bed = swellGain(M, out, t, 0.2, 0.22, dur, 0.7);
    crowdBed(M, bed, t, dur + 0.05, [[420, 1.4, 0.5], [900, 1.6, 0.35]], 2);
    for (let i = 0; i < 11; i++) {
      const st = t + rand(0, 0.18), vd = rand(0.9, 1.35);
      vocal(M, out, {
        t: st, dur: vd, f0: crowdPitch() * 1.1 * o.rate, nf: 2,
        pitch: [[0, 1.08], [0.2, 1.12], [1, 0.66]], vowels: [[0, 'ah'], [0.4, 'aw'], [1, 'oo']],
        vib: [rand(4.5, 6), 0.02], a: 0.1, r: vd * 0.5, v: rand(0.035, 0.06),
      });
    }
    return t + dur + 0.2;
  }, 1);

  def('crowd_gasp', 0.2, (M, t, o, out) => {
    noise(M, out, { t, kind: 'pink', a: 0.06, d: 0.4, v: 0.3, type: 'bandpass', f: 2200, q: 0.9 });
    for (let i = 0; i < 8; i++) {
      const st = t + rand(0, 0.08), vd = rand(0.3, 0.5);
      vocal(M, out, {
        t: st, dur: vd, f0: crowdPitch() * 1.15 * o.rate, nf: 2, breath: 0.25,
        pitch: [[0, 0.95], [0.3, 1.18], [1, 1.05]], vowels: [[0, 'ah'], [1, 'oh']],
        a: 0.03, r: vd * 0.6, v: rand(0.035, 0.06),
      });
    }
    return t + 0.6;
  }, 1);

  def('crowd_ooh', 0.2, (M, t, o, out) => {
    const dur = 1.7;
    const bed = swellGain(M, out, t, 0.25, 0.14, dur, 0.7);
    crowdBed(M, bed, t, dur + 0.05, [[380, 1.6, 0.5], [820, 2, 0.3]], 2);
    for (let i = 0; i < 11; i++) {
      const st = t + rand(0, 0.15), vd = rand(1.1, 1.6);
      vocal(M, out, {
        t: st, dur: vd, f0: crowdPitch() * o.rate, nf: 2,
        pitch: [[0, 0.95], [0.45, 1.28], [1, 0.95]], vowels: [[0, 'oo'], [0.5, 'oh'], [1, 'oo']],
        vib: [rand(5, 6.5), 0.018], a: 0.2, r: vd * 0.45, v: rand(0.035, 0.06),
      });
    }
    return t + dur + 0.1;
  }, 1);

  def('crowd_applause', 0.22, (M, t, o, out) => applause(M, out, t, o.intensity, 1.4 + 2.8 * o.intensity), 1);

  def('crowd_laugh', 0.18, (M, t, o, out) => {
    let end = t;
    for (let i = 0; i < 7; i++) {
      const st = t + rand(0, 0.25), rate = rand(5, 7), n = irand(4, 7), vd = n / rate + 0.1;
      end = Math.max(end, vocal(M, out, {
        t: st, dur: vd, f0: crowdPitch() * 1.1 * o.rate, nf: 2, breath: 0.35,
        pitch: [[0, 1.2], [1, 0.85]], vowels: [[0, 'ah'], [1, 'uh']],
        syll: { n, rate }, v: rand(0.1, 0.16),
      }));
    }
    return end;
  }, 1);

  def('whistle', 0.18, (M, t, o, out) => {
    const f = 2750 * o.rate, dur = 0.42;
    const osc = M.osc('sine', f), trill = M.osc('square', 34), tg = M.gain(110);
    trill.connect(tg); tg.connect(osc.frequency);
    const g = M.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.02);
    g.gain.setValueAtTime(0.28, t + dur - 0.06);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); trill.start(t); osc.stop(t + dur + 0.02); trill.stop(t + dur + 0.02);
    noise(M, out, { t, a: 0.02, d: dur, v: 0.05, type: 'bandpass', f, q: 4 });
    return t + dur;
  }, 1);

  def('voice_yay', 0.12, (M, t, o, out) => vocal(M, out, {
    t, dur: 0.55, f0: 340 * o.rate, pitch: [[0, 0.95], [0.25, 1.4], [0.7, 1.25], [1, 1.05]],
    vowels: [[0, 'ee'], [0.25, 'ah'], [0.8, 'ay'], [1, 'ee']], vib: [6, 0.025], a: 0.03, r: 0.18, v: 0.38,
  }), 2);

  def('voice_aw', 0.12, (M, t, o, out) => vocal(M, out, {
    t, dur: 0.7, f0: 360 * o.rate, pitch: [[0, 1.05], [0.25, 1.08], [1, 0.62]],
    vowels: [[0, 'ah'], [0.4, 'aw'], [1, 'oh']], vib: [5, 0.02], a: 0.05, r: 0.3, v: 0.36,
  }), 2);

  def('voice_hup', 0.05, (M, t, o, out) => {
    const f0 = rand(190, 230) * o.rate;
    noise(M, out, { t, a: 0.01, d: 0.05, v: 0.12, type: 'bandpass', f: 1300, q: 1.2 });
    return vocal(M, out, {
      t: t + 0.03, dur: 0.15, f0, pitch: [[0, 0.95], [0.4, 1.12], [1, 0.9]],
      vowels: [[0, 'uh'], [1, 'uh']], a: 0.015, r: 0.035, v: 0.4,
    });
  }, 2);

  def('ump_strike', 0.25, (M, t, o, out) => {
    noise(M, out, { t, a: 0.01, d: 0.06, v: 0.16, type: 'bandpass', f: 1700, q: 1.3 });
    return vocal(M, out, {
      t: t + 0.04, dur: 0.36, f0: 165 * o.rate, pitch: [[0, 1.1], [0.3, 1.32], [1, 0.9]],
      vowels: [[0, 'eh'], [0.55, 'ay'], [1, 'ee']], vib: [5.5, 0.02], a: 0.02, r: 0.12, v: 0.46,
    });
  }, 1);

  // ---- Fanfares & jingles ------------------------------------------------------------------------

  def('fanfare_small', 0.25, (M, t, o, out) => {
    phrase(M, out, t, 150, 'G4 . C5 . E5 . G5 - - - - - - - - -', 'brass', 0.8, Math.round(12 * Math.log2(o.rate)));
    const tc = t + 6 * 0.1;
    chord(M, out, tc, ['C4', 'E4', 'G4'], 0.8, 'brass', 0.45);
    INST.bell(M, out, tc, mtof(noteMidi('G6')), 0.5, 0.5);
    cymbal(M, out, tc, 0.06, 1);
    return tc + 1.2;
  }, 1);

  def('fanfare_big', 0.28, (M, t, o, out) => {
    const st = 60 / 140 / 4;
    phrase(M, out, t, 140, 'C5 . C5 . C5 . G4 . C5 - - . E5 - - . G5 - - - - - - - - - - - - - - -', 'brass', 0.85);
    phrase(M, out, t, 140, 'E4 . E4 . E4 . D4 . E4 - - . G4 - - . C5 - - - - - - - - - - - - - - -', 'brass', 0.45);
    timpani(M, out, t, 65.4, 0.45);
    timpani(M, out, t + 4 * st, 49, 0.4);
    const tc = t + 16 * st;
    timpani(M, out, tc, 65.4, 0.55);
    chord(M, out, tc, ['C4', 'G4'], 1.3, 'brass', 0.35);
    cymbal(M, out, tc, 0.1, 1.6);
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => INST.bell(M, out, tc + i * 0.07, mtof(noteMidi(n)), 0.4, 0.5));
    return sparkle(M, out, tc + 0.2, 6, 0.6, 0.035) + 1.6;
  }, 1);

  def('fanfare_record', 0.3, (M, t, o, out) => {
    phrase(M, out, t, 160, 'E5 G5 C6 E6 G6 C7', 'bell', 0.55);
    const tb = t + 6 * (60 / 160 / 4) + 0.05, st = 60 / 150 / 4;
    phrase(M, out, tb, 150, 'C5 - E5 - G5 - - . E5 - G5 - C6 - - - - - - - - - - -', 'brass', 0.8);
    phrase(M, out, tb, 150, 'G4 - C5 - E5 - - . C5 - E5 - G5 - - - - - - - - - - -', 'brass', 0.4);
    const tc = tb + 12 * st;
    timpani(M, out, tc, 65.4, 0.45);
    cymbal(M, out, tc, 0.08, 1.4);
    return sparkle(M, out, tc, 10, 1.0, 0.05) + 1.3;
  }, 1);

  def('jingle_win', 0.25, (M, t, o, out) => {
    const st = 60 / 150 / 4;
    phrase(M, out, t, 150, 'C5 E5 G5 C6 . G5 C6 - E6 - - - - - - -', 'marimba', 0.9);
    phrase(M, out, t, 150, 'C5 E5 G5 C6 . G5 C6 - E6 - - - - - - -', 'bell', 0.35, 12);
    phrase(M, out, t, 150, 'C3 - - - G2 - - - C3 - - - - - - -', 'bass', 0.55);
    chord(M, out, t + 8 * st, ['E4', 'G4', 'C5'], 0.9, 'brass', 0.4);
    return sparkle(M, out, t + 8 * st, 5, 0.6, 0.04) + 1.0;
  }, 1);

  def('jingle_lose', 0.22, (M, t, o, out) => {
    const st = 60 / 120 / 4;
    phrase(M, out, t, 120, 'G4 - - E4 - - D#4 - D4 - - - - - - -', 'marimba', 0.9);
    phrase(M, out, t, 120, 'G4 - - E4 - - D#4 - D4 - - - - - - -', 'brass', 0.35);
    phrase(M, out, t + 9 * st, 120, 'C4 - - - - - - - -', 'marimba', 0.8);
    phrase(M, out, t + 9 * st, 120, 'C3 - - - - - - - -', 'bass', 0.45);
    return t + 9 * st + 1.2;
  }, 1);

  def('jingle_start', 0.2, (M, t, o, out) => {
    const st = 60 / 160 / 4;
    phrase(M, out, t, 160, 'C5 . E5 . G5 . C6 - - -', 'marimba', 0.9);
    INST.bell(M, out, t + 6 * st, mtof(noteMidi('C7')), 0.5, 0.45);
    DRUM.shaker(M, out, t, 1); DRUM.shaker(M, out, t + 2 * st, 0.7); DRUM.shaker(M, out, t + 4 * st, 0.7);
    DRUM.kick(M, out, t + 6 * st, 0.8);
    return t + 6 * st + 1.0;
  }, 1);

  def('jingle_perfect', 0.3, (M, t, o, out) => {
    phrase(M, out, t, 300, 'C6 E6 G6 C7 E6 G6 C7 E7', 'bell', 0.5);
    const tb = t + 8 * (60 / 300 / 4) + 0.04, st = 60 / 150 / 4;
    phrase(M, out, tb, 150, 'G5 . E5 . G5 . C6 - - - - - - - - - -', 'brass', 0.8);
    phrase(M, out, tb, 150, 'E5 . C5 . E5 . G5 - - - - - - - - - -', 'brass', 0.4);
    phrase(M, out, tb, 150, 'G5 . E5 . G5 . C6 - - - - - - - - - -', 'marimba', 0.6, 12);
    const tc = tb + 6 * st;
    timpani(M, out, tc, 65.4, 0.5);
    cymbal(M, out, tc, 0.1, 1.6);
    return sparkle(M, out, tc, 14, 1.2, 0.05) + 1.4;
  }, 1);

  // ---- Bowling -----------------------------------------------------------------------------------

  def('bowl_release', 0.1, (M, t, o, out) => {
    tone(M, out, { t, f: 92 * o.rate, to: 46 * o.rate, a: 0.004, d: 0.34, v: 0.75 });
    noise(M, out, { t, kind: 'brown', a: 0.003, d: 0.2, v: 0.5, type: 'lowpass', f: 520 });
    return knock(M, out, t, 'wood', { v: 0.22, rate: 0.36 });
  }, 2);

  /** Pins tumbling: many randomized resonant knocks, densest at the start. */
  function clatter(M, out, t, n, span, v) {
    let end = t;
    for (let k = 0; k < n; k++) {
      const dt = span * Math.pow(Math.random(), 1.8);
      const floor = Math.random() < 0.25;
      end = Math.max(end, knock(M, out, t + dt, 'pin', {
        v: v * rand(0.35, 1) * (1 - 0.6 * dt / span),
        rate: floor ? rand(0.42, 0.5) : rand(0.88, 1.18),
        pan: rand(-0.6, 0.6),
      }));
    }
    return end;
  }

  def('pins_hit', 0.14, (M, t, o, out) => {
    const I = o.intensity;
    tone(M, out, { t, f: 170, to: 60, a: 0.002, d: 0.2, v: 0.35 + 0.35 * I });
    noise(M, out, { t, a: 0.001, d: 0.05, v: 0.3 + 0.25 * I, type: 'bandpass', f: 2500, q: 0.8 });
    knock(M, out, t, 'pin', { v: 0.7, rate: 0.95 });
    const span = 0.35 + 0.9 * I;
    noise(M, out, { t, kind: 'pink', a: 0.01, d: span, v: 0.08 + 0.12 * I, type: 'bandpass', f: 1800, q: 1 });
    return clatter(M, out, t + 0.012, Math.round(3 + 27 * I), span, 0.35 + 0.25 * I);
  }, 1);

  def('pin_clatter', 0.14, (M, t, o, out) =>
    clatter(M, out, t, Math.round(3 + 6 * o.intensity), 0.55, 0.3 + 0.2 * o.intensity), 2);

  def('gutter_drop', 0.1, (M, t, o, out) => {
    tone(M, out, { t, f: 130, to: 68, a: 0.003, d: 0.26, v: 0.6 });
    noise(M, out, { t, a: 0.002, d: 0.25, v: 0.4, type: 'bandpass', f: 400, q: 3 });
    noise(M, out, { t: t + 0.02, a: 0.02, d: 0.5, v: 0.1, type: 'bandpass', f: 950, q: 2 });
    return noise(M, out, { t: t + 0.05, kind: 'brown', a: 0.1, d: 0.85, v: 0.32, type: 'lowpass', f: 260 });
  }, 1);

  def('ball_return', 0.1, (M, t, o, out) => {
    noise(M, out, { t, kind: 'brown', a: 0.45, d: 1.0, v: 0.5, type: 'lowpass', f: 170 });
    noise(M, out, { t, a: 0.35, d: 0.95, v: 0.06, type: 'bandpass', f: 700, q: 4 });
    const tc = t + 1.3;
    knock(M, out, tc, 'wood', { v: 0.55, rate: 2.2 });
    tone(M, out, { t: tc, f: 1900, a: 0.001, d: 0.05, v: 0.12 });
    return tc + 0.3;
  }, 1);

  def('sweep', 0.1, (M, t, o, out) => {
    tone(M, out, { t, type: 'sawtooth', f: 70, to: 92, glide: 1.1, a: 0.2, d: 1.0, v: 0.14, lp: 420 });
    sweep(M, out, { t: t + 0.1, dur: 1.0, f0: 600, f1: 1500, f2: 500, v: 0.18, peak: 0.45, q: 1 });
    for (let i = 0; i < 6; i++) knock(M, out, t + rand(0.3, 1.0), 'pin', { v: rand(0.08, 0.18), rate: rand(0.8, 1.1), pan: rand(-0.5, 0.5) });
    return t + 1.4;
  }, 1);

  // ---- Tennis ------------------------------------------------------------------------------------

  def('racket_hit', 0.08, (M, t, o, out) => {
    const I = o.intensity, R = o.rate;
    noise(M, out, { t, a: 0.0005, d: 0.008, v: 0.5, type: 'highpass', f: 4000 });
    tone(M, out, { t, f: 1150 * R, to: 700 * R, glide: 0.015, a: 0.001, d: 0.05, v: 0.55 * (0.6 + 0.4 * I) });
    tone(M, out, { t, type: 'triangle', f: 520 * R, to: 380 * R, a: 0.001, d: 0.06, v: 0.4 * (0.7 + 0.3 * I) });
    fm(M, out, { t, f: 1900 * R, ratio: 1.41, index: 1, d: 0.18, v: 0.1 });
    tone(M, out, { t, f: 2850 * R, a: 0.001, d: 0.12, v: 0.05 });
    return tone(M, out, { t, f: 180, to: 90, a: 0.001, d: 0.08, v: 0.32 * I });
  }, 2);

  def('racket_frame', 0.08, (M, t, o, out) => {
    noise(M, out, { t, a: 0.0005, d: 0.01, v: 0.45, type: 'highpass', f: 3000 });
    tone(M, out, { t, type: 'square', f: 1200 * o.rate, to: 1100 * o.rate, a: 0.001, d: 0.06, v: 0.14, lp: 2500 });
    tone(M, out, { t, f: 400 * o.rate, to: 250 * o.rate, a: 0.001, d: 0.05, v: 0.32 });
    return fm(M, out, { t, f: 820 * o.rate, ratio: 2.76, index: 3, indexEnd: 0.2, d: 0.25, v: 0.16 });
  }, 2);

  def('ball_bounce_court', 0.08, (M, t, o, out) => {
    tone(M, out, { t, f: 480 * o.rate, to: 260 * o.rate, glide: 0.02, a: 0.001, d: 0.07, v: 0.45 });
    tone(M, out, { t, f: 950 * o.rate, to: 600 * o.rate, a: 0.001, d: 0.03, v: 0.1 });
    return noise(M, out, { t, a: 0.001, d: 0.015, v: 0.25, type: 'lowpass', f: 2500 });
  }, 3);

  def('serve_toss', 0.06, (M, t, o, out) => {
    tone(M, out, { t, f: 350 * o.rate, to: 420 * o.rate, a: 0.002, d: 0.05, v: 0.25 });
    return sweep(M, out, { t, dur: 0.22, f0: 700, f1: 1600, f2: 1200, v: 0.22, peak: 0.3, q: 1.5 });
  }, 1);

  def('net_hit', 0.08, (M, t, o, out) => {
    tone(M, out, { t, f: 140, to: 80, a: 0.002, d: 0.15, v: 0.5 });
    const am = flutter(M, out, t, 0.45, 28, 0.6);
    return noise(M, am, { t, a: 0.01, d: 0.4, v: 0.3, type: 'bandpass', f: 1200, q: 1.5 });
  }, 1);

  def('line_call', 0.2, (M, t, o, out) => {
    const end = vocal(M, out, {
      t, dur: 0.3, f0: 190 * o.rate, pitch: [[0, 1.1], [0.3, 1.2], [1, 0.8]],
      vowels: [[0, 'ah'], [0.5, 'aw'], [1, 'oo']], vib: [5, 0.02], a: 0.02, r: 0.06, v: 0.48,
    });
    return noise(M, out, { t: end + 0.01, a: 0.001, d: 0.025, v: 0.14, type: 'highpass', f: 3500 });
  }, 1);

  // ---- Baseball ----------------------------------------------------------------------------------

  def('bat_crack', 0.18, (M, t, o, out) => {
    const s = o.intensity, R = o.rate, f0 = 650 * R;
    noise(M, out, { t, a: 0.0005, d: 0.01, v: 0.85, type: 'highpass', f: 2500 });
    noise(M, out, { t, a: 0.001, d: 0.04 + 0.08 * s, v: 0.42 + 0.2 * s, type: 'bandpass', f: 1800, q: 0.9 });
    const parts = [[1, 0.5, 0.05 + 0.18 * s], [2.31, 0.4 * (0.4 + 0.6 * s), 0.04 + 0.12 * s],
      [3.95, 0.25 * (0.3 + 0.7 * s), 0.03 + 0.08 * s], [6.1, 0.15 * s, 0.02 + 0.06 * s]];
    for (const [r, g, d] of parts) if (g > 0.001) tone(M, out, { t, f: f0 * r, a: 0.0008, d, v: g });
    tone(M, out, { t, f: 200, to: 80, a: 0.001, d: 0.07, v: 0.45 * (1 - 0.4 * s) });
    return s > 0.7 ? tone(M, out, { t, f: 2950 * R, a: 0.001, d: 0.35 * s, v: 0.07 }) : t + 0.25;
  }, 1);

  def('bat_foul', 0.12, (M, t, o, out) => {
    noise(M, out, { t, a: 0.0005, d: 0.008, v: 0.7, type: 'highpass', f: 3000 });
    noise(M, out, { t, a: 0.001, d: 0.03, v: 0.4, type: 'bandpass', f: 2500, q: 1 });
    tone(M, out, { t, f: 900 * o.rate, a: 0.0008, d: 0.05, v: 0.3 });
    tone(M, out, { t, f: 2100 * o.rate, a: 0.0008, d: 0.03, v: 0.14 });
    return fm(M, out, { t, f: 170, ratio: 1.02, index: 2, indexEnd: 0.3, a: 0.002, d: 0.28, v: 0.14 });
  }, 1);

  def('mitt_pop', 0.22, (M, t, o, out) => {
    noise(M, out, { t, a: 0.001, d: 0.045, v: 1.0, type: 'lowpass', f: 1800 });
    noise(M, out, { t, a: 0.001, d: 0.02, v: 0.4, type: 'bandpass', f: 900 });
    return tone(M, out, { t, f: 210 * o.rate, to: 95 * o.rate, a: 0.001, d: 0.09, v: 0.65 });
  }, 1);

  def('pitch_whoosh', 0.08, (M, t, o, out) => {
    tone(M, out, { t: t + 0.05, f: 1250 * o.rate, to: 1450 * o.rate, glide: 0.3, a: 0.15, d: 0.2, v: 0.035 });
    return sweep(M, out, { t, dur: 0.42, f0: 700 * o.rate, f1: 2600 * o.rate, f2: 900 * o.rate, v: 0.38, peak: 0.52, q: 1.6 });
  }, 1);

  def('ball_land_grass', 0.06, (M, t, o, out) => {
    noise(M, out, { t, kind: 'brown', a: 0.002, d: 0.12, v: 0.5, type: 'lowpass', f: 500 });
    tone(M, out, { t, f: 110 * o.rate, to: 70 * o.rate, a: 0.002, d: 0.1, v: 0.35 });
    return noise(M, out, { t, a: 0.01, d: 0.15, v: 0.05, type: 'highpass', f: 3500 });
  }, 2);

  // ---- Golf --------------------------------------------------------------------------------------

  def('golf_drive', 0.12, (M, t, o, out) => {
    const I = o.intensity, R = o.rate;
    noise(M, out, { t, a: 0.0005, d: 0.006, v: 0.7, type: 'highpass', f: 3000 });
    fm(M, out, { t, f: 2900 * R, ratio: 1.41, index: 1.2, indexEnd: 0.1, a: 0.0008, d: 0.3, v: 0.22 });
    tone(M, out, { t, f: 4200 * R, a: 0.0008, d: 0.12, v: 0.05 });
    tone(M, out, { t, f: 900 * R, to: 600 * R, a: 0.001, d: 0.05, v: 0.42 });
    tone(M, out, { t, f: 160, to: 90, a: 0.001, d: 0.06, v: 0.3 * I });
    return noise(M, out, { t: t + 0.02, a: 0.03, d: 0.15 + 0.4 * I, v: 0.03 + 0.05 * I, type: 'bandpass', f: 3500, to: 1800, q: 2 });
  }, 1);

  def('golf_iron', 0.1, (M, t, o, out) => {
    noise(M, out, { t, a: 0.0005, d: 0.006, v: 0.6, type: 'highpass', f: 2500 });
    tone(M, out, { t, f: 1500 * o.rate, to: 1100 * o.rate, a: 0.001, d: 0.04, v: 0.3 });
    fm(M, out, { t, f: 2100 * o.rate, ratio: 2.2, index: 0.8, a: 0.001, d: 0.12, v: 0.06 });
    return noise(M, out, { t: t + 0.006, kind: 'brown', a: 0.005, d: 0.14, v: 0.42, type: 'lowpass', f: 900 });
  }, 1);

  def('golf_chip', 0.1, (M, t, o, out) => {
    noise(M, out, { t, a: 0.0005, d: 0.005, v: 0.4, type: 'highpass', f: 2500 });
    tone(M, out, { t, f: 1300 * o.rate, a: 0.001, d: 0.03, v: 0.22 });
    return noise(M, out, { t: t + 0.004, kind: 'brown', a: 0.004, d: 0.08, v: 0.25, type: 'lowpass', f: 1200 });
  }, 1);

  def('golf_putt', 0.08, (M, t, o, out) => {
    const k = 0.5 + 0.5 * o.intensity;
    tone(M, out, { t, f: 1050 * o.rate, to: 980 * o.rate, a: 0.001, d: 0.06, v: 0.36 * k });
    tone(M, out, { t, f: 2500 * o.rate, a: 0.001, d: 0.03, v: 0.08 * k });
    return noise(M, out, { t, a: 0.0005, d: 0.005, v: 0.2 * k, type: 'bandpass', f: 2000 });
  }, 1);

  def('golf_cup', 0.12, (M, t, o, out) => {
    const hits = [[0, 1], [0.11, 0.7], [0.19, 0.5], [0.25, 0.36], [0.29, 0.25], [0.315, 0.16]];
    for (const [dt, a] of hits) {
      knock(M, out, t + dt, 'cup', { v: 0.45 * a, rate: o.rate * rand(0.97, 1.03) });
      tone(M, out, { t: t + dt, f: 820 * o.rate, a: 0.001, d: 0.08, v: 0.12 * a });
    }
    return knock(M, out, t + 0.36, 'wood', { v: 0.18, rate: 0.6 });
  }, 1);

  def('golf_land_grass', 0.06, (M, t, o, out) => {
    noise(M, out, { t, kind: 'brown', a: 0.002, d: 0.1, v: 0.45, type: 'lowpass', f: 700 });
    tone(M, out, { t, f: 140 * o.rate, to: 80 * o.rate, a: 0.002, d: 0.08, v: 0.3 });
    return noise(M, out, { t, a: 0.01, d: 0.1, v: 0.05, type: 'highpass', f: 3500 });
  }, 2);

  def('golf_land_sand', 0.06, (M, t, o, out) => {
    noise(M, out, { t, a: 0.002, d: 0.3, v: 0.3, type: 'bandpass', f: 2500, q: 0.6 });
    tone(M, out, { t, f: 120, to: 80, a: 0.002, d: 0.07, v: 0.25 });
    let end = t + 0.3;
    for (let i = 0; i < 12; i++) {
      end = Math.max(end, noise(M, out, { t: t + rand(0, 0.25), a: 0.0005, d: 0.006, v: rand(0.02, 0.08), type: 'highpass', f: 4000 }));
    }
    return end;
  }, 1);

  def('golf_tree', 0.12, (M, t, o, out) => {
    knock(M, out, t, 'wood', { v: 0.5, rate: 0.7 * o.rate });
    knock(M, out, t + 0.25, 'wood', { v: 0.2, rate: 0.85 * o.rate });
    const leaves = flutter(M, out, t, 0.7, rand(12, 20), 0.6);
    return noise(M, leaves, { t, a: 0.03, d: 0.6, v: 0.15, type: 'highpass', f: 2500 });
  }, 1);

  def('golf_water', 0.15, (M, t, o, out) => {
    tone(M, out, { t, f: 260 * o.rate, to: 1100 * o.rate, glide: 0.06, a: 0.002, d: 0.1, v: 0.45 });
    let end = noise(M, out, { t, a: 0.005, d: 0.45, v: 0.32, type: 'lowpass', f: 2500, to: 600 });
    for (let i = 0; i < 6; i++) {
      const f = rand(1100, 2600);
      end = Math.max(end, tone(M, out, { t: t + rand(0.08, 0.6), f, to: f * 1.7, glide: 0.03, a: 0.002, d: 0.04, v: rand(0.04, 0.08) }));
    }
    return end;
  }, 1);

  def('flag_flap', 0.08, (M, t, o, out) => {
    const am = flutter(M, out, t, 0.8, rand(8, 11), 0.75);
    noise(M, am, { t, kind: 'pink', a: 0.05, d: 0.7, v: 0.9, type: 'bandpass', f: 450, q: 0.8 });
    return noise(M, am, { t, a: 0.05, d: 0.6, v: 0.25, type: 'bandpass', f: 1300, q: 1 });
  }, 1);

  // ---------------------------------------------------------------------------------------------
  // Loops. def(M, out) -> { setRate?(r, t, ramp), event?(t) -> seconds until next, stop(at) }
  // ---------------------------------------------------------------------------------------------

  /** A far-away crowd voice ("woo!", "yeah!"). */
  function distantVoice(M, dest, t, v) {
    const vd = rand(0.35, 0.7), word = pick([['oo', 'oo'], ['eh', 'ah'], ['ee', 'ay']]);
    return vocal(M, dest, {
      t, dur: vd, f0: crowdPitch(), nf: 2, pitch: [[0, 0.9], [0.3, 1.2], [1, 0.85]],
      vowels: [[0, word[0]], [1, word[1]]], vib: [6, 0.02], a: 0.05, r: vd * 0.5, v,
    });
  }

  function clapRun(M, dest, t, v) {
    const n = irand(3, 7), period = rand(0.18, 0.26), pan = rand(-0.8, 0.8);
    for (let i = 0; i < n; i++) clap(M, dest, t + i * period * rand(0.95, 1.05), v * rand(0.7, 1), pan);
  }

  function birdCall(M, dest, t) {
    const base = rand(2600, 4300), n = irand(2, 5), kind = irand(0, 2);
    for (let i = 0; i < n; i++) {
      const at = t + i * rand(0.07, 0.13), f = base * rand(0.92, 1.08);
      if (kind === 0) tone(M, dest, { t: at, f, to: f * rand(1.2, 1.5), glide: 0.05, a: 0.005, d: 0.06, v: rand(0.08, 0.15) });
      else if (kind === 1) fm(M, dest, { t: at, f, ratio: 0.012, index: 0.1, indexEnd: 0.1, a: 0.005, d: 0.09, v: rand(0.06, 0.12) });
      else tone(M, dest, { t: at, f: f * 1.3, to: f * 0.8, glide: 0.08, a: 0.01, d: 0.08, v: rand(0.06, 0.12) });
    }
  }

  /** Lowpass "distance" filter + panner feeding a loop's output. */
  function distance(M, out, f, pan) {
    const lp = M.filter('lowpass', f, 0.7), p = M.panner(pan);
    lp.connect(p); p.connect(out);
    return lp;
  }

  const LOOPS = {
    ball_roll(M, out) {
      const t = M.now;
      const rumble = M.noiseSrc('brown', t, null), lp = M.filter('lowpass', 220, 0.9), rg = M.gain(0.4);
      rumble.connect(lp); lp.connect(rg); rg.connect(out);
      const hum = M.osc('sine', 55), am = M.gain(0.5), lfo = M.osc('sine', 3), lfoG = M.gain(0.35), hg = M.gain(0.18);
      lfo.connect(lfoG); lfoG.connect(am.gain); hum.connect(hg); hg.connect(am); am.connect(out);
      const mid = M.noiseSrc('pink', t, null), bp = M.filter('bandpass', 700, 2.5), mg = M.gain(0.09);
      mid.connect(bp); bp.connect(mg); mg.connect(out);
      hum.start(t); lfo.start(t);
      return {
        setRate(r, at, ramp) {
          glideParam(lp.frequency, 120 + 200 * r, at, ramp);
          glideParam(hum.frequency, 38 + 30 * r, at, ramp);
          glideParam(lfo.frequency, 1 + 4 * r, at, ramp);
          glideParam(bp.frequency, 450 + 500 * r, at, ramp);
        },
        stop(at) { for (const n of [rumble, hum, lfo, mid]) n.stop(at); },
      };
    },

    crowd_ambience(M, out) {
      const t = M.now, lp = distance(M, out, 3200, 0);
      const srcs = crowdBed(M, lp, t, null, [[420, 1.2, 0.3], [950, 1.5, 0.26], [1900, 2, 0.15], [3000, 2.5, 0.06]]);
      return {
        event(at) {
          const r = Math.random();
          if (r < 0.5) distantVoice(M, lp, at, rand(0.02, 0.04));
          else clapRun(M, lp, at, rand(0.08, 0.16));
          return rand(1.2, 3.5);
        },
        stop(at) { srcs.forEach(s => s.stop(at)); },
      };
    },

    stadium_ambience(M, out) {
      const t = M.now, lp = distance(M, out, 2600, 0);
      const srcs = crowdBed(M, lp, t, null, [[380, 1, 0.34], [800, 1.3, 0.3], [1500, 1.6, 0.2], [2600, 2, 0.1], [3600, 2.5, 0.05]], 2);
      return {
        event(at) {
          const r = Math.random();
          if (r < 0.45) distantVoice(M, lp, at, rand(0.02, 0.035));
          else if (r < 0.85) clapRun(M, lp, at, rand(0.06, 0.12));
          else tone(M, lp, { t: at, f: 2100, to: 2900, glide: 0.2, a: 0.03, d: 0.3, v: 0.03 });
          return rand(0.8, 2.6);
        },
        stop(at) { srcs.forEach(s => s.stop(at)); },
      };
    },

    park_ambience(M, out) {
      const t = M.now;
      const air = M.noiseSrc('pink', t, null), lp = M.filter('lowpass', 600, 0.5), ag = M.gain(0.15);
      const mod = M.lfoNoise(t, 0.35, null), md = M.gain(250), gm = M.lfoNoise(t, 0.25, null), gmd = M.gain(0.12);
      mod.connect(md); md.connect(lp.frequency); gm.connect(gmd); gmd.connect(ag.gain);
      air.connect(lp); lp.connect(ag); ag.connect(out);
      return {
        event(at) {
          birdCall(M, distance(M, out, 9000, rand(-0.8, 0.8)), at);
          return rand(0.9, 3.2);
        },
        stop(at) { for (const n of [air, mod, gm]) n.stop(at); },
      };
    },

    wind(M, out) {
      const t = M.now;
      const src = M.noiseSrc('pink', t, null), bp = M.filter('bandpass', 500, 0.8), g = M.gain(0.4);
      const wander = M.lfoNoise(t, 0.4, null), wd = M.gain(260), gust = M.lfoNoise(t, 0.3, null), gd = M.gain(0.35);
      wander.connect(wd); wd.connect(bp.frequency); gust.connect(gd); gd.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(out);
      const hiss = M.noiseSrc('white', t, null), wbp = M.filter('bandpass', 1500, 12), wg = M.gain(0.12);
      const ww = M.lfoNoise(t, 0.5, null), wwd = M.gain(380);
      ww.connect(wwd); wwd.connect(wbp.frequency);
      hiss.connect(wbp); wbp.connect(wg); wg.connect(out);
      return {
        setRate(r, at, ramp) {
          glideParam(bp.frequency, 500 * r, at, ramp);
          glideParam(wbp.frequency, 1500 * r, at, ramp);
        },
        stop(at) { for (const n of [src, wander, gust, hiss, ww]) n.stop(at); },
      };
    },

    alley_ambience(M, out) {
      const t = M.now, lp = distance(M, out, 1800, 0);
      const srcs = crowdBed(M, lp, t, null, [[380, 1.2, 0.2], [850, 1.5, 0.16], [1700, 2, 0.08]], 2.5);
      return {
        event(at) {
          const r = Math.random(), far = distance(M, out, 1600, rand(-0.9, 0.9)), g = M.gain(0.16);
          g.connect(far);
          if (r < 0.55) SFX.pins_hit.fn(M, at, { intensity: rand(0.3, 0.9), rate: 1 }, g);
          else if (r < 0.8) noise(M, g, { t: at, kind: 'brown', a: 0.6, d: 1.4, v: 0.8, type: 'lowpass', f: 200 });
          else distantVoice(M, lp, at, 0.03);
          return rand(2.5, 6);
        },
        stop(at) { srcs.forEach(s => s.stop(at)); },
      };
    },
  };

  /** A running loop: output gain → loop gate, its implementation, and its event clock. */
  class LoopVoice {
    constructor(M, name, vol, rate) {
      this.M = M;
      this.out = M.gain(0);
      this.out.connect(M.loopGate);
      this.impl = LOOPS[name](M, this.out);
      this.done = false;
      this.endAt = Infinity;
      this.nextEvent = M.now + rand(0.4, 1.5);
      this.setRate(rate, 0);
      glideParam(this.out.gain, vol, M.now, 0.4);
    }
    tick(until) {
      if (!this.impl.event || this.done) return;
      while (this.nextEvent < until) this.nextEvent += this.impl.event(this.nextEvent);
    }
    setVolume(v, ramp) { if (!this.done) glideParam(this.out.gain, Math.max(0, v), this.M.now, ramp); }
    setRate(r, ramp) { if (!this.done && this.impl.setRate) this.impl.setRate(Math.max(0.05, r), this.M.now, ramp); }
    stop(fade) {
      if (this.done) return;
      this.done = true;
      const t = this.M.now, f = Math.max(0.02, fade);
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, f / 4);
      this.endAt = t + f + 0.05;
      this.impl.stop(this.endAt);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Music: track data. Lead lines are 8th notes unless leadRes: 16; '-' holds, '.' rests, '|' bars.
  // Bass/comp/arp patterns are 16 steps per bar of chord degrees (1 3 5 6 7 8 9 10 12) or 'x'.
  // Drum lanes are 16-char strings: x hit, X accent, g ghost.
  // ---------------------------------------------------------------------------------------------

  const TITLE_A = 'E5 - G5 - C6 - G5 E5 | D5 - G5 - B5 - A5 G5 | C5 - E5 - A5 - G5 E5 | F5 - E5 - D5 - . . | ' +
                  'E5 - G5 - C6 - D6 E6 | D6 - B5 - G5 - A5 B5';
  const TENNIS_A = 'F#5 - A5 - F#5 E5 D5 - | E5 - - C#5 A4 - . . | D5 - F#5 - B5 - A5 F#5 | G5 - - - F#5 - E5 - | ' +
                   'F#5 - A5 - D6 - C#6 B5 | A5 - - E5 C#5 - E5 -';

  const TRACKS = {
    title: {
      bpm: 124, swing16: 0.1, lead: 'marimba', dbl: { inst: 'bell', oct: 0 }, comp: 'pluck', bass: 'bass',
      compPat: '. . x . . . x . . . x . . . x .', bassPat: '1 - - 1 - - 5 - 1 - - 1 - - 5 -', pad: 'pad',
      mix: { lead: 0.62, dbl: 0.2, comp: 0.3, bass: 0.5, drums: 0.55, pad: 0.5 }, fill: 'snare',
      drums: {
        main: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.', shaker: '.g.g.g.g.g.g.g.g' },
        bridge: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.' },
      },
      sections: {
        A: { chords: 'C | G | Am | F | C | G | F G | C', lead: TITLE_A + ' | C6 - A5 - B5 - G5 - | C6 - - - . . G5 F5' },
        A2: { chords: 'C | G | Am | F | C | G | F G | C', lead: TITLE_A + ' | A5 - C6 - D6 - B5 - | C6 - G5 E5 C5 - . .', dbl: true },
        B: {
          chords: 'F | G | Em | Am | F | G | Am | G7', drums: 'bridge',
          lead: 'A5 - - G5 F5 - A5 - | G5 - - F5 E5 - D5 - | E5 - G5 - B5 - - - | A5 - - - . . G5 A5 | ' +
                'C6 - - A5 F5 - A5 - | B5 - - G5 D5 - G5 - | C6 - B5 - A5 - E5 - | D5 - F5 - G5 - B5 -',
        },
      },
      form: ['A', 'A2', 'B', 'A2'],
    },

    menu: {
      bpm: 100, swing16: 0.1, lead: 'marimba', dbl: { inst: 'bell', oct: 0 }, comp: 'epiano', bass: 'bass',
      compPat: 'x - . x - . x - . . x - x - . .', bassPat: '1 - - . . . 5 - 1 - - . . . 5 -', pad: 'pad',
      mix: { lead: 0.55, dbl: 0.18, comp: 0.28, bass: 0.48, drums: 0.5, pad: 0.4 },
      drums: { main: { kick: 'g.......g.......', rim: 'x..x..x...x.x...', shaker: 'xggxggxgxggxggxg' } },
      sections: {
        A: {
          chords: 'Fmaj7 | Em7 A7 | Dm7 | Cm7 F7 | Bbmaj7 | Bbm6 | Am7 D7 | Gm7 C7',
          lead: '. . A4 - C5 - E5 - | D5 - - C5 C#5 - E5 - | F5 - - - E5 - D5 - | C5 - - Bb4 A4 - C5 - | ' +
                'D5 - F5 - A5 - - - | G5 - F5 - Db5 - - - | C5 - - E5 - - F#5 - | G5 - - - . . . .',
        },
        B: {
          chords: 'Bbmaj7 | C7 | Am7 | Dm7 | Gm7 | C7 | Fmaj7 | Gm7 C7', dbl: true,
          lead: 'F5 - E5 - D5 - C5 - | E5 - - - G5 - - - | E5 - - C5 A4 - C5 - | F5 - - - . . A5 - | ' +
                'Bb5 - A5 - G5 - F5 - | E5 - - - G5 - - E5 | F5 - - - . . . . | . . . . . . . .',
        },
      },
      form: ['A', 'A', 'B', 'A'],
    },

    editor: {
      bpm: 112, swing16: 0.14, lead: 'pizz', dbl: { inst: 'bell', oct: 12 }, arp: 'marimba', arpLo: 60, bass: 'bass',
      arpPat: '1 . 3 . 5 . 3 . 1 . 3 . 5 . 8 .', bassPat: '1 . . . 5 . . . 1 . . . 5 . . .', pad: 'pad',
      mix: { lead: 0.7, dbl: 0.1, arp: 0.2, bass: 0.48, drums: 0.5, pad: 0.4 },
      drums: { main: { kick: 'x.......x.......', clap: '....x.......x...', shaker: 'x.g.x.g.x.g.x.g.' } },
      sections: {
        A: {
          chords: 'G | Em | C | D | G | Em | Am D | G', dbl: true,
          lead: 'D5 . D5 B4 G4 . B4 D5 | E5 . E5 . G5 . . . | E5 . E5 C5 G4 . C5 E5 | F#5 . E5 . D5 . . . | ' +
                'D5 . D5 B4 G4 . B4 D5 | G5 . F#5 . E5 . B4 . | C5 . E5 . D5 . F#5 . | G5 . . . . . . .',
        },
        B: {
          chords: 'C | D | Bm | Em | C | D | Am7 | D7', leadInst: 'bell', arp: false,
          lead: 'E5 - - G5 - - E5 - | F#5 - - A5 - - F#5 - | D5 - - F#5 - - B5 - | G5 - - - E5 - - - | ' +
                'E5 - G5 - C6 - B5 - | A5 - F#5 - D5 - - - | C5 - E5 - A5 - G5 - | F#5 - - - D5 - - -',
        },
      },
      form: ['A', 'A', 'B', 'A'],
    },

    bowling: {
      bpm: 112, swing8: 0.3, lead: 'vibes', comp: 'epiano', bass: 'bass', trem: [5.5, 0.25],
      compPat: '. . . . x - . . . . . . x - . .', bassPat: '1 - - - 3 - - - 5 - - - 6 - - -',
      mix: { lead: 0.6, comp: 0.3, bass: 0.55, drums: 0.55 }, fill: 'brush',
      drums: { main: { kick: 'g.......g.......', brush: '....x.......x...', ride: 'x...x.x.x...x.x.' } },
      sections: {
        A: {
          chords: 'Bb | Gm | Cm F7 | Bb | Bb7 | Eb | C7 F7 | Bb',
          lead: 'F5 . F5 G5 - F5 D5 . | Bb4 - D5 - - . . . | Eb5 . Eb5 F5 - Eb5 C5 . | D5 - - - . . . . | ' +
                'F5 . F5 G5 - F5 Ab5 . | G5 - - Eb5 - . Bb4 . | C5 - E5 - Eb5 - C5 - | Bb4 - - - . . . .',
        },
        B: {
          chords: 'Eb | Eb | Bb | G7 | C7 | C7 | F7 | F7',
          lead: 'G5 - Bb5 - G5 - Eb5 - | F5 - Eb5 - C5 - Bb4 - | D5 - F5 - Bb5 - - - | B4 - D5 - F5 - G5 - | ' +
                'E5 - G5 - Bb5 - G5 - | E5 - C5 - - - . . | A4 - C5 - Eb5 - F5 - | A5 - - - G5 - F5 -',
        },
      },
      form: ['A', 'A', 'B', 'A'],
    },

    tennis: {
      bpm: 128, swing16: 0.05, lead: 'square', comp: 'pluck', arp: 'pluck', arpLo: 62, bass: 'bass',
      compPat: '. . x . . . x . . . x . . . x .', arpPat: '1 5 8 5 1 5 8 5 1 5 8 5 1 5 8 5',
      bassPat: '1 - 8 - 1 - 8 - 1 - 8 - 5 - 8 -', pad: 'pad',
      mix: { lead: 0.58, comp: 0.24, arp: 0.1, bass: 0.48, drums: 0.55, pad: 0.4 }, fill: 'snare',
      drums: { main: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.' } },
      sections: {
        A: { chords: 'D | A | Bm | G | D | A | G | A', lead: TENNIS_A + ' | D5 - G5 - B5 - A5 G5 | A5 - - - . . . .', arp: false },
        A2: { chords: 'D | A | Bm | G | D | A | G A | D', lead: TENNIS_A + ' | B5 - - A5 G5 - C#6 - | D6 - - - . . . .' },
        B: {
          chords: 'Bm | G | D | A | Bm | G | Em | A7',
          lead: 'B5 - - A5 F#5 - - D5 | G5 - - F#5 E5 - - D5 | F#5 - - E5 D5 - - A4 | C#5 - - - E5 - - - | ' +
                'B5 - - A5 F#5 - - D5 | G5 - - B5 D6 - - B5 | G5 - - E5 B4 - E5 - | A5 - G5 - E5 - C#5 -',
        },
      },
      form: ['A', 'A2', 'B', 'A2'],
    },

    baseball: {
      bpm: 136, swing8: 0.22, lead: 'organ', comp: 'organ', compLo: 60, bass: 'bass',
      compPat: '. . x . . . x . . . x . . . x .', bassPat: '1 - - . 3 - - . 5 - - . 6 - - .',
      mix: { lead: 0.6, comp: 0.2, bass: 0.55, drums: 0.55 }, fill: 'snare', trem: [6.5, 0.12],
      drums: { main: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
      sections: {
        A: {
          chords: 'G | G | C | G | G | E7 | A7 D7 | G',
          lead: 'G4 . B4 D5 G5 - - . | F#5 . G5 . A5 . G5 . | E5 - C5 - E5 - G5 - | D5 - - - . . . . | ' +
                'G4 . B4 D5 G5 - - . | G#5 . A5 . B5 . G#5 . | A5 - E5 - F#5 - C5 - | B4 - - - G4 . . .',
        },
        B: {
          chords: 'C | C | G | G | A7 | A7 | D | D7',
          lead: 'E5 - G5 - C6 - G5 - | A5 - G5 - E5 - C5 - | D5 - G5 - B5 - G5 - | D5 - - - . . . . | ' +
                'C#5 - E5 - G5 - A5 - | G5 - E5 - C#5 - A4 - | D5 - F#5 - A5 - D6 - | C6 - - - A5 - F#5 -',
        },
      },
      form: ['A', 'A', 'B', 'A'],
    },

    golf: {
      bpm: 92, swing16: 0.12, lead: 'flute', arp: 'marimba', arpLo: 53, bass: 'bass',
      arpPat: '1 . 5 . 8 . 10 . 12 . 10 . 8 . 5 .', bassPat: '1 - - - . . . . 5 - - - . . . .', pad: 'pad',
      mix: { lead: 0.5, arp: 0.24, bass: 0.45, drums: 0.45, pad: 0.5 },
      drums: { main: { kick: 'g.......g.......', block: '....x.......x...', shaker: 'x.g.x.g.x.g.x.g.' } },
      sections: {
        A: {
          chords: 'F | C/E | Dm | Bb | F | C | Bb C | F',
          lead: 'C5 - - - A4 - C5 - | G5 - - - E5 - - - | F5 - - E5 D5 - A4 - | D5 - - - - - . . | ' +
                'C5 - - - F5 - A5 - | G5 - - - E5 - C5 - | D5 - F5 - E5 - G5 - | F5 - - - - - . .',
        },
        B: {
          chords: 'Dm | Am | Bb | F | Gm | Am | Bb | C7',
          lead: 'A5 - - - F5 - D5 - | E5 - - - C5 - A4 - | D5 - - F5 - - Bb5 - | A5 - - - - - . . | ' +
                'Bb5 - - - G5 - D5 - | C5 - - - E5 - A5 - | F5 - - D5 - - Bb4 - | C5 - - - E5 - G5 -',
        },
      },
      form: ['A', 'B', 'A'],
    },

    results: {
      bpm: 108, swing16: 0.1, lead: 'marimba', dbl: { inst: 'bell', oct: 0 }, comp: 'epiano', bass: 'bass',
      compPat: 'x - - . . . x - . . x - . . . .', bassPat: '1 - - - - - 5 - 8 - - - 5 - - -', pad: 'pad',
      mix: { lead: 0.6, dbl: 0.22, comp: 0.26, bass: 0.48, drums: 0.5, pad: 0.45 }, fill: 'snare',
      drums: { main: { kick: 'x.......x.......', clap: '....x.......x...', shaker: '.g.g.g.g.g.g.g.g' } },
      sections: {
        A: {
          chords: 'A | F#m | D | E | A | F#m | Bm7 E7 | A',
          lead: 'E5 - - C#5 E5 - A5 - | A5 - G#5 - F#5 - C#5 - | D5 - F#5 - A5 - F#5 - | G#5 - - - B5 - - - | ' +
                'C#6 - - B5 A5 - E5 - | F#5 - A5 - C#6 - B5 A5 | B5 - A5 - G#5 - E5 - | A5 - - - . . . .',
        },
        B: {
          chords: 'D | E | C#m | F#m | Bm | E | D E | A', dbl: true,
          lead: 'F#5 - A5 - D6 - - - | E5 - G#5 - B5 - - - | C#6 - B5 - G#5 - E5 - | F#5 - - - . . E5 F#5 | ' +
                'D5 - F#5 - B5 - A5 - | G#5 - E5 - B4 - E5 - | F#5 - A5 - G#5 - B5 - | A5 - - - . . . .',
        },
      },
      form: ['A', 'B'],
    },
  };

  // ---- Track compiler: data → per-bar, per-step event lists (cached, context-free) -------------

  const CHORD_TYPES = {
    '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
    m6: [0, 3, 7, 9], 6: [0, 4, 7, 9], sus4: [0, 5, 7], dim: [0, 3, 6],
  };
  const pitchClass = name => (NOTE_PC[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12) % 12;

  function parseChord(sym) {
    const m = /^([A-G][#b]?)(maj7|m7|m6|m|7|6|sus4|dim)?(?:\/([A-G][#b]?))?$/.exec(sym);
    if (!m) throw new Error(`audio: bad chord "${sym}"`);
    return { root: pitchClass(m[1]), iv: CHORD_TYPES[m[2] || ''], bass: m[3] ? pitchClass(m[3]) : null };
  }

  function degreeSemis(ch, tok) {
    const map = { 1: 0, 2: 2, 3: ch.iv[1], 4: 5, 5: ch.iv[2], 6: 9, 7: ch.iv[3] ?? 10, 8: 12, 9: 14, 10: 12 + ch.iv[1], 12: 12 + ch.iv[2] };
    if (!(tok in map)) throw new Error(`audio: bad degree "${tok}"`);
    return map[tok];
  }

  /** Lowest midi note ≥ lo with the given pitch class. */
  const placeAbove = (pc, lo) => lo + ((pc - lo) % 12 + 12) % 12;

  const DRUM_VEL = { x: 1, X: 1.25, g: 0.45 };
  const songCache = new Map();

  function compileTrack(id) {
    if (songCache.has(id)) return songCache.get(id);
    const def = TRACKS[id];
    const stepDur = 60 / def.bpm / 4;
    const bars = [];
    const leadRes = def.leadRes || 8, spt = 16 / leadRes;
    const ev = (layer, inst, midi, len, v) => ({ layer, inst, f: midi == null ? 0 : mtof(midi), dur: len * stepDur, v });
    const bar16 = (what, pat) => {
      const r = lineEvents(pat, 1);
      if (r.steps !== 16) throw new Error(`audio: ${id} ${what} pattern must be 16 steps`);
      return r.events;
    };
    const bassPat = def.bass ? bar16('bass', def.bassPat) : [];
    const compPat = def.comp ? bar16('comp', def.compPat) : [];
    const arpPat = def.arp ? bar16('arp', def.arpPat) : [];
    for (const kit of Object.values(def.drums)) {
      for (const lane of Object.keys(kit)) if (kit[lane].length !== 16) throw new Error(`audio: ${id} drum lane ${lane} must be 16 steps`);
    }

    def.form.forEach((secId, formIndex) => {
      const sec = def.sections[secId];
      const chordBars = sec.chords.split('|').map(b => b.trim().split(/\s+/).map(parseChord));
      const base = bars.length, nBars = chordBars.length;
      for (let b = 0; b < nBars; b++) bars.push(Array.from({ length: 16 }, () => []));
      const push = (abs, e) => bars[base + Math.floor(abs / 16)][abs % 16].push(e);
      const chordAt = abs => { const cb = chordBars[Math.floor(abs / 16)]; return cb[Math.floor((abs % 16) * cb.length / 16)]; };

      const lead = lineEvents(sec.lead, spt);
      if (lead.steps !== nBars * 16) throw new Error(`audio: ${id}.${secId} lead is ${lead.steps / 16} bars, chords ${nBars}`);
      for (const n of lead.events) {
        const midi = noteMidi(n.tok), v = n.step % 8 === 0 ? 1 : n.step % 4 === 0 ? 0.9 : 0.8;
        push(n.step, ev('lead', sec.leadInst || def.lead, midi, n.len, v));
        if (sec.dbl && def.dbl) push(n.step, ev('dbl', def.dbl.inst, midi + def.dbl.oct, n.len, v));
      }

      const kit = def.drums[sec.drums || 'main'];
      const lastBarOfForm = formIndex === def.form.length - 1;
      for (let b = 0; b < nBars; b++) {
        const b0 = b * 16;
        if (def.bass) {
          for (const p of bassPat) {
            const ch = chordAt(b0 + p.step);
            const root = placeAbove(ch.root, 40);
            const midi = p.tok === '1' && ch.bass != null ? placeAbove(ch.bass, 40) : root + degreeSemis(ch, p.tok);
            push(b0 + p.step, ev('bass', def.bass, midi, p.len, p.step % 4 === 0 ? 1 : 0.82));
          }
        }
        if (def.comp) {
          for (const p of compPat) {
            const ch = chordAt(b0 + p.step), lo = def.compLo || 55;
            for (const iv of ch.iv) push(b0 + p.step, ev('comp', def.comp, placeAbove((ch.root + iv) % 12, lo), p.len, 0.8));
          }
        }
        if (def.pad) {
          const cb = chordBars[b], segLen = 16 / cb.length;
          cb.forEach((ch, k) => {
            for (const iv of ch.iv.slice(0, 3)) push(b0 + k * segLen, ev('pad', def.pad, placeAbove((ch.root + iv) % 12, 55), segLen, 1));
          });
        }
        if (def.arp && sec.arp !== false) {
          for (const p of arpPat) {
            const ch = chordAt(b0 + p.step);
            push(b0 + p.step, ev('arp', def.arp, placeAbove(ch.root, def.arpLo) + degreeSemis(ch, p.tok), p.len, 0.8));
          }
        }
        for (const lane of Object.keys(kit)) {
          for (let s = 0; s < 16; s++) {
            const c = kit[lane][s];
            if (DRUM_VEL[c]) push(b0 + s, ev('drums', lane, null, 1, DRUM_VEL[c]));
          }
        }
        if (def.fill && lastBarOfForm && b === nBars - 1) {
          [0.35, 0.45, 0.58, 0.75].forEach((v, k) => push(b0 + 12 + k, ev('drums', def.fill, null, 1, v)));
        }
      }
    });
    const song = { bars, stepDur };
    songCache.set(id, song);
    return song;
  }

  // ---- Sequencer --------------------------------------------------------------------------------

  class Sequencer {
    constructor(M, id) {
      this.M = M;
      this.id = id;
      this.def = TRACKS[id];
      this.song = compileTrack(id);
      this.stepDur = this.song.stepDur;
      this.bus = M.gain(0);
      this.bus.connect(M.musicIn);
      this.layers = {};
      for (const [k, v] of Object.entries(this.def.mix)) {
        const g = M.gain(v);
        g.connect(this.bus);
        this.layers[k] = g;
      }
      this.lfo = null;
      if (this.def.trem) {
        this.lfo = M.osc('sine', this.def.trem[0]);
        const depth = M.gain(this.def.mix.lead * this.def.trem[1]);
        this.lfo.connect(depth); depth.connect(this.layers.lead.gain);
        this.lfo.start(M.now);
      }
      this.step = 0;
      this.next = 0;
      this.endAt = Infinity;
    }

    start(t, fade) {
      this.next = t;
      const g = this.bus.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(1, t + Math.max(0.01, fade));
    }

    swing(s) {
      let o = 0;
      if (this.def.swing16 && s % 2 === 1) o += this.def.swing16 * this.stepDur;
      if (this.def.swing8 && s % 4 === 2) o += this.def.swing8 * 2 * this.stepDur;
      return o;
    }

    /** Schedules every step that starts before `until`; skips ahead if the clock outran us. */
    schedule(until) {
      const now = this.M.now;
      if (this.next < now - 0.05) {
        const skip = Math.ceil((now - this.next) / this.stepDur);
        this.step += skip;
        this.next += skip * this.stepDur;
      }
      const limit = Math.min(until, this.endAt);
      const bars = this.song.bars;
      while (this.next < limit) {
        const bar = bars[Math.floor(this.step / 16) % bars.length], s = this.step % 16;
        const t = this.next + this.swing(s);
        for (const e of bar[s]) {
          const dest = this.layers[e.layer];
          if (e.layer === 'drums') DRUM[e.inst](this.M, dest, t, e.v);
          else INST[e.inst](this.M, dest, t, e.f, e.dur, e.v);
        }
        this.step++;
        this.next += this.stepDur;
      }
    }

    fadeOut(t, fade) {
      const g = this.bus.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
      this.endAt = t + Math.max(0.02, fade) + 0.05;
    }

    finish() {
      if (this.lfo) this.lfo.stop();
      this.bus.disconnect();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Runtime: lazy live context, unlock, scheduling clock, volumes, duck, pause/hide
  // ---------------------------------------------------------------------------------------------

  const savedSettings = SS.save && SS.save.settings;
  const vols = {
    music: savedSettings ? Number(savedSettings.music) : 0.6,
    sfx: savedSettings ? Number(savedSettings.sfx) : 0.9,
  };
  const muted = /[?&]mute=1(&|$)/.test(window.location.search);

  let live = null;               // Mixer on the live AudioContext
  let timer = 0;
  let paused = false;            // engine pause: loops gated, music muffled
  let wantTrack = null;
  let current = null;            // active Sequencer
  const seqs = new Set();        // active + fading sequencers
  const loopHandles = new Set(); // all non-stopped loop handles (pending or live)
  const fadingLoops = new Set();
  const recent = new Map();      // sfx name → { t, n } repeat throttle
  let voiceEnds = [];
  let duckUntil = 0, duckLevel = 1;

  const running = () => !!live && live.ctx.state === 'running';

  function createContext() {
    let ctx;
    try { ctx = new AudioCtx({ latencyHint: 'interactive' }); } catch (err) { ctx = new AudioCtx(); }
    live = new Mixer(ctx, vols, true);
    if (muted) live.master.gain.value = 0;
    ctx.onstatechange = onStateChange;
    if (paused) applyPause(true);
  }

  /** Plays one silent sample: iOS only starts output after a source plays inside a gesture. */
  function warmUp() {
    const ctx = live.ctx, s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start(0);
  }

  /** False only when the browser reports the page has had no user gesture yet (avoids autoplay warnings). */
  const hasActivation = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;

  function unlock() {
    if (!AudioCtx || !hasActivation()) return;
    if (!live) createContext();
    if (live.ctx.state === 'running') return;
    warmUp();
    if (document.hidden) return;
    const p = live.ctx.resume();
    if (p && p.then) p.then(onStateChange, () => {});
  }

  function tryResume() {
    if (!live || document.hidden || live.ctx.state === 'running' || live.ctx.state === 'closed') return;
    const p = live.ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }

  function onStateChange() {
    if (!running()) return;
    applyMusic(0.8);
    for (const h of loopHandles) h.attach();
    ensureTimer();
  }

  // Unlock on any gesture (iOS needs touchend/pointerup; also recovers the 'interrupted' state).
  for (const evt of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click']) {
    window.addEventListener(evt, () => { if (!running()) unlock(); }, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!live) return;
    if (document.hidden) { if (live.ctx.state === 'running') live.ctx.suspend(); } else tryResume();
  });
  window.addEventListener('pageshow', tryResume);
  window.addEventListener('focus', tryResume);

  function ensureTimer() {
    if (!timer && (seqs.size || loopHandles.size || fadingLoops.size)) timer = setInterval(tick, TICK_MS);
  }

  function tick() {
    if (!running()) return;
    const now = live.now, until = now + LOOKAHEAD;
    for (const s of seqs) {
      if (now > s.endAt) { s.finish(); seqs.delete(s); } else s.schedule(until);
    }
    for (const h of loopHandles) if (h.voice) h.voice.tick(until);
    for (const v of fadingLoops) if (now > v.endAt) { v.out.disconnect(); fadingLoops.delete(v); }
    if (!seqs.size && !loopHandles.size && !fadingLoops.size) { clearInterval(timer); timer = 0; }
  }

  // ---- SFX --------------------------------------------------------------------------------------

  /** Renders a sfx recipe into M at time t; shared by the live path and _analyze. */
  function renderSfx(M, name, t, o) {
    const d = SFX[name];
    const opts = { rate: o.rate > 0 ? o.rate : 1, intensity: clamp(o.intensity ?? 1, 0, 1) };
    const out = M.gain(Math.max(0, o.vol ?? 1));
    let tail = out;
    if (o.pan) { tail = M.panner(o.pan); out.connect(tail); }
    tail.connect(M.sfxIn);
    if (d.wet > 0) { const w = M.gain(d.wet); tail.connect(w); w.connect(M.sfxSend); }
    return d.fn(M, t, opts, out);
  }

  function sfx(name, o = {}) {
    if (!SFX[name]) { warnOnce('sfx', name); return; }
    if (!running() || muted) return;
    const now = live.now;
    const last = recent.get(name);
    if (last && now - last.t < REPEAT_WINDOW) {
      if (last.n >= SFX[name].max) return;
      last.n++;
    } else recent.set(name, { t: now, n: 1 });
    voiceEnds = voiceEnds.filter(e => e > now);
    if (voiceEnds.length >= MAX_VOICES) return;
    voiceEnds.push(renderSfx(live, name, now + 0.005 + Math.max(0, o.delay || 0), o));
  }

  // ---- Loops ------------------------------------------------------------------------------------

  /** Public loop handle. Before unlock it just remembers its settings and starts once audio runs. */
  class LoopHandle {
    constructor(name, vol, rate) {
      this.name = name; this.vol = vol; this.rate = rate;
      this.voice = null;
      loopHandles.add(this);
      this.attach();
    }
    attach() {
      if (this.voice || !live || muted) return;
      this.voice = new LoopVoice(live, this.name, this.vol, this.rate);
      ensureTimer();
    }
    setVolume(v, rampSec = 0.1) { this.vol = Math.max(0, v); if (this.voice) this.voice.setVolume(this.vol, rampSec); }
    setRate(r, rampSec = 0.1) { this.rate = r; if (this.voice) this.voice.setRate(r, rampSec); }
    stop(fadeSec = 0.2) {
      if (!loopHandles.delete(this)) return;
      if (this.voice) { this.voice.stop(fadeSec); fadingLoops.add(this.voice); ensureTimer(); }
    }
  }

  const NULL_LOOP = { setVolume() {}, setRate() {}, stop() {} };

  function loop(name, o = {}) {
    if (!LOOPS[name]) { warnOnce('loop', name); return NULL_LOOP; }
    return new LoopHandle(name, Math.max(0, o.vol ?? 1), o.rate ?? 1);
  }

  // ---- Music ------------------------------------------------------------------------------------

  function applyMusic(fade) {
    if (!live || (current && current.id === wantTrack) || (!current && !wantTrack)) return;
    const t = live.now;
    if (current) { current.fadeOut(t, fade); current = null; }
    if (wantTrack && !muted) {
      current = new Sequencer(live, wantTrack);
      current.start(t + 0.05, fade);
      seqs.add(current);
      ensureTimer();
    }
  }

  function music(id, o = {}) {
    if (id != null && !TRACKS[id]) { warnOnce('music', id); return; }
    const next = id == null ? null : id;
    if (next === wantTrack) return;
    wantTrack = next;
    applyMusic(o.fade ?? 0.8);
  }

  // ---- Mix controls -------------------------------------------------------------------------------

  function duck(amount = 0.5, seconds = 1.5) {
    if (!live) return;
    const t = live.now, p = live.musicDuck.gain;
    const level = clamp(1 - amount, 0, 1);
    duckLevel = t < duckUntil ? Math.min(duckLevel, level) : level;
    duckUntil = Math.max(duckUntil, t + seconds);
    p.cancelScheduledValues(t);
    p.setTargetAtTime(duckLevel, t, 0.04);
    p.setTargetAtTime(1, duckUntil, 0.25);
  }

  function setVolumes(o = {}) {
    if (o.music != null && isFinite(o.music)) vols.music = clamp(Number(o.music), 0, 1);
    if (o.sfx != null && isFinite(o.sfx)) vols.sfx = clamp(Number(o.sfx), 0, 1);
    if (live) live.setVolumes(vols.music, vols.sfx, 0.08);
  }

  function applyPause(on) {
    const t = live.now;
    glideParam(live.loopGate.gain, on ? 0 : 1, t, 0.15);
    glideParam(live.musicPause.gain, on ? 0.55 : 1, t, 0.3);
    glideParam(live.musicMuffle.frequency, on ? 900 : 20000, t, 0.3);
  }

  function suspend() {
    paused = true;
    if (!live) return;
    applyPause(true);
    if (document.hidden && live.ctx.state === 'running') live.ctx.suspend();
  }

  function resumeAll() {
    paused = false;
    if (!live) return;
    applyPause(false);
    tryResume();
  }

  if (SS.save && SS.save.events) {
    SS.save.events.on('setting', (key, value) => { if (key === 'music' || key === 'sfx') setVolumes({ [key]: value }); });
  }

  // ---------------------------------------------------------------------------------------------
  // Offline analysis (headless verification)
  // ---------------------------------------------------------------------------------------------

  /**
   * Renders a sfx name, 'music:<track>' or 'loop:<name>' offline with the same synthesis code.
   * Resolves { peak, rms (over the audible part), duration (s until it falls below -60 dB),
   *            scheduleMs (main-thread time spent building the graph), buffer (the AudioBuffer) }.
   */
  async function analyze(name, o = {}, seconds) {
    if (!OfflineCtx) throw new Error('audio: OfflineAudioContext unavailable');
    const kind = name.startsWith('music:') ? 'music' : name.startsWith('loop:') ? 'loop' : 'sfx';
    const id = kind === 'sfx' ? name : name.slice(kind.length + 1);
    const table = kind === 'music' ? TRACKS : kind === 'loop' ? LOOPS : SFX;
    if (!table[id]) { warnOnce(kind, id); return { peak: 0, rms: 0, duration: 0, scheduleMs: 0 }; }
    const secs = seconds || (kind === 'music' ? 8 : kind === 'loop' ? 6 : 4);
    const ctx = new OfflineCtx(2, Math.ceil(ANALYZE_RATE * secs), ANALYZE_RATE);
    const M = new Mixer(ctx, vols);
    const t0 = performance.now();
    if (kind === 'sfx') renderSfx(M, id, 0.02, o);
    else if (kind === 'music') {
      const seq = new Sequencer(M, id);
      seq.start(0.02, 0.01);
      seq.schedule(secs);
    } else {
      const v = new LoopVoice(M, id, o.vol ?? 1, o.rate ?? 1);
      v.tick(secs);
    }
    const scheduleMs = performance.now() - t0;
    const buf = await ctx.startRendering();
    let peak = 0, last = 0;
    const chans = [buf.getChannelData(0), buf.getChannelData(1)];
    for (const d of chans) for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a > 0.001 && i > last) last = i;
    }
    let sum = 0;
    for (const d of chans) for (let i = 0; i <= last; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / Math.max(1, 2 * (last + 1)));
    return { peak, rms, duration: last / ANALYZE_RATE, scheduleMs, buffer: buf };
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  SS.audio = {
    unlock, sfx, loop, music, duck, setVolumes, suspend, resumeAll,
    names: { sfx: Object.keys(SFX), loops: Object.keys(LOOPS), music: Object.keys(TRACKS) },
    _analyze: analyze,
  };
  Object.defineProperty(SS.audio, 'ctx', { get: () => (live ? live.ctx : null), enumerable: true });
  Object.defineProperty(SS.audio, 'track', { get: () => wantTrack, enumerable: true });
})();
