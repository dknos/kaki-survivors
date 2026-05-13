# KittyKaki Survivors — Session Handoff (2026-05-12)

## Where we are
Vampire Survivors clone built on THREE.js + ES modules (importmap, no bundler), served by `serve`. Solo dev. The original kitty-kaki forest game lives elsewhere; **this folder is the clone** so the original stays untouched.

**Working:**
- Orthographic isometric camera at (40,60,40) → origin, follows hero with lerp
- WASD/arrow + touch joystick, isometric-remapped (yaw 45° via `SQRT_HALF`)
- Mouse wheel + pinch zoom (0.5×–3×), applied to ortho frustum each frame
- Hero = `tower-castle-plain.glb` (uncompressed copy; DRACO loader configured for compressed)
- Procedural walk animation (bob + tilt + sway) — model has no bones, all code-side
- Weapons: orbitals + auto-aim, both upgradeable to 8
- Level-up modal with 6 filler choices (heal/maxhp/speed/magnet/cooldown/damage) so lv20+ doesn't freeze
- Enemy spawn with VS-style D(t) curve, spatial hash queries, pooled meshes
- XP gems via InstancedMesh (500 cap, 1 draw call)
- Procedural Web Audio SFX, bloom + chromatic aberration + Bayer dither post-FX

## Key files
- `src/main.js` — bootstrap + RAF loop, zoom applied to ortho frustum (lines 150–156)
- `src/input.js` — keyboard/touch/wheel/pinch, exports `sampleInput`, `getZoom`, `setZoom`
- `src/hero.js` — `initHero`, `updateHero` with procedural walk (`_stepPhase`, `_innerMesh`)
- `src/config.js` — all tunables; `HERO.scale = 4.0`
- `src/state.js` — single mutable state contract
- `src/assets.js` — GLTF + DRACOLoader (`https://www.gstatic.com/draco/v1/decoders/`)
- `src/weapons/index.js` — `FILLERS[]` + `applyFiller()` for endgame choices
- `src/xp.js` — `applyLevelUpChoice` handles `kind: 'filler'`
- `src/ui.js` — `paintCards` falls back to `choice.name/icon/desc` for fillers
- `assets/breakroom/`, `assets/sprites/` — copied directly (NOT junctions — `serve` doesn't follow them)

## Recent footguns (fixed but stay alert)
- DRACO-compressed GLBs silently fail without DRACOLoader
- Hero scale drifted 0.06 → 0.18 → 0.7 → 4.0 (scale logic scattered across loader/scene/anim — needs consolidation)
- Junction symlinks for assets — DON'T use them, copy
- `acquireWeapon` must run AFTER `resetState()` or weapons get wiped
- WASD raw XZ is wrong; must use isometric remap

## Plan to ship (from advisor)
**Order:**
1. **Harden first** — single hero-scale authority, lock DRACO + asset paths, consolidate iso-remap helper
2. **Run-end screen + meta-progression** — `RUN_OVER` state, summary (time/kills/XP), thin save layer for coins/unlocks
3. **Boss + 2–3 weapons** — boss tied to D(t), new weapons reuse orbital/projectile patterns
4. **Options menu** — SFX/music/shake toggles, zoom reset
5. **Polish** — hit-stop, screen-shake calibration, damage numbers, hero death anim, procedural music

**Cuts:** no new enemy families until pacing/boss locked, no backend/accounts/live-service meta.

**Biggest bang-for-buck:** consolidating hero scale to one authority. Drift is a deployment footgun on every future feature.

## Local run
```powershell
cd C:\Users\rneeb\Documents\kitty-kaki-survivors
npx serve
```
Then http://localhost:5180 (or whatever port serve picks).
