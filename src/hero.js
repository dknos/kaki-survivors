/**
 * Hero: spawn, movement, damage, level-up trigger.
 */
import * as THREE from 'three';
import { state, xpForLevel } from './state.js';
import { HERO } from './config.js';
import { cloneCached } from './assets.js';
import { sfx } from './audio.js';
import { showDeathScreen, showLevelUpModal } from './ui.js';
import { weaponChoices } from './weapons/index.js';

const _tmpDir = new THREE.Vector3();

export function initHero(scene) {
  const mesh = cloneCached('hero');
  if (mesh) {
    mesh.scale.setScalar(HERO.scale);
    mesh.position.set(0, HERO.yOffset, 0);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    scene.add(mesh);
    state.hero.mesh = mesh;
  } else {
    state.hero.mesh = null;
  }
  state.hero.pos = new THREE.Vector3(0, 0, 0);
  state.hero.vel.set(0, 0, 0);
  state.hero.facing.set(0, 0, 1);
}

export function updateHero(dt) {
  const h = state.hero;
  const mv = state.input.moveVec;

  // input.y → world z (screen down = +z)
  const speed = HERO.speed * (h.statMul.moveSpeed || 1);
  const vx = mv.x * speed;
  const vz = mv.y * speed;
  h.vel.set(vx, 0, vz);

  h.pos.x += vx * dt;
  h.pos.z += vz * dt;
  h.pos.y = 0;

  if (h.mesh) {
    h.mesh.position.set(h.pos.x, HERO.yOffset, h.pos.z);

    // Face move direction
    const mag2 = vx * vx + vz * vz;
    if (mag2 > 1e-4) {
      _tmpDir.set(vx, 0, vz).normalize();
      h.facing.copy(_tmpDir);
      const yaw = Math.atan2(vx, vz);
      h.mesh.rotation.y = yaw;
    }

    // I-frame flicker
    if (state.time.game < h.iFramesUntil) {
      const phase = Math.floor(state.time.real * 1000 / 80) % 2;
      h.mesh.visible = phase === 0;
    } else if (!h.mesh.visible) {
      h.mesh.visible = true;
    }
  }

  // Level-up check (loop to handle multi-level XP gains)
  while (h.xp >= h.xpNext && !state.pendingLevelUp) {
    h.xp -= h.xpNext;
    h.level += 1;
    h.xpNext = xpForLevel(h.level);
    state.pendingLevelUp = true;
    state.levelUpChoices = weaponChoices(3);
    showLevelUpModal(state.levelUpChoices);
    if (sfx && sfx.levelUp) sfx.levelUp();
  }
}

export function takeDamage(amt) {
  const h = state.hero;
  if (state.time.game < h.iFramesUntil) return;
  if (state.gameOver) return;

  h.hp -= amt;
  h.iFramesUntil = state.time.game + HERO.iFramesSec;
  state.run.dmgTaken += amt;
  state.fx.chromaticPulse = 1;
  if (sfx && sfx.heroHit) sfx.heroHit();

  if (h.hp <= 0) {
    h.hp = 0;
    state.gameOver = true;
    showDeathScreen();
  }
}
