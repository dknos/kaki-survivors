/**
 * Bootstrap + main RAF loop.
 * Order of operations is locked in the loop body below; modules fill the blanks.
 */
import * as THREE from 'three';
import { state, resetState } from './state.js';
import { WORLD, SPAWN } from './config.js';
import { preloadAll } from './assets.js';
import { createComposer, resizeComposer } from './postfx.js';
import { buildEnv } from './env.js';
import { unlockAudio } from './audio.js';

// Module imports (filled in by parallel agents)
import { initInput, sampleInput } from './input.js';
import { initHero, updateHero, takeDamage as heroTakeDamage } from './hero.js';
import { initEnemies, updateEnemies, prewarmPools } from './enemies.js';
import { initWeapons, tickWeapons, acquireWeapon, weaponChoices } from './weapons/index.js';
import { initXP, updateGems, dropGem, applyLevelUpChoice } from './xp.js';
import { initSpawnDirector, tickSpawnDirector } from './spawnDirector.js';
import { initUI, updateUI, showLevelUpModal, hideLevelUpModal, showDeathScreen, showStartScreen, hideStartScreen } from './ui.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('game-canvas');
let W = window.innerWidth, H = window.innerHeight;
const ASPECT = () => W / H;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(WORLD.bgColor);
scene.fog = new THREE.Fog(WORLD.bgColor, WORLD.fogNear, WORLD.fogFar);

// Orthographic camera, isometric-ish (matches original game's TD view)
const camera = new THREE.OrthographicCamera(
  -WORLD.cameraDistance * ASPECT(), WORLD.cameraDistance * ASPECT(),
   WORLD.cameraDistance,            -WORLD.cameraDistance,
   0.1, 800
);
camera.position.set(35, 50, 35);
camera.lookAt(0, 0, 0);

state.scene = scene; state.camera = camera; state.renderer = renderer;

// Post-FX composer
const { composer, bloomPass, postFXPass } = createComposer(renderer, scene, camera, W, H);
state.composer = composer; state.bloomPass = bloomPass; state.postFXPass = postFXPass;

// Resize
window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H);
  const a = ASPECT();
  camera.left = -WORLD.cameraDistance * a; camera.right = WORLD.cameraDistance * a;
  camera.top = WORLD.cameraDistance;        camera.bottom = -WORLD.cameraDistance;
  camera.updateProjectionMatrix();
  resizeComposer(composer, bloomPass, postFXPass, W, H);
});

// Unlock audio on first interaction
['click', 'touchstart', 'keydown'].forEach(ev =>
  window.addEventListener(ev, unlockAudio, { once: true })
);

// ── Async init ────────────────────────────────────────────────────────────────

async function boot() {
  showStartScreen('Loading…');
  await preloadAll();

  state.envGroup = buildEnv(scene);

  initInput();
  initUI();
  initHero(scene);
  initEnemies(scene);
  initWeapons();
  initXP(scene);
  initSpawnDirector();

  prewarmPools();   // create pooled meshes off-screen (hides first-horde stall)

  // Give starting weapon
  acquireWeapon('orbitals');

  resetState();
  showStartScreen('Click or press SPACE to start');
  const start = () => {
    if (state.started) return;
    state.started = true;
    hideStartScreen();
    state.run.startedAt = performance.now();
  };
  window.addEventListener('click', start);
  window.addEventListener('keydown', e => { if (e.code === 'Space') start(); });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let _lastT = performance.now();

function frame(now) {
  const realDt = Math.min(0.05, (now - _lastT) / 1000);
  _lastT = now;
  state.time.real += realDt;

  if (!state.started) {
    composer.render();
    requestAnimationFrame(frame);
    return;
  }

  if (state.pendingLevelUp || state.gameOver || state.time.paused) {
    // Frozen — render only, no logic, no time progression
    if (state.postFXPass) state.postFXPass.uniforms.time.value = state.time.real;
    composer.render();
    requestAnimationFrame(frame);
    return;
  }

  state.time.dt = realDt;
  state.time.game += realDt;

  // ── Logic phase ──
  sampleInput();
  updateHero(realDt);
  tickSpawnDirector(realDt);
  updateEnemies(realDt);
  tickWeapons(realDt);
  updateGems(realDt);

  // FX decay
  state.fx.chromaticPulse *= Math.pow(0.05, realDt);
  state.fx.bloomBoost     *= Math.pow(0.10, realDt);

  // Camera follow hero (lerp xz, keep height + offset)
  const hp = state.hero.pos;
  const camLerp = WORLD.cameraLerp;
  camera.position.x += (hp.x + 35 - camera.position.x) * camLerp;
  camera.position.z += (hp.z + 35 - camera.position.z) * camLerp;
  camera.lookAt(hp.x, 0, hp.z);

  // Update post-FX uniforms
  if (state.postFXPass) {
    state.postFXPass.uniforms.time.value = state.time.real;
    state.postFXPass.uniforms.chromatic.value = 0.0008 + state.fx.chromaticPulse * 0.004;
  }
  if (state.bloomPass) {
    state.bloomPass.strength = 1.2 + state.fx.bloomBoost * 0.8;
  }

  updateUI();

  composer.render();
  requestAnimationFrame(frame);
}

boot().then(() => requestAnimationFrame(frame));
