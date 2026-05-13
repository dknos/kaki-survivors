/**
 * Enemy projectile system. Wizards (and future ranged tiers) fire from
 * `enemies.js`. This module owns the visuals + movement + hero collision.
 */
import * as THREE from 'three';
import { state } from './state.js';
import { takeDamage as heroTakeDamage } from './hero.js';
import { tex } from './particleTextures.js';
import { BLOOM_LAYER } from './postfx.js';

const HIT_R = 0.9;
const HIT_R2 = HIT_R * HIT_R;
const WORLD_BOUND = 80;
const _flatX = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

// Shared geo/mat — every projectile is the same cheap glow.
const _coreGeo = new THREE.SphereGeometry(0.22, 10, 10);
const _coreMat = new THREE.MeshBasicMaterial({ color: 0xff88ff });
const _glowGeo = new THREE.PlaneGeometry(0.9, 0.9);
const _glowMat = new THREE.MeshBasicMaterial({
  map: tex('glowGold'),                        // tint via .color below
  color: 0xff66ee,
  transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
});

/**
 * Spawn an enemy projectile at (x,y,z) aimed at the hero. ttl in seconds.
 */
export function spawnEnemyProjectile(x, y, z, dmg = 9, speed = 9, ttl = 2.4) {
  const hero = state.hero.pos;
  const dx = hero.x - x;
  const dz = hero.z - z;
  const d = Math.hypot(dx, dz) || 1;
  const vx = (dx / d) * speed;
  const vz = (dz / d) * speed;

  const group = new THREE.Group();
  const core = new THREE.Mesh(_coreGeo, _coreMat);
  const glow = new THREE.Mesh(_glowGeo, _glowMat);
  glow.quaternion.copy(_flatX);
  glow.position.y = -0.05;
  core.layers.enable(BLOOM_LAYER);
  glow.layers.enable(BLOOM_LAYER);
  group.add(core);
  group.add(glow);
  group.position.set(x, y || 1.0, z);
  state.scene.add(group);

  state.enemyProjectiles.active.push({ mesh: group, vx, vz, ttl, dmg });
}

export function updateEnemyProjectiles(dt) {
  const list = state.enemyProjectiles.active;
  const heroPos = state.hero.pos;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.z += p.vz * dt;
    p.ttl -= dt;

    // Out-of-range or expired
    const dx = p.mesh.position.x - heroPos.x;
    const dz = p.mesh.position.z - heroPos.z;
    const d2 = dx * dx + dz * dz;
    if (p.ttl <= 0 || Math.abs(dx) > WORLD_BOUND || Math.abs(dz) > WORLD_BOUND) {
      state.scene.remove(p.mesh);
      list.splice(i, 1);
      continue;
    }
    // Hero collision
    if (d2 <= HIT_R2) {
      heroTakeDamage(p.dmg);
      state.scene.remove(p.mesh);
      list.splice(i, 1);
      continue;
    }
  }
}
