/**
 * Map secrets — breakable rotting logs scattered around the run.
 *
 * Static decorative props that the player can smash for loot. Intentionally
 * NOT in the enemy pool so weapons don't auto-DPS them; they break only on
 * explicit interactions:
 *   - Hero dash overlap          → instant break
 *   - Bomb pickup AoE            → instant break
 *   - Final boss shockwave AoE   → instant break (player gets dropped XP)
 *
 * Each log on break drops a gem and occasionally a heart, with a tiny chance
 * of spawning a chest. Sparks + bloom punch sell the moment.
 */
import * as THREE from 'three';
import { state } from './state.js';
import { BLOOM_LAYER } from './postfx.js';

const LOG_COUNT = 18;
const LOG_HP = 1;                 // one-shot: any qualified hit breaks it
const SPAWN_RING_MIN = 12;
const SPAWN_RING_MAX = 60;
const SECRET_CHEST_CHANCE = 0.08; // ~8% per log for the "hidden grove" feel
const HEART_CHANCE = 0.30;

let _inst = null;            // InstancedMesh
let _logs = [];              // { x, z, alive, idx }
let _scene = null;

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();

export function initDestructibles(scene) {
  _scene = scene;
  // Cylinder geometry — short stump-y log. Slight wood-tone, matte material.
  const geo = new THREE.CylinderGeometry(0.45, 0.55, 0.9, 10);
  geo.translate(0, 0.45, 0);    // base at y=0
  const mat = new THREE.MeshStandardMaterial({
    color: 0x5b3d22, roughness: 0.95, metalness: 0.0,
  });
  _inst = new THREE.InstancedMesh(geo, mat, LOG_COUNT);
  _inst.castShadow = true;
  _inst.receiveShadow = false;
  _inst.frustumCulled = false;
  scene.add(_inst);
  resetDestructibles();
}

/** Scatter logs around the spawn ring. Called on run start + restart. */
export function resetDestructibles() {
  if (!_inst) return;
  _logs.length = 0;
  for (let i = 0; i < LOG_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const rot = Math.random() * Math.PI * 2;
    _q.setFromAxisAngle(_v.set(0, 1, 0), rot);
    _s.set(1, 1, 1);
    _v.set(x, 0, z);
    _m4.compose(_v, _q, _s);
    _inst.setMatrixAt(i, _m4);
    _logs.push({ x, z, alive: true, idx: i });
  }
  _inst.instanceMatrix.needsUpdate = true;
  _inst.count = LOG_COUNT;
}

/** Hide an instance by collapsing its matrix to zero scale at far-away pos. */
function _hideInstance(i) {
  _q.identity();
  _s.set(0, 0, 0);
  _v.set(0, -1000, 0);
  _m4.compose(_v, _q, _s);
  _inst.setMatrixAt(i, _m4);
  _inst.instanceMatrix.needsUpdate = true;
}

/**
 * Smash any log within `radius` of (x, z). Returns the number broken so the
 * caller can decide on extra feedback (kill ring, etc.).
 */
export function smashLogsInRadius(x, z, radius) {
  if (!_logs.length) return 0;
  const r2 = radius * radius;
  let broken = 0;
  for (const log of _logs) {
    if (!log.alive) continue;
    const dx = log.x - x, dz = log.z - z;
    if (dx * dx + dz * dz <= r2) {
      log.alive = false;
      broken++;
      _breakLog(log);
    }
  }
  return broken;
}

function _breakLog(log) {
  _hideInstance(log.idx);
  // Drop a gem + maybe a heart + rare chest. Dynamic-import to dodge cycles.
  import('./xp.js').then(({ dropGem }) => dropGem(new THREE.Vector3(log.x, 0, log.z), 1));
  if (Math.random() < HEART_CHANCE) {
    import('./pickups.js').then(({ spawnHeart }) => spawnHeart(log.x, log.z));
  }
  if (Math.random() < SECRET_CHEST_CHANCE) {
    import('./chest.js').then(({ spawnChest }) => spawnChest(log.x, log.z));
  }
  // Spark burst — small + amber for "wood splinter" feel.
  import('./fx.js').then(({ spawnMagnetSpark, spawnKillRing }) => {
    spawnKillRing(log.x, log.z, false);
    for (let i = 0; i < 6; i++) spawnMagnetSpark(log.x, 0.3, log.z, 0xc8884a);
  });
  state.fx.bloomBoost = Math.max(state.fx.bloomBoost || 0, 0.25);
}

/**
 * Sample-side helper: if the hero is currently dashing, smash logs within
 * the dash damage radius. Cheap O(LOG_COUNT) check; called once per dash tick
 * from hero.js's existing dash hit-resolution block.
 */
export function smashLogsAtHero(radius) {
  const h = state.hero && state.hero.pos;
  if (!h) return 0;
  return smashLogsInRadius(h.x, h.z, radius);
}
