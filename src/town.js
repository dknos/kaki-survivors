/**
 * Town hub — walkable plaza between runs.
 *
 * Phase-1 scaffold: stone plaza, cabin (future House upgrades), Adventure Gate
 * (starts a run on E), four lamp posts. The town group attaches to the main
 * scene and toggles visible based on state.mode === 'town'.
 *
 * In town mode, main.js runs a stripped-down tick (input + hero + fx + camera)
 * with no spawn director, weapons, enemies, or pickups.
 *
 * Interactables are a flat list: {pos, radius, label, key}. tickTown finds
 * the closest one inside its trigger radius and shows the [E] prompt; pressing
 * E fires the activate handler.
 */
import * as THREE from 'three';
import { state } from './state.js';
import { CHARACTERS } from './config.js';
import { getMeta, setOption } from './meta.js';
import { initChatBindings, tickBubbles, pushBubble, setSpeakerAnchor } from './chatBubble.js';
import { bindPrompt, setPromptLabel, formatPrompt } from './buttonPrompts.js';
import { BLOOM_LAYER } from './postfx.js';
import { makeRuneRingTexture } from './enemyTells.js';
import { cloneCached } from './assets.js';
import { sfx } from './audio.js';
import { tex } from './particleTextures.js';

// Shared rune-ring texture for town FX (statue selection ring). Cached on
// first call so every statue + the catacomb / interior swaps share one upload.
let _runeTex = null;
function _getRuneTex() { return _runeTex || (_runeTex = makeRuneRingTexture()); }

const PLAZA_R = 18;
const FENCE_R = 22;

let _group = null;
let _portal = null;
let _portalLight = null;            // portal PointLight (CC8 gate-launch flare spike)
let _promptEl = null;
let _promptBinding = null;
let _activeKey = null;
let _onGateActivate = null;
// CC8 gate-launch flourish — a brief "whoosh into the adventure" beat on gate E
// before the real run-start fires. The flare itself is animated in tickTown.
let _gateFlourishUntil = 0;         // state.time.real when the launch flare ends
let _gateLaunchPending = false;     // guard: ignore repeat E during the flare
const GATE_FLOURISH_SEC = 0.26;     // flare duration before run-start (tunable feel knob)
const _handlers = {};

// Static interactables — character statues are appended dynamically in buildTown.
const _interactables = [
  { pos: { x: 0, z: 14 },  radius: 3.5, label: '⚔  Enter the Hunt',      key: 'gate'  },
  { pos: { x: 0, z: -14 }, radius: 4.0, label: '🏠  Enter the House',    key: 'house' },
  { pos: { x: -12, z: -3 }, radius: 3.0, label: '🛒  Shop · Spend embers', key: 'shop'  },
];
// Per-character statue refs so we can repaint selection rings on select.
const _statueRefs = {};

// Hellfire Brazier — force-trigger next-run Helltide. localStorage flag
// `kk_helltide_queued` persists across the run-start so helltide.js init can
// read + consume it without touching main.js.
const HELLTIDE_QUEUED_KEY = 'kk_helltide_queued';
let _brazier = null;             // THREE.Group
let _brazierFlames = [];         // [{mesh, baseY, phase, scale}]
let _brazierLight = null;        // PointLight ref for intensity pulse
let _brazierIntenseUntil = 0;    // state.time.real when the "hotter" glow ends

// Seedy Tent (Casino — iter 22B). Cone tent + dark entrance + flickering red
// lantern that wobbles via lerp in tickTown. Locked until first Catacomb Void
// clear (meta.unlockedVoid). Interactable lives in _interactables; the activate
// handler is wired in main.js via setInteractionHandler('casino', ...).
let _tent = null;                // THREE.Group
let _tentLight = null;           // PointLight ref for flicker
let _tentLanternMesh = null;     // small additive disc on the lantern shell

// Wandering town NPC (CC5 town cohort 2) — a robed sage-cat that ambles the
// open central plaza and chatters via chatBubble.js. Its first line per visit is
// keyed off the townVisits counter (returning-player dressing, folded in here);
// then it cycles flavor barks themed to the plaza's interactables. Speaker id
// is named after the concept so a future 2nd NPC isn't a rename.
const NPC_SPEAKER_ID = 'townSage';
let _npc = null;   // { group, pos, target, speed, nextBarkAt, firstBarkDone, barkIndex }
const NPC_BARKS = [
  'Mind the brazier — it bites back if you provoke it.',
  'The Grimoire holds recipes even I have half-forgotten.',
  'Spend your embers before the gate, hm? Coin is no use to the dead.',
  'The statues remember every champion. Choose yours.',
  'I have watched kittens stroll through that gate and never... well. Off you go.',
];

// Gate biome dressing (CC6 town cohort 3) — the emissive growth in the two
// planters flanking the Adventure Gate recolors to preview the SELECTED stage's
// biome, so the gate reads as "the way to <destination>". Keyed off
// getMeta().selectedStage (set in menuV2); falls back to forest for any stage
// without an entry. Recolors a shared material per planter (see _applyGateBiome).
const _GATE_BIOME = {
  forest:   { color: 0x3f7a3a, emissive: 0x4caf50 },  // verdant foliage
  cave:     { color: 0x1f4a40, emissive: 0x7fffe4 },  // glowmoss (CAVE_PALETTE.moss)
  twilight: { color: 0x4a3a6a, emissive: 0x9a6fc0 },  // dusk violet
  cinder:   { color: 0x6a2a16, emissive: 0xff6a28 },  // ember orange
  void:     { color: 0x2a1840, emissive: 0xc87bff },  // sigil violet
};
let _gateBiomeMats = [];   // shared growth materials of the flanking planters

function _matStandard(color, roughness = 0.85, metalness = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function _makeCabin() {
  // Iter 14: Quaternius fantasy_house GLB replaces the BoxGeometry shell.
  // Glowing windows + a roof-side chimney overlay sell "home" — we keep
  // the PointLight cue inside.
  const g = new THREE.Group();
  const kit = cloneCached('kit_house');
  if (kit) {
    kit.scale.setScalar(4.2);
    kit.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    g.add(kit);
  } else {
    // Fallback: small dark hut so the door interactable still has visible mass.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(7, 4, 5), _matStandard(0x6a4a30, 0.85),
    );
    body.position.y = 2; body.castShadow = true;
    g.add(body);
  }
  // Warm interior-light cue at the front porch (existing pattern — sells
  // "the lights are on, walk in").
  const porchLight = new THREE.PointLight(0xffd28a, 0.7, 7, 2);
  porchLight.position.set(0, 2.4, 3.0);
  g.add(porchLight);
  return g;
}

function _makeAdventureGate() {
  // Iter 14: Quaternius castle_gate GLB. Keep the animated turquoise portal
  // disc + point light on top (this is the iconic "exit to adventure" cue
  // and the in-game audio is timed to its sine pulse).
  const g = new THREE.Group();
  const kit = cloneCached('kit_gate');
  if (kit) {
    kit.scale.setScalar(3.5);
    kit.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    g.add(kit);
  } else {
    // Fallback: two-pillar stone arch.
    for (const x of [-2.4, 2.4]) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 4.2, 0.9), _matStandard(0x5a5550, 0.9),
      );
      p.position.set(x, 2.1, 0);
      p.castShadow = true;
      g.add(p);
    }
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 0.9, 1.0), _matStandard(0x5a5550, 0.9),
    );
    lintel.position.set(0, 4.65, 0);
    g.add(lintel);
  }
  // Glowing portal disc — flat mint puddle, no radial spoke art so it
  // doesn't read as "lines radiating across the plaza". Iter 28c's rune-
  // tex + additive blending caused the rune's 24 tick marks + 48 outer
  // hair ticks to bleed through everything in town.
  _portal = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 36),
    new THREE.MeshBasicMaterial({
      color: 0x7fffd4, transparent: true, opacity: 0.55, depthWrite: false,
    }),
  );
  _portal.rotation.x = -Math.PI / 2;
  _portal.position.set(0, 0.06, 0);
  g.add(_portal);
  // Portal point light
  const pl = new THREE.PointLight(0x7fffd4, 1.8, 14, 2);
  pl.position.set(0, 1.6, 0);
  g.add(pl);
  _portalLight = pl;   // CC8: spiked during the gate-launch flare
  return g;
}

function _makeLamp() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 3.4, 8),
    _matStandard(0x222020, 0.85, 0.3),
  );
  post.position.y = 1.7;
  post.castShadow = true;
  g.add(post);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd86a, emissive: 0xffb050, emissiveIntensity: 1.4 }),
  );
  head.position.y = 3.5;
  g.add(head);
  const pl = new THREE.PointLight(0xffb050, 0.9, 9, 2);
  pl.position.y = 3.4;
  g.add(pl);
  return g;
}

// Statue pedestal — `ch` is a CHARACTERS entry. `unlocked` toggles dim/lit.
function _makeCharStatue(ch, unlocked) {
  const g = new THREE.Group();
  // Selection ring under base (shown only for currently-picked character).
  // Iter 10b FX residue cleanup: swapped from flat RingGeometry +
  // MeshBasicMaterial to PlaneGeometry + makeRuneRingTexture so the statue
  // selection cue matches the rest of the game's "rune-warning" art
  // language (chest halo, elite tells, boss telegraphs all share the same tex).
  // Gold tint per brief — Hades-style "you are the chosen one" warmth.
  const ringGeo = new THREE.PlaneGeometry(3.1, 3.1);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({
      map: _getRuneTex(),
      color: 0xffd24a, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  ring.position.y = 0.04;
  ring.visible = false;
  ring.layers.enable(BLOOM_LAYER);
  g.add(ring);
  g.userData._selRing = ring;

  // Pedestal base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 16), _matStandard(0x3a3530, 0.9));
  base.position.y = 0.25;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.2, 16), _matStandard(0x5a5550, 0.85));
  top.position.y = 0.6;
  g.add(top);

  // Figure — tinted by character color, scaled by character size. Locked
  // statues render as gray stone with a "?" plate.
  const tint = unlocked ? (ch.tint || 0xffffff) : 0x55514c;
  const scaleMul = (ch.scaleMul || 1.0) * (unlocked ? 1 : 0.85);
  // Body (block torso)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.0, 0.55),
    new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7, metalness: 0.05 }),
  );
  body.position.y = 1.35;
  body.scale.set(scaleMul, scaleMul, scaleMul);
  body.castShadow = true;
  g.add(body);
  // Head (sphere)
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6, metalness: 0.05 }),
  );
  head.position.y = 2.1;
  head.scale.set(scaleMul, scaleMul, scaleMul);
  head.castShadow = true;
  g.add(head);
  // Cape-ish back plate for silhouette variety (small box on back)
  const cape = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.08),
    new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85, metalness: 0.0 }),
  );
  cape.position.set(0, 1.4, -0.32);
  cape.scale.set(scaleMul, scaleMul, scaleMul);
  cape.castShadow = true;
  g.add(cape);

  if (!unlocked) {
    // Floating "?" plate above the head for clarity
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    plate.position.y = 2.85;
    g.add(plate);
  } else {
    // Subtle accent point light over unlocked statues
    const pl = new THREE.PointLight(tint, 0.6, 4, 2);
    pl.position.y = 2.2;
    g.add(pl);
  }
  return g;
}

function _makeShopStall() {
  const g = new THREE.Group();
  // Counter
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.2, 1.4), _matStandard(0x6a4a30, 0.85));
  counter.position.y = 0.6;
  counter.castShadow = true; counter.receiveShadow = true;
  g.add(counter);
  // Awning poles
  for (const x of [-1.3, 1.3]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), _matStandard(0x2a2018, 0.9));
    p.position.set(x, 2.0, 0);
    g.add(p);
  }
  // Striped awning (red + cream alternating planes)
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 1.6),
      new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0xc23a3a : 0xece2cc, roughness: 0.9, side: THREE.DoubleSide,
      }),
    );
    stripe.position.set(-1.35 + i * 0.54, 3.0, 0.4);
    stripe.rotation.x = -Math.PI / 3;
    g.add(stripe);
  }
  return g;
}

// Grimoire lectern (CC3 town cohort 1) — a stone reading-stand with a glowing
// open book on top. E opens the evolution Grimoire (ui.showGrimoire). Visual:
// short pillar + angled slab + an emissive-violet book on the bloom layer so
// it reads as arcane from across the plaza.
function _makeGrimoirePedestal() {
  const g = new THREE.Group();
  // Pillar base
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.2, 10), _matStandard(0x4a4a52, 0.92));
  post.position.y = 0.6;
  post.castShadow = true; post.receiveShadow = true;
  g.add(post);
  // Angled reading slab
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.0), _matStandard(0x6a4a30, 0.85));
  slab.position.set(0, 1.28, 0);
  slab.rotation.x = -Math.PI / 7;
  slab.castShadow = true;
  g.add(slab);
  // Open book — two emissive violet pages on the bloom layer.
  const pageMat = new THREE.MeshStandardMaterial({
    color: 0x2a1840, emissive: 0xc87bff, emissiveIntensity: 0.7,
    roughness: 0.6, side: THREE.DoubleSide,
  });
  for (const sx of [-1, 1]) {
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), pageMat);
    page.position.set(sx * 0.3, 1.4, 0);
    page.rotation.set(-Math.PI / 7, sx * 0.18, 0);
    page.layers.enable(BLOOM_LAYER);
    g.add(page);
  }
  return g;
}

// Wandering sage-cat NPC (CC5 town cohort 2). Cheap primitives, dusk-violet
// robe + cream fur so it reads distinct from the gray statues and the player
// hero: tapered robe, round head, two ear cones, an arched tail, and a
// gem-tipped staff (bloom-layer gem sells "sage"). Animated in _tickNpc.
function _makeTownNpc() {
  const g = new THREE.Group();
  const ROBE = 0x6a4a8c;   // dusk-violet (distinct from town's warm browns/golds)
  const FUR  = 0xd9b88a;   // warm cream
  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.5, 1.2, 12), _matStandard(ROBE, 0.8),
  );
  robe.position.y = 0.6;
  robe.castShadow = true;
  g.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), _matStandard(FUR, 0.7));
  head.position.y = 1.45;
  head.castShadow = true;
  g.add(head);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 6), _matStandard(FUR, 0.7));
    ear.position.set(sx * 0.16, 1.7, 0);
    ear.castShadow = true;
    g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.7, 6), _matStandard(FUR, 0.7));
  tail.position.set(0, 0.7, -0.4);
  tail.rotation.x = 0.9;
  g.add(tail);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), _matStandard(0x3a2a18, 0.9));
  staff.position.set(0.34, 0.75, 0.1);
  g.add(staff);
  const gem = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a1840, emissive: 0xc87bff, emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  gem.position.set(0.34, 1.55, 0.1);
  gem.layers.enable(BLOOM_LAYER);
  g.add(gem);
  return g;
}

// Gate biome planter (CC6) — a stone urn holding 3 emissive "growth" shards
// (foliage / crystal / ember, read by recolor). The three shards share ONE
// material so _applyGateBiome can retint the whole planter in a single write;
// the material is stashed on userData._growthMat for buildTown to collect.
function _makeGatePlanter() {
  const g = new THREE.Group();
  const urn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.55, 0.7, 10),
    _matStandard(0x4a4a52, 0.92),
  );
  urn.position.y = 0.35;
  urn.castShadow = true; urn.receiveShadow = true;
  g.add(urn);
  const growthMat = new THREE.MeshStandardMaterial({
    color: _GATE_BIOME.forest.color, emissive: _GATE_BIOME.forest.emissive,
    emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.05,
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6 + i * 0.12, 6), growthMat);
    shard.position.set(Math.cos(a) * 0.18, 0.95 + i * 0.06, Math.sin(a) * 0.18);
    shard.rotation.z = (i - 1) * 0.18;
    shard.layers.enable(BLOOM_LAYER);
    g.add(shard);
  }
  g.userData._growthMat = growthMat;
  return g;
}

// Recolor the gate planters' growth to the selected stage's biome. Falls back
// to forest for any unmapped stage. Cheap (≤2 material writes) — safe to call
// every enterTown.
function _applyGateBiome(stageId) {
  const b = _GATE_BIOME[stageId] || _GATE_BIOME.forest;
  for (const mat of _gateBiomeMats) {
    if (!mat) continue;
    try { mat.color.setHex(b.color); mat.emissive.setHex(b.emissive); } catch (_) {}
  }
}

// Wander the NPC inside the open central plaza (target ring r∈[3,7] from origin
// so it never clips the statue arc / gate / shop / brazier / casino / fence)
// + run the bark scheduler. First bark per visit is townVisits-keyed; then it
// cycles NPC_BARKS. Reads hero/meta from the shared imports; no allocations.
function _tickNpc(dt) {
  if (!_npc) return;
  const p = _npc.pos, tgt = _npc.target;
  let dx = tgt.x - p.x, dz = tgt.z - p.z;
  let d = Math.hypot(dx, dz);
  if (d < 0.4) {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 4;
    tgt.x = Math.cos(a) * r;
    tgt.z = Math.sin(a) * r;
    dx = tgt.x - p.x; dz = tgt.z - p.z; d = Math.hypot(dx, dz) || 1;
  }
  const step = Math.min(_npc.speed * dt, d);
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  const grp = _npc.group;
  grp.position.x = p.x;
  grp.position.z = p.z;
  grp.position.y = 0.04 * Math.sin(state.time.real * 2.2);   // gentle amble bob
  grp.rotation.y = Math.atan2(dx, dz);                       // face travel dir

  const now = state.time.real;
  if (!_npc.firstBarkDone) {
    if (_npc.nextBarkAt === 0) _npc.nextBarkAt = now + 1.2;   // greeting lands ~1.2s after entry
    if (now >= _npc.nextBarkAt) {
      const meta = getMeta();
      const visits = (meta && meta.townVisits) | 0;
      const greet = (visits > 1)
        ? 'Back again? The Hunt has been hungry without you.'
        : 'Welcome to the Hollow, traveler. Rest before the Hunt.';
      pushBubble(NPC_SPEAKER_ID, greet);
      _npc.firstBarkDone = true;
      _npc.nextBarkAt = now + 7 + Math.random() * 3;
    }
  } else if (now >= _npc.nextBarkAt) {
    pushBubble(NPC_SPEAKER_ID, NPC_BARKS[_npc.barkIndex % NPC_BARKS.length]);
    _npc.barkIndex++;
    _npc.nextBarkAt = now + 7 + Math.random() * 3;
  }
}

// Brief confirmation toast for brazier interaction. ~2s, top-of-screen,
// hellfire amber. Self-contained — avoids cross-importing ui.js internals.
function _showBrazierToast(text) {
  const t = document.createElement('div');
  t.style.cssText = `
    position: fixed; left: 50%; top: 10%; transform: translateX(-50%);
    padding: 9px 22px; pointer-events: none; z-index: 100;
    background: linear-gradient(180deg, rgba(34,18,12,0.92), rgba(20,10,8,0.94));
    border: 1px solid rgba(255,122,40,0.6);
    border-radius: 8px;
    font-family: 'Cinzel Decorative', serif; font-size: 13px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: #ffae6a;
    text-shadow: 0 0 8px rgba(255,122,40,0.55);
    box-shadow: 0 8px 22px rgba(0,0,0,0.55), 0 0 20px rgba(255,90,40,0.30);
    animation: kk-fade-in 0.18s ease-out;
  `;
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 2000);
}

// Hellfire Brazier — stone basin + flame plume. Iter 18.
// Visual: short cone-pedestal + cylinder bowl + 5 additive flame quads that
// bob and twist on a sine. Small red point light underneath for floor bleed.
// Bowl is palette-matched dark stone; flame mat uses the glowRed particle
// texture so it picks up the bloom pass.
function _makeBrazier() {
  const g = new THREE.Group();
  // Pedestal — short cone (wide base → narrow top) reads as stone foundation
  const pedestal = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 0.95, 12, 1, true),
    _matStandard(0x3c342c, 0.92, 0.05),
  );
  pedestal.position.y = 0.48;
  pedestal.castShadow = true; pedestal.receiveShadow = true;
  g.add(pedestal);
  // Bowl — short open cylinder rim
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.55, 0.45, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2a1e16, roughness: 0.85, metalness: 0.08, side: THREE.DoubleSide,
    }),
  );
  bowl.position.y = 1.15;
  bowl.castShadow = true;
  g.add(bowl);
  // Inner ember plate — a tiny additive disc at the bottom of the bowl so the
  // brazier reads as "lit" even when the flames are at their bob trough.
  const emberDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 18),
    new THREE.MeshBasicMaterial({
      map: tex('emberWarm'),
      color: 0xff5a28, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  emberDisc.rotation.x = -Math.PI / 2;
  emberDisc.position.y = 0.98;
  emberDisc.layers.enable(BLOOM_LAYER);
  g.add(emberDisc);
  // Flame plume — 5 additive PlaneGeometry quads at varying heights & scales.
  // Each gets a phase offset so the bob/spin looks like a tongue of fire.
  const flameTex = tex('emberWarm') || tex('glowRed');
  for (let i = 0; i < 5; i++) {
    const s = 0.55 + Math.random() * 0.35;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s * 1.6),
      new THREE.MeshBasicMaterial({
        map: flameTex,
        color: 0xff7a28, transparent: true, opacity: 0.88,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    const baseY = 1.35 + Math.random() * 0.5;
    m.position.set((Math.random() - 0.5) * 0.4, baseY, (Math.random() - 0.5) * 0.4);
    m.layers.enable(BLOOM_LAYER);
    g.add(m);
    _brazierFlames.push({ mesh: m, baseY, phase: Math.random() * Math.PI * 2, scale: s });
  }
  // Floor bleed point-light — short range, red, so the flagstones around the
  // brazier get a warm wash that reads from the gate side.
  _brazierLight = new THREE.PointLight(0xff5a28, 1.4, 7, 2);
  _brazierLight.position.set(0, 1.6, 0);
  g.add(_brazierLight);
  return g;
}

// Seedy Tent — small carnival-style cone tent that houses the casino. Visual
// reads as "back-alley gambling den": dark red fabric, two wooden stakes,
// a black entrance void, and a flickering red lantern that pulses in tickTown.
// A tiny slot-cabinet peeks out of the entrance so the function is legible
// at a glance even before the player presses E. Palette-matched to the
// 8-color bible (deep red 0x7a1a1a, stake brown 0x6a4a30, lantern 0xff3a3a).
function _makeSeedyTent() {
  const g = new THREE.Group();
  // Iter 33f — Casino is the Poly by Google "Casino" CC-BY GLB (1930s neon
  // sign building on a road circle). Procedural cone tent stays as fallback
  // for the case where the GLB hasn't preloaded yet (or fails to fetch).
  const cas = cloneCached('casino_building');
  const usedGlb = !!cas;
  if (cas) {
    cas.scale.setScalar(0.018);      // source bbox ~176 units; pull to ~3.2 across
    cas.rotation.y = Math.PI;        // face the camera/hero spawn
    cas.position.y = 0.05;
    cas.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(cas);
    // Scatter poker chips at the entrance as bling. Cheap CC-BY low-poly,
    // 284 tris each, so 4 of them barely move the draw budget.
    for (let i = 0; i < 4; i++) {
      const chip = cloneCached('casino_chip');
      if (!chip) break;
      chip.scale.setScalar(6);
      chip.position.set(
        -0.6 + i * 0.4 + (Math.random() - 0.5) * 0.2,
        0.06 + i * 0.02,
        1.4 - (i % 2) * 0.15,
      );
      chip.rotation.x = -Math.PI / 2;
      chip.rotation.z = (i / 4) * Math.PI * 2;
      g.add(chip);
    }
  }
  if (!usedGlb) {
  // Vertical fabric seams — 4 thin darker stripes around the cone for
  // line-weight texture (matches the canopy/stripe pattern shop stall uses).
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const seam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x4a0e0e, side: THREE.DoubleSide }),
    );
    seam.position.set(Math.cos(a) * 1.55, 1.3, Math.sin(a) * 1.55);
    seam.lookAt(0, 1.3, 0);
    g.add(seam);
  }
  // Entrance void — flat black plane on the front. Slight glow rim around it.
  const entrance = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 1.4),
    new THREE.MeshBasicMaterial({ color: 0x080404, side: THREE.DoubleSide }),
  );
  entrance.position.set(0, 0.72, 1.62);
  g.add(entrance);
  // Two angled support stakes flanking the entrance
  for (const x of [-1.05, 1.05]) {
    const stake = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 1.55, 6),
      _matStandard(0x4a3220, 0.9, 0.05),
    );
    stake.position.set(x, 0.78, 1.3);
    stake.rotation.z = (x < 0) ? -0.18 : 0.18;
    stake.castShadow = true;
    g.add(stake);
  }
  // Tiny slot cabinet peeking out of the entrance — three-box stack (chassis,
  // window-pane, knob). Reads as "there's a real machine in there".
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.75, 0.4),
    _matStandard(0x2a2018, 0.6, 0.25),
  );
  cab.position.set(0, 0.37, 1.5);
  cab.castShadow = true;
  g.add(cab);
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.28),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  pane.position.set(0, 0.55, 1.71);
  pane.layers.enable(BLOOM_LAYER);
  g.add(pane);
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xc23a3a, roughness: 0.4, metalness: 0.4 }),
  );
  knob.position.set(0.18, 0.25, 1.71);
  g.add(knob);
  }   // end procedural-fallback block (iter 33f)
  // Hanging lantern on a tiny mast off the apex — additive disc + point light.
  // Kept unconditional so the casino has a red night-glow either way.
  const lantern = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 12),
    new THREE.MeshBasicMaterial({
      map: tex('emberWarm'),
      color: 0xff3a3a, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  lantern.position.set(0, 2.85, 0.6);
  lantern.layers.enable(BLOOM_LAYER);
  g.add(lantern);
  _tentLanternMesh = lantern;
  _tentLight = new THREE.PointLight(0xff3a3a, 1.2, 6, 2);
  _tentLight.position.set(0, 2.5, 0.6);
  g.add(_tentLight);
  return g;
}

export function buildTown(scene) {
  if (_group) return _group;
  const g = new THREE.Group();
  g.name = 'townGroup';

  // ── Plaza floor ──
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA_R, 64),
    new THREE.MeshStandardMaterial({ color: 0x8a7d6a, roughness: 0.85 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = -0.05;
  plaza.receiveShadow = true;
  g.add(plaza);
  // Darker stone border ring
  const border = new THREE.Mesh(
    new THREE.RingGeometry(PLAZA_R, PLAZA_R + 1.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x3c342c, roughness: 0.9 }),
  );
  border.rotation.x = -Math.PI / 2;
  border.position.y = -0.04;
  g.add(border);

  // ── Buildings + props ──
  const cabin = _makeCabin();
  cabin.position.set(0, 0, -14);
  g.add(cabin);

  const gate = _makeAdventureGate();
  gate.position.set(0, 0, 14);
  g.add(gate);

  const shopStall = _makeShopStall();
  shopStall.position.set(-12, 0, -3);
  shopStall.rotation.y = Math.PI / 6;
  g.add(shopStall);

  // Hellfire Brazier (iter 18) — beside the gate, offset east so it doesn't
  // compete with the gate's portal disc. Distinct from the statue arc which
  // spans roughly x∈[-7, 7], z=10.5±. The brazier sits at (8, 0, 12).
  _brazier = _makeBrazier();
  _brazier.position.set(8, 0, 12);
  g.add(_brazier);
  _interactables.push({
    pos: { x: 8, z: 12 }, radius: 2.6,
    label: '🔥  Hellfire Brazier · Force-trigger next run',
    key: 'brazier',
  });

  // Seedy Tent (Casino — iter 22B). Mirrored across the plaza from the shop
  // stall at (-12,-3): we plant the tent at (12,-3), face it inward toward the
  // hero spawn so the dark entrance reads as "come in here". Lock state is
  // resolved per-tick in tickTown (label flips on/off based on meta.unlockedVoid)
  // so the gate works even on save imports / mid-session unlocks.
  _tent = _makeSeedyTent();
  _tent.position.set(12, 0, -3);
  _tent.rotation.y = -Math.PI * 0.55;
  g.add(_tent);
  _interactables.push({
    pos: { x: 12, z: -3 }, radius: 2.8,
    label: '🎰  The Seedy Tent',
    key: 'casino',
    _casino: true,    // marker so tickTown can repaint label on cosmetic state changes
  });
  // Iter 33g — casino interactable now opens the walkable casino interior.
  // Handler installed by main.js via setInteractionHandler('casino', ...).
  _handlers.brazier = () => {
    // Persist across the town→run transition. helltide.js initHelltide() reads
    // and consumes the flag, scheduling the next event ~30s into the run
    // instead of the normal 4-6 min auto window.
    try { localStorage.setItem(HELLTIDE_QUEUED_KEY, 'true'); } catch (_) {}
    // Visual + audio feedback — ominous bell, brighter flames for 5 seconds.
    try { sfx.bossWarn(); } catch (_) {}
    _brazierIntenseUntil = state.time.real + 5;
    // Confirmation toast (DOM, similar shape to _kkShowMicroToast but
    // self-contained so town.js doesn't need to import ui internals).
    _showBrazierToast('🔥 Helltide queued for next run.');
  };

  // CC3 town cohort 1 — Grimoire lectern. Mirrored back-left of the plaza,
  // clear of gate(0,14) / house(0,-14) / shop(-12,-3) / casino(12,-3) /
  // brazier(8,12) / the statue arc (z≈10.5, x∈[-7,7]).
  const grimoire = _makeGrimoirePedestal();
  grimoire.position.set(-9, 0, -9);
  grimoire.rotation.y = Math.PI / 5;
  g.add(grimoire);
  _interactables.push({
    pos: { x: -9, z: -9 }, radius: 2.6,
    label: '📖  Grimoire · Evolution recipes',
    key: 'grimoire',
  });

  // CC3 town cohort 1 — wire the Shop + Grimoire interactables to their modals.
  // Dynamic import of ui.js (matches menuV2's _openGrimoire pattern) so town.js
  // doesn't pull ui internals into its module graph / risk a circular load.
  // Guarded with `if (!_handlers.x)` so an explicit main.js setInteractionHandler
  // override still wins.
  if (!_handlers.shop) {
    _handlers.shop = () => {
      import('./ui.js').then((m) => { try { m.showShop && m.showShop(); } catch (_) {} }).catch(() => {});
    };
  }
  if (!_handlers.grimoire) {
    _handlers.grimoire = () => {
      import('./ui.js').then((m) => { try { m.showGrimoire && m.showGrimoire(); } catch (_) {} }).catch(() => {});
    };
  }

  // CC5 town cohort 2 — wandering sage NPC. Spawns near plaza center, off the
  // hero spawn (0,6) so it doesn't overlap the player on entry, then ambles the
  // open central floor and chatters via chatBubble.js.
  const npcGroup = _makeTownNpc();
  _npc = {
    group: npcGroup,
    pos: { x: -3, z: 1 },
    target: { x: 4, z: -2 },
    speed: 1.6,
    nextBarkAt: 0,
    firstBarkDone: false,
    barkIndex: 0,
  };
  npcGroup.position.set(_npc.pos.x, 0, _npc.pos.z);
  g.add(npcGroup);
  // Anchor the NPC's chat bubbles to its live (mutating) pos so the bubble
  // tracks it as it wanders. Head height ~2.0 (above the 1.7 ear tips).
  setSpeakerAnchor(NPC_SPEAKER_ID, { pos: _npc.pos, y: 2.0 });

  // CC6 town cohort 3 — biome gate dressing. Two themed planters flank the
  // Adventure Gate (z=14) at the approach; their emissive growth recolors to
  // preview the selected stage's biome. Placed clear of the statue arc (z≈10.5)
  // and the gate footprint.
  _gateBiomeMats = [];
  for (const px of [-3.0, 3.0]) {
    const planter = _makeGatePlanter();
    planter.position.set(px, 0, 12.4);
    g.add(planter);
    if (planter.userData._growthMat) _gateBiomeMats.push(planter.userData._growthMat);
  }
  _applyGateBiome(getMeta().selectedStage);

  // ── Character statues — one per CHARACTERS entry, arc'd between hero
  // spawn (z=6) and the Adventure Gate (z=14). Player walks through them
  // on the way to the gate so character pick is the natural pre-run beat.
  const meta = getMeta();
  const N = CHARACTERS.length;
  for (let i = 0; i < N; i++) {
    const ch = CHARACTERS[i];
    const unlocked = ch.unlock === null || (meta.achievements && meta.achievements[ch.unlock]);
    // Place in a shallow arc centered at x=0, z=10.5, span ~14 across the plaza
    const t = (N === 1) ? 0 : (i / (N - 1) - 0.5);
    const px = t * 14;
    const pz = 10.5 + 0.6 * Math.abs(t);
    const statue = _makeCharStatue(ch, !!unlocked);
    statue.position.set(px, 0, pz);
    // Statue faces inward toward where the hero will stand (slightly tilted)
    statue.rotation.y = -Math.atan2(px, 6 - pz);
    g.add(statue);
    _statueRefs[ch.id] = statue;
    _interactables.push({
      pos: { x: px, z: pz },
      radius: 2.4,
      label: unlocked ? `🎭  Play as ${ch.name}` : `🔒  Locked · ${ch.unlock}`,
      key: `char:${ch.id}`,
      _unlocked: !!unlocked,
    });
  }
  // Initial ring repaint
  _repaintStatueSelection();

  // Lamp posts at four corners
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
    const lamp = _makeLamp();
    lamp.position.set(x, 0, z);
    g.add(lamp);
  }

  // Town fence ring — short stone posts every ~30°
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.9, 0.4),
      _matStandard(0x6a635a, 0.9),
    );
    post.position.set(Math.cos(a) * FENCE_R, 0.45, Math.sin(a) * FENCE_R);
    post.castShadow = true;
    g.add(post);
  }

  scene.add(g);
  _group = g;

  // ── DOM interaction prompt ──
  if (!_promptEl) {
    _promptEl = document.createElement('div');
    _promptEl.id = 'kk-town-prompt';
    _promptEl.style.cssText = `
      position: fixed; bottom: 14%; left: 50%; transform: translateX(-50%);
      padding: 10px 22px; pointer-events: none; z-index: 90;
      background: linear-gradient(180deg, rgba(28,22,18,0.92), rgba(18,14,12,0.92));
      border: 1px solid rgba(255,220,160,0.35); border-radius: 8px;
      color: #f4e6c4; font: 600 16px 'Cinzel Decorative', serif;
      letter-spacing: 0.06em;
      box-shadow: 0 6px 18px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
      backdrop-filter: blur(6px);
      display: none;
    `;
    document.body.appendChild(_promptEl);
    _promptBinding = bindPrompt(_promptEl, 'interact', '');
    window.addEventListener('keydown', _onKeyDown);
    initChatBindings();
  }

  g.visible = false;
  return g;
}

function _repaintStatueSelection() {
  const sel = getMeta().selectedChar;
  for (const id of Object.keys(_statueRefs)) {
    const ring = _statueRefs[id].userData._selRing;
    if (ring) ring.visible = (id === sel);
  }
}

function _selectChar(id) {
  const ch = CHARACTERS.find(c => c.id === id);
  if (!ch) return;
  const meta = getMeta();
  const unlocked = ch.unlock === null || (meta.achievements && meta.achievements[ch.unlock]);
  if (!unlocked) return;
  setOption('selectedChar', id);
  meta.selectedChar = id;
  _repaintStatueSelection();
  // Brief affordance toast
  if (_promptEl) _promptEl.textContent = `★  Now playing as ${ch.name}`;
}

// CC8 — gate-launch flourish. On E at the gate, flare the portal (disc swell +
// opacity + light spike, animated in tickTown) for GATE_FLOURISH_SEC, then run
// the real launch handler. A brief "whoosh into the adventure" beat instead of
// an instant cut; the voidTeleport sfx (0.95s whoosh+chime) carries across the
// transition. Guarded so a repeat E during the flare is a no-op.
function _triggerGateLaunch() {
  if (_gateLaunchPending) return;
  _gateLaunchPending = true;
  _gateFlourishUntil = state.time.real + GATE_FLOURISH_SEC;
  try { sfx.voidTeleport && sfx.voidTeleport(); } catch (_) {}
  setTimeout(() => {
    _gateLaunchPending = false;
    if (_onGateActivate) _onGateActivate();
  }, GATE_FLOURISH_SEC * 1000);
}

function _onKeyDown(e) {
  if (state.mode !== 'town') return;
  if (e.code !== 'KeyE' && e.code !== 'Enter') return;
  if (!_activeKey) return;
  if (_activeKey === 'gate' && _onGateActivate) _triggerGateLaunch();
  else if (_activeKey.startsWith('char:')) _selectChar(_activeKey.slice(5));
  else if (_handlers[_activeKey]) _handlers[_activeKey]();
}

export function setGateHandler(fn) { _onGateActivate = fn; }
export function setInteractionHandler(key, fn) { _handlers[key] = fn; }

export function enterTown() {
  state.mode = 'town';
  if (_group) _group.visible = true;
  // CC3 town cohort 1 — persistent visit state. Count town visits so future
  // cohorts (NPC greetings, "welcome back" dressing) can branch on first-vs-
  // returning. Persisted via meta so it survives reloads.
  try {
    const meta = getMeta();
    setOption('townVisits', ((meta && meta.townVisits) | 0) + 1);
  } catch (_) {}
  // Re-arm the sage NPC's greeting so the townVisits-keyed line re-lands on each
  // entry (visits 2+ get the "back again" variant). The counter was just bumped
  // above, so the variant reflects this visit.
  if (_npc) { _npc.firstBarkDone = false; _npc.nextBarkAt = 0; }
  // Refresh gate biome dressing — selectedStage may have changed since the last
  // town visit (stage is picked in menuV2).
  try { _applyGateBiome(getMeta().selectedStage); } catch (_) {}
  // Reset the gate-launch flare guard so a fresh town visit can re-trigger it.
  _gateLaunchPending = false; _gateFlourishUntil = 0;
  // Spawn just inside the plaza, facing the gate
  state.hero.pos.set(0, 0, 6);
  state.hero.vel.set(0, 0, 0);
  state.hero.facing.set(0, 0, 1);
  _repaintStatueSelection();
  // Settle any pending Boss Rush Wager from the previous run. Dynamic import
  // so we don't pull casino.js into the town graph unconditionally — most
  // players never set a wager. settlePendingWager() is a no-op when the
  // localStorage flag is absent or the player hasn't unlocked the casino.
  try {
    import('./casino.js')
      .then(({ settlePendingWager }) => { try { settlePendingWager(); } catch (_) {} })
      .catch(() => {});
  } catch (_) {}
}

export function exitTown() {
  state.mode = 'run';
  if (_group) _group.visible = false;
  if (_promptEl) _promptEl.style.display = 'none';
  _activeKey = null;
}

export function isInTown() { return state.mode === 'town'; }

// Iter 33h — let sibling sub-modes (casino interior, etc.) hide the town
// group while their own room is on-screen. Town's plaza disc (PLAZA_R=18)
// is wider than most interior rooms, so it can bleed past the room walls
// at the iso camera frustum's edges + show through any semi-transparent
// floor tile in the interior.
export function setTownGroupVisible(v) { if (_group) _group.visible = !!v; }

export function tickTown(dt) {
  if (state.mode !== 'town') {
    if (_promptEl && _promptEl.style.display !== 'none') _promptEl.style.display = 'none';
    return;
  }

  // Wander the sage NPC (+ its bark scheduler) first so its bubble reads from
  // the NPC's current spot, then position + fade all speech bubbles.
  _tickNpc(dt);
  tickBubbles();

  // Animate portal — gentle scale pulse + opacity sine
  const t = state.time.real;
  if (_portal) {
    if (t < _gateFlourishUntil) {
      // CC8 launch flare — disc swells + brightens toward the cut (k: 0→1).
      const k = 1 - (_gateFlourishUntil - t) / GATE_FLOURISH_SEC;
      const s = 1 + 1.6 * k;
      _portal.scale.set(s, s, s);
      _portal.material.opacity = Math.min(1, 0.55 + 0.5 * k);
      if (_portalLight) _portalLight.intensity = 1.8 + 4.0 * k;
    } else {
      const s = 1 + 0.08 * Math.sin(t * 2.6);
      _portal.scale.set(s, s, s);
      _portal.material.opacity = 0.50 + 0.18 * Math.sin(t * 2.6 + 0.4);
      if (_portalLight) _portalLight.intensity = 1.8;
    }
  }
  // Animate selected statue ring (rotate + opacity pulse) and gentle bob.
  // After the iter 10b swap, the X-rotation is baked into the PlaneGeometry,
  // so we yaw the rune by mutating rotation.y (the world-up axis) — same
  // visual feel as the original rotation.z spin on the un-baked RingGeometry.
  const sel = getMeta().selectedChar;
  if (sel && _statueRefs[sel]) {
    const ring = _statueRefs[sel].userData._selRing;
    if (ring) {
      ring.rotation.y += dt * 0.6;
      ring.material.opacity = 0.55 + 0.30 * Math.sin(t * 3.2);
      const rs = 1 + 0.08 * Math.sin(t * 2.4);
      ring.scale.set(rs, rs, rs);
    }
    _statueRefs[sel].position.y = 0.1 + 0.06 * Math.sin(t * 1.9);
  }
  // Reset bob on non-selected statues
  for (const id of Object.keys(_statueRefs)) {
    if (id !== sel) _statueRefs[id].position.y = 0;
  }

  // Seedy Tent — flickering red lantern (pulse + intensity wobble) + repaint
  // the casino interactable label whenever meta.unlockedVoid flips. Reading
  // getMeta() once per frame is cheap; we only mutate the label string when
  // the state actually changes (cached in _userData of the interactable).
  if (_tent && _tentLight) {
    const flicker = 1 + 0.18 * Math.sin(t * 9.2) + 0.10 * Math.sin(t * 21.5 + 0.7);
    _tentLight.intensity = 1.1 * flicker;
    if (_tentLanternMesh && _tentLanternMesh.material) {
      _tentLanternMesh.material.opacity = 0.85 + 0.15 * Math.sin(t * 6.1);
    }
  }
  // Casino is always unlocked as of iter 33e — no per-frame label repaint needed,
  // but we leave the iterator scaffolding here in case future state needs it.

  // Hellfire Brazier — bob/twist flames; "intense" window after a press makes
  // flames climb + light bleed brighter for ~5s as the confirmation cue.
  if (_brazier && _brazierFlames.length) {
    const intense = state.time.real < _brazierIntenseUntil;
    const climbBoost = intense ? 0.45 : 0;
    const scaleBoost = intense ? 1.35 : 1.0;
    for (const f of _brazierFlames) {
      const m = f.mesh;
      m.position.y = f.baseY + climbBoost + 0.08 * Math.sin(t * 4.5 + f.phase);
      m.rotation.y = Math.sin(t * 2.2 + f.phase) * 0.6;
      const flicker = 1 + 0.12 * Math.sin(t * 11 + f.phase * 2);
      m.scale.set(f.scale * scaleBoost * flicker, f.scale * scaleBoost * flicker, 1);
    }
    if (_brazierLight) {
      // Idle pulse ~1.2-1.7; intense pushes to 2.4-3.2.
      const base = intense ? 2.6 : 1.4;
      _brazierLight.intensity = base + 0.35 * Math.sin(t * 7.5);
    }
  }

  // Closest interactable inside its trigger radius
  const h = state.hero.pos;
  let best = null, bestD = Infinity;
  for (const it of _interactables) {
    const dx = h.x - it.pos.x;
    const dz = h.z - it.pos.z;
    const d2 = dx * dx + dz * dz;
    const r = it.radius;
    if (d2 < r * r && d2 < bestD) { best = it; bestD = d2; }
  }
  _activeKey = best ? best.key : null;
  if (best) {
    setPromptLabel(_promptBinding, best.label);
    _promptEl.style.display = 'block';
  } else {
    _promptEl.style.display = 'none';
  }

  // Constrain hero to fence — sliding clamp
  const r2 = h.x * h.x + h.z * h.z;
  const R = FENCE_R - 0.8;
  if (r2 > R * R) {
    const r = Math.sqrt(r2);
    h.x = (h.x / r) * R;
    h.z = (h.z / r) * R;
  }
}
