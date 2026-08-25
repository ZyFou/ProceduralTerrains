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

- Unit/integration suite: 53 files, 477 tests after the new boot/readback, compatibility, and monotonic-progress coverage.
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
