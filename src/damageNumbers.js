/**
 * Floating damage numbers. Pooled DOM divs, projected from world → screen each frame.
 * Cheap (no extra draw calls, no canvas overlay), and survives bloom/postFX since
 * they live above the canvas.
 */
import * as THREE from 'three';
import { state } from './state.js';

const POOL_SIZE = 64;
const LIFETIME = 0.7;
const RISE_UNITS = 32;   // px the number floats up over its lifetime

const _pool = [];
const _active = [];
let _layer = null;
const _projected = new THREE.Vector3();

export function initDamageNumbers() {
  if (_layer) return;
  _layer = document.createElement('div');
  _layer.id = 'dmg-layer';
  Object.assign(_layer.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '15',
    overflow: 'hidden', fontFamily: "'Courier New', monospace",
    fontWeight: 'bold', fontSize: '20px', userSelect: 'none',
  });
  document.body.appendChild(_layer);

  for (let i = 0; i < POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.willChange = 'transform, opacity';
    el.style.textShadow = '2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000';
    el.style.display = 'none';
    _layer.appendChild(el);
    _pool.push(el);
  }
}

/**
 * Spawn a damage number at a world position.
 * @param {THREE.Vector3} worldPos
 * @param {number} amount
 * @param {boolean} [crit]
 */
function _fmt(n) {
  const v = Math.round(n);
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000)    return (v / 1000).toFixed(1) + 'K';
  return v.toString();
}

export function spawnDamageNumber(worldPos, amount, crit = false) {
  if (!_layer) return;
  const el = _pool.pop();
  if (!el) return;
  el.textContent = _fmt(amount);
  el.style.color = crit ? '#ffe14a' : '#ffffff';
  el.style.fontSize = crit ? '30px' : '20px';
  el.style.fontWeight = crit ? '900' : 'bold';
  el.style.display = 'block';
  _active.push({
    el,
    x: worldPos.x, y: worldPos.y + 1.5, z: worldPos.z,
    drift: (Math.random() - 0.5) * 24,   // horizontal jitter px
    t: 0,
  });
}

export function updateDamageNumbers(dt) {
  if (!_layer || !state.camera) return;
  const cam = state.camera;
  const W = window.innerWidth, H = window.innerHeight;
  for (let i = _active.length - 1; i >= 0; i--) {
    const d = _active[i];
    d.t += dt;
    if (d.t >= LIFETIME) {
      d.el.style.display = 'none';
      _pool.push(d.el);
      _active.splice(i, 1);
      continue;
    }
    const k = d.t / LIFETIME;
    _projected.set(d.x, d.y, d.z).project(cam);
    const sx = (_projected.x * 0.5 + 0.5) * W + d.drift * k;
    const sy = (-_projected.y * 0.5 + 0.5) * H - RISE_UNITS * k;
    d.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
    d.el.style.opacity = (1 - k * k).toFixed(3);
  }
}
