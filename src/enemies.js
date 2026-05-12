/**
 * Enemy system: pooled meshes, spatial hash, seek-hero + light separation,
 * contact damage, and a damage interface for weapons.
 *
 * Highest-risk module: must hold 200+ active enemies at 60fps. To that end:
 *  - No `new` calls in hot loops (temp vectors are module-scoped).
 *  - No skeletal animation mixers — meshes are static (faster + zero allocs).
 *  - Proximity via SpatialHash, never raycasting.
 *  - Pools keyed by glb key; prewarm hides first-horde stall.
 */
import * as THREE from 'three';
import { state } from './state.js';
import { ENEMY_TIERS, POOL_PREWARM, SPATIAL, HERO } from './config.js';
import { cloneCached, GLTF_CACHE } from './assets.js';
import { takeDamage as heroTakeDamage } from './hero.js';
import { dropGem } from './xp.js';
import { sfx } from './audio.js';

// ── Module-scope temp vectors (reuse, never `new` in update loops) ────────────
const _tmpDir   = new THREE.Vector3();
const _tmpPush  = new THREE.Vector3();
const _tmpDelta = new THREE.Vector3();

const HERO_RADIUS = 0.4;
const ENEMY_RADIUS = 0.5;            // flat per spec
const CONTACT_RADIUS = HERO_RADIUS + ENEMY_RADIUS; // ~0.9; spec says ~1.0
const CONTACT_CD = 0.5;
const SEPARATION_DIST = 1.0;
const SEPARATION_NEIGHBORS = 3;
const CONTACT_DIST_SQ = 1.0 * 1.0;   // use a friendly 1.0 unit total contact

let _scene = null;

// ── Tier lookup ───────────────────────────────────────────────────────────────
const _tierByGlb = Object.create(null);
for (const t of ENEMY_TIERS) _tierByGlb[t.glb] = t;

// ─────────────────────────────────────────────────────────────────────────────
// SpatialHash
// ─────────────────────────────────────────────────────────────────────────────
class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    /** @type {Map<string, any[]>} */
    this.cells = new Map();
  }

  _key(cx, cz) { return cx + '_' + cz; }
  _cellCoord(v) { return Math.floor(v / this.cellSize); }

  insert(enemy) {
    const p = enemy.mesh.position;
    const cx = this._cellCoord(p.x);
    const cz = this._cellCoord(p.z);
    const key = this._key(cx, cz);
    enemy._spatialKey = key;
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = []; this.cells.set(key, bucket); }
    bucket.push(enemy);
  }

  remove(enemy) {
    const key = enemy._spatialKey;
    if (key == null) return;
    const bucket = this.cells.get(key);
    if (!bucket) { enemy._spatialKey = null; return; }
    const i = bucket.indexOf(enemy);
    if (i !== -1) {
      // swap-pop
      const last = bucket.length - 1;
      if (i !== last) bucket[i] = bucket[last];
      bucket.pop();
    }
    if (bucket.length === 0) this.cells.delete(key);
    enemy._spatialKey = null;
  }

  /** Call after position update. Rehashes only if cell changed. */
  move(enemy) {
    const p = enemy.mesh.position;
    const cx = this._cellCoord(p.x);
    const cz = this._cellCoord(p.z);
    const key = this._key(cx, cz);
    if (key === enemy._spatialKey) return;
    this.remove(enemy);
    enemy._spatialKey = key;
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = []; this.cells.set(key, bucket); }
    bucket.push(enemy);
  }

  /**
   * Returns array of active enemies within radius r of pos.
   * Iterates all cells overlapping the bounding box of the circle.
   */
  queryRadius(pos, r) {
    const out = [];
    const cs = this.cellSize;
    const minCX = Math.floor((pos.x - r) / cs);
    const maxCX = Math.floor((pos.x + r) / cs);
    const minCZ = Math.floor((pos.z - r) / cs);
    const maxCZ = Math.floor((pos.z + r) / cs);
    const rSq = r * r;
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const bucket = this.cells.get(this._key(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          if (!e.alive) continue;
          const dx = e.mesh.position.x - pos.x;
          const dz = e.mesh.position.z - pos.z;
          if (dx * dx + dz * dz <= rSq) out.push(e);
        }
      }
    }
    return out;
  }

  clear() { this.cells.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Init / pooling
// ─────────────────────────────────────────────────────────────────────────────
export function initEnemies(scene) {
  _scene = scene;
  state.enemies.spatial = new SpatialHash(SPATIAL.cellSize);
  state.enemies.pools = {};
  state.enemies.active.length = 0;
}

function _makePooledMesh(glbKey, scale) {
  const mesh = cloneCached(glbKey);
  if (!mesh) return null;
  mesh.scale.setScalar(scale);
  mesh.visible = false;
  mesh.position.set(0, 0, 0);
  // Optional: disable frustum culling churn on hidden meshes — leave default for now.
  return mesh;
}

export function prewarmPools() {
  for (const key of Object.keys(POOL_PREWARM)) {
    const tier = _tierByGlb[key];
    if (!tier) { console.warn(`[enemies] prewarm: no tier for "${key}"`); continue; }
    if (!GLTF_CACHE[key]) { console.warn(`[enemies] prewarm: GLTF "${key}" not loaded`); continue; }

    const n = POOL_PREWARM[key];
    const pool = state.enemies.pools[key] || (state.enemies.pools[key] = []);
    for (let i = 0; i < n; i++) {
      const mesh = _makePooledMesh(key, tier.scale);
      if (!mesh) break;
      _scene.add(mesh);
      pool.push(mesh);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn / kill
// ─────────────────────────────────────────────────────────────────────────────
export function spawnEnemy(tierConfig, x, z) {
  const key = tierConfig.glb;
  let pool = state.enemies.pools[key];
  if (!pool) pool = state.enemies.pools[key] = [];

  let mesh = pool.pop();
  if (!mesh) {
    // Pool exhausted — clone fresh and warn (means POOL_PREWARM was too small).
    console.warn(`[enemies] pool empty for "${key}" — cloning mid-game`);
    mesh = _makePooledMesh(key, tierConfig.scale);
    if (!mesh) return null;
    _scene.add(mesh);
  }

  mesh.position.set(x, 0, z);
  mesh.scale.setScalar(tierConfig.scale);
  mesh.visible = true;

  /** @type {import('./state.js').EnemyInstance} */
  const enemy = {
    mesh,
    glbKey: key,
    hp: tierConfig.hp,
    hpMax: tierConfig.hp,
    spd: tierConfig.spd,
    dmg: tierConfig.dmg,
    contactCooldown: 0,
    elite: !!tierConfig.elite,
    alive: true,
    _spatialKey: null,
  };

  state.enemies.spatial.insert(enemy);
  state.enemies.active.push(enemy);
  return enemy;
}

export function killEnemy(enemy) {
  if (!enemy.alive) return;
  enemy.alive = false;
  enemy.mesh.visible = false;

  // Drop XP gem
  dropGem(enemy.mesh.position.clone(), enemy.elite ? 5 : 1);

  state.run.kills++;

  // Return mesh to pool
  const pool = state.enemies.pools[enemy.glbKey] || (state.enemies.pools[enemy.glbKey] = []);
  pool.push(enemy.mesh);

  // Remove from spatial hash
  state.enemies.spatial.remove(enemy);

  // Splice from active list
  const arr = state.enemies.active;
  const i = arr.indexOf(enemy);
  if (i !== -1) {
    const last = arr.length - 1;
    if (i !== last) arr[i] = arr[last];
    arr.pop();
  }

  if (sfx && typeof sfx.hit === 'function') sfx.hit();
}

// ─────────────────────────────────────────────────────────────────────────────
// Damage interface (called by weapons)
// ─────────────────────────────────────────────────────────────────────────────
export function damageEnemy(enemy, dmg) {
  if (!enemy || !enemy.alive) return;
  enemy.hp -= dmg;
  state.run.dmgDealt += dmg;
  if (enemy.hp <= 0) killEnemy(enemy);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-frame update
// ─────────────────────────────────────────────────────────────────────────────
export function updateEnemies(dt) {
  const heroPos = state.hero.pos;
  const active = state.enemies.active;
  const spatial = state.enemies.spatial;

  // Iterate backwards so killEnemy splices are safe (it uses swap-pop too,
  // but backward iteration plays nicest with any future direct splicing).
  for (let i = active.length - 1; i >= 0; i--) {
    const e = active[i];
    if (!e.alive) continue;

    const ep = e.mesh.position;

    // ── Seek hero ──
    _tmpDir.set(heroPos.x - ep.x, 0, heroPos.z - ep.z);
    const distSq = _tmpDir.x * _tmpDir.x + _tmpDir.z * _tmpDir.z;

    if (distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const inv = 1 / dist;
      const dx = _tmpDir.x * inv;
      const dz = _tmpDir.z * inv;

      // Walk
      const step = e.spd * dt;
      ep.x += dx * step;
      ep.z += dz * step;

      // Face hero (XZ angle). Three.js: rotation.y of 0 looks down +Z;
      // atan2(x,z) is the standard "face this vector" formula.
      e.mesh.rotation.y = Math.atan2(dx, dz);
    }

    // ── Light separation ──
    // Query a small radius and push apart from up to 3 nearest neighbors.
    const neighbors = spatial.queryRadius(ep, SEPARATION_DIST);
    let pushed = 0;
    _tmpPush.set(0, 0, 0);
    for (let k = 0; k < neighbors.length && pushed < SEPARATION_NEIGHBORS; k++) {
      const o = neighbors[k];
      if (o === e || !o.alive) continue;
      const op = o.mesh.position;
      const ddx = ep.x - op.x;
      const ddz = ep.z - op.z;
      const dSq = ddx * ddx + ddz * ddz;
      if (dSq <= 1e-6 || dSq >= SEPARATION_DIST * SEPARATION_DIST) continue;
      const d = Math.sqrt(dSq);
      const overlap = (SEPARATION_DIST - d) / SEPARATION_DIST; // 0..1
      const inv = 1 / d;
      _tmpPush.x += ddx * inv * overlap;
      _tmpPush.z += ddz * inv * overlap;
      pushed++;
    }
    if (pushed > 0) {
      // Gentle nudge — keep magnitude < movement step so swarms still close.
      const pushStep = 1.5 * dt;
      ep.x += _tmpPush.x * pushStep;
      ep.z += _tmpPush.z * pushStep;
    }

    // ── Spatial hash position update ──
    spatial.move(e);

    // ── Contact damage ──
    if (e.contactCooldown > 0) e.contactCooldown -= dt;
    _tmpDelta.set(heroPos.x - ep.x, 0, heroPos.z - ep.z);
    const contactSq = _tmpDelta.x * _tmpDelta.x + _tmpDelta.z * _tmpDelta.z;
    if (contactSq <= CONTACT_DIST_SQ && e.contactCooldown <= 0) {
      heroTakeDamage(e.dmg);
      e.contactCooldown = CONTACT_CD;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public spatial query (for weapons / AoE)
// ─────────────────────────────────────────────────────────────────────────────
export function queryRadius(pos, r) {
  if (!state.enemies.spatial) return [];
  return state.enemies.spatial.queryRadius(pos, r);
}
