#!/usr/bin/env node
/**
 * PRIMARY SLOT smoke — guards the DMD-hybrid pivot Iter B.
 *
 * The primary is a NEW always-equipped, player-aimed, hold-to-fire weapon. This
 * boots a real run and proves:
 *   1. 'primary' is auto-equipped at run start (state.weapons contains it).
 *   2. It is hidden from the level-up draft (weaponChoices never offers it).
 *   3. With the auto-fire toggle on and enemies present, it actually fires —
 *      projectiles tagged ownerWeapon='primary' appear in state.projectiles.
 *
 * Headless has no mouse movement, so isManualAiming() is false and the primary
 * auto-targets the nearest enemy (deterministic). No npm install.
 * Run: node tools/smoke-primary.mjs   Port: 8802.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8802);
const BOOT_TIMEOUT_MS = 90000;

function mime(p) {
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'application/javascript';
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.css'))  return 'text/css';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.glb'))  return 'model/gltf-binary';
  if (p.endsWith('.png'))  return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.svg'))  return 'image/svg+xml';
  if (p.endsWith('.mp3'))  return 'audio/mpeg';
  return 'application/octet-stream';
}
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const full = path.resolve(ROOT, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  const within = path.relative(ROOT, full);
  if (within.startsWith('..') || path.isAbsolute(within)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': mime(full), 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const PLAY_PATH = '/home/nemoclaw/node_modules/playwright';
const PLAYWRIGHT_EXEC = '/home/nemoclaw/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

async function main() {
  if (!fs.existsSync(PLAY_PATH)) { console.error('[smoke-primary] FAIL: playwright missing'); process.exit(2); }
  if (!fs.existsSync(PLAYWRIGHT_EXEC)) { console.error('[smoke-primary] FAIL: chromium missing'); process.exit(2); }

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('[smoke-primary] server on http://127.0.0.1:' + PORT);

  const { chromium } = require(PLAY_PATH);
  const browser = await chromium.launch({
    executablePath: PLAYWRIGHT_EXEC, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const failures = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:' + PORT + '/index.html?smoke=1', { waitUntil: 'load', timeout: BOOT_TIMEOUT_MS });
    await page.waitForFunction(() => typeof window.kkStartRun === 'function' && window.kkState, null, { timeout: BOOT_TIMEOUT_MS });

    // Start a real run + force the auto-fire toggle so the primary fires without
    // a synthetic mouse-hold.
    await page.evaluate(async () => {
      const m = await import('./src/meta.js');
      try { m.setOption('optAutoFirePrimary', true); } catch (_) {}
      window.kkStartRun();
    });

    // 1) Primary equipped once the run's weapons are populated.
    await page.waitForFunction(
      () => window.kkState && window.kkState.started &&
            Array.isArray(window.kkState.weapons) &&
            window.kkState.weapons.some((w) => w.id === 'primary'),
      null, { timeout: BOOT_TIMEOUT_MS },
    ).catch(() => {});
    const equip = await page.evaluate(() => {
      const s = window.kkState;
      return {
        started: !!(s && s.started),
        hasPrimary: !!(s && s.weapons && s.weapons.some((w) => w.id === 'primary')),
        count: (s && s.weapons && s.weapons.filter((w) => w.id === 'primary').length) || 0,
      };
    });
    if (!equip.started) failures.push('run did not start (state.started false)');
    if (!equip.hasPrimary) failures.push('primary NOT auto-equipped at run start');
    if (equip.count > 1) failures.push(`primary equipped ${equip.count}x — should be exactly 1 (idempotency leak)`);

    // 2) Hidden from the draft pool.
    const inDraft = await page.evaluate(async () => {
      const w = await import('./src/weapons/index.js');
      let offered = false;
      for (let i = 0; i < 12; i++) {
        const choices = w.weaponChoices(3) || [];
        if (choices.some((c) => c.id === 'primary')) { offered = true; break; }
      }
      return offered;
    });
    if (inDraft) failures.push('primary appeared in the level-up draft (should be hidden:true)');

    // 3) It fires: wait for an enemy, then watch for primary-tagged projectiles.
    const fired = await page.evaluate(async () => {
      const deadline = Date.now() + 12000;
      let sawEnemy = false, sawProj = false, maxPrimary = 0;
      while (Date.now() < deadline) {
        const s = window.kkState;
        const enemies = (s && s.enemies && s.enemies.active) || [];
        if (enemies.length > 0) sawEnemy = true;
        const projs = (s && s.projectiles && s.projectiles.active) || [];
        const np = projs.filter((p) => p.ownerWeapon === 'primary').length;
        if (np > maxPrimary) maxPrimary = np;
        if (np > 0) { sawProj = true; break; }
        await new Promise((r) => setTimeout(r, 150));
      }
      return { sawEnemy, sawProj, maxPrimary };
    });
    if (!fired.sawEnemy) failures.push('no enemies spawned in 12s — cannot verify firing');
    else if (!fired.sawProj) failures.push('primary never fired (no ownerWeapon=primary projectiles despite enemies + auto-fire on)');

    if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));
    console.log(`  equipped=${equip.hasPrimary} (x${equip.count})  inDraft=${inDraft}  sawEnemy=${fired.sawEnemy}  primaryProjectiles=${fired.maxPrimary}`);
  } catch (e) {
    failures.push('exception: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('\n========== SUMMARY ==========');
  if (failures.length) {
    console.error('[smoke-primary] FAIL (' + failures.length + '):');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('[smoke-primary] PASS — primary auto-equips, stays out of the draft, and fires aimed projectiles');
  process.exit(0);
}

main().catch((e) => { console.error('[smoke-primary] FATAL', e); process.exit(2); });
