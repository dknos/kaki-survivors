/**
 * PRIMARY — the always-equipped, player-aimed, hold-to-fire attack.
 *
 * The DMD-hybrid pivot's active centerpiece (see kitty_kaki_survivors_project
 * memo). Unlike the auto weapons (orbitals/web/chain… which fire on their own
 * cooldown at the nearest enemy), the primary only fires while the player is
 * actively firing — LMB held on PC, or auto-fire while moving on mobile (the
 * `optAutoFirePrimary` accessibility toggle, default ON for touch / OFF for
 * mouse) — and it aims where the player points:
 *   • manual aim (mouse cursor / gamepad right-stick) when actively aiming,
 *   • nearest enemy as the auto-aim fallback when idle.
 *
 * It re-uses autoAim's shared InstancedMesh projectile pool + collision path
 * (spawnAutoAimProjectile, owner tag 'primary'), so it adds zero draw calls.
 *
 * Per-archetype flavor: each archetype gets a distinct fan/range/pierce
 * profile (kitty = 3-claw cone, sniper = slow hard-hitting pierce, …). The
 * shared `levels[]` is the base scaling; the profile applies multipliers.
 * Avatars inherit their archetype's profile (kitty + sote are both the kitty
 * 'Claw Bolt' for free). The slot is `hidden:true` so it never enters the
 * level-up draft; it scales with global passives (statMul.dmg/cooldown).
 */
import { state } from '../state.js';
import { queryRadius } from '../enemies.js';
import { sfx } from '../audio.js';
import { getMeta } from '../meta.js';
import { spawnAutoAimProjectile } from './autoAim.js';
import { getAimDirection, isPrimaryFiring, isManualAiming } from '../input.js';

// Same hero-relative cap autoAim uses — never auto-target off-screen enemies.
const SEARCH_RADIUS = 18;

function _findNearestEnemy(pos) {
  let candidates = null;
  try { candidates = queryRadius(pos, SEARCH_RADIUS); } catch (_) { candidates = null; }
  if (!candidates || candidates.length === 0) candidates = state.enemies.active;
  if (!candidates || candidates.length === 0) return null;
  let best = null, bestD2 = Infinity;
  for (const e of candidates) {
    if (!e || !e.alive) continue;
    const ep = e.mesh ? e.mesh.position : e.pos;
    if (!ep) continue;
    const dx = ep.x - pos.x, dz = ep.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}

// Per-archetype profiles. `count`/`spread` shape the fan; `speedMul`,
// `pierceBonus`, `cdMul`, `dmgMul` multiply the base level; `ice` picks the
// pale-blue projectile pool for a distinct read. dmgMul is normalized so a
// full volley lands near the same DPS band across archetypes (Iter E re-tunes).
const GENERIC = { name: 'Arc Bolt', count: 1, spread: 0.14, speedMul: 1.0, pierceBonus: 0, cdMul: 1.0, dmgMul: 1.0, ice: false };
const PROFILES = {
  kitty:      { name: 'Claw Bolt',   count: 3, spread: 0.16, speedMul: 0.95, pierceBonus: 0, cdMul: 1.05, dmgMul: 0.72, ice: false },
  sniper:     { name: 'Dead-Eye Shot',count: 1, spread: 0.00, speedMul: 1.40, pierceBonus: 2, cdMul: 1.50, dmgMul: 2.20, ice: true  },
  boom:       { name: 'Spark Lob',   count: 2, spread: 0.12, speedMul: 1.00, pierceBonus: 1, cdMul: 1.10, dmgMul: 1.05, ice: false },
  webspinner: { name: 'Silk Spit',   count: 2, spread: 0.20, speedMul: 0.90, pierceBonus: 0, cdMul: 1.00, dmgMul: 0.92, ice: false },
  phoenix:    { name: 'Ember Dart',  count: 2, spread: 0.10, speedMul: 1.10, pierceBonus: 0, cdMul: 0.95, dmgMul: 0.98, ice: false },
  clockwork:  { name: 'Cog Toss',    count: 1, spread: 0.10, speedMul: 1.00, pierceBonus: 1, cdMul: 0.90, dmgMul: 1.05, ice: false },
};

function _profileFor(archetypeId) {
  return PROFILES[archetypeId] || GENERIC;
}

const primary = {
  id: 'primary',
  hidden: true,        // never appears in the level-up draft pool
  maxLevel: 1,         // single base level; scales via global passives (statMul)
  // Base scaling shared by all archetypes. Held-fire centerpiece, so it out-DPSes
  // a single auto weapon by design (Iter E balances against spawn rate).
  levels: [
    { cooldown: 0.30, speed: 21, dmg: 9, ttl: 0.95, pierce: 1, count: 1 },
  ],

  init(state, level, inst) {
    inst.cd = 0;
    inst.profile = _profileFor(state.run && state.run.character);
  },

  tick(state, dt, level, inst) {
    if (inst.cd === undefined) inst.cd = 0;
    if (inst.cd > 0) inst.cd -= dt;

    // Gate on the fire input. When not firing, keep cd ready (clamped at 0) so
    // releasing then re-holding fires immediately rather than after a stale CD.
    if (!isPrimaryFiring()) { if (inst.cd < 0) inst.cd = 0; return; }
    if (inst.cd > 0) return;

    if (!inst.profile) inst.profile = _profileFor(state.run && state.run.character);
    const prof = inst.profile;
    const hero = state.hero.pos;

    // Aim: player-pointed when actively aiming, nearest enemy otherwise.
    let dir;
    if (isManualAiming()) {
      dir = getAimDirection();
    } else {
      const t = _findNearestEnemy(hero);
      if (!t) { inst.cd = 0.08; return; }   // nothing in range — re-check soon
      const tp = t.mesh ? t.mesh.position : t.pos;
      const dx = tp.x - hero.x, dz = tp.z - hero.z;
      const m = Math.hypot(dx, dz) || 1;
      dir = { x: dx / m, z: dz / m };
    }

    const baseAngle = Math.atan2(dir.z, dir.x);
    const dmg = level.dmg * prof.dmgMul * (state.hero.statMul.dmg || 1);
    const n = prof.count;
    const opts = prof.ice ? { ice: true } : null;
    for (let i = 0; i < n; i++) {
      const offset = (i - (n - 1) / 2) * prof.spread;
      const a = baseAngle + offset;
      const d = { x: Math.cos(a), z: Math.sin(a) };
      spawnAutoAimProjectile(hero, d, level, dmg, prof.speedMul, prof.pierceBonus, 'primary', opts);
    }
    try { sfx.weaponAutoaim && sfx.weaponAutoaim(); } catch (_) {}

    inst.cd = level.cooldown * prof.cdMul
      * (state.hero.statMul.cooldown || 1)
      * (state.run.passive_cooldown || 1);
  },
};

export default primary;
