/* Sunny Sports — sports/baseball.js
 * Placeholder module. The registration (menu card, modes, how-to, medals) is final; create()
 * builds a practice diamond — three pitches, swipe across to swing — so the whole product flow
 * (setup → how-to → play → results) works end to end until the full sport lands.
 */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};

  // ---------------------------------------------------------------------------------------------
  // Registration data
  // ---------------------------------------------------------------------------------------------

  const ICON =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<g transform="rotate(42 32 32)">' +
    '<path d="M30.2 56V38C30.2 30 27.2 24 27.2 15.5 27.2 9.5 29.3 6 32 6S36.8 9.5 36.8 15.5C36.8 24 33.8 30 33.8 38V56Z" fill="#E2AE6E"/>' +
    '<path d="M33.6 9.2C35.2 11 35.6 14 35.4 17" stroke="#F6D7A8" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '<rect x="30.1" y="44" width="3.8" height="12" rx="1.5" fill="#2E86F0"/>' +
    '<ellipse cx="32" cy="57" rx="4.4" ry="2.2" fill="#8A5A34"/></g>' +
    '<circle cx="44" cy="44" r="13.5" fill="#FFFFFF" stroke="#D9E1EC" stroke-width="1.6"/>' +
    '<path d="M35.2 34.4C39.8 39.6 39.8 48.4 35.2 53.6M52.8 34.4C48.2 39.6 48.2 48.4 52.8 53.6" stroke="#E8343A" stroke-width="2.2" fill="none" stroke-dasharray="2.2 2.2" stroke-linecap="round"/>' +
    '</svg>';

  const DEF = {
    id: 'baseball',
    name: 'Baseball',
    tagline: 'Swing for the fences!',
    accent: '#2E86F0',
    tint: '#E4F0FF',
    icon: ICON,
    music: 'baseball',
    players: { min: 1, max: 1 },
    opponent: true,
    modes: [
      { id: 'derby', name: 'Home Run Derby', desc: 'Ten pitches. Hit as many home runs as you can.' },
      { id: 'sudden', name: 'Sudden Death', desc: 'Keep hitting homers. One miss and you\'re out!' },
    ],
    howTo: {
      steps: [
        { gesture: 'swipe-across', text: 'Swipe across as the pitch arrives to swing' },
        { gesture: 'swipe-up', text: 'Swipe upward for a high fly, flat for a line drive' },
        { gesture: 'tap', text: 'Hold back on bad pitches — no swing, no strike' },
      ],
      tips: [
        'Swing early to pull the ball, late to push it to the other field.',
        'Watch the pitcher\'s hand: fast balls arrive sooner than curves.',
      ],
    },
    medals: [
      { id: 'bronze', name: 'Bronze', desc: 'Hit 3 home runs in one Derby' },
      { id: 'silver', name: 'Silver', desc: 'Hit 6 home runs in one Derby' },
      { id: 'gold', name: 'Gold', desc: 'Hit a 150 m home run' },
      { id: 'platinum', name: 'Platinum', desc: 'Hit 10 in a row in Sudden Death' },
    ],
    create,
  };

  // ---------------------------------------------------------------------------------------------
  // Practice diamond
  // ---------------------------------------------------------------------------------------------

  const PITCHES = 3;
  const MOUND_Z = -18.44;
  const FENCE_R = 100;
  const GRAVITY = -9.8;

  function create(ctx) {
    const { THREE, scene, camera, world, pals, ui, audio, util: U } = ctx;
    const me = ctx.players[0].profile;
    const opp = ctx.opponent;

    world.environment(scene, { sky: 'day', fogNear: 120, fogFar: 380, hillRadius: 200, trees: { ring: 135, count: 50 }, shadow: { center: new THREE.Vector3(0, 0, -6), size: 28 } });

    const fieldGeo = new THREE.CircleGeometry(FENCE_R + 6, 64, Math.PI * 0.25, Math.PI * 0.5);
    fieldGeo.rotateX(-Math.PI / 2);
    const field = new THREE.Mesh(fieldGeo, world.mat(0xffffff, { map: world.texture('grass_stripes', { repeat: [14, 14] }) }));
    field.receiveShadow = true;
    scene.add(field);
    const infield = new THREE.Mesh(new THREE.PlaneGeometry(27.4, 27.4), world.mat(0xffffff, { map: world.texture('dirt', { repeat: [4, 4] }) }));
    infield.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    infield.position.set(0, 0.01, -19.4);
    infield.receiveShadow = true;
    scene.add(infield);
    const grassIn = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), world.mat(0xffffff, { map: world.texture('grass', { repeat: [4, 4] }) }));
    grassIn.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    grassIn.position.set(0, 0.02, -19.4);
    scene.add(grassIn);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.25, 32), world.mat(0xffffff, { map: world.texture('dirt') }));
    mound.position.set(0, 0.12, MOUND_Z);
    scene.add(mound);
    const plateShape = new THREE.Shape([[0, -0.22], [0.22, 0], [0.22, 0.22], [-0.22, 0.22], [-0.22, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(plateShape), world.mat(0xFFFFFF));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.03;
    scene.add(plate);
    const box = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), world.mat(0xffffff, { map: world.texture('dirt', { repeat: [2, 2] }) }));
    box.rotation.x = -Math.PI / 2;
    box.position.y = 0.015;
    scene.add(box);

    const fence = new THREE.Mesh(new THREE.CylinderGeometry(FENCE_R, FENCE_R, 3, 64, 1, true, Math.PI * 0.75, Math.PI * 0.5),
      world.mat(0x2F7D4A, { side: THREE.DoubleSide }));
    fence.position.y = 1.5;
    scene.add(fence);
    const marker = world.label3d('100 m', { color: '#FFFFFF', bg: 'rgba(20,30,50,0.6)', size: 2.2 });
    marker.position.set(0, 4.6, -FENCE_R);
    scene.add(marker);

    const batter = pals.create(me);
    batter.setFacing(-Math.PI / 2);
    batter.root.position.set(0.75, 0, 0.1);
    scene.add(batter.root);
    const pitcher = pals.create(opp.profile);
    pitcher.root.position.set(0, 0.25, MOUND_Z);
    scene.add(pitcher.root);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), world.mat(0xFFFFFF, { kind: 'phong', shininess: 30 }));
    ball.castShadow = true;
    ball.visible = false;
    scene.add(ball);
    const trail = world.trail(ball, { color: 0xFFFFFF, width: 0.07, length: 24, opacity: 0.55 });

    const HOME_CAM = { pos: new THREE.Vector3(-1.2, 2.4, 4.6), look: new THREE.Vector3(0, 0.9, -16) };
    const camLook = HOME_CAM.look.clone();
    camera.position.copy(HOME_CAM.pos);
    camera.lookAt(camLook);

    // HUD ----------------------------------------------------------------------------------------
    const top = ui.el('div', 'ss-hud-top');
    const pitchChip = ui.el('div', 'ss-chip');
    const hrChip = ui.el('div', 'ss-chip dark');
    top.append(pitchChip, hrChip);
    ctx.hud.appendChild(top);

    // State --------------------------------------------------------------------------------------
    let pitches = 0, homers = 0, longest = 0;
    let phase = 'wait';          // 'pitch' | 'hit' | 'wait' | 'done'
    let flight = null;           // { vel, landed }
    let hint = null;
    let swung = false;
    let autoplay = false;
    let ambience = null;

    function refreshHud() {
      pitchChip.textContent = 'Pitch ' + Math.min(PITCHES, pitches + 1) + ' / ' + PITCHES;
      hrChip.textContent = homers + (homers === 1 ? ' homer' : ' homers');
    }

    function throwPitch() {
      phase = 'pitch';
      swung = false;
      refreshHud();
      pitcher.play('hop');
      audio.sfx('pitch_whoosh');
      ball.position.set(0.15, 1.9, MOUND_Z + 1);
      const speed = 22 + opp.skill * 8;
      flight = { vel: new THREE.Vector3(0, 0.6, speed) };
      ball.visible = true;
      trail.clear();
      if (pitches === 0) hint = ui.hint({ gesture: 'swipe-across', text: 'Swipe across to swing!' });
    }

    function onSwipe(s) {
      if (Math.abs(s.dx) < Math.abs(s.dy) * 0.8 || s.nspeed < 0.4) return;
      swing(s.nspeed, U.clamp(-s.dy / Math.max(1, Math.abs(s.dx)), -0.2, 1));
    }

    function swing(nspeed, loft) {
      if (phase !== 'pitch' || swung) return;
      swung = true;
      if (hint) { hint.hide(); hint = null; }
      batter.play('hop');
      audio.sfx('swing_heavy');
      audio.sfx('voice_hup');
      const timing = Math.abs(ball.position.z + 0.4);
      if (timing > 2.2) { batter.setExpression('surprised', 1); return; }
      phase = 'hit';
      const quality = U.clamp(1 - timing / 2.2, 0, 1) * U.clamp(nspeed / 2.6, 0.3, 1);
      audio.sfx('bat_crack', { intensity: quality });
      const exit = 25 + quality * 22;
      const angle = 0.25 + U.clamp(loft, 0, 1) * 0.45;
      const yaw = ctx.rng.range(-0.35, 0.35);
      flight = { vel: new THREE.Vector3(Math.sin(yaw) * Math.cos(angle) * exit, Math.sin(angle) * exit, -Math.cos(yaw) * Math.cos(angle) * exit) };
      ctx.engine.shake(0.05 + quality * 0.08, 0.25);
    }

    async function resolvePitch(kind, dist) {
      phase = 'wait';
      flight = null;
      if (kind === 'homer') {
        homers += 1;
        audio.sfx('crowd_cheer', { intensity: 1 });
        audio.duck(0.5, 1.8);
        ui.banner('HOME RUN!', { kind: 'huge', sub: U.fmt.meters(dist), duration: 1.7 });
        world.fireworks(scene, new THREE.Vector3(0, 30, -FENCE_R - 10), { count: 3 });
        batter.play('cheer');
        pitcher.play('sad');
      } else if (kind === 'hit') {
        audio.sfx('ball_land_grass');
        ui.banner(U.fmt.meters(dist), { kind: 'good', sub: 'Nice hit!', duration: 1.2 });
        batter.play('clap');
      } else {
        audio.sfx('mitt_pop');
        audio.sfx('ump_strike');
        ui.banner('STRIKE!', { kind: 'bad', duration: 1.1 });
        batter.play('shrug');
      }
      longest = Math.max(longest, dist);
      pitches += 1;
      refreshHud();
      await ctx.wait(kind === 'strike' ? 1.2 : 2);
      ball.visible = false;
      if (pitches >= PITCHES) finishGame(); else throwPitch();
    }

    function finishGame() {
      phase = 'done';
      const won = homers >= 2;
      const rec = ctx.save.record(DEF.id, 'longest', Math.round(longest), { label: 'Longest Hit', profileId: me.id, fmt: 'meters' });
      ctx.finish({
        outcome: won ? 'win' : 'done',
        title: won ? 'Slugger!' : 'Nice Swings!',
        headline: String(homers), headlineLabel: homers === 1 ? 'Home Run' : 'Home Runs',
        players: [{ profileId: me.id, name: me.name, profile: me, score: homers + ' HR', place: 1, isCpu: false,
          skillDelta: Math.round(homers * 22 - 14) }],
        stats: [{ label: 'Pitches', value: String(PITCHES) }, { label: 'Longest', value: U.fmt.meters(Math.round(longest)) }],
        records: [{ label: 'Longest Hit', value: U.fmt.meters(Math.round(longest)), isNew: rec.isNew }],
        medals: [],
        celebrate: won,
      });
    }

    ctx.input.on('swipe', onSwipe);
    refreshHud();

    // Lifecycle ----------------------------------------------------------------------------------
    return {
      start() {
        ambience = audio.loop('crowd_ambience', { vol: 0.45 });
        batter.play('idle_ready');
        ctx.wait(0.8).then(throwPitch);
      },
      update(dt) {
        batter.update(dt);
        pitcher.update(dt);
        if (autoplay && phase === 'pitch' && !swung && ball.position.z > -1.4) swing(2.4 + ctx.rng.range(-0.4, 0.6), ctx.rng.range(0.3, 0.8));
        if (flight) {
          flight.vel.y += GRAVITY * dt * (phase === 'pitch' ? 0.12 : 1);
          ball.position.addScaledVector(flight.vel, dt);
          batter.lookAt(ball.position);
          const p = ball.position;
          if (phase === 'pitch' && p.z > 2) resolvePitch('strike', 0);
          else if (phase === 'hit') {
            const d = Math.hypot(p.x, p.z);
            if (d >= FENCE_R && p.y > 3) resolvePitch('homer', Math.round(d + p.y * 1.5));
            else if (p.y <= 0.06) resolvePitch('hit', Math.round(d));
            camLook.lerp(p, 1 - Math.exp(-dt * 3));
          }
        } else camLook.lerp(HOME_CAM.look, 1 - Math.exp(-dt * 2));
        camera.lookAt(camLook);
      },
      dispose() {
        if (ambience) ambience.stop(0.3);
        trail.dispose();
        batter.dispose();
        pitcher.dispose();
      },
      debugState() { return { phase, pitches, homers, longest }; },
      debug: {
        autoplay(on) { autoplay = on !== false; },
      },
    };
  }

  SS.registerSport(DEF);
})();
