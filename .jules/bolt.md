## 2024-05-13 - Fast SpatialHash Keys
**Learning:** In highly queried code paths (like spatial hash key generation called multiple times per enemy frame), string concatenation `cx + '_' + cz` can lead to GC pauses and slower Map lookups than using integers. Packing grid coordinates into integers avoids these issues entirely.
**Action:** For 2D grid lookups, pack coordinates using bitwise operations (e.g. `((cx & 0xFFFF) << 16) | (cz & 0xFFFF)`) instead of strings whenever possible to improve hot-loop performance and prevent allocation in game loops.

## 2024-05-13 - [O(N) Blob Shadow Loop Spatial Query Conversion]
**Learning:** The `updateBlobShadows` loop iterated over all active enemies each frame, which caused scaling issues as max enemy limits grow, despite an eventual 24u culling. The project has a `state.enemies.spatial` spatial hash specifically designed for such spatial proximity queries.
**Action:** Always prefer using the global spatial hash `state.enemies.spatial.queryRadiusInto` with a pre-allocated array (like `const _nearby = []`) rather than iterating `state.enemies.active` in per-frame update functions.
