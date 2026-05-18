/**
 * Cave stage builder — minimum-viable skeleton (P4A cohort 1, 2026-05-18).
 *
 * The cave stage rides on top of the shared env (src/env.js#buildEnv)
 * exactly like forest/twilight/cinder/void do — applyStageTint already
 * recolors ground + fog from the STAGES entry (groundTint / fogColor),
 * and cave's slot-2 stone (#4a4a52) + slot-1 shadow fog (#1a1820)
 * pipe through without changes to env.js (which is HARD-out-of-scope
 * for cohort 1).
 *
 * What this module DOES (cohort 1):
 *   - Mounts a single scene-named group `caveStage` so the smoke can
 *     prove the wire-up ran.
 *   - Adds a placeholder BoxGeometry "stalactite" tinted CAVE_PALETTE.stone.
 *   - Adds a thin slot-2 floor accent plane slightly above y=0 so it does
 *     NOT z-fight with env.js#ground (which is the canonical floor).
 *   - Exports buildCaveStage(scene) + disposeCaveStage(scene) — idempotent,
 *     safe to call across stage swaps / run-end.
 *
 * What this module does NOT do (cohort 1):
 *   - No rooms, neutrals, hazards, weapons, chests, coffins, achievements,
 *     music phases, ceiling shader, ground normal, or stone wall textures.
 *     Those land in P4A cohorts 2 through N — see docs/P4_BACKLOG.md.
 *   - Does NOT register cave atmospheric particles in env.js#ATMOS_SPECS
 *     (env.js is out-of-scope for cohort 1; TODO carried in
 *     docs/CAVE_VISUAL_STYLE.md).
 *
 * Constraints honored:
 *   - Static import per [[feedback_kks_export_origin_module_break.md]].
 *   - 5-color palette only — slot-2 stone for placeholder geometry.
 *   - Idempotent dispose (early-return if not mounted).
 */
import * as THREE from 'three';
import { CAVE_PALETTE } from './cavePalette.js';

const STAGE_GROUP_NAME = 'caveStage';

// Single-instance module state. The shared env (one buildEnv at boot)
// runs once per process; the cave decor group is built/disposed per
// run-start / run-end, so module-level singletons are fine.
let _group = null;

/**
 * Build the cave-stage decor group and add it to the scene. Called from
 * main.js#applyMetaUpgrades when stage.id === 'cave'. Idempotent — if a
 * group is already mounted on a previous run, dispose first then rebuild.
 */
export function buildCaveStage(scene) {
  if (!scene) return null;
  if (_group) disposeCaveStage(scene);

  const group = new THREE.Group();
  group.name = STAGE_GROUP_NAME;

  // Floor accent plane — slightly above env.js#ground (y=0) to avoid
  // z-fight. Pure slot-2 stone; rotates flat with -PI/2 like env.js does.
  // Size 80x80 per the cohort spec; the shared env ground extends much
  // further so this only reads as a cave-floor "tint patch" in the
  // immediate play area.
  const floorMat = new THREE.MeshStandardMaterial({
    color: CAVE_PALETTE.stone,
    roughness: 0.95,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;            // sits just above env ground
  floor.receiveShadow = false;
  floor.name = 'caveStage_floorAccent';
  group.add(floor);

  // TODO P4A-c2: replace with stalactite landmark (matched-density
  // clusters; per-instance flat-shaded BufferGeometry; tip glow on
  // CAVE_PALETTE.moss like the FOREST_VISUAL_STYLE.md spider-web spec).
  // For cohort 1 a single Box-as-stalactite proves the decor builder ran
  // and gives the smoke a visible cave-tinted prop.
  const stalMat = new THREE.MeshStandardMaterial({
    color: CAVE_PALETTE.stone,
    roughness: 0.85,
    metalness: 0.10,
    flatShading: true,
  });
  const stalactite = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), stalMat);
  stalactite.position.set(8, 3, -6);
  stalactite.name = 'caveStage_stalactitePlaceholder';
  group.add(stalactite);

  scene.add(group);
  _group = group;
  return group;
}

/**
 * Tear down the cave-stage decor group, disposing geometry + materials so
 * GPU memory doesn't leak across stage swaps / run-end. Idempotent — safe
 * to call when nothing is mounted (e.g. on a forest run).
 */
export function disposeCaveStage(scene) {
  if (!_group) return false;
  // Detach first so traversal doesn't race with re-add elsewhere.
  if (_group.parent) _group.parent.remove(_group);
  _group.traverse((o) => {
    if (o.geometry && typeof o.geometry.dispose === 'function') {
      try { o.geometry.dispose(); } catch (_) {}
    }
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && typeof m.dispose === 'function') {
        try { m.dispose(); } catch (_) {}
      }
    }
  });
  _group = null;
  return true;
}
