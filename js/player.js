// Player controller: AABB collision against the world, stepping onto low boxes, jumping, crouch,
// sprint, camera head-bob / landing / recoil, health.
import * as THREE from 'three';
import * as Audio from './audio.js';

const RADIUS = 0.33, STAND = 1.75, CROUCH = 1.15, EYE_STAND = 1.62, EYE_CROUCH = 1.05, STEP = 0.48;

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
    this.bobPhase = 0; this.stepDist = 0; this.landDip = 0; this.shake = 0;
    this.moveSpeed = 0; this.strafe = 0;
    this.hurtDirs = [];
  }

  reset(spawn) {
    this.pos.copy(spawn); this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(spawn.x, spawn.z) ; // face roughly toward centre
    this.yaw = Math.atan2(-(0 - spawn.x), -(0 - spawn.z));
    this.pitch = 0; this.health = 100; this.armor = 50; this.alive = true; this.crouched = false;
  }

  look(dx, dy) {
    this.yaw -= dx; this.pitch -= dy;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
  }

  applyRecoil(up, side) { this.recoilPitch += up; this.recoilYaw += side; this.pitch += up; this.yaw += side; this.pitch = Math.min(this.pitch, 1.45); }

  update(dt, input, weaponMoveMul, adsAmount) {
    if (!this.alive) { this.updateCamera(dt); return; }
    // crouch / height
    if (input.crouchToggle) { this.crouched = !this.crouched; input.crouchToggle = false; }
    if (!this.crouched && this.height < STAND - 0.01 && this.blockedAbove(STAND)) this.crouched = true;
    this.crouchBlend += ((this.crouched ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 10);
    this.height = THREE.MathUtils.lerp(STAND, CROUCH, this.crouchBlend);
    this.eye = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouchBlend);

    // wish direction
    const f = input.moveY, s = input.moveX;
    const len = Math.hypot(f, s);
    this.sprinting = input.sprint && f > 0.5 && !this.crouched && adsAmount < 0.3 && len > 0.6;
    if (this.sprinting && this.crouched) this.crouched = false;
    let speed = this.sprinting ? 6.6 : (this.crouched ? 2.3 : 4.3);
    speed *= weaponMoveMul * (1 - adsAmount * 0.4);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s);
    if (len > 1) wish.divideScalar(len);
    wish.multiplyScalar(speed);
    const accel = this.grounded ? 14 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    if (input.jump && this.grounded) { this.vel.y = 6.4; this.grounded = false; input.jump = false; if (this.crouched) this.crouched = false; }
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
    if (this.grounded && !wasGrounded && fallV < -3) { this.landDip = Math.min(0.12, -fallV * 0.012); Audio.playLand(); this.landed = -fallV; }
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
    const bobAmt = this.grounded ? Math.min(1, hs / 5) : 0;
    const by = Math.sin(this.bobPhase * 2) * 0.035 * bobAmt * (this.sprinting ? 1.5 : 1);
    const bx = Math.cos(this.bobPhase) * 0.02 * bobAmt;
    const cam = this.camera;
    const eye = this.alive ? this.eye : 0.4;
    cam.position.set(this.pos.x, this.pos.y + eye + by - this.landDip, this.pos.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.addScaledVector(right, bx);
    const sh = this.shake;
    const roll = -this.strafe * 0.02 + Math.sin(this.bobPhase) * 0.004 * bobAmt + (this.alive ? 0 : 0.5);
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.02, this.yaw + (Math.random() - 0.5) * sh * 0.02, roll, 'YXZ');
    cam.updateMatrixWorld();
  }

  damage(amount, fromPos) {
    if (!this.alive) return;
    const absorbed = Math.min(this.armor, amount * 0.45);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this.shake = Math.min(1.5, this.shake + 0.6);
    Audio.playHurt();
    if (fromPos) {
      const ang = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
      this.hurtDirs.push({ ang, t: 1.2 });
    }
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }
}
