/**
 * Per-archetype weapon kits (leveling-system simplification, 2026-05-24).
 *
 * Replaces the old "pool ALL non-hidden weapons" draft behaviour in
 * weaponChoices(). Each gameplay archetype (CHARACTERS row in config.js) now
 * draws WEAPON cards only from a small curated list of BASE weapons that fit
 * its identity, PLUS the selected avatar's single signature weapon. This gives
 * each run a coherent build instead of 17 random options.
 *
 * Base weapon ids drawn from REGISTRY (non-hidden, non-signature):
 *   orbitals, autoaim, chain, web, frostbloom, sigilbell
 * (NOTE: autoAim's REGISTRY id is the lowercase 'autoaim'.)
 *
 * Signature weapons are NOT listed here — they are resolved per-run from the
 * avatar (state.run.signatureWeapon, set in main.js) so only the matching
 * avatar's signature ever rolls.
 */
import { CHARACTERS, AVATARS, archetypeForAvatar } from '../config.js';

// Full base-weapon list — also the defensive fallback so a kit lookup miss
// never yields an empty draft pool (which would soft-lock level-ups).
export const BASE_WEAPONS = ['orbitals', 'autoaim', 'chain', 'web', 'frostbloom', 'sigilbell'];

/**
 * Archetype → curated base weapon ids. Archetypes may share base weapons.
 * Each list reflects the archetype's starter + signature identity (config.js):
 *  - kitty (Balanced / Nine Lives, starter orbitals): generalist, all 6 — no
 *    identity penalty, matches its "default kit" framing.
 *  - boom (glass cannon / Charged Coil, starter chain): chain-lightning burst —
 *    chain + the two other hard-hitting bolts; drops the defensive web/bell.
 *  - webspinner (trapper / Lingering Silk, starter web): control & zone — web +
 *    slowing/area tools (frostbloom, sigilbell, orbitals); drops raw projectiles.
 *  - sniper (precise / Headhunter, starter autoaim): projectile precision —
 *    autoaim + chain bolts + orbitals; drops the slow trapper/zone tools.
 *  - phoenix (burns hot / Ember Burst, starter autoaim): aggressive burst —
 *    projectiles + chain + the fiery frostbloom AoE; drops the slow web.
 *  - clockwork (late scaling / Tempo, starter orbitals): sustained orbiters —
 *    orbitals + persistent area pressure (sigilbell, frostbloom, web).
 */
export const ARCHETYPE_KITS = {
  kitty:      ['orbitals', 'autoaim', 'chain', 'web', 'frostbloom', 'sigilbell'],
  boom:       ['chain', 'autoaim', 'orbitals', 'frostbloom'],
  webspinner: ['web', 'frostbloom', 'sigilbell', 'orbitals', 'autoaim'],
  sniper:     ['autoaim', 'chain', 'orbitals', 'sigilbell'],
  phoenix:    ['autoaim', 'chain', 'frostbloom', 'orbitals'],
  clockwork:  ['orbitals', 'sigilbell', 'frostbloom', 'web'],
};

/**
 * Returns the array of draftable WEAPON ids for the current run:
 *   that archetype's kit  +  the selected avatar's signature weapon.
 *
 * Resolution order for the archetype kit:
 *   1) runState.character  (archetype id; set directly in main.js, and on
 *      daily-challenge runs it carries the daily's overridden archetype — so
 *      this is the authoritative source, not archetypeForAvatar).
 *   2) archetypeForAvatar(AVATARS row matching runState.avatar) — fallback when
 *      runState.character is missing (older callers / pre-run state).
 *
 * The signature weapon comes from runState.signatureWeapon (pre-resolved in
 * main.js from the avatar), falling back to the AVATARS row's signatureWeapon.
 *
 * DEFENSIVE: if nothing resolves, returns the full BASE_WEAPONS list. Never
 * returns an empty array. The caller (weaponChoices) still filters these ids
 * against REGISTRY/hidden/stages, so an unregistered signature id is harmless.
 */
export function kitForRun(runState) {
  const rs = runState || {};

  // 1) Resolve the archetype kit (base weapon ids).
  let kit = null;
  if (rs.character && ARCHETYPE_KITS[rs.character]) {
    kit = ARCHETYPE_KITS[rs.character];
  } else {
    // Fallback: derive the archetype from the avatar.
    let avatar = null;
    if (rs.avatar && Array.isArray(AVATARS)) {
      avatar = AVATARS.find(a => a.id === rs.avatar) || null;
    }
    const arch = archetypeForAvatar(avatar);            // never null (CHARACTERS[0] default)
    if (arch && ARCHETYPE_KITS[arch.id]) kit = ARCHETYPE_KITS[arch.id];
  }
  // Last-resort fallback — guarantees a non-empty pool.
  if (!Array.isArray(kit) || kit.length === 0) kit = BASE_WEAPONS;

  // 2) Resolve the signature weapon id (avatar-tied, never daily-overridden).
  let sigId = rs.signatureWeapon || null;
  if (!sigId && rs.avatar && Array.isArray(AVATARS)) {
    const av = AVATARS.find(a => a.id === rs.avatar);
    if (av) sigId = av.signatureWeapon || null;
  }

  // Compose kit + signature, de-duplicated, preserving order.
  const out = kit.slice();
  if (sigId && !out.includes(sigId)) out.push(sigId);
  return out;
}
