# Module Contracts

Each agent fills in ONE module. main.js already imports specific names from each — these names + signatures are LOCKED. Don't rename them.

## Shared facts everyone uses
- ES modules, native browser (no bundler). Import path examples: `from './state.js'`, `from 'three'`.
- The ONLY global state lives in `state.js` exported `state` object. Mutate it directly. Never declare module-scoped game data.
- All tunables come from `config.js`. Add new ones there.
- THREE.js scene's "ground plane" is the XZ plane at y=0. The hero moves on XZ. The Y axis is up.
- `state.time.dt` is the per-frame delta in seconds (already clamped to <= 0.05). `state.time.game` is the paused-aware run time.
- Coordinate convention: `Vector3(x, y, z)` where y=0 = ground. Hero's pos.y = 0.

## Contract reference table (already imported by main.js)

| File | Exports |
|---|---|
| `src/input.js` | `initInput()`, `sampleInput()` |
| `src/hero.js` | `initHero(scene)`, `updateHero(dt)`, `takeDamage(amt)` |
| `src/enemies.js` | `initEnemies(scene)`, `updateEnemies(dt)`, `prewarmPools()`, `spawnEnemy(tierConfig, x, z)`, `killEnemy(enemy)`, `queryRadius(pos, r)` |
| `src/weapons/index.js` | `initWeapons()`, `tickWeapons(dt)`, `acquireWeapon(id)`, `weaponChoices(n)` |
| `src/xp.js` | `initXP(scene)`, `updateGems(dt)`, `dropGem(pos, value)`, `applyLevelUpChoice(choice)` |
| `src/spawnDirector.js` | `initSpawnDirector()`, `tickSpawnDirector(dt)` |
| `src/ui.js` | `initUI()`, `updateUI()`, `showLevelUpModal(choices)`, `hideLevelUpModal()`, `showDeathScreen()`, `showStartScreen(text)`, `hideStartScreen()` |
