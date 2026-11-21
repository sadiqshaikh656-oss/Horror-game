// Graphics / control / audio settings with PUBG-style quality presets.
// Every option is an index into the matching OPTIONS list so the UI can be generated.

export const OPTIONS = {
  renderScale:  { label: 'Render Resolution', values: ['50%', '65%', '80%', '100%', '125%'], num: [0.5, 0.65, 0.8, 1.0, 1.25] },
  shadows:      { label: 'Shadow Quality', values: ['Off', 'Low', 'Medium', 'High', 'Ultra'] },
  antiAliasing: { label: 'Anti-Aliasing', values: ['Off', 'FXAA', 'SMAA', 'MSAA 4x'] },
  ambientOcclusion: { label: 'Ambient Occlusion', values: ['Off', 'GTAO', 'GTAO High'] },
  reflections:  { label: 'Reflections', values: ['Off', 'Environment', 'Planar', 'Planar Ultra'] },
  textures:     { label: 'Texture Quality', values: ['Low', 'Medium', 'High', 'Ultra'] },
  propDensity:  { label: 'Prop Quality', values: ['Low', 'Medium', 'High', 'Ultra'] },
  propDetail:   { label: 'Prop Structure', values: ['Low', 'Medium', 'High', 'Ultra'] },
  viewDistance: { label: 'View Distance', values: ['Near', 'Medium', 'Far', 'Epic'] },
  effects:      { label: 'Effects Quality', values: ['Low', 'Medium', 'High', 'Ultra'] },
  bloom:        { label: 'Bloom', values: ['Off', 'On', 'Cinematic'] },
  postFx:       { label: 'Post Processing', values: ['Off', 'Standard', 'Filmic', 'Cinematic'] },
  lensFlare:    { label: 'Sun Lens Flare', values: ['Off', 'On'] },
  fpsLimit:     { label: 'Frame Rate', values: ['30', '60', '90', '120', 'Max'], num: [30, 60, 90, 120, 1000] },
  showFps:      { label: 'Show FPS', values: ['Off', 'On'] },
};

export const PRESET_NAMES = ['low', 'medium', 'high', 'ultra', 'cinematic'];
export const PRESET_LABELS = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', cinematic: 'Cinematic' };

export const PRESETS = {
  low:       { renderScale: 1, shadows: 0, antiAliasing: 0, ambientOcclusion: 0, reflections: 0, textures: 0, propDensity: 0, propDetail: 0, viewDistance: 0, effects: 0, bloom: 0, postFx: 0, lensFlare: 0 },
  medium:    { renderScale: 2, shadows: 1, antiAliasing: 1, ambientOcclusion: 0, reflections: 1, textures: 1, propDensity: 1, propDetail: 1, viewDistance: 1, effects: 1, bloom: 1, postFx: 1, lensFlare: 0 },
  high:      { renderScale: 2, shadows: 2, antiAliasing: 1, ambientOcclusion: 1, reflections: 2, textures: 2, propDensity: 2, propDetail: 2, viewDistance: 2, effects: 2, bloom: 1, postFx: 2, lensFlare: 1 },
  ultra:     { renderScale: 3, shadows: 3, antiAliasing: 2, ambientOcclusion: 1, reflections: 2, textures: 3, propDensity: 3, propDetail: 3, viewDistance: 3, effects: 3, bloom: 1, postFx: 2, lensFlare: 1 },
  cinematic: { renderScale: 3, shadows: 4, antiAliasing: 3, ambientOcclusion: 2, reflections: 3, textures: 3, propDensity: 3, propDetail: 3, viewDistance: 3, effects: 3, bloom: 2, postFx: 3, lensFlare: 1 },
};

const DEFAULTS = {
  preset: 'medium',
  graphics: { ...PRESETS.medium, fpsLimit: 1, showFps: 1 },
  controls: { sensitivity: 1.0, adsSensitivity: 0.7, fov: 78, invertY: false, autoFire: false, leftFire: true, gyro: false },
  audio: { master: 0.8, sfx: 1.0 },
  hudLayout: null,
  hudSaved: {},
};

const KEY = 'ironyard.settings.v1';

function clone(o) { return JSON.parse(JSON.stringify(o)); }

export const settings = load();

function load() {
  const s = clone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.preset) s.preset = d.preset;
      Object.assign(s.graphics, d.graphics || {});
      Object.assign(s.controls, d.controls || {});
      Object.assign(s.audio, d.audio || {});
      if (d.hudLayout) s.hudLayout = d.hudLayout;   // customised touch HUD (js/hudlayout.js)
      if (d.hudSaved) s.hudSaved = d.hudSaved;      // Save/Load layout slots 1-3
    } else {
      // First launch: pick a sensible preset for the device.
      s.preset = guessPreset();
      Object.assign(s.graphics, PRESETS[s.preset]);
    }
  } catch (e) { /* storage unavailable: defaults */ }
  const match = PRESET_NAMES.find(p => Object.keys(PRESETS[p]).every(k => PRESETS[p][k] === s.graphics[k]));
  s.preset = match || 'custom';
  return s;
}

function guessPreset() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory || 4;
  if (touch) return mem >= 8 ? 'high' : 'medium';
  return 'ultra';
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function applyPreset(name) {
  settings.preset = name;
  Object.assign(settings.graphics, PRESETS[name]);
  saveSettings();
}

export function setGraphicsOption(key, idx) {
  settings.graphics[key] = idx;
  // Any manual tweak of a preset-controlled option turns the preset into "custom".
  if (key in PRESETS.low) {
    const match = PRESET_NAMES.find(p => Object.keys(PRESETS[p]).every(k => PRESETS[p][k] === settings.graphics[k]));
    settings.preset = match || 'custom';
  }
  saveSettings();
}

export function gnum(key) {
  const o = OPTIONS[key];
  const i = settings.graphics[key];
  return o.num ? o.num[i] : i;
}
