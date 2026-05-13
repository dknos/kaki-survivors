/**
 * Lightweight FX: kill rings (expanding/fading torus on enemy death) and
 * magnet sparks (small upward darts when a gem locks on).
 *
 * Single InstancedMesh per FX type so this stays 2 draw calls regardless of count.
 */
import * as THREE from 'three';
import { state } from './state.js';
import { tex } from './particleTextures.js';
import { BLOOM_LAYER } from './postfx.js';

const RING_CAP = 64;
const SPARK_CAP = 64;

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q  = new THREE.Quaternion();
const _flatX = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const _zeroScale = new THREE.Vector3(0, 0, 0);

let _ringInst = null;
let _sparkInst = null;
let _pickupRing = null;
const _sparkColor = new THREE.Color();

const _rings = []; // {x,z,t,life,baseScale, eliteColor}
const _sparks = []; // {x,y,z,t,life}

let _ringDirty = false;
let _sparkDirty = false;

export function initFX(scene) {
  // Kill ring — textured plane, lying flat on the ground plane (rotated)
  const ringGeo = new THREE.PlaneGeometry(2.0, 2.0);
  const ringTex = tex('ringGold');
  const ringMat = new THREE.MeshBasicMaterial({
    map: ringTex,
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _ringInst = new THREE.InstancedMesh(ringGeo, ringMat, RING_CAP);
  _ringInst.count = RING_CAP;
  _ringInst.frustumCulled = false;
  _ringInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < RING_CAP; i++) {
    _m4.compose(_v3.set(0, -1000, 0), _flatX, _zeroScale);
    _ringInst.setMatrixAt(i, _m4);
  }
  _ringInst.instanceMatrix.needsUpdate = true;
  _ringInst.layers.enable(BLOOM_LAYER);
  scene.add(_ringInst);

  // Magnet spark — textured billboard sparkle
  const sparkGeo = new THREE.PlaneGeometry(0.6, 0.6);
  const sparkMat = new THREE.MeshBasicMaterial({
    map: tex('sparkCyan'),
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARK_CAP);
  _sparkInst.count = SPARK_CAP;
  _sparkInst.frustumCulled = false;
  _sparkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Sparks face camera (we'll set rotation to face -Y axis from above)
  // For ortho iso, sprites laid flat read fine — orient like the ring (XZ plane)
  for (let i = 0; i < SPARK_CAP; i++) {
    _m4.compose(_v3.set(0, -1000, 0), _flatX, _zeroScale);
    _sparkInst.setMatrixAt(i, _m4);
  }
  _sparkInst.instanceMatrix.needsUpdate = true;
  _sparkInst.layers.enable(BLOOM_LAYER);
  scene.add(_sparkInst);

  // Per-instance color attribute so spawnMagnetSpark can spawn gold variants too.
  _sparkInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_CAP * 3), 3);
  _sparkInst.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const defaultSparkColor = new THREE.Color(0x44ffcc);
  for (let i = 0; i < SPARK_CAP; i++) _sparkInst.setColorAt(i, defaultSparkColor);
  _sparkInst.instanceColor.needsUpdate = true;

  // Persistent pickup-radius ring under the hero — thin cyan ring on the ground.
  const pickupRingTex = tex('ringCyan');
  const pickupGeo = new THREE.PlaneGeometry(1, 1);
  const pickupMat = new THREE.MeshBasicMaterial({
    map: pickupRingTex,
    color: 0x44ffcc,
    transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  _pickupRing = new THREE.Mesh(pickupGeo, pickupMat);
  _pickupRing.quaternion.copy(_flatX);
  _pickupRing.position.y = 0.04;
  _pickupRing.renderOrder = -1;
  scene.add(_pickupRing);
}

export function updatePickupRing() {
  if (!_pickupRing) return;
  const h = state.hero;
  if (!h || !h.pos) return;
  const r = (h.statMul.magnet || 1) * 4.0 * 2.4;   // pickupRadius * attract mul ~= ring footprint
  _pickupRing.position.x = h.pos.x;
  _pickupRing.position.z = h.pos.z;
  _pickupRing.scale.set(r, r, r);
}

/** Pop a kill ring at world (x,z). elite scales it up. */
export function spawnKillRing(x, z, elite = false) {
  if (_rings.length >= RING_CAP) _rings.shift();
  _rings.push({
    x, z, t: 0,
    life: elite ? 0.55 : 0.35,
    baseScale: elite ? 1.6 : 0.9,
  });
}

/** Pop a magnet spark at world position. `color` is hex; default cyan. */
export function spawnMagnetSpark(x, y, z, color = 0x44ffcc) {
  if (_sparks.length >= SPARK_CAP) _sparks.shift();
  _sparks.push({ x, y, z, t: 0, life: 0.35, color });
}

export function updateFX(dt) {
  // Rings
  for (let i = 0; i < _rings.length; i++) {
    const r = _rings[i];
    r.t += dt;
    const k = r.t / r.life;
    if (k >= 1) {
      _m4.compose(_v3.set(0, -1000, 0), _flatX, _zeroScale);
      _ringInst.setMatrixAt(i, _m4);
      _ringDirty = true;
    } else {
      const s = r.baseScale * (0.3 + k * 3.2);
      _v3.set(r.x, 0.08, r.z);
      _m4.compose(_v3, _flatX, new THREE.Vector3(s, s, s));
      _ringInst.setMatrixAt(i, _m4);
      _ringDirty = true;
    }
  }
  // Drop dead rings from front (rare, since we shift on add)
  while (_rings.length > 0 && _rings[0].t >= _rings[0].life) _rings.shift();

  // Sparks
  for (let i = 0; i < _sparks.length; i++) {
    const sp = _sparks[i];
    sp.t += dt;
    const k = sp.t / sp.life;
    if (k >= 1) {
      _m4.compose(_v3.set(0, -1000, 0), _q.identity(), _zeroScale);
      _sparkInst.setMatrixAt(i, _m4);
      _sparkDirty = true;
    } else {
      const rise = k * 1.2;
      const s = (1 - k) * 1.5; // sprite scale multiplier — start bigger than 1 unit
      _v3.set(sp.x, sp.y + rise, sp.z);
      _m4.compose(_v3, _flatX, new THREE.Vector3(s, s, s));
      _sparkInst.setMatrixAt(i, _m4);
      _sparkInst.setColorAt(i, _sparkColor.setHex(sp.color || 0x44ffcc));
      _sparkDirty = true;
    }
  }
  while (_sparks.length > 0 && _sparks[0].t >= _sparks[0].life) _sparks.shift();

  if (_ringDirty)  { _ringInst.instanceMatrix.needsUpdate = true; _ringDirty = false; }
  if (_sparkDirty) {
    _sparkInst.instanceMatrix.needsUpdate = true;
    if (_sparkInst.instanceColor) _sparkInst.instanceColor.needsUpdate = true;
    _sparkDirty = false;
  }
}
