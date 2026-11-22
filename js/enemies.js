// Enemy soldiers. The supplied trooper model is a static (unrigged) mesh, so we build a skeleton and
// skin weights procedurally at load time, pose the arms onto a rifle with two-bone IK, and drive
// walk/run cycles, aim pitch, hit flinches and death falls from code.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { dequantize } from './world.js';
import * as Audio from './audio.js';

const NAMES = ['VIPER', 'GHOST', 'RAPTOR', 'HAVOC', 'REAPER', 'NOMAD', 'SPECTRE', 'JACKAL', 'COBRA', 'TITAN', 'WRAITH', 'ONYX'];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// rest joint positions (model space, metres, feet at y=0, facing +Z, model's left = +X)
const J = {
  hips: V(0, 1.0, 0), spine: V(0, 1.2, 0), chest: V(0, 1.42, 0), neck: V(0, 1.6, 0), head: V(0, 1.68, 0),
  thighL: V(0.1, 0.96, 0), shinL: V(0.11, 0.52, 0.0), thighR: V(-0.1, 0.96, 0), shinR: V(-0.11, 0.52, 0.0),
  armL: V(0.19, 1.56, 0), armR: V(-0.19, 1.56, 0),
};

export function buildSoldierTemplate(gltf, carbineGltf) {
  const src = gltf.scene; src.updateMatrixWorld(true);
  const parts = [];
  let minY = Infinity;
  src.traverse(o => { if (o.isMesh) { const g = dequantize(o.geometry).applyMatrix4(o.matrixWorld); g.computeBoundingBox(); minY = Math.min(minY, g.boundingBox.min.y); parts.push({ g, m: o.material, name: o.name }); } });
  for (const p of parts) p.g.translate(0, -minY, 0);

  // Find the hands (outermost arm vertices) to place elbows.
  let hand = V(0.72, 1.0, 0);
  {
    let maxX = 0; const acc = V(); let n = 0;
    for (const p of parts) { const a = p.g.attributes.position; for (let i = 0; i < a.count; i++) maxX = Math.max(maxX, a.getX(i)); }
    for (const p of parts) { const a = p.g.attributes.position; for (let i = 0; i < a.count; i++) if (a.getX(i) > maxX - 0.1) { acc.add(V(a.getX(i), a.getY(i), a.getZ(i))); n++; } }
    if (n) hand = acc.divideScalar(n);
  }
  J.handL = hand.clone(); J.handR = V(-hand.x, hand.y, hand.z);
  J.elbowL = J.armL.clone().lerp(J.handL, 0.5); J.elbowR = J.armR.clone().lerp(J.handR, 0.5);
  J.armL.z = J.armR.z = J.elbowL.z * 0 + hand.z * 0.5;

  // Bones
  const B = {};
  const mk = (name, parent, pos) => { const b = new THREE.Bone(); b.name = name; const pp = parent ? J[parent] || V() : V(); b.position.copy(pos).sub(parent ? pp : V()); B[name] = b; if (parent) B[parent].add(b); return b; };
  const root = new THREE.Bone(); root.name = 'root'; B.root = root;
  mk('hips', null, J.hips); root.add(B.hips); B.hips.position.copy(J.hips);
  mk('spine', 'hips', J.spine); mk('chest', 'spine', J.chest); mk('neck', 'chest', J.neck); mk('head', 'neck', J.head);
  mk('armL', 'chest', J.armL); mk('elbowL', 'armL', J.elbowL);
  mk('armR', 'chest', J.armR); mk('elbowR', 'armR', J.elbowR);
  mk('thighL', 'hips', J.thighL); mk('shinL', 'thighL', J.shinL);
  mk('thighR', 'hips', J.thighR); mk('shinR', 'thighR', J.shinR);
  const order = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'armL', 'elbowL', 'armR', 'elbowR', 'thighL', 'shinL', 'thighR', 'shinR'];
  const idx = Object.fromEntries(order.map((n, i) => [n, i]));
  const bones = order.map(n => B[n]);

  const ss = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
  function weigh(x, y, z) {
    const ax = Math.abs(x), side = x >= 0 ? 'L' : 'R';
    // arms
    const armness = y > 0.9 ? ss(0.2, 0.27, ax) : 0;
    if (armness > 0) {
      const S = J['arm' + side], H = J['hand' + side];
      const d = H.clone().sub(S); const t = V(x, y, z).sub(S).dot(d) / d.lengthSq();
      const fore = ss(0.42, 0.58, t);
      const armBone = fore > 0.5 ? 'elbow' + side : 'arm' + side;
      const armW = fore > 0.5 ? fore : 1 - fore;
      if (armness >= 0.999) return [armBone, fore > 0.5 ? 'arm' + side : 'elbow' + side, armW];
      return [armBone, 'chest', armness];
    }
    if (y < 1.02) { // legs
      const thigh = 'thigh' + side, shin = 'shin' + side;
      if (y > 0.9) { const w = ss(0.9, 1.02, y); return ['hips', thigh, w]; }
      const k = ss(0.44, 0.6, y); return [thigh, shin, k];
    }
    if (y > 1.6 && ax < 0.17) { const w = ss(1.58, 1.66, y); return ['head', 'chest', w]; }
    if (y > 1.32) { const w = ss(1.32, 1.42, y); return ['chest', 'spine', w]; }
    if (y > 1.1) { const w = ss(1.1, 1.22, y); return ['spine', 'hips', w]; }
    return ['hips', 'spine', 1];
  }

  const group = new THREE.Group();
  group.add(root);
  group.updateMatrixWorld(true); // bind inverses are taken from the bones' current world matrices
  const skeleton = new THREE.Skeleton(bones);
  for (const p of parts) {
    const a = p.g.attributes.position, n = a.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const [b0, b1, w] = weigh(a.getX(i), a.getY(i), a.getZ(i));
      si[i * 4] = idx[b0]; si[i * 4 + 1] = idx[b1]; sw[i * 4] = w; sw[i * 4 + 1] = 1 - w;
    }
    p.g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    p.g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const mesh = new THREE.SkinnedMesh(p.g, p.m);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    mesh.bind(skeleton);
  }

  // Rifle: take the non-skinned carbine parts from the viewmodel GLB, scaled to real size.
  const rifle = new THREE.Group(); rifle.name = 'rifle';
  const cs = carbineGltf.scene; cs.updateMatrixWorld(true);
  const inv = cs.matrixWorld.clone().invert();
  cs.traverse(o => {
    if (o.isMesh && !o.isSkinnedMesh) {
      const g = dequantize(o.geometry).applyMatrix4(inv.clone().multiply(o.matrixWorld));
      const m = new THREE.Mesh(g, o.material); m.castShadow = true; rifle.add(m);
    }
  });
  // centre rifle on its trigger, scale to ~0.9m
  const RS = 0.42;
  rifle.scale.setScalar(RS);
  const trig = V(0, 0.17, 0.13);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.3, 1.39); rifle.add(muzzle); muzzle.name = 'muzzle';
  // rifle held in chest space: grip under the right shoulder, barrel forward
  const gripChest = V(-0.13, -0.16, 0.24);
  rifle.position.copy(gripChest).sub(trig.clone().multiplyScalar(RS));
  B.chest.add(rifle);
  const foreChest = rifle.position.clone().add(V(0, 0.12, 0.62).multiplyScalar(RS));

  // two-bone IK (computed once, in chest space) for both arms
  const chestP = J.chest;
  const solve = (side, target, pole) => {
    const S = J['arm' + side].clone().sub(chestP), E0 = J['elbow' + side].clone().sub(chestP), H0 = J['hand' + side].clone().sub(chestP);
    const a = E0.distanceTo(S), b = H0.distanceTo(E0);
    const dvec = target.clone().sub(S); const d = Math.min(dvec.length(), a + b - 0.002); const dir = dvec.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    const T = S.clone().addScaledVector(dir, d);
    const restU = E0.clone().sub(S).normalize(), restF = H0.clone().sub(E0).normalize();
    const desU = E.clone().sub(S).normalize(), desF = T.clone().sub(E).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(restU, desU);
    const q2 = new THREE.Quaternion().setFromUnitVectors(restF, desF.clone().applyQuaternion(q1.clone().invert()));
    return [q1, q2];
  };
  const [qLU, qLF] = solve('L', foreChest, V(0.6, -1, -0.2));
  const [qRU, qRF] = solve('R', gripChest, V(-0.8, -1, -0.4));
  const aimPose = { armL: qLU, elbowL: qLF, armR: qRU, elbowR: qRF };
  group.userData.aimPose = aimPose;
  for (const k in aimPose) B[k].quaternion.copy(aimPose[k]);
  return group;
}

const ray = new THREE.Ray();
function rayCapsule(o, d, a, b, r) {
  // closest approach between ray and segment ab
  const ba = b.clone().sub(a), oa = o.clone().sub(a);
  const baba = ba.dot(ba), bard = ba.dot(d), baoa = ba.dot(oa), rdoa = d.dot(oa), oaoa = oa.dot(oa);
  const A = baba - bard * bard; let B = baba * rdoa - baoa * bard; let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0) {
    const t = (-B - Math.sqrt(h)) / A; const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
    const oc = y <= 0 ? oa : o.clone().sub(b);
    B = d.dot(oc); C = oc.dot(oc) - r * r; h = B * B - C;
    if (h > 0) { const t2 = -B - Math.sqrt(h); if (t2 > 0) return t2; }
  }
  return null;
}
function raySphere(o, d, c, r) {
  const oc = o.clone().sub(c); const b = oc.dot(d), cc = oc.dot(oc) - r * r; const h = b * b - cc;
  if (h < 0) return null; const t = -b - Math.sqrt(h); return t > 0 ? t : null;
}

export class Enemy {
  constructor(template, world, effects, id, difficulty) {
    this.world = world; this.effects = effects; this.id = id;
    this.name = NAMES[id % NAMES.length];
    this.obj = SkeletonUtils.clone(template);
    this.obj.userData.aimPose = template.userData.aimPose;
    this.bones = {}; this.obj.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.rifle = this.obj.getObjectByName('rifle');
    this.muzzle = this.obj.getObjectByName('muzzle');
    for (const k in template.userData.aimPose) this.bones[k].quaternion.copy(template.userData.aimPose[k]);
    this.rest = {}; for (const k in this.bones) this.rest[k] = this.bones[k].position.clone();
    world.scene.add(this.obj);
    this.pos = V(); this.yaw = 0; this.health = 100; this.alive = true;
    this.state = 'patrol'; this.path = null; this.pathTimer = 0; this.target = null;
    this.reaction = 0; this.lastSeen = null; this.seenTimer = 0; this.alertTimer = 0;
    this.burst = 0; this.nextShot = 0; this.strafeDir = 1; this.strafeTimer = 0;
    this.phase = Math.random() * 6; this.speed = 0; this.aimPitch = 0; this.flinch = 0; this.deathT = 0;
    this.difficulty = difficulty;
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), new THREE.MeshBasicMaterial({ map: effects.flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.visible = false; this.muzzle.add(this.flash); this.flash.scale.setScalar(1 / 0.42);
    this.flashT = 0;
    this.head = V(); this.neck = V(); this.hip = V(); this.foot = V();
  }

  spawn(p) { this.pos.copy(p); this.yaw = Math.random() * 6.28; this.health = 100; this.alive = true; this.state = 'patrol'; this.path = null; this.deathT = 0; this.obj.visible = true; this.obj.rotation.set(0, 0, 0); this.rifle.visible = true; }

  eye() { return V(this.pos.x, this.pos.y + 1.55, this.pos.z); }

  update(dt, time, game) {
    const P = game.player;
    if (!this.alive) { this.animateDeath(dt); return; }
    const toP = P.pos.clone().sub(this.pos); const dist = Math.hypot(toP.x, toP.z);
    const eye = this.eye(); const pHead = P.head.clone();
    const facing = Math.atan2(toP.x, toP.z);
    const angDiff = Math.abs(wrap(facing - this.yaw));
    let sees = false;
    if (P.alive && dist < 60 && (angDiff < 1.2 || this.alertTimer > 0 || dist < 6)) {
      sees = this.world.lineOfSight(eye, pHead) || this.world.lineOfSight(eye, pHead.clone().setY(P.pos.y + 1.0));
    }
    this.alertTimer = Math.max(0, this.alertTimer - dt);
    if (sees) { this.lastSeen = P.pos.clone(); this.seenTimer = 3; this.state = 'combat'; this.reaction += dt; }
    else { this.reaction = Math.max(0, this.reaction - dt * 0.5); this.seenTimer -= dt; if (this.state === 'combat' && this.seenTimer <= 0) this.state = this.lastSeen ? 'search' : 'patrol'; }

    let moveTarget = null, runSpeed = 2.0;
    if (this.state === 'patrol') {
      if (!this.path || !this.path.length) { this.pathTimer -= dt; if (this.pathTimer <= 0) { this.path = this.world.findPath(this.pos, this.world.randomWalkable()); this.pathTimer = 1 + Math.random() * 2; } }
      runSpeed = 1.9;
    } else if (this.state === 'search') {
      runSpeed = 3.6;
      this.pathTimer -= dt;
      if ((!this.path || !this.path.length) && this.pathTimer <= 0) {
        if (this.lastSeen && this.pos.distanceTo(this.lastSeen) > 1.5) this.path = this.world.findPath(this.pos, this.lastSeen);
        else { this.lastSeen = null; this.state = 'patrol'; }
        this.pathTimer = 0.8;
      }
    } else if (this.state === 'combat') {
      runSpeed = 3.8;
      this.pathTimer -= dt;
      if (!sees) {
        if (this.pathTimer <= 0) { this.path = this.world.findPath(this.pos, this.lastSeen); this.pathTimer = 0.7; }
      } else if (dist > 22) {
        if (this.pathTimer <= 0) { this.path = this.world.findPath(this.pos, P.pos); this.pathTimer = 0.9; }
      } else {
        // strafe while shooting
        this.path = null;
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) { this.strafeDir = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1); this.strafeTimer = 0.8 + Math.random() * 1.6; }
        if (this.strafeDir) {
          const side = V(Math.cos(facing), 0, -Math.sin(facing)).multiplyScalar(this.strafeDir);
          moveTarget = this.pos.clone().addScaledVector(side, 2);
          if (dist < 7) moveTarget.addScaledVector(toP.clone().normalize(), -2);
          runSpeed = 2.4;
        }
      }
    }
    if (this.path && this.path.length) {
      moveTarget = this.path[0];
      if (Math.hypot(moveTarget.x - this.pos.x, moveTarget.z - this.pos.z) < 0.4) { this.path.shift(); moveTarget = this.path[0] || null; }
    }
    // locomotion
    let vx = 0, vz = 0;
    if (moveTarget) {
      const dx = moveTarget.x - this.pos.x, dz = moveTarget.z - this.pos.z; const l = Math.hypot(dx, dz);
      if (l > 0.05) { vx = dx / l * runSpeed; vz = dz / l * runSpeed; }
    }
    // separation from other enemies
    for (const o of game.enemies) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z; const d2 = dx * dx + dz * dz;
      if (d2 < 1.2 && d2 > 1e-4) { const d = Math.sqrt(d2); vx += dx / d * 1.5; vz += dz / d * 1.5; }
    }
    const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    if (this.free(nx, this.pos.z)) this.pos.x = nx;
    if (this.free(this.pos.x, nz)) this.pos.z = nz;
    const sp = Math.hypot(vx, vz);
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    // facing: toward the player in combat, otherwise toward movement
    let desiredYaw = this.yaw;
    if (this.state === 'combat' && sees) desiredYaw = facing;
    else if (sp > 0.3) desiredYaw = Math.atan2(vx, vz);
    this.yaw += THREE.MathUtils.clamp(wrap(desiredYaw - this.yaw), -dt * 5, dt * 5);
    // aim pitch toward player chest
    const targetPitch = sees ? Math.atan2((P.pos.y + 1.2) - (this.pos.y + 1.4), Math.max(1, dist)) : 0;
    this.aimPitch += (targetPitch - this.aimPitch) * Math.min(1, dt * 6);

    // shooting
    if (this.state === 'combat' && sees && this.reaction > 0.5 / this.difficulty && angDiff < 0.25 && time > this.nextShot) {
      if (this.burst <= 0) this.burst = 3 + Math.floor(Math.random() * 4);
      this.shoot(game, dist, time);
      this.burst--;
      this.nextShot = time + (this.burst > 0 ? 0.11 : 0.55 + Math.random() * 0.9 / this.difficulty);
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.animate(dt);
  }

  free(x, z) {
    const r = 0.3;
    for (const c of this.world.colliders) {
      if (c.min.y > this.pos.y + 1.0 || c.max.y < this.pos.y + 0.3) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return false;
    }
    return Math.abs(x) < 35.5 && Math.abs(z) < 35.5;
  }

  shoot(game, dist, time) {
    const P = game.player;
    this.obj.updateMatrixWorld(true);
    const from = this.muzzle.getWorldPosition(V());
    let acc = THREE.MathUtils.clamp(0.62 - dist * 0.011, 0.1, 0.62) * this.difficulty;
    if (P.moveSpeed > 3) acc *= 0.7; if (P.crouched) acc *= 0.8; if (!P.grounded) acc *= 0.6;
    acc *= Math.min(1, 0.6 + this.reaction * 0.3);
    const target = P.head.clone().add(V(0, -0.35, 0));
    const hit = Math.random() < acc;
    let end;
    if (hit) {
      end = target;
      P.damage(7 + Math.random() * 6 * this.difficulty, this.pos);
    } else {
      const miss = V((Math.random() - 0.5), (Math.random() - 0.3), (Math.random() - 0.5)).normalize().multiplyScalar(0.6 + Math.random() * 1.2);
      const dir = target.clone().add(miss).sub(from).normalize();
      const h = this.world.raycast(from, dir, 80);
      end = h ? h.point : from.clone().addScaledVector(dir, 80);
      if (h) this.effects.impact(h.point, h.normal, h.surface, dir);
      // whiz if it passed near the head
      const closest = V(); new THREE.Ray(from, dir).closestPointToPoint(P.head, closest);
      if (closest.distanceTo(P.head) < 1.5) Audio.playWhiz(game.panFor(this.pos));
    }
    this.effects.tracer(from, end, 0xff9a60);
    this.effects.flashLight(from, 5);
    this.flash.visible = true; this.flash.rotation.z = Math.random() * 6; this.flashT = 0.04;
    Audio.playGunshot('enemy', game.panFor(this.pos), dist);
    game.onEnemyFire(this);
  }

  animate(dt) {
    const b = this.bones, r = this.rest;
    const moving = Math.min(1, this.speed / 2.2);
    this.phase += dt * (3.2 + this.speed * 1.9);
    const ph = this.phase;
    const amp = moving * (this.speed > 3 ? 0.75 : 0.5);
    b.thighL.rotation.x = -Math.sin(ph) * amp; b.thighR.rotation.x = Math.sin(ph) * amp;
    b.shinL.rotation.x = Math.max(0, Math.sin(ph - 1.2)) * amp * 1.5 + moving * 0.1;
    b.shinR.rotation.x = Math.max(0, -Math.sin(ph - 1.2)) * amp * 1.5 + moving * 0.1;
    b.hips.position.y = r.hips.y - Math.abs(Math.cos(ph)) * 0.04 * moving - moving * 0.03;
    b.hips.rotation.y = Math.sin(ph) * 0.12 * moving;
    b.spine.rotation.y = -Math.sin(ph) * 0.1 * moving;
    b.spine.rotation.x = moving * 0.08 + this.flinch;
    b.chest.rotation.x = -this.aimPitch * 0.8;
    b.neck.rotation.x = -this.aimPitch * 0.2;
    this.flinch *= Math.max(0, 1 - dt * 8);
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0, this.yaw, 0);
  }

  animateDeath(dt) {
    if (this.deathT > 3) return;
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.7);
    const e = t * t;
    const b = this.bones;
    b.shinL.rotation.x = b.shinR.rotation.x = e * 1.1;
    b.thighL.rotation.x = b.thighR.rotation.x = -e * 0.5;
    b.spine.rotation.x = -e * 0.3;
    this.obj.rotation.set(-e * 1.45 * this.fallDir, this.yaw, 0, 'YXZ');
    this.obj.position.set(this.pos.x, this.pos.y + Math.sin(e * Math.PI) * 0.15, this.pos.z);
    if (this.deathT > 0.4 && this.rifle.visible && this.rifle.parent === this.bones.chest) { /* keep rifle attached */ }
  }

  // ray hit test against head sphere + torso/leg capsules
  updateHitboxes() {
    this.obj.updateMatrixWorld(true);
    this.bones.head.getWorldPosition(this.head); this.head.y += 0.1;
    this.bones.neck.getWorldPosition(this.neck);
    this.bones.hips.getWorldPosition(this.hip);
    this.foot.set(this.pos.x, this.pos.y + 0.15, this.pos.z);
  }
  raycast(o, d) {
    if (!this.alive) return null;
    let best = null;
    const th = raySphere(o, d, this.head, 0.16); if (th !== null) best = { t: th, part: 'head' };
    const tt = rayCapsule(o, d, this.hip, this.neck, 0.25); if (tt !== null && (!best || tt < best.t - 0.02)) best = { t: tt, part: 'body' };
    const tl = rayCapsule(o, d, this.foot, this.hip.clone().add(V(0, -0.1, 0)), 0.2); if (tl !== null && (!best || tl < best.t)) best = { t: tl, part: 'leg' };
    return best;
  }

  takeDamage(amount, part, fromDir, game) {
    this.health -= amount;
    this.alertTimer = 4; this.state = 'combat'; this.lastSeen = game.player.pos.clone(); this.seenTimer = 3;
    this.reaction = Math.max(this.reaction, 0.3);
    this.flinch = part === 'head' ? -0.4 : -0.25;
    if (this.health <= 0) {
      this.alive = false; this.health = 0;
      const local = fromDir.clone().applyAxisAngle(V(0, 1, 0), -this.yaw);
      this.fallDir = local.z > 0 ? -1 : 1;
      this.flash.visible = false;
      return true;
    }
    return false;
  }

  dispose() { this.world.scene.remove(this.obj); }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
