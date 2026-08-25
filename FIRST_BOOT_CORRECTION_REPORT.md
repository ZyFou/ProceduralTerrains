# First-Boot Final-Frame Correction Report

Date: 2026-08-25  
Branch: `first_load_optimization_25082026`  
Three.js: `0.185.1`

## Outcome

The launch path now has one cancellable, generation-owned boot coordinator. It
keeps the landing cover in place while it plans the render key, validates the
renderer, prepares final resources, builds the launch-camera terrain set,
compiles the exact material graph, and presents two identical frozen-time
frames. Only the successful `ready` terminal state invokes `onBootComplete`.

The first canvas draw is the final configured scene. The former placeholder
draw and automatic degraded-material reveal have been removed from the active
startup path. Camera orbit, simulation time, adaptive cloud quality and normal
terrain streaming remain frozen until presentation is confirmed.

## Implemented corrections

- Added the explicit lifecycle `planning → renderer → resources → geometry → compile → present → ready`, plus cancellable retry, failure and disposal states.
- Added an immutable `BootRenderKey`, stage timings, progress/error callbacks, `initialView`, and `retryBoot({ mode })`.
- Passed `initialView: "landing"` before engine construction, eliminating the previous landing-requirements race.
- Added blocking landing failure actions for full retry and the fixed compatibility profile.
- Removed the initial cloud bootstrap specialization; enabled clouds construct their selected final specialization directly.
- Prioritized launch-camera chunks with a dependency halo for shoreline, shadow and reflection contributors. Off-camera chunks remain deferred.
- Delayed landing auto-orbit until deferred terrain is built, preventing the camera from exposing missing chunks.
- Consolidated terrain, water, sky and post materials into one compiler submission so parallel driver compilation can overlap the two largest programs.
- Upgraded Three.js through the `0.170`, `0.180`, and `0.185.1` checkpoints. Tests and production builds were run at each checkpoint.
- Migrated TransformControls to the r185 `getHelper()` ownership API with a legacy scene-object fallback. Engine timing prefers `Timer` and safely falls back to `Clock` when an older cached Three.js runtime does not expose a constructible `Timer`.
- Added a monotonic six-phase loading indicator with a progressively colored terrain SVG, overall percentage, and active/completed phase markers.
- Added backend-neutral asynchronous render-target readback for terrain/planet exports and heightmap export.
- Enforced WebGL2 as the minimum current production backend; WebGL1 no longer silently starts.

## Observed boot trace

The local browser used ANGLE with parallel shader compilation enabled.

| Trace | Compiler behavior | Observed time |
| --- | --- | ---: |
| Serialized pre-correction run | Water compiled alone | 38,439 ms |
| Serialized pre-correction run | Terrain compiled afterwards | 43,411 ms |
| Consolidated verification run | 24 final materials submitted together | 2,426 ms compile wait |
| Consolidated verification run | Overlay start through confirmed final frame | 4,861 ms |

The consolidated verification benefited from the driver's warmed shader cache,
so it must not be presented as a cold-cache percentage improvement. It proves
the corrected orchestration and removes the known additive water-plus-terrain
wait. A controlled 30-run cold-cache study still requires a repeatable GPU
profile reset or clean browser/driver workers on the reference machines.

## Shader inventory and TSL status

The runtime still contains 23 custom GLSL `ShaderMaterial` construction sites.
Three.js `WebGPURenderer` cannot execute those materials, including the dynamic
terrain graph, water families, cloud raymarches, bakers/exporters and ordered
post passes. Switching the production renderer before those shaders have true
TSL equivalents would produce missing or black output and would violate the
final-frame contract.

Accordingly, this correction keeps the validated WebGL2 renderer active while
landing the r185 upgrade, renderer-neutral async readback boundary, boot state
machine, and compile optimization. The full 23-site TSL/WebGPU rewrite and its
backend-specific pixel goldens remain outstanding work; they are not falsely
reported as complete here.

## Validation

- Unit/integration suite: 55 files, 486 tests after the boot/readback, mode-transition, instancing, lazy-allocation, compatibility, renderer-lifetime, empty-Manual specialization, and monotonic-progress coverage.
- Production Vite build: successful on Three.js `0.185.1`.
- Browser smoke test: final landing visible, loading cover removed only after `ready`, no console errors, `data-first-frame="final"` published on the viewport canvas.
- Retry coordinator tests cover ordered stages, exactly-once completion, stale-generation cancellation, terminal compile failure and deterministic render keys.
- Renderer-readback tests cover WebGL2 caller-owned buffers and universal-renderer returned buffers.

## Reproduction

1. Run `npm run dev -- --host 127.0.0.1`.
2. Open the local URL with a clean browser profile and clear GPU shader cache if the platform provides a supported method.
3. Record `[boot] final frame ready`, `[shader compile]`, `canvas[data-boot-state]`, and `canvas[data-first-frame]`.
4. Repeat 30 launches per backend/reference machine; compute p50 and p95 from the final-frame duration.
5. Treat any canvas draw before `data-first-frame="final"`, any post-ready material swap, or any failed run that removes the loading cover as a release failure.

## Mode-transition correction (2026-08-25)

The editor mode path now uses a second cancellable coordinator with the exact
sequence `planning → resources → geometry → compile → present → ready`.
`transitionMode({ worldMode, projectMode, project })` is the public atomic
entry point; `setWorldMode()` remains a compatibility wrapper. The React mode
switch no longer polls the global `_compiling` counter and has no fixed reveal
delay. It awaits the exact transition promise, which resolves only after two
frozen final frames have been rendered and presented behind the opaque loader.

The transition contract includes monotonic `onModeProgress`, exactly-once
`onModeComplete`, normalized `onModeError`, cancellation by replacement,
project/world rollback, resize coalescing and context-restore restart. Normal
animation time, controls and adaptive work remain frozen while the coordinator
owns the canvas. The loader uses the official theme accent `#2563eb`, shows the
five phases, percentage, and a terrain outline colored by overall progress.

### Mode-specific work removed

| Mode | Previous transition work | Corrected transition work |
| --- | --- | --- |
| Manual (empty) | Forced board rebuild; 384–640² height/surface fields and 256–512² prop field allocated immediately | Reuses a compatible Studio grid; fields remain neutral 1×1 until first authored data; fixed Manual material compiled once |
| Nodes | Published and compiled Blank, then compiled the selected template; editor import was detached from readiness | Installs only the final template graph; editor import and exact preview compile run together; no water or inactive surface variant |
| Infinite | Terrain, height cache, then auxiliary materials compiled serially; cloud runtime existed even when disabled | Instanced terrain, clipmap program, water/sky/enabled-cloud materials are submitted concurrently; no disabled cloud object |
| Planet | 384 leaf meshes and 384 material objects; terrain/water, cloud and height cache waited serially | Four instanced LOD batches with face basis attributes; one shared terrain program; terrain/water, enabled cloud and height cache prepare concurrently |

At the high Manual tier, the neutral project now starts with 32 bytes of field
array payload instead of approximately 12.5 MiB (excluding JS object and GPU
driver overhead). Allocation is promoted atomically on first sculpt, surface
paint, prop paint, or restoration of existing field data. The built-in Manual
surface atlas starts in parallel with project construction after the click and
is installed before final compilation/presentation; later visits reuse the
engine atlas cache.

### Mode cache and lifetime

`ModeRenderKey` covers backend, viewport/DPR, target camera profile, project
and world mode, graph signature, terrain variant, octave topology, effective
water/cloud/post configuration, render-target format and structural LOD
settings. The active mode plus at most two inactive entries are retained. LRU
entries keep compiled terrain/water programs and lazy modules alive; exact
disposal runs on eviction, structural invalidation and engine disposal.
Infinite reuses its compiled terrain material directly. Planet rebuilds only
the lightweight batch objects while the cached instanced terrain/water
programs prevent a driver relink.

### Transition validation

- Coordinator tests cover phase order, monotonic progress, replacement
  cancellation, exactly-once completion and deterministic render keys.
- LRU tests cover active + two inactive entries, recency and precise eviction.
- Manual tests prove 1×1 cold allocation, promotion on first authored sample,
  serialization/load parity and one-upload-per-frame batching.
- Planet tests assert 384 logical chunks are represented by exactly four
  instanced leaf batches/materials before lazy merge patches.
- Engine lifecycle tests cover retired Infinite/Planet shader gates and exact
  InstancedMesh compilation probes.
- Full result: **55 test files / 486 tests passed**. Production Vite build
  completed successfully.

The requested 30 cold + 30 warm hardware measurements are not fabricated in
this report. They still require the fixed reference GPU/browser profile and a
repeatable driver shader-cache reset. The implementation emits per-stage
durations in each completion manifest so those runs can calculate p50/p95 and
verify the targets (Manual/Nodes ≥70%, Planet/Infinite ≥50%, cache revisit
<500 ms) without changing application code.

### Local GPU smoke trace

An in-app Chromium run on the detected NVIDIA Quadro P2200 validated final
boot, creation of an empty Manual project, Tile → Infinite, Infinite → Planet,
and the cached returns. The five-phase cover remained present through compile
and disappeared only after the target button became active and the final mode
reported `Ready`.

| Operation | Observed signal |
| --- | ---: |
| Final-frame application boot | 5,854 ms |
| Empty Manual exact no-atlas material compile | 13,903 ms |
| Blank Nodes exact preview compile | 1,769 ms |
| Infinite auxiliary shader submission (enabled scene set) | 8,416 ms |
| Planet enabled-cloud submission | 99,803 ms |
| Planet final scene | 384 logical chunks, 174 visible, 163K triangles |
| Planet leaf representation | 4 instanced LOD batches; additional draw calls are lazy folded patches/water/post |

The empty Manual shader no longer includes the surface-atlas graph while its
paint fields have zero coverage. That graph was a provable no-op in the empty
document, so the 13.9-second specialized result preserves its height, terrain
detail, lighting and visible pixels. Compared with the reported 30,656 ms
Manual shader wait, this observed cold shader step is 54.6% shorter. The full
atlas variant and built-in atlas are prepared under a blocking cover before
surface paint becomes active; sculpt and shape editing do not require them.

The 99.8-second Planet trace came from a saved project with clouds enabled and
is the dominant remaining cold-path bottleneck on this driver. The coordinator
now overlaps it with terrain, water and height-cache preparation, but it cannot
omit or downgrade that shader without violating the exact-final-frame rule.
The default clouds-disabled path does not construct or compile this layer.
Warm returns completed without a relink in the smoke run, but this single
interactive sample is not used as evidence for the <500 ms statistical target.

### Nodes/HMR and publication correction

The reported Nodes exception was a renderer-lifetime race, not an invalid node
graph. A shader job could finish after Vite Fast Refresh had disposed the old
engine and then dereference `this.renderer.getContext()` after that field had
become `null`. Shader compilation now captures one renderer generation, aborts
cleanly when it is disposed/replaced, and never touches a successor renderer.
Engine disposal no longer forces `WEBGL_lose_context` on a canvas React is about
to reuse. The preserved boot-ready ref also retires the new HMR boot task, so a
stale 100% cover cannot remain over the editor.

Project creation now calls `transitionMode({ worldMode: 'studio', projectMode,
project })` directly. The former visible `newProject()` followed by a separate
shader rebuild is removed from the UI path. The project loader is opaque, uses
the five transition phases, and stays through both frozen presentation frames.
Persistence happens after that cover is released and reuses the already
presented canvas for its thumbnail, avoiding a second camera render in the
first five seconds after reveal.

Browser verification on the same Quadro P2200 observed no console errors while
opening Blank Nodes, opening Manual, activating Manual surface paint, and
performing two full Vite hot reloads. In particular, neither `getContext` on
`null` nor WebGL reinitialization failure recurred.
