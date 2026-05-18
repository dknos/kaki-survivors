# Cave Stage — Shared Visual Style Guide

Locked contract for any agent (Decor, Hazards, Neutrals, Weapons, Audio)
touching the Cave stage across cohorts P4A-c2 … P4A-cN. Same role as
`docs/FOREST_VISUAL_STYLE.md` plays for the Forest stage — visual style
drift across parallel cohorts is the #1 risk and this file is the lock.

Initial draft landed with P4A cohort 1 (skeleton). Sections marked
"draft — pending cohort cN" finalize when that cohort lands.

## Theme
**Stonewright Caverns** — deep, wet grottos lit only from below by
glowmoss patches and from above by sigil-pip pinpricks. Cold stone
silhouettes, amber pinholes for HUD parity, violet sigils that read as
old runeworker leftovers (slot reused from P1G sigil treatment so the
HUD doesn't have to learn a new accent). Dripping ceiling, ankle-deep
shadow at the edges, never any natural light.

## 5-Color Palette (locked)
All cave assets — geometry color, emissive, FX rings, particles — must
draw from this palette. Hex strings + THREE hex literals both listed.

| Slot | Use | Hex | THREE | Notes |
|------|-----|-----|-------|-------|
| 1 | Deep cave shadow, fog | `#1a1820` | `0x1a1820` | Near-black with violet bias. Stage fog + far-edge falloff. |
| 2 | Wet stone | `#4a4a52` | `0x4a4a52` | Floor, walls, stalactite base, sealed-door pediment. Slight cool gray. |
| 3 | Glowmoss bioluminescence | `#7fffe4` | `0x7fffe4` | Mint-cyan emissive. Already used in rune-kitten avatar tint (ties to acceptance). Emissive 1.4-2.0. |
| 4 | Sigil-pip violet | `#c87bff` | `0xc87bff` | Reused from P1G sigil arc treatment so HUD reads as same chrome. Hazard telegraph + cave-in ring + sealed-door rune. Emissive 1.6-2.2. |
| 5 | Amber lantern | `#ffd27f` | `0xffd27f` | HUD parity (cave HUD reuses the forest amber slot). Chest pop highlight. Emissive 1.2-1.8. |

**No off-palette colors.** Greens outside slot 3 are out. Reds are out
entirely. Browns/sepia are out (those belong to cinder). Stick to the 5.

## Intended Textures (TODO table)
Each row will be filled in by the named cohort. Texture authoring
follows the same pattern as forest (procedural BufferGeometry + flat
shading preferred over UV-mapped photo textures — reads cleaner under
bloom).

| Cohort | Asset | Texture / mesh notes |
|--------|-------|----------------------|
| P4A-c2 ✅ | Stalactite tip | Tapered 7-sided cylinder body (slot-2, roughness 0.85, flatShading), slot-3 moss-emissive sphere tip (intensity 1.6, bloom-tagged via BLOOM_LAYER). 4-5 per cluster × 6 anchored clusters (4 ring + 2 interior) = 26 InstancedMesh instances. Deterministic mulberry32 seed `0xC0CA0E1`. Shipped 2026-05-18 — `src/stages/cave/caveStalactites.js`. |
| P4A-c3 | Cave wall (stone) | Tileable rough stone normal map, slot-2 albedo. Reuse env.js#ground packKey hook (TODO P4A-cN: register cave-specific lighting branch in env.js#applyStageTint). |
| P4A-c4 | Glowmoss patch | Flat circle decal, slot-3 emissive 1.6, additive blend, bloom-tagged. Scatter near floor edges + on stalactite tips. |
| P4A-c5 | Ceiling drip | Single-frame slot-3 streak particle, gravity drop 4u in 0.4s, fades on contact. Spawned by ceiling shader (later cohort). |
| P4A-cN | Sealed door rune | Slot-4 sigil ring, identical line-weight contract to forest (0.06-0.10 world units, additive, bloom-tagged). |

## Line Weight + Bloom Feel
Same quality bar as forest — Spider Web FX
(`feedback_kitty_kaki_fx_quality.md`). Rune ring texture is canonical.

- Ring shockwaves: **line weight 0.06-0.10 world units**, additive
  blend, bloom-tagged via `mesh.layers.enable(BLOOM_LAYER)`.
- Stalactite tips: `flatShading: true` + per-instance tilt so light
  catches asymmetrically. Avoid smooth-shaded plastic look.
- Emissive intensity: glowmoss 1.4-2.0, sigil idle 1.6-2.2, sigil
  detonation 3.8 (single frame), amber 1.2-1.8.
- No texture-mapped stalactites. Merged BufferGeometry + flat shading
  reads cleaner under bloom than UV-mapped stone.

## Cohort Acceptance Order
Tracked in `docs/P4_BACKLOG.md` (P4A row). Cohort 1 ships:
- STAGES entry + selectable from menu
- Palette doc (this file)
- Palette module (`src/stages/cave/cavePalette.js`)
- Stage builder skeleton (`src/stages/cave/caveStage.js`)
- main.js stage-resolve switch + dispose hook
- assets.js#preloadStage cave arm (empty list, hook only)
- menuV2.js STAGE_ART cave entry
- smoke-cave-v2 phase 1 (boot+select)
- Initial STAGE_AUTHORING.md (P4K draft, finalized at cohort N)

Cohort 2 ships (2026-05-18):
- Stalactite landmark cluster (`src/stages/cave/caveStalactites.js`),
  26 InstancedMesh instances + bloom-tagged moss-emissive tips.
- `src/env.js` cave branch in `applyStageTint` (lower ambient, slot-3
  hemi sky, slot-1 hemi ground, dim cold-blue sun, cool fill).
- `src/env.js` `ATMOS_SPECS.cave` + `_tickCave` (36 slot-3 glowmoss
  spores drifting upward, light horizontal sway).
- smoke-cave-v2 phases 2 (stalactite count + bloom-tag) and 3
  (atmosClusters.cave visible + fog 0x1a1820 + hemi.intensity ≤0.22).

Layered cohorts (P4A-c3 … P4A-cN) follow the forest cohort cadence —
one self-contained content slice per cron tick, smoke gate green each
time.

## What's OUT
- Brown/sepia tones (cinder owns warm-decay)
- Mint outside slot 3 (forest owns full mint palette)
- Red/orange ground emission (cinder)
- Smooth shaded plastic stalactites
- Procedural particles with off-palette colors
- Any geometry that creates pathing dead-ends (enemies.js has no
  pathfinding — see slow-zones in forest hazards for the safe pattern)

## TODOs carried into later cohorts
- ~~env.js#applyStageTint has no `cave` branch~~ ✅ shipped P4A cohort 2
  (2026-05-18). Lighting branch landed; `packKey` still falls through
  to brown_mud diffuse — cohort cN: dedicated cave ground pack (slot-2
  wet stone diffuse + normal).
- ~~env.js#ATMOS_SPECS has no `cave` entry~~ ✅ shipped P4A cohort 2
  — 36 slot-3 glowmoss spores via `_tickCave`. Cohort cN may add a
  second slot-5 amber lantern mote layer (sparser, warmer counterpoint).
