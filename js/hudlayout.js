// Customisable mobile HUD: every touch control (joystick, fire buttons, actions, weapon slots, pause…)
// has a position (fraction of the screen, so it adapts to any Android aspect ratio), a size scale and
// an opacity. Layouts persist through settings.js (localStorage) and can be saved/loaded to 3 slots.
import { settings, saveSettings } from './settings.js';

// base sizes in px at the reference screen height (390px tall landscape phone)
export const CONTROLS = {
  joy:     { label: 'MOVE STICK', w: 136, h: 136, round: true },
  fire:    { label: 'FIRE', w: 96, h: 96, round: true },
  fire2:   { label: 'LEFT FIRE', w: 62, h: 62, round: true },
  ads:     { label: 'AIM', w: 64, h: 64, round: true },
  jump:    { label: 'JUMP', w: 64, h: 64, round: true },
  crouch:  { label: 'CROUCH', w: 60, h: 60, round: true },
  sprint:  { label: 'SPRINT', w: 58, h: 58, round: true },
  reload:  { label: 'RELOAD', w: 56, h: 56, round: true },
  inspect: { label: 'INSPECT', w: 44, h: 44, round: true },
  score:   { label: 'SCORES', w: 42, h: 42, round: true },
  pause:   { label: 'PAUSE', w: 42, h: 42, round: true },
  slots:   { label: 'WEAPON SLOTS', w: 282, h: 44, round: false },
};

export const DEFAULT_LAYOUT = {
  joy:     { x: 0.19, y: 0.72, s: 1, o: 0.85 },
  fire:    { x: 0.845, y: 0.6, s: 1, o: 0.95 },
  fire2:   { x: 0.06, y: 0.5, s: 1, o: 0.85 },
  ads:     { x: 0.735, y: 0.44, s: 1, o: 0.85 },
  jump:    { x: 0.945, y: 0.82, s: 1, o: 0.85 },
  crouch:  { x: 0.855, y: 0.86, s: 1, o: 0.85 },
  sprint:  { x: 0.95, y: 0.6, s: 1, o: 0.85 },
  reload:  { x: 0.755, y: 0.84, s: 1, o: 0.85 },
  inspect: { x: 0.735, y: 0.66, s: 1, o: 0.75 },
  score:   { x: 0.9, y: 0.09, s: 1, o: 0.8 },
  pause:   { x: 0.96, y: 0.09, s: 1, o: 0.8 },
  slots:   { x: 0.5, y: 0.845, s: 1, o: 0.9 },
};

const ELEMENT = { joy: 'joy', fire: 'btnFire', fire2: 'btnFire2', ads: 'btnAds', jump: 'btnJump', crouch: 'btnCrouch', sprint: 'btnSprint', reload: 'btnReload', inspect: 'btnInspect', score: 'btnScore', pause: 'btnPause', slots: 'touchSlots' };
// HUD readouts the buttons must never cover (ids of HUD elements)
const PROTECTED = ['minimapWrap', 'roundBar', 'healthWrap'];

const clone = (o) => JSON.parse(JSON.stringify(o));

export function unit() {
  // scale factor so controls feel the same physical size on small and large Android screens
  return Math.max(0.72, Math.min(1.45, Math.min(innerWidth, innerHeight) / 390));
}

export function getLayout() {
  const L = clone(DEFAULT_LAYOUT);
  const saved = settings.hudLayout || {};
  for (const k in L) if (saved[k]) Object.assign(L[k], saved[k]);
  return L;
}

export function sizeOf(id, l) {
  const c = CONTROLS[id], u = unit();
  return { w: c.w * l.s * u, h: c.h * l.s * u };
}

function rectOf(id, l) {
  const { w, h } = sizeOf(id, l);
  const cx = l.x * innerWidth, cy = l.y * innerHeight;
  return { cx, cy, w, h, round: CONTROLS[id].round };
}

function overlaps(a, b, pad = 4) {
  if (a.round && b.round) return Math.hypot(a.cx - b.cx, a.cy - b.cy) < (a.w + b.w) / 2 + pad;
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + pad && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + pad;
}

function protectedRects() {
  const out = [];
  for (const id of PROTECTED) {
    const el = document.getElementById(id); if (!el || !el.offsetParent) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    out.push({ id, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, round: false });
  }
  return out;
}

// Returns the id of whatever control / HUD readout `id` would collide with at layout l, or null.
export function collision(id, l, layout) {
  const r = rectOf(id, l);
  if (r.cx - r.w / 2 < 0 || r.cx + r.w / 2 > innerWidth || r.cy - r.h / 2 < 0 || r.cy + r.h / 2 > innerHeight) return 'screen edge';
  for (const k in layout) {
    if (k === id || !isActive(k)) continue;
    if (overlaps(r, rectOf(k, layout[k]))) return CONTROLS[k].label;
  }
  for (const p of protectedRects()) if (overlaps(r, p, 2)) return p.id === 'minimapWrap' ? 'MINIMAP' : p.id === 'roundBar' ? 'SCORE BAR' : 'HEALTH BAR';
  return null;
}

export function isActive(id) { return id !== 'fire2' || settings.controls.leftFire; }

// Small/odd screens can squeeze a saved layout so controls touch: push overlapping ones apart
// (minimum-penetration axis), keeping everything on screen. Operates on a copy for display only.
function relax(layout) {
  const L = clone(layout), ids = Object.keys(CONTROLS).filter(isActive);
  for (let it = 0; it < 24; it++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = rectOf(ids[i], L[ids[i]]), b = rectOf(ids[j], L[ids[j]]);
      if (!overlaps(a, b, 2)) continue;
      const ox = (a.w + b.w) / 2 + 3 - Math.abs(a.cx - b.cx), oy = (a.h + b.h) / 2 + 3 - Math.abs(a.cy - b.cy);
      const ax = ox < oy, sx = Math.sign(a.cx - b.cx) || 1, sy = Math.sign(a.cy - b.cy) || 1;
      const d = (ax ? ox : oy) / 2;
      if (ax) { L[ids[i]].x += sx * d / innerWidth; L[ids[j]].x -= sx * d / innerWidth; }
      else { L[ids[i]].y += sy * d / innerHeight; L[ids[j]].y -= sy * d / innerHeight; }
      moved = true;
    }
    for (const id of ids) {
      const { w, h } = sizeOf(id, L[id]);
      L[id].x = Math.min(1 - w / 2 / innerWidth, Math.max(w / 2 / innerWidth, L[id].x));
      L[id].y = Math.min(1 - h / 2 / innerHeight, Math.max(h / 2 / innerHeight, L[id].y));
    }
    if (!moved) break;
  }
  return L;
}

export function applyLayout(layout = getLayout(), exact = false) {
  if (!exact) layout = relax(layout);
  for (const id in CONTROLS) {
    const el = document.getElementById(ELEMENT[id]); if (!el) continue;
    const l = layout[id], { w, h } = sizeOf(id, l);
    el.style.left = (l.x * innerWidth) + 'px';
    el.style.top = (l.y * innerHeight) + 'px';
    el.style.opacity = l.o;
    el.style.setProperty('--w', w + 'px');
    el.style.setProperty('--h', h + 'px');
    if (id === 'joy') { el.dataset.homeX = l.x * innerWidth; el.dataset.homeY = l.y * innerHeight; el.dataset.radius = w / 2; }
  }
  return layout;
}

export function joyRadius() { const el = document.getElementById('joy'); return +el.dataset.radius || 68; }

// ---------------- editor ----------------
export class HudEditor {
  constructor(onClose) {
    this.onClose = onClose;
    this.root = document.getElementById('hudEditor');
    this.sel = 'fire';
    this.layout = getLayout();
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    $('heSize').addEventListener('input', () => { this.setProp('s', +$('heSize').value); });
    $('heOpacity').addEventListener('input', () => { this.setProp('o', +$('heOpacity').value); });
    $('heReset').addEventListener('click', () => { this.layout = clone(DEFAULT_LAYOUT); this.refresh(); this.toast('LAYOUT RESET TO DEFAULT'); });
    $('heDone').addEventListener('click', () => this.close(true));
    $('heCancel').addEventListener('click', () => this.close(false));
    this.root.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => {
      settings.hudSaved = settings.hudSaved || {};
      settings.hudSaved[b.dataset.save] = clone(this.layout); saveSettings(); this.renderSlots();
      this.toast('SAVED TO LAYOUT ' + b.dataset.save);
    }));
    this.root.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
      const s = settings.hudSaved && settings.hudSaved[b.dataset.load];
      if (!s) { this.toast('LAYOUT ' + b.dataset.load + ' IS EMPTY'); return; }
      this.layout = Object.assign(clone(DEFAULT_LAYOUT), clone(s)); this.refresh(); this.toast('LOADED LAYOUT ' + b.dataset.load);
    }));
    // dragging (pointer events work for touch and mouse)
    const layer = document.getElementById('touchLayer');
    layer.addEventListener('pointerdown', e => this.down(e));
    // stop the browser from turning an editor drag into a scroll/pan (which cancels the pointer)
    const block = e => { if (this.active) e.preventDefault(); };
    layer.addEventListener('touchstart', block, { passive: false });
    layer.addEventListener('touchmove', block, { passive: false });
    addEventListener('pointermove', e => this.move(e));
    addEventListener('pointerup', e => this.up(e));
    addEventListener('pointercancel', e => this.up(e));
    this.active = false;
  }

  open() {
    this.layout = getLayout();
    this.active = true;
    document.body.classList.add('hud-editing');
    this.root.classList.remove('hidden');
    for (const id of ['hud', 'touchLayer']) document.getElementById(id).classList.remove('hidden');
    this.select(this.sel);
    this.renderSlots();
    this.refresh();
  }

  close(save) {
    if (save) { settings.hudLayout = clone(this.layout); saveSettings(); }
    this.active = false; this.drag = null;
    document.body.classList.remove('hud-editing');
    this.root.classList.add('hidden');
    document.querySelectorAll('.he-sel,.he-bad').forEach(e => e.classList.remove('he-sel', 'he-bad'));
    applyLayout();
    this.onClose && this.onClose(save);
  }

  idFromEl(el) {
    for (const id in ELEMENT) { const e = document.getElementById(ELEMENT[id]); if (e && (e === el || e.contains(el))) return id; }
    return null;
  }

  down(e) {
    if (!this.active) return;
    const id = this.idFromEl(e.target); if (!id || !isActive(id)) return;
    e.preventDefault();
    this.select(id);
    const l = this.layout[id];
    this.drag = { id, pid: e.pointerId, ox: e.clientX - l.x * innerWidth, oy: e.clientY - l.y * innerHeight, last: { x: l.x, y: l.y } };
  }
  move(e) {
    const d = this.drag; if (!this.active || !d || e.pointerId !== d.pid) return;
    const l = this.layout[d.id];
    const { w, h } = sizeOf(d.id, l);
    l.x = Math.min(innerWidth - w / 2, Math.max(w / 2, e.clientX - d.ox)) / innerWidth;
    l.y = Math.min(innerHeight - h / 2, Math.max(h / 2, e.clientY - d.oy)) / innerHeight;
    const hit = collision(d.id, l, this.layout);
    if (!hit) d.last = { x: l.x, y: l.y };
    this.showStatus(hit);
    applyLayout(this.layout, true);
    document.getElementById(ELEMENT[d.id]).classList.toggle('he-bad', !!hit);
  }
  up(e) {
    const d = this.drag; if (!this.active || !d || e.pointerId !== d.pid) return;
    if (e.type === 'pointerup') this.move(e); // apply the final finger position
    const l = this.layout[d.id];
    if (collision(d.id, l, this.layout)) { l.x = d.last.x; l.y = d.last.y; this.toast('CAN\'T OVERLAP — MOVED BACK'); }
    document.getElementById(ELEMENT[d.id]).classList.remove('he-bad');
    this.drag = null; this.showStatus(null); this.refresh();
  }

  setProp(k, v) {
    const l = this.layout[this.sel], before = l[k];
    l[k] = v;
    if (k === 's') {
      // keep resized control on-screen; refuse sizes that would cover another control
      const { w, h } = sizeOf(this.sel, l);
      l.x = Math.min(1 - w / 2 / innerWidth, Math.max(w / 2 / innerWidth, l.x));
      l.y = Math.min(1 - h / 2 / innerHeight, Math.max(h / 2 / innerHeight, l.y));
      const hit = collision(this.sel, l, this.layout);
      if (hit && v > before) { l[k] = before; this.$('heSize').value = before; this.toast('NO ROOM — WOULD COVER ' + hit); }
    }
    this.refresh();
  }

  select(id) {
    this.sel = id;
    document.querySelectorAll('.he-sel').forEach(e => e.classList.remove('he-sel'));
    document.getElementById(ELEMENT[id]).classList.add('he-sel');
    this.$('heName').textContent = CONTROLS[id].label;
    this.$('heSize').value = this.layout[id].s;
    this.$('heOpacity').value = this.layout[id].o;
    this.updateVals();
  }

  refresh() { applyLayout(this.layout, true); this.select(this.sel); }
  updateVals() {
    const l = this.layout[this.sel];
    this.$('heSizeV').textContent = Math.round(l.s * 100) + '%';
    this.$('heOpacityV').textContent = Math.round(l.o * 100) + '%';
  }
  renderSlots() {
    this.root.querySelectorAll('[data-load]').forEach(b => b.classList.toggle('empty', !(settings.hudSaved && settings.hudSaved[b.dataset.load])));
  }
  showStatus(hit) { const s = this.$('heStatus'); s.textContent = hit ? 'OVERLAPS ' + hit : 'DRAG TO MOVE · TAP TO SELECT'; s.classList.toggle('bad', !!hit); }
  toast(t) { const s = this.$('heToast'); s.textContent = t; s.classList.add('on'); clearTimeout(this._t); this._t = setTimeout(() => s.classList.remove('on'), 1400); }
}
