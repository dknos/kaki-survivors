/**
 * Sticky Web — drops a slow patch at hero position on cooldown.
 * Each web lasts ~5s and reduces enemy speed inside its radius.
 * Webs live in state.webs.list; enemies.js applies slow per-frame.
 * Visual: a single InstancedMesh of flat translucent discs (one draw call total).
 */
import * as THREE from 'three';
import { state } from '../state.js';
import { tex } from '../particleTextures.js';

const WEB_CAP = 24;
const WEB_Y = 0.05;

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _flatX = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const _zeroScale = new THREE.Vector3(0, 0, 0);

let _inst = null;
let _dirty = false;

function _ensureMesh() {
  if (_inst) return;
  // Textured square plane → woven web sprite (radial spokes + concentric strands)
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex('webBraid'),
    color: 0xddffff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  _inst = new THREE.InstancedMesh(geo, mat, WEB_CAP);
  _inst.count = WEB_CAP;
  _inst.frustumCulled = false;
  _inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < WEB_CAP; i++) {
    _m4.compose(_v3.set(0, -1000, 0), _flatX, _zeroScale);
    _inst.setMatrixAt(i, _m4);
  }
  _inst.instanceMatrix.needsUpdate = true;
  state.scene.add(_inst);
}

function _writeWebMatrix(i, web) {
  const k = web.ttl / web.life; // 1..0 over lifetime
  const r = web.radius * (0.6 + 0.4 * k);
  _v3.set(web.x, WEB_Y, web.z);
  _m4.compose(_v3, _flatX, new THREE.Vector3(r, r, r));
  _inst.setMatrixAt(i, _m4);
}

function _hide(i) {
  _m4.compose(_v3.set(0, -1000, 0), _flatX, _zeroScale);
  _inst.setMatrixAt(i, _m4);
}

export function tickWebs(dt) {
  _ensureMesh();
  const list = state.webs.list;
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (w.ttl <= 0) continue;
    w.ttl -= dt;
    if (w.ttl <= 0) {
      _hide(i);
      _dirty = true;
      continue;
    }
    _writeWebMatrix(i, w);
    _dirty = true;
  }
  // Compact dead entries off the front so list doesn't grow unbounded
  while (list.length > 0 && list[0].ttl <= 0) list.shift();
  if (_dirty) { _inst.instanceMatrix.needsUpdate = true; _dirty = false; }
}

function _spawnWeb(x, z, level, evolved) {
  _ensureMesh();
  const list = state.webs.list;
  // Cap; oldest auto-falls off via shift in tickWebs, but also keep <= WEB_CAP
  if (list.length >= WEB_CAP) list.shift();
  const radiusMul = evolved ? 1.5 : 1;
  const durationMul = evolved ? 1.5 : 1;
  const slowMul = evolved ? level.slowMul * 0.7 : level.slowMul;   // sharper slow
  list.push({
    x, z,
    radius: level.radius * (state.hero.statMul.area || 1) * radiusMul,
    ttl: level.duration * (state.hero.statMul.duration || 1) * durationMul,
    life: level.duration * (state.hero.statMul.duration || 1) * durationMul,
    slowMul,
  });
}

export default {
  id: 'web',
  name: 'Sticky Web',
  desc: 'Drops slowing webs at your feet',
  icon: '🕸',
  maxLevel: 8,
  levels: [
    { cooldown: 3.5, duration: 5.0, radius: 3.5, slowMul: 0.50 },
    { cooldown: 3.2, duration: 5.0, radius: 3.8, slowMul: 0.45 },
    { cooldown: 3.0, duration: 5.5, radius: 4.0, slowMul: 0.42 },
    { cooldown: 2.7, duration: 5.5, radius: 4.3, slowMul: 0.38 },
    { cooldown: 2.5, duration: 6.0, radius: 4.6, slowMul: 0.35 },
    { cooldown: 2.2, duration: 6.0, radius: 4.9, slowMul: 0.32 },
    { cooldown: 2.0, duration: 6.5, radius: 5.2, slowMul: 0.28 },
    { cooldown: 1.7, duration: 7.0, radius: 5.6, slowMul: 0.25 },
  ],

  init(state, level, inst) { inst.cd = 0.4; },

  tick(state, dt, level, inst) {
    if (inst.cd === undefined) inst.cd = 0;
    inst.cd -= dt;
    if (inst.cd > 0) return;
    const h = state.hero.pos;
    _spawnWeb(h.x, h.z, level, !!inst.evolved);
    inst.cd = level.cooldown * (state.hero.statMul.cooldown || 1) * (inst.evolved ? 0.7 : 1);
  },

  refresh(state, level, inst) {
    if (inst.cd > level.cooldown * 0.5) inst.cd = level.cooldown * 0.25;
  },
};
