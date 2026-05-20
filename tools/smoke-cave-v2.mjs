#!/usr/bin/env node
/**
 * Cave stage skeleton smoke (P4A cohort 1 of N, 2026-05-18).
 *
 * Phase 1 ONLY for cohort 1 — proves the cave stage is selectable, mounts
 * the placeholder decor group, and runs without errors. Layered cohorts
 * (P4A-c2 … P4A-cN) will add phase 2 (rooms), phase 3 (boss), phase 4
 * (reaper / final wave) — see docs/STAGE_AUTHORING.md §7 for the cadence.
 *
 * Phase 1 assertions:
 *   - window.kkStartRun is registered (boot completed)
 *   - state.run.stage.id === 'cave'
 *   - scene.getObjectByName('caveStage') is non-null (decor builder ran)
 *   - 0 page errors
 *   - rAF alive (fps > FPS_LIVENESS_FLOOR — same liveness gate as
 *     smoke-forest-v2; headless-Chromium swiftshader can't approach 30fps,
 *     so this is a "loop alive" probe not a perf gate)
 *
 * Boot path:
 *   1. Goto /index.html?smoke=1
 *   2. Wait for window.kkStartRun
 *   3. Set meta.unlockedCave = true (menu gating — selectedStage()
 *      resolver itself doesn't gate, but menuV2's _stageUnlocked does;
 *      smoke pokes the flag so the next cohort's UI-driven smoke doesn't
 *      have to special-case the gate)
 *   4. setOption('selectedStage', 'cave')
 *   5. window.kkStartRun()
 *   6. Wait for kkState.run + kkState.mode === 'run'
 *   7. Settle, then probe
 *
 * Run: node tools/smoke-cave-v2.mjs
 * NO npm install. Playwright is expected at /home/nemoclaw/node_modules.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ROOT = path.resolve(__dirname, '..');
// Avoid port collisions with the other smokes (forest-v2=8773, ram-diet=8776, amber=8771).
const PORT = Number(process.env.PORT || 8778);
const BOOT_TIMEOUT_MS = 60000;
const PHASE_SETTLE_MS = 3000;
const FPS_WINDOW_MS = 2000;
const FPS_LIVENESS_FLOOR = 0.5;

// ── Static server (lifted from smoke-forest-v2 / smoke-ram-diet) ──────────
function mime(p) {
  if (p.endsWith('.js'))   return 'application/javascript';
  if (p.endsWith('.mjs'))  return 'application/javascript';
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.css'))  return 'text/css';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.glb'))  return 'model/gltf-binary';
  if (p.endsWith('.png'))  return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.svg'))  return 'image/svg+xml';
  if (p.endsWith('.mp3'))  return 'audio/mpeg';
  if (p.endsWith('.wav'))  return 'audio/wav';
  if (p.endsWith('.ogg'))  return 'audio/ogg';
  return 'application/octet-stream';
}
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': mime(full), 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const PLAY_PATH = '/home/nemoclaw/node_modules/playwright';
const PLAYWRIGHT_EXEC = '/home/nemoclaw/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

async function measureFps(page) {
  return await page.evaluate(async (windowMs) => {
    return await new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      function tick() {
        frames++;
        if (performance.now() - t0 >= windowMs) {
          resolve(frames / (windowMs / 1000));
        } else {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    });
  }, FPS_WINDOW_MS);
}

async function main() {
  const t0 = Date.now();

  if (!fs.existsSync(PLAY_PATH)) {
    console.error('[smoke-cave] FAIL: playwright not installed at ' + PLAY_PATH);
    console.error('[smoke-cave] Per CLAUDE.md, smoke tools NEVER run npm install.');
    process.exit(2);
  }
  if (!fs.existsSync(PLAYWRIGHT_EXEC)) {
    console.error('[smoke-cave] FAIL: chromium binary not found at ' + PLAYWRIGHT_EXEC);
    process.exit(2);
  }
  console.log('[smoke-cave] playwright check: OK');

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('[smoke-cave] server on http://127.0.0.1:' + PORT);

  const { chromium } = require(PLAY_PATH);
  const browser = await chromium.launch({
    executablePath: PLAYWRIGHT_EXEC,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log('[console.error]', msg.text());
    }
  });
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    console.error('[pageerror]', e.message);
  });

  let exitCode = 0;
  try {
    const url = 'http://127.0.0.1:' + PORT + '/index.html?smoke=1';
    await page.goto(url, { waitUntil: 'load', timeout: BOOT_TIMEOUT_MS });
    console.log('[smoke-cave] page loaded; waiting for kkStartRun');

    await page.waitForFunction(
      () => typeof window.kkStartRun === 'function',
      null,
      { timeout: BOOT_TIMEOUT_MS },
    );

    // Pin run to Cave BEFORE start. Two pokes:
    //   (a) meta.unlockedCave = true so any menu render path treats cave as
    //       selectable (defense in depth — the resolver itself doesn't gate,
    //       but a future UI-driven smoke would).
    //   (b) setOption('selectedStage', 'cave') — same call shape as
    //       smoke-forest-v2 / smoke-ram-diet.
    await page.evaluate(async () => {
      try {
        const mod = await import('./src/meta.js');
        const m = (mod.getMeta && mod.getMeta()) || null;
        if (m) m.unlockedCave = true;
        if (mod.setOption) mod.setOption('selectedStage', 'cave');
        else if (m) m.selectedStage = 'cave';
      } catch (e) {
        console.warn('[smoke-cave] meta poke failed:', e && e.message);
      }
    });

    // Clear state.weapons before kkStartRun. Production user-flow reaches
    // start() via kkReturnToMenu → menuV2 stage pick → Embark, by which
    // point _teardownActiveRun has wiped weapons via resetState. On the
    // straight boot → kkStartRun path the boot-time acquireWeapon (main.js
    // line ~441) leaves state.weapons.length = 1, so the gate at start()
    // line ~526 (`if (state.weapons.length === 0)`) skips the second
    // applyMetaUpgrades — meaning the boot-time stage selection (forest by
    // default) sticks even after setOption('selectedStage','cave'). Wiping
    // weapons here forces the re-apply path and matches the production
    // menu→Embark control flow.
    await page.evaluate(() => {
      try {
        const s = window.kkState;
        if (s && s.weapons && typeof s.weapons.length !== 'undefined') {
          s.weapons.length = 0;
        }
      } catch (e) {
        console.warn('[smoke-cave] weapons-clear failed:', e && e.message);
      }
    });

    // Start the run. start() is async (awaits preloadStage); we poll for
    // state.run + state.mode === 'run'.
    await page.evaluate(() => {
      if (typeof window.kkPerfForceOn === 'function') window.kkPerfForceOn();
      window.kkStartRun();
    });

    await page.waitForFunction(
      () => !!window.kkState && !!window.kkState.run && window.kkState.mode === 'run',
      null,
      { timeout: BOOT_TIMEOUT_MS },
    );
    console.log('[smoke-cave] kkState live; settling ' + PHASE_SETTLE_MS + 'ms for phase 1');

    await new Promise((r) => setTimeout(r, PHASE_SETTLE_MS));

    // FPS liveness probe — rAF alive ≠ perf gate (see smoke-forest-v2 header
    // for the rationale; headless swiftshader can't do 30fps).
    const fps1 = await measureFps(page);

    // Phase 1 probe — assert cave wired up.
    const p1 = await page.evaluate(() => {
      const s = window.kkState;
      if (!s) return { ok: false, reason: 'kkState missing' };
      const stageId = s.run && s.run.stage && s.run.stage.id;
      if (stageId !== 'cave') {
        return { ok: false, reason: 'state.run.stage.id=' + stageId + ' (expected cave)', stageId };
      }
      if (!s.scene || typeof s.scene.getObjectByName !== 'function') {
        return { ok: false, reason: 'scene.getObjectByName unavailable', stageId };
      }
      const caveGroup = s.scene.getObjectByName('caveStage');
      if (!caveGroup) {
        return { ok: false, reason: 'scene.getObjectByName("caveStage") returned null — buildCaveStage did not run', stageId };
      }
      // Count children so future cohorts can extend the probe (e.g.
      // assert >= 3 stalactite landmarks at c2).
      const childCount = caveGroup.children ? caveGroup.children.length : 0;
      const envGroupOk = !!s.envGroup;
      return {
        ok: true,
        reason: 'stage=cave, caveStage group present with ' + childCount + ' child(ren), envGroup=' + envGroupOk,
        stageId, childCount, envGroupOk,
      };
    });

    let p1Pass = p1.ok;
    let p1Reason = p1.reason;
    if (p1Pass && fps1 <= FPS_LIVENESS_FLOOR) {
      p1Pass = false;
      p1Reason += '; rAF DEAD (fps=' + fps1.toFixed(2) + ')';
    }

    const status = p1Pass ? 'PASS' : 'FAIL';
    console.log('phase 1 (skeleton): ' + status + ' — ' + p1Reason
                + '  [fps=' + fps1.toFixed(1) + ']');

    // ── Phase 2 (P4A cohort 2) — Stalactite cluster landed ──────────────
    // Probes caveStage.userData.stalactiteCount, set in src/stages/cave/
    // caveStage.js after buildStalactiteCluster returns. Cohort 2 author-
    // anchors 6 clusters × 4-5 stalactites = 24-30 instances; threshold
    // ≥6 is the conservative gate so future cohort tweaks (e.g. dropping
    // an interior cluster for room overlap) don't trip this.
    const p2 = await page.evaluate(() => {
      const s = window.kkState;
      if (!s || !s.scene) return { ok: false, reason: 'kkState/scene missing' };
      const caveGroup = s.scene.getObjectByName('caveStage');
      if (!caveGroup) return { ok: false, reason: 'caveStage group missing' };
      const n = (caveGroup.userData && caveGroup.userData.stalactiteCount) | 0;
      if (n < 6) {
        return { ok: false, reason: 'stalactiteCount=' + n + ' (expected >=6)' };
      }
      // Confirm the cluster group itself is mounted under caveStage and
      // contains two InstancedMesh children (bodies + tips).
      const stalGroup = caveGroup.getObjectByName('caveStage_stalactites');
      if (!stalGroup) {
        return { ok: false, reason: 'caveStage_stalactites group missing', count: n };
      }
      const bodies = stalGroup.getObjectByName('caveStage_stalactiteBodies');
      const tips   = stalGroup.getObjectByName('caveStage_stalactiteTips');
      if (!bodies || !tips) {
        return { ok: false, reason: 'stalactite bodies/tips InstancedMesh missing', count: n };
      }
      // Tips must be bloom-tagged for the slot-3 moss glow per the style doc.
      const tipsBloom = tips.layers && typeof tips.layers.mask === 'number'
        ? (tips.layers.mask & (1 << 1)) !== 0
        : false;
      return {
        ok: true,
        reason: 'stalactiteCount=' + n + ', bodies+tips present, tips bloom=' + tipsBloom,
        count: n, tipsBloom,
      };
    });
    console.log('phase 2 (stalactites): ' + (p2.ok ? 'PASS' : 'FAIL') + ' — ' + p2.reason);

    // ── Phase 3 (P4A cohort 2) — env.js cave wire-up ─────────────────────
    // Asserts the cave entry exists in ATMOS_SPECS (via the cluster object
    // on envGroup.userData.atmosClusters.cave) AND that the lighting +
    // fog colors came from the cave branch of applyStageTint (not the
    // forest-baseline fallthrough). Direct object probe — no screenshot
    // path, deterministic under headless swiftshader.
    const p3 = await page.evaluate(() => {
      const s = window.kkState;
      if (!s) return { ok: false, reason: 'kkState missing' };
      const env = s.envGroup;
      if (!env || !env.userData) return { ok: false, reason: 'envGroup missing' };
      // (a) ATMOS_SPECS cave cluster exists + is the active one.
      const clusters = env.userData.atmosClusters;
      if (!clusters || !clusters.cave) {
        return { ok: false, reason: 'envGroup.userData.atmosClusters.cave missing — ATMOS_SPECS cave entry not registered' };
      }
      if (!clusters.cave.visible) {
        return { ok: false, reason: 'atmos cave cluster present but not visible (active stage mismatch?)' };
      }
      // (b) Fog color matches CAVE_PALETTE.shadow (0x1a1820). applyStageTint
      // already pipes stage.fogColor through, so this validates the cave
      // STAGES entry → fog plumbing too.
      const fogHex = (s.scene && s.scene.fog && s.scene.fog.color)
        ? s.scene.fog.color.getHex() : -1;
      if (fogHex !== 0x1a1820) {
        return { ok: false, reason: 'scene.fog.color=0x' + fogHex.toString(16) + ' (expected 0x1a1820)' };
      }
      // (c) Lighting deltas — cave arm sets hemi.intensity=0.18 (vs forest
      // baseline 0.28). Probe hemi via envGroup userData stash.
      const hemi = env.userData.hemi;
      if (!hemi) return { ok: false, reason: 'envGroup.userData.hemi missing' };
      if (hemi.intensity > 0.22) {
        // Forest baseline is 0.28; cave should drop to 0.18. Threshold 0.22
        // catches "fell through to forest baseline" without rejecting small
        // future tweaks to the cave value.
        return { ok: false, reason: 'hemi.intensity=' + hemi.intensity + ' (expected <=0.22 for cave)' };
      }
      return {
        ok: true,
        reason: 'atmos cave active, fog=0x' + fogHex.toString(16) + ', hemi.intensity=' + hemi.intensity.toFixed(3),
        fogHex, hemiIntensity: hemi.intensity,
      };
    });
    console.log('phase 3 (env cave branch): ' + (p3.ok ? 'PASS' : 'FAIL') + ' — ' + p3.reason);

    // ── Phase 4 (P4A cohort 3) — Glowmoss patches + dedicated ground pack ─
    // Two assertions:
    //   (a) caveStage.userData.glowmossCount >= 15 — guard against the
    //       buildGlowmossPatches builder silently no-op'ing (e.g. parent
    //       null guard short-circuit). 15 is the conservative floor; the
    //       builder authors 24 per cohort 3 spec.
    //   (b) envGroup.userData.groundPacks.cave.diff truthy — proves the
    //       cave-specific pack materialized via the env.js cohort 3
    //       loadPngTex path AND that applyStageTint can route to it
    //       (the `isCave ? 'cave' : ...` branch in the packKey ternary).
    const p4 = await page.evaluate(() => {
      const s = window.kkState;
      if (!s || !s.scene) return { ok: false, reason: 'kkState/scene missing' };
      const caveGroup = s.scene.getObjectByName('caveStage');
      if (!caveGroup) return { ok: false, reason: 'caveStage group missing' };
      // (a) Glowmoss count
      const moss = (caveGroup.userData && caveGroup.userData.glowmossCount) | 0;
      if (moss < 15) {
        return { ok: false, reason: 'glowmossCount=' + moss + ' (expected >=15)' };
      }
      // Confirm the InstancedMesh itself is wired + bloom-tagged.
      const mossGroup = caveGroup.getObjectByName('caveStage_glowmoss');
      if (!mossGroup) return { ok: false, reason: 'caveStage_glowmoss group missing', count: moss };
      const mossInst = mossGroup.getObjectByName('caveStage_glowmossPatches');
      if (!mossInst) return { ok: false, reason: 'glowmoss InstancedMesh missing', count: moss };
      const mossBloom = mossInst.layers && typeof mossInst.layers.mask === 'number'
        ? (mossInst.layers.mask & (1 << 1)) !== 0
        : false;
      if (!mossBloom) {
        return { ok: false, reason: 'glowmoss InstancedMesh not bloom-tagged', count: moss };
      }
      // Z-order guard: ground decals must render BELOW hero (renderOrder < 0
      // + polygonOffset). Catches a regression that drops either knob.
      if (mossInst.renderOrder !== -1) {
        return { ok: false, reason: 'glowmoss renderOrder=' + mossInst.renderOrder + ' (expected -1)', count: moss };
      }
      const mossMat = mossInst.material;
      if (!mossMat || !mossMat.polygonOffset) {
        return { ok: false, reason: 'glowmoss material missing polygonOffset', count: moss };
      }

      // (b) Dedicated cave ground pack via envGroup userData.
      const env = s.envGroup;
      if (!env || !env.userData) return { ok: false, reason: 'envGroup missing', count: moss };
      const packs = env.userData.groundPacks;
      if (!packs) return { ok: false, reason: 'envGroup.userData.groundPacks missing', count: moss };
      const cavePack = packs.cave;
      if (!cavePack || !cavePack.diff) {
        return { ok: false, reason: 'groundPacks.cave.diff missing — fell through to brown_mud', count: moss };
      }
      // Sanity: cave pack diff should NOT be the same object reference as
      // the twilight/forest packs (= the brown_mud fallthrough regression).
      const t = packs.twilight && packs.twilight.diff;
      const f = packs.forest   && packs.forest.diff;
      if (cavePack.diff === t || cavePack.diff === f) {
        return { ok: false, reason: 'cave pack diff aliased to forest/twilight texture', count: moss };
      }
      return {
        ok: true,
        reason: 'glowmossCount=' + moss + ', bloom=' + mossBloom
              + ', cave pack present (diff !=forest/twilight)',
        count: moss,
      };
    });
    console.log('phase 4 (glowmoss + ground pack): ' + (p4.ok ? 'PASS' : 'FAIL') + ' — ' + p4.reason);

    // ── Phase 5 (P4A cohort 4) — Ceiling drip particle system ────────────
    // Three assertions:
    //   (a) caveStage.userData.dripPoolSize >= 20 — guards against the
    //       buildCeilingDrips builder silently no-op'ing (e.g. parent null
    //       guard short-circuit). Cohort 4 pre-allocates 24 slots.
    //   (b) InstancedMesh `caveStage_ceilingDrips` mounted + bloom-tagged
    //       so the slot-3 streak pops under the same chrome as the
    //       cohort-2 tips and cohort-3 patches.
    //   (c) After a 2s settle the dynamic drip-spawn module reports
    //       totalSpawned >= 1. We use a counter (not a snapshot of an
    //       in-flight slot) because at 0.5/s + 0.3-0.6s flight times the
    //       "catch one mid-air" probe is a flake per cohort-4 advisor.
    // For (c), import the module dynamically and call the spawn-counter
    // accessor — same pattern smoke-cave uses for `meta.js` import.
    await new Promise((r) => setTimeout(r, 2200));   // settle for spawn dispatcher
    const p5 = await page.evaluate(async () => {
      const s = window.kkState;
      if (!s || !s.scene) return { ok: false, reason: 'kkState/scene missing' };
      const caveGroup = s.scene.getObjectByName('caveStage');
      if (!caveGroup) return { ok: false, reason: 'caveStage group missing' };
      // (a) Pool size
      const poolSize = (caveGroup.userData && caveGroup.userData.dripPoolSize) | 0;
      if (poolSize < 20) {
        return { ok: false, reason: 'dripPoolSize=' + poolSize + ' (expected >=20)' };
      }
      // (b) InstancedMesh + bloom
      const dripGroup = caveGroup.getObjectByName('caveStage_ceilingDrips_group');
      if (!dripGroup) {
        return { ok: false, reason: 'caveStage_ceilingDrips_group missing', poolSize };
      }
      const dripInst = dripGroup.getObjectByName('caveStage_ceilingDrips');
      if (!dripInst) {
        return { ok: false, reason: 'ceilingDrips InstancedMesh missing', poolSize };
      }
      const dripBloom = dripInst.layers && typeof dripInst.layers.mask === 'number'
        ? (dripInst.layers.mask & (1 << 1)) !== 0
        : false;
      if (!dripBloom) {
        return { ok: false, reason: 'ceilingDrips InstancedMesh not bloom-tagged', poolSize };
      }
      const dripMat = dripInst.material;
      if (!dripMat || dripMat.blending !== 2) {
        // THREE.AdditiveBlending === 2. Verify the additive recipe survived.
        return { ok: false, reason: 'ceilingDrips material blending=' + (dripMat && dripMat.blending) + ' (expected 2 / AdditiveBlending)', poolSize };
      }
      // Slot-3 color sanity (CAVE_PALETTE.moss = 0x7fffe4)
      const colHex = (dripMat.color && dripMat.color.getHex) ? dripMat.color.getHex() : -1;
      if (colHex !== 0x7fffe4) {
        return { ok: false, reason: 'ceilingDrips color=0x' + colHex.toString(16) + ' (expected 0x7fffe4)', poolSize };
      }
      // (c) Total-spawned counter via module accessor
      let totalSpawned = -1;
      try {
        const mod = await import('./src/stages/cave/caveCeilingDrips.js');
        if (mod && typeof mod.getCeilingDripTotalSpawned === 'function') {
          totalSpawned = mod.getCeilingDripTotalSpawned() | 0;
        }
      } catch (e) {
        return { ok: false, reason: 'caveCeilingDrips import failed: ' + (e && e.message), poolSize };
      }
      if (totalSpawned < 1) {
        return { ok: false, reason: 'totalSpawned=' + totalSpawned + ' (expected >=1 after 2.2s settle)', poolSize };
      }
      return {
        ok: true,
        reason: 'dripPoolSize=' + poolSize + ', bloom=' + dripBloom
              + ', additive blending + slot-3 color, totalSpawned=' + totalSpawned,
        poolSize, totalSpawned,
      };
    });
    console.log('phase 5 (ceiling drips): ' + (p5.ok ? 'PASS' : 'FAIL') + ' — ' + p5.reason);

    // ── Phase 6 (P4A cohort 5) — Gloomshrimp neutrals ────────────────────
    // Four assertions:
    //   (a) caveStage.userData.gloomshrimpCount >= 10 — guards against the
    //       buildGloomshrimp builder silently no-op'ing. Cohort 5 spawns 12.
    //   (b) InstancedMesh `caveStage_gloomshrimp` mounted under
    //       `caveStage_gloomshrimpGroup` and bloom-tagged (slot-3 emissive
    //       pops under the same chrome as cohort-2/3/4).
    //   (c) Material emissive is slot-3 moss (0x7fffe4).
    //   (d) Instance 0's translation changes across a 700ms gap — proves
    //       tickGloomshrimp is actually wired into the frame loop (the whole
    //       tickCave → tickGloomshrimp chain), not just built once.
    const p6before = await page.evaluate(() => {
      const s = window.kkState;
      const cg = s && s.scene && s.scene.getObjectByName('caveStage');
      const g = cg && cg.getObjectByName('caveStage_gloomshrimpGroup');
      const inst = g && g.getObjectByName('caveStage_gloomshrimp');
      if (!inst) return null;
      const a = inst.instanceMatrix.array;
      return { x: a[12], y: a[13], z: a[14] };
    });
    await new Promise((r) => setTimeout(r, 700));   // let the school drift
    const p6 = await page.evaluate((before) => {
      const s = window.kkState;
      if (!s || !s.scene) return { ok: false, reason: 'kkState/scene missing' };
      const cg = s.scene.getObjectByName('caveStage');
      if (!cg) return { ok: false, reason: 'caveStage group missing' };
      const n = (cg.userData && cg.userData.gloomshrimpCount) | 0;
      if (n < 10) return { ok: false, reason: 'gloomshrimpCount=' + n + ' (expected >=10)' };
      const g = cg.getObjectByName('caveStage_gloomshrimpGroup');
      if (!g) return { ok: false, reason: 'caveStage_gloomshrimpGroup missing', count: n };
      const inst = g.getObjectByName('caveStage_gloomshrimp');
      if (!inst) return { ok: false, reason: 'gloomshrimp InstancedMesh missing', count: n };
      const bloom = inst.layers && typeof inst.layers.mask === 'number'
        ? (inst.layers.mask & (1 << 1)) !== 0
        : false;
      if (!bloom) return { ok: false, reason: 'gloomshrimp InstancedMesh not bloom-tagged', count: n };
      const mat = inst.material;
      const emHex = (mat && mat.emissive && mat.emissive.getHex) ? mat.emissive.getHex() : -1;
      if (emHex !== 0x7fffe4) {
        return { ok: false, reason: 'gloomshrimp emissive=0x' + emHex.toString(16) + ' (expected 0x7fffe4 slot-3 moss)', count: n };
      }
      let moved = -1;
      if (before) {
        const a = inst.instanceMatrix.array;
        const dx = a[12] - before.x, dy = a[13] - before.y, dz = a[14] - before.z;
        moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      if (!(moved > 0.02)) {
        return { ok: false, reason: 'instance 0 did not move (moved=' + moved + ') — tickGloomshrimp not running', count: n };
      }
      return {
        ok: true,
        reason: 'gloomshrimpCount=' + n + ', bloom=' + bloom
              + ', slot-3 emissive, moved=' + moved.toFixed(3) + 'u/0.7s',
        count: n, moved,
      };
    }, p6before);
    console.log('phase 6 (gloomshrimp): ' + (p6.ok ? 'PASS' : 'FAIL') + ' — ' + p6.reason);

    // ── Phase 7 (P4A cohort 6) — Cave achievements ───────────────────────
    // Three assertions:
    //   (a) All 5 cave_* defs are registered into the shared achievement
    //       registry (window.__kkAchievements.list() — exposed by
    //       forestAchievements.js) — proves loadCaveAchievements ran.
    //   (b) isUnlocked('cave_enter') === true — proves tickCaveAchievements
    //       is frame-wired through tickCave on the live cave run (the whole
    //       chain), not just registered.
    //   (c) Funnel + per-run idempotency: unlocking a not-yet-fired id
    //       (cave_clear) returns a def the first time + reads back unlocked,
    //       and a second unlock in the same run is a no-op (null).
    const p7 = await page.evaluate(() => {
      const A = window.__kkAchievements;
      if (!A || typeof A.list !== 'function') {
        return { ok: false, reason: 'window.__kkAchievements probe missing' };
      }
      const ids = new Set(A.list().map((d) => d.id));
      const want = ['cave_enter', 'cave_gloomshrimp', 'cave_time_10min', 'cave_clear', 'cave_flawless_3min'];
      const missing = want.filter((id) => !ids.has(id));
      if (missing.length) {
        return { ok: false, reason: 'cave defs not registered: ' + missing.join(',') };
      }
      // (b) frame-wired unlock
      if (!A.isUnlocked('cave_enter')) {
        return { ok: false, reason: 'cave_enter not unlocked — tickCaveAchievements not frame-wired' };
      }
      // (c) funnel + idempotency on a fresh id
      const first = A.unlock('cave_clear');
      const unlockedAfter = A.isUnlocked('cave_clear');
      const second = A.unlock('cave_clear');
      if (!first) return { ok: false, reason: 'unlock(cave_clear) returned falsy on first call' };
      if (!unlockedAfter) return { ok: false, reason: 'cave_clear not marked unlocked after unlock()' };
      if (second) return { ok: false, reason: 'unlock(cave_clear) re-fired in same run (expected null) — dedup broken' };
      return {
        ok: true,
        reason: 'registered ' + want.length + ' cave defs, cave_enter auto-unlocked, funnel idempotent',
      };
    });
    console.log('phase 7 (cave achievements): ' + (p7.ok ? 'PASS' : 'FAIL') + ' — ' + p7.reason);

    // ── Phase 8 (P4A cohort 7) — Gloomsigil cave-gated weapon ────────────
    // Stage-gate is the key regression risk: a cave weapon must NOT leak into
    // forest/twilight/cinder/void level-up offers. We test the gate directly
    // by flipping state.run.stage and draining the offer pool (weaponChoices
    // with a large n returns all eligible weapon cards before fillers):
    //   (a) REGISTRY.gloomsigil exists with stages: ['cave'].
    //   (b) On a forest stage, gloomsigil is filtered OUT of the offers.
    //   (c) On the cave stage, gloomsigil IS offered.
    //   (d) descriptions.js has a gloomsigil entry (static-source check).
    const p8 = await page.evaluate(async () => {
      let mod;
      try { mod = await import('./src/weapons/index.js'); }
      catch (e) { return { ok: false, reason: 'weapons/index import failed: ' + (e && e.message) }; }
      const REG = mod.REGISTRY;
      if (!REG || !REG.gloomsigil) return { ok: false, reason: 'gloomsigil not in REGISTRY' };
      const stages = REG.gloomsigil.stages;
      if (!Array.isArray(stages) || !stages.includes('cave') || stages.length !== 1) {
        return { ok: false, reason: 'gloomsigil.stages != ["cave"] (got ' + JSON.stringify(stages) + ')' };
      }
      const s = window.kkState;
      if (!s || !s.run) return { ok: false, reason: 'kkState.run missing' };
      if (typeof mod.weaponChoices !== 'function') return { ok: false, reason: 'weaponChoices not exported' };
      const bak = s.run.stage;
      let forestN = -1, caveN = -1;
      try {
        s.run.stage = { id: 'forest' };
        forestN = mod.weaponChoices(50).filter((c) => c && c.id === 'gloomsigil').length;
        s.run.stage = { id: 'cave' };
        caveN = mod.weaponChoices(50).filter((c) => c && c.id === 'gloomsigil').length;
      } finally {
        s.run.stage = bak;
      }
      if (forestN !== 0) return { ok: false, reason: 'gloomsigil leaked into forest offers (n=' + forestN + ')' };
      if (caveN < 1) return { ok: false, reason: 'gloomsigil not offered on cave (n=' + caveN + ')' };
      return { ok: true, reason: 'stages=[cave], forest offers=0, cave offers=' + caveN };
    });
    console.log('phase 8 (gloomsigil gate): ' + (p8.ok ? 'PASS' : 'FAIL') + ' — ' + p8.reason);

    // ── Phase 9 (P4A cohort 8) — Echo Bolt cave-gated weapon ─────────────
    // Same stage-gate regression test as phase 8, for the 2nd cave weapon.
    // Closes the "2 cave weapons" acceptance item. Asserts REGISTRY presence,
    // stages==['cave'], forest offers=0 (no leak), cave offers>=1.
    const p9 = await page.evaluate(async () => {
      let mod;
      try { mod = await import('./src/weapons/index.js'); }
      catch (e) { return { ok: false, reason: 'weapons/index import failed: ' + (e && e.message) }; }
      const REG = mod.REGISTRY;
      if (!REG || !REG.echobolt) return { ok: false, reason: 'echobolt not in REGISTRY' };
      const stages = REG.echobolt.stages;
      if (!Array.isArray(stages) || !stages.includes('cave') || stages.length !== 1) {
        return { ok: false, reason: 'echobolt.stages != ["cave"] (got ' + JSON.stringify(stages) + ')' };
      }
      const s = window.kkState;
      if (!s || !s.run) return { ok: false, reason: 'kkState.run missing' };
      const bak = s.run.stage;
      let forestN = -1, caveN = -1;
      try {
        s.run.stage = { id: 'forest' };
        forestN = mod.weaponChoices(50).filter((c) => c && c.id === 'echobolt').length;
        s.run.stage = { id: 'cave' };
        caveN = mod.weaponChoices(50).filter((c) => c && c.id === 'echobolt').length;
      } finally {
        s.run.stage = bak;
      }
      if (forestN !== 0) return { ok: false, reason: 'echobolt leaked into forest offers (n=' + forestN + ')' };
      if (caveN < 1) return { ok: false, reason: 'echobolt not offered on cave (n=' + caveN + ')' };
      return { ok: true, reason: 'stages=[cave], forest offers=0, cave offers=' + caveN };
    });
    console.log('phase 9 (echobolt gate): ' + (p9.ok ? 'PASS' : 'FAIL') + ' — ' + p9.reason);

    // ── Phase 10 (P4A cohort 9) — Perimeter stalagmite formations ─────────
    // Five assertions:
    //   (a) caveStage.userData.stalagmiteCount >= 24 — guards the builder
    //       silently no-op'ing. Cohort 9 author-places 8×4 = 32.
    //   (b) InstancedMesh `caveStage_stalagmites` mounted under its group.
    //   (c) Material is STONE-TEXTURED: map + normalMap both truthy. This is
    //       the "stone wall textures" acceptance proof (not flat placeholder).
    //   (d) Material color === CAVE_PALETTE.stone (0x4a4a52). The diffuse PNG
    //       is palette-locked grayscale; default-white would render a gray
    //       photograph instead of wet stone (silent ugly-fail per advisor).
    //   (e) Placement invariants from the instance matrices: every instance
    //       sits at r >= 27 (clear of the r<=26 decor footprint → perimeter)
    //       AND its center-Y stays low enough that the tip (≈2×centerY) clears
    //       the iso sightline (occlusion guard: centerY <= 3.0 → tip <= ~6).
    const p10 = await page.evaluate(() => {
      const s = window.kkState;
      if (!s || !s.scene) return { ok: false, reason: 'kkState/scene missing' };
      const cg = s.scene.getObjectByName('caveStage');
      if (!cg) return { ok: false, reason: 'caveStage group missing' };
      const n = (cg.userData && cg.userData.stalagmiteCount) | 0;
      if (n < 24) return { ok: false, reason: 'stalagmiteCount=' + n + ' (expected >=24)' };
      const grp = cg.getObjectByName('caveStage_stalagmites_grp');
      if (!grp) return { ok: false, reason: 'caveStage_stalagmites_grp missing', count: n };
      const inst = grp.getObjectByName('caveStage_stalagmites');
      if (!inst) return { ok: false, reason: 'stalagmites InstancedMesh missing', count: n };
      const mat = inst.material;
      if (!mat || !mat.map || !mat.normalMap) {
        return { ok: false, reason: 'stalagmite material not stone-textured (map/normalMap missing)', count: n };
      }
      const colHex = (mat.color && mat.color.getHex) ? mat.color.getHex() : -1;
      if (colHex !== 0x4a4a52) {
        return { ok: false, reason: 'stalagmite color=0x' + colHex.toString(16) + ' (expected 0x4a4a52 slot-2 stone)', count: n };
      }
      // Placement invariants from the instance matrices (translation = last col).
      const a = inst.instanceMatrix.array;
      let minR = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const off = i * 16;
        const x = a[off + 12], y = a[off + 13], z = a[off + 14];
        const r = Math.sqrt(x * x + z * z);
        if (r < minR) minR = r;
        if (y > maxY) maxY = y;
      }
      if (!(minR >= 27)) {
        return { ok: false, reason: 'a stalagmite is inside the decor footprint (minR=' + minR.toFixed(1) + ', expected >=27)', count: n };
      }
      if (!(maxY <= 3.0)) {
        return { ok: false, reason: 'stalagmite too tall (maxCenterY=' + maxY.toFixed(2) + ' → tip>~6, occlusion risk)', count: n };
      }
      return {
        ok: true,
        reason: 'stalagmiteCount=' + n + ', stone-textured (map+normalMap), color=0x4a4a52, minR='
              + minR.toFixed(1) + ', maxCenterY=' + maxY.toFixed(2),
        count: n, minR, maxY,
      };
    });
    console.log('phase 10 (stalagmites): ' + (p10.ok ? 'PASS' : 'FAIL') + ' — ' + p10.reason);

    // ── Summary ───────────────────────────────────────────────────────────
    const runtimeSec = ((Date.now() - t0) / 1000).toFixed(1);

    console.log('\n========== SMOKE SUMMARY ==========');
    console.log('phase 1 (skeleton):              ' + (p1Pass ? 'PASS' : 'FAIL'));
    console.log('phase 2 (stalactites):           ' + (p2.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 3 (env cave branch):       ' + (p3.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 4 (glowmoss + ground pack):' + (p4.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 5 (ceiling drips):         ' + (p5.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 6 (gloomshrimp):           ' + (p6.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 7 (cave achievements):     ' + (p7.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 8 (gloomsigil gate):       ' + (p8.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 9 (echobolt gate):         ' + (p9.ok  ? 'PASS' : 'FAIL'));
    console.log('phase 10 (stalagmites):          ' + (p10.ok ? 'PASS' : 'FAIL'));
    console.log('runtime: ' + runtimeSec + 's');
    console.log('console.errors:  ' + consoleErrors.length);
    for (const e of consoleErrors) console.log('  - ' + e);
    console.log('pageerrors:      ' + pageErrors.length);
    for (const e of pageErrors) console.log('  - ' + e);

    const hardFail = !p1Pass || !p2.ok || !p3.ok || !p4.ok || !p5.ok || !p6.ok || !p7.ok || !p8.ok || !p9.ok || !p10.ok || pageErrors.length > 0;
    if (hardFail) {
      console.error('[smoke-cave] FAIL — phases='
                    + (p1Pass?1:0) + (p2.ok?1:0) + (p3.ok?1:0) + (p4.ok?1:0) + (p5.ok?1:0) + (p6.ok?1:0) + (p7.ok?1:0) + (p8.ok?1:0) + (p9.ok?1:0) + (p10.ok?1:0)
                    + ' pageerrors=' + pageErrors.length);
      exitCode = 1;
    } else {
      console.log('[smoke-cave] OK — cohort 9 phases 1..10 passed');
      console.log('[smoke-cave] cohort 10…N will add rooms / boss / reaper '
                  + '— see docs/STAGE_AUTHORING.md §7');
    }
  } catch (e) {
    console.error('[smoke-cave] EXCEPTION:', e && (e.stack || e.message || e));
    exitCode = exitCode || 1;
  } finally {
    try { await browser.close(); } catch (_) {}
    try { server.close(); } catch (_) {}
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('[smoke-cave] FAIL (main):', e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
