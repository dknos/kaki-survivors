/**
 * GLTF preload + cache. Adapted from index.html lines 1985-2068 of the original game.
 * Exports a Promise that resolves once all assets are loaded (or failed gracefully).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

export const BASE = 'assets/breakroom/';

/** @type {Record<string, any>} */
export const GLTF_CACHE = {};

const _loader = new GLTFLoader();

function _preload(key, path) {
  return new Promise(resolve => {
    _loader.load(
      path,
      gltf => {
        GLTF_CACHE[key] = gltf;
        resolve(true);
      },
      undefined,
      err => {
        console.warn(`[assets] failed: ${path}`, err);
        GLTF_CACHE[key] = null;
        resolve(false);
      }
    );
  });
}

/**
 * Clone a cached GLTF scene. Uses SkeletonUtils.clone for skinned meshes.
 * Returns null if the asset wasn't loaded.
 */
export function cloneCached(key) {
  const gltf = GLTF_CACHE[key];
  if (!gltf) return null;
  return SkeletonUtils.clone(gltf.scene);
}

/**
 * Preload hero + enemy roster. Keys here map to config.js ENEMY_TIERS[].glb
 * and HERO.glb. If a key is missing here, the corresponding system silently skips.
 */
export function preloadAll() {
  const list = [
    ['hero',     BASE + 'tower-castle.glb'],
    ['zombie',   BASE + 'Zombie.glb'],
    ['goblin',   BASE + 'Goblin.glb'],
    ['skeleton', BASE + 'Skeleton.glb'],
    ['orc',      BASE + 'Orc-Q.glb'],
    ['demon',    BASE + 'Demon.glb'],
    ['robot',    BASE + 'Robot-Enemy.glb'],
    ['mech',     BASE + 'Mech-Walker.glb'],
    ['xeno',     BASE + 'xenomorph.glb'],
    ['slime',    BASE + 'Slime-Enemy.glb'],
    ['giant',    BASE + 'Giant.glb'],
    ['dragon',   BASE + 'Dragon.glb'],
    ['rock',     BASE + 'Rock.glb'],
    ['tree',     BASE + 'Tree.glb'],
    ['bush',     BASE + 'Bush.glb'],
    ['dead_tree',BASE + 'Dead Tree.glb'],
  ];
  return Promise.all(list.map(([k, p]) => _preload(k, p)));
}
