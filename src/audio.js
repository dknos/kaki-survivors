/**
 * Procedural audio via Web Audio API. Minimal: no audio files needed.
 * Patterns adapted from original game's audio synth helpers.
 */

let _ctx = null;
let _master = null;
let _enabled = true;

function ensureCtx() {
  if (_ctx) return _ctx;
  _ctx = new (window.AudioContext || window.webkitAudioContext)();
  _master = _ctx.createGain();
  _master.gain.value = 0.45;
  _master.connect(_ctx.destination);
  return _ctx;
}

/** Resume audio context on first user gesture (required by browsers). */
export function unlockAudio() {
  const ctx = ensureCtx();
  if (ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  if (_master) _master.gain.value = Math.max(0, Math.min(1, v));
}

export function setEnabled(b) { _enabled = !!b; }

/** Short tone. f=Hz, dur=sec, type=osc type, vol=0..1 */
function tone(f, dur, type = 'square', vol = 0.5) {
  if (!_enabled) return;
  const ctx = ensureCtx();
  if (ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(_master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Frequency sweep (e.g. for shoots, pickups). */
function sweep(fStart, fEnd, dur, type = 'square', vol = 0.4) {
  if (!_enabled) return;
  const ctx = ensureCtx();
  if (ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fStart, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, fEnd), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(_master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Brief noise burst (hits, explosions). */
function noiseBurst(dur, vol = 0.4, lowpass = 1200) {
  if (!_enabled) return;
  const ctx = ensureCtx();
  if (ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = lowpass;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(_master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ── Public sfx ────────────────────────────────────────────────────────────────
export const sfx = {
  shoot:    () => sweep(880, 220, 0.10, 'square', 0.20),
  hit:      () => { tone(180, 0.08, 'square', 0.35); noiseBurst(0.06, 0.25, 800); },
  pickup:   () => sweep(660, 1320, 0.08, 'triangle', 0.30),
  levelUp:  () => { sweep(330, 880, 0.18, 'triangle', 0.45); setTimeout(()=>sweep(440,1320,0.18,'triangle',0.45), 70); },
  heroHit:  () => { sweep(440, 110, 0.18, 'sawtooth', 0.45); noiseBurst(0.10, 0.30, 600); },
  death:    () => { sweep(330, 60, 0.6, 'sawtooth', 0.55); noiseBurst(0.5, 0.35, 400); },
  explosion:() => { noiseBurst(0.25, 0.50, 500); sweep(220, 60, 0.25, 'sawtooth', 0.40); },
  victory:  () => {
    // Triumphant arpeggio
    const notes = [392, 523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => sweep(f * 0.5, f, 0.25, 'triangle', 0.5), i * 100));
    setTimeout(() => sweep(1047, 1568, 0.6, 'triangle', 0.6), 600);
  },
  bossWarn: () => {
    [220, 220, 220].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'sawtooth', 0.4), i * 180));
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Procedural music: a bass-drone loop that ramps intensity with difficulty.
// One oscillator per voice, scheduled in 8-beat bars at ~110bpm.
// ─────────────────────────────────────────────────────────────────────────────
let _musicPlaying = false;
let _musicTier = 0;            // 0=calm, 1=combat, 2=boss
let _musicTimer = null;
let _beat = 0;

// Pentatonic minor in A — guaranteed not-sour. Bass notes drive the loop.
const A_MINOR_PENT = [110, 131, 147, 165, 196, 220, 262, 294]; // A2..D4

function playNote(f, dur, type, vol) {
  if (!_enabled || !_ctx) return;
  if (_ctx.state !== 'running') return;
  const t = _ctx.currentTime;
  const osc = _ctx.createOscillator();
  const g = _ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(_master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function _musicStep() {
  if (!_musicPlaying) return;
  const tier = _musicTier;
  // Beat 0 of each bar: bass root pulse
  if (_beat % 8 === 0) {
    playNote(A_MINOR_PENT[0], 0.45, 'sawtooth', 0.10 + tier * 0.05);
  }
  // Beat 4: fifth
  if (_beat % 8 === 4) {
    playNote(A_MINOR_PENT[4], 0.35, 'sawtooth', 0.08 + tier * 0.05);
  }
  // Combat tier+ : melody on every odd beat
  if (tier >= 1 && _beat % 2 === 1) {
    const pick = A_MINOR_PENT[3 + ((_beat * 7) % 5)];
    playNote(pick, 0.20, 'triangle', 0.05 + tier * 0.04);
  }
  // Boss tier: low rumble on every beat
  if (tier >= 2) {
    playNote(55, 0.30, 'sawtooth', 0.10);
    if (_beat % 4 === 2) playNote(A_MINOR_PENT[1] * 2, 0.18, 'square', 0.07);
  }
  _beat++;
}

export function startMusic() {
  if (_musicPlaying) return;
  ensureCtx();
  _musicPlaying = true;
  _beat = 0;
  const bpm = 110;
  const stepMs = (60 / bpm) * 1000 / 2;  // 8th notes
  _musicTimer = setInterval(_musicStep, stepMs);
}

export function stopMusic() {
  _musicPlaying = false;
  if (_musicTimer) { clearInterval(_musicTimer); _musicTimer = null; }
}

/** tier: 0=calm, 1=combat, 2=boss */
export function setMusicTier(tier) {
  _musicTier = Math.max(0, Math.min(2, tier | 0));
}
