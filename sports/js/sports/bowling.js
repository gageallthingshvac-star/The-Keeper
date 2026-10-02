/* Sunny Sports — sports/bowling.js
 * Placeholder module. The registration (menu card, modes, how-to, medals) is final; create()
 * builds a small practice alley — swipe up to roll, three rolls per player — so the whole
 * product flow (setup → how-to → play → results) works end to end until the full sport lands.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // ---------------------------------------------------------------------------------------------
  // Registration data
  // ---------------------------------------------------------------------------------------------

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="34" cy="58" rx="24" ry="3.5" fill="#000" opacity=".12"/>' +
    '<g transform="translate(47 2) scale(.92)">' +
    '<path d="M0 6C5.4 6 6.8 11 5.9 15.5 5.3 18.7 3.6 20 3.6 22.4 3.6 26 9.6 30 9.6 40.5 9.6 49 7 54 5.4 56H-5.4C-7 54-9.6 49-9.6 40.5-9.6 30-3.6 26-3.6 22.4-3.6 20-5.3 18.7-5.9 15.5-6.8 11-5.4 6 0 6Z" fill="#FFFFFF" stroke="#DCE3EE" stroke-width="1.6"/>' +
    '<path d="M-4.4 19.6h8.8M-4 24h8" stroke="#E8343A" stroke-width="2.6" stroke-linecap="round"/></g>' +
    '<g transform="translate(36 8) scale(.8)">' +
    '<path d="M0 6C5.4 6 6.8 11 5.9 15.5 5.3 18.7 3.6 20 3.6 22.4 3.6 26 9.6 30 9.6 40.5 9.6 49 7 54 5.4 56H-5.4C-7 54-9.6 49-9.6 40.5-9.6 30-3.6 26-3.6 22.4-3.6 20-5.3 18.7-5.9 15.5-6.8 11-5.4 6 0 6Z" fill="#FFFFFF" stroke="#DCE3EE" stroke-width="1.8"/>' +
    '<path d="M-4.4 19.6h8.8M-4 24h8" stroke="#E8343A" stroke-width="2.8" stroke-linecap="round"/></g>' +
    '<circle cx="24" cy="39" r="18" fill="#3C6BE0"/>' +
    '<path d="M10.5 30.5A16 16 0 0 1 33 23" stroke="#7FA5FF" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<circle cx="21" cy="33" r="3" fill="#1D2F6B"/><circle cx="29" cy="32" r="3" fill="#1D2F6B"/><circle cx="25" cy="41" r="3.4" fill="#1D2F6B"/>' +
    '</svg>';

  const DEF = {
    id: 'bowling',
    name: 'Bowling',
    tagline: 'Hook it for a strike!',
    accent: '#FF5A5F',
    tint: '#FFE8E6',
    icon: ICON,
    music: 'bowling',
    players: { min: 1, max: 4 },
    opponent: false,
    modes: [
      { id: 'game', name: '10 Frames', desc: 'A full game. Can you roll a 200?' },
      { id: 'spare', name: 'Spare Challenge', desc: 'Tricky leaves, one ball each. Pick them all up!' },
      { id: 'hundred', name: '100-Pin', desc: 'Ten rolls, one huge rack. Knock down as many as you can.' },
    ],
    howTo: {
      steps: [
        { gesture: 'drag-h', text: 'Drag sideways to line up your shot' },
        { gesture: 'swipe-up', text: 'Swipe up to roll — faster swipe, faster ball' },
        { gesture: 'swipe-up-curve', text: 'Bend your swipe to hook the ball into the pocket' },
      ],
      tips: [
        'Aim just right of the head pin for the most strikes.',
        'A gentle hook beats a fast straight ball.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Score 120 in 10 Frames' },
      { id: 'silver', name: 'Silver', desc: 'Score 170 in 10 Frames' },
      { id: 'gold', name: 'Gold', desc: 'Score 220 in 10 Frames' },
      { id: 'platinum', name: 'Platinum', desc: 'Pick up all 10 spares in Spare Challenge' },
    ],
    create,
  };

  // ---------------------------------------------------------------------------------------------
  // Practice alley
  // ---------------------------------------------------------------------------------------------

  const ROLLS = 3;
  const LANE_W = 1.066;
  const HEAD_PIN_Z = -18.29;
  const BALL_R = 0.109;
  const PIN_SPOTS = [[0, 0], [-0.5, 1], [0.5, 1], [-1, 2], [0, 2], [1, 2], [-1.5, 3], [-0.5, 3], [0.5, 3], [1.5, 3]];

  function pinGeometry(THREE) {
    const prof = [[0, 0], [0.026, 0], [0.042, 0.03], [0.058, 0.09], [0.06, 0.125], [0.053, 0.17], [0.036, 0.215],
      [0.025, 0.25], [0.026, 0.272], [0.033, 0.31], [0.033, 0.345], [0.022, 0.372], [0, 0.38]];
    return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 16);
  }

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, util: U } = ctx;
    const players = ctx.players;

    world.environment(scene, { sky: 'indoor', background: 0x2B2840, fogNear: 24, fogFar: 60 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 34), world.mat(0xffffff, { map: world.texture('carpet', { repeat: [6, 12] }) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -12);
    floor.receiveShadow = true;
    scene.add(floor);

    const laneMat = world.mat(0xffffff, { map: world.texture('wood_lane', { repeat: [1, 6] }) });
    const gutterMat = world.mat(0x8E99A8);
    for (const x of [-2.1, 0, 2.1]) {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(LANE_W, 0.05, 21), laneMat);
      lane.position.set(x, -0.025, -9.5);
      lane.receiveShadow = true;
      scene.add(lane);
      for (const side of [-1, 1]) {
        const gutter = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 21), gutterMat);
        gutter.position.set(x + side * (LANE_W / 2 + 0.12), -0.04, -9.5);
        scene.add(gutter);
      }
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), world.mat(0x3B3560));
    back.position.set(0, 1.5, -20.2);
    scene.add(back);
    const sign = world.label3d('SUNNY LANES', { color: '#FFC93C', bg: null, size: 0.7 });
    sign.position.set(0, 2.2, -20);
    scene.add(sign);

    const pinGeo = pinGeometry(THREE);
    const pinMat = world.mat(0xFFFFFF, { kind: 'phong', shininess: 60 });
    const stripeGeo = new THREE.TorusGeometry(0.027, 0.006, 6, 16);
    const stripeMat = world.mat(0xE8343A, { kind: 'phong' });
    const pins = PIN_SPOTS.map(([col, row]) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(pinGeo, pinMat);
      body.castShadow = true;
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.245;
      g.add(body, stripe);
      g.userData.home = new THREE.Vector3(col * 0.3048, 0, HEAD_PIN_Z - row * 0.2639);
      g.position.copy(g.userData.home);
      scene.add(g);
      return g;
    });

    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), world.mat(0x3C6BE0, { kind: 'phong', shininess: 80 }));
    ball.castShadow = true;
    scene.add(ball);

    const bowlers = players.map(p => {
      const pal = pals.create(p.profile);
      pal.setFacing(Math.PI);
      pal.root.position.set(-0.42, 0, 0.7);
      pal.setVisible(false);
      scene.add(pal.root);
      return pal;
    });

    const homeCamera = () => { camera.position.set(0.15, 2.3, 4.6); camera.lookAt(0, 0.1, -11); };
    homeCamera();

    // HUD ----------------------------------------------------------------------------------------
    const top = ui.el('div', 'ss-hud-top');
    const turnChip = ui.el('div', 'ss-chip');
    const scoreChip = ui.el('div', 'ss-chip dark');
    top.append(turnChip, scoreChip);
    ctx.hud.appendChild(top);

    // State --------------------------------------------------------------------------------------
    const scores = players.map(() => 0);
    let turn = 0;                 // index into the roll sequence (player-major per round)
    let phase = 'wait';           // 'aim' | 'roll' | 'wait' | 'done'
    let roll = null;              // { vx, speed, curve, loop }
    let hint = null;
    let autoplay = false;
    let ambience = null;

    const current = () => turn % players.length;
    const round = () => Math.floor(turn / players.length) + 1;

    function refreshHud() {
      const p = players[current()].profile;
      turnChip.textContent = (players.length > 1 ? p.name + ' · ' : '') + 'Roll ' + Math.min(ROLLS, round()) + ' / ' + ROLLS;
      scoreChip.textContent = scores[current()] + ' pins';
    }

    function resetRack() {
      for (const pin of pins) {
        U.killTweens(pin.rotation);
        U.killTweens(pin.position);
        pin.position.copy(pin.userData.home);
        pin.rotation.set(0, 0, 0);
      }
    }

    function readyBowler() {
      bowlers.forEach((pal, i) => pal.setVisible(i === current()));
      const pal = bowlers[current()];
      pal.play('idle_ready');
      pal.setExpression('focus');
      ball.position.set(-0.05, BALL_R, 0.62);
      phase = 'aim';
      refreshHud();
      if (turn === 0) hint = ui.hint({ gesture: 'swipe-up', text: 'Swipe up to roll!' });
      if (autoplay) ctx.wait(0.8).then(autoRoll);
    }

    function onSwipe(s) {
      if (phase !== 'aim' || s.dy > -30 || s.nspeed < 0.35) return;
      throwBall(s.nspeed, s.lateral, s.dx / Math.max(1, ctx.engine.size.w));
    }

    function throwBall(nspeed, lateral, aimX) {
      if (hint) { hint.hide(); hint = null; }
      phase = 'roll';
      const pal = bowlers[current()];
      pal.play('hop');
      audio.sfx('bowl_release', { intensity: U.clamp(nspeed / 3, 0.2, 1) });
      roll = {
        vx: U.clamp(aimX * 0.8, -0.25, 0.25),
        speed: U.clamp(5 + nspeed * 2.6, 5, 13),
        curve: U.clamp(lateral * 2.2, -0.8, 0.8),
        loop: audio.loop('ball_roll', { vol: 0.8, rate: 1 }),
      };
    }

    function autoRoll() {
      if (!ctx.alive || phase !== 'aim' || !autoplay) return;
      throwBall(2.2 + ctx.rng.range(-0.4, 0.6), ctx.rng.range(-0.12, 0.05), ctx.rng.range(-0.04, 0.06));
    }

    function knockPins(ballX) {
      const miss = Math.abs(ballX - 0.06);
      const count = Math.abs(ballX) > LANE_W / 2 ? 0 : U.clamp(Math.round(10 - miss * 26 + ctx.rng.range(-1.2, 1.2)), 1, 10);
      const order = pins.slice().sort((a, b) => Math.abs(a.position.x - ballX) - Math.abs(b.position.x - ballX));
      order.slice(0, count).forEach((pin, i) => {
        const dir = Math.sign(pin.position.x - ballX) || (i % 2 ? 1 : -1);
        U.tween(pin.rotation, { x: -1.45, z: dir * ctx.rng.range(0.2, 0.9) }, 0.45, { delay: i * 0.03, ease: 'outQuad' });
        U.tween(pin.position, { x: pin.position.x + dir * ctx.rng.range(0.05, 0.3), z: pin.position.z - 0.25, y: 0.06 }, 0.45, { delay: i * 0.03 });
      });
      return count;
    }

    async function resolveRoll(ballX) {
      phase = 'wait';
      if (roll && roll.loop) roll.loop.stop(0.2);
      const gutter = Math.abs(ballX) > LANE_W / 2;
      const count = gutter ? 0 : knockPins(ballX);
      const who = current();
      scores[who] += count;
      refreshHud();
      const pal = bowlers[who];
      if (gutter) {
        audio.sfx('gutter_drop');
        audio.sfx('crowd_aww', { intensity: 0.5 });
        ui.banner('GUTTER', { kind: 'bad', duration: 1.1 });
        pal.play('sad');
      } else {
        audio.sfx('pins_hit', { intensity: count / 10 });
        if (count === 10) {
          audio.sfx('crowd_cheer', { intensity: 1 });
          audio.duck(0.5, 1.6);
          ctx.engine.shake(0.08, 0.35);
          ui.banner('STRIKE!', { kind: 'huge', duration: 1.6 });
          world.confetti(scene, new THREE.Vector3(0, 0.6, HEAD_PIN_Z - 0.4), { count: 90 });
          pal.play('cheer');
        } else {
          ui.banner(count + (count === 1 ? ' PIN' : ' PINS'), { kind: count >= 7 ? 'good' : 'info', duration: 1.1 });
          pal.play(count >= 7 ? 'clap' : 'shrug');
        }
      }
      await ctx.wait(1.9);
      resetRack();
      turn += 1;
      if (turn >= ROLLS * players.length) finishGame();
      else readyBowler();
    }

    function finishGame() {
      phase = 'done';
      const best = Math.max(...scores);
      const ranked = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
      const placeOf = i => 1 + ranked.findIndex(r => r.s === scores[i]);
      const rec = ctx.save.record(DEF.id, 'practice', best, { label: 'Practice Pins', profileId: players[ranked[0].i].profile.id });
      ctx.finish({
        outcome: players.length > 1 ? 'done' : best >= 24 ? 'win' : 'done',
        title: best >= 24 ? 'Great Rolling!' : 'Nice Practice!',
        headline: String(scores[0]), headlineLabel: 'Pins',
        players: players.map((p, i) => ({
          profileId: p.profile.id, name: p.profile.name, profile: p.profile, score: String(scores[i]),
          place: placeOf(i), isCpu: false, skillDelta: Math.round((scores[i] - 18) * 2.5),
        })),
        stats: [{ label: 'Rolls', value: String(ROLLS) }, { label: 'Best Roll', value: String(Math.min(10, best)) }],
        records: [{ label: 'Practice Pins', value: String(best), isNew: rec.isNew }],
        medals: [],
        celebrate: best >= 24,
      });
    }

    ctx.input.on('swipe', onSwipe);
    refreshHud();

    // Lifecycle ----------------------------------------------------------------------------------
    return {
      start() {
        ambience = audio.loop('alley_ambience', { vol: 0.5 });
        readyBowler();
      },
      update(dt) {
        for (const pal of bowlers) pal.update(dt);
        if (phase !== 'roll' || !roll) return;
        const p = ball.position;
        const k = U.clamp(-p.z / 18, 0, 1);
        p.x += (roll.vx + roll.curve * k * k) * dt;
        p.z -= roll.speed * dt;
        ball.rotation.x -= roll.speed * dt / BALL_R;
        if (Math.abs(p.x) > LANE_W / 2 + 0.05) p.y = Math.max(BALL_R - 0.06, p.y - dt * 0.6);
        camera.position.z = Math.max(-9, U.damp(camera.position.z, p.z + 3.4, 3, dt));
        camera.lookAt(0, 0.35, Math.min(-9, p.z - 6));
        if (p.z <= HEAD_PIN_Z + 0.1) {
          const x = p.x;
          roll.loop.stop(0.2);
          roll = null;
          resolveRoll(x).then(homeCamera);
        }
      },
      dispose() {
        if (roll && roll.loop) roll.loop.stop(0.1);
        if (ambience) ambience.stop(0.3);
        for (const pin of pins) { U.killTweens(pin.rotation); U.killTweens(pin.position); }
        for (const pal of bowlers) pal.dispose();
        pinGeo.dispose();
        stripeGeo.dispose();
      },
      debugState() { return { phase, turn, scores: scores.slice() }; },
      debug: {
        autoplay(on) { autoplay = on !== false; if (autoplay) autoRoll(); },
      },
    };
  }

  SS.registerSport(DEF);
})();
