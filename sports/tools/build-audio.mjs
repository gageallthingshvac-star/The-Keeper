#!/usr/bin/env node
// Sunny Sports — real-audio sample bank builder (reproducible, idempotent).
//
//   node tools/build-audio.mjs                      rebuild every sample, the banks, samples.json and CREDITS.md
//   node tools/build-audio.mjs --only a,b           re-encode only these ids (the rest are read back from audio/)
//   node tools/build-audio.mjs --banks-only         no encoding: regenerate js/audio-bank*.js + CREDITS.md from audio/
//   node tools/build-audio.mjs --src <dir>          where the staged CC0 sources live (else $SS_AUDIO_SRC, else manifest.srcRoot)
//
// Input : tools/audio-sources.json (manifest: sources with credits + one entry per output sample).
// Output: audio/<bank>/<id>.mp3         mono MP3 (libmp3lame, CBR, bit-exact => same input gives the same bytes)
//         audio/samples.json            generated metadata per sample (duration, gain, root, loop points, levels, size)
//         audio/CREDITS.md              human-readable credits (every source is CC0 1.0)
//         js/audio-bank.js              core bank  (ui, generic, crowd, voices, ambience, instruments, drums)
//         js/audio-bank-<sport>.js      one bank per sport (bowling, tennis, baseball, golf)
// Each bank is a classic-script IIFE that merges into SS.audioBank = { samples: { id: { b64, gain, cat, ... } } }
// without clobbering other banks, so it works from file:// and inlined in the single-file bundle (no fetch, data only).
//
// Per sample: decode (ffmpeg, optional extra filter) -> mono -> cut (in/out, or several segments joined with an
// equal-power crossfade) -> trim leading silence to <= preRoll before the onset -> normalize (peak for one-shots,
// integrated loudness for beds) -> trim the tail at tailDb (or maxDur) with a fade -> loops: snap both ends to rising
// zero crossings and crossfade the tail into the head (equal power; "flatten" first divides out the slow level
// envelope so a bed that drifts or decays does not pulse at the wrap), then encode with a few thousand wrap-around
// samples on each side so the codec edges fall outside [loopStart, loopEnd) -> MP3 -> decode back and verify
// (length, peak <= 0 dBFS, loop-point continuity) -> gain = playback trim that evens out loudness per category
// (instruments: per instrument on the first 400 ms of each note, so every note of a sampler sits at the same level
// in a melody) -> instruments: refine the
// measured f0 hint to the nearest spectral peak and store root as a float MIDI note.
//
// Bank entry fields: b64 (MP3, base64), gain (0..1 playback trim), cat, sport? (per-sport banks), dur (s), peakAt? (s,
// loudest 50 ms window when it is >= 0.1 s in: swells, roars, applause),
// loop? + loopStart/loopEnd (s, in the gapless-decoded buffer), root? (float MIDI) + inst?, who? (voices: kid/man/woman),
// sr, enc (encoder delay+padding info: { delay, pad } in samples, for decoders that ignore the LAME gapless header).
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const MANIFEST = path.join(here, 'audio-sources.json');
const AUDIO_DIR = path.join(ROOT, 'audio');
const JS_DIR = path.join(ROOT, 'js');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf('--' + name); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const SRC = path.resolve(opt('src') || process.env.SS_AUDIO_SRC || man.srcRoot);
const ONLY = opt('only') ? new Set(String(opt('only')).split(',')) : null;
const BANKS_ONLY = !!opt('banks-only');
const D = man.defaults;
const LOOP_WRAP = 4096;            // samples of wrap-around audio encoded before/after a loop body
const BANKS = ['core', 'bowling', 'tennis', 'baseball', 'golf'];

const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// ------------------------------------------------------------------------------------------------- audio I/O

function decode(file, sr, af) {
  const args = ['-v', 'error', '-i', file];
  if (af) args.push('-af', af);
  args.push('-ac', '1', '-ar', String(sr), '-f', 'f32le', '-');
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  return Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}

function encodeMp3(x, sr, kbps, out) {
  const tmp = out + '.f32';
  fs.writeFileSync(tmp, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', tmp,
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-id3v2_version', '0', '-write_id3v1', '0',
    '-c:a', 'libmp3lame', '-b:a', kbps + 'k', '-ar', String(sr), out]);
  fs.unlinkSync(tmp);
}

/** Integrated loudness (LUFS) of a mono float signal via ffmpeg ebur128. */
function lufsOf(x, sr) {
  const tmp = path.join(AUDIO_DIR, '.lufs.f32');
  fs.writeFileSync(tmp, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  const r = spawnSync('ffmpeg', ['-nostats', '-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', tmp, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:')[1] || '');
  return m ? +m[1] : -70;
}

/** Encoder delay / padding from the LAME/Info tag of the first frame (null if absent). */
function lameGapless(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 2048));
  let i = head.indexOf('Info'); if (i < 0) i = head.indexOf('Xing');
  if (i < 0) return null;
  const flags = head.readUInt32BE(i + 4);
  let p = i + 8;
  if (flags & 1) p += 4; if (flags & 2) p += 4; if (flags & 4) p += 100; if (flags & 8) p += 4;
  const b = head.subarray(p + 21, p + 24);       // 9-byte encoder string + 12 bytes, then 12-bit delay, 12-bit padding
  if (b.length < 3) return null;
  return { delay: (b[0] << 4) | (b[1] >> 4), pad: ((b[1] & 15) << 8) | b[2] };
}

// ------------------------------------------------------------------------------------------------- DSP helpers

const peakOf = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };

/** Max RMS over 50 ms windows (dBFS): a short-term loudness that also works for 60 ms clicks. */
function loudOf(x, sr) { return loudAt(x, sr).db; }

/** { db, at }: loudest 50 ms window and its start time (s), e.g. where a swell or roar peaks. */
function loudAt(x, sr) {
  const W = Math.max(1, Math.round(sr * 0.05)), hop = Math.max(1, W >> 2);
  let best = 0, at = 0;
  for (let i = 0; i < Math.max(1, x.length - W + 1); i += hop) {
    let s = 0; const n = Math.min(W, x.length - i);
    for (let k = 0; k < n; k++) s += x[i + k] * x[i + k];
    if (s / W > best) { best = s / W; at = i / sr; }
  }
  return { db: 10 * Math.log10(best + 1e-12), at };
}

/** Equal-power crossfade join of segments a then b over n samples. */
function joinXfade(a, b, n) {
  n = Math.min(n, a.length, b.length);
  const out = new Float32Array(a.length + b.length - n);
  out.set(a.subarray(0, a.length - n));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out[a.length - n + i] = a[a.length - n + i] * Math.cos(t * Math.PI / 2) + b[i] * Math.sin(t * Math.PI / 2);
  }
  out.set(b.subarray(n), a.length);
  return out;
}

/** Nearest rising zero crossing to i within ±w samples (returns i if none). */
function risingZero(x, i, w) {
  let best = -1, bd = Infinity;
  for (let k = Math.max(1, i - w); k < Math.min(x.length, i + w); k++) {
    if (x[k - 1] < 0 && x[k] >= 0 && Math.abs(k - i) < bd) { bd = Math.abs(k - i); best = k; }
  }
  return best < 0 ? i : best;
}

/** Seamless loop: body of length L whose first X samples are crossfaded with the X samples that follow it. */
function makeLoop(x, sr, xfadeSec) {
  const X = Math.round(xfadeSec * sr);
  const s0 = risingZero(x, 0, Math.round(sr * 0.01));
  let L = x.length - s0 - X;
  L = risingZero(x, s0 + L, Math.round(sr * 0.01)) - s0;
  if (s0 + L + X > x.length) L = x.length - s0 - X;
  const y = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    if (i < X) {
      const t = (i + 0.5) / X;
      y[i] = x[s0 + i] * Math.sin(t * Math.PI / 2) + x[s0 + L + i] * Math.cos(t * Math.PI / 2);
    } else y[i] = x[s0 + i];
  }
  return y;
}

/**
 * Loop points in the DECODED signal. The two wrap copies are coded separately and a perceptual codec does not keep
 * noise waveforms, so the nominal points can leave a step. Search a' within ±200 samples of a and a loop length within
 * ±40 samples of nominal (a bed loses or repeats < 1 ms) for the pair whose neighbourhoods match best: then playing
 * b'-1 -> a' looks like the natural b'-1 -> b'. Returns the points and the click metric (step / median |step|).
 */
function bestLoopPoints(y, a, b) {
  const L0 = b - a;
  let best = Infinity, A = a, B = b;
  for (let a2 = Math.max(4, a - 200); a2 <= a + 200; a2++) {
    for (let L = L0 - 40; L <= L0 + 40; L++) {
      const b2 = a2 + L;
      if (b2 + 4 > y.length) continue;
      let c = 0;
      for (let k = -3; k <= 3 && c < best; k++) { const d = y[a2 + k] - y[b2 + k]; c += d * d * (k === 0 || k === -1 ? 4 : 1); }
      if (c < best) { best = c; A = a2; B = b2; }
    }
  }
  return { a: A, b: B };
}

/** Step at the loop join vs the natural steps inside the loop: { jump, p999 } in units of the median |step|. */
function loopClick(y, a, b) {
  const d = [];
  for (let i = a + 1; i < b; i++) d.push(Math.abs(y[i] - y[i - 1]));
  d.sort((p, q) => p - q);
  const med = d[d.length >> 1] || 1e-9;
  return { jump: Math.abs(y[a] - y[b - 1]) / med, p999: d[Math.floor(d.length * 0.999)] / med };
}

/** Strongest spectral peak within ±4 % of f0 (Hann window, 32k FFT, `len` s starting `at` s after the onset). */
function refineF0(x, sr, f0, at = 0.05, len = 0.25) {
  const N = 32768, L = Math.min(N, Math.round(len * sr));
  let on = 0; const pk = peakOf(x); while (on < x.length && Math.abs(x[on]) < pk * 0.05) on++;
  const i0 = on + Math.round(at * sr);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < L; i++) re[i] = (x[i0 + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L));
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let size = 2; size <= N; size <<= 1) {
    const h = size >> 1, ang = -2 * Math.PI / size;
    for (let i = 0; i < N; i += size) for (let k = 0; k < h; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const xr = re[i + k + h] * wr - im[i + k + h] * wi, xi = re[i + k + h] * wi + im[i + k + h] * wr;
      re[i + k + h] = re[i + k] - xr; im[i + k + h] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi;
    }
  }
  const mag = (k) => Math.hypot(re[k], im[k]);
  const lo = Math.floor(f0 * 0.96 * N / sr), hi = Math.ceil(f0 * 1.04 * N / sr);
  let bk = lo; for (let k = lo; k <= hi; k++) if (mag(k) > mag(bk)) bk = k;
  const y0 = Math.log(mag(bk - 1)), y1 = Math.log(mag(bk)), y2 = Math.log(mag(bk + 1));
  const f = (bk + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)) * sr / N;
  return { f, midi: 69 + 12 * Math.log2(f / 440) };
}

function fadeIn(x, n) { n = Math.min(n, x.length); for (let i = 0; i < n; i++) x[i] *= Math.sin((i / n) * Math.PI / 2) ** 2; }
function fadeOut(x, n) { n = Math.min(n, x.length); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= Math.sin((i / n) * Math.PI / 2) ** 2; }

/**
 * Divides out the slow level envelope: RMS in 50 ms hops, smoothed with a Gaussian of `sec` seconds (edges mirrored),
 * gain interpolated per sample. Keeps the short-term texture (claps, voices) while removing drifts and decays.
 */
function flatten(x, sr, sec) {
  const H = Math.round(sr * 0.05), n = Math.ceil(x.length / H), e = new Float64Array(n);
  for (let k = 0; k < n; k++) { let s = 0, c = 0; for (let i = k * H; i < Math.min(x.length, (k + 1) * H); i++) { s += x[i] * x[i]; c++; } e[k] = s / Math.max(1, c); }
  const sig = Math.max(1, sec / 0.05 / 2), R = Math.ceil(sig * 3), sm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0, w = 0;
    for (let j = -R; j <= R; j++) {
      let q = k + j; if (q < 0) q = -q; if (q >= n) q = 2 * n - 2 - q; q = Math.max(0, Math.min(n - 1, q));
      const g = Math.exp(-0.5 * (j / sig) ** 2); s += e[q] * g; w += g;
    }
    sm[k] = Math.sqrt(s / w);
  }
  let mean = 0; for (let k = 0; k < n; k++) mean += sm[k]; mean /= n;
  for (let i = 0; i < x.length; i++) {
    const p = i / H - 0.5, k0 = Math.max(0, Math.min(n - 1, Math.floor(p))), k1 = Math.min(n - 1, k0 + 1), f = Math.max(0, Math.min(1, p - k0));
    x[i] *= mean / Math.max(1e-6, sm[k0] * (1 - f) + sm[k1] * f);
  }
}

/** RMS (dBFS) of the first `sec` seconds after the onset (10 % of peak): how loud a note sounds in a melody. */
function headLoud(x, sr, sec = 0.4) {
  const pk = peakOf(x); let on = 0; while (on < x.length && Math.abs(x[on]) < pk * 0.1) on++;
  const n = Math.min(x.length - on, Math.round(sec * sr)); let s = 0;
  for (let i = on; i < on + n; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, Math.round(sec * sr)) + 1e-12);
}

/** Time (ms) from the start of the sample to its first sample at 10 % of peak: the audible onset. */
function onsetMs(x, sr) { const pk = peakOf(x); let i = 0; while (i < x.length && Math.abs(x[i]) < pk * 0.1) i++; return i / sr * 1000; }

// ------------------------------------------------------------------------------------------------- one sample

function srcFile(e) {
  const s = man.sources[e.src];
  if (!s) throw new Error(`${e.id}: unknown source "${e.src}"`);
  return path.join(SRC, s.path, e.file || '');
}

function cfgOf(e) {
  const c = D.cat[e.cat] || {};
  return { sr: e.sr || c.sr || 44100, kbps: e.kbps || c.kbps || 96, loudTarget: e.loudTarget ?? c.loudTarget };
}

function processSample(e) {
  const { sr, kbps } = cfgOf(e);
  const file = srcFile(e);
  if (!fs.existsSync(file)) throw new Error(`${e.id}: missing source ${file}`);
  const full = decode(file, sr, e.af);
  const cut = (a, b) => full.slice(Math.max(0, Math.round(a * sr)), b == null ? full.length : Math.min(full.length, Math.round(b * sr)));
  let x;
  if (e.segs) x = e.segs.map(([a, b]) => cut(a, b)).reduce((acc, seg) => acc ? joinXfade(acc, seg, Math.round((e.join || 0.25) * sr)) : seg, null);
  else x = cut(e.in || 0, e.out);
  const info = { id: e.id };

  if (e.loop) {
    // Beds / loops: loudness-normalize, seamless crossfade loop, encode with wrap-around padding.
    if (e.flatten) flatten(x, sr, e.flatten);
    let y = makeLoop(x, sr, e.loop.xfade);
    const lufs = lufsOf(y, sr);
    const target = e.lufs ?? -24;
    let k = dbToLin(target - lufs);
    const pk = peakOf(y) * k;
    if (pk > dbToLin(D.peakDb)) k *= dbToLin(D.peakDb) / pk;    // never exceed the peak ceiling
    for (let i = 0; i < y.length; i++) y[i] *= k;
    const P = Math.min(LOOP_WRAP, y.length >> 1);
    const enc = new Float32Array(y.length + 2 * P);
    enc.set(y.subarray(y.length - P), 0); enc.set(y, P); enc.set(y.subarray(0, P), P + y.length);
    info.loop = true; info.loopStart = P / sr; info.loopEnd = (P + y.length) / sr; info.wrap = P;
    info.lufs = r2(lufsOf(y, sr)); info.body = y;
    return { x: enc, sr, kbps, info };
  }

  // One-shots.
  const pk0 = peakOf(x);
  if (pk0 <= 0) throw new Error(`${e.id}: silent cut`);
  if (e.trim !== false) {
    const thr = pk0 * dbToLin(e.onsetDb ?? D.onsetDb);
    let i0 = 0; while (i0 < x.length && Math.abs(x[i0]) < thr) i0++;
    x = x.slice(Math.max(0, i0 - Math.round((D.preRoll) * sr)));
  }
  const k = dbToLin(e.peakDb ?? D.peakDb) / pk0;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  // Tail: last 10 ms block whose peak is above tailDb (absolute, after normalization).
  const W = Math.round(sr * 0.01), tail = dbToLin(e.tailDb ?? D.tailDb);
  let end = x.length;
  for (let i = x.length - W; i >= 0; i -= W) { let m = 0; for (let j = 0; j < W; j++) m = Math.max(m, Math.abs(x[i + j])); if (m > tail) { end = Math.min(x.length, i + 2 * W); break; } }
  let fo = e.fadeOut ?? D.fadeOut;
  if (e.maxDur && end > Math.round(e.maxDur * sr)) { end = Math.round(e.maxDur * sr); if (e.fadeOut == null) fo = Math.min(0.3, e.maxDur * 0.25); }
  x = x.slice(0, end);
  fadeIn(x, Math.round((e.fadeIn ?? D.fadeIn) * sr));
  fadeOut(x, Math.round(fo * sr));
  if (e.f0) { const r = refineF0(x, sr, e.f0, e.f0At, e.f0Len); info.root = r2(r.midi); info.f0 = r2(r.f); }
  return { x, sr, kbps, info };
}

// ------------------------------------------------------------------------------------------------- verification

function verifyEncoded(mp3, x, sr, info) {
  const y = decode(mp3, sr);
  const v = { decodedLen: y.length, srcLen: x.length, peakDb: r2(linToDb(peakOf(y))) };
  // Alignment: the decoded start must line up with the source sample-exactly (loop points depend on it).
  // Lag with the least squared error over the first 8192 samples (codec error is far below any misalignment).
  let best = Infinity; v.lag = 0;
  const n = Math.min(8192, x.length);
  for (let lag = -1200; lag <= 1200; lag++) {
    let err = 0;
    for (let i = 0; i < n && err < best; i++) { const d = x[i] - (y[i + lag] || 0); err += d * d; }
    if (err < best) { best = err; v.lag = lag; }
  }
  // A few trailing samples of difference are a decoder end-padding quirk; harmless (silence after the fade).
  v.lenOk = v.lag === 0 && Math.abs(y.length - x.length) <= 64;
  v.clipOk = peakOf(y) < 1.0;
  if (info.loop) {
    const nom = { a: Math.round(info.loopStart * sr), b: Math.round(info.loopEnd * sr) };
    const nomClick = loopClick(y, nom.a, nom.b);
    const p = bestLoopPoints(y, nom.a, nom.b);
    const c = loopClick(y, p.a, p.b);
    info.loopStart = p.a / sr; info.loopEnd = p.b / sr;           // what the bank publishes
    v.loopShift = [p.a - nom.a, (p.b - p.a) - (nom.b - nom.a)];
    v.loopJumpNominal = r2(nomClick.jump);
    v.loopJump = r2(c.jump); v.loopP999 = r2(c.p999);
    v.loopOk = c.jump <= c.p999;                                     // the join is no bigger than 99.9 % of natural steps
  }
  return v;
}

// ------------------------------------------------------------------------------------------------- main

fs.mkdirSync(AUDIO_DIR, { recursive: true });
const metaPath = path.join(AUDIO_DIR, 'samples.json');
const prevMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')).samples || {} : {};
const meta = {};
const problems = [];
const t0 = Date.now();

for (const e of man.samples) {
  const bankDir = path.join(AUDIO_DIR, e.bank);
  fs.mkdirSync(bankDir, { recursive: true });
  const mp3 = path.join(bankDir, e.id + '.mp3');
  const rebuild = !BANKS_ONLY && (!ONLY || ONLY.has(e.id) || !fs.existsSync(mp3) || !prevMeta[e.id]);
  if (!rebuild) { if (!prevMeta[e.id]) throw new Error(`${e.id}: no previous metadata; run a full build`); meta[e.id] = prevMeta[e.id]; continue; }
  const { x, sr, kbps, info } = processSample(e);
  encodeMp3(x, sr, kbps, mp3);
  const buf = fs.readFileSync(mp3);
  const v = verifyEncoded(mp3, x, sr, info);
  const body = info.body || x;
  const m = {
    bank: e.bank, cat: e.cat, sport: e.sport, file: path.relative(ROOT, mp3).split(path.sep).join('/'),
    dur: r3(x.length / sr), sr, kbps, bytes: buf.length, b64: Math.ceil(buf.length / 3) * 4,
    peakDb: v.peakDb, loudDb: r2(loudOf(body, sr)), peakAt: r3(loudAt(body, sr).at), enc: lameGapless(buf),
  };
  if (!info.loop) { m.onsetMs = r2(onsetMs(x, sr)); if (e.inst) m.headDb = r2(headLoud(x, sr)); }
  for (const k of ['root', 'f0', 'loop', 'lufs']) if (info[k] !== undefined) m[k] = typeof info[k] === 'number' ? r3(info[k]) : info[k];
  if (info.loop) { m.loopStart = r6(info.loopStart); m.loopEnd = r6(info.loopEnd); }   // sample-accurate
  if (e.inst) m.inst = e.inst;
  if (e.who) m.who = e.who;
  m.check = v;
  if (!v.lenOk || !v.clipOk || v.loopOk === false) problems.push(`${e.id}: ${JSON.stringify(v)}`);
  meta[e.id] = m;
  process.stdout.write(`${e.id.padEnd(22)} ${m.dur.toFixed(3)}s ${String(kbps).padStart(3)}k ${String(buf.length).padStart(6)}B peak ${m.peakDb} loud ${m.loudDb}${m.onsetMs != null ? ' onset ' + m.onsetMs + 'ms' : ''}${m.root ? ' root ' + m.root : ''}${m.loop ? ` loop ${m.loopStart.toFixed(3)}-${m.loopEnd.toFixed(3)} join ${v.loopJump}x median step (nominal ${v.loopJumpNominal}x, natural p99.9 ${v.loopP999}x, shift ${v.loopShift}) ${m.lufs} LUFS` : ''}\n`);
}

// Playback gain: evens out short-term loudness within a category (instruments: within each instrument).
const groups = {};
for (const e of man.samples) { const g = e.inst ? 'inst:' + e.inst : 'cat:' + e.cat; (groups[g] = groups[g] || []).push(e); }
for (const [g, list] of Object.entries(groups)) {
  const target = g.startsWith('inst:') ? null : cfgOf(list[0]).loudTarget;
  if (target == null && g.startsWith('inst:')) {
    const lv = e => meta[e.id].headDb ?? meta[e.id].loudDb;
    const louds = list.map(lv).sort((a, b) => a - b);
    const med = louds[louds.length >> 1];
    const raw = list.map(e => dbToLin(med - lv(e)));
    const mx = Math.max(...raw);
    list.forEach((e, i) => { meta[e.id].gain = r3(Math.min(1, raw[i] / mx) * (e.gain ?? 1)); });
  } else {
    for (const e of list) meta[e.id].gain = target == null ? r3(e.gain ?? 1) : r3(Math.max(0.05, Math.min(1, dbToLin(target - meta[e.id].loudDb))) * (e.gain ?? 1));
  }
}

// Prune MP3s whose id left the manifest (keeps audio/ an exact mirror of the manifest).
const wanted = new Set(man.samples.map(e => `${e.bank}/${e.id}.mp3`));
for (const bank of BANKS) {
  const dir = path.join(AUDIO_DIR, bank);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (!wanted.has(`${bank}/${f}`)) { fs.unlinkSync(path.join(dir, f)); console.log('pruned stale', `${bank}/${f}`); }
}

fs.writeFileSync(metaPath, JSON.stringify({ _doc: 'GENERATED by tools/build-audio.mjs from tools/audio-sources.json — do not edit.', samples: meta }, null, 1) + '\n');

// ------------------------------------------------------------------------------------------------- banks

const sizes = {};
for (const bank of BANKS) {
  const list = man.samples.filter(e => e.bank === bank);
  let total = 0;
  const lines = list.map(e => {
    const m = meta[e.id];
    const b64 = fs.readFileSync(path.join(ROOT, m.file)).toString('base64');
    total += b64.length;
    const o = { gain: m.gain, cat: m.cat };
    if (m.sport) o.sport = m.sport;
    o.dur = m.dur;
    if (!m.loop && m.peakAt >= 0.1) o.peakAt = m.peakAt;      // swells / roars: when the loudest moment arrives
    if (m.loop) { o.loop = true; o.loopStart = m.loopStart; o.loopEnd = m.loopEnd; }
    if (m.root !== undefined) { o.root = m.root; o.inst = m.inst; }
    if (m.who) o.who = m.who;
    o.sr = m.sr;
    if (m.enc) o.enc = m.enc;
    return `  add(${JSON.stringify(e.id)}, ${JSON.stringify(o).slice(0, -1)},\n    b64: '${b64}' });`;
  });
  sizes[bank] = { count: list.length, b64: total };
  const name = bank === 'core' ? 'audio-bank.js' : `audio-bank-${bank}.js`;
  const what = bank === 'core' ? 'core bank: UI, generic, crowd, voices, ambience beds, sampled instruments + drums' : `${bank} bank: samples used only by the ${bank} sport`;
  const js = `/* Sunny Sports — ${name}: ${what}.
 * GENERATED by tools/build-audio.mjs from tools/audio-sources.json — do not edit by hand.
 * ${list.length} real recordings (all CC0 1.0, see audio/CREDITS.md), mono MP3, ${(total / 1024).toFixed(0)} KB of base64.
 * Registers into SS.audioBank.samples[id] = { b64, gain, cat, sport?, dur, peakAt?, loop?, loopStart?, loopEnd?, root?, inst?, who?, sr, enc? }
 * and never clobbers samples registered by other banks. Decoding is left to js/audio.js (lazy, synthesis fallback).
 */
(function () {
  'use strict';
  var SS = window.SS = window.SS || {};
  var bank = SS.audioBank = SS.audioBank || {};
  var samples = bank.samples = bank.samples || {};
  var banks = bank.banks = bank.banks || {};
  banks[${JSON.stringify(bank)}] = { count: ${list.length}, ids: [] };
  function add(id, s) { samples[id] = s; banks[${JSON.stringify(bank)}].ids.push(id); }
${lines.join('\n')}
})();
`;
  fs.writeFileSync(path.join(JS_DIR, name), js);
}

// ------------------------------------------------------------------------------------------------- credits

const bySource = {};
for (const e of man.samples) (bySource[e.src] = bySource[e.src] || []).push(e.id);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const link = (u) => u.split(' ').map(x => /^https?:/.test(x) ? `<${x}>` : x).join(' ');
let md = `# Sunny Sports — audio credits

Every sound effect, crowd, voice, ambience bed and sampled instrument in the game is a **real recording**
released under **CC0 1.0 (public domain dedication)**. CC0 requires no attribution; we credit the authors anyway, with thanks.
Files in \`audio/\` and the base64 banks in \`js/audio-bank*.js\` are edited derivatives (cut, mono, faded,
normalized, looped, MP3-encoded) produced by \`tools/build-audio.mjs\` from \`tools/audio-sources.json\`.

| Work | Author | Original | License | Obtained via | Used as (sample ids) |
|---|---|---|---|---|---|
`;
for (const [key, ids] of Object.entries(bySource)) {
  const s = man.sources[key];
  md += `| ${esc(s.title)} | ${esc(s.author)} | ${link(s.url)} | ${s.license} | ${link(s.via)} | ${ids.map(i => '`' + i + '`').join(' ')} |\n`;
}
md += `\nTotals: ${Object.entries(sizes).map(([b, s]) => `${b} ${s.count} samples / ${(s.b64 / 1024).toFixed(0)} KB base64`).join(' · ')}.\n`;
fs.writeFileSync(path.join(AUDIO_DIR, 'CREDITS.md'), md);

// ------------------------------------------------------------------------------------------------- report

const all = Object.values(sizes).reduce((a, s) => a + s.b64, 0);
console.log('\nbanks:', Object.entries(sizes).map(([b, s]) => `${b}=${s.count} samples ${(s.b64 / 1024).toFixed(0)}KB`).join('  '), ` total ${(all / 1048576).toFixed(2)} MB base64`);
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }
