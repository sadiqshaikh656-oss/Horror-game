// Map construction: container yard arena built from the supplied props, procedural concrete,
// physically based sky + IBL, sun shadows, wet-ground planar reflections, colliders and nav grid.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { settings } from './settings.js';

export const ARENA = 36;          // half size of the playable square

export class World {
  constructor(renderer, assets) {
    this.renderer = renderer;
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.colliders = [];
    this.dynamic = new THREE.Group();   // props that get rebuilt on quality changes
    this.scene.add(this.dynamic);
    this.pickups = [];
    this.sunDir = new THREE.Vector3();
    this.prefabs = {};
    this.textures = {};
    this.decalSurfaces = [];
    this.buildPrefabs();
    this.buildTextures();
    this.buildSkyAndLights();
    this.buildGround();
    this.buildWalls();
    this.buildLayout();
    this.buildNavGrid();
  }

  // ---------- prefab extraction ----------
  extract(gltfScene, name, scale, centerMode = 'bottom', bodyCenter = null) {
    gltfScene.updateMatrixWorld(true);
    let src = null;
    gltfScene.traverse(o => { if (o.isMesh && o.name === name) src = o; });
    if (!src) { console.warn('missing mesh', name); return null; }
    const geo = dequantize(src.geometry).applyMatrix4(src.matrixWorld);
    geo.scale(scale, scale, scale);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const c = new THREE.Vector3(); bb.getCenter(c);
    if (bodyCenter) { c.x = bodyCenter.x * scale; c.z = bodyCenter.z * scale; }
    geo.translate(-c.x, centerMode === 'bottom' ? -bb.min.y : -c.y, -c.z);
    geo.computeBoundingBox();
    const mat = src.material;
    return { geo, mat, size: geo.boundingBox.getSize(new THREE.Vector3()), box: geo.boundingBox.clone() };
  }

  buildPrefabs() {
    const C = this.assets.containers.scene, D = this.assets.dungeon.scene;
    const P = this.prefabs;
    const contNames = ['Object_4', 'Object_6', 'Object_8', 'Object_10', 'Object_12', 'Object_14', 'Object_16', 'Object_18'];
    P.containers = contNames.map(n => {
      const tmp = this.extract(C, n, 1, 'bottom');
      return tmp;
    });
    // Container bodies are 2.4 x 2.2 x 6m; open-door variants have a larger bbox, so collide on the body only.
    P.containers.forEach(p => {
      p.colSize = new THREE.Vector3(2.4, 2.2, 6.0);
      p.colOffset = new THREE.Vector3(0, 0, 0);
      if (p.size.z > 6.5) { // doors open: body sits between z -1.5..4.5 of the original layout => shift
        p.colOffset.z = (-1.5 + 4.5) / 2 - (-2.65 + 5.69) / 2;
      }
      p.colSize.x = Math.min(p.size.x, 2.45);
    });
    P.barrels = ['Object_20', 'Object_22', 'Object_24', 'Object_26', 'Object_28', 'Object_30'].map(n => this.extract(C, n, 1));
    P.plasticCrates = ['Object_32', 'Object_34'].map(n => this.extract(C, n, 1));
    const s = 0.01;
    P.woodCrate = this.extract(D, 'crate_1_crate_0', s * 0.8);
    P.woodBarrel = this.extract(D, 'barrel_barrel_0', s * 0.75);
    P.chestLower = this.extract(D, 'lower_chest_0', s * 0.6);
    P.table = this.extract(D, 'table_table_0', s * 0.8);
    P.chair = this.extract(D, 'chair_chair_0', s * 0.8);
    P.healthbox = this.extract(D, 'healthbox_healthbox_0', s * 0.9);
    P.ammobox = this.extract(D, 'ammobox_ammobox_0', s * 0.9);
    // Debris used for destructible wooden crates.
    P.cratePieces = ['piece_1_crate_0', 'piece_4_crate_0', 'piece_2_2_crate_0', 'piece_3_crate_0', 'piece_2_crate_0', 'piece_crate_0']
      .map(n => this.extract(D, n, s * 0.8, 'center')).filter(Boolean);
    P.shells = {
      pistol: this.extract(D, 'pistolshell_shells_0', s, 'center'),
      smg: this.extract(D, 'smgshell_shells_0', s, 'center'),
      carbine: this.extract(D, 'snipershell_shells_0', s * 0.75, 'center'),
    };
    for (const k in P.shells) {
      const sh = P.shells[k]; if (!sh) continue;
      sh.mat = sh.mat.clone(); sh.mat.color = new THREE.Color(1.0, 0.82, 0.45); sh.mat.metalness = 1; sh.mat.roughness = 0.3;
    }
  }

  // ---------- procedural textures ----------
  buildTextures() {
    const q = settings.graphics.textures;
    const size = [512, 1024, 1024, 2048][q];
    // clean concrete: low-contrast grain, no stains / cracks / puddles
    this.textures.ground = makeConcrete(size, 0x8f8c86, 0.22, false, false, true, true);
    this.textures.wall = makeConcrete(size / 2, 0x7d7a74, 0.45, false, true);
    this.textures.barrier = makeConcrete(size / 4, 0xb8b2a4, 0.35, false, false, true);
  }

  setTextureQuality() {
    const aniso = [1, 4, 8, 16][settings.graphics.textures];
    const max = this.renderer.capabilities.getMaxAnisotropy();
    this.scene.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (m[k] && m[k].anisotropy !== Math.min(aniso, max)) { m[k].anisotropy = Math.min(aniso, max); m[k].needsUpdate = true; }
      }
    });
  }

  // ---------- sky, sun, IBL ----------
  buildSkyAndLights() {
    const sky = new Sky();
    sky.scale.setScalar(1000);
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = 2.8; u.rayleigh.value = 0.9; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.88;
    const elevation = 19, azimuth = 322;
    const phi = THREE.MathUtils.degToRad(90 - elevation), theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;
    this.scene.add(sky);

    // Image based lighting from the sky.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.sunPosition.value, this.sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = u[k].value;
    envScene.add(sky2);
    // dark ground hemisphere for the env so reflections are not sky-only below the horizon
    const groundHemi = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3a3430, side: THREE.BackSide }));
    envScene.add(groundHemi);
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;

    this.fogColor = new THREE.Color(0xa9a59c);
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.012);

    const sun = new THREE.DirectionalLight(0xffd9b0, 3.4);
    sun.position.copy(this.sunDir).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(0x9fb8d8, 0x5a4a3a, 0.7);
    this.scene.add(hemi);
    this.hemi = hemi;

  }

  buildGround() {
    const t = this.textures.ground;
    const mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.55, 0.55) });
    const rep = 260 / 8;
    for (const tx of [t.map, t.normal, t.rough]) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(rep, rep); }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.surface = 'concrete';
    this.scene.add(ground);
    this.ground = ground;

  }

  buildReflections() {
    // planar puddle reflections were removed together with the puddles (clean ground, faster)
    if (this.reflector) { this.scene.remove(this.reflector); this.reflector.dispose(); this.reflector = null; }
  }

  buildWalls() {
    const t = this.textures.wall;
    for (const tx of [t.map, t.normal, t.rough]) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1 });
    const H = 5, T = 1.2, L = ARENA * 2 + T * 2;
    const add = (x, z, w, d, h = H, m = mat, y = 0) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      worldUV(geo, w, h, d, 4);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.surface = 'concrete';
      this.scene.add(mesh);
      this.addCollider(mesh.position.x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, 'concrete', mesh);
      return mesh;
    };
    add(0, -ARENA - T / 2, L, T); add(0, ARENA + T / 2, L, T);
    add(-ARENA - T / 2, 0, T, L); add(ARENA + T / 2, 0, T, L);
    // Concrete jersey-style barriers (low cover)
    const bt = this.textures.barrier;
    const bmat = new THREE.MeshStandardMaterial({ map: bt.map, normalMap: bt.normal, roughnessMap: bt.rough, roughness: 1 });
    for (const tx of [bt.map, bt.normal, bt.rough]) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    const barriers = [[-6, 12, 3, 0.7], [6, -12, 3, 0.7], [-28, 0, 0.7, 4], [28, 0, 0.7, 4], [0, 8, 0.7, 3], [0, -8, 0.7, 3],
      [-15, -25, 3, 0.7], [15, 25, 3, 0.7], [-30, 22, 3, 0.7], [30, -22, 3, 0.7]];
    for (const [x, z, w, d] of barriers) add(x, z, w, d, 1.05, bmat);
    // Overhead catwalk/platform pieces for verticality (raised slabs on pillars)
    const slab = (x, z, w, d, y) => {
      add(x, z, w, d, 0.35, mat, y);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(x + sx * (w / 2 - 0.3), z + sz * (d / 2 - 0.3), 0.4, 0.4, y, mat);
    };
    slab(-31, -31, 6, 6, 2.6); slab(31, 31, 6, 6, 2.6);
    // ramps (stairs) to the slabs
    const stairs = (x, z, dir) => { for (let i = 0; i < 6; i++) add(x, z + dir * i * 0.6, 2, 0.6, 0.44 * (i + 1), mat); };
    stairs(-26.5, -31 + 2.2, 1); // up to NW slab
    stairs(26.5, 31 - 2.2, -1);
    this.wallMat = mat;
  }

  addCollider(x0, y0, z0, x1, y1, z1, surface, mesh) {
    const c = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), surface, mesh };
    this.colliders.push(c);
    return c;
  }

  placePrefab(p, x, y, z, rotY, opts = {}) {
    const mesh = new THREE.Mesh(p.geo, p.mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    mesh.userData.surface = opts.surface || 'metal';
    mesh.userData.propClass = opts.propClass || 'main';
    (opts.parent || this.scene).add(mesh);
    if (opts.collide !== false) {
      const sz = p.colSize || p.size;
      const off = p.colOffset || new THREE.Vector3();
      const rot = Math.abs(Math.sin(rotY)) > 0.5;
      const sx = rot ? sz.z : sz.x, sz2 = rot ? sz.x : sz.z;
      const o = off.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const cx = x + o.x, cz = z + o.z;
      const sy = opts.colHeight || sz.y;
      mesh.userData.collider = this.addCollider(cx - sx / 2, y, cz - sz2 / 2, cx + sx / 2, y + sy, cz + sz2 / 2, opts.surface || 'metal', mesh);
    }
    return mesh;
  }

  buildLayout() {
    const P = this.prefabs;
    const C = P.containers;
    const H = 2.2;
    // [x, z, rotated(1=long along x), stackLevel, prefab]
    const L = [
      [0, 0, 1, 0, 0], [0, 0, 1, 1, 5],
      [-5.5, -5, 0, 0, 2], [5.5, 5, 0, 0, 3],
      [-12, -7, 1, 0, 6], [12, 7, 1, 0, 1],
      [14, -5, 0, 0, 4], [-14, 5, 0, 0, 7],
      [-22, -12, 0, 0, 0], [-24.5, -12, 0, 0, 6], [-24.5, -12, 0, 1, 3],
      [22, 12, 0, 0, 1], [24.5, 12, 0, 0, 7], [24.5, 12, 0, 1, 2],
      [-20, 10, 0, 0, 5], [20, -10, 0, 0, 4],
      [-27, 16, 1, 0, 2], [27, -16, 1, 0, 3], [27, -16, 1, 1, 0],
      [-8, -22, 1, 0, 1], [8, -24, 1, 0, 6], [0, -30, 1, 0, 7], [-31, -26, 0, 0, 3], [31, -27, 0, 0, 5],
      [8, 22, 1, 0, 0], [-8, 24, 1, 0, 2], [13, 30, 0, 0, 4], [-31, 27, 0, 0, 1],
      [-14, 31, 1, 0, 6], [14, -31, 1, 0, 2],
    ];
    for (const [x, z, r, lvl, pi] of L) {
      this.placePrefab(C[pi], x, lvl * H, z, r ? Math.PI / 2 : 0, { surface: 'metal' });
    }
    this.buildProps();
    this.buildPickups();
  }

  // Quality-dependent props. Rebuilt when Prop Quality / Prop Structure change.
  buildProps() {
    // remove old dynamic props + their colliders
    for (const m of [...this.dynamic.children]) {
      if (m.userData.collider) this.colliders.splice(this.colliders.indexOf(m.userData.collider), 1);
      this.dynamic.remove(m);
    }
    this.lamps = [];
    // Clear ground: no crates, barrels, furniture, lamp posts or skyline props any more.
    // Containers, walls, concrete barriers, platforms and pickups (built elsewhere) remain.
    if (!this.withProps) return;
    const P = this.prefabs, d = settings.graphics.propDensity, detail = settings.graphics.propDetail;
    const rnd = mulberry(1337);
    const add = (p, x, z, rot, o = {}) => this.placePrefab(p, x, o.y || 0, z, rot, { parent: this.dynamic, cast: detail >= 1, ...o });
    // Essential cover crates (always)
    const wood = P.woodCrate, ws = wood.size.y;
    const crateSpots = [[-3, 9], [3, -9], [-18, -2], [18, 2], [-10, 16], [10, -16], [-30, -10], [30, 10], [0, 18.5], [0, -18.5]];
    for (const [x, z] of crateSpots) {
      const m = add(wood, x, z, rnd() * 0.4 - 0.2, { surface: 'wood' });
      m.userData.destructible = detail >= 3; m.userData.hp = 120;
      if (rnd() > 0.5) add(wood, x + 0.1, z - 0.05, rnd(), { y: ws, surface: 'wood' }).userData.destructible = detail >= 3;
    }
    for (const [x, z] of [[-24, 4], [24, -4], [5, 14], [-5, -14]]) {
      add(P.plasticCrates[0], x, z, 0, { surface: 'plastic' });
      add(P.plasticCrates[1], x + 1.05, z, 0, { surface: 'plastic' });
      add(P.plasticCrates[0], x + 0.5, z, 0.3, { y: 1, surface: 'plastic' });
    }
    if (d >= 1) { // oil barrels
      const spots = [[-17, -11], [17, 11], [-2.5, -4.5], [2.5, 4.5], [-28, 8], [28, -8], [11, 26], [-11, -26], [-33, -18], [33, 18]];
      for (const [x, z] of spots) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) add(P.barrels[Math.floor(rnd() * 6)], x + (i % 2) * 0.9, z + Math.floor(i / 2) * 0.9, rnd() * 6, { surface: 'metal' });
      }
    }
    if (d >= 2) { // furniture-ish props
      add(P.woodBarrel, -33, 33, 0, { surface: 'wood' }); add(P.woodBarrel, 33, -33, 1, { surface: 'wood' });
      add(P.table, -18, 26, 0.4, { surface: 'wood' }); add(P.chair, -16.8, 25, 2.2, { surface: 'wood', collide: false });
      add(P.table, 18, -26, 2.9, { surface: 'wood' }); add(P.chestLower, 33, 2, Math.PI / 2, { surface: 'wood' });
      add(P.chestLower, -33, -2, -Math.PI / 2, { surface: 'wood' });
      for (const [x, z] of [[-6, -27], [6, 27], [-25, -20], [25, 20]]) add(wood, x, z, rnd(), { surface: 'wood' });
    }
    if (d >= 3) { // lamp posts with lights + far background silhouettes
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x40444a, metalness: 0.8, roughness: 0.4 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc890, emissiveIntensity: 4 });
      for (const [x, z] of [[-34, -34], [34, 34], [-34, 34], [34, -34], [0, 34.5], [0, -34.5]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 10), poleMat);
        pole.position.set(x, 4, z); pole.castShadow = detail >= 2; this.dynamic.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 0.4), headMat);
        head.position.set(x * 0.97, 8, z * 0.97); this.dynamic.add(head);
        const light = new THREE.PointLight(0xffc890, 6, 18, 2);
        light.position.set(x * 0.95, 7.6, z * 0.95); this.dynamic.add(light);
        this.lamps.push(light);
      }
      const cr = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8, metalness: 0.4 });
      const crane = (x, z, r) => {
        const g = new THREE.Group();
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 34, 2), cr); tower.position.y = 17; g.add(tower);
        const jib = new THREE.Mesh(new THREE.BoxGeometry(40, 1.6, 1.6), cr); jib.position.set(10, 34, 0); g.add(jib);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), cr); cab.position.set(0, 32, 0); g.add(cab);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 14), poleMat); cable.position.set(22, 27, 0); g.add(cable);
        g.position.set(x, 0, z); g.rotation.y = r; g.traverse(o => { if (o.isMesh) o.castShadow = false; });
        this.dynamic.add(g);
      };
      crane(-60, -50, 0.6); crane(65, 30, 2.4); crane(-20, 75, 4.0);
      const bmat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 0.95 });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rnd() * 0.2, r = 70 + rnd() * 30;
        const w = 10 + rnd() * 16, h = 8 + rnd() * 22;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10 + rnd() * 10), bmat);
        b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); b.rotation.y = a; this.dynamic.add(b);
      }
    }
  }

  buildPickups() {
    const P = this.prefabs;
    const spots = [['health', -30, 0], ['health', 30, 0], ['ammo', 0, 13.5], ['ammo', 0, -13.5], ['ammo', -33, 30], ['ammo', 33, -30], ['health', 0, 26]];
    for (const [type, x, z] of spots) {
      const p = type === 'health' ? P.healthbox : P.ammobox;
      const m = new THREE.Mesh(p.geo, p.mat);
      m.position.set(x, 0.0, z); m.castShadow = true; m.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.85, 40), new THREE.MeshBasicMaterial({ color: type === 'health' ? 0x5cff8a : 0xffc640, transparent: true, opacity: 0.6, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.03, z);
      this.scene.add(m); this.scene.add(ring);
      this.pickups.push({ type, mesh: m, ring, pos: new THREE.Vector3(x, 0, z), active: true, timer: 0 });
    }
  }

  updatePickups(dt, time) {
    for (const p of this.pickups) {
      if (!p.active) { p.timer -= dt; if (p.timer <= 0) { p.active = true; p.mesh.visible = p.ring.visible = true; } continue; }
      p.mesh.position.y = 0.05 + Math.sin(time * 2 + p.pos.x) * 0.05;
      p.mesh.rotation.y += dt * 0.6;
      p.ring.material.opacity = 0.35 + Math.sin(time * 4) * 0.25;
    }
  }

  // ---------- per-frame & quality ----------
  applyQuality(camera) {
    const g = settings.graphics;
    const r = this.renderer;
    r.shadowMap.enabled = g.shadows > 0;
    r.shadowMap.type = g.shadows >= 3 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const sz = [512, 1024, 2048, 2048, 4096][g.shadows];
    this.shadowExtent = [20, 24, 32, 40, 46][g.shadows];
    const s = this.sun.shadow;
    if (s.mapSize.x !== sz) { s.mapSize.set(sz, sz); if (s.map) { s.map.dispose(); s.map = null; } }
    s.radius = g.shadows >= 4 ? 3 : 2;
    const cam = s.camera;
    cam.left = cam.bottom = -this.shadowExtent; cam.right = cam.top = this.shadowExtent;
    cam.near = 1; cam.far = 140; cam.updateProjectionMatrix();
    this.sun.castShadow = g.shadows > 0;
    const far = [70, 110, 170, 260][g.viewDistance];
    this.scene.fog.density = [0.022, 0.012, 0.0075, 0.0055][g.viewDistance];
    camera.far = far; camera.updateProjectionMatrix();
    // IBL always lights the scene; the Reflections setting controls its specular strength + planar puddles
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = g.reflections >= 1 ? 0.6 : 0.45;
    this.hemi.intensity = g.reflections >= 1 ? 0.6 : 0.8;
    this.buildProps();
    this.buildReflections();
    // Shadow casting of props depends on Prop Structure.
    const detail = g.propDetail;
    this.scene.traverse(o => { if (o.isMesh && o.userData.propClass === 'main') o.castShadow = detail >= 1 || o.geometry.boundingBox?.max.y > 2; });
    this.setTextureQuality();
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse(o => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
  }

  update(dt, time, focus) {
    // keep the shadow frustum centered on the player, snapped to texels to avoid shimmering
    const e = this.shadowExtent || 30;
    const texel = (e * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 70);
    if (this.reflector) this.reflector.material.uniforms.uTime.value = time;
    this.updatePickups(dt, time);
  }

  // ---------- queries ----------
  raycast(origin, dir, maxDist, ignoreLowerThan = -1) {
    let best = null, bestT = maxDist;
    const inv = new THREE.Vector3(1 / dir.x, 1 / dir.y, 1 / dir.z);
    for (const c of this.colliders) {
      if (c.max.y <= ignoreLowerThan) continue;
      const t = rayBox(origin, inv, c.min, c.max, bestT);
      if (t !== null && t < bestT) { bestT = t; best = c; }
    }
    // ground plane
    if (dir.y < 0) { const t = -origin.y / dir.y; if (t > 0 && t < bestT) { bestT = t; best = { ground: true, surface: 'concrete' }; } }
    if (!best) return null;
    const point = origin.clone().addScaledVector(dir, bestT);
    let normal;
    if (best.ground) normal = new THREE.Vector3(0, 1, 0);
    else normal = boxNormal(point, best.min, best.max);
    return { dist: bestT, point, normal, collider: best, surface: best.surface };
  }

  lineOfSight(a, b) {
    const d = b.clone().sub(a); const len = d.length(); d.divideScalar(len);
    const hit = this.raycast(a, d, len - 0.05);
    return !hit;
  }

  // ---------- AI navigation grid ----------
  buildNavGrid() {
    const N = ARENA * 2; this.navN = N;
    this.nav = new Uint8Array(N * N);
    this.markNav();
  }
  markNav() {
    const N = this.navN; this.nav.fill(0);
    const pad = 0.5;
    for (const c of this.colliders) {
      if (c.min.y > 1.2 || c.max.y < 0.4) continue;
      const x0 = Math.floor(c.min.x - pad + ARENA), x1 = Math.floor(c.max.x + pad + ARENA);
      const z0 = Math.floor(c.min.z - pad + ARENA), z1 = Math.floor(c.max.z + pad + ARENA);
      for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++)
        for (let z = Math.max(0, z0); z <= Math.min(N - 1, z1); z++) this.nav[z * N + x] = 1;
    }
  }
  cellOf(p) { return [Math.max(0, Math.min(this.navN - 1, Math.floor(p.x + ARENA))), Math.max(0, Math.min(this.navN - 1, Math.floor(p.z + ARENA)))]; }
  walkable(x, z) { return x >= 0 && z >= 0 && x < this.navN && z < this.navN && !this.nav[z * this.navN + x]; }
  randomWalkable(rng = Math.random, region = null) {
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(rng() * this.navN), z = Math.floor(rng() * this.navN);
      if (!this.walkable(x, z)) continue;
      const p = new THREE.Vector3(x - ARENA + 0.5, 0, z - ARENA + 0.5);
      if (region && !region(p)) continue;
      return p;
    }
    return new THREE.Vector3();
  }
  findPath(from, to) {
    const N = this.navN;
    let [sx, sz] = this.cellOf(from); let [tx, tz] = this.cellOf(to);
    if (!this.walkable(tx, tz)) { const n = this.nearestWalkable(tx, tz); if (!n) return null; [tx, tz] = n; }
    if (!this.walkable(sx, sz)) { const n = this.nearestWalkable(sx, sz); if (n) [sx, sz] = n; }
    const start = sz * N + sx, goal = tz * N + tx;
    const g = new Float32Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
    const open = new MinHeap();
    g[start] = 0; open.push(start, 0);
    let iter = 0;
    while (open.size && iter++ < 6000) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue; closed[cur] = 1;
      const cx = cur % N, cz = (cur / N) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.walkable(nx, nz)) continue;
        if (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz))) continue;
        const ni = nz * N + nx, ng = g[cur] + (dx && dz ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; const h = Math.hypot(nx - tx, nz - tz); open.push(ni, ng + h); }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const path = []; let c = goal;
    while (c !== -1 && c !== start) { path.push(new THREE.Vector3(c % N - ARENA + 0.5, 0, ((c / N) | 0) - ARENA + 0.5)); c = came[c]; }
    path.reverse();
    // string-pull: drop waypoints that are directly reachable
    const out = []; let anchor = from.clone(); let i = 0;
    while (i < path.length) {
      let j = path.length - 1;
      while (j > i && !this.gridLine(anchor, path[j])) j--;
      out.push(path[j]); anchor = path[j]; i = j + 1;
    }
    return out;
  }
  gridLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z); const steps = Math.ceil(d * 2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; const [x, z] = this.cellOf({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      if (!this.walkable(x, z)) return false;
    }
    return true;
  }
  nearestWalkable(x, z) {
    for (let r = 1; r < 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (this.walkable(x + dx, z + dz)) return [x + dx, z + dz];
    return null;
  }
}

// ---------- helpers ----------
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) { this.k.push(k); this.v.push(v); let i = this.k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.v[p] <= this.v[i]) break; this.swap(i, p); i = p; } }
  pop() { const top = this.k[0]; const lk = this.k.pop(), lv = this.v.pop(); if (this.k.length) { this.k[0] = lk; this.v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.k.length && this.v[l] < this.v[m]) m = l; if (r < this.k.length && this.v[r] < this.v[m]) m = r; if (m === i) break; this.swap(i, m); i = m; } } return top; }
  swap(a, b) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.v[a], this.v[b]] = [this.v[b], this.v[a]]; }
}

export function rayBox(o, inv, mn, mx, maxT) {
  let t1 = (mn.x - o.x) * inv.x, t2 = (mx.x - o.x) * inv.x;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (mn.y - o.y) * inv.y; t2 = (mx.y - o.y) * inv.y;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (mn.z - o.z) * inv.z; t2 = (mx.z - o.z) * inv.z;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0) || tmin > maxT) return null;
  return tmin >= 0 ? tmin : null;
}

function boxNormal(p, mn, mx) {
  const d = [p.x - mn.x, mx.x - p.x, p.y - mn.y, mx.y - p.y, p.z - mn.z, mx.z - p.z];
  let i = 0; for (let k = 1; k < 6; k++) if (d[k] < d[i]) i = k;
  return [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1)][i];
}

export function dequantize(geo) {
  const g = new THREE.BufferGeometry();
  for (const name in geo.attributes) {
    const a = geo.attributes[name];
    if (name === 'position' || name === 'normal' || name === 'tangent' || (a.normalized && !(a.array instanceof Float32Array))) {
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    } else g.setAttribute(name, a);
  }
  if (geo.index) g.setIndex(geo.index);
  for (const gr of geo.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  if (g.attributes.normal) g.attributes.normal.normalized = false;
  return g;
}

function worldUV(geo, w, h, d, texM) {
  // Re-map BoxGeometry UVs so textures keep a constant world scale.
  const uv = geo.attributes.uv, n = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su / texM, uv.getY(i) * sv / texM);
  }
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function valueNoise(size, scale, seed) {
  const rnd = mulberry(seed); const g = scale + 1; const grid = new Float32Array(g * g).map(() => rnd());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * scale, fy = y / size * scale; const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const i0 = iy * g + ix, ixw = (ix + 1) % scale, iyw = (iy + 1) % scale;
    const a = grid[iy * g + ix], b = grid[iy * g + ixw], c = grid[iyw * g + ix], d = grid[iyw * g + ixw];
    out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}

function makeConcrete(size, base, contrast, cracks = false, panels = false, smooth = false, clean = false) {
  const n1 = valueNoise(size, 8, 11), n2 = valueNoise(size, 32, 7), n3 = valueNoise(size, 128, 3);
  const h = new Float32Array(size * size);
  const rnd = mulberry(99 + size);
  for (let i = 0; i < h.length; i++) h[i] = n1[i] * 0.5 + n2[i] * 0.3 + n3[i] * 0.2 + (rnd() - 0.5) * (smooth ? 0.04 : 0.12);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
  for (let i = 0; i < h.length; i++) {
    const v = 1 + (h[i] - 0.5) * contrast * 1.6;
    img.data[i * 4] = br * v; img.data[i * 4 + 1] = bg * v; img.data[i * 4 + 2] = bb * v * 0.98; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // stains
  for (let i = 0; i < (clean ? 0 : 18); i++) {
    const x = rnd() * size, y = rnd() * size, r = size * (0.03 + rnd() * 0.12);
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(30,25,20,${0.12 + rnd() * 0.2})`); gr.addColorStop(1, 'rgba(30,25,20,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // expansion joints / panel seams
  ctx.strokeStyle = 'rgba(20,18,16,0.55)'; ctx.lineWidth = Math.max(1, size / 400);
  if (cracks || panels) { ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(size, 1); ctx.moveTo(1, 0); ctx.lineTo(1, size); if (panels) { ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); } ctx.stroke(); }
  if (cracks) {
    ctx.strokeStyle = 'rgba(15,12,10,0.6)'; ctx.lineWidth = Math.max(1, size / 700);
    for (let i = 0; i < 6; i++) { let x = rnd() * size, y = rnd() * size; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 14; k++) { x += (rnd() - 0.5) * size * 0.06; y += (rnd() - 0.3) * size * 0.05; ctx.lineTo(x, y); } ctx.stroke(); }
  }
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
  // normal map from the height field (+ the painted cracks via luminance)
  const lum = ctx.getImageData(0, 0, size, size).data;
  const nc = document.createElement('canvas'); nc.width = nc.height = size;
  const nctx = nc.getContext('2d'); const nimg = nctx.createImageData(size, size);
  const rc = document.createElement('canvas'); rc.width = rc.height = size;
  const rctx = rc.getContext('2d'); const rimg = rctx.createImageData(size, size);
  const H = (x, y) => { x = (x + size) % size; y = (y + size) % size; const i = y * size + x; return h[i] * 0.6 + lum[i * 4] / 255 * 0.4; };
  const k = smooth ? 2 : 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * k, dy = (H(x, y - 1) - H(x, y + 1)) * k;
    const l = Math.hypot(dx, dy, 1); const i = (y * size + x) * 4;
    nimg.data[i] = (dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
    const r = 0.72 + (h[y * size + x] - 0.5) * 0.4; rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r * 255; rimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0); rctx.putImageData(rimg, 0, 0);
  const normal = new THREE.CanvasTexture(nc), rough = new THREE.CanvasTexture(rc);
  return { map, normal, rough };
}


