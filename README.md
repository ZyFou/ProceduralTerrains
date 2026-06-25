# Procedural Terrains

A shader-driven procedural terrain generator and editor built with **React + Vite + Three.js (WebGL2)**.

Height, normals and biome colors are computed **on the GPU** — there is no baked CPU heightmap
driving the live view. The app ships three world modes (switchable from the top bar):

| Mode | What it is |
|---|---|
| **Tile** | Fixed terrain board with per-chunk LOD — best for painting, multi-tile layouts and exports |
| **Infinite World** | Streamed chunk grid around the camera with FPS walk / plane exploration |
| **Planet** | Cube-sphere procedural planet with atmosphere, volumetric clouds and orbit camera |

## Run

```sh
npm install
npm run dev
```

The dev server starts on **http://localhost:6061** and is also reachable on your local network
(Vite listens on all interfaces and prints the LAN URL, e.g. `http://192.168.x.x:6061`).
If port 6061 is already in use, Vite picks the next free port.

Production build: `npm run build` (output in `dist/`), preview it with `npm run preview`.

## Architecture

The WebGL **engine** is framework-agnostic (`src/engine/`); the editor **UI** is React
(`src/components/`). They talk through `Engine` methods + a callbacks object — React mirrors
the engine's parameter state and renders the side-panel controls.

| Area | Key files |
|---|---|
| **Core** | [src/engine/Engine.js](src/engine/Engine.js) — renderer, scene, param→uniform plumbing, save/load, undo state |
| **Tile board** | [src/engine/terrain/TerrainBoard.js](src/engine/terrain/TerrainBoard.js), [ChunkGeometry.js](src/engine/terrain/ChunkGeometry.js), [BoardPlinth.js](src/engine/terrain/BoardPlinth.js) |
| **Infinite world** | [src/engine/terrain/InfiniteWorld.js](src/engine/terrain/InfiniteWorld.js) — streamed chunks, triangle budget, behind-camera culling |
| **Planet** | [src/engine/terrain/PlanetWorld.js](src/engine/terrain/PlanetWorld.js), [PlanetMaterial.js](src/engine/terrain/PlanetMaterial.js), [PlanetOrbitControls.js](src/engine/PlanetOrbitControls.js) |
| **Noise stack** | [src/engine/terrain/noise/NoiseStack.js](src/engine/terrain/noise/NoiseStack.js), [noiseStackCodegen.js](src/engine/terrain/noise/noiseStackCodegen.js) — layered, serializable noise layers compiled to GLSL |
| **Shaders** | [src/engine/terrain/terrainGLSL.js](src/engine/terrain/terrainGLSL.js), [TerrainMaterial.js](src/engine/terrain/TerrainMaterial.js), [WaterMaterial.js](src/engine/terrain/WaterMaterial.js) |
| **Water** | [src/engine/water/WaterSystem.js](src/engine/water/WaterSystem.js), [RealisticWaterMaterial.js](src/engine/water/RealisticWaterMaterial.js), [UnderwaterEffect.js](src/engine/render/UnderwaterEffect.js) |
| **Sky & clouds** | [src/engine/sky/ProceduralSky.js](src/engine/sky/ProceduralSky.js), [CloudSlabLayer.js](src/engine/sky/CloudSlabLayer.js), [PlanetCloudChunks.js](src/engine/sky/PlanetCloudChunks.js), [TimeOfDay.js](src/engine/sky/TimeOfDay.js) |
| **Style** | [src/engine/style/PlanetStyleManager.js](src/engine/style/PlanetStyleManager.js), [ColorPalette.js](src/engine/style/ColorPalette.js) |
| **Paint** | [src/paint/PaintModeManager.js](src/paint/PaintModeManager.js) — height / biome / props brush layers (Tile mode) |
| **Export** | [src/engine/terrain/TerrainExporter.js](src/engine/terrain/TerrainExporter.js), [PlanetExporter.js](src/engine/terrain/PlanetExporter.js) |
| **UI** | [src/App.jsx](src/App.jsx), [src/components/panels/index.jsx](src/components/panels/index.jsx) — schema-driven side panels, settings search, performance overlay |

## Key properties

- **Deterministic**: terrain is a pure function of `(world XZ, seed, params)`. The seed drives
  a domain offset via a mulberry32 PRNG; `Math.random()` is never used for shape.
- **Layered noise**: a stack of typed noise layers (add, carve, replace, …) is codegen'd into
  the terrain shader and serializes with every save.
- **No cracks**: chunk geometries carry skirt rings dropped in the vertex shader so adjacent
  chunks at different LODs never show gaps.
- **Live editing**: most sliders map to shader uniforms — only chunk count/size, tile layout,
  planet radius and a few structural keys trigger a geometry rebuild.
- **Camera never shapes terrain**: LOD is view-dependent; the height field is not.
- **Undo / redo**: full project state (params, tiles, paint layers) with `Ctrl+Z` / `Ctrl+Y`.
- **Save / load**: seed + all parameters as JSON from the top bar.

## Tile mode extras

- **Multi-tile assembly**: place tiles on a grid to build larger landscapes; export merged or
  per-tile.
- **Square or circle layout**: circle mode clips terrain to a disk, supports ring expansion,
  and renders a radial wall that follows the terrain silhouette.
- **Paint mode**: brush height, rivers, biomes and procedural props onto the board.
- **Real-world heightmaps**: import location-based elevation data (preview, replace or blend).
- **Close-range detail layer**: extra surface detail near the camera in Tile mode.

## Controls

**Editor camera (Tile mode)**
- **Left-drag** — pan across the board (clamped)
- **Right-drag** — orbit
- **Scroll** — zoom
- Bottom toolbar: top-down / angled / reset camera

**Exploration (Infinite World & Planet)**
- Bottom toolbar **Explore** menu: **Walk** (FPS) or **Plane** (fly-through)
- Touch controls on mobile while exploring

**Shortcuts**
- `Ctrl+K` — search all settings
- `Ctrl+Z` / `Ctrl+Y` — undo / redo
- `Ctrl+Shift+P` — developer performance overlay (also via the FPS badge in the status bar)

## Exports

Quick actions (Export panel):
- **Screenshot** — PNG of the current viewport
- **Heightmap** — orthographic grayscale bake from the same shader

Full export (ZIP with optional contents):
- Terrain mesh as **GLB/GLTF** or **OBJ** (configurable resolution, skirts, base slab)
- Baked **color**, **normal** and **heightmap** textures
- **Biome splat** map, **collision** mesh, water surface mesh
- Water masks (depth, shoreline, foam) and preset JSON for re-import

Planet mode has a dedicated planet exporter with cubemap height baking.

## Performance notes

Normals are finite-differenced per fragment (multiple height evaluations per pixel), which
keeps distant terrain crisp at low geometric LOD. The **Performance** panel offers GPU-tier
detection, quality presets, LOD budgets and renderer options. On weaker GPUs, lower the pixel
ratio, reduce octaves/layer count, or switch to a lighter water quality mode.
