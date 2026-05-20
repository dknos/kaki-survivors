/**
 * Cave central sigil-floor landmark (P4A cohort 11, 2026-05-20).
 *
 * A large ancient rune circle inscribed on the cave floor at the hero spawn —
 * the cave's central focal landmark (the perimeter has stalactites/stalagmites/
 * mushrooms; the mid-field has glowmoss patches + drifting gloomshrimp; the
 * CENTER, r<12, was bare because the cohort-3 glowmoss patches start at the 12u
 * annulus). This fills that gap with a single inscribed sigil so the player
 * "materializes on the ancient mark".
 *
 * Reuses the game-wide rune-ring texture (src/enemyTells.js#makeRuneRingTexture
 * — the same art language as statue selection rings, chest halos, elite tells)
 * tinted to slot-3 moss. Slot-3 (NOT the slot-4 sigil-violet) deliberately:
 * violet is the palette's telegraph/hazard-ring color, and a permanent violet
 * floor sigil would later be confused with the (deferred) cave-in hazard rings.
 * Moss reads as "ancient sigil overgrown with glowmoss" and matches the
 * cohort-3 floor-glow palette.
 *
 * Ground-decal recipe is copied verbatim from cohort-3 caveGlowmoss.js (the
 * canonical [[fix_aoe_z_order]] precedent): additive + transparent + depthWrite
 * off + polygonOffset(-1,-1) + renderOrder -1, so the hero capsule + enemies
 * draw ON TOP and the sigil reads as ground, not a prop. FLAT → zero occlusion
 * on the ortho-iso cam, and a large structured ring is unambiguously
 * architecture (not a pickup) even before CC7's visual gate lands.
 *
 * Single mesh (one landmark, not an instanced scatter). Static decor — no
 * tickCave wiring. build + dispose only (geometry + material + the CanvasTexture
 * this module owns).
 */
import * as THREE from 'three';
import { CAVE_PALETTE } from './cavePalette.js';
import { BLOOM_LAYER } from '../../postfx.js';
import { makeRuneRingTexture } from '../../enemyTells.js';

const SIGIL_SIZE = 18;     // plane edge length → ~9u radius; fills the bare
                           // r<12 center without swamping the r12+ patch annulus
const FLOOR_Y    = 0.03;   // just above the cohort-3 glowmoss patches (0.02)
const OPACITY    = 0.5;    // additive — kept modest so the center doesn't blow out

let _state = null;   // { group, mesh, geo, mat, tex }

/**
 * Build the central sigil floor under `parent` (the caveStage group). Returns
 * `{ group, present }` so caveStage.js can flag it on userData for the smoke
 * probe. Idempotent — disposes a prior build first.
 */
export function buildCaveSigilFloor(parent) {
  if (_state) disposeCaveSigilFloor();
  if (!parent) return { group: null, present: false };

  const tex = makeRuneRingTexture();
  const geo = new THREE.PlaneGeometry(SIGIL_SIZE, SIGIL_SIZE);
  geo.rotateX(-Math.PI / 2);   // lie flat, face +Y

  const mat = new THREE.MeshBasicMaterial({
    map:          tex,
    color:        CAVE_PALETTE.moss,   // slot-3 tint of the white rune art
    transparent:  true,
    opacity:      OPACITY,
    blending:     THREE.AdditiveBlending,
    depthWrite:   false,
    side:         THREE.DoubleSide,
    // Z-order parity with cohort-3 glowmoss: bias BELOW hero+enemy capsules.
    polygonOffset:       true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits:  -1,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'caveStage_sigilFloor';
  mesh.position.set(0, FLOOR_Y, 0);
  mesh.renderOrder = -1;             // pair with polygonOffset for ground decals
  mesh.layers.enable(BLOOM_LAYER);   // slot-3 moss pops under bloom
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'caveStage_sigilFloor_grp';
  group.add(mesh);
  parent.add(group);

  _state = { group, mesh, geo, mat, tex };
  return { group, present: true };
}

/**
 * Tear down the sigil floor. Idempotent — safe when not mounted. Disposes the
 * geometry, material, and the CanvasTexture this module created.
 */
export function disposeCaveSigilFloor() {
  if (!_state) return false;
  const { group, geo, mat, tex } = _state;
  if (group && group.parent) group.parent.remove(group);
  try { geo && geo.dispose(); } catch (_) {}
  try { mat && mat.dispose(); } catch (_) {}
  try { tex && tex.dispose(); } catch (_) {}
  _state = null;
  return true;
}
