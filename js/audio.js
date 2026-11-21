// Fully synthesized sound (no audio files): gunshots, mechanical clicks, footsteps, UI.
import { settings } from './settings.js';

let ctx = null, master = null, reverb = null, reverbGain = null, noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.audio.master;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  // Outdoor slap-back reverb from a generated impulse response.
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 1.6;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const slap = (t > 0.09 && t < 0.13) ? 0.6 : 1;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * slap;
    }
  }
  reverb.buffer = ir;
  reverbGain = ctx.createGain(); reverbGain.gain.value = 0.28;
  reverb.connect(reverbGain); reverbGain.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
}

export function setMasterVolume(v) { if (master) master.gain.value = v; }

function out(pan, dist) {
  // Returns a node to connect a voice to, with optional stereo pan + distance falloff.
  const g = ctx.createGain();
  const vol = settings.audio.sfx * (dist == null ? 1 : 1 / (1 + dist * 0.06));
  g.gain.value = vol;
  let node = g;
  if (pan != null && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(master); p.connect(reverb);
  } else { g.connect(master); g.connect(reverb); }
  return node;
}

function noise(dest, t, dur, type, freq, q, gain, attack = 0.001) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  return f;
}

function tone(dest, t, dur, f0, f1, gain, type = 'sine') {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
}

const GUN_VOICES = {
  pistol:  { crack: 2600, body: 900, thump: 140, len: 0.22, gain: 0.9 },
  smg:     { crack: 3200, body: 1200, thump: 120, len: 0.18, gain: 0.75 },
  carbine: { crack: 2100, body: 700, thump: 95, len: 0.32, gain: 1.0 },
  enemy:   { crack: 2300, body: 800, thump: 110, len: 0.3, gain: 0.8 },
};

export function playGunshot(kind, pan = 0, dist = null) {
  if (!ctx) return;
  const v = GUN_VOICES[kind] || GUN_VOICES.carbine;
  const t = ctx.currentTime;
  const d = out(pan, dist);
  const far = dist != null && dist > 20;
  noise(d, t, 0.05, 'highpass', v.crack, 0.7, far ? 0.25 : v.gain);
  noise(d, t, v.len, 'bandpass', far ? v.body * 0.6 : v.body, 0.9, v.gain * 0.9);
  tone(d, t, v.len * 0.8, v.thump * 1.8, v.thump * 0.5, v.gain * 0.9);
  noise(d, t + 0.02, v.len * 2.2, 'lowpass', 500, 0.5, v.gain * 0.25, 0.02);
}

export function playClick(kind = 'mag', delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const d = out(0.2);
  if (kind === 'mag') { noise(d, t, 0.06, 'bandpass', 1800, 3, 0.5); tone(d, t, 0.05, 600, 300, 0.2, 'square'); }
  else if (kind === 'slide') { noise(d, t, 0.09, 'bandpass', 3000, 2, 0.5); noise(d, t + 0.08, 0.06, 'bandpass', 2200, 4, 0.5); }
  else if (kind === 'dry') { noise(d, t, 0.03, 'highpass', 4000, 2, 0.4); }
  else if (kind === 'draw') { noise(d, t, 0.18, 'bandpass', 1400, 1.5, 0.25, 0.03); noise(d, t + 0.15, 0.04, 'bandpass', 2600, 3, 0.35); }
}

export function playFootstep(sprint) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const d = out((Math.random() - 0.5) * 0.3);
  noise(d, t, sprint ? 0.12 : 0.09, 'lowpass', 700 + Math.random() * 300, 1, sprint ? 0.35 : 0.2);
  noise(d, t, 0.04, 'highpass', 3000, 1, 0.05);
}

export function playLand() {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(0);
  noise(d, t, 0.18, 'lowpass', 400, 1, 0.5); tone(d, t, 0.15, 90, 50, 0.4);
}

export function playHit(head) {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(0);
  if (head) { tone(d, t, 0.25, 1900, 1700, 0.35, 'triangle'); tone(d, t, 0.2, 2850, 2600, 0.15, 'sine'); }
  else { noise(d, t, 0.05, 'bandpass', 2500, 4, 0.5); tone(d, t, 0.04, 1200, 900, 0.15, 'square'); }
}

export function playKill() {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(0);
  tone(d, t, 0.12, 700, 700, 0.18, 'triangle'); tone(d, t + 0.09, 0.25, 1050, 1050, 0.18, 'triangle');
}

export function playHurt() {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(0);
  noise(d, t, 0.2, 'lowpass', 300, 1, 0.6); tone(d, t, 0.2, 120, 60, 0.4);
}

export function playImpact(pan, dist) {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(pan, dist);
  noise(d, t, 0.05, 'bandpass', 3500 + Math.random() * 2000, 3, 0.25);
}

export function playWhiz(pan) {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(pan);
  noise(d, t, 0.12, 'bandpass', 5000, 6, 0.3, 0.04);
}

export function playUI(kind = 'tap') {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(0);
  if (kind === 'tap') tone(d, t, 0.06, 1400, 1100, 0.08, 'triangle');
  else if (kind === 'start') { tone(d, t, 0.2, 400, 800, 0.15, 'sawtooth'); tone(d, t + 0.12, 0.35, 800, 800, 0.12, 'triangle'); }
  else if (kind === 'round') { tone(d, t, 0.5, 220, 220, 0.18, 'sawtooth'); tone(d, t, 0.5, 330, 330, 0.12, 'sawtooth'); }
  else if (kind === 'pickup') { tone(d, t, 0.1, 900, 1300, 0.15, 'triangle'); tone(d, t + 0.08, 0.15, 1300, 1800, 0.12, 'triangle'); }
}

export function playClimb() {
  if (!ctx) return;
  const t = ctx.currentTime; const d = out(0);
  noise(d, t, 0.12, 'bandpass', 900, 1.2, 0.35); noise(d, t + 0.25, 0.1, 'lowpass', 600, 1, 0.3);
  tone(d, t + 0.25, 0.1, 140, 70, 0.25);
}
