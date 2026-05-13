/**
 * Cheesy Burgers — orbital weapon.
 * N burgers orbit the hero, damaging on contact (per-orb/per-enemy cooldown).
 * Each burger is a stacked group: bottom bun + patty + cheese square + top bun
 * with sesame seed dots. A flat additive glow disc sits under each one so they
 * still read as energy + pop under bloom.
 */
import * as THREE from 'three';
import { state } from '../state.js';
import { damageEnemy, queryRadius } from '../enemies.js';
import { tex } from '../particleTextures.js';
import { BLOOM_LAYER } from '../postfx.js';
import { cloneCached } from '../assets.js';

// ── Shared geometries + materials (cached across all orbs for batching) ──
const BUN_GEO    = new THREE.CylinderGeometry(0.30, 0.34, 0.16, 18);
const TOP_BUN_GEO = new THREE.SphereGeometry(0.32, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2); // dome
const PATTY_GEO  = new THREE.CylinderGeometry(0.32, 0.32, 0.09, 18);
// Cheese now sits INSIDE the bun outline (slightly smaller than patty) so
// the burger silhouette stays round. No emissive — bloom was making the
// flat square dominate and pulse blue-white. Keeps a faint yellow tint only.
const CHEESE_GEO = new THREE.BoxGeometry(0.58, 0.04, 0.58);
const SEED_GEO   = new THREE.SphereGeometry(0.035, 6, 5);

const BUN_MAT    = new THREE.MeshStandardMaterial({ color: 0xd99b54, roughness: 0.78, metalness: 0.0 });
const PATTY_MAT  = new THREE.MeshStandardMaterial({ color: 0x3e1f0e, roughness: 0.85, metalness: 0.0 });
const CHEESE_MAT = new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.7, metalness: 0.0 });
const SEED_MAT   = new THREE.MeshStandardMaterial({ color: 0xf2e3b6, roughness: 0.7 });

const GLOW_GEO = new THREE.PlaneGeometry(0.95, 0.95);
const GLOW_MAT = new THREE.MeshBasicMaterial({
  map: tex('glowGold'), color: 0xffd24a,
  transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
});

const HIT_RADIUS = 0.55;
const _glowFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

// Build a fallback burger from primitives if no GLB is provided.
function _makeBurgerPrimitive() {
  const g = new THREE.Group();
  const bot = new THREE.Mesh(BUN_GEO, BUN_MAT);
  bot.position.y = 0.08;
  bot.castShadow = true;
  g.add(bot);
  const patty = new THREE.Mesh(PATTY_GEO, PATTY_MAT);
  patty.position.y = 0.20;
  g.add(patty);
  const cheese = new THREE.Mesh(CHEESE_GEO, CHEESE_MAT);
  cheese.position.y = 0.255;
  cheese.rotation.y = Math.PI / 6;
  g.add(cheese);
  const top = new THREE.Mesh(TOP_BUN_GEO, BUN_MAT);
  top.scale.set(1.0, 0.85, 1.0);
  top.position.y = 0.28;
  top.castShadow = true;
  g.add(top);
  const seedPositions = [
    [0.00, 0.50, 0.00], [0.16, 0.46, 0.04], [-0.14, 0.46, -0.06],
    [0.08, 0.47, -0.16], [-0.10, 0.47, 0.14],
  ];
  for (const [x, y, z] of seedPositions) {
    const s = new THREE.Mesh(SEED_GEO, SEED_MAT);
    s.position.set(x, y, z);
    g.add(s);
  }
  return g;
}

// Auto-fit a cloned GLB to a target bounding-box height (in world units),
// so any donated cheeseburger model — regardless of authored scale or pivot —
// reads at the right size as an orbital. Centers on origin too.
const TARGET_HEIGHT = 0.95;     // matches the primitive's silhouette
function _normalizeBurgerGlb(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const h = Math.max(0.001, size.y);
  const k = TARGET_HEIGHT / h;
  root.scale.multiplyScalar(k);
  // Recompute center post-scale and shift so origin sits at the burger base.
  root.position.x -= center.x * k;
  root.position.y -= (center.y - size.y / 2) * k;
  root.position.z -= center.z * k;
  // Cast/receive shadows so the orbital looks grounded.
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

// Try the GLB first; fall back to primitives if missing.
function _makeBurger() {
  const glb = cloneCached('burger');
  if (glb) {
    const wrap = new THREE.Group();
    wrap.add(_normalizeBurgerGlb(glb));
    return wrap;
  }
  return _makeBurgerPrimitive();
}

function spawnOrbs(level, inst) {
  const scene = state.scene;
  inst.orbs = [];
  for (let i = 0; i < level.count; i++) {
    const group = new THREE.Group();
    // Burger stack — stays on the default render layer. BLOOM_LAYER is for
    // glowy emissives; putting the burger on it makes the bloom pass render
    // each mesh in isolation against black, then additive-composite it back,
    // which produced the ghostly "blue square" look the player flagged.
    const burger = _makeBurger();
    group.add(burger);
    // Flat additive glow on ground
    const glow = new THREE.Mesh(GLOW_GEO, GLOW_MAT);
    glow.quaternion.copy(_glowFlat);
    glow.position.y = -0.40;
    glow.layers.enable(BLOOM_LAYER);
    group.add(glow);
    group.position.copy(state.hero.pos);
    group.position.y = 0.5;
    scene.add(group);
    inst.orbs.push({
      mesh: group,
      core: burger,
      glow,
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
  name: 'Cheesy Burgers',
  desc: 'Sacred cheeseburgers orbit you, smashing what they touch',
  icon: '🍔',
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
    const evoMul = inst.evolved ? 2.5 : 1;
    const dmg = level.dmg * dmgMul * evoMul;
    const radiusFinal = radius * (inst.evolved ? 1.15 : 1);

    // Toxic Halo evo: tint the cheese poison-green + recolor the ground glow
    if (inst.evolved && !inst._tinted) {
      inst._tinted = true;
      for (const orb of inst.orbs) {
        // Walk the burger group; the cheese has the unique CHEESE_MAT color.
        if (orb.core && orb.core.traverse) {
          orb.core.traverse(o => {
            if (!o.isMesh || !o.material) return;
            // Cheese slice has the warmest emissive — recolor to poison.
            if (o.geometry === CHEESE_GEO) {
              o.material = o.material.clone();
              o.material.color.set(0xb0ff44);
              o.material.emissive.set(0x4a8a1a);
              o.material.emissiveIntensity = 0.5;
            }
          });
        }
        if (orb.glow && orb.glow.material) {
          orb.glow.material = orb.glow.material.clone();
          orb.glow.material.color.set(0x99ff33);
        }
      }
    }

    // Subtle glow pulse — costs nothing, reads as energy
    const pulse = 1 + Math.sin(now * 4) * 0.08;

    for (const orb of inst.orbs) {
      orb.angle += level.rotSpeed * dt;
      const x = hero.x + Math.cos(orb.angle) * radiusFinal;
      const z = hero.z + Math.sin(orb.angle) * radiusFinal;
      orb.mesh.position.set(x, 0.5, z);
      // Self-spin so each burger reads as a tumbling object, not a sprite.
      if (orb.core) orb.core.rotation.y += dt * 1.8;
      if (orb.glow) orb.glow.scale.setScalar(pulse);

      // Collision check
      const candidates = queryRadius(orb.mesh.position, HIT_RADIUS);
      if (!candidates || candidates.length === 0) continue;
      for (const enemy of candidates) {
        if (!enemy || !enemy.alive) continue;
        const last = orb.lastHitTime.get(enemy) || -Infinity;
        if (now - last >= level.dmgInterval) {
          const src = inst.evolved ? 'toxic_halo' : 'orbitals';
          damageEnemy(enemy, dmg, src);
          orb.lastHitTime.set(enemy, now);
          // Toxic Halo: stamp a poison DoT (1s @ dmg/2 per second)
          if (inst.evolved) {
            enemy._dotDps = dmg * 0.5;
            enemy._dotUntil = now + 1.0;
            enemy._dotSource = src;
          }
        }
      }
    }
  },

  refresh(state, level, inst) {
    disposeOrbs(inst);
    spawnOrbs(level, inst);
  },
};
