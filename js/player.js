// Player controller: AABB collision against the world, stepping onto low boxes, jumping, crouch,
// sprint, camera head-bob / landing / recoil, health.
import * as THREE from 'three';
import * as Audio from './audio.js';

const RADIUS = 0.33, STAND = 1.75, CROUCH = 1.15, EYE_STAND = 1.62, EYE_CROUCH = 1.05, STEP = 0.48, MAX_CLIMB = 2.45;

export class Player {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.pos = new THREE.Vector3(0, 0, 32);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.grounded = true; this.crouched = false; this.crouchBlend = 0; this.sprinting = false;
    this.height = STAND; this.eye = EYE_STAND;
    this.health = 100; this.armor = 50; this.alive = true;
    this.bobPhase = 0; this.sprintRamp = 0; this.stepDist = 0; this.landDip = 0; this.shake = 0; this.climbDip = 0; this.mantle = null; this.ledge = null;
    this.moveSpeed = 0; this.strafe = 0;
    this.hurtDirs = [];
    this.head = new THREE.Vector3(0, 1.6, 32); // world head position (enemies aim here; camera is behind in 3rd person)
  }

  reset(spawn) {
    this.pos.copy(spawn); this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(spawn.x, spawn.z); // face toward the centre
    this.pitch = 0; this.health = 100; this.armor = 50; this.alive = true; this.crouched = false; this.crouchBlend = 0; this.mantle = null; this.climbDip = 0;
  }

  look(dx, dy) {
    this.yaw -= dx; this.pitch -= dy;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
  }

  applyRecoil(up, side) { this.recoilPitch += up; this.recoilYaw += side; this.pitch += up; this.yaw += side; this.pitch = Math.min(this.pitch, 1.45); }

  // Ledge in front of the player that can be climbed (containers, crates, barriers, props)?
  findLedge() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let best = null;
    for (const d of [0.42, 0.62, 0.85]) {
      const px = this.pos.x + fx * d, pz = this.pos.z + fz * d;
      for (const c of this.world.colliders) {
        if (px < c.min.x - 0.02 || px > c.max.x + 0.02 || pz < c.min.z - 0.02 || pz > c.max.z + 0.02) continue;
        const rise = c.max.y - this.pos.y;
        if (rise < 0.5 || rise > MAX_CLIMB) continue;
        if (c.max.x - c.min.x < RADIUS * 1.6 && c.max.z - c.min.z < RADIUS * 1.6) continue; // too small to stand on
        // stand-up spot on top of the ledge, pulled inside the box
        const tx = THREE.MathUtils.clamp(px + fx * (RADIUS + 0.15), c.min.x + RADIUS * 0.9, c.max.x - RADIUS * 0.9);
        const tz = THREE.MathUtils.clamp(pz + fz * (RADIUS + 0.15), c.min.z + RADIUS * 0.9, c.max.z - RADIUS * 0.9);
        let clear = true;
        for (const o of this.world.colliders) if (o !== c && this.overlaps(o, tx, c.max.y + 0.02, tz, CROUCH)) { clear = false; break; }
        if (!clear) continue;
        if (!best || rise < best.rise) best = { rise, top: c.max.y, to: new THREE.Vector3(tx, c.max.y, tz) };
      }
      if (best) break;
    }
    return best;
  }

  startClimb(ledge) {
    this.mantle = { t: 0, dur: 0.38 + ledge.rise * 0.2, from: this.pos.clone(), to: ledge.to, rise: ledge.rise };
    this.vel.set(0, 0, 0); this.grounded = false;
    Audio.playClimb && Audio.playClimb();
  }

  updateClimb(dt) {
    const m = this.mantle;
    m.t += dt / m.dur;
    const t = Math.min(1, m.t);
    // phase 1: pull up (ease-out) — phase 2: roll forward onto the top
    const up = 1 - Math.pow(1 - Math.min(1, t / 0.65), 2.2);
    const fwd = THREE.MathUtils.smoothstep(t, 0.45, 1);
    this.pos.y = m.from.y + (m.to.y - m.from.y) * up;
    this.pos.x = m.from.x + (m.to.x - m.from.x) * fwd;
    this.pos.z = m.from.z + (m.to.z - m.from.z) * fwd;
    this.climbDip = Math.sin(t * Math.PI) * 0.18; // camera dips toward the ledge like a pull-up
    if (t >= 1) { this.mantle = null; this.grounded = true; this.vel.set(0, 0, 0); this.climbDip = 0; this.landDip = 0.05; this.landed = 2; }
  }

  update(dt, input, weaponMoveMul, adsAmount) {
    if (!this.alive) { this.updateCamera(dt); return; }
    if (this.mantle) { input.jump = false; input.crouchToggle = false; this.updateClimb(dt); this.moveSpeed = 0; this.sprinting = false; this.ledge = null; this.updateCamera(dt); return; }
    // crouch / height
    if (input.crouchToggle) { this.crouched = !this.crouched; input.crouchToggle = false; }
    if (!this.crouched && this.height < STAND - 0.01 && this.blockedAbove(STAND)) this.crouched = true;
    this.crouchBlend += ((this.crouched ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 10);
    this.height = THREE.MathUtils.lerp(STAND, CROUCH, this.crouchBlend);
    this.eye = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouchBlend);

    // wish direction
    const f = input.moveY, s = input.moveX;
    const len = Math.hypot(f, s);
    // sprinting from a crouch stands the player up first (if there is headroom)
    if (input.sprint && this.crouched && f > 0.5 && !this.blockedAbove(STAND)) this.crouched = false;
    this.sprinting = input.sprint && f > 0.5 && !this.crouched && adsAmount < 0.3 && len > 0.6;
    // sprint ramps up gradually and eases off quicker (smoother speed changes)
    this.sprintRamp += ((this.sprinting ? 1 : 0) - this.sprintRamp) * Math.min(1, dt * (this.sprinting ? 2.2 : 6));
    let speed = this.crouched ? 2.3 : 4.3 + (6.6 - 4.3) * this.sprintRamp;
    speed *= weaponMoveMul * (1 - adsAmount * 0.4);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s);
    if (len > 1) wish.divideScalar(len);
    wish.multiplyScalar(speed);
    // softer acceleration / deceleration on the ground, little air control
    const targetV = Math.hypot(wish.x, wish.z), curV = Math.hypot(this.vel.x, this.vel.z);
    const accel = this.grounded ? (targetV > curV ? 9 : 6.5) : 2.4;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    this.ledge = this.grounded ? this.findLedge() : null;
    if (input.jump && this.grounded) {
      input.jump = false;
      if (this.ledge && !this.blockedAbove(CROUCH)) { this.crouched = false; this.startClimb(this.ledge); this.updateCamera(dt); return; }
      this.vel.y = 6.4; this.grounded = false; if (this.crouched && !this.blockedAbove(STAND)) this.crouched = false;
    }
    input.jump = false;
    this.vel.y -= 20 * dt;

    // collide axis by axis
    const prevY = this.pos.y;
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    const fallV = this.vel.y;
    this.pos.y += this.vel.y * dt;
    const wasGrounded = this.grounded;
    this.grounded = false;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.grounded = true; }
    for (const c of this.world.colliders) {
      if (!this.overlaps(c)) continue;
      if (this.vel.y <= 0 && prevY >= c.max.y - 0.05) { this.pos.y = c.max.y; this.vel.y = 0; this.grounded = true; }
      else if (this.vel.y > 0 && prevY + this.height <= c.min.y + 0.05) { this.pos.y = c.min.y - this.height; this.vel.y = 0; }
    }
    // snap down small steps when walking off a box edge
    if (!this.grounded && wasGrounded && this.vel.y <= 0) {
      const g = this.groundBelow();
      if (this.pos.y - g < STEP * 0.6) { this.pos.y = g; this.vel.y = 0; this.grounded = true; }
    }
    if (this.grounded && !wasGrounded && fallV < -3) { this.landDip = Math.min(0.12, -fallV * 0.012); Audio.playLand(); this.landed = -fallV; if (fallV < -6) { this.vel.x *= 0.55; this.vel.z *= 0.55; } }
    // keep in arena
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -35.5, 35.5); this.pos.z = THREE.MathUtils.clamp(this.pos.z, -35.5, 35.5);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moveSpeed = hs;
    this.strafe = (this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) / 5;
    if (this.grounded && hs > 0.5) {
      this.stepDist += hs * dt;
      const stride = this.sprinting ? 2.1 : 1.6;
      if (this.stepDist > stride) { this.stepDist = 0; if (!this.crouched) Audio.playFootstep(this.sprinting); }
      this.bobPhase += hs * dt * (this.sprinting ? 2.9 : 3.3);
    }
    // recoil recovery (returns part of the climb like PUBG/CS)
    const rec = Math.min(1, dt * 7);
    const back = this.recoilPitch * rec * 0.7, backY = this.recoilYaw * rec * 0.7;
    this.pitch -= back; this.yaw -= backY; this.recoilPitch -= this.recoilPitch * rec; this.recoilYaw -= this.recoilYaw * rec;
    this.updateCamera(dt, hs);
  }

  overlaps(c, px = this.pos.x, py = this.pos.y, pz = this.pos.z, h = this.height) {
    return px + RADIUS > c.min.x && px - RADIUS < c.max.x && pz + RADIUS > c.min.z && pz - RADIUS < c.max.z && py + h > c.min.y && py < c.max.y;
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    this.pos[axis] += d;
    for (const c of this.world.colliders) {
      if (!this.overlaps(c)) continue;
      const stepUp = c.max.y - this.pos.y;
      if (this.grounded && stepUp > 0 && stepUp <= STEP && !this.blockedAt(this.pos.x, c.max.y, this.pos.z)) { this.pos.y = c.max.y; continue; }
      if (d > 0) this.pos[axis] = c.min[axis] - RADIUS - 0.001; else this.pos[axis] = c.max[axis] + RADIUS + 0.001;
      if (axis === 'x') this.vel.x = 0; else this.vel.z = 0;
    }
  }

  blockedAt(x, y, z) { for (const c of this.world.colliders) if (this.overlaps(c, x, y + 0.01, z)) return true; return false; }
  blockedAbove(h) { for (const c of this.world.colliders) if (this.overlaps(c, this.pos.x, this.pos.y + 0.05, this.pos.z, h)) return true; return false; }
  groundBelow() {
    let g = 0;
    for (const c of this.world.colliders) {
      if (this.pos.x + RADIUS > c.min.x && this.pos.x - RADIUS < c.max.x && this.pos.z + RADIUS > c.min.z && this.pos.z - RADIUS < c.max.z && c.max.y <= this.pos.y + 0.01) g = Math.max(g, c.max.y);
    }
    return g;
  }

  updateCamera(dt, hs = 0) {
    this.landDip *= Math.max(0, 1 - dt * 8);
    this.shake *= Math.max(0, 1 - dt * 6);
    // bob amplitude fades in/out instead of snapping
    const bobTarget = this.grounded ? Math.min(1, hs / 5) : 0;
    this.bobAmp = (this.bobAmp || 0) + (bobTarget - (this.bobAmp || 0)) * Math.min(1, dt * 8);
    const bobAmt = this.bobAmp;
    const by = Math.sin(this.bobPhase * 2) * 0.035 * bobAmt * (this.sprinting ? 1.5 : 1);
    const bx = Math.cos(this.bobPhase) * 0.02 * bobAmt;
    const cam = this.camera;
    const eye = this.alive ? this.eye : 0.4;
    this.head.set(this.pos.x, this.pos.y + (this.alive ? this.eye : 0.5), this.pos.z);
    cam.position.set(this.pos.x, this.pos.y + eye + by - this.landDip - this.climbDip, this.pos.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.addScaledVector(right, bx);
    const sh = this.shake;
    const roll = -this.strafe * 0.02 + Math.sin(this.bobPhase) * 0.004 * bobAmt + (this.alive ? 0 : 0.5);
    cam.rotation.set(this.pitch - this.climbDip * 0.6 + (Math.random() - 0.5) * sh * 0.02, this.yaw + (Math.random() - 0.5) * sh * 0.02, roll, 'YXZ');
    cam.updateMatrixWorld();
  }

  damage(amount, fromPos) {
    if (!this.alive) return;
    const absorbed = Math.min(this.armor, amount * 0.45);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this.shake = Math.min(1.5, this.shake + 0.6);
    Audio.playHurt();
    if (fromPos) this.lastHitDir = this.pos.clone().sub(fromPos).setY(0).normalize(); // shooter -> player (death direction)
    if (fromPos) {
      const ang = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
      this.hurtDirs.push({ ang, t: 1.2 });
    }
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }
}
