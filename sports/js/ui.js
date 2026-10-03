/* Sunny Sports — ui.js
 * The UI kit (DESIGN §6.7): DOM helpers, icons, buttons, banners, toasts, gesture hints,
 * floating labels, meters, modals (choose / confirm / how-to), countdown, title cards,
 * the core pause button, transitions, portraits, score pop-ups and DOM confetti.
 * Pure presentation: it never touches game state. main.js drives the screens with it.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const U = SS.util;

  // ---------------------------------------------------------------------------------------------
  // Layers & small helpers
  // ---------------------------------------------------------------------------------------------

  const byId = id => document.getElementById(id);
  const root = byId('ss-root');
  const hud = byId('ss-hud');
  const screens = byId('ss-screens');
  const overlay = byId('ss-overlay');
  const fx = byId('ss-fx');
  const fade = byId('ss-fade');

  const events = U.emitter();
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function sfx(name, opts) {
    if (SS.audio && typeof SS.audio.sfx === 'function') SS.audio.sfx(name, opts);
  }

  /** Short vibration when the player allows haptics and the device supports it. */
  function haptic(ms = 10) {
    const s = SS.save && SS.save.settings;
    if (s && !s.haptics) return;
    if (!navigator.vibrate) return;
    // Chrome logs an error for vibrate() before the first user gesture; skip it until then.
    const ua = navigator.userActivation;
    if (ua && !ua.hasBeenActive) return;
    try { navigator.vibrate(ms); } catch (err) { /* not allowed right now */ }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Injects a <style id=...> once. */
  function css(id, cssText) {
    if (byId(id)) return byId(id);
    const st = document.createElement('style');
    st.id = id;
    st.textContent = cssText;
    document.head.appendChild(st);
    return st;
  }

  /** Tiny DOM helper: el('div', 'a b', '<b>html</b>'). */
  function el(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------------------------------------------------------------------------------------------
  // Icons (24×24, round caps, currentColor)
  // ---------------------------------------------------------------------------------------------

  function gearPath() {
    const pts = [];
    const teeth = 8;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const w = Math.PI / teeth * 0.52;
      for (const [r, da] of [[7.4, -w * 1.25], [10, -w * 0.62], [10, w * 0.62], [7.4, w * 1.25]]) {
        pts.push((12 + Math.cos(a + da) * r).toFixed(2) + ' ' + (12 + Math.sin(a + da) * r).toFixed(2));
      }
    }
    return 'M' + pts.join('L') + 'Z';
  }

  const STAR_PATH = 'M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z';

  const ICONS = {
    pause: '<rect x="6" y="5" width="4.6" height="14" rx="1.7" fill="currentColor" stroke="none"/><rect x="13.4" y="5" width="4.6" height="14" rx="1.7" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.93l10-6.4a1.1 1.1 0 0 0 0-1.86l-10-6.4A1.1 1.1 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>',
    home: '<path d="M3.8 11.4 12 4.2l8.2 7.2"/><path d="M6.3 9.6v9.9h4.1v-5.2h3.2v5.2h4.1V9.6"/>',
    retry: '<path d="M5 12.5a7 7 0 1 0 2.1-5"/><path d="M6.6 3.6l.5 3.9 3.9-.5"/>',
    gear: '<path d="' + gearPath() + '"/><circle cx="12" cy="12" r="2.9"/>',
    trophy: '<path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6.2H4.6a2.8 2.8 0 0 0 3.3 4.1"/><path d="M16.5 6.2h2.9a2.8 2.8 0 0 1-3.3 4.1"/><path d="M12 13.8v3"/><path d="M8.4 20.2h7.2l-.8-3.4H9.2z"/>',
    medal: '<path d="M8 3l2.6 6.2M16 3l-2.6 6.2"/><circle cx="12" cy="14.8" r="5.6"/><path d="M12 12.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="currentColor" stroke="none"/>',
    user: '<circle cx="12" cy="8.4" r="4"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0"/>',
    users: '<circle cx="9" cy="8.6" r="3.5"/><path d="M2.8 19.6a6.2 6.2 0 0 1 12.4 0"/><path d="M15 5.4a3.4 3.4 0 0 1 0 6.5"/><path d="M17.4 14a6 6 0 0 1 3.8 5.6"/>',
    back: '<path d="M19.5 12H5"/><path d="M11 5.8 4.8 12l6.2 6.2"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.6l4.6 4.6L19.2 7.6"/>',
    star: '<path d="' + STAR_PATH + '" fill="currentColor" stroke-width="1.2"/>',
    left: '<path d="M14.8 5.5 8.3 12l6.5 6.5"/>',
    right: '<path d="M9.2 5.5l6.5 6.5-6.5 6.5"/>',
    up: '<path d="M5.5 14.8 12 8.3l6.5 6.5"/>',
    down: '<path d="M5.5 9.2 12 15.7l6.5-6.5"/>',
    'rotate-left': '<path d="M4.6 13a7.6 7.6 0 1 0 2.4-6.2"/><path d="M6.2 2.9l.8 4-4 .8"/>',
    'rotate-right': '<path d="M19.4 13A7.6 7.6 0 1 1 17 6.8"/><path d="M17.8 2.9l-.8 4 4 .8"/>',
    map: '<path d="M3.6 6.4 9 4l6 2.4 5.4-2.4v13.6L15 20l-6-2.4-5.4 2.4z"/><path d="M9 4v13.6M15 6.4V20"/>',
    sound: '<path d="M4 9.4h3.4L12 5.2v13.6l-4.6-4.2H4z" fill="currentColor"/><path d="M15.6 8.8a4.4 4.4 0 0 1 0 6.4"/><path d="M18.2 6.2a8.2 8.2 0 0 1 0 11.6"/>',
    mute: '<path d="M4 9.4h3.4L12 5.2v13.6l-4.6-4.2H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><circle cx="12" cy="7.7" r="1.2" fill="currentColor" stroke="none"/>',
    flag: '<path d="M6 21V3.6"/><path d="M6 4.2h11.4l-2.6 4 2.6 4H6" fill="currentColor"/>',
    wind: '<path d="M3 9h11.5a2.8 2.8 0 1 0-2.8-2.8"/><path d="M3 13.2h15a3 3 0 1 1-3 3"/><path d="M3 17.4h6.5"/>',
    edit: '<path d="M4.5 19.5l1-4.4L15.8 4.8a2.1 2.1 0 0 1 3 0l.4.4a2.1 2.1 0 0 1 0 3L8.9 18.5z"/><path d="M13.8 6.8l3.4 3.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.2h9.2L17.5 7"/><path d="M10.2 10.6v5.2M13.8 10.6v5.2"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="8.6" cy="8.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.35" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.3 10.5V8a3.7 3.7 0 0 1 7.4 0v2.5"/>',
    sparkle: '<path d="M12 3.5l1.9 5.3 5.3 1.9-5.3 1.9L12 17.9l-1.9-5.3-5.3-1.9 5.3-1.9z" fill="currentColor" stroke-width="1.2"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none"/>',
    chart: '<path d="M4 19.5h16"/><path d="M7 16v-4M12 16V7M17 16v-6.5"/>',
    bulb: '<path d="M9 17.6h6"/><path d="M10 20.6h4"/><path d="M8.3 14.6a6 6 0 1 1 7.4 0c-.7.5-1 1.2-1 2v1H9.3v-1c0-.8-.3-1.5-1-2z"/>',
    crown: '<path d="M4 17.5 3 7.5l5 4.2 4-6.2 4 6.2 5-4.2-1 10z" fill="currentColor"/><path d="M5 20.4h14"/>',
  };

  /** SVG markup for a named icon (unknown names render the info glyph). */
  function icon(name) {
    const body = ICONS[name] || ICONS.info;
    return '<svg class="ss-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  // ---------------------------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------------------------

  /** kind: 'primary' | 'secondary' | 'ghost' | 'round'. Extra opts: className, title, haptic. */
  function button(label, onClick, opts = {}) {
    const kind = opts.kind || 'primary';
    const b = el('button', 'ss-btn ' + kind + (opts.className ? ' ' + opts.className : ''));
    b.type = 'button';
    const showLabel = kind !== 'round' && label;
    b.innerHTML = (opts.icon ? icon(opts.icon) : '') + (showLabel ? '<span class="ss-btn-label">' + esc(label) + '</span>' : '');
    if (label) b.setAttribute('aria-label', label);
    if (kind === 'round' && label) b.title = label;
    b.addEventListener('click', e => {
      if (b.disabled || b.classList.contains('is-busy')) return;
      if (opts.sfx !== null) sfx(opts.sfx || 'ui_select');
      haptic(opts.haptic || 8);
      if (onClick) onClick(e);
    });
    return b;
  }

  // ---------------------------------------------------------------------------------------------
  // Big outlined letters (banners, title card, logo): an outline layer under a gradient fill layer
  // ---------------------------------------------------------------------------------------------

  /** Builds per-letter markup; words never break, letters pop in with a stagger index (--i). */
  function letters(text, start = 0) {
    let i = start;
    return String(text).split(/\s+/).filter(Boolean).map(word => {
      const chars = Array.from(word).map(c => {
        const ch = esc(c);
        return '<span class="ss-ch" style="--i:' + (i++) + '"><span class="o" aria-hidden="true">' + ch + '</span><span class="f">' + ch + '</span></span>';
      }).join('');
      i += 1;
      return '<span class="ss-word">' + chars + '</span>';
    }).join(' ');
  }

  // ---------------------------------------------------------------------------------------------
  // Banner
  // ---------------------------------------------------------------------------------------------

  let activeBanner = null;

  function dismissBannerEntry(b, fast) {
    if (!b || b.done) return;
    b.done = true;
    clearTimeout(b.timer);
    if (activeBanner === b) activeBanner = null;
    b.el.classList.add('is-out');
    setTimeout(() => { b.el.remove(); b.resolve(); }, fast ? 120 : 320);
  }

  /** Dismisses the banner on screen (if any). fast: a quick 0.12 s exit instead of the normal one. */
  function dismissBanner(fast) { if (activeBanner) dismissBannerEntry(activeBanner, !!fast); }

  /**
   * Big center pop. kind: 'great' | 'good' | 'info' | 'bad' | 'huge'. Plays no sound.
   * opts.caseSensitive keeps the text's own case (banners are uppercase by default).
   * Returns a promise (resolves when the banner is gone) with .dismiss(fast) to end it early.
   */
  function banner(text, opts = {}) {
    const kind = opts.kind || 'great';
    const duration = opts.duration == null ? 1.6 : Math.max(0.3, Number(opts.duration));
    if (activeBanner) dismissBannerEntry(activeBanner, true);
    const wrap = el('div', 'ss-banner ' + kind + (opts.caseSensitive ? ' keep-case' : ''));
    wrap.setAttribute('role', 'status');
    if (opts.color) wrap.style.setProperty('--stroke', opts.color);
    let html = '';
    if (kind === 'huge') html += '<div class="ss-banner-rays"></div>';
    html += '<div class="ss-banner-text">' + letters(text) + '</div>';
    if (opts.sub) html += '<div class="ss-banner-sub">' + esc(opts.sub) + '</div>';
    wrap.innerHTML = html;
    fx.appendChild(wrap);
    let entry = null;
    const promise = new Promise(resolve => {
      entry = { el: wrap, resolve, done: false, timer: 0 };
      entry.timer = setTimeout(() => dismissBannerEntry(entry), duration * 1000);
      activeBanner = entry;
    });
    promise.dismiss = fast => dismissBannerEntry(entry, !!fast);
    promise.el = wrap;
    return promise;
  }

  // ---------------------------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------------------------

  let toastBox = null;

  /** During play, toasts sit just below the sport's top-center HUD row (measured, not assumed). */
  function placeToasts() {
    if (!root.classList.contains('is-playing')) { toastBox.style.top = ''; return; }
    let bottom = 0;
    for (const n of hud.querySelectorAll('.ss-hud-top')) {
      const r = n.getBoundingClientRect();
      if (r.height > 0 && r.width > 0 && !n.classList.contains('ss-hidden')) bottom = Math.max(bottom, r.bottom);
    }
    const rootTop = root.getBoundingClientRect().top;
    toastBox.style.top = bottom > 0 ? Math.round(bottom - rootTop + 8) + 'px' : '';
  }

  function toast(text, opts = {}) {
    if (!toastBox || !toastBox.isConnected) { toastBox = el('div', 'ss-toasts'); fx.appendChild(toastBox); }
    placeToasts();
    const t = el('div', 'ss-toast', (opts.icon ? icon(opts.icon) : '') + '<span>' + esc(text) + '</span>');
    toastBox.appendChild(t);
    while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
    const dur = (opts.duration == null ? 2 : Number(opts.duration)) * 1000;
    setTimeout(() => {
      t.classList.add('is-out');
      setTimeout(() => t.remove(), 300);
    }, dur);
  }

  // ---------------------------------------------------------------------------------------------
  // Gesture glyphs: an animated pointing hand (SVG + SMIL) shared by hint() and howTo()
  // ---------------------------------------------------------------------------------------------

  // Each gesture: motion path (fingertip coordinates in a 120×150 area; the viewBox adds room for the
  // hand below and beside the fingertip), loop duration, keyPoints/keyTimes
  // along the path, and when the finger is pressed (fraction of the loop).
  const GESTURES = {
    'swipe-up': { path: 'M60 122 L60 30', dur: 1.7, kp: '0;0;1;1', kt: '0;0.22;0.46;1', press: [0.14, 0.47] },
    'swipe-up-curve': { path: 'M52 124 C 30 92, 98 70, 70 28', dur: 1.9, kp: '0;0;1;1', kt: '0;0.2;0.48;1', press: [0.12, 0.49] },
    'swipe-left': { path: 'M100 78 L20 78', dur: 1.6, kp: '0;0;1;1', kt: '0;0.22;0.46;1', press: [0.14, 0.47] },
    'swipe-right': { path: 'M20 78 L100 78', dur: 1.6, kp: '0;0;1;1', kt: '0;0.22;0.46;1', press: [0.14, 0.47] },
    'swipe-across': { path: 'M12 100 Q 60 64 108 70', dur: 1.5, kp: '0;0;1;1', kt: '0;0.26;0.42;1', press: [0.18, 0.43] },
    'drag-down-up': { path: 'M60 52 L60 116 L60 20', dur: 2.4, kp: '0;0;0.4;0.4;1;1', kt: '0;0.1;0.44;0.56;0.68;1', press: [0.06, 0.69] },
    'drag-h': { path: 'M60 80 L22 80 L98 80 L60 80', dur: 2.6, kp: '0;0;0.25;0.75;1;1', kt: '0;0.1;0.32;0.7;0.86;1', press: [0.06, 0.88] },
    tap: { path: 'M60 78 L60 78', dur: 1.3, kp: '0;1', kt: '0;1', press: [0.3, 0.42], ripple: true, still: true },
    hold: { path: 'M60 78 L60 78', dur: 2.2, kp: '0;1', kt: '0;1', press: [0.14, 0.82], ring: true, still: true },
  };

  const HAND =
    '<g class="hand-shape">' +
    '<g fill="#24324A" stroke="#24324A" stroke-width="5" stroke-linejoin="round">' +
    '<rect x="-6" y="-1" width="12" height="30" rx="6"/><rect x="-9" y="17" width="30" height="29" rx="11"/>' +
    '<circle cx="11" cy="19.5" r="5.5"/><circle cx="17.5" cy="23.5" r="5"/>' +
    '<ellipse cx="-9" cy="31" rx="5" ry="8" transform="rotate(-24 -9 31)"/><rect x="-5" y="43" width="23" height="10" rx="3.5"/></g>' +
    '<g fill="#fff"><rect x="-6" y="-1" width="12" height="30" rx="6"/><rect x="-9" y="17" width="30" height="29" rx="11"/>' +
    '<circle cx="11" cy="19.5" r="5.5"/><circle cx="17.5" cy="23.5" r="5"/>' +
    '<ellipse cx="-9" cy="31" rx="5" ry="8" transform="rotate(-24 -9 31)"/></g>' +
    '<rect x="-5" y="43" width="23" height="10" rx="3.5" fill="#1FA2FF"/>' +
    '<path d="M-2.5 5.5h5" stroke="#D5DEEA" stroke-width="2" stroke-linecap="round"/>' +
    '</g>';

  /** Values for a SMIL animation that is `a` outside the press window and `b` inside it. */
  function pressAnim(attr, a, b, g) {
    const [p0, p1] = g.press;
    const e = 0.035;
    return '<animate attributeName="' + attr + '" dur="' + g.dur + 's" repeatCount="indefinite" calcMode="linear" ' +
      'keyTimes="0;' + p0 + ';' + (p0 + e) + ';' + p1 + ';' + Math.min(0.999, p1 + e) + ';1" values="' +
      [a, a, b, b, a, a].join(';') + '"/>';
  }

  /** Inline SVG markup for an animated gesture glyph. */
  function gestureSVG(name) {
    const g = GESTURES[name] || GESTURES.tap;
    const kp = g.kp.split(';').map(Number);
    const trailValues = kp.map(v => (1 - v).toFixed(3)).join(';');
    const visible = '<animate attributeName="opacity" dur="' + g.dur + 's" repeatCount="indefinite" ' +
      'keyTimes="0;0.06;0.86;0.98;1" values="0;1;1;0;0"/>';
    let extra = '';
    if (g.ripple) {
      const t = g.press[0];
      extra += '<circle class="g-ripple" r="8" fill="none" stroke="#1FA2FF" stroke-width="4" opacity="0">' +
        '<animate attributeName="r" dur="' + g.dur + 's" repeatCount="indefinite" keyTimes="0;' + t + ';' + (t + 0.3) + ';1" values="8;8;30;30"/>' +
        '<animate attributeName="opacity" dur="' + g.dur + 's" repeatCount="indefinite" keyTimes="0;' + t + ';' + (t + 0.3) + ';1" values="0;0.8;0;0"/></circle>';
    }
    if (g.ring) {
      const [p0, p1] = g.press;
      extra += '<circle r="22" fill="none" stroke="#FFC93C" stroke-width="5" stroke-linecap="round" pathLength="1" ' +
        'stroke-dasharray="1 1" transform="rotate(-90)" opacity="0.95">' +
        '<animate attributeName="stroke-dashoffset" dur="' + g.dur + 's" repeatCount="indefinite" keyTimes="0;' + p0 + ';' + p1 + ';1" values="1;1;0;0"/>' +
        pressAnim('opacity', 0, 0.95, g) + '</circle>';
    }
    const motion = '<animateMotion dur="' + g.dur + 's" repeatCount="indefinite" calcMode="linear" keyPoints="' + g.kp +
      '" keyTimes="' + g.kt + '" path="' + g.path + '"/>';
    const trail = g.still ? '' :
      '<path d="' + g.path + '" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9"/>' +
      '<path d="' + g.path + '" fill="none" stroke="#FFC93C" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1">' +
      '<animate attributeName="stroke-dashoffset" dur="' + g.dur + 's" repeatCount="indefinite" calcMode="linear" keyTimes="' + g.kt + '" values="' + trailValues + '"/>' +
      visible + '</path>';
    return '<svg class="ss-gesture" viewBox="-6 0 146 184" aria-hidden="true">' + trail + '<g>' + motion + extra +
      '<circle r="10" fill="rgba(31,162,255,.35)" opacity="0">' + pressAnim('opacity', 0, 1, g) + '</circle>' +
      '<g>' + visible + '<g>' +
      '<animateTransform attributeName="transform" type="scale" dur="' + g.dur + 's" repeatCount="indefinite" calcMode="linear" ' +
      'keyTimes="0;' + g.press[0] + ';' + (g.press[0] + 0.035) + ';' + g.press[1] + ';' + Math.min(0.999, g.press[1] + 0.035) + ';1" values="1.08;1.08;0.92;0.92;1.08;1.08"/>' +
      HAND + '</g></g></g></svg>';
  }

  // ---------------------------------------------------------------------------------------------
  // Hint
  // ---------------------------------------------------------------------------------------------

  /** Animated hand glyph demonstrating a gesture. x, y: css px anchor (default bottom center). */
  function hint(opts = {}) {
    const s = SS.save && SS.save.settings;
    const node = el('div', 'ss-hint');
    node.innerHTML = gestureSVG(opts.gesture) + (opts.text ? '<div class="ss-hint-text">' + esc(opts.text) + '</div>' : '');
    // a narrower text box must be set before an anchored hint is measured and clamped
    if (opts.textMaxWidth && node.lastElementChild) node.lastElementChild.style.maxWidth = opts.textMaxWidth + 'px';
    let hidden = false;
    const handle = {
      el: node,
      hide() {
        if (hidden) return;
        hidden = true;
        node.classList.add('is-out');
        setTimeout(() => node.remove(), 260);
      },
    };
    if (s && s.hints === false) { hidden = true; return handle; }
    const at = opts.x != null || opts.y != null;
    if (at) {
      node.classList.add('at');
      node.style.left = (opts.x == null ? fx.clientWidth / 2 : opts.x) + 'px';
      node.style.top = (opts.y == null ? fx.clientHeight * 0.7 : opts.y) + 'px';
    }
    fx.appendChild(node);
    if (at) clampHint(node, opts.x, opts.y);
    return handle;
  }

  let insetProbe = null;
  /** Safe-area insets in px (resolved from the --sat/--sar/--sab/--sal variables). */
  function safeInsets() {
    if (!insetProbe || !insetProbe.isConnected) {
      insetProbe = el('div');
      insetProbe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:var(--sat) var(--sar) var(--sab) var(--sal)';
      root.appendChild(insetProbe);
    }
    const cs = getComputedStyle(insetProbe);
    return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  }

  /**
   * Keeps an anchored hint on screen: the box is sized to its content (not to the room right of the
   * anchor), then its center is clamped so the whole glyph + text stay inside the safe area.
   */
  function clampHint(node, x, y) {
    const W = fx.clientWidth, H = fx.clientHeight;
    if (!W || !H) return;
    const si = safeInsets(), m = 8;
    const left = si.left + m, right = W - si.right - m, top = si.top + m, bottom = H - si.bottom - m;
    const w = Math.min(node.offsetWidth, right - left), h = Math.min(node.offsetHeight, bottom - top);
    const cx = x == null ? W / 2 : x, cy = y == null ? H * 0.7 : y;
    node.style.left = Math.round(U.clamp(cx, left + w / 2, Math.max(left + w / 2, right - w / 2))) + 'px';
    node.style.top = Math.round(U.clamp(cy, top + h / 2, Math.max(top + h / 2, bottom - h / 2))) + 'px';
  }

  // ---------------------------------------------------------------------------------------------
  // Floating label & meter (live in the HUD so they are cleared on exit)
  // ---------------------------------------------------------------------------------------------

  function label(text, opts = {}) {
    const node = el('div', 'ss-label' + (opts.className ? ' ' + opts.className : ''));
    node.textContent = text == null ? '' : text;
    hud.appendChild(node);
    return {
      el: node,
      set(t) { const s = t == null ? '' : String(t); if (node.textContent !== s) node.textContent = s; },
      at(x, y) { node.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0) translate(-50%,-100%)'; },
      show(v) { node.classList.toggle('ss-hidden', !v); },
      remove() { node.remove(); },
    };
  }

  function meter(opts = {}) {
    const vertical = !!opts.vertical;
    const node = el('div', 'ss-meter' + (vertical ? ' vertical' : ''));
    const zones = (opts.zones || []).map(z => {
      const from = U.clamp(z.from, 0, 1), to = U.clamp(z.to, 0, 1);
      const pos = vertical ? 'bottom:' + from * 100 + '%;height:' + (to - from) * 100 + '%' : 'left:' + from * 100 + '%;width:' + (to - from) * 100 + '%';
      return '<i class="ss-meter-zone" style="' + pos + ';background:' + esc(z.color) + '"></i>';
    }).join('');
    node.innerHTML = (opts.label ? '<div class="ss-meter-label">' + esc(opts.label) + '</div>' : '') +
      '<div class="ss-meter-track">' + zones + '<i class="ss-meter-fill"></i><i class="ss-meter-needle"></i></div>';
    hud.appendChild(node);
    const track = node.querySelector('.ss-meter-track');
    const fill = node.querySelector('.ss-meter-fill');
    const needle = node.querySelector('.ss-meter-needle');
    const prop = vertical ? 'height' : 'width';
    const posProp = vertical ? 'bottom' : 'left';
    return {
      el: node,
      set(v) {
        const p = (U.clamp(Number(v) || 0, 0, 1) * 100).toFixed(2) + '%';
        fill.style[prop] = p;
        needle.style[posProp] = p;
      },
      marker(v, color) {
        const m = el('i', 'ss-meter-marker');
        m.style[posProp] = (U.clamp(Number(v) || 0, 0, 1) * 100) + '%';
        if (color) m.style.background = color;
        track.appendChild(m);
        return m;
      },
      flash(color) {
        node.style.setProperty('--flash', color || '#fff');
        node.classList.remove('is-flash');
        void node.offsetWidth;
        node.classList.add('is-flash');
      },
      remove() { node.remove(); },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Modals (stacked; Escape / back closes the top one)
  // ---------------------------------------------------------------------------------------------

  const modals = [];

  /**
   * Opens a modal shell in #ss-overlay. Returns { el, panel, close(value) } and a promise via .result.
   * opts.className, opts.dismissValue (value when closed by back/backdrop), opts.backdrop (close on backdrop tap).
   */
  function modal(opts = {}) {
    const wrap = el('div', 'ss-modal' + (opts.className ? ' ' + opts.className : ''));
    const panel = el('div', 'ss-modal-panel ss-panel');
    wrap.appendChild(panel);
    overlay.appendChild(wrap);
    let resolveFn;
    const m = {
      el: wrap, panel, closed: false,
      result: new Promise(r => { resolveFn = r; }),
      dismissValue: opts.dismissValue === undefined ? null : opts.dismissValue,
      close(value) {
        if (m.closed) return;
        m.closed = true;
        const i = modals.indexOf(m);
        if (i >= 0) modals.splice(i, 1);
        if (!modals.length) fx.classList.remove('has-modal');
        wrap.classList.add('is-out');
        setTimeout(() => wrap.remove(), 220);
        resolveFn(value);
      },
    };
    if (opts.backdrop !== false) {
      wrap.addEventListener('click', e => { if (e.target === wrap) { sfx('ui_close'); m.close(m.dismissValue); } });
    }
    modals.push(m);
    fx.classList.add('has-modal');
    sfx(opts.sfx || 'ui_open');
    return m;
  }

  /** Closes the top-most modal as "back". Returns true if one was closed. */
  function closeTop() {
    const m = modals[modals.length - 1];
    if (!m) return false;
    sfx('ui_close');
    m.close(m.dismissValue);
    return true;
  }

  function modalOpen() { return modals.length > 0; }

  function choose(title, options, opts = {}) {
    const m = modal({ className: 'ss-choose' });
    m.panel.innerHTML = '<div class="ss-modal-head"><h2>' + esc(title) + '</h2>' +
      (opts.sub ? '<p class="ss-modal-sub">' + esc(opts.sub) + '</p>' : '') + '</div>';
    const list = el('div', 'ss-choose-list ss-scroll');
    for (const o of options || []) {
      const b = el('button', 'ss-choice');
      b.type = 'button';
      b.innerHTML = (o.icon ? '<span class="ss-choice-icon">' + (o.icon.indexOf('<') === 0 ? o.icon : icon(o.icon)) + '</span>' : '') +
        '<span class="ss-choice-text"><b>' + esc(o.label) + '</b>' + (o.desc ? '<small>' + esc(o.desc) + '</small>' : '') + '</span>';
      b.addEventListener('click', () => { sfx('ui_select'); haptic(8); m.close(o.id); });
      list.appendChild(b);
    }
    m.panel.appendChild(list);
    const foot = el('div', 'ss-modal-foot');
    foot.appendChild(button('Cancel', () => m.close(null), { kind: 'ghost', sfx: 'ui_back' }));
    m.panel.appendChild(foot);
    return m.result;
  }

  function confirm(title, text, opts = {}) {
    const m = modal({ className: 'ss-confirm', dismissValue: false });
    m.panel.innerHTML = '<div class="ss-modal-head"><h2>' + esc(title) + '</h2>' + (text ? '<p class="ss-modal-sub">' + esc(text) + '</p>' : '') + '</div>';
    const foot = el('div', 'ss-modal-foot two');
    foot.appendChild(button(opts.no || 'Cancel', () => m.close(false), { kind: 'secondary', sfx: 'ui_back' }));
    foot.appendChild(button(opts.yes || 'OK', () => m.close(true), { kind: opts.danger ? 'primary danger' : 'primary' }));
    m.panel.appendChild(foot);
    return m.result;
  }

  // ---------------------------------------------------------------------------------------------
  // Countdown (game time: pauses with the game)
  // ---------------------------------------------------------------------------------------------

  function gameDelay(seconds) {
    return new Promise(r => {
      if (SS.engine && SS.engine.after && SS.engine.renderer) SS.engine.after(seconds, r);
      else setTimeout(r, seconds * 1000);
    });
  }

  async function countdown(n = 3) {
    const box = el('div', 'ss-countdown');
    fx.appendChild(box);
    for (let i = Math.max(1, Math.round(n)); i >= 1; i--) {
      box.innerHTML = '<div class="ss-count-num">' + letters(String(i)) + '</div>';
      sfx('count_beep');
      haptic(6);
      await gameDelay(0.75);
    }
    box.innerHTML = '<div class="ss-count-num go">' + letters('GO!') + '</div>';
    sfx('count_go');
    haptic(18);
    setTimeout(() => { box.classList.add('is-out'); setTimeout(() => box.remove(), 300); }, 650);
    await gameDelay(0.25);
  }

  // ---------------------------------------------------------------------------------------------
  // Title card (sport / hole titles). Tap to skip.
  // ---------------------------------------------------------------------------------------------

  function titleCard(title, sub, opts = {}) {
    const card = el('div', 'ss-titlecard ss-block');
    if (opts.accent) card.style.setProperty('--accent', opts.accent);
    card.innerHTML = '<div class="ss-tc-band"></div><div class="ss-tc-band b2"></div>' +
      '<div class="ss-tc-text"><div class="ss-tc-title">' + letters(title) + '</div>' +
      (sub ? '<div class="ss-tc-sub">' + esc(sub) + '</div>' : '') + '</div>';
    fx.appendChild(card);
    sfx('swish');
    return new Promise(resolve => {
      let done = false;
      const timers = [];
      function finish() {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        card.classList.add('is-out');
        setTimeout(() => { card.remove(); resolve(); }, 340);
      }
      timers.push(setTimeout(() => sfx('whoosh', { intensity: 0.5 }), 1150));
      timers.push(setTimeout(finish, (opts.duration || 1.6) * 1000));
      card.addEventListener('pointerdown', finish);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // How-to overlay (from sport.howTo)
  // ---------------------------------------------------------------------------------------------

  function howTo(sport) {
    const info = (sport && sport.howTo) || {};
    const steps = info.steps || [];
    const tips = info.tips || [];
    const m = modal({ className: 'ss-howto', dismissValue: true });
    if (sport && sport.accent) m.el.style.setProperty('--accent', sport.accent);
    let html = '<div class="ss-howto-head">' +
      (sport && sport.icon ? '<div class="ss-howto-icon">' + sport.icon + '</div>' : '') +
      '<div><small>How to Play</small><h2>' + esc(sport ? sport.name : '') + '</h2></div></div>';
    html += '<div class="ss-howto-body ss-scroll"><ol class="ss-howto-steps n' + Math.min(4, steps.length) + '">';
    steps.forEach((s, i) => {
      html += '<li class="ss-howto-step" style="--i:' + i + '"><div class="ss-howto-glyph">' + gestureSVG(s.gesture) + '</div>' +
        '<div class="ss-howto-text"><b>' + (i + 1) + '</b><span>' + esc(s.text) + '</span></div></li>';
    });
    html += '</ol>';
    if (tips.length) {
      html += '<ul class="ss-howto-tips">' + tips.map(t => '<li>' + icon('bulb') + '<span>' + esc(t) + '</span></li>').join('') + '</ul>';
    }
    html += '</div><div class="ss-howto-more" aria-hidden="true"><i>' + icon('down') + '</i></div>';
    m.panel.innerHTML = html;
    const foot = el('div', 'ss-modal-foot');
    const go = button("Let's go!", () => m.close(true), { kind: 'primary', icon: 'check', className: 'accent' });
    foot.appendChild(go);
    m.panel.appendChild(foot);
    // A tap anywhere on the card closes it too (a scroll of the body is not a click). Enter / Space close
    // it while it is the top modal; the key never reaches the game underneath.
    m.panel.addEventListener('click', e => {
      if (m.closed || (e.target instanceof Element && e.target.closest('button'))) return;
      sfx('ui_select');
      m.close(true);
    });
    const onKey = e => {
      if (m.closed || modals[modals.length - 1] !== m || e.repeat) return;
      if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
      e.preventDefault();
      e.stopPropagation();
      sfx('ui_select');
      m.close(true);
    };
    window.addEventListener('keydown', onKey, true);
    // Short screens: when the steps + tips overflow, show it (fade at the cut edge + a visible scrollbar).
    const body = m.panel.querySelector('.ss-howto-body');
    const cue = () => { scrollCue(body); m.panel.classList.toggle('has-more', body.classList.contains('is-more')); };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(cue) : null;
    if (body) {
      body.addEventListener('scroll', cue, { passive: true });
      if (ro) ro.observe(body); else requestAnimationFrame(cue);
    }
    return m.result.then(() => {
      window.removeEventListener('keydown', onKey, true);
      if (ro) ro.disconnect();
    });
  }

  /** Marks a scroll box that has more content below (is-more) or above (is-scrolled) for CSS cues. */
  function scrollCue(box) {
    if (!box) return;
    const more = box.scrollHeight - box.clientHeight - box.scrollTop > 4;
    box.classList.toggle('is-more', more);
    box.classList.toggle('is-scrollable', box.scrollHeight - box.clientHeight > 4);
    box.classList.toggle('is-scrolled', box.scrollTop > 4);
  }

  // ---------------------------------------------------------------------------------------------
  // Core pause button (top-left; main.js listens to SS.ui.events 'pause')
  // ---------------------------------------------------------------------------------------------

  const pauseBtn = button('Pause', () => events.emit('pause'), { kind: 'round', icon: 'pause', sfx: 'ui_open', className: 'ss-pause-btn' });
  pauseBtn.id = 'ss-pause';
  pauseBtn.classList.add('ss-hidden');
  root.insertBefore(pauseBtn, screens);

  function setPauseVisible(v) { pauseBtn.classList.toggle('ss-hidden', !v); }

  // ---------------------------------------------------------------------------------------------
  // Transition curtain (iris close → fn → iris open)
  // ---------------------------------------------------------------------------------------------

  fade.innerHTML = '<div class="ss-iris"></div><div class="ss-iris-sun"></div>';
  let transitionChain = Promise.resolve();

  function transition(fn) {
    const run = async () => {
      const close = reducedMotion ? 160 : 380;
      fade.classList.remove('is-opening');
      fade.classList.add('is-active', 'is-closing');
      sfx('swish', { vol: 0.7 });
      await sleep(close);
      // On a slow frame the close transition can still be running: give it a moment to land, then
      // .is-closed snaps the iris shut (transition: none) so the swap underneath is never visible.
      const iris = fade.firstElementChild;
      if (iris && iris.getBoundingClientRect().width > 1) {
        await new Promise(r => {
          const done = () => { iris.removeEventListener('transitionend', done); clearTimeout(t); r(); };
          const t = setTimeout(done, 240);
          iris.addEventListener('transitionend', done);
        });
      }
      fade.classList.add('is-closed');
      let result;
      try {
        // Let the curtain paint before heavy work blocks the main thread.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        result = await fn();
      } catch (err) {
        console.error('[SS] transition step failed:', err);
      }
      await sleep(120);
      fade.classList.remove('is-closing', 'is-closed');
      fade.classList.add('is-opening');
      await sleep(reducedMotion ? 160 : 420);
      fade.classList.remove('is-active', 'is-opening');
      return result;
    };
    const p = transitionChain.then(run);
    transitionChain = p.catch(() => {});
    return p;
  }

  // ---------------------------------------------------------------------------------------------
  // Portraits & score pop-ups
  // ---------------------------------------------------------------------------------------------

  /** Render sizes are bucketed so the pals' portrait cache gets reused across screens. */
  function portraitSize(size) {
    const want = size * Math.min(2, window.devicePixelRatio || 1);
    for (const s of [48, 64, 96, 128, 192, 256]) if (s >= want) return s;
    return 256;
  }

  function portraitImg(profile, size = 64) {
    const img = new Image(size, size);
    img.className = 'ss-portrait';
    img.alt = profile && profile.name ? profile.name : '';
    img.draggable = false;
    if (SS.pals && profile) {
      try { img.src = SS.pals.portraitURL(profile, portraitSize(size)); } catch (err) { console.error('[SS] portrait failed:', err); }
    }
    return img;
  }

  function scorePopup(text, x, y, opts = {}) {
    const p = el('div', 'ss-score-pop');
    p.textContent = text;
    if (opts.color) p.style.color = opts.color;
    p.style.left = Math.round(x) + 'px';
    p.style.top = Math.round(y) + 'px';
    fx.appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }

  // ---------------------------------------------------------------------------------------------
  // DOM confetti (celebrations over panels)
  // ---------------------------------------------------------------------------------------------

  const CONFETTI_COLORS = ['#FF5A5F', '#FFC93C', '#3BC45B', '#1FA2FF', '#9B6BFF', '#FF8A2B', '#FF6FAE'];

  function confetti(opts = {}) {
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = el('canvas', 'ss-confetti');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    fx.appendChild(canvas);
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const count = reducedMotion ? 40 : (opts.count || 140);
    const colors = opts.colors || CONFETTI_COLORS;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      parts.push({
        x: fromLeft ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (180 + Math.random() * 420) * (W / 700 + 0.4),
        vy: -(520 + Math.random() * 520) * (H / 800 + 0.3),
        w: 7 + Math.random() * 7, h: 4 + Math.random() * 5,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, flip: Math.random() * 6, vf: 6 + Math.random() * 8,
        color: colors[i % colors.length], delay: Math.random() * 0.35,
      });
    }
    let last = performance.now(), t = 0;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      g.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        if (t < p.delay) { alive++; continue; }
        p.vy += 900 * dt;
        p.vx *= Math.pow(0.35, dt);
        p.vy = Math.min(p.vy, 260 + (p.w * 6));
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;
        if (p.y > H + 30) continue;
        alive++;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(1, Math.cos(p.flip));
        g.fillStyle = p.color;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      if (alive && t < 6 && canvas.isConnected) requestAnimationFrame(frame); else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  /** Removes transient fx (banners, hints, toasts, pop-ups, countdowns, title cards, confetti). */
  function clearFx() {
    if (activeBanner) dismissBannerEntry(activeBanner, true);
    for (const n of Array.from(fx.children)) n.remove();
    toastBox = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Keyboard: Escape closes the top modal, otherwise emits 'back'
  // ---------------------------------------------------------------------------------------------

  // While the transition curtain runs, screens are being swapped underneath: Escape must not navigate.
  // It may still open the pause menu ('pause' — main.js only opens it for a live, pausable game that is
  // not being left); otherwise the press is simply dropped and leaves no pending state behind.
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.repeat) return;
    if (fade.classList.contains('is-active')) { if (!modals.length) events.emit('pause', { source: 'escape' }); return; }
    if (!closeTop()) events.emit('back');
  });

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  SS.ui = {
    root, hud, screens, overlay, fx,
    css, el, icon, button, banner, toast, hint, label, meter, choose, confirm, countdown, titleCard, howTo,
    setPauseVisible, transition, portraitImg, scorePopup,
    // extensions
    events, esc, sfx, haptic, letters, gestureSVG, modal, closeTop, modalOpen, confetti, clearFx, dismissBanner, safeInsets,
    pauseButton: pauseBtn, GESTURES: Object.keys(GESTURES), ICONS: Object.keys(ICONS),
  };
})();
