/**
 * Input: keyboard (WASD + arrow keys) and touch joystick (left half of screen).
 * Writes into state.input.moveVec each frame via sampleInput().
 */
import { state } from './state.js';

const _keys = Object.create(null);
const _touch = {
  active: false,
  id: -1,
  originX: 0,
  originY: 0,
  curX: 0,
  curY: 0,
};
const TOUCH_MAX_RADIUS = 60;

let _initialized = false;

export function initInput() {
  if (_initialized) return;
  _initialized = true;

  // ── Keyboard ──
  window.addEventListener('keydown', (e) => {
    _keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => {
    _keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    for (const k in _keys) _keys[k] = false;
  });

  // ── Touch joystick (left half of screen) ──
  const onTouchStart = (e) => {
    if (_touch.active) return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.5) {
        _touch.active = true;
        _touch.id = t.identifier;
        _touch.originX = t.clientX;
        _touch.originY = t.clientY;
        _touch.curX = t.clientX;
        _touch.curY = t.clientY;
        break;
      }
    }
  };
  const onTouchMove = (e) => {
    if (!_touch.active) return;
    for (const t of e.changedTouches) {
      if (t.identifier === _touch.id) {
        _touch.curX = t.clientX;
        _touch.curY = t.clientY;
        e.preventDefault();
        break;
      }
    }
  };
  const onTouchEnd = (e) => {
    if (!_touch.active) return;
    for (const t of e.changedTouches) {
      if (t.identifier === _touch.id) {
        _touch.active = false;
        _touch.id = -1;
        break;
      }
    }
  };

  window.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

export function sampleInput() {
  let x = 0, y = 0;

  // Keyboard
  if (_keys['KeyW'] || _keys['ArrowUp'])    y -= 1;
  if (_keys['KeyS'] || _keys['ArrowDown'])  y += 1;
  if (_keys['KeyA'] || _keys['ArrowLeft'])  x -= 1;
  if (_keys['KeyD'] || _keys['ArrowRight']) x += 1;

  // Touch joystick overrides if active and has displacement
  if (_touch.active) {
    let dx = _touch.curX - _touch.originX;
    let dy = _touch.curY - _touch.originY;
    const mag = Math.hypot(dx, dy);
    if (mag > 1e-3) {
      const clamped = Math.min(mag, TOUCH_MAX_RADIUS);
      const nx = (dx / mag) * (clamped / TOUCH_MAX_RADIUS);
      const ny = (dy / mag) * (clamped / TOUCH_MAX_RADIUS);
      x = nx;
      y = ny;
    } else {
      x = 0; y = 0;
    }
  } else {
    // Normalize diagonals for keyboard
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag; y /= mag;
    }
  }

  // Final clamp to magnitude <= 1
  const m2 = Math.hypot(x, y);
  if (m2 > 1) { x /= m2; y /= m2; }

  state.input.moveVec.set(x, y);
}
