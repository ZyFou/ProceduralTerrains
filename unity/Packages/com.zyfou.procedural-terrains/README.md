# Procedural Terrains for Unity

This alpha package imports renderer-neutral `.ptrterrain` JSON documents and
Unity ZIP exports produced by Procedural Terrains. It can create validated
`TerrainProjectAsset` metadata or build a ready-to-edit Unity Terrain hierarchy
with heightfields, colliders, baked surfaces, and connected tile neighbors.

## Install and import

1. Add this package through Unity Package Manager using its local folder.
2. In Procedural Terrains, select the **Unity Terrain** export target.
3. In Unity, open **Window > Procedural Terrains > Terrain Importer**.
4. Select the exported ZIP and click **Import ZIP and Build Scene**.

The importer extracts the archive into a unique folder below
`Assets/ProceduralTerrains/Imports`, imports `project.ptrterrain`, creates one
`TerrainData` and Terrain GameObject per tile, connects adjacent tiles, and
creates baked Material and TerrainLayer assets from the exported color and
normal maps. You can also drag an already imported `TerrainProjectAsset` into
the window and rebuild its terrain hierarchy.

The **Create** tab is intentionally marked as coming soon. Water, detailed
biome materials, props, splines, and procedural generation inside Unity remain
deferred; the baked terrain files remain authoritative.
