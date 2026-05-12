/**
 * Enemy spawn director.
 *
 * Continuous-flow spawner with a difficulty curve D(t):
 *   t ∈ [0, rampSec)        → D = t / rampSec           (0 → 1)
 *   t ∈ [rampSec, maxSec)   → D linear 1 → difficultyMax
 *   t ≥ maxSec              → D = difficultyMax
 *
 * Each director tick (throttled to SPAWN.tickIntervalSec):
 *   - Tops up active enemies toward target = base + D * perD (capped).
 *   - Picks a weighted-random tier unlocked by D and spawns it on a ring
 *     around the hero, slightly off the orthographic frustum.
 *
 * Periodic events:
 *   - Horde   every SPAWN.hordeIntervalSec  → burst of hordeCount mid-tier in an arc.
 *   - Boss    every SPAWN.bossIntervalSec   → one elite at 5× HP on a wider ring.
 */
import { state } from './state.js';
import { ENEMY_TIERS, SPAWN } from './config.js';
import { spawnEnemy } from './enemies.js';

// ── Module-local director state ──────────────────────────────────────────────
let _acc = 0;
let _nextHorde = SPAWN.hordeIntervalSec;
let _nextBoss = SPAWN.bossIntervalSec;
let _lastSeenTime = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────
function weightedPick(tiers) {
  const total = tiers.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of tiers) { r -= t.weight; if (r <= 0) return t; }
  return tiers[tiers.length - 1];
}

function computeDifficulty(t) {
  if (t <= 0) return 0;
  if (t < SPAWN.difficultyRampSec) return t / SPAWN.difficultyRampSec;
  if (t < SPAWN.difficultyMaxSec) {
    const span = SPAWN.difficultyMaxSec - SPAWN.difficultyRampSec;
    const k = (t - SPAWN.difficultyRampSec) / span;
    return 1 + k * (SPAWN.difficultyMax - 1);
  }
  return SPAWN.difficultyMax;
}

function ringPos(angle, radius) {
  const hp = state.hero.pos;
  return {
    x: hp.x + Math.cos(angle) * radius,
    z: hp.z + Math.sin(angle) * radius,
  };
}

function spawnOnRing(tier, angle, radiusMul = 1) {
  const r = (SPAWN.ringRadius + (Math.random() * 2 - 1) * SPAWN.ringJitter) * radiusMul;
  const { x, z } = ringPos(angle, r);
  spawnEnemy(tier, x, z);
}

// ── Public API ───────────────────────────────────────────────────────────────
export function initSpawnDirector() {
  _acc = 0;
  _nextHorde = SPAWN.hordeIntervalSec;
  _nextBoss = SPAWN.bossIntervalSec;
  _lastSeenTime = 0;
}

export function resetSpawnDirector() { initSpawnDirector(); }

export function tickSpawnDirector(dt) {
  const t = state.time.game;

  // Detect restart (game time rewound)
  if (t < _lastSeenTime) {
    _acc = 0;
    _nextHorde = SPAWN.hordeIntervalSec;
    _nextBoss = SPAWN.bossIntervalSec;
  }
  _lastSeenTime = t;

  _acc += dt;
  if (_acc < SPAWN.tickIntervalSec) return;
  _acc = 0;

  const D = computeDifficulty(t);

  // Tiers currently allowed by difficulty
  const allowedTiers = ENEMY_TIERS.filter(tier => tier.minD <= D);
  if (allowedTiers.length === 0) return;

  // ── Continuous top-up ──
  const target = Math.min(
    SPAWN.targetAliveCap,
    SPAWN.targetAliveBase + D * SPAWN.targetAlivePerD
  );
  const deficit = target - state.enemies.active.length;
  if (deficit > 0) {
    const n = Math.min(SPAWN.spawnBatchPerTick, Math.ceil(deficit));
    for (let i = 0; i < n; i++) {
      const tier = weightedPick(allowedTiers);
      const angle = Math.random() * Math.PI * 2;
      spawnOnRing(tier, angle);
    }
  }

  // ── Horde event ──
  if (t >= _nextHorde) {
    // Mid-tier: allowed by D, not elite. Fall back to allowed if filter is empty.
    const hordePool = allowedTiers.filter(tier => !tier.elite);
    const pool = hordePool.length > 0 ? hordePool : allowedTiers;

    // Tight arc on one side of hero
    const center = Math.random() * Math.PI * 2;
    const arc = Math.PI / 3; // 60° spread
    for (let i = 0; i < SPAWN.hordeCount; i++) {
      const tier = weightedPick(pool);
      const angle = center + (Math.random() - 0.5) * arc;
      spawnOnRing(tier, angle);
    }

    state.fx.chromaticPulse = 0.8;
    state.fx.bloomBoost = 0.5;
    _nextHorde += SPAWN.hordeIntervalSec;
  }

  // ── Boss event ──
  if (t >= _nextBoss) {
    let bossTier = null;
    const eliteAllowed = allowedTiers.filter(tier => tier.elite);
    if (eliteAllowed.length > 0) {
      bossTier = weightedPick(eliteAllowed);
    } else {
      // Fallback: highest-minD allowed tier
      bossTier = allowedTiers.reduce((best, cur) =>
        (!best || cur.minD > best.minD) ? cur : best, null);
    }

    if (bossTier) {
      const buffed = { ...bossTier, hp: bossTier.hp * 5 };
      const angle = Math.random() * Math.PI * 2;
      spawnOnRing(buffed, angle, 1.2);

      state.fx.chromaticPulse = 1.0;
      state.fx.bloomBoost = 1.0;
    }
    _nextBoss += SPAWN.bossIntervalSec;
  }
}
