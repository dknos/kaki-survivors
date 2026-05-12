/**
 * XP gem system. Uses a single InstancedMesh (capacity 500) so all gems = 1 draw call.
 *
 * Exports: initXP, dropGem, updateGems, applyLevelUpChoice
 */
import * as THREE from 'three';
import { state, xpForLevel } from './state.js';
import { XP, HERO } from './config.js';
import { sfx } from './audio.js';
import { weaponChoices, acquireWeapon } from './weapons/index.js';
import { showLevelUpModal, hideLevelUpModal } from './ui.js';

const GEM_CAPACITY = 500;
const PICKUP_DIST = 0.5;
const PICKUP_DIST_SQ = PICKUP_DIST * PICKUP_DIST;

// Reusable temporaries (avoid per-frame allocations).
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scaleOne = new THREE.Vector3(1, 1, 1);
const _scaleZero = new THREE.Vector3(0, 0, 0);
const _toHero = new THREE.Vector3();

let _matrixDirty = false;

/** Write a hidden (scale-0) matrix at slot i. */
function _hideInstance(i) {
  _mat.compose(_pos.set(0, -1000, 0), _quat.identity(), _scaleZero);
  state.gems.instMesh.setMatrixAt(i, _mat);
  _matrixDirty = true;
}

/** Write a visible (scale-1) matrix at slot i for given world pos. */
function _placeInstance(i, pos) {
  _mat.compose(pos, _quat.identity(), _scaleOne);
  state.gems.instMesh.setMatrixAt(i, _mat);
  _matrixDirty = true;
}

export function initXP(scene) {
  const geo = new THREE.OctahedronGeometry(XP.gemSize);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x44ffcc,
    transparent: true,
    opacity: 0.95,
  });
  const inst = new THREE.InstancedMesh(geo, mat, GEM_CAPACITY);
  inst.count = GEM_CAPACITY;
  inst.frustumCulled = false;
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Hide all instances initially.
  _mat.compose(_pos.set(0, -1000, 0), _quat.identity(), _scaleZero);
  for (let i = 0; i < GEM_CAPACITY; i++) {
    inst.setMatrixAt(i, _mat);
  }
  inst.instanceMatrix.needsUpdate = true;

  state.gems.instMesh = inst;
  state.gems.list.length = 0;
  state.gems.nextSlot = 0;
  scene.add(inst);
}

export function dropGem(pos, value = 1) {
  const list = state.gems.list;

  // Try to reuse an inactive slot.
  let slot = -1;
  for (let i = 0; i < list.length; i++) {
    if (!list[i].active) { slot = i; break; }
  }

  if (slot === -1) {
    if (list.length >= GEM_CAPACITY) {
      // Over capacity — drop silently.
      return;
    }
    slot = list.length;
    list.push({
      pos: pos.clone(),
      value,
      active: true,
      magnetized: false,
      instanceIndex: slot,
      _vx: 0,
      _vz: 0,
    });
  } else {
    const g = list[slot];
    g.pos.copy(pos);
    g.value = value;
    g.active = true;
    g.magnetized = false;
    g.instanceIndex = slot;
    g._vx = 0;
    g._vz = 0;
  }

  _placeInstance(slot, list[slot].pos);
}

function _triggerLevelUp() {
  const choices = weaponChoices(3);
  state.levelUpChoices = choices;
  state.pendingLevelUp = true;
  showLevelUpModal(choices);
  sfx.levelUp && sfx.levelUp();
}

export function updateGems(dt) {
  const list = state.gems.list;
  const inst = state.gems.instMesh;
  if (!inst) return;

  const hero = state.hero;
  const hx = hero.pos.x, hz = hero.pos.z;
  const pickupR = HERO.pickupRadius * hero.statMul.magnet;
  const pickupR2 = pickupR * pickupR;
  const maxSpd = XP.gemMagnetMaxSpeed;
  const accel = XP.gemMagnetAccel;

  let anyPickup = false;

  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (!g.active) continue;

    const dx = hx - g.pos.x;
    const dz = hz - g.pos.z;
    const d2 = dx * dx + dz * dz;

    if (!g.magnetized && d2 <= pickupR2) {
      g.magnetized = true;
    }

    let moved = false;

    if (g.magnetized) {
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d, nz = dz / d;
      g._vx += nx * accel * dt;
      g._vz += nz * accel * dt;
      const sp2 = g._vx * g._vx + g._vz * g._vz;
      if (sp2 > maxSpd * maxSpd) {
        const s = maxSpd / Math.sqrt(sp2);
        g._vx *= s;
        g._vz *= s;
      }
      g.pos.x += g._vx * dt;
      g.pos.z += g._vz * dt;
      moved = true;

      // Pickup check (re-evaluate distance after move).
      const ddx = hx - g.pos.x;
      const ddz = hz - g.pos.z;
      if (ddx * ddx + ddz * ddz <= PICKUP_DIST_SQ) {
        hero.xp += g.value;
        state.run.pickedGems++;
        g.active = false;
        g.magnetized = false;
        _hideInstance(i);
        sfx.pickup && sfx.pickup();
        anyPickup = true;
        continue;
      }
    }

    if (moved) {
      _placeInstance(i, g.pos);
    }
  }

  // Level-up: if multiple thresholds crossed, only show one modal;
  // applyLevelUpChoice re-checks for queued level-ups when the player picks.
  if (anyPickup && !state.pendingLevelUp && hero.xp >= hero.xpNext) {
    hero.xp -= hero.xpNext;
    hero.level++;
    hero.xpNext = xpForLevel(hero.level);
    _triggerLevelUp();
  }

  if (_matrixDirty) {
    inst.instanceMatrix.needsUpdate = true;
    _matrixDirty = false;
  }
}

export function applyLevelUpChoice(choice) {
  if (choice && choice.kind === 'weapon') {
    acquireWeapon(choice.id);
  }
  // (passives not implemented yet)

  state.pendingLevelUp = false;
  state.levelUpChoices.length = 0;
  hideLevelUpModal();

  // If another level is still pending, queue the next modal.
  const hero = state.hero;
  if (hero.xp >= hero.xpNext) {
    hero.xp -= hero.xpNext;
    hero.level++;
    hero.xpNext = xpForLevel(hero.level);
    _triggerLevelUp();
  }
}
