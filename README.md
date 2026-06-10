# Terrain Studio

A shader-driven procedural terrain generator/editor built with **React + Vite + Three.js (WebGL2)**.

One **single fixed terrain board** (no infinite world, no streaming) is divided into an
internal chunk grid purely for LOD. Height, normals and biome colors are all computed
**on the GPU** — there is no CPU heightmap and no image textures.

## Run

```sh
npm install
npm run dev
```

The dev server starts on **http://localhost:6061** and is also reachable on your
local network (it listens on all interfaces — Vite prints the LAN URL, e.g.
`http://192.168.x.x:6061`). The port is strict: if 6061 is taken, the server fails
instead of silently moving.

Production build: `npm run build` (output in `dist/`), preview it with `npm run preview`.

## Architecture

The WebGL **engine** is framework-agnostic (`src/engine/`); the editor **UI** is React
(`src/components/`). They talk through `Engine` methods + a callbacks object — React
mirrors the engine's parameter state and renders the panels.

| File | Role |
|---|---|
| [src/engine/terrain/terrainGLSL.js](src/engine/terrain/terrainGLSL.js) | Shared GLSL: hash/value noise, FBM, ridged multifractal, domain warp, the deterministic `heightAt()` field and the moisture field |
| [src/engine/terrain/TerrainMaterial.js](src/engine/terrain/TerrainMaterial.js) | Terrain shader — vertex displacement + skirts, finite-difference normals, biome blending (height/slope/moisture/detail), lighting, AO, fog, grid overlay, LOD debug |
| [src/engine/terrain/WaterMaterial.js](src/engine/terrain/WaterMaterial.js) | Sea plane — shares the height field for depth tint + shore foam |
| [src/engine/terrain/ChunkGeometry.js](src/engine/terrain/ChunkGeometry.js) | Unit chunk grid + skirt ring (hides cracks between LOD levels) |
| [src/engine/terrain/TerrainBoard.js](src/engine/terrain/TerrainBoard.js) | The single board: N×N chunk meshes sharing 4 LOD geometries and one material |
| [src/engine/EditorControls.js](src/engine/EditorControls.js) | Mouse camera: left-drag pan (clamped to board), right-drag orbit, wheel zoom, orbit/top-down modes |
| [src/engine/Minimap.js](src/engine/Minimap.js) | Top-down render-to-target minimap with live camera marker |
| [src/engine/presets.js](src/engine/presets.js) | Default params + terrain presets (parameter patches, nothing hardcoded) |
| [src/engine/Engine.js](src/engine/Engine.js) | Engine shell: renderer, scene, param→uniform plumbing, exports, save/load |
| [src/App.jsx](src/App.jsx) | React root: engine lifecycle + state bridge |
| [src/components/](src/components/LeftPanel.jsx) | Editor panels: top bar, schema-driven left controls, camera/LOD/minimap panels, status bar, settings modal |

## Key properties

- **Deterministic**: terrain is a pure function of `(world XZ, seed, params)`. The seed
  drives a domain offset via a mulberry32 PRNG; `Math.random()` is never used for shape.
- **No cracks**: every chunk geometry carries a skirt ring dropped in the vertex shader,
  so adjacent chunks at different LODs never show gaps.
- **Live editing**: every slider maps to a shader uniform — only chunk count/size
  trigger a geometry rebuild.
- **Camera never shapes terrain**: LOD is view-dependent (as it should be), the height
  field is not.

## Controls

- **Left-drag** — pan across the board (clamped)
- **Right-drag** — orbit
- **Scroll** — zoom
- Bottom toolbar: top-down / angled / reset camera

## Exports

- Screenshot (PNG) of the current viewport
- Heightmap (PNG, 1024², grayscale) rendered orthographically from the same shader

## Performance notes

Normals are finite-differenced per fragment (3 height evaluations per pixel), which is
what makes distant terrain stay crisp at low geometric LOD. On weaker GPUs, lower the
Pixel Ratio in Project Settings or reduce Octaves.
