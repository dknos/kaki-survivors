#!/usr/bin/env bash
# Import a CURATED subset of the KayKit free packs into assets/kits/.
#
# Source zips live in the user's Windows Downloads (WSL mount). This script is
# idempotent — already-present outputs are skipped. Static props (forest +
# dungeon) are run through `gltf-transform optimize` with GEOMETRY COMPRESSION
# OFF (the loader registers DRACO but NOT Meshopt, so meshopt glbs would fail
# to load) and textures recompressed to webp@512. Skeleton character + rig
# glbs are copied RAW to preserve skinning/animation integrity (optimize's
# join/weld passes can corrupt skinned meshes).
#
# Output layout:
#   assets/kits/forest/*.glb      curated trees/bushes/rocks
#   assets/kits/dungeon/*.glb     modular walls/floors/pillars/props (additive)
#   assets/kits/skeletons/*.glb   4 rigged chars + 2 shared anim rigs
#
# Re-run after dropping fresh zips to refresh. Requires: unzip, gltf-transform.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DL="/mnt/c/Users/rneeb/Downloads"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FOREST_ZIP="$DL/KayKit_Forest_Nature_Pack_1.0_FREE.zip"
DUNGEON_ZIP="$DL/KayKit_DungeonRemastered_1.1_FREE.zip"
SKEL_ZIP="$DL/KayKit_Skeletons_1.1_FREE.zip"

FOREST_BASE="KayKit_Forest_Nature_Pack_1.0_FREE"
DUNGEON_BASE="KayKit_DungeonRemastered_1.1_FREE"
SKEL_BASE="KayKit_Skeletons_1.1_FREE"

OPT=(optimize --compress false --texture-compress webp --texture-size 512)

mkdir -p assets/kits/forest assets/kits/dungeon assets/kits/skeletons

# ── curated lists ───────────────────────────────────────────────────────────
# Forest: trees (leafy + bare), bushes, rocks. Single shared atlas re-embeds
# per glb but webp@512 keeps each ~20 KB.
FOREST=(
  Tree_1_A_Color1 Tree_2_A_Color1 Tree_2_C_Color1 Tree_3_A_Color1 Tree_4_A_Color1
  Tree_Bare_1_A_Color1 Tree_Bare_2_A_Color1
  Bush_1_A_Color1 Bush_2_A_Color1 Bush_4_A_Color1
  Rock_1_A_Color1 Rock_1_E_Color1 Rock_2_A_Color1 Rock_3_A_Color1 Rock_3_H_Color1
)
# Forest output names (strip _Color1 suffix for cleaner kit ids)
declare -A FOREST_OUT
for f in "${FOREST[@]}"; do FOREST_OUT[$f]="${f%_Color1}"; done

# Dungeon: modular walls/floors/pillars/stairs + treasure & dressing props.
DUNGEON=(
  wall wall_corner wall_corner_small wall_doorway wall_arched wall_broken
  wall_cracked wall_window_open wall_endcap wall_half wall_Tsplit wall_pillar
  floor_tile_large floor_tile_small floor_dirt_large floor_tile_big_grate
  floor_tile_big_spikes
  pillar pillar_decorated column stairs stairs_wide
  barrel_large barrel_small box_large crates_stacked chest chest_gold
  candle_triple candle_lit coin_stack_large keg table_medium shelf_large
  rubble_large banner_thin_brown sword_shield
)

# Skeletons: rigged character meshes (share Rig_Medium) + the two anim banks.
SKEL_CHARS=(Skeleton_Mage Skeleton_Minion Skeleton_Rogue Skeleton_Warrior)
SKEL_RIGS=(Rig_Medium_General Rig_Medium_MovementBasic)

# ── forest ───────────────────────────────────────────────────────────────────
echo "[forest]"
unzip -o "$FOREST_ZIP" "$FOREST_BASE/Textures/forest_texture.png" -d "$TMP" >/dev/null
for f in "${FOREST[@]}"; do
  out="assets/kits/forest/${FOREST_OUT[$f]}.glb"
  if [[ -s "$out" ]]; then printf "  %-26s [skip]\n" "$(basename "$out")"; continue; fi
  unzip -o "$FOREST_ZIP" \
    "$FOREST_BASE/Assets/gltf/$f.gltf" "$FOREST_BASE/Assets/gltf/$f.bin" \
    -d "$TMP" >/dev/null
  cp "$TMP/$FOREST_BASE/Textures/forest_texture.png" "$TMP/$FOREST_BASE/Assets/gltf/"
  gltf-transform "${OPT[@]}" "$TMP/$FOREST_BASE/Assets/gltf/$f.gltf" "$out" >/dev/null 2>&1
  printf "  %-26s %sB\n" "$(basename "$out")" "$(stat -c%s "$out")"
done

# ── dungeon (texture co-located with gltf, no copy needed) ────────────────────
echo "[dungeon]"
for f in "${DUNGEON[@]}"; do
  out="assets/kits/dungeon/$f.glb"
  if [[ -s "$out" ]]; then printf "  %-26s [skip]\n" "$f.glb"; continue; fi
  unzip -o "$DUNGEON_ZIP" \
    "$DUNGEON_BASE/Assets/gltf/$f.gltf" "$DUNGEON_BASE/Assets/gltf/$f.bin" \
    "$DUNGEON_BASE/Assets/gltf/dungeon_texture.png" \
    -d "$TMP" >/dev/null
  gltf-transform "${OPT[@]}" "$TMP/$DUNGEON_BASE/Assets/gltf/$f.gltf" "$out" >/dev/null 2>&1
  printf "  %-26s %sB\n" "$f.glb" "$(stat -c%s "$out")"
done

# ── skeletons (raw copy — preserve rig + clips) ───────────────────────────────
echo "[skeletons]"
for f in "${SKEL_CHARS[@]}"; do
  out="assets/kits/skeletons/$f.glb"
  if [[ -s "$out" ]]; then printf "  %-30s [skip]\n" "$f.glb"; continue; fi
  unzip -o "$SKEL_ZIP" "$SKEL_BASE/characters/gltf/$f.glb" -d "$TMP" >/dev/null
  cp "$TMP/$SKEL_BASE/characters/gltf/$f.glb" "$out"
  printf "  %-30s %sB\n" "$f.glb" "$(stat -c%s "$out")"
done
for f in "${SKEL_RIGS[@]}"; do
  out="assets/kits/skeletons/$f.glb"
  if [[ -s "$out" ]]; then printf "  %-30s [skip]\n" "$f.glb"; continue; fi
  unzip -o "$SKEL_ZIP" "$SKEL_BASE/Animations/gltf/Rig_Medium/$f.glb" -d "$TMP" >/dev/null
  cp "$TMP/$SKEL_BASE/Animations/gltf/Rig_Medium/$f.glb" "$out"
  printf "  %-30s %sB\n" "$f.glb" "$(stat -c%s "$out")"
done

echo
echo "kaykit import total:"
du -ch assets/kits/forest/*.glb assets/kits/dungeon/*.glb assets/kits/skeletons/*.glb 2>/dev/null | tail -1
