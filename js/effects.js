// Particles, tracers, bullet-hole decals, ejected shell casings, crate debris.
import * as THREE from 'three';
import { settings } from './settings.js';

const PVERT = /* glsl */`
  attribute float aSize; attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const PFRAG = /* glsl */`
  varying vec4 vColor;
  uniform float uSoft;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = 1.0 - smoothstep(uSoft, 1.0, d);
    if (a <= 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    #include <fog_fragment>
  }`;

class Particles {
  constructor(scene, cap, additive) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4); this.size = new Float32Array(cap);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.grow = new Float32Array(cap); this.a0 = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 0.0 : 0.3 }, ...THREE.UniformsLib.fog },
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(p, v, color, alpha, size, life, grav = 0, drag = 0, grow = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b, alpha], i * 4);
    this.size[i] = size; this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.a0[i] = alpha;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); i--; continue; }
      const k = i * 3, dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.01 && this.grav[i] > 0) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.3; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5; }
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, this.life[i] / this.max[i] * 1.5);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }
  kill(i) {
    const j = --this.n; if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3); this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
    for (const a of [this.size, this.life, this.max, this.grav, this.drag, this.grow, this.a0]) a[i] = a[j];
  }
}

function holeTexture() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  let g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(5,4,3,1)'); g.addColorStop(0.18, 'rgba(10,8,6,0.95)'); g.addColorStop(0.3, 'rgba(40,34,28,0.6)'); g.addColorStop(1, 'rgba(40,34,28,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  x.strokeStyle = 'rgba(15,12,10,0.6)'; x.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, r = s * (0.2 + Math.random() * 0.25); x.beginPath(); x.moveTo(s / 2, s / 2); x.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function flashTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  x.translate(s / 2, s / 2);
  for (let i = 0; i < 6; i++) {
    x.rotate(Math.PI / 3 + (Math.random() - 0.5) * 0.3);
    const g = x.createLinearGradient(0, 0, s / 2, 0);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,170,60,0.8)'); g.addColorStop(1, 'rgba(255,90,10,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -s * 0.06); x.lineTo(s / 2 * (0.7 + Math.random() * 0.3), 0); x.lineTo(0, s * 0.06); x.fill();
  }
  const rg = x.createRadialGradient(0, 0, 0, 0, 0, s * 0.25);
  rg.addColorStop(0, 'rgba(255,255,230,1)'); rg.addColorStop(1, 'rgba(255,160,50,0)');
  x.fillStyle = rg; x.fillRect(-s / 2, -s / 2, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Effects {
  constructor(scene, prefabs) {
    this.scene = scene; this.prefabs = prefabs;
    this.add = new Particles(scene, 1200, true);
    this.alpha = new Particles(scene, 900, false);
    this.decals = []; this.decalIdx = 0;
    this.holeMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
    this.decalGeo = new THREE.PlaneGeometry(0.11, 0.11);
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true); tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 32; i++) { const m = new THREE.Mesh(tg, this.tracerMat.clone()); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, t: 0 }); }
    this.shells = []; this.debris = [];
    this.flashTex = flashTexture();
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffb060, 0, 9, 2); scene.add(l); this.lights.push({ l, t: 0 }); }
    this.tmp = new THREE.Vector3(); this.c = new THREE.Color();
  }

  get quality() { return settings.graphics.effects; }
  get decalCap() { return [24, 64, 128, 220][settings.graphics.propDetail]; }

  flashLight(pos, intensity = 10) {
    const s = this.lights.find(x => x.t <= 0) || this.lights[0];
    s.l.position.copy(pos); s.l.intensity = intensity; s.t = 0.05;
  }

  tracer(from, to, color = 0xffd28a) {
    const tr = this.tracers.find(t => t.t <= 0); if (!tr) return;
    const d = to.clone().sub(from); const len = d.length();
    tr.m.position.copy(from); tr.m.lookAt(to); tr.m.scale.set(1, 1, Math.min(len, 8));
    tr.m.userData.dir = d.normalize(); tr.m.userData.len = len; tr.m.userData.travelled = 0;
    tr.m.material.color.setHex(color); tr.m.visible = true; tr.t = len / 380 + 0.03;
  }

  impact(point, normal, surface, dirIn) {
    const q = this.quality, n = normal, P = this.add, A = this.alpha;
    const count = [3, 6, 10, 14][q];
    const rnd = () => (Math.random() - 0.5);
    if (surface === 'flesh') {
      for (let i = 0; i < count; i++) {
        const v = this.tmp.set(rnd() * 2, Math.random() * 1.5, rnd() * 2).addScaledVector(dirIn, 2.5);
        A.emit(point, v, this.c.setRGB(0.35, 0.02, 0.02), 0.9, 0.05 + Math.random() * 0.05, 0.4 + Math.random() * 0.3, 9, 1);
      }
      A.emit(point, this.tmp.set(0, 0.2, 0), this.c.setRGB(0.4, 0.05, 0.05), 0.5, 0.25, 0.35, 0, 0, 1.2);
      return;
    }
    const sparks = surface === 'metal' || surface === 'plastic';
    if (sparks) {
      for (let i = 0; i < count * 1.5; i++) {
        const v = this.tmp.set(rnd(), rnd(), rnd()).multiplyScalar(5).addScaledVector(n, 4 + Math.random() * 3);
        P.emit(point, v, this.c.setRGB(1, 0.6 + Math.random() * 0.3, 0.25), 1, 0.03 + Math.random() * 0.02, 0.15 + Math.random() * 0.25, 12, 0.5);
      }
      P.emit(point, this.tmp.set(0, 0, 0), this.c.setRGB(1, 0.8, 0.5), 1, 0.35, 0.05);
    }
    const dust = surface === 'wood' ? [0.42, 0.3, 0.18] : [0.55, 0.52, 0.47];
    for (let i = 0; i < count; i++) {
      const v = this.tmp.set(rnd(), rnd(), rnd()).multiplyScalar(1.2).addScaledVector(n, 0.8 + Math.random() * 1.2);
      A.emit(point.clone().addScaledVector(n, 0.03), v, this.c.setRGB(...dust), 0.45, 0.12 + Math.random() * 0.15, 0.6 + Math.random() * 0.8 * (q + 1) / 3, -0.15, 1.8, 0.6 + q * 0.2);
    }
    if (!sparks || surface === 'metal') for (let i = 0; i < count; i++) { // chips
      const v = this.tmp.set(rnd(), rnd(), rnd()).multiplyScalar(3).addScaledVector(n, 3);
      A.emit(point, v, this.c.setRGB(dust[0] * 0.5, dust[1] * 0.5, dust[2] * 0.5), 1, 0.025, 0.5, 14, 0.2);
    }
    this.decal(point, n);
  }

  decal(point, normal) {
    let d;
    if (this.decals.length < this.decalCap) { d = new THREE.Mesh(this.decalGeo, this.holeMat); this.scene.add(d); this.decals.push(d); }
    else { d = this.decals[this.decalIdx % this.decals.length]; this.decalIdx++; }
    while (this.decals.length > this.decalCap) this.scene.remove(this.decals.pop());
    d.position.copy(point).addScaledVector(normal, 0.004);
    d.lookAt(this.tmp.copy(point).add(normal));
    d.rotateZ(Math.random() * 6.28);
    const s = 0.7 + Math.random() * 0.6; d.scale.set(s, s, s);
  }

  muzzleSmoke(pos, dir) {
    if (this.quality < 1) return;
    for (let i = 0; i < 2 + this.quality; i++) {
      const v = this.tmp.copy(dir).multiplyScalar(0.8 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3));
      this.alpha.emit(pos, v, this.c.setRGB(0.7, 0.7, 0.7), 0.12, 0.08, 0.7 + Math.random() * 0.6, -0.3, 1.5, 0.5);
    }
  }

  shell(kind, pos, vel) {
    const p = this.prefabs.shells[kind]; if (!p) return;
    const life = [0.6, 1.5, 4, 8][settings.graphics.propDetail];
    let s = this.shells.find(x => x.life <= 0);
    if (!s) { if (this.shells.length > 40) return; s = { m: new THREE.Mesh(p.geo, p.mat), v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }; this.scene.add(s.m); this.shells.push(s); }
    s.m.geometry = p.geo; s.m.material = p.mat; s.m.visible = true; s.m.castShadow = settings.graphics.propDetail >= 2;
    s.m.position.copy(pos); s.v.copy(vel); s.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20); s.life = life; s.bounces = 0;
  }

  debrisBurst(mesh, impulseDir) {
    const pcs = this.prefabs.cratePieces; if (!pcs.length) return;
    for (const p of pcs) {
      const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true;
      m.position.copy(mesh.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6));
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(m);
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5).addScaledVector(impulseDir, 3);
      this.debris.push({ m, v, w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), life: 6 });
    }
    for (let i = 0; i < 25; i++) this.alpha.emit(mesh.position.clone().setY(0.6), new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), this.c.setRGB(0.45, 0.33, 0.2), 0.5, 0.3, 1.2, 0, 1.5, 0.8);
  }

  update(dt, camera) {
    this.add.points.material.uniforms.uScale.value = this.alpha.points.material.uniforms.uScale.value = window.innerHeight * 0.9;
    this.add.update(dt); this.alpha.update(dt);
    for (const t of this.tracers) {
      if (t.t <= 0) continue;
      t.t -= dt;
      const ud = t.m.userData; ud.travelled += 380 * dt;
      const remain = ud.len - ud.travelled;
      if (t.t <= 0 || remain <= 0) { t.m.visible = false; t.t = 0; continue; }
      t.m.position.addScaledVector(ud.dir, 380 * dt);
      t.m.scale.z = Math.min(8, remain);
    }
    for (const l of this.lights) { if (l.t > 0) { l.t -= dt; if (l.t <= 0) l.l.intensity = 0; } }
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt; if (s.life <= 0) { s.m.visible = false; continue; }
      s.v.y -= 9.8 * dt; s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      if (s.m.position.y < 0.01) { s.m.position.y = 0.01; s.v.y *= -0.35; s.v.x *= 0.6; s.v.z *= 0.6; s.w.multiplyScalar(0.5); s.bounces++; if (s.bounces > 3) s.v.set(0, 0, 0); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.life -= dt;
      d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.1) { d.m.position.y = 0.1; d.v.multiplyScalar(0.4); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.5); }
      d.m.rotation.x += d.w.x * dt; d.m.rotation.z += d.w.z * dt;
      if (d.life < 1) d.m.scale.setScalar(Math.max(0.01, d.life));
      if (d.life <= 0) { this.scene.remove(d.m); this.debris.splice(i, 1); }
    }
  }
}
