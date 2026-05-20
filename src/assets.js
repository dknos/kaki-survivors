/**
 * GLTF preload + cache. Adapted from index.html lines 1985-2068 of the original game.
 * Exports a Promise that resolves once all assets are loaded (or failed gracefully).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HERO, AVATARS } from './config.js';

export const BASE = 'assets/breakroom/';

/** @type {Record<string, any>} */
export const GLTF_CACHE = {};

// Draco decoder served from Google's CDN — required because tower-castle.glb and
// tower-void.glb were re-exported with Draco compression.
const _draco = new DRACOLoader();
_draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
_draco.setDecoderConfig({ type: 'js' });

const _loader = new GLTFLoader();
_loader.setDRACOLoader(_draco);

function _preload(key, path) {
  return new Promise(resolve => {
    _loader.load(
      path,
      gltf => {
        GLTF_CACHE[key] = gltf;
        resolve(true);
      },
      undefined,
      err => {
        console.warn(`[assets] failed: ${path}`, err);
        GLTF_CACHE[key] = null;
        // Iter 10b — surface asset-load failures via a window CustomEvent so
        // 10c's UI layer can show a user-facing toast instead of leaving the
        // game silently spawnless. We accumulate failures on a shared list
        // so a late listener still sees the full picture (and we dispatch
        // each time so an early listener picks them up immediately too).
        try {
          if (typeof window !== 'undefined') {
            window._kkAssetFailures = window._kkAssetFailures || [];
            window._kkAssetFailures.push({ key, path, err: String(err && err.message || err) });
            window.dispatchEvent(new CustomEvent('kk-asset-load-failed', {
              detail: { failures: window._kkAssetFailures.slice() },
            }));
          }
        } catch (_) { /* event dispatch must never block the load resolve */ }
        resolve(false);
      }
    );
  });
}

/**
 * Clone a cached GLTF scene. Uses SkeletonUtils.clone for skinned meshes.
 * Returns null if the asset wasn't loaded.
 */
export function cloneCached(key) {
  const gltf = GLTF_CACHE[key];
  if (!gltf) return null;
  return SkeletonUtils.clone(gltf.scene);
}

/**
 * Lazy GLTF loader (iter 33y) — fetches the asset if not yet cached and
 * resolves with `true` when the cache entry is populated, `false` on error.
 * Used by the carousel to fetch non-default hero avatars on demand instead
 * of preloading all 12 at boot (~80 MB GPU memory).
 *
 * Returns an existing in-flight promise if one is pending for the same key,
 * so concurrent callers share a single network request.
 */
const _inflight = new Map();
export function lazyLoadGLTF(key, path) {
  if (GLTF_CACHE[key]) return Promise.resolve(true);
  const pending = _inflight.get(key);
  if (pending) return pending;
  const p = _preload(key, path).then((ok) => {
    _inflight.delete(key);
    return ok;
  });
  _inflight.set(key, p);
  return p;
}

/**
 * Drop a cached GLTF and release its GPU resources. Walks the scene graph
 * to dispose every Material, MaterialMap (Texture), and BufferGeometry so
 * VRAM doesn't leak. Used when we're done with non-selected hero avatars
 * after entering run mode.
 */
export function disposeCachedGLTF(key) {
  const gltf = GLTF_CACHE[key];
  if (!gltf) return false;
  const seenMats = new Set();
  const seenTex = new Set();
  const seenGeo = new Set();
  gltf.scene.traverse((o) => {
    if (o.geometry && !seenGeo.has(o.geometry)) {
      seenGeo.add(o.geometry);
      try { o.geometry.dispose(); } catch (_) {}
    }
    if (!o.material) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of arr) {
      if (!m || seenMats.has(m)) continue;
      seenMats.add(m);
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
        const t = m[slot];
        if (t && !seenTex.has(t)) { seenTex.add(t); try { t.dispose(); } catch (_) {} }
      }
      try { m.dispose(); } catch (_) {}
    }
  });
  GLTF_CACHE[key] = null;
  delete GLTF_CACHE[key];
  return true;
}

/**
 * Return the animation clips for a cached GLTF, or empty array.
 * Use with THREE.AnimationMixer to drive idle/walk/attack on enemies.
 */
export function getClips(key) {
  // KayKit skeleton character meshes ship WITHOUT embedded clips — the clips
  // live in the two shared Rig_Medium banks. Splice them in by name so the
  // enemy mixer path (enemies.js _makePooledMesh) drives them like any other
  // animated GLB. Clips are immutable data; sharing across mixers is safe.
  if (key && key.indexOf('skel_') === 0 && key !== 'skel_rig_general' && key !== 'skel_rig_move') {
    return getSkeletonClips();
  }
  const gltf = GLTF_CACHE[key];
  return (gltf && gltf.animations) ? gltf.animations : [];
}

let _skelClips = null;
/** Merged Rig_Medium animation clips (General + MovementBasic). Cached. */
export function getSkeletonClips() {
  if (_skelClips) return _skelClips;
  const g = GLTF_CACHE['skel_rig_general'];
  const m = GLTF_CACHE['skel_rig_move'];
  const out = [];
  if (g && g.animations) out.push(...g.animations);
  if (m && m.animations) out.push(...m.animations);
  if (out.length) _skelClips = out;          // only cache once populated
  return out;
}

/**
 * Pick a clip by fuzzy name match (case-insensitive substring). Used for
 * resilience against varying naming conventions (Idle vs idle vs CharacterIdle).
 */
export function findClip(clips, ...needles) {
  if (!clips || clips.length === 0) return null;
  for (const needle of needles) {
    const n = needle.toLowerCase();
    for (const c of clips) {
      if (c.name && c.name.toLowerCase().includes(n)) return c;
    }
  }
  return clips[0] || null;
}

/**
 * In-place material upgrade for a cloned GLTF scene: bumps Lambert/Phong to
 * MeshStandardMaterial so it reads scene.environment and looks PBR-correct.
 * Idempotent + cheap; safe to call on every spawn.
 */
const _upgradedCache = new WeakSet();

/**
 * Inject a view-space rim light term into a MeshStandardMaterial via onBeforeCompile.
 * Cheap fragment-level fake — bumps `outgoingLight` near grazing-angle pixels so
 * characters read against dark fog without needing real backlight.
 */
/**
 * Inject vertex-displacement animation onto a static-mesh material.
 * Used to fake leg/wing motion on Poly-by-Google bugs that have no skeleton.
 * Kinds:
 *   'crawl' — bottom verts sway in alternating phase along X (leg-shuffle)
 *   'flap'  — side verts oscillate Y opposite to each other (wing flap)
 *   'hover' — side verts rapid Y micro-jitter (wing buzz)
 *   'inch'  — body verts squash-wave along X (worm crawl)
 */
function _injectVertAnim(mat, kind) {
  if (!mat || mat.userData._vertAnimKind === kind) return;
  mat.userData._vertAnimKind = kind;
  const prior = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prior) prior(shader);
    shader.uniforms.vertTime = { value: 0 };
    shader.uniforms.vertAmp  = { value: 1.0 };
    let displaceSnippet = '';
    switch (kind) {
      case 'crawl':
        displaceSnippet = `
          float legMask = smoothstep(0.5, -0.5, position.y);
          float wave = sin(vertTime * 18.0 + position.x * 6.0);
          transformed.x += wave * 0.10 * legMask * vertAmp;
          transformed.z += sin(vertTime * 18.0 + position.z * 6.0) * 0.06 * legMask * vertAmp;
        `;
        break;
      case 'flap':
        displaceSnippet = `
          float wingMask = smoothstep(0.15, 0.8, abs(position.x));
          float flap = sin(vertTime * 22.0);
          transformed.y += flap * sign(position.x) * 0.45 * wingMask * vertAmp;
        `;
        break;
      case 'hover':
        displaceSnippet = `
          float wingMask = smoothstep(0.1, 0.6, abs(position.x));
          float buzz = sin(vertTime * 80.0);
          transformed.y += buzz * sign(position.x) * 0.10 * wingMask * vertAmp;
        `;
        break;
      case 'inch':
        displaceSnippet = `
          float bodyMask = 1.0 - smoothstep(0.5, 1.0, abs(position.y));
          float pulse = sin(vertTime * 6.0 + position.x * 4.0);
          transformed.x += pulse * 0.08 * bodyMask * vertAmp;
          transformed.y += sin(vertTime * 6.0) * 0.04 * bodyMask * vertAmp;
        `;
        break;
      default:
        return;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float vertTime;\nuniform float vertAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${displaceSnippet}`);
    mat.userData._vertAnimShader = shader;
  };
  mat.needsUpdate = true;
}

/**
 * iter 33p — collapse non-skinned child Mesh primitives that share a source
 * material into a single merged Mesh per material. Cuts draw calls + scene-
 * graph traversal cost for GLBs authored as many small primitives (Wolf has
 * 21 prims / 4 materials → 4 draws/instance instead of 21).
 *
 * Safe to call on cloned scenes only. Bails if any SkinnedMesh is present
 * (bone-aware merging is a different problem). Returns count of primitives
 * collapsed; 0 means no-op.
 */
export function collapseStaticMeshes(root) {
  if (!root) return 0;
  let hasSkin = false;
  root.traverse((o) => { if (o.isSkinnedMesh) hasSkin = true; });
  if (hasSkin) return 0;

  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  // Bucket meshes by source material UUID. Each bucket merges to one Mesh.
  const buckets = new Map();
  const candidates = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    if (!o.geometry || !o.material) return;
    if (Array.isArray(o.material)) return;
    candidates.push(o);
  });
  if (candidates.length < 2) return 0;

  for (const o of candidates) {
    const mat = o.material;
    const geo = o.geometry.clone();
    const toRootLocal = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    geo.applyMatrix4(toRootLocal);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    let b = buckets.get(mat.uuid);
    if (!b) { b = { mat, geoms: [], originals: [] }; buckets.set(mat.uuid, b); }
    b.geoms.push(geo);
    b.originals.push(o);
  }

  let collapsed = 0;
  for (const { mat, geoms, originals } of buckets.values()) {
    if (geoms.length < 2) { for (const g of geoms) g.dispose(); continue; }
    let mergedGeo;
    try { mergedGeo = mergeGeometries(geoms, false); }
    catch (e) { mergedGeo = null; }
    if (!mergedGeo) {
      for (const g of geoms) g.dispose();
      continue;
    }
    for (const o of originals) {
      if (o.parent) o.parent.remove(o);
      if (o.geometry && o.geometry !== mergedGeo) o.geometry.dispose();
    }
    for (const g of geoms) if (g !== mergedGeo) g.dispose();
    const m = new THREE.Mesh(mergedGeo, mat);
    m.name = '_collapsed_' + originals[0].name;
    m.castShadow = false;
    m.receiveShadow = false;
    root.add(m);
    collapsed += originals.length;
  }
  return collapsed;
}

/**
 * Recursively flag every material on `root` for vert anim, and return the
 * list of materials so the per-frame updater can mutate uniforms.
 */
export function injectVertAnim(root, kind) {
  const mats = [];
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of arr) {
      _injectVertAnim(m, kind);
      mats.push(m);
    }
  });
  return mats;
}

function _injectRim(mat) {
  if (!mat || mat.userData._rimInjected) return;
  mat.userData._rimInjected = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(0xaaccff) };
    shader.uniforms.rimPower = { value: 2.4 };
    shader.uniforms.rimStrength = { value: 0.35 };
    shader.fragmentShader =
      'uniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimStrength;\n' +
      shader.fragmentShader;
    // Try both: newer three.js uses <opaque_fragment>, older <output_fragment>
    const rimSnippet =
      'float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), rimPower);\n' +
      'outgoingLight += rimColor * rim * rimStrength;\n';
    if (shader.fragmentShader.includes('#include <opaque_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        rimSnippet + '#include <opaque_fragment>',
      );
    } else if (shader.fragmentShader.includes('#include <output_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        rimSnippet + '#include <output_fragment>',
      );
    }
  };
}
export function upgradeMaterials(root, envMapIntensity = 0.55, roughness = null) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (_upgradedCache.has(m)) continue;
      _upgradedCache.add(m);
      if (m.isMeshStandardMaterial) {
        m.envMapIntensity = envMapIntensity;
        if (roughness !== null) m.roughness = roughness;
        _injectRim(m);
        m.needsUpdate = true;
        continue;
      }
      // Upgrade Lambert/Phong/Basic → Standard, preserving color & map
      if (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial) {
        const upgraded = new THREE.MeshStandardMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          map: m.map || null,
          metalness: 0.05,
          roughness: roughness !== null ? roughness : 0.85,
          emissive: (m.emissive ? m.emissive.clone() : new THREE.Color(0x000000)),
          emissiveIntensity: m.emissiveIntensity || 0,
          envMapIntensity,
          transparent: !!m.transparent,
          opacity: m.opacity !== undefined ? m.opacity : 1,
        });
        _injectRim(upgraded);
        upgraded.needsUpdate = true;
        if (Array.isArray(o.material)) o.material[i] = upgraded;
        else o.material = upgraded;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiered preload (hotfix #151, 2026-05-18) — splits the previous all-at-boot
// preloadAll into:
//   Tier 1 preloadEssential()  — hero/avatar carousel + XP gem + orbital weapon
//                                meshes. Blocks first paint.
//   Tier 2 preloadStage(id)    — enemy roster + stage-specific decor kits.
//                                Awaited at run-start before world spawns.
//   Tier 3 preloadTown()       — town district kits, lazy on enter
//        preloadCasino()       — casino building/chip/dice, lazy on enter
//        preloadHomeDecor()    — H-overlay furniture set, lazy on enter
//
// Each tier resolves a Promise.all over its _preload([k, p]) pairs. _preload
// itself is idempotent across re-calls (the loader callback is one-shot per
// key, and Tier 2/3 wrappers below skip already-cached entries). Caches are
// SHARED — Tier 1 loading 'cheese' once is enough for the whole session.
// ─────────────────────────────────────────────────────────────────────────────

// Skip keys already cached or in flight. Used by all tier helpers so repeat
// calls (e.g. preloadStage('forest') after a return-to-menu) are no-ops.
function _loadPairs(pairs) {
  return Promise.all(pairs.map(([k, p]) => {
    if (GLTF_CACHE[k]) return Promise.resolve(true);
    return lazyLoadGLTF(k, p);
  }));
}

/**
 * Tier 1 — boot path. Hero donor + per-avatar overrides + XP gem + orbital
 * weapon meshes. Particle textures + fxAwait stay in main.js because they're
 * synchronous or non-GLB. Anything else is deferred to Tier 2/3.
 *
 * Note on the 'hero' donor: tower-castle-plain.glb is ~15 MB and is only
 * used as the fallback mesh for AVATARS entries with `glb: null` — namely
 * `kitty` (default), `rune_kitten`, `mire_kitten`, `shroud_kitten`. We keep
 * it in Tier 1 because the carousel previews those avatars at boot via
 * `cloneCached('hero')`. A smaller-donor swap would change the default
 * kitty's silhouette → out of scope for a pure preload-tier refactor.
 * Tracked in HANDOFF: "hero donor is 15 MB, four avatars depend on it."
 */
export function preloadEssential() {
  const avatarOverrides = (AVATARS || [])
    .filter(a => a && a.glb)
    .map(a => [`hero_${a.id}`, BASE + a.glb]);
  const pairs = [
    ['hero', BASE + HERO.glb],
    ...avatarOverrides,
    // XP gem mesh — initXP() at boot reads GLTF_CACHE.cheese; cylinder
    // fallback exists but the cheese block reads as the canonical pickup.
    ['cheese', 'assets/food/cheese.glb'],
    // Orbital weapon meshes — acquired at boot via acquireWeapon('orbitals').
    // Primitives fallback exists but the GLB is the polished art.
    ['burger',     'assets/food/Cheeseburger.glb'],
    ['burger_evo', 'assets/food/Double Cheeseburger.glb'],
  ];
  return _loadPairs(pairs);
}

// Shared mob roster — every stage's spawn director pulls from ENEMY_TIERS,
// so the full enemy set has to be loaded before the run starts regardless
// of stage. (spawnDirector.js filters only on tier.minD vs difficulty D —
// no stage-keyed enemy filter exists.)
const _CORE_MOB_PAIRS = [
  ['zombie',   BASE + 'Mushnub.glb'],
  ['goblin',   BASE + 'Cactoro.glb'],
  ['skeleton', BASE + 'Goleling.glb'],
  ['orc',      BASE + 'Orc-New.glb'],
  ['demon',    BASE + 'Demon-New.glb'],
  ['robot',    BASE + 'Goleling-Evolved.glb'],
  ['mech',     BASE + 'Yeti.glb'],
  ['xeno',     BASE + 'Blue-Demon.glb'],
  ['slime',    BASE + 'Pink-Slime.glb'],
  ['giant',    BASE + 'Mushroom-King.glb'],
  ['dragon',   BASE + 'Dragon-New.glb'],
  ['wizard',   BASE + 'Wizard.glb'],
  ['ghost',    BASE + 'Ghost.glb'],
  ['spider',   BASE + 'Spider.glb'],
  ['wolf',     BASE + 'Wolf.glb'],
  ['dragon_evo', BASE + 'Dragon-Evolved.glb'],
];

// Forest bugs — only spawn on forest stage per the wave-spawn semantics in
// spawnDirector.js (D-gated, but bug tiers have low minD so they appear
// only in the early-difficulty pool which lines up with forest gameplay).
const _FOREST_BUG_PAIRS = [
  ['ant',         BASE + 'Ant.glb'],
  ['beetle',      BASE + 'Beetle.glb'],
  ['ladybug',     BASE + 'Ladybug.glb'],
  ['grasshopper', BASE + 'Grasshopper.glb'],
  ['cockroach',   BASE + 'Cockroach.glb'],
  ['mantis',      BASE + 'Mantis.glb'],
  ['wasp',        BASE + 'Wasp.glb'],
  ['bee',         BASE + 'Bee.glb'],
  ['butterfly',   BASE + 'Butterfly.glb'],
  ['caterpillar', BASE + 'Caterpillar.glb'],
];

// Env props — chests + scatter rocks/trees/bushes. Used by every stage's
// arenaDecor + the in-run chest spawner. Loaded with every stage.
const _ENV_PROP_PAIRS = [
  ['rock',     BASE + 'Rock.glb'],
  ['tree',     BASE + 'Tree.glb'],
  ['bush',     BASE + 'Bush.glb'],
  ['dead_tree',BASE + 'Dead Tree.glb'],
  ['chest',    BASE + 'chest.glb'],
  ['chest_open', BASE + 'chest_open.glb'],
];

// Dungeon kits — Kay Lousberg crypts/pillars/bones. Used by:
//   - arenaDecor._buildVoidDecor for the void stage's pillar/bone ring
//   - catacomb.js for the catacomb sub-mode chamber (entered via E on
//     overworld stairs). buildCatacomb runs at boot for the entrance, but
//     the chamber interior gracefully renders sparse without these kits.
// Loaded for void stage; sparse-chamber trade-off documented.
const _DUNGEON_KIT_PAIRS = [
  ['kit_arch',         'assets/kits/dungeon/arch.glb'],
  ['kit_pillar',       'assets/kits/dungeon/pillar.glb'],
  ['kit_pillar2',      'assets/kits/dungeon/pillar_alt.glb'],
  ['kit_pillar_broken','assets/kits/dungeon/pillar_broken.glb'],
  ['kit_coffin',       'assets/kits/dungeon/coffin.glb'],
  ['kit_crypt',        'assets/kits/dungeon/crypt.glb'],
  ['kit_bone1',        'assets/kits/dungeon/bone1.glb'],
  ['kit_bone2',        'assets/kits/dungeon/bone2.glb'],
  ['kit_bone3',        'assets/kits/dungeon/bone3.glb'],
  // Torches — used by catacomb.js chamber. Also referenced by twilight
  // ruins decor; loaded with void since catacomb is the heavier consumer.
  ['kit_torch_wall',   'assets/kits/torches/torch_wall.glb'],
  ['kit_torch_stand',  'assets/kits/torches/torch_stand.glb'],
];

// Twilight ruins kits — gravestones. Loaded only on twilight stage.
const _TWILIGHT_KIT_PAIRS = [
  ['kit_grave',     'assets/kits/ruins/damaged_grave.glb'],
  ['kit_gravestone','assets/kits/ruins/gravestone.glb'],
  ['kit_gravestone2','assets/kits/ruins/gravestone_alt.glb'],
];

// ── KayKit imports (scripts/fetch-kaykit.sh) ────────────────────────────────
// Forest Nature accents — curated trees/bushes/rocks scattered as InstancedMesh
// accents ON TOP of the procedural tree field (arenaDecor.js). Loaded on forest.
const _FOREST_ACCENT_PAIRS = [
  ['kkf_tree1',      'assets/kits/forest/Tree_1_A.glb'],
  ['kkf_tree2',      'assets/kits/forest/Tree_2_A.glb'],
  ['kkf_tree3',      'assets/kits/forest/Tree_2_C.glb'],
  ['kkf_tree4',      'assets/kits/forest/Tree_3_A.glb'],
  ['kkf_tree5',      'assets/kits/forest/Tree_4_A.glb'],
  ['kkf_tree_bare1', 'assets/kits/forest/Tree_Bare_1_A.glb'],
  ['kkf_tree_bare2', 'assets/kits/forest/Tree_Bare_2_A.glb'],
  ['kkf_bush1',      'assets/kits/forest/Bush_1_A.glb'],
  ['kkf_bush2',      'assets/kits/forest/Bush_2_A.glb'],
  ['kkf_bush3',      'assets/kits/forest/Bush_4_A.glb'],
  ['kkf_rock1',      'assets/kits/forest/Rock_1_A.glb'],
  ['kkf_rock2',      'assets/kits/forest/Rock_1_E.glb'],
  ['kkf_rock3',      'assets/kits/forest/Rock_2_A.glb'],
  ['kkf_rock4',      'assets/kits/forest/Rock_3_A.glb'],
  ['kkf_rock5',      'assets/kits/forest/Rock_3_H.glb'],
];

// Dungeon Remastered — modular walls/floors/pillars/stairs + dressing props.
// Used by catacomb.js to build a real walled room instead of the bare box.
// Lazy-loaded on catacomb entry (preloadDungeonKit) since the catacomb is
// reachable from any stage, not just void.
const _KAYKIT_DUNGEON_PAIRS = [
  ['kkd_wall',           'assets/kits/dungeon/wall.glb'],
  ['kkd_wall_corner',    'assets/kits/dungeon/wall_corner.glb'],
  ['kkd_wall_corner_sm', 'assets/kits/dungeon/wall_corner_small.glb'],
  ['kkd_wall_doorway',   'assets/kits/dungeon/wall_doorway.glb'],
  ['kkd_wall_arched',    'assets/kits/dungeon/wall_arched.glb'],
  ['kkd_wall_broken',    'assets/kits/dungeon/wall_broken.glb'],
  ['kkd_wall_cracked',   'assets/kits/dungeon/wall_cracked.glb'],
  ['kkd_wall_window',    'assets/kits/dungeon/wall_window_open.glb'],
  ['kkd_wall_endcap',    'assets/kits/dungeon/wall_endcap.glb'],
  ['kkd_wall_half',      'assets/kits/dungeon/wall_half.glb'],
  ['kkd_wall_tsplit',    'assets/kits/dungeon/wall_Tsplit.glb'],
  ['kkd_wall_pillar',    'assets/kits/dungeon/wall_pillar.glb'],
  ['kkd_floor_large',    'assets/kits/dungeon/floor_tile_large.glb'],
  ['kkd_floor_small',    'assets/kits/dungeon/floor_tile_small.glb'],
  ['kkd_floor_dirt',     'assets/kits/dungeon/floor_dirt_large.glb'],
  ['kkd_floor_grate',    'assets/kits/dungeon/floor_tile_big_grate.glb'],
  ['kkd_floor_spikes',   'assets/kits/dungeon/floor_tile_big_spikes.glb'],
  ['kkd_pillar',         'assets/kits/dungeon/pillar_decorated.glb'],
  ['kkd_column',         'assets/kits/dungeon/column.glb'],
  ['kkd_stairs',         'assets/kits/dungeon/stairs.glb'],
  ['kkd_stairs_wide',    'assets/kits/dungeon/stairs_wide.glb'],
  ['kkd_barrel',         'assets/kits/dungeon/barrel_large.glb'],
  ['kkd_barrel_sm',      'assets/kits/dungeon/barrel_small.glb'],
  ['kkd_box',            'assets/kits/dungeon/box_large.glb'],
  ['kkd_crates',         'assets/kits/dungeon/crates_stacked.glb'],
  ['kkd_chest',          'assets/kits/dungeon/chest.glb'],
  ['kkd_chest_gold',     'assets/kits/dungeon/chest_gold.glb'],
  ['kkd_candle3',        'assets/kits/dungeon/candle_triple.glb'],
  ['kkd_candle',         'assets/kits/dungeon/candle_lit.glb'],
  ['kkd_coins',          'assets/kits/dungeon/coin_stack_large.glb'],
  ['kkd_keg',            'assets/kits/dungeon/keg.glb'],
  ['kkd_table',          'assets/kits/dungeon/table_medium.glb'],
  ['kkd_shelf',          'assets/kits/dungeon/shelf_large.glb'],
  ['kkd_rubble',         'assets/kits/dungeon/rubble_large.glb'],
  ['kkd_banner',         'assets/kits/dungeon/banner_thin_brown.glb'],
  ['kkd_sword_shield',   'assets/kits/dungeon/sword_shield.glb'],
];

// Skeletons — 4 rigged character meshes + 2 shared anim banks (Rig_Medium).
// Clips live in skel_rig_*; bind to a cloned char SkinnedMesh by bone name via
// an AnimationMixer. Used for animated elites + catacomb wave mobs (low counts
// only — skinned meshes are too heavy for the full horde). Lazy-loaded.
const _SKELETON_PAIRS = [
  ['skel_mage',        'assets/kits/skeletons/Skeleton_Mage.glb'],
  ['skel_minion',      'assets/kits/skeletons/Skeleton_Minion.glb'],
  ['skel_rogue',       'assets/kits/skeletons/Skeleton_Rogue.glb'],
  ['skel_warrior',     'assets/kits/skeletons/Skeleton_Warrior.glb'],
  ['skel_rig_general', 'assets/kits/skeletons/Rig_Medium_General.glb'],
  ['skel_rig_move',    'assets/kits/skeletons/Rig_Medium_MovementBasic.glb'],
];

/** Char-key list (excludes the anim-only rigs) for spawn-side variant picks. */
export const SKELETON_CHAR_KEYS = ['skel_mage', 'skel_minion', 'skel_rogue', 'skel_warrior'];

/**
 * Tier 2 — run-start. Loads enemy roster + props + stage-specific decor
 * before the world spawns. Idempotent across re-calls (already-cached
 * entries are skipped by _loadPairs). main.js awaits this before
 * rebuildHero / spawnArenaProps and re-runs prewarmPools after.
 *
 * Stage mapping (no explicit per-stage enemy filter exists in
 * spawnDirector.js — every tier with `minD <= D` is eligible, so every
 * stage gets the full core mob roster):
 *   - forest:   core mobs + forest bugs + env props
 *   - twilight: core mobs + env props + ruins kits
 *   - cinder:   core mobs + env props
 *   - void:     core mobs + env props + dungeon kits
 *   - any other id: defensive — load core mobs + env props
 */
export function preloadStage(stageId) {
  const pairs = [..._CORE_MOB_PAIRS, ..._ENV_PROP_PAIRS];
  switch (stageId) {
    case 'forest':
      pairs.push(..._FOREST_BUG_PAIRS);
      pairs.push(..._FOREST_ACCENT_PAIRS);
      break;
    case 'twilight':
      pairs.push(..._TWILIGHT_KIT_PAIRS);
      break;
    case 'cinder':
      // no stage-specific kits
      break;
    case 'void':
      pairs.push(..._DUNGEON_KIT_PAIRS);
      break;
    case 'cave':
      // P4A-cN cohorts add cave-specific GLBs here (stalactites, glowmoss
      // patches, sealed-door rune kits, gloomshrimp mesh). Cohort 1 ships
      // the skeleton only — no stage-unique assets yet, just the case-arm
      // so future cohorts have the hook ready.
      break;
    default:
      // unknown stage id — load conservative baseline only
      break;
  }
  return _loadPairs(pairs);
}

/**
 * Lazy — KayKit modular dungeon kit + animated skeletons. Awaited by
 * catacomb.js#enterCatacomb so the chamber builds with real walls/props and
 * spawns animated skeleton wave mobs. Reachable from any stage, so it can't
 * ride a fixed preloadStage arm. Idempotent (_loadPairs skips cached keys).
 */
export function preloadDungeonKit() {
  return _loadPairs([..._KAYKIT_DUNGEON_PAIRS, ..._SKELETON_PAIRS]);
}

/**
 * Lazy — just the skeleton meshes + anim rigs, for animated elites that can
 * appear outside the catacomb. Idempotent.
 */
export function preloadSkeletons() {
  return _loadPairs(_SKELETON_PAIRS);
}

/**
 * Tier 3 — town district. Six Quaternius house/keep/inn kits used by
 * town.js#buildTown. main.js's kkEnterTown wrapper awaits this before
 * buildTown(scene) + enterTown(). Idempotent.
 */
export function preloadTown() {
  return _loadPairs([
    ['kit_house',    'assets/kits/town/fantasy_house.glb'],
    ['kit_house2',   'assets/kits/town/town_house.glb'],
    ['kit_inn',      'assets/kits/town/fantasy_inn.glb'],
    ['kit_keep',     'assets/kits/town/tower_house.glb'],
    ['kit_gate',     'assets/kits/town/castle_gate.glb'],
    ['kit_barracks', 'assets/kits/town/fantasy_barracks.glb'],
  ]);
}

/**
 * Forest overworld buildings — the kingdom-district kits placed by
 * env.js#buildEnv (BUILDINGS[]). These are the town kits PLUS one dungeon ruin
 * pillar. buildEnv runs at boot BEFORE preloadStage/preloadTown, so without this
 * the forest's houses/keep/inn fall back to brown placeholder boxes.
 * Regressed by #151 (perf: tier preloadAll) which deferred the town kits to the
 * town-entry path; boot() must await this before buildEnv. Idempotent (reuses
 * preloadTown's cached entries; only kit_pillar_broken is new here).
 */
export function preloadForestBuildings() {
  return Promise.all([
    preloadTown(),
    _loadPairs([['kit_pillar_broken', 'assets/kits/dungeon/pillar_broken.glb']]),
  ]);
}

/**
 * Tier 3 — casino interior. Building + chip + dice GLBs used by both
 * town.js (Seedy Tent procedural prop) and casinoInterior.js (chip
 * scatter / dice prop). main.js wraps the casino interactable handler
 * to await this before enterCasinoInterior. Idempotent.
 */
export function preloadCasino() {
  return _loadPairs([
    ['casino_building', 'assets/casino/casino_building.glb'],
    ['casino_chip',     'assets/casino/poker_chip.glb'],
    ['casino_dice',     'assets/casino/dice.glb'],
  ]);
}

/**
 * Tier 3 — home decor catalog. 16 Quaternius furniture kits used by
 * homeDecor.js for the H-overlay Decorate mode. main.js's interior-enter
 * handler kicks this off in the background so the assets are ready by
 * the time the player presses H inside the interior. Idempotent.
 */
export function preloadHomeDecor() {
  return _loadPairs([
    ['home_rug',           'assets/kits/home/rug.glb'],
    ['home_plant',         'assets/kits/home/plant.glb'],
    ['home_lamp',          'assets/kits/home/lamp.glb'],
    ['home_bed',           'assets/kits/home/bed.glb'],
    ['home_bookshelf',     'assets/kits/home/bookshelf.glb'],
    ['home_cauldron',      'assets/kits/home/cauldron.glb'],
    ['home_chair',         'assets/kits/home/chair.glb'],
    ['home_side_table',    'assets/kits/home/side_table.glb'],
    ['home_sofa',          'assets/kits/home/sofa.glb'],
    ['home_cat',           'assets/kits/home/cat.glb'],
    ['home_chest',         'assets/kits/home/chest.glb'],
    ['home_banner_wall',   'assets/kits/home/banner_wall.glb'],
    ['home_banner_alt',    'assets/kits/home/banner_alt.glb'],
    ['home_sword_mount',   'assets/kits/home/sword_mount.glb'],
    ['home_shield_mount',  'assets/kits/home/shield_mount.glb'],
    ['home_skull_mount',   'assets/kits/home/skull_mount.glb'],
  ]);
}

/**
 * @deprecated Use preloadEssential() at boot and preloadStage()/preloadTown()
 * /preloadCasino()/preloadHomeDecor() at the appropriate entry points.
 * Kept as a thin wrapper for backward-compat with any external callers
 * (none in-tree at hotfix #151 time).
 */
export function preloadAll() {
  return preloadEssential();
}
