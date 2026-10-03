# Procedural Terrains for Unity

This alpha package creates deterministic procedural terrain directly in Unity
and imports renderer-neutral `.ptrterrain` documents and Unity ZIP exports.
Both workflows produce ready-to-edit native Unity Terrain hierarchies with
`TerrainData`, colliders, surfaces, and connected tile neighbors.

## Create terrain

1. Open **Window > Procedural Terrains > Terrain Importer** and choose **Create**.
2. Select a terrain preset, seed, dimensions, tile grid, and heightmap resolution.
3. Click **Generate Terrain**.

Version 0.4 defaults to a 1000 × 1000 × 560 m Highlands recipe with a 513 × 513 grid.
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

## Detail, erosion and surfaces

Choose Draft (129), Standard (257), High (513), Very High (1025), or Custom.
The window reports sample spacing in meters and keeps the sixteen-million-sample limit.
Fine Detail exposes amplitude, wavelength and slope influence; two seeded octaves
are limited by sample spacing. Thermal Erosion exposes iterations, strength and
stability angle and runs across the complete assembly with fixed outer borders.
Defaults are 2 m / 40 m detail and 30 passes / 0.4 strength / 30 degrees erosion.

Procedural surfaces create four editable TerrainLayers (sand, grass, rock and snow)
with generated color/normal textures and altitude/slope alphamaps. Colors, grain
scale, normal strength, snow height, rock slope and transition softness are editable.
The active Built-in/URP/HDRP Terrain shader is selected automatically. Disable
Procedural Surfaces to retain the original preview. Version-1 recipes load with
detail, thermal erosion and water disabled and the historical preview retained.

## Placeholder water

Creation includes one separate Water Placeholder object, initially at the preset's
formation sea level. Import offers Source / Enabled / Disabled water and an optional
custom level. Select an assembly to edit visibility, level and color in the window,
or select the water object in the Inspector; changes apply without regeneration and
are saved to its recipe. The plane has no collider, wave simulation or source shader.
Imported source water is reported as a placeholder rather than full reconstruction.

No clouds or props are generated. Native creation remains an approximation of the
studio's surfaces; baked imports remain authoritative for exact appearance. Runtime
generation, hydraulic erosion fields, node graphs and splines remain deferred.
