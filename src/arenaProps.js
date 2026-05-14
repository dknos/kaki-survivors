/**
 * Arena props — breakable barrels / crates / totems scattered at run start.
 * Each prop on break drops 1–3 gems and may drop a heart. Cheap to maintain:
 * a small list of self-managed groups; we check hero-dash overlap each tick
 * (mirrors src/destructibles.js but with palette-colored boxes instead of
 * the InstancedMesh log set).
 */
import * as THREE from 'three';
import { state } from './state.js';
import { BLOOM_LAYER } from './postfx.js';

const PROP_MIN = 8;
const PROP_MAX = 12;
const SPAWN_RING_MIN = 6;
const SPAWN_RING_MAX = 25;
const HIT_RADIUS = 1.1;          // dash overlap radius
const HEART_CHANCE = 0.18;
const PROP_KINDS = ['barrel', 'crate', 'totem'];

const COLOR_WOOD  = 0x6a4a2a;
const COLOR_STONE = 0x8a8a8a;
const COLOR_TOTEM = 0x7a5c3a;

let _scene = null;
const _props = [];   // { group, x, z, alive, kind }

function _makeProp(kind) {
  const g = new THREE.Group();
  let mesh;
  if (kind === 'barrel') {
    const geo = new THREE.CylinderGeometry(0.45, 0.55, 1.1, 12);
    geo.translate(0, 0.55, 0);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: COLOR_WOOD, roughness: 0.95, metalness: 0.0,
    }));
    // Iron bands — two thin torus rings
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 });
    const b1 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 16), bandMat);
    b1.rotation.x = Math.PI / 2; b1.position.y = 0.25;
    const b2 = b1.clone(); b2.position.y = 0.85;
    g.add(mesh); g.add(b1); g.add(b2);
  } else if (kind === 'crate') {
    const geo = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    geo.translate(0, 0.48, 0);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: COLOR_WOOD, roughness: 0.9, metalness: 0.0,
    }));
    g.add(mesh);
  } else { // totem — stacked stone cubes
    const matStone = new THREE.MeshStandardMaterial({ color: COLOR_STONE, roughness: 0.95 });
    const matCap   = new THREE.MeshStandardMaterial({ color: COLOR_TOTEM, roughness: 0.85 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.9), matStone);
    base.position.y = 0.2;
    const mid  = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), matStone);
    mid.position.y = 0.65;
    const cap  = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), matCap);
    cap.position.y = 1.05;
    g.add(base); g.add(mid); g.add(cap);
    mesh = cap;
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

export function initArenaProps(scene) {
  _scene = scene;
}

export function spawnArenaProps() {
  if (!_scene) return;
  resetArenaProps();
  const count = PROP_MIN + Math.floor(Math.random() * (PROP_MAX - PROP_MIN + 1));
  for (let i = 0; i < count; i++) {
    const kind = PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)];
    const ang = Math.random() * Math.PI * 2;
    const r = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const group = _makeProp(kind);
    group.position.set(x, 0, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    _scene.add(group);
    _props.push({ group, x, z, alive: true, kind });
  }
}

export function resetArenaProps() {
  if (!_scene) return;
  for (const p of _props) {
    if (p.group && p.group.parent) p.group.parent.remove(p.group);
  }
  _props.length = 0;
}

function _breakProp(p) {
  p.alive = false;
  if (p.group && p.group.parent) p.group.parent.remove(p.group);
  const x = p.x, z = p.z;
  // Drop 1–3 gems
  const gems = 1 + Math.floor(Math.random() * 3);
  import('./xp.js').then(({ dropGem }) => {
    for (let i = 0; i < gems; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.4;
      dropGem(new THREE.Vector3(x + Math.cos(ang) * r, 0, z + Math.sin(ang) * r), 1);
    }
  });
  if (Math.random() < HEART_CHANCE) {
    import('./pickups.js').then(({ spawnHeart }) => spawnHeart(x, z));
  }
  import('./fx.js').then(({ spawnKillRing, spawnMagnetSpark }) => {
    spawnKillRing(x, z, false);
    const col = p.kind === 'totem' ? 0xaaaaaa : 0xc8884a;
    for (let i = 0; i < 6; i++) spawnMagnetSpark(x, 0.4, z, col);
  });
  state.fx.bloomBoost = Math.max(state.fx.bloomBoost || 0, 0.2);
}

/** Smash any prop within `radius` of (x, z). Returns number broken. */
export function smashPropsInRadius(x, z, radius) {
  if (!_props.length) return 0;
  const r2 = radius * radius;
  let broken = 0;
  for (const p of _props) {
    if (!p.alive) continue;
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz <= r2) { _breakProp(p); broken++; }
  }
  return broken;
}

/**
 * Per-frame tick — checks if hero (while dashing) is close enough to break a
 * prop, and resolves projectile overlaps against any active prop.
 * Cheap O(props × projectiles_nearby).
 */
export function tickArenaProps(dt) {
  if (_props.length === 0) return;
  const h = state.hero && state.hero.pos;
  if (!h) return;
  // Hero dash overlap
  const dashing = state.hero.dashUntil && state.time.real < state.hero.dashUntil;
  if (dashing) {
    smashPropsInRadius(h.x, h.z, HIT_RADIUS);
  }
  // Projectile overlap — any player projectile within HIT_RADIUS breaks it.
  const proj = state.projectiles && state.projectiles.active;
  if (proj && proj.length) {
    for (const p of _props) {
      if (!p.alive) continue;
      for (let i = 0; i < proj.length; i++) {
        const pr = proj[i];
        if (!pr || !pr.mesh) continue;
        const dx = pr.mesh.position.x - p.x;
        const dz = pr.mesh.position.z - p.z;
        if (dx * dx + dz * dz <= HIT_RADIUS * HIT_RADIUS) {
          _breakProp(p);
          break;
        }
      }
    }
  }
}
