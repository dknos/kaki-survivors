/**
 * Holy Croissants — orbital weapon.
 * N orbs orbit the hero, damaging enemies on contact (with per-orb per-enemy cooldown).
 */
import * as THREE from 'three';
import { state } from '../state.js';
import { damageEnemy, queryRadius } from '../enemies.js';

const ORB_GEO = new THREE.SphereGeometry(0.25, 8, 8);
const ORB_MAT = new THREE.MeshBasicMaterial({ color: 0xffcc44 });
const HIT_RADIUS = 0.5;

function spawnOrbs(level, inst) {
  const scene = state.scene;
  inst.orbs = [];
  for (let i = 0; i < level.count; i++) {
    const mesh = new THREE.Mesh(ORB_GEO, ORB_MAT);
    mesh.position.copy(state.hero.pos);
    mesh.position.y = 0.5;
    scene.add(mesh);
    inst.orbs.push({
      mesh,
      angle: (i / level.count) * Math.PI * 2,
      lastHitTime: new Map(),
    });
  }
}

function disposeOrbs(inst) {
  if (!inst.orbs) return;
  const scene = state.scene;
  for (const o of inst.orbs) {
    if (o.mesh) scene.remove(o.mesh);
  }
  inst.orbs = null;
}

export default {
  id: 'orbitals',
  name: 'Holy Croissants',
  desc: 'Orbiting orbs damage on contact',
  icon: '🥐',
  maxLevel: 8,
  levels: [
    { count: 2, dmg: 8,  radius: 2.5, rotSpeed: 2.4, dmgInterval: 0.5 },
    { count: 3, dmg: 10, radius: 2.6, rotSpeed: 2.6, dmgInterval: 0.45 },
    { count: 3, dmg: 13, radius: 2.8, rotSpeed: 2.8, dmgInterval: 0.4 },
    { count: 4, dmg: 16, radius: 3.0, rotSpeed: 2.9, dmgInterval: 0.4 },
    { count: 4, dmg: 20, radius: 3.2, rotSpeed: 3.0, dmgInterval: 0.35 },
    { count: 5, dmg: 25, radius: 3.4, rotSpeed: 3.0, dmgInterval: 0.3 },
    { count: 5, dmg: 32, radius: 3.6, rotSpeed: 3.2, dmgInterval: 0.3 },
    { count: 6, dmg: 40, radius: 3.8, rotSpeed: 3.4, dmgInterval: 0.25 },
  ],

  init(state, level, inst) {
    spawnOrbs(level, inst);
  },

  tick(state, dt, level, inst) {
    if (!inst.orbs) return;
    const hero = state.hero.pos;
    const now = state.time.game;
    const areaMul = state.hero.statMul.area || 1;
    const radius = level.radius * areaMul;
    const dmgMul = state.hero.statMul.dmg || 1;
    const dmg = level.dmg * dmgMul;

    for (const orb of inst.orbs) {
      orb.angle += level.rotSpeed * dt;
      const x = hero.x + Math.cos(orb.angle) * radius;
      const z = hero.z + Math.sin(orb.angle) * radius;
      orb.mesh.position.set(x, 0.5, z);

      // Collision check
      const candidates = queryRadius(orb.mesh.position, HIT_RADIUS);
      if (!candidates || candidates.length === 0) continue;
      for (const enemy of candidates) {
        if (!enemy || !enemy.alive) continue;
        const last = orb.lastHitTime.get(enemy) || -Infinity;
        if (now - last >= level.dmgInterval) {
          damageEnemy(enemy, dmg);
          orb.lastHitTime.set(enemy, now);
        }
      }
    }
  },

  refresh(state, level, inst) {
    disposeOrbs(inst);
    spawnOrbs(level, inst);
  },
};
