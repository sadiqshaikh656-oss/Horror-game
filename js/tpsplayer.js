// Third-person player: Michael (GTA-style SKEL_* rig) holding the MP5.
//
// Michael's model ships without animations, so he is driven by the FPSBody rig (Ch15 + 43 Mixamo clips,
// kept invisible). Each frame the Ch15 pose is copied onto Michael with a rest-relative world-space
// retarget: Michael's rest pose is first aligned to Ch15's T-pose bone by bone, after which
//   michaelWorld = ch15World * inverse(ch15Rest) * michaelRestAligned
// gives the same motion on the other skeleton (fingers included, so his right hand closes on the grip).
//
// The MP5 is parented to Michael's right hand. Its grip offset is measured once from the aim-idle pose:
// the barrel takes the M4's direction, and the pistol grip sits in the centre of the closed fist. The
// left hand is locked to the MP5 handguard with two-bone IK (released during reloads).
import * as THREE from 'three';
import { FPSBody } from './fpsbody.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();

// Mixamo (Ch15) -> GTA (Michael) bone map; Spine2 drives Michael's top spine joint (Spine3)
const MAP = {
  Hips: 'SKEL_Pelvis', Spine: 'SKEL_Spine0', Spine1: 'SKEL_Spine1', Spine2: 'SKEL_Spine3',
  Neck: 'SKEL_Neck_1', Head: 'SKEL_Head',
  LeftUpLeg: 'SKEL_L_Thigh', LeftLeg: 'SKEL_L_Calf', LeftFoot: 'SKEL_L_Foot', LeftToeBase: 'SKEL_L_Toe0',
  RightUpLeg: 'SKEL_R_Thigh', RightLeg: 'SKEL_R_Calf', RightFoot: 'SKEL_R_Foot', RightToeBase: 'SKEL_R_Toe0',
};
for (const [m, g] of [['Left', 'L'], ['Right', 'R']]) {
  Object.assign(MAP, {
    [m + 'Shoulder']: `SKEL_${g}_Clavicle`, [m + 'Arm']: `SKEL_${g}_UpperArm`, [m + 'ForeArm']: `SKEL_${g}_Forearm`, [m + 'Hand']: `SKEL_${g}_Hand`,
  });
  ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach((f, fi) => {
    for (let k = 1; k <= 3; k++) MAP[`${m}Hand${f}${k}`] = `SKEL_${g}_Finger${fi}${k - 1}`;
  });
}
// child used to measure each bone's direction when aligning the rest poses
const DIR_CHILD = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};
for (const m of ['Left', 'Right']) {
  Object.assign(DIR_CHILD, { [m + 'Shoulder']: m + 'Arm', [m + 'Arm']: m + 'ForeArm', [m + 'ForeArm']: m + 'Hand', [m + 'Hand']: m + 'HandMiddle1' });
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) { DIR_CHILD[`${m}Hand${f}1`] = `${m}Hand${f}2`; DIR_CHILD[`${m}Hand${f}2`] = `${m}Hand${f}3`; }
}
const ORDER = Object.keys(MAP); // parents are listed before children
const Z_AXIS = V(0, 0, 1);
const LEFT_CURL = [0.25, 0.45, 0.35]; // extra curl (rad) per finger segment for the handguard wrap

// MP5 frame (assets/models/mp5.glb, node MP5_Root): origin = pistol-grip centre, +X barrel, +Y up, metres
const MP5 = {
  muzzle: V(0.405, 0.115, 0),
  handguard: V(0.262, 0.095, 0),   // centre of the handguard (left fist goes here)
  ejection: V(0.03, 0.13, 0.02),
};

export class TPSPlayer {
  constructor(assets, scene, flashTex) {
    // invisible animation source
    this.src = new FPSBody(assets.player, scene, flashTex);
    this.src.root.visible = false;
    this.src.flash.visible = false;
    // Michael
    this.root = assets.michael.scene;
    this.holder = new THREE.Group(); this.holder.add(this.root); scene.add(this.holder);
    this.root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isCamera || o.isLight) o.visible = false;
    });
    // shirt and jacket are skinned separately: keep the shirt behind the jacket in depth and draw the jacket
    // front faces only (its inner faces showed through as dark patches when the spine bends)
    this.root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      if (o.name === 'Object_367') { const m = o.material.clone(); m.side = THREE.FrontSide; o.material = m; } // jacket: its inner back-faces showed as dark patches
      else if (o.name === 'Object_366') { const m = o.material.clone(); m.polygonOffset = true; m.polygonOffsetFactor = 6; m.polygonOffsetUnits = 6; o.material = m; } // shirt
    });
    this.G = {}; // GTA bones by base name (SKEL_L_Hand_059 -> SKEL_L_Hand)
    this.root.traverse(o => { if (o.isBone || /^(SKEL|RB|CLOTH)_?/.test(o.name)) { const n = o.name.replace(/_\d+$/, ''); if (!this.G[n]) this.G[n] = o; } });
    this.bones = ORDER.map(m => ({ m, s: this.src.B[m], t: this.G[MAP[m]] })).filter(b => b.s && b.t);
    this.rolls = ['L', 'R'].map(g => [this.G[`RB_${g}_ThighRoll`], this.G[`SKEL_${g}_Thigh`]]).filter(r => r[0] && r[1]);
    for (const [roll] of this.rolls) roll.userData.rest = roll.quaternion.clone();
    // MP5
    this.gun = assets.mp5.scene.getObjectByName('MP5_Root') || assets.mp5.scene;
    this.gun.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.muzzle = new THREE.Object3D(); this.muzzle.position.copy(MP5.muzzle); this.gun.add(this.muzzle);
    this.leftGripPt = new THREE.Object3D(); this.leftGripPt.position.copy(MP5.handguard); this.gun.add(this.leftGripPt);
    // own muzzle flash (the FPSBody one sits on the hidden M4)
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.visible = false; this.flashT = 0; scene.add(this.flash);
    this.bind();
  }

  // ---------- one-time setup: align rest poses, then measure the MP5 grip
  bind() {
    const S = this.src;
    this.holder.position.set(0, 0, 0); this.holder.rotation.set(0, 0, 0);
    S.holder.position.set(0, 0, 0); S.holder.rotation.set(0, 0, 0);
    S.poseOnly(null);
    this.holder.updateMatrixWorld(true);
    // scale for the hips (Michael's leg length vs Ch15's)
    const hS = S.B.Hips.getWorldPosition(V()).y, hT = this.G.SKEL_Pelvis.getWorldPosition(V()).y;
    this.hipScale = hT / hS;
    // align each mapped Michael bone so it points the same way as the Ch15 bone in rest (T-pose)
    for (const b of this.bones) {
      const c = DIR_CHILD[b.m]; if (!c || !S.B[c] || !this.G[MAP[c]]) continue;
      const sd = S.B[c].getWorldPosition(V()).sub(b.s.getWorldPosition(V())).normalize();
      const td = this.G[MAP[c]].getWorldPosition(V()).sub(b.t.getWorldPosition(V())).normalize();
      let rot = Q().setFromUnitVectors(td, sd);
      // hands: also match the palm plane (index -> pinky knuckles) so the grip roll is right
      if (/Hand$/.test(b.m)) {
        const side = b.m.replace('Hand', '');
        const sAcross = S.B[side + 'HandPinky1'].getWorldPosition(V()).sub(S.B[side + 'HandIndex1'].getWorldPosition(V()));
        const tAcross = this.G[MAP[side + 'HandPinky1']].getWorldPosition(V()).sub(this.G[MAP[side + 'HandIndex1']].getWorldPosition(V())).applyQuaternion(rot);
        const proj = (v) => v.sub(sd.clone().multiplyScalar(v.dot(sd))).normalize();
        rot = Q().setFromUnitVectors(proj(tAcross), proj(sAcross)).multiply(rot);
      }
      setWorldQuat(b.t, rot.multiply(b.t.getWorldQuaternion(Q())));
    }
    this.root.updateMatrixWorld(true);
    for (const b of this.bones) { b.sRest = b.s.getWorldQuaternion(Q()); b.tRest = b.t.getWorldQuaternion(Q()); }
    this.spineRestQ = this.G.SKEL_Spine0.getWorldQuaternion(Q());
    { const rb = this.G.SKEL_ROOT || this.G.SKEL_Pelvis; this.pelvisOff = this.G.SKEL_Pelvis.getWorldPosition(V()).sub(rb.getWorldPosition(V())); }
    this.cloth = this.G.CLOTH || null;
    if (this.cloth) this.clothRest = this.cloth.getWorldQuaternion(Q());
    // ---- MP5 in the right hand, measured in the aim-idle pose
    S.poseOnly('aim_idle', 0);
    this.retarget();
    const hand = this.G.SKEL_R_Hand;
    const rifleQ = S.rifle.getWorldQuaternion(Q());
    const barrel = V(0, 1, 0).applyQuaternion(rifleQ), up = V(0, 0, -1).applyQuaternion(rifleQ);
    // MP5 +X = M4 barrel (+Y), MP5 +Y = M4 top (-Z)
    const z = V().crossVectors(barrel, up).normalize(), y = V().crossVectors(z, barrel).normalize();
    const gunQ = Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(barrel, y, z));
    // pistol grip in the middle of the fist: between the palm knuckles and the wrist, pushed into the curl
    const P = (n) => this.G[n].getWorldPosition(V());
    const knuckles = P('SKEL_R_Finger10').add(P('SKEL_R_Finger20')).add(P('SKEL_R_Finger30')).add(P('SKEL_R_Finger40')).multiplyScalar(0.25);
    const tips = P('SKEL_R_Finger12').add(P('SKEL_R_Finger22')).add(P('SKEL_R_Finger32')).multiplyScalar(1 / 3);
    const wrist = P('SKEL_R_Hand');
    const fist = knuckles.clone().lerp(wrist, 0.3).lerp(tips, 0.35);
    const gunM = new THREE.Matrix4().compose(fist, gunQ, V(1, 1, 1));
    hand.updateMatrixWorld(true);
    const local = hand.matrixWorld.clone().invert().multiply(gunM);
    local.decompose(this.gun.position, this.gun.quaternion, this.gun.scale);
    hand.add(this.gun);
    this.root.updateMatrixWorld(true);
    // left hand: its pose relative to the gun, taken from where Ch15's left hand sits on the M4 handguard
    // (orientation only; position comes from the MP5 handguard point)
    S.poseOnly(null);
  }

  // copy the current Ch15 pose onto Michael (world-space, rest-relative)
  retarget() {
    const S = this.src;
    // Michael follows the hidden body's placement
    this.holder.position.copy(S.holder.position); this.holder.quaternion.copy(S.holder.quaternion);
    this.holder.updateMatrixWorld(true);
    const sInv = S.holder.getWorldQuaternion(Q()).invert(), tQ = this.holder.getWorldQuaternion(Q());
    for (const b of this.bones) {
      // rest values were captured with both holders at identity: work in holder space
      const sq = sInv.clone().multiply(b.s.getWorldQuaternion(Q()));
      const tq = tQ.clone().multiply(sq.multiply(b.sRest.clone().invert()).multiply(b.tRest));
      setWorldQuat(b.t, tq);
    }
    // hips height / bob (scaled to Michael's proportions)
    const sh = S.B.Hips.getWorldPosition(V()).sub(S.holder.position).multiplyScalar(this.hipScale).add(this.holder.position);
    // GTA thigh-roll helpers hang off the pelvis (not the thigh), so they don't follow the leg on
    // their own; without this the jacket hem stays in rest pose and sticks out when crouching
    for (const [roll, thigh] of this.rolls) roll.quaternion.copy(roll.userData.rest).slerp(thigh.quaternion, 0.7);
    // pelvis and spine root are siblings under SKEL_ROOT: move that root so the torso and the cloth
    // bone follow the hips (before this the legs crouched while the spine stayed at standing height)
    const rootB = this.G.SKEL_ROOT || this.G.SKEL_Pelvis;
    rootB.parent.updateMatrixWorld(true);
    rootB.position.copy(rootB.parent.worldToLocal(sh.clone().sub(this.pelvisOff)));
    this.root.updateMatrixWorld(true);
    // jacket hem: the CLOTH bone was cloth-simulated in the original. Let it follow the lower spine
    // part-way so the jacket neither stays rigid-upright (folds/dark creases at the back) nor swings
    if (this.cloth) {
      const k = this.clothW ?? 0.55, sp = this.G.SKEL_Spine0, rest = this.spineRestQ;
      const follow = sp.getWorldQuaternion(Q()).multiply(rest.clone().invert()).multiply(this.clothRest);
      setWorldQuat(this.cloth, tQ.clone().multiply(this.clothRest).slerp(follow, k));
    }
    this.root.updateMatrixWorld(true);
  }

  // ---------- API used by main.js (same shape as FPSBody)
  get rifle() { return this.gun; }
  muzzleWorld() { return this.muzzle.getWorldPosition(V()); }
  barrelWorld() { return V(1, 0, 0).applyQuaternion(this.gun.getWorldQuaternion(Q())).normalize(); }
  setHead() { }
  onShot() {
    this.src.recoil = Math.min(1, this.src.recoil + 0.5); this.src.calmT = 0;
    this.flash.position.copy(this.muzzleWorld());
    this.flash.quaternion.copy(this.gun.getWorldQuaternion(Q())).multiply(Q().setFromAxisAngle(V(0, 1, 0), Math.PI / 2));
    this.flash.rotateZ(Math.random() * 6); this.flash.scale.setScalar(0.7 + Math.random() * 0.5);
    this.flash.visible = true; this.flashT = 0.04;
  }

  update(dt, s) {
    this.src.update(dt, { ...s, ads: 0 }); // TPS aims over the shoulder; the body keeps its hip-aim pose
    this.src.flash.visible = false;
    this.retarget();
    if (!this.src.deathName) this.leftHandIK(1 - this.src.w.reload);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }

  // left fist on the MP5 handguard: keep the retargeted hand orientation, move the wrist so the fist
  // centre lands on the handguard, then solve the arm
  leftHandIK(w) {
    if (w < 0.02) return;
    const G = this.G, hand = G.SKEL_L_Hand;
    const P = (n) => G[n].getWorldPosition(V());
    this.gun.updateMatrixWorld(true);
    const target = this.leftGripPt.getWorldPosition(V());
    const fist = P('SKEL_L_Finger10').add(P('SKEL_L_Finger40')).multiplyScalar(0.5).lerp(P('SKEL_L_Hand'), 0.3);
    const tips = P('SKEL_L_Finger12').add(P('SKEL_L_Finger32')).multiplyScalar(0.5);
    fist.lerp(tips, 0.3);
    const wristT = target.sub(fist.sub(P('SKEL_L_Hand')));
    const hq = hand.getWorldQuaternion(Q());
    const right = V(1, 0, 0).applyQuaternion(this.holder.quaternion);
    solveArm(G.SKEL_L_UpperArm, G.SKEL_L_Forearm, hand, wristT, hq, V(0, -1, 0).addScaledVector(right, 0.6), w);
    // close the support-hand fingers around the handguard (GTA finger joints bend about local Z)
    for (let f = 1; f <= 4; f++) for (let k = 0; k < 3; k++) {
      const b = G[`SKEL_L_Finger${f}${k}`]; if (!b) continue;
      b.quaternion.multiply(Q().setFromAxisAngle(Z_AXIS, -LEFT_CURL[k] * w));
    }
    hand.updateMatrixWorld(true);
  }

  // ---------- over-the-shoulder camera (right shoulder), pulled in by walls; closer while aiming
  updateCamera(dt, P, camera, ads, alive, world) {
    if (!alive && this.src.deathName) { // death cam: slow orbit above the body
      this.root.visible = true;
      const h = this.G.SKEL_Pelvis.getWorldPosition(V());
      const a = P.yaw + this.src.deathT * 0.25;
      camera.position.set(h.x + Math.sin(a) * 3, h.y + 2, h.z + Math.cos(a) * 3);
      camera.lookAt(h); camera.updateMatrixWorld(); return;
    }
    const sh = P.shake;
    camera.rotation.set(P.pitch + (Math.random() - 0.5) * sh * 0.02, P.yaw + (Math.random() - 0.5) * sh * 0.02, 0, 'YXZ');
    camera.updateMatrixWorld();
    const qc = camera.quaternion;
    const right = V(1, 0, 0).applyQuaternion(qc), back = V(0, 0, 1).applyQuaternion(qc);
    // pivot just above the head, following the (smoothed) collision capsule
    const pivot = V(P.pos.x, P.pos.y + P.eye + 0.12, P.pos.z);
    if (!this.pivotS) this.pivotS = pivot.clone();
    this.pivotS.x = pivot.x; this.pivotS.z = pivot.z; this.pivotS.y += (pivot.y - this.pivotS.y) * (1 - Math.exp(-dt * 12));
    const side = THREE.MathUtils.lerp(0.72, 0.62, ads), dist = THREE.MathUtils.lerp(2.6, 1.3, ads), lift = THREE.MathUtils.lerp(0.22, 0.1, ads);
    // shoulder point (wall check sideways), then boom back (wall check behind)
    let sideLen = side;
    const hs = world.raycast(this.pivotS, right, side + 0.25);
    if (hs) sideLen = Math.max(0, hs.dist - 0.25);
    const shoulder = this.pivotS.clone().addScaledVector(right, sideLen); shoulder.y += lift;
    let want = dist;
    const hb = world.raycast(shoulder, back, dist + 0.25);
    if (hb) want = Math.max(0.15, hb.dist - 0.25);
    // snap in instantly when blocked, ease back out
    this.boom = this.boom == null ? want : (want < this.boom ? want : this.boom + (want - this.boom) * (1 - Math.exp(-dt * 5)));
    camera.position.copy(shoulder).addScaledVector(back, this.boom);
    camera.updateMatrixWorld();
    // hide the body when the camera is pressed right into it
    this.root.visible = this.boom > 0.45;
    this.gun.visible = true;
  }

  get deathName() { return this.src.deathName; }
  get deathT() { return this.src.deathT; }
}

function setWorldQuat(b, qw) {
  const pw = b.parent.getWorldQuaternion(Q());
  b.quaternion.copy(pw.invert().multiply(qw));
  b.updateMatrixWorld(true);
}
function aimBone(b, from, to) { setWorldQuat(b, Q().setFromUnitVectors(from, to).multiply(b.getWorldQuaternion(Q()))); }

function solveArm(up, lo, hd, tp, tq, pole, weight = 1) {
  const keep = weight < 0.999 ? [up.quaternion.clone(), lo.quaternion.clone(), hd.quaternion.clone()] : null;
  const a = up.getWorldPosition(V()), b = lo.getWorldPosition(V()), c = hd.getWorldPosition(V());
  const la = a.distanceTo(b), lb = b.distanceTo(c); const toT = tp.clone().sub(a);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-4, la + lb - 1e-4); const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const e = a.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * Math.sqrt(1 - cosA * cosA));
  aimBone(up, b.clone().sub(a).normalize(), e.clone().sub(a).normalize());
  const b2 = lo.getWorldPosition(V()), c2 = hd.getWorldPosition(V());
  aimBone(lo, c2.clone().sub(b2).normalize(), a.clone().addScaledVector(dir, d).sub(b2).normalize());
  if (tq) setWorldQuat(hd, tq);
  if (keep) {
    up.quaternion.copy(keep[0].slerp(up.quaternion, weight)); lo.quaternion.copy(keep[1].slerp(lo.quaternion, weight)); hd.quaternion.copy(keep[2].slerp(hd.quaternion, weight));
    up.updateMatrixWorld(true);
  }
}
