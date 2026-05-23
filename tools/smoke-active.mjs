#!/usr/bin/env node
/**
 * ACTIVE-ABILITY smoke — guards the DMD-hybrid pivot Iter C.
 *
 * The active is a drafted, cooldown-gated cast (Nova Burst v1). This boots a
 * real run and proves:
 *   1. acquireActive('nova') equips it (state.hero.active = nova, level 1).
 *   2. activeChoices() offers it to the draft (kind:'active').
 *   3. Casting it off-cooldown damages a nearby enemy (synchronous hp drop or
 *      kill — no frame elapses, so other weapons can't confound it) and arms
 *      the cooldown; a second immediate cast is refused (on cooldown).
 *
 * No npm install. Run: node tools/smoke-active.mjs   Port: 8803.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8803);
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
  if (!fs.existsSync(PLAY_PATH)) { console.error('[smoke-active] FAIL: playwright missing'); process.exit(2); }
  if (!fs.existsSync(PLAYWRIGHT_EXEC)) { console.error('[smoke-active] FAIL: chromium missing'); process.exit(2); }

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('[smoke-active] server on http://127.0.0.1:' + PORT);

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
    await page.evaluate(() => window.kkStartRun());
    await page.waitForFunction(() => window.kkState && window.kkState.started, null, { timeout: BOOT_TIMEOUT_MS }).catch(() => {});

    // 1) equip + 2) draft presence
    const equip = await page.evaluate(async () => {
      const act = await import('./src/weapons/actives.js');
      act.acquireActive('nova');
      const a = window.kkState.hero.active;
      const choices = act.activeChoices() || [];
      return {
        equipped: !!(a && a.id === 'nova' && a.level === 1),
        inChoices: choices.some((c) => c.id === 'nova' && c.kind === 'active'),
      };
    });
    if (!equip.equipped) failures.push('acquireActive did not equip nova at level 1');
    if (!equip.inChoices) failures.push('activeChoices() did not offer nova (kind:active)');

    // 3) cast damages a near enemy + arms cooldown + refuses while on cooldown
    const cast = await page.evaluate(async () => {
      const act = await import('./src/weapons/actives.js');
      const s = window.kkState;
      const a = s.hero.active;
      // Wait for any enemy, then move the HERO onto it (not the enemy — that
      // would desync the spatial hash queryRadius reads). Casting then blasts it.
      const deadline = Date.now() + 14000;
      let e = null;
      while (Date.now() < deadline) {
        e = (s.enemies.active || []).find((x) => x && x.alive);
        if (e) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!e) return { noEnemy: true };
      const ep = e.mesh ? e.mesh.position : e.pos;
      s.hero.pos.x = ep.x; s.hero.pos.z = ep.z;   // stand on the target
      const before = e.hp;
      a.cd = 0;
      const ok = act.castActive();
      const after = e.alive ? e.hp : -1;            // dead counts as damaged
      const cdArmed = a.cd > 0;
      const refused = act.castActive() === false;   // immediate re-cast blocked
      return { ok, before, after, damaged: after < before, cdArmed, refused };
    });
    if (cast.noEnemy) failures.push('no enemy came within blast radius in 14s — cannot verify cast');
    else {
      if (!cast.ok) failures.push('castActive() returned false off-cooldown (should have fired)');
      if (!cast.damaged) failures.push(`cast did not damage the near enemy (hp ${cast.before} -> ${cast.after})`);
      if (!cast.cdArmed) failures.push('cast did not arm the cooldown');
      if (!cast.refused) failures.push('second immediate cast was NOT refused (cooldown not gating)');
    }

    if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));
    console.log(`  equipped=${equip.equipped} inChoices=${equip.inChoices} | cast ok=${cast.ok} hp ${cast.before}->${cast.after} cdArmed=${cast.cdArmed} refused=${cast.refused}`);
  } catch (e) {
    failures.push('exception: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('\n========== SUMMARY ==========');
  if (failures.length) {
    console.error('[smoke-active] FAIL (' + failures.length + '):');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('[smoke-active] PASS — active equips, drafts, casts (damages + cooldown-gates)');
  process.exit(0);
}

main().catch((e) => { console.error('[smoke-active] FATAL', e); process.exit(2); });
