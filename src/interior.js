/**
 * Cabin interior — top-down iso room the player walks into from the town
 * hub's House interactable. Holds room-level interactables that open the
 * existing meta menus (Renovation desk → showHouse()) and minigames
 * (Sketchbook stand → showSketchbook(), iteration 9).
 *
 * Architecturally a sibling to town.js — own Group, own interactable list,
 * own DOM prompt, own mode-branch in main.js. The hero is shared (same
 * mesh + input), but constrained to the room's floor.
 *
 * Camera is the same THREE.OrthographicCamera; main.js applies a tighter
 * offset when state.mode === 'interior' so the room feels close.
 */
import * as THREE from 'three';
import { state } from './state.js';

// Room dimensions (in world units)
const ROOM_W = 14;   // x
const ROOM_D = 11;   // z
const WALL_H = 4;
const DOOR_W = 2.4;

let _group = null;
let _promptEl = null;
let _activeKey = null;
const _handlers = {};
const _interactables = [
  { pos: { x: 0,    z: 4.4 }, radius: 1.8, label: '🚪  Leave the House',        key: 'exit'    },
  { pos: { x: -4.0, z: -2.0 }, radius: 2.0, label: '🛠  Renovations Desk',       key: 'house'   },
  { pos: { x:  4.0, z: -2.0 }, radius: 2.0, label: '✎  Sketchbook · trace a doodle', key: 'sketch'  },
  { pos: { x:  0,   z: -4.0 }, radius: 2.0, label: '☕  Tea Ceremony · perfect the pour', key: 'tea' },
  { pos: { x:  5.5, z:  2.2 }, radius: 1.8, label: '🧶  Yarn Toss · throw at baskets', key: 'yarn' },
];

function _matStandard(color, roughness = 0.85, metalness = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function _makeFloor() {
  // Wide plank-stripe pattern via three thinner planes overlaid
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    _matStandard(0xb6864a, 0.85),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0;
  base.receiveShadow = true;
  g.add(base);
  // Dark plank seams (4 thin strips along x)
  for (let i = -1; i <= 1; i++) {
    const seam = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_W, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x6a4830, transparent: true, opacity: 0.55 }),
    );
    seam.rotation.x = -Math.PI / 2;
    seam.position.y = 0.005;
    seam.position.z = (i / 2) * ROOM_D;
    g.add(seam);
  }
  return g;
}

function _makeWall(w, h, color = 0xe9d6a8) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.25),
    _matStandard(color, 0.9),
  );
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function _makeRenovationsDesk() {
  const g = new THREE.Group();
  // Desktop slab
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 1.2), _matStandard(0x6a4830, 0.7));
  top.position.y = 0.9;
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  // 4 legs
  for (const [x, z] of [[-0.95, -0.45],[0.95, -0.45],[-0.95, 0.45],[0.95, 0.45]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), _matStandard(0x4a2f1c, 0.85));
    leg.position.set(x, 0.45, z);
    g.add(leg);
  }
  // Toolbox on top (small box, brass-tinted)
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.42), _matStandard(0xc98a3a, 0.6, 0.3));
  box.position.set(-0.5, 1.16, 0);
  box.castShadow = true;
  g.add(box);
  // Floorplan paper roll
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12), _matStandard(0xf3e8cf, 0.85));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0.5, 1.05, 0);
  g.add(roll);
  return g;
}

function _makeSketchbookStand() {
  const g = new THREE.Group();
  // Easel base — A-frame triangle
  for (const x of [-0.45, 0.45]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.0, 0.10), _matStandard(0x4a2f1c, 0.85));
    leg.position.set(x, 1.0, 0);
    leg.rotation.z = (x < 0 ? 1 : -1) * 0.14;
    leg.castShadow = true;
    g.add(leg);
  }
  // Cross bar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.10, 0.10), _matStandard(0x4a2f1c, 0.85));
  bar.position.set(0, 1.55, 0);
  g.add(bar);
  // Canvas / sketchbook — paper-tinted plane
  const canvas = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 1.18),
    new THREE.MeshStandardMaterial({ color: 0xf3e8cf, roughness: 0.95, metalness: 0.0 }),
  );
  canvas.position.set(0, 1.45, 0.06);
  canvas.castShadow = true;
  g.add(canvas);
  // Sketched lines on the canvas (decoration)
  for (const [x1, y1, x2, y2] of [[-0.3, 0.2, 0.3, 0.1], [-0.2, -0.2, 0.25, -0.3], [-0.1, 0.4, 0.15, 0.3]]) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x231a14 }),
    );
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    line.position.set(cx, 1.45 + cy, 0.065);
    line.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    g.add(line);
  }
  return g;
}

function _makeTeaKettle() {
  const g = new THREE.Group();
  // Stove top
  const stove = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.0), _matStandard(0x3a3a44, 0.7, 0.4));
  stove.position.y = 0.35;
  stove.castShadow = true;
  g.add(stove);
  // Burner ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 24), new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.55 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.72;
  g.add(ring);
  // Kettle body — squat sphere
  const kettle = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 10),
    _matStandard(0xc98a3a, 0.5, 0.5),
  );
  kettle.scale.set(1, 0.85, 1);
  kettle.position.y = 0.95;
  kettle.castShadow = true;
  g.add(kettle);
  // Spout
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.4, 8), _matStandard(0xc98a3a, 0.5, 0.5));
  spout.rotation.z = -Math.PI / 3;
  spout.position.set(0.32, 1.1, 0);
  g.add(spout);
  // Handle (curved torus segment)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 16, Math.PI), _matStandard(0x4a2f1c, 0.85));
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 1.22, 0);
  g.add(handle);
  return g;
}

function _makeYarnBasket() {
  const g = new THREE.Group();
  // Wicker bowl — wide flat cylinder
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.45, 0.40, 18),
    _matStandard(0xd99b54, 0.85),
  );
  bowl.position.y = 0.20;
  bowl.castShadow = true; bowl.receiveShadow = true;
  g.add(bowl);
  // Rim
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.06, 8, 18),
    _matStandard(0xc98a3a, 0.7),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.40;
  g.add(rim);
  // Three yarn balls sitting in the bowl
  const colors = [0xe8a3c7, 0x8aaa6a, 0xc98a3a];
  const positions = [[0.0, 0.55, 0.0], [-0.20, 0.55, 0.15], [0.20, 0.50, -0.10]];
  for (let i = 0; i < 3; i++) {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.75 }),
    );
    ball.position.set(...positions[i]);
    ball.castShadow = true;
    g.add(ball);
  }
  return g;
}

function _makeFireplace() {
  const g = new THREE.Group();
  // Hearth box (chimney)
  const hearth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 0.8), _matStandard(0x5a4338, 0.95));
  hearth.position.y = 1.6;
  hearth.castShadow = true; hearth.receiveShadow = true;
  g.add(hearth);
  // Cavity (dark recessed box)
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0608, roughness: 1 }));
  cavity.position.set(0, 0.8, 0.22);
  g.add(cavity);
  // Glowing log + firelight
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0xff5522, emissive: 0xff5522, emissiveIntensity: 1.0 }));
  log.rotation.z = Math.PI / 2;
  log.position.set(0, 0.4, 0.32);
  g.add(log);
  const flLight = new THREE.PointLight(0xff7a3a, 1.6, 7, 2);
  flLight.position.set(0, 0.9, 0.6);
  g.add(flLight);
  g.userData._fireLight = flLight;
  return g;
}

export function buildInterior(scene) {
  if (_group) return _group;
  const g = new THREE.Group();
  g.name = 'interiorGroup';

  // ── Floor ──
  g.add(_makeFloor());

  // ── Walls (4 outer walls, with a door gap on +Z) ──
  // Back wall (-z)
  const back = _makeWall(ROOM_W, WALL_H);
  back.position.set(0, WALL_H / 2, -ROOM_D / 2);
  g.add(back);
  // Left wall (-x)
  const left = _makeWall(0.25, WALL_H);
  left.geometry = new THREE.BoxGeometry(0.25, WALL_H, ROOM_D);
  left.position.set(-ROOM_W / 2, WALL_H / 2, 0);
  g.add(left);
  // Right wall (+x)
  const right = _makeWall(0.25, WALL_H);
  right.geometry = new THREE.BoxGeometry(0.25, WALL_H, ROOM_D);
  right.position.set(ROOM_W / 2, WALL_H / 2, 0);
  g.add(right);
  // Front wall (+z) with door gap
  const halfDoor = DOOR_W / 2;
  const sideW = (ROOM_W - DOOR_W) / 2;
  const frontL = _makeWall(sideW, WALL_H);
  frontL.position.set(-(sideW / 2 + halfDoor), WALL_H / 2, ROOM_D / 2);
  g.add(frontL);
  const frontR = _makeWall(sideW, WALL_H);
  frontR.position.set((sideW / 2 + halfDoor), WALL_H / 2, ROOM_D / 2);
  g.add(frontR);
  // Lintel above door
  const lintel = _makeWall(DOOR_W + 0.25, WALL_H * 0.32);
  lintel.position.set(0, WALL_H - 0.6, ROOM_D / 2);
  g.add(lintel);

  // ── Furniture ──
  const desk = _makeRenovationsDesk();
  desk.position.set(-4.0, 0, -2.0);
  desk.rotation.y = 0.18;
  g.add(desk);

  const easel = _makeSketchbookStand();
  easel.position.set(4.0, 0, -2.0);
  easel.rotation.y = -0.18;
  g.add(easel);

  const kettle = _makeTeaKettle();
  kettle.position.set(0, 0, -4.0);
  g.add(kettle);

  const fireplace = _makeFireplace();
  fireplace.position.set(-ROOM_W / 2 + 0.4, 0, 2.5);
  fireplace.rotation.y = Math.PI / 2;
  g.add(fireplace);

  // Yarn basket — stacked balls in a wicker bowl, near the south-east corner
  const yarnBasket = _makeYarnBasket();
  yarnBasket.position.set(5.5, 0, 2.2);
  g.add(yarnBasket);

  // ── Ambient lighting (warm interior fill) ──
  const fill = new THREE.PointLight(0xffd4a0, 0.55, 22, 2);
  fill.position.set(0, 3.6, 0);
  g.add(fill);
  // Cool kicker from window-ish (back-left)
  const kicker = new THREE.PointLight(0x9bb6e8, 0.35, 14, 2);
  kicker.position.set(-ROOM_W / 2 + 1, 3.0, -ROOM_D / 2 + 1);
  g.add(kicker);

  // Hide initially — only visible when state.mode === 'interior'
  // Stash far below world; toggling .visible alone leaves lights affecting other modes.
  g.position.y = -200;
  scene.add(g);
  _group = g;

  // ── DOM prompt ──
  if (!_promptEl) {
    _promptEl = document.createElement('div');
    _promptEl.id = 'kk-interior-prompt';
    _promptEl.style.cssText = `
      position: fixed; bottom: 14%; left: 50%; transform: translateX(-50%);
      padding: 10px 22px; pointer-events: none; z-index: 90;
      background: linear-gradient(180deg, rgba(243,232,207,0.95), rgba(217,202,170,0.92));
      border: 1px solid rgba(35,26,20,0.55); border-radius: 8px;
      color: #231a14; font: 600 16px 'Cinzel Decorative', serif;
      letter-spacing: 0.06em;
      box-shadow: 0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.4);
      display: none;
    `;
    document.body.appendChild(_promptEl);
    window.addEventListener('keydown', _onKeyDown);
  }
  return g;
}

function _onKeyDown(e) {
  if (state.mode !== 'interior') return;
  if (e.code !== 'KeyE' && e.code !== 'Enter') return;
  if (!_activeKey) return;
  if (_activeKey === 'exit') { _handlers.exit && _handlers.exit(); return; }
  if (_handlers[_activeKey]) _handlers[_activeKey]();
}

export function setInteriorHandler(key, fn) { _handlers[key] = fn; }

export function enterInterior() {
  state.mode = 'interior';
  if (_group) _group.position.y = 0;
  // Spawn at the door (south end of the room)
  state.hero.pos.set(0, 0, ROOM_D / 2 - 2);
  state.hero.vel.set(0, 0, 0);
  state.hero.facing.set(0, 0, -1);
}

export function exitInterior() {
  state.mode = 'town';
  if (_group) _group.position.y = -200;
  if (_promptEl) _promptEl.style.display = 'none';
  _activeKey = null;
}

export function tickInterior(dt) {
  if (state.mode !== 'interior') {
    if (_promptEl && _promptEl.style.display !== 'none') _promptEl.style.display = 'none';
    return;
  }

  // Flicker fire light gently for atmosphere
  if (_group) {
    _group.traverse(o => {
      if (o.userData && o.userData._fireLight) {
        const t = state.time.real;
        o.userData._fireLight.intensity = 1.4 + 0.4 * Math.sin(t * 6.7) + 0.2 * Math.sin(t * 13.1);
      }
    });
  }

  // Find closest interactable
  const h = state.hero.pos;
  let best = null, bestD = Infinity;
  for (const it of _interactables) {
    const dx = h.x - it.pos.x;
    const dz = h.z - it.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < it.radius * it.radius && d2 < bestD) { best = it; bestD = d2; }
  }
  _activeKey = best ? best.key : null;
  if (best) {
    _promptEl.textContent = `[E]  ${best.label}`;
    _promptEl.style.display = 'block';
  } else {
    _promptEl.style.display = 'none';
  }

  // Constrain hero to room interior with a small wall margin
  const margin = 0.6;
  const minX = -ROOM_W / 2 + margin;
  const maxX =  ROOM_W / 2 - margin;
  const minZ = -ROOM_D / 2 + margin;
  // The door gap on +z lets the player walk out without clipping
  const maxZ = (Math.abs(h.x) < DOOR_W / 2 + 0.2)
    ? ROOM_D / 2 + 1.8           // door gap: extra room to walk through (exits handled separately)
    : ROOM_D / 2 - margin;
  if (h.x < minX) h.x = minX;
  if (h.x > maxX) h.x = maxX;
  if (h.z < minZ) h.z = minZ;
  if (h.z > maxZ) h.z = maxZ;
}

export const INTERIOR_ROOM = { W: ROOM_W, D: ROOM_D };
