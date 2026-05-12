/**
 * Weapon registry + lifecycle. Add a new weapon by:
 *   1) creating src/weapons/foo.js with the default-export contract,
 *   2) importing it here and adding to REGISTRY.
 *
 * The rest of the game talks to weapons only through the four exports below.
 */
import * as THREE from 'three';
import { state } from '../state.js';
import { damageEnemy, queryRadius } from '../enemies.js';

import orbitals from './orbitals.js';
import autoAim from './autoAim.js';

export const REGISTRY = {
  [orbitals.id]: orbitals,
  [autoAim.id]:  autoAim,
};

const WORLD_BOUND = 200; // projectile cull bound (square half-extent around hero)
const PROJ_HIT_RADIUS = 0.6;

export function initWeapons() {
  // Nothing to set up globally — scene/state are already available via `state`.
  // This exists for symmetry with the rest of the bootstrap order in main.js.
}

export function acquireWeapon(id) {
  const mod = REGISTRY[id];
  if (!mod) {
    console.warn('[weapons] unknown weapon id:', id);
    return;
  }
  const existing = state.weapons.find(w => w.id === id);
  if (existing) {
    if (existing.level >= mod.maxLevel) return;
    existing.level += 1;
    const level = mod.levels[existing.level - 1];
    if (mod.refresh) mod.refresh(state, level, existing.inst);
    return;
  }
  const entry = { id, level: 1, inst: {} };
  state.weapons.push(entry);
  const level = mod.levels[0];
  if (mod.init) mod.init(state, level, entry.inst);
}

export function tickWeapons(dt) {
  // 1) Run each weapon's tick
  for (const entry of state.weapons) {
    const mod = REGISTRY[entry.id];
    if (!mod) continue;
    const level = mod.levels[entry.level - 1];
    if (mod.tick) mod.tick(state, dt, level, entry.inst);
  }
  // 2) Update all live projectiles (spawned by weapons above)
  tickProjectiles(dt);
}

function tickProjectiles(dt) {
  const list = state.projectiles.active;
  const scene = state.scene;
  const hero = state.hero.pos;

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    // Move
    p.mesh.position.x += p.vel.x * dt;
    p.mesh.position.z += p.vel.z * dt;
    p.ttl -= dt;

    // Out-of-bounds / expired
    const dx = p.mesh.position.x - hero.x;
    const dz = p.mesh.position.z - hero.z;
    if (p.ttl <= 0 || Math.abs(dx) > WORLD_BOUND || Math.abs(dz) > WORLD_BOUND) {
      disposeProjectile(p, scene);
      list.splice(i, 1);
      continue;
    }

    // Collide vs enemies
    let candidates = null;
    try { candidates = queryRadius(p.mesh.position, PROJ_HIT_RADIUS); } catch (_) { candidates = null; }
    if (!candidates || candidates.length === 0) continue;

    let killed = false;
    for (const enemy of candidates) {
      if (!enemy || !enemy.alive) continue;
      if (p.hit.has(enemy)) continue;
      damageEnemy(enemy, p.dmg);
      p.hit.add(enemy);
      p.pierce -= 1;
      if (p.pierce <= 0) {
        disposeProjectile(p, scene);
        list.splice(i, 1);
        killed = true;
        break;
      }
    }
    if (killed) continue;
  }
}

function disposeProjectile(p, scene) {
  if (p.mesh && scene) scene.remove(p.mesh);
}

/**
 * Returns up to N level-up choices for weapons only.
 * Each choice: { kind:'weapon', id, level: nextLevel }.
 * Passives are handled elsewhere (xp.js).
 */
export function weaponChoices(n) {
  const ids = Object.keys(REGISTRY);
  const owned = new Map(state.weapons.map(w => [w.id, w]));
  const pool = [];

  for (const id of ids) {
    const mod = REGISTRY[id];
    const have = owned.get(id);
    if (have) {
      if (have.level < mod.maxLevel) {
        pool.push({ kind: 'weapon', id, level: have.level + 1 });
      }
    } else {
      // Respect maxSlots: if all slots are full, only level-ups are offered
      // (handled by the caller too, but be defensive).
      pool.push({ kind: 'weapon', id, level: 1 });
    }
  }

  // Shuffle (Fisher–Yates) and take first N
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, n);
}
