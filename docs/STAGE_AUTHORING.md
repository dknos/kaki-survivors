# Stage Authoring Guide

Minimal contract for adding a new playable stage to kitty-kaki-survivors.

Status: **initial draft (P4K, 2026-05-18)**. Authored alongside the Cave
stage cohorts (P4A) — Cave is the canonical worked example. Sections
marked "draft — finalized at P4A-cN" will firm up as each Cave cohort
lands the corresponding subsystem.

## 0. Before you start
- Pick a stage `id` (one word, lowercase, ASCII). Existing ids:
  `forest`, `twilight`, `cinder`, `void`, `cave`.
- Pick a 5-to-8 color palette and put it in `docs/<STAGE>_VISUAL_STYLE.md`
  BEFORE writing any code. Off-palette colors are the #1 cohort-drift
  risk; lock the palette first.
- Read this doc top-to-bottom. The order of subsections matches the
  build order you'll follow.

## 1. Palette declaration
Canonical example: [docs/CAVE_VISUAL_STYLE.md](./CAVE_VISUAL_STYLE.md).

- One markdown doc per stage in `docs/<STAGE>_VISUAL_STYLE.md`.
- One JS constant module at `src/stages/<stage>/<stage>Palette.js`
  exporting a `<STAGE>_PALETTE` object — see
  `src/stages/cave/cavePalette.js` for the canonical shape.
- Every mesh, emissive, FX ring, particle, and tint in the stage MUST
  draw from the palette constant. Placeholder geometry is OK,
  off-palette colors are NOT.

## 2. STAGES entry shape
Add an entry to `STAGES` in `src/config.js`. Required fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Lowercase ASCII, stable forever (persisted to localStorage). |
| `name` | string | Display name on the menu card. |
| `desc` | string | One-line tagline for the menu card. |
| `enemyHpMul` | number | Multiplier applied via `state.run.stageHpMul`. |
| `finalBossAt` | number | Seconds. When the stage's final boss spawns. |
| `groundTint` | hex (0xRRGGBB) | `env.js#applyStageTint` recolors ground via this. Use slot-2-equivalent from your palette. |
| `fogColor` | hex (0xRRGGBB) | `env.js#applyStageTint` sets scene.fog.color to this. Use slot-1-equivalent. |
| `unlock` | string \| null | Meta flag name (`unlockedX`) that gates this stage. First stage = `null`. |

✏️ draft — will be finalized at P4A-cN: per-stage `lighting` profile
slot (low ambient / hemi color / sun color triple) once env.js gains
a cave-specific branch in `applyStageTint`. Until then the
forest-baseline lighting falls through.

## 3. Stage builder module
Create `src/stages/<stage>/<stage>Stage.js` exporting:

```js
export function build<Stage>Stage(scene) { ... }
export function dispose<Stage>Stage(scene) { ... }
```

Contract (canonical example: `src/stages/cave/caveStage.js`):
- **Static import** of palette + THREE — never dynamic. Per
  `[[feedback_kks_export_origin_module_break.md]]`, lazy origin imports
  break across module reloads.
- Build a single `THREE.Group` with `group.name = '<stage>Stage'` so
  smoke tests can verify wire-up with `scene.getObjectByName(...)`.
- Dispose must walk the group, dispose geometry + materials, detach
  from parent, and null out module state. **Idempotent** — safe to
  call even when nothing is mounted.
- Stage builder runs ON TOP of the shared `env.js#buildEnv` — it
  does NOT replace it. The shared env owns ground / fog / lighting;
  the per-stage builder adds decor.

## 4. Asset preload tier
Add a `case '<stage>':` arm to `preloadStage` in `src/assets.js`. Even
if your first cohort has no stage-specific GLBs, the case arm must
exist so future cohorts can drop in assets. Use the form:

```js
case 'cave':
  // P4A-cN cohorts add cave-specific GLBs here
  break;
```

## 5. main.js stage-resolve switch
In `src/main.js#applyMetaUpgrades` (search for the chain of
`if (stage.id === 'forest') { ... } else if ('twilight') ...`):
- Add an `else if (stage.id === '<stage>')` arm.
- Inside the arm, call `build<Stage>Stage(state.scene)`.
- Mirror the defensive `clear<Other>Stage` / `dispose<Other>Stage`
  calls from the other arms so a stage swap mid-session doesn't leave
  ghost decor from the previous stage.
- In `_teardownActiveRun`, add a `dispose<Stage>Stage(state.scene)`
  call alongside the other clear* calls so cave decor is torn down on
  run-end.

✏️ draft — finalized at P4A-cN: when the dispose chain grows, the
spec calls for extracting a per-stage teardown table rather than the
current copy-paste pattern. Holding the refactor until Cave has full
content coverage so the shape is locked.

## 6. Menu STAGE_ART entry
Add a `<stage>: { ... }` entry to `STAGE_ART` near the top of
`src/menuV2.js`. Required fields:

| Field | Type | Notes |
|-------|------|-------|
| `bg` | CSS color string | Card background. Match slot-1 hex from your palette. |
| `accent` | string | Art preset key. Reuse `mistwood`/`dungeon`/`cinder`/`void` or invent `<stage>`. |
| `tier` | string | "Chapter N" label. |
| `sub` | string | Subtitle (typically a poetic phrasing of `name`). |
| `diff` | string | Difficulty label (Whisker / Veteran / Elite / Nightmare / Hollow). |
| `waves` | number | Cosmetic "N waves" stat on the card. |

If the menu falls back to `STAGE_ART.forest` for unknown ids it won't
crash but the card art will be wrong.

## 7. Smoke test
Naming convention: `tools/smoke-<stage>-v2.mjs`. Lifecycle:
1. Phase 1 — boot. Poke `meta.unlockedX = true` + `setOption('selectedStage', '<stage>')`,
   call `window.kkStartRun()`, assert `state.run.stage.id === '<stage>'`
   and `scene.getObjectByName('<stage>Stage')` is non-null.
2. Phase 2 — rooms. ✏️ draft — finalized at P4A-cN when Cave lands
   rooms.
3. Phase 3 — boss. ✏️ draft.
4. Phase 4 — reaper / final wave. ✏️ draft.

For cohort 1 (skeleton), only phase 1 is required. Use
`tools/smoke-cave-v2.mjs` as the canonical example.

Smoke must:
- Boot in headless Chromium via Playwright (no `npm install` — paths
  are pinned to `/home/nemoclaw/node_modules/playwright` and
  `/home/nemoclaw/.cache/ms-playwright/chromium-1208`).
- Capture 0 page errors.
- Exit non-zero on failure.

## 8. TODO sections (draft — filled in as Cave cohorts land them)

### 8a. Weapon registration
✏️ draft — finalized at P4A-cN. Pattern: register stage-themed weapons
in `src/weapons/index.js` REGISTRY. Cave: 2 weapons matching forest
density.

### 8b. Neutral / hazard / landmark slots
✏️ draft — finalized at P4A-cN. Pattern follows forest:
- Neutral: `src/<stage>Neutrals.js` (canonical: `src/forestNeutrals.js`)
- Hazard: `src/<stage>EnvHazards.js` or `src/stageHazards.js` arm
- Landmark: `src/<stage>Landmarks.js` (canonical: `src/forestLandmarks.js`)

Cave will use: gloomshrimp (neutral), cave-in (hazard), stalactite
(landmark).

### 8c. Music phase hooks
✏️ draft — finalized at P4A-cN. Pattern: 3-phase music progression
(intro / mid / final-boss) routed through `playStageAmbient(stage.id)`
in `src/audio.js`. Stage owns its `.ogg` loops under
`assets/audio/<stage>/`.

### 8d. Achievement registration
✏️ draft — finalized at P4A-cN. Pattern: per-stage achievement file
(`src/<stage>Achievements.js`). For cave, mirror
`src/forestAchievements.js` shape.

### 8e. Sky dome wire
✏️ draft — finalized at P4A-cN. Pattern: `src/<stage>SkyDome.js` or
the cave equivalent — a ceiling shader for cave instead of a sky dome,
since cave is enclosed. Hook into `loadX(state.scene)` from the
stage-resolve switch.

### 8f. Ground normal map
✏️ draft — finalized at P4A-cN. Pattern:
`tools/_gen_<stage>_ground_normal.mjs` regenerates the normal map.
Wire into `env.js#applyStageTint` via a per-stage `packKey` arm.
Currently cave falls through to `'twilight'` brown_mud — out of
scope for cohort 1 (env.js is hard-out-of-scope per cohort 1 file
ownership).

## 9. Where to find prior art
- `src/env.js` — shared environment, per-stage tint hook.
- `src/forestRooms.js`, `src/forestAmber.js`, `src/forestLandmarks.js` —
  forest stage subsystems, canonical pattern for cohort N coverage.
- `src/stages/cave/*` — minimum-viable stage skeleton; the canonical
  example for a fresh stage.
- `tools/smoke-forest-v2.mjs` — 4-phase forest regression. Copy the
  shape; trim to cohort 1 phase count.

## 10. Multi-cohort cadence
- Phase ownership: one cohort per cron tick. Don't try to land rooms
  + weapons + hazards in the same commit — review surface explodes.
- Smoke gate: every cohort must add or extend the stage's smoke. If
  smoke-<stage>-v2 isn't green, the cohort isn't shipped.
- Palette guard: every cohort review checks the palette. Off-palette
  colors block merge.
- Hard-scope file ownership in the cohort spec. The Cave cohort 1
  spec is the canonical example of how to draw the scope line.
