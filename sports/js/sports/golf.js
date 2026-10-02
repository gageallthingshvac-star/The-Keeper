/* Sunny Sports — sports/golf.js
 * Placeholder module. The registration (menu card, modes, how-to, medals) is final; create()
 * builds a practice range — pull down and flick up to drive, three balls per player — so the
 * whole product flow (setup → how-to → play → results) works end to end until the full sport lands.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // ---------------------------------------------------------------------------------------------
  // Registration data
  // ---------------------------------------------------------------------------------------------

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="32" cy="51" rx="27" ry="9.5" fill="#5CC765"/>' +
    '<ellipse cx="32" cy="49.6" rx="23" ry="6.6" fill="#7AD67F"/>' +
    '<ellipse cx="40" cy="50" rx="5.2" ry="2.1" fill="#1F3A24"/>' +
    '<path d="M40 50V9" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M41.4 9.2 59 15.6 41.4 22Z" fill="#FF5A5F"/>' +
    '<path d="M41.4 9.2 59 15.6 41.4 13.6Z" fill="#FF8286"/>' +
    '<circle cx="19" cy="46" r="6.6" fill="#FFFFFF" stroke="#D9E1EC" stroke-width="1.4"/>' +
    '<g fill="#D3DBE6"><circle cx="17" cy="44.2" r="1"/><circle cx="20.6" cy="44" r="1"/><circle cx="18.8" cy="47.4" r="1"/><circle cx="22" cy="47" r="1"/><circle cx="15.6" cy="47.6" r="1"/></g>' +
    '</svg>';

  const DEF = {
    id: 'golf',
    name: 'Golf',
    tagline: 'Pull back, flick, sink it!',
    accent: '#2FAE55',
    tint: '#E5F7E8',
    icon: ICON,
    music: 'golf',
    players: { min: 1, max: 4 },
    opponent: false,
    modes: [
      { id: 'beginner', name: 'Beginner 3', desc: 'Three friendly holes to warm up.' },
      { id: 'expert', name: 'Expert 3', desc: 'Three tricky holes with water and sand.' },
      { id: 'full9', name: 'Full 9', desc: 'The whole parkland course. Can you beat par?' },
    ],
    howTo: {
      steps: [
        { gesture: 'drag-h', text: 'Drag sideways to aim your shot' },
        { gesture: 'drag-down-up', text: 'Pull down for power, then flick straight up' },
        { gesture: 'swipe-up-curve', text: 'A bent flick curves the ball — use it around trees' },
      ],
      tips: [
        'Watch the wind arrow: aim a little into the wind.',
        'On the green, a short gentle flick is all you need.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Finish Beginner 3 at even par or better' },
      { id: 'silver', name: 'Silver', desc: 'Finish Expert 3 at even par or better' },
      { id: 'gold', name: 'Gold', desc: 'Finish Full 9 under par' },
      { id: 'platinum', name: 'Platinum', desc: 'Make a hole in one' },
    ],
    create,
  };

  // ---------------------------------------------------------------------------------------------
  // Practice range
  // ---------------------------------------------------------------------------------------------

  const SHOTS = 3;
  const PIN = { x: 4, z: -150 };
  const GRAVITY = -9.8;

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, util: U } = ctx;
    const players = ctx.players;

    world.environment(scene, { sky: 'day', fogNear: 120, fogFar: 420, hillRadius: 230, trees: { ring: 95, count: 70 }, shadow: { center: new THREE.Vector3(0, 0, -3), size: 24 } });

    const rough = new THREE.Mesh(new THREE.PlaneGeometry(160, 260), world.mat(0xffffff, { map: world.texture('rough', { repeat: [20, 32] }) }));
    rough.rotation.x = -Math.PI / 2;
    rough.position.z = -90;
    rough.receiveShadow = true;
    scene.add(rough);
    const fairway = new THREE.Mesh(new THREE.PlaneGeometry(30, 180), world.mat(0xffffff, { map: world.texture('fairway', { repeat: [3, 18] }) }));
    fairway.rotation.x = -Math.PI / 2;
    fairway.position.set(0, 0.01, -80);
    fairway.receiveShadow = true;
    scene.add(fairway);
    const tee = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 5), world.mat(0xffffff, { map: world.texture('green') }));
    tee.position.y = 0.06;
    tee.receiveShadow = true;
    scene.add(tee);
    const green = new THREE.Mesh(new THREE.CircleGeometry(12, 48), world.mat(0xffffff, { map: world.texture('green', { repeat: [3, 3] }) }));
    green.rotation.x = -Math.PI / 2;
    green.position.set(PIN.x, 0.02, PIN.z);
    scene.add(green);
    const bunker = new THREE.Mesh(new THREE.CircleGeometry(5, 32), world.mat(0xffffff, { map: world.texture('sand') }));
    bunker.rotation.x = -Math.PI / 2;
    bunker.scale.set(1.6, 1, 1);
    bunker.position.set(PIN.x - 14, 0.03, PIN.z + 10);
    scene.add(bunker);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 8), world.mat(0xFFFFFF));
    pole.position.set(PIN.x, 1.5, PIN.z);
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), world.mat(0xFF5A5F, { side: THREE.DoubleSide }));
    flag.position.set(PIN.x + 0.7, 2.5, PIN.z);
    scene.add(flag);
    const rng = ctx.rng;
    for (const [x, z, kind, s] of [[-13, -30, 'round', 2.2], [15, -55, 'pine', 2.4], [-17, -85, 'round', 2.6], [18, -110, 'round', 2.1], [-12, -140, 'pine', 2.5]]) {
      const t = world.tree(kind, s, rng);
      t.position.set(x, 0, z);
      t.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(t);
    }
    const yard = world.label3d('150 m', { color: '#FFFFFF', bg: 'rgba(20,60,30,0.55)', size: 1.6 });
    yard.position.set(PIN.x, 4.4, PIN.z);
    scene.add(yard);

    const golfers = players.map(p => {
      const pal = pals.create(p.profile);
      pal.setFacing(-Math.PI / 2);
      pal.root.position.set(0.55, 0.12, 0.1);
      pal.setVisible(false);
      scene.add(pal.root);
      return pal;
    });

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), world.mat(0xFFFFFF, { kind: 'phong', shininess: 50 }));
    ball.castShadow = true;
    scene.add(ball);
    const trail = world.trail(ball, { color: 0xFFFFFF, width: 0.09, length: 30, opacity: 0.55 });

    const HOME_CAM = new THREE.Vector3(-0.6, 2.1, 5.2);
    const camLook = new THREE.Vector3(0, 1, -30);
    camera.position.copy(HOME_CAM);
    camera.lookAt(camLook);

    // HUD ----------------------------------------------------------------------------------------
    const top = ui.el('div', 'ss-hud-top');
    const turnChip = ui.el('div', 'ss-chip');
    const bestChip = ui.el('div', 'ss-chip dark');
    top.append(turnChip, bestChip);
    ctx.hud.appendChild(top);

    // State --------------------------------------------------------------------------------------
    const best = players.map(() => null);   // closest finish to the pin, meters
    let turn = 0;
    let phase = 'wait';                       // 'aim' | 'flight' | 'wait' | 'done'
    let flight = null;
    let hint = null;
    let autoplay = false;
    let ambience = null;

    const current = () => turn % players.length;

    function refreshHud() {
      const i = current();
      turnChip.textContent = (players.length > 1 ? players[i].profile.name + ' · ' : '') + 'Ball ' + Math.min(SHOTS, Math.floor(turn / players.length) + 1) + ' / ' + SHOTS;
      bestChip.textContent = best[i] == null ? 'To pin: 150 m' : 'Best: ' + U.fmt.meters(best[i]);
    }

    function readyGolfer() {
      golfers.forEach((pal, i) => pal.setVisible(i === current()));
      const pal = golfers[current()];
      pal.play('idle_ready');
      pal.setExpression('focus');
      ball.position.set(0, 0.18, 0);
      trail.clear();
      camera.position.copy(HOME_CAM);
      camLook.set(0, 1, -30);
      phase = 'aim';
      refreshHud();
      if (turn === 0) hint = ui.hint({ gesture: 'drag-down-up', text: 'Pull down, then flick up!' });
      if (autoplay) ctx.wait(0.8).then(autoShot);
    }

    function autoShot() {
      if (autoplay && phase === 'aim') shoot(2.5 + rng.range(-0.3, 0.5), rng.range(-0.05, 0.05), rng.range(0.75, 1));
    }

    function onSwipe(s) {
      if (phase !== 'aim' || s.dy > -30 || s.nspeed < 0.3) return;
      const pull = U.clamp((s.start.y - Math.min(...s.path.map(q => q.y))) / Math.max(1, ctx.engine.size.h), 0, 1);
      shoot(s.nspeed, s.lateral, U.clamp(0.55 + pull * 1.6, 0.55, 1));
    }

    function shoot(nspeed, lateral, power) {
      if (hint) { hint.hide(); hint = null; }
      phase = 'flight';
      const pal = golfers[current()];
      pal.play('hop');
      const k = U.clamp(nspeed / 3, 0.3, 1) * power;
      audio.sfx('golf_drive', { intensity: k });
      audio.sfx('voice_hup');
      const speed = 26 + k * 30;
      const loft = 0.36;
      const yaw = Math.atan2(PIN.x, -PIN.z) + U.clamp(lateral, -0.5, 0.5) * 0.4 + rng.range(-0.03, 0.03);
      flight = { vel: new THREE.Vector3(Math.sin(yaw) * Math.cos(loft) * speed, Math.sin(loft) * speed, -Math.cos(yaw) * Math.cos(loft) * speed) };
      ctx.engine.shake(0.03, 0.2);
    }

    async function landed() {
      phase = 'wait';
      flight = null;
      const p = ball.position;
      world.ring(scene, new THREE.Vector3(p.x, 0.05, p.z), { color: 0xFFFFFF, radius: 0.8, life: 0.7 });
      const toPin = Math.hypot(p.x - PIN.x, p.z - PIN.z);
      const i = current();
      const rounded = Math.round(toPin * 10) / 10;
      best[i] = best[i] == null ? rounded : Math.min(best[i], rounded);
      refreshHud();
      const pal = golfers[i];
      if (toPin < 6) {
        audio.sfx('golf_land_grass');
        audio.sfx('crowd_applause', { intensity: 0.8 });
        ui.banner('ON THE GREEN!', { kind: 'great', sub: U.fmt.meters(rounded) + ' to the pin', duration: 1.5 });
        pal.play('cheer');
      } else {
        audio.sfx(Math.abs(p.x) > 15 ? 'golf_tree' : 'golf_land_grass');
        ui.banner(U.fmt.meters(rounded), { kind: toPin < 25 ? 'good' : 'info', sub: 'to the pin', duration: 1.2 });
        pal.play(toPin < 25 ? 'clap' : 'shrug');
      }
      await ctx.wait(2);
      turn += 1;
      if (turn >= SHOTS * players.length) finishGame(); else readyGolfer();
    }

    function finishGame() {
      phase = 'done';
      const order = best.map((d, i) => ({ d: d == null ? 999 : d, i })).sort((a, b) => a.d - b.d);
      const winner = order[0];
      const rec = ctx.save.record(DEF.id, 'closest', winner.d, { label: 'Closest to Pin', higherIsBetter: false, profileId: players[winner.i].profile.id, fmt: 'meters' });
      ctx.finish({
        outcome: players.length > 1 ? 'done' : winner.d < 10 ? 'win' : 'done',
        title: winner.d < 10 ? 'Dialed In!' : 'Nice Range Session!',
        headline: U.fmt.meters(best[0]), headlineLabel: 'Closest to Pin',
        players: players.map((p, i) => ({
          profileId: p.profile.id, name: p.profile.name, profile: p.profile, score: U.fmt.meters(best[i]),
          place: 1 + order.findIndex(o => o.d === (best[i] == null ? 999 : best[i])), isCpu: false,
          skillDelta: Math.round(U.clamp(30 - best[i], -20, 30)),
        })),
        stats: [{ label: 'Balls', value: String(SHOTS) }, { label: 'Best', value: U.fmt.meters(winner.d) }],
        records: [{ label: 'Closest to Pin', value: U.fmt.meters(winner.d), isNew: rec.isNew }],
        medals: [],
        celebrate: winner.d < 10,
      });
    }

    ctx.input.on('swipe', onSwipe);
    refreshHud();

    // Lifecycle ----------------------------------------------------------------------------------
    return {
      start() {
        ambience = audio.loop('park_ambience', { vol: 0.5 });
        readyGolfer();
      },
      update(dt, t) {
        for (const pal of golfers) pal.update(dt);
        flag.rotation.y = Math.sin(t * 1.6) * 0.25;
        if (flight) {
          flight.vel.y += GRAVITY * dt;
          ball.position.addScaledVector(flight.vel, dt);
          camLook.lerp(ball.position, 1 - Math.exp(-dt * 2.5));
          if (ball.position.y <= 0.04) { ball.position.y = 0.04; landed(); }
        }
        camera.lookAt(camLook);
      },
      dispose() {
        if (ambience) ambience.stop(0.3);
        trail.dispose();
        for (const pal of golfers) pal.dispose();
      },
      debugState() { return { phase, turn, best: best.slice() }; },
      debug: {
        autoplay(on) { autoplay = on !== false; autoShot(); },
      },
    };
  }

  SS.registerSport(DEF);
})();
