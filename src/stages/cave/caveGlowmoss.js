/**
 * Cave glowmoss floor decals (P4A cohort 3, 2026-05-18).
 *
 * Bioluminescent slot-3 patches lying flat on the cave floor — additive
 * blended, bloom-tagged, Z-ordered BELOW the hero so they read as glowing
 * ground decoration rather than props. Mirrors the ring-shockwave decal
 * pattern from `src/forestAmber.js` (the canonical ground-decal precedent
 * established by the 2026-05-17 AOE Z-order fix).
 *
 * Authored per docs/CAVE_VISUAL_STYLE.md row P4A-c4:
 *   - CircleGeometry radius 1.0-2.4u (jittered via per-instance scale).
 *   - MeshBasicMaterial slot-3 moss (CAVE_PALETTE.moss = 0x7fffe4) with
 *     transparent + additive blending + depthWrite off — classic
 *     ground-decal additive-glow recipe.
 *   - polygonOffset { factor: -1, units: -1 } + renderOrder = -1 so the
 *     hero capsule + enemies + stalactites all draw on top.
 *   - InstancedMesh (24 instances ≥ 20 instance break-even).
 *   - `layers.enable(BLOOM_LAYER)` so the slot-3 cyan pops under bloom —
 *     same quality bar as Spider Web FX / stalactite tips.
 *
 * Scatter: 24 patches in a deterministic mulberry32 ring around the cave
 * (seed `0xC0CA0E2` — distinct from stalactite seed `0xC0CA0E1`). Patches
 * bias toward the 12-26u annulus so the hero spawn at (0,0) stays clear
 * and the patches read as "edge-of-clearing" growth lining the floor.
 *
 * Optional polish: per-instance alpha pulse via `tickGlowmoss(dt)` — gentle
 * 0.5 Hz sine modulating the InstancedMesh material opacity between 0.45
 * and 0.65. Single material so the modulation is one assignment per frame
 * (cheaper than per-instance alpha attributes). Self-gates on `_state` so
 * a non-cave run dropping into the tick is a no-op per
 * `[[feedback_kks_wave_dispatcher_throttle.md]]`.
 *
 * Disposal: single module-level state pointer; idempotent disposeGlowmoss
 * tears down the InstancedMesh geometry + material, matching the cohort 2
 * stalactite contract.
 */
import * as THREE from 'three';
import { CAVE_PALETTE } from './cavePalette.js';
import { BLOOM_LAYER } from '../../postfx.js';

const COHORT_SEED      = 0xC0CA0E2;
const PATCH_COUNT      = 24;          // ≥20 instance break-even, ≤30 brief cap
const FLOOR_Y          = 0.02;        // sits just above caveStage floor accent
const RADIUS_MIN       = 1.0;
const RADIUS_MAX       = 2.4;
const RING_R_MIN       = 12;          // keep-out around hero spawn
const RING_R_MAX       = 26;          // outer annulus bound

// Per-instance unit CircleGeometry baked into the InstancedMesh; per-instance
// scale carries the radius jitter. Single geometry + single material is the
// cheapest path through the renderer for 24 ground decals.
const BASE_RADIUS      = 1.0;
const CIRCLE_SEGMENTS  = 24;

// Alpha pulse band — gentle so the patches read as glowing growth, not a
// strobe. 0.5 Hz means a full bright→dim→bright cycle every 2 seconds.
const ALPHA_BASE       = 0.55;
const ALPHA_AMPLITUDE  = 0.10;        // 0.45..0.65
const ALPHA_FREQ_HZ    = 0.5;

// Tiny local deterministic RNG. Same algorithm as src/dailyRng.js but
// inlined to keep cave geometry independent of the daily-seed plumbing —
// glowmoss look should be the same on Tuesday and Wednesday daily runs.
function _mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _state = null;   // { group, inst, geo, mat, count, tAcc }

/**
 * Build the glowmoss patch InstancedMesh and parent it under `parent`
 * (typically the caveStage group). Returns `{ group, count }` so the
 * caller can record `glowmossCount` on caveStage.userData for the smoke
 * probe. Idempotent — if a cluster is already mounted (re-entry on stage
 * swap), dispose first then rebuild.
 */
export function buildGlowmossPatches(parent) {
  if (_state) disposeGlowmoss();
  if (!parent) return { group: null, count: 0 };

  // Unit circle in XY plane (CircleGeometry default). Rotate -PI/2 so the
  // face points up along world +Y, then per-instance scale puts radius in
  // the 1.0-2.4u band.
  const geo = new THREE.CircleGeometry(BASE_RADIUS, CIRCLE_SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  // Ground-decal recipe — additive blend + transparent + depthWrite off so
  // the patches glow over each other without z-fighting at overlap zones.
  // Color is slot-3 moss; the multiply against bloom + the additive blend
  // does most of the visual work.
  const mat = new THREE.MeshBasicMaterial({
    color:        CAVE_PALETTE.moss,
    transparent:  true,
    opacity:      ALPHA_BASE,
    blending:     THREE.AdditiveBlending,
    depthWrite:   false,
    side:         THREE.DoubleSide,
    // Z-order fix per [[fix_aoe_z_order]] / src/forestAmber.js precedent:
    // bias the decal BELOW the hero+enemy capsules so they occlude it.
    polygonOffset:       true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits:  -1,
  });

  const inst = new THREE.InstancedMesh(geo, mat, PATCH_COUNT);
  inst.name = 'caveStage_glowmossPatches';
  inst.layers.enable(BLOOM_LAYER);   // slot-3 emissive bloom per style doc
  inst.renderOrder = -1;             // pair with polygonOffset for ground decals
  inst.castShadow = false;
  inst.receiveShadow = false;
  inst.frustumCulled = false;        // decals are small, scattered; skip the
                                     // per-instance cull cost on a fixed N=24

  const rng = _mulberry32(COHORT_SEED);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < PATCH_COUNT; i++) {
    // Polar scatter in the 12-26u annulus around origin — keeps hero spawn
    // clear and biases patches toward the cave's "edge of clearing" feel.
    const theta = rng() * Math.PI * 2;
    const r     = RING_R_MIN + rng() * (RING_R_MAX - RING_R_MIN);
    const x     = Math.cos(theta) * r;
    const z     = Math.sin(theta) * r;

    // Per-instance radius via uniform scale — the base CircleGeometry is
    // 1.0u so scale = target radius.
    const radius = RADIUS_MIN + rng() * (RADIUS_MAX - RADIUS_MIN);

    // Slight per-instance rotation so the 24-segment circle silhouettes
    // don't all align (avoids a moiré pattern when patches overlap).
    const yaw = rng() * Math.PI * 2;

    dummy.position.set(x, FLOOR_Y, z);
    dummy.scale.set(radius, 1, radius);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'caveStage_glowmoss';
  group.add(inst);
  parent.add(group);

  _state = { group, inst, geo, mat, count: PATCH_COUNT, tAcc: 0 };
  return { group, count: PATCH_COUNT };
}

/**
 * Tick the glowmoss alpha pulse. Self-gated — early-return when no cluster
 * is mounted (per [[feedback_kks_wave_dispatcher_throttle.md]] for any
 * per-frame hook in this codebase). dt is wall-clock seconds.
 *
 * Modulates the InstancedMesh material's `opacity` uniform. Since all 24
 * instances share one material this is O(1) per frame.
 */
export function tickGlowmoss(dt) {
  if (!_state) return;
  if (!Number.isFinite(dt) || dt <= 0) return;
  _state.tAcc += dt;
  const phase = _state.tAcc * ALPHA_FREQ_HZ * Math.PI * 2;
  const op = ALPHA_BASE + Math.sin(phase) * ALPHA_AMPLITUDE;
  _state.mat.opacity = op;
  // No needsUpdate on transparent opacity — three.js re-reads each frame.
}

/**
 * Tear down the glowmoss cluster. Idempotent — safe to call when not
 * mounted. Disposes the InstancedMesh geometry + material.
 */
export function disposeGlowmoss() {
  if (!_state) return false;
  const { group, geo, mat } = _state;
  if (group && group.parent) group.parent.remove(group);
  try { geo && geo.dispose(); } catch (_) {}
  try { mat && mat.dispose(); } catch (_) {}
  _state = null;
  return true;
}
