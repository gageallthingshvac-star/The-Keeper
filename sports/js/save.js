/* Sunny Sports — save.js
 * Persistence: profiles, settings, skill levels, records, stats, medals and seen-flags.
 * Stored as one JSON document in localStorage. When storage is unavailable (Safari private
 * mode, blocked cookies, quota) everything keeps working in memory for the session.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const U = SS.util;

  // ---------------------------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------------------------

  const STORAGE_KEY = 'sunnysports.v1';
  const SCHEMA_VERSION = 1;
  const WRITE_DELAY_MS = 500;
  const HISTORY_LENGTH = 20;
  const LEVEL_MAX = 2500;
  const QUALITIES = ['auto', 'low', 'medium', 'high'];

  const RANKS = [
    { id: 'rookie', name: 'Rookie', min: 0 },
    { id: 'amateur', name: 'Amateur', min: 300 },
    { id: 'pro', name: 'Pro', min: 1000 },
    { id: 'star', name: 'Star', min: 1600 },
    { id: 'legend', name: 'Legend', min: 2200 },
  ];

  const DEFAULT_SETTINGS = {
    music: 0.6, sfx: 0.9, haptics: true, quality: 'auto', hints: true, leftHanded: false,
  };

  function defaults() {
    return {
      version: SCHEMA_VERSION,
      created: Date.now(),
      profiles: [],
      activeProfile: null,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      skills: {},    // [profileId][sportId] -> { level, history, games, best }
      records: {},   // [sportId][key] -> { value, label, fmt, profileId, name, date }
      stats: {},     // [sportId][profileId] -> { [key]: number }
      medals: {},    // [sportId][medalId] -> { profileId, name, date }
      seen: {},      // [flag] -> true
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Storage backend (localStorage with an in-memory fallback)
  // ---------------------------------------------------------------------------------------------

  const store = (function detectStorage() {
    try {
      const ls = window.localStorage;
      const probe = '__ss_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (err) {
      return null;
    }
  })();
  let memoryCopy = null;

  function readRaw() {
    if (!store) return memoryCopy;
    try { return store.getItem(STORAGE_KEY); } catch (err) { return memoryCopy; }
  }

  function writeRaw(text) {
    memoryCopy = text;
    if (!store) return;
    try { store.setItem(STORAGE_KEY, text); } catch (err) { /* quota/private mode: memory copy stays authoritative */ }
  }

  // ---------------------------------------------------------------------------------------------
  // Load, migrate, validate
  // ---------------------------------------------------------------------------------------------

  /** Schema migrations: MIGRATIONS[n] upgrades a version-n document to version n+1. */
  const MIGRATIONS = {};

  function migrate(doc) {
    let v = Number(doc.version) || 1;
    while (v < SCHEMA_VERSION && MIGRATIONS[v]) {
      doc = MIGRATIONS[v](doc) || doc;
      v += 1;
      doc.version = v;
    }
    doc.version = SCHEMA_VERSION;
    return doc;
  }

  const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);

  function normalizeSettings(s) {
    const out = Object.assign({}, DEFAULT_SETTINGS);
    if (!isObj(s)) return out;
    for (const key of Object.keys(s)) out[key] = s[key];
    out.music = U.clamp(Number(out.music), 0, 1);
    out.sfx = U.clamp(Number(out.sfx), 0, 1);
    if (!isFinite(out.music)) out.music = DEFAULT_SETTINGS.music;
    if (!isFinite(out.sfx)) out.sfx = DEFAULT_SETTINGS.sfx;
    out.haptics = !!out.haptics;
    out.hints = !!out.hints;
    out.leftHanded = !!out.leftHanded;
    if (QUALITIES.indexOf(out.quality) < 0) out.quality = DEFAULT_SETTINGS.quality;
    return out;
  }

  function normalize(doc) {
    const base = defaults();
    if (!isObj(doc)) return base;
    doc = migrate(doc);
    const out = base;
    out.created = Number(doc.created) || base.created;
    out.profiles = Array.isArray(doc.profiles) ? doc.profiles.filter(p => isObj(p) && p.id) : [];
    out.activeProfile = out.profiles.some(p => p.id === doc.activeProfile) ? doc.activeProfile : null;
    out.settings = normalizeSettings(doc.settings);
    for (const key of ['skills', 'records', 'stats', 'medals', 'seen']) {
      if (isObj(doc[key])) out[key] = doc[key];
    }
    return out;
  }

  function load() {
    const raw = readRaw();
    if (!raw) return defaults();
    try { return normalize(JSON.parse(raw)); } catch (err) { return defaults(); }
  }

  let data = load();

  // ---------------------------------------------------------------------------------------------
  // Writing (debounced) + flush when the page is backgrounded or closed
  // ---------------------------------------------------------------------------------------------

  let writeTimer = 0;

  function flush() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = 0; }
    try { writeRaw(JSON.stringify(data)); } catch (err) { console.error('[SS] save failed:', err); }
  }

  function dirty() {
    if (writeTimer) return;
    writeTimer = setTimeout(flush, WRITE_DELAY_MS);
  }

  function flushIfPending() { if (writeTimer) flush(); }
  window.addEventListener('pagehide', flushIfPending);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushIfPending(); });

  const events = U.emitter();

  function reset() {
    data = defaults();
    flush();
    events.emit('reset');
  }

  // ---------------------------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------------------------

  function profiles() { return data.profiles; }

  function getProfile(id) {
    if (id == null) return null;
    return data.profiles.find(p => p.id === id) || null;
  }

  function upsertProfile(p) {
    if (!isObj(p)) return null;
    if (!p.id) p.id = U.uid();
    if (!p.created) p.created = Date.now();
    const i = data.profiles.findIndex(q => q.id === p.id);
    if (i >= 0) data.profiles[i] = p; else data.profiles.push(p);
    if (!data.activeProfile && !p.isGuest) data.activeProfile = p.id;
    dirty();
    events.emit('profile', p);
    return p;
  }

  function deleteProfile(id) {
    const i = data.profiles.findIndex(p => p.id === id);
    if (i < 0) return;
    data.profiles.splice(i, 1);
    delete data.skills[id];
    for (const sportId of Object.keys(data.stats)) delete data.stats[sportId][id];
    if (data.activeProfile === id) {
      const next = data.profiles.find(p => !p.isGuest);
      data.activeProfile = next ? next.id : null;
    }
    dirty();
    events.emit('profile', null);
  }

  function activeProfile() { return getProfile(data.activeProfile); }

  function setActiveProfile(id) {
    if (!getProfile(id) || data.activeProfile === id) return;
    data.activeProfile = id;
    dirty();
    events.emit('active', id);
  }

  // ---------------------------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------------------------

  function setSetting(key, value) {
    if (key === 'quality' && QUALITIES.indexOf(value) < 0) return;
    if (data.settings[key] === value) return;
    data.settings[key] = value;
    dirty();
    events.emit('setting', key, value);
  }

  // ---------------------------------------------------------------------------------------------
  // Skill levels & ranks
  // ---------------------------------------------------------------------------------------------

  /** Rank for a level. Extension: `index` and `next` (the next rank or null) for progress bars. */
  function rankFor(level) {
    const lv = U.clamp(Number(level) || 0, 0, LEVEL_MAX);
    let index = 0;
    for (let i = 0; i < RANKS.length; i++) if (lv >= RANKS[i].min) index = i;
    const r = RANKS[index];
    return { id: r.id, name: r.name, min: r.min, index, next: RANKS[index + 1] || null };
  }

  function skill(profileId, sportId) {
    const key = profileId == null ? '_' : profileId;
    const byProfile = data.skills[key] || (data.skills[key] = {});
    let s = byProfile[sportId];
    if (!isObj(s)) s = byProfile[sportId] = { level: 0, history: [], games: 0, best: 0 };
    if (!Array.isArray(s.history)) s.history = [];
    return s;
  }

  /** Applies a (rounded) delta, clamps to 0..2500, appends history and counts the game. */
  function addSkill(profileId, sportId, delta) {
    const s = skill(profileId, sportId);
    const before = s.level;
    const after = U.clamp(Math.round(before + (Number(delta) || 0)), 0, LEVEL_MAX);
    s.level = after;
    s.games = (s.games || 0) + 1;
    s.best = Math.max(s.best || 0, after);
    s.history.push(after);
    if (s.history.length > HISTORY_LENGTH) s.history.splice(0, s.history.length - HISTORY_LENGTH);
    dirty();
    return { before, after, rankBefore: rankFor(before), rankAfter: rankFor(after) };
  }

  // ---------------------------------------------------------------------------------------------
  // Records, stats, medals, seen-flags
  // ---------------------------------------------------------------------------------------------

  function record(sportId, key, value, opts = {}) {
    const higherIsBetter = opts.higherIsBetter !== false;
    const bySport = data.records[sportId] || (data.records[sportId] = {});
    const prev = bySport[key];
    const previous = prev ? prev.value : null;
    const v = Number(value);
    if (!isFinite(v)) return { isNew: false, previous };
    const isNew = previous == null || (higherIsBetter ? v > previous : v < previous);
    if (isNew) {
      const profile = getProfile(opts.profileId);
      bySport[key] = {
        value: v,
        label: opts.label || (prev && prev.label) || key,
        fmt: typeof opts.fmt === 'string' ? opts.fmt : (prev && prev.fmt) || null,
        profileId: opts.profileId || null,
        name: profile ? profile.name : null,
        date: Date.now(),
      };
      dirty();
    }
    return { isNew, previous };
  }

  function records(sportId) { return data.records[sportId] || {}; }

  function stat(sportId, profileId, key, inc = 1) {
    const bySport = data.stats[sportId] || (data.stats[sportId] = {});
    const pid = profileId == null ? '_' : profileId;
    const s = bySport[pid] || (bySport[pid] = {});
    s[key] = (Number(s[key]) || 0) + (Number(inc) || 0);
    dirty();
    return s[key];
  }

  function stats(sportId, profileId) {
    const bySport = data.stats[sportId];
    return (bySport && bySport[profileId == null ? '_' : profileId]) || {};
  }

  function awardMedal(sportId, medalId, profileId) {
    const bySport = data.medals[sportId] || (data.medals[sportId] = {});
    if (bySport[medalId]) return false;
    const profile = getProfile(profileId);
    bySport[medalId] = { profileId: profileId || null, name: profile ? profile.name : null, date: Date.now() };
    dirty();
    events.emit('medal', sportId, medalId, profileId);
    return true;
  }

  function medals(sportId) { return new Set(Object.keys(data.medals[sportId] || {})); }

  /** Extension: who earned a medal and when → { profileId, name, date } | null. */
  function medalInfo(sportId, medalId) { return (data.medals[sportId] || {})[medalId] || null; }

  function isSeen(flag) { return !!data.seen[flag]; }

  function seen(flag) {
    const was = !!data.seen[flag];
    if (!was) { data.seen[flag] = true; dirty(); }
    return was;
  }

  // ---------------------------------------------------------------------------------------------
  // Public API (`data` and `settings` are live getters so reset() never leaves stale references)
  // ---------------------------------------------------------------------------------------------

  SS.save = {
    dirty, flush, reset, events,
    profiles, getProfile, upsertProfile, deleteProfile, activeProfile, setActiveProfile,
    setSetting,
    skill, addSkill, rankFor, RANKS, LEVEL_MAX,
    record, records, stat, stats, awardMedal, medals, medalInfo, seen, isSeen,
    persistent: !!store,
  };
  Object.defineProperty(SS.save, 'data', { get: () => data, enumerable: true });
  Object.defineProperty(SS.save, 'settings', { get: () => data.settings, enumerable: true });
})();
