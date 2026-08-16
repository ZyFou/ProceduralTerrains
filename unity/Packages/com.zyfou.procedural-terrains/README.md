# Procedural Terrains for Unity

This alpha foundation imports renderer-neutral `.ptrterrain` JSON documents
exported by Procedural Terrains. It creates a `TerrainProjectAsset` containing
validated bounds, tile descriptors, baked-field references, feature metadata,
and optional generation source data.

## Install and import

1. Add this package through Unity Package Manager using its local folder.
2. In Procedural Terrains, select the **Unity Terrain** export target.
3. Extract the exported `Terrain` folder anywhere below the Unity project's
   `Assets` folder.
4. Select `project.ptrterrain` to inspect the imported project summary.

This version does not create `TerrainData`, materials, scene objects, water, or
props. Baked RAW heightfields are validated but not rendered yet.
