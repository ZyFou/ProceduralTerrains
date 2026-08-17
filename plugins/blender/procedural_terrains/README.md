# Procedural Terrains for Blender 5.2

This alpha extension imports validated Procedural Terrains ZIP exports and
renderer-neutral `.ptrterrain` documents. It builds a collection of native,
editable Blender mesh objects from the authoritative RAW heightfields, creates
UVs, applies baked color and tangent-space normal textures, and stores project
and tile metadata as custom properties.

## Install

1. In Blender 5.2, open **Edit > Preferences > Get Extensions**.
2. Open the menu and choose **Install from Disk**.
3. Select `procedural-terrains-blender-0.2.0.zip`.
4. Enable **Procedural Terrains** if Blender does not enable it automatically.

## Import

1. In Procedural Terrains, select the **Blender Scene** production preset and
   export the ZIP.
2. In Blender, choose **File > Import > Procedural Terrains
   (.zip/.ptrterrain)**, or use **3D View > Sidebar > Terrain**.
3. Select the exported ZIP and choose the desired editable mesh resolution.
4. Click **Import Procedural Terrain**.

The default Automatic setting uses at most 513 x 513 vertices per tile while
sampling the complete source height range. Use Full source resolution only
when the extra density is intentional; a 4097 grid contains more than 16
million vertices per tile.

## Coordinate mapping

The interchange document is Y-up. The add-on applies the right-handed mapping
`source (X, Y, Z) -> Blender (X, -Z, Y)`. Tile centers, heights, UVs, and normal
maps all use this mapping consistently. Units remain meters.

## Alpha scope

Available now:

- ZIP and `.ptrterrain` schema validation
- safe, bounded ZIP extraction
- one editable mesh object per heightfield tile
- baked color and normal materials
- packed ZIP texture images
- project, feature, splat, and generation metadata as custom properties
- undo for completed imports

Water, props, splines, procedural generation inside Blender, and detailed
biome reconstruction remain deferred. They are reported as warnings and the
baked terrain remains authoritative.
