#!/usr/bin/env node
/**
 * Sprite hit-flash parity smoke (CC4, 2026-05-20).
 *
 * Static-source gate (mirrors tools/smoke-town.mjs / smoke-sig-weapons.mjs).
 * Driving a real billboard hit-flash headless is not worth it; the shader
 * compile + render is covered by a forest boot (smoke-forest-v2 renders the
 * 23-tier trash horde as billboards, so a broken shader → pageerror / missing
 * sprites). Here we assert the WIRING that CC4 added:
 *
 *   spritePool.js
 *     1. per-instance `aFlash` InstancedBufferAttribute + geom.setAttribute
 *     2. `vFlash` varying declared in BOTH the vertex + fragment shader
 *     3. fragment shader mixes the texel toward white by clamp(vFlash)
 *     4. `setSpriteFlash` export
 *     5. flash reset to 0 in BOTH spawnSprite (evict-recycle) AND killSprite
 *        (stash) — the two silent stale-flash paths
 *   sprites/index.js
 *     6. re-exports setSpriteFlash
 *   enemies.js
 *     7. imports setSpriteFlash; sprite branch calls it edge-triggered on
 *        _wasFlashing (parity with the 3D flashMats path); strength is a const
 *
 * Run: node tools/smoke-sprite-flash.mjs   (no flags, no server, no playwright)
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
function ok(msg) { pass++; console.log(`[OK] ${msg}`); }

const pool = read('src/sprites/spritePool.js');
const idx = read('src/sprites/index.js');
const enemies = read('src/enemies.js');

// 1: aFlash attribute set up
assert.ok(/const flashAttr = new THREE\.InstancedBufferAttribute/.test(pool), "spritePool: flashAttr InstancedBufferAttribute missing");
assert.ok(/geom\.setAttribute\('aFlash'/.test(pool), "spritePool: aFlash attribute not bound to geometry");
assert.ok(/attribute float aFlash;/.test(pool), "spritePool VS: aFlash attribute not declared");
ok('per-instance aFlash attribute set up + bound to geometry + VS attribute');

// 2: vFlash varying in BOTH shaders (declared twice: VS + FS)
const varyingCount = (pool.match(/varying float vFlash;/g) || []).length;
assert.ok(varyingCount >= 2, `spritePool: vFlash varying must appear in VS+FS (found ${varyingCount})`);
assert.ok(/vFlash = aFlash;/.test(pool), "spritePool VS: vFlash not assigned from aFlash");
ok('vFlash varying declared in VS + FS and assigned in VS');

// 3: FS mixes toward white by clamp(vFlash)
assert.ok(/mix\(c\.rgb,\s*vec3\(1\.0\),\s*clamp\(vFlash/.test(pool), "spritePool FS: white-mix by clamp(vFlash) missing");
ok('fragment shader mixes texel toward white by clamp(vFlash)');

// 4: setSpriteFlash export
assert.ok(/export function setSpriteFlash\(/.test(pool), "spritePool: setSpriteFlash export missing");
ok('setSpriteFlash export present');

// 5: flash reset to 0 in BOTH spawnSprite + killSprite (>=2 occurrences of the
//    zero-write; setSpriteFlash writes `= amount`, not `= 0`, so it doesn't count)
const zeroResets = (pool.match(/pool\.flashAttr\.array\[slot\]\s*=\s*0;/g) || []).length;
assert.ok(zeroResets >= 2, `spritePool: flash must be zeroed in spawnSprite AND killSprite (found ${zeroResets} zero-writes)`);
ok('flash zeroed on both recycle paths (spawnSprite evict + killSprite stash)');

// 6: index.js re-exports it
assert.ok(/setSpriteFlash/.test(idx), "sprites/index.js: setSpriteFlash not re-exported");
ok('sprites/index.js re-exports setSpriteFlash');

// 7: enemies.js imports + edge-triggered sprite-branch call + strength const
assert.ok(/import \{[^}]*setSpriteFlash[^}]*\} from '\.\/sprites\/index\.js'/.test(enemies), "enemies.js: setSpriteFlash not imported");
assert.ok(/const SPRITE_FLASH_STRENGTH\s*=/.test(enemies), "enemies.js: SPRITE_FLASH_STRENGTH const missing");
assert.ok(/setSpriteFlash\('enemies',\s*e\._spriteSlot,\s*isFlashing \? SPRITE_FLASH_STRENGTH : 0\)/.test(enemies), "enemies.js: sprite branch does not call setSpriteFlash edge-triggered");
// Edge-trigger proof: the call sits behind an `isFlashing !== e._wasFlashing` guard.
assert.ok(/isFlashing !== e\._wasFlashing[\s\S]{0,160}setSpriteFlash\('enemies'/.test(enemies), "enemies.js: sprite flash not edge-triggered on _wasFlashing");
ok('enemies.js: import + edge-triggered sprite-branch setSpriteFlash + strength const');

console.log(`\npass=${pass} fail=0`);
console.log('ALL CHECKS PASS');
