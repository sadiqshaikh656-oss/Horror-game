// Writes baked keyframes (from tools/fixanims.html) into a rigged GLB as glTF animations.
// Usage: node tools/add-anims.mjs <rig.glb> <keys.json> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'fs';

const [RIG, KEYS, OUT] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(RIG);
const root = doc.getRoot(), buffer = root.listBuffers()[0];
const data = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
const node = {};
for (const n of root.listNodes()) { const m = /^mixamorig:(.+)$/.exec(n.getName()); if (m) node[m[1]] = n; }
for (const a of root.listAnimations()) a.dispose();
for (const clip of data.clips) {
  const anim = doc.createAnimation(clip.name);
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(clip.times)).setBuffer(buffer);
  for (const k in clip.tracks) {
    if (!node[k]) continue;
    const s = doc.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
      .setOutput(doc.createAccessor().setType('VEC4').setArray(new Float32Array(clip.tracks[k])).setBuffer(buffer));
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node[k]).setTargetPath('rotation').setSampler(s));
  }
  const s = doc.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
    .setOutput(doc.createAccessor().setType('VEC3').setArray(new Float32Array(clip.hips)).setBuffer(buffer));
  anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node.Hips).setTargetPath('translation').setSampler(s));
}
await io.write(OUT, doc);
console.log('wrote', OUT, data.clips.map(c => c.name + ' ' + c.times.length + 'f').join(', '));
