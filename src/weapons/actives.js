/**
 * ACTIVE ability slot — the DMD-hybrid "cast" (Iter C).
 *
 * One player-triggered ability on a cooldown (~7-11s), drafted from the
 * level-up offer and upgraded by re-picking it. Triggered by RMB / Q on PC
 * (a virtual button on touch lands in Iter D). This is the big-moment beat
 * that the auto weapons and the held primary don't provide.
 *
 * v1 ships one active (Nova Burst, a radial damage + knockback blast). The
 * registry + slot are built to take more later; the draft offers whatever is
 * not yet maxed.
 *
 * Effect helpers reuse the enemy knock/damage path (set knockV*, damageEnemy)
 * exactly like the dash sweep in hero.js, and the level-up aura-burst sprite
 * for the cast FX — no new pools or draw calls.
 */
import { state } from '../state.js';
import { queryRadius, damageEnemy } from '../enemies.js';
import { sfx } from '../audio.js';
import { spawnSprite } from '../sprites/index.js';

function _castRadial(lv, source) {
  const hero = state.hero.pos;
  const r = lv.radius, r2 = r * r;
  const dmg = lv.dmg * (state.hero.statMul.dmg || 1);
  let cands = null;
  try { cands = queryRadius(hero, r); } catch (_) { cands = null; }
  if (!cands) cands = (state.enemies && state.enemies.active) || [];
  for (const e of cands) {
    if (!e || !e.alive) continue;
    const ep = e.mesh ? e.mesh.position : e.pos;
    if (!ep) continue;
    const dx = ep.x - hero.x, dz = ep.z - hero.z;
    if (dx * dx + dz * dz > r2) continue;
    const m = Math.hypot(dx, dz) || 1;
    e.knockVx = (dx / m) * lv.knock;   // radial knockback, away from hero
    e.knockVz = (dz / m) * lv.knock;
    try { damageEnemy(e, dmg, source); } catch (_) {}
  }
  // Cast FX: a big ground-anchored aura burst (same non-looping sprite the
  // level-up moment uses) sized to the blast radius.
  try { spawnSprite('fx/aura_rings_v1', { x: hero.x, y: 0.06, z: hero.z, scale: r * 1.1, anim: 'burst' }); } catch (_) {}
  try { if (sfx && sfx.weaponDash) sfx.weaponDash(); } catch (_) {}
}

export const ACTIVES = {
  nova: {
    id: 'nova', name: 'Nova Burst', icon: '💥', maxLevel: 5,
    levels: [
      { radius: 5.5, dmg: 60,  cd: 11, knock: 16 },
      { radius: 6.0, dmg: 95,  cd: 10, knock: 18 },
      { radius: 6.5, dmg: 140, cd: 9,  knock: 20 },
      { radius: 7.0, dmg: 195, cd: 8,  knock: 22 },
      { radius: 7.5, dmg: 270, cd: 7,  knock: 24 },
    ],
    desc: (lv) => `Blast enemies within ${lv.radius}m for ${lv.dmg} dmg + knockback. ${lv.cd}s cooldown.`,
    cast(lv) { _castRadial(lv, 'active_nova'); },
  },
};

function _def(id) { return ACTIVES[id] || null; }
function _levelOf(def, level) { return def.levels[Math.min(level, def.levels.length) - 1]; }

/** Equip the active (first pick) or level it up (re-pick). Called from xp.js. */
export function acquireActive(id) {
  const def = _def(id);
  if (!def) return;
  const a = state.hero.active || (state.hero.active = { id: null, level: 0, cd: 0 });
  if (a.id === id) {
    if (a.level < def.maxLevel) a.level += 1;
  } else if (!a.id) {
    a.id = id; a.level = 1; a.cd = 0;
  }
}

/** Fire the equipped active if off cooldown. Returns true if it fired. */
export function castActive() {
  const a = state.hero.active;
  if (!a || !a.id || a.cd > 0) return false;
  const def = _def(a.id);
  if (!def) return false;
  const lv = _levelOf(def, a.level);
  try { def.cast(lv); } catch (e) { console.warn('[actives] cast', a.id, e); }
  a.cd = lv.cd;
  return true;
}

/** Per-frame cooldown countdown. Called from tickWeapons. */
export function tickActive(dt) {
  const a = state.hero.active;
  if (a && a.cd > 0) a.cd -= dt;
}

/** Draft cards for any active not yet maxed (first pick = equip, else level up). */
export function activeChoices() {
  const a = state.hero.active;
  const out = [];
  for (const id of Object.keys(ACTIVES)) {
    const def = ACTIVES[id];
    const owned = a && a.id === id ? a : null;
    if (owned && owned.level >= def.maxLevel) continue;
    const nextLv = owned ? owned.level + 1 : 1;
    const lv = _levelOf(def, nextLv);
    out.push({
      kind: 'active', id, level: nextLv,
      name: owned ? `${def.name} Lv${nextLv}` : `${def.name} (Active)`,
      icon: def.icon,
      desc: typeof def.desc === 'function' ? def.desc(lv) : def.desc,
    });
  }
  return out;
}
