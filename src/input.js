/**
 * Input: keyboard (WASD + arrow keys) and touch joystick (left half of screen).
 * Writes into state.input.moveVec each frame via sampleInput().
 */
import * as THREE from 'three';
import { state } from './state.js';
import { initGamepad, pollGamepad, gamepadState, gamepadHasActivity } from './gamepad.js';
import { getMeta } from './meta.js';

// ── Active input device tracking ─────────────────────────────────────────────
// Other systems (HUD prompts, etc.) read input.activeDevice to swap key/button
// glyphs. Flips on whichever device produced input most recently.
export const input = {
  activeDevice: 'kbm',   // 'kbm' or 'gamepad'
};
let _kbmActivityThisFrame = false;

// Zoom is a discrete ladder gated by the "Bigger Picture" powerup.
// Notch 0 = most zoomed in (start of every run). Each unlock opens one more
// notch outward. Wheel/pinch only moves within unlocked range.
const ZOOM_NOTCHES = [3.0, 2.2, 1.6, 1.2, 0.9, 0.65];
let _zoomNotch = 0;
let _maxUnlocked = 0;    // index of farthest-out notch the player has earned
let _pinchStartDist = 0;
let _pinchStartNotch = 0;

// ── Manual aim: cursor → world XZ via ortho-camera ray (cheap, no Raycaster) ──
const _mouse = { clientX: 0, clientY: 0, hasMoved: false };
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
export function getMouseClient() { return _mouse; }

// ── Primary-fire input (DMD-hybrid hold-to-fire) ──
// _primaryHeld = LMB currently down. _lastAimMoveAt = last cursor-move time, so
// isManualAiming() knows whether the player is actively aiming with the mouse
// vs idle (auto-target nearest). Set by handlers in initInput().
let _primaryHeld = false;
let _lastAimMoveAt = 0;

// ── Touch action buttons (DMD-hybrid mobile) ──
// _touchDashHeld: dash button currently pressed (folded into isDashPressed).
// _touchBtns: { dash, active } DOM refs, updated each frame for cooldown
// dimming + hide-while-paused. _lastStickTapAt: double-tap-to-jump timing.
let _touchDashHeld = false;
let _touchBtns = null;
let _lastStickTapAt = 0;

/** Is the game in live combat (not paused, no modal up)? Touch buttons hide
 *  otherwise so a tap can't leak a queued cast through a paused frame. */
function _gameInteractive() {
  if (!state.started) return false;
  if (state.time && state.time.paused) return false;
  if (state.pendingLevelUp) return false;
  try { if (document.querySelector('[role="dialog"]')) return false; } catch (_) {}
  return true;
}

/** Per-frame: show/hide + cooldown-dim the touch buttons. Driven by its own
 *  rAF (runs even while game logic is paused, so buttons hide promptly). */
function _updateTouchButtons() {
  if (!_touchBtns) return;
  const live = _gameInteractive();
  if (!live) { _touchDashHeld = false; _activeCastQueued = false; }  // drop leaked input
  const d = _touchBtns.dash;
  if (d) {
    d.style.display = live ? 'flex' : 'none';
    const ready = (state.hero.dashCD || 0) <= 0;
    d.style.opacity = ready ? '1' : '0.4';
    d.style.filter  = ready ? 'none' : 'grayscale(1)';
  }
  const a = _touchBtns.active;
  if (a) {
    const act = state.hero.active;
    const has = !!(act && act.id);
    a.style.display = (live && has) ? 'flex' : 'none';
    const ready = act && (act.cd || 0) <= 0;
    a.style.opacity = ready ? '1' : '0.4';
    a.style.filter  = ready ? 'none' : 'grayscale(1)';
  }
}

/** Resolve the auto-fire-primary accessibility toggle. Unset resolves by device:
 *  ON for coarse pointer (touch), OFF for mouse — so the primary fires on its own
 *  on phones (auto-aim) but is hold-to-fire on PC. */
function _resolveAutoFirePrimary() {
  let v;
  try { v = getMeta().optAutoFirePrimary; } catch (_) { v = undefined; }
  if (v === undefined || v === null) return isCoarsePointer();
  return !!v;
}

/** True while the player is firing the primary: LMB held (PC), right
 *  trigger / right-stick deflected (gamepad), or the auto-fire toggle. */
export function isPrimaryFiring() {
  if (_primaryHeld) return true;
  if (gamepadState.connected) {
    const rt = gamepadState.buttons && gamepadState.buttons.rt;
    if (rt && rt > 0.3) return true;
    if (Math.hypot(gamepadState.rx, gamepadState.ry) > 0.3) return true;
  }
  return _resolveAutoFirePrimary();
}

/** True when the player is actively aiming (mouse moved recently or right-stick
 *  deflected) — primary aims at the cursor/stick; otherwise auto-targets nearest. */
export function isManualAiming() {
  if (gamepadState.connected && Math.hypot(gamepadState.rx, gamepadState.ry) > 0.3) return true;
  // While LMB is held the cursor IS the aim point (even if still); otherwise
  // treat a recent move as active aiming. Idle => caller auto-targets nearest.
  if (_mouse.hasMoved && (_primaryHeld || (performance.now() - _lastAimMoveAt) < 1500)) return true;
  return false;
}

/**
 * Project the current mouse position onto the y=0 plane in world coords.
 * Returns {x, z}. Falls back to hero forward 10u if camera not yet ready or
 * the cursor never moved this session.
 */
export function getAimWorldPos() {
  const cam = state.camera;
  const heroPos = state.hero.pos;
  if (!cam || !_mouse.hasMoved) {
    const f = state.hero.facing;
    return { x: heroPos.x + (f.x || 0) * 10, z: heroPos.z + (f.z || 1) * 10 };
  }
  // NDC must be relative to the canvas rect, not the window — with the 16:9
  // letterbox the canvas is a centred box offset from the viewport by the
  // black bars, so window-relative coords would skew aim on ultrawide/portrait.
  const dom = state.renderer && state.renderer.domElement;
  const rect = dom ? dom.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const ndcX =  ((_mouse.clientX - rect.left) / rect.width)  * 2 - 1;
  const ndcY = -((_mouse.clientY - rect.top)  / rect.height) * 2 + 1;
  _p1.set(ndcX, ndcY, -1).unproject(cam);
  _p2.set(ndcX, ndcY,  1).unproject(cam);
  const dx = _p2.x - _p1.x, dy = _p2.y - _p1.y, dz = _p2.z - _p1.z;
  if (Math.abs(dy) < 1e-6) return { x: heroPos.x, z: heroPos.z };
  const t = -_p1.y / dy;
  return { x: _p1.x + dx * t, z: _p1.z + dz * t };
}

export function isDashPressed() {
  // Repeating presses while held are fine — hero.js gates on its own cooldown.
  // Gamepad: A button (XInput south) also triggers dash.
  if (_keys['ShiftLeft'] || _keys['ShiftRight']) return true;
  if (gamepadState.connected && gamepadState.buttons.a) return true;
  if (_touchDashHeld) return true;   // touch dash button (DMD-hybrid mobile)
  return false;
}

// Edge-triggered: returns true exactly once per keydown of Space (jump).
let _jumpQueued = false;
export function consumeJump() {
  if (_jumpQueued) { _jumpQueued = false; return true; }
  return false;
}
export function _internalQueueJump() { _jumpQueued = true; }

// Edge-triggered active-ability cast (RMB / Q on PC; touch button in Iter D).
// Consumed once per press by the weapon tick (weapons/index.js tickWeapons).
let _activeCastQueued = false;
export function consumeActiveCast() {
  if (_activeCastQueued) { _activeCastQueued = false; return true; }
  return false;
}
export function _internalQueueActiveCast() { _activeCastQueued = true; }

// Edge-triggered gamepad action queues. Other systems consume these once.
let _padInteractQueued = false;
let _padPauseQueued = false;
let _padLevelUpConfirmQueued = false;
export function consumePadInteract() {
  if (_padInteractQueued) { _padInteractQueued = false; return true; }
  return false;
}
export function consumePadPause() {
  if (_padPauseQueued) { _padPauseQueued = false; return true; }
  return false;
}
export function consumePadLevelUpConfirm() {
  if (_padLevelUpConfirmQueued) { _padLevelUpConfirmQueued = false; return true; }
  return false;
}

/**
 * Normalized world-space aim direction {x, z} for top-down weapons/hero code.
 * - If the right stick is deflected past 0.3, returns the stick direction.
 * - Otherwise falls back to the mouse-projected aim point relative to hero.
 * - z is used (not y) because the game is top-down on the XZ plane.
 */
export function getAimDirection() {
  if (gamepadState.connected) {
    const rx = gamepadState.rx, ry = gamepadState.ry;
    const mag = Math.hypot(rx, ry);
    if (mag > 0.3) {
      return { x: rx / mag, z: ry / mag };
    }
  }
  const heroPos = state.hero && state.hero.pos;
  if (!heroPos) {
    const f = (state.hero && state.hero.facing) || { x: 0, z: 1 };
    return { x: f.x || 0, z: f.z || 1 };
  }
  const aim = getAimWorldPos();
  const dx = aim.x - heroPos.x;
  const dz = aim.z - heroPos.z;
  const m = Math.hypot(dx, dz);
  if (m < 1e-4) {
    const f = state.hero.facing;
    return { x: f.x || 0, z: f.z || 1 };
  }
  return { x: dx / m, z: dz / m };
}

export function getZoom() { return ZOOM_NOTCHES[_zoomNotch]; }
export function getZoomNotch() { return _zoomNotch; }
export function getMaxZoomNotch() { return _maxUnlocked; }
export function getZoomNotchCount() { return ZOOM_NOTCHES.length; }
export function unlockZoomLevel() {
  if (_maxUnlocked < ZOOM_NOTCHES.length - 1) _maxUnlocked++;
}
export function resetZoom() { _zoomNotch = 0; _maxUnlocked = 0; }

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

// Coarse pointer (phone/tablet) detection. `?touch=1` forces the path so the
// headless smoke test can exercise the touch branch (matchMedia coarse stays
// false under Playwright even with hasTouch).
let _coarse = null;
function isCoarsePointer() {
  if (_coarse !== null) return _coarse;
  try {
    _coarse = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || (navigator.maxTouchPoints > 0)
      || ('ontouchstart' in window)
      || /[?&]touch=1/.test(location.search);
  } catch (_) { _coarse = false; }
  return _coarse;
}

export function initInput() {
  if (_initialized) return;
  _initialized = true;

  // ── Gamepad (Web Gamepad API, XInput-standard mapping) ──
  initGamepad();

  // ── Keyboard ──
  window.addEventListener('keydown', (e) => {
    _keys[e.code] = true;
    _kbmActivityThisFrame = true;
    // Edge-trigger jump on Space — main.js gates by state.started before consuming
    if (e.code === 'Space' && !e.repeat) _jumpQueued = true;
    // Edge-trigger active-ability cast on Q.
    if (e.code === 'KeyQ' && !e.repeat) _activeCastQueued = true;
  });
  window.addEventListener('keyup', (e) => {
    _keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    for (const k in _keys) _keys[k] = false;
  });

  // ── Mouse position (for manual aim mode) ──
  window.addEventListener('mousemove', (e) => {
    _mouse.clientX = e.clientX;
    _mouse.clientY = e.clientY;
    _mouse.hasMoved = true;
    _lastAimMoveAt = performance.now();
    _kbmActivityThisFrame = true;
  }, { passive: true });
  // LMB = hold-to-fire primary. Ignore presses that start on UI chrome (menu
  // buttons, dialogs) so clicking the HUD/options never starts firing; mouseup
  // anywhere clears the hold so it can't get stuck after a drag-off.
  window.addEventListener('mousedown', (e) => {
    _kbmActivityThisFrame = true;
    const onUi = e.target && e.target.closest && e.target.closest('button, [role="dialog"], [role="button"], input, a');
    if (onUi) return;
    if (e.button === 0) _primaryHeld = true;            // LMB hold = fire primary
    else if (e.button === 2) _activeCastQueued = true;  // RMB = active ability
  }, { passive: true });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) _primaryHeld = false; }, { passive: true });
  window.addEventListener('blur', () => { _primaryHeld = false; });
  // RMB is the active-ability trigger — suppress the browser context menu over
  // the play area so it doesn't pop. (Menus/dialogs keep their default menu.)
  window.addEventListener('contextmenu', (e) => {
    const onUi = e.target && e.target.closest && e.target.closest('button, [role="dialog"], [role="button"], input, a');
    if (!onUi) e.preventDefault();
  });

  // ── Touch joystick (left half of screen) ──
  const onTouchStart = (e) => {
    if (_touch.active) return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.5) {
        // Double-tap the move stick = jump (no dedicated button on touch).
        const now = performance.now();
        if (now - _lastStickTapAt < 280) _jumpQueued = true;
        _lastStickTapAt = now;
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

  // ── Mouse wheel zoom (steps one notch per click, clamped to unlocks) ──
  let _wheelCD = 0;
  window.addEventListener('wheel', (e) => {
    // Don't hijack the wheel for camera zoom when the pointer is over an open
    // modal — let its overflow-y:auto scroll. The game is paused while any
    // dialog is open, so zoom-while-dialog is meaningless anyway.
    if (e.target && e.target.closest && e.target.closest('[role="dialog"]')) return;
    e.preventDefault();
    const now = performance.now();
    if (now < _wheelCD) return;        // throttle: one notch per ~120ms
    _wheelCD = now + 120;
    if (e.deltaY > 0) {
      // scroll down = zoom OUT (advance notch up to unlocked cap)
      _zoomNotch = Math.min(_maxUnlocked, _zoomNotch + 1);
    } else {
      // scroll up = zoom IN (back toward notch 0)
      _zoomNotch = Math.max(0, _zoomNotch - 1);
    }
  }, { passive: false });

  // ── Pinch zoom (two-finger touch) — maps ratio to notch index ──
  window.addEventListener('touchstart', (e) => {
    // Ignore touches that began on an action button — a thumb on dash/active
    // plus a thumb on the stick is NOT a pinch (blind-spot: zoom would jitter).
    if (e.target && e.target.closest && e.target.closest('[data-kk-touch-btn]')) return;
    if (e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      _pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      _pinchStartNotch = _zoomNotch;
    }
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && _pinchStartDist > 0) {
      const a = e.touches[0], b = e.touches[1];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / _pinchStartDist;
      // pinch open (ratio > 1) = zoom in toward 0; pinch close = zoom out toward _maxUnlocked
      // map a 50% range to one notch step
      let delta = 0;
      if (ratio > 1.3) delta = -1;
      else if (ratio < 0.77) delta = 1;
      else if (ratio > 1.7) delta = -2;
      else if (ratio < 0.6) delta = 2;
      const target = _pinchStartNotch + delta;
      _zoomNotch = Math.max(0, Math.min(_maxUnlocked, target));
      e.preventDefault();
    }
  }, { passive: false });
  window.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) _pinchStartDist = 0;
  });

  // ── Touch action buttons (coarse pointer only): DASH + ACTIVE ──
  // The DMD-hybrid mobile scheme. Movement = left-half stick (above); the
  // primary auto-fires at the nearest enemy (optAutoFirePrimary defaults ON
  // for touch). Jump is reachable by double-tapping the move stick (see
  // onTouchStart), so the bottom-right corner is freed for the two combat
  // verbs the player taps. Buttons mount on <body> (outside #kk-stage) so the
  // letterbox doesn't clip them; they self-hide while paused / a modal is up.
  if (isCoarsePointer()) {
    const mkBtn = (id, glyph, label, css) => {
      const b = document.createElement('div');
      b.id = id;
      b.textContent = glyph;
      b.setAttribute('aria-label', label);
      b.setAttribute('data-kk-touch-btn', '1');
      b.style.cssText = `position: fixed; z-index: 90; ${css}
        border-radius: 50%; display: none; align-items: center; justify-content: center;
        background: radial-gradient(circle at 50% 35%, rgba(40,52,44,0.92), rgba(10,16,13,0.95));
        border: 2px solid rgba(255,210,127,0.5); color: #ffd27f; line-height: 1;
        user-select: none; touch-action: none;
        transition: transform 0.09s ease, opacity 0.12s ease, filter 0.12s ease;`;
      document.body.appendChild(b);
      return b;
    };
    const dashBtn   = mkBtn('kk-touch-dash',   '»', 'Dash',
      'right: 24px; bottom: 28px; width: 84px; height: 84px; font-size: 40px;');
    const activeBtn = mkBtn('kk-touch-active', '✸', 'Active ability',
      'right: 36px; bottom: 130px; width: 68px; height: 68px; font-size: 30px;');
    const press = (btn, fn) => {
      const onStart = (e) => { e.preventDefault(); e.stopPropagation(); fn(true);  btn.style.transform = 'scale(0.9)'; };
      const onEnd   = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } fn(false); btn.style.transform = ''; };
      btn.addEventListener('touchstart',  onStart, { passive: false });
      btn.addEventListener('touchend',    onEnd,   { passive: false });
      btn.addEventListener('touchcancel', onEnd,   { passive: false });
    };
    press(dashBtn,   (down) => { _touchDashHeld = down; });
    press(activeBtn, (down) => { if (down) _activeCastQueued = true; });
    _touchBtns = { dash: dashBtn, active: activeBtn };
    // Own rAF so visibility/cooldown dimming updates even while the game logic
    // is paused (modal open) — that's exactly when buttons must hide.
    const tick = () => { try { _updateTouchButtons(); } catch (_) {} requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}

export function sampleInput() {
  // Refresh gamepad snapshot once per frame BEFORE deriving moveVec.
  pollGamepad();

  let x = 0, y = 0;

  // Keyboard
  if (_keys['KeyW'] || _keys['ArrowUp'])    y -= 1;
  if (_keys['KeyS'] || _keys['ArrowDown'])  y += 1;
  if (_keys['KeyA'] || _keys['ArrowLeft'])  x -= 1;
  if (_keys['KeyD'] || _keys['ArrowRight']) x += 1;

  // Gamepad left stick overrides WASD when pad is connected and deflected.
  // The stick already has deadzone+rescale applied in gamepad.js.
  if (gamepadState.connected) {
    const lx = gamepadState.lx, ly = gamepadState.ly;
    if (Math.hypot(lx, ly) > 1e-3) {
      x = lx; y = ly;
    }
  }

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

  // ── Edge-triggered gamepad actions (consumed once by main.js / ui.js) ──
  // B = interact, X = pause, Y = level-up confirm. A is held-checked via
  // isDashPressed(). Start mirrors X for convenience (typical pause button).
  if (gamepadState.connected) {
    const jp = gamepadState.justPressed;
    if (jp.b) _padInteractQueued = true;
    if (jp.x || jp.start) _padPauseQueued = true;
    if (jp.y) _padLevelUpConfirmQueued = true;
  }

  // ── Active device tracking ──
  // If kbm produced any event this frame, prefer kbm. Else if the pad shows any
  // activity (stick/button/trigger), flip to gamepad. Sticky between frames.
  if (_kbmActivityThisFrame) {
    input.activeDevice = 'kbm';
  } else if (gamepadHasActivity()) {
    input.activeDevice = 'gamepad';
  }
  _kbmActivityThisFrame = false;
}
