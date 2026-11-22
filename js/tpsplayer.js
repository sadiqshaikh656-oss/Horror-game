// Third-person player: the SWAT operator with its five corrected rifle clips (models-export /
// assets/models/player.glb), an over-the-shoulder camera, and upper/lower-body animation layering.
//
//  * legs always play the locomotion blend (idle / walk / run, time-scaled to the real speed)
//  * the upper body blends to Rifle_Fire (aim + fire) or Rifle_Reload when needed, so the operator
//    can reload or shoot while walking
//  * crouch is procedural (hips drop, two-bone leg IK keeps the feet planted)
//  * aim is closed-loop: body yaw + spine pitch are steered until the barrel points at the crosshair
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
// rifle placement inside mixamorig:RightHand (same values that were baked into the GLB)
const RIFLE_IN_HAND = [-24.85851, -5.94046, 110.43575, 0, 20.93815, 110.89122, 10.67803, 0, -108.59527, 22.74066, -23.22095, 0, 7.86199, 24.47937, 4.08438, 1];
const MUZZLE_LOCAL = V(0, 0.41, -0.045);
const UPPER = /(Spine|Neck|Head|Shoulder|Arm|Hand)/;
const CLIPS = { idle: 'Rifle_Idle', walk: 'Rifle_Walk', run: 'Rifle_Run', fire: 'Rifle_Fire', reload: 'Rifle_Reload' };

export class TPSPlayer {
  constructor(gltf, scene, flashTex) {
    this.root = gltf.scene;
    this.holder = new THREE.Group();
    this.holder.add(this.root);
    scene.add(this.holder);
    this.root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material;
        if (m && m.transmission) { m.transmission = 0; m.transparent = true; m.opacity = 0.55; }
      }
    });
    this.B = {}; this.root.traverse(o => { if (o.isBone) this.B[o.name.replace(/^mixamorig:?/, '')] = o; });
    this.root.updateMatrixWorld(true);
    // ----- clips: strip root motion, measure native speed, split upper / lower body
    const hipsScale = this.B.Hips.parent.getWorldScale(V()).x;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.L = {}; this.U = {}; this.native = {}; this.dur = {};
    for (const [key, name] of Object.entries(CLIPS)) {
      const clip = gltf.animations.find(c => c.name === name);
      if (!clip) { console.warn('missing clip', name); continue; }
      this.dur[key] = clip.duration;
      const tracks = clip.tracks.map(t => t.clone());
      const hp = tracks.find(t => /Hips\.position$/.test(t.name));
      if (hp) {
        const v = hp.values, n = v.length / 3;
        // horizontal travel in hips-parent space -> metres per second
        this.native[key] = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) * hipsScale / clip.duration;
        const x0 = v[0], z0 = v[2];
        for (let i = 0; i < n; i++) { v[i * 3] = x0; v[i * 3 + 2] = z0; } // keep the vertical bob only
      }
      const boneOf = (t) => t.name.split('.')[0].replace(/^mixamorig:?/, '');
      const lower = new THREE.AnimationClip(name + '_L', clip.duration, tracks.filter(t => !UPPER.test(boneOf(t))));
      const upper = new THREE.AnimationClip(name + '_U', clip.duration, tracks.filter(t => UPPER.test(boneOf(t))));
      this.L[key] = this.mixer.clipAction(lower); this.U[key] = this.mixer.clipAction(upper);
      for (const a of [this.L[key], this.U[key]]) { a.play(); a.setEffectiveWeight(0); }
    }
    this.L.idle.setEffectiveWeight(1); this.U.idle.setEffectiveWeight(1);
    this.w = { idle: 1, walk: 0, run: 0, fire: 0, reload: 0 };
    // ----- rifle muzzle (child of the right hand, in rifle space)
    const rifle = new THREE.Object3D();
    new THREE.Matrix4().fromArray(RIFLE_IN_HAND).decompose(rifle.position, rifle.quaternion, rifle.scale);
    this.B.RightHand.add(rifle);
    this.rifle = rifle;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.copy(MUZZLE_LOCAL); rifle.add(this.muzzle);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.visible = false; this.flashT = 0;
    scene.add(this.flash);
    // ----- state
    this.bodyYaw = 0; this.aimYawOff = 0; this.aimPitchOff = 0; this.recoil = 0;
    this.camDist = 2.6; this.deathT = 0;
    this.wasReloading = false;
  }

  // world helpers
  setWorldQuat(b, qw) { const pw = b.parent.getWorldQuaternion(Q()); b.quaternion.copy(pw.invert().multiply(qw)); b.updateMatrixWorld(true); }
  rotateWorld(b, axis, ang) { if (!ang) return; const w = b.getWorldQuaternion(Q()); this.setWorldQuat(b, Q().setFromAxisAngle(axis, ang).multiply(w)); }
  aimBone(b, from, to) { const w = b.getWorldQuaternion(Q()); this.setWorldQuat(b, Q().setFromUnitVectors(from, to).multiply(w)); }
  solveLeg(side, target, pole) {
    const up = this.B[side + 'UpLeg'], lo = this.B[side + 'Leg'], ft = this.B[side + 'Foot'];
    const footQ = ft.getWorldQuaternion(Q());
    const a = up.getWorldPosition(V()), b = lo.getWorldPosition(V()), c = ft.getWorldPosition(V());
    const la = a.distanceTo(b), lb = b.distanceTo(c);
    const toT = target.clone().sub(a);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-4, la + lb - 1e-4); const dir = toT.normalize();
    const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const e = a.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * Math.sqrt(1 - cosA * cosA));
    this.aimBone(up, b.clone().sub(a).normalize(), e.clone().sub(a).normalize());
    const b2 = lo.getWorldPosition(V()), c2 = ft.getWorldPosition(V());
    this.aimBone(lo, c2.clone().sub(b2).normalize(), a.clone().addScaledVector(dir, d).sub(b2).normalize());
    this.setWorldQuat(ft, footQ);
  }

  muzzleWorld() { this.root.updateMatrixWorld(true); return this.muzzle.getWorldPosition(V()); }
  barrelWorld() { const q = this.rifle.getWorldQuaternion(Q()); return V(0, 1, 0).applyQuaternion(q).normalize(); }

  onShot() {
    this.recoil = Math.min(1, this.recoil + 0.45);
    const p = this.muzzleWorld();
    this.flash.position.copy(p);
    this.flash.quaternion.copy(this.rifle.getWorldQuaternion(Q())).multiply(Q().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));
    this.flash.rotateZ(Math.random() * 6); this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.flash.visible = true; this.flashT = 0.04;
  }

  // s: {P, camera, aiming, firing, reloading, reloadTime, moveSpeed, sprinting, crouch, grounded, alive, vel}
  update(dt, s) {
    const P = s.P, B = this.B;
    // ---------- body facing
    const camYaw = P.yaw;
    const combat = s.aiming || s.firing;
    let targetYaw = this.bodyYaw;
    if (combat || (s.reloading && s.moveSpeed < 0.5)) targetYaw = camYaw + Math.PI + this.aimYawOff;
    else if (s.moveSpeed > 0.4) targetYaw = Math.atan2(s.vel.x, s.vel.z);
    const dy = wrap(targetYaw - this.bodyYaw);
    this.bodyYaw += dy * Math.min(1, dt * (combat ? 18 : 10));
    this.holder.position.copy(P.pos);
    // ---------- locomotion weights
    const spd = s.moveSpeed;
    const tgt = { idle: spd < 0.35 ? 1 : 0, walk: spd >= 0.35 && !(s.sprinting || spd > 5.2) ? 1 : 0, run: (s.sprinting || spd > 5.2) && spd >= 0.35 ? 1 : 0 };
    for (const k of ['idle', 'walk', 'run']) this.w[k] += (tgt[k] - this.w[k]) * Math.min(1, dt * 9);
    if (this.native.walk > 0.2) this.L.walk.timeScale = this.U.walk.timeScale = THREE.MathUtils.clamp(spd / this.native.walk, 0.55, 1.8);
    if (this.native.run > 0.2) this.L.run.timeScale = this.U.run.timeScale = THREE.MathUtils.clamp(spd / this.native.run, 0.7, 1.6);
    // ---------- upper-body overlay
    if (s.reloading && !this.wasReloading) { this.U.reload.reset().play(); this.U.reload.timeScale = this.dur.reload / Math.max(0.5, s.reloadTime); }
    this.wasReloading = s.reloading;
    const oF = !s.reloading && combat ? 1 : 0, oR = s.reloading ? 1 : 0;
    this.w.fire += (oF - this.w.fire) * Math.min(1, dt * 12);
    this.w.reload += (oR - this.w.reload) * Math.min(1, dt * 10);
    // aiming without shooting = hold the first frame of the fire clip; shooting loops it
    if (s.firing) { if (this.U.fire.timeScale === 0) this.U.fire.time = 0; this.U.fire.timeScale = 1; }
    else { this.U.fire.timeScale = 0; this.U.fire.time = 0.05; }
    const over = Math.min(1, this.w.fire + this.w.reload);
    for (const k of ['idle', 'walk', 'run']) { this.L[k].setEffectiveWeight(this.w[k]); this.U[k].setEffectiveWeight(this.w[k] * (1 - over)); }
    this.U.fire.setEffectiveWeight(this.w.fire); this.U.reload.setEffectiveWeight(this.w.reload);
    this.mixer.update(dt);
    // ---------- death: fall backward, then lie still
    if (!s.alive) {
      this.deathT += dt; const e = Math.min(1, this.deathT / 0.8) ** 2;
      this.holder.rotation.set(-e * 1.45, this.bodyYaw, 0, 'YXZ');
      this.updateFlash(dt); return;
    }
    this.deathT = 0;
    this.holder.rotation.set(0, this.bodyYaw, 0);
    this.root.updateMatrixWorld(true);
    const right = V(1, 0, 0).applyQuaternion(this.holder.quaternion);
    // ---------- crouch: drop the hips, keep the feet planted with leg IK
    if (s.crouch > 0.01) {
      const fL = B.LeftFoot.getWorldPosition(V()), fR = B.RightFoot.getWorldPosition(V());
      const hp = B.Hips.getWorldPosition(V()); hp.y -= 0.36 * s.crouch;
      hp.addScaledVector(V(0, 0, 1).applyQuaternion(this.holder.quaternion), -0.06 * s.crouch);
      B.Hips.position.copy(B.Hips.parent.worldToLocal(hp)); B.Hips.updateMatrixWorld(true);
      const fwd = V(0, 0, 1).applyQuaternion(this.holder.quaternion);
      this.solveLeg('Left', fL, fwd.clone().add(V(0, 0.2, 0)));
      this.solveLeg('Right', fR, fwd.clone().add(V(0, 0.2, 0)));
      this.rotateWorld(B.Spine, right, 0.18 * s.crouch);
    }
    // ---------- airborne: tuck the knees a little
    if (!s.grounded) { this.rotateWorld(B.LeftUpLeg, right, -0.35); this.rotateWorld(B.RightUpLeg, right, -0.2); this.rotateWorld(B.LeftLeg, right, 0.6); this.rotateWorld(B.RightLeg, right, 0.45); }
    // ---------- closed-loop aim: steer spine pitch + body yaw until the barrel matches the camera
    const aimW = Math.max(this.w.fire, 0.35 * (1 - this.w.reload));
    const camFwd = V(0, 0, -1).applyQuaternion(s.camera.quaternion);
    const camPitch = Math.asin(THREE.MathUtils.clamp(camFwd.y, -1, 1));
    const pitch = camPitch + this.aimPitchOff;
    for (const b of [B.Spine, B.Spine1, B.Spine2]) this.rotateWorld(b, right, -pitch * 0.33 * aimW);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.recoil > 0) { this.rotateWorld(B.Spine2, right, -this.recoil * 0.05); this.rotateWorld(B.RightShoulder, right, -this.recoil * 0.04); }
    if (this.w.fire > 0.9) {
      const bar = this.barrelWorld();
      const bh = bar.clone(); bh.y = 0; const ch = camFwd.clone(); ch.y = 0;
      if (bh.lengthSq() > 1e-4 && ch.lengthSq() > 1e-4) {
        bh.normalize(); ch.normalize();
        const yawErr = Math.atan2(bh.clone().cross(ch).y, bh.dot(ch));
        this.aimYawOff = THREE.MathUtils.clamp(this.aimYawOff + yawErr * Math.min(1, dt * 6), -1.2, 1.2);
      }
      const pitchErr = camPitch - Math.asin(THREE.MathUtils.clamp(bar.y, -1, 1));
      this.aimPitchOff = THREE.MathUtils.clamp(this.aimPitchOff + pitchErr * Math.min(1, dt * 4), -0.8, 0.8);
    }
    this.updateFlash(dt);
  }

  updateFlash(dt) { if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; } }

  // over-the-shoulder camera with wall collision; called after the player controller
  updateCamera(dt, P, camera, world, ads) {
    const pivot = V(P.pos.x, P.pos.y + P.eye - 0.08, P.pos.z);
    if (!P.alive) pivot.y = P.pos.y + 0.9;
    const rot = new THREE.Euler(P.pitch, P.yaw, 0, 'YXZ');
    const q = Q().setFromEuler(rot);
    const offset = V(THREE.MathUtils.lerp(0.55, 0.42, ads), THREE.MathUtils.lerp(0.18, 0.12, ads), THREE.MathUtils.lerp(2.5, 1.15, ads)).applyQuaternion(q);
    const len = offset.length(), dir = offset.clone().normalize();
    const hit = world.raycast(pivot, dir, len + 0.25);
    const want = hit ? Math.max(0.35, hit.dist - 0.25) : len;
    this.camDist += (want - this.camDist) * Math.min(1, dt * (want < this.camDist ? 30 : 6));
    camera.position.copy(pivot).addScaledVector(dir, this.camDist);
    const sh = P.shake;
    camera.rotation.set(P.pitch + (Math.random() - 0.5) * sh * 0.02, P.yaw + (Math.random() - 0.5) * sh * 0.02, 0, 'YXZ');
    camera.updateMatrixWorld();
    // hide the body if the camera gets pushed into it
    this.root.visible = this.camDist > 0.6 || !P.alive;
  }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
