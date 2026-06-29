# Terrain Studio — Performance Roadmap

> The definitive plan for killing startup freeze and runtime heaviness.
> Branch of record: `background_loading`. All file paths are relative to repo root.

---

## TL;DR — the one root cause

The startup "freeze" is **ANGLE's GLSL→HLSL shader translation**, which runs
**synchronously on the main thread** inside every `renderer.compile()` call
(Chrome → Windows → Direct3D11).

`KHR_parallel_shader_compile` only moves the **D3D bytecode link** onto a driver
thread. The **translation itself still blocks the main thread.** So the only ways
to reduce the freeze are:

1. **Split** the compiles so the worst single stall = one shader (not the sum). ✅ done
2. **Shrink** each shader compiled up-front (fewer unrolled octaves/steps). ✅ partly done
3. **Defer** non-essential compiles until after first paint. ✅ partly done
4. **Move the GL context off the main thread entirely** (OffscreenCanvas + Worker). ⬜ **the ultimate task** — see §3

Everything else (LOD, bake resolution, auto-quality) is about *runtime* FPS, not the boot freeze.

---

## 1. Done (on `background_loading`)

All in `src/engine/Engine.js` unless noted.

- **Staggered scene compile** — `_compileSceneStaggered(renderTarget?)` compiles one
  unique scene material per animation frame, then waits for all programs in parallel.
  Worst single freeze = one shader instead of the whole scene. Used at the 3
  monolithic compile sites: boot warmup, infinite-mode switch, underwater warm.
- **Single-pass full-octave boot** — `BOOT_OCTAVES` and `_upgradeBootOctaves()`
  were removed. Terrain and water compile once at the requested octave count.
  `_setOctavesAsync` / `_rebuildStackMaterialsAsync` still stagger edits, so
  changing octaves / the noise stack does not freeze the app.
- **Deferred terrain bake + fast water init** — the first compile keeps the water
  material in the scene's warmup set, then paints with water still hidden. After
  first paint, `_warmDeferredWater()` initializes the plane in parallel with
  `_warmDeferredTerrainBake()` instead of waiting for the bake to finish.
- **Tier-scaled bake** — `_bakeBaseSize()`: low 1024² / medium 1536² / high 2048²
  (the bake re-evaluates the field 3× per texel for the normal — brutal on weak GPUs).
- **GPU tier detection narrowed** — `src/engine/render/GpuTier.js`: generic GTX /
  GeForce / old Radeon now → `medium` (Balanced); only RTX / Quadro RTX / Titan /
  RX 6-7-9 / Arc / Apple M → `high`.
- **Auto-performance ON by default + steps the whole preset down** — `_autoPerfTick`
  now, when resolution is floored and a *rendered* frame still exceeds ~45 ms
  (`profiler.frame.avg`, on-demand-safe), drops Ultra→High→Balanced→Performance and
  toasts the user. Default `autoPerf: true` in `render/PerformanceSettings.js`.
- **Boot timing logs** — `console.info('[boot] …')` lines for sync init, terrain
  warmup / first paint, and deferred terrain bake.

> ⚠️ Stored settings keep `autoPerf:false` and the old preset for returning users —
> the detection/default changes only help fresh installs or after a perf reset.

---

## 2. Next, cheap wins (no architecture change)

Measure first with the `[boot]` logs + the Performance overlay (Ctrl/Cmd+Shift+P),
then attack whichever line dominates.

- [ ] **Confirm the bottleneck** from `[boot]` numbers on the weak PC:
  `sync init` (JS/geometry) vs `terrain warmup` (ANGLE) vs deferred bake / water.
- [x] **Cap multi-cell bake size on low tier** — `TerrainHeightBaker._ensureTargetSize`
  caps at 4096²; cap to 2048² when `gpuTier === 'low'`.
- [x] **Stagger / low-step first compile for the cloud slab** — the volumetric raymarch
  (`sky/CloudSlabShader.js`, steps×lightSteps nested loops) is likely the single
  biggest *non-terrain* shader. Compile at low steps first, upgrade in background
  (mirror the boot-octaves pattern). Only matters when clouds are enabled.
- [x] **Code-split the bundle** — main chunk is ~847 KB (gzip 241 KB). Lazy-load
  planet mode, exporters, and the performance overlay via dynamic `import()` so the
  initial parse/execute on weak CPUs shrinks. (Vite already warns about this.)
- [x] **Lower default `chunkCount` (16) on low tier** — fewer chunks built
  synchronously in `applyAll` at boot.
- [x] **Persisted GPU program cache** — nothing actionable in WebGL2 (no
  `getProgramBinary`), but Chrome disk-caches linked programs, so 2nd loads are
  already faster. Document this; don't spend effort here.

Implementation notes:

- Low-tier fresh boots now clamp `chunkCount` to 12 unless an initial project explicitly supplies `chunkCount`.
- Low-tier multi-cell studio height bakes now cap their atlas at 2048^2; medium and high stay capped at 4096^2.
- Studio cloud slabs compile a tiny bootstrap program first (8 steps, 1 light step, reduced octaves), then warm and swap to the selected quality in the background.
- `Engine`, Planet mode, 3D exporters, water-mask ZIP support, and the Performance overlay are now dynamic chunks.
- Studio terrain chunks now build center-first in a small initial batch, then stream remaining chunks across frames using GPU-tier-aware budgets.
- Studio first paint now skips the height bake but precompiles water. Full octaves are used from the start, then terrain bake and water init run in parallel after first paint.
- WebGL2 still does not expose portable program binaries. Chrome's own shader disk cache remains the only practical persisted GPU program cache.

---

## 3. THE ULTIMATE TASK — OffscreenCanvas + Worker

**Goal:** move the entire renderer (and thus all shader compilation) onto a Web
Worker via `OffscreenCanvas`, so the main/UI thread NEVER freezes during compile,
bake, or heavy frames — the browser stays fully responsive no matter what the GPU
driver is doing.

This is the only way to eliminate the freeze rather than merely shorten it.

### Why it's a real project (not a one-line change)

The engine couples to the DOM in ~14 files. A worker can't touch the DOM, so every
one of these needs a proxy layer:

| Coupling | Files | Migration |
|---|---|---|
| Camera controls (`addEventListener`, `domElement`) | `EditorControls`, `FPSControls`, `PlanetOrbitControls`, `player/*Controller` | Keep listeners on the **main-thread** canvas element; forward normalized pointer/wheel/key events to the worker, OR keep controls on main thread and post camera state into the worker each frame. |
| Minimap (2D canvas) | `Minimap.js` | Render in worker → transfer `ImageBitmap` to a main-thread 2D canvas. |
| Exports / screenshots (`toDataURL`, `toBlob`) | `terrain/TerrainExporter`, `terrain/PlanetExporter`, `water/WaterMasks`, `export/*` | Read pixels in the worker; post a `Blob`/`ArrayBuffer` back. |
| Engine lifecycle | `Engine.js` | `ResizeObserver` + `visibilitychange` live on main; forward dimensions/visibility. |
| The whole `callbacks` surface (`onStatus`, `onBoard`, `onLod`, `onParams`, `onToast`, `onPerfChange`, `onStats`, `onQualityChange`, …) | `Engine.js` ↔ `App.jsx` | Serialize every callback as a `postMessage` event; React subscribes on the main thread. |
| React integration | `App.jsx`, `src/state/*` | Replace the direct `new Engine(...)` call with an `EngineProxy` that speaks `postMessage`. |

Existing asset: the project already runs a **non-GL worker** (`erosion.worker`), so
the build (Vite worker bundling) and messaging patterns exist to copy from.

### Hard constraints / gotchas

- **`transferControlToOffscreen()` is one-way** — once transferred, the main thread
  can't get a 2D/WebGL context on that canvas again. Keep a separate DOM canvas for
  the minimap.
- **Feature-detect** `typeof OffscreenCanvas !== 'undefined'` and
  `canvas.transferControlToOffscreen` — fall back to the current in-thread path
  (Safari < 17 and some setups lack it).
- **Raycasting for paint/tile picking** lives where the geometry lives (the worker) —
  pointer → worker → raycast → result back. Adds a frame of latency to hover.
- **`requestIdleCallback`** is not in workers everywhere — use explicit task/frame
  scheduling instead of relying on idle-only boot work.
- **Verification can't be done in the Claude preview** (it lands on `chrome-error://`
  for this WebGL app) — must be tested on a real GPU.

### Phased plan (each phase ships independently, flag-gated)

1. **Phase 0 - DONE.** Introduce `EngineProxy` (main thread) with the exact public
   method surface React uses today, currently delegating to an in-thread `Engine`.
   No behavior change. Add `perf.useWorker` flag (default OFF).
2. **Phase 1 — worker boot.** When the flag is ON and OffscreenCanvas is supported,
   create the `Engine` inside `engine.worker.js` with the transferred canvas; wire
   `postMessage` for params-in and the `callbacks` surface out. Camera controls stay
   on the main thread, posting camera state each frame.
3. **Phase 2 — input + resize.** Forward pointer/wheel/key + ResizeObserver +
   visibilitychange. Move paint/tile raycasting behind a request/response message.
4. **Phase 3 — minimap + exports.** Worker → `ImageBitmap` for the minimap; exports
   return `Blob` via `postMessage`.
5. **Phase 4 — flip the flag.** Default `useWorker` ON where supported, keep the
   in-thread fallback. Measure boot + frame on the user's GPU.

### Definition of done

- Cold boot: the page stays interactive (overlay animates, buttons respond, can
  scroll) for the **entire** compile/bake — zero main-thread long tasks > 50 ms in
  the Performance panel.
- Feature parity: controls, paint, minimap, all exports, all world modes, undo/redo.
- Graceful fallback on browsers without OffscreenCanvas.
- Verified on the weak PC AND the RTX desktop.

### Effort / risk

Multi-day. Touches the entire engine↔UI boundary. Must be done on a dedicated branch
with the in-thread path kept working as a fallback the whole time. **Do not attempt
to land blind / unverified** — it can leave the app non-functional.

---

## 4. How to measure

- **Boot:** read the `[boot]` console lines (added on this branch).
- **Runtime:** Performance overlay — Ctrl/Cmd+Shift+P (CPU frame ms, GPU timer,
  draw calls, triangles, `lastBakeMs`).
- **Main-thread freezes:** Chrome DevTools → Performance → record a reload → look for
  long tasks (red-flagged) during the compile/bake window.
- **Always test on both** the weak PC and the RTX desktop; tier-scaled code paths
  differ between them.




