/**
 * Procedural particle textures. Generated once via canvas → DataTexture.
 * Cheaper and more reliable than shipping PNGs:
 *  - No CDN dependency
 *  - Single asset preload step
 *  - Exact look matches the game aesthetic
 *
 * Each texture is 128×128 RGBA, mipmapped, with anisotropy where useful.
 */
import * as THREE from 'three';

const SIZE = 128;
const _cache = {};

function _ctx() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c.getContext('2d');
}

function _toTex(canvasCtx) {
  const tex = new THREE.CanvasTexture(canvasCtx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Radial soft glow — bright center fading to alpha 0. */
function _makeGlow(color = '#ffffff') {
  const ctx = _ctx();
  const cx = SIZE / 2, cy = SIZE / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.5);
  g.addColorStop(0.00, color);
  g.addColorStop(0.25, color);
  g.addColorStop(0.55, color + '88');
  g.addColorStop(1.00, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return _toTex(ctx);
}

/** Spark — bright pinpoint core with cross-pattern flares. */
function _makeSpark(color = '#fff7a8') {
  const ctx = _ctx();
  const cx = SIZE / 2, cy = SIZE / 2;
  // Soft core
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.35);
  core.addColorStop(0.00, '#ffffff');
  core.addColorStop(0.20, color);
  core.addColorStop(1.00, color + '00');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Plus-shaped flare overlay
  ctx.globalCompositeOperation = 'lighter';
  const flare = ctx.createLinearGradient(0, cy, SIZE, cy);
  flare.addColorStop(0, color + '00');
  flare.addColorStop(0.5, '#ffffff');
  flare.addColorStop(1, color + '00');
  ctx.fillStyle = flare;
  ctx.fillRect(0, cy - 2, SIZE, 4);
  const flare2 = ctx.createLinearGradient(cx, 0, cx, SIZE);
  flare2.addColorStop(0, color + '00');
  flare2.addColorStop(0.5, '#ffffff');
  flare2.addColorStop(1, color + '00');
  ctx.fillStyle = flare2;
  ctx.fillRect(cx - 2, 0, 4, SIZE);
  ctx.globalCompositeOperation = 'source-over';
  return _toTex(ctx);
}

/** Smoke puff — irregular cloud blob with noise. */
function _makeSmoke(color = '#cfd4dc') {
  const ctx = _ctx();
  const img = ctx.createImageData(SIZE, SIZE);
  const cx = SIZE / 2, cy = SIZE / 2;
  // Color base
  const cR = parseInt(color.slice(1, 3), 16);
  const cG = parseInt(color.slice(3, 5), 16);
  const cB = parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - cx) / (SIZE * 0.45);
      const dy = (y - cy) / (SIZE * 0.45);
      const r = Math.sqrt(dx * dx + dy * dy);
      // Multi-octave noise for cloud feel
      const n = (Math.sin(x * 0.4) + Math.cos(y * 0.45) + Math.sin((x + y) * 0.31)) * 0.08;
      const falloff = Math.max(0, 1 - r + n);
      const alpha = Math.max(0, Math.min(1, Math.pow(falloff, 1.8)));
      const i = (y * SIZE + x) * 4;
      img.data[i + 0] = cR;
      img.data[i + 1] = cG;
      img.data[i + 2] = cB;
      img.data[i + 3] = Math.floor(alpha * 220);
    }
  }
  ctx.putImageData(img, 0, 0);
  return _toTex(ctx);
}

/** Ring — a thin glowing torus seen face-on. */
function _makeRing(color = '#ffe14a') {
  const ctx = _ctx();
  const cx = SIZE / 2, cy = SIZE / 2;
  const g = ctx.createRadialGradient(cx, cy, SIZE * 0.30, cx, cy, SIZE * 0.48);
  g.addColorStop(0.00, color + '00');
  g.addColorStop(0.45, color + '00');
  g.addColorStop(0.70, color + 'ff');
  g.addColorStop(0.85, color + 'aa');
  g.addColorStop(1.00, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return _toTex(ctx);
}

/** Shockwave — thick double-edge ring for explosions. */
function _makeShockwave(color = '#ffd078') {
  const ctx = _ctx();
  const cx = SIZE / 2, cy = SIZE / 2;
  // Outer wider band
  const g1 = ctx.createRadialGradient(cx, cy, SIZE * 0.30, cx, cy, SIZE * 0.50);
  g1.addColorStop(0.00, color + '00');
  g1.addColorStop(0.55, color + '00');
  g1.addColorStop(0.78, color + 'ff');
  g1.addColorStop(0.92, color + 'aa');
  g1.addColorStop(1.00, color + '00');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Inner thin hot edge
  ctx.globalCompositeOperation = 'lighter';
  const g2 = ctx.createRadialGradient(cx, cy, SIZE * 0.36, cx, cy, SIZE * 0.42);
  g2.addColorStop(0.00, '#ffffff00');
  g2.addColorStop(0.55, '#ffffffff');
  g2.addColorStop(1.00, '#ffffff00');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalCompositeOperation = 'source-over';
  return _toTex(ctx);
}

/** Multi-point flash star — hot white core with 6 long flares. */
function _makeFlashStar(color = '#fff4c8') {
  const ctx = _ctx();
  const cx = SIZE / 2, cy = SIZE / 2;
  // Hot soft core
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.30);
  core.addColorStop(0.00, '#ffffff');
  core.addColorStop(0.35, color);
  core.addColorStop(1.00, color + '00');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // 6 streaks rotated around center
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  for (let s = 0; s < 6; s++) {
    ctx.save();
    ctx.rotate((s * Math.PI) / 3);
    const lg = ctx.createLinearGradient(-SIZE * 0.48, 0, SIZE * 0.48, 0);
    lg.addColorStop(0.00, color + '00');
    lg.addColorStop(0.45, color + 'ff');
    lg.addColorStop(0.50, '#ffffff');
    lg.addColorStop(0.55, color + 'ff');
    lg.addColorStop(1.00, color + '00');
    ctx.fillStyle = lg;
    ctx.fillRect(-SIZE * 0.48, -1.5, SIZE * 0.96, 3);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return _toTex(ctx);
}

/** Woven web — radial spokes + concentric strands, slight noise jitter. */
function _makeWeb(color = '#e8f4ff') {
  const ctx = _ctx();
  const cx = SIZE / 2, cy = SIZE / 2;
  // Faint background haze so the disc reads at any zoom
  const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.50);
  haze.addColorStop(0.00, color + '40');
  haze.addColorStop(0.70, color + '20');
  haze.addColorStop(1.00, color + '00');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.lineCap = 'round';
  ctx.strokeStyle = color + 'd0';
  // 12 radial spokes
  ctx.lineWidth = 1.2;
  for (let s = 0; s < 12; s++) {
    const a = (s / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * SIZE * 0.48, cy + Math.sin(a) * SIZE * 0.48);
    ctx.stroke();
  }
  // 4 concentric loops with tiny sag between spokes (decagonal arcs)
  const rings = [0.15, 0.27, 0.38, 0.47];
  for (const rN of rings) {
    const r = SIZE * rN;
    ctx.beginPath();
    for (let s = 0; s <= 12; s++) {
      const a = (s / 12) * Math.PI * 2;
      const jitter = 1 - 0.06 * Math.sin(a * 3 + rN * 9);
      const px = cx + Math.cos(a) * r * jitter;
      const py = cy + Math.sin(a) * r * jitter;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Bright center node
  const node = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6);
  node.addColorStop(0, '#ffffff');
  node.addColorStop(1, color + '00');
  ctx.fillStyle = node;
  ctx.fillRect(cx - 8, cy - 8, 16, 16);
  return _toTex(ctx);
}

export function initParticleTextures() {
  if (_cache.glowWhite) return;
  _cache.glowWhite  = _makeGlow('#ffffff');
  _cache.glowCyan   = _makeGlow('#7fffd4');
  _cache.glowGold   = _makeGlow('#ffd24a');
  _cache.glowRed    = _makeGlow('#ff5555');
  _cache.sparkGold  = _makeSpark('#ffe14a');
  _cache.sparkCyan  = _makeSpark('#7fffe4');
  _cache.smokeGray  = _makeSmoke('#b8c0ca');
  _cache.smokeDark  = _makeSmoke('#3a3a44');
  _cache.ringGold   = _makeRing('#ffe14a');
  _cache.ringCyan   = _makeRing('#7fffd4');
  _cache.shockwave  = _makeShockwave('#ffd078');
  _cache.flashStar  = _makeFlashStar('#fff4c8');
  _cache.emberWarm  = _makeSpark('#ff9a3a');
  _cache.smokeWarm  = _makeSmoke('#6b4d3a');
  _cache.webBraid   = _makeWeb('#e8f4ff');
}

export function tex(name) {
  return _cache[name] || null;
}
