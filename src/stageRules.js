/**
 * Per-stage gameplay rules ("stage modifiers" — Vampire-Survivors style).
 *
 * Each map plays differently:
 *
 *  - **forest / Overgrowth**   — enemies spawn 25% closer; every 10s a 1s
 *                                  "spore pulse" slows all enemies 40% (green tint).
 *  - **twilight / Witching Hour** — every 30s a 5s night surge: fog shrinks,
 *                                  spawn rate doubles, XP gems worth 2x.
 *  - **cinder / Eruption**     — every 20s, 3–5 lava puddles erupt within 12u
 *                                  of hero. Kills <3u from a puddle drop a bonus heart.
 *  - **void / Reaper's Toll**  — hero loses 1 HP every 8s (clamps to 1); every
 *                                  25 kills regain 5 HP. Aggression rewarded.
 *
 * Wiring points (in main.js / loop):
 *   applyStageRule(stageId, state)  → called in _primeRunStart after stage select
 *   tickStageRule(state, dt)        → called once per frame in the run tick
 *   clearStageRule(state)           → called in _teardownActiveRun
 *
 * Rule effects expose themselves via flag fields on state.run so that the
 * existing enemy/spawn/xp/hazard subsystems can opt-in with one-line checks:
 *
 *   state.run.stageRuleEnemySlow   (number ≤1)  — multiplied into enemy seek
 *   state.run.stageRuleXpMul       (number ≥1)  — multiplied into gem pickup
 *   state.run.stageRuleSpawnMul    (number ≥1)  — multiplied into target swarm
 *   state.run.stageRuleSpawnRingMul(number)     — radius multiplier on spawnOnRing
 *   state.run.twilightSurge        (bool)       — stageHazards reads to tighten fog
 *
 * The banner is a single absolutely-positioned div created once at first
 * invocation and reused.
 */
import { pushBubble } from './chatBubble.js';
import { spawnLavaPuddle } from './stageHazards.js';
import { spawnHeart } from './pickups.js';
import { state } from './state.js';

// ── HUD banner (separate from ui.js' showBanner so we don't compete with
//    elite/boss warnings). Subtle paper-ribbon under the timer.
let _banner = null;
let _bannerText = null;
let _bannerSub = null;
let _bannerHideAt = 0;

function _ensureBanner() {
  if (_banner) return _banner;
  const div = document.createElement('div');
  div.id = 'kk-stage-rule-banner';
  div.style.cssText = `
    position: fixed; top: 84px; left: 50%; transform: translateX(-50%);
    pointer-events: none; z-index: 86;
    padding: 6px 18px;
    background: linear-gradient(180deg, rgba(243,232,207,0.92), rgba(217,202,170,0.92));
    border: 1px solid rgba(35,26,20,0.55);
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.45);
    text-align: center; min-width: 260px;
    opacity: 0; transition: opacity 0.3s ease;
    font-family: 'Cinzel Decorative', serif;
  `;
  const title = document.createElement('div');
  title.style.cssText = 'font-size:13px;letter-spacing:0.24em;color:#7a2a2a;text-transform:uppercase;font-weight:900;';
  const sub = document.createElement('div');
  sub.style.cssText = "font-family:'Inter',sans-serif;font-size:11px;color:#5a4838;letter-spacing:0.06em;margin-top:2px;";
  div.appendChild(title);
  div.appendChild(sub);
  document.body.appendChild(div);
  _banner = div;
  _bannerText = title;
  _bannerSub = sub;
  return div;
}

function _showBanner(text, sub, durationSec = 3) {
  _ensureBanner();
  _bannerText.textContent = text;
  _bannerSub.textContent = sub || '';
  _banner.style.opacity = '1';
  _bannerHideAt = state.time.real + durationSec;
}

function _tickBanner() {
  if (!_banner) return;
  if (_bannerHideAt > 0 && state.time.real >= _bannerHideAt) {
    _banner.style.opacity = '0';
    _bannerHideAt = 0;
  }
}

function _setBannerSub(text) {
  if (!_banner) return;
  _bannerSub.textContent = text || '';
}

// ── Default state.run flag reset (called on apply + clear) ─────────────────
function _resetRuleFlags(s) {
  s.run.stageRuleEnemySlow   = 1;
  s.run.stageRuleXpMul       = 1;
  s.run.stageRuleSpawnMul    = 1;
  s.run.stageRuleSpawnRingMul = 1;
  s.run.twilightSurge        = false;
}

// ── Rule definitions ───────────────────────────────────────────────────────
export const STAGE_RULES = {
  forest: {
    name: 'Overgrowth',
    blurb: 'The wood draws close. Spore pulses dull the swarm.',
    onRunStart(s) {
      s.run._fr_pulseAt = 10;   // first pulse at game-time 10s
      s.run._fr_pulseEndAt = -1;
      s.run.stageRuleSpawnRingMul = 0.75;   // 25% tighter ring
    },
    onTick(s, dt) {
      const t = s.time.game;
      // End an active pulse
      if (s.run._fr_pulseEndAt > 0 && t >= s.run._fr_pulseEndAt) {
        s.run._fr_pulseEndAt = -1;
        s.run.stageRuleEnemySlow = 1;
      }
      // Start a new pulse
      if (t >= s.run._fr_pulseAt) {
        s.run.stageRuleEnemySlow = 0.60;     // 40% slow
        s.run._fr_pulseEndAt = t + 1.0;
        s.run._fr_pulseAt = t + 10;
        // Green pulse via existing FX channels
        s.fx.bloomBoost = Math.max(s.fx.bloomBoost, 0.55);
        s.fx.chromaticPulse = Math.max(s.fx.chromaticPulse, 0.35);
        _showBanner('Spore Pulse', 'Enemies slowed', 1.0);
      }
    },
    onEnemySpawn(enemy, s) {
      // Already handled by stageRuleSpawnRingMul on the spawn ring; nothing extra.
    },
  },

  twilight: {
    name: 'Witching Hour',
    blurb: 'When night closes in, the swarm doubles — and so do the gems.',
    onRunStart(s) {
      s.run._tw_surgeAt = 30;
      s.run._tw_surgeEndAt = -1;
    },
    onTick(s, dt) {
      const t = s.time.game;
      if (s.run._tw_surgeEndAt > 0) {
        const remain = s.run._tw_surgeEndAt - t;
        if (remain <= 0) {
          s.run._tw_surgeEndAt = -1;
          s.run.twilightSurge = false;
          s.run.stageRuleSpawnMul = 1;
          s.run.stageRuleXpMul = 1;
        } else {
          _setBannerSub(`Surge: ${remain.toFixed(1)}s — 2× spawns / 2× XP`);
        }
      }
      if (t >= s.run._tw_surgeAt && s.run._tw_surgeEndAt < 0) {
        s.run._tw_surgeEndAt = t + 5.0;
        s.run._tw_surgeAt = t + 30;
        s.run.twilightSurge = true;
        s.run.stageRuleSpawnMul = 2.0;
        s.run.stageRuleXpMul = 2.0;
        s.fx.bloomBoost = Math.max(s.fx.bloomBoost, 0.7);
        s.fx.chromaticPulse = Math.max(s.fx.chromaticPulse, 0.5);
        _showBanner('Witching Hour', 'Surge: 5.0s — 2× spawns / 2× XP', 5.0);
      }
    },
    onEnemySpawn() {},
  },

  cinder: {
    name: 'Eruption',
    blurb: 'The ground splits. Hot earth drops trophies for the bold.',
    onRunStart(s) {
      s.run._ci_eruptAt = 20;
      s.run._ci_lavaPositions = [];   // recent eruption positions for "near puddle" kill check
    },
    onTick(s, dt) {
      const t = s.time.game;
      if (t >= s.run._ci_eruptAt) {
        s.run._ci_eruptAt = t + 20;
        const count = 3 + Math.floor(Math.random() * 3);   // 3..5
        const hp = s.hero.pos;
        const fresh = [];
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 9;                 // within 12u
          const x = hp.x + Math.cos(a) * r;
          const z = hp.z + Math.sin(a) * r;
          try { spawnLavaPuddle(x, z); } catch (_) {}
          fresh.push({ x, z, until: t + 10 });             // remember for 10s for kill-bonus check
        }
        s.run._ci_lavaPositions = (s.run._ci_lavaPositions || []).concat(fresh);
        s.fx.bloomBoost = Math.max(s.fx.bloomBoost, 0.6);
        s.fx.shake = Math.max(s.fx.shake || 0, 0.35);
        _showBanner('Eruption', `${count} puddles burst near you`, 2.0);
      }
      // Expire old eruption positions
      if (s.run._ci_lavaPositions && s.run._ci_lavaPositions.length > 0) {
        s.run._ci_lavaPositions = s.run._ci_lavaPositions.filter(p => p.until > t);
      }
    },
    onEnemySpawn() {},
    // Called from enemies.js killEnemy hook
    onKill(enemy, s) {
      const lavas = s.run._ci_lavaPositions;
      if (!lavas || lavas.length === 0) return;
      const ex = enemy.mesh.position.x, ez = enemy.mesh.position.z;
      for (let i = 0; i < lavas.length; i++) {
        const lp = lavas[i];
        const dx = ex - lp.x, dz = ez - lp.z;
        if (dx * dx + dz * dz < 9) {     // <3u
          try { spawnHeart(ex, ez); } catch (_) {}
          return;                         // one bonus heart per kill
        }
      }
    },
  },

  void: {
    name: "Reaper's Toll",
    blurb: 'The crypt drains you. Kill 25 to claw back what was taken.',
    onRunStart(s) {
      s.run._vd_nextToll = 8;
      s.run._vd_killBaseline = s.run.kills || 0;
    },
    onTick(s, dt) {
      const t = s.time.game;
      if (t >= s.run._vd_nextToll) {
        s.run._vd_nextToll = t + 8;
        // Bypass iFrames / damage flow — direct HP nibble that clamps to 1.
        if (s.hero && !s.gameOver) {
          s.hero.hp = Math.max(1, s.hero.hp - 1);
          s.fx.chromaticPulse = Math.max(s.fx.chromaticPulse, 0.4);
        }
      }
      // Kill-bounty refund — every 25 kills, regain 5 HP.
      const k = (s.run.kills || 0) - (s.run._vd_killBaseline || 0);
      const earned = Math.floor(k / 25);
      const taken  = s.run._vd_killBountiesTaken || 0;
      if (earned > taken) {
        s.run._vd_killBountiesTaken = earned;
        if (s.hero && s.hero.hpMax) {
          s.hero.hp = Math.min(s.hero.hpMax, s.hero.hp + 5);
          _showBanner("Reaper's Toll", '+5 HP — the toll is paid back', 1.6);
          s.fx.bloomBoost = Math.max(s.fx.bloomBoost, 0.5);
        }
      }
    },
    onEnemySpawn() {},
  },
};

// ── Hooks called by external systems ───────────────────────────────────────

/** Called from enemies.js spawnEnemy (post-construct). One-line opt-in. */
export function notifyStageEnemySpawn(enemy) {
  const rid = state.run && state.run.stage && state.run.stage.id;
  const rule = rid && STAGE_RULES[rid];
  if (!rule || !rule.onEnemySpawn) return;
  try { rule.onEnemySpawn(enemy, state); } catch (_) {}
}

/** Called from enemies.js killEnemy (Cinder heart-drop bonus). */
export function notifyStageEnemyKill(enemy) {
  const rid = state.run && state.run.stage && state.run.stage.id;
  const rule = rid && STAGE_RULES[rid];
  if (!rule || !rule.onKill) return;
  try { rule.onKill(enemy, state); } catch (_) {}
}

/** Called from hero.js takeDamage if the rule wants to mutate incoming damage. */
export function notifyStagePlayerHit(amount) {
  const rid = state.run && state.run.stage && state.run.stage.id;
  const rule = rid && STAGE_RULES[rid];
  if (!rule || !rule.onPlayerHit) return amount;
  try { return rule.onPlayerHit(amount, state); } catch (_) { return amount; }
}

// ── Public lifecycle ───────────────────────────────────────────────────────

export function applyStageRule(stageId, s = state) {
  _resetRuleFlags(s);
  s.run._stageRuleId = stageId || null;
  const rule = stageId && STAGE_RULES[stageId];
  if (!rule) return;
  try { rule.onRunStart && rule.onRunStart(s); } catch (_) {}
  // Announce via chat bubble + HUD banner
  try { pushBubble('system', rule.name + ': ' + rule.blurb); } catch (_) {}
  _showBanner(rule.name, rule.blurb, 4.5);
  // Tickle the existing stage tint so the rule activation feels visible.
  try {
    if (s.envGroup && s.envGroup.userData && typeof s.envGroup.userData.applyStageTint === 'function') {
      s.envGroup.userData.applyStageTint(s.run.stage);
    }
  } catch (_) {}
}

export function tickStageRule(s = state, dt) {
  _tickBanner();
  const rid = s.run && s.run._stageRuleId;
  const rule = rid && STAGE_RULES[rid];
  if (!rule || !rule.onTick) return;
  try { rule.onTick(s, dt); } catch (_) {}
}

export function clearStageRule(s = state) {
  _resetRuleFlags(s);
  if (s.run) s.run._stageRuleId = null;
  if (_banner) {
    _banner.style.opacity = '0';
    _bannerHideAt = 0;
  }
}
