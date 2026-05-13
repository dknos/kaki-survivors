/**
 * Named passives — distinct from one-shot FILLERS. Each passive is a slot
 * with its own max level (default 5) and a per-level stat effect. They
 * compete with weapons + evolutions in the level-up pool, but live in their
 * own `state.passives` array so we can cap owned passives at MAX_PASSIVES.
 *
 * Apply pattern: when the player picks the same passive twice, the second
 * pick rebuilds the cumulative buff (statMul reset to base, then re-applied
 * for the new total level). Damage-reduction caps at 0.40× incoming damage
 * so stacking can't make the hero invincible.
 */
import { state } from '../state.js';

export const MAX_PASSIVES = 6;

/**
 * Each passive defines:
 *   id, name, icon, desc(level)         — UI metadata
 *   maxLevel                            — cap
 *   apply(level)                        — installs the cumulative effect
 *                                         (called every pick; idempotent —
 *                                         must replace previous level effect)
 */
export const PASSIVES = [
  {
    id: 'spinach',  name: 'Spinach',     icon: '🥬', maxLevel: 5,
    desc: lv => `+${lv * 12}% damage`,
    apply(level, prev) {
      const newMul  = 1 + 0.12 * level;
      const prevMul = 1 + 0.12 * (prev || 0);
      state.hero.statMul.dmg *= newMul / prevMul;
    },
  },
  {
    id: 'armor',    name: 'Armor',       icon: '🛡️', maxLevel: 5,
    desc: lv => `−${lv * 12}% damage taken (cap 60%)`,
    apply(level, prev) {
      // dmgTaken multiplier: lower is better. Cap at 0.40 so 5×12% = 60% reduction.
      const newMul  = Math.max(0.40, 1 - 0.12 * level);
      const prevMul = Math.max(0.40, 1 - 0.12 * (prev || 0));
      state.hero.statMul.dmgTaken *= newMul / prevMul;
    },
  },
  {
    id: 'wings',    name: 'Wings',       icon: '🪶', maxLevel: 5,
    desc: lv => `+${lv * 8}% move speed`,
    apply(level, prev) {
      const newMul  = 1 + 0.08 * level;
      const prevMul = 1 + 0.08 * (prev || 0);
      state.hero.statMul.moveSpeed *= newMul / prevMul;
    },
  },
  {
    id: 'tome',     name: 'Tome',        icon: '📕', maxLevel: 5,
    desc: lv => `−${lv * 10}% weapon cooldown`,
    apply(level, prev) {
      const newMul  = Math.max(0.40, 1 - 0.10 * level);
      const prevMul = Math.max(0.40, 1 - 0.10 * (prev || 0));
      state.hero.statMul.cooldown *= newMul / prevMul;
    },
  },
  {
    id: 'bracer',   name: 'Bracer',      icon: '🏹', maxLevel: 5,
    desc: lv => `+${lv * 18}% projectile speed`,
    apply(level, prev) {
      const newMul  = 1 + 0.18 * level;
      const prevMul = 1 + 0.18 * (prev || 0);
      state.hero.statMul.projSpeed *= newMul / prevMul;
    },
  },
  {
    id: 'duration', name: 'Empty Tome',  icon: '📜', maxLevel: 5,
    desc: lv => `+${lv * 16}% effect duration`,
    apply(level, prev) {
      const newMul  = 1 + 0.16 * level;
      const prevMul = 1 + 0.16 * (prev || 0);
      state.hero.statMul.duration *= newMul / prevMul;
    },
  },
  {
    id: 'hollow',   name: 'Hollow Heart',icon: '💗', maxLevel: 5,
    desc: lv => `+${lv * 20} max HP`,
    apply(level, prev) {
      const delta = 20 * (level - (prev || 0));
      state.hero.hpMax += delta;
      state.hero.hp = Math.min(state.hero.hpMax, state.hero.hp + delta);
    },
  },
  {
    id: 'pummarola',name: 'Pummarola',   icon: '🍅', maxLevel: 5,
    desc: lv => `regen +${(lv * 0.5).toFixed(1)} HP/s`,
    apply(level/*, prev*/) {
      state.hero.regenPerSec = 0.5 * level;   // absolute, replaces prev
    },
  },
];

/** Roll-time helper: returns picks the player can still benefit from. */
export function passiveChoices(n) {
  const owned = new Map((state.passives || []).map(p => [p.id, p]));
  const slotsLeft = MAX_PASSIVES - owned.size;
  const pool = [];
  for (const p of PASSIVES) {
    const have = owned.get(p.id);
    if (have) {
      if (have.level < p.maxLevel) {
        pool.push({ kind: 'passive', id: p.id, level: have.level + 1,
                    name: p.name, icon: p.icon, desc: p.desc(have.level + 1) });
      }
    } else if (slotsLeft > 0) {
      pool.push({ kind: 'passive', id: p.id, level: 1,
                  name: p.name, icon: p.icon, desc: p.desc(1) });
    }
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, n);
}

/** Apply a passive pick (level-up or new acquisition). */
export function applyPassive(choice) {
  if (!state.passives) state.passives = [];
  const def = PASSIVES.find(p => p.id === choice.id);
  if (!def) return;
  let entry = state.passives.find(p => p.id === choice.id);
  const prevLevel = entry ? entry.level : 0;
  if (!entry) {
    if (state.passives.length >= MAX_PASSIVES) return; // safety: shouldn't happen
    entry = { id: choice.id, level: 0 };
    state.passives.push(entry);
  }
  if (entry.level >= def.maxLevel) return;
  entry.level += 1;
  def.apply(entry.level, prevLevel);
}
