/**
 * Forest environment: ground plane + scattered scenery + lights + fog.
 * Trimmed from original game's buildCastleEnv() (line 4409). No destructibles,
 * no central tower platform — the hero IS the player, no fixed structure here.
 */
import * as THREE from 'three';
import { WORLD } from './config.js';
import { cloneCached } from './assets.js';

const SCATTER = [
  { key: 'tree',      count: 32, rMin: 30, rMax: 120, scale: [3.0, 5.5] },
  { key: 'dead_tree', count: 12, rMin: 30, rMax: 120, scale: [2.5, 4.5] },
  { key: 'rock',      count: 28, rMin: 20, rMax: 110, scale: [1.5, 3.5] },
  { key: 'bush',      count: 40, rMin: 15, rMax: 100, scale: [1.2, 2.8] },
];

export function buildEnv(scene) {
  const group = new THREE.Group();
  group.name = 'envGroup';

  // Forest ground (Poly Haven texture from original game's assets)
  const tex = new THREE.TextureLoader().load('assets/sprites/forest-ground.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.groundSize, WORLD.groundSize),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  group.add(ground);

  // Scatter scenery
  for (const def of SCATTER) {
    for (let i = 0; i < def.count; i++) {
      const clone = cloneCached(def.key);
      if (!clone) continue;
      const angle = Math.random() * Math.PI * 2;
      const r = def.rMin + Math.random() * (def.rMax - def.rMin);
      const sc = def.scale[0] + Math.random() * (def.scale[1] - def.scale[0]);
      clone.scale.setScalar(sc);
      clone.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      clone.rotation.y = Math.random() * Math.PI * 2;
      group.add(clone);
    }
  }

  // Lights
  const ambient = new THREE.AmbientLight(0x4d6e3a, 0.5);
  group.add(ambient);
  const hemi = new THREE.HemisphereLight(0x88ddaa, 0x223311, 0.6);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0cc, 1.4);
  sun.position.set(40, 60, 30);
  group.add(sun);
  const fill = new THREE.DirectionalLight(0x88ffaa, 0.25);
  fill.position.set(-30, 30, -30);
  group.add(fill);

  scene.add(group);
  return group;
}
