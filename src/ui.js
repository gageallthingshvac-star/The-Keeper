// Screens, menus and the shipyard editor. Talks to App for anything stateful.
const UI = (() => {
  const {PARTS, PART_ORDER, OPS, WEATHER, DIFFICULTY, DOCKS, TRACKS, ENEMIES, TURRETS} = Data;
  const $ = id => document.getElementById(id);
  const $$ = s => Array.from(document.querySelectorAll(s));
  let app;

  // ---------------------------------------------------------------- part icons (2D)
  function drawPartIcon(ctx, t, x, y, s) {
    const h = s / 2;
    ctx.save();
    ctx.fillStyle = t === 'armor' ? '#4a535d' : t === 'bridge' ? '#d6dbe0' : t === 'engine' ? '#8a5a3c' : t === 'rudder' ? '#5f7050' : '#76808c';
    roundRect(ctx, x - h, y - h, s, s, s * 0.12); ctx.fill();
    const k = s;
    switch (t) {
      case 'hull': ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = k * .06; ctx.strokeRect(x - h + k * .14, y - h + k * .14, k * .72, k * .72); break;
      case 'armor': ctx.strokeStyle = '#2f363d'; ctx.lineWidth = k * .12; ctx.strokeRect(x - h + k * .12, y - h + k * .12, k * .76, k * .76);
        ctx.fillStyle = '#8e98a3'; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(x + dx * k * .27 - k * .05, y + dy * k * .27 - k * .05, k * .1, k * .1); break;
      case 'bridge': ctx.fillStyle = '#1f2a35'; ctx.fillRect(x - h + k * .15, y - h + k * .2, k * .7, k * .18); ctx.fillStyle = '#e0b45a'; ctx.fillRect(x - k * .08, y + k * .08, k * .16, k * .2); break;
      case 'engine': ctx.fillStyle = '#3a2518'; circ(ctx, x, y, k * .3); ctx.fill(); ctx.strokeStyle = '#c08050'; ctx.lineWidth = k * .07;
        ctx.beginPath(); ctx.moveTo(x - k * .2, y); ctx.lineTo(x + k * .2, y); ctx.moveTo(x, y - k * .2); ctx.lineTo(x, y + k * .2); ctx.stroke(); break;
      case 'rudder': ctx.fillStyle = '#2a3322'; ctx.fillRect(x - k * .08, y - k * .34, k * .16, k * .68); break;
      case 'gun': ctx.fillStyle = '#2b3138'; ctx.fillRect(x - k * .07, y - k * .5, k * .14, k * .45); ctx.fillStyle = '#b3bdc7'; circ(ctx, x, y + k * .04, k * .3); ctx.fill(); break;
      case 'heavy': ctx.fillStyle = '#22282e'; ctx.fillRect(x - k * .2, y - k * .5, k * .12, k * .5); ctx.fillRect(x + k * .08, y - k * .5, k * .12, k * .5);
        ctx.fillStyle = '#c0c8d0'; ctx.fillRect(x - k * .36, y - k * .14, k * .72, k * .5); break;
      case 'torp': ctx.fillStyle = '#55606b'; ctx.fillRect(x - k * .3, y - k * .4, k * .6, k * .8); ctx.fillStyle = '#1b2026'; for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * k * .19 - k * .06, y - k * .38, k * .12, k * .56); break;
      case 'ciws': ctx.fillStyle = '#1b2026'; ctx.fillRect(x - k * .04, y - k * .46, k * .08, k * .4); ctx.fillStyle = '#eef2f5'; circ(ctx, x, y + k * .04, k * .24); ctx.fill(); break;
      case 'missile': ctx.fillStyle = '#3d4650'; ctx.fillRect(x - k * .36, y - k * .36, k * .72, k * .72); ctx.fillStyle = '#c94a3a';
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { circ(ctx, x + dx * k * .16, y + dy * k * .16, k * .1); ctx.fill(); } break;
      case 'rockets': ctx.fillStyle = '#9aa4ae'; ctx.fillRect(x - k * .32, y - k * .3, k * .64, k * .56); ctx.fillStyle = '#15191d';
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { circ(ctx, x - k * .21 + c * k * .14, y - k * .14 + r * k * .2, k * .05); ctx.fill(); } break;
      case 'rail': ctx.fillStyle = '#2b3138'; ctx.fillRect(x - k * .15, y - k * .5, k * .1, k * .7); ctx.fillRect(x + k * .05, y - k * .5, k * .1, k * .7);
        ctx.fillStyle = '#4f8fb8'; for (let i = 0; i < 3; i++) ctx.fillRect(x - k * .22, y - k * .42 + i * k * .2, k * .44, k * .06); ctx.fillStyle = '#9aa4ae'; ctx.fillRect(x - k * .26, y + k * .12, k * .52, k * .24); break;
      case 'radar': ctx.fillStyle = '#2b3138'; circ(ctx, x, y, k * .1); ctx.fill(); ctx.fillStyle = '#dfe5ea'; ctx.fillRect(x - k * .34, y - k * .08, k * .68, k * .16); break;
      case 'repair': ctx.fillStyle = '#d9a92e'; ctx.fillRect(x - k * .3, y - k * .3, k * .6, k * .6); ctx.fillStyle = '#2a3036'; ctx.fillRect(x - k * .06, y - k * .22, k * .12, k * .44); ctx.fillRect(x - k * .22, y - k * .06, k * .44, k * .12); break;
      case 'smoke': ctx.fillStyle = '#2a3036'; circ(ctx, x - k * .16, y, k * .14); ctx.fill(); circ(ctx, x + k * .16, y, k * .14); ctx.fill();
        ctx.fillStyle = 'rgba(220,225,230,.8)'; circ(ctx, x, y - k * .26, k * .12); ctx.fill(); circ(ctx, x + k * .14, y - k * .32, k * .09); ctx.fill(); break;
    }
    ctx.restore();
  }
  function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function iconCanvas(t, px = 64) { const cv = document.createElement('canvas'); cv.width = cv.height = px; drawPartIcon(cv.getContext('2d'), t, px / 2, px / 2, px * 0.72); return cv; }
  const starsHtml = n => [0, 1, 2].map(i => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');
  const cr = n => `${Util.fmtNum(n)} cr`;

  // ---------------------------------------------------------------- screens
  let current = null;
  function show(id) {
    current = id;
    for (const s of $$('.screen')) s.classList.toggle('on', s.id === id);
    const battle = id === 'sHud';
    $('overlay').style.display = battle ? 'block' : 'none';
    $('shade').style.opacity = battle ? 0 : id === 'sYard' ? 0.35 : 1;
    if (!battle) app.yard.mode = id === 'sYard' ? 'edit' : 'menu';
    if (id === 'sYard') { requestAnimationFrame(layoutYard); }
    else if (!battle) app.yard.setView(0, 0, window.innerWidth, window.innerHeight * (id === 'sTitle' ? 0.9 : 1));
    if (!battle) app.yard.showGrid(id === 'sYard', yardState.mirror);
    $('coach').classList.remove('on');
  }
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1800); }
  let msgT = 0;
  function flash(title, sub) { const m = $('msg'); m.querySelector('b').textContent = title; m.querySelector('span').textContent = sub || ''; m.classList.add('on'); clearTimeout(msgT); msgT = setTimeout(() => m.classList.remove('on'), 2300); }

  // ---------------------------------------------------------------- title
  function refreshTitle() {
    const p = app.profile;
    $('tCredits').textContent = cr(p.credits);
    $('tStars').textContent = `${Progress.totalStars(p)} / ${OPS.length * 3} ★`;
    $('tBest').textContent = p.endlessBest ? `Best wave ${p.endlessBest}` : 'Survive the waves';
    $('tDiff').textContent = 'Difficulty · ' + DIFFICULTY[p.settings.difficulty].name;
  }

  // ---------------------------------------------------------------- campaign
  function renderCampaign() {
    const p = app.profile, el = $('ops');
    $('cCredits').textContent = cr(p.credits);
    el.innerHTML = '';
    OPS.forEach((op, i) => {
      const open = Progress.opUnlocked(p, i);
      const b = document.createElement('button');
      b.className = 'op' + (open ? '' : ' locked'); b.disabled = !open;
      const foes = {}; op.enemies.forEach(e => foes[ENEMIES[e].name] = (foes[ENEMIES[e].name] || 0) + 1);
      b.innerHTML = `<span class="num">OPERATION ${i + 1} · ${WEATHER[op.weather].name.toUpperCase()}</span><b>${op.name}</b>
        <div class="meta">${Object.entries(foes).map(([n, c]) => `${c}× ${n}`).join(', ')}<br>Budget ${Util.fmtNum(Progress.budget(p, i))}${open ? '' : ' · Locked'}</div>
        <div class="stars">${starsHtml(p.stars[i])}</div>${p.hardClears[i] ? '<span class="badge">HARD</span>' : ''}`;
      b.onclick = () => { Sound.play('click'); openBrief(i); };
      el.appendChild(b);
    });
  }
  function openBrief(i) {
    const p = app.profile, op = OPS[i];
    const foes = {}; op.enemies.forEach(e => foes[ENEMIES[e].name] = (foes[ENEMIES[e].name] || 0) + 1);
    const probs = app.launchProblems({mode: 'op', op: i});
    $('sheetBody').innerHTML = `
      <div class="mute small">OPERATION ${i + 1}</div><h2>${op.name}</h2>
      <div class="stars">${starsHtml(p.stars[i])}</div>
      <p class="brief">${op.brief}</p>
      <div class="facts">
        <div><span>Enemy</span>${Object.entries(foes).map(([n, c]) => `${c}× ${n}`).join('<br>')}</div>
        <div><span>Conditions</span>${WEATHER[op.weather].name}${WEATHER[op.weather].spread > 1 ? ' — gunnery harder' : ''}</div>
        <div><span>Build budget</span>${Util.fmtNum(Progress.budget(p, i))}</div>
        <div><span>Difficulty</span>${DIFFICULTY[p.settings.difficulty].name}</div>
      </div>
      <div class="goals"><i>★</i> Win &nbsp; <i>★</i> Keep 60% of your hull &nbsp; <i>★</i> Win within ${Util.fmtTime(op.par)}</div>
      ${probs.length ? `<div class="why">Your current design can't launch: ${probs[0]}</div>` : ''}
      <div class="btns" style="flex-direction:row;margin-top:16px">
        <button id="bfClose">Close</button><button id="bfYard">Shipyard</button>
        <button class="primary" id="bfGo" ${probs.length ? 'disabled' : ''}>Launch</button>
      </div>`;
    $('sheet').classList.add('on');
    $('bfClose').onclick = () => $('sheet').classList.remove('on');
    $('bfYard').onclick = () => { $('sheet').classList.remove('on'); openYard({mode: 'op', op: i}); };
    $('bfGo').onclick = () => { $('sheet').classList.remove('on'); app.startBattle({mode: 'op', op: i}); };
  }

  // ---------------------------------------------------------------- shipyard editor
  const yardState = {ctx: {mode: 'free'}, tool: 'hull', mirror: true, erase: false, hist: new Design.History()};
  function openYard(ctx) {
    yardState.ctx = ctx;
    yardState.hist.clear();
    const p = app.profile;
    const dock = Progress.dock(p);
    if (p.design.w !== dock.w || p.design.h !== dock.h) p.design = Design.resize(p.design, dock.w, dock.h);
    if (!Progress.unlocked(p).has(yardState.tool)) yardState.tool = 'hull';
    if (ctx.mode === 'op') { $('yTitle').textContent = `${ctx.op + 1}. ${OPS[ctx.op].name}`; const f = {}; OPS[ctx.op].enemies.forEach(e => f[ENEMIES[e].name] = (f[ENEMIES[e].name] || 0) + 1); $('yBrief').textContent = 'vs ' + Object.entries(f).map(([n, c]) => `${c}× ${n}`).join(', '); }
    else if (ctx.mode === 'endless') { $('yTitle').textContent = 'Endless Patrol'; $('yBrief').textContent = 'Waves until you sink. Best: ' + (p.endlessBest || '—'); }
    else { $('yTitle').textContent = 'Shipyard'; $('yBrief').textContent = `${dock.name} · ${dock.w}×${dock.h}`; }
    $('yLaunch').textContent = ctx.mode === 'free' ? 'Done' : 'Launch';
    show('sYard');
    buildPalette(); buildSlots(); refreshDesign();
    coach();
  }
  function yardBudget() {
    const c = yardState.ctx, p = app.profile;
    return c.mode === 'op' ? Progress.budget(p, c.op) : Progress.endlessBudgetCap(p);
  }
  function buildPalette() {
    const p = app.profile, el = $('palette'), unl = Progress.unlocked(p);
    el.innerHTML = '';
    for (const t of PART_ORDER) {
      const P = PARTS[t], b = document.createElement('button'), ok = unl.has(t);
      b.className = 'part' + (yardState.tool === t && !yardState.erase ? ' sel' : '') + (ok ? '' : ' locked');
      b.appendChild(iconCanvas(t));
      b.insertAdjacentHTML('beforeend', `<span>${P.name}</span><span class="c">${P.cost}</span>`);
      b.onclick = () => {
        if (!ok) { const st = Progress.partStatus(p, t); toast(st.state === 'locked' ? `${P.name}: reach operation ${st.op + 1}, then buy in the Armory` : `${P.name}: buy it in the Armory (${cr(st.price)})`); Sound.play('deny'); return; }
        yardState.tool = t; yardState.erase = false; $('tErase').classList.remove('on'); Sound.play('click'); buildPalette();
      };
      el.appendChild(b);
    }
    const P = PARTS[yardState.tool], W = P.weapon, U = P.util;
    $('partInfo').innerHTML = `<b>${P.name}</b> — ${P.desc}<br><span class="mono">cost ${P.cost} · mass ${P.mass} · float ${P.buoy} · hp ${P.hp}` +
      (W && W.dmg ? ` · dmg ${W.dmg}${W.salvo ? '×' + W.salvo : ''} · rng ${W.range}` : '') + (W && W.type === 'ciws' ? ` · rng ${W.range}` : '') + '</span>';
  }
  function buildSlots() {
    const el = $('slots'), p = app.profile; el.innerHTML = '';
    p.slots.forEach((s, i) => {
      const sv = document.createElement('button'); sv.textContent = `Save ${i + 1}`;
      sv.onclick = () => { p.slots[i] = Design.clone(p.design); app.save(); buildSlots(); toast(`Saved to slot ${i + 1}`); Sound.play('click'); };
      const ld = document.createElement('button'); ld.textContent = `Load ${i + 1}`; ld.disabled = !s;
      ld.onclick = () => { if (!p.slots[i]) return; const d = Progress.dock(p); edit(() => { p.design = Design.resize(p.slots[i], d.w, d.h); }); toast(`Loaded slot ${i + 1}`); };
      el.appendChild(sv); el.appendChild(ld);
    });
  }
  function edit(fn) { yardState.hist.push(app.profile.design); fn(); app.save(); refreshDesign(); }
  function refreshDesign() {
    const p = app.profile, d = p.design;
    const a = Design.analyze(d, Progress.mods(p));
    app.yard.setDesign(d, a.conn);
    const budget = yardBudget();
    $('sCost').textContent = `${a.cost} / ${Util.fmtNum(budget)}`; $('sCost').style.color = a.cost > budget ? 'var(--bad)' : '';
    $('sMass').textContent = `${a.mass.toFixed(0)} / ${a.buoy.toFixed(0)}`;
    const margin = a.buoy > 0 ? (a.buoy - a.mass) / a.buoy : 0;
    $('sMass').style.color = margin < 0 ? 'var(--bad)' : margin < 0.15 ? 'var(--brass)' : '';
    $('sSpeed').textContent = (a.speed * Design.KN).toFixed(1) + ' kn';
    $('sTurn').textContent = (a.turn * 180 / Math.PI).toFixed(0) + '°/s';
    $('sDps').textContent = a.dps.toFixed(0) + ' dps';
    $('sRange').textContent = a.range ? Math.round(a.range) : '—';
    const cb = $('sCostBar'); cb.style.width = Math.min(100, a.cost / budget * 100) + '%'; cb.style.background = a.cost > budget ? 'var(--bad)' : 'var(--brass)';
    const bb = $('sBuoyBar'); bb.style.width = Util.clamp(margin * 160, 2, 100) + '%'; bb.style.background = margin < 0 ? 'var(--bad)' : margin < 0.15 ? 'var(--brass)' : 'var(--good)';
    const probs = app.launchProblems(yardState.ctx);
    $('warn').innerHTML = probs.length ? probs.map(x => '• ' + x).join('<br>') : '<span class="ok">Seaworthy. Ready to launch.</span>';
    $('yLaunch').disabled = yardState.ctx.mode !== 'free' && probs.length > 0;
    $('yUndo').disabled = !yardState.hist.past.length; $('yRedo').disabled = !yardState.hist.future.length;
  }
  function layoutYard() {
    const r = $('yardFree').getBoundingClientRect();
    app.yard.setView(r.left, r.top, r.width, r.height);
  }
  function paint(i, eraseOverride) {
    if (i < 0) return;
    const p = app.profile, d = p.design, c = i % d.w, r = (i / d.w) | 0;
    const t = (yardState.erase || eraseOverride) ? null : yardState.tool;
    if (t && !Progress.unlocked(p).has(t)) return;
    const test = Design.clone(d);
    if (!Design.place(test, c, r, t, yardState.mirror)) return;
    yardState.hist.push(d);
    p.design = test;
    app.save(); refreshDesign();
    Sound.play(t ? 'place' : 'erase');
    app.haptic('light');
  }

  // pointer: paint with one finger / left mouse, orbit with right mouse or two fingers, pinch or wheel to zoom
  const yp = {ptrs: new Map(), mode: null, last: -1, pinch0: 0, dist0: 0, start: null};
  function bindYardInput() {
    const el = app.renderer.domElement, Y = app.yard;
    const active = () => current === 'sYard' && !app.battle;
    el.addEventListener('pointerdown', e => {
      if (!active()) return;
      Sound.init();
      el.setPointerCapture(e.pointerId);
      yp.ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (yp.ptrs.size === 2) { yp.mode = 'orbit2'; const [a, b] = [...yp.ptrs.values()]; yp.pinch0 = Math.hypot(a.x - b.x, a.y - b.y); yp.dist0 = Y.dist; return; }
      if (e.button === 2 || e.button === 1) { yp.mode = 'orbit'; return; }
      yp.start = {x: e.clientX, y: e.clientY};
      if (e.pointerType === 'mouse') { yp.mode = 'paint'; yp.last = Y.pick(e.clientX, e.clientY); paint(yp.last, e.shiftKey); Y.showGhost(yp.last, yardState.mirror, yardState.erase, yardState.tool); }
      else yp.mode = 'pending';
    });
    el.addEventListener('pointermove', e => {
      if (!active()) return;
      const prev = yp.ptrs.get(e.pointerId);
      if (!prev) { if (e.pointerType === 'mouse') Y.showGhost(Y.pick(e.clientX, e.clientY), yardState.mirror, yardState.erase, yardState.tool); return; }
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y; prev.x = e.clientX; prev.y = e.clientY;
      if (yp.mode === 'orbit') { Y.yaw -= dx * 0.008; Y.pitch = Util.clamp(Y.pitch + dy * 0.006, 0.12, 1.5); }
      else if (yp.mode === 'orbit2') {
        const [a, b] = [...yp.ptrs.values()];
        Y.yaw -= dx * 0.004; Y.pitch = Util.clamp(Y.pitch + dy * 0.003, 0.12, 1.5);
        const d = Math.hypot(a.x - b.x, a.y - b.y); if (yp.pinch0 > 0) { Y.dist = Util.clamp(yp.dist0 * yp.pinch0 / d, 90, 1100); Y.userZoom = true; }
      } else if (yp.mode === 'pending' && Math.hypot(e.clientX - yp.start.x, e.clientY - yp.start.y) > 8) { yp.mode = 'paint'; yp.last = -1; }
      if (yp.mode === 'paint') { const i = Y.pick(e.clientX, e.clientY); Y.showGhost(i, yardState.mirror, yardState.erase, yardState.tool); if (i !== yp.last) { yp.last = i; paint(i, e.shiftKey); } }
    });
    const up = e => {
      if (!yp.ptrs.has(e.pointerId)) return;
      if (yp.mode === 'pending' && yp.ptrs.size === 1) { const i = Y.pick(e.clientX, e.clientY); paint(i); Y.showGhost(i, yardState.mirror, yardState.erase, yardState.tool); }
      yp.ptrs.delete(e.pointerId);
      if (!yp.ptrs.size) yp.mode = null;
      if (e.pointerType !== 'mouse') setTimeout(() => Y.showGhost(-1), 350);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', e => { if (active() && e.pointerType === 'mouse' && !yp.ptrs.size) Y.showGhost(-1); });
    el.addEventListener('wheel', e => { if (!active()) return; e.preventDefault(); Y.userZoom = true; Y.dist = Util.clamp(Y.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 90, 1100); }, {passive: false});
    el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (!active()) return;
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.code === 'KeyM') $('tMirror').onclick();
      else if (e.code === 'KeyE') $('tErase').onclick();
    });
  }
  function undo() { const d = yardState.hist.undo(app.profile.design); if (d) { app.profile.design = d; app.save(); refreshDesign(); Sound.play('click'); } }
  function redo() { const d = yardState.hist.redo(app.profile.design); if (d) { app.profile.design = d; app.save(); refreshDesign(); Sound.play('click'); } }

  const COACH = Gfx.IS_TOUCH ? [
    'Pick a part from the strip, then tap the deck to place it. Drag to paint a row.',
    'Two fingers orbit the camera and pinch to zoom. Mirror places blocks on both sides. In battle, pinch the right side to zoom.',
    'Keep Mass under Float or the ship sinks. Everything must connect to the Bridge.',
    'When it says "Seaworthy", hit Launch.',
  ] : [
    'Pick a part, then click the deck to place it. Drag to paint; Shift-drag erases.',
    'Right-drag orbits the camera, the wheel zooms. Ctrl/⌘-Z undoes.',
    'Keep Mass under Float or the ship sinks. Everything must connect to the Bridge.',
    'When it says "Seaworthy", hit Launch.',
  ];
  function coach() {
    const p = app.profile;
    if (p.seen.yard) return;
    let i = 0;
    const next = () => {
      if (i >= COACH.length) { $('coach').classList.remove('on'); p.seen.yard = true; app.save(); return; }
      $('coachText').textContent = COACH[i]; $('coachNext').textContent = i === COACH.length - 1 ? 'Start building' : 'Next';
      $('coach').classList.add('on'); i++;
    };
    $('coachNext').onclick = () => { Sound.play('click'); next(); };
    next();
  }

  // ---------------------------------------------------------------- armory
  let armoryTab = 'parts';
  function renderArmory(tab) {
    if (tab) armoryTab = tab;
    const p = app.profile, el = $('aList');
    $('aCredits').textContent = cr(p.credits);
    for (const b of $$('#aTabs button')) b.classList.toggle('on', b.dataset.tab === armoryTab);
    el.innerHTML = '';
    const item = (iconEl, title, desc, extra, actHtml, onBuy) => {
      const c = document.createElement('div'); c.className = 'card item';
      c.appendChild(iconEl);
      c.insertAdjacentHTML('beforeend', `<div class="txt"><b>${title}</b><p>${desc}</p>${extra || ''}</div><div class="act">${actHtml}</div>`);
      const btn = c.querySelector('.act button');
      if (btn && onBuy) btn.onclick = () => { if (onBuy()) { Sound.play('buy'); app.haptic('success'); app.save(); renderArmory(); } else Sound.play('deny'); };
      el.appendChild(c);
    };
    if (armoryTab === 'parts') {
      for (const t of PART_ORDER) {
        const P = PARTS[t], st = Progress.partStatus(p, t), W = P.weapon;
        const stats = `<span class="mono">mass ${P.mass} · float ${P.buoy} · hp ${P.hp}${W && W.dmg ? ` · dmg ${W.dmg}${W.salvo ? '×' + W.salvo : ''} · rng ${W.range}` : ''}</span>`;
        const act = st.state === 'owned' ? '<span class="owned">Owned</span>'
          : st.state === 'locked' ? `<span class="mute small">Reach op ${st.op + 1}</span>`
          : `<button class="${st.state === 'buy' ? 'primary' : ''}" ${st.state === 'buy' ? '' : 'disabled'}>${cr(st.price)}</button>`;
        item(iconCanvas(t, 96), P.name, P.desc, stats, act, () => Progress.buyPart(p, t));
      }
    } else if (armoryTab === 'eng') {
      for (const k in TRACKS) {
        const T = TRACKS[k], lv = p.tracks[k], price = Progress.trackPrice(p, k);
        const pips = `<div class="pips">${[0, 1, 2, 3, 4].map(i => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>`;
        const act = price == null ? '<span class="owned">Max</span>' : `<button class="${p.credits >= price ? 'primary' : ''}" ${p.credits >= price ? '' : 'disabled'}>${cr(price)}</button>`;
        const cv = document.createElement('canvas'); cv.width = cv.height = 96; const g = cv.getContext('2d');
        g.fillStyle = '#e0b45a'; g.font = 'bold 44px -apple-system,system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(T.name[0], 48, 50);
        item(cv, T.name, T.desc, pips, act, () => Progress.buyTrack(p, k));
      }
    } else {
      DOCKS.forEach((d, i) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 96; const g = cv.getContext('2d');
        const cs = 70 / Math.max(d.w, d.h); g.strokeStyle = i <= p.dock ? '#e0b45a' : '#556'; g.lineWidth = 2; g.strokeRect(48 - d.w * cs / 2, 48 - d.h * cs / 2, d.w * cs, d.h * cs);
        const owned = i <= p.dock, nextUp = i === p.dock + 1;
        const act = owned ? `<span class="owned">${i === p.dock ? 'Current' : 'Owned'}</span>`
          : nextUp ? `<button class="${p.credits >= d.price ? 'primary' : ''}" ${p.credits >= d.price ? '' : 'disabled'}>${cr(d.price)}</button>` : '<span class="mute small">Buy previous dock first</span>';
        item(cv, d.name, `Build area ${d.w} × ${d.h} blocks.`, '', act, () => Progress.buyDock(p));
      });
    }
  }

  // ---------------------------------------------------------------- settings / help
  function renderSettings() {
    const s = app.profile.settings;
    const seg = (id, opts, val, set) => {
      const el = $(id); el.innerHTML = '';
      for (const [k, label] of opts) { const b = document.createElement('button'); b.textContent = label; b.classList.toggle('on', k === val); b.onclick = () => { Sound.play('click'); set(k); }; el.appendChild(b); }
    };
    seg('setDiff', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), s.difficulty, k => { s.difficulty = k; app.save(); renderSettings(); });
    $('setDiffDesc').textContent = DIFFICULTY[s.difficulty].desc + ` Rewards ×${DIFFICULTY[s.difficulty].reward}.`;
    seg('setQual', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality, k => { if (k === s.quality) return; s.quality = k; app.save(); location.reload(); });
    $('setVol').value = s.volume; $('setVol').oninput = e => { s.volume = +e.target.value; Sound.setVolume(s.volume); app.save(); };
    $('setMusic').checked = s.music; $('setMusic').onchange = e => { s.music = e.target.checked; Sound.setMusic(s.music); app.save(); };
    $('setShake').checked = s.shake; $('setShake').onchange = e => { s.shake = e.target.checked; app.save(); };
    let armed = 0;
    $('setReset').textContent = 'Reset all progress';
    $('setReset').onclick = () => {
      if (!armed) { $('setReset').textContent = 'Tap again to erase everything'; armed = setTimeout(() => { armed = 0; $('setReset').textContent = 'Reset all progress'; }, 3000); return; }
      clearTimeout(armed); app.reset(); toast('Progress reset');
    };
  }
  function renderHelp() {
    const el = $('helpParts'); if (el.childElementCount) return;
    for (const t of PART_ORDER) {
      const d = document.createElement('div'); d.className = 'hp'; d.appendChild(iconCanvas(t));
      d.insertAdjacentHTML('beforeend', `<div><b>${PARTS[t].name}</b>${PARTS[t].desc}</div>`);
      el.appendChild(d);
    }
  }

  // ---------------------------------------------------------------- pause / results
  function pause(on) {
    $('pauseOv').classList.toggle('on', on);
    $('pRetreat').textContent = app.battle && app.battle.cfg.mode === 'endless' ? 'Retreat (bank waves)' : 'Retreat to shipyard';
  }
  function results(r, rw) {
    const p = app.profile, endless = r.mode === 'endless';
    const title = endless ? 'Patrol Over' : r.won ? 'Victory' : 'Defeat';
    $('rTitle').textContent = title; $('rTitle').style.color = r.won || (endless && r.wave > 0) ? 'var(--brass)' : 'var(--bad)';
    $('rSub').textContent = endless ? `Survived ${r.wave} wave${r.wave === 1 ? '' : 's'}${rw.best ? ' — new best!' : ''}` : `${OPS[r.op].name} — ${r.won ? (r.op === OPS.length - 1 ? 'the Iron Tide is broken' : 'cleared') : 'your ship went down'}`;
    const stars = endless ? 0 : rw.stars;
    $('rStars').style.display = endless ? 'none' : '';
    $('rStars').innerHTML = endless ? '' : [0, 1, 2].map(() => '<span>★</span>').join('');
    const st = r.stats;
    $('rStats').innerHTML = [['Time', Util.fmtTime(r.time)], ['Ships sunk', r.sunk], ['Accuracy', st.shots ? Math.round(Math.min(1, st.hits / st.shots) * 100) + '%' : '—'],
      ['Damage dealt', Util.fmtNum(st.dmg)], ['Damage taken', Util.fmtNum(st.taken)], ['Hull remaining', Math.round(r.integrity * 100) + '%']]
      .map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('');
    const lines = endless ? [[`Waves × ${r.wave}`, r.wave * 45], ['Ships sunk', Math.round((r.sunkCost || 0) * 0.1)]] : rw.lines;
    const mult = endless ? DIFFICULTY[r.difficulty].reward : rw.mult;
    $('rReward').innerHTML = lines.map(([a, b]) => `<div class="row"><span>${a}</span><span>${Util.fmtNum(b)}</span></div>`).join('') +
      (mult !== 1 ? `<div class="row"><span>${DIFFICULTY[r.difficulty].name} bonus</span><span>×${mult}</span></div>` : '') +
      `<div class="row total"><span>Credits</span><span id="rTotal">0</span></div>`;
    const btns = $('rBtns'); btns.innerHTML = '';
    const add = (label, fn, primary) => { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = () => { Sound.play('click'); fn(); }; btns.appendChild(b); };
    if (!endless && r.won && r.op < OPS.length - 1) add('Next operation', () => { closeResults(); app.exitBattle(); show('sCampaign'); renderCampaign(); openBrief(r.op + 1); }, true);
    add(endless ? 'Patrol again' : 'Retry', () => { closeResults(); app.startBattle(endless ? {mode: 'endless'} : {mode: 'op', op: r.op}); }, !r.won && !endless);
    add('Shipyard', () => { closeResults(); app.exitBattle(); openYard(endless ? {mode: 'endless'} : {mode: 'op', op: r.op}); });
    add('Armory', () => { closeResults(); app.exitBattle(); show('sArmory'); renderArmory(); });
    add('Menu', () => { closeResults(); app.exitBattle(); show('sTitle'); refreshTitle(); });
    $('resultOv').classList.add('on');
    // reveal stars, then count credits up
    const spans = $$('#rStars span');
    let t = 350;
    spans.forEach((s, i) => { if (i < stars) setTimeout(() => { s.classList.add('on'); Sound.play('star'); app.haptic('light'); }, t += 380); });
    const total = rw.total, start = t + 300, dur = 900;
    setTimeout(() => {
      const t0 = performance.now();
      const tick = () => {
        const f = Math.min(1, (performance.now() - t0) / dur);
        const el = $('rTotal'); if (!el) return;
        el.textContent = '+' + Util.fmtNum(total * f);
        if (f < 1) { if (Math.random() < 0.5) Sound.play('coin'); requestAnimationFrame(tick); }
      };
      tick();
    }, start);
  }
  function closeResults() { $('resultOv').classList.remove('on'); }

  // ---------------------------------------------------------------- wiring
  function init(a) {
    app = a;
    for (const b of $$('[data-act]')) b.addEventListener('click', () => {
      Sound.init(); Sound.play('click');
      const act = b.dataset.act;
      if (act === 'title') { show('sTitle'); refreshTitle(); }
      else if (act === 'campaign') { show('sCampaign'); renderCampaign(); }
      else if (act === 'endless') openYard({mode: 'endless'});
      else if (act === 'yardFree') openYard({mode: 'free'});
      else if (act === 'armory') { show('sArmory'); renderArmory(); }
      else if (act === 'settings') { show('sSettings'); renderSettings(); }
      else if (act === 'help') { show('sHelp'); renderHelp(); }
    });
    for (const b of $$('#aTabs button')) b.onclick = () => { Sound.play('click'); renderArmory(b.dataset.tab); };
    $('yBack').onclick = () => { Sound.play('click'); const c = yardState.ctx; if (c.mode === 'op') { show('sCampaign'); renderCampaign(); openBrief(c.op); } else { show('sTitle'); refreshTitle(); } };
    $('yLaunch').onclick = () => { const c = yardState.ctx; if (c.mode === 'free') { show('sTitle'); refreshTitle(); return; } app.startBattle(c); };
    $('yUndo').onclick = undo; $('yRedo').onclick = redo;
    $('tMirror').onclick = () => { yardState.mirror = !yardState.mirror; $('tMirror').classList.toggle('on', yardState.mirror); app.yard.showGrid(true, yardState.mirror); Sound.play('click'); };
    $('tErase').onclick = () => { yardState.erase = !yardState.erase; $('tErase').classList.toggle('on', yardState.erase); buildPalette(); Sound.play('click'); };
    let clearArm = 0;
    $('tClear').onclick = () => {
      const b = $('tClear');
      if (!clearArm) { b.textContent = 'Tap again'; b.classList.add('on'); clearArm = setTimeout(() => { clearArm = 0; b.textContent = 'Clear'; b.classList.remove('on'); }, 2500); return; }
      clearTimeout(clearArm); clearArm = 0; b.textContent = 'Clear'; b.classList.remove('on');
      edit(() => { const d = app.profile.design; app.profile.design = Design.create(d.w, d.h); });
    };
    $('tStarter').onclick = () => { const d = Progress.dock(app.profile); edit(() => { app.profile.design = Design.fromRows(Data.STARTER, d.w, d.h); }); };
    $('vLeft').onclick = () => { app.yard.yaw += Math.PI / 4; };
    $('vRight').onclick = () => { app.yard.yaw -= Math.PI / 4; };
    $('vTop').onclick = () => { const Y = app.yard; if (Y.pitch > 1.3) { Y.pitch = 0.62; Y.yaw = 0.75; } else { Y.pitch = 1.49; Y.yaw = 0; } };
    $('pResume').onclick = () => app.battle && app.battle.togglePause();
    $('pRestart').onclick = () => { pause(false); app.startBattle(app.battle.cfg); };
    $('pRetreat').onclick = () => {
      pause(false);
      const b = app.battle;
      if (b.cfg.mode === 'endless') { b.paused = false; b.retreat(); return; }
      const c = b.cfg; app.exitBattle(); openYard(c);
    };
    $('pQuit').onclick = () => { pause(false); app.exitBattle(); show('sTitle'); refreshTitle(); };
    bindYardInput();
    window.addEventListener('resize', () => { if (current === 'sYard') layoutYard(); });
  }

  return {init, show, flash, toast, pause, results, refreshTitle, renderCampaign, openBrief, openYard, renderArmory, layoutYard, drawPartIcon, get current() { return current; }};
})();
