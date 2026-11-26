// First-person viewmodels. Each supplied GLB ships one baked timeline ("allanims"); we split it into
// clips (draw / fire / reload / inspect ...) by time range and layer procedural motion on top:
// walk + sprint cycles, aim-down-sights, recoil springs, look sway, landing dip, strafe roll, breathing.
import * as THREE from 'three';
import * as Audio from './audio.js';

export const WEAPONS = {
  carbine: {
    id: 'carbine', name: 'M4 CARBINE', type: 'ASSAULT RIFLE', model: 'carbine', unit: 1,
    auto: true, rpm: 720, damage: 32, headMul: 3.0, legMul: 0.75, mag: 30, reserve: 150, pellets: 1,
    spreadHip: 0.032, spreadAds: 0.0012, spreadMove: 0.03, bloomPerShot: 0.006, maxBloom: 0.04,
    recoil: { up: 0.016, side: 0.006, kick: 0.035, rotKick: 0.06, recover: 0.65 },
    zoom: 1.7, adsTime: 0.22, moveMul: 0.95, tracer: 0xffd08a,
    sight: [0.0, 0.462, 0.03], muzzleMesh: 'base_carbine_0', muzzle: [0.0, 0.3, 1.39],
    hip: [0.1, -0.088, -0.27], ads: [0, 0, -0.22], adsVmFov: 32,
    clips: { fire: [0, 0.2], reload: [0.3, 2.27], reloadEmpty: [2.3, 4.47], holster: [4.5, 4.75], draw: [4.75, 5.93], idle: [5.93, 6.8], inspect: [6.83, 7.4] },
    reloadAt: { reload: 0.75, reloadEmpty: 0.8 }, shell: 'carbine',
    sounds: { reload: [[0.35, 'mag'], [1.2, 'mag']], reloadEmpty: [[0.35, 'mag'], [1.15, 'mag'], [1.7, 'slide']], draw: [[0.1, 'draw']] },
  },
  smg: {
    id: 'smg', name: 'MP5', type: 'SUBMACHINE GUN', model: 'smg', unit: 0.01,
    auto: true, rpm: 900, damage: 23, headMul: 2.6, legMul: 0.8, mag: 32, reserve: 192, pellets: 1,
    spreadHip: 0.026, spreadAds: 0.004, spreadMove: 0.018, bloomPerShot: 0.004, maxBloom: 0.03,
    recoil: { up: 0.011, side: 0.007, kick: 0.028, rotKick: 0.05, recover: 0.7 },
    zoom: 1.3, adsTime: 0.16, moveMul: 1.05, tracer: 0xffc070,
    sight: [0.15, 20.6, 4], muzzleMesh: 'base_smg45_0', muzzle: [0.2, 15.0, 49.5],
    hip: [0.07, -0.07, -0.25], ads: [0, 0, -0.2], adsVmFov: 40,
    clips: { fire: [0, 0.27], reload: [0.27, 2.67], reloadEmpty: [2.7, 4.3], holster: [4.33, 4.7], draw: [4.7, 5.85], idle: [5.87, 7.17], inspect: [7.17, 7.8] },
    reloadAt: { reload: 0.75, reloadEmpty: 0.8 }, shell: 'smg',
    sounds: { reload: [[0.3, 'mag'], [1.3, 'mag']], reloadEmpty: [[0.3, 'mag'], [1.0, 'mag'], [1.35, 'slide']], draw: [[0.1, 'draw']] },
  },
  pistol: {
    id: 'pistol', name: 'P92 PISTOL', type: 'SIDEARM', model: 'pistol', unit: 0.01,
    auto: false, rpm: 420, damage: 36, headMul: 3.2, legMul: 0.8, mag: 15, reserve: 90, pellets: 1,
    spreadHip: 0.02, spreadAds: 0.002, spreadMove: 0.015, bloomPerShot: 0.008, maxBloom: 0.03,
    recoil: { up: 0.024, side: 0.006, kick: 0.04, rotKick: 0.12, recover: 0.8 },
    zoom: 1.2, adsTime: 0.14, moveMul: 1.1, tracer: 0xffe0a0,
    sight: [0.0, 17.45, 12], muzzleMesh: 'muzzlebreak_Mat_0', muzzle: [0, 14.5, 43],
    hip: [0.06, -0.068, -0.3], ads: [0, 0, -0.27], adsVmFov: 45,
    clips: { fire: [0, 0.33], reload: [0.33, 2.1], reloadEmpty: [2.17, 4.33], holster: [4.37, 4.77], draw: [4.77, 5.93], idle: [5.93, 6.83], inspect: [6.87, 7.43] },
    reloadAt: { reload: 0.7, reloadEmpty: 0.75 }, shell: 'pistol',
    sounds: { reload: [[0.25, 'mag'], [1.05, 'mag']], reloadEmpty: [[0.25, 'mag'], [1.0, 'mag'], [1.4, 'slide']], draw: [[0.35, 'slide']] },
  },
};
export const SLOTS = ['carbine', 'smg', 'pistol'];

const V = () => new THREE.Vector3();
class Spring { // critically damped-ish vector spring
  constructor(k = 120, d = 14) { this.k = k; this.d = d; this.x = V(); this.v = V(); this.target = V(); }
  update(dt) {
    const a = this.target.clone().sub(this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.d);
    this.v.addScaledVector(a, dt); this.x.addScaledVector(this.v, dt);
  }
}

export class Viewmodels {
  constructor(assets, envMap) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
    this.baseVmFov = 54;
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.7;
    this.sun = new THREE.DirectionalLight(0xffe2c0, 2.0);
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xa8c0e0, 0x4a4038, 0.9);
    this.scene.add(this.hemi);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 1.2, 2);
    this.scene.add(this.flashLight);

    this.guns = {};
    for (const id of SLOTS) this.guns[id] = this.buildGun(WEAPONS[id], assets[WEAPONS[id].model]);
    this.state = {};
    for (const id of SLOTS) this.state[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

    this.currentId = null; this.pendingId = null;
    this.clipName = 'idle'; this.t = 0; this.clipSpeed = 1;
    this.ads = 0; this.adsWanted = false;
    this.sprint = 0; this.move = 0; this.phase = 0;
    this.sway = new Spring(90, 12); this.recoilPos = new Spring(220, 18); this.recoilRot = new Spring(200, 16);
    this.land = new Spring(160, 14); this.tilt = 0;
    this.lastShot = -1; this.spray = 0; this.bloom = 0;
    this.triggerHeld = false; this.triggerWasDown = false;
    this.flashTimer = 0;
    this.soundQueue = [];
    this.equip(SLOTS[0], true);
  }

  buildGun(cfg, gltf) {
    const holder = new THREE.Group();
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const model = new THREE.Group();
    model.add(root);
    model.rotation.y = Math.PI;
    model.scale.setScalar(cfg.unit);
    holder.add(model);
    holder.visible = false;
    this.scene.add(holder);
    root.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
        const m = o.material;
        if (m && m.isMeshStandardMaterial) m.envMapIntensity = 1.0;
        if (/lens/i.test(o.name)) { // see-through scope glass: black drops out, the reticle stays
          o.material = m.clone(); o.material.blending = THREE.AdditiveBlending; o.material.transparent = true; o.material.depthWrite = false;
          o.material.emissive = new THREE.Color(1, 1, 1); o.material.emissiveMap = m.map; o.material.emissiveIntensity = 1.5; o.renderOrder = 2;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
    // pose at idle to attach helpers in the right place
    action.time = cfg.clips.idle[0]; mixer.update(0); root.updateMatrixWorld(true);
    let baseMesh = null;
    root.traverse(o => { if (o.name === cfg.muzzleMesh) baseMesh = o; });
    if (!baseMesh) root.traverse(o => { if (!baseMesh && o.isMesh && !o.isSkinnedMesh) baseMesh = o; });
    const sight = new THREE.Object3D(), muzzle = new THREE.Object3D();
    const toLocal = (arr) => baseMesh.worldToLocal(root.localToWorld(new THREE.Vector3(...arr)));
    baseMesh.add(sight); sight.position.copy(toLocal(cfg.sight));
    baseMesh.add(muzzle); muzzle.position.copy(toLocal(cfg.muzzle));
    // Place model so the sight point is at the holder origin.
    model.updateMatrixWorld(true);
    const s = new THREE.Vector3(...cfg.sight).multiplyScalar(cfg.unit).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    model.position.copy(s).negate();
    // muzzle flash: 3 additive quads
    const flash = new THREE.Group();
    const fm = new THREE.MeshBasicMaterial({ map: null, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flashMat = this.flashMat || fm;
    const q = new THREE.PlaneGeometry(1, 1);
    const a = new THREE.Mesh(q, this.flashMat), b = new THREE.Mesh(q, this.flashMat), c = new THREE.Mesh(q, this.flashMat);
    b.rotation.y = Math.PI / 2; a.rotation.x = 0; c.rotation.x = Math.PI / 2;
    a.scale.set(1, 1, 1); b.scale.set(1.6, 0.7, 1); c.scale.set(0.7, 1.6, 1);
    b.position.z = c.position.z = 0;
    flash.add(a, b, c); flash.visible = false;
    holder.add(flash);
    return { cfg, holder, model, root, mixer, action, sight, muzzle, flash };
  }

  setFlashTexture(tex) { this.flashMat.map = tex; this.flashMat.needsUpdate = true; }

  get cfg() { return WEAPONS[this.currentId]; }
  get gun() { return this.guns[this.currentId]; }
  get ammo() { return this.state[this.currentId]; }
  get busy() { return ['reload', 'reloadEmpty', 'draw', 'holster'].includes(this.clipName); }
  get reloading() { return this.clipName === 'reload' || this.clipName === 'reloadEmpty'; }

  play(name, speed = 1) {
    this.clipName = name; this.clipSpeed = speed;
    this.t = this.cfg.clips[name][0];
    this.reloadApplied = false;
    this.soundQueue = (this.cfg.sounds[name] || []).map(([at, k]) => ({ at, k }));
  }

  equip(id, instant = false) {
    if (id === this.currentId && !this.pendingId) return;
    if (!this.currentId || instant) {
      if (this.currentId) this.gun.holder.visible = false;
      this.currentId = id; this.gun.holder.visible = true; this.pendingId = null;
      this.play('draw', 1.25);
      return;
    }
    if (this.clipName === 'holster') { this.pendingId = id; return; }
    this.pendingId = id;
    this.play('holster', 1.6);
  }

  reload() {
    const a = this.ammo, c = this.cfg;
    if (this.busy || a.mag >= c.mag || a.reserve <= 0) return false;
    this.play(a.mag === 0 ? 'reloadEmpty' : 'reload', 1.05);
    this.adsWanted = false;
    return true;
  }

  inspect() { if (!this.busy && this.clipName !== 'fire') this.play('inspect', 0.9); }

  // Called every frame by the game; returns array of shots fired this frame.
  update(dt, time, ctx) {
    const c = this.cfg, g = this.gun;
    const shots = [];
    // --- trigger / fire logic ---
    const interval = 60 / c.rpm;
    const wantsFire = ctx.trigger && !ctx.blockFire;
    if (wantsFire && !this.busy && this.sprint < 0.35) {
      // semi-autos repeat while the touch FIRE button is held (at a controlled cadence)
      const can = c.auto ? true : (!this.triggerWasDown || ctx.holdRepeat);
      const gap = c.auto || !this.triggerWasDown ? interval : Math.max(interval, 0.22);
      if (can && time - this.lastShot >= gap) {
        if (this.ammo.mag > 0) {
          if (time - this.lastShot > 0.4) this.spray = 0;
          this.ammo.mag--; this.lastShot = time;
          this.spray++;
          shots.push(this.makeShot(ctx));
          this.play('fire', 1);
          this.kick();
          Audio.playGunshot(c.id);
          if (this.ammo.mag === 0 && this.ammo.reserve > 0) this.autoReloadAt = time + 0.35;
        } else if (!this.triggerWasDown) {
          Audio.playClick('dry');
          if (this.ammo.reserve > 0) this.reload();
        }
      }
    }
    this.triggerWasDown = ctx.trigger;
    if (this.autoReloadAt && time >= this.autoReloadAt) { this.autoReloadAt = 0; this.reload(); }
    this.bloom = Math.max(0, this.bloom - dt * 0.08);

    // --- clip playback ---
    const [s, e] = c.clips[this.clipName];
    this.t += dt * this.clipSpeed;
    const local = this.t - s;
    for (const q of this.soundQueue) if (!q.done && local >= q.at) { q.done = true; Audio.playClick(q.k); }
    if (this.reloading && !this.reloadApplied && local >= (e - s) * c.reloadAt[this.clipName]) {
      const need = c.mag - this.ammo.mag, take = Math.min(need, this.ammo.reserve);
      this.ammo.mag += take; this.ammo.reserve -= take; this.reloadApplied = true;
    }
    if (this.t >= e) {
      if (this.clipName === 'holster' && this.pendingId) {
        g.holder.visible = false;
        this.currentId = this.pendingId; this.pendingId = null;
        this.gun.holder.visible = true;
        this.play('draw', 1.4);
      } else if (this.clipName === 'idle') {
        this.t = s + (this.t - e);
      } else {
        this.play('idle');
      }
    }
    const gun = this.gun;
    gun.action.time = Math.min(this.t, c.clips[this.clipName][1] - 0.001);
    gun.mixer.update(0);

    // --- procedural layers ---
    const adsTarget = (this.adsWanted && !this.busy && this.sprint < 0.3) ? 1 : 0;
    this.ads += Math.sign(adsTarget - this.ads) * Math.min(Math.abs(adsTarget - this.ads), dt / this.cfg.adsTime);
    const ads = smooth(this.ads);
    const sprintTarget = ctx.sprinting && !this.busy ? 1 : (ctx.sprinting ? 0.5 : 0);
    this.sprint += (sprintTarget - this.sprint) * Math.min(1, dt * 8);
    this.move += (ctx.moveSpeed - this.move) * Math.min(1, dt * 10);
    const speedFactor = ctx.grounded ? this.move : 0;
    this.phase += dt * (ctx.sprinting ? 11.5 : 8.2) * Math.min(1, speedFactor / 3);
    const bobAmp = Math.min(1, speedFactor / 4) * (1 - ads * 0.88);
    const sp = this.sprint;
    // look sway (lags opposite to look direction)
    this.sway.target.set(THREE.MathUtils.clamp(-ctx.lookDX * 0.0009, -0.03, 0.03), THREE.MathUtils.clamp(ctx.lookDY * 0.0009, -0.03, 0.03), 0).multiplyScalar(1 - ads * 0.7);
    this.sway.update(dt); this.recoilPos.update(dt); this.recoilRot.update(dt); this.land.update(dt);
    this.recoilPos.target.multiplyScalar(0); this.recoilRot.target.multiplyScalar(0); this.land.target.set(0, 0, 0);
    this.tilt += (THREE.MathUtils.clamp(-ctx.strafe * 0.06, -0.08, 0.08) * (1 - ads * 0.6) - this.tilt) * Math.min(1, dt * 6);

    const hip = new THREE.Vector3(...c.hip), adsP = new THREE.Vector3(...c.ads);
    // dynamic sight alignment while aiming: compensate the baked idle sway so the sight stays centered
    g.holder.updateMatrixWorld(true);
    const sightLocal = g.holder.worldToLocal(g.sight.getWorldPosition(V()));
    const pos = hip.lerp(adsP, ads);
    pos.x -= sightLocal.x * ads; pos.y -= sightLocal.y * ads;
    const breathe = Math.sin(time * 1.6) * 0.0025 * (1 - ads * 0.8);
    // walk / sprint bob (figure-eight)
    const bx = Math.sin(this.phase) * 0.011 * bobAmp * (1 + sp * 1.6);
    const by = -Math.abs(Math.cos(this.phase)) * 0.012 * bobAmp * (1 + sp * 1.4) + breathe;
    pos.x += bx + this.sway.x.x; pos.y += by + this.sway.x.y;
    // sprint pose: lower, pull in, roll & yaw the weapon across the body
    const pistol = c.id === 'pistol';
    pos.x += sp * (pistol ? -0.03 : -0.02); pos.y += sp * (pistol ? -0.004 : -0.012); pos.z += sp * 0.03;
    pos.y += this.land.x.y + ctx.crouchBlend * -0.012;
    pos.z += this.recoilPos.x.z;
    pos.y += this.recoilPos.x.y;
    g.holder.position.copy(pos);
    // sprint: rifles swing across the chest (muzzle left, rolled), pistol tucks low with muzzle down
    const rx = this.recoilRot.x.x + sp * (pistol ? -0.28 : -0.06) + Math.cos(this.phase * 2) * 0.012 * bobAmp + this.sway.x.y * 1.5;
    const ry = sp * (pistol ? 0.3 : 0.62) + this.sway.x.x * 2 + Math.sin(this.phase) * 0.02 * bobAmp + this.recoilRot.x.y;
    const rz = sp * (pistol ? 0.25 : 0.38) + this.tilt + Math.sin(this.phase) * 0.03 * bobAmp + ctx.crouchBlend * 0.04 * (1 - ads) + this.recoilRot.x.z;
    g.holder.rotation.set(rx, ry, rz, 'YXZ');

    this.camera.fov = THREE.MathUtils.lerp(this.baseVmFov, c.adsVmFov, ads);
    this.camera.updateProjectionMatrix();

    // muzzle flash
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) { g.flash.visible = false; this.flashLight.intensity = 0; }
    }
    // camera-space sun
    this.sun.position.copy(ctx.sunDirView).multiplyScalar(5);
    return shots;
  }

  onLand(v) { this.land.v.y -= Math.min(0.5, v * 0.06); }

  kick() {
    const r = this.cfg.recoil;
    const ads = this.ads;
    this.recoilPos.v.z += r.kick * 30 * (1 - ads * 0.5);
    this.recoilPos.v.y += r.kick * 4 * (1 - ads);
    this.recoilRot.v.x += r.rotKick * 30 * (1 - ads * 0.6);
    this.recoilRot.v.z += (Math.random() - 0.5) * r.rotKick * 12;
    this.recoilRot.v.y += (Math.random() - 0.5) * r.rotKick * 8;
    // muzzle flash
    const g = this.gun;
    g.holder.updateMatrixWorld(true);
    g.flash.position.copy(g.holder.worldToLocal(g.muzzle.getWorldPosition(V())));
    g.flash.rotation.z = Math.random() * Math.PI;
    const s = (this.cfg.id === 'pistol' ? 0.07 : 0.1) * (0.8 + Math.random() * 0.5);
    g.flash.scale.setScalar(s);
    g.flash.visible = true; this.flashTimer = 0.035;
    this.flashLight.position.copy(g.muzzle.getWorldPosition(V()));
    this.flashLight.intensity = 6;
    this.bloom = Math.min(this.cfg.maxBloom, this.bloom + this.cfg.bloomPerShot);
  }

  makeShot(ctx) {
    const c = this.cfg;
    const ads = this.ads;
    let spread = THREE.MathUtils.lerp(c.spreadHip, c.spreadAds, ads) + this.bloom * (1 - ads * 0.6);
    spread += Math.min(1, ctx.moveSpeed / 5) * c.spreadMove * (1 - ads * 0.5);
    if (!ctx.grounded) spread += 0.06;
    if (ctx.crouched) spread *= 0.75;
    // CS-style climbing pattern with horizontal wobble
    const i = this.spray;
    const up = c.recoil.up * (i < 4 ? 0.8 : 1.0) * (1 - ads * 0.25);
    const side = c.recoil.side * (Math.sin(i * 0.7) * 1.2 + (Math.random() - 0.5));
    return { spread, recoilUp: up, recoilSide: side, damage: c.damage, cfg: c, ads };
  }

  // world-space muzzle point approximation for tracers/flash light
  muzzleWorld(cameraWorld) {
    const g = this.gun;
    g.holder.updateMatrixWorld(true);
    const p = g.muzzle.getWorldPosition(V()); // in vm camera space (vm camera at origin)
    // vm camera has a different FOV; scale depth so the tracer lines up with the drawn muzzle
    const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(cameraWorld.fov / 2));
    p.x *= k; p.y *= k;
    return p.applyMatrix4(cameraWorld.matrixWorld);
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  refill() { for (const id of SLOTS) { this.state[id].reserve = WEAPONS[id].reserve; } }
  resetAmmo() { for (const id of SLOTS) { this.state[id].mag = WEAPONS[id].mag; this.state[id].reserve = WEAPONS[id].reserve; } }
}

function smooth(x) { return x * x * (3 - 2 * x); }
