/**
 * DOM-based UI overlay for Kitty Kaki Survivors.
 * Mounts everything into #ui-root (defined in index.html).
 * Tron/synthwave aesthetic — neon on dark, glowing borders, monospace.
 *
 * Public API (called by main.js):
 *   initUI(), updateUI(), showLevelUpModal(choices), hideLevelUpModal(),
 *   showDeathScreen(), showStartScreen(text), hideStartScreen()
 */
import { state } from './state.js';

// ── Theme constants ──────────────────────────────────────────────────────────
const C = {
  bg:      '#061008',
  text:    '#ffffff',
  cyan:    '#44ffcc',
  magenta: '#ff44cc',
  red:     '#ff4444',
  amber:   '#ffcc44',
  green:   '#44ff66',
};

// ── Module-local DOM refs ────────────────────────────────────────────────────
let _root = null;
let _hud = null;
let _hpFill = null;
let _xpFill = null;
let _levelText = null;
let _timeText = null;
let _killsText = null;

let _modal = null;
let _modalKeyHandler = null;

let _deathScreen = null;
let _deathKeyHandler = null;
let _deathClickHandler = null;

let _startScreen = null;

// Cache last values to avoid DOM thrash
const _last = {
  hpPct: -1,
  hpColor: '',
  xpPct: -1,
  level: -1,
  timeStr: '',
  kills: -1,
};

// ── CSS injection ────────────────────────────────────────────────────────────
function injectCSS() {
  if (document.getElementById('kk-ui-style')) return;
  const css = `
    .kk-hud {
      position: absolute; inset: 0;
      pointer-events: none;
      font-family: 'Courier New', monospace;
      color: ${C.text};
      text-shadow: 0 0 6px rgba(68,255,204,0.5);
    }
    .kk-hp-wrap {
      position: absolute; top: 16px; left: 16px;
      display: flex; align-items: center; gap: 8px;
      pointer-events: auto;
    }
    .kk-hp-label {
      font-size: 14px; font-weight: bold;
      letter-spacing: 2px; color: ${C.cyan};
      text-shadow: 0 0 8px ${C.cyan};
    }
    .kk-hp-bar {
      width: 220px; height: 18px;
      background: rgba(6,16,8,0.85);
      border: 1px solid ${C.cyan};
      box-shadow: 0 0 12px rgba(68,255,204,0.55), inset 0 0 6px rgba(0,0,0,0.6);
      position: relative; overflow: hidden;
    }
    .kk-hp-fill {
      height: 100%; width: 100%;
      background: ${C.green};
      box-shadow: 0 0 10px currentColor;
      transition: width 0.12s linear, background 0.2s linear;
    }
    .kk-xp-bar {
      position: absolute; top: 0; left: 0; right: 0;
      height: 6px;
      background: rgba(6,16,8,0.7);
      border-bottom: 1px solid ${C.cyan};
      box-shadow: 0 0 8px rgba(68,255,204,0.45);
      pointer-events: auto;
    }
    .kk-xp-fill {
      height: 100%; width: 0%;
      background: ${C.cyan};
      box-shadow: 0 0 10px ${C.cyan}, 0 0 18px ${C.cyan};
      transition: width 0.12s linear;
    }
    .kk-stats {
      position: absolute; top: 16px; right: 16px;
      text-align: right;
      pointer-events: auto;
      line-height: 1.4;
    }
    .kk-stats .kk-line { font-size: 14px; letter-spacing: 1px; }
    .kk-stats .kk-level {
      font-size: 28px; font-weight: bold;
      color: ${C.magenta};
      text-shadow: 0 0 10px ${C.magenta}, 0 0 18px ${C.magenta};
      letter-spacing: 3px;
    }
    .kk-stats .kk-time {
      font-size: 22px; color: ${C.cyan};
      text-shadow: 0 0 8px ${C.cyan};
    }
    .kk-stats .kk-kills {
      font-size: 16px; color: ${C.amber};
      text-shadow: 0 0 8px ${C.amber};
    }

    /* ── Level-up modal ── */
    .kk-modal {
      position: fixed; inset: 0;
      background: rgba(6,16,8,0.78);
      backdrop-filter: blur(4px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      pointer-events: auto;
      font-family: 'Courier New', monospace;
      z-index: 100;
    }
    .kk-modal-title {
      font-size: 48px; font-weight: bold;
      letter-spacing: 8px; margin-bottom: 36px;
      color: ${C.magenta};
      text-shadow: 0 0 12px ${C.magenta}, 0 0 28px ${C.magenta}, 0 0 48px ${C.magenta};
      animation: kk-pulse 1.6s ease-in-out infinite;
    }
    @keyframes kk-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .kk-card-row {
      display: flex; flex-direction: row; gap: 20px;
      max-width: 95vw;
    }
    .kk-card {
      width: 220px; min-height: 280px;
      background: rgba(6,16,8,0.95);
      border: 1px solid ${C.cyan};
      box-shadow: 0 0 12px rgba(68,255,204,0.55);
      padding: 18px; cursor: pointer;
      display: flex; flex-direction: column; align-items: center;
      color: ${C.text};
      transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s;
    }
    .kk-card:hover, .kk-card:focus {
      transform: translateY(-4px) scale(1.03);
      border-color: ${C.magenta};
      box-shadow: 0 0 20px rgba(255,68,204,0.75);
      outline: none;
    }
    .kk-card-num {
      font-size: 12px; color: ${C.amber};
      text-shadow: 0 0 6px ${C.amber};
      margin-bottom: 6px; letter-spacing: 2px;
    }
    .kk-card-icon {
      font-size: 56px; line-height: 1; margin: 8px 0 12px;
      filter: drop-shadow(0 0 8px ${C.cyan});
    }
    .kk-card-name {
      font-size: 18px; font-weight: bold; color: ${C.cyan};
      text-shadow: 0 0 8px ${C.cyan};
      text-align: center; margin-bottom: 6px;
    }
    .kk-card-level {
      font-size: 14px; color: ${C.magenta};
      text-shadow: 0 0 6px ${C.magenta};
      margin-bottom: 10px; letter-spacing: 2px;
    }
    .kk-card-desc {
      font-size: 12px; color: #cfe9e0;
      text-align: center; line-height: 1.4;
      flex: 1;
    }

    /* ── Death screen ── */
    .kk-death {
      position: fixed; inset: 0;
      background: rgba(6,16,8,0.92);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      pointer-events: auto;
      font-family: 'Courier New', monospace;
      z-index: 110;
    }
    .kk-death-title {
      font-size: 72px; font-weight: bold; letter-spacing: 10px;
      color: ${C.red};
      text-shadow: 0 0 14px ${C.red}, 0 0 34px ${C.red}, 0 0 60px ${C.red};
      margin-bottom: 40px;
    }
    .kk-death-stats {
      font-size: 18px; color: ${C.cyan};
      text-shadow: 0 0 6px ${C.cyan};
      line-height: 1.8; margin-bottom: 36px;
      text-align: center;
    }
    .kk-death-stats .kk-stat-val {
      color: ${C.amber};
      text-shadow: 0 0 6px ${C.amber};
    }
    .kk-death-hint {
      font-size: 16px; color: ${C.magenta};
      text-shadow: 0 0 8px ${C.magenta};
      letter-spacing: 3px;
      animation: kk-pulse 1.4s ease-in-out infinite;
    }

    /* ── Start screen ── */
    .kk-start {
      position: fixed; inset: 0;
      background: rgba(6,16,8,0.92);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      pointer-events: auto;
      font-family: 'Courier New', monospace;
      z-index: 90;
    }
    .kk-start-title {
      font-size: 56px; font-weight: bold; letter-spacing: 8px;
      color: ${C.cyan};
      text-shadow: 0 0 14px ${C.cyan}, 0 0 32px ${C.cyan}, 0 0 60px ${C.magenta};
      margin-bottom: 28px;
      text-align: center;
    }
    .kk-start-sub {
      font-size: 18px; color: ${C.magenta};
      text-shadow: 0 0 8px ${C.magenta};
      letter-spacing: 3px;
      animation: kk-pulse 1.4s ease-in-out infinite;
    }

    /* ── Mobile ── */
    @media (max-width: 600px) {
      .kk-card-row { flex-direction: column; gap: 12px; }
      .kk-card { width: 80vw; min-height: 0; padding: 12px; }
      .kk-card-icon { font-size: 40px; margin: 4px 0 8px; }
      .kk-modal-title { font-size: 32px; margin-bottom: 18px; }
      .kk-hp-bar { width: 140px; }
      .kk-death-title { font-size: 44px; }
      .kk-start-title { font-size: 36px; }
    }
  `;
  const style = document.createElement('style');
  style.id = 'kk-ui-style';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function hpColorFor(pct) {
  if (pct < 0.30) return C.red;
  if (pct < 0.60) return C.amber;
  return C.green;
}

function getRegistry() {
  // weapons/index.js exports REGISTRY (id → {name, desc, icon, ...})
  // It may not be loaded yet at module-evaluation time; dynamic import-with-cache.
  if (_registry) return _registry;
  return null;
}
let _registry = null;
async function loadRegistry() {
  if (_registry) return _registry;
  try {
    const m = await import('./weapons/index.js');
    _registry = m.REGISTRY || m.default || {};
  } catch (e) {
    _registry = {};
  }
  return _registry;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initUI() {
  injectCSS();
  _root = document.getElementById('ui-root');
  if (!_root) {
    console.error('[ui] #ui-root not found');
    return;
  }

  // Try to warm registry cache (non-blocking)
  loadRegistry();

  // Build HUD container
  _hud = document.createElement('div');
  _hud.className = 'kk-hud';

  // XP bar (top, full-width thin)
  const xpBar = document.createElement('div');
  xpBar.className = 'kk-xp-bar';
  _xpFill = document.createElement('div');
  _xpFill.className = 'kk-xp-fill';
  xpBar.appendChild(_xpFill);

  // HP bar (top-left)
  const hpWrap = document.createElement('div');
  hpWrap.className = 'kk-hp-wrap';
  hpWrap.style.top = '20px'; // below xp strip
  const hpLabel = document.createElement('div');
  hpLabel.className = 'kk-hp-label';
  hpLabel.textContent = 'HP';
  const hpBar = document.createElement('div');
  hpBar.className = 'kk-hp-bar';
  _hpFill = document.createElement('div');
  _hpFill.className = 'kk-hp-fill';
  hpBar.appendChild(_hpFill);
  hpWrap.appendChild(hpLabel);
  hpWrap.appendChild(hpBar);

  // Stats (top-right)
  const stats = document.createElement('div');
  stats.className = 'kk-stats';
  _levelText = document.createElement('div');
  _levelText.className = 'kk-line kk-level';
  _levelText.textContent = 'LV 1';
  _timeText = document.createElement('div');
  _timeText.className = 'kk-line kk-time';
  _timeText.textContent = '00:00';
  _killsText = document.createElement('div');
  _killsText.className = 'kk-line kk-kills';
  _killsText.textContent = 'KILLS 0';
  stats.appendChild(_levelText);
  stats.appendChild(_timeText);
  stats.appendChild(_killsText);

  _hud.appendChild(xpBar);
  _hud.appendChild(hpWrap);
  _hud.appendChild(stats);
  _root.appendChild(_hud);
}

export function updateUI() {
  if (!_hpFill) return;
  const h = state.hero;

  // HP
  const hpPct = Math.max(0, Math.min(1, h.hp / Math.max(1, h.hpMax)));
  if (hpPct !== _last.hpPct) {
    _hpFill.style.width = (hpPct * 100).toFixed(1) + '%';
    _last.hpPct = hpPct;
  }
  const col = hpColorFor(hpPct);
  if (col !== _last.hpColor) {
    _hpFill.style.background = col;
    _hpFill.style.color = col; // for currentColor shadow
    _last.hpColor = col;
  }

  // XP
  const xpPct = Math.max(0, Math.min(1, h.xp / Math.max(1, h.xpNext)));
  if (xpPct !== _last.xpPct) {
    _xpFill.style.width = (xpPct * 100).toFixed(1) + '%';
    _last.xpPct = xpPct;
  }

  // Level
  if (h.level !== _last.level) {
    _levelText.textContent = `LV ${h.level}`;
    _last.level = h.level;
  }

  // Time
  const t = fmtTime(state.time.game);
  if (t !== _last.timeStr) {
    _timeText.textContent = t;
    _last.timeStr = t;
  }

  // Kills
  if (state.run.kills !== _last.kills) {
    _killsText.textContent = `KILLS ${state.run.kills}`;
    _last.kills = state.run.kills;
  }
}

export function showLevelUpModal(choices) {
  if (_modal) hideLevelUpModal();

  const registry = _registry || {};
  // Try to ensure registry is loaded (fire-and-forget; cards will fall back gracefully)
  if (!_registry) loadRegistry().then(() => {
    // If modal still open, repaint card contents
    if (_modal) repaintCards(choices);
  });

  _modal = document.createElement('div');
  _modal.className = 'kk-modal';

  const title = document.createElement('div');
  title.className = 'kk-modal-title';
  title.textContent = 'LEVEL UP';
  _modal.appendChild(title);

  const row = document.createElement('div');
  row.className = 'kk-card-row';
  row.dataset.role = 'cards';
  _modal.appendChild(row);

  _root.appendChild(_modal);

  paintCards(row, choices, registry);

  _modalKeyHandler = (e) => {
    if (e.code === 'Digit1' || e.key === '1') pickChoice(choices, 0);
    else if (e.code === 'Digit2' || e.key === '2') pickChoice(choices, 1);
    else if (e.code === 'Digit3' || e.key === '3') pickChoice(choices, 2);
  };
  window.addEventListener('keydown', _modalKeyHandler);
}

function paintCards(row, choices, registry) {
  row.innerHTML = '';
  choices.forEach((choice, i) => {
    const entry = (registry && registry[choice.id]) || {};
    const icon = entry.icon || '★';
    const name = entry.name || choice.id || 'Unknown';
    const desc = entry.desc || (choice.kind === 'passive' ? 'Passive bonus' : 'Weapon');
    const lvl = choice.level || 1;

    const card = document.createElement('button');
    card.className = 'kk-card';
    card.type = 'button';
    card.innerHTML = `
      <div class="kk-card-num">[${i + 1}]</div>
      <div class="kk-card-icon">${icon}</div>
      <div class="kk-card-name">${escapeHtml(name)}</div>
      <div class="kk-card-level">Lv ${lvl}</div>
      <div class="kk-card-desc">${escapeHtml(desc)}</div>
    `;
    card.addEventListener('click', () => pickChoice(choices, i));
    row.appendChild(card);
  });
}

function repaintCards(choices) {
  if (!_modal) return;
  const row = _modal.querySelector('[data-role="cards"]');
  if (row) paintCards(row, choices, _registry || {});
}

function pickChoice(choices, idx) {
  const c = choices[idx];
  if (!c) return;
  import('./xp.js').then(m => {
    if (m && typeof m.applyLevelUpChoice === 'function') m.applyLevelUpChoice(c);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

export function hideLevelUpModal() {
  if (_modalKeyHandler) {
    window.removeEventListener('keydown', _modalKeyHandler);
    _modalKeyHandler = null;
  }
  if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
  _modal = null;
}

export function showDeathScreen() {
  if (_deathScreen) return;

  _deathScreen = document.createElement('div');
  _deathScreen.className = 'kk-death';

  const title = document.createElement('div');
  title.className = 'kk-death-title';
  title.textContent = 'YOU DIED';

  const stats = document.createElement('div');
  stats.className = 'kk-death-stats';
  stats.innerHTML = `
    TIME SURVIVED  <span class="kk-stat-val">${fmtTime(state.time.game)}</span><br>
    LEVEL REACHED  <span class="kk-stat-val">${state.hero.level}</span><br>
    KILLS          <span class="kk-stat-val">${state.run.kills}</span><br>
    DAMAGE DEALT   <span class="kk-stat-val">${Math.floor(state.run.dmgDealt)}</span>
  `;

  const hint = document.createElement('div');
  hint.className = 'kk-death-hint';
  hint.textContent = 'Press R or click to restart';

  _deathScreen.appendChild(title);
  _deathScreen.appendChild(stats);
  _deathScreen.appendChild(hint);
  _root.appendChild(_deathScreen);

  const restart = () => location.reload();
  _deathClickHandler = restart;
  _deathKeyHandler = (e) => {
    if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') restart();
  };
  _deathScreen.addEventListener('click', _deathClickHandler);
  window.addEventListener('keydown', _deathKeyHandler);
}

export function showStartScreen(text) {
  if (_startScreen) {
    // Update subtitle in place
    const sub = _startScreen.querySelector('.kk-start-sub');
    if (sub) sub.textContent = text || '';
    return;
  }
  // Ensure root exists even if initUI hasn't run (called early in boot)
  if (!_root) {
    injectCSS();
    _root = document.getElementById('ui-root');
    if (!_root) return;
  }

  _startScreen = document.createElement('div');
  _startScreen.className = 'kk-start';

  const title = document.createElement('div');
  title.className = 'kk-start-title';
  title.textContent = 'KITTY KAKI SURVIVORS';

  const sub = document.createElement('div');
  sub.className = 'kk-start-sub';
  sub.textContent = text || '';

  _startScreen.appendChild(title);
  _startScreen.appendChild(sub);
  _root.appendChild(_startScreen);
}

export function hideStartScreen() {
  if (_startScreen && _startScreen.parentNode) {
    _startScreen.parentNode.removeChild(_startScreen);
  }
  _startScreen = null;
}
