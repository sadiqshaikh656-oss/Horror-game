// Converts the SWAT Operator GLB into a retarget-ready T-pose GLB (Mixamo bone names):
//  * arms raised to a true T-pose, legs straightened; mesh re-baked so the new rest pose = bind pose
//  * the rifle (and the two cloth patches) become skinned meshes weighted 100% to their bones
//    (rifle -> mixamorig:RightHand), using the exact grip from the artist's original animation,
//    so any retargeted animation keeps the gun in the hand
//  * fingers keep the gripping curl from that same pose (no straight-finger pop around the grip)
//  * mixamorig:Hips is the skeleton root, joint names are exactly Mixamo's, animation removed
//  * textures untouched (full quality)
// Usage: node tools/swat-tpose.mjs <in.glb> <out.glb>   (needs @gltf-transform/core, /extensions, three)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const [IN, OUT] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const ibmAcc = skin.getInverseBindMatrices();
const M4 = () => new THREE.Matrix4();
const short = (n) => (/mixamorig:(.+?)_\d+$/.exec(n) || [])[1];
const J = {}; joints.forEach((j, i) => { const k = short(j.getName()); if (k) J[k] = { node: j, i }; });
const jointSet = new Set(joints);
const parentOf = (n) => n.getParentNode();

// ---------- 1. pose from the original animation's first frame (rifle gripped) ----------
const anim = root.listAnimations()[0];
const animTRS = new Map(); // node -> {t,r,s}
for (const ch of anim.listChannels()) {
  const n = ch.getTargetNode(), path = ch.getTargetPath(), out = ch.getSampler().getOutput();
  if (!animTRS.has(n)) animTRS.set(n, {});
  animTRS.get(n)[path] = out.getElement(0, []);
}
const localAnim = (n) => {
  const a = animTRS.get(n) || {};
  return M4().compose(new THREE.Vector3(...(a.translation || n.getTranslation())), new THREE.Quaternion(...(a.rotation || n.getRotation())), new THREE.Vector3(...(a.scale || n.getScale())));
};
const worldAnim = (n) => { const m = localAnim(n); let p = parentOf(n); while (p) { m.premultiply(localAnim(p)); p = parentOf(p); } return m; };
const rifleNode = root.listNodes().find(n => n.getName() === 'part_2_low_101');
const rifleInHand = worldAnim(J.RightHand.node).invert().multiply(worldAnim(rifleNode));
const extras = [['Circle_102', null], ['Plane_103', 'Spine2']].map(([name, bone]) => ({ node: root.listNodes().find(n => n.getName() === name), bone }));
for (const e of extras) {
  if (!e.node) continue;
  if (!e.bone) { // nearest upper-arm / shoulder bone
    const p = new THREE.Vector3().setFromMatrixPosition(worldAnim(e.node)); let bd = 1e9;
    for (const k of ['LeftArm', 'RightArm', 'LeftShoulder', 'RightShoulder', 'Spine2']) { const d = new THREE.Vector3().setFromMatrixPosition(worldAnim(J[k].node)).distanceTo(p); if (d < bd) { bd = d; e.bone = k; } }
  }
  e.inBone = worldAnim(J[e.bone].node).invert().multiply(worldAnim(e.node));
}

// ---------- 2. bind pose world matrices and local (parent-relative) matrices ----------
const bindW = new Map(); joints.forEach((j, i) => bindW.set(j, M4().fromArray(ibmAcc.getElement(i, [])).invert()));
const nodeWorld = (n) => { const m = M4().fromArray(n.getWorldMatrix()); return m; };
const parentBindW = (j) => { const p = parentOf(j); return jointSet.has(p) ? bindW.get(p) : nodeWorld(p); };
const local = new Map(); for (const j of joints) local.set(j, parentBindW(j).clone().invert().multiply(bindW.get(j)));

// fingers: take the gripping rotation from the animation pose (keep bind bone lengths)
for (const k in J) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(k)) {
  const n = J[k].node, L = local.get(n);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); L.decompose(t, q, s);
  const a = new THREE.Quaternion(); localAnim(n).decompose(new THREE.Vector3(), a, new THREE.Vector3());
  local.set(n, M4().compose(t, a, s));
}

// ---------- 3. T-pose: rotate chains so bones point along world axes ----------
const W = new Map();
const computeW = () => { const rec = (j) => { W.set(j, (jointSet.has(parentOf(j)) ? W.get(parentOf(j)) : nodeWorld(parentOf(j))).clone().multiply(local.get(j))); for (const c of j.listChildren()) if (jointSet.has(c)) rec(c); }; rec(J.Hips ? joints[0] : joints[0]); };
computeW();
const pos = (k) => new THREE.Vector3().setFromMatrixPosition(W.get(J[k].node));
const aimBone = (k, childK, target) => {
  computeW();
  const n = J[k].node, from = pos(childK).sub(pos(k)).normalize();
  const dq = new THREE.Quaternion().setFromUnitVectors(from, target.clone().normalize());
  const Wj = W.get(n), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); Wj.decompose(t, q, s);
  const newW = M4().compose(t, dq.multiply(q), s);
  const pW = jointSet.has(parentOf(n)) ? W.get(parentOf(n)) : nodeWorld(parentOf(n));
  local.set(n, pW.clone().invert().multiply(newW));
};
const X = new THREE.Vector3(1, 0, 0), DOWN = new THREE.Vector3(0, -1, 0);
for (const [side, sx] of [['Left', 1], ['Right', -1]]) {
  aimBone(side + 'Arm', side + 'ForeArm', X.clone().multiplyScalar(sx));
  aimBone(side + 'ForeArm', side + 'Hand', X.clone().multiplyScalar(sx));
  aimBone(side + 'Hand', side + 'HandMiddle1', X.clone().multiplyScalar(sx));
  aimBone(side + 'UpLeg', side + 'Leg', new THREE.Vector3(0.06 * sx, -1, 0));
  aimBone(side + 'Leg', side + 'Foot', DOWN);
}
computeW();

// ---------- 4. re-bake skinned vertices into the T-pose ----------
const skinMats = joints.map((j, i) => W.get(j).clone().multiply(M4().fromArray(ibmAcc.getElement(i, []))));
const done = new Set();
const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmpM = M4(), nm = new THREE.Matrix3();
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const Ja = prim.getAttribute('JOINTS_0'), Wa = prim.getAttribute('WEIGHTS_0'); if (!Ja) continue;
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TANGENT');
  if (done.has(P)) continue; done.add(P);
  for (let i = 0; i < P.getCount(); i++) {
    const jj = Ja.getElement(i, []), ww = Wa.getElement(i, []);
    tmpM.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let sum = 0;
    for (let k = 0; k < 4; k++) if (ww[k] > 0) { sum += ww[k]; const e = skinMats[jj[k]].elements; for (let q = 0; q < 16; q++) tmpM.elements[q] += e[q] * ww[k]; }
    if (sum > 0 && Math.abs(sum - 1) > 1e-4) for (let q = 0; q < 16; q++) tmpM.elements[q] /= sum;
    P.setElement(i, v.fromArray(P.getElement(i, [])).applyMatrix4(tmpM).toArray());
    nm.getNormalMatrix(tmpM);
    if (N) N.setElement(i, v.fromArray(N.getElement(i, [])).applyMatrix3(nm).normalize().toArray());
    if (T) { const t4 = T.getElement(i, []); v.set(t4[0], t4[1], t4[2]).transformDirection(tmpM); T.setElement(i, [v.x, v.y, v.z, t4[3]]); }
  }
}

// ---------- 5. rigid parts -> skinned to one bone ----------
const skinnedParent = root.listNodes().find(n => n.getMesh() && n.getSkin()).getParentNode();
const bufferOf = root.listBuffers()[0];
const makeRigidSkinned = (meshNode, boneKey, worldNow) => {
  const mesh = meshNode.getMesh();
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TANGENT');
    nm.getNormalMatrix(worldNow);
    for (let i = 0; i < P.getCount(); i++) {
      P.setElement(i, v.fromArray(P.getElement(i, [])).applyMatrix4(worldNow).toArray());
      if (N) N.setElement(i, v.fromArray(N.getElement(i, [])).applyMatrix3(nm).normalize().toArray());
      if (T) { const t4 = T.getElement(i, []); v.set(t4[0], t4[1], t4[2]).transformDirection(worldNow); T.setElement(i, [v.x, v.y, v.z, t4[3]]); }
    }
    const n = P.getCount(), ji = new Uint16Array(n * 4), wi = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { ji[i * 4] = J[boneKey].i; wi[i * 4] = 1; }
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(ji).setBuffer(bufferOf));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(wi).setBuffer(bufferOf));
  }
  meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  meshNode.getParentNode().removeChild(meshNode);
  skinnedParent.addChild(meshNode);
  meshNode.setSkin(skin);
};
const rifleW = W.get(J.RightHand.node).clone().multiply(rifleInHand);
for (const c of [...rifleNode.listChildren()]) {
  const name = { Object_142: 'Rifle_Receiver_Magazine', Object_143: 'Rifle_Upper', Object_144: 'Rifle_Stock', Object_145: 'Rifle_Barrel_Handguard', Object_146: 'Rifle_Optic' }[c.getName()] || 'Rifle_Part';
  makeRigidSkinned(c, 'RightHand', rifleW.clone().multiply(M4().compose(new THREE.Vector3(...c.getTranslation()), new THREE.Quaternion(...c.getRotation()), new THREE.Vector3(...c.getScale()))));
  c.setName(name); c.getMesh().setName(name);
}
rifleNode.dispose();
for (const e of extras) {
  if (!e.node) continue;
  const w = W.get(J[e.bone].node).clone().multiply(e.inBone);
  for (const c of [...e.node.listChildren()]) { makeRigidSkinned(c, e.bone, w.clone().multiply(M4().compose(new THREE.Vector3(...c.getTranslation()), new THREE.Quaternion(...c.getRotation()), new THREE.Vector3(...c.getScale())))); c.setName('Patch_' + e.bone); }
  e.node.dispose();
}

// ---------- 6. write rest pose, inverse binds, Mixamo names; drop the old root joint ----------
for (const j of joints) {
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); local.get(j).decompose(t, q, s);
  j.setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
}
const rootJoint = joints[0];
// remove root joint from the skin: shift joint indices down by one (no vertex uses it)
const newJoints = joints.slice(1);
const ibmArr = new Float32Array(newJoints.length * 16);
newJoints.forEach((j, i) => ibmArr.set(W.get(j).clone().invert().elements, i * 16));
for (const j of joints) skin.removeJoint(j);
for (const j of newJoints) skin.addJoint(j);
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibmArr).setBuffer(bufferOf));
skin.setSkeleton(J.Hips.node);
const remapped = new Set();
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const Ja = prim.getAttribute('JOINTS_0'); if (!Ja || remapped.has(Ja)) continue; remapped.add(Ja);
  const n = Ja.getCount(), arr = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) { const e = Ja.getElement(i, []); for (let k = 0; k < 4; k++) arr[i * 4 + k] = Math.max(0, e[k] - 1); }
  Ja.setArray(arr);
}
rootJoint.setName('Armature');
for (const j of newJoints) j.setName('mixamorig:' + short(j.getName()));
for (const a of root.listAnimations()) a.dispose();
skin.setName('Armature');
await io.write(OUT, doc);
// optional: export the artist's original "rifle held" pose as world rotations (for verification)
if (process.argv[4]) {
  const pose = {};
  for (const j of newJoints) { const q = new THREE.Quaternion(); worldAnim(j).decompose(new THREE.Vector3(), q, new THREE.Vector3()); pose[j.getName()] = q.toArray(); }
  (await import('fs')).writeFileSync(process.argv[4], JSON.stringify(pose));
}
console.log('wrote', OUT, 'joints', newJoints.length);
