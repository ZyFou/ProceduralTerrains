# Performance audit implementation — 7 September 2026

Based on the supplied performance audit and baseline `1b488d99aae81fae615eecf281fb24e2f9995cdf`.

This change removes avoidable synchronization, repeated analytical sampling and retained pass targets. Requested render scale, noise octaves, cloud steps, water settings, textures, props and LOD settings are preserved. Full 3D visual parity and device-specific startup/FPS gains remain unverified; this PR should stay a draft until those checks pass.

## Changes

- **Minimap:** reuse the existing backend-neutral asynchronous readback helper in both canvas and worker paths. Limit work to one pending image, restore the render target immediately, reuse front/back CPU image buffers, and discard results after an edit, changed view, canvas handoff or disposal. Worker responses receive an owned copy so transferring the RGBA buffer cannot detach the cached map. Coalesce refresh requests while a worker result is pending.
- **Analytical maps:** preserve the 128 × 128 sample grid and 256 × 256 RGBA output. Height/water, noise, biome, slope and props views compute only the field their pixels need. Hover continues to use the complete surface sample. Batches stop after 256 samples or a cooperative 4 ms budget. Map grids and camera overlays reuse the cached base image. A hidden minimap or pending readback no longer forces full Studio scene renders through its dirty flag.
- **Shaders:** reuse the exact centre climate in the live Tile height call, including all composed offsets. Neighbour climate/height samples, Manual/Infinite cache semantics and rasterized shoreline classification are preserved. The same fogged plinth-wall branch runs before expensive terrain shading only outside debug/export modes.
- **Boot:** cloud readiness overlaps terrain/water submission and incremental geometry. The final compile stage joins readiness, refreshes the material list/target and compiles newly required variants before water activation and presentation. Isolated shader benchmarks retain their original resource-readiness precondition. Main-thread staggered submission now overlaps driver readiness instead of waiting for each material to finish linking before submitting the next.
- **Renderer ownership:** select/restore targets inside each scheduled submission, including cube face/mip and exception paths. Keep the scheduler at one submission at a time. Let Three deduplicate actual programs instead of coalescing potentially different topology/target jobs by an incomplete application key.
- **Editor loading:** defer the existing SideDrawer chunk until idle capacity after exact scene readiness, with a 1.2 s idle timeout and normal lazy loading on first use. The production chunk is about 191.9 kB / 52.8 kB gzip; this changes when it loads, not total download size. The landing scene remains mounted.
- **Memory and diagnostics:** release disabled post-processing targets and unused low-resolution cloud buffers. Track registered live/peak estimated bytes without rescanning the ledger for every reservation. Add an on-demand inventory for reachable geometry buffers, textures/atlases, retained materials, water/cloud targets and CPU backing arrays, deduplicating shared resources. The inventory is advisory; it does not change admission budgets or dispose shared resources.
- **Comparison data:** graphics and performance exports include resolved settings, scene parameters, actual/base DPR, buffer dimensions, effective scale, boot stages/render key, shader-run flags and minimap counters. Initial geometry reports queue/batch metrics while keeping the complete existing readiness gate.

## Verification performed

- Baseline: 590 tests passed across 71 files; production build passed.
- Updated branch: 618 tests passed across 73 files; production build passed. Existing Vite warnings about large chunks remain.
- Regression coverage includes single-flight readback, row order, worker buffer ownership, exact cell centres/pixels, cancellation, retries, canvas handoffs, analytical field parity, shader generation for Tile/Manual/Infinite/shared modes, compiler submission overlap and state restoration, cloud failure gating, resource release/recreation, shared-resource counting and reservation rejection.
- CPU benchmark: six map modes × three fixed seeds, non-integer zoom/centre, authored height offsets and varying props masks. All 18 complete RGBA images matched the baseline byte for byte. Raw observations and hashes are in `minimap-audit-results.json`.

The following are medians of three observations per mode in Node v24.19.0 in this environment, rounded to 0.1 ms. Runs are sequential before/after, not randomized; they are a narrow CPU check, not a browser, RTX, M4, mobile or GPU benchmark.

| Map | Before: one blocking task (ms) | After: total including yields (ms) | Largest observed new sample batch (ms) | Differing RGBA bytes |
|---|---:|---:|---:|---:|
| height | 435.4 | 156.3 | 6.6 | 0 |
| water | 446.7 | 158.0 | 6.5 | 0 |
| noise | 493.3 | 158.2 | 4.8 | 0 |
| biome | 434.4 | 113.3 | 1.3 | 0 |
| slope | 424.5 | 327.7 | 4.7 | 0 |
| props | 398.1 | 72.7 | 1.4 | 0 |

The 4 ms budget is cooperative: a single sample, GC or runtime scheduling can exceed it. The observed maximum is reported rather than claiming a strict 4 ms ceiling. Cached requests still copy the transferable RGBA payload but perform no terrain resampling or GPU readback. No FPS or general application-speed multiplier is established by these observations.

Reproduce from a checkout containing the audit baseline commit:

```sh
npm ci --ignore-scripts
npm test
npm run build
node tools/benchmark-minimap.mjs > minimap-results.json
```

The benchmark's default baseline is the pinned audit revision. It uses the current unchanged CPU height sampler and uniforms for both versions to isolate the minimap implementation.

## Pending visual/device checks

The provided browser reported `net::ERR_BLOCKED_BY_CLIENT` for both the local preview and its localhost retry. No 3D screenshots, GPU timings, actual browser cold-start timings, or first-tool latency measurements were obtained. Unit tests and analytical image equality do not establish full scene parity.

Before marking ready, compare main versus this branch at identical seed, camera, effective profile, output size and animation/history state: detailed Tile slopes and walls; above/below-water shorelines; heavy clouds; large assemblies; Manual, imported and graph terrains; Infinite and Planet. Check debug/export modes, rapid edits/resize/retry/context loss, minimap zoom/pan/hover and repeated pass/mode switches. Record ordinary cold and warm starts separately from isolated shader benchmark runs. Confirm the first visible draw introduces no unexpected cold programs.

## Audit items kept gated

The sampled Tile height/climate cache remains disabled: atomic publication alone cannot prove a sampled field matches arbitrary procedural fragment coordinates. The complete initial LOD queue/halo gate remains in place; visible-set metrics need real scene traces before shortening it. Inactive world cache eviction and full atlas/preallocation admission need an ownership and peak-memory trace before changing their policy. The new resource inventory covers known reachable resources, not all driver allocations or measured VRAM. DPR inconsistencies are now observable but this change does not silently reduce requested pixels.
