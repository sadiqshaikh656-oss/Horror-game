// Builds dist/ironyard.html: one self-contained file (code + three.js + models inlined).
// Usage: node tools/build-single.mjs   (needs esbuild: npm i esbuild)
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const res = await build({
  entryPoints: [path.join(root, 'js/main.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
  alias: { 'three/addons': path.join(root, 'lib/three/addons'), three: path.join(root, 'lib/three/three.module.js') },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const models = {};
for (const f of fs.readdirSync(path.join(root, 'assets/models'))) {
  models[path.basename(f, '.glb')] = 'data:model/gltf-binary;base64,' + fs.readFileSync(path.join(root, 'assets/models', f)).toString('base64');
}
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n/, '')
  .replace('<link rel="manifest" href="manifest.json">\n', '')
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>',
    `<script>window.__MODELS=${JSON.stringify(models)};</script>\n<script>${js}</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/ironyard.html'), html);
console.log('dist/ironyard.html', (html.length / 1e6).toFixed(1), 'MB');
