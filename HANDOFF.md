# Kitty Kaki Survivors — Handoff for Next Claude Session (2026-05-14)

> **Heads up:** this handoff was written from a Windows session. The next session is opening in WSL — paths become `/mnt/c/Users/rneeb/Documents/kitty-kaki-survivors`. PowerShell commands won't work; use bash. Git remote + repo state is the source of truth across both.

---

## Project at a glance

- **Repo:** `dknos/kitty-kaki-survivors` (GitHub Pages from `main` branch root)
- **Live URL:** https://dknos.github.io/kitty-kaki-survivors/ (rebuild ~60s after push)
- **Stack:** THREE.js **0.160** via importmap. No bundler. Served as static files.
- **Genre:** Vampire-Survivors-style horde game with a hub town, interior, dungeon, multiple stages.
- **Pages flow:** push to `main` → wait ~60s → hard-refresh the live URL to test.

## Standing user mandate

Direct quote from the user, still in force:

> "talk to advisor and finish all tasks, plan improve iterate the game until it is fully shippable and able to compete with the best survivors games ever made"

User also asked us to "use sota technologies, send out agents to for nvidia hugging face research to utilize latest technology and find latest techniques on github/academic/arvix for best practices and coolest features". See `SOTA_RESEARCH.md` in the repo — research is already done. Headline finding: **r171 + TSL compute particles is the biggest unlock**, queued as iter 11 (post-roadmap).

User collaboration style:
- Likes parallel worktree/background agents (3 per iteration is the cadence)
- Commits and pushes after every iteration so Pages reflects state
- Reports bugs by user-visible symptom ("blue squares orbit", "wolf walks backward", "ring effects look plain AI glow") — fix the symptom AND root cause
- No long-winded summaries; show what changed and what's next

## Roadmap & current task list

10-iteration shippability plan + a post-roadmap r171 spike. Track via TaskList tool. Current state:

| # | Iter | Status |
|---|---|---|
| 26 | Iter 1: Combat Grammar (legibility) | completed |
| 27 | Iter 2: One More Slot (build axis) | completed |
| 28 | Iter 3: Controller First | completed |
| 29 | Iter 4: Stage Rules | completed |
| 30 | Iter 5: Teach the Loop | completed |
| **31** | **Iter 6: Meta With Teeth** | **in_progress** (no work done yet — just queued) |
| 32 | Iter 7: Roster Pressure | pending |
| 33 | Iter 8: Enemy Identity | pending |
| 34 | Iter 9: Retention Hooks | pending |
| 35 | Iter 10: Polish Lock (ship) | pending |
| 36 | Iter 11: r171 + TSL compute particles spike | pending |

WSL session may have a fresh task list — if so, re-create these from this table.

## Iteration pattern (use it)

For each iteration:
1. Mark task `in_progress`.
2. Spawn **3 parallel background agents** (`Agent` tool, `run_in_background: true`) on **non-overlapping file surfaces**. Brief them with file paths + concrete API + "do NOT touch X (other agent owns it)".
3. Wait for completion notifications. Verify with `git status`, `node --check`, and quick smoke imports.
4. Commit + push with a detailed message listing what shipped per sub-task.
5. Mark task `completed`, set next iteration `in_progress`.

When agents touch the same file (e.g. `main.js`, `ui.js`), expect 3-way merges. Strategy that worked: pick the agent with the largest changes as base, manually re-apply others' specific additions.

**Background agents cannot commit** (shell permission denied). They leave files in place; the parent session commits.

## Recent commits (top of `main`)

- `2d51fff` Visual polish: rune-textured rings + dark hero shadow (also bundled iter 5b/c files)
- `36dccd8` Tutorial: drop stage-1 pause (deadlocks movement)
- `3c70691` Iter 4: Stage Rules — per-stage modifiers, mini-events, arena decor
- `99f84db` Iter 3: Controller First — gamepad, UI focus, context prompts
- `38e8990` Wolf walk + hornet sideways fix
- `715b59b` Iter 2 full merge

## Architecture (the parts you need to know)

### Scene-swap state machine
`state.mode ∈ {'menu', 'town', 'interior', 'catacomb', 'run'}`. Run lifecycle hooks live in `src/main.js`: `_primeRunStart`, `_teardownActiveRun`. Most subsystems init at boot once and reset on run start.

### Key modules
- `src/main.js` — render loop, mode branches, run lifecycle, camera, sun shadow follow
- `src/state.js` — central mutable state (always import `{ state }`)
- `src/config.js` — STAGES, ENEMY_TIERS, HERO, WORLD, XP tunables
- `src/meta.js` — persistent localStorage (`meta.tutorialDone`, `meta.codex`, `meta.runHistory`, shop levels, currencies)
- `src/audio.js` — WebAudio procedural synth + ~17 SFX hooks
- `src/postfx.js` — selective bloom via `BLOOM_LAYER`, two-composer pipeline
- `src/enemies.js` — spawn, AI step, kill, procAnim (`'crawl'|'hover'|'hop'|'flap'|'inch'|'pad'`), faceYaw radians (replaced old faceFlip bool)
- `src/weapons/` — 6 modules in `REGISTRY`, 5 evolutions in `EVOLUTIONS`. Passives in `passives.js` use idempotent `apply(level, prev)` pattern — divide out `prev` before applying new. Passives set `state.run.passive_*` scalars consumed elsewhere.
- `src/xp.js` — InstancedMesh gem pool (cap 500), level-up vacuum, soft cap at 60 active
- `src/ui.js` — every modal pushes a focus scope via `uiFocus.js`
- `src/uiFocus.js` — keyboard/gamepad nav with focus scope stack
- `src/buttonPrompts.js` — device-aware glyph pills (E↔B etc.) auto-refresh on device flip
- `src/gamepad.js` — XInput layer; `gamepadState`, `getAimDirection()`. `input.activeDevice` flips on last-touched device.
- `src/tutorial.js` — 6-stage first-run guide. **Important:** stage 1 must NOT pause the game (deadlocks movement). Already fixed in `36dccd8`.
- `src/tooltips.js` — 200ms hover delay, listens for `kk-focus-change` CustomEvent
- `src/codex.js` — bestiary/weapons/passives/secrets tabs. Discovery hooks called from `enemies.js`, `xp.js`, `weapons/index.js`.
- `src/runHistory.js` — last 20 runs, re-roll-seed button per row
- `src/stageRules.js` — per-stage modifier registry: `onRunStart`, `onTick`, `onEnemySpawn`, `notify*`
- `src/miniEvents.js` — one-slot scheduler for Treasure Goblin / Meteor Shower / Elite Pack
- `src/arenaProps.js` — destructible barrels/crates/totems
- `src/arenaDecor.js` — InstancedMesh biome decor (trees/grass/crystals/runes/rocks/bones)
- `src/stageHazards.js` — pollen, fog (`uInner`/`uOuter` shrink on twilight surge), lava (`spawnLavaPuddle` exported)
- `src/blobShadows.js` — InstancedMesh contact discs. **Hero gets a tight blob on top of its real PCF shadow** — without this the PCF alone reads as a green smear from hemi bounce.
- `src/enemyTells.js` — exports `makeRuneRingTexture()` for shared rune-disc art (boss telegraphs reuse it).
- `src/env.js` — lights + ground. Hemi groundColor is **neutral gray** (`0x1a1a1f`), NOT green.

### Visual style locked in
- 8-color palette + 4/2/1 px line weights. See `STYLE_BIBLE.md` + `style-bible.html`.
- Procedural rune ring texture (radial falloff + ticks + 4 cardinal glyphs) is the canonical "magic AoE" look. Reused by enemy elite tells, boss wind-ups, shockwaves. Reuse it for new rings — do NOT use flat `RingGeometry` + `MeshBasicMaterial`. Import `makeRuneRingTexture` from `src/enemyTells.js`.
- BLOOM_LAYER is selective — only emissive/FX meshes opt in. Don't put bulk geometry on it (cheese-burger blue-squares bug came from BLOOM on a wide cheese mesh).

### Common gotchas
- `node --check src/foo.js` works for syntax. Full `import` fails locally because `three` is loaded via importmap, not node_modules.
- LF↔CRLF warnings on every commit are normal noise.
- Don't auto-add `--no-verify` / skip hooks.
- All assets/textures are procedural (canvas) or GLB drop-ins from `assets/`. No npm dependencies.

## What to do next

**Iter 6: Meta With Teeth** (task #31, marked in_progress)

Roadmap brief: branching shop upgrades + a second meta currency (Sigils, earned from boss kills / quest completions / daily). Players should feel that NOT picking everything on their first run is correct.

Suggested 3-agent split:
- **6a — Sigil currency + earn paths.** Add `meta.sigils`, earn hooks (mini-boss = 1, final boss = 5, quest complete = 2, daily = 3). Surface in shop header + run-end results screen.
- **6b — Branching shop tree.** Convert `src/meta.js` shop from flat upgrade list to a tree with 3 prestige branches (Survival / Power / Greed) gated by sigils. Each branch ~4 nodes with prerequisites. Visualize as a node graph in shop modal.
- **6c — Build presets / loadouts.** Save favorite character+stage+passive picks as named presets, persisted in `meta.presets`. Add to start screen. Advisor's #1 risk was "build combinatorics" — this addresses it.

Brief each agent with: file paths to read, exact API surface, "do NOT touch X" list.

## Pending bug-fix watchlist

Nothing open as of `2d51fff`. The wolf-walk + hornet-sideways + tutorial-deadlock + green-shadow + flat-ring bugs are all shipped. User has not reported anything since the ring/shadow fix.

## How to verify your work before pushing

```bash
cd /mnt/c/Users/rneeb/Documents/kitty-kaki-survivors
git status --short
for f in src/<changed>; do node --check "$f"; done
git diff --stat
git push origin main
# Wait ~60s, hard-refresh https://dknos.github.io/kitty-kaki-survivors/
```

## Memory references

`MEMORY.md` index lives at `~/.claude/projects/.../memory/`. WSL session has its own memory dir — likely empty or different. Check on first user prompt; persist new learnings there.

---

Mandate: ship.
