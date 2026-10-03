# Changelog

## 0.4.0-alpha.1

- Added density-aware fine detail and conservative thermal erosion over the full assembly.
- Added Draft/Standard/High/Very High quality presets, sample spacing and a 513 default.
- Added four procedural TerrainLayers with color/normal textures and altitude/slope alphamaps.
- Added independent placeholder water to native creation and import, with live level/color/visibility controls.
- Migrated old generation recipes without enabling new effects or changing their preview surface.
- Retained native TerrainData, colliders and neighbors; no clouds or props are generated.

## 0.3.0-alpha.1

- Enabled native seeded terrain creation in the Unity Editor.
- Ported all Blender terrain presets, Noise Stack presets, 13 layer types, 11 blend modes, and four mask types.
- Added tiled `TerrainData` generation with exact shared borders, colliders, connected neighbors, and height/slope preview TerrainLayers.
- Added persistent generation recipe assets plus Load Selected and Regenerate Selected workflows.
- Added density validation, cancelable progress, failure cleanup, and Blender CPU parity tests.

## 0.2.0-alpha.1

- Fixed broken Terrain rendering and instancing errors caused by assigning a generic Lit material.
- Generated materials now use the native Terrain shader for the active Built-in, URP, or HDRP pipeline.
- Baked color and normal textures remain assigned through a generated TerrainLayer.

## 0.2.0-alpha.0

- Added a dockable ZIP import window under `Window > Procedural Terrains`.
- Added safe, unique extraction below the Unity project's `Assets` folder.
- Added automatic `TerrainData`, collider, tile positioning, and neighbor creation.
- Added baked material and `TerrainLayer` generation from exported color and normal maps.
- Added an in-window Create tab marked as coming soon.

## 0.1.0-alpha.0

- Added the `.ptrterrain` scripted importer.
- Added runtime document validation and artifact dependency tracking.
- Added `TerrainProjectAsset` and a read-only project Inspector.
