# Balance Audit — 2026-05-13

A code-review style balance pass over `config.js` and the boss/spawn tables.
Where a number is justifiable from math alone, the tweak ships in this pass.
Where the call needs a real play-test, the item is flagged for review.

## Tweaks shipped this pass

### `SPAWN.difficultyMaxSec`: 1800 → 1200

D(t) ramps from 1 at t=60s to `difficultyMax = 10` at `difficultyMaxSec`.
With the old 1800s cap and a 15-min boss arrival, D at boss time was:

> D(900) = 1 + (900-60)/1740 × 9 ≈ 5.34

That kept **dragon** (`minD: 7`) and **mech** (`minD: 4.5`) populations
suppressed for the entire normal run — dragons literally never appeared
outside of Endless. New cap is 1200:

> D(900) = 1 + (900-60)/1140 × 9 ≈ 7.63

Dragon spawns now turn on around t=12:00 (~3 min before the final boss),
which puts the player up against the highest-tier mob right when their
weapons should be at evolution-grade. Mech tier becomes available at
t=7:00. No other knobs change — top-of-curve content is just reachable in
the run length you actually play.

## Reviewed and left as-is

### Mini-boss HP multiplier: 3.0×

Default elite tiers used as mini-bosses: `giant` (200 HP) or `dragon` (400).
With ×3: 600–1200 HP. With evolved weapons at the time of the wave
(~4/8/12 min), kill time is on the order of 8–15s. That's the right length
for a wave to feel like a beat, not a slog. No change.

### Final boss HP multiplier: 30×

Final boss = highest-minD elite at 30×: 12,000 HP. With a typical run's
DPS at t=15:00 in the 250–500 range, expected kill time is 25–48s. That
matches the desired cinematic length. No change.

### Wizard ranged projectile: dmg 9, cd 2.4s

A single wizard at standoff range fires 9 dmg every 2.4s = 3.75 dps.
With hero hpMax 100 and 0.6s i-frames, even three wizards firing at the
hero from the screen edge gives time to close. Light, not oppressive.
No change.

### Ant weight 14 (highest of any tier)

Ants dominate early spawn rolls. With base 5 HP, they're confetti for
even level-1 orbitals (8–12 dmg/tick). Intentional — gives the player a
satisfying "mow through the swarm" feel before harder tiers spawn in.
No change.

### Chest cadence: every 75s + 30% elite drop

Generous but not broken — slot-machine outcomes range from "single
filler" to "777 jackpot" so the expected value per chest is moderate.
Reducing cadence would feel stingy. No change.

## Items flagged for play-test review

The following call needs an actual playtest before adjusting:

- **`SPAWN.targetAliveBase` (25) and `targetAlivePerD` (18)** — combined
  these go from 25 alive at run start to 25 + 5.34 * 18 = 121 by D=5.34
  in the old curve, or 25 + 7.63 * 18 = 162 by D=7.63 in the new curve.
  Need to verify framerate holds at 162 alive with shadows + bloom on
  reference hardware. The F3 perf overlay can confirm.
- **Dash damage** — at level 5 the dash deals 85 dmg with a 3s cooldown.
  Against a 400 HP dragon that's ~14 dashes to solo. Likely fine since
  dash is high-skill timing, but if it lets the player ignore weapons
  entirely the multiplier may need to come down.
- **Pummarola regen** — at level 5, 2.5 HP/s. Stacked with shop HP +50
  and Hollow Heart +100, the hero can outheal most ambient swarm damage.
  Probably fine for build identity (a "tank" build is desirable) but
  watch for trivial late-game.
- **Toxic Halo DoT damage** — set at half the base hit damage for 1s.
  Stacks per re-hit. Could trivialize crowds; if the death-screen DPS
  panel routinely puts toxic_halo at 70%+ of total damage, the ratio
  needs to come down.

## How to verify

1. Run an Endless mode session with the F3 overlay open.
2. Watch FPS at t=4:00, 8:00, 12:00 (mini-boss waves) and t=15:00+
   (post-final-boss in Endless).
3. Note the alive count peaks and the DPS panel on the death screen.
4. Adjust `targetAlivePerD` down by 10% if peak-alive sustains a frame
   budget breach (~50ms+ frames).
