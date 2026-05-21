/**
 * Cave ceiling / sky-dome (P4A cohort 12, 2026-05-20).
 *
 * The cave's "sky-dome equivalent (cave ceiling shader)" acceptance item.
 * Mirrors src/forestSkyDome.js — a large inverted sphere (r=300, BackSide,
 * renderOrder -100, depthWrite off) that wraps the play area as a backdrop —
 * so it is occlusion-safe BY CONSTRUCTION at the ortho-iso cam (it renders
 * BEHIND everything and never writes depth; the floor + decor always draw in
 * front). This is exactly why a literal low ceiling was deferred and a
 * backdrop dome was the right read: the iso camera sees the upper-far interior
 * of the dome at the top of the frame (the "vault in the distance"), while the
 * cave floor fills the lower frame.
 *
 * Simpler than the forest dome: the cave is timeless, so there are no day/night
 * phase textures + crossfade. Instead a PROCEDURAL vertical gradient (no asset
 * gen) lerps between two PALETTE-PURE colors by sphere uv.y:
 *   - uLo = CAVE_PALETTE.shadow (0x1a1820) = the fog color, so the dome's lower
 *     band blends SEAMLESSLY into the fogged horizon (no visible seam).
 *   - uHi = CAVE_PALETTE.stone (0x4a4a52) = a lit stone vault toward the top.
 * smoothstep(0.4,1.0) keeps the lower ~40% flat at shadow (= fog) and only
 * lifts to stone in the upper vault. Palette discipline: both ends are the
 * locked slots 1+2; the lerp is shading between them, not an off-palette tint.
 *
 * Visual verification: cohort-12 ships alongside CC7's render gate (smoke-cave-v2
 * phase 13), which re-confirms the cave still renders non-black WITH the dome
 * and saves _thumb_cave_visual.png for a human to judge the vault look — the
 * first cave cohort that is NOT shipped blind.
 *
 * Static — no per-frame tick (no phases; steady backdrop). build + dispose only.
 */
import * as THREE from 'three';
import { CAVE_PALETTE } from './cavePalette.js';

const DOME_RADIUS = 300;   // matches forestSkyDome — wraps the arena + fog ramp
const DOME_W_SEG  = 32;
const DOME_H_SEG  = 16;

const VERT = /* glsl */`
varying float vH;
void main() {
  vH = uv.y;   // SphereGeometry uv.y: 0 at bottom pole → 1 at top pole
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uLo;
uniform vec3 uHi;
varying float vH;
void main() {
  // Keep the lower band flat at uLo (= fog color → seamless horizon); lift to
  // uHi only across the upper vault.
  float t = smoothstep(0.4, 1.0, vH);
  gl_FragColor = vec4(mix(uLo, uHi, t), 1.0);
}`;

let _state = null;   // { group, mesh, geo, mat }

/**
 * Build the cave sky-dome under `parent` (the caveStage group) and return
 * `{ group, present }` for the caveStage userData flag. Idempotent.
 */
export function buildCaveSkyDome(parent) {
  if (_state) disposeCaveSkyDome();
  if (!parent) return { group: null, present: false };

  const geo = new THREE.SphereGeometry(DOME_RADIUS, DOME_W_SEG, DOME_H_SEG);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLo: { value: new THREE.Color(CAVE_PALETTE.shadow) },   // 0x1a1820 (= fog)
      uHi: { value: new THREE.Color(CAVE_PALETTE.stone) },    // 0x4a4a52 (vault)
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,            // backdrop must not be double-fogged
    transparent: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'caveStage_skyDome';
  mesh.renderOrder = -100;     // behind everything (mirrors forestSkyDome)
  mesh.frustumCulled = false;  // wraps the camera — always render
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const group = new THREE.Group();
  group.name = 'caveStage_skyDome_grp';
  group.add(mesh);
  parent.add(group);

  _state = { group, mesh, geo, mat };
  return { group, present: true };
}

/**
 * Tear down the sky-dome. Idempotent — safe when not mounted.
 */
export function disposeCaveSkyDome() {
  if (!_state) return false;
  const { group, geo, mat } = _state;
  if (group && group.parent) group.parent.remove(group);
  try { geo && geo.dispose(); } catch (_) {}
  try { mat && mat.dispose(); } catch (_) {}
  _state = null;
  return true;
}
