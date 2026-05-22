/**
 * Kitty Kaki Survivors — Main Menu hero splash (Iter 37).
 *
 * Replaces the static SVG silhouette on the title screen with the REAL hero
 * model — the same GLB the in-game hero and the Heroes-tab carousel render
 * (cloneCached('hero'), tinted/scaled per selected avatar) — slow-rotating on
 * an alpha canvas. Decorative only: pointer-events:none, no interaction.
 *
 * Self-contained, mirrors charCarousel.js's renderer + disposal discipline:
 *   - clone materials BEFORE tinting; dispose ONLY those clones on teardown.
 *     The cached GLTF (geometry + original materials) is shared with the
 *     in-game hero render — never mutate or dispose it.
 *   - RO-deferred sizing: the host (.kkv2-hero) is built detached and sized
 *     by its parent AFTER this returns, so clientWidth is 0 at init. The first
 *     ResizeObserver fire (when real dimensions land) sets renderer size and
 *     starts the RAF.
 *
 * Returns a { destroy } handle, or null when the hero GLTF isn't cached yet —
 * in which case the caller keeps the SVG silhouette as a graceful fallback.
 */
import * as THREE from 'three';
import { cloneCached } from './assets.js';

// Match charCarousel's preview scale (NOT HERO.targetHeight=3.6, which is the
// in-world scale relative to enemies — far too large at this camera distance).
const TARGET_HEIGHT = 1.4;
const SPIN_RATE = 0.45;   // gentle turntable, rad/s

/**
 * @param {HTMLElement} host - mount target (.kkv2-hero)
 * @param {Object} opts
 * @param {string} [opts.avatarId]
 * @param {number} [opts.tint]      - avatar tint (multiplied into material color)
 * @param {number} [opts.scaleMul]  - avatar scale multiplier
 * @param {string} [opts.glb]       - avatar's dedicated GLB filename, if any
 * @returns {{destroy:()=>void}|null}
 */
export function createHeroSplash(host, opts = {}) {
  if (!host) return null;
  const avatarId = opts.avatarId || 'kitty';
  // Prefer the avatar's own GLB (only the selected avatar is preloaded at
  // boot — see menuV2 header), else the shared hero donor.
  const ownKey = opts.glb ? `hero_${avatarId}` : null;
  const mesh = (ownKey && cloneCached(ownKey)) || cloneCached('hero');
  if (!mesh) return null;   // GLTF not preloaded → caller keeps the SVG fallback

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'kkv2-hero-canvas';
  canvas.style.cssText =
    'position:absolute; inset:0; width:100%; height:100%; display:block;' +
    'pointer-events:none; filter: drop-shadow(0 30px 50px rgba(0,0,0,.7));';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 0.78, 0.1, 50);
  camera.position.set(0, 0.9, 4.8);
  camera.lookAt(0, 0.72, 0);

  // Lights — match the carousel for readability parity.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyL = new THREE.DirectionalLight(0xfff3cc, 1.1);
  keyL.position.set(2.5, 4, 3);
  scene.add(keyL);
  const rimL = new THREE.DirectionalLight(0x7fffe4, 0.5);
  rimL.position.set(-3, 2, -2);
  scene.add(rimL);

  const group = new THREE.Group();
  scene.add(group);

  // ── Auto-fit + center + tint ────────────────────────────────────────
  const ownedMats = [];
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const fit = size.y > 1e-6 ? TARGET_HEIGHT / size.y : 1;
  mesh.scale.setScalar(fit * (opts.scaleMul || 1));

  // Re-measure post-scale to center on X/Z and seat the feet at y=0.
  const box2 = new THREE.Box3().setFromObject(mesh);
  const center = box2.getCenter(new THREE.Vector3());
  mesh.position.x -= center.x;
  mesh.position.z -= center.z;
  mesh.position.y -= box2.min.y;

  const tint = new THREE.Color(opts.tint != null ? opts.tint : 0xffffff);
  mesh.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const isArr = Array.isArray(o.material);
    const src = isArr ? o.material : [o.material];
    const cloned = src.map((m) => {
      const cm = m.clone();          // clone BEFORE mutating — cache is shared
      if (cm.color) cm.color.multiply(tint);
      ownedMats.push(cm);
      return cm;
    });
    o.material = isArr ? cloned : cloned[0];
    o.castShadow = false;
    o.receiveShadow = false;
  });
  group.add(mesh);

  // ── RO-deferred sizing + render loop ────────────────────────────────
  let _raf = 0;
  let _started = false;
  let lastT = 0;
  let w = 0;
  let h = 0;

  function resize() {
    const rect = host.getBoundingClientRect();
    const nw = Math.max(1, Math.floor(rect.width));
    const nh = Math.max(1, Math.floor(rect.height));
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    renderer.setSize(w, h, false);   // false: CSS (inset:0/100%) drives display size
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!_started) {
      _started = true;
      lastT = performance.now();
      _raf = requestAnimationFrame(tick);
    }
  }

  function tick() {
    _raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    group.rotation.y += SPIN_RATE * dt;
    renderer.render(scene, camera);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();   // attempt immediate size in case host is already laid out

  return {
    destroy() {
      if (_raf) cancelAnimationFrame(_raf);
      _raf = 0;
      try { ro.disconnect(); } catch (_) {}
      for (const m of ownedMats) { try { m.dispose(); } catch (_) {} }
      try { renderer.dispose(); } catch (_) {}
      try { renderer.forceContextLoss(); } catch (_) {}
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
