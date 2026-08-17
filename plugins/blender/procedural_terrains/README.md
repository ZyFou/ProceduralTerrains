# Procedural Terrains for Blender 5.2

Version 0.3.3 creates editable procedural terrain directly in Blender and
imports validated Procedural Terrains ZIP/`.ptrterrain` exports. Both workflows
produce ordinary Blender mesh objects with UVs and source metadata.

## Install

1. Open **Edit > Preferences > Get Extensions** in Blender 5.2.
2. Open the extensions menu and choose **Install from Disk**.
3. Select `procedural-terrains-blender-0.3.3.zip` and enable the extension.
4. Open **3D View > Sidebar > Terrain**.

## Create terrain

Choose **Create**, select a terrain preset, seed, dimensions, tile grid, and
mesh resolution, then click **Generate Terrain**. The default is a 1000 × 1000
× 560 m Highlands terrain with a 257 × 257 grid.

Advanced Noise Stack controls expose the editor's 13 layer types, blend modes,
height/noise/slope/biome masks, normalization, smoothing, climate controls, and
all current stack presets. Generated tiles share global sample coordinates, so
their border vertices remain identical.

Generated collections store their complete recipe. Select a generated tile,
click **Load Selected**, edit the settings, and use **Regenerate Selected**.
Only generated tile objects are replaced; unrelated objects in the collection
are retained. All creation and regeneration operators support Blender undo.

The preview surface is a Blender-native height/slope material. Geometry matches
the Procedural Terrains CPU generation model; exact editor surface appearance is
available by importing baked color and normal textures.

## Import terrain

1. Export with the **Blender Scene** production preset.
2. In Blender, choose **File > Import > Procedural Terrains**, or choose
   **Import** in the Terrain sidebar.
3. Select the ZIP or `project.ptrterrain` document.
4. Keep **Source Dimensions**, or choose **Custom Dimensions** and enter the
   target total width and depth. Vertical Scale controls elevation separately.
5. Choose World Origin or 3D Cursor placement and click **Import and Build**.

Imports are centered as one assembly at the selected placement. The source
minimum elevation maps to the placement Z. Original and effective dimensions
are retained as collection/object custom properties.

Automatic mesh detail uses at most 513 × 513 vertices per tile. Full source
resolution should be intentional: a 4097 grid contains more than 16 million
vertices for one tile. ZIP texture images are always packed before temporary
extraction data is removed.

## Coordinate mapping

Runtime documents are Y-up. Import applies the right-handed mapping
`source (X, Y, Z) -> Blender (X, -Z, Y)`. Units remain meters. Native generated
terrain uses Blender X/Y horizontally and Z for elevation.

## Parity boundary

Native creation covers procedural Noise Stack terrain geometry. Node graphs,
manual sculpt/paint documents, erosion fields, detailed biome surfaces, water,
props, and splines remain authoritative baked-import features. Unsupported
scene features are preserved in metadata and reported as import warnings.

## Performance

The sidebar reports the estimated vertex count, warns above one million, and
blocks generation above sixteen million vertices. Start with 129 or 257 while
designing, then regenerate at 513 or 1025 only when the added density is useful.
