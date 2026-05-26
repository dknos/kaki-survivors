#!/usr/bin/env node
/**
 * SHOP FLATTEN smoke — guards the "flatten the sigil shop" pivot (2026-05-25).
 *
 * The 12-node branch/tier SHOP_TREE became a flat list of single-purchase
 * upgrades. This proves:
 *   1. SHOP_TREE is exactly 5 flat nodes — no branch/tier/requires fields,
 *      each with a callable effect(runState).
 *   2. Every node.effect() runs without throwing on an empty runState (the
 *      run-start applier in main.js calls these on every owned node).
 *   3. nodeUnlocked(knownId)=true / nodeUnlocked(bogus)=false (no prereqs).
 *   4. purchaseTreeNode debits sigils, marks owned, and refuses a second buy.
 *   5. DECOUPLING: the separate flat COIN stat-shop (SHOP_UPGRADES) is intact
 *      and shopLevel() still returns a number for all 6 stat ids — proving the
 *      flatten did not disturb the in-run XP curve / hero-stat shop.
 *
 * No npm install. Run: node tools/smoke-shop-flat.mjs   Port: 8807.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8807);
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
  if (!fs.existsSync(PLAY_PATH)) { console.error('[smoke-shop-flat] FAIL: playwright missing'); process.exit(2); }
  if (!fs.existsSync(PLAYWRIGHT_EXEC)) { console.error('[smoke-shop-flat] FAIL: chromium missing'); process.exit(2); }

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('[smoke-shop-flat] server on http://127.0.0.1:' + PORT);

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

    const r = await page.evaluate(async () => {
      const out = {};
      const m = await import('./src/meta.js');

      // ── 1. flat shape ──
      const tree = m.SHOP_TREE;
      out.len = Array.isArray(tree) ? tree.length : -1;
      out.badFields = tree
        .filter((n) => ('branch' in n) || ('tier' in n) || ('requires' in n))
        .map((n) => n.id);
      out.badShape = tree
        .filter((n) => typeof n.id !== 'string' || typeof n.cost !== 'number' ||
          !n.name || !n.desc || !n.icon || typeof n.effect !== 'function')
        .map((n) => n.id || '?');

      // ── 2. every effect() survives an empty runState ──
      out.effectThrew = [];
      for (const n of tree) {
        try { n.effect({}); } catch (e) { out.effectThrew.push(n.id + ': ' + e.message); }
      }

      // ── 3. nodeUnlocked: known=true, bogus=false ──
      out.knownUnlocked = m.nodeUnlocked(tree[0].id);
      out.bogusUnlocked = m.nodeUnlocked('__not_a_node__');

      // ── 4. purchase flow: debit + own + refuse-second ──
      const target = tree.find((n) => !m.nodeOwned(n.id)) || tree[0];
      out.target = target.id;
      m.grantSigils(100, 'smoke');
      const before = m.sigilCount();
      const buy1 = m.purchaseTreeNode(target.id);
      const after = m.sigilCount();
      out.buy1ok = !!(buy1 && buy1.ok);
      out.debited = before - after;          // should equal target.cost
      out.cost = target.cost;
      out.ownedAfter = m.nodeOwned(target.id);
      const buy2 = m.purchaseTreeNode(target.id);
      out.buy2refused = !!(buy2 && !buy2.ok && buy2.reason === 'already_owned');

      // ── 5. decoupling: flat coin stat-shop untouched ──
      const STAT_IDS = ['hp', 'magnet', 'speed', 'damage', 'growth', 'luck'];
      out.upgCount = Array.isArray(m.SHOP_UPGRADES) ? m.SHOP_UPGRADES.length : -1;
      out.shopLevelBad = STAT_IDS.filter((id) => typeof m.shopLevel(id) !== 'number');

      return out;
    });

    if (r.len !== 5) failures.push(`SHOP_TREE should have 5 flat nodes, has ${r.len}`);
    if (r.badFields.length) failures.push(`nodes still carry branch/tier/requires: ${JSON.stringify(r.badFields)}`);
    if (r.badShape.length) failures.push(`nodes with bad shape (missing id/cost/name/desc/icon/effect): ${JSON.stringify(r.badShape)}`);
    if (r.effectThrew.length) failures.push(`effect() threw on empty runState: ${JSON.stringify(r.effectThrew)}`);
    if (r.knownUnlocked !== true) failures.push('nodeUnlocked(knownId) should be true');
    if (r.bogusUnlocked !== false) failures.push('nodeUnlocked(bogusId) should be false');
    if (!r.buy1ok) failures.push('purchaseTreeNode failed on a fresh affordable node');
    if (r.debited !== r.cost) failures.push(`purchase debited ${r.debited} sigils, expected ${r.cost}`);
    if (!r.ownedAfter) failures.push('node not marked owned after purchase');
    if (!r.buy2refused) failures.push('second purchase of an owned node was not refused (already_owned)');
    if (r.upgCount !== 6) failures.push(`SHOP_UPGRADES (flat coin shop) should be intact at 6, is ${r.upgCount}`);
    if (r.shopLevelBad.length) failures.push(`shopLevel() not numeric for: ${JSON.stringify(r.shopLevelBad)} (XP-curve decoupling broken)`);
    if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));

    console.log(`  len=${r.len} badFields=${JSON.stringify(r.badFields)} badShape=${JSON.stringify(r.badShape)} effectThrew=${r.effectThrew.length} | unlocked known=${r.knownUnlocked}/bogus=${r.bogusUnlocked} | buy ${r.target}: ok=${r.buy1ok} debit=${r.debited}/${r.cost} owned=${r.ownedAfter} refuse2=${r.buy2refused} | upg=${r.upgCount} shopLevelBad=${JSON.stringify(r.shopLevelBad)}`);
  } catch (e) {
    failures.push('exception: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('\n========== SUMMARY ==========');
  if (failures.length) {
    console.error('[smoke-shop-flat] FAIL (' + failures.length + '):');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('[smoke-shop-flat] PASS — 5 flat nodes, effects safe, purchase debits+owns, coin shop decoupled');
  process.exit(0);
}

main().catch((e) => { console.error('[smoke-shop-flat] FATAL', e); process.exit(2); });
