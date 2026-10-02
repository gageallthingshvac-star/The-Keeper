/* Sunny Sports — sports/tennis.js
 * Placeholder module. The registration (menu card, modes, how-to, medals) is final; create()
 * builds a practice court — the CPU feeds three balls, swipe to hit them back — so the whole
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
    '<g transform="rotate(-38 26 26)">' +
    '<rect x="23.2" y="40" width="5.6" height="20" rx="2.8" fill="#2F3B52"/>' +
    '<rect x="23.2" y="49" width="5.6" height="11" rx="2.8" fill="#FF5A5F"/>' +
    '<path d="M22 38.5 26 44 30 38.5" stroke="#8E5BE0" stroke-width="3.2" fill="none" stroke-linejoin="round"/>' +
    '<ellipse cx="26" cy="21" rx="14.5" ry="18.5" fill="#F3EEFF" stroke="#8E5BE0" stroke-width="4"/>' +
    '<g stroke="#B9A6E8" stroke-width="1.3">' +
    '<path d="M18 9v24M22 5.4v31.2M26 4v34M30 5.4v31.2M34 9v24"/>' +
    '<path d="M14.2 13h23.6M12.4 17h27.2M12 21h28M12.4 25h27.2M14.2 29h23.6"/></g></g>' +
    '<circle cx="47" cy="46" r="10.5" fill="#D7F04A"/>' +
    '<path d="M38.4 40.4C43 42 44.5 48 41.6 53.7M55.6 38.3C51 40 49.5 46 52.4 51.6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  const DEF = {
    id: 'tennis',
    name: 'Tennis',
    tagline: 'Time it. Smash it. Ace!',
    accent: '#8E5BE0',
    tint: '#F1EAFF',
    icon: ICON,
    music: 'tennis',
    players: { min: 1, max: 1 },
    opponent: true,
    modes: [
      { id: 'quick', name: 'Quick Match', desc: 'One game, first to four points.' },
      { id: 'match', name: 'Match', desc: 'Best of three games against your rival.' },
      { id: 'rally', name: 'Rally Challenge', desc: 'Keep the rally going as long as you can.' },
    ],
    howTo: {
      steps: [
        { gesture: 'swipe-across', text: 'Swipe across as the ball arrives to swing' },
        { gesture: 'swipe-up', text: 'Swipe faster for a harder shot' },
        { gesture: 'tap', text: 'Tap to toss, then swipe up to serve' },
      ],
      tips: [
        'Swing early to aim cross-court, late to go down the line.',
        'Your Pal runs to the ball for you — just focus on timing.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Win a Quick Match' },
      { id: 'silver', name: 'Silver', desc: 'Win a Match against a Pro' },
      { id: 'gold', name: 'Gold', desc: 'Reach a 30-hit rally in Rally Challenge' },
      { id: 'platinum', name: 'Platinum', desc: 'Win a Match against Odessa without losing a game' },
    ],
    create,
  };

  // ---------------------------------------------------------------------------------------------
  // Practice court
  // ---------------------------------------------------------------------------------------------

  const FEEDS = 3;
  const COURT_W = 10.97, COURT_L = 23.77, SINGLES_W = 8.23;
  const BALL_R = 0.034;
  const GRAVITY = -9.8;

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, util: U } = ctx;
    const me = ctx.players[0].profile;
    const opp = ctx.opponent;

    world.environment(scene, { sky: 'day', trees: { ring: 60, count: 36 }, shadow: { center: new THREE.Vector3(0, 0, 0), size: 32 } });

    const apron = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 16, COURT_L + 30), world.mat(0x3E8F5A));
    apron.rotation.x = -Math.PI / 2;
    apron.receiveShadow = true;
    scene.add(apron);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_L), world.mat(0xffffff, { map: world.texture('hardcourt', { repeat: [2, 4] }) }));
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.005;
    court.receiveShadow = true;
    scene.add(court);

    const lineMat = world.mat(0xFFFFFF);
    const line = (w, l, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.01, z);
      scene.add(m);
    };
    for (const x of [-COURT_W / 2, COURT_W / 2, -SINGLES_W / 2, SINGLES_W / 2]) line(0.05, COURT_L, x, 0);
    for (const z of [-COURT_L / 2, COURT_L / 2]) line(COURT_W, 0.05, 0, z);
    for (const z of [-6.4, 6.4]) line(SINGLES_W, 0.05, 0, z);
    line(0.05, 12.8, 0, 0);

    const net = new THREE.Mesh(new THREE.BoxGeometry(COURT_W + 0.6, 0.86, 0.02), world.mat(0x26303F, { transparent: true, opacity: 0.75 }));
    net.position.y = 0.46;
    scene.add(net);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(COURT_W + 0.6, 0.06, 0.04), lineMat);
    tape.position.y = 0.9;
    scene.add(tape);
    for (const x of [-(COURT_W / 2 + 0.3), COURT_W / 2 + 0.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.07, 10), world.mat(0x2F5D50));
      post.position.set(x, 0.53, 0);
      post.castShadow = true;
      scene.add(post);
    }

    const stands = world.stands(scene, { x: 0, y: 0, z: -COURT_L / 2 - 6, width: 22, rows: 5, rise: 0.45, depth: 0.8, facing: 0, color: 0x6C7FA8 });
    const crowd = world.crowd(scene, { rows: stands.userData.rows, density: 0.8, seed: ctx.seed });

    const player = pals.create(me);
    player.setFacing(Math.PI);
    player.root.position.set(0.8, 0, COURT_L / 2 - 0.6);
    scene.add(player.root);
    const rival = pals.create(opp.profile);
    rival.root.position.set(-0.6, 0, -COURT_L / 2 + 0.6);
    scene.add(rival.root);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 2, 16, 12), world.mat(0xD7F04A, { kind: 'phong', shininess: 40 }));
    ball.castShadow = true;
    ball.visible = false;
    scene.add(ball);
    const trail = world.trail(ball, { color: 0xF4FFB0, width: 0.06, length: 18, opacity: 0.5 });

    camera.position.set(0, 7.2, COURT_L / 2 + 7);
    camera.lookAt(0, 0, 1);

    // HUD ----------------------------------------------------------------------------------------
    const top = ui.el('div', 'ss-hud-top');
    const meChip = ui.el('div', 'ss-chip');
    const oppChip = ui.el('div', 'ss-chip dark');
    top.append(meChip, oppChip);
    ctx.hud.appendChild(top);

    // State --------------------------------------------------------------------------------------
    const score = { me: 0, cpu: 0 };
    let feeds = 0;
    let phase = 'wait';          // 'incoming' | 'outgoing' | 'wait' | 'done'
    let flight = null;           // { vel: Vector3 }
    let hint = null;
    let autoplay = false;
    let ambience = null;
    let swung = false;

    function refreshHud() {
      meChip.textContent = me.name + ' ' + score.me;
      oppChip.textContent = opp.profile.name + ' ' + score.cpu;
    }

    function launch(from, to, time) {
      ball.position.copy(from);
      const vel = new THREE.Vector3().subVectors(to, from).divideScalar(time);
      vel.y = (to.y - from.y - 0.5 * GRAVITY * time * time) / time;
      flight = { vel };
      ball.visible = true;
      trail.clear();
    }

    function feed() {
      phase = 'incoming';
      swung = false;
      rival.play('hop');
      audio.sfx('racket_hit', { intensity: 0.4, pan: -0.2 });
      const target = new THREE.Vector3(player.root.position.x - 0.5, 0.9, player.root.position.z - 0.3);
      const time = 1.35 - opp.skill * 0.25;
      launch(new THREE.Vector3(rival.root.position.x + 0.4, 1.0, rival.root.position.z), target, time);
      if (feeds === 0) hint = ui.hint({ gesture: 'swipe-across', text: 'Swipe to swing!' });
    }

    function onSwipe(s) {
      if (phase !== 'incoming' || swung || s.nspeed < 0.4) return;
      swing(s.nspeed);
    }

    function swing(nspeed) {
      swung = true;
      if (hint) { hint.hide(); hint = null; }
      const near = ball.position.z > COURT_L / 2 - 6;
      audio.sfx('voice_hup');
      audio.sfx('swing_light');
      player.play('hop');
      if (!near) { player.setExpression('surprised', 1); return; }
      phase = 'outgoing';
      const power = U.clamp(nspeed / 3, 0.2, 1);
      const winner = power > 0.5 + opp.skill * 0.4 * ctx.rng.next();
      audio.sfx('racket_hit', { intensity: power });
      const land = new THREE.Vector3(ctx.rng.range(-3.4, 3.4), 0, -COURT_L / 2 + 1.5 + (1 - power) * 4);
      launch(ball.position.clone(), land, 1.4 - power * 0.5);
      flight.winner = winner;
    }

    async function pointOver(mine, text, kind) {
      phase = 'wait';
      if (mine) score.me += 1; else score.cpu += 1;
      refreshHud();
      if (mine) {
        audio.sfx('crowd_cheer', { intensity: 0.7 });
        crowd.cheer(0.8, 1.6);
        player.play('cheer');
        rival.play('shrug');
      } else {
        audio.sfx('crowd_aww', { intensity: 0.5 });
        player.play('sad');
        rival.play('clap');
      }
      ui.banner(text, { kind, duration: 1.2 });
      feeds += 1;
      await ctx.wait(1.6);
      ball.visible = false;
      if (feeds >= FEEDS) finishGame(); else feed();
    }

    function onLand() {
      const p = ball.position;
      world.ring(scene, new THREE.Vector3(p.x, 0.02, p.z), { color: 0xFFFFFF, radius: 0.3, life: 0.5 });
      audio.sfx('ball_bounce_court');
      if (phase === 'incoming') pointOver(false, 'MISSED!', 'bad');
      else if (flight && flight.winner) pointOver(true, 'WINNER!', 'great');
      else {
        rival.play('hop');
        audio.sfx('racket_hit', { intensity: 0.6, pan: -0.2 });
        pointOver(false, 'RETURNED!', 'info');
      }
      flight = null;
    }

    function finishGame() {
      phase = 'done';
      const won = score.me > score.cpu;
      const rec = ctx.save.record(DEF.id, 'practice', score.me, { label: 'Practice Winners', profileId: me.id });
      ctx.finish({
        outcome: won ? 'win' : 'lose',
        title: won ? 'You Win!' : 'Good Game!',
        headline: score.me + ' – ' + score.cpu, headlineLabel: 'Points',
        players: [
          { profileId: me.id, name: me.name, profile: me, score: String(score.me), place: won ? 1 : 2, isCpu: false,
            skillDelta: Math.round((won ? 30 : -12) + opp.skill * 30) },
          { profileId: opp.profile.id, name: opp.profile.name, profile: opp.profile, score: String(score.cpu), place: won ? 2 : 1, isCpu: true },
        ],
        stats: [{ label: 'Winners', value: String(score.me) }, { label: 'Balls Fed', value: String(FEEDS) }],
        records: [{ label: 'Practice Winners', value: String(score.me), isNew: rec.isNew }],
        medals: [],
        celebrate: won,
      });
    }

    ctx.input.on('swipe', onSwipe);
    refreshHud();

    // Lifecycle ----------------------------------------------------------------------------------
    return {
      start() {
        ambience = audio.loop('stadium_ambience', { vol: 0.5 });
        player.play('idle_ready');
        rival.play('idle_ready');
        ctx.wait(0.6).then(feed);
      },
      update(dt) {
        player.update(dt);
        rival.update(dt);
        if (autoplay && phase === 'incoming' && !swung && ball.position.z > COURT_L / 2 - 3) swing(2 + ctx.rng.range(-0.3, 0.8));
        if (flight) {
          flight.vel.y += GRAVITY * dt;
          ball.position.addScaledVector(flight.vel, dt);
          player.lookAt(ball.position);
          if (ball.position.y <= BALL_R) { ball.position.y = BALL_R; onLand(); }
        }
      },
      dispose() {
        if (ambience) ambience.stop(0.3);
        trail.dispose();
        crowd.dispose();
        player.dispose();
        rival.dispose();
      },
      debugState() { return { phase, feeds, score: Object.assign({}, score) }; },
      debug: {
        autoplay(on) { autoplay = on !== false; },
      },
    };
  }

  SS.registerSport(DEF);
})();
