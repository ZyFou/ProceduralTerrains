# Procedural Terrains for Unity

This alpha package creates deterministic procedural terrain directly in Unity
and imports renderer-neutral `.ptrterrain` documents and Unity ZIP exports.
Both workflows produce ready-to-edit native Unity Terrain hierarchies with
`TerrainData`, colliders, surfaces, and connected tile neighbors.

## Create terrain

1. Open **Window > Procedural Terrains > Terrain Importer** and choose **Create**.
2. Select a terrain preset, seed, dimensions, tile grid, and heightmap resolution.
3. Click **Generate Terrain**.

The default is a 1000 × 1000 × 560 m Highlands recipe with a 257 × 257 grid.
Advanced Noise Stack controls expose the same 13 layer types, blend modes,
height/noise/slope/biome masks, normalization, smoothing, climate settings, and
stack presets as the Blender extension. Tiles use shared assembly coordinates,
so adjacent TerrainData borders remain identical.

Every generated hierarchy references a `TerrainGenerationRecipe` asset. Select
its root or any generated tile, click **Load Selected**, edit the settings, and
click **Regenerate Selected**. Unrelated children below the generated root are
preserved. The sixteen-million-sample safety limit matches Blender.

## Install and import

1. Add this package through Unity Package Manager using its local folder.
2. In Procedural Terrains, select the **Unity Terrain** export target.
3. In Unity, open **Window > Procedural Terrains > Terrain Importer**.
4. Select the exported ZIP and click **Import ZIP and Build Scene**.

The importer extracts the archive into a unique folder below
`Assets/ProceduralTerrains/Imports`, imports `project.ptrterrain`, creates one
`TerrainData` and Terrain GameObject per tile, connects adjacent tiles, and
creates a pipeline-compatible Terrain Material and a baked TerrainLayer from
the exported color and normal maps. The material uses the native Terrain shader
for Built-in, URP, or HDRP; textures are assigned through the TerrainLayer. You
can also drag an already imported `TerrainProjectAsset` into
the window and rebuild its terrain hierarchy.

Native creation covers procedural Noise Stack terrain geometry and a generated
height/slope preview surface. Runtime generation, water, detailed biome
materials, erosion fields, props, and splines remain deferred. Baked imports
remain authoritative for exact editor surface appearance and unsupported scene
features.
