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

    // ── Summary ───────────────────────────────────────────────────────────
    const runtimeSec = ((Date.now() - t0) / 1000).toFixed(1);

    console.log('\n========== SMOKE SUMMARY ==========');
    console.log('phase 1 (skeleton): ' + (p1Pass ? 'PASS' : 'FAIL'));
    console.log('runtime: ' + runtimeSec + 's');
    console.log('console.errors:  ' + consoleErrors.length);
    for (const e of consoleErrors) console.log('  - ' + e);
    console.log('pageerrors:      ' + pageErrors.length);
    for (const e of pageErrors) console.log('  - ' + e);

    const hardFail = !p1Pass || pageErrors.length > 0;
    if (hardFail) {
      console.error('[smoke-cave] FAIL — phase=' + (p1Pass ? 'pass' : 'fail')
                    + ' pageerrors=' + pageErrors.length);
      exitCode = 1;
    } else {
      console.log('[smoke-cave] OK — cohort 1 phase 1 passed');
      console.log('[smoke-cave] cohort 2…N will add phase 2 (rooms), '
                  + 'phase 3 (boss), phase 4 (reaper) — see docs/STAGE_AUTHORING.md §7');
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
