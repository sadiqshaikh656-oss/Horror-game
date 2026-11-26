// MP5 source -> game asset: drop lights/cameras/backdrop, wrap the gun in an "MP5" node whose
// origin is the centre of the pistol grip, scaled to real size (gun frame: +X barrel, +Y up, metres)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
const [IN, OUT] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot(), scene = root.listScenes()[0];
const S = 0.137;                    // 4.86 source units -> 0.665 m (MP5A3, stock extended)
const GRIP = [-0.53, -0.33, 0];      // pistol-grip centre in source units
const gun = doc.createNode('MP5').setScale([S, S, S]).setTranslation(GRIP.map(v => -v * S));
const holder = doc.createNode('MP5_Root').addChild(gun);
for (const n of [...scene.listChildren()]) {
  scene.removeChild(n);
  if (n.getMesh() && n.getName() !== '1') gun.addChild(n); else n.dispose();
}
scene.addChild(holder);
await doc.transform(prune());
await io.write(OUT, doc);
