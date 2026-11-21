// Render pipeline. World pass -> GTAO -> viewmodel pass (own FOV, cleared depth) -> bloom ->
// tone mapping (ACES) -> filmic grade (vignette, chromatic aberration, grain, lift/gamma/gain) -> AA.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { settings, gnum } from './settings.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.35 }, uGrain: { value: 0.0 },
    uCA: { value: 0.0 }, uSat: { value: 1.05 }, uContrast: { value: 1.05 }, uDamage: { value: 0 }, uAds: { value: 0 },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.01) }, uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uAspect: { value: 1.7 }, uFlare: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uCA, uSat, uContrast, uDamage, uAds;
    uniform vec3 uLift, uGain, uSun; uniform float uAspect, uFlare; varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d,d);
      vec3 col;
      if (uCA > 0.0) {
        vec2 o = d * r2 * uCA;
        col = vec3(texture2D(tDiffuse, vUv - o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + o).b);
      } else col = texture2D(tDiffuse, vUv).rgb;
      col = col * uGain + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      float vig = 1.0 - smoothstep(0.25, 0.95, r2 * 2.0 * (1.0 + uAds * 0.6)) * (uVignette + uAds * 0.25);
      col *= vig;
      col = mix(col, vec3(0.45, 0.0, 0.0), uDamage * smoothstep(0.05, 0.5, r2 * 2.0));
      if (uFlare > 0.0 && uSun.z > 0.001) {
        // screen-space sun glare: glow, anamorphic streak and ghosts mirrored through the centre
        vec2 dd = (vUv - uSun.xy) * vec2(uAspect, 1.0);
        float l = length(dd);
        float glow = exp(-l * 10.0) * 0.07 + exp(-l * 40.0) * 0.3;
        float streak = exp(-abs(dd.y) * 160.0) * exp(-abs(dd.x) * 3.5) * 0.1;
        vec3 ghosts = vec3(0.0);
        vec2 axis = vec2(0.5) - uSun.xy;
        for (int i = 1; i <= 4; i++) {
          float fi = float(i);
          vec2 gp = uSun.xy + axis * (0.45 * fi);
          float r = 0.025 + 0.018 * fi;
          float gd = length((vUv - gp) * vec2(uAspect, 1.0));
          float ring = smoothstep(r, r * 0.55, gd);
          ghosts += ring * 0.05 * (fi == 2.0 ? vec3(0.4, 0.7, 1.0) : vec3(1.0, 0.7, 0.4));
        }
        col += (vec3(1.0, 0.86, 0.62) * (glow + streak) + ghosts) * uSun.z * uFlare;
      }
      col += (rand(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// Draws the first-person weapon on top of the world into the same buffer with a fresh depth buffer.
class ViewmodelPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

export class Graphics {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.composer = null;
    this.damage = 0;
  }

  setup(world, camera, vm) {
    this.world = world; this.camera = camera; this.vm = vm;
    this.rebuild();
  }

  get pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return dpr * gnum('renderScale');
  }

  rebuild() {
    const g = settings.graphics, r = this.renderer;
    r.setPixelRatio(this.pixelRatio);
    r.setSize(innerWidth, innerHeight);
    if (this.composer) { this.composer.passes.forEach(p => p.dispose && p.dispose()); this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.composer = null;
    const usePost = g.ambientOcclusion > 0 || g.bloom > 0 || g.postFx > 0 || g.antiAliasing > 0 || g.lensFlare > 0;
    if (!usePost) return;
    const w = Math.floor(innerWidth * this.pixelRatio), h = Math.floor(innerHeight * this.pixelRatio);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: g.antiAliasing === 3 ? 4 : 0 });
    const c = new EffectComposer(r, rt);
    c.setPixelRatio(this.pixelRatio); c.setSize(innerWidth, innerHeight);
    c.addPass(new RenderPass(this.world.scene, this.camera));
    if (g.ambientOcclusion > 0) {
      const ao = new GTAOPass(this.world.scene, this.camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: g.ambientOcclusion === 2 ? 16 : 8 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ambientOcclusion === 2 ? 8 : 4, rings: 2, samples: g.ambientOcclusion === 2 ? 16 : 8 });
      ao.blendIntensity = 0.85;
      this.ao = ao;
      c.addPass(ao);
      if (g.ambientOcclusion === 1) ao.setSize(Math.floor(w / 2), Math.floor(h / 2));
    }
    c.addPass(new ViewmodelPass(this.vm.scene, this.vm.camera));
    if (g.bloom > 0) {
      const b = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), g.bloom === 2 ? 0.45 : 0.3, 0.45, 1.1);
      c.addPass(b);
    }
    c.addPass(new OutputPass());
    if (g.postFx > 0 || g.lensFlare > 0) {
      const grade = new ShaderPass(GradeShader);
      const u = grade.uniforms;
      u.uFlare.value = g.lensFlare;
      u.uVignette.value = [0, 0.25, 0.35, 0.45][g.postFx];
      u.uGrain.value = [0, 0, 0.025, 0.04][g.postFx];
      u.uCA.value = [0, 0, 0.004, 0.009][g.postFx];
      u.uSat.value = [1, 1.06, 1.1, 1.12][g.postFx];
      u.uContrast.value = [1, 1.05, 1.08, 1.11][g.postFx];
      if (g.postFx === 0) { u.uLift.value.set(0, 0, 0); u.uGain.value.set(1, 1, 1); }
      if (g.postFx === 3) { u.uLift.value.set(0.0, 0.01, 0.03); u.uGain.value.set(1.05, 1.0, 0.94); }
      this.grade = grade;
      c.addPass(grade);
    } else this.grade = null;
    if (g.antiAliasing === 1) {
      const fx = new ShaderPass(FXAAShader);
      fx.material.uniforms.resolution.value.set(1 / w, 1 / h);
      c.addPass(fx);
    } else if (g.antiAliasing === 2) {
      c.addPass(new SMAAPass(w, h));
    }
    this.composer = c;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.vm.resize();
    this.rebuild();
    if (this.world.reflector) this.world.buildReflections();
  }

  updateSun(dt) {
    if (!this.grade) return;
    // project the sun, test occlusion against world colliders, smooth visibility
    const w = this.world, cam = this.camera;
    const p = cam.position.clone().addScaledVector(w.sunDir, 150).project(cam);
    const front = w.sunDir.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)) > 0;
    let vis = front && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3 ? 1 : 0;
    if (vis && w.raycast(cam.position, w.sunDir, 200, 0.05)) vis = 0;
    vis *= THREE.MathUtils.clamp(1.3 - Math.max(Math.abs(p.x), Math.abs(p.y)), 0, 1);
    this.sunVis = (this.sunVis || 0) + (vis - (this.sunVis || 0)) * Math.min(1, dt * 10);
    const u = this.grade.uniforms;
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, this.sunVis);
    u.uAspect.value = innerWidth / innerHeight;
  }

  render(time, ads = 0, dt = 0.016) {
    const r = this.renderer;
    this.updateSun(dt);
    if (this.grade) {
      this.grade.uniforms.uTime.value = time % 10;
      this.grade.uniforms.uDamage.value = this.damage;
      this.grade.uniforms.uAds.value = ads;
    }
    if (this.composer) { this.composer.render(); return; }
    r.autoClear = false;
    r.clear();
    r.render(this.world.scene, this.camera);
    r.clearDepth();
    r.render(this.vm.scene, this.vm.camera);
    r.autoClear = true;
  }
}
