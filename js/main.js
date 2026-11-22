// Game bootstrap + loop: loading, lobby camera, rounds (CS-style elimination), hitscan resolution.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { settings, gnum } from './settings.js';
import { Graphics } from './graphics.js';
import { World } from './world.js';
import { Viewmodels, SLOTS, WEAPONS } from './weapons.js';
import { Player } from './player.js';
import { Enemy, buildSoldierTemplate } from './enemies.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import * as Audio from './audio.js';
import { applyLayout, HudEditor } from './hudlayout.js';
import { FPSBody } from './fpsbody.js';

const MODELS = ['carbine', 'smg', 'pistol', 'soldier', 'containers', 'dungeon', 'player'];
const ADS_ZOOM = 1.5; // camera zoom while aiming down the M4's optic
const ROUND_TIME = 115;
const MAX_ROUNDS = 10;

class Game {
  constructor() {
    this.state = 'loading';
    this.difficulty = 1;
    this.profile = loadProfile();
    this.gfx = new Graphics(document.getElementById('gameCanvas'));
    this.camera = new THREE.PerspectiveCamera(settings.controls.fov, innerWidth / innerHeight, 0.05, 200);
    this.input = new Input(document.getElementById('gameCanvas'));
    this.ui = new UI(this);
    this.enemies = [];
    this.stats = newStats();
    this.round = 1; this.roundTime = ROUND_TIME;
    this.hurtFlash = 0; this.time = 0; this.lobbyT = 0;
    if (this.input.isTouch) document.body.classList.add('touch');
    this.load();
  }

  async load() {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager); loader.setMeshoptDecoder(MeshoptDecoder);
    const progress = {}; const sizes = { carbine: 0.8, smg: 0.7, pistol: 0.7, soldier: 1.1, containers: 0.3, dungeon: 1.1, player: 3.5 };
    const total = Object.values(sizes).reduce((a, b) => a + b);
    const report = () => { let s = 0; for (const k in progress) s += progress[k] * sizes[k]; this.ui.setLoading(s / total * 0.9); };
    const assets = {};
    try {
      await Promise.all(MODELS.map(name => new Promise((res, rej) => loader.load((window.__MODELS && window.__MODELS[name]) || `assets/models/${name}.glb`, g => { assets[name] = g; progress[name] = 1; report(); res(); },
        e => { if (e.total) { progress[name] = e.loaded / e.total; report(); } }, rej))));
    } catch (e) {
      this.ui.setLoading(0, 'FAILED TO LOAD ASSETS — serve this folder over http(s)');
      console.error(e); return;
    }
    this.ui.setLoading(0.93, 'BUILDING IRONYARD…');
    await nextFrame();
    this.assets = assets;
    this.world = new World(this.gfx.renderer, assets);
    this.effects = new Effects(this.world.scene, this.world.prefabs);
    this.vm = new Viewmodels(assets, this.world.envMap);
    this.vm.setFlashTexture(this.effects.flashTex);
    this.ui.setLoading(0.97, 'RIGGING OPERATORS…');
    await nextFrame();
    this.soldierTemplate = buildSoldierTemplate(assets.soldier, assets.carbine);
    this.player = new Player(this.camera, this.world);
    // third-person SWAT operator replaces the first-person hands (the Viewmodels class stays as the
    // invisible weapon system: ammo, fire rate, spread, recoil, reload timing)
    this.body = new FPSBody(assets.player, this.world.scene, this.effects.flashTex);
    for (const id of ['touchSlots', 'slots', 'btnInspect']) document.getElementById(id).classList.add('hidden');
    this.gfx.setup(this.world, this.camera, this.vm);
    this.world.applyQuality(this.camera);
    this.gfx.rebuild();
    this.ui.buildMinimapBase(this.world);
    // warm up shaders with a few enemies so the first round doesn't hitch
    this.spawnEnemies(4, true);
    // pre-compile effect shaders (tracers, flashes, particles, decals) to avoid first-shot hitches
    const warm = [this.effects.tracers[0].m, ...SLOTS.map(id => this.vm.guns[id].flash), this.enemies[0].flash];
    warm.forEach(o => o.visible = true);
    this.effects.decal(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0));
    this.effects.impact(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0), 'metal', new THREE.Vector3(0, -1, 0));
    this.gfx.renderer.compile(this.world.scene, this.camera);
    this.gfx.renderer.compile(this.vm.scene, this.vm.camera);
    this.gfx.render(0, 0, 0.016);
    warm.forEach(o => o.visible = false);
    this.ui.setLoading(1, 'READY');
    this.input.onPause = () => this.togglePause();
    this.input.onScore = (on) => this.ui.showScoreboard(on === undefined ? document.getElementById('scoreboard').classList.contains('hidden') : on);
    this.input.onUnlock = () => { if (this.state === 'playing') this.pause(); };
    addEventListener('resize', () => { this.gfx.resize(); this.applyFov(); applyLayout(); });
    this.hudEditor = new HudEditor((saved) => this.closeHudEditor(saved));
    document.getElementById('mHud').addEventListener('click', () => { Audio.playUI('tap'); this.openHudEditor(); });
    document.getElementById('pHud').addEventListener('click', () => { Audio.playUI('tap'); this.openHudEditor(); });
    this.ui.onOpenHud = () => this.openHudEditor();
    this.applyControls();
    applyLayout();
    this.ui.hideLoading();
    this.toLobby();
    this.last = performance.now();
    this.gfx.renderer.setAnimationLoop(() => this.frame());
    window.__game = this;
  }

  // ---------- state changes ----------
  toLobby() {
    this.state = 'menu';
    for (const id of ['hud', 'touchLayer', 'pause', 'death', 'banner', 'clickToPlay']) document.getElementById(id).classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    this.input.enabled = false; this.input.reset();
    document.exitPointerLock?.();
    this.vm.scene.visible = false;
    if (!this.enemies.length) this.spawnEnemies(4, true);
    this.ui.refreshMenuStats();
  }

  async startMatch() {
    Audio.initAudio();
    Audio.setMasterVolume(settings.audio.master);
    if (this.input.isTouch) {
      try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); await screen.orientation?.lock?.('landscape'); } catch (e) { /* not supported */ }
    }
    for (const id of ['menu', 'death', 'pause']) document.getElementById(id).classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('touchLayer').classList.toggle('hidden', !this.input.isTouch);
    this.vm.scene.visible = false;
    this.stats = newStats();
    this.round = 1;
    this.vm.resetAmmo();
    this.vm.equip(SLOTS[0], true);
    this.startRound();
    this.state = 'playing';
    this.input.enabled = true; this.input.reset();
    if (!this.input.isTouch) document.getElementById('gameCanvas').requestPointerLock?.();
  }

  startRound() {
    this.player.reset(new THREE.Vector3((Math.random() - 0.5) * 10, 0, 33));
    this.roundTime = ROUND_TIME;
    const n = Math.min(3 + this.round, 10);
    this.spawnEnemies(n, false);
    for (const p of this.world.pickups) { p.active = true; p.mesh.visible = p.ring.visible = true; }
    this.ui.banner('ROUND ' + this.round, this.round === MAX_ROUNDS ? 'FINAL ROUND' : 'ELIMINATE ALL HOSTILES');
    Audio.playUI('round');
    this.roundOver = false;
  }

  spawnEnemies(n, lobby) {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    const diff = this.difficulty * (1 + (this.round - 1) * 0.06);
    for (let i = 0; i < n; i++) {
      const e = new Enemy(this.soldierTemplate, this.world, this.effects, i + (this.round * 3), diff);
      const p = this.world.randomWalkable(Math.random, lobby ? (q => Math.hypot(q.x, q.z) < 22) : (q => q.z < -12 && Math.abs(q.x) < 33));
      e.spawn(p);
      e.spottedT = 0; e.kills = 0;
      this.enemies.push(e);
    }
  }

  togglePause() { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.input.reset();
    document.getElementById('pause').classList.remove('hidden');
  }
  resume() {
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('settings').classList.add('hidden');
    this.state = 'playing'; this.input.enabled = true;
    if (!this.input.isTouch) document.getElementById('gameCanvas').requestPointerLock?.();
  }

  endMatch(win) {
    this.state = 'over';
    this.input.enabled = false; this.input.reset();
    document.exitPointerLock?.();
    this.profile.totalKills += this.stats.kills;
    this.profile.bestRound = Math.max(this.profile.bestRound, win ? MAX_ROUNDS : this.round);
    saveProfile(this.profile);
    setTimeout(() => this.ui.showDeath(win, this.stats, this.round), win ? 800 : 1600);
  }

  applyGraphics() {
    if (!this.world) return;
    this.world.applyQuality(this.camera);
    this.gfx.rebuild();
    this.ui.buildMinimapBase(this.world);
    this.world.markNav();
  }
  applyFov() { this.baseFov = settings.controls.fov; }
  applyControls() {
    document.getElementById('btnFire2').classList.toggle('hidden', !settings.controls.leftFire);
    this.applyFov();
    applyLayout();
  }

  // ---------- HUD layout editor ----------
  openHudEditor() {
    this.editorFrom = this.state;
    document.getElementById('settings').classList.add('hidden');
    this.input.enabled = false; this.input.reset();
    document.exitPointerLock?.();
    this.hudEditor.open();
  }
  closeHudEditor() {
    applyLayout();
    if (this.editorFrom === 'menu') {
      for (const id of ['hud', 'touchLayer']) document.getElementById(id).classList.add('hidden');
      this.ui.refreshMenuStats();
    } else {
      document.getElementById('touchLayer').classList.toggle('hidden', !this.input.isTouch);
      if (this.editorFrom === 'paused') document.getElementById('pause').classList.remove('hidden');
    }
  }

  // ---------- combat ----------
  currentSpread() {
    if (!this.vm) return 0;
    const c = this.vm.cfg, P = this.player;
    let s = THREE.MathUtils.lerp(c.spreadHip, c.spreadAds, this.vm.ads) + this.vm.bloom;
    s += Math.min(1, P.moveSpeed / 5) * c.spreadMove;
    if (!P.grounded) s += 0.06;
    if (P.crouched) s *= 0.75;
    return s;
  }

  fireShot(shot) {
    const cam = this.camera, c = shot.cfg;
    this.stats.shots++;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    // random point in a cone
    const r = shot.spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    // third person: start the ray at the player's depth so nothing between camera and player is hit
    const pivot = this.player.head;
    const origin = cam.position.clone().addScaledVector(dir, Math.max(0, pivot.clone().sub(cam.position).dot(dir)));
    const worldHit = this.world.raycast(origin, dir, 300);
    let maxT = worldHit ? worldHit.dist : 300;
    let enemyHit = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.updateHitboxes();
      const h = e.raycast(origin, dir);
      if (h && h.t < maxT) { maxT = h.t; enemyHit = { e, ...h }; }
    }
    const end = origin.clone().addScaledVector(dir, maxT);
    const muzzle = this.body.muzzleWorld();
    this.body.onShot();
    // visible bullet travelling from the muzzle to the crosshair hit point
    this.effects.tracer(muzzle, end, c.tracer);
    this.effects.flashLight(muzzle, 8);
    this.effects.muzzleSmoke(muzzle, dir);
    // shell ejection to the right
    const ej = muzzle.clone().addScaledVector(this.body.barrelWorld(), -0.55);
    this.effects.shell(c.shell, ej, right.clone().multiplyScalar(1.6 + Math.random() * 0.8).addScaledVector(up, 0.6 + Math.random() * 0.5).add(this.player.vel));
    this.player.applyRecoil(shot.recoilUp, shot.recoilSide);
    if (enemyHit) {
      const e = enemyHit.e;
      let dmg = c.damage * (enemyHit.part === 'head' ? c.headMul : enemyHit.part === 'leg' ? c.legMul : 1);
      if (maxT > 30) dmg *= Math.max(0.6, 1 - (maxT - 30) / 120);
      this.stats.hits++; this.stats.damage += Math.min(dmg, e.health);
      this.effects.impact(end, dir.clone().negate(), 'flesh', dir);
      const killed = e.takeDamage(dmg, enemyHit.part, dir, this);
      Audio.playHit(enemyHit.part === 'head');
      if (killed) {
        const head = enemyHit.part === 'head';
        this.stats.kills++; if (head) this.stats.headshots++;
        this.stats.score += head ? 150 : 100;
        this.ui.hitmarker('kill'); this.ui.killNotice(e.name, head);
        this.ui.killfeed('YOU', e.name, c.id, head);
        Audio.playKill();
      } else this.ui.hitmarker(enemyHit.part === 'head' ? 'head' : 'body');
      // alert nearby squad mates
      for (const o of this.enemies) if (o.alive && o.pos.distanceTo(e.pos) < 15) { o.alertTimer = 3; o.lastSeen = this.player.pos.clone(); if (o.state === 'patrol') o.state = 'search'; }
    } else if (worldHit) {
      this.effects.impact(worldHit.point, worldHit.normal, worldHit.surface, dir);
      Audio.playImpact(this.panFor(worldHit.point), worldHit.dist);
      const col = worldHit.collider;
      if (col.mesh && col.mesh.userData.destructible) {
        col.mesh.userData.hp -= c.damage;
        if (col.mesh.userData.hp <= 0) this.destroyProp(col, dir);
      }
    }
    // gunfire draws attention
    for (const e of this.enemies) if (e.alive && e.pos.distanceTo(this.player.pos) < 28 && e.state === 'patrol') { e.state = 'search'; e.lastSeen = this.player.pos.clone(); e.pathTimer = 0; }
  }

  destroyProp(col, dir) {
    const m = col.mesh;
    this.effects.debrisBurst(m, dir);
    m.parent.remove(m);
    this.world.colliders.splice(this.world.colliders.indexOf(col), 1);
    // anything stacked on top falls
    for (const c of this.world.colliders) if (c.mesh && c.min.y > 0.5 && Math.abs(c.min.y - col.max.y) < 0.05 && c.min.x < col.max.x && c.max.x > col.min.x && c.min.z < col.max.z && c.max.z > col.min.z) {
      const h = c.max.y - c.min.y; c.min.y = col.min.y; c.max.y = c.min.y + h; c.mesh.position.y = col.min.y;
    }
    this.world.markNav();
  }

  onEnemyFire(e) { e.spottedT = 2.5; }

  panFor(pos) {
    const rel = pos.clone().applyMatrix4(this.camera.matrixWorldInverse);
    return THREE.MathUtils.clamp(rel.x / (Math.abs(rel.z) + 2), -1, 1);
  }

  // ---------- loop ----------
  frame() {
    const now = performance.now();
    const limit = gnum('fpsLimit');
    if (limit < 1000 && now - this.last < 1000 / limit - 1.5) return;
    let dt = Math.min(0.05, (now - this.last) / 1000);
    // smooth frame-time spikes so movement / animation / camera don't stutter on uneven frames
    this.dtS = this.dtS ? this.dtS + (dt - this.dtS) * 0.3 : dt;
    dt = this.dtS;
    this.last = now;
    this.time += dt;
    const t = this.time;
    if (this.state === 'menu' || this.state === 'loading') {
      this.lobbyT += dt * 0.05;
      const a = this.lobbyT;
      this.camera.fov = 55; this.camera.updateProjectionMatrix();
      this.camera.position.set(Math.sin(a) * 26, 6 + Math.sin(a * 0.7) * 2, Math.cos(a) * 26);
      this.camera.lookAt(0, 2.5, 0);
      for (const e of this.enemies) e.update(dt, t, { player: { pos: new THREE.Vector3(0, -100, 0), head: new THREE.Vector3(0, -100, 0), alive: false, camera: this.camera }, enemies: this.enemies });
      this.world.update(dt, t, new THREE.Vector3());
      this.effects.update(dt, this.camera);
      this.body.update(dt, { P: this.player, camQuat: this.camera.quaternion, ads: 0, firing: false, reloading: false, reloadTime: 2, crouch: 0, grounded: true, alive: true, wantStop: false });
      this.body.setHead(true);
      this.gfx.render(t, 0, dt);
      return;
    }
    if (this.state === 'playing' || this.state === 'over') this.simulate(dt, t);
    this.gfx.damage = Math.max(0, this.hurtFlash * 0.6 + (this.player.health < 35 ? (35 - this.player.health) / 70 : 0));
    this.gfx.render(t, this.vm.ads, dt);
  }

  updateButtonStates() {
    const P = this.player, inp = this.input, $ = (id) => document.getElementById(id);
    $('btnAds').classList.toggle('on', inp.ads);
    $('btnCrouch').classList.toggle('on', P.crouched);
    $('btnSprint').classList.toggle('on', P.sprinting || inp.sprintBtn || inp.sprintLock);
    const climb = !!(P.ledge && P.ledge.rise > 1.0 && P.alive);
    $('btnJump').classList.toggle('climb', climb);
    $('climbHint').classList.toggle('on', climb && this.input.isTouch);
    $('climbHint').textContent = this.input.isTouch ? 'CLIMB' : 'SPACE · CLIMB';
  }

  simulate(dt, t) {
    const inp = this.input, P = this.player, vm = this.vm;
    inp.poll();
    const playing = this.state === 'playing' && P.alive;
    // weapon switching / actions
    if (playing) {
      inp.switchTo = null; inp.wheel = 0; // single rifle loadout in third person
      if (inp.reload) { vm.reload(); inp.reload = false; }
      inp.inspect = false;
      vm.adsWanted = inp.ads;
      if (vm.reloading || P.sprinting) { if (this.input.isTouch && vm.reloading) inp.ads = false; }
    }
    this.updateButtonStates();
    // look
    let [lx, ly] = inp.consumeLook();
    if (inp.isTouch) { // light smoothing of finger look input: apply 60% of the pending turn per frame (total preserved)
      this.lookRx = (this.lookRx || 0) + lx; this.lookRy = (this.lookRy || 0) + ly;
      lx = this.lookRx * 0.6; ly = this.lookRy * 0.6; this.lookRx -= lx; this.lookRy -= ly;
    }
    const adsMul = THREE.MathUtils.lerp(1, settings.controls.adsSensitivity / ADS_ZOOM * 1.4, vm.ads);
    if (playing) P.look(lx * adsMul, ly * adsMul);
    // firing while sprinting cancels sprint
    if (inp.fire && P.sprinting) inp.cancelSprintLock();
    P.update(dt, playing ? inp : { moveX: 0, moveY: 0, sprint: false, jump: false }, vm.cfg.moveMul, vm.ads);
    if (P.landed) { vm.onLand(P.landed); P.landed = 0; }
    // first-person body: pose for this frame, then the eye camera (+ ADS / left-hand IK)
    const rc = vm.cfg.clips[vm.clipName];
    const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(P.pitch, P.yaw, 0, 'YXZ'));
    this.body.update(dt, {
      P, camQuat, ads: vm.ads, firing: playing && inp.fire && !vm.reloading && !P.mantle,
      reloading: vm.reloading, reloadTime: rc ? (rc[1] - rc[0]) / (vm.clipSpeed || 1) : 2,
      crouch: P.crouchBlend, grounded: P.grounded || !!P.mantle, alive: P.alive, wantStop: Math.hypot(inp.moveX, inp.moveY) < 0.1,
    });
    this.body.updateCamera(dt, P, this.camera, vm.ads, P.alive);
    // FOV zoom while aiming
    const fov = this.baseFov / THREE.MathUtils.lerp(1, ADS_ZOOM, vm.ads) * (1 + 0.06 * P.sprintRamp);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 14);
    this.camera.updateProjectionMatrix();
    // viewmodel
    const sunView = this.world.sunDir.clone().transformDirection(this.camera.matrixWorldInverse);
    const shots = vm.update(dt, t, {
      trigger: playing && inp.fire, blockFire: !playing || !!P.mantle, holdRepeat: inp.isTouch, sprinting: P.sprinting || !!P.mantle, moveSpeed: P.moveSpeed, grounded: P.grounded,
      lookDX: lx * 1000 / Math.max(dt * 60, 0.5), lookDY: ly * 1000 / Math.max(dt * 60, 0.5), strafe: P.strafe, crouchBlend: P.crouchBlend, crouched: P.crouched, sunDirView: sunView,
    });
    for (const s of shots) this.fireShot(s);
    // third-person body animation
    // enemies
    for (const e of this.enemies) { e.update(dt, t, this); e.spottedT = Math.max(0, (e.spottedT || 0) - dt); }
    // spot enemies the player can see (for minimap)
    if ((this._spot = (this._spot || 0) + dt) > 0.25) {
      this._spot = 0;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      for (const e of this.enemies) if (e.alive) {
        const d = e.eye().sub(this.camera.position); const l = d.length();
        if (d.normalize().dot(fwd) > 0.5 && l < 60 && this.world.lineOfSight(this.camera.position, e.eye())) e.spottedT = 1.5;
      }
    }
    // pickups
    for (const p of this.world.pickups) {
      if (!p.active || !P.alive) continue;
      if (Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 1.1 && P.pos.y < 1) {
        if (p.type === 'health' && (P.health < 100 || P.armor < 100)) { P.health = Math.min(100, P.health + 50); P.armor = Math.min(100, P.armor + 25); this.ui.pickup('+50 HEALTH  +25 ARMOR'); }
        else if (p.type === 'ammo') { vm.refill(); this.ui.pickup('AMMO REFILLED'); }
        else continue;
        p.active = false; p.mesh.visible = p.ring.visible = false; p.timer = 25; Audio.playUI('pickup');
      }
    }
    // damage feedback
    if (P.health < this._lastHp) this.hurtFlash = 0.6;
    this._lastHp = P.health;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    // world + effects
    this.world.update(dt, t, P.pos);
    this.effects.update(dt, this.camera);
    this.ui.update(dt);
    // round logic
    if (this.state === 'playing') {
      this.roundTime -= dt;
      if (!P.alive) {
        this.stats.deaths++;
        const killer = this.enemies.find(e => e.alive && e.state === 'combat') || this.enemies.find(e => e.alive);
        if (killer) { killer.kills = (killer.kills || 0) + 1; this.ui.killfeed(killer.name, 'YOU', 'carbine', false, true); }
        this.ui.banner('KILLED IN ACTION', 'YOU WERE ELIMINATED', 1800);
        this.endMatch(false);
      } else if (!this.roundOver && this.enemies.every(e => !e.alive)) {
        this.roundOver = true;
        this.stats.score += 250 + Math.ceil(this.roundTime) * 2;
        if (this.round >= MAX_ROUNDS) { this.ui.banner('VICTORY', 'IRONYARD SECURED', 3000); this.endMatch(true); }
        else {
          this.ui.banner('ROUND ' + this.round + ' WON', 'HOSTILES ELIMINATED', 2500);
          Audio.playUI('round');
          setTimeout(() => { if (this.state === 'playing') { this.round++; this.startRound(); } }, 3500);
        }
      } else if (this.roundTime <= 0 && !this.roundOver) {
        this.ui.banner('TIME EXPIRED', 'MISSION FAILED', 2500);
        this.endMatch(false);
      }
    }
  }
}

function newStats() { return { kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, score: 0, damage: 0 }; }
function nextFrame() { return new Promise(r => requestAnimationFrame(() => r())); }
function loadProfile() { try { return Object.assign({ bestRound: 0, totalKills: 0 }, JSON.parse(localStorage.getItem('ironyard.profile') || '{}')); } catch (e) { return { bestRound: 0, totalKills: 0 }; } }
function saveProfile(p) { try { localStorage.setItem('ironyard.profile', JSON.stringify(p)); } catch (e) { /* ignore */ } }

new Game();
