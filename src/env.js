/**
 * Forest environment: ground plane + scattered scenery + lights + fog.
 * Trimmed from original game's buildCastleEnv() (line 4409). No destructibles,
 * no central tower platform — the hero IS the player, no fixed structure here.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { WORLD } from './config.js';
import { cloneCached } from './assets.js';

// Base scatter (always present)
const SCATTER = [
  { key: 'tree',      count: 140, rMin: 30, rMax: 380, scale: [3.0, 5.5] },
  { key: 'dead_tree', count: 60,  rMin: 30, rMax: 380, scale: [2.5, 4.5] },
  { key: 'rock',      count: 110, rMin: 20, rMax: 360, scale: [1.5, 3.5] },
  { key: 'bush',      count: 180, rMin: 15, rMax: 340, scale: [1.2, 2.8] },
];
// Twilight-only scatter — dead trees + rocks layered in for a sparser,
// gnarlier silhouette. Hidden until the player picks the Twilight stage.
const SCATTER_TWILIGHT = [
  { key: 'dead_tree', count: 80, rMin: 26, rMax: 380, scale: [2.8, 5.0] },
  { key: 'rock',      count: 60, rMin: 20, rMax: 360, scale: [2.0, 4.0] },
];

export function buildEnv(scene, renderer) {
  const group = new THREE.Group();
  group.name = 'envGroup';

  // ── HDRI environment ──
  // Provides soft ambient reflections + light directionality for all PBR materials.
  // Doesn't override scene.background (we keep the dark fog color), only `environment`.
  new RGBELoader().load('assets/sprites/hdri/approaching_storm_1k.hdr', (hdrTex) => {
    hdrTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdrTex;
    // Re-walk env meshes to set envMapIntensity for any standard materials
    group.traverse(o => {
      if (o.isMesh && o.material && 'envMapIntensity' in o.material) {
        o.material.envMapIntensity = 0.70;
        o.material.needsUpdate = true;
      }
    });
  });

  // ── PBR ground: Poly Haven forrest_ground_01 (CC0) ──
  // diff + rough + normal at 1k. Heavy tiling (180×180) means 1k = plenty.
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  const repeat = 180;

  function prepTex(t, srgb) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = Math.min(maxAniso, 8);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Stage-keyed texture packs. Forest = default; Twilight = brown_mud (CC0
   // Poly Haven). Pre-loaded so swaps are instant when the player picks a stage.
  function loadPack(base) {
    return {
      diff:   prepTex(loader.load(base + 'diff.jpg',   t => t.needsUpdate = true), true),
      rough:  prepTex(loader.load(base + 'rough.jpg',  t => t.needsUpdate = true), false),
      normal: prepTex(loader.load(base + 'nor_gl.jpg', t => t.needsUpdate = true), false),
    };
  }
  const groundPacks = {
    forest:   loadPack('assets/sprites/forrest_ground_01/'),
    twilight: loadPack('assets/sprites/brown_mud/'),
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.groundSize, WORLD.groundSize, 1, 1),
    new THREE.MeshStandardMaterial({
      map: groundPacks.forest.diff,
      roughnessMap: groundPacks.forest.rough,
      normalMap: groundPacks.forest.normal,
      roughness: 0.95,
      metalness: 0.0,
      normalScale: new THREE.Vector2(0.6, 0.6),
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  group.add(ground);

  // Scatter scenery. Forest props are always visible; twilight-only props
  // are flagged so applyStageTint can toggle them.
  const forestProps = [];   // visible only in forest stage (live trees + bushes)
  const twilightProps = []; // visible only in twilight (extra dead trees + rocks)
  function scatterInto(defs, tag) {
    for (const def of defs) {
      for (let i = 0; i < def.count; i++) {
        const clone = cloneCached(def.key);
        if (!clone) continue;
        const angle = Math.random() * Math.PI * 2;
        const r = def.rMin + Math.random() * (def.rMax - def.rMin);
        const sc = def.scale[0] + Math.random() * (def.scale[1] - def.scale[0]);
        clone.scale.setScalar(sc);
        clone.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        clone.rotation.y = Math.random() * Math.PI * 2;
        clone.userData._stageTag = tag;
        clone.userData._kkBaseColor = null; // lazily captured on first tint
        group.add(clone);
        if (tag === 'forestOnly')   forestProps.push(clone);
        if (tag === 'twilightOnly') { twilightProps.push(clone); clone.visible = false; }
      }
    }
  }
  // Tag live trees + bushes as forest-only so they hide in Twilight (gives the
  // hollow a sparser, deader silhouette). Rocks + the base dead_tree set stay
  // visible in both stages.
  scatterInto([SCATTER[0], SCATTER[3]], 'forestOnly');    // tree + bush
  scatterInto([SCATTER[1], SCATTER[2]], 'shared');        // dead_tree + rock
  scatterInto(SCATTER_TWILIGHT, 'twilightOnly');

  // Cinematic 3-light setup: warm key + cool fill + sky hemi. HDRI fills ambient.
  // Dropped raw AmbientLight (HDRI environment provides it already).
  const hemi = new THREE.HemisphereLight(0xaaccff, 0x223322, 0.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe4b8, 2.2);    // warm key
  sun.position.set(60, 80, 40);
  // Soft shadow casting — only the sun casts. Camera frustum sized to a 60u
  // box around the action area so we don't waste shadow-map texels.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;          // PCFSoftShadow blur radius
  const sc = sun.shadow.camera;
  sc.near = 0.5; sc.far = 200;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
  sc.updateProjectionMatrix();
  // Make the shadow camera follow the hero — set up a target the engine
  // re-points each frame from main.js.
  sun.target.position.set(0, 0, 0);
  group.add(sun.target);
  group.add(sun);
  const fill = new THREE.DirectionalLight(0x5577aa, 0.25);  // cool fill
  fill.position.set(-30, 30, -30);
  group.add(fill);

  scene.add(group);
  // Stash the sun on the group so main.js can re-point it each frame.
  group.userData.sun = sun;
  // Stash the ground mesh + scene ref so applyStageTint can recolor on demand.
  group.userData.ground = ground;
  group.userData.scene = scene;
  group.userData.baseFogColor = scene.fog ? scene.fog.color.getHex() : null;
  group.userData.applyStageTint = (stage) => {
    if (!stage) return;
    const id = stage.id;
    const isForest   = id === 'forest';
    const isTwilight = id === 'twilight';
    const isCinder   = id === 'cinder';
    // Ground pack: forest uses its own; twilight and cinder share brown_mud
    // (cinder gets a much hotter color tint on top so it reads as basalt/clay).
    const packKey = isForest ? 'forest' : 'twilight';
    const pack = groundPacks[packKey];
    if (ground.material) {
      ground.material.map         = pack.diff;
      ground.material.roughnessMap= pack.rough;
      ground.material.normalMap   = pack.normal;
      const tint = stage.groundTint || 0xffffff;
      if (ground.material.color) ground.material.color.setHex(tint);
      // Cinder reads better at slightly higher roughness so highlights don't
      // smear over the hot fog.
      ground.material.roughness = isCinder ? 1.0 : 0.95;
      ground.material.needsUpdate = true;
    }
    if (scene.fog && scene.fog.color) {
      scene.fog.color.setHex(stage.fogColor || group.userData.baseFogColor || 0x061008);
    }
    // Live forest props (trees + bushes) appear only in the forest stage —
    // twilight and cinder both want a sparser, harsher silhouette.
    for (const p of forestProps)   p.visible = isForest;
    // Twilight's extra dead trees + rocks appear in BOTH twilight and cinder:
    // a charred ex-forest reads as cinder's natural ancestor.
    for (const p of twilightProps) p.visible = isTwilight || isCinder;
  };
  return group;
}
