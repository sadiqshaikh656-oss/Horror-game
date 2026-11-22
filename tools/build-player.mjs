// Builds the first-person-body player GLB:
//   Ch15 (Mixamo rig) + the M4 rifle taken from the SWAT export (static, under mixamorig:RightHand)
//   + Muzzle / Sight marker nodes + baked animation clips (from tools/retarget.html)
// Usage: node tools/build-player.mjs <ch15.glb> <swat_tpose.glb> <swat_grip.json> <ch15_grip.json> <keys.json> <out.glb>
//   swat_grip.json : {rifleInHand}  rifle placement inside the SWAT RightHand (cm-scaled hand space)
//   ch15_grip.json : {rifleInHand}  rifle placement inside the Ch15 RightHand (metres)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import fs from 'fs';

const [CH15, SWAT, SWAT_GRIP, CH15_GRIP, KEYS, OUT] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(CH15);
const swat = await io.read(SWAT);
const root = doc.getRoot();
const M4 = (a) => new THREE.Matrix4().fromArray(a);

// --- rifle meshes from the SWAT export, converted to rifle-node space
const sSkin = swat.getRoot().listSkins()[0];
const sJoints = sSkin.listJoints();
const rhIdx = sJoints.findIndex(j => j.getName() === 'mixamorig:RightHand');
const handBind = M4(sSkin.getInverseBindMatrices().getElement(rhIdx, [])).invert();
const Oswat = M4(JSON.parse(fs.readFileSync(SWAT_GRIP, 'utf8')).rifleInHand);
const toRifle = handBind.clone().multiply(Oswat).invert();
const nm = new THREE.Matrix3().getNormalMatrix(toRifle);
const v = new THREE.Vector3();
const rifleNodes = swat.getRoot().listNodes().filter(n => /^Rifle_/.test(n.getName()) && n.getMesh());
for (const n of rifleNodes) for (const prim of n.getMesh().listPrimitives()) {
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TANGENT');
  for (let i = 0; i < P.getCount(); i++) {
    P.setElement(i, v.fromArray(P.getElement(i, [])).applyMatrix4(toRifle).toArray());
    if (N) N.setElement(i, v.fromArray(N.getElement(i, [])).applyMatrix3(nm).normalize().toArray());
    if (T) { const t = T.getElement(i, []); v.set(t[0], t[1], t[2]).transformDirection(toRifle); T.setElement(i, [v.x, v.y, v.z, t[3]]); }
  }
  prim.setAttribute('JOINTS_0', null); prim.setAttribute('WEIGHTS_0', null);
  n.setSkin(null);
}
// the source rifle is very dense: simplify it (rifle only) to keep first-person triangle counts phone-friendly
await MeshoptSimplifier.ready;
await swat.transform(weld());
const RATIO = +(process.env.RIFLE_RATIO || 0.3);
let before = 0, after = 0;
for (const n of rifleNodes) for (const prim of n.getMesh().listPrimitives()) {
  before += prim.getIndices().getCount() / 3;
  simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.004 });
  after += prim.getIndices().getCount() / 3;
}
console.log('rifle triangles', before, '->', after);
// keep only the rifle in the SWAT document, then merge it into Ch15
const keep = new Set(rifleNodes);
for (const s of swat.getRoot().listScenes()) for (const c of [...s.listChildren()]) s.removeChild(c);
for (const n of swat.getRoot().listNodes()) if (!keep.has(n)) n.dispose();
for (const a of swat.getRoot().listAnimations()) a.dispose();
for (const s of swat.getRoot().listSkins()) s.dispose();
for (const n of rifleNodes) { n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); swat.getRoot().listScenes()[0].addChild(n); }
await swat.transform(prune());
mergeDocuments(doc, swat);
// merged scene's nodes -> under a Rifle node in the Ch15 right hand
const hand = root.listNodes().find(n => n.getName() === 'mixamorig:RightHand');
const Och = M4(JSON.parse(fs.readFileSync(CH15_GRIP, 'utf8')).rifleInHand);
const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); Och.decompose(t, q, s);
const rifle = doc.createNode('Rifle').setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
hand.addChild(rifle);
const mainScene = root.listScenes()[0];
for (const sc of root.listScenes().slice(1)) { for (const c of [...sc.listChildren()]) { sc.removeChild(c); rifle.addChild(c); } sc.dispose(); }
rifle.addChild(doc.createNode('Muzzle').setTranslation([0, 0.41, -0.045]));
rifle.addChild(doc.createNode('Sight').setTranslation([0, 0.02, -0.118]));   // rear of the optic, on the sight line
root.setDefaultScene(mainScene);

// --- animations
const buffer = root.listBuffers()[0];
for (const b of root.listBuffers().slice(1)) { for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(buffer); b.dispose(); }
const bone = {}; for (const n of root.listNodes()) { const m = /^mixamorig:(.+)$/.exec(n.getName()); if (m) bone[m[1]] = n; }
for (const a of root.listAnimations()) a.dispose();
const data = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
for (const clip of data.clips) {
  const anim = doc.createAnimation(clip.name);
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(clip.times)).setBuffer(buffer);
  for (const k in clip.tracks) {
    if (!bone[k] || /_End$|4$/.test(k)) continue; // end bones never move
    const smp = doc.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
      .setOutput(doc.createAccessor().setType('VEC4').setArray(new Float32Array(clip.tracks[k])).setBuffer(buffer));
    anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(bone[k]).setTargetPath('rotation').setSampler(smp));
  }
  const smp = doc.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
    .setOutput(doc.createAccessor().setType('VEC3').setArray(new Float32Array(clip.hips)).setBuffer(buffer));
  anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(bone.Hips).setTargetPath('translation').setSampler(smp));
}
await io.write(OUT, doc);
console.log('wrote', OUT, data.clips.length, 'clips');
