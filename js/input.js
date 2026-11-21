// Unified input: multi-touch (PUBG-style floating joystick, drag-to-look anywhere on the right,
// fire buttons that also steer, sprint-lock by pushing the stick up) + keyboard & pointer-lock mouse.
import { settings } from './settings.js';

export class Input {
  constructor(root) {
    this.root = root;
    this.moveX = 0; this.moveY = 0; this.lookDX = 0; this.lookDY = 0;
    this.fire = false; this.ads = false; this.sprint = false; this.sprintLock = false;
    this.jump = false; this.crouchToggle = false; this.reload = false; this.inspect = false; this.switchTo = null;
    this.keys = {}; this.touches = new Map();
    this.enabled = false; this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.adsToggleMode = true;
    this.joy = document.getElementById('joy'); this.joyKnob = document.getElementById('joyKnob');
    this.joyBase = { x: 0, y: 0 };
    this.bindTouch(); this.bindDesktop();
  }

  bindTouch() {
    const zone = document.getElementById('touchLayer');
    const opt = { passive: false };
    zone.addEventListener('touchstart', e => this.onStart(e), opt);
    zone.addEventListener('touchmove', e => this.onMove(e), opt);
    zone.addEventListener('touchend', e => this.onEnd(e), opt);
    zone.addEventListener('touchcancel', e => this.onEnd(e), opt);
  }

  onStart(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const btn = el && el.closest('[data-btn]');
      const rec = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, role: 'look', btn: null };
      if (btn) {
        const b = btn.dataset.btn; rec.btn = btn; btn.classList.add('pressed');
        if (b === 'fire' || b === 'fire2') { rec.role = 'fireLook'; this.fire = true; }
        else { rec.role = 'button'; this.press(b, btn); }
      } else if (t.clientX < innerWidth * 0.42) {
        rec.role = 'joy';
        this.cancelSprintLock();
        this.joyBase = { x: t.clientX, y: t.clientY };
        this.joy.style.left = t.clientX + 'px'; this.joy.style.top = t.clientY + 'px';
        this.joy.classList.add('active');
      }
      this.touches.set(t.identifier, rec);
    }
  }

  onMove(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const r = this.touches.get(t.identifier); if (!r) continue;
      const dx = t.clientX - r.x, dy = t.clientY - r.y;
      r.x = t.clientX; r.y = t.clientY;
      if (r.role === 'joy') {
        const R = 60;
        let jx = t.clientX - this.joyBase.x, jy = t.clientY - this.joyBase.y;
        const l = Math.hypot(jx, jy);
        // pushing well past the rim upward locks sprint (PUBG behaviour)
        this.sprintLock = jy < -R * 1.55;
        document.getElementById('sprintLock').classList.toggle('on', this.sprintLock);
        if (l > R) { jx *= R / l; jy *= R / l; }
        this.joyKnob.style.transform = `translate(${jx}px, ${jy}px)`;
        this.moveX = jx / R; this.moveY = -jy / R;
      } else if (r.role === 'look' || r.role === 'fireLook') {
        const s = 0.0042 * settings.controls.sensitivity;
        this.lookDX += dx * s; this.lookDY += dy * s * (settings.controls.invertY ? -1 : 1);
      }
    }
  }

  onEnd(e) {
    for (const t of e.changedTouches) {
      const r = this.touches.get(t.identifier); if (!r) continue;
      if (r.btn) r.btn.classList.remove('pressed');
      if (r.role === 'joy') {
        this.joy.classList.remove('active'); this.joyKnob.style.transform = '';
        // sprint-lock keeps auto-running forward after release
        if (this.sprintLock) { this.moveX = 0; this.moveY = 1; } else { this.moveX = this.moveY = 0; }
      }
      if (r.role === 'fireLook') {
        this.fire = [...this.touches.values()].some(o => o !== r && o.role === 'fireLook');
      }
      this.touches.delete(t.identifier);
    }
  }

  press(b, el) {
    switch (b) {
      case 'ads': this.ads = !this.ads; break;
      case 'jump': this.jump = true; break;
      case 'crouch': this.crouchToggle = true; break;
      case 'reload': this.reload = true; break;
      case 'inspect': this.inspect = true; break;
      case 'slot': this.switchTo = +el.dataset.slot; break;
      case 'pause': this.onPause && this.onPause(); break;
      case 'score': this.onScore && this.onScore(); break;
    }
  }

  bindDesktop() {
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') this.jump = true;
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouchToggle = true;
      if (e.code === 'KeyR') this.reload = true;
      if (e.code === 'KeyF') this.inspect = true;
      if (e.code === 'Digit1') this.switchTo = 0;
      if (e.code === 'Digit2') this.switchTo = 1;
      if (e.code === 'Digit3') this.switchTo = 2;
      if (e.code === 'Tab') { e.preventDefault(); this.onScore && this.onScore(true); }
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause && this.onPause();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; if (e.code === 'Tab' && this.onScore) this.onScore(false); });
    const canvasWrap = this.root;
    canvasWrap.addEventListener('mousedown', e => {
      if (!this.enabled || this.isTouch) return;
      if (document.pointerLockElement !== canvasWrap) { canvasWrap.requestPointerLock?.(); return; }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.fire = false; if (e.button === 2) this.ads = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.enabled || document.pointerLockElement !== canvasWrap) return;
      const s = 0.0022 * settings.controls.sensitivity;
      this.lookDX += e.movementX * s; this.lookDY += e.movementY * s * (settings.controls.invertY ? -1 : 1);
    });
    addEventListener('wheel', e => { if (this.enabled && document.pointerLockElement === canvasWrap) this.wheel = Math.sign(e.deltaY); });
    document.addEventListener('pointerlockchange', () => {
      if (this.enabled && !this.isTouch && document.pointerLockElement !== canvasWrap && this.onUnlock) this.onUnlock();
    });
  }

  poll() {
    if (!this.isTouch || Object.values(this.keys).some(Boolean)) {
      const k = this.keys;
      const kx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), ky = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
      if (kx || ky || !this.isTouch) { this.moveX = kx; this.moveY = ky; }
      this.sprint = !!(k.ShiftLeft || k.ShiftRight);
    }
    if (this.isTouch && !Object.values(this.keys).some(Boolean)) this.sprint = this.sprintLock;
  }
  touchesHaveJoy() { for (const r of this.touches.values()) if (r.role === 'joy') return true; return false; }
  cancelSprintLock() { this.sprintLock = false; document.getElementById('sprintLock').classList.remove('on'); }

  consumeLook() { const d = [this.lookDX, this.lookDY]; this.lookDX = this.lookDY = 0; return d; }
  reset() { this.fire = false; this.ads = false; this.moveX = this.moveY = 0; this.sprintLock = false; this.touches.clear(); this.keys = {}; }
}
