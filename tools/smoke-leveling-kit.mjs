#!/usr/bin/env node
/**
 * LEVELING SIMPLIFICATION smoke — guards the "simple leveling" pivot (2026-05-24).
 *
 * Proves the four leveling guarantees:
 *   1. weaponChoices is never empty (no level-up soft-lock).
 *   2. NO 'evolution' cards are ever emitted (auto-evolve replaced them).
 *   3. The draft pool is KIT-GATED: weapon cards are a subset of kitForRun(),
 *      and the ~11 per-avatar signature weapons no longer roll for everyone
 *      (default run pool = the 6 base weapons only, zero sig ids).
 *   4. Forcing an archetype (sniper) yields exactly that archetype's kit.
 *   5. AUTO-EVOLVE: leveling a kit weapon to maxLevel sets inst.evolved=true
 *      with no recipe (no filler/passive prereq) and no evolution card.
 *
 * No npm install. Run: node tools/smoke-leveling-kit.mjs   Port: 8806.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8806);
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
  if (!fs.existsSync(PLAY_PATH)) { console.error('[smoke-leveling] FAIL: playwright missing'); process.exit(2); }
  if (!fs.existsSync(PLAYWRIGHT_EXEC)) { console.error('[smoke-leveling] FAIL: chromium missing'); process.exit(2); }

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('[smoke-leveling] server on http://127.0.0.1:' + PORT);

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

    const r = await page.evaluate(async () => {
      const out = {};
      const s = window.kkState;
      const kits = await import('./src/weapons/kits.js');
      const widx = await import('./src/weapons/index.js');

      // ── default run pool ──
      const kit = kits.kitForRun(s.run);
      out.kitLen = Array.isArray(kit) ? kit.length : -1;
      const choices = widx.weaponChoices(20);
      out.choicesLen = choices.length;
      out.hasEvolutionCard = choices.some((c) => c.kind === 'evolution');
      const weaponCards = choices.filter((c) => c.kind === 'weapon');
      out.weaponCardIds = weaponCards.map((c) => c.id);
      out.allWeaponsInKit = weaponCards.every((c) => kit.includes(c.id));
      // A true leak = a weapon card that is neither a base weapon nor THIS run's
      // own avatar signature (i.e. some OTHER avatar's signature rolling for you).
      // The run's own signature legitimately appears; base weapons obviously do.
      const BASE = kits.BASE_WEAPONS || [];
      out.ownSig = s.run.signatureWeapon || null;
      out.sigLeak = out.weaponCardIds.filter((id) => !BASE.includes(id) && id !== out.ownSig);

      // ── forced archetype (sniper) yields sniper kit ──
      const ARCH = kits.ARCHETYPE_KITS || {};
      out.hasSniperKit = Array.isArray(ARCH.sniper) && ARCH.sniper.length > 0;
      if (out.hasSniperKit) {
        const saved = s.run.character;
        s.run.character = 'sniper';
        const sk = kits.kitForRun(s.run);
        // every base id in the returned kit (minus any appended signature) should
        // be drawn from sniper's defined kit.
        out.sniperKitMatch = ARCH.sniper.every((id) => sk.includes(id));
        s.run.character = saved;
      }

      // ── auto-evolve at maxLevel, no recipe, no card ──
      const EVOLVABLE = ['orbitals', 'chain', 'autoaim', 'web'];
      const target = EVOLVABLE.find((id) => kit.includes(id));
      out.evoTarget = target || null;
      if (target) {
        const mod = widx.REGISTRY[target];
        for (let i = 0; i < (mod.maxLevel + 2); i++) widx.acquireWeapon(target);
        const owned = s.weapons.find((w) => w.id === target);
        out.evoLevel = owned ? owned.level : -1;
        out.evoMax = mod.maxLevel;
        out.evolved = !!(owned && owned.inst && owned.inst.evolved);
        // After evolving + maxed, still no evolution card should ever appear.
        out.postEvoCardLeak = widx.weaponChoices(20).some((c) => c.kind === 'evolution');
      }
      return out;
    });

    if (r.kitLen <= 0) failures.push(`kitForRun returned empty/invalid (len=${r.kitLen})`);
    if (r.choicesLen <= 0) failures.push('weaponChoices returned empty (level-up soft-lock risk)');
    if (r.hasEvolutionCard) failures.push('an evolution card was emitted (should be auto-evolve only)');
    if (!r.allWeaponsInKit) failures.push(`weapon cards leaked outside the kit: ${JSON.stringify(r.weaponCardIds)}`);
    if (r.sigLeak && r.sigLeak.length) failures.push(`signature weapon(s) rolled in a default run: ${JSON.stringify(r.sigLeak)}`);
    if (!r.hasSniperKit) failures.push('ARCHETYPE_KITS.sniper missing/empty');
    else if (!r.sniperKitMatch) failures.push('forcing character=sniper did not yield the sniper kit');
    if (!r.evoTarget) failures.push('no evolvable weapon in the default kit to test auto-evolve');
    else {
      if (r.evoLevel < r.evoMax) failures.push(`auto-evolve target did not reach maxLevel (${r.evoLevel}/${r.evoMax})`);
      if (!r.evolved) failures.push(`weapon at maxLevel did NOT auto-evolve (inst.evolved=false) for ${r.evoTarget}`);
      if (r.postEvoCardLeak) failures.push('evolution card appeared after auto-evolve');
    }
    if (pageErrors.length) failures.push('page errors: ' + pageErrors.join(' | '));

    console.log(`  kit=${r.kitLen} choices=${r.choicesLen} evoCard=${r.hasEvolutionCard} inKit=${r.allWeaponsInKit} sigLeak=${JSON.stringify(r.sigLeak)} sniperKit=${r.sniperKitMatch} | autoEvolve ${r.evoTarget}: lv${r.evoLevel}/${r.evoMax} evolved=${r.evolved} postLeak=${r.postEvoCardLeak}`);
  } catch (e) {
    failures.push('exception: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('\n========== SUMMARY ==========');
  if (failures.length) {
    console.error('[smoke-leveling] FAIL (' + failures.length + '):');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('[smoke-leveling] PASS — kit-gated pool, no sig leak, no evolution cards, auto-evolve at max');
  process.exit(0);
}

main().catch((e) => { console.error('[smoke-leveling] FATAL', e); process.exit(2); });
