# Procedural Terrains for Blender 5.2

Version 0.4.0 creates editable procedural terrain directly in Blender and
imports validated Procedural Terrains ZIP/`.ptrterrain` exports. Both workflows
produce ordinary Blender mesh objects with UVs and source metadata.

## Install

1. Open **Edit > Preferences > Get Extensions** in Blender 5.2.
2. Open the extensions menu and choose **Install from Disk**.
3. Select `procedural-terrains-blender-0.4.0.zip` and enable the extension.
4. Open **3D View > Sidebar > Terrain**.

## Create terrain

Choose **Create**, select a terrain preset, seed, dimensions, tile grid, and
mesh resolution, then click **Generate Terrain**. The default is a 1000 × 1000
× 560 m Highlands terrain with a 513 × 513 grid.

Advanced Noise Stack controls expose the editor's 13 layer types, blend modes,
height/noise/slope/biome masks, normalization, smoothing, climate controls, and
all current stack presets. Generated tiles share global sample coordinates, so
their border vertices remain identical.

Generated collections store their complete recipe. Select a generated tile,
click **Load Selected**, edit the settings, and use **Regenerate Selected**.
Only generated tile objects are replaced; unrelated objects in the collection
are retained. All creation and regeneration operators support Blender undo.

## Detail, erosion and surfaces

Choose Draft (129), Standard (257), High (513), Very High (1025), or Custom.
The sidebar reports sample spacing in meters. Fine Detail exposes amplitude,
wavelength and slope influence and limits its frequency to mesh density. Thermal
Erosion exposes iterations, strength and stability angle; it processes the entire
assembly before tiling, conserves material and keeps the outer border fixed.
Defaults are 2 m / 40 m detail and 30 passes / 0.4 strength / 30 degrees erosion.

The editable procedural material combines sand, grass, rock and snow using global
altitude/slope weights. Colors, grain scale, normal strength, snow height, rock slope
and transition softness are configurable. World-aligned attributes and shared
custom normals keep tile seams continuous. Legacy Preview remains selectable.
Old recipes load with new effects and water disabled and their preview retained.
Exact studio appearance is still available by importing baked color and normal maps.

## Placeholder water

Native generation and imports create one separate Water Placeholder mesh per
collection. Creation starts at the preset's formation sea level. Import offers
From Source / Enabled / Disabled and a custom level above placement; source levels
follow source minimum elevation, vertical scale and cursor placement.

Select any tile or its water, click **Edit Selected Water**, and change Visible,
Level or Color. Changes apply immediately, update viewport and render visibility,
and persist in the native recipe without regeneration. The water is a flat opaque
blue surface with no simulation. No clouds or props are generated.

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

Native creation covers Noise Stack geometry, fine detail, thermal erosion and
procedural surfaces. Node graphs, manual sculpt/paint documents, hydraulic erosion
fields and exact studio biome shaders remain baked-import features. Source water
is approximated by a flat placeholder and reported as such. Unsupported scene
features remain preserved in metadata and reported as import warnings.

## Performance

The sidebar reports the estimated vertex count, warns above one million, and
blocks generation above sixteen million vertices. Start with 129 or 257 while
designing, then regenerate at 513 or 1025 only when the added density is useful.
