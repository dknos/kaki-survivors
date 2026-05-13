# Kitty Kaki Survivors — Style Bible

**For Oekaki Connect contributors.** Read this once before drawing anything.
Open `style-bible.html` in a browser for live palette swatches + reference renders.

Game tagline: *cozy roguelite horde game, drawn the way the collective sketches.*
Mood: warm paper, ink lines, late-afternoon sun. The horde-game half is brisk and
loud; the **house interior** half is calm, paper-soft, and inviting.

---

## 1. Color palette

Six total ramps. Use only these — no off-palette saturation spikes.

| Role            | Hex      | Use                                            |
|-----------------|----------|------------------------------------------------|
| Paper           | `#f3e8cf`| Default background, paper-grain base.          |
| Ink             | `#231a14`| Line work, body shadow.                        |
| Warm Tan        | `#d99b54`| Buns, wood, cardboard, midday warmth.          |
| Tea Amber       | `#c98a3a`| Brewed tea, button accent, brass.              |
| Sakura          | `#e8a3c7`| Ribbon, cheeks, blossoms, soft glow.           |
| Sage            | `#8aaa6a`| Leaf, jade, calm UI accents.                   |
| Indigo Wash     | `#384a78`| Cold shadow, dusk, water.                      |
| Ember           | `#ff7a3a`| Embers currency, energy FX, alarms.            |

**Highlight color** (single, always): `#fff9e6` warm bone — never pure white.
**Shadow color** (single, always): `#231a14` ink — never gray.

## 2. Line weight

One pen. One weight. Stop using brush size as a stylistic variable.

| Line             | Pixel weight (at 1024-tall canvas) | Use                  |
|------------------|-----------------------------------:|----------------------|
| Primary outline  | 4 px                               | Character silhouette.|
| Secondary detail | 2 px                               | Furniture, hair tufts.|
| Whisker / hint   | 1 px                               | Pet hair, paper folds.|

Never below 1 px or above 4 px. No tapered brush calligraphy unless you're
hand-drawing a wall sketch decal — that's its own asset class.

## 3. Shadow & highlight

- **One shadow angle**: light source from upper-left, shadow falls lower-right.
- Shadow stays flat — no gradients, no painterly soft edges.
- Highlights are single ovals on round forms; single facets on flat forms.
- No ambient occlusion in painted assets — let 3D engine handle that.

## 4. Perspective & framing

Two cameras the game uses; brief each asset against the right one.

**A. Horde view (out-running enemies)** — orthographic top-down, ~60° tilt.
Characters are read mostly from above. Faces are NOT important here — silhouette
+ palette are.

**B. House interior view** — orthographic iso, ~30° tilt, fixed Y-axis.
Characters' 3/4 face IS readable. Slight foreshortening, never extreme.
Furniture is drawn from this angle even when reused in props elsewhere.

Reference angles are diagrammed in `style-bible.html` — open it for live grids.

## 5. Paper grain & noise

A single shared paper texture overlay is applied at render time
(`assets/sprites/paper_grain.png` — TODO, commissioned first). Don't bake grain
into individual assets; the engine multiplies it on top of finished sprites.

If you draw on textured paper IRL, scan and submit the texture as a SEPARATE
file labeled `texture_<your-name>.png`. We may pool them into a rotating overlay.

## 6. Material rules (where 2D meets 3D)

The game is **flat-shaded 3D meshes with hand-drawn 2D decals layered on top**.

| Element              | Asset type            | Who makes it             |
|----------------------|-----------------------|--------------------------|
| Room walls / floor   | 3D mesh (Quaternius)  | Engine / dev             |
| Furniture geometry   | 3D mesh               | Quaternius first; commissioned overrides later |
| Wall sketches        | PNG decal             | Collective member        |
| Rugs, paper stacks   | PNG decal on flat 3D  | Collective member        |
| Kitty's face         | PNG decal on mesh head| Collective member        |
| Particle FX          | Canvas-painted atlas  | Engine (already shipped) |

Decal exports: PNG with alpha, **power-of-two dimensions** (256/512/1024).
Provide both a 1024 master and a 512 game-ready resize.

## 7. Commission ladder

| Tier  | Scope                                | Pay (USD) | Turnaround |
|-------|--------------------------------------|----------:|-----------:|
| Micro | 1 prop sheet or 1 icon set (6 icons) | $25–50    | 1-2 days   |
| Small | 1 prop cluster or 1 vignette decal   | $75–150   | 3-5 days   |
| Room  | 1 full room kit + variants           | $200–400  | 1 week     |
| Hero  | Anchor key-art + style co-direction  | $500+     | 2 weeks    |

Each Micro commission gets a 1-page brief: target asset, dimensions, palette
slots, reference photo, due date. No vibe briefs. No "draw something cute."

## 8. First-wave commission queue

In order:

1. **Paper-grain texture** (Micro) — the shared overlay texture.
2. **Kitty Kaki idle/interaction sheet** (Small) — front + 3/4 + back stances.
3. **House key art** (Room) — one room rendered at intended camera, used as
   the visual target for all subsequent room commissions.
4. **12 reusable prop decals** (Micro × 3) — yarn ball, teacup, sketchbook,
   stamp, paper plane, inkblot, framed sketch, postal stamp, blossom branch,
   tea kettle, ribbon spool, paw print.
5. **6 minigame icons** (Micro) — one per shipped house minigame.

After (3) lands, every subsequent commission references that piece as the
"this is the bar" anchor. Quality drifts upward from there, not from "vibe."

## 9. Naming & delivery

- Filenames: `kk_<category>_<asset>_<variant>.png`
  e.g. `kk_prop_teacup_steaming.png`, `kk_room_kitchen_anchor.png`.
- Submit in a single zip per commission; include a `.txt` with palette slots used.
- Source files (PSD/Procreate/Krita) optional but appreciated.

## 10. What NOT to do

- ❌ Photoreal rendering, soft brushes, painted-volumetric lighting.
- ❌ Off-palette pastel washes "just to add variety."
- ❌ AI-generated assets without heavy redraw on top. Mood: oekaki collective,
  not Midjourney.
- ❌ Five different line weights on one character.
- ❌ Tilted/dutch-angle props that won't sit on the iso floor grid.

If you're unsure, open `style-bible.html` and squint at the swatches before
committing time.
