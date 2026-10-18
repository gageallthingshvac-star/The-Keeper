// Boot, main loop and the glue between screens, battles and the saved profile.
const App = {
  profile: null, renderer: null, yard: null, battle: null, ui: UI, quality: 'medium', governor: null,
  drawPartIcon: UI.drawPartIcon,

  boot() {
    this.profile = Progress.load();
    const s = this.profile.settings;
    this.quality = Gfx.resolveQuality(s.quality);
    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no webgl');
      Gfx.init();
      this.renderer = Gfx.makeRenderer(document.getElementById('view'), this.quality);
      this.governor = new Gfx.Governor(this.renderer, Gfx.QUALITY[this.quality].pr);
      this.yard = new Yard(this.renderer, this.quality);
    } catch (e) {
      console.error(e);
      document.getElementById('nogl').style.display = 'flex';
      return;
    }
    Sound.setVolume(s.volume); Sound.setMusic(s.music);
    UI.init(this);
    this.yard.setDesign(this.profile.design);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    if (window.visualViewport) visualViewport.addEventListener('resize', () => this.resize());
    // Save when the app is backgrounded; pause a running battle so it isn't lost.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.save(); if (this.battle && !this.battle.paused && !this.battle.over) this.battle.togglePause(); }
    });
    // First interaction unlocks audio (browsers require a gesture).
    const unlock = () => { if (Sound.init()) { window.removeEventListener('pointerdown', unlock); if (!this.battle && this.profile.settings.music) Sound.startMusic(0.5); } };
    window.addEventListener('pointerdown', unlock);
    UI.show('sTitle'); UI.refreshTitle();
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));
  },

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    if (this.battle) this.battle.resize(); else this.yard.resize(W, H);
    if (UI.current === 'sYard') UI.layoutYard();
  },

  loop(now) {
    const ms = now - this.last, dt = Math.min(0.05, ms / 1000);
    this.last = now;
    if (this.battle) { this.battle.update(dt); this.battle.render(); }
    else { this.yard.update(dt); this.yard.render(); }
    if (this.governor.tick(ms)) { if (this.battle) this.battle.onPixelRatio(); else this.yard.resize(window.innerWidth, window.innerHeight); }
    requestAnimationFrame(t => this.loop(t));
  },

  save() { Progress.save(this.profile); },
  reset() {
    const s = this.profile.settings;
    this.profile = Progress.fresh(); this.profile.settings = s; this.profile.seen = {yard: true};
    this.save(); this.yard.setDesign(this.profile.design); UI.refreshTitle();
  },

  launchProblems(ctx) {
    const p = this.profile;
    if (ctx.mode === 'free') return [];
    const budget = ctx.mode === 'op' ? Progress.budget(p, ctx.op) : Progress.endlessBudgetCap(p);
    return Design.problems(Design.analyze(p.design, Progress.mods(p)), {budget, unlocked: Progress.unlocked(p)});
  },

  startBattle(ctx) {
    if (this.launchProblems(ctx).length) { UI.toast(this.launchProblems(ctx)[0]); Sound.play('deny'); return; }
    Sound.init(); Sound.stopMusic();
    if (this.battle) { this.battle.dispose(); this.battle = null; }
    document.getElementById('resultOv').classList.remove('on');
    document.getElementById('pauseOv').classList.remove('on');
    const p = this.profile;
    this.battle = new Battle(this, {mode: ctx.mode, op: ctx.op, design: Design.clone(p.design), difficulty: p.settings.difficulty,
      mods: Progress.mods(p), quality: this.quality, settings: p.settings});
    UI.show('sHud');
    this.battle.resize();
    this.haptic('medium');
  },

  onBattleEnd(r) {
    const p = this.profile;
    let rw;
    if (r.mode === 'endless') rw = Progress.applyEndless(p, r);
    else rw = Progress.applyResult(p, r);
    this.save();
    this.haptic(r.won || (r.mode === 'endless' && r.wave > 0) ? 'success' : 'error');
    setTimeout(() => UI.results(r, rw), r.retreat ? 0 : 400);
  },

  exitBattle() {
    if (!this.battle) return;
    this.battle.dispose(); this.battle = null;
    this.yard.resize(window.innerWidth, window.innerHeight);
    this.yard.setDesign(this.profile.design);
    if (this.profile.settings.music) Sound.startMusic(0.5);
  },

  // Haptics: the iOS app exposes a native bridge; browsers fall back to vibrate where available.
  haptic(kind) {
    try {
      const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic;
      if (h) { h.postMessage(kind); return; }
      if (navigator.vibrate) navigator.vibrate({light: 8, medium: 15, heavy: 30, success: [10, 40, 10], error: [30, 50, 30]}[kind] || 10);
    } catch (e) {}
  },
};
App.boot();
