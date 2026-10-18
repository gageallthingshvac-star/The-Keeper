// The dry dock: a 3D scene that is the backdrop for every menu and the editor in the shipyard.
const Yard = (() => {
  const {S, DECK} = Sim;
  const V3 = THREE.Vector3;

  class Yard {
    constructor(renderer, quality) {
      this.renderer = renderer;
      this.env = new Gfx.Env(renderer, {quality, oceanSize: 3600, shadowSize: 170});
      this.env.setWeather(Data.WEATHER.dawn);
      this.viz = new Viz(this.env, {quality});
      this.camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
      this.yaw = 0.75; this.pitch = 0.62; this.dist = 300; this.userZoom = false;
      this.mode = 'menu';        // menu: slow orbit backdrop | edit: interactive shipyard
      this.view = {x: 0, y: 0, w: 1, h: 1};
      this.t = 0;
      this.dockGroup = new THREE.Group(); this.env.scene.add(this.dockGroup);
      this.ghosts = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(S * 0.96, 1.2, S * 0.96), new THREE.MeshBasicMaterial({color: '#e0b45a', transparent: true, opacity: 0.5, depthWrite: false})); m.visible = false; this.env.scene.add(m); return m; });
      this.looseGroup = new THREE.Group(); this.env.scene.add(this.looseGroup);
      this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new V3(0, 1, 0), -DECK);
      this.design = null; this.ship = null;
    }

    // Walls and deck grid for the current dock size.
    buildDock(w, h) {
      if (this.dockW === w && this.dockH === h) return;
      this.dockW = w; this.dockH = h;
      const g = this.dockGroup;
      while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); }
      const wallM = new THREE.MeshStandardMaterial({color: '#4b5560', roughness: 0.9, metalness: 0.05});
      const L = h * S + 50, W = w * S + 50;
      for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(8, 16, L), wallM); m.position.set(sx * (W / 2 + 4), 1, 0); m.receiveShadow = true; m.castShadow = true; g.add(m); }
      const back = new THREE.Mesh(new THREE.BoxGeometry(W + 16, 16, 8), wallM); back.position.set(0, 1, L / 2 + 4); back.castShadow = back.receiveShadow = true; g.add(back);
      // bollards along the walls
      const bm = new THREE.MeshStandardMaterial({color: '#e0b45a', roughness: 0.5});
      for (let z = -L / 2 + 20; z < L / 2; z += 40) for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 2.5, 8), bm); b.position.set(sx * (W / 2 + 4), 10.2, z); g.add(b); }
      const pts = [];
      for (let c = 0; c <= w; c++) { const x = (c - w / 2) * S; pts.push(x, DECK + 0.06, -h * S / 2, x, DECK + 0.06, h * S / 2); }
      for (let r = 0; r <= h; r++) { const z = (r - h / 2) * S; pts.push(-w * S / 2, DECK + 0.06, z, w * S / 2, DECK + 0.06, z); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({color: '#cfe2ee', transparent: true, opacity: 0.22}));
      g.add(this.grid);
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute([0, DECK + 0.1, -h * S / 2, 0, DECK + 0.1, h * S / 2], 3));
      this.center = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({color: '#e0b45a', transparent: true, opacity: 0.7}));
      g.add(this.center);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(4, 9, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: '#e0b45a'}));
      arrow.position.set(0, DECK + 0.5, -h * S / 2 - 10); g.add(arrow);
      this.dockFit = Math.max(w * S * 2.1, h * S * 1.15) + 60;
    }
    showGrid(on, mirror) { if (this.grid) this.grid.visible = on; if (this.center) this.center.visible = on && mirror; }

    cellX(c) { return (c - (this.design.w - 1) / 2) * S; }
    cellZ(r) { return (r - (this.design.h - 1) / 2) * S; }

    setDesign(d, conn) {
      this.design = d;
      this.buildDock(d.w, d.h);
      this.viz.clear();
      this.ship = null;
      while (this.looseGroup.children.length) this.looseGroup.remove(this.looseGroup.children[0]);
      // Frame the ship itself (not the whole dock), so small designs in a big dock stay readable.
      const bnd = Design.bounds(d);
      const bw = bnd ? Math.max(5, bnd.c1 - bnd.c0 + 3) : d.w, bh = bnd ? Math.max(9, bnd.r1 - bnd.r0 + 3) : d.h;
      if (!this.userZoom) this.dist = Math.min(this.dockFit, Math.max(bw * S * 2.1, bh * S * 1.15) + 60);
      if (!d.cells.some(Boolean)) return;
      const w = new Sim.World({rng: Util.rng(1)});
      const s = w.addShip(d, {team: 0, x: 0, y: 0, a: 0});
      // Sim ships are centred on their centroid; shift so blocks line up with the grid.
      s.x = this.cellX(s.cx); s.y = this.cellZ(s.cy);
      this.ship = s;
      this.viz.addShip(s);
      if (conn) {
        const edge = new THREE.EdgesGeometry(new THREE.BoxGeometry(S * 0.98, 8.4, S * 0.98).translate(0, DECK - 4, 0));
        const mat = new THREE.LineBasicMaterial({color: '#ff5a4a'});
        d.cells.forEach((t, i) => { if (t && !conn.has(i)) { const e = new THREE.LineSegments(edge, mat); e.position.set(this.cellX(i % d.w), 0.2, this.cellZ((i / d.w) | 0)); this.looseGroup.add(e); } });
      }
    }

    // Region of the screen (CSS px) the ship should be centred in.
    setView(x, y, w, h) { this.view = {x, y, w: Math.max(1, w), h: Math.max(1, h)}; }

    pick(clientX, clientY) {
      if (!this.design) return -1;
      const W = window.innerWidth, H = window.innerHeight;
      const ndc = new THREE.Vector2((clientX / W) * 2 - 1, -(clientY / H) * 2 + 1);
      this.ray.setFromCamera(ndc, this.camera);
      const hit = new V3();
      if (!this.ray.ray.intersectPlane(this.plane, hit)) return -1;
      const c = Math.round(hit.x / S + (this.design.w - 1) / 2), r = Math.round(hit.z / S + (this.design.h - 1) / 2);
      if (c < 0 || r < 0 || c >= this.design.w || r >= this.design.h) return -1;
      return c + r * this.design.w;
    }
    showGhost(i, mirror, erase, part) {
      const d = this.design;
      for (const g of this.ghosts) { g.visible = false; g.material.color.set(erase ? '#ff5a4a' : '#e0b45a'); }
      if (!d || i < 0) return;
      const c = i % d.w, r = (i / d.w) | 0;
      const place = (g, cc) => { g.visible = true; g.position.set(this.cellX(cc), DECK + 0.7 + (d.cells[cc + r * d.w] ? 1.2 : 0), this.cellZ(r)); };
      place(this.ghosts[0], c);
      const mc = d.w - 1 - c;
      if (mirror && mc !== c && part !== 'bridge') place(this.ghosts[1], mc);
    }

    resize(W, H) {
      this.renderer.setSize(W, H, false);
      this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
      this.viz.setScale((H * this.renderer.getPixelRatio() / 2) / Math.tan(this.camera.fov * Math.PI / 360));
    }

    update(dt) {
      this.t += dt;
      const W = window.innerWidth, H = window.innerHeight, v = this.view;
      if (this.mode === 'menu') this.yaw += dt * 0.06;
      // Fit the ship into the free region, then shift the projection so it is centred there.
      const fill = Math.min(v.w / W, v.h / H * (W / H > 1 ? 1 : 1));
      const dist = this.dist / Math.max(0.35, Math.min(1, fill * 1.15)) * (W < H ? 1.25 : 1);
      const c = this.camera, p = this.pitch;
      c.position.set(Math.sin(this.yaw) * Math.cos(p) * dist, Math.sin(p) * dist + 6, Math.cos(this.yaw) * Math.cos(p) * dist);
      c.lookAt(0, DECK, 0);
      c.setViewOffset(W, H, W / 2 - (v.x + v.w / 2), H / 2 - (v.y + v.h / 2), W, H);
      this.env.update(dt, this.t, c);
      this.env.focusShadow(0, 0);
      if (this.ship) this.ship.a = 0;
      this.viz.update(null, dt, this.t, {effects: false, projectiles: false});
    }
    render() { this.renderer.render(this.env.scene, this.camera); }
  }
  return Yard;
})();
