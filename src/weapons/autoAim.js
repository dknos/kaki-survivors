/**
 * Magic Missile — auto-aim projectile weapon.
 * Fires at the nearest enemy on cooldown. Projectile updates live in weapons/index.js.
 */
import * as THREE from 'three';
import { state } from '../state.js';
import { queryRadius } from '../enemies.js';
import { sfx } from '../audio.js';

const PROJ_GEO = new THREE.SphereGeometry(0.25, 8, 8);
const PROJ_MAT = new THREE.MeshBasicMaterial({ color: 0x66ddff });

const SEARCH_RADIUS = 40;
const FAN_SPREAD = 0.18; // radians between fanned projectiles

function findNearestEnemy(pos) {
  // Try queryRadius first (uses spatial hash if available)
  let candidates = null;
  try { candidates = queryRadius(pos, SEARCH_RADIUS); } catch (_) { candidates = null; }
  if (!candidates || candidates.length === 0) candidates = state.enemies.active;
  if (!candidates || candidates.length === 0) return null;

  let best = null;
  let bestD2 = Infinity;
  for (const e of candidates) {
    if (!e || !e.alive) continue;
    const ep = e.mesh ? e.mesh.position : e.pos;
    if (!ep) continue;
    const dx = ep.x - pos.x;
    const dz = ep.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}

function spawnProjectile(origin, dir, level, dmg) {
  const mesh = new THREE.Mesh(PROJ_GEO, PROJ_MAT);
  mesh.position.set(origin.x, 0.5, origin.z);
  state.scene.add(mesh);
  const vel = new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(level.speed * (state.hero.statMul.projSpeed || 1));
  state.projectiles.active.push({
    mesh,
    vel,
    dmg,
    ttl: level.ttl * (state.hero.statMul.duration || 1),
    pierce: level.pierce,
    hit: new Set(),
    ownerWeapon: 'autoaim',
  });
}

export default {
  id: 'autoaim',
  name: 'Magic Missile',
  desc: 'Auto-fires at the nearest enemy',
  icon: '✨',
  maxLevel: 8,
  levels: [
    { cooldown: 1.00, speed: 18, dmg: 12, ttl: 2.0, pierce: 1, count: 1 },
    { cooldown: 0.85, speed: 19, dmg: 16, ttl: 2.0, pierce: 1, count: 1 },
    { cooldown: 0.75, speed: 20, dmg: 22, ttl: 2.0, pierce: 2, count: 1 },
    { cooldown: 0.65, speed: 21, dmg: 30, ttl: 2.2, pierce: 2, count: 2 },
    { cooldown: 0.55, speed: 22, dmg: 40, ttl: 2.2, pierce: 3, count: 2 },
    { cooldown: 0.50, speed: 24, dmg: 54, ttl: 2.5, pierce: 3, count: 3 },
    { cooldown: 0.45, speed: 26, dmg: 70, ttl: 2.5, pierce: 4, count: 3 },
    { cooldown: 0.40, speed: 28, dmg: 90, ttl: 3.0, pierce: 4, count: 4 },
  ],

  init(state, level, inst) {
    inst.cd = 0; // fire immediately on first tick when an enemy is present
  },

  tick(state, dt, level, inst) {
    if (inst.cd === undefined) inst.cd = 0;
    inst.cd -= dt;
    if (inst.cd > 0) return;

    const hero = state.hero.pos;
    const target = findNearestEnemy(hero);
    if (!target) {
      // wait a short retry rather than spamming search every frame
      inst.cd = 0.15;
      return;
    }

    const tp = target.mesh ? target.mesh.position : target.pos;
    const dx = tp.x - hero.x;
    const dz = tp.z - hero.z;
    const len = Math.hypot(dx, dz) || 1;
    const baseAngle = Math.atan2(dz, dx);

    const dmgMul = state.hero.statMul.dmg || 1;
    const dmg = level.dmg * dmgMul;
    const n = level.count;

    for (let i = 0; i < n; i++) {
      const offset = (i - (n - 1) / 2) * FAN_SPREAD;
      const a = baseAngle + offset;
      const dir = { x: Math.cos(a), z: Math.sin(a) };
      spawnProjectile(hero, dir, level, dmg);
    }

    try { sfx.shoot(); } catch (_) {}

    inst.cd = level.cooldown * (state.hero.statMul.cooldown || 1);
  },

  refresh(state, level, inst) {
    // Snap cooldown so the new level can fire promptly.
    if (inst.cd === undefined || inst.cd > level.cooldown) {
      inst.cd = Math.min(inst.cd ?? 0, level.cooldown * 0.25);
    }
  },
};
