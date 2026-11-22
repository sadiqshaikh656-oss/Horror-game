// First-person BODY player (Ch15, Mixamo rig) with the M4 in its hands and baked Mixamo clips
// (assets/models/player.glb, built by tools/build-player.mjs from the Mixamo FBX packs).
//
//  * locomotion: 8-way blend of walk / run / crouch-walk + sprint, phase-synced so direction changes
//    never pop or slide; one stride phase driven by real speed
//  * upper body overlays: firing (hip) and reload; relaxed low-ready idle after a few calm seconds
//  * jump up / loop / land, run-to-stop, directional deaths
//  * aim: spine pitch follows the view (closed loop on the barrel); ADS uses arm IK to bring the optic
//    to the eye; left hand stays locked on the handguard with IK
//  * camera sits at the eye (EyeAnchor), smoothed; head mesh hidden while alive
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const UPPER = /(Spine|Neck|Head|Shoulder|Arm|Hand)/;
const DIRS = ['f', 'fl', 'l', 'bl', 'b', 'br', 'r', 'fr'];      // angle increases toward the model's left (+X)
const STRIDE = { walk: 1.92, run: 2.4, cwalk: 2.04, sprint: 3.6 }; // metres per clip cycle (from root motion)
const ONE_SHOT = /^(jump_up|jump_down|run_stop|death_.*)$/;
const DEATHS = { front: 'death_front', back: 'death_back', right: 'death_right', head_front: 'death_head_front', head_back: 'death_head_back', crouch: 'death_crouch' };

export class FPSBody {
  constructor(gltf, scene, flashTex) {
    this.root = gltf.scene;
    this.holder = new THREE.Group(); this.holder.add(this.root); scene.add(this.holder);
    this.B = {}; this.headObjs = [];
    this.root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isBone) this.B[o.name.replace(/^mixamorig:?/, '')] = o;
      if (/Head/.test(o.name) && o.isMesh) this.headObjs.push(o);
    });
    // marker nodes (re-created if the asset optimizer stripped the empty nodes)
    const marker = (name, parent, pos) => { let o = this.root.getObjectByName(name); if (!o) { o = new THREE.Object3D(); o.name = name; o.position.copy(pos); parent.add(o); } return o; };
    this.rifle = this.root.getObjectByName('Rifle');
    // the detailed M4 doesn't need to render into the shadow map in first person (big triangle saving)
    this.rifle.traverse(o => { if (o.isMesh) o.castShadow = false; });
    this.eyeNode = marker('EyeAnchor', this.B.Head, V(0, 0.1, 0.0975));
    this.muzzle = marker('Muzzle', this.rifle, V(0, 0.41, -0.045));
    this.sight = marker('Sight', this.rifle, V(0, 0.02, -0.118)); // centre of the holo-sight window
    // ---- actions
    this.mixer = new THREE.AnimationMixer(this.root);
    this.A = {}; this.AU = {}; this.AL = {}; this.dur = {}; this.w = {};
    const boneOf = (t) => t.name.split('.')[0].replace(/^mixamorig:?/, '');
    for (const clip of gltf.animations) {
      const n = clip.name; this.dur[n] = clip.duration;
      const tracks = clip.tracks.map(t => t.clone());
      if (!/^death_/.test(n)) { // strip horizontal root motion (keep the vertical bob)
        const hp = tracks.find(t => /Hips\.position$/.test(t.name));
        if (hp) { const v = hp.values, x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; } }
      }
      const mk = (c) => { const a = this.mixer.clipAction(c); if (ONE_SHOT.test(n)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } a.play(); a.setEffectiveWeight(0); return a; };
      if (/^death_/.test(n)) { this.A[n] = mk(new THREE.AnimationClip(n, clip.duration, tracks)); continue; }
      this.AL[n] = mk(new THREE.AnimationClip(n + '_L', clip.duration, tracks.filter(t => !UPPER.test(boneOf(t)))));
      this.AU[n] = mk(new THREE.AnimationClip(n + '_U', clip.duration, tracks.filter(t => UPPER.test(boneOf(t)))));
      this.w[n] = 0;
    }
    this.locoNames = Object.keys(this.AL).filter(n => /^(idle|aim_idle|crouch_idle|crouch_aim|(walk|run|cwalk|sprint)_\w+)$/.test(n));
    // left-hand grip on the handguard, learned from the aim idle pose of this very rig
    this.root.updateMatrixWorld(true);
    this.poseOnly('aim_idle', 0);
    this.leftGrip = this.rifle.matrixWorld.clone().invert().multiply(this.B.LeftHand.matrixWorld);
    this.poseOnly(null);
    // ---- muzzle flash
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.visible = false; this.flashT = 0; scene.add(this.flash);
    // ---- state
    this.phase = 0; this.calmT = 0; this.air = 0; this.landT = 0; this.stopT = 0; this.prevSpd = 0;
    this.aimPitchOff = 0; this.aimYawOff = 0; this.recoil = 0;
    this.deathName = null; this.deathT = 0;
    this.camPos = null; this.headShown = true;
    this.wasReloading = false; this.wasGrounded = true;
  }

  // pose the rig with one clip at time t (used once at start-up); null = rest
  poseOnly(name, t = 0) {
    for (const k in this.AL) { this.AL[k].setEffectiveWeight(0); this.AU[k].setEffectiveWeight(0); }
    if (name) { for (const a of [this.AL[name], this.AU[name]]) { a.setEffectiveWeight(1); a.time = t; } }
    this.mixer.update(0); this.root.updateMatrixWorld(true);
  }

  setHead(v) { if (this.headShown === v) return; this.headShown = v; for (const o of this.headObjs) o.visible = v; }
  setWorldQuat(b, qw) { const pw = b.parent.getWorldQuaternion(Q()); b.quaternion.copy(pw.invert().multiply(qw)); b.updateMatrixWorld(true); }
  rotateWorld(b, axis, ang) { if (!ang) return; const w = b.getWorldQuaternion(Q()); this.setWorldQuat(b, Q().setFromAxisAngle(axis, ang).multiply(w)); }
  aimBone(b, from, to) { const w = b.getWorldQuaternion(Q()); this.setWorldQuat(b, Q().setFromUnitVectors(from, to).multiply(w)); }
  solveArm(side, tp, tq, pole, weight = 1) {
    const up = this.B[side + 'Arm'], lo = this.B[side + 'ForeArm'], hd = this.B[side + 'Hand'];
    const keep = weight < 0.999 ? [up.quaternion.clone(), lo.quaternion.clone(), hd.quaternion.clone()] : null;
    const a = up.getWorldPosition(V()), b = lo.getWorldPosition(V()), c = hd.getWorldPosition(V());
    const la = a.distanceTo(b), lb = b.distanceTo(c); const toT = tp.clone().sub(a);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-4, la + lb - 1e-4); const dir = toT.normalize();
    const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const e = a.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * Math.sqrt(1 - cosA * cosA));
    this.aimBone(up, b.clone().sub(a).normalize(), e.clone().sub(a).normalize());
    const b2 = lo.getWorldPosition(V()), c2 = hd.getWorldPosition(V());
    this.aimBone(lo, c2.clone().sub(b2).normalize(), a.clone().addScaledVector(dir, d).sub(b2).normalize());
    if (tq) this.setWorldQuat(hd, tq);
    if (keep) { up.quaternion.copy(keep[0].slerp(up.quaternion, weight)); lo.quaternion.copy(keep[1].slerp(lo.quaternion, weight)); hd.quaternion.copy(keep[2].slerp(hd.quaternion, weight)); up.updateMatrixWorld(true); }
  }

  muzzleWorld() { return this.muzzle.getWorldPosition(V()); }
  barrelWorld() { return V(0, 1, 0).applyQuaternion(this.rifle.getWorldQuaternion(Q())).normalize(); }
  onShot() {
    this.recoil = Math.min(1, this.recoil + 0.5); this.calmT = 0;
    const p = this.muzzleWorld();
    this.flash.position.copy(p);
    this.flash.quaternion.copy(this.rifle.getWorldQuaternion(Q())).multiply(Q().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));
    this.flash.rotateZ(Math.random() * 6); this.flash.scale.setScalar(0.7 + Math.random() * 0.5);
    this.flash.visible = true; this.flashT = 0.04;
  }

  die(fromDir, head) {
    if (this.deathName) return;
    let k;
    if (this.crouchW > 0.5) k = 'crouch';
    else {
      const local = fromDir ? fromDir.clone().applyAxisAngle(V(0, 1, 0), -this.holder.rotation.y) : V(0, 0, -1);
      // fromDir points from the shooter toward the player; local -Z = hit in the front
      if (Math.abs(local.x) > Math.abs(local.z)) k = 'right';
      else k = local.z < 0 ? (head ? 'head_front' : 'front') : (head ? 'head_back' : 'back');
    }
    this.deathName = DEATHS[k]; this.deathT = 0;
    const a = this.A[this.deathName]; a.reset(); a.play(); a.setEffectiveWeight(1);
  }
  revive() { if (this.deathName) this.A[this.deathName].setEffectiveWeight(0); this.deathName = null; this.camPos = null; }

  // s: {P, camQuat, ads, firing, reloading, reloadTime, crouch, alive}
  update(dt, s) {
    const P = s.P, B = this.B;
    if (!s.alive && !this.deathName) this.die(P.lastHitDir, false);
    if (s.alive && this.deathName) this.revive();
    // ---------- body placement: always faces the view in first person
    const yaw = P.yaw + Math.PI + this.aimYawOff;
    this.holder.position.copy(P.pos); this.holder.rotation.set(0, yaw, 0);
    if (this.deathName) {
      for (const k in this.AL) { this.AL[k].setEffectiveWeight(0); this.AU[k].setEffectiveWeight(0); }
      this.deathT += dt; this.mixer.update(dt); this.root.updateMatrixWorld(true); this.updateFlash(dt); return;
    }
    // ---------- locomotion analysis (velocity in body space)
    const vx = P.vel.x, vz = P.vel.z, spd = Math.hypot(vx, vz);
    const local = V(vx, 0, vz).applyAxisAngle(V(0, 1, 0), -yaw);
    const ang = Math.atan2(local.x, local.z);
    const crouch = s.crouch; this.crouchW = crouch;
    const sprint = P.sprinting && !crouch ? Math.min(1, P.sprintRamp * 1.4) : 0;
    const moving = THREE.MathUtils.smoothstep(spd, 0.15, 0.7);
    const runK = THREE.MathUtils.smoothstep(spd, 2.4, 3.6);
    // directional weights between the two nearest of 8 clips
    const dirW = {}; for (const d of DIRS) dirW[d] = 0;
    const sec = ((ang / (Math.PI / 4)) % 8 + 8) % 8, i0 = Math.floor(sec) % 8, fr = sec - Math.floor(sec);
    dirW[DIRS[i0]] += 1 - fr; dirW[DIRS[(i0 + 1) % 8]] += fr;
    // sprint only has forward variants; fall back to run for the rest
    const sprintDirs = { f: dirW.f, fl: dirW.fl, fr: dirW.fr }; const sprintCover = sprintDirs.f + sprintDirs.fl + sprintDirs.fr;
    // stride phase
    const stride = crouch > 0.5 ? STRIDE.cwalk : THREE.MathUtils.lerp(STRIDE.walk, STRIDE.run, runK) * (1 - sprint) + STRIDE.sprint * sprint;
    this.phase = (this.phase + dt * spd / stride) % 1;
    // calm (relaxed low-ready) when standing still without shooting for a while
    this.calmT = (s.firing || s.ads > 0.1 || spd > 0.3 || s.reloading) ? 0 : this.calmT + dt;
    const calm = THREE.MathUtils.smoothstep(this.calmT, 4, 5.5);
    // air state
    if (!s.grounded) this.air += dt; else this.air = 0;
    if (s.grounded && !this.wasGrounded) { this.landT = 0.35; this.AL.jump_down.reset().play(); this.AU.jump_down.reset().play(); }
    if (!s.grounded && this.wasGrounded && P.vel.y > 1) { this.AL.jump_up.reset().play(); this.AU.jump_up.reset().play(); }
    this.wasGrounded = s.grounded; this.landT = Math.max(0, this.landT - dt);
    // run-to-stop: sudden stop from a fast run/sprint
    if (this.prevSpd > 4.5 && spd < this.prevSpd - 1.2 * dt * 60 * 0.05 && s.wantStop && this.stopT <= 0 && !crouch) { this.stopT = 0.7; this.AL.run_stop.reset().play(); this.AU.run_stop.reset().play(); this.AL.run_stop.time = 0.45; this.AU.run_stop.time = 0.45; }
    this.prevSpd = spd; this.stopT = Math.max(0, this.stopT - dt);
    // ---------- target weights
    const T = {}; for (const n in this.AL) T[n] = 0;
    const airW = s.grounded ? 0 : THREE.MathUtils.smoothstep(this.air, 0.05, 0.2);
    const landW = this.landT > 0 ? this.landT / 0.35 : 0;
    const stopW = this.stopT > 0 ? Math.min(1, this.stopT / 0.25) * (1 - moving * 0.6) : 0;
    const base = (1 - airW) * (1 - landW * 0.6) * (1 - stopW);
    const stand = 1 - crouch;
    // idles
    T.aim_idle = base * stand * (1 - moving) * (1 - calm);
    T.idle = base * stand * (1 - moving) * calm;
    T.crouch_aim = base * crouch * (1 - moving);
    // moving
    for (const d of DIRS) {
      const m = base * moving * dirW[d];
      T['walk_' + d] = m * stand * (1 - runK) * (1 - sprint);
      T['run_' + d] = m * stand * runK * (1 - sprint) + (sprintCover > 0 ? 0 : m * stand * sprint) + (['f', 'fl', 'fr'].includes(d) ? 0 : m * stand * sprint);
      T['cwalk_' + d] = m * crouch;
    }
    if (sprintCover > 0) for (const d of ['f', 'fl', 'fr']) T['sprint_' + d] = base * moving * stand * sprint * dirW[d];
    T.jump_loop = airW * (P.vel.y < 1 ? 1 : 0.3);
    T.jump_up = airW * (P.vel.y >= 1 ? 0.7 : 0);
    T.jump_down = landW * 0.6 * (1 - airW);
    T.run_stop = stopW * (1 - airW);
    // overlays (upper body)
    if (s.reloading && !this.wasReloading) { this.AU.reload.reset().play(); this.AU.reload.timeScale = this.dur.reload / Math.max(0.5, s.reloadTime); }
    this.wasReloading = s.reloading;
    const fireT = s.firing && s.ads < 0.5 && !s.reloading ? 1 : 0, relT = s.reloading ? 1 : 0;
    // ---------- apply (smoothed) weights; loco clips are phase-synced manually
    const k = Math.min(1, dt * 10);
    for (const n in this.AL) {
      const cur = this.w[n] + ((T[n] ?? 0) - this.w[n]) * (/^(fire|reload)$/.test(n) ? 0 : k);
      this.w[n] = cur;
    }
    this.w.fire += (fireT - this.w.fire) * Math.min(1, dt * 14);
    this.w.reload += (relT - this.w.reload) * Math.min(1, dt * 10);
    const over = Math.min(1, this.w.fire + this.w.reload);
    for (const n in this.AL) {
      const isOver = n === 'fire' || n === 'reload';
      this.AL[n].setEffectiveWeight(isOver ? 0 : this.w[n]);
      this.AU[n].setEffectiveWeight(isOver ? this.w[n] : this.w[n] * (1 - over));
      if (/^(walk|run|cwalk|sprint)_/.test(n)) { this.AL[n].timeScale = this.AU[n].timeScale = 0; this.AL[n].time = this.AU[n].time = this.phase * this.dur[n]; }
    }
    if (s.firing && this.AU.fire.time > this.dur.fire * 0.5) this.AU.fire.time = 0.0; // keep the recoil part looping while held
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    // ---------- aim: spine pitch follows the view (+ closed-loop correction on the barrel)
    const right = V(1, 0, 0).applyQuaternion(this.holder.quaternion);
    const camFwd = V(0, 0, -1).applyQuaternion(s.camQuat);
    const camPitch = Math.asin(THREE.MathUtils.clamp(camFwd.y, -1, 1));
    const aimW = (1 - calm * 0.7) * (1 - this.w.reload * 0.6) * (1 - sprint);
    // looking down bends the spine only partly (otherwise the arms swing up into the eye)
    const pitch = camPitch + this.aimPitchOff;
    const spinePitch = pitch > 0 ? pitch : Math.max(pitch * 0.45, -0.45);
    for (const b of [B.Spine, B.Spine1, B.Spine2]) this.rotateWorld(b, right, -spinePitch * 0.33 * aimW);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    if (this.recoil > 0) this.rotateWorld(B.Spine2, right, -this.recoil * 0.035);
    if (aimW > 0.8 && s.ads < 0.5) {
      const bar = this.barrelWorld();
      const pitchErr = camPitch - Math.asin(THREE.MathUtils.clamp(bar.y, -1, 1));
      this.aimPitchOff = THREE.MathUtils.clamp(this.aimPitchOff + pitchErr * Math.min(1, dt * 3), -0.5, 0.5);
      const bh = bar.clone(); bh.y = 0; const ch = camFwd.clone(); ch.y = 0;
      if (bh.lengthSq() > 1e-4) { bh.normalize(); ch.normalize(); const e = Math.atan2(bh.clone().cross(ch).y, bh.dot(ch)); this.aimYawOff = THREE.MathUtils.clamp(this.aimYawOff + e * Math.min(1, dt * 3), -0.6, 0.6); }
    } else { this.aimYawOff *= Math.max(0, 1 - dt * 2); }
    this.updateFlash(dt);
  }

  // eye camera (after update) + ADS / left-hand IK which depend on the final camera
  updateCamera(dt, P, camera, ads, alive) {
    if (!alive && this.deathName) { // death cam: orbit above the body
      this.setHead(true);
      const h = this.B.Hips.getWorldPosition(V());
      const a = P.yaw + this.deathT * 0.25;
      camera.position.set(h.x + Math.sin(a) * 2.6, h.y + 1.8, h.z + Math.cos(a) * 2.6);
      camera.lookAt(h); camera.updateMatrixWorld(); return;
    }
    this.setHead(false);
    const eye = this.eyeNode.getWorldPosition(V());
    // keep the eye over the collision capsule so the camera can't poke into walls
    const off = V(eye.x - P.pos.x, 0, eye.z - P.pos.z); if (off.length() > 0.24) { off.setLength(0.24); eye.x = P.pos.x + off.x; eye.z = P.pos.z + off.z; }
    if (!this.camPos) this.camPos = eye.clone();
    // smooth the animated head motion (horizontal follows tightly, vertical bob is softened)
    const kh = 1 - Math.exp(-dt * 30), kv = 1 - Math.exp(-dt * 14);
    this.camPos.x += (eye.x - this.camPos.x) * kh; this.camPos.z += (eye.z - this.camPos.z) * kh; this.camPos.y += (eye.y - this.camPos.y) * kv;
    camera.position.copy(this.camPos);
    const sh = P.shake;
    camera.rotation.set(P.pitch + (Math.random() - 0.5) * sh * 0.02, P.yaw + (Math.random() - 0.5) * sh * 0.02, 0, 'YXZ');
    camera.position.addScaledVector(V(0, 0, -1).applyQuaternion(camera.quaternion), 0.06);
    camera.updateMatrixWorld();
    // ---- ADS: bring the optic to the eye with right-arm IK
    const fwd = V(0, 0, -1).applyQuaternion(camera.quaternion), up = V(0, 1, 0).applyQuaternion(camera.quaternion);
    if (ads > 0.01 && !this.wasReloading) {
      const rq = quatFromBasis(fwd, up);
      const rs = this.rifle.getWorldScale(V());
      const sightLocal = this.sight.position.clone().multiply(rs).applyQuaternion(rq);
      const kick = this.recoil * 0.04;
      const rp = camera.position.clone().addScaledVector(fwd, 0.13 - kick).sub(sightLocal);
      const rifleW = new THREE.Matrix4().compose(rp, rq, rs);
      const handM = rifleW.multiply(this.rifle.matrix.clone().invert());
      const hp = V(), hq = Q(); handM.decompose(hp, hq, V());
      const rightV = V(1, 0, 0).applyQuaternion(this.holder.quaternion);
      this.solveArm('Right', hp, hq, V(0, -1, 0).addScaledVector(rightV, -0.6), THREE.MathUtils.smoothstep(ads, 0, 1));
    }
    // ---- left hand on the handguard (released during reloads)
    const lw = 1 - this.w.reload;
    if (lw > 0.02) {
      this.rifle.updateMatrixWorld(true);
      const g = this.rifle.matrixWorld.clone().multiply(this.leftGrip);
      const gp = V(), gq = Q(); g.decompose(gp, gq, V());
      const leftV = V(1, 0, 0).applyQuaternion(this.holder.quaternion);
      this.solveArm('Left', gp, gq, V(0, -1, 0).addScaledVector(leftV, 0.5), lw);
    }
  }

  updateFlash(dt) { if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; } }
}

// rotation mapping rifle local +Y -> dir and local -Z -> up
function quatFromBasis(dir, up) {
  const y = dir.clone().normalize();
  const zN = up.clone().sub(y.clone().multiplyScalar(up.dot(y))).normalize();
  const z = zN.clone().negate(), x = V().crossVectors(y, z).normalize();
  return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
