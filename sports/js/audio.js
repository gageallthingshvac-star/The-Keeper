/* Sunny Sports — audio.js
 * Every sound in the game. Real CC0 recordings (js/audio-bank*.js, see audio/CREDITS.md) carry the
 * sound effects, crowds, ambience and the sampled music instruments; WebAudio synthesis is the
 * automatic fallback whenever a recording is not decoded yet (or cannot be). No network, no fetch().
 *
 *   Samples    bank access, lazy per-sport bank scripts, prioritized lazy decoding per sample rate,
 *              the sample player (variants without repeats, rate/gain jitter, filters, fades, loops).
 *   Mixer      one per AudioContext (live or offline): bus graph, master compressor + soft-clip
 *              ceiling, generated-impulse reverb send, cached noise / procedural sample buffers.
 *   Primitives tone, FM, filtered noise, formant voices, procedural knock/clap samples.
 *   Instruments sampled (marimba, glockenspiel, vibraphone, kalimba, harp, recorder, drums, timpani,
 *              cymbals) with the synthesized versions as fallback; bass/pad/square/organ/brass synth.
 *   SFX        the named one-shots of DESIGN §6.4. Synth recipe fn(M, t, o, out) -> end time, plus a
 *              recorded recipe used whenever its recordings are decoded.
 *   Loops      ambience beds (recorded loops, synth until decoded, then a crossfade to the recording).
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
  const MUSIC_WAIT_MS = 1200;    // longest a new track waits for its sampled instruments to decode
  const LOOP_WAIT_MS = 1500;     // longest a loop stays silent waiting for its recording before synthesizing

  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const volCurve = v => Math.pow(clamp(Number(v) || 0, 0, 1), 1.6);   // slider → gain (perceptual)

  const ftom = f => 69 + 12 * Math.log2(f / 440);
  const DEBUG = /[?&]debug=1(&|$)/.test(window.location.search);

  const warned = new Set();
  function warnOnce(kind, name) {
    const key = kind + ':' + name;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[audio] unknown ${kind} "${name}"`);
  }
  /** Sample-loading problems are never user-facing: synthesis covers them. Reported once with ?debug=1. */
  function debugWarnOnce(key, msg) {
    if (!DEBUG || warned.has(key)) return;
    warned.add(key);
    console.warn('[audio] ' + msg);
  }

  // ---------------------------------------------------------------------------------------------
  // Real recordings: the banks (classic scripts filling SS.audioBank.samples with base64 MP3s),
  // per-sport bank scripts loaded on demand, lazy prioritized decoding, variant groups.
  // ---------------------------------------------------------------------------------------------

  const SPORT_BANKS = ['bowling', 'tennis', 'baseball', 'golf'];
  /** Core ambience beds each sport's loops need (decoded together with that sport's bank). */
  const SPORT_BEDS = { bowling: ['amb_cafe'], tennis: ['amb_crowd'], baseball: ['amb_crowd'], golf: ['amb_forest'] };
  /** Decode priority: lower first. `track` = the instruments of the music about to start (ahead of crowds/voices). */
  const PRIO = { now: 0, ui: 1, track: 1.5, high: 2, sport: 3, normal: 4, idle: 5 };
  const DECODE_CONCURRENCY = 3;

  const bankSamples = () => (SS.audioBank && SS.audioBank.samples) || {};
  // Per-sport banks sit next to this file; inside the single-file bundle they are already inlined.
  const BANK_BASE = (() => {
    const src = document.currentScript && document.currentScript.src;
    return src ? src.slice(0, src.lastIndexOf('/') + 1) : null;
  })();

  const bankLoads = new Map();
  let bankStamp = -1;            // number of registered banks when the indexes were last built
  let groups = new Map();        // variant group (id minus a trailing _N) or id → [ids]
  let instIds = new Map();       // sampled instrument → [ids] sorted by root

  /** Resolves true once SS.audioBank.banks[name] exists (script injection, works on file:// and http). */
  function loadBank(name) {
    const banks = SS.audioBank && SS.audioBank.banks;
    if (banks && banks[name]) return Promise.resolve(true);
    if (bankLoads.has(name)) return bankLoads.get(name);
    const p = new Promise(resolve => {
      if (!BANK_BASE || !document.head) { resolve(false); return; }
      const s = document.createElement('script');
      s.src = BANK_BASE + 'audio-bank-' + name + '.js';
      s.async = true;
      s.onload = () => resolve(!!(SS.audioBank && SS.audioBank.banks && SS.audioBank.banks[name]));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    }).then(ok => {
      if (!ok) debugWarnOnce('bank:' + name, `sample bank "${name}" unavailable; using synthesis`);
      return ok;
    });
    bankLoads.set(name, p);
    return p;
  }

  function indexBank() {
    const banks = (SS.audioBank && SS.audioBank.banks) || {};
    const stamp = Object.keys(banks).length;
    if (stamp === bankStamp) return;
    bankStamp = stamp;
    groups = new Map();
    instIds = new Map();
    const S = bankSamples();
    const add = (map, key, id) => { if (!map.has(key)) map.set(key, []); map.get(key).push(id); };
    for (const id of Object.keys(S)) {
      add(groups, id, id);
      if (S[id].inst) { add(instIds, S[id].inst, id); continue; }
      const m = /^(.*)_\d+$/.exec(id);
      if (m) add(groups, m[1], id);
    }
    for (const ids of instIds.values()) ids.sort((a, b) => S[a].root - S[b].root);
  }

  /** 'inst:<name>' → that instrument's notes; 'bank:<sport>' → a sport bank; else a group or id. */
  function expand(name) {
    indexBank();
    if (name.startsWith('inst:')) return instIds.get(name.slice(5)) || [];
    if (name.startsWith('bank:')) {
      const b = SS.audioBank && SS.audioBank.banks && SS.audioBank.banks[name.slice(5)];
      return b ? b.ids : [];
    }
    return groups.get(name) || [];
  }

  function base64ToArrayBuffer(b64) {
    const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  /** decodeAudioData in both its callback (old Safari) and promise forms. */
  function decodeAudio(ctx, ab) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(ab, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  /**
   * Decoded recordings for one AudioContext sample rate (AudioBuffers are shareable between
   * contexts). Decodes lazily, highest priority first, a few at a time, never blocking anything.
   */
  class SampleStore {
    constructor(ctx) {
      this.ctx = ctx;
      this.bufs = new Map();     // id → AudioBuffer, or null when decoding failed
      this.queue = new Map();    // id → priority (not started yet)
      this.inflight = new Set();
      this.waiters = [];         // { ids, resolve }
      this.last = new Map();     // group → last id played (no immediate repeats)
      this.sustain = new Map();  // id → [loopStart, loopEnd] for held instrument notes
      this.leads = new Map();    // id → seconds of decoder lead-in to skip (MP3 decoders that ignore the gapless header)
    }

    /** Seconds of codec lead-in at the start of id's decoded buffer (0 on decoders that honour the LAME header). */
    lead(id) { return this.leads.get(id) || 0; }

    /**
     * A decoder that ignores the LAME gapless header returns the encoder delay (+ its own ~529-sample delay) as
     * leading silence and the padding at the end, so the buffer is longer than the bank's `dur`. Then skip the
     * lead-in: never more than delay + 529 samples, and never past the first audible sample.
     */
    measureLead(id, buf, s) {
      if (!s.enc || !s.sr || !s.dur) return;
      const k = buf.sampleRate / s.sr, extra = buf.length - Math.round(s.dur * buf.sampleRate);
      if (extra < 256 * k) return;
      const d = buf.getChannelData(0), max = Math.min(extra, (s.enc.delay + 529) * k, d.length);
      let i = 0;
      while (i < max && Math.abs(d[i]) < 1e-4) i++;
      if (i > 0) this.leads.set(id, i / buf.sampleRate);
    }

    has(id) { return !!this.bufs.get(id); }

    /** True when every name (group / id / inst:x) has at least one decoded recording. */
    ready(names) {
      for (const n of names) if (!expand(n).some(id => this.has(id))) return false;
      return true;
    }

    /** Asks for names to be decoded (raising the priority of anything already queued). */
    want(names, prio = PRIO.normal) {
      const S = bankSamples();
      for (const n of names) {
        for (const id of expand(n)) {
          if (this.bufs.has(id) || this.inflight.has(id) || !S[id]) continue;
          const q = this.queue.get(id);
          if (q == null || prio < q) this.queue.set(id, prio);
        }
      }
      this.pump();
    }

    /** Resolves when every recording of names is decoded or has failed. */
    settled(names) {
      const ids = names.flatMap(expand);
      if (ids.every(id => this.bufs.has(id))) return Promise.resolve();
      return new Promise(resolve => this.waiters.push({ ids, resolve }));
    }

    pump() {
      while (this.inflight.size < DECODE_CONCURRENCY && this.queue.size) {
        let best = null, bp = Infinity;
        for (const [id, p] of this.queue) if (p < bp) { best = id; bp = p; }
        this.queue.delete(best);
        this.decode(best);
      }
    }

    decode(id) {
      const s = bankSamples()[id];
      this.inflight.add(id);
      const done = buf => {
        this.inflight.delete(id);
        this.bufs.set(id, buf);
        if (!buf) debugWarnOnce('decode:' + id, `could not decode sample "${id}"; using synthesis`);
        this.waiters = this.waiters.filter(w => {
          if (!w.ids.every(x => this.bufs.has(x))) return true;
          w.resolve();
          return false;
        });
        this.pump();
      };
      let ab;
      try { ab = base64ToArrayBuffer(s.b64); } catch (err) { setTimeout(() => done(null), 0); return; }
      decodeAudio(this.ctx, ab).then(buf => {
        if (buf && buf.length) { try { this.measureLead(id, buf, s); } catch (err) { /* keep lead 0 */ } }
        done(buf && buf.length ? buf : null);
      }, () => done(null));
    }

    /**
     * One decoded id for a group/id (or an array of them: one pool), random among its variants, never the one
     * played last.
     */
    pick(name) {
      const ids = (Array.isArray(name) ? name.flatMap(expand) : expand(name)).filter(id => this.has(id));
      if (!ids.length) return null;
      if (ids.length === 1) return ids[0];
      const key = Array.isArray(name) ? name.join('|') : name, prev = this.last.get(key);
      let id;
      do id = pick(ids); while (id === prev);
      this.last.set(key, id);
      return id;
    }

    /** n decoded ids drawn from several groups, all different while there are enough. */
    pickMany(names, n) {
      const pool = names.flatMap(expand).filter(id => this.has(id));
      const out = [];
      let bag = [];
      for (let i = 0; i < n && pool.length; i++) {
        if (!bag.length) bag = pool.slice().sort(() => Math.random() - 0.5);
        out.push(bag.pop());
      }
      return out;
    }

    /** Decoded note of a sampled instrument whose root is nearest to midi. */
    nearest(inst, midi) {
      const S = bankSamples();
      let best = null, bd = Infinity;
      for (const id of expand('inst:' + inst)) {
        if (!this.has(id)) continue;
        const d = Math.abs(S[id].root - midi);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    }

    /**
     * Pitch-synchronous sustain loop for a held note: a whole number of periods between two upward
     * zero crossings inside the steady part of the recording. Cached per id; null if none found.
     */
    sustainLoop(id) {
      if (this.sustain.has(id)) return this.sustain.get(id);
      const buf = this.bufs.get(id), meta = bankSamples()[id];
      const d = buf.getChannelData(0), sr = buf.sampleRate, period = sr / mtof(meta.root);
      const up = i => { while (i < d.length - 1 && !(d[i] <= 0 && d[i + 1] > 0)) i++; return i; };
      let loop = null;
      const a = up(Math.floor(sr * 0.42));
      const target = a + Math.round(Math.round(sr * 0.7 / period) * period);
      if (target < d.length - sr * 0.25) {
        let b = up(target - Math.floor(period * 0.5));
        if (b - target > period * 0.5) b = up(target);
        loop = [a / sr, b / sr];
      }
      this.sustain.set(id, loop);
      return loop;
    }
  }

  /** Every id in the loaded banks matching a predicate. */
  const idsWhere = test => { const S = bankSamples(); return Object.keys(S).filter(id => test(S[id], id)); };

  // ---- Who played what (debug + soundboard) -------------------------------------------------

  const stats = { sample: {}, synth: {} };
  /** Records that `name` (sfx:x, loop:x, inst:x, drum:x) played as a recording or as synthesis. */
  function mark(M, name, real, ids) {
    if (M.trace) { (real ? M.trace.sample : M.trace.synth).add(name); if (ids) ids.forEach(i => M.trace.ids.add(i)); return; }
    const tab = real ? stats.sample : stats.synth;
    const first = !tab[name];
    tab[name] = (tab[name] || 0) + 1;
    if (DEBUG && first) console.log(`[audio] ${name} → ${real ? 'recording' + (ids && ids.length ? ' (' + ids.join(', ') + ')' : '') : 'synthesis'}`);
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
    /**
     * `isLive`: build the impulse and sample caches in later small tasks (keeps the unlocking tap snappy).
     * `store`: the SampleStore of decoded recordings, or null for pure synthesis.
     */
    constructor(ctx, vols, isLive = false, store = null) {
      this.ctx = ctx;
      this.sr = ctx.sampleRate;
      this.cache = new Map();
      this.store = store;
      this.live = isLive;        // the real-time context (offline analysis never waits on timers)
      this.trace = null;         // analysis only: { sample: Set, synth: Set, ids: Set }

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
  // Recording player. Routed into the same destinations as the synth voices, so the sfx/loop/music
  // buses, reverb send, compressor, ducking and pause behave exactly as before.
  // ---------------------------------------------------------------------------------------------

  /**
   * Plays one decoded recording: an id or a variant group, or an array of them as one pool (random variant,
   * never the same twice in a row). o: t, rate, gain, pan, lp, hp, q, offset | lead, dur (cut length), fade (fade-out at the cut),
   * attack, jit (± rate jitter fraction, default 0.04), gj (± gain jitter dB, default 1.5),
   * loop (use the bank's seamless loopStart/loopEnd; runs until stopped).
   * Returns { src, g, end, id } or null when nothing of `name` is decoded.
   */
  function playRec(M, dest, name, o = {}) {
    const st = M.store;
    const id = st && st.pick(name);
    if (!id) return null;
    const buf = st.bufs.get(id), meta = bankSamples()[id], skip = st.lead(id);
    const t = o.t ?? M.now;
    const rate = (o.rate || 1) * (1 + rand(-1, 1) * (o.jit ?? 0.04));
    const gain = (o.gain ?? 1) * (meta.gain ?? 1) * (TRIM[id] || 1) * Math.pow(10, rand(-1, 1) * (o.gj ?? 1.5) / 20);
    const src = M.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let node = src;
    if (o.lp) { const f = M.filter('lowpass', Math.min(o.lp, M.sr * 0.45), o.q ?? 0.7); node.connect(f); node = f; }
    if (o.hp) { const f = M.filter('highpass', o.hp, 0.7); node.connect(f); node = f; }
    const g = M.gain(gain);
    node.connect(g);
    if (o.pan) { const p = M.panner(o.pan); g.connect(p); p.connect(dest); } else g.connect(dest);
    if (M.trace) M.trace.ids.add(id);
    if (M.ids) M.ids.push(id);
    if (o.loop && meta.loop) {
      src.loop = true;
      src.loopStart = meta.loopStart + skip;
      src.loopEnd = meta.loopEnd + skip;
      src.start(t, skip + (o.offset ?? rand(meta.loopStart, meta.loopEnd - 0.05)));
      return { src, g, end: Infinity, id };
    }
    // o.lead: start this many seconds before the recording's loudest moment (swells, roars)
    const offset = skip + clamp(o.lead != null ? (meta.peakAt || 0) - o.lead : o.offset || 0, 0, Math.max(0, buf.duration - skip - 0.02));
    const natural = (buf.duration - offset) / rate;
    const len = o.dur != null ? Math.min(o.dur, natural) : natural;
    if (o.attack) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(o.attack, len)); }
    if (o.dur != null && o.dur < natural) {
      const f = Math.min(o.fade ?? 0.04, len * 0.9);
      g.gain.setValueAtTime(gain, Math.max(t + (o.attack || 0), t + len - f));
      g.gain.linearRampToValueAtTime(0, t + len);
    }
    src.start(t, offset);
    src.stop(t + len + 0.02);
    return { src, g, end: t + len, id };
  }

  /**
   * Balance fixes: variants whose bank gain is capped at 1 although they are much quieter, and sampled-instrument
   * notes whose level jumps against their neighbours (measured with 'note:<inst>:<midi>' renders).
   */
  const TRIM = {
    ui_tap_1: 2.2,
    glock_79: 0.9, glock_96: 1.11, glock_103: 0.77, kalimba_55: 1.15, kalimba_67: 0.9, kalimba_70: 1.19, kalimba_83: 1.19,
    kalimba_92: 1.14, harp_68: 1.22, harp_72: 1.17, harp_76: 1.14, recorder_74: 1.14, marimba_55: 0.91,
  };

  /** playRec returning the end time (or 0 when not played): the form the recipes use. */
  function rec(M, dest, name, o) { const p = playRec(M, dest, name, o); return p ? p.end : 0; }

  /**
   * A crowd reaction built from individual real voices: n voices from `pools` with random onset
   * offsets, playback rate 0.92–1.08 and stereo spread, through a gentle "distance" low-pass.
   */
  function voiceLayer(M, out, t, pools, n, o = {}) {
    const ids = M.store.pickMany(pools, n);
    const lp = M.filter('lowpass', o.lp ?? 5200, 0.6);
    lp.connect(out);
    let end = t;
    ids.forEach((id, i) => {
      const at = t + (i === 0 ? 0 : rand(0, o.spread ?? 0.18));
      const g = (o.gain ?? 1) * (i === 0 ? o.first ?? 1 : rand(0.55, 0.95));
      end = Math.max(end, rec(M, lp, id, { t: at, rate: rand(0.92, 1.08) * (o.rate || 1), jit: 0, gain: g, pan: rand(-0.75, 0.75) }));
    });
    return end;
  }

  /**
   * Short synthesized sub thump (attack 2 ms, ~0.15 s decay, f → 0.82 f): weight under big hits. A sine is all a
   * sub needs; the recorded "beefy thud" it replaces was a slow pulse train that peaked 100 ms after the hit.
   */
  function sub(M, out, t, v, f = 55) { return tone(M, out, { t, f, to: f * 0.82, glide: 0.15, a: 0.002, d: 0.15, v }); }

  /** A short swell of the recorded crowd bed (the room reacting), low-passed. */
  function bedSwell(M, out, t, dur, v, lp = 1400) {
    const p = playRec(M, out, 'amb_crowd', {
      t, offset: rand(0.5, 9), dur, attack: dur * 0.3, fade: dur * 0.55, gain: v, lp, gj: 0.5,
    });
    return p ? p.end : t;
  }

  // ---------------------------------------------------------------------------------------------
  // Instruments (shared by music and the fanfares). fn(M, dest, t, freq, dur, vel) -> end time.
  // SYNTH_INST are the synthesized voices; INST (below) swaps in the sampled real instruments.
  // ---------------------------------------------------------------------------------------------

  const SYNTH_INST = {
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
    pizz(M, dest, t, f, dur, v) { return SYNTH_INST.pluck(M, dest, t, f, dur, v * 1.1, 0.18); },
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

  const SYNTH_DRUM = {
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

  // ---- Sampled instruments (VCSL, CC0) ---------------------------------------------------------
  //
  // Each instrument keeps 6–9 recorded notes; a note plays the nearest root, repitched by
  // playbackRate = 2^((midi − root)/12) from the measured (fractional) root. `level` matches the
  // synthesized voice's loudness at the same velocity (calibrated offline with 'note:' renders). The bank evens
  // out the notes of an instrument (on their first 400 ms) and TRIM the rest, so neighbouring roots sit within
  // ~2 dB; an optional `tilt` [midi, dB/octave] adds a slope; `hold(dur)` is how long
  // the note rings before its release (mallets ring past the written length, the recorder stops
  // with it and loops its steady part for long notes). Velocity scales gain.

  const SAMPLED = {
    marimba: { inst: 'marimba', level: 0.4, hold: d => Math.max(d, 0.12) + 0.45, rel: 0.18 },
    bell:    { inst: 'glock', level: 0.7, hold: d => Math.max(d, 0.2) + 0.9, rel: 0.45 },
    vibes:   { inst: 'vibes', level: 0.31, hold: d => Math.max(d, 0.15) + 0.3, rel: 0.3 },
    epiano:  { inst: 'vibes', level: 0.22, hold: d => Math.max(d, 0.15) + 0.2, rel: 0.25, lp: 3200 },
    // high kalimba tines ring short (and their long tails carry the neighbouring tines), so they stop sooner
    pluck:   { inst: 'kalimba', level: 0.57, hold: d => Math.max(d, 0.1) + 0.3, rel: 0.2, lp: 6500,
               hi: { root: 70, hold: d => Math.max(d, 0.1) + 0.12, rel: 0.1 } },
    pizz:    { inst: 'harp', level: 0.21, hold: d => Math.max(d, 0.1) + 0.12, rel: 0.15 },
    flute:   { inst: 'recorder', level: 0.68, hold: d => Math.max(0.08, d * 0.92), rel: 0.09, sustain: true },
  };

  /** Plays one note on a sampled instrument; null when none of its notes is decoded yet. */
  function sampledNote(M, dest, t, f, dur, v, spec) {
    const st = M.store;
    const midi = ftom(f);
    const id = st && st.nearest(spec.inst, midi);
    if (!id) return null;
    const buf = st.bufs.get(id), meta = bankSamples()[id], skip = st.lead(id);
    const rate = Math.pow(2, (midi - meta.root) / 12);
    const tilt = spec.tilt ? Math.pow(10, spec.tilt[1] * (midi - spec.tilt[0]) / 240) : 1;   // dB per octave
    const peak = Math.max(0, v) * spec.level * (meta.gain ?? 1) * (TRIM[id] || 1) * tilt;
    const src = M.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const natural = (buf.duration - skip) / rate;
    const env = spec.hi && meta.root >= spec.hi.root ? spec.hi : spec;
    let hold = env.hold(dur);
    if (spec.sustain && hold > natural - 0.3) {
      const lp = st.sustainLoop(id);
      if (lp) { src.loop = true; src.loopStart = lp[0]; src.loopEnd = lp[1]; } else hold = Math.min(hold, natural - 0.3);
    }
    let node = src;
    if (spec.lp) { const fl = M.filter('lowpass', spec.lp, 0.6); node.connect(fl); node = fl; }
    const g = M.gain(peak);
    node.connect(g); g.connect(dest);
    let end;
    if (src.loop || hold + env.rel < natural) {
      g.gain.setValueAtTime(peak, t + hold);
      g.gain.setTargetAtTime(0, t + hold, env.rel / 4);
      end = t + hold + env.rel * 1.5;
    } else end = t + natural;
    src.start(t, skip);
    src.stop(end + 0.01);
    if (M.trace) M.trace.ids.add(id);
    return end;
  }

  function sampledInst(name) {
    const spec = SAMPLED[name], synth = SYNTH_INST[name];
    return (M, dest, t, f, dur, v) => {
      const end = sampledNote(M, dest, t, f, dur, v, spec);
      mark(M, 'inst:' + name, end != null);
      return end != null ? end : synth(M, dest, t, f, dur, v);
    };
  }

  const INST = Object.assign({}, SYNTH_INST);
  for (const name of Object.keys(SAMPLED)) INST[name] = sampledInst(name);

  /** Recorded drum hit: o.group (+ o.soft for ghost notes below velocity 0.6), o.level, o.extra layer. */
  function sampledDrum(name, o) {
    const synth = SYNTH_DRUM[name];
    return (M, dest, t, v) => {
      const group = o.soft && v < 0.6 ? o.soft : o.group;
      const end = rec(M, dest, group, { t, gain: v * o.level, jit: o.jit ?? 0.02, gj: 1, lp: o.lp, attack: o.attack });
      mark(M, 'drum:' + name, !!end);
      if (!end) return synth(M, dest, t, v);
      if (o.extra) o.extra(M, dest, t, v);
      return end;
    };
  }

  const DRUM = {
    // the concert bass drum is mostly 50–60 Hz, so it keeps the synth kick's beater click for small speakers
    kick: sampledDrum('kick', { group: 'drum_kick', level: 0.6,
      extra: (M, dest, t, v) => tone(M, dest, { t, f: 1200, to: 400, a: 0.001, d: 0.012, v: v * 0.1 }) }),
    snare: sampledDrum('snare', { group: 'drum_snare', soft: 'drum_snare_soft', level: 0.2 }),
    clap: sampledDrum('clap', { group: 'drum_clap', level: 0.3 }),
    rim: sampledDrum('rim', { group: 'drum_rim', level: 0.12 }),
    hat: sampledDrum('hat', { group: 'drum_hat', level: 0.065 }),
    ride: sampledDrum('ride', { group: 'drum_ride', level: 0.09 }),
    shaker: sampledDrum('shaker', { group: 'drum_shaker', level: 0.045 }),
    brush: sampledDrum('brush', { group: 'drum_snare_soft', level: 0.2, lp: 3800, attack: 0.012 }),
    block: sampledDrum('block', { group: 'drum_block', level: 0.14 }),
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

  /** Suspended cymbal: crash for long decays, soft hit otherwise (synth noise as fallback). */
  function cymbal(M, dest, t, v, d = 1.4) {
    const end = rec(M, dest, d >= 1.4 ? 'cymbal_crash' : 'cymbal_soft', { t, gain: v * 3.2, dur: d + 0.6, fade: 0.6, jit: 0.02, gj: 1 });
    mark(M, 'drum:cymbal', !!end);
    return end || noise(M, dest, { t, a: 0.003, d, v, type: 'highpass', f: 5200, q: 0.5 });
  }

  /** Timpani hit. Recorded roots are F2/A#2-ish, so very low fanfare notes sound an octave up. */
  function timpani(M, dest, t, f, v) {
    const midi = ftom(f) < 40 ? ftom(f) + 12 : ftom(f);
    const end = sampledNote(M, dest, t, mtof(midi), 0.6, v, { inst: 'timpani', level: 0.85, hold: () => 1.4, rel: 0.5 });
    mark(M, 'drum:timpani', end != null);
    if (end != null) return end;
    tone(M, dest, { t, f, to: f * 0.96, a: 0.004, d: 0.7, v });
    return noise(M, dest, { t, kind: 'brown', a: 0.002, d: 0.12, v: v * 0.6, type: 'lowpass', f: 400 });
  }

  // ---------------------------------------------------------------------------------------------
  // SFX library. Recipe: fn(M, t, o, out) -> end time. o = { intensity, rate } (vol/pan are applied
  // by the caller's output node). `wet` = reverb send, `max` = repeats allowed per 35 ms window.
  // ---------------------------------------------------------------------------------------------

  const SFX = {};
  function def(name, wet, fn, max = 3) { SFX[name] = { wet, fn, max, real: null }; }

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
    return glints(M, out, t + 0.12, 5, 0.4, 0.05) + 1.2;
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

  // No real recording of a swing grunt exists in the library, and silence beats a fake voice.
  def('voice_hup', 0, (M, t) => t, 2);

  /** A small murmur from the stands (synth stand-in for the recorded one). */
  function murmur(M, out, t, dur, v) {
    const bed = swellGain(M, out, t, dur * 0.3, v, dur, dur * 0.55);
    crowdBed(M, bed, t, dur + 0.05, [[420, 1.4, 0.5], [950, 1.6, 0.35]], 3);
    return t + dur;
  }

  def('ump_strike', 0.2, (M, t, o, out) => murmur(M, out, t, 0.9, 0.8), 1);

  // ---- Fanfares & jingles ------------------------------------------------------------------------
  //
  // Played on the sampled real instruments (each note falls back to synthesis on its own until decoded):
  // the melody on marimba doubled an octave up by the glockenspiel, long notes held the way players do it
  // (a soft marimba roll plus the recorder sustaining the pitch), chords strummed on the harp over a quiet
  // brass pad, timpani + suspended cymbal accents, and glockenspiel / triangle glints for the sparkle.

  /** Melody line for fanfares (see above). Returns the end time. */
  function fanfareLine(M, out, t, bpm, str, v, transpose = 0) {
    const st = 60 / bpm / 4;
    let end = t;
    for (const e of lineEvents(str, 1).events) {
      const at = t + e.step * st, midi = noteMidi(e.tok) + transpose, f = mtof(midi), len = e.len * st;
      end = Math.max(end, INST.marimba(M, out, at, f, len, v));
      INST.bell(M, out, at, mtof(midi + 12), Math.min(len, 0.3), v * 0.4);
      if (len >= 0.35) {
        for (let tt = at + 0.075, k = 0; tt < at + len - 0.06; tt += rand(0.066, 0.076), k++) {
          INST.marimba(M, out, tt, f, 0.05, v * (0.42 - 0.18 * (tt - at) / len) * (k % 2 ? 0.85 : 1));
        }
        let fm2 = midi;                                       // recorder in its own range (C5–C7)
        while (fm2 > 88) fm2 -= 12;
        while (fm2 < 70) fm2 += 12;
        end = Math.max(end, INST.flute(M, out, at + 0.015, mtof(fm2), len, v * 0.42));
      }
    }
    return end;
  }

  /** Chord for fanfares: harp strum (low to high) over a soft brass pad. */
  function fanfareChord(M, out, t, notes, dur, v) {
    let end = t;
    notes.forEach((n, i) => { end = Math.max(end, INST.pizz(M, out, t + i * 0.028, mtof(noteMidi(n)), dur, v * 1.6)); });
    return Math.max(end, chord(M, out, t, notes, dur, 'brass', Math.min(0.25, v * 0.55)));
  }

  /**
   * Sparkle on real instruments: quick high glockenspiel glints (C pentatonic: every fanfare is in C) and, when
   * `tri` is set, a triangle hit (1 = short tap, 2 = open ring). Synth glints until the glockenspiel decodes.
   */
  function glints(M, dest, t, n, span, v, tri = 0) {
    let end = t;
    if (tri && M.store) end = Math.max(end, rec(M, dest, tri === 2 ? 'triangle_2' : 'triangle_1', { t, gain: tri === 2 ? 0.34 : 0.3, jit: 0.03 }));
    if (!M.store || !M.store.ready(['inst:glock'])) return Math.max(end, sparkle(M, dest, t, n, span, v));
    const notes = [96, 98, 100, 103, 105, 108];
    for (let i = 0; i < n; i++) {
      const at = t + Math.pow(Math.random(), 1.4) * span;
      end = Math.max(end, INST.bell(M, dest, at, mtof(pick(notes)), 0.05, v * rand(4.2, 6.8)));
    }
    return end;
  }

  def('fanfare_small', 0.25, (M, t, o, out) => {
    fanfareLine(M, out, t, 150, 'G4 . C5 . E5 . G5 - - - - - - - - -', 0.8, Math.round(12 * Math.log2(o.rate)));
    const tc = t + 6 * 0.1;
    fanfareChord(M, out, tc, ['C4', 'E4', 'G4'], 0.8, 0.45);
    INST.bell(M, out, tc, mtof(noteMidi('G6')), 0.5, 0.5);
    cymbal(M, out, tc, 0.06, 1);
    return tc + 1.2;
  }, 1);

  def('fanfare_big', 0.28, (M, t, o, out) => {
    const st = 60 / 140 / 4;
    fanfareLine(M, out, t, 140, 'C5 . C5 . C5 . G4 . C5 - - . E5 - - . G5 - - - - - - - - - - - - - - -', 0.85);
    phrase(M, out, t, 140, 'E4 . E4 . E4 . D4 . E4 - - . G4 - - . C5 - - - - - - - - - - - - - - -', 'marimba', 0.42);
    timpani(M, out, t, 65.4, 0.45);
    timpani(M, out, t + 4 * st, 49, 0.4);
    const tc = t + 16 * st;
    timpani(M, out, tc, 65.4, 0.55);
    fanfareChord(M, out, tc, ['C4', 'G4', 'C5', 'E5'], 1.3, 0.4);
    cymbal(M, out, tc, 0.1, 1.6);
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => INST.bell(M, out, tc + i * 0.07, mtof(noteMidi(n)), 0.4, 0.5));
    return glints(M, out, tc + 0.2, 6, 0.6, 0.035, 2) + 1.6;
  }, 1);

  def('fanfare_record', 0.3, (M, t, o, out) => {
    phrase(M, out, t, 160, 'E5 G5 C6 E6 G6 C7', 'bell', 0.55);
    const tb = t + 6 * (60 / 160 / 4) + 0.05, st = 60 / 150 / 4;
    fanfareLine(M, out, tb, 150, 'C5 - E5 - G5 - - . E5 - G5 - C6 - - - - - - - - - - -', 0.8);
    phrase(M, out, tb, 150, 'G4 - C5 - E5 - - . C5 - E5 - G5 - - - - - - - - - - -', 'marimba', 0.38);
    const tc = tb + 12 * st;
    timpani(M, out, tc, 65.4, 0.45);
    cymbal(M, out, tc, 0.08, 1.4);
    return glints(M, out, tc, 10, 1.0, 0.05, 2) + 1.3;
  }, 1);

  def('jingle_win', 0.25, (M, t, o, out) => {
    const st = 60 / 150 / 4;
    phrase(M, out, t, 150, 'C5 E5 G5 C6 . G5 C6 - E6 - - - - - - -', 'marimba', 0.9);
    phrase(M, out, t, 150, 'C5 E5 G5 C6 . G5 C6 - E6 - - - - - - -', 'bell', 0.35, 12);
    phrase(M, out, t, 150, 'C3 - - - G2 - - - C3 - - - - - - -', 'bass', 0.55);
    fanfareChord(M, out, t + 8 * st, ['E4', 'G4', 'C5'], 0.9, 0.4);
    return glints(M, out, t + 8 * st, 5, 0.6, 0.04, 1) + 1.0;
  }, 1);

  def('jingle_lose', 0.22, (M, t, o, out) => {
    const st = 60 / 120 / 4;
    phrase(M, out, t, 120, 'G4 - - E4 - - D#4 - D4 - - - - - - -', 'marimba', 0.9);
    phrase(M, out, t, 120, 'G4 - - E4 - - D#4 - D4 - - - - - - -', 'vibes', 0.45);
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
    fanfareLine(M, out, tb, 150, 'G5 . E5 . G5 . C6 - - - - - - - - - -', 0.8);
    phrase(M, out, tb, 150, 'E5 . C5 . E5 . G5 - - - - - - - - - -', 'marimba', 0.4);
    const tc = tb + 6 * st;
    timpani(M, out, tc, 65.4, 0.5);
    cymbal(M, out, tc, 0.1, 1.6);
    fanfareChord(M, out, tc, ['C4', 'E4', 'G4', 'C5'], 1.0, 0.3);
    return glints(M, out, tc, 14, 1.2, 0.05, 2) + 1.4;
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

  def('line_call', 0.2, (M, t, o, out) => murmur(M, out, t, 0.8, 0.7), 1);

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
  // Recorded SFX. real(name, needs, fn, wet) attaches a recipe built from real recordings; it plays
  // whenever every group in `needs` has a decoded recording (optional layers just skip when missing),
  // otherwise the synth recipe above plays and the recordings are queued for decoding.
  // Gains are absolute levels, balanced offline against each other with _analyze (DESIGN §10.6).
  // ---------------------------------------------------------------------------------------------

  function real(name, needs, fn, wet) { SFX[name].real = { needs, fn, wet: wet ?? SFX[name].wet }; }
  const has = (M, name) => M.store.ready([name]);

  // ---- UI (Kenney interface sounds: light and short) -------------------------------------------

  const uiRec = (name, group, gain, extra) => real(name, [group], (M, t, o, out) =>
    rec(M, out, group, Object.assign({ t, gain, rate: o.rate, jit: 0.02, gj: 0.8 }, extra)), 0.03);
  uiRec('ui_tap', 'ui_tap', 1.4);
  uiRec('ui_select', 'ui_select', 0.85);
  uiRec('ui_back', 'ui_back', 1.5);
  uiRec('ui_open', 'ui_open', 0.6);
  uiRec('ui_close', 'ui_close', 0.6, { rate: 0.94 });
  uiRec('ui_error', 'ui_error', 0.9);
  uiRec('ui_tick', 'ui_tick', 0.6, { jit: 0.01 });
  uiRec('pop', 'ui_pop', 0.75);
  uiRec('type', 'ui_type', 0.18, { jit: 0.06 });
  uiRec('swish', 'ui_swish', 0.85);
  real('ui_toggle', ['ui_toggle_on', 'ui_toggle_off'], (M, t, o, out) =>
    rec(M, out, o.intensity >= 0.5 ? 'ui_toggle_on' : 'ui_toggle_off', { t, gain: 0.48, rate: o.rate, jit: 0.01, gj: 0.5 }), 0.03);

  // Chimes keep their melodies, played on the sampled glockenspiel / marimba (INST).
  real('coin', ['inst:glock', 'inst:marimba'], (M, t, o, out) => {
    const R = o.rate;
    INST.marimba(M, out, t, 988 * R, 0.07, 0.34);
    INST.bell(M, out, t, 988 * R, 0.07, 0.52);
    INST.marimba(M, out, t + 0.07, 1319 * R, 0.3, 0.34);
    return INST.bell(M, out, t + 0.07, 1319 * R, 0.45, 0.64);
  }, 0.15);

  real('levelup', ['inst:glock', 'inst:marimba'], (M, t, o, out) => {
    ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => INST.marimba(M, out, t + i * 0.055, mtof(noteMidi(n)) * o.rate, 0.12, 0.7));
    const t2 = t + 6 * 0.055;
    ['C6', 'E6', 'G6'].forEach(n => INST.bell(M, out, t2, mtof(noteMidi(n)) * o.rate, 0.6, 0.6));
    cymbal(M, out, t2, 0.03, 1);
    return glints(M, out, t2, 4, 0.45, 0.03) + 1.0;
  }, 0.25);

  real('count_beep', ['inst:glock', 'inst:marimba'], (M, t, o, out) => {
    INST.marimba(M, out, t, 880 * o.rate, 0.1, 0.5);
    return INST.bell(M, out, t, 880 * o.rate, 0.12, 0.55);
  }, 0.08);

  real('count_go', ['inst:glock', 'inst:marimba'], (M, t, o, out) => {
    for (const f of [784, 1046, 1318]) { INST.marimba(M, out, t, f * o.rate, 0.3, 0.4); INST.bell(M, out, t, f * o.rate, 0.4, 0.36); }
    cymbal(M, out, t, 0.025, 1);
    rec(M, out, 'whoosh_soft', { t, gain: 0.15, rate: 1.3 });
    return t + 0.9;
  }, 0.15);

  // ---- Generic ---------------------------------------------------------------------------------

  real('whoosh', ['whoosh', 'whoosh_soft', 'swing_heavy'], (M, t, o, out) => {
    const I = o.intensity;
    const group = I < 0.35 ? 'whoosh_soft' : I < 0.75 ? 'whoosh' : 'swing_heavy';
    return rec(M, out, group, { t, gain: 0.12 + 0.9 * Math.pow(I, 1.3), rate: o.rate * (0.92 + 0.16 * I) });
  });
  real('swing_light', ['swing_light'], (M, t, o, out) => rec(M, out, 'swing_light', { t, gain: 0.55, rate: o.rate }));
  real('swing_heavy', ['swing_heavy'], (M, t, o, out) => rec(M, out, 'swing_heavy', { t, gain: 1, rate: o.rate }));
  real('thud', ['thud'], (M, t, o, out) => {
    sub(M, out, t, 0.22, 58 * o.rate);
    rec(M, out, 'knock_wood', { t, gain: 0.4, rate: 0.75 * o.rate, lp: 2600 });   // the knock phones can play
    return rec(M, out, 'thud', { t, gain: 0.9, rate: o.rate });
  });
  real('bounce_soft', ['bounce_soft'], (M, t, o, out) => rec(M, out, 'bounce_soft', { t, gain: 1.5, rate: o.rate }));
  real('splash', ['splash'], (M, t, o, out) => rec(M, out, 'splash', { t, gain: 0.9, rate: o.rate }));
  real('wood_knock', ['knock_wood'], (M, t, o, out) => {
    rec(M, out, 'drum_block', { t, gain: 0.42, rate: 0.72 * o.rate, lp: 3000, jit: 0.04 });   // the woody click phones can play
    return rec(M, out, 'knock_wood', { t, gain: 1.8, rate: 1.25 * o.rate, jit: 0.04 });
  });
  real('camera_flash', ['camera_flash'], (M, t, o, out) => rec(M, out, 'camera_flash', { t, gain: 0.3, rate: o.rate, jit: 0.03 }));

  real('firework', ['firework_boom'], (M, t, o, out) => {
    const I = o.intensity, tb = t + 0.6;
    rec(M, out, 'whoosh_fast', { t, gain: 0.1, rate: 0.7, lp: 5000 });   // the shell going up
    let end = rec(M, out, 'firework_boom', { t: tb, gain: 0.45 + 0.4 * I });
    if (I > 0.4) end = Math.max(end, rec(M, out, 'firework_crackle', { t: tb + rand(0.12, 0.25), gain: 0.18 + 0.22 * I, pan: rand(-0.4, 0.4) }));
    if (I > 0.65) rec(M, out, 'firework_far', { t: tb + rand(0.35, 0.7), gain: 0.32, pan: rand(-0.6, 0.6) });
    if (has(M, 'amb_crowd')) end = Math.max(end, bedSwell(M, out, tb + 0.1, 1.8, 0.1 + 0.12 * I, 2200));
    return end;
  }, 0.25);

  real('confetti', ['balloon_pop'], (M, t, o, out) => {
    rec(M, out, 'balloon_pop', { t, gain: 0.4, rate: o.rate });
    rec(M, out, 'whoosh_soft', { t: t + 0.03, gain: 0.22, rate: 1.2 });
    return Math.max(t + 0.7, rec(M, out, 'triangle_1', { t: t + 0.04, gain: 0.16, rate: rand(0.95, 1.08) }));
  });

  // ---- Crowd & people ----------------------------------------------------------------------------

  real('crowd_cheer', ['crowd_cheer'], (M, t, o, out) => {
    const I = o.intensity, len = 1.3 + 2.4 * I;
    if (I >= 0.7 && has(M, 'crowd_roar')) {
      // big moment: a stadium roar (started just before its swell peaks) over the cheering crowd
      const end = rec(M, out, 'crowd_roar', { t, lead: 0.5, dur: len + 1, fade: 1.6, attack: 0.05, gain: 0.5 + 0.35 * I, gj: 0.8 });
      rec(M, out, 'crowd_cheer', { t: t + 0.08, offset: rand(0, 0.4), dur: len, fade: len * 0.5, attack: 0.1, gain: 0.3 });
      return end;
    }
    // a different crowd each time: random start inside the recording and speed, sometimes the arena roar far
    // underneath, and a single voice or two on top
    const kids = I < 0.5 && Math.random() < 0.35 && has(M, 'crowd_cheer_kids');
    const src = bankSamples()[kids ? 'crowd_cheer_kids' : 'crowd_cheer'];
    const end = rec(M, out, kids ? 'crowd_cheer_kids' : 'crowd_cheer', {
      t, offset: rand(0, Math.max(0, Math.min(kids ? 0.3 : 0.8, (src ? src.dur : 3) - len - 0.3))), dur: len, fade: len * 0.45,
      attack: 0.05, gain: (0.45 + 0.35 * I) * (kids ? 1.4 : 1), rate: rand(0.96, 1.04), jit: 0,
    });
    if (I >= 0.35 && Math.random() < 0.6 && has(M, 'crowd_roar')) {
      rec(M, out, 'crowd_roar', { t: t + 0.05, lead: 0.35, dur: len, fade: len * 0.5, attack: 0.25, gain: 0.1 + 0.18 * I, lp: 2400, gj: 1 });
    }
    if (Math.random() < 0.7 && has(M, 'vox_yay')) voiceLayer(M, out, t + 0.12, ['vox_yay'], irand(1, 2), { gain: 0.1 + 0.08 * I, spread: 0.45, lp: 3800 });
    return end;
  }, 0.06);

  // Applause: a random stretch of 16 s of steady applause, then the recording's natural die-away crossfaded on
  // (later into the die-away for small ones), so no two are the same.
  real('crowd_applause', ['crowd_applause_body'], (M, t, o, out) => {
    const I = o.intensity, len = 1.4 + 2.8 * I, gain = 0.5 + 0.45 * I, xf = 0.5;
    const body = (bankSamples().crowd_applause_body || { dur: 16 }).dur, run = Math.max(0.6, len - 0.5);
    let end = rec(M, out, 'crowd_applause_body', {
      t, offset: rand(0, Math.max(0, body - run - xf - 0.5)), dur: run + xf, fade: xf, attack: 0.15, gain, gj: 0.8, jit: 0.02,
    });
    // the recording's own die-away starts ~1.5 s into the tail clip: join just before it, keep ~2–2.6 s of it
    end = Math.max(end, rec(M, out, 'crowd_applause_tail', {
      t: t + run, offset: I < 0.4 ? rand(1.5, 1.9) : rand(0.9, 1.4), attack: xf, dur: 2 + 0.6 * I, fade: 0.6, gain: gain * 1.05, gj: 0.5, jit: 0.02,
    }));
    return end;
  }, 0.06);

  // Crowd reactions: 5–8 real individual voices layered with offsets and spread, plus the room swelling.
  real('crowd_aww', ['vox_aww', 'vox_sigh'], (M, t, o, out) => {
    const I = o.intensity;
    // two of the three "aww" voices, a kid's sigh and 2–5 adult sighs: a different crowd every time
    let end = voiceLayer(M, out, t, ['vox_aww', 'vox_kid_aww'], 2, { gain: 0.42 });
    end = Math.max(end, voiceLayer(M, out, t + 0.03, ['vox_sigh_9', 'vox_sigh_10'], 1, { gain: 0.3, spread: 0.15 }));
    end = Math.max(end, voiceLayer(M, out, t + 0.05, ['vox_sigh'], 2 + Math.round(3 * I), { gain: 0.32, spread: 0.2 }));
    if (has(M, 'amb_crowd')) bedSwell(M, out, t, 1.5, 0.2, 900);
    return end;
  }, 0.12);

  real('crowd_ooh', ['vox_ooh'], (M, t, o, out) => {
    const end = voiceLayer(M, out, t, ['vox_ooh'], 4, { gain: 0.62, spread: 0.15 });   // 4 of the 6 voices
    if (has(M, 'amb_crowd')) bedSwell(M, out, t, 1.6, 0.25, 1000);
    return end;
  }, 0.12);

  real('crowd_gasp', ['vox_gasp'], (M, t, o, out) => {
    const end = voiceLayer(M, out, t, ['vox_gasp'], 6, { gain: 0.3, spread: 0.08 });
    if (has(M, 'amb_crowd')) bedSwell(M, out, t, 0.9, 0.12, 1600);
    return end;
  }, 0.12);

  real('crowd_laugh', ['vox_laugh'], (M, t, o, out) => {
    const end = voiceLayer(M, out, t, ['vox_laugh'], 7, { gain: 0.45, first: 0.75, spread: 0.25, lp: 4200 });
    if (has(M, 'amb_crowd')) bedSwell(M, out, t, 1.4, 0.15, 1400);
    return end;
  }, 0.12);

  real('whistle', ['whistle_short'], (M, t, o, out) =>
    rec(M, out, o.intensity >= 0.9 && has(M, 'whistle_long') ? 'whistle_long' : 'whistle_short', { t, gain: 0.6, rate: o.rate, jit: 0.02 }), 0.15);

  // a single Pal: well under the crowd, sibilance softened for phone speakers
  real('voice_yay', ['vox_yay'], (M, t, o, out) => rec(M, out, 'vox_yay', { t, gain: 0.6, rate: o.rate, jit: 0.03, lp: 6000 }), 0.1);
  real('voice_aw', ['vox_kid_aww'], (M, t, o, out) =>
    rec(M, out, ['vox_kid_aww', 'vox_sigh_9', 'vox_sigh_10'], { t, gain: 0.55, rate: o.rate, jit: 0.03, lp: 6000 }), 0.1);

  /** A small real murmur from the stands: the bed swelling plus a couple of distant "ooh"s. */
  function murmurRec(M, out, t, dur, v) {
    const end = bedSwell(M, out, t, dur, v, 1800);
    return Math.max(end, voiceLayer(M, out, t + 0.05, ['vox_ooh'], 2, { gain: v * 0.5, lp: 2200, spread: 0.12 }));
  }
  real('ump_strike', ['vox_ooh', 'amb_crowd'], (M, t, o, out) => murmurRec(M, out, t, 0.9, 0.25), 0.1);
  real('line_call', ['vox_ooh', 'amb_crowd'], (M, t, o, out) => murmurRec(M, out, t, 0.8, 0.22), 0.1);

  // ---- Bowling -------------------------------------------------------------------------------------

  real('bowl_release', ['thud', 'knock_wood'], (M, t, o, out) => {
    const I = o.intensity;
    sub(M, out, t, 0.2 + 0.15 * I, 50);
    rec(M, out, 'knock_wood', { t, gain: 0.5 + 0.3 * I, rate: 0.8, lp: 2200 });                 // ball on maple
    rec(M, out, 'drum_block', { t, gain: 0.1 + 0.08 * I, rate: 0.5, lp: 1600, jit: 0.03 });    // its "tock": audible on phones
    return rec(M, out, 'thud', { t, gain: 0.64 + 0.5 * I, rate: 0.85, lp: 2500 });
  });

  /** n single pin knocks, staggered over `span` with falling gain; some low and dull (pins on the deck). */
  function knocks(M, out, t, n, span, v) {
    let end = t;
    for (let k = 0; k < n; k++) {
      const dt = k === 0 ? 0 : span * Math.pow(Math.random(), 1.3);
      const floor = Math.random() < 0.25;
      end = Math.max(end, rec(M, out, 'pin_knock', {
        t: t + dt, gain: v * rand(0.45, 1) * (1 - 0.5 * dt / Math.max(span, 0.01)), jit: 0,
        rate: floor ? rand(0.7, 0.8) : rand(0.92, 1.12), lp: floor ? 1800 : 0, pan: rand(-0.6, 0.6),
      }));
    }
    return end;
  }

  real('pins_hit', ['pin_knock'], (M, t, o, out) => {
    const I = o.intensity;
    sub(M, out, t, 0.08 + 0.14 * I, 60);
    if (I >= 0.72 && has(M, 'pins_strike_1')) {
      // a full rack exploding: real strike recordings (the scattered one gets an onset knock)
      const scattered = has(M, 'pins_strike_2') && Math.random() < 0.3;
      if (scattered) knocks(M, out, t, 2, 0.03, 0.9);
      return rec(M, out, scattered ? 'pins_strike_2' : 'pins_strike_1', {
        t, gain: 0.95 + 0.25 * I, rate: 0.96 + 0.08 * I, lp: 4000 + 16000 * (I - 0.72) / 0.28,
      });
    }
    // lighter hits: a few single knocks 20–90 ms apart, plus scattered clatter once the ball has pace
    let end = knocks(M, out, t, I < 0.4 ? irand(2, 3) : irand(2, 4), 0.02 + 0.07 * I, 2.2);
    if (I >= 0.25 && has(M, 'pins_strike_2')) end = Math.max(end, rec(M, out, 'pins_strike_2', { t: t + 0.01, gain: 0.35 + 0.65 * I, lp: 2500 + 8000 * I }));
    return end;
  }, 0.1);

  real('pin_clatter', ['pin_knock'], (M, t, o, out) => knocks(M, out, t, 3 + Math.round(4 * o.intensity), 0.15 + 0.3 * o.intensity, 1.4 + 1.4 * o.intensity), 0.1);

  real('gutter_drop', ['knock_wood_heavy', 'knock_wood'], (M, t, o, out) => {
    sub(M, out, t, 0.22, 52);
    rec(M, out, 'knock_wood', { t, gain: 0.6, rate: 0.9 * o.rate });
    return rec(M, out, 'knock_wood_heavy', { t, gain: 1.4, rate: 0.85 * o.rate });
  });

  real('ball_return', ['ball_return'], (M, t, o, out) => {
    rec(M, out, 'ball_return', { t, gain: 0.34, rate: o.rate });
    return rec(M, out, 'knock_wood', { t: t + 1.05, gain: 0.5, rate: 1.25 }) || t + 1.3;
  });

  real('sweep', ['knock_plank'], (M, t, o, out) => {
    rec(M, out, 'knock_plank', { t, gain: 0.75, rate: 0.9 });                            // the bar drops
    rec(M, out, 'whoosh_soft', { t: t + 0.12, gain: 0.4, rate: 0.6, lp: 1800 });         // and sweeps
    if (has(M, 'pin_knock')) knocks(M, out, t + 0.35, 4, 0.6, 0.5);                       // the deadwood
    return rec(M, out, 'knock_plank', { t: t + 1.15, gain: 0.42, rate: 1.05 }) || t + 1.4; // and lifts
  });

  // ---- Tennis --------------------------------------------------------------------------------------

  // The racket "pock": three bright takes (body below 250 Hz removed, presence at 1.3 kHz), the strings' ping on
  // top; power raises level (~8 dB range) and pitch. The court bounce stays dull and full, so the two never blur.
  real('racket_hit', ['tennis_pock'], (M, t, o, out) => {
    const I = o.intensity;
    fm(M, out, { t, f: 1900 * o.rate, ratio: 1.41, index: 1, d: 0.1, v: 0.05 + 0.03 * I });   // the strings' ping
    return rec(M, out, 'tennis_pock', { t, gain: 0.7 + 1.8 * I, rate: o.rate * (0.94 + 0.14 * I), jit: 0.03, gj: 1 });
  });

  real('racket_frame', ['tennis_pock'], (M, t, o, out) => {
    rec(M, out, 'knock_wood', { t, gain: 0.7, rate: 1.25, hp: 400 });
    return rec(M, out, 'tennis_pock', { t, gain: 1.0, rate: o.rate * 0.8, lp: 3500 });
  });

  real('ball_bounce_court', ['tennis_bounce'], (M, t, o, out) =>
    rec(M, out, 'tennis_bounce', { t, gain: 0.85, rate: o.rate, jit: 0.05, hp: 120 }));
  real('serve_toss', ['whoosh_soft'], (M, t, o, out) => rec(M, out, 'whoosh_soft', { t, gain: 0.15, rate: 1.25 * o.rate, dur: 0.35, fade: 0.15 }));

  real('net_hit', ['soft_hit'], (M, t, o, out) => {
    const am = flutter(M, out, t, 0.4, 28, 0.6);                                      // the net shivering
    noise(M, am, { t, a: 0.01, d: 0.35, v: 0.14, type: 'bandpass', f: 1500, q: 1.2 });
    rec(M, out, 'land_sand', { t, gain: 0.4, hp: 180, rate: 1.1 * o.rate });           // the mesh catching the ball
    return rec(M, out, 'soft_hit', { t, gain: 1, rate: o.rate });
  });

  // ---- Baseball ------------------------------------------------------------------------------------

  // One wooden-bat recording, three "takes": alone, with a hardwood claves crack on top, or with a dry wood knock
  // (and a slightly different speed / EQ each), so back-to-back hits are not the same clip.
  real('bat_crack', ['bat_crack'], (M, t, o, out) => {
    const s = o.intensity, v = irand(0, 2);
    if (s > 0.8) sub(M, out, t, 0.16, 62);
    if (v === 1) rec(M, out, 'drum_rim', { t: t + 0.002, gain: 0.22 + 0.18 * s, rate: rand(0.6, 0.68), hp: 900, jit: 0 });
    else if (v === 2) rec(M, out, 'knock_wood', { t: t + 0.001, gain: 0.3 + 0.25 * s, rate: rand(1.25, 1.4), hp: 600, jit: 0 });
    return rec(M, out, 'bat_crack', {
      t, gain: 1.3 + 1.1 * s, rate: o.rate * (0.95 + 0.07 * s) * [1, 0.97, 1.035][v], lp: 3000 + 17000 * s * s, hp: v === 2 ? 220 : 0, jit: 0.02,
    });
  }, 0.18);
  real('bat_foul', ['bat_crack'], (M, t, o, out) => rec(M, out, 'bat_crack', { t, gain: 0.9, rate: o.rate * 0.92, lp: 2400, dur: 0.18, fade: 0.08 }));
  real('mitt_pop', ['leather_pop'], (M, t, o, out) => {
    const I = o.intensity;
    rec(M, out, 'drum_clap', { t, gain: 0.15 + 0.15 * I, rate: 0.75, lp: 4500, jit: 0.04 });   // the leather "snap"
    return rec(M, out, I > 0.8 && has(M, 'leather_pop_heavy') ? 'leather_pop_heavy' : 'leather_pop', { t, gain: 0.2 + 0.35 * I, rate: o.rate });
  }, 0.18);
  // the bright swishes only (the other fast whoosh is mostly low body, which phone speakers drop)
  real('pitch_whoosh', ['whoosh_fast_2', 'swing_light'], (M, t, o, out) =>
    rec(M, out, ['whoosh_fast_2', 'swing_light_1', 'swing_light_3'], { t, gain: 1.0, rate: o.rate * 1.08, hp: 250 }));
  real('ball_land_grass', ['land_grass'], (M, t, o, out) => rec(M, out, 'land_grass', { t, gain: 0.9, rate: o.rate }));

  // ---- Golf ----------------------------------------------------------------------------------------

  // Club contact: one clack recording, three voicings per club (speed, EQ, which metal ring), so a round of
  // drives does not repeat. Power drives level over a ~5 dB range.
  real('golf_drive', ['golf_clack'], (M, t, o, out) => {
    const I = o.intensity, v = irand(0, 2);
    rec(M, out, 'metal_ping', { t, gain: 0.12 + 0.2 * I, rate: o.rate * [1.1, 1.18, 1.03][v], hp: 1500 });
    rec(M, out, 'whoosh_fast', { t: t + 0.005, gain: 0.12 * I, rate: 1.3 });
    return Math.max(t + 0.3, rec(M, out, 'golf_clack', {
      t, gain: 0.9 + 0.6 * I, rate: o.rate * [1.19, 1.13, 1.25][v], hp: [0, 300, 0][v], lp: [0, 0, 9000][v], jit: 0.02,
    }));
  });
  real('golf_iron', ['golf_clack'], (M, t, o, out) => {
    const v = irand(0, 2);
    rec(M, out, 'land_grass', { t: t + 0.006, gain: 0.35, lp: 2500 });   // the divot
    if (v) rec(M, out, 'metal_ping', { t, gain: 0.07, rate: o.rate * (v === 1 ? 0.92 : 1.05), hp: 1200 });
    return rec(M, out, 'golf_clack', { t, gain: 0.5, rate: o.rate * [1, 0.95, 1.06][v], lp: [0, 7000, 0][v], jit: 0.03 });
  });
  real('golf_chip', ['golf_clack'], (M, t, o, out) => {
    rec(M, out, 'land_grass', { t: t + 0.004, gain: 0.3, lp: 2000 });
    return rec(M, out, 'golf_clack', { t, gain: 0.25, rate: o.rate * rand(0.9, 1), lp: rand(2300, 3000) });
  });
  real('golf_putt', ['golf_putt'], (M, t, o, out) => rec(M, out, 'golf_putt', { t, gain: 0.12 + 0.18 * o.intensity, rate: o.rate, jit: 0.02 }));
  real('golf_cup', ['golf_cup'], (M, t, o, out) => rec(M, out, 'golf_cup', { t, gain: 1.3, rate: o.rate, jit: 0.02 }));
  real('golf_land_grass', ['land_grass'], (M, t, o, out) => rec(M, out, 'land_grass', { t, gain: 1.2, rate: o.rate }));
  real('golf_land_sand', ['land_sand'], (M, t, o, out) => rec(M, out, 'land_sand', { t, gain: 0.35, rate: o.rate }));
  real('golf_tree', ['golf_leaves', 'knock_wood'], (M, t, o, out) => {
    rec(M, out, 'knock_wood', { t, gain: 0.6, rate: 0.8 * o.rate });
    rec(M, out, 'knock_wood', { t: t + 0.25, gain: 0.25, rate: 0.95 * o.rate });
    return rec(M, out, 'golf_leaves', { t: t + 0.02, gain: 0.3, dur: 1.0, fade: 0.4 });
  });
  real('golf_water', ['splash'], (M, t, o, out) =>
    rec(M, out, has(M, 'splash_big') && Math.random() < 0.5 ? 'splash_big' : 'splash_1', { t, gain: 0.65, rate: o.rate }), 0.12);

  /** Sport whose bank holds a sfx/loop's recordings (requesting one loads that bank). */
  const SPORT_OF = {};
  for (const [sport, names] of Object.entries({
    bowling: ['pins_hit', 'pin_clatter', 'ball_return', 'ball_roll', 'alley_ambience', 'sweep'],
    tennis: ['racket_hit', 'racket_frame', 'ball_bounce_court'],
    baseball: ['bat_crack', 'bat_foul'],
    golf: ['golf_drive', 'golf_iron', 'golf_chip', 'golf_putt', 'golf_cup', 'golf_tree'],
  })) for (const n of names) SPORT_OF[n] = sport;

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

  // ---- Recorded loops: seamless bank loops (loopStart/loopEnd), same handle semantics ------------

  /** Crowd bed loop with occasional distant real clap runs and voices. */
  function crowdLoop(M, out, lpF, gain, gap) {
    const lp = distance(M, out, lpF, 0);
    const p = playRec(M, lp, 'amb_crowd', { loop: true, gain, gj: 0, jit: 0 });
    return {
      event(at) {
        const far = distance(M, out, 2200, rand(-0.8, 0.8));
        if (Math.random() < 0.6) {
          const n = irand(3, 6), period = rand(0.18, 0.26), v = rand(0.05, 0.1);
          for (let i = 0; i < n; i++) rec(M, far, 'drum_clap', { t: at + i * period * rand(0.95, 1.05), gain: v * rand(0.7, 1), jit: 0.04 });
        } else rec(M, far, pick(['vox_yay', 'vox_laugh', 'vox_ooh']), { t: at, gain: rand(0.04, 0.08), lp: 1800 });
        return rand(gap[0], gap[1]);
      },
      stop(at) { p.src.stop(at); },
    };
  }

  const REAL_LOOPS = {
    ball_roll: {
      needs: ['ball_roll'],
      make(M, out) {
        const p = playRec(M, out, 'ball_roll', { loop: true, gain: 0.9, gj: 0, jit: 0 });
        const base = p.g.gain.value;
        return {
          // speed → playback rate 0.8–1.25 and level
          setRate(r, at, ramp) {
            const k = clamp((r - 0.3) / 1.1, 0, 1);
            glideParam(p.src.playbackRate, 0.8 + 0.45 * k, at, ramp);
            glideParam(p.g.gain, base * (0.55 + 0.45 * k), at, ramp);
          },
          stop(at) { p.src.stop(at); },
        };
      },
    },
    crowd_ambience: { needs: ['amb_crowd'], make: (M, out) => crowdLoop(M, out, 3200, 0.5, [2, 6]) },
    stadium_ambience: { needs: ['amb_crowd'], make: (M, out) => crowdLoop(M, out, 2600, 0.55, [1.5, 5]) },
    park_ambience: {
      needs: ['amb_forest'],
      make(M, out) {
        const p = playRec(M, out, 'amb_forest', { loop: true, gain: 0.25, gj: 0, jit: 0 });
        return { stop(at) { p.src.stop(at); } };
      },
    },
    alley_ambience: {
      needs: ['amb_cafe'],
      make(M, out) {
        const lp = distance(M, out, 2400, 0);
        const p = playRec(M, lp, 'amb_cafe', { loop: true, gain: 0.6, gj: 0, jit: 0 });
        return {
          // now and then a distant real strike on another lane, or a ball rumbling back
          event(at) {
            const far = distance(M, out, 1400, rand(-0.9, 0.9)), r = Math.random();
            if (r < 0.7) {
              if (!rec(M, far, 'pins_strike', { t: at, gain: rand(0.1, 0.18) })) {
                const g = M.gain(0.16);
                g.connect(far);
                SFX.pins_hit.fn(M, at, { intensity: rand(0.4, 0.9), rate: 1 }, g);
              }
            } else rec(M, far, 'ball_return', { t: at, gain: rand(0.08, 0.14), lp: 700 });
            return rand(6, 14);
          },
          stop(at) { p.src.stop(at); },
        };
      },
    },
  };

  /**
   * A running loop: output gain → loop gate, its implementation, and its event clock. A loop with a
   * recorded version starts synthesized if the recording is not decoded yet, then crossfades over.
   */
  class LoopVoice {
    constructor(M, name, vol, rate) {
      this.M = M;
      this.name = name;
      this.rate = rate;
      this.out = M.gain(0);
      this.out.connect(M.loopGate);
      this.done = false;
      this.endAt = Infinity;
      this.nextEvent = M.now + rand(0.4, 1.5);
      const real = REAL_LOOPS[name], st = M.store;
      const isReal = !!(real && st && st.ready(real.needs));
      if (real && st && !isReal && M.live) {
        // Not decoded yet (a sport's bank loads as it launches): stay silent up to LOOP_WAIT_MS for the
        // recording rather than open on the synthesized bed, then fall back to synthesis and upgrade later.
        this.impl = { stop() {} };
        this.waiting = true;
        st.want(real.needs, PRIO.now);
        st.settled(real.needs).then(() => this.upgrade());
        setTimeout(() => this.fallback(), LOOP_WAIT_MS);
      } else {
        this.impl = this.build(isReal ? real.make : LOOPS[name], 1);
        if (real) mark(M, 'loop:' + name, isReal);
        if (real && st && !isReal) {
          st.want(real.needs, PRIO.now);
          st.settled(real.needs).then(() => this.upgrade());
        }
      }
      this.setRate(rate, 0);
      glideParam(this.out.gain, vol, M.now, 0.4);
    }
    /** The recording did not arrive in time: start the synthesized loop (upgrade() still crossfades later). */
    fallback() {
      if (this.done || !this.waiting) return;
      this.waiting = false;
      this.impl = this.build(LOOPS[this.name], 1);
      this.setRate(this.rate, 0);
      mark(this.M, 'loop:' + this.name, false);
    }
    build(make, level) {
      const bus = this.M.gain(level);
      bus.connect(this.out);
      const impl = make(this.M, bus);
      impl.bus = bus;
      return impl;
    }
    upgrade() {
      const real = REAL_LOOPS[this.name];
      if (this.done || !this.M.store.ready(real.needs)) return;
      const t = this.M.now, old = this.impl;
      if (this.waiting) {                       // nothing was playing yet: start the recording straight away
        this.waiting = false;
        this.impl = this.build(real.make, 1);
        this.setRate(this.rate, 0);
        mark(this.M, 'loop:' + this.name, true);
        return;
      }
      this.impl = this.build(real.make, 0);
      glideParam(this.impl.bus.gain, 1, t, 1.2);
      glideParam(old.bus.gain, 0, t, 1);
      old.stop(t + 1.5);
      this.setRate(this.rate, 0);
      mark(this.M, 'loop:' + this.name, true);
    }
    tick(until) {
      if (!this.impl.event || this.done) { if (this.waiting) this.nextEvent = Math.max(this.nextEvent, until); return; }
      while (this.nextEvent < until) this.nextEvent += this.impl.event(this.nextEvent);
    }
    setVolume(v, ramp) { if (!this.done) glideParam(this.out.gain, Math.max(0, v), this.M.now, ramp); }
    setRate(r, ramp) {
      this.rate = r;
      if (!this.done && this.impl.setRate) this.impl.setRate(Math.max(0.05, r), this.M.now, ramp);
    }
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
  // Music: track data. Mixes are set for the sampled instruments: the synthesized backing (bass, pad)
  // sits a little lower than in the all-synth days so the real marimba/vibes/recorder carry.
  // Lead lines are 8th notes unless leadRes: 16; '-' holds, '.' rests, '|' bars.
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
      mix: { lead: 0.68, dbl: 0.2, comp: 0.3, bass: 0.42, drums: 0.55, pad: 0.38 }, fill: 'snare',
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
      mix: { lead: 0.6, dbl: 0.18, comp: 0.28, bass: 0.4, drums: 0.5, pad: 0.3 },
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
      mix: { lead: 0.75, dbl: 0.1, arp: 0.2, bass: 0.4, drums: 0.5, pad: 0.3 },
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
      mix: { lead: 0.82, comp: 0.33, bass: 0.47, drums: 0.55 }, fill: 'brush',
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
      bpm: 128, swing16: 0.05, lead: 'vibes', dbl: { inst: 'bell', oct: 0 }, comp: 'pluck', arp: 'pluck', arpLo: 62, bass: 'bass',
      compPat: '. . x . . . x . . . x . . . x .', arpPat: '1 5 8 5 1 5 8 5 1 5 8 5 1 5 8 5',
      bassPat: '1 - 8 - 1 - 8 - 1 - 8 - 5 - 8 -', pad: 'pad',
      mix: { lead: 0.95, dbl: 0.24, comp: 0.24, arp: 0.1, bass: 0.42, drums: 0.55, pad: 0.32 }, fill: 'snare',
      drums: { main: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.' } },
      sections: {
        A: { chords: 'D | A | Bm | G | D | A | G | A', lead: TENNIS_A + ' | D5 - G5 - B5 - A5 G5 | A5 - - - . . . .', arp: false },
        A2: { chords: 'D | A | Bm | G | D | A | G A | D', lead: TENNIS_A + ' | B5 - - A5 G5 - C#6 - | D6 - - - . . . .', dbl: true },
        B: {
          chords: 'Bm | G | D | A | Bm | G | Em | A7',
          lead: 'B5 - - A5 F#5 - - D5 | G5 - - F#5 E5 - - D5 | F#5 - - E5 D5 - - A4 | C#5 - - - E5 - - - | ' +
                'B5 - - A5 F#5 - - D5 | G5 - - B5 D6 - - B5 | G5 - - E5 B4 - E5 - | A5 - G5 - E5 - C#5 -',
        },
      },
      form: ['A', 'A2', 'B', 'A2'],
    },

    baseball: {
      // ballpark: the tune on marimba + glockenspiel, the stadium organ kept as a quiet comp underneath
      bpm: 136, swing8: 0.22, lead: 'marimba', dbl: { inst: 'bell', oct: 12 }, comp: 'organ', compLo: 60, bass: 'bass',
      compPat: '. . x . . . x . . . x . . . x .', bassPat: '1 - - . 3 - - . 5 - - . 6 - - .',
      mix: { lead: 0.86, dbl: 0.18, comp: 0.2, bass: 0.5, drums: 0.55 }, fill: 'snare',
      drums: { main: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
      sections: {
        A: {
          chords: 'G | G | C | G | G | E7 | A7 D7 | G', dbl: true,
          lead: 'G4 . B4 D5 G5 - - . | F#5 . G5 . A5 . G5 . | E5 - C5 - E5 - G5 - | D5 - - - . . . . | ' +
                'G4 . B4 D5 G5 - - . | G#5 . A5 . B5 . G#5 . | A5 - E5 - F#5 - C5 - | B4 - - - G4 . . .',
        },
        B: {
          chords: 'C | C | G | G | A7 | A7 | D | D7', dbl: true,
          lead: 'E5 - G5 - C6 - G5 - | A5 - G5 - E5 - C5 - | D5 - G5 - B5 - G5 - | D5 - - - . . . . | ' +
                'C#5 - E5 - G5 - A5 - | G5 - E5 - C#5 - A4 - | D5 - F#5 - A5 - D6 - | C6 - - - A5 - F#5 -',
        },
      },
      form: ['A', 'A', 'B', 'A'],
    },

    golf: {
      bpm: 92, swing16: 0.12, lead: 'flute', arp: 'marimba', arpLo: 53, bass: 'bass',
      arpPat: '1 . 5 . 8 . 10 . 12 . 10 . 8 . 5 .', bassPat: '1 - - - . . . . 5 - - - . . . .', pad: 'pad',
      mix: { lead: 0.55, arp: 0.24, bass: 0.38, drums: 0.45, pad: 0.38 },
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
      mix: { lead: 0.66, dbl: 0.22, comp: 0.26, bass: 0.4, drums: 0.5, pad: 0.34 }, fill: 'snare',
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
      this.started = false;
      this.endAt = Infinity;
    }

    start(t, fade) {
      this.started = true;
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
      if (!this.started) return;
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
    live = new Mixer(ctx, vols, true, muted ? null : new SampleStore(ctx));
    if (muted) live.master.gain.value = 0;
    ctx.onstatechange = onStateChange;
    if (paused) applyPause(true);
    if (live.store) startDecoding(live.store);
  }

  // ---- Recordings: what to decode first ---------------------------------------------------------

  const INST_SAMPLES = {
    marimba: 'inst:marimba', bell: 'inst:glock', vibes: 'inst:vibes', epiano: 'inst:vibes',
    pluck: 'inst:kalimba', pizz: 'inst:harp', flute: 'inst:recorder',
  };
  const DRUM_SAMPLES = {
    kick: ['drum_kick'], snare: ['drum_snare', 'drum_snare_soft'], clap: ['drum_clap'], rim: ['drum_rim'], hat: ['drum_hat'],
    ride: ['drum_ride'], shaker: ['drum_shaker'], brush: ['drum_snare_soft'], block: ['drum_block'],
  };
  /** Recordings used by the fanfares, jingles and chimes. */
  const FANFARE_NEEDS = ['inst:glock', 'inst:marimba', 'inst:timpani', 'inst:recorder', 'inst:harp', 'inst:vibes', 'cymbal_crash', 'cymbal_soft',
    'triangle', 'drum_shaker', 'drum_kick'];

  /** Sampled instruments and drums a music track uses. */
  function trackNeeds(id) {
    const d = TRACKS[id];
    const insts = new Set([d.lead, d.comp, d.arp, d.dbl && d.dbl.inst, ...Object.values(d.sections).map(sec => sec.leadInst)]);
    const out = [];
    for (const i of insts) if (INST_SAMPLES[i]) out.push(INST_SAMPLES[i]);
    for (const kit of Object.values(d.drums)) for (const lane of Object.keys(kit)) out.push(...DRUM_SAMPLES[lane]);
    if (d.fill) out.push(...DRUM_SAMPLES[d.fill]);
    return [...new Set(out)];
  }

  const prepared = new Set();   // sports whose recordings are wanted

  /**
   * Gets a sport's recordings ready: loads its bank script if it is not inlined yet, then decodes it
   * (and the ambience bed its loops use) ahead of other low-priority work. Cheap to call repeatedly.
   */
  function prepare(sport) {
    if (muted || !SPORT_BEDS[sport]) return;
    prepared.add(sport);
    loadBank(sport).then(() => { if (live && live.store) live.store.want(['bank:' + sport, ...SPORT_BEDS[sport]], PRIO.sport); });
  }

  /**
   * Unlock-time decode order: UI clicks first, then crowd + voices + fanfare instruments + the
   * current track, the launching sport, then the generic effects. Ambience beds and other tracks'
   * instruments are decoded when a loop or track first asks for them.
   */
  function startDecoding(st) {
    st.want(idsWhere(x => x.cat === 'ui'), PRIO.ui);
    if (wantTrack) st.want(trackNeeds(wantTrack), PRIO.track);     // the music about to start, before crowds/voices
    st.want(idsWhere(x => x.cat === 'crowd' || x.cat === 'voice').concat(['amb_crowd', 'drum_clap'], FANFARE_NEEDS), PRIO.high);
    for (const sp of prepared) st.want(['bank:' + sp, ...SPORT_BEDS[sp]], PRIO.sport);
    st.want(idsWhere(x => x.cat === 'generic'), PRIO.normal);
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
  /** Renders a sfx into M at time t (the recorded recipe when its recordings are decoded). */
  function renderSfx(M, name, t, o) {
    const d = SFX[name];
    const opts = { rate: o.rate > 0 ? o.rate : 1, intensity: clamp(o.intensity ?? 1, 0, 1) };
    const real = d.real && M.store && M.store.ready(d.real.needs) ? d.real : null;
    if (d.real && M.store && !real) M.store.want(d.real.needs, PRIO.now);
    const wet = real ? real.wet : d.wet;
    const out = M.gain(Math.max(0, o.vol ?? 1));
    let tail = out;
    if (o.pan) { tail = M.panner(o.pan); out.connect(tail); }
    tail.connect(M.sfxIn);
    if (wet > 0) { const w = M.gain(wet); tail.connect(w); w.connect(M.sfxSend); }
    M.ids = real ? [] : null;
    const end = (real ? real.fn : d.fn)(M, t, opts, out);
    if (d.real) mark(M, 'sfx:' + name, !!real, M.ids);
    M.ids = null;
    return end;
  }

  function sfx(name, o = {}) {
    if (!SFX[name]) { warnOnce('sfx', name); return; }
    if (SPORT_OF[name] && !prepared.has(SPORT_OF[name])) prepare(SPORT_OF[name]);
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
    if (SPORT_OF[name] && !prepared.has(SPORT_OF[name])) prepare(SPORT_OF[name]);
    return new LoopHandle(name, Math.max(0, o.vol ?? 1), o.rate ?? 1);
  }

  // ---- Music ------------------------------------------------------------------------------------

  function applyMusic(fade) {
    if (!live || (current && current.id === wantTrack) || (!current && !wantTrack)) return;
    const t = live.now;
    if (current) { current.fadeOut(t, fade); current = null; }
    if (wantTrack && !muted) {
      const seq = current = new Sequencer(live, wantTrack);
      seqs.add(seq);
      ensureTimer();
      // a new track waits (briefly) for its sampled instruments so it never starts on the synth fallback
      const go = () => { if (current === seq && !seq.started) seq.start(live.now + 0.05, fade); };
      const needs = trackNeeds(wantTrack);
      if (live.store && !live.store.ready(needs)) {
        live.store.want(needs, PRIO.track);
        live.store.settled(needs).then(go);
        setTimeout(go, MUSIC_WAIT_MS);
      } else go();
    }
  }

  function music(id, o = {}) {
    if (id != null && !TRACKS[id]) { warnOnce('music', id); return; }
    const next = id == null ? null : id;
    if (next === wantTrack) return;
    wantTrack = next;
    if (next && SPORT_BEDS[next]) prepare(next);
    if (next && live && live.store) live.store.want(trackNeeds(next), PRIO.track);
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

  const analysisStores = new Map();

  /** Every bank loaded and every recording decoded at `rate` (analysis only; cached). */
  async function analysisStore(rate) {
    await Promise.all(SPORT_BANKS.map(loadBank));
    let st = analysisStores.get(rate);
    if (!st) { st = new SampleStore(new OfflineCtx(1, 1, rate)); analysisStores.set(rate, st); }
    const all = Object.keys(bankSamples());
    st.want(all, PRIO.normal);
    await st.settled(all);
    return st;
  }

  /** RBJ biquad applied in place (used for the K-weighting of the loudness measurement). */
  function biquadInPlace(d, b0, b1, b2, a1, a2) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
    }
  }

  /**
   * ITU-R BS.1770-style loudness of a rendered buffer: K-weighting (high shelf + high-pass), 400 ms
   * blocks with 75 % overlap. Returns { integrated (gated, LUFS), max (loudest momentary block) }.
   */
  function loudness(buf) {
    const sr = buf.sampleRate, chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = Float32Array.from(buf.getChannelData(c));
      let w = 2 * Math.PI * 1681.97 / sr, A = Math.pow(10, 3.99984 / 40), al = Math.sin(w) / (2 * 0.70717), cw = Math.cos(w);
      let a0 = (A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * al;
      biquadInPlace(d, A * ((A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * al) / a0, -2 * A * ((A - 1) + (A + 1) * cw) / a0,
        A * ((A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * al) / a0, 2 * ((A - 1) - (A + 1) * cw) / a0, ((A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * al) / a0);
      w = 2 * Math.PI * 38.135 / sr; al = Math.sin(w) / (2 * 0.5003); cw = Math.cos(w); a0 = 1 + al;
      biquadInPlace(d, (1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - al) / a0);
      chans.push(d);
    }
    const block = Math.floor(sr * 0.4), hop = Math.floor(block / 4), z = [];
    for (let i = 0; i + block <= chans[0].length; i += hop) {
      let sum = 0;
      for (const d of chans) { let e = 0; for (let j = i; j < i + block; j++) e += d[j] * d[j]; sum += e / block; }
      z.push(sum);
    }
    const lk = e => -0.691 + 10 * Math.log10(Math.max(e, 1e-12));
    const max = z.length ? lk(Math.max(...z)) : -120;
    const abs = z.filter(e => lk(e) > -70);
    if (!abs.length) return { integrated: -120, max };
    const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter(e => lk(e) > rel);
    return { integrated: lk(gated.reduce((a, b) => a + b, 0) / gated.length), max };
  }

  /** Length of one pass through a track's form, in seconds. */
  const songSeconds = id => compileTrack(id).bars.length * 16 * compileTrack(id).stepDur;

  /**
   * Renders offline with exactly the live code: a sfx name, 'music:<track>', 'loop:<name>',
   * 'sample:<id>' (one raw recording at its bank gain) or 'note:<instrument>:<midi>' (o.dur, o.vel). Recordings are decoded first (all banks), so
   * the recorded recipes play; o.synth = true renders the pure-synthesis fallback instead.
   * o.full renders a whole music track. Resolves { peak, rms (over the audible part), duration (s until
   * it falls below -60 dB), lufs (integrated), lufsMax (loudest 400 ms), scheduleMs (main-thread time
   * spent building the graph), real / synth (what played as recordings / synthesis), samples (ids),
   * buffer (the AudioBuffer) }.
   */
  async function analyze(name, o = {}, seconds) {
    if (!OfflineCtx) throw new Error('audio: OfflineAudioContext unavailable');
    const m = /^(music|loop|sample|note):(.*)$/.exec(name);
    const kind = m ? m[1] : 'sfx', id = m ? m[2].split(':')[0] : name;
    const store = o.synth ? null : await analysisStore(ANALYZE_RATE);
    const table = { music: TRACKS, loop: LOOPS, sample: bankSamples(), note: Object.assign({}, INST, DRUM), sfx: SFX }[kind];
    if (!table[id]) { warnOnce(kind, id); return { peak: 0, rms: 0, duration: 0, lufs: -120, lufsMax: -120, scheduleMs: 0, real: [], synth: [], samples: [] }; }
    const secs = seconds || (kind === 'music' ? (o.full ? songSeconds(id) + 2.5 : 8) : kind === 'loop' ? 6
      : kind === 'sample' ? table[id].dur + 0.5 : kind === 'note' ? 3 : 4);
    const ctx = new OfflineCtx(2, Math.ceil(ANALYZE_RATE * secs), ANALYZE_RATE);
    const M = new Mixer(ctx, vols, false, store);
    M.trace = { sample: new Set(), synth: new Set(), ids: new Set() };
    const t0 = performance.now();
    if (kind === 'sfx') renderSfx(M, id, 0.02, o);
    else if (kind === 'sample') { if (store) rec(M, M.sfxIn, id, { t: 0.02, jit: 0, gj: 0 }); }
    else if (kind === 'note' && DRUM[id]) DRUM[id](M, M.sfxIn, 0.02, o.vel ?? 1);
    else if (kind === 'note') INST[id](M, M.sfxIn, 0.02, mtof(Number(m[2].split(':')[1]) || 72), o.dur ?? 0.4, o.vel ?? 1);
    else if (kind === 'music') {
      const seq = new Sequencer(M, id);
      seq.start(0.02, 0.01);
      seq.schedule(o.full ? songSeconds(id) + 0.02 : secs);
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
    const L = loudness(buf);
    return {
      peak, rms, duration: last / ANALYZE_RATE, lufs: L.integrated, lufsMax: L.max, scheduleMs,
      real: [...M.trace.sample], synth: [...M.trace.synth], samples: [...M.trace.ids], buffer: buf,
    };
  }

  /** Every source recording (all CC0 1.0), mirrored from audio/CREDITS.md: [work, author, link]. */
  const CREDITS = [
    { title: 'Sound effects', rows: [
      ["Interface Sounds","Kenney (kenney.nl)","https://kenney.nl/assets/interface-sounds"],
      ["UI Audio","Kenney Vleugels (kenney.nl)","https://kenney.nl/assets/ui-audio"],
      ["Micro Pack - Organic Wooshes","Ben Burnes (abstractionmusic.com)","https://gumroad.com/ben_burnes"],
      ["Swoosh","WizardOZ","https://freesound.org/s/419341/"],
      ["Impact Sounds","Kenney (kenney.nl)","https://kenney.nl/assets/impact-sounds"],
      ["Retail Therapy Sample Pack","Ben Burnes (abstractionmusic.com)","https://gumroad.com/ben_burnes"],
      ["25 CC0 bang / firework SFX","OpenGameArt CC0 pack","https://opengameart.org/"],
      ["30 CC0 SFX loops (rolling)","OpenGameArt CC0 pack","https://opengameart.org/"],
      ["Water drop (splash)","bolkmar","https://freesound.org/s/451126/"],
      ["40 CC0 water splash / slime SFX","OpenGameArt CC0 pack","https://opengameart.org/"],
      ["Vintage Camera Flash Powder and Shutter","Werra","https://freesound.org/s/232130/"],
      ["Balloon-Burst-07.wav","Gniffelbaf","https://freesound.org/s/82121/"],
      ["Versilian Community Sample Library: Ball Whistle (referee pea whistle)","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Aerophones/Edge-blown%20Aerophones/Ball%20Whistle"],
      ["Ball into pins (Freesound #792203 + #514385)","unknown (Freesound #792203, #514385)","https://freesound.org/s/792203/"],
      ["B_2 Bowling ball striking pins.wav","Yarmonics","https://freesound.org/s/441856/"],
      ["Six single bowling-pin knocks (Freesound #151204)","unknown (Freesound #151204)","https://freesound.org/s/151204/"],
      ["Bowling ball roll (Freesound #655945)","unknown (Freesound #655945)","https://freesound.org/s/655945/"],
      ["ball_hit_ground.wav","Kyanite_","https://freesound.org/s/432912/"],
      ["bola de tenis caindo.wav","Negraovictor","https://freesound.org/s/394355/"],
      ["Bat Hit 9 FF095.aif","martinimeniscus","https://freesound.org/s/162886/"],
      ["pool_break.wav","reg7783","https://freesound.org/s/204187/"],
      ["Minigolf putt, right into the hole!","pfranzen","https://freesound.org/s/512505/"],
      ["FallingLeaves","falcospizaetus","https://freesound.org/s/489911/"],
    ] },
    { title: 'Crowds', rows: [
      ["cheering and clapping crowd 1","AlaskaRobotics","https://freesound.org/s/221568/"],
      ["Kids cheering (Freesound #321572)","unknown (Freesound #321572)","https://freesound.org/s/321572/"],
      ["Crowd roars and arena atmosphere (edits of Freesound #829453, #130568, #412160, #706497)","itmightgetloud, benfree, phillyfan972, SEF7 (edited by livewire-hoops)","https://freesound.org/s/829453/"],
      ["Applause in a large hall or church","eXpl0it3r","https://opengameart.org/"],
    ] },
    { title: 'Voices', rows: [
      ["kid-Aww, short-girl kid","Bluey1234","https://freesound.org/people/Bluey1234/sounds/839993/"],
      ["aww.wav","phmiller42","https://freesound.org/people/phmiller42/sounds/124996/"],
      ["awwwww.mp3","WhisperPotato","https://freesound.org/people/WhisperPotato/sounds/547589/"],
      ["male sigh.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/215380/"],
      ["sigh.wav","Ashtalon","https://freesound.org/people/Ashtalon/sounds/275055/"],
      ["A male sigh","randbsoundbites","https://freesound.org/people/randbsoundbites/sounds/799579/"],
      ["sigh.mp3","mariiao2","https://freesound.org/people/mariiao2/sounds/240689/"],
      ["Sigh_3_Female","Drkvixn91","https://freesound.org/people/Drkvixn91/sounds/318089/"],
      ["woman sigh","threadzz","https://freesound.org/people/threadzz/sounds/384992/"],
      ["Woman Sigh","Nicolas4677","https://freesound.org/people/Nicolas4677/sounds/446651/"],
      ["Female *Sigh* Sound Effect [Voiced By DarkNightPrincess]","DarkNightPrincess","https://freesound.org/people/DarkNightPrincess/sounds/621773/"],
      ["Girl sighs","BlueSiren","https://freesound.org/people/BlueSiren/sounds/377736/"],
      ["04. Suspiro niña.wav","lemigoga","https://freesound.org/people/lemigoga/sounds/427715/"],
      ["Human_Male_Sigh.wav","lzmraul","https://freesound.org/people/lzmraul/sounds/389461/"],
      ["wow.mp3","MChuckster","https://freesound.org/people/MChuckster/sounds/213939/"],
      ["WOW male voice","ahab2000","https://freesound.org/people/ahab2000/sounds/398933/"],
      ["Oh! (Male)","DrFortyseven","https://freesound.org/people/DrFortyseven/sounds/436108/"],
      ["short wow","riippumattog","https://freesound.org/people/riippumattog/sounds/848609/"],
      ["ooh!.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/323707/"],
      ["ooh.m4a","selinest","https://freesound.org/people/selinest/sounds/659610/"],
      ["Gasp Male","bertiehs","https://freesound.org/people/bertiehs/sounds/271245/"],
      ["Male Gasp 1.wav","jawbutch","https://freesound.org/people/jawbutch/sounds/344407/"],
      ["Male Gasp 4.wav","jawbutch","https://freesound.org/people/jawbutch/sounds/344415/"],
      ["male_gasp.wav","slamaxu","https://freesound.org/people/slamaxu/sounds/509880/"],
      ["Man Gasping","ranman22","https://freesound.org/people/ranman22/sounds/677888/"],
      ["big gasp.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/343878/"],
      ["Famale- Gasp.wav","akennedybrewer","https://freesound.org/people/akennedybrewer/sounds/389169/"],
      ["Gasp.mp3","laft2k","https://freesound.org/people/laft2k/sounds/437667/"],
      ["female_gasp.wav","slamaxu","https://freesound.org/people/slamaxu/sounds/509883/"],
      ["LittleGirlGasp.wav","Willary1","https://freesound.org/people/Willary1/sounds/346198/"],
      ["Cute scared little girl gasp","SkyRaeVoicing","https://freesound.org/people/SkyRaeVoicing/sounds/363586/"],
      ["little girl's gasp","Elona_11","https://freesound.org/people/Elona_11/sounds/813271/"],
      ["Kid-gasp, surprised-girl kid","Bluey1234","https://freesound.org/people/Bluey1234/sounds/839996/"],
      ["Laugh_old_man_6.wav","deleted_user_2104797","https://freesound.org/people/deleted_user_2104797/sounds/166150/"],
      ["Voices - male laughter - mild chuckles.wav","jodybruchon","https://freesound.org/people/jodybruchon/sounds/459455/"],
      ["Laugh_male_quiet.wav","deleted_user_2104797","https://freesound.org/people/deleted_user_2104797/sounds/166141/"],
      ["LaughM.ogg","egomassive","https://freesound.org/people/egomassive/sounds/536811/"],
      ["Man's laugh","quavosh","https://freesound.org/people/quavosh/sounds/670839/"],
      ["small chuckle.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/234950/"],
      ["giggle2.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/235167/"],
      ["giggle10.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/343984/"],
      ["giggle8.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/343991/"],
      ["Female Giggle","DarkNightPrincess","https://freesound.org/people/DarkNightPrincess/sounds/611781/"],
      ["giggle","Singger","https://freesound.org/people/Singger/sounds/635014/"],
      ["short - female - laugh - chuckle - giggle -  AIFF 24 bits","amoyssiadis","https://freesound.org/people/amoyssiadis/sounds/397673/"],
      ["laugh82.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/343941/"],
      ["Girl Laugh.wav","lmbubec","https://freesound.org/people/lmbubec/sounds/119450/"],
      ["Young Female Child Laughing","kim.headlee","https://freesound.org/people/kim.headlee/sounds/184616/"],
      ["yay.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/241487/"],
      ["japanese - yay!2.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/235054/"],
      ["japanese - yay!3.wav","Reitanna","https://freesound.org/people/Reitanna/sounds/235083/"],
    ] },
    { title: 'Ambience', rows: [
      ["Bustling Cafe Ambience","Talitha5","https://freesound.org/s/509950/"],
      ["Early summer, czech wood outside the camp, early morning ambiance","J.Zazvurek","https://freesound.org/s/353311/"],
    ] },
    { title: 'Instruments & drums', rows: [
      ["Versilian Community Sample Library: Marimba","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Marimba"],
      ["Versilian Community Sample Library: Glockenspiel","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Glockenspiel"],
      ["Versilian Community Sample Library: Vibraphone (soft mallets)","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Vibraphone/Soft%20Mallets"],
      ["Versilian Community Sample Library: Kalimba, Tanzania","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Plucked%20Idiophones/Kalimba,%20Tanzania"],
      ["Versilian Community Sample Library: Folk Harp","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Chordophones/Composite%20Chordophones/Folk%20Harp"],
      ["Versilian Community Sample Library: Baroque Soprano Recorder (sustain)","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Aerophones/Edge-blown%20Aerophones/Baroque%20Soprano%20Recorder/Sustain"],
      ["Versilian Community Sample Library: Timpani 1","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Membranophones/Struck%20Membranophones/Timpani%201/Hit"],
      ["Versilian Community Sample Library: Bass Drum 2","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Membranophones/Struck%20Membranophones/Bass%20Drum%202"],
      ["Versilian Community Sample Library: Snare Drum, Modern 1","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Membranophones/Struck%20Membranophones/Snare%20Drum,%20Modern%201"],
      ["Versilian Community Sample Library: Claps","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Claps"],
      ["Versilian Community Sample Library: Claves","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Claves"],
      ["Versilian Community Sample Library: Hi-Hat Cymbal","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Hi-Hat%20Cymbal"],
      ["Versilian Community Sample Library: Suspended Cymbal 1","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Suspended%20Cymbal%201"],
      ["Versilian Community Sample Library: Shaker, Small","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Shaker,%20Small"],
      ["Versilian Community Sample Library: Woodblock","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Woodblock"],
      ["Versilian Community Sample Library: Tambourine 1","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Tambourine%201"],
      ["Versilian Community Sample Library: Triangles","Versilian Studios & VCSL contributors","https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Triangles"],
    ] },
  ];

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  /**
   * Whether a sound is backed by real recordings. kind: 'sfx' | 'loop' | 'music'. Returns
   * { recorded (has a recorded version), ready (decoded in the live context), needs (groups) }.
   * Fanfares/chimes count as recorded through their sampled instruments.
   */
  function info(kind, name) {
    let needs = [];
    if (kind === 'sfx' && SFX[name]) needs = SFX[name].real ? SFX[name].real.needs : /^(fanfare|jingle)_|^star$/.test(name) ? ['inst:glock', 'inst:marimba'] : [];
    else if (kind === 'loop' && REAL_LOOPS[name]) needs = REAL_LOOPS[name].needs;
    else if (kind === 'music' && TRACKS[name]) needs = trackNeeds(name);
    return { recorded: needs.length > 0, ready: !!(live && live.store && needs.length && live.store.ready(needs)), needs };
  }

  /** Debug counters: how often each sound played as a recording / as synthesis, and decode progress. */
  function debugStats() {
    const st = live && live.store;
    let failed = 0;
    if (st) for (const b of st.bufs.values()) if (!b) failed++;
    return {
      sample: Object.assign({}, stats.sample), synth: Object.assign({}, stats.synth),
      decoded: st ? st.bufs.size - failed : 0, failed, queued: st ? st.queue.size + st.inflight.size : 0,
      total: Object.keys(bankSamples()).length, banks: Object.keys((SS.audioBank && SS.audioBank.banks) || {}),
    };
  }

  SS.audio = {
    unlock, sfx, loop, music, duck, setVolumes, suspend, resumeAll, prepare, info,
    names: { sfx: Object.keys(SFX), loops: Object.keys(LOOPS), music: Object.keys(TRACKS) },
    credits: CREDITS,
    _analyze: analyze,
    _stats: debugStats,
  };
  Object.defineProperty(SS.audio, 'ctx', { get: () => (live ? live.ctx : null), enumerable: true });
  Object.defineProperty(SS.audio, 'track', { get: () => wantTrack, enumerable: true });
})();
