# WebGPU migration handoff

Date: 2026-08-28  
Project: Procedural Terrains 1.7.1  
Current Windows branch: `engine_boot_rework`  
HEAD observed while writing this handoff: `365c577`  
Three.js: `0.185.1`

## Prompt for the next Codex task

Use this document as the authoritative engineering handoff for the native WebGPU migration. Start from branch `engine_boot_rework` at commit `365c577` or later and inspect the working tree before changing anything. Continue the migration in the order below. Preserve the WebGL2 fallback and do not set `applicationReady` to true until every production material is implemented, compiled on native WebGPU, visually compared with WebGL2, and entered in the validated registry. Start by running the existing tests/build and the production-material canary on the Mac, then port the terrain material family using specialized TSL graphs rather than a universal shader.

## Objective

Make native WebGPU the default renderer when the browser supports it, while keeping an atomic WebGL2 fallback. The user cares primarily about:

- fewer browser freezes during boot and world-mode transitions;
- no shader-link or mode-transition crashes;
- lower avoidable GPU pressure;
- no visual regressions in Studio/manual/nodal, Infinite World, or Planet modes;
- safe behavior when WebGPU is unavailable or the device is lost.

This is a correctness-first migration. Do not force WebGPU merely because `navigator.gpu` exists. Three.js cannot translate the application's existing GLSL `ShaderMaterial` programs into WGSL automatically.

## Transfer warning

The WebGPU implementation described below is committed in `365c577` on branch `engine_boot_rework` and was already present on `origin/engine_boot_rework` when this handoff was finalized. Pull that branch on the Mac rather than checking out the repository's default branch.

Important files created by that commit include:

- `src/engine/render/webgpu/WebGpuMaterialBackend.js`
- `tests/GpuTier.test.js`
- `tests/RendererBootstrap.test.js`
- `tests/WebGpuMaterialBackend.test.js`

After pulling, run `git status --short` and confirm these files exist on the Mac.

## What is already implemented

### Renderer bootstrap and fallback

- `EngineProxy` now initializes the renderer asynchronously before `Engine` creates GPU resources.
- `createRendererForCanvasAsync()` can initialize `THREE.WebGPURenderer`, rejects Three.js' internal WebGL fallback, and creates a fresh WebGL2 renderer if native WebGPU initialization fails.
- `Auto` selects WebGPU only when the application readiness gate is true.
- `Engine` receives the initialized renderer and optional material backend.
- WebGPU adapter/device capability reporting and GPU-tier selection are backend-neutral.
- WebGPU `device.lost` is observed. Ongoing publication/transition work is cancelled and the UI requires a reload rather than hanging indefinitely.
- WebGPU compilation paths use `compileAsync()` and do not inspect WebGL program internals.
- Renderer readback has a WebGPU async path. The normal WebGL2 RGBA8 path uses a pixel-pack buffer plus fence rather than a synchronous application readback.

Primary files:

- `src/engine/EngineProxy.js`
- `src/engine/Engine.js`
- `src/engine/render/createWebGLRenderer.js`
- `src/engine/render/RendererCapabilities.js`
- `src/engine/render/GpuTier.js`
- `src/engine/render/RendererReadback.js`

### Native material backend

`src/engine/render/webgpu/WebGpuMaterialBackend.js` is dynamically imported only after the active renderer is confirmed as native WebGPU. This keeps Three WebGPU/TSL code out of the normal WebGL2 boot path.

Six of the 22 concrete production material families have native TSL/NodeMaterial implementations:

1. `sky-procedural`
2. `post-look`
3. `post-camera`
4. `underwater`
5. `cloud-composite`
6. `cloud-occupancy`

The backend preserves the existing mutable uniform contract. Existing code can still use expressions such as `material.uniforms.uTime.value = value`; on WebGPU those entries are TSL uniform or texture nodes.

Backend injection is already threaded through:

- `ProceduralSky`
- `VisualPostProcess`
- `UnderwaterEffect`
- `CloudLowResPass`
- `CloudOccupancyPass`
- `CloudSlabLayer`
- `PlanetCloudLayer`

The cloud occupancy port includes the exact three-octave cloud value-noise field and both 3x3 dilation passes. Its `setUniforms()` implementation synchronizes replacement cloud-material uniforms into the already-compiled node graph.

### Readiness registry

`src/engine/render/RendererBackendStatus.js` separates three concepts:

- reusable node families exist;
- a concrete production material has been ported;
- that material has passed native compilation/rendering and visual parity validation.

Current state:

- ported production materials: 6/22;
- validated production materials: 0/22;
- exact material families: none;
- `applicationReady`: `false`;
- default renderer: still WebGL2.

This closed gate is deliberate. Do not add a material to `VALIDATED_PRODUCTION_MATERIALS` merely because unit tests can construct its node graph.

### Native production-material canary

`src/engine/render/WebGpuRuntimeValidation.js` contains two validations:

- a small generic WebGPU/TSL draw and async readback;
- `validateWebGpuProductionMaterials()`, which creates a short-lived native WebGPU renderer, compiles/renders the six ported production materials, executes cloud occupancy generation/dilation, and performs a readback.

The Performance panel exposes the second test as:

`Performance > GPU / Renderer > Run WebGPU Canary`

It is click-triggered and dynamically imported, so it adds no work to normal boot. The returned text tells how many materials passed before any failure.

## Validation already completed on Windows

- Full test suite: 69 files, 575 tests passed.
- Production build: passed with `npm run build`.
- Production Chromium smoke test: landing terrain rendered correctly.
- Browser console: only the expected API HTTP 500 from the isolated Vite preview, because the API service was not running. No new React, shader, or WebGL exception was observed.
- Headless Chromium may expose `navigator.gpu` but provide no native adapter; the canary must reject Three.js' WebGL fallback and report failure in that case. This is expected and is not a reason to weaken the check.

Useful commands:

```powershell
npm install
npm run test
npm run build
npm run dev
```

If the API responses are needed during browser testing, also run:

```powershell
npm run dev:api
```

## Remaining production materials

The registry currently requires these unported concrete paths:

### Terrain

- `terrain-studio`
- `terrain-manual`
- `terrain-nodes`
- `terrain-infinite`
- `terrain-planet`

### Water

- `water-studio-legacy`
- `water-studio-realistic`
- `water-infinite`
- `water-planet`

### Volumetric clouds

- `cloud-studio`
- `cloud-planet`

### Authoring, export and props

- `height-baker-studio`
- `height-baker-planet`
- `export-studio`
- `export-planet`
- `props-standard-patches`

## Recommended continuation plan

### Part 1 — Establish the Mac native baseline

1. Confirm the transferred working tree and dependency versions.
2. Run the full tests and production build before editing.
3. Use a normal hardware-accelerated Chrome session on the Mac and run `Run WebGPU Canary`.
4. Record the exact result and console output. Fix any WGSL/TSL compilation issue in the six existing ports before marking anything validated.
5. Add a repeatable native result artifact or golden capture format. Unit graph-construction tests are necessary but insufficient.

Exit criteria:

- all six current ports compile and draw on native WebGPU;
- readback is non-empty;
- no validation uses Three.js' WebGL fallback;
- WebGL2 boot remains visually unchanged.

### Part 2 — Port the terrain family first

This is the critical path and likely the largest source of shader compilation stalls.

Relevant sources:

- `src/engine/terrain/TerrainMaterial.js`
- `src/engine/terrain/PlanetMaterial.js`
- `src/engine/terrain/InfiniteTerrainClipmap.js`
- `src/engine/terrain/terrainGLSL.js`
- `src/engine/terrain/biomeGLSL.js`
- `src/engine/terrain/noise/`
- `src/engine/render/tsl/SharedTerrainNodes.js`
- graph compiler/evaluator code under `src/engine/graph/` and `src/engine/terrain/`

Implementation rules:

1. Do not build one universal terrain graph containing dormant Studio, Infinite and Planet branches. Produce specialized material graphs per world mode and terrain source.
2. Preserve exact graph semantics for procedural and nodal terrain. The existing `SharedTerrainNodes.js` proves the TSL architecture but is not yet an exact replacement for every live graph.
3. Keep manual terrain separate. It should sample the manual height/paint data without compiling the complete procedural graph.
4. Infinite terrain must preserve clipmap topology, cache sampling, seam/skirt behavior and the recent smooth LOD normal transition. Do not reintroduce the black LOD ring.
5. Planet terrain must preserve spherical displacement, planet-local coordinates, biome/coloring and atmosphere/water integration.
6. Preserve the existing uniform mutation APIs while the rest of the engine remains backend-neutral.
7. Add each concrete material to `portedProductionMaterials` only after the actual runtime factory uses the native material on the WebGPU path.
8. Add it to the production canary and compile both representative minimal and full feature variants.

Suggested order:

1. `terrain-manual`
2. `terrain-studio`
3. `terrain-nodes`
4. `terrain-infinite`
5. `terrain-planet`

Manual terrain is the smallest useful end-to-end path and can establish the mesh/material integration before the graph compiler is ported.

### Part 3 — Port water after terrain height authority is stable

Relevant sources:

- `src/engine/terrain/WaterMaterial.js`
- `src/engine/water/RealisticWaterMaterial.js`
- `src/engine/water/WaterMaterialFactory.js`
- `src/engine/water/WaterSystem.js`
- `src/engine/water/waterShaderGLSL.js`
- `src/engine/water/waterLightingGLSL.js`
- planet water creation in `src/engine/terrain/PlanetMaterial.js`

Requirements:

- Legacy water must use the same terrain-height authority as terrain for wet masks, depth tint and shoreline foam.
- Infinite water must preserve its cached terrain sampling and distance fade.
- Realistic water must preserve reflection/refraction targets, normals, depth, fog and active sky/sun lighting.
- Planet water must preserve the spherical shell and planet-local depth/shore behavior.
- Avoid recompilation for quality sliders that are currently uniforms.

Suggested order:

1. Studio legacy water
2. Infinite legacy water
3. Planet water
4. Studio/infinite realistic water

### Part 4 — Port the visible volumetric cloud raymarchs

Relevant sources:

- `src/engine/sky/CloudSlabShader.js`
- `src/engine/sky/CloudVolumeShader.js`
- `src/engine/sky/cloudGLSL.js`
- `src/engine/sky/CloudSlabLayer.js`
- `src/engine/sky/PlanetCloudLayer.js`

The composite and occupancy passes are already native. Remaining work is the Studio slab and Planet shell raymarch.

Requirements:

- Share the already ported cloud value-noise functions instead of creating a visually different noise family.
- Keep compile-time specializations for step count, light steps, octaves, erosion and light mode where that materially reduces pipelines.
- Preserve empty-space occupancy, depth occlusion, near-biased intervals, physical extinction length, low-resolution rendering and bilateral composite.
- Ensure quality changes compile the replacement in the background and atomically swap only after readiness.

### Part 5 — Port hidden authoring/export passes and props

Relevant sources:

- `src/engine/terrain/TerrainHeightBaker.js`
- `src/engine/terrain/PlanetHeightBaker.js`
- `src/engine/terrain/TerrainExporter.js`
- `src/engine/terrain/PlanetExporter.js`
- `src/engine/props/GrassMaterial.js`
- `src/engine/props/ProceduralPropsManager.js`

These cannot be skipped. A native editor that works visually but crashes when baking or exporting is not application-ready.

Prefer sharing the exact height/biome TSL nodes used by the visible terrain. Do not maintain a second approximate export implementation. Replace `onBeforeCompile` patches with NodeMaterial equivalents on the WebGPU path while leaving the current WebGL2 path intact.

### Part 6 — Golden parity and registry promotion

For every production material:

1. Compile and render it on native WebGPU.
2. Capture representative WebGL2 and WebGPU frames or render-target buffers using identical inputs.
3. Compare with `src/engine/render/BackendImageParity.js`.
4. Inspect images visually; metrics alone can miss spatially localized seams.
5. Test all world transitions, including rapid cancellation:
   - Studio procedural to manual and back
   - Studio procedural to nodal and back
   - Studio to Infinite to Planet to Infinite
   - repeated rapid mode clicks
6. Test cold and warm shader caches.
7. Test water off/on, clouds off/on and representative quality presets.
8. Test height baking and both export paths.
9. Test device loss or simulated loss handling.
10. Only then move the material name into `VALIDATED_PRODUCTION_MATERIALS`.

When every concrete material is validated, populate `EXACT_MATERIAL_FAMILIES`. `APPLICATION_READY` is computed from both lists and should become true without a hard-coded override.

### Part 7 — Enable WebGPU Auto and retain rollback

Once the gate becomes true:

- `Auto` will already request WebGPU through `createRendererForCanvasAsync()`.
- Keep explicit `WebGL` as a user-selectable rollback.
- Keep atomic WebGPU initialization failure fallback.
- Confirm `WebGPU` becomes selectable in Performance settings.
- Update UI copy from migration status to validated status.
- Run the full hardware/display acceptance matrix, not only one laptop/browser.

## Acceptance criteria

The migration is complete only when all of the following are true:

- 22/22 production materials are ported and validated.
- Seven shader families are exact.
- `WEBGPU_RENDERER_STATUS.applicationReady === true` through computed coverage.
- `Auto` selects native WebGPU on a supported browser.
- Unsupported WebGPU or initialization failure falls back to a fresh WebGL2 renderer.
- No production WebGPU path instantiates a GLSL `ShaderMaterial` or relies on `onBeforeCompile`.
- Studio procedural/manual/nodal, Infinite and Planet all render correctly.
- Rapid mode changes do not surface stale warmup failures.
- No black Infinite LOD transition ring reappears.
- Water, clouds, underwater view, height baking and exports work.
- Device loss never leaves a perpetual loading screen.
- Full tests and production build pass.
- Native WebGPU cold/warm measurements and WebGL2 comparisons are recorded.

## Performance guardrails

WebGPU alone does not guarantee lower GPU usage. During the port:

- retain render-scale, terrain-resolution, cloud-scale and distance controls;
- avoid allocating duplicate full-resolution color/depth targets;
- dispose replaced materials and render targets only after pending compilation is safe;
- prefer cached height/biome textures where this reduces repeated procedural evaluation;
- keep shader specializations small and explicit;
- do not synchronously read GPU buffers on animation or transition paths;
- measure cold compilation, warm transition time, frame time, VRAM/target bytes and browser responsiveness separately.

## Known unrelated console noise

An isolated Vite preview without the API service returns HTTP 500 for endpoints such as:

- `/api/v1/analytics/visit`
- `/api/v1/auth/session`

Those responses are not renderer failures. Browser-extension messages such as `Receiving end does not exist` are also external to the renderer. Continue to investigate any actual JavaScript, TSL/WGSL, validation, device-loss or render error.

## Tests most relevant to this migration

- `tests/RendererBootstrap.test.js`
- `tests/RendererCapabilities.test.js`
- `tests/GpuTier.test.js`
- `tests/BootShaderCompilation.test.js`
- `tests/PerformancePhase3WebGpu.test.js`
- `tests/WebGpuMaterialBackend.test.js`
- `tests/RendererReadback.test.js`
- `tests/ModeTransitionCoordinator.test.js`
- `tests/ModeLaunchReadiness.test.js`
- `tests/CloudPerformance.test.js`
- `tests/TerrainMaterial.test.js`
- `tests/InfiniteWorldPerformance.test.js`
- `tests/WaterStartup.test.js`
- `tests/RealisticWaterV2.test.js`
- `tests/ResourceLifetime.test.js`

After each material family, run targeted tests first, then the full suite and production build. Perform a real browser screenshot/console inspection after every meaningful visual change.

## Mac continuation log — 2026-08-28

Hardware baseline: Apple M4 Pro, normal hardware-accelerated Chromium session.

- Restored the locked Three.js `0.185.1` dependency on the Mac. The transferred
  `node_modules` directory contained `0.160.1`, which did not expose
  `three/webgpu` or `three/tsl`.
- Fixed two native cloud-occupancy canary issues: the fullscreen pass now uses
  a projection camera that WebGPU can update for its clip-space convention, and
  the single-channel render target lets Three infer the backend-specific R8
  format instead of passing WebGL's `R8` spelling to WebGPU.
- Native canary result after those fixes: 6/6 existing production materials
  compiled, rendered, and produced a non-empty readback.
- Added specialized Manual terrain TSL graphs for `manual-empty` and painted
  `manual` variants. The runtime terrain factory returns these NodeMaterials
  when the native material backend is active and retains the shared mutable
  uniform contract.
- Native canary result with both Manual variants: passed, 7/22 production
  materials reported as ported. `terrain-manual` remains unvalidated.
- Hardened the Manual NodeMaterial data and inspection paths. Heightmap,
  collision and prop-placement outputs now bypass display gamma (including
  mode 3's visible-LOD height), and the native graph includes height, slope,
  normal, curvature and water-depth analysis views plus chunk-grid, LOD and
  merge-debug overlays.
- The native production canary now renders a real XZ Manual terrain plane with
  a constant 64/255 height texture and rejects gamma-corrupted or channel-skewed
  readback. Result on the M4 Pro: passed, 7 native materials compiled/rendered,
  linear Manual height byte = 64, with no new console warning/error.
- Remaining Manual parity work before validation: atlas diffuse/normal/rough/AO
  sampling, full detail and caustic layers, tile occupancy/wall edge cases,
  biome/detail-specific debug outputs, and WebGL2/WebGPU golden-image comparison.

## Mac continuation log — 2026-08-29

- Ported the painted Manual surface atlas to the native TSL graph. Manual A/B
  weights retain the WebGL role mapping and select the two strongest roles.
  Each selected role samples atlas diffuse plus packed normal/roughness/AO;
  the packed properties share triplanar samples to avoid a second property
  sampling pass. Distance fade, palette influence, stochastic breakup,
  triplanar/planar selection, normal relief, AO and roughness response are live
  uniforms.
- Added a mutable-array bridge for `uSurfTile` and `uSurfRolePresent`. Existing
  engine code can continue replacing `.value` arrays while native WebGPU reads
  padded uniform buffers.
- Found and fixed a WebGPU-only dynamic-resource issue during semantic canary
  validation. Three identifies TSL texture uniforms by texture UUID when it
  builds the graph, so installing an atlas after the fallback texture had been
  compiled retained the old binding. Native Manual materials now expose a
  narrow resource refresh hook; `_installSurfaceAtlas()` invokes it after
  swapping atlas textures and rebuilds the vertex/fragment nodes without
  changing the public uniform API.
- Ported Manual multi-tile visibility and wall classification: occupancy texture
  sampling, empty-neighbour outer walls, interior-seam preservation, circular
  disk clipping, radial-wall exemption and finite/single-board behavior.
- Strengthened `validateWebGpuProductionMaterials()` beyond compilation. It now
  verifies: linear Manual height byte near 64; unskewed grayscale channels;
  controlled Manual grass-mask coverage/amount; green-dominant atlas role
  lookup after a post-compile texture replacement; and a zero-color readback
  when the circular tile occupancy mask is empty.
- Native result on Apple M4 Pro: passed, 7 native materials compiled/rendered,
  all semantic Manual checks passed, and browser console contained no WebGPU
  warning/error.
- Validation after this lot: 69 test files / 580 tests passed; production build
  passed. The existing Vite chunk-size warnings are unchanged.
- `terrain-manual` remains ported but deliberately not promoted to validated.
  Remaining visual parity work is the full close-range detail/normal layer,
  underwater caustics, the remaining biome/detail debug views, and a controlled
  WebGL2/WebGPU golden-image comparison. After that, begin the exact Studio
  procedural height/noise-stack port; do not use the approximate demo height in
  `SharedTerrainNodes.js` as production parity.
- At the user's explicit request, WebGPU is now selectable during the migration
  and is the default renderer preference. `Auto` also prefers native WebGPU.
  Existing persisted settings that still contain the old implicit `auto`
  default migrate once to explicit `webgpu`; an explicit WebGL choice is never
  overwritten. Native renderer initialization failure still falls back
  atomically to a fresh WebGL2 renderer. The parity registry remains closed and
  the Performance panel continues to display the 7/22 migration warning.
- Browser smoke test after enabling the default: the Manual project reached
  `Ready`, Performance showed WebGPU selected and active, and the post-process
  null-sampler startup error was fixed with a valid fallback texture. Expected
  `ShaderMaterial is not compatible` diagnostics remain for production passes
  that have not yet been ported; these are migration work, not a reason to mark
  the registry validated.
- Fixed the WebGPU minimap failure reported from `MinimapOverlay`. Color mode no
  longer renders the complete Three.js scene into a secondary target under
  WebGPU; it uses the existing terrain/biome/water sampler, just like the other
  minimap modes. This removes the redundant scene pass/readback and prevents
  the minimap from submitting every remaining GLSL `ShaderMaterial` to
  NodeBuilder. Browser verification: opening the Manual project still exposes
  its known hybrid-terrain migration diagnostics, but opening the minimap adds
  zero new warning/error entries.
- Ported Studio Legacy water to a native TSL `MeshBasicNodeMaterial`. The graph
  keeps the mutable shared-uniform contract and covers Manual/baked terrain
  depth, tile and circular occupancy, waves, shallow/deep tint, sun/specular,
  foam, fog, distance fade and alpha. It is created through the normal water
  factory only when the WebGPU material backend is active; WebGL2 and the
  unported realistic/infinite/planet water paths are unchanged. The production
  canary now compiles/renders `water-studio-legacy`, and the parity registry is
  8/22 ported.
- Deliberately rejected an approximate procedural-height TSL prototype after a
  browser visual comparison. `terrain-studio` and hybrid generated-base terrain
  remain unported until the exact noise-stack/codegen semantics are available;
  do not promote them based only on successful compilation.
- Validation after the minimap/water slice: 70 test files / 583 tests passed;
  production build passed with only the unchanged Vite chunk-size warnings.
- Began the exact Studio Classic terrain port. The default single-legacy-layer
  stack now has a native TSL height graph covering the historical climate,
  biome weights, domain warp, FBM/ridged FBM, dunes, mountain chains, wetlands,
  canyon terraces, smoothing, stack normalization, tile/disk falloff, edge
  mountains, paint/spline/manual/erosion/destruction offsets and the live layer
  strength. It is intentionally specialized to Studio `base`, `detail`,
  `hybrid-surface` and `hybrid` variants with the default structural stack;
  custom stacks and the procedural surface/full variants still use their
  existing path until their exact graphs are ported. `terrain-studio` therefore
  remains outside the ported registry.
- Added safe material-topology swaps for edits that cross between this native
  Classic graph and an unported GLSL/custom-stack graph, including octave-count
  changes. Optional TSL texture uniforms now retain a transparent fallback when
  project loading clears them, preventing a `TextureNode` null-resource error.
- Native browser verification on the M4 Pro: cold boot and opening the saved
  Procedural Blank terrain both rendered with the WebGPU adapter, with zero
  warning/error entries and no `ShaderMaterial is not compatible` diagnostic.
  Observed final-frame times were 511 ms cold and 332 ms for the project mode
  transition on the test viewport. Final validation: 70 test files / 584 tests
  passed, and the production build passed with only the existing chunk-size
  warnings.
- Fixed WebGPU draw-call telemetry that appeared to leak upward forever. Three's
  common WebGPU `Info` object uses cumulative `render.calls` for render-pass
  submissions and frame-local `render.drawCalls` for actual draw commands,
  whereas WebGL exposes draw commands through `render.calls`. Engine pass stats
  and `PerformanceProfiler` now select the backend-correct field and explicitly
  reset pass-local counters. Browser reproduction changed from 2440→2824 over
  five seconds to a stable 33 draw calls across ten samples; triangles remained
  stable and the console had no warning/error, confirming this was telemetry
  accumulation rather than duplicated scene objects. Final validation after
  this fix: 70 test files / 586 tests passed and the production build passed.
- Fixed the Classic Studio quality/interaction regression exposed by the first
  native terrain rollout. Generated terrain no longer lights each triangle with
  a flat screen-space derivative normal: the vertex stage derives a continuous
  finite-difference normal from the exact height field and interpolates it,
  removing the low-poly faceting without increasing the geometry budget.
  Classic WebGPU FBM/ridged FBM now use bounded WGSL loops driven by a live
  `uOctaves` uniform, so octave edits reuse the existing pipeline instead of
  rebuilding the large terrain shader. Browser stress tests applied 28 rapid
  octave edits and 29 noise-scale edits at roughly 11 ms per update with zero
  shader compile/error logs; the reference view remained responsive at its
  existing triangle budget.
- Production rollout decision: WebGPU is no longer the default. Real-project
  visual validation still showed major material, lighting, texture and water
  parity gaps despite the isolated native terrain fixes. New settings and
  `Auto` now use WebGL2; settings written by the short-lived WebGPU-default
  rollout migrate once back to WebGL2. WebGPU remains an explicit experimental
  option only. Browser verification restored the complete saved-project look
  with `full, webgl2`, a 154 ms final frame, and no console error. Do not make
  WebGPU the default again without golden-image parity on representative saved
  projects, interactive latency checks, and all production material roles.
