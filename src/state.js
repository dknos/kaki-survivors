/**
 * Single mutable GameState object. Every module imports `state` from this file.
 * No window globals. No module-scoped game data outside this file.
 * If you need to add data, add it here so it shows up in resetState().
 */
import * as THREE from 'three';
import { HERO, XP } from './config.js';

export const state = {
  // ── THREE.js core (set by main.js bootstrap) ──
  scene:    /** @type {THREE.Scene|null}  */ (null),
  camera:   /** @type {THREE.OrthographicCamera|null} */ (null),
  renderer: /** @type {THREE.WebGLRenderer|null} */ (null),
  composer: /** @type {any|null} */ (null),
  bloomPass: null,
  postFXPass: null,
  envGroup: /** @type {THREE.Group|null} */ (null),

  // ── Time ──
  time: {
    game: 0,          // paused-aware run time (seconds)
    dt: 0,            // last frame delta (clamped <= 0.05)
    real: 0,          // wall-clock (for UI anims during pause)
    paused: false,    // when true, main loop skips logic + renders only
  },

  // ── Hero ──
  hero: {
    mesh:   /** @type {THREE.Object3D|null} */ (null),
    pos:    new THREE.Vector3(),
    vel:    new THREE.Vector3(),
    facing: new THREE.Vector3(0, 0, 1),
    hp:     HERO.hpMax,
    hpMax:  HERO.hpMax,
    level:  1,
    xp:     0,
    xpNext: XP.base,
    iFramesUntil: 0,   // game-time at which i-frames expire
    /** stat multipliers applied by passives; default 1.0 */
    statMul: { dmg: 1, projSpeed: 1, area: 1, cooldown: 1, magnet: 1, hpMax: 1, moveSpeed: 1, duration: 1 },
  },

  // ── Enemies ──
  enemies: {
    /** @type {Array<EnemyInstance>} */
    active: [],
    /** pools keyed by glb key: { zombie: [mesh, mesh, ...], ... } */
    pools: /** @type {Record<string, THREE.Object3D[]>} */ ({}),
    /** spatial hash for fast radius queries (set by enemies.js init) */
    spatial: /** @type {any|null} */ (null),
  },

  // ── Projectiles (spawned by weapons) ──
  projectiles: {
    /** @type {Array<Projectile>} */
    active: [],
  },

  // ── Gems / XP drops ──
  gems: {
    instMesh:   /** @type {THREE.InstancedMesh|null} */ (null),
    /** @type {Array<Gem>} */
    list: [],
    nextSlot: 0,
  },

  // ── Weapons + Passives ──
  /** @type {Array<{id:string, level:number, inst:any}>} */
  weapons: [],
  /** @type {Array<{id:string, level:number}>} */
  passives: [],

  // ── Run stats ──
  run: {
    kills: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    pickedGems: 0,
    startedAt: 0,
  },

  // ── FX ──
  fx: {
    chromaticPulse: 0,   // 0..1, decays each frame
    bloomBoost: 0,       // 0..1, decays each frame
  },

  // ── Input ──
  input: {
    moveVec: new THREE.Vector2(),    // unit vector, screen-space (-1..1 each axis)
    fire: false,
  },

  // ── UI / level-up ──
  pendingLevelUp: false,
  /** @type {Array<{kind:'weapon'|'passive', id:string, level:number}>} */
  levelUpChoices: [],
  gameOver: false,
  started: false,        // false until "press start" cleared
};

/**
 * @typedef {Object} EnemyInstance
 * @property {THREE.Object3D} mesh
 * @property {string} glbKey
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} spd
 * @property {number} dmg
 * @property {number} contactCooldown  // seconds until can deal contact damage again
 * @property {boolean} elite
 * @property {boolean} alive
 */

/**
 * @typedef {Object} Projectile
 * @property {THREE.Object3D} mesh
 * @property {THREE.Vector3} vel
 * @property {number} dmg
 * @property {number} ttl       // seconds remaining
 * @property {number} pierce    // remaining hits before destroy
 * @property {Set<any>} hit     // enemies already damaged by this projectile
 * @property {string} ownerWeapon
 */

/**
 * @typedef {Object} Gem
 * @property {THREE.Vector3} pos
 * @property {number} value
 * @property {boolean} active
 * @property {boolean} magnetized
 * @property {number} instanceIndex
 */

export function resetState() {
  state.time.game = 0; state.time.dt = 0; state.time.paused = false;
  state.hero.pos.set(0,0,0); state.hero.vel.set(0,0,0);
  state.hero.hp = HERO.hpMax; state.hero.hpMax = HERO.hpMax;
  state.hero.level = 1; state.hero.xp = 0; state.hero.xpNext = XP.base;
  state.hero.iFramesUntil = 0;
  for (const k of Object.keys(state.hero.statMul)) state.hero.statMul[k] = 1;
  state.enemies.active.length = 0;
  state.projectiles.active.length = 0;
  state.gems.list.length = 0; state.gems.nextSlot = 0;
  state.weapons.length = 0;
  state.passives.length = 0;
  state.run.kills = 0; state.run.dmgDealt = 0; state.run.dmgTaken = 0; state.run.pickedGems = 0;
  state.run.startedAt = performance.now();
  state.fx.chromaticPulse = 0; state.fx.bloomBoost = 0;
  state.pendingLevelUp = false; state.levelUpChoices.length = 0; state.gameOver = false;
}

/** Compute XP required for next level after `lvl`. */
export function xpForLevel(lvl) {
  return Math.ceil(XP.base * Math.pow(XP.growth, lvl - 1));
}
