# Kitty Kaki Survivors

A Vampire Survivors-style auto-attacking horde game built in **THREE.js** with no bundler. Slot-machine treasure chests, evolving weapons, animated bug swarms in a forest biome.

**▶ Play locally**: `npx serve` then open `http://localhost:5180/`.

## Controls

| Key | Action |
|---|---|
| **WASD / Arrows** | Move |
| **Space** | Jump |
| **Shift** | Dash (after unlock) |
| **Mouse wheel / Pinch** | Zoom (after unlock) |
| **ESC** | Options |
| **R** | Retry (on death/victory screen) |

## Features

- 🎯 **4 weapons** with evolutions — Holy Croissants (Orbitals), Magic Missile, Chain Lightning, Sticky Web. Each evolves at max level + 3 picks of a paired filler: **Toxic Halo**, **Storm**, **Volley**, **Tangle**.
- 🐞 **Forest bug swarm** — 10 animated insect tiers (Beetle, Ladybug, Grasshopper, Mantis, Cockroach, Ant, Wasp, Bee, Butterfly, Caterpillar) plus 15 Quaternius creature tiers (Goblin, Orc, Demon, Spider, Wolf, Wizard, Ghost, Dragon, etc.). Per-instance hue jitter so swarms look like crowds.
- 🎰 **Treasure chests + slot machine** — chests drop from elites + every 75s. Pickup opens a 3-reel slot. 7-7-7 jackpot = max upgrade. Double-or-nothing gamble after any non-jackpot result.
- ⚡ **Wizard ranged AI** — stops and fires magenta projectiles inside range.
- 🛡️ **Mini-bosses at 4/8/12 min** + **Final boss at 15 min** = VICTORY.
- 💀 **Hero death animation** (squash/spin/fade) + cinematic Victory hop.
- 🏆 **8 achievements**, persistent meta (coins, best time, best kills, runs).
- 🎨 **Selective bloom layers**, vertex-shader leg/wing animation for static bugs, HDRI environment, blob shadows, rim light, ACES Filmic tone mapping, height fog, LGG color grade (red shadow tint during final boss).

## Stack

- **THREE.js 0.160** via importmap (no bundler)
- **No tests**, no TypeScript — single-file modules
- DPR 1.75 cap, selective-bloom EffectComposer pipeline, InstancedMesh-pooled FX (kill rings, sparks, blob shadows, pickups)
- Procedural particle textures + procedural Web Audio (toggleable music off by default)
- Vertex animation injection via `onBeforeCompile` for static bug GLBs
- Per-instance material clone for damage flash + hue jitter

## Credits

Models — all CC0 / CC-BY:
- **Quaternius** — Ultimate Monsters bundle (Mushnub, Cactoro, Goleling, Orc, Demon, Yeti, Pink Slime, Ghost, Dragon, Mushroom King, Wasp, Spider, Wolf) — CC0
- **Poly by Google** (via [Poly Pizza](https://poly.pizza)) — Beetle, Ladybug, Grasshopper, Mantis, Cockroach, Ant, Bee, Butterfly, Caterpillar — CC-BY
- **Quaternius** — chest / chest_open — CC0

Textures:
- **Poly Haven** — `forrest_ground_01` (1k diff/rough/normal), `approaching_storm` HDRI — CC0

Code, gameplay, shaders by [@slopfactory9000](mailto:slopfactory9000@gmail.com).

## Architecture

```
src/
  main.js              # bootstrap + RAF loop
  state.js             # single mutable game state
  config.js            # tunables (DAMAGE, JUMP, DASH, ENEMY_TIERS, etc.)
  assets.js            # GLTF preload, material upgrade, vertex anim injection
  particleTextures.js  # canvas-rendered glow/spark/smoke textures
  postfx.js            # bloom composer + composite + LGG grade + height fog
  env.js               # ground, lights, HDRI environment, scenery scatter
  hero.js              # input → movement/jump/dash/walk anim/death anim
  enemies.js           # spawn, pool, AI, AnimationMixer, proc anim, flash, DoT
  enemyProjectiles.js  # wizard fireballs
  fx.js                # InstancedMesh pools: kill rings, sparks, pickup ring
  blobShadows.js       # InstancedMesh of soft dark circles under characters
  damageNumbers.js     # DOM-overlay floating numbers (1.2K format)
  xp.js                # gem InstancedMesh + magnetize + per-tier color
  pickups.js           # 3D extruded heart + star pickups
  chest.js             # chest spawn + open-flash + slot machine trigger
  slotMachine.js       # symbols, outcome resolution, jackpot apply
  spawnDirector.js     # D(t) curve, hordes, mini-bosses @ 4/8/12, final @ 15
  meta.js              # localStorage save (coins/runs/best/achievements)
  ui.js                # HUD, level-up modal, death screen, banners, toasts
  audio.js             # procedural Web Audio sfx + tiered music (default OFF)
  input.js             # keyboard / touch / wheel zoom (notched) / Shift dash / Space jump
  weapons/
    index.js           # registry, evolutions, fillers
    orbitals.js        # Holy Croissants → Toxic Halo
    autoAim.js         # Magic Missile → Volley
    chain.js           # Chain Lightning → Storm
    web.js             # Sticky Web → Tangle
```

## License

Code under MIT (or your choice). Assets keep their original CC0/CC-BY terms.
