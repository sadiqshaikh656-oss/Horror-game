// HUD (compass, minimap, round bar, kill feed, crosshair, health, ammo, slots) + menus & settings.
import { settings, OPTIONS, PRESETS, PRESET_NAMES, PRESET_LABELS, applyPreset, setGraphicsOption, saveSettings } from './settings.js';
import { WEAPONS, SLOTS } from './weapons.js';
import { ARENA } from './world.js';
import { playUI, setMasterVolume } from './audio.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.buildCompass();
    this.mm = $('minimap').getContext('2d');
    this.healthShown = 100;
    this.hitT = 0; this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    this.feed = [];
    this.buildSettings();
    this.bindMenus();
  }

  // ---------- compass ----------
  buildCompass() {
    const strip = $('compassStrip');
    const px = 3; this.compassPx = px; // pixels per degree
    let html = '';
    for (let d = -180; d <= 540; d += 5) {
      const deg = ((d % 360) + 360) % 360;
      const x = (d + 180) * px;
      const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg];
      if (card) html += `<span class="card ${deg === 0 ? 'n' : ''}" style="left:${x}px">${card}</span>`;
      else if (deg % 15 === 0) html += `<span style="left:${x}px">${deg}</span>`;
      html += `<i style="left:${x}px;height:${deg % 15 === 0 ? 8 : 4}px"></i>`;
    }
    strip.innerHTML = html;
  }

  // ---------- minimap ----------
  buildMinimapBase(world) {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'); const k = S / (ARENA * 2);
    x.fillStyle = '#2b2d2e'; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i <= ARENA * 2; i += 6) { x.beginPath(); x.moveTo(i * k, 0); x.lineTo(i * k, S); x.moveTo(0, i * k); x.lineTo(S, i * k); x.stroke(); }
    for (const col of world.colliders) {
      const h = col.max.y;
      x.fillStyle = col.surface === 'concrete' ? (h > 3 ? '#77736d' : '#8e8a82') : col.surface === 'wood' ? '#7a5a3a' : (h > 2.5 ? '#5d6b78' : '#4f5d68');
      x.fillRect((col.min.x + ARENA) * k, (col.min.z + ARENA) * k, (col.max.x - col.min.x) * k, (col.max.z - col.min.z) * k);
    }
    for (const p of world.pickups) { x.fillStyle = p.type === 'health' ? '#5cff8a' : '#ffc640'; x.beginPath(); x.arc((p.pos.x + ARENA) * k, (p.pos.z + ARENA) * k, 4, 0, 7); x.fill(); }
    this.mmBase = c; this.mmK = k;
  }

  drawMinimap() {
    const g = this.game, P = g.player, ctx = this.mm, W = 300, scale = 3.6; // px per metre on the 300px canvas
    const k = this.mmK;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(P.yaw);
    ctx.scale(scale / k, scale / k);
    ctx.translate(-(P.pos.x + ARENA) * k, -(P.pos.z + ARENA) * k);
    ctx.drawImage(this.mmBase, 0, 0);
    // spotted enemies
    for (const e of g.enemies) {
      if (!e.alive || e.spottedT <= 0) continue;
      ctx.fillStyle = `rgba(255,70,60,${Math.min(1, e.spottedT)})`;
      ctx.beginPath(); ctx.arc((e.pos.x + ARENA) * k, (e.pos.z + ARENA) * k, 9 * k / scale * 1.0, 0, 7); ctx.fill();
    }
    ctx.restore();
    // player arrow + view cone
    ctx.save(); ctx.translate(W / 2, W / 2);
    const fov = g.camera.fov * Math.PI / 180 * g.camera.aspect * 0.5;
    const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 120);
    grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 120, -Math.PI / 2 - fov / 2, -Math.PI / 2 + fov / 2); ctx.fill();
    ctx.fillStyle = '#ffcf4a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  // ---------- per-frame HUD ----------
  update(dt) {
    const g = this.game, P = g.player, vm = g.vm, c = vm.cfg, a = vm.ammo;
    // compass: yaw 0 looks toward -Z, which we call north
    const heading = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360;
    $('compassStrip').style.transform = `translateX(${170 - (heading + 180) * this.compassPx}px)`;
    this.drawMinimap();
    // health
    const hp = Math.max(0, P.health);
    $('healthFill').style.width = hp + '%';
    $('healthLag').style.width = hp + '%';
    $('healthNum').textContent = Math.ceil(hp);
    $('healthBar').classList.toggle('low', hp < 30);
    $('armorBar').firstElementChild.style.width = P.armor + '%';
    $('damageVignette').style.opacity = Math.min(1, Math.max(0, (45 - hp) / 45) * 0.8 + g.hurtFlash);
    // ammo
    $('mag').textContent = a.mag; $('reserve').textContent = a.reserve;
    $('mag').classList.toggle('low', a.mag <= Math.ceil(c.mag * 0.2));
    $('wname').textContent = c.name; $('wtype').textContent = c.type + (c.auto ? ' · AUTO' : ' · SEMI');
    $('reloadHint').classList.toggle('on', a.mag === 0 && !vm.reloading);
    const rr = $('reloadRing');
    if (vm.reloading) {
      rr.classList.add('on');
      const [s, e] = c.clips[vm.clipName];
      $('reloadArc').style.strokeDashoffset = 106.8 * (1 - Math.min(1, (vm.t - s) / ((e - s) * c.reloadAt[vm.clipName])));
    } else rr.classList.remove('on');
    document.querySelectorAll('.slot').forEach((el) => {
      const id = SLOTS[+el.dataset.i];
      el.classList.toggle('on', id === (vm.pendingId || vm.currentId));
      el.querySelector('.ammo').textContent = vm.state[id].mag;
    });
    // crosshair spread
    const ch = $('crosshair');
    const spreadPx = g.currentSpread() * innerHeight / (2 * Math.tan(g.camera.fov * Math.PI / 360));
    const gap = 4 + spreadPx;
    ch.children[0].style.transform = `translateX(${-gap - 9}px)`; ch.children[1].style.transform = `translateX(${gap}px)`;
    ch.children[2].style.transform = `translateY(${-gap - 9}px)`; ch.children[3].style.transform = `translateY(${gap}px)`;
    ch.style.opacity = vm.ads > 0.6 || P.sprinting ? 0 : 1; // aiming down sights: the optic's reticle is the aim
    // hitmarker
    if (this.hitT > 0) { this.hitT -= dt; $('hitmarker').style.opacity = Math.min(1, this.hitT * 5); }
    // hurt direction arcs
    const hd = $('hurtDirs');
    P.hurtDirs = P.hurtDirs.filter(h => (h.t -= dt) > 0);
    while (hd.children.length < P.hurtDirs.length) { const d = document.createElement('div'); d.className = 'hurt'; hd.appendChild(d); }
    while (hd.children.length > P.hurtDirs.length) hd.lastChild.remove();
    P.hurtDirs.forEach((h, i) => {
      const rel = h.ang - Math.atan2(-Math.sin(P.yaw), -Math.cos(P.yaw));
      hd.children[i].style.transform = `rotate(${-rel}rad)`;
      hd.children[i].style.opacity = Math.min(1, h.t);
    });
    // round bar
    $('kills').textContent = g.stats.kills;
    $('alive').textContent = g.enemies.filter(e => e.alive).length;
    const t = Math.max(0, Math.ceil(g.roundTime));
    $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('timer').parentElement.classList.toggle('low', t <= 15);
    $('roundLabel').textContent = 'ROUND ' + g.round;
    // fps
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT > 0.5) { $('fps').textContent = Math.round(this.fpsN / this.fpsT) + ' FPS'; this.fpsT = 0; this.fpsN = 0; }
    $('fps').classList.toggle('hidden', !settings.graphics.showFps);
    if (!$('scoreboard').classList.contains('hidden')) this.renderScoreboard();
  }

  hitmarker(kind) {
    const h = $('hitmarker'); h.className = kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : '';
    this.hitT = kind === 'kill' ? 0.45 : 0.25; h.style.opacity = 1;
  }

  killNotice(name, head) {
    const k = $('killIcon'); $('killText').textContent = head ? 'HEADSHOT · ' + name : 'ELIMINATED · ' + name;
    k.classList.remove('show'); void k.offsetWidth; k.classList.add('show');
  }

  killfeed(attacker, victim, weaponId, head, bad = false) {
    const f = $('killfeed');
    const el = document.createElement('div'); el.className = 'kf' + (bad ? ' bad' : '');
    el.innerHTML = `<span class="a">${attacker}</span><svg viewBox="0 0 120 40"><use href="#ic-${weaponId}"/></svg>${head ? '<span class="hs">◎</span>' : ''}<span class="v">${victim}</span>`;
    f.prepend(el);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => el.remove(), 6000);
  }

  pickup(text) { const p = $('pickupMsg'); p.textContent = text; p.style.opacity = 1; clearTimeout(this._pk); this._pk = setTimeout(() => p.style.opacity = 0, 1500); }

  banner(small, big, ms = 2600) {
    const b = $('banner'); $('bannerSmall').textContent = small; $('bannerBig').textContent = big;
    b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this._bn); this._bn = setTimeout(() => b.classList.add('hidden'), ms);
  }

  showScoreboard(on) { $('scoreboard').classList.toggle('hidden', !on); if (on) this.renderScoreboard(); }
  renderScoreboard() {
    const g = this.game, s = g.stats;
    const hs = s.kills ? Math.round(s.headshots / s.kills * 100) : 0, acc = s.shots ? Math.round(s.hits / s.shots * 100) : 0;
    $('sbYou').innerHTML = `<span>YOU</span><span>${s.kills}</span><span>${s.deaths}</span><span>${hs}%</span><span>${acc}%</span><span>${s.score}</span>`;
    $('sbEnemies').innerHTML = g.enemies.map(e => `<div class="sbRow enemy ${e.alive ? '' : 'dead'}"><span>${e.name}</span><span>${e.kills || 0}</span><span>${e.alive ? 0 : 1}</span><span>-</span><span>-</span><span>${e.alive ? Math.ceil(e.health) + ' HP' : 'KIA'}</span></div>`).join('');
  }

  // ---------- menus ----------
  bindMenus() {
    const g = this.game;
    const tap = (id, fn) => $(id).addEventListener('click', () => { playUI('tap'); fn(); });
    tap('mSettings', () => this.openSettings('graphics'));
    tap('mGraphics', () => this.openSettings('graphics'));
    tap('mControls', () => this.openSettings('controls'));
    tap('setClose', () => this.closeSettings());
    tap('pResume', () => g.resume());
    tap('pSettings', () => this.openSettings('graphics'));
    tap('pQuit', () => g.toLobby());
    tap('dRetry', () => g.startMatch());
    tap('dLobby', () => g.toLobby());
    $('playBtn').addEventListener('click', () => { playUI('start'); g.startMatch(); });
    document.querySelectorAll('#diffSeg button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#diffSeg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      g.difficulty = +b.dataset.d; playUI('tap');
    }));
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    this.refreshMenuStats();
  }

  refreshMenuStats() {
    const p = this.game.profile;
    $('mBest').textContent = p.bestRound; $('mKills').textContent = p.totalKills;
    const ranks = [[0, 'RECRUIT'], [10, 'PRIVATE'], [30, 'CORPORAL'], [70, 'SERGEANT'], [150, 'LIEUTENANT'], [300, 'CAPTAIN'], [600, 'MAJOR'], [1000, 'COMMANDER']];
    $('mRank').textContent = ranks.filter(r => p.totalKills >= r[0]).pop()[1];
    $('mPreset').textContent = (PRESET_LABELS[settings.preset] || 'CUSTOM').toUpperCase();
  }

  openSettings(tab) { $('settings').classList.remove('hidden'); this.showTab(tab); this.renderSettings(); }
  closeSettings() { $('settings').classList.add('hidden'); saveSettings(); this.refreshMenuStats(); }
  showTab(t) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    for (const n of ['graphics', 'controls', 'audio']) $('tab-' + n).classList.toggle('hidden', n !== t);
  }

  buildSettings() {
    // preset cards
    const pr = $('presetRow');
    pr.innerHTML = PRESET_NAMES.map((n, i) => `<button class="preset ${n === 'cinematic' ? 'cine' : ''}" data-p="${n}"><div class="bars">${[0, 1, 2, 3, 4].map(k => `<i class="${k <= i ? 'f' : ''}" style="height:${5 + k * 3}px"></i>`).join('')}</div><b>${PRESET_LABELS[n].toUpperCase()}</b><small>${['Battery saver', 'Balanced', 'HD', 'Ultra HD', 'Max fidelity'][i]}</small></button>`).join('');
    pr.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => { playUI('tap'); applyPreset(b.dataset.p); this.renderSettings(); this.game.applyGraphics(); }));
    // graphics options
    const order = ['fpsLimit', 'renderScale', 'shadows', 'antiAliasing', 'ambientOcclusion', 'reflections', 'textures', 'propDetail', 'viewDistance', 'effects', 'bloom', 'postFx', 'lensFlare', 'showFps'];
    $('gfxList').innerHTML = order.map(k => `<div class="optRow"><label>${OPTIONS[k].label}</label><div class="seg" data-k="${k}">${OPTIONS[k].values.map((v, i) => `<button data-i="${i}">${v.toUpperCase()}</button>`).join('')}</div></div>`).join('');
    $('gfxList').querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      playUI('tap'); setGraphicsOption(seg.dataset.k, +b.dataset.i); this.renderSettings();
      if (seg.dataset.k !== 'showFps' && seg.dataset.k !== 'fpsLimit') this.game.applyGraphics();
    }));
    // controls
    const slider = (key, label, min, max, step, obj, fmt = v => v.toFixed(2)) => `<div class="optRow"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" data-o="${obj}" data-k="${key}"><span class="val" data-v="${key}"></span></div>`;
    const toggle = (key, label, obj) => `<div class="optRow"><label>${label}</label><div class="seg" data-o="${obj}" data-tk="${key}" style="flex:0 1 200px"><button data-i="0">OFF</button><button data-i="1">ON</button></div></div>`;
    $('ctlList').innerHTML = slider('sensitivity', 'Look Sensitivity', 0.2, 3, 0.05, 'controls') + slider('adsSensitivity', 'ADS / Scope Sensitivity', 0.2, 1.5, 0.05, 'controls') + slider('fov', 'Field of View', 60, 100, 1, 'controls') + toggle('invertY', 'Invert Look', 'controls') + toggle('leftFire', 'Left Fire Button (touch)', 'controls') +
      `<div class="optRow"><label>Touch HUD Layout</label><button class="hudBtn" id="openHud">CUSTOMIZE HUD LAYOUT</button></div>
       <div class="optHint">KEYBOARD: WASD move · SHIFT sprint · SPACE jump / climb · C crouch · R reload · F inspect · 1/2/3 weapons · RMB aim · TAB scores · ESC pause</div>
       <div class="optHint">TOUCH: left side = move stick (push to top to lock sprint) · drag right side to look · fire buttons also steer</div>`;
    $('openHud').addEventListener('click', () => { playUI('tap'); this.onOpenHud && this.onOpenHud(); });
    $('audList').innerHTML = slider('master', 'Master Volume', 0, 1, 0.05, 'audio') + slider('sfx', 'Effects Volume', 0, 1, 0.05, 'audio');
    for (const list of ['ctlList', 'audList']) {
      $(list).querySelectorAll('input[type=range]').forEach(inp => inp.addEventListener('input', () => {
        settings[inp.dataset.o][inp.dataset.k] = +inp.value; this.renderSettings();
        if (inp.dataset.k === 'master') setMasterVolume(+inp.value);
        if (inp.dataset.k === 'fov') this.game.applyFov();
        saveSettings();
      }));
      $(list).querySelectorAll('.seg[data-tk]').forEach(seg => seg.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        settings[seg.dataset.o][seg.dataset.tk] = b.dataset.i === '1'; playUI('tap'); this.renderSettings(); saveSettings(); this.game.applyControls();
      }));
    }
  }

  renderSettings() {
    document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.p === settings.preset));
    $('gfxList').querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.i === settings.graphics[seg.dataset.k])));
    document.querySelectorAll('input[type=range][data-o]').forEach(inp => {
      const v = settings[inp.dataset.o][inp.dataset.k]; inp.value = v;
      const out = document.querySelector(`[data-v="${inp.dataset.k}"]`); if (out) out.textContent = inp.dataset.k === 'fov' ? v : (inp.dataset.o === 'audio' ? Math.round(v * 100) : v.toFixed(2));
    });
    document.querySelectorAll('.seg[data-tk]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.i === '1') === !!settings[seg.dataset.o][seg.dataset.tk])));
  }

  setLoading(p, text) { $('loadFill').style.width = (p * 100).toFixed(0) + '%'; $('loadText').textContent = text || `LOADING ASSETS ${(p * 100).toFixed(0)}%`; }
  hideLoading() { const l = $('loading'); l.style.opacity = 0; setTimeout(() => l.classList.add('hidden'), 600); }

  showDeath(win, stats, round) {
    $('death').classList.remove('hidden');
    const t = $('deathTitle'); t.textContent = win ? 'MISSION COMPLETE' : 'YOU WERE ELIMINATED'; t.classList.toggle('win', win);
    const hs = stats.kills ? Math.round(stats.headshots / stats.kills * 100) : 0, acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
    $('deathStats').innerHTML = [['ROUND', round], ['KILLS', stats.kills], ['SCORE', stats.score], ['HEADSHOT %', hs + '%'], ['ACCURACY', acc + '%'], ['DAMAGE', Math.round(stats.damage)]]
      .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  }
}
