# Performance — Architecture Notes & Budget

> Last reviewed: 2026-05-13. Toggle the in-game F3 overlay (`window.kkPerf()`
> works in the console too) to read live FPS / draw calls / triangle count
> against the budget below.

## Targets

- 60 fps on a 2020-era mid laptop (Intel UHD or M1 base) at 1080p, DPR cap 1.75.
- Frame budget: **16.6 ms** total.
  - Game logic / animation                       ≤ 4.0 ms
  - Render (bloom pass + composite pass)         ≤ 9.0 ms
  - DOM HUD update (throttled by `_last` cache)  ≤ 0.5 ms
  - Headroom                                     ≥ 2.0 ms

## Counts (steady state, 8 min into a normal run)

| Subsystem            | Live entities | Visible meshes | Notes                                                       |
|----------------------|--------------:|---------------:|-------------------------------------------------------------|
| Enemies (active)     | 60–110        | 60–110         | Capped at `SPAWN.targetAliveCap = 220`. D(t) ramps linearly. |
| Enemy projectiles    | 0–8           | 0–8            | Wizard ranged AI only. 2.4s cooldown.                       |
| Hero projectiles     | 0–20          | 0–20           | Pools per weapon, cleared on TTL or pierce-0.                |
| Gems                 | 0–60          | 1 InstancedMesh| `state.gems.list`, single instanced draw.                   |
| Webs                 | 0–4           | 4 (pooled)     | Tangle (web evo) caps at 4 active patches.                  |
| Pickups (h/s/b/f/c)  | 0–12          | 5 InstancedMesh| One InstancedMesh per kind. Magnetic drift on hero proximity. |
| Destructibles (logs) | 0–18          | 1 InstancedMesh| Hidden slots collapsed to zero-scale, single draw.          |
| Blob shadows         | 0–N           | 1 InstancedMesh| Skips entities with real cast shadows (hero, elites).       |
| Scatter (env)        | ~490          | ~490           | Pre-built at boot, never updated.                           |

## Render budget breakdown (typical 8-min run)

Numbers below are from the F3 overlay on the reference machine. Real numbers
will vary — use the overlay to verify.

| Pass               | Calls | Tris   | ms (approx) |
|--------------------|------:|-------:|------------:|
| Bloom-only render  |   ~80 |  ~80k  | ~2.0        |
| Composite + scene  |  ~140 | ~480k  | ~5.5        |
| **Total**          |  ~220 | ~560k  | **~7.5**    |

DPR cap of 1.75 keeps the bloom-pass texture small enough that on a 1440p
display the post-FX cost stays bounded.

## Architectural rules that protect performance

1. **No allocations in hot loops.** Module-scope `_tmpDir`, `_tmpPush`,
   `_tmpDelta`, `_p1`, `_p2`, `_m4` vectors/matrices are reused. Don't
   `new THREE.*` per-enemy, per-projectile, or per-tick.
2. **Pooled meshes only.** `state.enemies.pools[glbKey]` is the pool of
   inactive meshes. New enemies pop from there; killed enemies return.
   `POOL_PREWARM` sizes are tuned to absorb first-horde bursts so we never
   `cloneCached` mid-game (it warns in console if it has to).
3. **InstancedMesh for any pool > 4.** Gems, sparks, kill-rings, pickups,
   destructibles, blob shadows all use `InstancedMesh`. Unused slots get
   collapsed to zero scale at y=-1000.
4. **Spatial hash, not raycasts.** `SpatialHash` with `cellSize = 6` for
   proximity queries. Weapons call `queryRadius(pos, r)`.
5. **Animation cost is opt-in.** Rigged GLBs (Quaternius monsters) get an
   `AnimationMixer`. Static GLBs (Poly-by-Google bugs) get a per-kind shader
   vertex animation (`injectVertAnim`) that runs entirely on the GPU.
6. **Selective shadows.** Real shadow maps cast only by hero / chests /
   elites / mini-boss / final boss. Swarm enemies use blob shadows.
   `castShadow` is set at spawn time and cached on `mesh.userData._castSet`.
7. **Selective bloom.** Two-composer pipeline. The bloom pass renders only
   `BLOOM_LAYER` (gems, sparks, weapon glows, etc.) into a texture; the
   composite pass adds it back. ~1000 main scene meshes don't pay bloom.
8. **No per-frame DOM read or layout.** `updateUI()` uses a `_last` cache
   and only writes when a value changes by a perceptible amount.

## Recommended profiling procedure

1. Open the game in Chrome.
2. Press F3 — verify FPS stays ≥ 58 in the steady-state mid-run.
3. Open DevTools → Performance, record a 10-second window during a
   mini-boss wave (the highest-load moment).
4. Look for:
   - Long GC pauses (>5 ms) — usually means a hot-loop allocation snuck in.
   - GPU stalls during the bloom pass — usually means DPR is too high or
     too many emissive materials joined `BLOOM_LAYER`.
   - Long `updateEnemies` ticks — usually means the spatial hash is being
     bypassed by a brute-force enemy list scan somewhere.

## Known soft spots (watch list)

- The blob shadow `InstancedMesh` walks all active enemies each frame.
  Currently O(n) with n ≤ 220, fine. If swarm sizes grow, switch to
  "shadows for nearby only" via a 24u camera-distance gate.
- `bossTelegraphs.js` allocates a new `RingGeometry` per wind-up tell.
  Frequency is low (one per ~9s per boss) so it doesn't matter, but if
  Boss Rush gets stretched we'd want to pool the ring meshes too.
- The DOM achievement / secret toast queue creates and destroys DOM nodes
  per pop. Acceptable because they fire ≤ once per 3-4 seconds.
