/**
 * All gameplay tunables. Modules import from here — no magic numbers in code.
 */

export const WORLD = {
  cameraDistance: 28,       // ortho frustum half-height baseline
  cameraLerp: 0.10,         // 0..1, higher = snappier follow
  groundSize: 800,          // forest plane edge length
  fogNear: 60,
  fogFar: 200,
  bgColor: 0x061008,
};

export const HERO = {
  glb: 'tower-castle.glb',  // donor model from original game
  scale: 0.06,              // tower-scale → hero-scale
  speed: 8.0,               // units/sec
  hpMax: 100,
  iFramesSec: 0.6,
  pickupRadius: 4.0,        // gem magnet radius (modified by magnet stat)
  contactPushback: 0.5,     // hero gets nudged on enemy contact
  yOffset: 0,
};

export const XP = {
  base: 5,                  // xp needed for level 2
  growth: 1.18,             // xpNext = base * growth^(level-1)
  gemValue: 1,              // default
  gemSize: 0.35,
  gemMagnetMaxSpeed: 30,
  gemMagnetAccel: 60,
};

export const SPAWN = {
  targetAliveBase: 25,
  targetAlivePerD: 18,      // alive = base + D * perD
  targetAliveCap: 220,
  difficultyRampSec: 60,    // D goes 0→1 over first 60s
  difficultyMaxSec: 1800,   // D maxes at 30min
  difficultyMax: 10,
  ringRadius: 32,           // spawn distance from hero
  ringJitter: 4,
  hordeIntervalSec: 90,
  hordeCount: 30,
  bossIntervalSec: 300,
  spawnBatchPerTick: 4,     // how many enemies can spawn in one director tick
  tickIntervalSec: 0.5,
};

/**
 * Enemy tier table. glb keys must match preload list in assets.js.
 * spd = units/sec, dmg = per-contact damage, hp = base HP, weight = roll weight,
 * minD = minimum difficulty before this tier can appear.
 */
export const ENEMY_TIERS = [
  { glb: 'zombie',    hp: 6,   spd: 2.2, dmg: 4,  minD: 0.0, weight: 10, scale: 0.9 },
  { glb: 'goblin',    hp: 9,   spd: 2.9, dmg: 5,  minD: 0.4, weight: 8,  scale: 0.8 },
  { glb: 'skeleton',  hp: 14,  spd: 2.4, dmg: 6,  minD: 0.9, weight: 7,  scale: 0.9 },
  { glb: 'orc',       hp: 28,  spd: 1.9, dmg: 10, minD: 1.8, weight: 5,  scale: 1.1 },
  { glb: 'demon',     hp: 22,  spd: 2.6, dmg: 9,  minD: 2.2, weight: 5,  scale: 0.95 },
  { glb: 'robot',     hp: 50,  spd: 1.7, dmg: 14, minD: 3.5, weight: 3,  scale: 1.0 },
  { glb: 'mech',      hp: 90,  spd: 1.4, dmg: 18, minD: 4.5, weight: 2,  scale: 1.1 },
  { glb: 'xeno',      hp: 65,  spd: 3.0, dmg: 12, minD: 5.0, weight: 3,  scale: 1.0 },
  { glb: 'slime',     hp: 35,  spd: 2.0, dmg: 8,  minD: 1.5, weight: 4,  scale: 1.0 },
  { glb: 'giant',     hp: 200, spd: 1.2, dmg: 25, minD: 6.0, weight: 1,  scale: 1.3, elite: true },
  { glb: 'dragon',    hp: 400, spd: 1.2, dmg: 30, minD: 7.0, weight: 1,  scale: 1.4, elite: true },
];

/** Initial roster size pre-warmed per pool to hide first-horde stall. */
export const POOL_PREWARM = {
  zombie: 50, goblin: 40, skeleton: 30, orc: 20, demon: 20,
  robot: 12, mech: 8, xeno: 12, slime: 16, giant: 4, dragon: 2,
};

export const SPATIAL = {
  cellSize: 6,              // SpatialHash cell edge
};

export const WEAPONS = {
  startingWeapon: 'orbitals',
  maxSlots: 6,
  maxPassives: 6,
};

export const STAGE = {
  durationSec: 1800,        // run length
};
