# Art Director — Shader/Lighting/Shadow Plan

Consultation 2026-05-13. Items 1, 2, 3 shipped. Remaining items below for loop iterations.

## Shipped
- [x] **#1 Tone mapping**: `LinearToneMapping` → `ACESFilmicToneMapping`, exposure 1.05.
- [x] **#2 Light stack rebalance**: dropped AmbientLight (HDRI fills it), hemi 1.0→0.35 with cool sky / warm ground, sun recolored to warm `#ffe4b8` from steeper key, fill recolored cool `#5577aa` at 0.25. HDRI envMapIntensity 0.55→0.70.
- [x] **#3 Blob shadows**: new `src/blobShadows.js` — InstancedMesh of soft radial-gradient dark circles at y=0.02. 320 slots, dynamic matrices. Hero gets a bigger blob, enemies scale by mesh size. ~0.3ms.

## Queued
- [x] **#4 Selective bloom**: `BLOOM_LAYER = 1` exported from postfx.js. New `bloomComposer` renders the bloom layer only into a texture; main composer adds it back via a `BloomCompositeShader`. Threshold 0, strength 0.70, radius 0.50. Layer-flagged: kill rings, magnet sparks, orbital glow+core, projectile glow+core, chain tubes, chest halo. Frame loop saves scene.background/fog, masks camera to layer 1 for bloom render, restores for main.
- [x] **#5 Rim light fake**: `_injectRim()` in assets.js. onBeforeCompile adds rimColor/rimPower/rimStrength uniforms (cyan #aaccff / power 2.4 / strength 0.35) and a view-space rim term added to `outgoingLight` before `<opaque_fragment>` (fallback `<output_fragment>`). Applies to all GLB materials — characters now read cleanly against dark fog.
- [x] **#6 Height fog tint**: `fogTint` (#3a4a44) + `fogAmount` (0.18) uniforms. Smoothstep gradient toward top of screen blends toward fogTint.
- [x] **#7 Material consistency**: `upgradeMaterials(root, env, roughness)`. Hero 0.92 plush, elites 0.55 glossy, bugs 0.65 chitin, default 0.85.
- [x] **#8 Color grade (LGG)**: lift/gamma/gain Vec3 uniforms in PostFX. Defaults nudge shadows cool / highlights warm. Boss waves lerp `lift` toward +red/-blue 4%/frame while final boss alive.
- [ ] **#9 Re-evaluate HDRI intensity** after the above land. May need to tune envMapIntensity back to 0.45-0.50.

## Apply order rationale
Lighting baseline (#1, #2) → depth & FX (#3, #4) → character readability (#5, #7) → mood (#6, #8) → final tune (#9).
