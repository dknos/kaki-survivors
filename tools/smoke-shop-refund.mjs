#!/usr/bin/env node
/**
 * SHOP REFUND smoke — guards the one-time orphaned-sigil refund migration that
 * accompanies the 2026-05-25 shop flatten.
 *
 * When the 12-node tree became 5 flat nodes, 7 node ids were dropped. A player
 * who had bought any of them spent sigils on something that no longer applies,
 * so loadMeta() refunds their original cost ONCE (idempotent via shopTreeV2).
 *
 * Proves, by seeding a pre-flatten save into localStorage and reloading:
 *   1. Sigils spent on DROPPED nodes are refunded at their original cost.
 *   2. Sigils spent on KEPT nodes are NOT refunded (owned flag retained).
 *   3. The migration stamps meta.shopTreeV2 = true.
 *   4. Reloading again does NOT refund a second time (idempotent).
 *
 * No npm install. Run: node tools/smoke-shop-refund.mjs   Port: 8808.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8808);
const BOOT_TIMEOUT_MS = 90000;

// Pre-flatten save: two dropped nodes (critical-eye 12 + magpie 4 = 16 refund)
// plus one KEPT node (iron-skin) that must NOT be refunded. Starting sigils 5.
const SAVE_KEY_V2 = 'kk-survivors-meta-v2';
const SEED = {
  migrationVersion: 2,
  sigils: 5,
  shopTree: { 'power-3-critical-eye': 1, 'greed-1-magpie': 1, 'survival-1-iron-skin': 1 },
};
const EXPECTED_REFUND = 12 + 4;            // critical-eye + magpie
const EXPECTED_SIGILS = 5 + EXPECTED_REFUND;

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

async function readSigils(page) {
  return page.evaluate(async () => {
    const m = await import('./src/meta.js');
    const meta = m.getMeta();
    return { sigils: m.sigilCount(), stampV2: !!meta.shopTreeV2, ironKept: !!m.nodeOwned('survival-1-iron-skin') };
  });
}

async function main() {
  if (!fs.existsSync(PLAY_PATH)) { console.error('[smoke-shop-refund] FAIL: playwright missing'); process.exit(2); }
  if (!fs.existsSync(PLAYWRIGHT_EXEC)) { console.error('[smoke-shop-refund] FAIL: chromium missing'); process.exit(2); }

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('[smoke-shop-refund] server on http://127.0.0.1:' + PORT);

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
    const url = 'http://127.0.0.1:' + PORT + '/index.html?smoke=1';
    await page.goto(url, { waitUntil: 'load', timeout: BOOT_TIMEOUT_MS });
    await page.waitForFunction(() => typeof window.kkStartRun === 'function' && window.kkState, null, { timeout: BOOT_TIMEOUT_MS });

    // Seed the pre-flatten save, overwriting whatever the fresh boot wrote.
    await page.evaluate(([key, seed]) => {
      localStorage.setItem(key, JSON.stringify(seed));
    }, [SAVE_KEY_V2, SEED]);

    // Reload → fresh JS context → loadMeta reads the seed → migration fires.
    await page.reload({ waitUntil: 'load', timeout: BOOT_TIMEOUT_MS });
    await page.waitForFunction(() => typeof window.kkStartRun === 'function' && window.kkState, null, { timeout: BOOT_TIMEOUT_MS });
    const first = await readSigils(page);

    // Reload once more → migration must see the stamp and NOT refund again.
    await page.reload({ waitUntil: 'load', timeout: BOOT_TIMEOUT_MS });
    await page.waitForFunction(() => typeof window.kkStartRun === 'function' && window.kkState, null, { timeout: BOOT_TIMEOUT_MS });
    const second = await readSigils(page);

    if (first.sigils !== EXPECTED_SIGILS) failures.push(`after refund sigils=${first.sigils}, expected ${EXPECTED_SIGILS} (5 + ${EXPECTED_REFUND})`);
    if (!first.stampV2) failures.push('migration did not stamp shopTreeV2');
    if (!first.ironKept) failures.push('kept node (iron-skin) lost its owned flag');
    if (second.sigils !== EXPECTED_SIGILS) failures.push(`idempotency broken: 2nd load sigils=${second.sigils}, expected ${EXPECTED_SIGILS}`);
    if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));

    console.log(`  after-refund: sigils=${first.sigils} stampV2=${first.stampV2} ironKept=${first.ironKept} | reload-again: sigils=${second.sigils} (expected ${EXPECTED_SIGILS} both)`);
  } catch (e) {
    failures.push('exception: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('\n========== SUMMARY ==========');
  if (failures.length) {
    console.error('[smoke-shop-refund] FAIL (' + failures.length + '):');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('[smoke-shop-refund] PASS — orphaned nodes refunded once, kept nodes spared, idempotent');
  process.exit(0);
}

main().catch((e) => { console.error('[smoke-shop-refund] FATAL', e); process.exit(2); });
